import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ArbabError } from "../util/errors";
import { confine, ensureDir, readText } from "../util/fs";
import { assertValidName } from "../util/names";

export type GitRunner = (args: string[], cwd: string) => { code: number; stdout: string; stderr: string };

/** A git runner with an explicit environment (tests isolate git from the user's global config with it). */
export function makeGitRunner(env?: NodeJS.ProcessEnv): GitRunner {
  return (args, cwd) => {
    const r = spawnSync("git", args, { cwd, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.error) return { code: 127, stdout: "", stderr: r.error.message };
    // A git killed by a signal has no status; report it as a failure.
    return { code: r.status ?? 128, stdout: r.stdout, stderr: r.stderr };
  };
}

export const nodeGit: GitRunner = makeGitRunner();

/** Runs `git <options> <args>`; errors name only `args`, the command as a person would type it. */
function must(git: GitRunner, args: string[], cwd: string, options: string[] = []): string {
  const r = git([...options, ...args], cwd);
  if (r.code !== 0) {
    throw new ArbabError("git", `git ${args.join(" ")} failed (${r.code}): ${(r.stderr || r.stdout).trim()}`);
  }
  return r.stdout;
}

/** Appends missing entries to the repository's info/exclude and verifies that git ignores each of them. */
export function ensureIgnored(projectRoot: string, entries: string[], git: GitRunner): void {
  const excludeRel = must(git, ["rev-parse", "--git-path", "info/exclude"], projectRoot).trim();
  if (excludeRel === "") throw new ArbabError("git", "git rev-parse --git-path info/exclude printed nothing");
  const exclude = resolve(projectRoot, excludeRel);
  const text = readText(exclude) ?? "";
  const present = new Set(text.split(/\r?\n/).map((line) => line.trim()));
  const missing = entries.filter((entry) => !present.has(entry));
  if (missing.length > 0) {
    const prefix = text === "" || text.endsWith("\n") ? "" : "\n";
    ensureDir(dirname(exclude));
    writeFileSync(exclude, text + prefix + missing.join("\n") + "\n");
  }
  for (const entry of entries) {
    const probe = `${entry.replace(/\/+$/, "")}/x`;
    const r = git(["check-ignore", "-q", "--", probe], projectRoot);
    if (r.code !== 0) throw new ArbabError("git", `${entry} is not ignored by git in ${projectRoot}`);
  }
}

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** The branch each registered worktree is on (null when detached), by canonical path. */
function listWorktrees(projectRoot: string, git: GitRunner): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const block of must(git, ["worktree", "list", "--porcelain"], projectRoot).split("\n\n")) {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice("worktree ".length);
    if (path === undefined) continue;
    out.set(canonical(path), lines.find((l) => l.startsWith("branch "))?.slice("branch ".length) ?? null);
  }
  return out;
}

function branchExists(projectRoot: string, branch: string, git: GitRunner): boolean {
  return git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], projectRoot).code === 0;
}

/**
 * Refuses to re-create a missing worktree on a branch that holds commits the base does not: a created worktree is
 * the shepherd's own, and it installs dependencies there on the host, which on a tree of worker commits runs worker
 * code (package.json scripts, .npmrc) outside the fence.
 */
function refuseWorkerBranch(projectRoot: string, branch: string, base: string, path: string, git: GitRunner): void {
  const r = git(["merge-base", "--is-ancestor", `refs/heads/${branch}`, base], projectRoot);
  if (r.code === 0) return;
  if (r.code !== 1) {
    throw new ArbabError("git", `git merge-base --is-ancestor refs/heads/${branch} ${base} failed (${r.code}): ${(r.stderr || r.stdout).trim()}`);
  }
  throw new ArbabError(
    "git",
    `the worktree ${path} is missing, and its branch ${branch} holds worker commits that are not on ${base}; arbab ` +
      `installs dependencies only on a trusted base. Restore the worktree at ${path}, or delete the branch ${branch}`,
  );
}

export interface WorktreeInput {
  projectRoot: string;
  /** The worktree root relative to the project, e.g. ".arbab/worktrees". */
  root: string;
  lane: string;
  /**
   * Where a new branch starts. A function is called only when a branch is made, so a reused worktree or branch never
   * resolves it.
   */
  base: string | (() => string);
  /**
   * The trusted branch (config.baseBranch) an existing branch must be contained in to be checked out again: not the
   * lane's base, which a worker may have written.
   */
  trustedBase: string;
  git: GitRunner;
}

function assertRevision(rev: string, what: string): string {
  if (rev === "" || rev.startsWith("-")) throw new ArbabError("usage", `${what} ${JSON.stringify(rev)} is not a valid revision`);
  return rev;
}

/** The repository's shared git directory, asked of the project root (never of a worker's worktree). */
function commonDir(projectRoot: string, git: GitRunner): string {
  const out = must(git, ["rev-parse", "--git-common-dir"], projectRoot).trim();
  if (out === "") throw new ArbabError("git", "git rev-parse --git-common-dir printed nothing");
  return canonical(resolve(projectRoot, out));
}

