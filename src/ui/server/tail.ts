// Tool calls of a running attempt, counted from its growing stream.jsonl (DESIGN.md §19): a byte offset per lane, so a
// tick reads only what was appended since the last one, never the whole stream.
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { REPORT_TOOL, toolUses } from "../../stream";
import { ArbabError } from "../../util/errors";

export interface LiveCount {
  toolCalls: number;
  lastTool: string | null;
}

export interface ToolCallCounter {
  /** The attempt's tool calls so far; reads only the bytes appended since the last call for this attempt. */
  count(lane: string, attempt: number, streamPath: string): LiveCount;
  /** Forgets every lane not in `lanes` (lanes that left the window). */
  retain(lanes: ReadonlySet<string>): void;
}

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const NEWLINE = 0x0a;

interface Tail {
  attempt: number;
  path: string;
  offset: number;
  /** The unfinished last line, as bytes: decoding it now could cut a multi-byte character. */
  pending: Buffer;
  seen: Set<string>;
  toolCalls: number;
  lastTool: string | null;
}

const fresh = (attempt: number, path: string): Tail => ({
  attempt,
  path,
  offset: 0,
  pending: Buffer.alloc(0),
  seen: new Set(),
  toolCalls: 0,
  lastTool: null,
});

function countLine(tail: Tail, line: string): void {
  if (line.trim() === "") return;
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  for (const { id, name } of toolUses(event)) {
    // The same rules as digestStream: a replayed id is one call, and the report is not work.
    if (id !== null) {
      if (tail.seen.has(id)) continue;
      tail.seen.add(id);
    }
    if (name === REPORT_TOOL) continue;
    tail.toolCalls++;
    tail.lastTool = name;
  }
}

/** Reads up to `max` bytes of `path` from the tail's offset; null when the file does not exist. */
function readMore(tail: Tail, max: number): Buffer | null {
  let fd: number;
  try {
    fd = openSync(tail.path, "r");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new ArbabError("io", `cannot open ${tail.path}: ${(err as Error).message}`, { cause: err });
  }
  try {
    const size = fstatSync(fd).size;
    if (size < tail.offset) {
      // Truncated or replaced: what was counted no longer describes this file.
      Object.assign(tail, fresh(tail.attempt, tail.path));
    }
    const want = Math.min(size - tail.offset, max);
    const chunk = Buffer.allocUnsafe(Math.max(0, want));
    let got = 0;
    while (got < want) {
      const n = readSync(fd, chunk, got, want - got, tail.offset + got);
      if (n === 0) break;
      got += n;
    }
    return chunk.subarray(0, got);
  } catch (err) {
    throw new ArbabError("io", `cannot read ${tail.path}: ${(err as Error).message}`, { cause: err });
  } finally {
    closeSync(fd);
  }
}

export function createToolCallCounter(options: { maxBytesPerCall?: number } = {}): ToolCallCounter {
  const max = options.maxBytesPerCall ?? DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(max) || max < 1) throw new ArbabError("usage", `maxBytesPerCall ${max} must be a positive integer`);
  const tails = new Map<string, Tail>();

  return {
    count(lane, attempt, streamPath) {
      let tail = tails.get(lane);
      if (tail === undefined || tail.attempt !== attempt || tail.path !== streamPath) {
        tail = fresh(attempt, streamPath);
        tails.set(lane, tail);
      }
      const chunk = readMore(tail, max);
      if (chunk === null) {
        tails.set(lane, fresh(attempt, streamPath));
        return { toolCalls: 0, lastTool: null };
      }
      if (chunk.length > 0) {
        tail.offset += chunk.length;
        const bytes = tail.pending.length > 0 ? Buffer.concat([tail.pending, chunk]) : chunk;
        let start = 0;
        for (let end = bytes.indexOf(NEWLINE, start); end !== -1; end = bytes.indexOf(NEWLINE, start)) {
          // A newline byte never occurs inside a UTF-8 sequence, so each complete line decodes on its own.
          countLine(tail, bytes.toString("utf8", start, end));
          start = end + 1;
        }
        // A copy, so the pending line does not pin the whole chunk.
        tail.pending = Buffer.from(bytes.subarray(start));
      }
      return { toolCalls: tail.toolCalls, lastTool: tail.lastTool };
    },
    retain(lanes) {
      for (const lane of tails.keys()) if (!lanes.has(lane)) tails.delete(lane);
    },
  };
}
