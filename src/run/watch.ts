import { closeSync, openSync, readSync, statSync } from "node:fs";
import type { KillReason } from "../types";
import { ArbabError } from "../util/errors";
import type { Clock } from "../util/proc";

/** Current size of a file; 0 while it does not exist yet. */
export function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw new ArbabError("io", `cannot stat ${path}: ${(err as Error).message}`, { cause: err });
  }
}

/** Bytes [start, end) of a file. */
export function fileRange(path: string, start: number, end: number): Buffer {
  const buf = Buffer.alloc(Math.max(0, end - start));
  if (buf.length === 0) return buf;
  const fd = openSync(path, "r");
  try {
    let done = 0;
    while (done < buf.length) {
      const n = readSync(fd, buf, done, buf.length - done, start + done);
      if (n === 0) break;
      done += n;
    }
    return buf.subarray(0, done);
  } finally {
    closeSync(fd);
  }
}

export interface WatcherInput {
  streamPath: string;
  startedAtMs: number;
  wallMs: number;
  idleMs: number;
  hangAfterResultMs?: number;
  hangAfterErrorMs?: number;
  clock: Clock;
  readSize?: (path: string) => number;
  readRange?: (path: string, start: number, end: number) => Buffer;
}

export interface WatcherState {
  offset: number;
  lastGrowthMs: number;
  resultSeen: boolean;
  lastResultIsError: boolean;
}

export interface WatcherTick {
  /** The kill rule that applies now, if any. */
  kill: KillReason | null;
  /** The last `rate_limit_event` among the lines this tick read, as parsed JSON; the caller interprets it. */
  rateLimitEvent: Record<string, unknown> | null;
}

export interface Watcher {
  /** Reads what was appended since the last tick and evaluates the kill rules. */
  tick(): WatcherTick;
  state(): WatcherState;
}

const NEWLINE = 0x0a;

/**
 * Level-triggered: every tick re-evaluates the rules from the current state, so a finish or a hang is never missed
 * because an event was.
 */
export function createWatcher(input: WatcherInput): Watcher {
  const hangAfterResultMs = input.hangAfterResultMs ?? 15 * 60_000;
  const hangAfterErrorMs = input.hangAfterErrorMs ?? 2 * 60_000;
  const readSize = input.readSize ?? fileSize;
  const readRange = input.readRange ?? fileRange;
  let offset = 0;
  let carry = Buffer.alloc(0);
  let lastGrowthMs = input.startedAtMs;
  let resultSeen = false;
  let lastResultIsError = false;
  let rateLimitEvent: Record<string, unknown> | null = null;

  const consume = (line: Buffer): void => {
    let event: unknown;
    try {
      event = JSON.parse(line.toString("utf8"));
    } catch {
      return;
    }
    if (typeof event !== "object" || event === null || Array.isArray(event)) return;
    const e = event as Record<string, unknown>;
    if (e.type === "rate_limit_event") rateLimitEvent = e;
    if (e.type !== "result") return;
    resultSeen = true;
    lastResultIsError = e.is_error === true;
  };

  const read = (now: number): void => {
    const size = readSize(input.streamPath);
    if (size < offset) {
      // The file shrank (replaced); start over rather than read garbage.
      offset = 0;
      carry = Buffer.alloc(0);
    }
    if (size <= offset) return;
    const chunk = readRange(input.streamPath, offset, size);
    if (chunk.length === 0) return;
    offset += chunk.length;
    lastGrowthMs = now;
    let data = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
    let nl = data.indexOf(NEWLINE);
    while (nl !== -1) {
      consume(data.subarray(0, nl));
      data = data.subarray(nl + 1);
      nl = data.indexOf(NEWLINE);
    }
    carry = Buffer.from(data);
  };

  return {
    tick(): WatcherTick {
      const now = input.clock.now();
      rateLimitEvent = null;
      read(now);
      const quiet = now - lastGrowthMs;
      let kill: KillReason | null = null;
      if (now - input.startedAtMs > input.wallMs) kill = "wall";
      else if (resultSeen && lastResultIsError && quiet > hangAfterErrorMs) kill = "hang-after-error";
      else if (resultSeen && quiet > hangAfterResultMs) kill = "hang-after-result";
      else if (quiet > input.idleMs) kill = "idle";
      return { kill, rateLimitEvent };
    },
    state: () => ({ offset, lastGrowthMs, resultSeen, lastResultIsError }),
  };
}