export interface Worktree {
  path: string;
  branch: string;
  /** False when an existing worktree was reused. */
  created: boolean;
  /** Absolute path of the repository's shared git directory. */
  gitCommonDir: string;
}

/**
 * Creates `<root>/<lane>` on branch `arbab/<lane>`, or reuses it when it is already a worktree of this repository. A
 * missing worktree is re-created on an existing branch only when the trusted base contains that branch.
 */
export function createWorktree(input: WorktreeInput): Worktree {
  const lane = assertValidName(input.lane, "lane");
  const path = join(confine(input.projectRoot, input.root), lane);
  const branch = `arbab/${lane}`;
  if (existsSync(path)) {
    const ref = listWorktrees(input.projectRoot, input.git).get(canonical(path));
    if (ref !== undefined) {
      // Another branch's worktree at this path (an integration's, integrate/<name>) is not the lane's to run in.
      if (ref !== `refs/heads/${branch}`) {
        throw new ArbabError("git", `${path} is a worktree on ${ref ?? "a detached HEAD"}, not on ${branch}; lane ${lane} cannot run there`);
      }
      return { path, branch, created: false, gitCommonDir: commonDir(input.projectRoot, input.git) };
    }
  }
  const trusted = assertRevision(input.trustedBase, "trusted base");
  if (typeof input.base === "string") assertRevision(input.base, "base");
  // A worktree directory deleted by hand stays registered and makes `worktree add` fail; forget such entries first.
  must(input.git, ["worktree", "prune"], input.projectRoot);
  ensureDir(dirname(path));
  // An existing branch can hold worker commits, and checking it out runs post-checkout from that tree.
  if (branchExists(input.projectRoot, branch, input.git)) {
    refuseWorkerBranch(input.projectRoot, branch, trusted, path, input.git);
    must(input.git, ["worktree", "add", path, branch], input.projectRoot, untrustedTree());
  } else {
    const base = assertRevision(typeof input.base === "string" ? input.base : input.base(), "base");
    must(input.git, ["worktree", "add", "-b", branch, path, base], input.projectRoot, untrustedTree());
  }
  return { path, branch, created: true, gitCommonDir: commonDir(input.projectRoot, input.git) };
}

export interface DiscardInput {
  projectRoot: string;
  /** The worktree root relative to the project, e.g. ".arbab/worktrees". */
  root: string;
  lane: string;
  /**
   * The commits the branch's history may come from without being the lane's own: the trusted base, the lane's base
   * and its merge branches, resolved.
   */
  sources: string[];
  /** The repository's shared git directory, to verify the worktree before its status is read. */
  gitCommonDir: string;
  git: GitRunner;
}

/**
 * Removes `<root>/<lane>` and deletes arbab/<lane>, so the shepherd can build the worktree again on a trusted commit.
 * Only for a worktree no worker has run in, which the caller decides, and only when it holds nothing arbab could not
 * rebuild: a clean tree (read through the verified git dir) on a branch whose every commit, merges included, comes
 * from a source. Anything else (uncommitted changes, a file an interrupted merge left, a commit or merge made by hand)
 * is refused with nothing removed: it is not arbab's to destroy, and not safe to install on.
 */
export function discardWorktree(input: DiscardInput): void {
  const lane = assertValidName(input.lane, "lane");
  const path = join(confine(input.projectRoot, input.root), lane);
  const branch = `arbab/${lane}`;
  const sources = input.sources.map((s) => assertRevision(s, "source"));
  const head = branchExists(input.projectRoot, branch, input.git);
  const keeps: string[] = [];
  if (head) {
    const extra = must(input.git, ["rev-list", `refs/heads/${branch}`, "--not", ...sources, "--"], input.projectRoot)
      .split("\n")
      .filter((l) => l !== "");
    if (extra.length > 0) {
      const shown = extra.slice(0, 3).join(", ") + (extra.length > 3 ? ` and ${extra.length - 3} more` : "");
      keeps.push(`commits on ${branch} that are not on its base, its merge branches or the trusted base: ${shown}`);
    }
  }
  if (existsSync(path)) {
    const verified = verifyWorktreeGit({ worktree: path, branch, gitCommonDir: input.gitCommonDir });
    if (verified.gitDir === null) {
      keeps.push(`a git dir that cannot be verified (${verified.error})`);
    } else {
      const changes = worktreeStatus(path, verified.gitDir, input.git);
      if (changes.length > 0) {
        const shown = changes.slice(0, 5).join("; ") + (changes.length > 5 ? `; and ${changes.length - 5} more` : "");
        keeps.push(`uncommitted changes (${shown})`);
      }
    }
  }
  if (keeps.length > 0) {
    throw new ArbabError(
      "git",
      `no worker has run in ${path}, but it holds what arbab cannot rebuild: ${keeps.join("; ")}. arbab will neither ` +
        `install dependencies there nor remove it. Keep what you need, remove the worktree and the branch ${branch}, ` +
        `then launch ${lane} again`,
    );
  }
  // The tree may hold worker files (a merged branch's), so no hook or nested repository's config runs.
  if (existsSync(path)) must(input.git, ["worktree", "remove", "--force", path], input.projectRoot, untrustedTree());
  must(input.git, ["worktree", "prune"], input.projectRoot);
  if (head) must(input.git, ["branch", "-D", branch], input.projectRoot, untrustedTree());
}

