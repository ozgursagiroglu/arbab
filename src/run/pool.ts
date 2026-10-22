import { createHash, randomBytes } from "node:crypto";
import { linkSync, readdirSync, renameSync, rmdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { ArbabError } from "../util/errors";
import { createExclusive, readText } from "../util/fs";
import { assertValidName } from "../util/names";

/** Who holds a pool entry; the content of `<dir>/<value>.json`. */
export interface Holder {
  pid: number;
  lane: string;
  project: string;
  createdAt: string;
}

export type Alive = (pid: number) => boolean;

function isHolder(value: unknown): value is Holder {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Number.isInteger(v.pid) &&
    (v.pid as number) > 0 &&
    typeof v.lane === "string" &&
    typeof v.project === "string" &&
    typeof v.createdAt === "string"
  );
}

function assertHolder(holder: Holder): void {
  if (!isHolder(holder)) throw new ArbabError("usage", "pool holder needs a positive pid, lane, project and createdAt");
}

function entryPath(dir: string, value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new ArbabError("usage", `pool value ${value} is not a non-negative integer`);
  return join(dir, `${value}.json`);
}

function parseHolder(text: string): Holder | null {
  try {
    const value: unknown = JSON.parse(text);
    return isHolder(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Removes an entry whose holder is dead. Returns true when the path is free to create. An entry that does not parse
 * is kept, since its creator may be between open and write, unless the caller has decided otherwise
 * (`unparsedIsStale`: cleanup, once its grace period has passed).
 */
export function releaseIfStale(path: string, alive: Alive, unparsedIsStale = false): boolean {
  const text = readText(path);
  if (text === null) return true;
  const holder = parseHolder(text);
  if (holder === null ? !unparsedIsStale : alive(holder.pid)) return false;
  // Move it aside instead of unlinking, so two reclaimers cannot both delete: if what we moved is not the stale
  // entry we read (someone reclaimed and re-created in between), put it back.
  const tomb = `${path}.${randomBytes(6).toString("hex")}.stale`;
  try {
    renameSync(path, tomb);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw new ArbabError("io", `cannot reclaim ${path}: ${(err as Error).message}`, { cause: err });
  }
  const moved = readText(tomb);
  if (moved !== text) {
    try {
      linkSync(tomb, path);
    } catch {
      // Someone created a new entry meanwhile; theirs wins.
    }
    rmSync(tomb, { force: true });
    return false;
  }
  rmSync(tomb, { force: true });
  return true;
}

/**
 * Takes the first free value, in order, by creating `<dir>/<value>.json` exclusively. An entry whose holder pid is
 * dead is reclaimed once. Returns the value taken, or null when every value is held.
 */
export function acquireFromPool(dir: string, values: number[], holder: Holder, alive: Alive): number | null {
  assertHolder(holder);
  const data = JSON.stringify(holder);
  for (const value of values) {
    const path = entryPath(dir, value);
    if (createExclusive(path, data)) return value;
    if (!releaseIfStale(path, alive) || !createExclusive(path, data)) continue;
    // A third racer that read the same stale entry may move ours aside and lose the race to put it back (see
    // releaseIfStale); only an entry that still reads as ours is held.
    if (readText(path) === data) return value;
  }
  return null;
}

/** Removes the entry only when it belongs to this holder (same pid and lane). Returns whether it was removed. */
export function releaseToPool(dir: string, value: number, holder: Holder): boolean {
  const path = entryPath(dir, value);
  const text = readText(path);
  if (text === null) return false;
  const current = parseHolder(text);
  if (current === null || current.pid !== holder.pid || current.lane !== holder.lane) return false;
  rmSync(path, { force: true });
  return true;
}

function list(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

const POOL_FILE = /^\d+\.json(\.[0-9a-f]+\.stale)?$/;

/**
 * Every pool file under ~/.arbab: the `<value>.json` entries of slots, semaphores, leases and writer locks, and the
 * `.stale` tombs a reclaim left behind when it died between rename and unlink.
 */
export function listPoolEntries(home: string): string[] {
  const root = resolve(home);
  const dirs = [join(root, "slots")];
  for (const kind of ["semaphores", "leases", "locks"]) {
    for (const name of list(join(root, kind))) dirs.push(join(root, kind, name));
  }
  return dirs.flatMap((dir) => list(dir).filter((name) => POOL_FILE.test(name)).map((name) => join(dir, name)));
}

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

function assertCount(n: number, what: string): void {
  if (!Number.isSafeInteger(n) || n < 1) throw new ArbabError("config", `${what} must be a positive integer, got ${n}`);
}

// Slots: maxParallel workers across all projects.

export function acquireSlot(home: string, maxParallel: number, holder: Holder, alive: Alive): number | null {
  assertCount(maxParallel, "maxParallel");
  return acquireFromPool(join(resolve(home), "slots"), range(maxParallel), holder, alive);
}

export function releaseSlot(home: string, slot: number, holder: Holder): boolean {
  return releaseToPool(join(resolve(home), "slots"), slot, holder);
}

// Semaphores: named capacities that serialise shared external resources.

export function acquireSemaphore(home: string, name: string, capacity: number, holder: Holder, alive: Alive): number | null {
  assertValidName(name, "semaphore");
  assertCount(capacity, `semaphore ${name} capacity`);
  return acquireFromPool(join(resolve(home), "semaphores", name), range(capacity), holder, alive);
}

export function releaseSemaphore(home: string, name: string, slot: number, holder: Holder): boolean {
  assertValidName(name, "semaphore");
  return releaseToPool(join(resolve(home), "semaphores", name), slot, holder);
}

// Writer lock: one writer per worktree, a pool of one value.

export function writerLockKey(worktreeRealpath: string): string {
  return createHash("sha1").update(worktreeRealpath).digest("hex");
}

function lockDir(home: string, key: string): string {
  if (!/^[0-9a-f]{40}$/.test(key)) throw new ArbabError("usage", `writer lock key ${JSON.stringify(key)} is not a sha1`);
  return join(resolve(home), "locks", key);
}

/** How often an acquire starts over when a releaser removed the lock's directory under it. */
const LOCK_DIR_RETRIES = 5;

function vanished(err: unknown): boolean {
  return err instanceof ArbabError && (err.cause as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

export function acquireWriterLock(home: string, key: string, holder: Holder, alive: Alive): boolean {
  const dir = lockDir(home, key);
  for (let tries = 1; ; tries++) {
    try {
      return acquireFromPool(dir, [0], holder, alive) === 0;
    } catch (err) {
      // A release removed the directory between its creation and the entry's: create both again.
      if (!vanished(err) || tries >= LOCK_DIR_RETRIES) throw err;
    }
  }
}

/** Removes the entry, then the key's directory, so locks/ does not keep one directory per worktree ever locked. */
export function releaseWriterLock(home: string, key: string, holder: Holder): boolean {
  const dir = lockDir(home, key);
  const released = releaseToPool(dir, 0, holder);
  if (released) {
    try {
      rmdirSync(dir);
    } catch {
      // Not empty (another acquirer's entry, a reclaim's tomb) or already gone: either way it is not ours to remove.
    }
  }
  return released;
}
