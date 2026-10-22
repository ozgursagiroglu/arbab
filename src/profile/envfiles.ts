import { readdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, posix, relative, sep } from "node:path";
import type { GitRunner } from "../run";
import { confine } from "../util/fs";

/**
 * Absolute paths, in the worktree, of the listed files git tracks there (`git ls-files --error-unmatch --
 * :(literal)<path>` exits 0) and that are regular files, not links. Listed files that are untracked, missing,
 * links or directories are left out.
 */
export function envFileAllowReads(input: { worktree: string; readable: string[]; git: GitRunner }): string[] {
  let real: string;
  try {
    real = realpathSync(input.worktree);
  } catch {
    return [];
  }
  const out = new Set<string>();
  for (const listed of input.readable) {
    let path: string;
    try {
      path = confine(input.worktree, normalRel(listed));
    } catch {
      continue;
    }
    const rel = relative(input.worktree, path).split(sep).join("/");
    if (rel === "") continue;
    if (isRegularFile(input.worktree, real, path) && isTracked(input.git, input.worktree, rel)) out.add(path);
  }
  return [...out].sort();
}

function normalRel(path: string): string {
  return posix.normalize(path.split("\\").join("/"));
}

function isTracked(git: GitRunner, root: string, rel: string): boolean {
  // Literal, so a listed name with glob characters matches only itself.
  return git(["ls-files", "--error-unmatch", "--", `:(literal)${rel}`], root).code === 0;
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
