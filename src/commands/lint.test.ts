import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compileProfile } from "../profile";
import { ArbabError } from "../util/errors";
import { formatIssue, hasErrors, issueSummary, lintLane, lintLaneSpec, profileInputFor, resolveGitCommonDir, runLint } from "./lint";
import { openProject } from "./project";
import { makeProject, type TestProject } from "./testkit";

// The real compiler, spied on so tests can see the ProfileInput each lint compiled.
vi.mock("../profile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../profile")>();
  return { ...actual, compileProfile: vi.fn(actual.compileProfile) };
});

let p: TestProject;
afterEach(() => {
  p?.dispose();
  vi.mocked(compileProfile).mockClear();
});

describe("resolveGitCommonDir", () => {
  it("is the absolute, real shared git directory, from the root or a linked worktree", () => {
    p = makeProject();
    expect(resolveGitCommonDir(p.git, p.root)).toBe(join(p.root, ".git"));
    const wt = join(p.dir, "wt");
    p.ok(["worktree", "add", "-q", wt]);
    expect(resolveGitCommonDir(p.git, wt)).toBe(join(p.root, ".git"));
    symlinkSync(p.root, join(p.dir, "link"));
    expect(resolveGitCommonDir(p.git, join(p.dir, "link"))).toBe(join(p.root, ".git"));
  });

  it("is undefined outside a git repository", () => {
    p = makeProject();
    const plain = join(p.dir, "plain");
    mkdirSync(plain);
    expect(resolveGitCommonDir((args) => ({ code: 128, stdout: "", stderr: `not a repository: ${args.join(" ")}` }), plain)).toBeUndefined();
  });
});

describe("profileInputFor", () => {
  it("compiles the shepherd's input with placeholder leases and the lane's worktree", () => {
    p = makeProject({ config: { commands: { implementer: ["pnpm test"] }, resources: { port: { range: [4000, 4010] } } } });
    const project = openProject(p.ctx);
    const input = profileInputFor(project, {
      name: "demo",
      role: "implementer",
      brief: "lanes/demo.md",
      resources: { port: 2 },
      allow: ["Bash(make check)"],
    });
    expect(input.env).toMatchObject({ ARBAB_PORT_0: "0", ARBAB_PORT_1: "0" });
    expect(input.worktree).toBe(`${p.worktreeRoot}/demo`);
    expect(input.commands).toEqual(["pnpm test"]);
    expect(input.laneAllow).toEqual(["Bash(make check)"]);
    expect(input.fence).toBe("strict");
  });

  it("uses the borrowed worktree of another lane", () => {
    p = makeProject();
    const input = profileInputFor(openProject(p.ctx), { name: "check", role: "verifier", brief: "lanes/demo.md", worktree: "demo" });
    expect(input.worktree).toBe(`${p.worktreeRoot}/demo`);
  });

  it("carries the shared git directory only when given one", () => {
    p = makeProject();
    const lane = { name: "demo", role: "implementer" as const, brief: "lanes/demo.md" };
    expect(profileInputFor(openProject(p.ctx), lane, "/r/.git").gitCommonDir).toBe("/r/.git");
    expect("gitCommonDir" in profileInputFor(openProject(p.ctx), lane)).toBe(false);
  });

  it("lints a lane with the tools it narrowed to, as the shepherd runs it", () => {
    p = makeProject();
    const lane = { name: "demo", role: "probe" as const, brief: "lanes/demo.md" };
    expect(profileInputFor(openProject(p.ctx), lane).tools).toEqual(["Read", "Write", "Bash"]);
    expect(profileInputFor(openProject(p.ctx), { ...lane, tools: ["Read", "Bash"] }).tools).toEqual(["Read", "Bash"]);
  });
});

