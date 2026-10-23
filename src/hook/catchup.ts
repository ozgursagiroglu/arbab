// The UserPromptSubmit and SessionStart hooks (DESIGN.md §21): a session that comes back after a pause, a usage limit
// or `claude --resume` is told what other sessions landed in its project meanwhile, before it builds on a stale base.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
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

/** The watermark's time in ms, or null when there is none or it does not read as one. */
export function readWatermark(path: string): number | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
  if (!isObject(raw)) return null;
  const seenAt = raw["seenAt"];
  const ms = typeof seenAt === "string" ? Date.parse(seenAt) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Record text is the project's, not ours: no control character or line break may shape the model's context. */
const flat = (text: string): string => text.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ");

/** The context paragraph for landings by other sessions since `seenAt`, oldest first. */
export function catchUpText(seenAt: string, landings: readonly LandingSince[]): string {
  const intos = [...new Set(landings.map((l) => l.into))];
  const named = landings.slice(0, NAMED_LANDINGS).map(landingText);
  const more = landings.length > NAMED_LANDINGS ? ` and ${landings.length - NAMED_LANDINGS} more` : "";
  const into = intos.join(", ");
  const merge = intos.length === 1 ? into : `its base (${into})`;
  return flat(
    `arbab: since this session's last message (${seenAt}), other sessions landed into ${into} here: ${named.join(", ")}${more}. ` +
      `Lanes keep their own base; an integration started before these must merge ${merge} in before it can land.`,
  );
}

/** The registered project roots `cwd` lies in, as written or on disk. */
function registeredAround(home: string, cwd: string, realpath: (path: string) => string): string[] {
  let real: string | null = null;
  try {
    real = realpath(cwd);
  } catch {
    // A directory that is gone matches by its spelling only.
  }
  return listProjects(home)
    .map((entry) => entry.root)
    .filter((root) => sameOrInside(root, cwd) || (real !== null && sameOrInside(root, real)));
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
 * sessions made in this project since the session's watermark, or null. Null too for malformed input, a directory in
 * no registered project or in a lane worktree, and a session's first message, which only sets the watermark: a new
 * session gets no history. Each answer moves the watermark to the clock. Never loads the project's config.
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
  const roots = registeredAround(opts.home, cwd, realpath);
  if (roots.length === 0) return null;
  const root = opts.findRoot(cwd);
  if (root === null || !roots.some((r) => sameRoot(r, root, realpath))) return null;

  const path = watermarkPath(opts.home, session);
  const seenMs = readWatermark(path);
  const now = isoAt(opts.clock);
  if (seenMs === null) {
    writeJsonAtomic(path, { seenAt: now });
    return null;
  }
  const landings = landingsSince(root, seenMs).filter((l) => l.owner !== session);
  // Moved first: a watermark that cannot be written would repeat the same news at every message.
  writeJsonAtomic(path, { seenAt: now });
  if (landings.length === 0) return null;
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: event, additionalContext: catchUpText(new Date(seenMs).toISOString(), landings) },
  });
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
