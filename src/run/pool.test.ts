import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArbabError } from "../util/errors";
import { isAlive } from "../util/proc";
import {
  acquireFromPool,
  acquireSemaphore,
  acquireSlot,
  acquireWriterLock,
  listPoolEntries,
  releaseIfStale,
  releaseSemaphore,
  releaseSlot,
  releaseToPool,
  releaseWriterLock,
  writerLockKey,
  type Holder,
} from "./pool";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "arbab-pool-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const holder = (pid: number, lane = `lane-${pid}`): Holder => ({
  pid,
  lane,
  project: "/p",
  createdAt: "2026-10-09T00:00:00.000Z",
});

/** A pid that certainly belonged to a process that has exited. */
function deadPid(): number {
  const r = spawnSync(process.execPath, ["-e", ""]);
  if (r.pid === undefined || isAlive(r.pid)) throw new Error("no dead pid");
  return r.pid;
}

const everyoneAlive = () => true;

describe("acquireFromPool / releaseToPool", () => {
  it("hands out values in order until the pool is full", () => {
    const dir = join(home, "p");
    expect(acquireFromPool(dir, [0, 1], holder(10), everyoneAlive)).toBe(0);
    expect(acquireFromPool(dir, [0, 1], holder(11), everyoneAlive)).toBe(1);
    expect(acquireFromPool(dir, [0, 1], holder(12), everyoneAlive)).toBeNull();
    expect(JSON.parse(readFileSync(join(dir, "0.json"), "utf8"))).toEqual(holder(10));
  });

  it("releases only for the matching holder", () => {
    const dir = join(home, "p");
    acquireFromPool(dir, [0], holder(10), everyoneAlive);
    expect(releaseToPool(dir, 0, holder(11))).toBe(false);
    expect(releaseToPool(dir, 0, holder(10, "other-lane"))).toBe(false);
    expect(existsSync(join(dir, "0.json"))).toBe(true);
    expect(releaseToPool(dir, 0, holder(10))).toBe(true);
    expect(releaseToPool(dir, 0, holder(10))).toBe(false);
    expect(acquireFromPool(dir, [0], holder(11), everyoneAlive)).toBe(0);
  });

  it("reclaims an entry whose holder is dead and leaves no debris", () => {
    const dir = join(home, "p");
    const dead = deadPid();
    expect(acquireFromPool(dir, [0], holder(dead), isAlive)).toBe(0);
    expect(acquireFromPool(dir, [0], holder(process.pid), isAlive)).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "0.json"), "utf8")).pid).toBe(process.pid);
    expect(readdirSync(dir)).toEqual(["0.json"]);
  });

  it("never reclaims from a live holder", () => {
    const dir = join(home, "p");
    expect(acquireFromPool(dir, [0], holder(process.pid), isAlive)).toBe(0);
    expect(acquireFromPool(dir, [0], holder(deadPid()), isAlive)).toBeNull();
  });

  it("keeps an entry that does not parse (its creator may be mid-write)", () => {
    const dir = join(home, "p");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "0.json"), "");
    expect(acquireFromPool(dir, [0, 1], holder(10), () => false)).toBe(1);
    expect(releaseToPool(dir, 0, holder(10))).toBe(false);
    expect(existsSync(join(dir, "0.json"))).toBe(true);
  });

  it("validates holders and values", () => {
    const dir = join(home, "p");
    expect(() => acquireFromPool(dir, [0], { ...holder(10), pid: 0 }, everyoneAlive)).toThrow(ArbabError);
    expect(() => acquireFromPool(dir, [-1], holder(10), everyoneAlive)).toThrow(ArbabError);
    expect(() => acquireFromPool(dir, [1.5], holder(10), everyoneAlive)).toThrow(ArbabError);
    expect(() => releaseToPool(dir, -1, holder(10))).toThrow(ArbabError);
  });
});

