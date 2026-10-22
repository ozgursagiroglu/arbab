import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listWaiters, runPaths, writeState, type FinishedItem } from "../registry";
import type { AttemptSummary } from "../types";
import { CLI_PID, NOW_MS, SHEPHERD_PID, makeProject, writeLaneRun, type TestProject } from "./testkit";
import { WAIT_TIMEOUT_EXIT, describeFinished, formatFinished, parseTimeoutMin, runWait } from "./wait";

let p: TestProject;
afterEach(() => p?.dispose());

const OWNER = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const OTHER = "99999999-8888-7777-6666-555555555555";

/** Rewrites the lane's shepherd.json with an owner, as a §21 shepherd writes it. */
function own(t: TestProject, lane: string, owner: string | null, pid = SHEPHERD_PID): void {
  writeFileSync(runPaths(t.runsRoot, lane).shepherdFile, JSON.stringify({ pid, startedAt: "2026-10-09T11:00:00.000Z", owner }));
}

const finishedLanes = (stdout: string): string[] =>
  (JSON.parse(stdout) as { finished: Array<{ lane: string }> }).finished.map((f) => f.lane);

const waiterFile = (t: TestProject): string => join(t.home, "waiters", `${CLI_PID}.json`);

const finishedSummary: Partial<AttemptSummary> = { state: "success", wallMs: 125_000, turns: 7, toolCallTotal: 11, failedTotal: 2, costDeltaUsd: 0.4321 };

describe("parseTimeoutMin", () => {
  it("converts minutes and defaults to forever", () => {
    expect(parseTimeoutMin("1.5")).toBe(90_000);
    expect(parseTimeoutMin("0")).toBe(0);
    expect(parseTimeoutMin(undefined)).toBe(Infinity);
  });
  it("rejects what is not a non-negative number", () => {
    for (const bad of ["", "x", "-1", "Infinity"]) expect(() => parseTimeoutMin(bad)).toThrow(/timeout-min/);
  });
});

const RUN = { shepherdPid: 4242, since: "2026-10-09T11:50:00.000Z" };

function item(over: Partial<FinishedItem> & { lane: string }): FinishedItem {
  return { attempt: null, state: "finished", endState: null, reason: null, summary: null, run: RUN, ...over };
}

describe("formatFinished", () => {
  it("prints one line per finished run", () => {
    p = makeProject();
    const n = writeLaneRun(p.runsRoot, "demo", { state: "finished", summary: finishedSummary, report: { status: "done" } });
    const line = describeFinished(
      p.runsRoot,
      item({ lane: "demo", attempt: n, endState: "success", summary: finishedSummary as unknown as AttemptSummary }),
    );
    expect(formatFinished(line)).toBe(
      `demo#1 success 2m05s turns=7 calls=11 failed=2 cost=$0.43 report=${join(p.runsRoot, "demo", "attempt-1", "report.json")}`,
    );
  });

  it("uses dashes and the lane state when there is no summary, and leaves out a missing report", () => {
    p = makeProject();
    const n = writeLaneRun(p.runsRoot, "demo", { state: "running", shepherdPid: 999, started: {} });
    expect(formatFinished(describeFinished(p.runsRoot, item({ lane: "demo", attempt: n, state: "orphaned" })))).toBe(
      "demo#1 orphaned — turns=0 calls=0 failed=0 cost=—",
    );
  });

  it("prints a run without an attempt as the lane, its end state and the reason on one line", () => {
    p = makeProject();
    const line = describeFinished(p.runsRoot, item({ lane: "setup", endState: "failed", reason: "dependencies failed (1):\n  no lockfile\n" }));
    expect(line).toMatchObject({ attempt: null, endState: "failed", report: null, wallMs: null });
    expect(formatFinished(line)).toBe("setup failed reason: dependencies failed (1): no lockfile");
  });

  it("prefers the lane's end state over the last attempt's", () => {
    p = makeProject();
    const n = writeLaneRun(p.runsRoot, "demo", { state: "finished", endState: "failed", summary: finishedSummary });
    const summary = finishedSummary as unknown as AttemptSummary;
    const line = describeFinished(p.runsRoot, item({ lane: "demo", attempt: n, endState: "failed", reason: "binary changed", summary }));
    expect(formatFinished(line)).toBe("demo#1 failed 2m05s turns=7 calls=11 failed=2 cost=$0.43 reason: binary changed");
    // Without an end state in state.json, the attempt's state stands in.
    expect(describeFinished(p.runsRoot, item({ lane: "demo", attempt: n, summary })).endState).toBe("success");
  });
});

