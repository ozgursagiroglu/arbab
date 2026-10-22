import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EndState, LaneEvent, LaneState } from "../types";
import { ArbabError } from "../util/errors";
import { runPaths } from "./paths";
import { LANE_STATES } from "./state";

/** The state-change log of a lane's runs, beside state.json (DESIGN.md §21). */
export const EVENTS_FILE = "events.jsonl";

function eventsFile(runsRoot: string, lane: string): string {
  return join(runPaths(runsRoot, lane).laneDir, EVENTS_FILE);
}

/** Appends one JSON line to <runs>/<lane>/events.jsonl; never throws (a lost event is not fatal). */
export function appendLaneEvent(runsRoot: string, lane: string, event: LaneEvent): void {
  try {
    const file = eventsFile(runsRoot, lane);
    mkdirSync(join(file, ".."), { recursive: true });
    // One write of one line under PIPE_BUF: concurrent appenders do not interleave within it.
    appendFileSync(file, `${JSON.stringify(event)}\n`);
  } catch {
    // The log is for people reading history; the run goes on without it.
  }
}

/** Every parsable event, in file order; [] when the file is missing. */
export function readLaneEvents(runsRoot: string, lane: string): LaneEvent[] {
  const file = eventsFile(runsRoot, lane);
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new ArbabError("io", `cannot read ${file}: ${(err as Error).message}`, { cause: err });
  }
  const out: LaneEvent[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    let v: unknown;
    try {
      v = JSON.parse(line) as unknown;
    } catch {
      // A torn last line of a killed shepherd.
      continue;
    }
    const event = asEvent(v);
    if (event !== null) out.push(event);
  }
  return out;
}

function asEvent(v: unknown): LaneEvent | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.at !== "string" || !Number.isSafeInteger(o.shepherdPid) || !Number.isSafeInteger(o.attempt)) return null;
  if (typeof o.state !== "string" || !(LANE_STATES as readonly string[]).includes(o.state)) return null;
  const event: LaneEvent = { at: o.at, shepherdPid: o.shepherdPid as number, state: o.state as LaneState, attempt: o.attempt as number };
  // Optional fields of the wrong type are dropped, not fatal: the log is written by other versions too.
  if (typeof o.reason === "string") event.reason = o.reason;
  if (typeof o.until === "number" && Number.isFinite(o.until)) event.until = o.until;
  if (typeof o.endState === "string" && o.endState !== "") event.endState = o.endState as EndState;
  return event;
}
