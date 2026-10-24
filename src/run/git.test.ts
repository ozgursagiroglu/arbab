import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArbabError } from "../util/errors";
import {
  commonDir,
  createWorktree,
  discardWorktree,
  ensureIgnored,
  holdsGit,
  indexGitlinks,
  isDirty,
  makeGitRunner,
  nodeGit,
  untrustedTree,
  verifyWorktreeGit,
  worktreeStatus,
  type GitRunner,
} from "./git";
import { plantNestedRepo } from "./testkit";

let dir: string;
let repo: string;
let git: GitRunner;

// Isolated from the user's global and system git config (hooks paths, signing, identity).
function isolatedGit(home: string): GitRunner {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"]) delete env[key];
  return makeGitRunner({
    ...env,
    HOME: home,
    XDG_CONFIG_HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(home, "gitconfig"),
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  });
}

function ok(args: string[], cwd = repo): string {
  const r = git(args, cwd);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arbab-git-"));
  repo = join(dir, "repo");
  git = isolatedGit(dir);
  ok(["init", "-q", "-b", "main", repo], dir);
  writeFileSync(join(repo, "a.txt"), "a\n");
  ok(["add", "-A"]);
  ok(["commit", "-q", "-m", "init"]);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const excludeFile = () => join(repo, ".git", "info", "exclude");

describe("git runners", () => {
  it("nodeGit runs git with an argv", () => {
    const r = nodeGit(["--version"], dir);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^git version/);
  });
  it("reports a missing git binary as code 127", () => {
    const r = makeGitRunner({ PATH: "" })(["--version"], dir);
    expect(r.code).toBe(127);
    expect(r.stderr).not.toBe("");
  });
});

