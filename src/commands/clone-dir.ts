// arbab clone-dir <src> <dst>
//
// Clones one directory of the main checkout into the current directory (DESIGN.md §23): clonefile on macOS, cp
// otherwise. A host helper for dependency scripts, which call it as `node "$ARBAB_RUNNER" clone-dir <src> <dst>` from
// the worktree being prepared; it runs on the host, on a trusted install point, never inside a worker's sandbox.
// The hook never approves it: a worker writes its worktree, so from anywhere else it would copy worker files to where
// the host runs them. The current directory's real path must lie inside the project's worktree root. `src` is
// resolved against the project root (ARBAB_PROJECT_ROOT, else the project around the current directory) or taken
// absolute; its real path must lie inside the project root and outside `.arbab/`, `.arbab-tmp/` and the worktree root.
// `dst` must not exist and must lie inside the current directory. Prints `cloned <dst> (<how>)`; exit 1 on a refusal
// or a failed clone.
import { lstatSync, realpathSync, rmSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { loadConfig } from "../config";
import { cloneDirectory, missingRoot } from "../run";
import { DEPS_PROJECT_ENV } from "../types";
import { confine } from "../util/fs";
import { sameOrInside } from "../util/pathcase";
import type { CommandContext } from "./context";
import { findProjectRoot, parse } from "./project";

/** Whether `path` lies strictly inside `root`. */
function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function present(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

// Real paths in the spelling on disk (`native`), so a `.ARBAB` spelling compares as what it is.

/** The real path of `path`'s nearest existing ancestor (or of itself), or null when even the root fails. */
function realAncestor(path: string): string | null {
  for (let p = path; ; p = dirname(p)) {
    try {
      return realpathSync.native(p);
    } catch {
      if (dirname(p) === p) return null;
    }
  }
}

function real(path: string): string | null {
  try {
    return realpathSync.native(path);
  } catch {
    return null;
  }
}

/** The project's worktree root, real, from its config; a refusal when the config or the root cannot be read. */
function worktreeRoot(root: string): { path: string } | { refused: string } {
  let configured: string;
  try {
    configured = confine(root, loadConfig(root).worktreeRoot);
  } catch (err) {
    return { refused: `cannot read the project's worktree root: ${err instanceof Error ? err.message : String(err)}` };
  }
  const path = real(configured);
  return path === null ? { refused: `cannot resolve the worktree root ${configured}` } : { path };
}

/**
 * Why `src` (a real path inside the real project root) may not be cloned, or null: arbab's state and every worktree
 * hold what workers wrote, and only the main checkout's own content is trusted.
 */
function untrustedSource(src: string, root: string, worktrees: string): string | null {
  const dirs = [join(root, ".arbab"), join(root, ".arbab-tmp")].flatMap((dir) => [dir, real(dir) ?? dir]);
  for (const dir of [...dirs, worktrees]) {
    if (sameOrInside(dir, src)) return dir;
  }
  return null;
}

/** The main checkout: what arbab gave the dependency command, else the project around the current directory. */
function projectRoot(ctx: CommandContext): { root: string } | { refused: string } {
  const given = ctx.hostEnv[DEPS_PROJECT_ENV];
  if (given !== undefined && given !== "") {
    return isAbsolute(given) ? { root: given } : { refused: `${DEPS_PROJECT_ENV} ${JSON.stringify(given)} is not an absolute path` };
  }
  const found = findProjectRoot(ctx.cwd, ctx.git);
  return found === null ? { refused: `no project at or above ${ctx.cwd}, and ${DEPS_PROJECT_ENV} is not set` } : { root: found };
}

export async function runCloneDir(argv: string[], ctx: CommandContext): Promise<number> {
  const { positionals } = parse("clone-dir", { args: argv, options: {}, allowPositionals: true });
  const refuse = (why: string): number => {
    ctx.stderr(`arbab clone-dir: ${why}\n`);
    return 1;
  };
  const [srcArg, dstArg, ...extra] = positionals;
  if (srcArg === undefined || dstArg === undefined || extra.length > 0 || srcArg === "" || dstArg === "") {
    return refuse("usage: arbab clone-dir <src> <dst>");
  }

  const project = projectRoot(ctx);
  if ("refused" in project) return refuse(project.refused);
  const root = real(project.root);
  if (root === null) return refuse(`cannot resolve the project root ${project.root}`);
  const worktrees = worktreeRoot(project.root);
  if ("refused" in worktrees) return refuse(worktrees.refused);

  const cwd = resolve(ctx.cwd);
  const cwdReal = real(cwd);
  if (cwdReal === null) return refuse(`cannot resolve the current directory ${cwd}`);
  if (!inside(worktrees.path, cwdReal)) {
    return refuse(
      `the current directory ${cwdReal} is not inside the worktree root ${worktrees.path}: clone-dir runs from a dependency script in a new worktree`,
    );
  }

  const src = real(isAbsolute(srcArg) ? srcArg : resolve(project.root, srcArg));
  if (src === null) return refuse(`${srcArg} does not exist`);
  if (!inside(root, src)) {
    return refuse(`${srcArg} leads to ${src}, outside the project root ${root}: only the main checkout's own content may be cloned`);
  }
  const untrusted = untrustedSource(src, root, worktrees.path);
  if (untrusted !== null) {
    return refuse(`${srcArg} leads to ${src}, inside ${untrusted}: only the main checkout's own content may be cloned`);
  }
  if (!statSync(src).isDirectory()) return refuse(`${srcArg} is not a directory`);

  const dst = resolve(cwd, dstArg);
  if (present(dst)) return refuse(`${dstArg} already exists`);
  const at = realAncestor(dirname(dst));
  if (!inside(cwd, dst) || at === null || (at !== cwdReal && !inside(cwdReal, at))) {
    return refuse(`${dstArg} is not inside the current directory ${cwd}`);
  }
  // A source that holds the destination would be cloned into itself.
  if (at === src || inside(src, at)) return refuse(`${dstArg} lies inside ${srcArg}`);

  const made = missingRoot(dst);
  let failure: string;
  try {
    const r = cloneDirectory(src, dst, { platform: ctx.platform, run: ctx.runCommand });
    if (r.ok) {
      ctx.stdout(`cloned ${dstArg} (${r.how})\n`);
      return 0;
    }
    failure = `cloning ${srcArg} failed (${r.how}): ${r.output.trim()}`;
  } catch (err) {
    failure = `cloning ${srcArg} failed: ${err instanceof Error ? err.message : String(err)}`;
  }
  // Half a copy is worse than none: the script's next step may take it for the whole.
  if (made !== null) rmSync(made, { recursive: true, force: true });
  return refuse(failure);
}