describe("releaseIfStale", () => {
  const write = (path: string, text: string): string => {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
    return path;
  };

  it("removes a dead holder's entry and reports the path free", () => {
    const path = write(join(home, "p", "0.json"), JSON.stringify(holder(20)));
    expect(releaseIfStale(path, () => false)).toBe(true);
    expect(readdirSync(join(home, "p"))).toEqual([]);
  });

  it("keeps a live holder's entry", () => {
    const path = write(join(home, "p", "0.json"), JSON.stringify(holder(20)));
    expect(releaseIfStale(path, (pid) => pid === 20)).toBe(false);
    expect(existsSync(path)).toBe(true);
  });

  it("reports a missing entry free", () => {
    expect(releaseIfStale(join(home, "p", "0.json"), () => false)).toBe(true);
  });

  it("keeps an unparsable entry unless the caller calls it stale", () => {
    const path = write(join(home, "p", "0.json"), "{");
    expect(releaseIfStale(path, () => false)).toBe(false);
    expect(existsSync(path)).toBe(true);
    expect(releaseIfStale(path, () => true, true)).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  it("throws an io error for an entry it cannot read", () => {
    mkdirSync(join(home, "p", "0.json"), { recursive: true });
    expect(() => releaseIfStale(join(home, "p", "0.json"), () => false)).toThrow(ArbabError);
  });
});

describe("listPoolEntries", () => {
  it("lists entries and tombs of slots, semaphores, leases and locks, nothing else", () => {
    const key = "a".repeat(40);
    const files = [
      join(home, "slots", "0.json"),
      join(home, "slots", "1.json.0a1b2c.stale"),
      join(home, "semaphores", "db", "0.json"),
      join(home, "leases", "port", "4000.json"),
      join(home, "locks", key, "0.json"),
    ];
    for (const path of [...files, join(home, "slots", "notes.txt"), join(home, "quota.json"), join(home, "other", "x", "0.json")]) {
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, "");
    }
    expect(listPoolEntries(home).sort()).toEqual(files.sort());
  });

  it("returns nothing for a home that does not exist", () => {
    expect(listPoolEntries(join(home, "none"))).toEqual([]);
  });
});

describe("slots", () => {
  it("bounds holders by maxParallel under <home>/slots", () => {
    expect(acquireSlot(home, 2, holder(10), everyoneAlive)).toBe(0);
    expect(acquireSlot(home, 2, holder(11), everyoneAlive)).toBe(1);
    expect(acquireSlot(home, 2, holder(12), everyoneAlive)).toBeNull();
    expect(readdirSync(join(home, "slots")).sort()).toEqual(["0.json", "1.json"]);
    expect(releaseSlot(home, 0, holder(10))).toBe(true);
    expect(acquireSlot(home, 2, holder(12), everyoneAlive)).toBe(0);
  });
  it("rejects a non-positive maxParallel", () => {
    expect(() => acquireSlot(home, 0, holder(10), everyoneAlive)).toThrow(ArbabError);
  });
});

describe("semaphores", () => {
  it("serialises holders by capacity under <home>/semaphores/<name>", () => {
    expect(acquireSemaphore(home, "staging-db", 1, holder(10), everyoneAlive)).toBe(0);
    expect(acquireSemaphore(home, "staging-db", 1, holder(11), everyoneAlive)).toBeNull();
    expect(existsSync(join(home, "semaphores", "staging-db", "0.json"))).toBe(true);
    expect(releaseSemaphore(home, "staging-db", 0, holder(10))).toBe(true);
    expect(acquireSemaphore(home, "staging-db", 1, holder(11), everyoneAlive)).toBe(0);
  });
  it("validates the name and capacity", () => {
    expect(() => acquireSemaphore(home, "../x", 1, holder(10), everyoneAlive)).toThrow(ArbabError);
    expect(() => acquireSemaphore(home, "db", 0, holder(10), everyoneAlive)).toThrow(ArbabError);
    expect(() => releaseSemaphore(home, "A", 0, holder(10))).toThrow(ArbabError);
  });
});

describe("writer lock", () => {
  it("keys a worktree by the sha1 of its realpath", () => {
    const key = writerLockKey("/w/t");
    expect(key).toBe(createHash("sha1").update("/w/t").digest("hex"));
    expect(key).toMatch(/^[0-9a-f]{40}$/);
    expect(writerLockKey("/w/u")).not.toBe(key);
  });
  it("admits one writer per key", () => {
    const key = writerLockKey("/w/t");
    expect(acquireWriterLock(home, key, holder(10, "builder"), everyoneAlive)).toBe(true);
    expect(acquireWriterLock(home, key, holder(11, "verifier"), everyoneAlive)).toBe(false);
    expect(acquireWriterLock(home, writerLockKey("/w/other"), holder(11, "verifier"), everyoneAlive)).toBe(true);
    expect(releaseWriterLock(home, key, holder(11, "verifier"))).toBe(false);
    expect(releaseWriterLock(home, key, holder(10, "builder"))).toBe(true);
    expect(acquireWriterLock(home, key, holder(11, "verifier"), everyoneAlive)).toBe(true);
    expect(existsSync(join(home, "locks", key, "0.json"))).toBe(true);
  });
  it("is reclaimed from a dead writer", () => {
    const key = writerLockKey("/w/t");
    expect(acquireWriterLock(home, key, holder(deadPid()), isAlive)).toBe(true);
    expect(acquireWriterLock(home, key, holder(process.pid), isAlive)).toBe(true);
  });
  it("rejects keys that are not sha1 hex", () => {
    expect(() => acquireWriterLock(home, "../../etc", holder(10), everyoneAlive)).toThrow(ArbabError);
    expect(() => releaseWriterLock(home, "x", holder(10))).toThrow(ArbabError);
  });
});
