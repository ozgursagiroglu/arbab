import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { effectiveCap, quotaOverview, slotsInUse } from "./slots";
import { writeQuota, writeSlot } from "./testkit";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "arbab-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const alive = (pids: number[]) => (pid: number) => pids.includes(pid);
const holder = (pid: number, lane: string) => ({ pid, lane, project: "/work/repo", createdAt: "2026-10-09T11:00:00.000Z" });
const CONFIG = { maxParallel: 4, quota: { holdAbove: { fiveHour: 0.85, sevenDay: 0.95 } } };
const NOW_SEC = Math.floor(Date.parse("2026-10-09T12:00:00.000Z") / 1000);

describe("slotsInUse", () => {
  it("lists the entries of live pids, by slot, and leaves the dead ones on disk", () => {
    writeSlot(home, 2, holder(12, "b"));
    writeSlot(home, 0, holder(11, "a"));
    writeSlot(home, 1, holder(99, "dead"));
    writeSlot(home, 3, "{partial");
    writeSlot(home, 4, { pid: "12", lane: "x", project: "/p" });
    mkdirSync(join(home, "slots"), { recursive: true });
    writeFileSync(join(home, "slots", "5.json.0123abcd.stale"), JSON.stringify(holder(11, "tomb")));
    expect(slotsInUse(home, alive([11, 12]))).toEqual([
      { slot: 0, pid: 11, lane: "a", project: "/work/repo" },
      { slot: 2, pid: 12, lane: "b", project: "/work/repo" },
    ]);
    expect(existsSync(join(home, "slots", "1.json"))).toBe(true);
  });

  it("is empty without a slots directory", () => {
    expect(slotsInUse(home, alive([]))).toEqual([]);
  });
});

describe("effectiveCap", () => {
  it("caps the project's maxParallel by the machine's", () => {
    expect(effectiveCap(4, { maxParallel: 2 })).toBe(2);
    expect(effectiveCap(2, { maxParallel: 6 })).toBe(2);
    expect(effectiveCap(4, { maxParallel: null })).toBe(4);
  });
});

describe("quotaOverview", () => {
  it("carries the snapshot, the hold decision and the slots against the cap", () => {
    writeQuota(home, 0.9, 0.5, NOW_SEC + 3600);
    writeSlot(home, 0, holder(11, "a"));
    const q = quotaOverview({ home, config: CONFIG, machine: { maxParallel: 3 }, alive: alive([11]), nowSec: NOW_SEC });
    expect(q.snapshot?.fiveHour?.utilization).toBe(0.9);
    expect(q.hold).toMatchObject({ hold: true, until: NOW_SEC + 3600 });
    expect(q.slots).toEqual({ inUse: [{ slot: 0, pid: 11, lane: "a", project: "/work/repo" }], cap: 3, projectMaxParallel: 4, machineMaxParallel: 3 });
  });

  it("holds nothing without a snapshot", () => {
    const q = quotaOverview({ home, config: CONFIG, machine: { maxParallel: null }, alive: alive([]), nowSec: NOW_SEC });
    expect(q).toEqual({
      snapshot: null,
      hold: { hold: false, reason: null, until: null },
      slots: { inUse: [], cap: 4, projectMaxParallel: 4, machineMaxParallel: null },
    });
  });
});
