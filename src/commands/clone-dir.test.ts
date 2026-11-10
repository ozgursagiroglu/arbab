import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ArgvRunner } from "../run";
import { runCloneDir } from "./clone-dir";
import { dispatch } from "./index";
import { makeProject, type TestProject } from "./testkit";

let p: TestProject;
let wt: string;
let calls: string[][];
/** What the fake cp answers; a failing one leaves half a copy behind. */
let cp: { code: number };

beforeEach(() => {
  p = makeProject();
  mkdirSync(join(p.root, "node_modules", "left-pad"), { recursive: true });
  wt = join(p.worktreeRoot, "lane");
  mkdirSync(wt, { recursive: true });
  calls = [];
  cp = { code: 0 };
  const run: ArgvRunner = (argv) => {
    calls.push(argv);
    mkdirSync(join(argv.at(-1) ?? "", cp.code === 0 ? "left-pad" : "partial"), { recursive: true });
    return { code: cp.code, output: cp.code === 0 ? "" : "cp: No space left on device\n" };
  };
  p.ctx = { ...p.ctx, cwd: wt, platform: "linux", runCommand: run, hostEnv: { ARBAB_PROJECT_ROOT: p.root } };
});
afterEach(() => p.dispose());

describe("arbab clone-dir", () => {
  it("clones a directory of the main checkout, named from the project root, into the current directory", async () => {
    expect(await runCloneDir(["node_modules", "node_modules"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe("cloned node_modules (cp)\n");
    expect(calls).toEqual([["cp", "-a", "--reflink=auto", join(p.root, "node_modules"), join(wt, "node_modules")]]);
    expect(existsSync(join(wt, "node_modules", "left-pad"))).toBe(true);
  });

  it("takes an absolute source and creates the destination's parents", async () => {
    expect(await runCloneDir([join(p.root, "node_modules"), "web/node_modules"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe("cloned web/node_modules (cp)\n");
    expect(existsSync(join(wt, "web", "node_modules"))).toBe(true);
  });

  it("refuses a current directory outside the worktree root, the main checkout and the root itself included", async () => {
    mkdirSync(join(p.root, "sub"));
    const elsewhere = join(p.dir, "elsewhere");
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(wt, "out"));
    for (const cwd of [join(p.root, "sub"), p.root, p.worktreeRoot, elsewhere, join(wt, "out")]) {
      p.err.length = 0;
      p.ctx = { ...p.ctx, cwd };
      expect(await runCloneDir(["node_modules", "deps"], p.ctx), cwd).toBe(1);
      expect(p.stderr(), cwd).toMatch(
        /^arbab clone-dir: the current directory .* is not inside the worktree root .*: clone-dir runs from a dependency script in a new worktree\n$/,
      );
    }
    expect(calls).toEqual([]);
  });

  it("refuses a source outside the project root, by real path, a missing one, a file and the root itself", async () => {
    const outside = join(p.dir, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(p.root, "linked"));
    writeFileSync(join(p.root, "file.txt"), "x\n");
    const cases: Array<[string, RegExp]> = [
      [outside, /leads to .*outside, outside the project root .*: only the main checkout's own content may be cloned/],
      ["linked", /linked leads to .*outside, outside the project root/],
      ["gone", /gone does not exist/],
      ["file.txt", /file\.txt is not a directory/],
      [".", /outside the project root/],
    ];
    for (const [src, why] of cases) {
      p.err.length = 0;
      expect(await runCloneDir([src, "copy"], p.ctx), src).toBe(1);
      expect(p.stderr(), src).toMatch(why);
    }
    expect(calls).toEqual([]);
  });

  it("refuses a destination that exists, a dangling link included, or that is not inside the current directory", async () => {
    mkdirSync(join(wt, "node_modules"));
    symlinkSync(join(p.dir, "nowhere"), join(wt, "dangling"));
    mkdirSync(join(p.dir, "elsewhere"));
    symlinkSync(join(p.dir, "elsewhere"), join(wt, "out"));
    const cases: Array<[string, RegExp]> = [
      ["node_modules", /node_modules already exists/],
      ["dangling", /dangling already exists/],
      ["../other", /\.\.\/other is not inside the current directory/],
      [join(p.dir, "abs"), /is not inside the current directory/],
      [".", /\. already exists/],
      ["out/node_modules", /out\/node_modules is not inside the current directory/],
    ];
    for (const [dst, why] of cases) {
      p.err.length = 0;
      expect(await runCloneDir(["node_modules", dst], p.ctx), dst).toBe(1);
      expect(p.stderr(), dst).toMatch(why);
    }
    expect(calls).toEqual([]);
  });

  it("refuses a source in a worktree, in .arbab or .arbab-tmp, by any spelling or link", async () => {
    mkdirSync(join(wt, "node_modules"));
    mkdirSync(join(p.root, ".arbab", "runs", "x"), { recursive: true });
    mkdirSync(join(p.root, ".arbab-tmp", "inputs"), { recursive: true });
    symlinkSync(join(wt, "node_modules"), join(p.root, "planted"));
    const cases: Array<[string, RegExp]> = [
      [".arbab/worktrees/lane/node_modules", /\.arbab\/worktrees\/lane\/node_modules leads to .*, inside .*\.arbab: only the main checkout's own content may be cloned/],
      [join(wt, "node_modules"), /inside .*\.arbab: only the main checkout's own content may be cloned/],
      ["planted", /planted leads to .*lane\/node_modules, inside .*\.arbab: /],
      [".arbab/runs/x", /inside .*\.arbab: /],
      [".arbab", /inside .*\.arbab: /],
      [".arbab-tmp/inputs", /inside .*\.arbab-tmp: /],
    ];
    if (process.platform === "darwin") cases.push([".ARBAB/worktrees/lane/node_modules", /inside .*\.arbab: /]);
    for (const [src, why] of cases) {
      p.err.length = 0;
      expect(await runCloneDir([src, "copy"], p.ctx), src).toBe(1);
      expect(p.stderr(), src).toMatch(why);
    }
    expect(calls).toEqual([]);
  });

  it("refuses a source in a worktree root the config moved, and a destination inside its own source", async () => {
    const t = makeProject({ config: { baseBranch: "main", worktreeRoot: "wt/trees" } });
    try {
      const lane = join(t.root, "wt", "trees", "lane");
      mkdirSync(join(lane, "deps"), { recursive: true });
      t.ctx = { ...t.ctx, cwd: lane, platform: "linux", runCommand: p.ctx.runCommand, hostEnv: { ARBAB_PROJECT_ROOT: t.root } };
      expect(await runCloneDir(["wt/trees/lane/deps", "copy"], t.ctx)).toBe(1);
      expect(t.stderr()).toMatch(/inside .*wt\/trees: only the main checkout's own content may be cloned/);
      t.err.length = 0;
      expect(await runCloneDir(["wt", "copy"], t.ctx)).toBe(1);
      expect(t.stderr()).toMatch(/copy lies inside wt/);
      expect(calls).toEqual([]);
    } finally {
      t.dispose();
    }
  });

  it("refuses a relative ARBAB_PROJECT_ROOT and wrong arguments", async () => {
    p.ctx = { ...p.ctx, hostEnv: { ARBAB_PROJECT_ROOT: "repo" } };
    expect(await runCloneDir(["node_modules", "node_modules"], p.ctx)).toBe(1);
    expect(p.stderr()).toMatch(/ARBAB_PROJECT_ROOT "repo" is not an absolute path/);
    for (const argv of [[], ["node_modules"], ["a", "b", "c"], ["", "b"]]) {
      p.err.length = 0;
      expect(await runCloneDir(argv, p.ctx), argv.join(" ")).toBe(1);
      expect(p.stderr()).toBe("arbab clone-dir: usage: arbab clone-dir <src> <dst>\n");
    }
  });

  it("removes half a copy when the clone fails, and exits 1", async () => {
    cp.code = 1;
    expect(await runCloneDir(["node_modules", "web/node_modules"], p.ctx)).toBe(1);
    expect(p.stderr()).toBe("arbab clone-dir: cloning node_modules failed (cp): cp: No space left on device\n");
    expect(existsSync(join(wt, "web"))).toBe(false);
  });

  it("is a runner command: dispatch runs it, and a lane worktree is no project without ARBAB_PROJECT_ROOT", async () => {
    expect(await dispatch(["clone-dir", "node_modules", "node_modules"], p.ctx)).toBe(0);
    // A real worktree holds the project's tracked config.
    writeFileSync(join(wt, "arbab.config.json"), "{}\n");
    p.ctx = { ...p.ctx, hostEnv: {} };
    expect(await dispatch(["clone-dir", "node_modules", "other"], p.ctx)).toBe(1);
    expect(p.stderr()).toMatch(/^arbab clone-dir: .*is in a lane worktree, not a project/);
  });
});
