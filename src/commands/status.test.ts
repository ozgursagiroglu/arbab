import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readAttempt, readState, runPaths, writeState } from "../registry";
import type { StatusRow } from "../types";
import { openProject } from "./project";
import { laneStatus, liveSummary, runStatus } from "./status";
import { NOW_MS, SHEPHERD_PID, makeProject, writeLaneRun, type TestProject } from "./testkit";

let p: TestProject;
afterEach(() => p?.dispose());

const OWNER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

/** Rewrites the lane's shepherd.json with an owner, as a §21 shepherd writes it. */
function own(t: TestProject, lane: string, owner: string | null): void {
  const file = runPaths(t.runsRoot, lane).shepherdFile;
  writeFileSync(file, JSON.stringify({ pid: SHEPHERD_PID, startedAt: "2026-10-09T11:00:00.000Z", owner }));
}

const SESSION = "11111111-2222-3333-4444-555555555555";
const stream = [
  { type: "system", subtype: "init", session_id: SESSION, tools: ["Bash"], permissionMode: "dontAsk", model: "claude-opus-5-5" },
  { type: "assistant", session_id: SESSION, message: { id: "m1", content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] } },
  { type: "assistant", session_id: SESSION, message: { id: "m2", content: [{ type: "tool_use", id: "t2", name: "Read", input: {} }] } },
]
  .map((e) => JSON.stringify(e))
  .join("\n")
  // A live stream's last line is often cut mid-write.
  .concat('\n{"type":"assist');

describe("liveSummary", () => {
  it("digests the partial stream of a running attempt", () => {
    p = makeProject();
    const n = writeLaneRun(p.runsRoot, "demo", { state: "running", started: { startedAt: "2026-10-09T11:59:00.000Z" }, stream });
    const record = readAttempt(runPaths(p.runsRoot, "demo").attemptDir(n));
    const s = liveSummary(p.runsRoot, "demo", n, record, NOW_MS);
    expect(s).toMatchObject({ state: "running", turns: 2, toolCallTotal: 2, lastTool: "Read", wallMs: 60_000, sessionId: SESSION });
  });

  it("takes the cost delta against the previous attempt of a resumed session", () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "waiting-reset", summary: { state: "usage-limit", costUsd: 1 } });
    const result = JSON.stringify({ type: "result", subtype: "success", total_cost_usd: 1.5 });
    const n = writeLaneRun(p.runsRoot, "demo", { state: "running", started: { resume: true }, stream: result + "\n" });
    const s = liveSummary(p.runsRoot, "demo", n, readAttempt(runPaths(p.runsRoot, "demo").attemptDir(n)), NOW_MS);
    expect(s.costUsd).toBe(1.5);
    expect(s.costDeltaUsd).toBeCloseTo(0.5);
  });

  it("treats a missing stream as empty", () => {
    p = makeProject();
    const n = writeLaneRun(p.runsRoot, "demo", { state: "running", started: {} });
    const s = liveSummary(p.runsRoot, "demo", n, readAttempt(runPaths(p.runsRoot, "demo").attemptDir(n)), NOW_MS);
    expect(s.turns).toBe(0);
  });
});

describe("laneStatus", () => {
  it("shows a dead shepherd's lane as orphaned", () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "running", shepherdPid: 31337 });
    expect(laneStatus(openProject(p.ctx), "demo", p.ctx.alive, NOW_MS)?.state).toBe("orphaned");
  });

  it("uses summary.json for a finished attempt", () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", {
      state: "finished",
      endState: "success",
      summary: { state: "success", turns: 9, toolCallTotal: 12, wallMs: 90_000, costUsd: 2, costDeltaUsd: 2, failedTotal: 1 },
    });
    expect(laneStatus(openProject(p.ctx), "demo", p.ctx.alive, NOW_MS)).toMatchObject({
      state: "finished",
      endState: "success",
      turns: 9,
      toolCalls: 12,
      elapsedMs: 90_000,
      failedTotal: 1,
    });
  });

  it("returns null before the shepherd wrote a state", () => {
    p = makeProject();
    mkdirSync(join(p.runsRoot, "demo"), { recursive: true });
    expect(laneStatus(openProject(p.ctx), "demo", p.ctx.alive, NOW_MS)).toBeNull();
  });
});

