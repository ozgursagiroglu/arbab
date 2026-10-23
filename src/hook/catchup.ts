// The UserPromptSubmit and SessionStart hooks (DESIGN.md §21): a session that comes back after a pause, a usage limit
// or `claude --resume` is told what other sessions landed in its project meanwhile, before it builds on a stale base.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { basename, isAbsolute, join, normalize, relative, sep } from "node:path";
import { listProjects } from "../registry";
import { landingsSince, landingText, type LandingSince } from "../summary";
import { writeJsonAtomic } from "../util/fs";
import { foldPath, sameOrInside } from "../util/pathcase";
import type { Clock } from "../util/proc";

/**
 * Under ~/.arbab: one watermark file per session, `<sha256 of the session id>.json`: the session's last message and a
 * watermark per project inside.
 */
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

/** What a session saw of one project: when the hooks last answered it there, and the landings already reported or already there then. */
export interface Watermark {
  seenMs: number;
  /** landingKey of each, oldest first; empty for a watermark written before keys were kept (0.2.2). */
  reported: string[];
}

/** A session's watermarks by project root, as its file holds them, and the session's own. */
export interface SessionWatermarks {
  projects: Map<string, Watermark>;
  /**
   * When the hooks last answered the session, for a project without its own watermark. Keys only from a file in the
   * earlier single-watermark shape, whose watermark it is.
   */
  session: Watermark | null;
}

/** `<name>@<mergeSha>`: one landing, even if the integration name is reused later. */
export function landingKey(landing: Pick<LandingSince, "name" | "mergeSha">): string {
  return `${landing.name}@${landing.mergeSha}`;
}

function parseWatermark(raw: unknown): Watermark | null {
  if (!isObject(raw)) return null;
  const seenAt = raw["seenAt"];
  const ms = typeof seenAt === "string" ? Date.parse(seenAt) : NaN;
  if (!Number.isFinite(ms)) return null;
  const keys = raw["reported"];
  const reported = Array.isArray(keys) ? keys.filter((k): k is string => typeof k === "string").slice(-REPORTED_KEPT) : [];
  return { seenMs: ms, reported };
}

/**
 * A session's watermarks, or null when the file is missing or reads as neither shape. A project whose time does not
 * read is left out, as are keys that are not strings. Without a session time that reads, the latest project's stands
 * in: a file written before the session kept one (0.2.2) last answered then.
 */
export function readWatermarks(path: string): SessionWatermarks | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
  if (!isObject(raw)) return null;
  const projects = raw["projects"];
  if (isObject(projects)) {
    const marks = new Map<string, Watermark>();
    for (const [root, value] of Object.entries(projects)) {
      const mark = parseWatermark(value);
      if (root !== "" && mark !== null) marks.set(root, mark);
    }
    // Keys stay with the projects: only a single-watermark file gives the session any.
    const own = parseWatermark({ seenAt: raw["seenAt"] });
    const latest = Math.max(...[...marks.values()].map((m) => m.seenMs));
    const session = own ?? (marks.size > 0 ? { seenMs: latest, reported: [] } : null);
    return { projects: marks, session };
  }
  const session = parseWatermark(raw);
  return session === null ? null : { projects: new Map(), session };
}

/** The watermark of `root`, compared as the file system does, with the key it is stored under. */
function watermarkOf(marks: ReadonlyMap<string, Watermark>, root: string): [string, Watermark] | null {
  const folded = foldPath(root);
  for (const entry of marks) if (foldPath(entry[0]) === folded) return entry;
  return null;
}

