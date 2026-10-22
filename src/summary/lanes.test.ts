import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeState } from "../registry";
import { NOW_MS, makeProject, writeLaneRun, type TestProject } from "../commands/testkit";
import { laneOverview } from "./lanes";
import { writeOwner } from "./testkit";

let p: TestProject;
afterEach(() => p?.dispose());

const LIVE = 5000;

describe("laneOverview", () => {
  it("counts lanes by state and finished lanes by end state", () => {
    p = makeProject();
    p.alive.add(LIVE);
    for (const [lane, state] of [
      ["a-run", "running"],
      ["b-held", "held"],
      ["c-prep", "preparing"],
      ["d-wait", "waiting-reset"],
      ["e-queue", "queued"],
    ] as const) {
      writeLaneRun(p.runsRoot, lane, { state, shepherdPid: LIVE });
    }
    writeLaneRun(p.runsRoot, "f-ok", { state: "finished", endState: "success" });
    writeLaneRun(p.runsRoot, "g-ok", { state: "finished", endState: "success" });
    writeLaneRun(p.runsRoot, "h-bad", { state: "finished", endState: "failed" });
    writeLaneRun(p.runsRoot, "i-dead", { state: "running", shepherdPid: 31337 });
    const o = laneOverview(p.runsRoot, p.ctx.alive, NOW_MS);
    expect(o.total).toBe(9);
    expect(o.counts.byState).toEqual({ running: 1, held: 1, preparing: 1, "waiting-reset": 1, queued: 1, orphaned: 1 });
    expect(o.counts.finished).toEqual({ success: 2, failed: 1 });
    expect(o.active.map((l) => l.lane)).toEqual(["a-run", "b-held", "c-prep", "d-wait", "e-queue", "i-dead"]);
    expect(o.errors).toEqual([]);
  });

  it("gives each lane not finished its elapsed time, attempt, owner prefix and reason", () => {
    p = makeProject();
    p.alive.add(LIVE);
    writeLaneRun(p.runsRoot, "held", { state: "held", shepherdPid: LIVE, since: "2026-10-09T11:58:00.000Z" });
    writeState(p.runsRoot, { lane: "held", state: "held", attempt: 0, since: "2026-10-09T11:58:00.000Z", shepherdPid: LIVE, reason: "no free slot" });
    writeOwner(p.runsRoot, "held", "0123456789abcdef");
    writeLaneRun(p.runsRoot, "solo", { state: "running", shepherdPid: LIVE, attempt: 2 });
    const o = laneOverview(p.runsRoot, p.ctx.alive, NOW_MS);
    expect(o.active).toEqual([
      { lane: "held", state: "held", attempt: 0, elapsedMs: 120_000, owner: "01234567", reason: "no free slot" },
      { lane: "solo", state: "running", attempt: 2, elapsedMs: 600_000, owner: null, reason: null },
    ]);
  });

  it("lists failed latest runs and orphans under attention, with what to do", () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "killed", { state: "finished", endState: "killed:wall", summary: { state: "killed:wall" } });
    writeLaneRun(p.runsRoot, "limit", { state: "finished", endState: "usage-limit" });
    writeLaneRun(p.runsRoot, "ok", { state: "finished", endState: "success" });
    writeLaneRun(p.runsRoot, "orphan", { state: "preparing", shepherdPid: 31337 });
    const o = laneOverview(p.runsRoot, p.ctx.alive, NOW_MS);
    expect(o.attention.map((a) => [a.lane, a.state])).toEqual([
      ["killed", "killed:wall"],
      ["orphan", "orphaned"],
    ]);
    expect(o.attention[0]?.todo).toContain("wallMin");
    expect(o.attention[1]?.todo).toContain("arbab cleanup");
  });

  it("forgets a failure once the lane was relaunched", () => {
    p = makeProject();
    p.alive.add(LIVE);
    writeLaneRun(p.runsRoot, "again", { state: "finished", endState: "failed", summary: { state: "failed" } });
    writeLaneRun(p.runsRoot, "again", { state: "running", shepherdPid: LIVE, started: {} });
    const o = laneOverview(p.runsRoot, p.ctx.alive, NOW_MS);
    expect(o.attention).toEqual([]);
    expect(o.active[0]).toMatchObject({ lane: "again", state: "running", attempt: 2 });
  });

  it("takes the end state from summary.json when state.json has none", () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "old", { state: "finished", summary: { state: "budget" } });
    const o = laneOverview(p.runsRoot, p.ctx.alive, NOW_MS);
    expect(o.counts.finished).toEqual({ budget: 1 });
    expect(o.attention[0]).toMatchObject({ lane: "old", state: "budget", attempt: 1 });
  });

  it("counts a finished lane with no end state anywhere as unknown", () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "bare", { state: "finished" });
    expect(laneOverview(p.runsRoot, p.ctx.alive, NOW_MS).counts.finished).toEqual({ unknown: 1 });
  });

  it("skips lanes with no state yet and reports unreadable ones without failing", () => {
    p = makeProject();
    mkdirSync(join(p.runsRoot, "starting"), { recursive: true });
    mkdirSync(join(p.runsRoot, "broken"), { recursive: true });
    writeFileSync(join(p.runsRoot, "broken", "state.json"), "{not json");
    writeLaneRun(p.runsRoot, "fine", { state: "finished", endState: "success" });
    const o = laneOverview(p.runsRoot, p.ctx.alive, NOW_MS);
    expect(o.total).toBe(1);
    expect(o.errors).toHaveLength(1);
    expect(o.errors[0]).toMatch(/^lane broken: .*not valid JSON/);
  });

  it("is empty without a runs directory", () => {
    p = makeProject();
    expect(laneOverview(p.runsRoot, p.ctx.alive, NOW_MS)).toMatchObject({ total: 0, active: [], attention: [], errors: [] });
  });
});
