// Three racers on one stale pool entry. The interleaving that loses an entry needs a step between "create" and
// "count it as held", so createExclusive is wrapped to run that step.
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireFromPool, type Holder } from "./pool";

const hooks = vi.hoisted(() => ({ afterCreate: null as ((path: string, created: boolean) => void) | null }));

vi.mock("../util/fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("../util/fs")>();
  return {
    ...real,
    createExclusive: (path: string, data: string): boolean => {
      const created = real.createExclusive(path, data);
      hooks.afterCreate?.(path, created);
      return created;
    },
  };
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arbab-pool-race-"));
});
afterEach(() => {
  hooks.afterCreate = null;
  rmSync(dir, { recursive: true, force: true });
});

const holder = (pid: number): Holder => ({ pid, lane: `lane-${pid}`, project: "/p", createdAt: "2026-10-09T00:00:00.000Z" });
const DEAD = 900_001;
const alive = (pid: number): boolean => pid !== DEAD;

describe("acquireFromPool after a reclaim", () => {
  it("does not count an entry another racer moved aside and replaced", () => {
    const pool = join(dir, "pool");
    const entry = join(pool, "0.json");
    mkdirSync(pool);
    writeFileSync(entry, JSON.stringify(holder(DEAD)));

    // Racer A read the same stale entry earlier: right after B creates its own, A moves B's entry aside (thinking it
    // is the stale one), racer C creates its entry in the gap, A's put-back loses to C and A drops what it moved.
    let raced = false;
    hooks.afterCreate = (path, created) => {
      if (raced || !created || path !== entry) return;
      raced = true;
      const tomb = `${entry}.a.stale`;
      renameSync(entry, tomb);
      writeFileSync(entry, JSON.stringify(holder(300)));
      rmSync(tomb);
    };

    expect(acquireFromPool(pool, [0], holder(200), alive)).toBeNull();
    expect(raced).toBe(true);
    expect(JSON.parse(readFileSync(entry, "utf8"))).toEqual(holder(300));
  });

  it("moves on to the next value when the reclaimed one was lost", () => {
    const pool = join(dir, "pool");
    mkdirSync(pool);
    writeFileSync(join(pool, "0.json"), JSON.stringify(holder(DEAD)));
    let raced = false;
    hooks.afterCreate = (path, created) => {
      if (raced || !created || path !== join(pool, "0.json")) return;
      raced = true;
      writeFileSync(path, JSON.stringify(holder(300)));
    };
    expect(acquireFromPool(pool, [0, 1], holder(200), alive)).toBe(1);
  });

  it("counts a reclaimed entry that is still its own", () => {
    const pool = join(dir, "pool");
    mkdirSync(pool);
    writeFileSync(join(pool, "0.json"), JSON.stringify(holder(DEAD)));
    expect(acquireFromPool(pool, [0], holder(200), alive)).toBe(0);
    expect(JSON.parse(readFileSync(join(pool, "0.json"), "utf8"))).toEqual(holder(200));
  });
});
