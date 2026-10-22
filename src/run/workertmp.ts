import { join } from "node:path";
import { createExclusive, ensureDir } from "../util/fs";

// A worker's own config home and package-manager files, inside its worktree: the fence denies ~/.config and ~/.npmrc,
// and tools that read them (package managers, git) fail or hang without a writable stand-in (DESIGN.md §21).

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

/** Creates the directories and an empty npmrc file when missing; returns the paths. */
export function ensureWorkerTmp(worktree: string): WorkerTmpPaths {
  const paths = workerTmpPaths(worktree);
  for (const dir of [paths.xdgConfig, paths.yarnCache, paths.inputs]) ensureDir(dir);
  // Never overwritten: a worker may have written registry settings it needs into it.
  createExclusive(paths.npmrc, "");
  return paths;
}
