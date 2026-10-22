import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dispatch } from "./index";
import { findProjectRoot, inLaneWorktree, isActive, onePositional, openProject, parse, printJson } from "./project";
import { isolatedGit, makeProject, type TestProject } from "./testkit";

let p: TestProject;
afterEach(() => p?.dispose());

describe("findProjectRoot", () => {
  it("prefers the nearest arbab.config.json", () => {
    p = makeProject();
    mkdirSync(join(p.root, "sub", "inner"), { recursive: true });
    writeFileSync(join(p.root, "sub", "arbab.config.json"), "{}");
    expect(findProjectRoot(join(p.root, "sub", "inner"), p.git)).toBe(join(p.root, "sub"));
    expect(findProjectRoot(join(p.root, "lanes"), p.git)).toBe(p.root);
  });

  it("falls back to the git top level, then to null", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "arbab-root-")));
    try {
      const git = isolatedGit(dir);
      expect(findProjectRoot(dir, git)).toBeNull();
      git(["init", "-q", join(dir, "repo")], dir);
      mkdirSync(join(dir, "repo", "src"));
      expect(findProjectRoot(join(dir, "repo", "src"), git)).toBe(join(dir, "repo"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("inLaneWorktree", () => {
  it("is true for a path with a .arbab/worktrees pair of components", () => {
    expect(inLaneWorktree("/work/repo/.arbab/worktrees/a")).toBe(true);
    expect(inLaneWorktree("/work/repo/.arbab/worktrees/a/src")).toBe(true);
    expect(inLaneWorktree("/work/repo/.arbab/worktrees")).toBe(true);
    expect(inLaneWorktree("/work/repo")).toBe(false);
    expect(inLaneWorktree("/work/repo/.arbab/runs/a")).toBe(false);
    expect(inLaneWorktree("/work/repo/x.arbab/worktrees/a")).toBe(false);
    expect(inLaneWorktree("/work/repo/.arbab/worktrees-old/a")).toBe(false);
    expect(inLaneWorktree("/work/.arbab/repo/worktrees")).toBe(false);
  });
});

describe("findProjectRoot in a lane worktree", () => {
  function laneWorktree(t: TestProject): string {
    const lane = join(t.worktreeRoot, "demo");
    t.ok(["worktree", "add", "-q", "-b", "arbab/demo", lane, "main"]);
    return lane;
  }

  it("refuses a worktree found by git, with its .arbab/config.json, from it and from below it", () => {
    p = makeProject();
    const lane = laneWorktree(p);
    mkdirSync(join(lane, ".arbab"), { recursive: true });
    writeFileSync(join(lane, ".arbab", "config.json"), "{}");
    rmSync(join(lane, "arbab.config.json"));
    // The worktree has no arbab.config.json, but the walk up finds the project's: that root is the human's.
    expect(findProjectRoot(lane, p.git)).toBe(p.root);
    rmSync(join(p.root, "arbab.config.json"));
    expect(() => findProjectRoot(lane, p.git)).toThrow(expect.objectContaining({ code: "usage" }));
    mkdirSync(join(lane, "src"));
    expect(() => findProjectRoot(join(lane, "src"), p.git)).toThrow(/lane worktree/);
  });

  it("refuses a worktree holding arbab.config.json, and a symlink to it", () => {
    p = makeProject();
    const lane = laneWorktree(p);
    expect(() => findProjectRoot(lane, p.git)).toThrow(/lane worktree/);
    symlinkSync(lane, join(p.dir, "lane-link"));
    expect(() => findProjectRoot(join(p.dir, "lane-link"), p.git)).toThrow(/lane worktree/);
    expect(() => openProject({ cwd: lane, git: p.git })).toThrow(expect.objectContaining({ code: "usage" }));
  });

  it("refuses it from the cwd and through -C, before loading its config", async () => {
    p = makeProject();
    const lane = laneWorktree(p);
    // A config that would not load: the refusal comes first.
    writeFileSync(join(lane, "arbab.config.json"), JSON.stringify({ nope: 1 }));
    expect(await dispatch(["-C", lane, "status"], p.ctx)).toBe(1);
    expect(p.stderr()).toMatch(/lane worktree/);
    p.err.length = 0;
    expect(await dispatch(["status"], { ...p.ctx, cwd: lane })).toBe(1);
    expect(p.stderr()).toMatch(/lane worktree/);
    expect(p.stderr()).not.toMatch(/unknown key/);
  });
});

describe("openProject", () => {
  it("returns the root, config and absolute roots", () => {
    p = makeProject({ config: { runsRoot: "var/runs" } });
    const project = openProject(p.ctx);
    expect(project.root).toBe(p.root);
    expect(project.runsRoot).toBe(join(p.root, "var", "runs"));
    expect(project.worktreeRoot).toBe(p.worktreeRoot);
  });

  it("refuses a directory outside any project, and an invalid config", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "arbab-root-")));
    try {
      expect(() => openProject({ cwd: dir, git: isolatedGit(dir) })).toThrow(/no arbab.config.json/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    p = makeProject({ config: { nope: 1 } });
    expect(() => openProject(p.ctx)).toThrow(/unknown key/);
  });
});

describe("argument helpers", () => {
  it("parse is strict and turns errors into usage errors", () => {
    const options = { json: { type: "boolean" as const } };
    expect(parse("x", { args: ["--json", "a"], options, allowPositionals: true }).positionals).toEqual(["a"]);
    expect(() => parse("x", { args: ["--nope"], options, allowPositionals: true })).toThrow(/see arbab x --help/);
    expect(() => parse("x", { args: ["a"], options, allowPositionals: false })).toThrow(expect.objectContaining({ code: "usage" }));
  });

  it("onePositional wants exactly one", () => {
    expect(onePositional("x", ["a"], "lane")).toBe("a");
    expect(() => onePositional("x", [], "lane")).toThrow("usage: arbab x <lane>");
    expect(() => onePositional("x", ["a", "b"], "lane")).toThrow("usage: arbab x <lane>");
  });

  it("printJson writes indented JSON and a newline", () => {
    const out: string[] = [];
    printJson({ stdout: (t) => out.push(t) }, { a: 1 });
    expect(out.join("")).toBe('{\n  "a": 1\n}\n');
  });

  it("isActive is everything but finished and orphaned", () => {
    expect(isActive("running")).toBe(true);
    expect(isActive("held")).toBe(true);
    expect(isActive("finished")).toBe(false);
    expect(isActive("orphaned")).toBe(false);
  });
});