describe("ensureIgnored", () => {
  it("appends missing entries once and verifies them", () => {
    writeFileSync(excludeFile(), "# comment\nfoo");
    ensureIgnored(repo, [".arbab/", ".arbab-tmp/"], git);
    ensureIgnored(repo, [".arbab/", ".arbab-tmp/"], git);
    expect(readFileSync(excludeFile(), "utf8")).toBe("# comment\nfoo\n.arbab/\n.arbab-tmp/\n");
    expect(git(["check-ignore", "-q", ".arbab/worktrees/x"], repo).code).toBe(0);
  });
  it("creates info/exclude when it is missing", () => {
    rmSync(join(repo, ".git", "info"), { recursive: true, force: true });
    ensureIgnored(repo, [".arbab/"], git);
    expect(readFileSync(excludeFile(), "utf8")).toBe(".arbab/\n");
  });
  it("throws a git error when an entry is re-included by .gitignore", () => {
    writeFileSync(join(repo, ".gitignore"), "!keep/\n");
    const err = (() => {
      try {
        ensureIgnored(repo, ["keep/"], git);
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(ArbabError);
    expect((err as ArbabError).code).toBe("git");
  });
  it("throws a git error outside a repository", () => {
    const plain = mkdtempSync(join(dir, "plain-"));
    expect(() => ensureIgnored(plain, [".arbab/"], isolatedGit(dir))).toThrow(/rev-parse/);
  });
});

describe("createWorktree", () => {
  it("creates the worktree on arbab/<lane> and reuses it", () => {
    const first = createWorktree({ projectRoot: repo, root: ".arbab/worktrees", lane: "m1-x", base: "main", trustedBase: "main", git });
    const gitCommonDir = realpathSync(join(repo, ".git"));
    expect(first).toEqual({ path: join(repo, ".arbab/worktrees/m1-x"), branch: "arbab/m1-x", created: true, gitCommonDir });
    expect(existsSync(join(first.path, "a.txt"))).toBe(true);
    expect(ok(["rev-parse", "--abbrev-ref", "HEAD"], first.path).trim()).toBe("arbab/m1-x");

    writeFileSync(join(first.path, "work.txt"), "w");
    const again = createWorktree({ projectRoot: repo, root: ".arbab/worktrees", lane: "m1-x", base: "main", trustedBase: "main", git });
    expect(again.created).toBe(false);
    expect(again.gitCommonDir).toBe(gitCommonDir);
    expect(existsSync(join(again.path, "work.txt"))).toBe(true);
  });
  it("reports the shared git dir even when the project root is itself a linked worktree", () => {
    const first = createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "main", trustedBase: "main", git });
    const nested = createWorktree({ projectRoot: first.path, root: "wt", lane: "b", base: "main", trustedBase: "main", git });
    expect(nested.gitCommonDir).toBe(realpathSync(join(repo, ".git")));
  });
  it("checks out an existing branch the base contains when the worktree is gone", () => {
    const first = createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "main", trustedBase: "main", git });
    ok(["worktree", "remove", first.path]);
    // main moved on past the branch: it still contains it.
    writeFileSync(join(repo, "later.txt"), "later\n");
    ok(["add", "-A"]);
    ok(["commit", "-q", "-m", "later"]);
    const second = createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "main", trustedBase: "main", git });
    expect(second.created).toBe(true);
    expect(ok(["rev-parse", "--abbrev-ref", "HEAD"], second.path).trim()).toBe("arbab/a");
  });
  it("refuses to re-create a missing worktree on a branch that holds commits the base does not", () => {
    const first = createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "main", trustedBase: "main", git });
    writeFileSync(join(first.path, "package.json"), '{"scripts":{"postinstall":"touch pwned"}}\n');
    ok(["add", "-A"], first.path);
    ok(["commit", "-q", "-m", "worker"], first.path);
    rmSync(first.path, { recursive: true, force: true });
    const err = (() => {
      try {
        createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "main", trustedBase: "main", git });
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(ArbabError);
    expect((err as ArbabError).code).toBe("git");
    expect((err as ArbabError).message).toBe(
      `the worktree ${first.path} is missing, and its branch arbab/a holds worker commits that are not on main; arbab ` +
        "installs dependencies only on a trusted base, and rebuilds a missing worktree from its branch only for a lane " +
        "that has run. Delete the branch arbab/a, then launch the lane again",
    );
    expect(existsSync(first.path)).toBe(false);
  });
  it("compares an existing branch with the trusted base, not the lane's base, which may hold the same worker commits", () => {
    const first = createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "main", trustedBase: "main", git });
    writeFileSync(join(first.path, "scripts.js"), "worker\n");
    ok(["add", "-A"], first.path);
    ok(["commit", "-q", "-m", "worker"], first.path);
    ok(["worktree", "remove", first.path]);
    // The lane's base is a worker branch that contains arbab/a: it vouches for nothing.
    ok(["branch", "arbab/other", "arbab/a"]);
    expect(() => createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "arbab/other", trustedBase: "main", git })).toThrow(
      /holds worker commits that are not on main/,
    );
    expect(existsSync(first.path)).toBe(false);
  });
  it("reports a trusted base it cannot compare the existing branch with", () => {
    const first = createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "main", trustedBase: "main", git });
    ok(["worktree", "remove", first.path]);
    expect(() => createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "main", trustedBase: "does-not-exist", git })).toThrow(
      /merge-base --is-ancestor/,
    );
  });
  it("resolves a base given as a function only when it makes a branch", () => {
    const calls: string[] = [];
    const base = (): string => {
      calls.push("base");
      return ok(["rev-parse", "main"]).trim();
    };
    const first = createWorktree({ projectRoot: repo, root: "wt", lane: "a", base, trustedBase: "main", git });
    expect(calls).toEqual(["base"]);
    createWorktree({ projectRoot: repo, root: "wt", lane: "a", base, trustedBase: "main", git });
    ok(["worktree", "remove", first.path]);
    createWorktree({ projectRoot: repo, root: "wt", lane: "a", base, trustedBase: "main", git });
    expect(calls).toEqual(["base"]);
    expect(() => createWorktree({ projectRoot: repo, root: "wt", lane: "b", base: () => "-x", trustedBase: "main", git })).toThrow(
      /base "-x" is not a valid revision/,
    );
  });
  it("recreates a worktree whose directory was deleted by hand (a stale registration)", () => {
    const first = createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "main", trustedBase: "main", git });
    rmSync(first.path, { recursive: true, force: true });
    const second = createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "main", trustedBase: "main", git });
    expect(second.created).toBe(true);
    expect(existsSync(join(second.path, "a.txt"))).toBe(true);
  });
  it("refuses bad lanes, escaping roots and option-like bases", () => {
    expect(() => createWorktree({ projectRoot: repo, root: "wt", lane: "../x", base: "main", trustedBase: "main", git })).toThrow(ArbabError);
    expect(() => createWorktree({ projectRoot: repo, root: "../out", lane: "a", base: "main", trustedBase: "main", git })).toThrow(ArbabError);
    expect(() => createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "--orphan", trustedBase: "main", git })).toThrow(ArbabError);
    expect(() => createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "main", trustedBase: "--orphan", git })).toThrow(ArbabError);
  });
  it("reports git failures (an unknown base)", () => {
    expect(() => createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "nope", trustedBase: "main", git })).toThrow(/worktree add/);
  });
  it("refuses to reuse a worktree at the lane's path that is on another branch (an integration's)", () => {
    const path = join(repo, "wt", "integrate-x");
    ok(["worktree", "add", "-b", "integrate/x", path, "main"]);
    expect(() => createWorktree({ projectRoot: repo, root: "wt", lane: "integrate-x", base: "main", trustedBase: "main", git })).toThrow(
      /is a worktree on refs\/heads\/integrate\/x, not on arbab\/integrate-x; lane integrate-x cannot run there/,
    );
    ok(["checkout", "-q", "--detach"], path);
    expect(() => createWorktree({ projectRoot: repo, root: "wt", lane: "integrate-x", base: "main", trustedBase: "main", git })).toThrow(/on a detached HEAD/);
  });
  it("runs no post-checkout hook from a relative core.hooksPath when it checks out a lane's branch", () => {
    const marker = join(dir, "hook-ran");
    markerHooks(join(repo, ".husky"), ["post-checkout"], marker);
    ok(["add", "-A"]);
    ok(["commit", "-q", "-m", "husky"]);
    ok(["config", "core.hooksPath", ".husky"]);
    // A new branch, then the existing branch once its worktree is gone.
    const first = createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "main", trustedBase: "main", git });
    ok(["worktree", "remove", first.path]);
    createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "main", trustedBase: "main", git });
    expect(existsSync(marker)).toBe(false);
    // Without the override the same checkout runs the hook.
    ok(["worktree", "add", "--detach", join(dir, "control"), "main"]);
    expect(existsSync(marker)).toBe(true);
  });
});

