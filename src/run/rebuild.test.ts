import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DependencyStrategy } from "../types";
import { ArbabError } from "../util/errors";
import type { ArgvRunner } from "./deps";
import { makeGitRunner, verifyWorktreeGit, type GitRunner } from "./git";
import { rebuildWorktree, type RebuildInput } from "./rebuild";

let dir: string;
let repo: string;
let git: GitRunner;
let commonDir: string;

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

const sha = (rev: string): string => ok(["rev-parse", rev]).trim();

let scratches = 0;

/**
 * Commits `files` (executable under .husky/) on `branch`, created from main when missing, in a scratch worktree
 * removed afterwards. main itself is committed in the project root.
 */
function commitOn(branch: string, files: Record<string, string>): string {
  const exists = git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], repo).code === 0;
  const scratch = branch === "main" ? repo : join(dir, `scratch-${++scratches}`);
  if (scratch !== repo) ok(exists ? ["worktree", "add", scratch, branch] : ["worktree", "add", "-b", branch, scratch, "main"]);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(scratch, rel, ".."), { recursive: true });
    writeFileSync(join(scratch, rel), text);
    if (rel.startsWith(".husky/")) chmodSync(join(scratch, rel), 0o755);
  }
  ok(["add", "-A"], scratch);
  ok(["commit", "-q", "-m", `${branch} commit`], scratch);
  if (scratch !== repo) ok(["worktree", "remove", scratch]);
  return sha(`refs/heads/${branch}`);
}

const COMMAND: DependencyStrategy = { strategy: "command", command: ["fake-install"] };

interface Seen {
  cwd: string;
  a: string;
  head: string;
}

/** A runCommand that records the tree it runs in: a.txt and the worktree's HEAD file, read through its .git pointer. */
function recorder(seen: Seen[], result = { code: 0, output: "" }): ArgvRunner {
  return (_argv, cwd) => {
    const pointer = readFileSync(join(cwd, ".git"), "utf8").trim().replace(/^gitdir: /, "");
    seen.push({ cwd, a: readFileSync(join(cwd, "a.txt"), "utf8"), head: readFileSync(join(pointer, "HEAD"), "utf8").trim() });
    return result;
  };
}

function input(over: Partial<RebuildInput> = {}): RebuildInput {
  return {
    projectRoot: repo,
    path: join(repo, "wt", "a"),
    branch: "arbab/a",
    start: sha("main"),
    dependencies: COMMAND,
    runCommand: () => ({ code: 0, output: "" }),
    manifests: "refuse",
    git,
    ...over,
  };
}

function caught(fn: () => unknown): ArbabError {
  try {
    fn();
  } catch (e) {
    if (e instanceof ArbabError) return e;
    throw e;
  }
  throw new Error("expected a throw");
}

