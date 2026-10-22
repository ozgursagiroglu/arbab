import { readdirSync, type Dirent } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import type { GitRunner } from "../run";

const MAX_DEPTH = 6;
const SKIP_DIRS = new Set(["node_modules", ".git", ".arbab", ".arbab-tmp"]);

/**
 * Absolute paths of the env files to deny one by one when `fence.readableEnvFiles` lifts the blanket `**\/.env*` deny:
 * every `.env*` file in the worktree and the main checkout that is not a listed tracked template (DESIGN.md §21).
 * The attempt calls it only when `readable` is non-empty.
 */
export function envFileDenies(input: { projectRoot: string; worktree: string; readable: string[]; git: GitRunner }): string[] {
  const readable = new Set(input.readable.map(normalRel));
  const out = new Set<string>();
  for (const root of [input.worktree, input.projectRoot]) {
    for (const { path, link } of findEnvFiles(root)) {
      const rel = relative(root, path).split(sep).join("/");
      // A link is never lifted: reading it reads its target, which may be a secret outside both trees.
      if (link || !readable.has(rel) || !isTracked(input.git, root, rel)) out.add(path);
    }
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

/** `.env*` entries under `root`, directories at most MAX_DEPTH levels down; links are reported, never followed. */
function findEnvFiles(root: string): Array<{ path: string; link: boolean }> {
  const found: Array<{ path: string; link: boolean }> = [];
  const walk = (dir: string, depth: number): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // A missing tree (no main checkout yet) or an unreadable directory has nothing to list.
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        if (entry.name.startsWith(".env")) found.push({ path, link: true });
      } else if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && depth < MAX_DEPTH) walk(path, depth + 1);
      } else if (entry.name.startsWith(".env")) {
        found.push({ path, link: false });
      }
    }
  };
  walk(root, 0);
  return found;
}
