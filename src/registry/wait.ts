import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AttemptSummary, EndState, LaneState, LaneStateRecord } from "../types";
import { ArbabError } from "../util/errors";
import { createExclusive, readJson, writeJsonAtomic } from "../util/fs";
import { assertValidName } from "../util/names";
import type { Clock } from "../util/proc";
import { attemptFiles, listLanes, readAttempt, runPaths } from "./paths";
import { effectiveState, readState } from "./state";

/** One shepherd run of a lane, as its state.json names it. A relaunch is a new run: a new shepherd pid and since. */
export interface LaneRun {
  shepherdPid: number;
  since: string;
}

export interface FinishedItem {
  lane: string;
  /** The last attempt this run made; null when it finished before its first attempt (a setup failure). */
  attempt: number | null;
  state: LaneState;
  /** The lane's end state from state.json; null for an orphaned lane. */
  endState: EndState | null;
  /** Why the run ended, from state.json (a setup failure says what failed). */
  reason: string | null;
  /** The summary of `attempt`, when it has one. */
  summary: AttemptSummary | null;
  /** The state.json this item was read from; acking records it. */
  run: LaneRun;
}

export interface WaitOptions {
  runsRoot: string;
  /** Lanes to wait for; null means every lane under runsRoot. */
  lanes: string[] | null;
  mode: "any" | "all";
  /** Infinity waits for ever. */
  timeoutMs: number;
  pollMs: number;
  clock: Clock;
  sleep: (ms: number) => Promise<void>;
  alive: (pid: number) => boolean;
}

export interface WaitResult {
  finished: FinishedItem[];
  timedOut: boolean;
}

type Alive = (pid: number) => boolean;

const isDone = (state: LaneState): boolean => state === "finished" || state === "orphaned";

function doneRecord(runsRoot: string, lane: string, alive: Alive): { record: LaneStateRecord; state: LaneState } | null {
  const record = readState(runsRoot, lane);
  if (!record) return null;
  const state = effectiveState(record, alive);
  return isDone(state) ? { record, state } : null;
}

/** <laneDir>/acked.json: the run `arbab wait` last told the orchestrator about. */
export function ackedFile(runsRoot: string, lane: string): string {
  return join(runPaths(runsRoot, lane).laneDir, "acked.json");
}

/** One marker per acked run; creating it exclusively is what makes two waiters never claim the same run. */
function runMarker(runsRoot: string, lane: string, run: LaneRun): string {
  const since = createHash("sha256").update(run.since).digest("hex").slice(0, 16);
  return join(runPaths(runsRoot, lane).laneDir, "acks", `${run.shepherdPid}-${since}`);
}

const sameRun = (a: unknown, b: LaneRun): boolean =>
  typeof a === "object" &&
  a !== null &&
  (a as Record<string, unknown>)["shepherdPid"] === b.shepherdPid &&
  (a as Record<string, unknown>)["since"] === b.since;

/** Whether this run of the lane has been acked. */
export function isAcked(runsRoot: string, lane: string, run: LaneRun): boolean {
  let recorded: unknown = null;
  try {
    recorded = readJson<unknown>(ackedFile(runsRoot, lane));
  } catch {
    // A damaged acked.json is rewritten by the next ack; the marker still answers.
  }
  return sameRun(recorded, run) || existsSync(runMarker(runsRoot, lane, run));
}

/**
 * Marks a lane run as told and records it in acked.json. False when it was already acked (another waiter got there
 * first). An attempt, when given, also gets its `acked` file.
 */
export function ackRun(runsRoot: string, lane: string, run: LaneRun, attempt: number | null = null): boolean {
  if (!Number.isSafeInteger(run.shepherdPid) || typeof run.since !== "string") throw new ArbabError("usage", "invalid lane run");
  if (!createExclusive(runMarker(runsRoot, lane, run), `${JSON.stringify(run)}\n`)) return false;
  writeJsonAtomic(ackedFile(runsRoot, lane), { shepherdPid: run.shepherdPid, since: run.since, attempt });
  if (attempt !== null) {
    const dir = runPaths(runsRoot, lane).attemptDir(attempt);
    if (existsSync(dir)) createExclusive(attemptFiles(dir).acked, `${attempt}\n`);
  }
  return true;
}

