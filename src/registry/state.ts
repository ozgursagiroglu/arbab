import type { LaneState, LaneStateRecord } from "../types";
import { ArbabError } from "../util/errors";
import { readJson, writeJsonAtomic } from "../util/fs";
import { isValidName } from "../util/names";
import { runPaths } from "./paths";

export const LANE_STATES: readonly LaneState[] = [
  "queued",
  "held",
  "preparing",
  "running",
  "waiting-reset",
  "finished",
  "orphaned",
];

function isRecord(value: unknown): value is LaneStateRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    isValidName(v["lane"]) &&
    typeof v["state"] === "string" &&
    (LANE_STATES as readonly string[]).includes(v["state"]) &&
    Number.isSafeInteger(v["attempt"]) &&
    typeof v["since"] === "string" &&
    Number.isSafeInteger(v["shepherdPid"])
  );
}

export function writeState(runsRoot: string, record: LaneStateRecord): void {
  if (!isRecord(record)) throw new ArbabError("usage", "invalid lane state record");
  writeJsonAtomic(runPaths(runsRoot, record.lane).stateFile, record);
}

/** The lane's state record, or null when the shepherd has not written one yet. */
export function readState(runsRoot: string, lane: string): LaneStateRecord | null {
  const path = runPaths(runsRoot, lane).stateFile;
  const value = readJson<unknown>(path);
  if (value === null) return null;
  if (!isRecord(value) || value.lane !== lane) throw new ArbabError("io", `${path} is not a valid state record`);
  return value;
}

/** A shepherd that died before writing `finished` leaves its lane orphaned (DESIGN.md §2). */
export function effectiveState(record: LaneStateRecord, alive: (pid: number) => boolean): LaneState {
  if (record.state === "finished" || record.state === "orphaned") return record.state;
  return alive(record.shepherdPid) ? record.state : "orphaned";
}