describe("runWait", () => {
  it("reports a lane that finished before the call, acks it, and exits 0", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "finished", endState: "success", summary: finishedSummary });
    expect(await runWait([], p.ctx)).toBe(0);
    expect(p.stdout()).toBe("demo#1 success 2m05s turns=7 calls=11 failed=2 cost=$0.43\n");
    expect(existsSync(join(p.runsRoot, "demo", "attempt-1", "acked"))).toBe(true);
  });

  it("reports a lane that failed before its first attempt, once", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "bad", { state: "finished", endState: "failed" });
    writeState(p.runsRoot, { lane: "bad", state: "finished", attempt: 0, since: "x", shepherdPid: 4242, endState: "failed", reason: "base nope" });
    expect(await runWait(["--any", "--json"], p.ctx)).toBe(0);
    expect(JSON.parse(p.stdout())).toEqual({
      timedOut: false,
      finished: [
        {
          lane: "bad",
          attempt: null,
          state: "finished",
          endState: "failed",
          reason: "base nope",
          wallMs: null,
          turns: 0,
          toolCalls: 0,
          failed: 0,
          costDeltaUsd: null,
          report: null,
        },
      ],
    });
    // Acked, and nothing else runs: the next wait has nothing to wait for.
    p.out.length = 0;
    expect(await runWait(["--any", "--timeout-min", "0"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe("no lanes are running\n");
  });

  it("times out with exit 3 and acks nothing", async () => {
    p = makeProject();
    p.alive.add(500);
    writeLaneRun(p.runsRoot, "demo", { state: "running", shepherdPid: 500, started: {} });
    const start = p.now.ms;
    expect(await runWait(["--timeout-min", "1", "demo"], p.ctx)).toBe(WAIT_TIMEOUT_EXIT);
    expect(p.now.ms - start).toBe(60_000);
    expect(p.stderr()).toContain("timed out");
    expect(p.stdout()).toBe("");
  });

  it("blocks until a lane finishes", async () => {
    p = makeProject();
    p.alive.add(500);
    writeLaneRun(p.runsRoot, "demo", { state: "running", shepherdPid: 500, started: {} });
    const sleep = p.ctx.sleep;
    let ticks = 0;
    p.ctx.sleep = async (ms) => {
      await sleep(ms);
      if (++ticks === 3) writeState(p.runsRoot, { lane: "demo", state: "finished", attempt: 1, since: "x", shepherdPid: 500, endState: "success" });
    };
    expect(await runWait(["--any"], p.ctx)).toBe(0);
    expect(p.stdout()).toMatch(/^demo#1 success/);
  });

  it("--all waits for every named lane; --json has a stable shape", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "a", { state: "finished", endState: "success", summary: finishedSummary, report: {} });
    writeLaneRun(p.runsRoot, "b", { state: "running", shepherdPid: 31337, started: {} });
    expect(await runWait(["--all", "--json", "a", "b"], p.ctx)).toBe(0);
    const out = JSON.parse(p.stdout()) as { timedOut: boolean; finished: Array<Record<string, unknown>> };
    expect(out.timedOut).toBe(false);
    expect(out.finished.map((f) => [f.lane, f.state, f.endState])).toEqual([
      ["a", "finished", "success"],
      ["b", "orphaned", "orphaned"],
    ]);
    expect(Object.keys(out.finished[0]!)).toEqual([
      "lane",
      "attempt",
      "state",
      "endState",
      "reason",
      "wallMs",
      "turns",
      "toolCalls",
      "failed",
      "costDeltaUsd",
      "report",
    ]);
    expect(out.finished[0]?.report).toBe(join(p.runsRoot, "a", "attempt-1", "report.json"));
  });

  it("--json on timeout", async () => {
    p = makeProject();
    p.alive.add(500);
    writeLaneRun(p.runsRoot, "demo", { state: "running", shepherdPid: 500, started: {} });
    expect(await runWait(["--json", "--timeout-min", "0"], p.ctx)).toBe(3);
    expect(JSON.parse(p.stdout())).toEqual({ timedOut: true, finished: [] });
  });

  it("--any acknowledges this session's and ownerless runs, and leaves another session's alone", async () => {
    p = makeProject();
    for (const lane of ["mine", "theirs", "old"]) writeLaneRun(p.runsRoot, lane, { state: "finished", endState: "success" });
    own(p, "mine", OWNER);
    own(p, "theirs", OTHER);
    p.ctx.hostEnv = { CLAUDE_CODE_SESSION_ID: OWNER };
    expect(await runWait(["--any", "--json"], p.ctx)).toBe(0);
    expect(finishedLanes(p.stdout())).toEqual(["mine", "old"]);
    expect(existsSync(join(p.runsRoot, "theirs", "acked.json"))).toBe(false);
    // The other session's run is not ours to wait for: nothing of ours runs, so the default --any is idle.
    p.out.length = 0;
    expect(await runWait(["--json"], p.ctx)).toBe(0);
    expect(JSON.parse(p.stdout())).toEqual({ timedOut: false, finished: [], idle: true });
    // Its own session still gets it.
    p.out.length = 0;
    p.ctx.hostEnv = { CLAUDE_CODE_SESSION_ID: OTHER };
    expect(await runWait(["--json"], p.ctx)).toBe(0);
    expect(finishedLanes(p.stdout())).toEqual(["theirs"]);
  });

  it("--any does not wait on another session's running lane", async () => {
    p = makeProject();
    p.alive.add(500);
    writeLaneRun(p.runsRoot, "theirs", { state: "running", shepherdPid: 500, started: {} });
    own(p, "theirs", OTHER, 500);
    p.ctx.hostEnv = { CLAUDE_CODE_SESSION_ID: OWNER };
    const start = p.now.ms;
    expect(await runWait(["--any"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe("no lanes are running\n");
    expect(p.now.ms).toBe(start);
    // --all waits for it.
    expect(await runWait(["--all", "--timeout-min", "0"], p.ctx)).toBe(WAIT_TIMEOUT_EXIT);
  });

  it("--all acknowledges every session's runs, one wait at a time as --any", async () => {
    p = makeProject();
    for (const lane of ["mine", "theirs", "old"]) writeLaneRun(p.runsRoot, lane, { state: "finished", endState: "success" });
    own(p, "mine", OWNER);
    own(p, "theirs", OTHER);
    p.alive.add(500);
    writeLaneRun(p.runsRoot, "busy", { state: "running", shepherdPid: 500, started: {} });
    p.ctx.hostEnv = { CLAUDE_CODE_SESSION_ID: OWNER };
    expect(await runWait(["--all", "--json"], p.ctx)).toBe(0);
    expect(finishedLanes(p.stdout())).toEqual(["mine", "old", "theirs"]);
  });

  it("named lanes are waited for whoever owns them", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "theirs", { state: "finished", endState: "success" });
    own(p, "theirs", OTHER);
    p.ctx.hostEnv = { CLAUDE_CODE_SESSION_ID: OWNER };
    expect(await runWait(["--any", "--json", "theirs"], p.ctx)).toBe(0);
    expect(finishedLanes(p.stdout())).toEqual(["theirs"]);
    // Once acked, a named lane that no longer runs is idle too, in both modes.
    for (const mode of ["--any", "--all"]) {
      p.out.length = 0;
      expect(await runWait([mode, "theirs"], p.ctx)).toBe(0);
      expect(p.stdout()).toBe("no lanes are running\n");
    }
  });

  it("is idle without any lanes", async () => {
    p = makeProject();
    expect(await runWait([], p.ctx)).toBe(0);
    expect(p.stdout()).toBe("no lanes are running\n");
    expect(p.stderr()).toBe("");
  });

  it("registers the waiter while it waits and removes it after", async () => {
    p = makeProject();
    p.alive.add(500);
    p.alive.add(CLI_PID);
    writeLaneRun(p.runsRoot, "demo", { state: "running", shepherdPid: 500, started: {} });
    p.ctx.hostEnv = { CLAUDE_CODE_SESSION_ID: OWNER };
    const seen: unknown[] = [];
    const sleep = p.ctx.sleep;
    p.ctx.sleep = async (ms) => {
      seen.push(listWaiters(p.home, p.ctx.alive));
      await sleep(ms);
      writeState(p.runsRoot, { lane: "demo", state: "finished", attempt: 1, since: "x", shepherdPid: 500, endState: "success" });
    };
    expect(await runWait([], p.ctx)).toBe(0);
    expect(seen).toEqual([[{ pid: CLI_PID, project: p.root, owner: OWNER, startedAt: new Date(NOW_MS).toISOString() }]]);
    expect(existsSync(waiterFile(p))).toBe(false);
  });

  it("removes the waiter on timeout and on error", async () => {
    p = makeProject();
    p.alive.add(500);
    writeLaneRun(p.runsRoot, "demo", { state: "running", shepherdPid: 500, started: {} });
    let registered = false;
    const sleep = p.ctx.sleep;
    p.ctx.sleep = async (ms) => {
      registered ||= existsSync(waiterFile(p));
      await sleep(ms);
    };
    expect(await runWait(["--timeout-min", "0.1"], p.ctx)).toBe(WAIT_TIMEOUT_EXIT);
    expect(registered).toBe(true);
    expect(existsSync(waiterFile(p))).toBe(false);

    registered = false;
    p.ctx.sleep = async () => {
      registered = existsSync(waiterFile(p));
      throw new Error("interrupted");
    };
    await expect(runWait([], p.ctx)).rejects.toThrow("interrupted");
    expect(registered).toBe(true);
    expect(existsSync(waiterFile(p))).toBe(false);
  });

  it("--notify shows one notification per finished lane and ignores whether it showed", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "a", { state: "finished", endState: "success", summary: finishedSummary });
    writeLaneRun(p.runsRoot, "b", { state: "running", shepherdPid: 31337, started: {} });
    p.notifyResult.shown = false;
    expect(await runWait(["--notify"], p.ctx)).toBe(0);
    expect(p.notified).toEqual([
      { title: "arbab", body: "a: success" },
      { title: "arbab", body: "b: orphaned" },
    ]);
    // Without --notify, or with nothing finished, there is none.
    p.notified.length = 0;
    writeLaneRun(p.runsRoot, "c", { state: "finished", endState: "failed" });
    expect(await runWait([], p.ctx)).toBe(0);
    expect(await runWait(["--notify"], p.ctx)).toBe(0);
    expect(p.notified).toEqual([]);
  });

  it("rejects usage errors", async () => {
    p = makeProject();
    await expect(runWait(["--any", "--all"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runWait(["--timeout-min"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runWait(["--timeout-min", "soon"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runWait(["--first"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runWait(["Bad_Name"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runWait(["missing"], p.ctx)).rejects.toMatchObject({ code: "usage" });
  });
});
