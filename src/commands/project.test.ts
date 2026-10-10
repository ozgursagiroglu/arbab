import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findProjectRoot, isActive, onePositional, openProject, parse, printJson } from "./project";
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