describe("discardWorktree", () => {
  const sha = (rev: string): string => ok(["rev-parse", rev]).trim();
  const branchExists = (branch: string): boolean => git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], repo).code === 0;
  const common = (): string => resolve(repo, ok(["rev-parse", "--git-common-dir"]).trim());
  const discard = (sources: string[], lane = "a"): void =>
    discardWorktree({ projectRoot: repo, root: "wt", lane, sources, gitCommonDir: common(), git });

  /** arbab/up, a worker's branch on main with one commit. */
  const upBranch = (): void => {
    ok(["checkout", "-q", "-b", "arbab/up"]);
    writeFileSync(join(repo, "up.txt"), "up\n");
    ok(["add", "-A"]);
    ok(["commit", "-q", "-m", "up"]);
    ok(["checkout", "-q", "main"]);
  };

  it("removes a clean worktree and its branch when every commit on the branch comes from a source", () => {
    upBranch();
    const wt = createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "main", trustedBase: "main", git });
    ok(["merge", "-q", "--ff", "arbab/up"], wt.path);
    discard([sha("main"), sha("arbab/up")]);
    expect(existsSync(wt.path)).toBe(false);
    expect(branchExists("arbab/a")).toBe(false);
    expect(ok(["worktree", "list", "--porcelain"])).not.toContain(wt.path);
    // Built again from scratch, on the trusted base.
    const again = createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "main", trustedBase: "main", git });
    expect(again.created).toBe(true);
    expect(readFileSync(join(again.path, "a.txt"), "utf8")).toBe("a\n");
  });

  it("refuses, removing nothing, a worktree with uncommitted changes, such as an interrupted merge leaves", () => {
    const wt = createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "main", trustedBase: "main", git });
    writeFileSync(join(wt.path, "a.txt"), "worker\n");
    writeFileSync(join(wt.path, "dropped.txt"), "worker\n");
    expect(() => discard([sha("main")])).toThrow(/holds what arbab cannot rebuild: uncommitted changes \(.*a\.txt.*dropped\.txt/);
    expect(readFileSync(join(wt.path, "a.txt"), "utf8")).toBe("worker\n");
    expect(existsSync(join(wt.path, "dropped.txt"))).toBe(true);
    expect(branchExists("arbab/a")).toBe(true);
  });

  it("refuses, removing nothing, a merge commit no source holds (a human may have made it)", () => {
    upBranch();
    const wt = createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "main", trustedBase: "main", git });
    ok(["merge", "-q", "--no-ff", "--no-edit", "arbab/up"], wt.path);
    const merge = sha("arbab/a");
    expect(() => discard([sha("main"), sha("arbab/up")])).toThrow(new RegExp(`commits on arbab/a that are not on .*: ${merge}`));
    expect(sha("arbab/a")).toBe(merge);
    expect(existsSync(wt.path)).toBe(true);
  });

  it("refuses, removing nothing, while the branch holds a commit no source holds", () => {
    const wt = createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "main", trustedBase: "main", git });
    writeFileSync(join(wt.path, "own.txt"), "own\n");
    ok(["add", "-A"], wt.path);
    ok(["commit", "-q", "-m", "own"], wt.path);
    const own = sha("arbab/a");
    writeFileSync(join(wt.path, "uncommitted.txt"), "x\n");
    expect(() => discard([sha("main")])).toThrow(
      new RegExp(`^no worker has run in ${wt.path}, but it holds what arbab cannot rebuild: commits on arbab/a that are not on .*: ${own}; uncommitted changes`),
    );
    // With no source at all, every commit is the lane's own.
    expect(() => discard([])).toThrow(/commits on arbab\/a that are not on/);
    expect(existsSync(join(wt.path, "uncommitted.txt"))).toBe(true);
    expect(sha("arbab/a")).toBe(own);
  });

  it("runs no hook a relative core.hooksPath finds while it removes the worktree and deletes the branch", () => {
    const marker = join(dir, "hook-ran");
    createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "main", trustedBase: "main", git });
    markerHooks(join(repo, ".husky"), ["reference-transaction"], marker);
    ok(["config", "core.hooksPath", ".husky"]);
    discard([sha("main")]);
    expect(existsSync(marker)).toBe(false);
    expect(branchExists("arbab/a")).toBe(false);
    // Without the override the same branch deletion runs the hook.
    ok(["branch", "arbab/b"]);
    ok(["branch", "-D", "arbab/b"]);
    expect(existsSync(marker)).toBe(true);
  });

  it("removes a worktree whose branch is gone, and forgets a registration whose directory is gone", () => {
    const wt = createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "main", trustedBase: "main", git });
    rmSync(wt.path, { recursive: true, force: true });
    discard([sha("main")]);
    expect(ok(["worktree", "list", "--porcelain"])).not.toContain(wt.path);
    expect(branchExists("arbab/a")).toBe(false);
  });

  it("refuses bad lanes, escaping roots and option-like sources", () => {
    expect(() => discard([sha("main")], "../x")).toThrow(ArbabError);
    expect(() => discardWorktree({ projectRoot: repo, root: "../out", lane: "a", sources: [], gitCommonDir: common(), git })).toThrow(ArbabError);
    expect(() => discard(["--all"])).toThrow(/source "--all" is not a valid revision/);
  });
});