/** Whether git still lists a worktree at `path`. */
function registered(path: string): boolean {
  return ok(["worktree", "list", "--porcelain"]).includes(`worktree ${path}\n`);
}

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "arbab-rebuild-")));
  repo = join(dir, "repo");
  git = isolatedGit(dir);
  ok(["init", "-q", "-b", "main", repo], dir);
  writeFileSync(join(repo, "a.txt"), "base\n");
  writeFileSync(join(repo, "package.json"), '{"name":"demo","dependencies":{"left-pad":"1.0.0"}}\n');
  ok(["add", "-A"]);
  ok(["commit", "-q", "-m", "init"]);
  commonDir = realpathSync(join(repo, ".git"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("rebuildWorktree", () => {
  it("installs while the tree is at start, then ends on the branch at its old head, attached and verified", () => {
    const start = sha("main");
    const head = commitOn("arbab/a", { "a.txt": "worker\n" });
    const seen: Seen[] = [];
    const path = join(repo, "wt", "a");
    const r = rebuildWorktree(input({ runCommand: recorder(seen) }));
    expect(seen).toEqual([{ cwd: path, a: "base\n", head: start }]);
    const gitDir = join(commonDir, "worktrees", "a");
    expect(r).toEqual({ path, branch: "arbab/a", head, gitCommonDir: commonDir, gitDir, manifests: [] });
    expect(readFileSync(join(path, "a.txt"), "utf8")).toBe("worker\n");
    expect(readFileSync(join(gitDir, "HEAD"), "utf8").trim()).toBe("ref: refs/heads/arbab/a");
    expect(verifyWorktreeGit({ worktree: path, branch: "arbab/a", gitCommonDir: commonDir })).toEqual({ gitDir, error: null });
    expect(ok(["rev-parse", "HEAD"], path).trim()).toBe(head);
    expect(ok(["status", "--porcelain"], path)).toBe("");
    expect(sha("refs/heads/arbab/a")).toBe(head);
  });

  it("rebuilds a worktree whose directory was deleted by hand (a stale registration)", () => {
    const head = commitOn("arbab/a", { "a.txt": "worker\n" });
    const path = join(repo, "wt", "a");
    ok(["worktree", "add", path, "arbab/a"]);
    rmSync(path, { recursive: true, force: true });
    const r = rebuildWorktree(input());
    expect(r.head).toBe(head);
    expect(readFileSync(join(path, "a.txt"), "utf8")).toBe("worker\n");
    expect(sha("refs/heads/arbab/a")).toBe(head);
  });

  it("installs at the head itself when start is the head", () => {
    const head = commitOn("arbab/a", { "a.txt": "worker\n" });
    const seen: Seen[] = [];
    const r = rebuildWorktree(input({ start: head, runCommand: recorder(seen) }));
    expect(seen.map((s) => [s.a, s.head])).toEqual([["worker\n", head]]);
    expect(r.head).toBe(head);
  });

  it("runs nothing for the none strategy", () => {
    commitOn("arbab/a", { "a.txt": "worker\n" });
    const seen: Seen[] = [];
    rebuildWorktree(input({ dependencies: { strategy: "none" }, runCommand: recorder(seen) }));
    expect(seen).toEqual([]);
  });

  it("works on an integration branch", () => {
    const head = commitOn("integrate/rel", { "a.txt": "merged\n" });
    const path = join(repo, "wt", "integrate-rel");
    const r = rebuildWorktree(input({ path, branch: "integrate/rel" }));
    expect(r.head).toBe(head);
    expect(verifyWorktreeGit({ worktree: path, branch: "integrate/rel", gitCommonDir: commonDir }).gitDir).not.toBeNull();
  });

  it("refuses a manifest change in refuse mode, after the install, and leaves no worktree", () => {
    const head = commitOn("arbab/a", { "package.json": '{"name":"demo","dependencies":{"left-pad":"9.9.9"}}\n' });
    const path = join(repo, "wt", "a");
    const seen: Seen[] = [];
    const err = caught(() => rebuildWorktree(input({ runCommand: recorder(seen) })));
    expect(err.code).toBe("git");
    expect(err.message).toMatch(/^arbab\/a changes dependency manifests since [0-9a-f]{40} \(package\.json\)/);
    expect(err.message).toContain('relaunch under a new name with "base": "arbab/a"');
    expect(err.message).toContain("Land that dependency change on the base");
    expect(seen.map((s) => s.a)).toEqual(["base\n"]);
    expect(existsSync(path)).toBe(false);
    expect(registered(path)).toBe(false);
    expect(sha("refs/heads/arbab/a")).toBe(head);
  });

  it("ignores a package.json change no install sees, in refuse mode", () => {
    const head = commitOn("arbab/a", { "package.json": '{"name":"demo","version":"2.0.0","dependencies":{"left-pad":"1.0.0"}}\n' });
    expect(rebuildWorktree(input()).head).toBe(head);
  });

  it("returns a manifest change in flag mode", () => {
    const head = commitOn("arbab/a", { "package.json": '{"name":"demo","dependencies":{"left-pad":"9.9.9"}}\n', ".npmrc": "x=1\n" });
    const r = rebuildWorktree(input({ manifests: "flag" }));
    expect(r.manifests).toEqual([".npmrc", "package.json"]);
    expect(r.head).toBe(head);
    expect(readFileSync(join(r.path, ".npmrc"), "utf8")).toBe("x=1\n");
  });

  it("removes the worktree when the install fails, and names its last lines", () => {
    const head = commitOn("arbab/a", { "a.txt": "worker\n" });
    const path = join(repo, "wt", "a");
    const output = ["1", "2", "3", "4", "5", "6", "boom"].join("\n");
    const err = caught(() => rebuildWorktree(input({ runCommand: () => ({ code: 3, output }) })));
    expect(err.code).toBe("runtime");
    expect(err.message).toBe(`dependencies failed in ${path} (3): 3\n4\n5\n6\nboom`);
    expect(existsSync(path)).toBe(false);
    expect(registered(path)).toBe(false);
    expect(sha("refs/heads/arbab/a")).toBe(head);
  });

  it("removes the worktree when the dependency strategy is invalid", () => {
    const head = commitOn("arbab/a", { "a.txt": "worker\n" });
    const path = join(repo, "wt", "a");
    const bad = { strategy: "command", command: [] } as unknown as DependencyStrategy;
    expect(caught(() => rebuildWorktree(input({ dependencies: bad }))).code).toBe("config");
    expect(existsSync(path)).toBe(false);
    expect(sha("refs/heads/arbab/a")).toBe(head);
  });

  it("removes the worktree when the checkout fails, and leaves the branch where it was", () => {
    const head = commitOn("arbab/a", { "a.txt": "worker\n" });
    const path = join(repo, "wt", "a");
    // An install that leaves a tracked file changed which the checkout would overwrite.
    const dirty: ArgvRunner = (_argv, cwd) => {
      writeFileSync(join(cwd, "a.txt"), "install wrote this\n");
      return { code: 0, output: "" };
    };
    const err = caught(() => rebuildWorktree(input({ runCommand: dirty })));
    expect(err.message).toMatch(/git checkout -q arbab\/a -- failed/);
    expect(existsSync(path)).toBe(false);
    expect(registered(path)).toBe(false);
    expect(sha("refs/heads/arbab/a")).toBe(head);
  });

  it("refuses an existing path, a dangling link included, without installing", () => {
    const head = commitOn("arbab/a", { "a.txt": "worker\n" });
    const path = join(repo, "wt", "a");
    const seen: Seen[] = [];
    mkdirSync(path, { recursive: true });
    const err = caught(() => rebuildWorktree(input({ runCommand: recorder(seen) })));
    expect(err.code).toBe("usage");
    expect(err.message).toBe(`${path} exists; arbab rebuilds only a missing worktree`);
    expect(existsSync(path)).toBe(true);
    rmSync(path, { recursive: true });
    // A link whose target is gone: existsSync says no, but something is there.
    symlinkSync(join(dir, "gone"), path);
    expect(caught(() => rebuildWorktree(input({ runCommand: recorder(seen) }))).message).toMatch(/exists; arbab rebuilds only/);
    expect(seen).toEqual([]);
    expect(sha("refs/heads/arbab/a")).toBe(head);
  });

  it("refuses a start that is not the head or an ancestor of it, before anything is created", () => {
    const head = commitOn("arbab/a", { "a.txt": "worker\n" });
    const other = commitOn("main", { "b.txt": "later\n" });
    const path = join(repo, "wt", "a");
    const seen: Seen[] = [];
    const err = caught(() => rebuildWorktree(input({ start: other, runCommand: recorder(seen) })));
    expect(err.code).toBe("git");
    expect(err.message).toBe(`cannot rebuild ${path}: ${other} is not arbab/a's head ${head} or an ancestor of it`);
    expect(seen).toEqual([]);
    expect(existsSync(path)).toBe(false);
    expect(sha("refs/heads/arbab/a")).toBe(head);
  });

  it("refuses a missing branch, a start that names no commit, and bad inputs", () => {
    const path = join(repo, "wt", "a");
    expect(caught(() => rebuildWorktree(input())).message).toBe(`cannot rebuild ${path}: branch arbab/a does not exist`);
    commitOn("arbab/a", { "a.txt": "worker\n" });
    expect(caught(() => rebuildWorktree(input({ start: "nope" }))).message).toBe(`cannot rebuild ${path}: start nope does not name a commit`);
    expect(caught(() => rebuildWorktree(input({ start: "--orphan" }))).code).toBe("usage");
    expect(caught(() => rebuildWorktree(input({ start: "" }))).code).toBe("usage");
    expect(caught(() => rebuildWorktree(input({ path: "wt/a" }))).message).toMatch(/is not absolute/);
    expect(caught(() => rebuildWorktree(input({ branch: "main" }))).message).toMatch(/neither arbab\/<lane> nor integrate\/<name>/);
    expect(caught(() => rebuildWorktree(input({ branch: "other/a" }))).code).toBe("usage");
    expect(() => rebuildWorktree(input({ branch: "arbab/../x" }))).toThrow(ArbabError);
    expect(existsSync(path)).toBe(false);
  });

  it("runs no post-checkout hook from a relative core.hooksPath the branch holds", () => {
    const marker = join(dir, "hook-ran");
    const hooks: Record<string, string> = {};
    for (const name of ["post-checkout", "post-merge", "reference-transaction"]) {
      hooks[`.husky/${name}`] = `#!/bin/sh\necho ${name} >> '${marker}'\n`;
    }
    commitOn("arbab/a", hooks);
    ok(["config", "core.hooksPath", ".husky"]);
    const r = rebuildWorktree(input());
    expect(existsSync(marker)).toBe(false);
    // Without the override a checkout in that tree runs the hook.
    ok(["checkout", "-q", "--detach"], r.path);
    expect(existsSync(marker)).toBe(true);
  });
});
