// The machine-wide registry of checks (DESIGN.md §22): one `<pid>.json` per run in `<$TMPDIR>/arbab-checks/`, which
// every sandbox of the user shares, so each check sees the others wherever they run. Any sandbox can write there, so
// every file in it is untrusted.
import { closeSync, constants, fstatSync, openSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ArbabError } from "../util/errors";
import { createExclusive, ensureDir, writeTextAtomic } from "../util/fs";

export interface RegistryFs {
  /** mkdir -p. */
  mkdirp(dir: string): void;
  /** Creates the file with this content; false when it already exists. */
  writeExclusive(path: string, data: string): boolean;
  /** Replaces the file at once: a temporary file in the same directory renamed over it. */
  replace(path: string, data: string): void;
  readDir(dir: string): string[];
  readFile(path: string): string;
  /** The text of a regular file, or null for anything else; never follows a link, never blocks on a FIFO. */
  readEntry(path: string): string | null;
  /** Removes the file; a missing file is not an error. */
  remove(path: string): void;
}

export type CheckState = "waiting" | "running";

export interface CheckEntry {
  pid: number;
  name: string;
  cwd: string;
  startedAt: string;
  cpus: number;
  /** An entry without one, from an older script, is running. */
  state: CheckState;
  /** The CPUs a running check took. */
  share?: number;
}

/** The registry under a temporary directory. */
export function registryDir(tmpdir: string): string {
  return join(tmpdir, "arbab-checks");
}

/**
 * An entry older than this is stale whatever its pid says: a check runs inside one Bash call, which the tool kills
 * after at most 15 minutes (BASH_MAX_TIMEOUT_MS), so no live check is older; 5 more minutes allow for clock steps.
 */
export const ENTRY_MAX_AGE_MS = 20 * 60_000;
/** An entry dated further ahead than this was not written by a check on this clock. */
export const ENTRY_MAX_AHEAD_MS = 60_000;
/** An entry is about 200 bytes; a bigger file is not one, and is not worth reading. */
export const ENTRY_MAX_BYTES = 16 * 1024;

const ENTRY_FILE = /^([1-9]\d*)\.json$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const entryPath = (dir: string, pid: number): string => join(dir, `${pid}.json`);
const isPid = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

function assertPid(pid: number): void {
  if (!isPid(pid)) throw new ArbabError("usage", `invalid pid ${pid}`);
}

/** startedAt in milliseconds, or NaN when it is not the ISO time a check writes. */
export function entryTime(entry: CheckEntry): number {
  return ISO_TIME.test(entry.startedAt) ? Date.parse(entry.startedAt) : Number.NaN;
}

/** Whether `a` registered before `b`: by startedAt, then by pid. */
export function registeredBefore(a: CheckEntry, b: CheckEntry): boolean {
  const ta = entryTime(a);
  const tb = entryTime(b);
  return ta !== tb ? ta < tb : a.pid < b.pid;
}

/** Writes <dir>/<pid>.json (replacing a stale one of the same pid). */
export function register(dir: string, entry: CheckEntry, fs: RegistryFs): void {
  assertPid(entry.pid);
  fs.mkdirp(dir);
  const path = entryPath(dir, entry.pid);
  const data = JSON.stringify(entry) + "\n";
  if (fs.writeExclusive(path, data)) return;
  // A file of our own pid is a dead run's: pids are reused, and no live process can hold ours.
  fs.remove(path);
  if (!fs.writeExclusive(path, data)) throw new ArbabError("io", `cannot register ${path}: it keeps existing`);
}

/** Rewrites this run's entry in place, atomically, so no reader sees it half written or missing. */
export function update(dir: string, entry: CheckEntry, fs: RegistryFs): void {
  assertPid(entry.pid);
  fs.replace(entryPath(dir, entry.pid), JSON.stringify(entry) + "\n");
}

export function unregister(dir: string, pid: number, fs: RegistryFs): void {
  assertPid(pid);
  fs.remove(entryPath(dir, pid));
}

function parseEntry(text: string, pid: number): CheckEntry | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.pid !== pid || typeof r.name !== "string" || typeof r.cwd !== "string" || typeof r.startedAt !== "string" || !isPid(r.cpus)) {
    return null;
  }
  if (r.state !== undefined && r.state !== "waiting" && r.state !== "running") return null;
  const entry: CheckEntry = { pid, name: r.name, cwd: r.cwd, startedAt: r.startedAt, cpus: r.cpus, state: r.state ?? "running" };
  if (isPid(r.share)) entry.share = r.share;
  return entry;
}

/** Why an entry is stale whatever its pid says, or null. */
function staleByTime(entry: CheckEntry, now: number): string | null {
  const t = entryTime(entry);
  if (Number.isNaN(t)) return "unparsable startedAt";
  if (now - t > ENTRY_MAX_AGE_MS) return "too old";
  if (t - now > ENTRY_MAX_AHEAD_MS) return "in the future";
  return null;
}

/**
 * The other live entries, waiting or running. Only regular files are read, and never through a link. An entry is
 * stale, and its file removed (best effort), when its startedAt does not parse, is older than ENTRY_MAX_AGE_MS or more
 * than ENTRY_MAX_AHEAD_MS ahead of `now`, or when kill(pid, 0) throws ESRCH; EPERM counts as alive. Files that do not
 * parse as a CheckEntry, and anything that is not a regular file, are ignored, never removed.
 */
export function liveEntries(dir: string, self: number, fs: RegistryFs, probe: (pid: number) => "alive" | "gone", now: number): CheckEntry[] {
  const live: CheckEntry[] = [];
  for (const file of fs.readDir(dir).sort()) {
    const match = ENTRY_FILE.exec(file);
    if (match === null) continue;
    const pid = Number(match[1]);
    if (pid === self || !Number.isSafeInteger(pid)) continue;
    let text: string | null;
    try {
      text = fs.readEntry(join(dir, file));
    } catch {
      // Removed between the listing and the read (that run has ended), or a link: skipped either way.
      continue;
    }
    if (text === null) continue;
    const entry = parseEntry(text, pid);
    if (entry === null) continue;
    if (staleByTime(entry, now) === null && probe(pid) === "alive") {
      live.push(entry);
      continue;
    }
    try {
      fs.remove(join(dir, file));
    } catch {
      // Best effort: another check may be removing it too.
    }
  }
  return live;
}

/** kill(pid, 0) as a probe: ESRCH is gone; success, EPERM (someone else's process) or anything else is alive. */
export function killProbe(kill: (pid: number, signal: 0) => unknown): (pid: number) => "alive" | "gone" {
  return (pid) => {
    try {
      kill(pid, 0);
      return "alive";
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === "ESRCH" ? "gone" : "alive";
    }
  };
}

// O_NOFOLLOW fails on a link (ELOOP) instead of opening its target; O_NONBLOCK opens a FIFO at once instead of
// waiting for a writer. Neither exists on Windows, where neither threat applies the same way.
const ENTRY_OPEN = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0);

/** RegistryFs.readEntry on the real file system. */
export function readEntryFile(path: string): string | null {
  const fd = openSync(path, ENTRY_OPEN);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > ENTRY_MAX_BYTES) return null;
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}

/** The registry's effects on the real file system. */
export const nodeRegistryFs: RegistryFs = {
  mkdirp: ensureDir,
  writeExclusive: createExclusive,
  replace: writeTextAtomic,
  readDir: (dir) => readdirSync(dir),
  readFile: (path) => readFileSync(path, "utf8"),
  readEntry: readEntryFile,
  remove: (path) => {
    rmSync(path, { force: true });
  },
};