/** Executable hooks under `hooksDir` that each append their name to `marker`. */
function markerHooks(hooksDir: string, names: string[], marker: string): void {
  mkdirSync(hooksDir, { recursive: true });
  for (const name of names) {
    const hook = join(hooksDir, name);
    writeFileSync(hook, `#!/bin/sh\necho ${name} >> '${marker}'\n`);
    chmodSync(hook, 0o755);
  }
}

describe("untrustedTree", () => {
  it("names hooks, fsmonitor and submodule recursion off", () => {
    expect(untrustedTree()).toEqual([
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "diff.ignoreSubmodules=all",
      "-c",
      "submodule.recurse=false",
    ]);
  });
  it("keeps git from running hooks a relative core.hooksPath finds in the work tree", () => {
    const marker = join(dir, "hook-ran");
    markerHooks(join(repo, ".husky"), ["pre-commit", "prepare-commit-msg", "commit-msg", "post-commit"], marker);
    ok(["config", "core.hooksPath", ".husky"]);
    ok([...untrustedTree(), "add", "-A"]);
    ok([...untrustedTree(), "commit", "-q", "-m", "hooks off"]);
    expect(existsSync(marker)).toBe(false);
    writeFileSync(join(repo, "b.txt"), "b\n");
    ok(["add", "-A"]);
    ok(["commit", "-q", "-m", "hooks on"]);
    expect(readFileSync(marker, "utf8")).toMatch(/pre-commit/);
  });
});

