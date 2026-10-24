import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig, loadConfig } from "../config";
import { HOOK_MISSING } from "../doctor";
import {
  checkClaude,
  checkGit,
  checkHome,
  checkNode,
  checkSandbox,
  doctorChecks,
  formatChecks,
  projectChecks,
  runDoctor,
} from "./doctor";
import { fakeDeps, makeProject, writeLaneRun, type TestProject } from "./testkit";

let p: TestProject;
afterEach(() => p?.dispose());

describe("individual checks", () => {
  it("node must be at least 20", () => {
    expect(checkNode("20.11.0").status).toBe("ok");
    expect(checkNode("18.19.1")).toMatchObject({ status: "fail", detail: "18.19.1 is older than 20.0.0" });
    expect(checkNode("weird").status).toBe("fail");
  });

  it("git must be at least 2.20", () => {
    const git = (stdout: string, code = 0) => () => ({ code, stdout, stderr: "boom" });
    expect(checkGit({ cwd: "/", git: git("git version 2.39.5 (Apple Git-154)\n") })).toMatchObject({ status: "ok", detail: "2.39.5" });
    expect(checkGit({ cwd: "/", git: git("git version 2.19.0\n") }).status).toBe("fail");
    expect(checkGit({ cwd: "/", git: git("", 127) })).toMatchObject({ status: "fail", detail: "git --version failed: boom" });
  });

  it("claude must resolve at the configured minimum", () => {
    const deps = fakeDeps("/h", "/c");
    expect(checkClaude(deps, defaultConfig())).toMatchObject({ status: "ok" });
    expect(checkClaude(deps, { ...defaultConfig(), minClaudeVersion: "2.2.0" })).toMatchObject({ status: "fail" });
    expect(checkClaude(fakeDeps("/h", "/c", { pathEnv: "/nowhere" }), defaultConfig()).detail).toMatch(/not found/);
  });

  it("sandbox needs sandbox-exec on macOS and bwrap + socat on Linux", () => {
    const deps = fakeDeps("/h", "/c");
    expect(checkSandbox("darwin", deps).status).toBe("ok");
    expect(checkSandbox("linux", deps).status).toBe("ok");
    const bare = fakeDeps("/h", "/c", { exists: (f) => f === "/usr/bin/bwrap" });
    expect(checkSandbox("darwin", bare).status).toBe("fail");
    expect(checkSandbox("linux", bare)).toMatchObject({ status: "fail", detail: "socat not on PATH" });
    expect(checkSandbox("win32", deps).status).toBe("fail");
  });

  it("home must be writable", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "arbab-home-")));
    try {
      expect(checkHome(join(dir, "home")).status).toBe("ok");
      mkdirSync(join(dir, "ro"));
      chmodSync(join(dir, "ro"), 0o500);
      expect(checkHome(join(dir, "ro")).status).toBe("fail");
    } finally {
      chmodSync(join(dir, "ro"), 0o700);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("doctorChecks", () => {
  it("runs every check in order", () => {
    p = makeProject();
    expect(doctorChecks(p.ctx).map((c) => [c.check, c.status])).toEqual([
      ["node", "ok"],
      ["git", "ok"],
      ["config", "ok"],
      ["claude", "ok"],
      ["sandbox", "ok"],
      ["hook", "warn"],
      ["ignored", "warn"],
      ["disk", "ok"],
      ["home", "ok"],
    ]);
  });

  it("runs the project checks of a project that has everything to check, warnings only", () => {
    p = makeProject({
      files: {
        ".arbab/config.json": "{}",
        "eslint.config.js": "export default [];\n",
        "vitest.config.ts": "export default {};\n",
        "package.json": JSON.stringify({ scripts: { test: "vitest run", lint: "eslint ." } }),
      },
    });
    mkdirSync(join(p.dir, "plugin", "hooks"), { recursive: true });
    writeFileSync(join(p.dir, "plugin", "hooks", "hooks.json"), '{"command": "arbab hook pre-tool-use"}');
    mkdirSync(p.home, { recursive: true });
    writeFileSync(join(p.home, "machine.json"), JSON.stringify({ maxParallel: 2 }));
    const checks = doctorChecks(p.ctx);
    expect(checks.map((c) => [c.check, c.status])).toEqual([
      ["node", "ok"],
      ["git", "ok"],
      ["config", "ok"],
      ["configs", "warn"],
      ["claude", "ok"],
      ["sandbox", "ok"],
      ["hook", "ok"],
      ["ignored", "warn"],
      ["eslint", "warn"],
      ["tests", "warn"],
      ["gates", "warn"],
      ["disk", "ok"],
      ["machine", "ok"],
      ["home", "ok"],
    ]);
    expect(checks.find((c) => c.check === "machine")?.detail).toBe("maxParallel min(4, 2) = 2");
  });

  it("gives the disk check the unused worktrees and the free space of their volume, and warns when it runs low", () => {
    p = makeProject();
    mkdirSync(join(p.worktreeRoot, "old"), { recursive: true });
    mkdirSync(join(p.worktreeRoot, "young"), { recursive: true });
    writeLaneRun(p.runsRoot, "old", { state: "finished", endState: "success", since: "2026-08-30T12:00:00.000Z" });
    writeLaneRun(p.runsRoot, "young", { state: "finished", endState: "success", since: "2026-10-09T11:00:00.000Z" });
    const asked: string[] = [];
    p.ctx.freeSpace = (path) => {
      asked.push(path);
      return p.free.bytes;
    };
    const disk = (): string[] => projectChecks(p.ctx, p.root, loadConfig(p.root)).filter((c) => c.check === "disk").map((c) => `${c.status} ${c.detail}`);
    expect(disk()).toEqual(["ok 2 worktree directories (1 unused for 3+ days), 500.0 GB free, 0 empty lock directories"]);
    expect(asked).toEqual([p.worktreeRoot]);
    p.free.bytes = 12.5e9;
    expect(disk()).toEqual([
      "warn 12.5 GB free on the volume of .arbab/worktrees (less than 20.0 GB; 1 unused for 3+ days): the automatic sweep (worktrees.idleDays 3) " +
        "removes them after a launch; arbab cleanup --worktrees --older-than <days> removes unused ones now",
    ]);
  });

  it("reports a project check that throws as a warning and goes on", () => {
    p = makeProject();
    mkdirSync(p.home, { recursive: true });
    writeFileSync(join(p.home, "machine.json"), "{");
    const config = { ...defaultConfig(), worktreeRoot: "../outside" };
    const checks = projectChecks(p.ctx, p.root, config);
    expect(checks.find((c) => c.check === "ignored")).toMatchObject({ status: "warn", detail: expect.stringMatching(/^could not check: /) });
    expect(checks.find((c) => c.check === "disk")).toMatchObject({ status: "warn", detail: expect.stringMatching(/^could not check: /) });
    expect(checks.find((c) => c.check === "machine")?.status).toBe("fail");
  });

  it("skips the hook check when the runner is not in a dist directory", () => {
    p = makeProject();
    p.ctx.scriptPath = join(p.dir, "src", "cli.ts");
    expect(doctorChecks(p.ctx).some((c) => c.check === "hook")).toBe(false);
  });

  it("fails config, claude and sandbox when they cannot be read", () => {
    p = makeProject({ config: { maxParallel: 0 } });
    p.ctx.shepherdDeps = () => {
      throw new Error("the shepherd is not implemented yet");
    };
    const checks = doctorChecks(p.ctx);
    expect(checks.filter((c) => c.status === "fail").map((c) => c.check)).toEqual(["config", "claude", "sandbox"]);
    expect(checks.some((c) => c.check === "ignored")).toBe(false);
  });

  it("fails config outside any project", () => {
    p = makeProject();
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "arbab-noproj-")));
    try {
      p.ctx.cwd = outside;
      expect(doctorChecks(p.ctx).find((c) => c.check === "config")?.status).toBe("fail");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("runDoctor", () => {
  it("prints aligned lines and exits 0 with warnings only", async () => {
    p = makeProject();
    expect(await runDoctor([], p.ctx)).toBe(0);
    const lines = p.stdout().trimEnd().split("\n");
    expect(lines[0]).toBe("ok    node     20.11.0");
    expect(lines.filter((l) => l.startsWith("warn"))).toEqual([
      `warn  hook     ${HOOK_MISSING}`,
      "warn  ignored  .arbab/ not ignored yet (the shepherd adds it to info/exclude on the next launch)",
    ]);
  });

  it("exits 1 when a check fails, with --json", async () => {
    p = makeProject();
    p.ctx.nodeVersion = "18.0.0";
    expect(await runDoctor(["--json"], p.ctx)).toBe(1);
    const out = JSON.parse(p.stdout()) as { ok: boolean; checks: Array<{ status: string; check: string; detail: string }> };
    expect(out.ok).toBe(false);
    expect(out.checks[0]).toEqual({ status: "fail", check: "node", detail: "18.0.0 is older than 20.0.0" });
  });

  it("rejects usage errors", async () => {
    p = makeProject();
    await expect(runDoctor(["--fix"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runDoctor(["x"], p.ctx)).rejects.toMatchObject({ code: "usage" });
  });
});

describe("formatChecks", () => {
  it("pads status and check names", () => {
    expect(formatChecks([
      { status: "ok", check: "a", detail: "x" },
      { status: "fail", check: "long", detail: "y" },
    ])).toBe("ok    a     x\nfail  long  y");
  });
});
