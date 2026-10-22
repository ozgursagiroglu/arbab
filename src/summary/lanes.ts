// The Lanes and Needs attention sections of `arbab summary`: counts by state, one line per lane not finished, and
// the lanes whose latest run needs the orchestrator.
import { existsSync } from "node:fs";
import { effectiveState, listLanes, readAttempt, readShepherdRecord, readState, runPaths, statusRow } from "../registry";
import type { AttemptSummary, EndState, LaneState } from "../types";
import { adviceFor, needsAttention } from "./advice";

/** States counted on their own; finished lanes are counted by end state. */
export const COUNTED_STATES = ["running", "held", "preparing", "waiting-reset", "queued", "orphaned"] as const;
export type CountedState = (typeof COUNTED_STATES)[number];

export interface LaneCounts {
  byState: Record<CountedState, number>;
  /** End state (or "unknown" when neither state.json nor summary.json names one) → count. */
  finished: Record<string, number>;
}

export interface LaneLine {
  lane: string;
  state: LaneState;
  attempt: number;
  elapsedMs: number | null;
  /** The first 8 characters of the owning session id, or null. */
  owner: string | null;
  reason: string | null;
}

export interface AttentionItem {
  lane: string;
  /** The latest run's end state, or "orphaned". */
  state: EndState | "orphaned";
  attempt: number;
  reason: string | null;
  todo: string;
}

export interface LaneOverview {
  total: number;
  counts: LaneCounts;
  /** Lanes not finished (orphaned included), by name. */
  active: LaneLine[];
  attention: AttentionItem[];
  /** Lanes whose records could not be read, with why. */
  errors: string[];
}

export const OWNER_CHARS = 8;

const emptyCounts = (): LaneCounts => ({
  byState: { running: 0, held: 0, preparing: 0, "waiting-reset": 0, queued: 0, orphaned: 0 },
  finished: {},
});

function attemptSummary(runsRoot: string, lane: string, attempt: number): AttemptSummary | null {
  if (attempt < 1) return null;
  const dir = runPaths(runsRoot, lane).attemptDir(attempt);
  return existsSync(dir) ? readAttempt(dir).summary : null;
}

/** Every lane under the runs root; a lane whose shepherd has not written a state yet is not counted. */
export function laneOverview(runsRoot: string, alive: (pid: number) => boolean, nowMs: number): LaneOverview {
  const out: LaneOverview = { total: 0, counts: emptyCounts(), active: [], attention: [], errors: [] };
  for (const lane of listLanes(runsRoot)) {
    try {
      const record = readState(runsRoot, lane);
      if (record === null) continue;
      const state = effectiveState(record, alive);
      const summary = attemptSummary(runsRoot, lane, record.attempt);
      const reason = record.reason ?? null;
      out.total++;
      if (state === "finished") {
        const end = record.endState ?? summary?.state ?? null;
        const key = end ?? "unknown";
        out.counts.finished[key] = (out.counts.finished[key] ?? 0) + 1;
        if (needsAttention(end)) {
          const endState = end as EndState;
          out.attention.push({ lane, state: endState, attempt: record.attempt, reason, todo: adviceFor(endState) });
        }
        continue;
      }
      out.counts.byState[state]++;
      const owner = readShepherdRecord(runsRoot, lane)?.owner ?? null;
      out.active.push({
        lane,
        state,
        attempt: record.attempt,
        elapsedMs: statusRow({ ...record, state }, summary, nowMs).elapsedMs,
        owner: owner === null ? null : owner.slice(0, OWNER_CHARS),
        reason,
      });
      if (state === "orphaned") {
        out.attention.push({ lane, state: "orphaned", attempt: record.attempt, reason, todo: adviceFor("orphaned") });
      }
    } catch (err) {
      out.errors.push(`lane ${lane}: ${(err as Error).message}`);
    }
  }
  return out;
}
