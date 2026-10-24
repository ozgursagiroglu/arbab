// How many worktrees a project holds and how many sit unused, from records and directory listings only: no git, so
// summary and doctor stay cheap on a project with hundreds of them.
import { existsSync, readdirSync, statSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { INTEGRATION_WORKTREE_PREFIX } from "../config/lane";
import { effectiveState, readState } from "../registry";
import { INTEGRATIONS_DIR, SWEEP_FILE, type ProjectConfig } from "../types";
import { readJson } from "../util/fs";
import { isValidName } from "../util/names";

const DAY_MS = 86_400_000;

export interface WorktreeOverview {
  /** Directories in worktreeRoot. */
  total: number;
  /** Finished lanes' worktrees and unlanded integrations' unused for more than idleDays. */
  idle: number;
  /** config worktrees.idleDays; 0 = the automatic sweep is off. */
  idleDays: number;
  lastSweep: { startedAt: string; finishedAt: string | null; removed: number } | null;
}

/** `3 unused for 3+ days`, or `automatic sweep off` when idleDays is 0; summary and doctor say it alike. */
export const unusedText = (idle: number, idleDays: number): string => (idleDays === 0 ? "automatic sweep off" : `${idle} unused for ${idleDays}+ days`);

export interface WorktreeOverviewInput {
  project: { root: string; config: Pick<ProjectConfig, "worktrees">; runsRoot: string; worktreeRoot: string };
  alive: (pid: number) => boolean;
  nowMs: number;
}

function dirs(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return [];
  }
}

/**
 * When an integration was last used: the newest mtime of the files directly in its records directory (every command
 * that works on it writes one there). Null when it holds none.
 */
export function recordsIdleSince(recordsDir: string): number | null {
  let entries: Dirent[];
  try {
    entries = readdirSync(recordsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  let newest: number | null = null;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    try {
      const mtime = statSync(join(recordsDir, entry.name)).mtimeMs;
      if (newest === null || mtime > newest) newest = mtime;
    } catch {
      // Gone since the listing.
    }
  }
  return newest;
}

/** The integration a worktree directory belongs to (`integrate-<name>`), else null. */
export function integrationOfWorktree(dirName: string): string | null {
  if (!dirName.startsWith(INTEGRATION_WORKTREE_PREFIX)) return null;
  const name = dirName.slice(INTEGRATION_WORKTREE_PREFIX.length);
  return isValidName(name) ? name : null;
}

/** The latest sweep.json, with what it needs checked; null when there is none or it does not read. */
export function readLastSweep(root: string): WorktreeOverview["lastSweep"] {
  let raw: unknown;
  try {
    raw = readJson<unknown>(join(root, SWEEP_FILE));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const { startedAt, finishedAt, removed } = raw as Record<string, unknown>;
  if (typeof startedAt !== "string" || !(finishedAt === null || typeof finishedAt === "string") || !Array.isArray(removed)) return null;
  return { startedAt, finishedAt, removed: removed.length };
}

function laneIdle(input: WorktreeOverviewInput, lane: string, idleMs: number): boolean {
  try {
    const record = readState(input.project.runsRoot, lane);
    if (record === null || effectiveState(record, input.alive) !== "finished") return false;
    // An unparsable `since` gives NaN, which is never older.
    return input.nowMs - Date.parse(record.since) > idleMs;
  } catch {
    return false;
  }
}

function integrationIdle(input: WorktreeOverviewInput, name: string, idleMs: number): boolean {
  const dir = join(input.project.root, INTEGRATIONS_DIR, name);
  if (existsSync(join(dir, "landing.json"))) return false;
  const since = recordsIdleSince(dir);
  return since !== null && input.nowMs - since > idleMs;
}

/**
 * `worktrees: <total> (<idle> unused for <idleDays>+ days)[; last sweep <time>: removed <n>]`; `(automatic sweep off)`
 * when idleDays is 0, and `, unfinished` after a sweep that has not written its result (running, or died).
 */
export function formatWorktrees(w: WorktreeOverview): string {
  const sweep = w.lastSweep;
  const last =
    sweep === null ? "" : `; last sweep ${sweep.startedAt.replace(/\.\d{3}Z$/, "Z")}: removed ${sweep.removed}${sweep.finishedAt === null ? ", unfinished" : ""}`;
  return `worktrees: ${w.total} (${unusedText(w.idle, w.idleDays)})${last}`;
}

export function worktreeOverview(input: WorktreeOverviewInput): WorktreeOverview {
  const { idleDays } = input.project.config.worktrees;
  const idleMs = idleDays * DAY_MS;
  const entries = dirs(input.project.worktreeRoot);
  let idle = 0;
  for (const entry of entries) {
    const integration = integrationOfWorktree(entry.name);
    if (integration !== null ? integrationIdle(input, integration, idleMs) : isValidName(entry.name) && laneIdle(input, entry.name, idleMs)) idle++;
  }
  return { total: entries.length, idle, idleDays, lastSweep: readLastSweep(input.project.root) };
}
