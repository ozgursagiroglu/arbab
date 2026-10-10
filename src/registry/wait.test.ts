import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AttemptSummary, LaneState, LaneStateRecord } from "../types";
import { ArbabError } from "../util/errors";
import type { Clock } from "../util/proc";
import { ack, ackedFile, ackRun, createAttempt, isAcked, pendingFinished, waitForFinished, writeState } from "./index";
import type { FinishedItem, WaitOptions } from "./index";

const LIVE_PID = 100;
const DEAD_PID = 200;
const alive = (pid: number): boolean => pid === LIVE_PID;

let root: string;
let runs = 0;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "arbab-wait-"));
  runs = 0;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A new `since` per call: every lane() is a new shepherd run. */
const nextSince = (): string => new Date(Date.UTC(2026, 9, 9, 10, 0, runs++)).toISOString();

/** A lane run with one more attempt, in the given state. */
function lane(name: string, state: LaneState, pid = LIVE_PID, extra: Partial<LaneStateRecord> = {}): number {
  const { n } = createAttempt(root, name);
  writeState(root, { lane: name, state, attempt: n, since: nextSince(), shepherdPid: pid, ...extra });
  return n;
}

/** A lane run that made no attempt (it failed in setup). */
function setupFailure(name: string, reason: string, pid = LIVE_PID): void {
  writeState(root, { lane: name, state: "finished", attempt: 0, since: nextSince(), shepherdPid: pid, endState: "failed", reason });
}

function setState(name: string, state: LaneState, attempt: number, pid = LIVE_PID, extra: Partial<LaneStateRecord> = {}): void {
  writeState(root, { lane: name, state, attempt, since: nextSince(), shepherdPid: pid, ...extra });
}

function writeSummary(name: string, attempt: number, cost: number): void {
  const s = { lane: name, attempt, state: "success", costUsd: cost } as Partial<AttemptSummary>;
  writeFileSync(join(root, name, `attempt-${attempt}`, "summary.json"), JSON.stringify(s));
}

/** A fake clock whose sleep advances time and runs the scheduled step for that tick, if any. */
function fakeTime(steps: Record<number, () => void> = {}): { clock: Clock; sleep: (ms: number) => Promise<void> } {
  let t = 0;
  let tick = 0;
  return {
    clock: { now: () => t },
    sleep: async (ms) => {
      t += ms;
      tick += 1;
      steps[tick]?.();
    },
  };
}

function opts(over: Partial<WaitOptions>): WaitOptions {
  return { runsRoot: root, lanes: null, mode: "any", timeoutMs: 60_000, pollMs: 1000, alive, ...fakeTime(), ...over };
}

const brief = (i: FinishedItem) => ({ lane: i.lane, attempt: i.attempt, state: i.state, endState: i.endState, reason: i.reason });

