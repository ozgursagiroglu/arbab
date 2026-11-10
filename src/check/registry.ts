// The machine-wide registry of running checks (DESIGN.md §22): one `<pid>.json` per run in `<$TMPDIR>/arbab-checks/`,
// which every sandbox of the user shares, so each check sees the others wherever they run.
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ArbabError } from "../util/errors";
import { createExclusive, ensureDir } from "../util/fs";

export interface RegistryFs {
  /** mkdir -p. */
  mkdirp(dir: string): void;
  /** Creates the file with this content; false when it already exists. */
  writeExclusive(path: string, data: string): boolean;
  readDir(dir: string): string[];
  readFile(path: string): string;
  /** Removes the file; a missing file is not an error. */
  remove(path: string): void;
}

export interface CheckEntry {
  pid: number;
  name: string;
  cwd: string;
  startedAt: string;
  cpus: number;
}

/** The registry under a temporary directory. */
export function registryDir(tmpdir: string): string {
  return join(tmpdir, "arbab-checks");
}

const ENTRY_FILE = /^([1-9]\d*)\.json$/;
const entryPath = (dir: string, pid: number): string => join(dir, `${pid}.json`);
const isPid = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

function assertPid(pid: number): void {
  if (!isPid(pid)) throw new ArbabError("usage", `invalid pid ${pid}`);
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
  return { pid, name: r.name, cwd: r.cwd, startedAt: r.startedAt, cpus: r.cpus };
}

/**
 * The other live entries: a pid whose kill(pid, 0) throws ESRCH is stale and its file is removed (best effort);
 * EPERM counts as alive; files that do not parse as a CheckEntry are ignored, never removed.
 */
export function running(dir: string, self: number, fs: RegistryFs, probe: (pid: number) => "alive" | "gone"): CheckEntry[] {
  const live: CheckEntry[] = [];
  for (const file of fs.readDir(dir).sort()) {
    const match = ENTRY_FILE.exec(file);
    if (match === null) continue;
    const pid = Number(match[1]);
    if (pid === self || !Number.isSafeInteger(pid)) continue;
    let text: string;
    try {
      text = fs.readFile(join(dir, file));
    } catch {
      // Removed between the listing and the read: that run has ended.
      continue;
    }
    const entry = parseEntry(text, pid);
    if (entry === null) continue;
    if (probe(pid) === "alive") {
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

/** The registry's effects on the real file system. */
export const nodeRegistryFs: RegistryFs = {
  mkdirp: ensureDir,
  writeExclusive: createExclusive,
  readDir: (dir) => readdirSync(dir),
  readFile: (path) => readFileSync(path, "utf8"),
  remove: (path) => {
    rmSync(path, { force: true });
  },
};
