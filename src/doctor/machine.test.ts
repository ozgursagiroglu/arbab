import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerProject } from "../registry";
import { checkDisk, checkMachineCap, countDirs, countEmptyDirs, MAX_EMPTY_LOCK_DIRS, MAX_WORKTREE_DIRS } from "./machine";

let dir: string;
let home: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "arbab-")));
  home = join(dir, "home");
  mkdirSync(home);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function dirs(parent: string, n: number, withFile = false): void {
  for (let i = 0; i < n; i++) {
    mkdirSync(join(parent, `d${i}`), { recursive: true });
    if (withFile) writeFileSync(join(parent, `d${i}`, "0.json"), "{}");
  }
}

describe("countDirs and countEmptyDirs", () => {
  it("count directories, empty ones apart, and 0 for a missing directory", () => {
    const d = join(dir, "x");
    dirs(d, 2);
    dirs(join(d, "full"), 1, true);
    writeFileSync(join(d, "file"), "");
    expect(countDirs(d)).toBe(3);
    expect(countEmptyDirs(d)).toBe(2);
    expect(countDirs(join(dir, "missing"))).toBe(0);
    expect(countEmptyDirs(join(dir, "missing"))).toBe(0);
  });
});

describe("checkDisk", () => {
  const wt = (): string => join(dir, "repo", ".arbab", "worktrees");

  it("is ok with the counts", () => {
    dirs(wt(), 3);
    dirs(join(home, "locks"), 2);
    expect(checkDisk(wt(), ".arbab/worktrees", home)).toEqual([
      { status: "ok", check: "disk", detail: "3 worktree directories, 2 empty lock directories" },
    ]);
    expect(checkDisk(join(dir, "none"), ".arbab/worktrees", join(dir, "nohome"))[0]?.detail).toBe("0 worktree directories, 0 empty lock directories");
  });

  it("warns above the limits", () => {
    dirs(wt(), MAX_WORKTREE_DIRS + 1);
    dirs(join(home, "locks"), MAX_EMPTY_LOCK_DIRS + 1);
    expect(checkDisk(wt(), ".arbab/worktrees", home)).toEqual([
      {
        status: "warn",
        check: "disk",
        detail: "31 directories in .arbab/worktrees (more than 30): arbab cleanup --worktrees removes finished lanes' worktrees",
      },
      { status: "warn", check: "disk", detail: "101 empty lock directories (more than 100): arbab cleanup removes them" },
    ]);
  });

  it("does not count lock directories that hold an entry, nor stop at the limit", () => {
    dirs(wt(), MAX_WORKTREE_DIRS);
    dirs(join(home, "locks"), MAX_EMPTY_LOCK_DIRS + 5, true);
    expect(checkDisk(wt(), ".arbab/worktrees", home).map((c) => c.status)).toEqual(["ok"]);
  });
});

describe("checkMachineCap", () => {
  const project = (name: string, maxParallel?: number): string => {
    const root = join(dir, name);
    mkdirSync(root);
    writeFileSync(join(root, "arbab.config.json"), JSON.stringify(maxParallel === undefined ? {} : { maxParallel }));
    registerProject(home, root, "2026-10-09T12:00:00.000Z");
    return root;
  };

  it("is ok with the effective cap when machine.json sets maxParallel", () => {
    writeFileSync(join(home, "machine.json"), JSON.stringify({ maxParallel: 3 }));
    expect(checkMachineCap(home, join(dir, "a"), 6)).toEqual({ status: "ok", check: "machine", detail: "maxParallel min(6, 3) = 3" });
    expect(checkMachineCap(home, join(dir, "a"), 2)?.detail).toBe("maxParallel min(2, 3) = 2");
  });

  it("fails on an invalid machine.json", () => {
    writeFileSync(join(home, "machine.json"), JSON.stringify({ maxParallel: 0 }));
    expect(checkMachineCap(home, join(dir, "a"), 4)?.status).toBe("fail");
  });

  it("warns when existing projects disagree and there is no machine cap", () => {
    const a = project("a", 2);
    project("b");
    expect(checkMachineCap(home, a, 2)).toEqual({
      status: "warn",
      check: "machine",
      detail: "slots are shared machine-wide: set maxParallel in ~/.arbab/machine.json (projects set 2, 4)",
    });
  });

  it("counts this project before its first launch registers it", () => {
    project("b", 6);
    expect(checkMachineCap(home, join(dir, "new"), 4)?.status).toBe("warn");
  });

  it("skips when projects agree, are gone or have a broken config", () => {
    const a = project("a", 4);
    project("b");
    expect(checkMachineCap(home, a, 4)).toBeNull();
    registerProject(home, join(dir, "gone"), "2026-10-09T12:00:00.000Z");
    const broken = project("broken");
    writeFileSync(join(broken, "arbab.config.json"), JSON.stringify({ maxParallel: 9, nope: true }));
    expect(checkMachineCap(home, a, 4)).toBeNull();
    expect(checkMachineCap(join(dir, "empty-home"), a, 4)).toBeNull();
  });
});
