// The UserPromptSubmit and SessionStart hooks (DESIGN.md §21): a session that comes back after a pause, a usage limit
// or `claude --resume` is told what other sessions landed in its project meanwhile, before it builds on a stale base.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { listProjects } from "../registry";
import { landingsSince, landingText, type LandingSince } from "../summary";
import { writeJsonAtomic } from "../util/fs";
import { foldPath, sameOrInside } from "../util/pathcase";
import { isoAt, type Clock } from "../util/proc";

/** Under ~/.arbab: one watermark per session, `<sha256 of the session id>.json`. */
export const SESSIONS_DIR = "sessions";
/** How many landings the context names; the rest are counted. */
export const NAMED_LANDINGS = 5;
/** `cleanup` removes watermarks not modified for this long. */
export const WATERMARK_MAX_AGE_MS = 30 * 86_400_000;

const WATERMARK_FILE = /^[0-9a-f]{64}\.json$/;

export type CatchUpEvent = "UserPromptSubmit" | "SessionStart";

export interface CatchUpOptions {
  /** ~/.arbab */
  home: string;
  clock: Clock;
  /**
   * The project root of a directory, or null for none and for a lane worktree; may throw. Called only once the
   * directory lies in a registered project, so an unregistered one costs no git call.
   */
  findRoot: (cwd: string) => string | null;
  /** The path in its spelling on disk; throws when there is none. Default: `realpathSync.native`. */
  realpath?: (path: string) => string;
}

/** The watermark file of a session: hashed, so any id makes one safe file name. */
export function watermarkPath(home: string, session: string): string {
  return join(home, SESSIONS_DIR, `${createHash("sha256").update(session).digest("hex")}.json`);
}

/** How many reported landing keys a watermark keeps, the latest. */
export const REPORTED_KEPT = 100;
/**
 * How far before the watermark the next answer looks: land stamps landedAt before it writes landing.json, so a record
 * written while a hook ran can carry a time the watermark already passed. The keys keep it from being said twice.
 */
export const LANDING_SLACK_MS = 10 * 60_000;

/** What a session saw: when the hooks last answered it, and the landings already reported or already there then. */
export interface Watermark {
  seenMs: number;
  /** landingKey of each, oldest first; empty for a watermark written before keys were kept (0.2.2). */
  reported: string[];
}

/** `<name>@<mergeSha>`: one landing, even if the integration name is reused later. */
export function landingKey(landing: Pick<LandingSince, "name" | "mergeSha">): string {
  return `${landing.name}@${landing.mergeSha}`;
}

/** The watermark, or null when there is none or its time does not read; keys that are not strings are dropped. */
export function readWatermark(path: string): Watermark | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
  if (!isObject(raw)) return null;
  const seenAt = raw["seenAt"];
  const ms = typeof seenAt === "string" ? Date.parse(seenAt) : NaN;
  if (!Number.isFinite(ms)) return null;
  const keys = raw["reported"];
  const reported = Array.isArray(keys) ? keys.filter((k): k is string => typeof k === "string").slice(-REPORTED_KEPT) : [];
  return { seenMs: ms, reported };
}

