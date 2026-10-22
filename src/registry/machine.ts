import { createHash } from "node:crypto";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ProjectEntry, ShepherdEntry, WaiterEntry } from "../types";
import { ArbabError } from "../util/errors";
import { writeJsonAtomic } from "../util/fs";

// Machine-wide registries under ~/.arbab (DESIGN.md §21): which shepherds and waiters live, which projects launched.
// Every process of every project writes here, so a reader trusts nothing it finds and never fails on another's file.

const SHEPHERDS_DIR = "shepherds";
const WAITERS_DIR = "waiters";
const PROJECTS_DIR = "projects";
const ENTRY_FILE = /^([1-9][0-9]*)\.json$/;

function pidFile(home: string, dir: string, pid: number): string {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new ArbabError("usage", `pid ${pid} must be a positive integer`);
  return join(home, dir, `${pid}.json`);
}

function remove(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // Best effort: the next list tries again.
  }
}

function fileNames(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new ArbabError("io", `cannot list ${dir}: ${(err as Error).message}`, { cause: err });
  }
}

/** The parsed JSON of a file, or undefined when it is gone or does not parse. */
function parsed(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const isPid = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const isOwner = (v: unknown): v is string | null => v === null || typeof v === "string";

function asShepherd(v: unknown): ShepherdEntry | null {
  if (!isObject(v) || !isPid(v.pid) || typeof v.lane !== "string" || typeof v.project !== "string") return null;
  if (!isOwner(v.owner) || typeof v.startedAt !== "string") return null;
  return { pid: v.pid, lane: v.lane, project: v.project, owner: v.owner, startedAt: v.startedAt };
}

function asWaiter(v: unknown): WaiterEntry | null {
  if (!isObject(v) || !isPid(v.pid) || typeof v.project !== "string") return null;
  if (!isOwner(v.owner) || typeof v.startedAt !== "string") return null;
  return { pid: v.pid, project: v.project, owner: v.owner, startedAt: v.startedAt };
}

function asProject(v: unknown): ProjectEntry | null {
  if (!isObject(v) || typeof v.root !== "string" || typeof v.lastLaunchAt !== "string") return null;
  return { root: v.root, lastLaunchAt: v.lastLaunchAt };
}

function listByPid<T extends { pid: number; startedAt: string }>(
  home: string,
  dir: string,
  as: (v: unknown) => T | null,
  alive: (pid: number) => boolean,
): T[] {
  const out: T[] = [];
  for (const file of fileNames(join(home, dir))) {
    const match = ENTRY_FILE.exec(file);
    if (match === null) continue;
    const path = join(home, dir, file);
    const entry = as(parsed(path));
    // The file name is the pid that owns it; a body naming another pid is not trusted.
    if (entry === null || entry.pid !== Number(match[1])) continue;
    if (!alive(entry.pid)) {
      remove(path);
      continue;
    }
    out.push(entry);
  }
  return out.sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : a.pid - b.pid));
}

export function registerShepherd(home: string, entry: ShepherdEntry): void {
  writeJsonAtomic(pidFile(home, SHEPHERDS_DIR, entry.pid), entry);
}

export function unregisterShepherd(home: string, pid: number): void {
  remove(pidFile(home, SHEPHERDS_DIR, pid));
}

/** Live shepherds, oldest first; entries of dead pids are removed. */
export function listShepherds(home: string, alive: (pid: number) => boolean): ShepherdEntry[] {
  return listByPid(home, SHEPHERDS_DIR, asShepherd, alive);
}

export function registerWaiter(home: string, entry: WaiterEntry): void {
  writeJsonAtomic(pidFile(home, WAITERS_DIR, entry.pid), entry);
}

export function unregisterWaiter(home: string, pid: number): void {
  remove(pidFile(home, WAITERS_DIR, pid));
}

/** Live waiters, oldest first; entries of dead pids are removed. */
export function listWaiters(home: string, alive: (pid: number) => boolean): WaiterEntry[] {
  return listByPid(home, WAITERS_DIR, asWaiter, alive);
}

/** The registry file of a project root: one per root, whatever characters the path holds. */
export function projectFile(home: string, root: string): string {
  return join(home, PROJECTS_DIR, `${createHash("sha1").update(root).digest("hex")}.json`);
}

/** Records (or refreshes) that `root` launched a lane at `at`. */
export function registerProject(home: string, root: string, at: string): void {
  const entry: ProjectEntry = { root, lastLaunchAt: at };
  writeJsonAtomic(projectFile(home, root), entry);
}

/** Every recorded project, by root. */
export function listProjects(home: string): ProjectEntry[] {
  const out: ProjectEntry[] = [];
  for (const file of fileNames(join(home, PROJECTS_DIR))) {
    if (!/^[0-9a-f]{40}\.json$/.test(file)) continue;
    const entry = asProject(parsed(join(home, PROJECTS_DIR, file)));
    if (entry !== null) out.push(entry);
  }
  return out.sort((a, b) => (a.root < b.root ? -1 : a.root > b.root ? 1 : 0));
}
