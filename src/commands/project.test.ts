import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dispatch } from "./index";
import {
  findProjectRoot,
  inLaneWorktree,
  isActive,
  onePositional,
  openProject,
  parse,
  printJson,
  type LaneWorktreeIo,
} from "./project";
import { DEFAULT_CONFIG, isolatedGit, makeProject, type TestProject } from "./testkit";

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
  // A fake file system: `files` by exact path, and a realpath that knows only `links`.
  function fakeIo(files: Record<string, string> = {}, links: Record<string, string> = {}): LaneWorktreeIo {
    return {
      readFile: (p) => {
        const text = files[p];
        if (text === undefined) throw new Error(`ENOENT ${p}`);
        return text;
      },
      realpath: (p) => {
        const target = links[p];
        if (target === undefined) throw new Error(`ENOENT ${p}`);
        return target;
      },
    };
  }

  it("is true for a path with a .arbab/worktrees pair of components", () => {
    const io = fakeIo();
    expect(inLaneWorktree("/work/repo/.arbab/worktrees/a", io)).toBe(true);
    expect(inLaneWorktree("/work/repo/.arbab/worktrees/a/src", io)).toBe(true);
    expect(inLaneWorktree("/work/repo/.arbab/worktrees", io)).toBe(true);
    expect(inLaneWorktree("/work/repo", io)).toBe(false);
    expect(inLaneWorktree("/work/repo/.arbab/runs/a", io)).toBe(false);
    expect(inLaneWorktree("/work/repo/x.arbab/worktrees/a", io)).toBe(false);
    expect(inLaneWorktree("/work/repo/.arbab/worktrees-old/a", io)).toBe(false);
    expect(inLaneWorktree("/work/.arbab/repo/worktrees", io)).toBe(false);
  });

  it("ignores case in the pair, as a case-insensitive file system does", () => {
    const io = fakeIo();
    expect(inLaneWorktree("/work/repo/.ARBAB/WORKTREES/a", io)).toBe(true);
    expect(inLaneWorktree("/work/repo/.Arbab/Worktrees", io)).toBe(true);
    expect(inLaneWorktree("/work/repo/.ARBAB/RUNS/a", io)).toBe(false);
  });

  it("checks the spelling on disk as well as the one given", () => {
    // A link into a worktree, and another spelling the file system folds to it.
    const io = fakeIo({}, { "/work/link": "/work/repo/.arbab/worktrees/a", "/WORK/REPO/LANE": "/work/repo/.arbab/worktrees/a" });
    expect(inLaneWorktree("/work/link", io)).toBe(true);
    expect(inLaneWorktree("/WORK/REPO/LANE", io)).toBe(true);
    expect(inLaneWorktree("/work/other", io)).toBe(false);
    // The lexical spelling counts when the canonical one does not.
    expect(inLaneWorktree("/work/repo/.arbab/worktrees/a", fakeIo({}, { "/work/repo/.arbab/worktrees/a": "/elsewhere/a" }))).toBe(true);
  });

  it("is true at or under a worktreeRoot an ancestor's arbab.config.json sets, ignoring case", () => {
    const io = fakeIo({ "/work/repo/arbab.config.json": JSON.stringify({ worktreeRoot: "wt", baseBranch: "main" }) });
    expect(inLaneWorktree("/work/repo/wt", io)).toBe(true);
    expect(inLaneWorktree("/work/repo/wt/a", io)).toBe(true);
    expect(inLaneWorktree("/work/repo/wt/a/src", io)).toBe(true);
    expect(inLaneWorktree("/work/repo/WT/a", io)).toBe(true);
    expect(inLaneWorktree("/work/repo", io)).toBe(false);
    expect(inLaneWorktree("/work/repo/src", io)).toBe(false);
    expect(inLaneWorktree("/work/repo/wt-old/a", io)).toBe(false);
    // Through the spelling on disk.
    const linked = fakeIo({ "/work/repo/arbab.config.json": JSON.stringify({ worktreeRoot: "lanes/wt" }) }, { "/work/l": "/work/repo/lanes/wt/a" });
    expect(inLaneWorktree("/work/l", linked)).toBe(true);
  });

  it("reads .arbab/config.json too, and both when both exist", () => {
    const io = fakeIo({
      "/work/repo/arbab.config.json": JSON.stringify({ worktreeRoot: "one" }),
      "/work/repo/.arbab/config.json": JSON.stringify({ worktreeRoot: "two/lanes" }),
    });
    expect(inLaneWorktree("/work/repo/one/a", io)).toBe(true);
    expect(inLaneWorktree("/work/repo/two/lanes/a", io)).toBe(true);
    expect(inLaneWorktree("/work/repo/two", io)).toBe(false);
    const local = fakeIo({ "/work/repo/.arbab/config.json": JSON.stringify({ worktreeRoot: "wt" }) });
    expect(inLaneWorktree("/work/repo/wt/a", local)).toBe(true);
    expect(inLaneWorktree("/work/repo", local)).toBe(false);
  });

  it("adds nothing for a worktreeRoot outside or at its ancestor, or a config that is not one", () => {
    for (const text of [
      JSON.stringify({ worktreeRoot: "../elsewhere" }),
      JSON.stringify({ worktreeRoot: "/work/elsewhere" }),
      JSON.stringify({ worktreeRoot: "." }),
      JSON.stringify({ worktreeRoot: "" }),
      JSON.stringify({ worktreeRoot: 7 }),
      JSON.stringify({ worktreeRoot: ["elsewhere"] }),
      JSON.stringify({ nested: { worktreeRoot: "elsewhere" } }),
      JSON.stringify(["worktreeRoot", "elsewhere"]),
      JSON.stringify("elsewhere"),
      "null",
      "{not json",
    ]) {
      const io = fakeIo({ "/work/repo/arbab.config.json": text, "/work/repo/.arbab/config.json": text });
      expect(inLaneWorktree("/work/elsewhere/a", io), text).toBe(false);
      expect(inLaneWorktree("/work/repo/a", io), text).toBe(false);
      expect(inLaneWorktree("/work/repo", io), text).toBe(false);
    }
  });

  it("adds nothing for a config it cannot read", () => {
    const io: LaneWorktreeIo = {
      realpath: (p) => p,
      readFile: () => {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      },
    };
    expect(inLaneWorktree("/work/repo/wt/a", io)).toBe(false);
  });

  it("reads real files by default", () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "arbab-root-")));
    try {
      mkdirSync(join(dir, "repo", "wt", "a"), { recursive: true });
      writeFileSync(join(dir, "repo", "arbab.config.json"), JSON.stringify({ worktreeRoot: "wt" }));
      expect(inLaneWorktree(join(dir, "repo", "wt", "a"))).toBe(true);
      expect(inLaneWorktree(join(dir, "repo", "wt", "missing"))).toBe(true);
      expect(inLaneWorktree(join(dir, "repo"))).toBe(false);
      // Unreadable: a directory where the config would be.
      rmSync(join(dir, "repo", "arbab.config.json"));
      mkdirSync(join(dir, "repo", "arbab.config.json"));
      expect(inLaneWorktree(join(dir, "repo", "wt", "a"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

  it("refuses a worktree under the worktreeRoot arbab.config.json sets, and still opens the project", async () => {
    p = makeProject({ config: { ...DEFAULT_CONFIG, worktreeRoot: "wt" } });
    const lane = join(p.root, "wt", "demo");
    p.ok(["worktree", "add", "-q", "-b", "arbab/demo", lane, "main"]);
    mkdirSync(join(lane, "src"));
    // The worker's own config would point elsewhere; the project's still decides.
    writeFileSync(join(lane, "arbab.config.json"), JSON.stringify({ commands: { implementer: ["sh evil.sh"] } }));
    expect(() => findProjectRoot(lane, p.git)).toThrow(/lane worktree/);
    expect(() => findProjectRoot(join(lane, "src"), p.git)).toThrow(expect.objectContaining({ code: "usage" }));
    expect(await dispatch(["-C", lane, "status"], p.ctx)).toBe(1);
    expect(p.stderr()).toMatch(/lane worktree/);
    expect(findProjectRoot(p.root, p.git)).toBe(p.root);
    expect(openProject(p.ctx).worktreeRoot).toBe(join(p.root, "wt"));
  });

  it("refuses a worktree under the worktreeRoot .arbab/config.json sets, and still opens the project", () => {
    p = makeProject();
    const lane = join(p.root, "wt", "demo");
    p.ok(["worktree", "add", "-q", "-b", "arbab/demo", lane, "main"]);
    mkdirSync(join(lane, "src"));
    rmSync(join(p.root, "arbab.config.json"));
    p.write(".arbab/config.json", JSON.stringify({ ...DEFAULT_CONFIG, worktreeRoot: "wt" }));
    // The lane still holds the committed arbab.config.json, with the default worktreeRoot.
    expect(() => findProjectRoot(lane, p.git)).toThrow(/lane worktree/);
    expect(() => findProjectRoot(join(lane, "src"), p.git)).toThrow(/lane worktree/);
    rmSync(join(lane, "arbab.config.json"));
    expect(() => findProjectRoot(lane, p.git)).toThrow(/lane worktree/);
    expect(findProjectRoot(p.root, p.git)).toBe(p.root);
    expect(openProject(p.ctx).worktreeRoot).toBe(join(p.root, "wt"));
  });

  it("refuses a .ARBAB/WORKTREES spelling", () => {
    p = makeProject();
    const lane = join(p.root, ".ARBAB", "WORKTREES", "demo");
    mkdirSync(lane, { recursive: true });
    writeFileSync(join(lane, "arbab.config.json"), "{}");
    expect(() => findProjectRoot(lane, p.git)).toThrow(/lane worktree/);
  });

  it("adds nothing for a worktreeRoot outside the project, or a config it cannot parse", () => {
    p = makeProject();
    const other = join(p.dir, "elsewhere", "demo");
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, "arbab.config.json"), "{}");
    writeFileSync(join(p.root, "arbab.config.json"), JSON.stringify({ worktreeRoot: "../elsewhere" }));
    expect(findProjectRoot(other, p.git)).toBe(other);
    writeFileSync(join(p.dir, "arbab.config.json"), "{not json");
    expect(findProjectRoot(other, p.git)).toBe(other);
    writeFileSync(join(p.dir, "arbab.config.json"), JSON.stringify({ worktreeRoot: 1 }));
    expect(findProjectRoot(other, p.git)).toBe(other);
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
