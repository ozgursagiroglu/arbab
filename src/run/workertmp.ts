import { join } from "node:path";
import { createExclusive, ensureDir } from "../util/fs";

// A worker's own config, data and cache homes, inside its worktree: the fence denies ~/.config and ~/.npmrc, and tools
// that read them (package managers, git) fail or hang without a writable stand-in (DESIGN.md §21).

export const WORKER_TMP_DIR = ".arbab-tmp";

export interface WorkerTmpPaths {
  root: string;
  xdgConfig: string;
  xdgData: string;
  xdgCache: string;
  yarnCache: string;
  npmrc: string;
  inputs: string;
}

/** Absolute paths under <worktree>/.arbab-tmp: xdg-config, xdg-data, xdg-cache, yarn-cache, npmrc, inputs. */
export function workerTmpPaths(worktree: string): WorkerTmpPaths {
  const root = join(worktree, WORKER_TMP_DIR);
  return {
    root,
    xdgConfig: join(root, "xdg-config"),
    xdgData: join(root, "xdg-data"),
    xdgCache: join(root, "xdg-cache"),
    yarnCache: join(root, "yarn-cache"),
    npmrc: join(root, "npmrc"),
    inputs: join(root, "inputs"),
  };
}

/** Creates the directories and an empty npmrc file when missing; returns the paths. */
export function ensureWorkerTmp(worktree: string): WorkerTmpPaths {
  const paths = workerTmpPaths(worktree);
  for (const dir of [paths.xdgConfig, paths.xdgData, paths.xdgCache, paths.yarnCache, paths.inputs]) ensureDir(dir);
  // Never overwritten: a worker may have written registry settings it needs into it.
  createExclusive(paths.npmrc, "");
  return paths;
}
