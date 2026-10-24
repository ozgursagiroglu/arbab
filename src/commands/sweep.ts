// arbab __sweep <root> (internal; started detached by launch and resume through maybeStartSweep)
//
// Removes what `cleanup --worktrees --older-than <worktrees.idleDays>` removes (sweepIdleWorktrees): the clean
// worktrees of finished lanes merged into the base or landed by record (at any age), of finished lanes and unlanded
// integrations unused for idleDays days, and of landed integrations. Branches stay, except generated lanes' and landed
// integrations' once merged. It keeps what cleanup keeps: a worktree whose writer lock a live process holds (integrate
// and host-check hold the integration's), a lane whose branch changed dependency manifests since its trusted install
// point (it could not be rebuilt), and a generated lane its verify or review has not collected yet unless idle. One
// sweep per project at a time (.arbab/sweep.lock, reclaimed when its pid is dead), and one start per hour
// (.arbab/sweep.json's startedAt). Writes sweep.json (SweepRecord) when it starts and again when it finishes; prints
// one line per action to its log (.arbab/sweep.log, moved to sweep.log.1 at the start once over 1 MiB). Exit 0, also
// when another sweep holds the lock; 1 on bad arguments.
import { realpathSync, rmSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { releaseIfStale, type Holder } from "../run";
import { SWEEP_FILE, SWEEP_LOCK_FILE, type SweepRecord } from "../types";
import { ArbabError } from "../util/errors";
import { createExclusive, readJson, readText, writeJsonAtomic } from "../util/fs";
import { isoAt } from "../util/proc";
import { formatWorktreeCleanup, sweepIdleWorktrees, UNPARSED_GRACE_MS } from "./cleanup";
import type { CommandContext } from "./context";
import { openProject, type Project } from "./project";

/** A sweep starts at most this often per project. */
export const SWEEP_INTERVAL_MS = 3_600_000;
/** The `lane` of the sweep lock's Holder. */
const SWEEP_HOLDER = "sweep";

function parseHolder(text: string): Holder | null {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null) return null;
    const pid = (value as Record<string, unknown>)["pid"];
    return Number.isInteger(pid) && (pid as number) > 0 ? (value as Holder) : null;
  } catch {
    return null;
  }
}

/** Whether the lock file is older than the grace an unparsed entry gets for its creator to finish writing it. */
function unparsedIsStale(ctx: CommandContext, path: string): boolean {
  try {
    return ctx.clock.now() - statSync(path).mtimeMs > UNPARSED_GRACE_MS;
  } catch {
    return false;
  }
}

/** Whether a live process holds the sweep lock; an unparsable one counts as held while its creator may be writing it. */
function lockHeld(ctx: CommandContext, path: string): boolean {
  const text = readText(path);
  if (text === null) return false;
  const holder = parseHolder(text);
  return holder === null ? !unparsedIsStale(ctx, path) : ctx.alive(holder.pid);
}

/** When the last sweep started, from sweep.json; null when there is none or it does not read. */
function lastStartedMs(root: string): number | null {
  try {
    const raw = readJson<unknown>(join(root, SWEEP_FILE));
    const startedAt = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>)["startedAt"] : undefined;
    const ms = typeof startedAt === "string" ? Date.parse(startedAt) : NaN;
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

/**
 * Starts a background sweep of the project's idle worktrees when worktrees.idleDays is above 0, the last one started
 * at least SWEEP_INTERVAL_MS ago (or never, or in the future), and no live process holds the sweep lock. Returns
 * whether it started one. Never throws: a sweep is housekeeping, and a launch must not fail for it.
 */
export function maybeStartSweep(ctx: CommandContext, project: Project): boolean {
  try {
    if (!(project.config.worktrees.idleDays > 0)) return false;
    const last = lastStartedMs(project.root);
    const age = last === null ? null : ctx.clock.now() - last;
    if (age !== null && age >= 0 && age < SWEEP_INTERVAL_MS) return false;
    if (lockHeld(ctx, join(project.root, SWEEP_LOCK_FILE))) return false;
    ctx.spawnSweep(project.root);
    return true;
  } catch {
    return false;
  }
}

/** Takes the sweep lock for this process; returns its release, or null when a live sweep holds it. */
function takeSweepLock(ctx: CommandContext, project: Project): (() => void) | null {
  const path = join(project.root, SWEEP_LOCK_FILE);
  const holder: Holder = { pid: ctx.pid, lane: SWEEP_HOLDER, project: project.root, createdAt: isoAt(ctx.clock) };
  const data = JSON.stringify(holder);
  if (!createExclusive(path, data) && !(releaseIfStale(path, ctx.alive, unparsedIsStale(ctx, path)) && createExclusive(path, data))) return null;
  return () => {
    try {
      if (readText(path) === data) rmSync(path, { force: true });
    } catch {
      // Already gone.
    }
  };
}

/**
 * Sweeps the project once under the sweep lock: sweep.json first with `finishedAt: null`, so a sweep that dies still
 * throttles the next, then the finished record. A sweep that fails records why among its warnings.
 */
export function sweepProject(ctx: CommandContext, project: Project): { record: SweepRecord; lines: string[] } | null {
  const release = takeSweepLock(ctx, project);
  if (release === null) return null;
  try {
    const path = join(project.root, SWEEP_FILE);
    const idleDays = project.config.worktrees.idleDays;
    const record: SweepRecord = { startedAt: isoAt(ctx.clock), finishedAt: null, idleDays, removed: [], kept: 0, warnings: [] };
    writeJsonAtomic(path, record);
    let lines: string[] = [];
    if (idleDays > 0) {
      try {
        const result = sweepIdleWorktrees(ctx, project, idleDays);
        record.removed = result.worktreeRemovals;
        record.kept = result.worktreesKept.length;
        record.warnings = result.warnings;
        lines = formatWorktreeCleanup(result, result.worktreeRemovals);
      } catch (err) {
        record.warnings.push((err as Error).message);
        lines = [`warning ${(err as Error).message}`];
      }
    }
    record.finishedAt = isoAt(ctx.clock);
    writeJsonAtomic(path, record);
    return { record, lines };
  } finally {
    release();
  }
}

export async function runSweepProcess(argv: string[], ctx: CommandContext): Promise<number> {
  const [root, ...rest] = argv;
  if (root === undefined || rest.length > 0) throw new ArbabError("usage", "usage: arbab __sweep <root>");
  if (!isAbsolute(root)) throw new ArbabError("usage", `project root ${root} must be absolute`);
  // openProject refuses a lane worktree; a root whose config lies further up is not the project asked for.
  const project = openProject({ cwd: root, git: ctx.git });
  if (realpathSync(project.root) !== realpathSync(root)) throw new ArbabError("usage", `${root} is not a project root (its project is ${project.root})`);
  const swept = sweepProject(ctx, project);
  if (swept === null) {
    ctx.stdout(`${isoAt(ctx.clock)} another sweep of ${project.root} is running\n`);
    return 0;
  }
  const { record, lines } = swept;
  const header = record.idleDays > 0 ? `unused for ${record.idleDays}+ days` : "automatic sweep off";
  ctx.stdout([`${record.startedAt} sweep of ${project.root} (${header})`, ...(lines.length === 0 ? ["nothing to remove"] : lines)].join("\n") + "\n");
  return 0;
}
