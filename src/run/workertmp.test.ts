import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArbabError } from "../util/errors";
import { WORKER_TMP_DIR, ensureWorkerTmp, workerTmpPaths } from "./index";
import { realDir } from "./workertmp";

let base: string;
let wt: string;
// What a planted link points at: it must survive untouched.
let victim: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "arbab-wtmp-"));
  wt = join(base, "wt");
  victim = join(base, "victim");
  mkdirSync(wt);
  mkdirSync(join(victim, "sub"), { recursive: true });
  writeFileSync(join(victim, "keep.txt"), "keep\n");
  writeFileSync(join(victim, "sub", "keep.txt"), "keep\n");
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const untouched = (): void => {
  expect(readdirSync(victim).sort()).toEqual(["keep.txt", "sub"]);
  expect(readFileSync(join(victim, "keep.txt"), "utf8")).toBe("keep\n");
  expect(readdirSync(join(victim, "sub"))).toEqual(["keep.txt"]);
};
const isRealDir = (path: string): boolean => lstatSync(path).isDirectory();

describe("workerTmpPaths", () => {
  it("names every path under <worktree>/.arbab-tmp without touching the disk", () => {
    expect(WORKER_TMP_DIR).toBe(".arbab-tmp");
    const root = join("/w", ".arbab-tmp");
    expect(workerTmpPaths("/w")).toEqual({
      root,
      xdgConfig: join(root, "xdg-config"),
      yarnCache: join(root, "yarn-cache"),
      npmrc: join(root, "npmrc"),
      inputs: join(root, "inputs"),
    });
  });
});

describe("realDir", () => {
  it("creates each missing directory and returns the path", () => {
    expect(realDir(wt, "a/b/c")).toBe(join(wt, "a", "b", "c"));
    expect(isRealDir(join(wt, "a", "b", "c"))).toBe(true);
  });

  it("keeps a real directory and what it holds", () => {
    mkdirSync(join(wt, "a"));
    writeFileSync(join(wt, "a", "f.txt"), "f");
    realDir(wt, "a/b");
    expect(readFileSync(join(wt, "a", "f.txt"), "utf8")).toBe("f");
  });

  it("replaces a link on the way, never touching its target", () => {
    symlinkSync(victim, join(wt, "a"));
    realDir(wt, "a/sub");
    expect(isRealDir(join(wt, "a"))).toBe(true);
    expect(readdirSync(join(wt, "a"))).toEqual(["sub"]);
    expect(readdirSync(join(wt, "a", "sub"))).toEqual([]);
    untouched();
  });

  it("replaces a link at the last component, and a dangling one", () => {
    mkdirSync(join(wt, "a"));
    symlinkSync(join(victim, "sub"), join(wt, "a", "b"));
    symlinkSync(join(base, "missing"), join(wt, "c"));
    realDir(wt, "a/b");
    realDir(wt, "c");
    expect(isRealDir(join(wt, "a", "b"))).toBe(true);
    expect(isRealDir(join(wt, "c"))).toBe(true);
    expect(existsSync(join(base, "missing"))).toBe(false);
    untouched();
  });

  it("replaces a file on the way", () => {
    writeFileSync(join(wt, "a"), "a file where the directory goes");
    realDir(wt, "a/b");
    expect(isRealDir(join(wt, "a", "b"))).toBe(true);
  });

  it("refuses a path that leaves the worktree", () => {
    expect(() => realDir(wt, "../out")).toThrow(ArbabError);
    expect(existsSync(join(base, "out"))).toBe(false);
  });

  it("fails when the worktree does not exist", () => {
    expect(() => realDir(join(base, "none"), "a")).toThrow(/cannot create/);
  });
});

describe("ensureWorkerTmp", () => {
  it("creates the directories and an empty npmrc", () => {
    const paths = ensureWorkerTmp(wt);
    expect(paths).toEqual(workerTmpPaths(wt));
    for (const dir of [paths.root, paths.xdgConfig, paths.yarnCache, paths.inputs]) {
      expect(statSync(dir).isDirectory(), dir).toBe(true);
    }
    for (const gone of ["xdg-data", "xdg-cache"]) expect(existsSync(join(paths.root, gone)), gone).toBe(false);
    expect(statSync(paths.npmrc).isFile()).toBe(true);
    expect(readFileSync(paths.npmrc, "utf8")).toBe("");
  });

  it("is idempotent and keeps what is already there", () => {
    const paths = ensureWorkerTmp(wt);
    writeFileSync(paths.npmrc, "registry=https://registry.example.test/\n");
    writeFileSync(join(paths.inputs, "note.md"), "x");
    ensureWorkerTmp(wt);
    expect(readFileSync(paths.npmrc, "utf8")).toBe("registry=https://registry.example.test/\n");
    expect(readFileSync(join(paths.inputs, "note.md"), "utf8")).toBe("x");
  });

  it.each([".arbab-tmp", ".arbab-tmp/inputs", ".arbab-tmp/xdg-config"])("replaces a link at %s, leaving its target alone", (rel) => {
    mkdirSync(join(wt, ".arbab-tmp"), { recursive: true });
    if (rel === ".arbab-tmp") rmSync(join(wt, rel), { recursive: true });
    symlinkSync(victim, join(wt, rel));
    const paths = ensureWorkerTmp(wt);
    for (const dir of [paths.root, paths.xdgConfig, paths.yarnCache, paths.inputs]) expect(isRealDir(dir), dir).toBe(true);
    expect(lstatSync(paths.npmrc).isFile()).toBe(true);
    untouched();
  });

  it("replaces a link at npmrc with an empty file, never writing through it", () => {
    mkdirSync(join(wt, ".arbab-tmp"));
    const paths = workerTmpPaths(wt);
    symlinkSync(join(victim, "keep.txt"), paths.npmrc);
    ensureWorkerTmp(wt);
    expect(lstatSync(paths.npmrc).isFile()).toBe(true);
    expect(readFileSync(paths.npmrc, "utf8")).toBe("");
    untouched();

    // A dangling link would otherwise create its target.
    rmSync(paths.npmrc);
    symlinkSync(join(base, "created"), paths.npmrc);
    ensureWorkerTmp(wt);
    expect(existsSync(join(base, "created"))).toBe(false);
    expect(lstatSync(paths.npmrc).isFile()).toBe(true);
  });

  it("replaces a directory at npmrc", () => {
    const paths = workerTmpPaths(wt);
    mkdirSync(paths.npmrc, { recursive: true });
    symlinkSync(victim, join(paths.npmrc, "link"));
    ensureWorkerTmp(wt);
    expect(lstatSync(paths.npmrc).isFile()).toBe(true);
    untouched();
  });

  it("replaces a file where a directory goes", () => {
    writeFileSync(join(wt, ".arbab-tmp"), "a file where the directory goes");
    const paths = ensureWorkerTmp(wt);
    expect(isRealDir(paths.root)).toBe(true);
  });

  it("fails when the worktree does not exist", () => {
    expect(() => ensureWorkerTmp(join(base, "none"))).toThrow(ArbabError);
  });
});