describe("commonDir", () => {
  it("names the shared git dir from the project root and from a linked worktree", () => {
    const shared = realpathSync(join(repo, ".git"));
    expect(commonDir(repo, git)).toBe(shared);
    const wt = createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "main", trustedBase: "main", git });
    expect(commonDir(wt.path, git)).toBe(shared);
  });
  it("throws a git error outside a repository", () => {
    expect(() => commonDir(mkdtempSync(join(dir, "plain-")), git)).toThrow(/rev-parse --git-common-dir/);
  });
});

describe("verifyWorktreeGit", () => {
  it("returns the private git dir of an untouched worktree", () => {
    const wt = createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "main", trustedBase: "main", git });
    expect(verifyWorktreeGit({ worktree: wt.path, branch: "arbab/a", gitCommonDir: wt.gitCommonDir })).toEqual({
      gitDir: join(wt.gitCommonDir, "worktrees", "a"),
      error: null,
    });
  });
  it("refuses another branch, a missing pointer and the main checkout", () => {
    const wt = createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "main", trustedBase: "main", git });
    expect(verifyWorktreeGit({ worktree: wt.path, branch: "arbab/b", gitCommonDir: wt.gitCommonDir }).error).toMatch(/not ref: refs\/heads\/arbab\/b/);
    expect(verifyWorktreeGit({ worktree: join(dir, "nowhere"), branch: "arbab/a", gitCommonDir: wt.gitCommonDir }).gitDir).toBeNull();
    expect(verifyWorktreeGit({ worktree: repo, branch: "main", gitCommonDir: wt.gitCommonDir }).gitDir).toBeNull();
  });
  it("checks a detached HEAD at the given commit instead of the branch when detachedAt is set", () => {
    const main = ok(["rev-parse", "main"]).trim();
    const path = join(dir, "detached");
    ok(["worktree", "add", "--detach", path, main]);
    const gitCommonDir = realpathSync(join(repo, ".git"));
    expect(verifyWorktreeGit({ worktree: path, branch: "arbab/a", gitCommonDir, detachedAt: main })).toEqual({
      gitDir: join(gitCommonDir, "worktrees", "detached"),
      error: null,
    });
    expect(verifyWorktreeGit({ worktree: path, branch: "arbab/a", gitCommonDir }).error).toMatch(/not ref: refs\/heads\/arbab\/a/);
    const other = "0".repeat(40);
    expect(verifyWorktreeGit({ worktree: path, branch: "arbab/a", gitCommonDir, detachedAt: other }).error).toMatch(new RegExp(`is "${main}", not ${other}$`));
    expect(verifyWorktreeGit({ worktree: path, branch: "arbab/a", gitCommonDir, detachedAt: "main" }).error).toBe('"main" is not a commit sha');
    // A worktree on the branch is not detached at its head.
    const wt = createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "main", trustedBase: "main", git });
    expect(verifyWorktreeGit({ worktree: wt.path, branch: "arbab/a", gitCommonDir, detachedAt: main }).gitDir).toBeNull();
  });
  it("refuses a pointer to the shared dir's worktrees root itself", () => {
    const wt = createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "main", trustedBase: "main", git });
    writeFileSync(join(wt.path, ".git"), `gitdir: ${join(wt.gitCommonDir, "worktrees")}\n`);
    expect(verifyWorktreeGit({ worktree: wt.path, branch: "arbab/a", gitCommonDir: wt.gitCommonDir }).error).toMatch(/is not under/);
  });
});

describe("isDirty", () => {
  it("is false on a clean tree and true with an untracked file", () => {
    const gitDir = join(repo, ".git");
    expect(isDirty(repo, git, gitDir)).toBe(false);
    writeFileSync(join(repo, "new.txt"), "n");
    expect(isDirty(repo, git, gitDir)).toBe(true);
  });
  it("uses the explicit git dir instead of the one the work tree names", () => {
    const wt = createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "main", trustedBase: "main", git });
    writeFileSync(join(wt.path, "new.txt"), "n");
    writeFileSync(join(wt.path, ".git"), "gitdir: /nonexistent\n");
    expect(isDirty(wt.path, git, join(wt.gitCommonDir, "worktrees", "a"))).toBe(true);
  });
  it("throws when the git dir is not a repository", () => {
    const plain = mkdtempSync(join(dir, "plain-"));
    expect(() => isDirty(plain, git, join(plain, ".git"))).toThrow(ArbabError);
  });
});

