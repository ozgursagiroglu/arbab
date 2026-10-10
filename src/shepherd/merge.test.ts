import { chmodSync, existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeProject, mustGit, type TestProject } from "../../test/fake-claude/harness";
import { createWorktree, untrustedTree, type GitRunner, type Worktree } from "../run";
import { mergeBranches, type MergedBranch } from "./merge";

let project: TestProject;
beforeEach(() => {
  project = makeProject();
});
afterEach(() => {
  project.cleanup();
});

const git = (args: string[], cwd = project.root): string => mustGit(project.git, args, cwd);

/** A branch off main with one commit writing `file`. */
function branchWith(branch: string, file: string, text: string): string {
  git(["branch", branch, "main"]);
  const wt = join(project.dir, `wt-${branch.replace(/\//g, "-")}`);
  git(["worktree", "add", wt, branch]);
  writeFileSync(join(wt, file), text);
  git(["add", "-A"], wt);
  git(["commit", "-q", "-m", `${branch} writes ${file}`], wt);
  return git(["rev-parse", "HEAD"], wt).trim();
}

function laneWorktree(lane: string): Worktree & { real: string } {
  const wt = createWorktree({ projectRoot: project.root, root: ".arbab/worktrees", lane, base: "main", trustedBase: "main", git: project.git });
  return { ...wt, real: realpathSync(wt.path) };
}

const input = (wt: Worktree & { real: string }, branches: Array<string | MergedBranch>, runner: GitRunner = project.git) => ({
  worktree: wt.real,
  branch: wt.branch,
  gitCommonDir: wt.gitCommonDir,
  lane: "b",
  branches,
  git: runner,
});