describe("pendingFinished", () => {
  it("lists finished and orphaned lanes whose current run is not acked", () => {
    lane("done", "finished", LIVE_PID, { endState: "success" });
    lane("orphan", "running", DEAD_PID);
    lane("busy", "running");
    expect(pendingFinished(root, null, alive).map(brief)).toEqual([
      { lane: "done", attempt: 1, state: "finished", endState: "success", reason: null },
      { lane: "orphan", attempt: 1, state: "orphaned", endState: null, reason: null },
    ]);
    expect(pendingFinished(root, ["busy", "done"], alive).map((i) => i.lane)).toEqual(["done"]);
  });

  it("reports the run's attempt with its summary, and the run it read", () => {
    lane("x", "running");
    const n = lane("x", "finished");
    writeSummary("x", n, 0.5);
    const [item] = pendingFinished(root, null, alive);
    expect(item?.attempt).toBe(2);
    expect(item?.summary?.costUsd).toBe(0.5);
    expect(item?.run).toEqual({ shepherdPid: LIVE_PID, since: "2026-10-09T10:00:01.000Z" });
  });

  it("reports a run that failed before its first attempt, with its end state and reason", () => {
    setupFailure("setup", "git worktree add failed (128): invalid reference: nope");
    expect(pendingFinished(root, null, alive).map(brief)).toEqual([
      { lane: "setup", attempt: null, state: "finished", endState: "failed", reason: "git worktree add failed (128): invalid reference: nope" },
    ]);
  });

  it("reports a relaunch that failed in setup after an earlier run was acked", () => {
    lane("x", "finished", LIVE_PID, { endState: "success" });
    expect(ack(root, "x", 1)).toBe(true);
    expect(pendingFinished(root, null, alive)).toEqual([]);
    setupFailure("x", "dependencies failed (1): no lockfile");
    const [item] = pendingFinished(root, null, alive);
    expect(item).toMatchObject({ lane: "x", attempt: null, endState: "failed", reason: "dependencies failed (1): no lockfile", summary: null });
  });

  it("takes the lane's end state from state.json, not from the last attempt's summary", () => {
    const n = lane("x", "finished", LIVE_PID, { endState: "failed", reason: "binary changed" });
    writeSummary("x", n, 1);
    const [item] = pendingFinished(root, null, alive);
    expect(item).toMatchObject({ endState: "failed", reason: "binary changed" });
    expect(item?.summary?.state).toBe("success");
  });

  it("leaves out an attempt the state names but that does not exist, and the reason of a lane still held", () => {
    setState("bare", "finished", 3);
    setState("gone", "held", 0, DEAD_PID, { reason: "no free slot" });
    expect(pendingFinished(root, null, alive).map(brief)).toEqual([
      { lane: "bare", attempt: null, state: "finished", endState: null, reason: null },
      { lane: "gone", attempt: null, state: "orphaned", endState: null, reason: null },
    ]);
  });

  it("skips lanes without a state record", () => {
    createAttempt(root, "fresh");
    expect(pendingFinished(root, null, alive)).toEqual([]);
  });

  it("forgets a run once acked, but reports the next one", () => {
    lane("x", "finished");
    expect(ack(root, "x", 1)).toBe(true);
    expect(ack(root, "x", 1)).toBe(false);
    expect(pendingFinished(root, null, alive)).toEqual([]);
    lane("x", "finished");
    expect(pendingFinished(root, null, alive).map((i) => i.attempt)).toEqual([2]);
  });
});

describe("ackRun", () => {
  it("records the run in acked.json once, and marks its attempt", () => {
    lane("x", "finished");
    const [item] = pendingFinished(root, null, alive);
    expect(ackRun(root, "x", item!.run, 1)).toBe(true);
    expect(ackRun(root, "x", item!.run, 1)).toBe(false);
    expect(JSON.parse(readFileSync(ackedFile(root, "x"), "utf8"))).toEqual({ ...item!.run, attempt: 1 });
    expect(existsSync(join(root, "x", "attempt-1", "acked"))).toBe(true);
    expect(isAcked(root, "x", item!.run)).toBe(true);
    expect(isAcked(root, "x", { ...item!.run, shepherdPid: 101 })).toBe(false);
  });

  it("still knows an acked run when acked.json was replaced or damaged", () => {
    setupFailure("x", "boom");
    const [first] = pendingFinished(root, null, alive);
    expect(ackRun(root, "x", first!.run)).toBe(true);
    writeFileSync(ackedFile(root, "x"), "{broken");
    expect(isAcked(root, "x", first!.run)).toBe(true);
    expect(ackRun(root, "x", first!.run)).toBe(false);
  });
});

describe("ack", () => {
  it("refuses an attempt that does not exist instead of creating it", () => {
    lane("x", "finished");
    expect(() => ack(root, "x", 2)).toThrow(ArbabError);
    expect(existsSync(join(root, "x", "attempt-2"))).toBe(false);
  });

  it("marks only the attempt when the current run is about another one", () => {
    lane("x", "finished");
    lane("x", "finished");
    expect(ack(root, "x", 1)).toBe(true);
    expect(pendingFinished(root, null, alive).map((i) => i.attempt)).toEqual([2]);
  });
});