export interface WorktreeGitInput {
  worktree: string;
  /** The branch the worktree must be on, e.g. "arbab/m1-a". */
  branch: string;
  gitCommonDir: string;
}

/**
 * The worktree's private git directory, once it is shown to be the one git made for `branch`: under
 * `<gitCommonDir>/worktrees/`, its HEAD on the branch and its commondir back at `gitCommonDir`. A worker that can
 * write these files could otherwise point a checkpoint at another branch or at a git directory of its own.
 */
export function verifyWorktreeGit(input: WorktreeGitInput): { gitDir: string; error: null } | { gitDir: null; error: string } {
  const fail = (error: string): { gitDir: null; error: string } => ({ gitDir: null, error });
  const read = (path: string): string | null => {
    try {
      return readText(path);
    } catch {
      return null;
    }
  };
  const common = canonical(input.gitCommonDir);
  const pointer = /^gitdir: (.+)$/.exec((read(join(input.worktree, ".git")) ?? "").trim());
  if (pointer?.[1] === undefined) return fail(`${join(input.worktree, ".git")} is not a worktree's gitdir pointer`);
  const gitDir = canonical(resolve(input.worktree, pointer[1]));
  const rel = relative(join(common, "worktrees"), gitDir);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel) || rel.includes(sep)) {
    return fail(`git dir ${gitDir} is not under ${join(common, "worktrees")}`);
  }
  const head = read(join(gitDir, "HEAD"))?.trim();
  if (head !== `ref: refs/heads/${input.branch}`) return fail(`HEAD of ${gitDir} is ${JSON.stringify(head ?? null)}, not ref: refs/heads/${input.branch}`);
  const commondir = read(join(gitDir, "commondir"))?.trim();
  if (commondir === undefined || commondir === "" || canonical(resolve(gitDir, commondir)) !== common) {
    return fail(`commondir of ${gitDir} does not lead to ${common}`);
  }
  return { gitDir, error: null };
}

/** The global options that make git use exactly this git dir and work tree, whatever the worktree holds. */
export function explicitGit(gitDir: string, worktree: string): string[] {
  return [`--git-dir=${gitDir}`, `--work-tree=${worktree}`];
}

/**
 * The global options for every git arbab runs on the host in a tree that holds worker code. No hook runs: a relative
 * core.hooksPath (husky's `.husky`) resolves inside the work tree, which a worker can write. No child git descends into
 * a nested repository (a gitlink): that git would read the nested repository's own config, a worker-written file, and
 * run its core.fsmonitor command or clean filters on the host, outside the fence.
 */
export function untrustedTree(): string[] {
  return [
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "diff.ignoreSubmodules=all",
    "-c",
    "submodule.recurse=false",
  ];
}

/** Whether `path` holds a `.git` entry (a file or a directory), as a nested repository does. Symlinks are not followed. */
export function holdsGit(path: string): boolean {
  try {
    lstatSync(join(path, ".git"));
    return true;
  } catch {
    return false;
  }
}

/** The gitlinks (mode 160000) the worktree's index records, through the given git dir. Reads the index only. */
export function indexGitlinks(worktree: string, gitDir: string, git: GitRunner): string[] {
  return must(git, [...explicitGit(gitDir, worktree), "ls-files", "-s", "-z"], worktree, untrustedTree())
    .split("\0")
    .filter((entry) => entry.startsWith("160000 "))
    .map((entry) => entry.slice(entry.indexOf("\t") + 1))
    .filter((path) => path !== "");
}

/**
 * The worktree's `git status --porcelain` lines, through the given (verified) git dir and never descending into a
 * nested repository. An untracked one shows as `?? <path>/`, as git lists it; status ignores a gitlink entirely, so
 * one with a repository checked out under it is added as `?? <path>/` too: its content is neither committed nor
 * inspected, and the tree is not what its HEAD says.
 */
export function worktreeStatus(worktree: string, gitDir: string, git: GitRunner): string[] {
  const args = [...explicitGit(gitDir, worktree), "status", "--porcelain", "--ignore-submodules=all"];
  const lines = must(git, args, worktree, untrustedTree())
    .split("\n")
    .filter((line) => line.trim() !== "");
  const nested = indexGitlinks(worktree, gitDir, git)
    .filter((path) => holdsGit(join(worktree, path)))
    .map((path) => `?? ${path}/`);
  return [...lines, ...nested.filter((line) => !lines.includes(line))];
}

/** Whether the worktree has changes, by worktreeStatus. */
export function isDirty(worktree: string, git: GitRunner, gitDir: string): boolean {
  return worktreeStatus(worktree, gitDir, git).length > 0;
}