describe("mergeBranches", () => {
  it("merges each branch in order, fast-forwarding where it can and with a merge commit otherwise, naming the git dir and work tree", () => {
    const a = branchWith("arbab/a", "a.txt", "a\n");
    const c = branchWith("arbab/c", "c.txt", "c\n");
    const wt = laneWorktree("b");
    const calls: string[][] = [];
    const runner: GitRunner = (args, cwd) => {
      calls.push(args);
      return project.git(args, cwd);
    };

    expect(mergeBranches(input(wt, ["arbab/a", "arbab/c"], runner))).toEqual([
      { branch: "arbab/a", sha: a },
      { branch: "arbab/c", sha: c },
    ]);
    expect(existsSync(join(wt.real, "a.txt")) && existsSync(join(wt.real, "c.txt"))).toBe(true);
    // arbab/a descends from the base: fast-forwarded. arbab/c does not descend from a: a merge commit on top of a.
    expect(git(["log", "--first-parent", "--format=%s", "-2"], wt.real).trim().split("\n")).toEqual(["arbab: merge arbab/c for b", "arbab/a writes a.txt"]);
    expect(git(["rev-list", "--parents", "-1", "HEAD"], wt.real).trim().split(" ")).toEqual([expect.any(String), a, c]);
    expect(calls.every((args) => args[0]?.startsWith("--git-dir=") && args[1] === `--work-tree=${wt.real}`)).toBe(true);
    // The merged trees are worker-written: no hook, no fsmonitor, no descent into a nested repository.
    for (const args of calls) expect(args.slice(2, 2 + untrustedTree().length)).toEqual(untrustedTree());
    // The resolved commit is merged; the message keeps the branch name.
    expect(calls).toContainEqual(expect.arrayContaining(["merge", "--ff", "--no-edit", "--no-verify", "-m", "arbab: merge arbab/a for b", a]));
    expect(calls.some((args) => args.includes("--no-ff"))).toBe(false);
  });

  it("ends exactly at a commit that descends from the worktree's base, as a generated lane needs", () => {
    branchWith("arbab/a", "a.txt", "a\n");
    writeFileSync(join(project.dir, "wt-arbab-a", "a2.txt"), "a2\n");
    git(["add", "-A"], join(project.dir, "wt-arbab-a"));
    git(["commit", "-q", "-m", "second"], join(project.dir, "wt-arbab-a"));
    const head = git(["rev-parse", "arbab/a"]).trim();
    const wt = laneWorktree("b");

    expect(mergeBranches(input(wt, [head]))).toEqual([{ branch: head, sha: head }]);
    expect(git(["rev-parse", "HEAD"], wt.real).trim()).toBe(head);
    expect(git(["rev-parse", "refs/heads/arbab/b"]).trim()).toBe(head);
    expect(git(["status", "--porcelain"], wt.real)).toBe("");
  });

  it("merges a pinned entry at its commit, naming its branch, wherever the branch has gone", () => {
    const a = branchWith("arbab/a", "a.txt", "a\n");
    const later = branchWith("arbab/later", "later.txt", "later\n");
    git(["update-ref", "refs/heads/arbab/a", later]);
    const wt = laneWorktree("b");
    expect(mergeBranches(input(wt, [{ branch: "arbab/a", sha: a }]))).toEqual([{ branch: "arbab/a", sha: a }]);
    expect(git(["rev-parse", "HEAD"], wt.real).trim()).toBe(a);

    const m = branchWith("arbab/m", "package.json", "{}\n");
    expect(() => mergeBranches(input(wt, [{ branch: "arbab/up", sha: m }]))).toThrow(/^arbab\/up changes dependency manifests \(package\.json\)/);
    // A pinned entry is a commit, never a revision git would read some other way.
    expect(() => mergeBranches(input(wt, [{ branch: "arbab/a", sha: "arbab/a" }]))).toThrow(/not a valid branch name/);
    expect(git(["rev-parse", "HEAD"], wt.real).trim()).toBe(a);
  });

  it("merges and records the commit the branch resolved to, even when the branch moves before the merge", () => {
    const a = branchWith("arbab/a", "a.txt", "a\n");
    const later = branchWith("arbab/later", "later.txt", "later\n");
    const wt = laneWorktree("b");
    let moved = false;
    const runner: GitRunner = (args, cwd) => {
      const r = project.git(args, cwd);
      // A worker's branch moving right after arbab read it.
      if (!moved && args.includes("rev-parse")) {
        moved = true;
        git(["update-ref", "refs/heads/arbab/a", later]);
      }
      return r;
    };

    expect(mergeBranches(input(wt, ["arbab/a"], runner))).toEqual([{ branch: "arbab/a", sha: a }]);
    expect(moved).toBe(true);
    // Fast-forwarded to the resolved commit, not to where the branch went.
    expect(git(["rev-parse", "HEAD"], wt.real).trim()).toBe(a);
    expect(existsSync(join(wt.real, "later.txt"))).toBe(false);
  });

  it("refuses a branch that changes a dependency manifest at any depth, naming the branch and the files, and merges nothing", () => {
    branchWith("arbab/ok", "ok.txt", "ok\n");
    git(["branch", "arbab/a", "main"]);
    const wa = join(project.dir, "wt-a");
    git(["worktree", "add", wa, "arbab/a"]);
    mkdirSync(join(wa, "pkgs", "x"), { recursive: true });
    writeFileSync(join(wa, "package.json"), "{}\n");
    writeFileSync(join(wa, "pkgs", "x", ".npmrc"), "registry=x\n");
    writeFileSync(join(wa, "pkgs", "x", "notes.txt"), "fine\n");
    git(["add", "-A"], wa);
    git(["commit", "-q", "-m", "a changes manifests"], wa);
    const wt = laneWorktree("b");

    let err: unknown;
    try {
      mergeBranches(input(wt, ["arbab/ok", "arbab/a"]));
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ code: "git" });
    const msg = (err as Error).message;
    expect(msg).toMatch(/^arbab\/a changes dependency manifests \(package\.json, pkgs\/x\/\.npmrc\), so it was not merged into arbab\/b/);
    expect(msg).toContain("The orchestrator must review and land that dependency change on the base before dependent phases run");
    expect(msg).not.toContain("notes.txt");
    // The branch before it is merged (fast-forwarded); arbab/a is not, and nothing is in progress.
    expect(git(["rev-parse", "HEAD"], wt.real).trim()).toBe(git(["rev-parse", "arbab/ok"]).trim());
    expect(existsSync(join(wt.real, "package.json"))).toBe(false);
    expect(git(["status", "--porcelain"], wt.real)).toBe("");
  });

  it("refuses a manifest whose name differs only in case", () => {
    branchWith("arbab/a", "Package.JSON", "{}\n");
    const wt = laneWorktree("b");
    expect(() => mergeBranches(input(wt, ["arbab/a"]))).toThrow(/arbab\/a changes dependency manifests \(Package\.JSON\)/);
  });

  it("says the relaunch builds the worktree again, and when a merge commit made before the failure must go first", () => {
    branchWith("arbab/a", "a.txt", "a\n");
    branchWith("arbab/m", "package.json", "{}\n");
    for (const branches of [["arbab/m"], ["arbab/a", "arbab/m"]]) {
      const wt = laneWorktree(`b${branches.length}`);
      expect(() => mergeBranches(input(wt, branches))).toThrow(
        new RegExp(`arbab builds it again, installs and merges again; if a merge commit was made there before this failure, remove the worktree and the branch arbab\/b${branches.length} first$`),
      );
    }
  });

  it("returns nothing for no branches", () => {
    expect(mergeBranches(input(laneWorktree("b"), []))).toEqual([]);
  });

  it("fails on a missing branch, naming it", () => {
    const wt = laneWorktree("b");
    expect(() => mergeBranches(input(wt, ["arbab/none"]))).toThrow(/cannot merge arbab\/none into arbab\/b: branch arbab\/none does not exist/);
    expect(git(["status", "--porcelain"], wt.real)).toBe("");
  });

  it("aborts a conflicting merge and names the conflicting paths", () => {
    branchWith("arbab/a", "shared.txt", "from a\n");
    branchWith("arbab/c", "shared.txt", "from c\n");
    const wt = laneWorktree("b");
    let err: unknown;
    try {
      mergeBranches(input(wt, ["arbab/a", "arbab/c"]));
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({
      code: "git",
      message:
        "merging arbab/c into arbab/b conflicts in shared.txt; the merge was aborted and nothing is left to resolve in the " +
        "worktree; fix the branches (or land the dependency change) and launch b again: as long as no worker has run in " +
        "its worktree, arbab builds it again, installs and merges again; if a merge commit was made there before this " +
        "failure, remove the worktree and the branch arbab/b first",
    });
    // The first merge (a fast-forward) stays; the conflicting one is gone.
    expect(git(["rev-parse", "HEAD"], wt.real).trim()).toBe(git(["rev-parse", "arbab/a"]).trim());
    expect(git(["status", "--porcelain"], wt.real)).toBe("");
    expect(project.git(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"], wt.real).code).not.toBe(0);
  });

  it("reports a merge that fails without conflicts with git's output", () => {
    branchWith("arbab/a", "a.txt", "a\n");
    const wt = laneWorktree("b");
    // An untracked file the merge would overwrite: git refuses before merging anything.
    writeFileSync(join(wt.real, "a.txt"), "local\n");
    expect(() => mergeBranches(input(wt, ["arbab/a"]))).toThrow(
      /merging arbab\/a into arbab\/b failed \(\d+\): .*a\.txt.*; the merge was aborted and nothing is left to resolve.*launch b again/s,
    );
  });

  it("refuses a branch git would read as an option, before running git", () => {
    const wt = laneWorktree("b");
    const calls: string[][] = [];
    const runner: GitRunner = (args, cwd) => {
      calls.push(args);
      return project.git(args, cwd);
    };
    expect(() => mergeBranches(input(wt, ["--upload-pack=x"], runner))).toThrow(/not a valid branch name/);
    expect(() => mergeBranches(input(wt, ["a b"], runner))).toThrow(/not a valid branch name/);
    expect(calls).toEqual([]);
  });

  it("runs no hook a merged branch brings under a relative core.hooksPath, while a plain merge would", () => {
    const marker = join(project.dir, "hook-ran");
    git(["branch", "arbab/a", "main"]);
    const wa = join(project.dir, "wt-a");
    git(["worktree", "add", wa, "arbab/a"]);
    mkdirSync(join(wa, ".husky"));
    for (const name of ["pre-merge-commit", "prepare-commit-msg", "commit-msg", "post-merge"]) {
      writeFileSync(join(wa, ".husky", name), `#!/bin/sh\necho ${name} >> '${marker}'\n`);
      chmodSync(join(wa, ".husky", name), 0o755);
    }
    git(["add", "-A"], wa);
    git(["commit", "-q", "-m", "a brings hooks"], wa);
    branchWith("arbab/c", "c.txt", "c\n");
    branchWith("arbab/control", "control.txt", "control\n");
    git(["config", "core.hooksPath", ".husky"]);
    const wt = laneWorktree("b");

    expect(mergeBranches(input(wt, ["arbab/a", "arbab/c"])).map((m) => m.branch)).toEqual(["arbab/a", "arbab/c"]);
    expect(existsSync(join(wt.real, ".husky", "post-merge"))).toBe(true);
    expect(existsSync(marker)).toBe(false);

    git(["merge", "--no-ff", "--no-edit", "arbab/control"], wt.real);
    expect(existsSync(marker)).toBe(true);
  });

  it("refuses a worktree whose git dir is not the one arbab created", () => {
    branchWith("arbab/a", "a.txt", "a\n");
    const wt = laneWorktree("b");
    writeFileSync(join(project.root, ".git", "worktrees", "b", "HEAD"), "ref: refs/heads/main\n");
    expect(() => mergeBranches(input(wt, ["arbab/a"]))).toThrow(/cannot merge into .*HEAD of/);
  });
});
