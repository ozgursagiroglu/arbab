import { closeSync, constants, lstatSync, mkdirSync, openSync, rmSync, unlinkSync } from "node:fs";
import type { Stats } from "node:fs";
import { join } from "node:path";
import { ArbabError } from "../util/errors";

// A worker's own config home and package-manager files, inside its worktree: the fence denies ~/.config and ~/.npmrc,
// and tools that read them (package managers, git) fail or hang without a writable stand-in (DESIGN.md §21).
// The shepherd runs unsandboxed and the worker owns .arbab-tmp/: anything there may be a link a worker planted, so
// the shepherd never writes through one.

export const WORKER_TMP_DIR = ".arbab-tmp";

export interface WorkerTmpPaths {
  root: string;
  xdgConfig: string;
  yarnCache: string;
  npmrc: string;
  inputs: string;
}

/** Absolute paths under <worktree>/.arbab-tmp: xdg-config, yarn-cache, npmrc, inputs. */
export function workerTmpPaths(worktree: string): WorkerTmpPaths {
  const root = join(worktree, WORKER_TMP_DIR);
  return {
    root,
    xdgConfig: join(root, "xdg-config"),
    yarnCache: join(root, "yarn-cache"),
    npmrc: join(root, "npmrc"),
    inputs: join(root, "inputs"),
  };
}

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new ArbabError("io", `cannot read ${path}: ${(err as Error).message}`, { cause: err });
  }
}

/** Removes what is at `path` without following it: a link or a file is unlinked, a directory removed whole. */
function removeEntry(path: string, stat: Stats): void {
  try {
    // A recursive remove unlinks the links it meets; it never follows them.
    if (stat.isDirectory()) rmSync(path, { recursive: true, force: true });
    else unlinkSync(path);
  } catch (err) {
    throw new ArbabError("io", `cannot remove ${path}: ${(err as Error).message}`, { cause: err });
  }
}

/**
 * Makes `<worktree>/<rel>` a real directory, walking from the worktree one component at a time with lstat: a
 * symbolic link or a non-directory found on the way is removed (the link itself, never what it points to) and
 * replaced by a new directory. Returns the absolute path.
 */
export function realDir(worktree: string, rel: string): string {
  let at = worktree;
  for (const part of rel.split(/[\\/]+/)) {
    if (part === "" || part === ".") continue;
    if (part === "..") throw new ArbabError("usage", `${rel} leaves the worktree`);
    at = join(at, part);
    const stat = lstatOrNull(at);
    if (stat?.isDirectory() === true) continue;
    if (stat !== null) removeEntry(at, stat);
    try {
      mkdirSync(at);
    } catch (err) {
      throw new ArbabError("io", `cannot create ${at}: ${(err as Error).message}`, { cause: err });
    }
  }
  return at;
}

/** Creates the directories and an empty npmrc file when missing, each a real one; returns the paths. */
export function ensureWorkerTmp(worktree: string): WorkerTmpPaths {
  const paths = workerTmpPaths(worktree);
  for (const dir of ["xdg-config", "yarn-cache", "inputs"]) realDir(worktree, join(WORKER_TMP_DIR, dir));
  // A regular file is never overwritten: a worker may have written registry settings it needs into it.
  const stat = lstatOrNull(paths.npmrc);
  if (stat?.isFile() === true) return paths;
  if (stat !== null) removeEntry(paths.npmrc, stat);
  let fd: number;
  try {
    fd = openSync(paths.npmrc, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  } catch (err) {
    throw new ArbabError("io", `cannot create ${paths.npmrc}: ${(err as Error).message}`, { cause: err });
  }
  closeSync(fd);
  return paths;
}
