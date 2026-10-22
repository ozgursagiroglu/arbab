import { readdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, posix, relative, sep } from "node:path";
import { explicitGit, untrustedTree, verifyWorktreeGit, type GitRunner } from "../run";
import { confine } from "../util/fs";

/**
 * Absolute paths, in the worktree, of the listed files git tracks there and that are regular files, not links. Listed
 * files that are untracked, missing, links or directories are left out, and so is every file when the worktree's git
 * dir cannot be verified: its `.git` file is worker-written, and a git dir of the worker's own would run its config's
 * commands (core.fsmonitor) on the host.
 */
export function envFileAllowReads(input: {
  worktree: string;
  /** The branch the worktree is on, e.g. "arbab/m1-a". */
  branch: string;
  gitCommonDir: string;
  readable: string[];
  git: GitRunner;
}): string[] {
  let real: string;
  try {
    real = realpathSync(input.worktree);
  } catch {
    return [];
  }
  const verified = verifyWorktreeGit({ worktree: input.worktree, branch: input.branch, gitCommonDir: input.gitCommonDir });
  if (verified.gitDir === null) return [];
  const candidates = new Map<string, string>();
  for (const listed of input.readable) {
    let path: string;
    try {
      path = confine(input.worktree, normalRel(listed));
    } catch {
      continue;
    }
    const rel = relative(input.worktree, path).split(sep).join("/");
    if (rel === "") continue;
    if (isRegularFile(input.worktree, real, path)) candidates.set(rel, path);
  }
  if (candidates.size === 0) return [];
  const tracked = trackedOf(input.git, input.worktree, verified.gitDir, [...candidates.keys()]);
  return [...candidates].filter(([rel]) => tracked.has(rel)).map(([, path]) => path).sort();
}

function normalRel(path: string): string {
  return posix.normalize(path.split("\\").join("/"));
}

/** Which of `rels` git tracks, in one call through the verified git dir; none when git fails. */
function trackedOf(git: GitRunner, worktree: string, gitDir: string, rels: string[]): Set<string> {
  // Literal, so a listed name with glob characters matches only itself.
  const args = [...explicitGit(gitDir, worktree), ...untrustedTree(), "ls-files", "-z", "--", ...rels.map((rel) => `:(literal)${rel}`)];
  const r = git(args, worktree);
  if (r.code !== 0) return new Set();
  return new Set(r.stdout.split("\0").filter((p) => p !== ""));
}

/**
 * Whether `path` is a regular file reached without a link: its directory resolves to where it sits in the worktree,
 * and its own entry is a file. Read from the directory listing, not by stat: a sandbox that denies `.env*` reads
 * may refuse a stat of the file itself.
 */
function isRegularFile(worktree: string, realWorktree: string, path: string): boolean {
  const dir = dirname(path);
  try {
    if (realpathSync(dir) !== join(realWorktree, relative(worktree, dir))) return false;
    const entry = readdirSync(dir, { withFileTypes: true }).find((e) => e.name === basename(path));
    return entry !== undefined && entry.isFile();
  } catch {
    // A missing or unreadable directory holds no readable template.
    return false;
  }
}
