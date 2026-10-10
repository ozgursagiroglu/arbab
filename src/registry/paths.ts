import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { AttemptExit, AttemptStarted, AttemptSummary } from "../types";
import { ArbabError } from "../util/errors";
import { confine, ensureDir, readJson } from "../util/fs";
import { assertValidName, isValidName } from "../util/names";

export interface RunPaths {
  laneDir: string;
  laneFile: string;
  stateFile: string;
  shepherdFile: string;
  attemptDir(n: number): string;
}

export interface AttemptFiles {
  brief: string;
  settings: string;
  args: string;
  started: string;
  stream: string;
  stderr: string;
  registration: string;
  exit: string;
  summary: string;
  report: string;
  acked: string;
}

export interface AttemptRecord {
  started: AttemptStarted | null;
  exit: AttemptExit | null;
  summary: AttemptSummary | null;
  acked: boolean;
}

const ATTEMPT_DIR = /^attempt-([1-9][0-9]*)$/;

export function runPaths(runsRoot: string, lane: string): RunPaths {
  assertValidName(lane, "lane");
  const laneDir = confine(runsRoot, lane);
  return {
    laneDir,
    laneFile: join(laneDir, "lane.json"),
    stateFile: join(laneDir, "state.json"),
    shepherdFile: join(laneDir, "shepherd.json"),
    attemptDir(n: number): string {
      if (!Number.isSafeInteger(n) || n < 1) throw new ArbabError("usage", `attempt ${n} must be a positive integer`);
      return join(laneDir, `attempt-${n}`);
    },
  };
}

export function attemptFiles(dir: string): AttemptFiles {
  return {
    brief: join(dir, "brief.md"),
    settings: join(dir, "settings.json"),
    args: join(dir, "args.json"),
    started: join(dir, "started.json"),
    stream: join(dir, "stream.jsonl"),
    stderr: join(dir, "stderr.log"),
    registration: join(dir, "registration.json"),
    exit: join(dir, "exit.json"),
    summary: join(dir, "summary.json"),
    report: join(dir, "report.json"),
    acked: join(dir, "acked"),
  };
}

/** Directory entries, or none when the directory does not exist yet. */
function entries(dir: string): Array<{ name: string; isDirectory(): boolean }> {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new ArbabError("io", `cannot list ${dir}: ${(err as Error).message}`, { cause: err });
  }
}

export function listAttempts(runsRoot: string, lane: string): number[] {
  const out: number[] = [];
  for (const entry of entries(runPaths(runsRoot, lane).laneDir)) {
    const match = ATTEMPT_DIR.exec(entry.name);
    if (match?.[1] !== undefined && entry.isDirectory()) out.push(Number(match[1]));
  }
  return out.sort((a, b) => a - b);
}

export function listLanes(runsRoot: string): string[] {
  return entries(runsRoot)
    .filter((entry) => entry.isDirectory() && isValidName(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Takes the next attempt number. The final directory is created without `recursive`, so mkdir itself is the
 * arbiter: a creator that loses the race gets EEXIST and moves on to the next number.
 */
export function createAttempt(runsRoot: string, lane: string): { n: number; dir: string } {
  const paths = runPaths(runsRoot, lane);
  ensureDir(paths.laneDir);
  let n = (listAttempts(runsRoot, lane).at(-1) ?? 0) + 1;
  for (;;) {
    const dir = paths.attemptDir(n);
    try {
      mkdirSync(dir);
      return { n, dir };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new ArbabError("io", `cannot create ${dir}: ${(err as Error).message}`, { cause: err });
      }
      n += 1;
    }
  }
}

function readObject<T>(path: string): T | null {
  const value = readJson<unknown>(path);
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new ArbabError("io", `${path} is not a JSON object`);
  return value as T;
}

export function readAttempt(dir: string): AttemptRecord {
  const files = attemptFiles(dir);
  return {
    started: readObject<AttemptStarted>(files.started),
    exit: readObject<AttemptExit>(files.exit),
    summary: readObject<AttemptSummary>(files.summary),
    acked: existsSync(files.acked),
  };
}
