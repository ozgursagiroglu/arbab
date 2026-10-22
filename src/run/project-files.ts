import { join, relative, resolve, sep } from "node:path";
import type { ProjectConfig } from "../types";
import { createExclusive, confine } from "../util/fs";
import { WORKER_TMP_DIR } from "./workertmp";

/** arbab's own directory in a project: records, worktrees and runs by default. */
export const ARBAB_DIR = ".arbab";

/** The ESLint 8 root marker: its config cascade stops at .arbab/ instead of reaching the main checkout's config. */
export const ESLINT_MARKER = ".eslintrc.json";

/** ".arbab/", ".arbab-tmp/", and worktreeRoot/runsRoot (with a trailing slash) when they are outside .arbab/. */
export function arbabIgnoreEntries(projectRoot: string, config: Pick<ProjectConfig, "worktreeRoot" | "runsRoot">): string[] {
  const rel = (p: string): string => `${relative(resolve(projectRoot), confine(projectRoot, p)).split(sep).join("/")}/`;
  const own = `${ARBAB_DIR}/`;
  const outside = [rel(config.worktreeRoot), rel(config.runsRoot)].filter((r) => !r.startsWith(own));
  return [...new Set([own, `${WORKER_TMP_DIR}/`, ...outside])];
}

/** Writes <root>/.arbab/.eslintrc.json as {"root": true} when it is missing; never overwrites. */
export function ensureArbabMarkers(projectRoot: string): void {
  createExclusive(join(projectRoot, ARBAB_DIR, ESLINT_MARKER), `${JSON.stringify({ root: true }, null, 2)}\n`);
}