describe("lintLane", () => {
  it("passes a clean lane", () => {
    p = makeProject();
    // The shepherd always knows the shared git dir, so a clean lane lints clean only with it.
    expect(lintLane(openProject(p.ctx), "lanes/demo.json", resolveGitCommonDir(p.git, p.root)).issues).toEqual([]);
  });

  it("reports profile errors, brief errors and a schema that is not JSON", () => {
    p = makeProject({
      lanes: { "lanes/bad.json": { name: "bad", role: "implementer", brief: "lanes/bad.md", allow: ["Bash(node *)"], schema: "lanes/bad.schema.json" } },
      files: { "lanes/bad.md": "# Bad\n\n## Task\n\nRun `cd src && pnpm test`.\n", "lanes/bad.schema.json": "{nope" },
    });
    const codes = lintLane(openProject(p.ctx), "lanes/bad.json").issues.map((i) => i.code);
    expect(codes).toContain("any-code-allow");
    expect(codes).toContain("missing-section");
    expect(codes).toContain("forbidden-shape");
    expect(codes).toContain("schema-json");
  });

  it("warns that the shared git dir is writable when it is not known", () => {
    p = makeProject();
    const codes = lintLane(openProject(p.ctx), "lanes/demo.json").issues.map((i) => i.code);
    expect(codes).toEqual(["shared-git-writable"]);
  });

  it("refuses a schema that is JSON but not an object", () => {
    p = makeProject({
      lanes: { "lanes/s.json": { name: "s", role: "implementer", brief: "lanes/demo.md", schema: "lanes/s.schema.json" } },
      files: { "lanes/s.schema.json": "[1]" },
    });
    const issues = lintLane(openProject(p.ctx), "lanes/s.json", resolveGitCommonDir(p.git, p.root)).issues;
    expect(issues).toEqual([expect.objectContaining({ severity: "error", code: "schema-json" })]);
  });

  it("throws on an invalid lane file", () => {
    p = makeProject({ lanes: { "lanes/x.json": { name: "X Y", role: "implementer", brief: "lanes/demo.md" } } });
    expect(() => lintLane(openProject(p.ctx), "lanes/x.json")).toThrow(ArbabError);
  });
});

describe("lintLaneSpec", () => {
  it("lints a spec that has no file, as lintLane lints the same spec from one", () => {
    p = makeProject();
    const project = openProject(p.ctx);
    const fromFile = lintLane(project, "lanes/demo.json");
    expect(lintLaneSpec(project, fromFile.lane)).toEqual(fromFile);
    const bad = lintLaneSpec(project, { name: "x", role: "implementer", brief: "lanes/demo.md", allow: ["Bash"], mergeBranches: ["arbab/y"] });
    expect(bad.issues.map((i) => i.code)).toContain("bare-bash-allow");
    expect(() => lintLaneSpec(project, { name: "x", role: "implementer", brief: "lanes/none.md" })).toThrow(/cannot read brief/);
  });
});

describe("formatting", () => {
  it("prints severity, code, message and where", () => {
    expect(formatIssue({ severity: "error", code: "c", message: "m", where: "w" })).toBe("error  c  m  (w)");
    expect(formatIssue({ severity: "warning", code: "c", message: "m" })).toBe("warning  c  m");
  });
  it("counts errors and warnings", () => {
    const issues = [
      { severity: "error" as const, code: "a", message: "" },
      { severity: "warning" as const, code: "b", message: "" },
    ];
    expect(hasErrors(issues)).toBe(true);
    expect(hasErrors([issues[1]!])).toBe(false);
    expect(issueSummary("x", issues)).toBe("x: 1 error(s), 1 warning(s)");
    expect(issueSummary("x", [])).toBe("x: ok");
  });
});

describe("runLint", () => {
  it("exits 0 and prints ok for a clean lane", async () => {
    p = makeProject();
    expect(await runLint(["lanes/demo.json"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe("demo: ok\n");
  });

  it("compiles the profile with the repository's shared git directory, as the shepherd will", async () => {
    p = makeProject();
    expect(await runLint(["lanes/demo.json"], p.ctx)).toBe(0);
    expect(vi.mocked(compileProfile)).toHaveBeenCalledWith(expect.objectContaining({ gitCommonDir: join(p.root, ".git") }));
  });

  it("exits 1 on errors, with a stable --json shape", async () => {
    p = makeProject({ lanes: { "lanes/bad.json": { name: "bad", role: "implementer", brief: "lanes/demo.md", allow: ["Bash"] } } });
    expect(await runLint(["lanes/bad.json", "--json"], p.ctx)).toBe(1);
    const out = JSON.parse(p.stdout()) as { lane: string; ok: boolean; issues: Array<{ code: string }> };
    expect(out.lane).toBe("bad");
    expect(out.ok).toBe(false);
    expect(out.issues.map((i) => i.code)).toContain("bare-bash-allow");
  });

  it("finds the project from a subdirectory", async () => {
    p = makeProject();
    p.ctx.cwd = `${p.root}/lanes`;
    expect(await runLint(["lanes/demo.json"], p.ctx)).toBe(0);
  });

  it("rejects unknown flags and a missing lane file argument as usage errors", async () => {
    p = makeProject();
    await expect(runLint(["--nope", "lanes/demo.json"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runLint([], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runLint(["a", "b"], p.ctx)).rejects.toMatchObject({ code: "usage" });
  });
});
