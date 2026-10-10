import { readdirSync, type Dirent } from "node:fs";
import { join } from "node:path";
import type { EndState } from "../types";
import { ArbabError } from "../util/errors";
import { assertValidName } from "../util/names";
import { explicitGit, holdsGit, indexGitlinks, untrustedTree, verifyWorktreeGit, worktreeStatus, type GitRunner } from "./git";

export interface CheckpointInput {
  worktree: string;
  lane: string;
  attempt: number;
  endState: EndState;
  /** The branch the worktree must be on (arbab/<owner>). */
  branch: string;
  /** The repository's shared git directory, from createWorktree. */
  gitCommonDir: string;
  git: GitRunner;
}

type GitResult = ReturnType<GitRunner>;

/** The nested repositories at or under an untracked directory, relative to the work tree; symlinks are not followed. */
function nestedUnder(worktree: string, rel: string, out: string[]): void {
  const abs = join(worktree, rel);
  if (holdsGit(abs)) {
    out.push(rel);
    return;
  }
  let entries: Dirent[];
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) if (e.isDirectory()) nestedUnder(worktree, `${rel}/${e.name}`, out);
}

/**
 * The repositories at or under the untracked directories, which `git add -A` would stage as gitlinks. `ls-files
 * --others --directory` lists a wholly untracked directory once, without descending into a nested repository.
 */
function untrackedRepositories(git: (args: string[]) => GitResult, worktree: string): string[] | GitResult {
  const others = git(["ls-files", "--others", "--exclude-standard", "--directory", "-z"]);
  if (others.code !== 0) return others;
  const out: string[] = [];
  for (const entry of others.stdout.split("\0")) {
    if (entry.endsWith("/")) nestedUnder(worktree, entry.replace(/\/+$/, ""), out);
  }
  return out;
}

/** The paths `git diff --cached --raw -z --no-renames` shows with a gitlink on either side, sorted. */
function stagedGitlinks(raw: string): string[] {
  const fields = raw.split("\0");
  const out: string[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const [src, dst] = (fields[i] ?? "").replace(/^:/, "").split(" ");
    const path = fields[i + 1] ?? "";
    if ((src === "160000" || dst === "160000") && path !== "") out.push(path);
  }
  return out.sort();
}

/** Directories of arbab's own state in a worktree, never staged by a checkpoint. */
export const ARBAB_STATE: readonly string[] = [".arbab", ".arbab-tmp"];

/**
 * Commits whatever the worker left in its worktree. When the commit fails, the error text comes back instead of a sha
 * and the changes stay staged.
 *
 * The worker could write its worktree's git files, so git is never left to find the repository from the worktree:
 * the private git dir is verified first (verifyWorktreeGit) and every call names it and the work tree explicitly. A
 * git dir that fails the check gets no commit, only the error. No hook runs: hooks the work tree holds are worker
 * code, and this commit runs on the host. The project's checks run inside the fence instead (arbab verify).
 *
 * A nested repository is never staged: once it is a gitlink, a host git that refreshes the work tree runs a child git
 * inside it, under the worker's config. The rest is committed, and the error names what was left out. One the worker
 * staged itself stops the commit.
 */
export function checkpoint(input: CheckpointInput): { sha: string | null; error: string | null } {
  const lane = assertValidName(input.lane, "lane");
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 1) {
    throw new ArbabError("usage", `attempt ${input.attempt} is not a positive integer`);
  }
  const verified = verifyWorktreeGit({ worktree: input.worktree, branch: input.branch, gitCommonDir: input.gitCommonDir });
  if (verified.gitDir === null) return { sha: null, error: `checkpoint skipped: ${verified.error}` };
  const gitDir = verified.gitDir;
  const prefix = [...explicitGit(gitDir, input.worktree), ...untrustedTree()];
  const git = (args: string[]): GitResult => input.git([...prefix, ...args], input.worktree);
  let tracked: string[];
  try {
    if (worktreeStatus(input.worktree, gitDir, input.git).length === 0) return { sha: null, error: null };
    tracked = indexGitlinks(input.worktree, gitDir, input.git);
  } catch (err) {
    return { sha: null, error: (err as Error).message };
  }

  const failed = (step: string, r: GitResult) => ({
    sha: null,
    error: `${step} failed (${r.code}): ${(r.stderr || r.stdout).trim()}`,
  });
  const untracked = untrackedRepositories(git, input.worktree);
  if (!Array.isArray(untracked)) return failed("git ls-files --others", untracked);
  // A tracked gitlink with nothing checked out under it is not a repository, and nothing of it was left out.
  const left = [...new Set([...tracked.filter((p) => holdsGit(join(input.worktree, p))), ...untracked])].sort();
  const leftOut = left.length === 0 ? null : `nested repositories were not committed: ${left.join(", ")}; arbab never commits or inspects them`;

  // arbab's own state is never a lane's work: a worker that un-ignores .arbab/ could otherwise commit an integration
  // record, which would land as a tracked file where arbab reads which install points a human confirmed. Excluded only
  // where git does not ignore it already: naming an ignored path, even to exclude it, makes `git add` fail.
  // Matched without case: on a case-insensitive file system `.ARBAB/` is `.arbab/`, and would land where arbab reads.
  const state = ARBAB_STATE.filter((path) => git(["check-ignore", "-q", "--", path]).code !== 0);
  const add = git([
    "add",
    "-A",
    "--",
    ".",
    ...[...new Set([...tracked, ...untracked])].map((p) => `:(exclude,literal)${p}`),
    ...state.map((p) => `:(exclude,icase,literal)${p}`),
  ]);
  if (add.code !== 0) return failed("git add -A", add);
  // Index against HEAD only, so no nested repository is looked at; a gitlink shows despite diff.ignoreSubmodules.
  const cached = git(["diff", "--cached", "--raw", "-z", "--no-renames", "--ignore-submodules=none"]);
  if (cached.code !== 0) return failed("git diff --cached", cached);
  const staged = stagedGitlinks(cached.stdout);
  if (staged.length > 0) {
    // The worker staged them itself; a commit would take them, and unstaging means touching them.
    return {
      sha: null,
      error:
        `nested repositories are staged in the index: ${staged.join(", ")}; arbab never commits or inspects them, so ` +
        "nothing was committed. Unstage them to let the checkpoint commit the rest",
    };
  }
  // Nothing staged when only nested repositories changed: there is no commit to make.
  if (cached.stdout === "") return { sha: null, error: leftOut };
  const message =
    `arbab(${lane}): checkpoint attempt ${input.attempt} (${input.endState})\n\n` +
    "Co-Authored-By: Claude <noreply@anthropic.com>";
  const commit = git(["commit", "--no-verify", "-m", message]);
  if (commit.code !== 0) return failed("git commit", commit);
  const head = git(["rev-parse", "HEAD"]);
  if (head.code !== 0) return failed("git rev-parse HEAD", head);
  return { sha: head.stdout.trim(), error: leftOut };
}