describe("runStatus", () => {
  it("prints a table with a live row and the quota line", async () => {
    p = makeProject();
    p.alive.add(SHEPHERD_PID);
    writeLaneRun(p.runsRoot, "demo", { state: "running", started: {}, stream });
    writeLaneRun(p.runsRoot, "other", { state: "finished", endState: "failed", summary: { state: "failed" } });
    expect(await runStatus([], p.ctx)).toBe(0);
    const lines = p.stdout().trimEnd().split("\n");
    expect(lines[0]).toMatch(/^lane\s+state\s+attempt/);
    expect(lines[1]).toMatch(/^demo\s+running\s+1\s+10m00s\s+2\s+2\s+Read/);
    expect(lines[2]).toMatch(/^other\s+finished \(failed\)/);
    expect(lines[3]).toBe("quota: quota unknown");
  });

  it("prints the stable --json shape", async () => {
    p = makeProject();
    mkdirSync(p.home, { recursive: true });
    const resetsAt = Math.floor(NOW_MS / 1000) + 3600;
    writeFileSync(
      join(p.home, "quota.json"),
      JSON.stringify({ observedAt: "2026-10-09T11:00:00.000Z", status: "allowed", type: null, fiveHour: { utilization: 0.9, resetsAt }, sevenDay: null }),
    );
    writeLaneRun(p.runsRoot, "demo", { state: "finished", endState: "success", summary: { state: "success" } });
    expect(await runStatus(["--json", "demo"], p.ctx)).toBe(0);
    const out = JSON.parse(p.stdout()) as { lanes: StatusRow[]; quota: { snapshot: unknown; hold: { hold: boolean; until: number } } };
    expect(Object.keys(out)).toEqual(["lanes", "quota"]);
    expect(out.lanes.map((r) => [r.lane, r.state, r.endState])).toEqual([["demo", "finished", "success"]]);
    expect(Object.keys(out.lanes[0]!).sort()).toEqual(
      [
        "attempt",
        "costDeltaUsd",
        "costUsd",
        "effort",
        "elapsedMs",
        "endState",
        "failedTotal",
        "fiveHour",
        "lane",
        "lastTool",
        "owner",
        "reason",
        "sevenDay",
        "state",
        "tokens",
        "toolCalls",
        "turns",
      ].sort(),
    );
    expect(out.quota.hold).toMatchObject({ hold: true, until: resetsAt });
  });

  it("says so when there are no lanes", async () => {
    p = makeProject();
    expect(await runStatus([], p.ctx)).toBe(0);
    expect(p.stdout()).toMatch(/^no lanes\n/);
  });

  it("notes a named lane without a state yet", async () => {
    p = makeProject();
    mkdirSync(join(p.runsRoot, "demo"), { recursive: true });
    expect(await runStatus(["demo"], p.ctx)).toBe(0);
    expect(p.stderr()).toContain("demo: no state yet");
  });

  it("gives each row its owner, the state's reason and the summary's tokens", async () => {
    p = makeProject();
    const tokens = { input: 1200, cacheCreation: 5000, cacheRead: 900_000, output: 35_000 };
    writeLaneRun(p.runsRoot, "demo", { state: "finished", endState: "killed:wall", summary: { state: "killed:wall", costUsd: null, tokens } });
    writeState(p.runsRoot, { ...readState(p.runsRoot, "demo")!, reason: "wall clock 60 min" });
    own(p, "demo", OWNER);
    expect(await runStatus(["--json"], p.ctx)).toBe(0);
    const out = JSON.parse(p.stdout()) as { lanes: StatusRow[] };
    expect(out.lanes[0]).toMatchObject({ owner: OWNER, reason: "wall clock 60 min", tokens, costUsd: null });
    p.out.length = 0;
    expect(await runStatus([], p.ctx)).toBe(0);
    const [header, row] = p.stdout().split("\n");
    expect(header).toMatch(/\s+cost\s+quota\s+why$/);
    expect(row).toMatch(/^demo\s+finished \(killed:wall\).*\s41\.2k tok\s+—\s+wall clock 60 min$/);
  });

  it("--active leaves finished lanes out and keeps orphaned ones", async () => {
    p = makeProject();
    p.alive.add(SHEPHERD_PID);
    writeLaneRun(p.runsRoot, "busy", { state: "running", started: {}, stream });
    writeLaneRun(p.runsRoot, "done", { state: "finished", endState: "success", summary: { state: "success" } });
    writeLaneRun(p.runsRoot, "lost", { state: "running", shepherdPid: 31337 });
    writeLaneRun(p.runsRoot, "waiting", { state: "held" });
    expect(await runStatus(["--active", "--json"], p.ctx)).toBe(0);
    const out = JSON.parse(p.stdout()) as { lanes: StatusRow[] };
    expect(out.lanes.map((r) => [r.lane, r.state])).toEqual([
      ["busy", "running"],
      ["lost", "orphaned"],
      ["waiting", "held"],
    ]);
    p.out.length = 0;
    expect(await runStatus(["--active", "done"], p.ctx)).toBe(0);
    expect(p.stdout()).toMatch(/^no lanes\n/);
  });

  it("--mine keeps this session's runs and the ownerless ones", async () => {
    p = makeProject();
    for (const lane of ["mine", "theirs", "old", "outside"]) writeLaneRun(p.runsRoot, lane, { state: "finished", endState: "success" });
    own(p, "mine", OWNER);
    own(p, "theirs", "99999999-8888-7777-6666-555555555555");
    own(p, "outside", null);
    p.ctx.hostEnv = { CLAUDE_CODE_SESSION_ID: OWNER };
    expect(await runStatus(["--mine", "--json"], p.ctx)).toBe(0);
    const lanes = (JSON.parse(p.stdout()) as { lanes: StatusRow[] }).lanes;
    expect(lanes.map((r) => [r.lane, r.owner])).toEqual([
      ["mine", OWNER],
      ["old", null],
      ["outside", null],
    ]);
    // Named lanes are filtered the same way.
    p.out.length = 0;
    expect(await runStatus(["--mine", "--json", "theirs"], p.ctx)).toBe(0);
    expect((JSON.parse(p.stdout()) as { lanes: StatusRow[] }).lanes).toEqual([]);
    // Outside Claude Code there is no session: every run is ours.
    p.out.length = 0;
    p.ctx.hostEnv = {};
    expect(await runStatus(["--mine", "--json"], p.ctx)).toBe(0);
    expect((JSON.parse(p.stdout()) as { lanes: StatusRow[] }).lanes).toHaveLength(4);
  });

  it("--mine and --active combine", async () => {
    p = makeProject();
    p.alive.add(SHEPHERD_PID);
    writeLaneRun(p.runsRoot, "mine-busy", { state: "running" });
    writeLaneRun(p.runsRoot, "mine-done", { state: "finished", endState: "success" });
    writeLaneRun(p.runsRoot, "theirs-busy", { state: "running" });
    own(p, "mine-busy", OWNER);
    own(p, "mine-done", OWNER);
    own(p, "theirs-busy", "someone-else");
    p.ctx.hostEnv = { CLAUDE_CODE_SESSION_ID: OWNER };
    expect(await runStatus(["--mine", "--active", "--json"], p.ctx)).toBe(0);
    expect((JSON.parse(p.stdout()) as { lanes: StatusRow[] }).lanes.map((r) => r.lane)).toEqual(["mine-busy"]);
  });

  it("rejects unknown lanes, invalid names and unknown flags", async () => {
    p = makeProject();
    await expect(runStatus(["missing"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runStatus(["../x"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runStatus(["--all"], p.ctx)).rejects.toMatchObject({ code: "usage" });
  });
});