/**
 * Finished or orphaned lanes whose current run (state.json) has not been acked. Level-triggered: a lane that finished
 * long before this call is still reported until someone acks it, including a run that failed before its first
 * attempt.
 */
export function pendingFinished(runsRoot: string, lanes: string[] | null, alive: Alive): FinishedItem[] {
  const out: FinishedItem[] = [];
  for (const lane of lanes ?? listLanes(runsRoot)) {
    const done = doneRecord(runsRoot, lane, alive);
    if (!done) continue;
    const { record, state } = done;
    const run: LaneRun = { shepherdPid: record.shepherdPid, since: record.since };
    if (isAcked(runsRoot, lane, run)) continue;
    const dir = record.attempt >= 1 ? runPaths(runsRoot, lane).attemptDir(record.attempt) : null;
    const attempt = dir !== null && existsSync(dir) ? record.attempt : null;
    const summary = attempt === null || dir === null ? null : readAttempt(dir).summary;
    const finished = record.state === "finished";
    out.push({
      lane,
      attempt,
      state,
      endState: finished ? (record.endState ?? null) : null,
      reason: finished ? (record.reason ?? null) : null,
      summary,
      run,
    });
  }
  return out;
}

/**
 * Acks the lane's current run when it is done and its attempt is `attempt`, and marks the attempt itself. False
 * when neither was new (another waiter got there first). Kept for callers that know an attempt (preflight).
 */
export function ack(runsRoot: string, lane: string, attempt: number): boolean {
  const dir = runPaths(runsRoot, lane).attemptDir(attempt);
  if (!existsSync(dir)) throw new ArbabError("usage", `lane ${lane} has no attempt ${attempt}`);
  const marked = createExclusive(attemptFiles(dir).acked, `${attempt}\n`);
  const record = readState(runsRoot, lane);
  const run =
    record !== null && record.attempt === attempt
      ? ackRun(runsRoot, lane, { shepherdPid: record.shepherdPid, since: record.since }, attempt)
      : false;
  return marked || run;
}

/** Acks the items and keeps only those this caller acked, so two waiters never report the same finish. */
function claim(runsRoot: string, items: FinishedItem[]): FinishedItem[] {
  return items.filter((item) => ackRun(runsRoot, item.lane, item.run, item.attempt));
}

/**
 * Polls until lanes finish. `any` returns as soon as something unacked is finished; `all` returns once every lane
 * is finished or orphaned. Returned items are acked. On timeout nothing is acked and `finished` is empty.
 */
export async function waitForFinished(options: WaitOptions): Promise<WaitResult> {
  const { runsRoot, lanes, mode, timeoutMs, pollMs, clock, sleep, alive } = options;
  if (lanes) {
    for (const lane of lanes) {
      assertValidName(lane, "lane");
      if (!existsSync(runPaths(runsRoot, lane).laneDir)) throw new ArbabError("usage", `no runs for lane ${lane}`);
    }
  }
  const start = clock.now();
  for (;;) {
    if (mode === "any") {
      const claimed = claim(runsRoot, pendingFinished(runsRoot, lanes, alive));
      if (claimed.length > 0) return { finished: claimed, timedOut: false };
    } else {
      const names = lanes ?? listLanes(runsRoot);
      if (names.every((lane) => doneRecord(runsRoot, lane, alive) !== null)) {
        return { finished: claim(runsRoot, pendingFinished(runsRoot, names, alive)), timedOut: false };
      }
    }
    const remaining = timeoutMs - (clock.now() - start);
    if (remaining <= 0) return { finished: [], timedOut: true };
    await sleep(Math.min(pollMs, remaining));
  }
}