function writeWatermarks(path: string, nowMs: number, marks: ReadonlyMap<string, Watermark>): void {
  const projects: Record<string, { seenAt: string; reported: string[] }> = {};
  for (const [root, { seenMs, reported }] of marks) {
    projects[root] = { seenAt: new Date(seenMs).toISOString(), reported: [...new Set(reported)].slice(-REPORTED_KEPT) };
  }
  writeJsonAtomic(path, { seenAt: new Date(nowMs).toISOString(), projects });
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Record text is the project's, not ours: no control character or line break may shape the model's context. */
const flat = (text: string): string => text.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ");

/** A landing, with its project's name (projectName) when the session sees more than one project. */
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
function registeredAround(
  home: string,
  cwd: string,
  real: string | null,
): { around: string[]; below: string[] } {
  const around: string[] = [];
  const below: string[] = [];
  for (const { root } of listProjects(home)) {
    if (sameOrInside(root, cwd) || (real !== null && sameOrInside(root, real))) around.push(root);
    else if (sameOrInside(cwd, root) || (real !== null && sameOrInside(real, root))) below.push(root);
  }
  return { around, below };
}

/**
 * A project's name in the text: its path from the session's directory, in the spelling it lies under, so two
 * repositories with the same directory name read differently, measured through foldPath and spelled as the root is.
 * The basename for the project the directory lies in, whose path from there (empty, or `..` steps) is no name.
 */
export function projectName(root: string, cwd: string, real: string | null): string {
  const from = [cwd, real].find((dir): dir is string => dir !== null && sameOrInside(dir, root));
  // Folded, so a directory spelled in another case or normalisation than the root still measures a path.
  const rel = from === undefined ? "" : relative(foldPath(from), foldPath(root));
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return basename(root);
  // Folding changes no separator, so the root's last as many components are that path in its own spelling.
  const parts = normalize(root).split(sep).filter((part) => part !== "");
  return parts.slice(-rel.split(sep).length).join(sep);
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
 * sessions made in its project and in every registered project inside its directory, each since the session's
 * watermark for that project (less LANDING_SLACK_MS, without the landings it already reported), or null. Null too for
 * malformed input, a directory with no registered project at, above or below it, and a lane worktree. A project
 * without its own watermark is read from the session's (its last answer), so one registered while the session was away
 * is heard of; only a session with no file gets no history, its projects only watermarks. Each answer moves the
 * session's watermark and those of the projects it covers to the clock and adds the keys it reported; the others are
 * kept, so a session that comes back to a project hears what landed there meanwhile. Never loads a project's config.
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
  let real: string | null = null;
  try {
    real = realpath(cwd);
  } catch {
    // A directory that is gone matches by its spelling only.
  }
  const { around, below } = registeredAround(opts.home, cwd, real);
  if (around.length === 0 && below.length === 0) return null;
  // `root` is read, `key` (the registered root) names its watermark whichever way the session reached it.
  const roots: { root: string; key: string }[] = [];
  if (around.length > 0) {
    // Null in a lane worktree, which lies inside its project: a worker hears nothing, of that project or any other.
    const root = opts.findRoot(cwd);
    if (root === null) return null;
    const key = around.find((r) => sameRoot(r, root, realpath));
    if (key !== undefined) roots.push({ root, key });
  }
  for (const root of below) if (!roots.some((r) => sameRoot(r.root, root, realpath))) roots.push({ root, key: root });
  if (roots.length === 0) return null;

  const path = watermarkPath(opts.home, session);
  const marks = readWatermarks(path) ?? { projects: new Map<string, Watermark>(), session: null };
  const next = new Map(marks.projects);
  const nowMs = opts.clock.now();
  const landings: CaughtLanding[] = [];
  for (const { root, key } of roots) {
    const found = watermarkOf(marks.projects, key);
    if (found !== null) next.delete(found[0]);
    const mark = found?.[1] ?? marks.session;
    if (mark === null) {
      // A new session: what is on disk now is history, slack window included.
      next.set(key, { seenMs: nowMs, reported: landingsSince(root, nowMs - LANDING_SLACK_MS).map(landingKey) });
      continue;
    }
    const reported = new Set(mark.reported);
    const news = landingsSince(root, mark.seenMs - LANDING_SLACK_MS).filter(
      (l) => l.owner !== session && !reported.has(landingKey(l)),
    );
    next.set(key, { seenMs: nowMs, reported: [...mark.reported, ...news.map(landingKey)] });
    const project = roots.length > 1 ? projectName(root, cwd, real) : undefined;
    landings.push(...news.map((l) => (project === undefined ? l : { ...l, project })));
  }
  // Moved first: a watermark that cannot be written would repeat the same news at every message.
  writeWatermarks(path, nowMs, next);
  if (landings.length === 0) return null;
  // Stable: each project's own order holds among equal times.
  landings.sort((a, b) => (Date.parse(a.landedAt) || 0) - (Date.parse(b.landedAt) || 0));
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