function writeWatermark(path: string, seenAt: string, reported: readonly string[]): void {
  writeJsonAtomic(path, { seenAt, reported: [...new Set(reported)].slice(-REPORTED_KEPT) });
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Record text is the project's, not ours: no control character or line break may shape the model's context. */
const flat = (text: string): string => text.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ");

/** A landing, with its project's directory name when the session sees more than one project. */
export type CaughtLanding = LandingSince & { project?: string };

/**
 * The context paragraph for landings by other sessions while this session was away, oldest first. No time of its own:
 * the slack window can list a landing stamped before the session's last message; each landing keeps its time.
 */
export function catchUpText(landings: readonly CaughtLanding[]): string {
  const intos = [...new Set(landings.map((l) => l.into))];
  const named = landings
    .slice(0, NAMED_LANDINGS)
    .map((l) => (l.project === undefined ? landingText(l) : `${landingText(l)} in ${l.project}`));
  const more = landings.length > NAMED_LANDINGS ? ` and ${landings.length - NAMED_LANDINGS} more` : "";
  const into = intos.join(", ");
  const here = landings.some((l) => l.project !== undefined) ? "" : " here";
  const merge = intos.length === 1 ? into : `its base (${into})`;
  return flat(
    `arbab: while this session was away, other sessions landed into ${into}${here}: ${named.join(", ")}${more}. ` +
      `Lanes keep their own base; an integration started before these must merge ${merge} in before it can land.`,
  );
}

/**
 * The registered project roots around `cwd`, as written or on disk: those it lies in (`around`) and those inside it
 * (`below`), so an orchestrator started in a parent folder of several repositories hears about each.
 */
function registeredAround(home: string, cwd: string, realpath: (path: string) => string): { around: string[]; below: string[] } {
  let real: string | null = null;
  try {
    real = realpath(cwd);
  } catch {
    // A directory that is gone matches by its spelling only.
  }
  const around: string[] = [];
  const below: string[] = [];
  for (const { root } of listProjects(home)) {
    if (sameOrInside(root, cwd) || (real !== null && sameOrInside(root, real))) around.push(root);
    else if (sameOrInside(cwd, root) || (real !== null && sameOrInside(real, root))) below.push(root);
  }
  return { around, below };
}

function sameRoot(a: string, b: string, realpath: (path: string) => string): boolean {
  if (foldPath(a) === foldPath(b)) return true;
  try {
    return foldPath(realpath(a)) === foldPath(realpath(b));
  } catch {
    return false;
  }
}

/**
 * The hook's answer to its input (raw stdin): one JSON object whose additionalContext names the landings other
 * sessions made since the session's watermark (less LANDING_SLACK_MS, without the landings it already reported) in its
 * project and in every registered project inside its directory, or null. Null too for malformed input, a directory
 * with no registered project at, above or below it, a lane worktree, and a session's first message, which only sets
 * the watermark: a new session gets no history. Each answer moves the watermark to the clock and adds the keys it
 * reported. Never loads a project's config.
 */
export function catchUpDecision(input: string, event: CatchUpEvent, opts: CatchUpOptions): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input) as unknown;
  } catch {
    return null;
  }
  if (!isObject(parsed)) return null;
  const { session_id: session, cwd, hook_event_name: name, source } = parsed;
  if (typeof session !== "string" || session === "" || typeof cwd !== "string" || cwd === "") return null;
  if (name !== undefined && name !== event) return null;
  // SessionStart's source (startup, resume, clear, compact) changes nothing: the watermark says what this session saw.
  if (source !== undefined && typeof source !== "string") return null;

  const realpath = opts.realpath ?? ((path: string) => realpathSync.native(path));
  const { around, below } = registeredAround(opts.home, cwd, realpath);
  if (around.length === 0 && below.length === 0) return null;
  const roots: string[] = [];
  if (around.length > 0) {
    // Null in a lane worktree, which lies inside its project: a worker hears nothing, of that project or any other.
    const root = opts.findRoot(cwd);
    if (root === null) return null;
    if (around.some((r) => sameRoot(r, root, realpath))) roots.push(root);
  }
  for (const root of below) if (!roots.some((r) => sameRoot(r, root, realpath))) roots.push(root);
  if (roots.length === 0) return null;

  const since = (sinceMs: number): CaughtLanding[] => {
    const all: CaughtLanding[] = roots.flatMap((root) =>
      landingsSince(root, sinceMs).map((l) => (roots.length > 1 ? { ...l, project: basename(root) } : l)),
    );
    // Stable: each project's own order holds among equal times.
    return all.sort((a, b) => (Date.parse(a.landedAt) || 0) - (Date.parse(b.landedAt) || 0));
  };
  const path = watermarkPath(opts.home, session);
  const watermark = readWatermark(path);
  const nowMs = opts.clock.now();
  const now = isoAt(opts.clock);
  if (watermark === null) {
    // What is on disk now is history, slack window included: only a record written after this counts as news.
    writeWatermark(path, now, since(nowMs - LANDING_SLACK_MS).map(landingKey));
    return null;
  }
  const reported = new Set(watermark.reported);
  const landings = since(watermark.seenMs - LANDING_SLACK_MS).filter((l) => l.owner !== session && !reported.has(landingKey(l)));
  // Moved first: a watermark that cannot be written would repeat the same news at every message.
  writeWatermark(path, now, [...watermark.reported, ...landings.map(landingKey)]);
  if (landings.length === 0) return null;
  return JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: catchUpText(landings) } });
}

/** Removes the watermarks under `home` not modified for `maxAgeMs`; returns how many went. */
export function removeStaleWatermarks(home: string, nowMs: number, maxAgeMs: number = WATERMARK_MAX_AGE_MS): number {
  const dir = join(home, SESSIONS_DIR);
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const file of files) {
    if (!WATERMARK_FILE.test(file)) continue;
    const path = join(dir, file);
    try {
      if (!(nowMs - statSync(path).mtimeMs > maxAgeMs)) continue;
      rmSync(path, { force: true });
      removed++;
    } catch {
      // Gone already, or moved by its session meanwhile.
    }
  }
  return removed;
}