describe("waitForFinished", () => {
  it("returns a finish that happened before the call, and acks it", async () => {
    lane("early", "finished");
    const result = await waitForFinished(opts({ mode: "any" }));
    expect(result.timedOut).toBe(false);
    expect(result.finished.map(brief)).toEqual([{ lane: "early", attempt: 1, state: "finished", endState: null, reason: null }]);
    expect(existsSync(join(root, "early", "attempt-1", "acked"))).toBe(true);
    expect(existsSync(ackedFile(root, "early"))).toBe(true);
  });

  it("any: returns a setup failure at once, and only once", async () => {
    setupFailure("bad", "git worktree add failed");
    const result = await waitForFinished(opts({ mode: "any" }));
    expect(result.finished.map(brief)).toEqual([
      { lane: "bad", attempt: null, state: "finished", endState: "failed", reason: "git worktree add failed" },
    ]);
    expect(await waitForFinished(opts({ mode: "any", timeoutMs: 0 }))).toEqual({ finished: [], timedOut: true });
  });

  it("any: blocks until something finishes and returns everything pending", async () => {
    const a = lane("a", "running");
    const b = lane("b", "running");
    lane("c", "running");
    const time = fakeTime({
      3: () => {
        setState("a", "finished", a);
        setState("b", "running", b, DEAD_PID);
      },
    });
    const result = await waitForFinished(opts({ mode: "any", ...time }));
    expect(result.timedOut).toBe(false);
    expect(result.finished.map((i) => [i.lane, i.state])).toEqual([
      ["a", "finished"],
      ["b", "orphaned"],
    ]);
    expect(time.clock.now()).toBe(3000);
  });

  it("all: waits for every named lane, then returns the unacked ones", async () => {
    const a = lane("a", "finished");
    const b = lane("b", "running");
    lane("other", "running");
    ack(root, "a", a);
    const time = fakeTime({ 2: () => setState("b", "finished", b) });
    const result = await waitForFinished(opts({ mode: "all", lanes: ["a", "b"], ...time }));
    expect(result.timedOut).toBe(false);
    expect(result.finished.map(brief)).toEqual([{ lane: "b", attempt: 1, state: "finished", endState: null, reason: null }]);
    expect(time.clock.now()).toBe(2000);
  });

  it("all: with no lanes named, waits for every lane", async () => {
    lane("a", "finished");
    const b = lane("b", "queued");
    const time = fakeTime({ 1: () => setState("b", "finished", b) });
    const result = await waitForFinished(opts({ mode: "all", ...time }));
    expect(result.finished.map((i) => i.lane)).toEqual(["a", "b"]);
  });

  it("times out without acking anything", async () => {
    lane("a", "running");
    const done = lane("b", "finished");
    const time = fakeTime();
    const result = await waitForFinished(opts({ mode: "all", timeoutMs: 2500, ...time }));
    expect(result).toEqual({ finished: [], timedOut: true });
    expect(time.clock.now()).toBe(2500);
    expect(existsSync(join(root, "b", `attempt-${done}`, "acked"))).toBe(false);
    expect(existsSync(ackedFile(root, "b"))).toBe(false);
  });

  it("any: times out when nothing finishes", async () => {
    lane("a", "running");
    expect(await waitForFinished(opts({ mode: "any", timeoutMs: 0 }))).toEqual({ finished: [], timedOut: true });
  });

  it("does not return the same finish twice", async () => {
    lane("a", "finished");
    expect((await waitForFinished(opts({ mode: "any" }))).finished).toHaveLength(1);
    expect(await waitForFinished(opts({ mode: "any", timeoutMs: 3000 }))).toEqual({ finished: [], timedOut: true });
    // all mode is satisfied (everything is finished) but has nothing new to say.
    expect(await waitForFinished(opts({ mode: "all" }))).toEqual({ finished: [], timedOut: false });
  });

  it("leaves a finish acked by a concurrent waiter to that waiter", async () => {
    lane("a", "finished");
    const b = lane("b", "running");
    const time = fakeTime({ 1: () => setState("b", "finished", b) });
    // The liveness check for "b" runs after "a" was listed: another waiter acks "a" right then.
    let raced = false;
    const racingAlive = (pid: number): boolean => {
      if (!raced) raced = ack(root, "a", 1);
      return alive(pid);
    };
    const result = await waitForFinished(opts({ mode: "any", alive: racingAlive, ...time }));
    expect(raced).toBe(true);
    expect(result.finished.map((i) => i.lane)).toEqual(["b"]);
  });

  it("refuses unknown or invalid lane names", async () => {
    await expect(waitForFinished(opts({ lanes: ["missing"] }))).rejects.toThrow(ArbabError);
    await expect(waitForFinished(opts({ lanes: ["../x"] }))).rejects.toThrow(ArbabError);
  });
});
