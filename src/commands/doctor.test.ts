import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../config";
import {
  checkClaude,
  checkGit,
  checkHome,
  checkIgnored,
  checkNode,
  checkSandbox,
  doctorChecks,
  formatChecks,
  runDoctor,
} from "./doctor";
import { fakeDeps, makeProject, type TestProject } from "./testkit";

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

  it("ignored roots are a warning until the shepherd adds them", () => {
    p = makeProject();
    const config = defaultConfig();
    expect(checkIgnored(p.ctx, p.root, config).status).toBe("warn");
    writeFileSync(join(p.root, ".git", "info", "exclude"), ".arbab/\n");
    expect(checkIgnored(p.ctx, p.root, config).status).toBe("ok");
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
      ["ignored", "warn"],
      ["home", "ok"],
    ]);
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
    expect(lines.find((l) => l.startsWith("warn"))).toMatch(/^warn  ignored  /);
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