describe("holdsGit", () => {
  it("sees a .git directory or file, and nothing else", () => {
    expect(holdsGit(repo)).toBe(true);
    const plain = mkdtempSync(join(dir, "plain-"));
    expect(holdsGit(plain)).toBe(false);
    expect(holdsGit(join(dir, "missing"))).toBe(false);
    writeFileSync(join(plain, ".git"), "gitdir: elsewhere\n");
    expect(holdsGit(plain)).toBe(true);
  });
});

describe("indexGitlinks", () => {
  it("reads the gitlinks from the index, by the explicit git dir", () => {
    expect(indexGitlinks(repo, join(repo, ".git"), git)).toEqual([]);
    const head = ok(["rev-parse", "HEAD"]).trim();
    ok(["update-index", "--add", "--cacheinfo", `160000,${head},a b/c`]);
    ok(["update-index", "--add", "--cacheinfo", `160000,${head},d`]);
    expect(indexGitlinks(repo, join(repo, ".git"), git)).toEqual(["a b/c", "d"]);
  });
  it("throws when the git dir is not a repository", () => {
    const plain = mkdtempSync(join(dir, "plain-"));
    expect(() => indexGitlinks(plain, join(plain, ".git"), git)).toThrow(ArbabError);
  });
});

describe("worktreeStatus", () => {
  it("lists the porcelain lines through the explicit git dir, with the untrusted-tree options", () => {
    const wt = createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "main", trustedBase: "main", git });
    const gitDir = join(wt.gitCommonDir, "worktrees", "a");
    expect(worktreeStatus(wt.path, gitDir, git)).toEqual([]);
    writeFileSync(join(wt.path, "a.txt"), "changed\n");
    writeFileSync(join(wt.path, "new.txt"), "n");
    const calls: string[][] = [];
    const spy: GitRunner = (args, cwd) => {
      calls.push(args);
      return git(args, cwd);
    };
    expect(worktreeStatus(wt.path, gitDir, spy)).toEqual([" M a.txt", "?? new.txt"]);
    expect(calls).toEqual([
      [...untrustedTree(), `--git-dir=${gitDir}`, `--work-tree=${wt.path}`, "status", "--porcelain", "--ignore-submodules=all"],
      [...untrustedTree(), `--git-dir=${gitDir}`, `--work-tree=${wt.path}`, "ls-files", "-s", "-z"],
    ]);
  });
  it("does not list a gitlink with nothing checked out under it", () => {
    const wt = createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "main", trustedBase: "main", git });
    const gitDir = join(wt.gitCommonDir, "worktrees", "a");
    ok(["update-index", "--add", "--cacheinfo", `160000,${ok(["rev-parse", "HEAD"]).trim()},vendor/lib`], wt.path);
    ok(["commit", "-q", "-m", "a submodule"], wt.path);
    expect(indexGitlinks(wt.path, gitDir, git)).toEqual(["vendor/lib"]);
    expect(worktreeStatus(wt.path, gitDir, git)).toEqual([]);
  });
  it("still shows an untracked nested repository, without running anything of it", () => {
    const wt = createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "main", trustedBase: "main", git });
    const nested = plantNestedRepo(git, wt.path, "sub", dir);
    expect(worktreeStatus(wt.path, join(wt.gitCommonDir, "worktrees", "a"), git)).toEqual(["?? sub/"]);
    expect(nested.ran()).toBe("");
  });
  it("never descends into a staged nested repository, whose config a plain status runs", () => {
    const wt = createWorktree({ projectRoot: repo, root: "wt", lane: "a", base: "main", trustedBase: "main", git });
    const gitDir = join(wt.gitCommonDir, "worktrees", "a");
    const nested = plantNestedRepo(git, wt.path, "sub", dir);
    // What an unprotected checkpoint did: the nested repository becomes a gitlink.
    ok(["add", "-A"], wt.path);
    expect(ok(["ls-files", "-s", "sub"], wt.path)).toMatch(/^160000 /);
    nested.reset();

    // Status ignores the gitlink; the repository checked out under it is listed from the index.
    expect(worktreeStatus(wt.path, gitDir, git)).toEqual(["?? sub/"]);
    expect(isDirty(wt.path, git, gitDir)).toBe(true);
    expect(nested.ran()).toBe("");

    // The hazard is real on this machine: the same status without the options runs the worker's commands.
    ok([`--git-dir=${gitDir}`, `--work-tree=${wt.path}`, "status", "--porcelain"], wt.path);
    expect(nested.ran()).toMatch(/fsmonitor/);
    expect(nested.ran()).toMatch(/clean/);
  });
});
