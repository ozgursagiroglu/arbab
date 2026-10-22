import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  fakePs,
  fixture,
  FIXTURE_RESET_SEC,
  makeProject,
  mustGit,
  testDeps,
  until,
  type TestProject,
} from "../../test/fake-claude/harness";
import { defaultConfig } from "../config";
import { resetQuota } from "../quota";
import { ack, attemptFiles, listProjects, listShepherds, pendingFinished, readLaneEvents } from "../registry";
import { writerLockKey } from "../run";
import type { AttemptExit, AttemptStarted, AttemptSummary, LaneSpec, LaneStateRecord, RateLimitSnapshot } from "../types";
import { isAlive, sendSignal } from "../util/proc";
import { CONTINUATION_PROMPT, runShepherd, type ShepherdDeps } from "./index";
import { ignoreEntries, resetSince, slotCap, usageLimitResetsAt } from "./lifecycle";

let project: TestProject;

beforeEach(() => {
  project = makeProject();
});
afterEach(() => {
  project.cleanup();
});

const never = (): AbortSignal => new AbortController().signal;
const runDir = (lane: string): string => join(project.root, ".arbab", "runs", lane);
const attemptDir = (lane: string, n: number): string => join(runDir(lane), `attempt-${n}`);
const readJsonFile = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
// The worker's pid as the shepherd recorded it at spawn. The fake's own log line comes later (after stdin, the touch and
// any child), so under load a kill can land before it is written.
const startedPid = (lane: string, n = 1): number => readJsonFile<AttemptStarted>(attemptFiles(attemptDir(lane, n)).started).pid;
const stateOf = (lane: string): LaneStateRecord | undefined => {
  try {
    return readJsonFile<LaneStateRecord>(join(runDir(lane), "state.json"));
  } catch {
    return undefined;
  }
};
const attempts = (lane: string): string[] => readdirSync(runDir(lane)).filter((n) => n.startsWith("attempt-")).sort();
const poolEntries = (...parts: string[]): string[] => {
  const dir = join(project.home, ...parts);
  return existsSync(dir) ? readdirSync(dir) : [];
};
const lockEntries = (): string[] =>
  poolEntries("locks").flatMap((key) => readdirSync(join(project.home, "locks", key)));

/** A spawn that also writes the session registration and a transcript, as Claude Code would. */
function registeringSpawn(): ShepherdDeps["spawnImpl"] {
  return (command, args, options) => {
    const child = spawn(command, args, options);
    const i = args.indexOf("--session-id");
    const session = i === -1 ? args[args.indexOf("--resume") + 1] : args[i + 1];
    mkdirSync(join(project.claudeHome, "sessions"), { recursive: true });
    writeFileSync(
      join(project.claudeHome, "sessions", `${child.pid}.json`),
      JSON.stringify({ pid: child.pid, kind: "sdk", entrypoint: "sdk-cli", name: "m1-a", cwd: "/elsewhere" }),
    );
    mkdirSync(join(project.claudeHome, "projects", "-work-repo"), { recursive: true });
    writeFileSync(
      join(project.claudeHome, "projects", "-work-repo", `${session}.jsonl`),
      `${JSON.stringify({ type: "assistant", effort: "high" })}\n${JSON.stringify({ type: "assistant", effort: "high" })}\n`,
    );
    return child;
  };
}

describe("runShepherd", () => {
  it("runs a successful lane and writes every attempt file and a checkpoint", async () => {
    project.scenario({ fixture: fixture("success-report"), touch: "src/a.ts" });
    project.lane({ name: "m1-a" });
    const deps = testDeps(project, { spawnImpl: registeringSpawn() });

    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, deps, never())).toBe("success");

    const files = attemptFiles(attemptDir("m1-a", 1));
    for (const f of [files.brief, files.settings, files.args, files.started, files.stream, files.stderr, files.registration, files.exit, files.summary, files.report]) {
      expect(existsSync(f), f).toBe(true);
    }
    expect(attempts("m1-a")).toEqual(["attempt-1"]);

    const started = readJsonFile<AttemptStarted>(files.started);
    const exit = readJsonFile<AttemptExit>(files.exit);
    const summary = readJsonFile<AttemptSummary>(files.summary);
    const [call] = project.calls();
    expect(call?.argv).toEqual(expect.arrayContaining(["--session-id", started.sessionId, "-n", "m1-a"]));
    expect(started.args).toEqual(call?.argv.map((a, i, all) => (all[i - 1] === "--json-schema" ? "<schema>" : a)));
    expect(readJsonFile<string[]>(files.args)).toEqual(started.args);
    expect(started.args).toContain("<schema>");
    expect(started.binary.version).toBe("2.1.295");
    expect(started.resume).toBe(false);
    expect(call?.envKeys).toContain("FAKE_CLAUDE_SCENARIO");
    expect(call?.envKeys).not.toContain("HOST_ONLY_SECRET");
    expect(started.envKeys).not.toContain("HOST_ONLY_SECRET");
    expect(call?.cwd).toBe(started.cwd);

    // The brief inlines the project rules and the source sections.
    const brief = readFileSync(files.brief, "utf8");
    expect(brief).toContain("## Project rules");
    expect(brief).toContain("Keep it small.");
    expect(brief).toContain("Edit `src/a.ts`.");
    expect(call?.stdinBytes).toBe(Buffer.byteLength(brief));

    const settings = readJsonFile<{ env: Record<string, string> }>(files.settings);
    expect(settings.env["XDG_CONFIG_HOME"]).toBe(join(started.cwd, ".arbab-tmp", "xdg-config"));
    for (const dir of ["xdg-config", "yarn-cache", "inputs", "npmrc"]) {
      expect(existsSync(join(started.cwd, ".arbab-tmp", dir)), dir).toBe(true);
    }
    expect(settings.env["XDG_DATA_HOME"]).toBeUndefined();
    expect(settings.env["XDG_CACHE_HOME"]).toBeUndefined();

    expect(exit.killedBy).toBeNull();
    expect(exit.exitCode).toBe(0);
    expect(exit.checkpoint).toMatch(/^[0-9a-f]{40}$/);
    expect(mustGit(project.git, ["rev-parse", "HEAD"], started.cwd).trim()).toBe(exit.checkpoint);
    expect(mustGit(project.git, ["show", "--name-only", "--format=%s", "HEAD"], started.cwd)).toContain("src/a.ts");
    expect(mustGit(project.git, ["status", "--porcelain"], started.cwd)).toBe("");

    expect(summary.state).toBe("success");
    expect(summary.reportValid).toBe(true);
    expect(summary.costUsd).toBe(1.25);
    expect(summary.costDeltaUsd).toBe(1.25);
    expect(summary.measuredEffort).toEqual({ high: 2 });
    expect(summary.registration).toEqual({ kind: "sdk", entrypoint: "sdk-cli", name: "m1-a" });
    expect(readJsonFile<{ summary: string }>(files.report).summary).toBe("edited src/a.ts");

    const state = stateOf("m1-a");
    expect(state).toMatchObject({ state: "finished", endState: "success", attempt: 1, shepherdPid: process.pid });
    expect(readJsonFile<{ pid: number }>(join(runDir("m1-a"), "shepherd.json")).pid).toBe(process.pid);
    expect(readJsonFile<RateLimitSnapshot>(join(project.home, "quota.json")).fiveHour?.utilization).toBe(0.2);
    expect(poolEntries("slots")).toEqual([]);
    expect(lockEntries()).toEqual([]);
    // .arbab/ as a whole is ignored through info/exclude, and ESLint's cascade stops there.
    const exclude = readFileSync(join(project.root, ".git", "info", "exclude"), "utf8");
    expect(exclude.split("\n")).toContain(".arbab/");
    expect(exclude.split("\n")).toContain(".arbab-tmp/");
    expect(readJsonFile<{ root: boolean }>(join(project.root, ".arbab", ".eslintrc.json"))).toEqual({ root: true });
  });

  it("waits out a usage limit and resumes the same session to success", async () => {
    project.scenario({ fixture: "usage-limit", resumeFixture: fixture("resume-success"), touch: "src/a.ts" });
    project.lane({ name: "m1-a" });
    const seen: LaneStateRecord[] = [];
    const deps = testDeps(project);
    const sleep = deps.sleep;
    deps.sleep = (ms) => {
      const s = stateOf("m1-a");
      if (s !== undefined && ms >= 1_000) seen.push(s);
      return sleep(ms);
    };

    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, deps, never())).toBe("success");

    expect(attempts("m1-a")).toEqual(["attempt-1", "attempt-2"]);
    const first = readJsonFile<AttemptStarted>(attemptFiles(attemptDir("m1-a", 1)).started);
    const second = readJsonFile<AttemptStarted>(attemptFiles(attemptDir("m1-a", 2)).started);
    expect(second.resume).toBe(true);
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.binary).toEqual(first.binary);
    const calls = project.calls();
    expect(calls[1]?.argv).toEqual(expect.arrayContaining(["--resume", first.sessionId]));
    expect(calls[1]?.argv).not.toContain("--session-id");
    expect(readFileSync(attemptFiles(attemptDir("m1-a", 2)).brief, "utf8")).toBe(`${CONTINUATION_PROMPT}\n`);

    const s1 = readJsonFile<AttemptSummary>(attemptFiles(attemptDir("m1-a", 1)).summary);
    const s2 = readJsonFile<AttemptSummary>(attemptFiles(attemptDir("m1-a", 2)).summary);
    expect(s1.state).toBe("usage-limit");
    expect(s2.state).toBe("success");
    expect(s2.costDeltaUsd).toBeCloseTo(6.32 - 4.82);
    expect(readJsonFile<AttemptExit>(attemptFiles(attemptDir("m1-a", 1)).exit).checkpoint).toMatch(/^[0-9a-f]{40}$/);

    // resetsAt + 60 s + jitter (random 0.5 → 30 s).
    const waiting = seen.find((s) => s.state === "waiting-reset");
    expect(waiting).toMatchObject({ attempt: 1, until: FIXTURE_RESET_SEC + 90 });
    expect(stateOf("m1-a")).toMatchObject({ state: "finished", endState: "success", attempt: 2 });
  });

  /**
   * Runs a usage-limited lane to its resumed success; `onWaiting` runs once, at the first poll in waiting-reset, and
   * returns the clock then. Returns that time and when the second attempt started (both epoch ms).
   */
  const waitingRun = async (onWaiting: (nowMs: number) => void): Promise<{ changedAt: number; resumedAt: number; until: number }> => {
    project.scenario({ fixture: "usage-limit", resumeFixture: fixture("resume-success") });
    project.lane({ name: "m1-a" });
    const deps = testDeps(project);
    const sleep = deps.sleep;
    let changedAt: number | null = null;
    let until: number | null = null;
    deps.sleep = (ms) => {
      const s = stateOf("m1-a");
      if (changedAt === null && s?.state === "waiting-reset") {
        changedAt = deps.clock.now();
        until = (s.until ?? 0) * 1000;
        onWaiting(changedAt);
      }
      return sleep(ms);
    };
    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, deps, never())).toBe("success");
    expect(changedAt).not.toBeNull();
    const resumedAt = Date.parse(readJsonFile<AttemptStarted>(attemptFiles(attemptDir("m1-a", 2)).started).startedAt);
    return { changedAt: changedAt ?? 0, resumedAt, until: until ?? 0 };
  };
  const quotaFile = (): string => join(project.home, "quota.json");
  const freshSnapshot = (nowMs: number, utilization: number, status = "allowed"): RateLimitSnapshot => ({
    observedAt: new Date(nowMs + 1).toISOString(),
    status,
    type: "five_hour",
    fiveHour: { utilization, resetsAt: Math.floor(nowMs / 1000) + 18_000 },
    sevenDay: null,
  });

  it("resumes a usage-limited lane at the next poll once arbab quota --reset runs (an account switch)", async () => {
    const run = await waitingRun((now) => resetQuota(project.home, { now: () => now + 1 }));
    expect(run.until).toBe((FIXTURE_RESET_SEC + 90) * 1000);
    // One hold poll (60 s), not the hour until the old account's reset.
    expect(run.resumedAt - run.changedAt).toBeLessThanOrEqual(60_000 + 5_000);
    expect(run.resumedAt).toBeLessThan(run.until - 3_000_000);
    expect(stateOf("m1-a")).toMatchObject({ state: "finished", endState: "success", attempt: 2 });
  });

  it("resumes early on a reset after the limited attempt began, even one from before the wait", async () => {
    let resetAt = 0;
    const run = await waitingRun((now) => {
      // The human switched accounts while the attempt was still finishing (its checkpoint, say).
      resetAt = Date.parse(readJsonFile<AttemptStarted>(attemptFiles(attemptDir("m1-a", 1)).started).startedAt) + 1;
      expect(resetAt).toBeLessThan(now);
      resetQuota(project.home, { now: () => resetAt });
    });
    expect(run.resumedAt - run.changedAt).toBeLessThanOrEqual(60_000 + 5_000);
    expect(run.resumedAt).toBeLessThan(run.until - 3_000_000);
  });

  it("does not resume early on a reset from before the limited attempt began", async () => {
    const run = await waitingRun(() => resetQuota(project.home, { now: () => (FIXTURE_RESET_SEC - 3600) * 1000 }));
    expect(run.resumedAt).toBeGreaterThanOrEqual(run.until);
  });

  it("does not resume early on a newer snapshot that no longer holds: it may be another lane's limit", async () => {
    const run = await waitingRun((now) => writeFileSync(quotaFile(), JSON.stringify(freshSnapshot(now, 0.1))));
    expect(run.resumedAt).toBeGreaterThanOrEqual(run.until);
  });

  it("does not resume early when the snapshot alone disappears", async () => {
    const run = await waitingRun(() => rmSync(quotaFile(), { force: true }));
    expect(run.resumedAt).toBeGreaterThanOrEqual(run.until);
  });

  it("keeps waiting for the reset while a newer snapshot still holds", async () => {
    const run = await waitingRun((now) => writeFileSync(quotaFile(), JSON.stringify(freshSnapshot(now, 1, "rejected"))));
    expect(run.resumedAt).toBeGreaterThanOrEqual(run.until);
  });

  it("does not resume a usage limit once maxAttempts is reached", async () => {
    project.scenario({ fixture: "usage-limit" });
    project.lane({ name: "m1-a", maxAttempts: 1 });
    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project), never())).toBe("usage-limit");
    expect(attempts("m1-a")).toEqual(["attempt-1"]);
  });

  it("kills a worker that hangs after its result, reaps its child, and keeps the result's end state", async () => {
    project.scenario({ fixture: fixture("success-report"), hangMs: -1, spawnChild: true });
    project.lane({ name: "m1-a", wallMin: 600, idleMin: 120 });
    // Every 20 ms tick is a virtual minute, so the 15-minute hang rule fires in well under a second.
    const deps = testDeps(project, {}, 60_000);

    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, deps, never())).toBe("success");

    const [call] = project.calls();
    const child = call?.childPid as number;
    const exit = readJsonFile<AttemptExit>(attemptFiles(attemptDir("m1-a", 1)).exit);
    expect(exit.killedBy).toBe("hang-after-result");
    expect(exit.signal).toBe("SIGTERM");
    expect(exit.reaped).toContain(child);
    expect(isAlive(call?.pid as number)).toBe(false);
    await until(() => (isAlive(child) ? undefined : true), 5_000);
    expect(readJsonFile<AttemptSummary>(attemptFiles(attemptDir("m1-a", 1)).summary).state).toBe("success");
  });

  it("auto-resumes a worker that hit the usage limit and then hung", async () => {
    project.scenario({ fixture: "usage-limit", resumeFixture: fixture("resume-success"), hangMs: -1 });
    project.lane({ name: "m1-a", wallMin: 600, idleMin: 120 });
    const deps = testDeps(project, {}, 60_000);

    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, deps, never())).toBe("success");
    expect(attempts("m1-a")).toEqual(["attempt-1", "attempt-2"]);
    expect(readJsonFile<AttemptExit>(attemptFiles(attemptDir("m1-a", 1)).exit).killedBy).toBe("hang-after-error");
    expect(readJsonFile<AttemptSummary>(attemptFiles(attemptDir("m1-a", 1)).summary).state).toBe("usage-limit");
    expect(readJsonFile<AttemptStarted>(attemptFiles(attemptDir("m1-a", 2)).started).resume).toBe(true);
  });

  it("reaps a child left in the worker's process group by a worker that exits normally", async () => {
    project.scenario({ fixture: fixture("success-report"), spawnChild: "group", lineDelayMs: 20 });
    project.lane({ name: "m1-a" });
    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project), never())).toBe("success");
    const child = project.calls()[0]?.childPid as number;
    const exit = readJsonFile<AttemptExit>(attemptFiles(attemptDir("m1-a", 1)).exit);
    expect(exit.killedBy).toBeNull();
    expect(exit.reaped).toEqual([child]);
    await until(() => (isAlive(child) ? undefined : true), 5_000);
  });

  it("never signals a tracked pid that a fresh snapshot no longer places in the worker's tree", async () => {
    // 99999901 cannot be a real pid. It shows up as the worker's child, then as a process under init in a group of
    // its own: what a recycled pid looks like.
    const STRANGER = 99_999_901;
    project.scenario({ fixture: "truncated", hangMs: -1 });
    project.lane({ name: "m1-a", wallMin: 600, idleMin: 5 });
    let reads = 0;
    const real = fakePs(project);
    const readPs = (): string => {
      const call = project.calls()[0];
      reads += 1;
      if (call === undefined) return real();
      const row = reads < 3 ? `${STRANGER} ${call.pid} ${STRANGER}` : `${STRANGER} 1 ${STRANGER}`;
      return `${real()}\n${row}`;
    };
    const signalled: number[] = [];
    const deps = testDeps(
      project,
      {
        readPs,
        signal: (target, sig) => {
          signalled.push(target);
          return target === STRANGER ? true : sendSignal(target, sig);
        },
      },
      60_000,
    );

    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, deps, never())).toBe("killed:idle");
    const pid = startedPid("m1-a");
    expect(reads).toBeGreaterThan(3);
    expect(signalled).toContain(-pid);
    expect(signalled).not.toContain(STRANGER);
    expect(readJsonFile<AttemptExit>(attemptFiles(attemptDir("m1-a", 1)).exit).reaped).not.toContain(STRANGER);
  });

  it("signals only the process group when ps is refused", async () => {
    project.scenario({ fixture: "truncated", hangMs: -1, spawnChild: true });
    project.lane({ name: "m1-a", wallMin: 600, idleMin: 5 });
    const signalled: number[] = [];
    const deps = testDeps(
      project,
      {
        readPs: () => {
          throw Object.assign(new Error("ps: EPERM"), { code: "EPERM" });
        },
        signal: (target, sig) => {
          signalled.push(target);
          return sendSignal(target, sig);
        },
      },
      60_000,
    );
    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, deps, never())).toBe("killed:idle");
    const pid = startedPid("m1-a");
    expect(new Set(signalled)).toEqual(new Set([-pid]));
  });

  it("kills an idle worker", async () => {
    project.scenario({ fixture: "truncated", hangMs: -1 });
    project.lane({ name: "m1-a", wallMin: 600, idleMin: 5 });
    const deps = testDeps(project, {}, 60_000);
    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, deps, never())).toBe("killed:idle");
    expect(readJsonFile<AttemptExit>(attemptFiles(attemptDir("m1-a", 1)).exit).killedBy).toBe("idle");
  });

  it("kills a worker past its wall clock", async () => {
    project.scenario({ fixture: "truncated", hangMs: -1 });
    project.lane({ name: "m1-a", wallMin: 3, idleMin: 100 });
    const deps = testDeps(project, {}, 60_000);
    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, deps, never())).toBe("killed:wall");
    const exit = readJsonFile<AttemptExit>(attemptFiles(attemptDir("m1-a", 1)).exit);
    expect(exit.killedBy).toBe("wall");
    expect(isAlive(startedPid("m1-a"))).toBe(false);
  });

  it("holds while the quota is above the threshold and starts once quota.json says otherwise", async () => {
    const nowSec = FIXTURE_RESET_SEC - 3600;
    const snapshot = (utilization: number): RateLimitSnapshot => ({
      observedAt: new Date(nowSec * 1000).toISOString(),
      status: "allowed_warning",
      type: "five_hour",
      fiveHour: { utilization, resetsAt: nowSec + 7200 },
      sevenDay: null,
    });
    mkdirSync(project.home, { recursive: true });
    writeFileSync(join(project.home, "quota.json"), JSON.stringify(snapshot(0.9)));
    project.scenario({ fixture: fixture("success-report") });
    project.lane({ name: "m1-a" });
    const deps = testDeps(project, { holdPollMs: 30 });

    const done = runShepherd(project.root, "m1-a", { kind: "start" }, deps, never());
    const held = await until(() => (stateOf("m1-a")?.state === "held" ? stateOf("m1-a") : undefined));
    expect(held.reason).toMatch(/five-hour window at 90%/);
    expect(held.until).toBe(nowSec + 7200);
    expect(existsSync(attemptDir("m1-a", 1))).toBe(false);

    writeFileSync(join(project.home, "quota.json"), JSON.stringify(snapshot(0.5)));
    expect(await done).toBe("success");
  });

  it("waits for a free slot", async () => {
    project.cleanup();
    project = makeProject({ maxParallel: 1 });
    mkdirSync(join(project.home, "slots"), { recursive: true });
    const other = { pid: process.pid, lane: "other", project: "/elsewhere", createdAt: new Date().toISOString() };
    writeFileSync(join(project.home, "slots", "0.json"), JSON.stringify(other));
    project.scenario({ fixture: fixture("success-report") });
    project.lane({ name: "m1-a" });
    const deps = testDeps(project, { slotPollMs: 30 });

    const done = runShepherd(project.root, "m1-a", { kind: "start" }, deps, never());
    const held = await until(() => (stateOf("m1-a")?.state === "held" ? stateOf("m1-a") : undefined));
    expect(held.reason).toBe("no free slot");
    await new Promise((d) => setTimeout(d, 100));
    expect(project.calls()).toEqual([]);

    rmSync(join(project.home, "slots", "0.json"));
    expect(await done).toBe("success");
    expect(poolEntries("slots")).toEqual([]);
  });

  it("stops a running worker through the abort signal", async () => {
    project.scenario({ fixture: "truncated", hangMs: -1 });
    project.lane({ name: "m1-a" });
    const stop = new AbortController();
    const done = runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project), stop.signal);
    await until(() => (project.calls().length > 0 ? true : undefined));
    stop.abort();

    expect(await done).toBe("killed:stopped");
    const exit = readJsonFile<AttemptExit>(attemptFiles(attemptDir("m1-a", 1)).exit);
    expect(exit.killedBy).toBe("stopped");
    expect(isAlive(startedPid("m1-a"))).toBe(false);
    expect(stateOf("m1-a")).toMatchObject({ state: "finished", endState: "killed:stopped" });
    expect(poolEntries("slots")).toEqual([]);
    expect(lockEntries()).toEqual([]);
  });

  it("stops while held, before any attempt", async () => {
    project.cleanup();
    project = makeProject({ maxParallel: 1 });
    mkdirSync(join(project.home, "slots"), { recursive: true });
    const other = { pid: process.pid, lane: "other", project: "/elsewhere", createdAt: new Date().toISOString() };
    writeFileSync(join(project.home, "slots", "0.json"), JSON.stringify(other));
    project.scenario({ fixture: fixture("success-report") });
    project.lane({ name: "m1-a" });
    const stop = new AbortController();
    const done = runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project, { slotPollMs: 60_000 }), stop.signal);
    await until(() => (stateOf("m1-a")?.state === "held" ? true : undefined));
    stop.abort();
    expect(await done).toBe("killed:stopped");
    expect(attempts("m1-a")).toEqual([]);
    expect(poolEntries("slots")).toEqual(["0.json"]);
  });

  it("fails a resume when the pinned binary changed version", async () => {
    project.scenario({ fixture: "usage-limit", resumeFixture: fixture("resume-success") });
    project.lane({ name: "m1-a" });
    let versionCalls = 0;
    const deps = testDeps(project);
    const run = deps.run;
    deps.run = (path, args) => {
      versionCalls++;
      return versionCalls === 1 ? run(path, args) : "2.1.296 (Claude Code)\n";
    };

    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, deps, never())).toBe("failed");
    expect(attempts("m1-a")).toEqual(["attempt-1"]);
    const state = stateOf("m1-a");
    expect(state).toMatchObject({ state: "finished", endState: "failed", attempt: 1 });
    expect(state?.reason).toMatch(/binary changed since the attempt this one resumes: .* reports 2\.1\.296, not 2\.1\.295/);
    expect(poolEntries("slots")).toEqual([]);
  });

  it("fails setup on a bad base ref and releases the slot", async () => {
    project.scenario({ fixture: fixture("success-report") });
    project.lane({ name: "m1-a", base: "no-such-branch" });
    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project), never())).toBe("failed");
    const state = stateOf("m1-a");
    expect(state).toMatchObject({ state: "finished", endState: "failed", attempt: 0 });
    expect(state?.reason).toMatch(/git worktree add/);
    expect(attempts("m1-a")).toEqual([]);
    expect(project.calls()).toEqual([]);
    expect(poolEntries("slots")).toEqual([]);
  });

  it("fails setup when the dependency command fails", async () => {
    project.cleanup();
    project = makeProject({ dependencies: { strategy: "command", command: [process.execPath, "-e", "console.log('no lockfile'); process.exit(4)"] } });
    project.scenario({ fixture: fixture("success-report") });
    project.lane({ name: "m1-a" });
    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project), never())).toBe("failed");
    expect(stateOf("m1-a")?.reason).toBe("dependencies failed (4): no lockfile");
  });

  it("fails when lane.json is missing or names another lane", async () => {
    mkdirSync(runDir("m1-a"), { recursive: true });
    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project), never())).toBe("failed");
    expect(stateOf("m1-a")?.reason).toMatch(/does not exist/);

    project.lane({ name: "m1-b" });
    writeFileSync(join(runDir("m1-a"), "lane.json"), readFileSync(join(runDir("m1-b"), "lane.json")));
    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project), never())).toBe("failed");
    expect(stateOf("m1-a")?.reason).toMatch(/names lane m1-b/);
  });

  it("rejects an invalid lane name before touching anything", async () => {
    await expect(runShepherd(project.root, "../x", { kind: "start" }, testDeps(project), never())).rejects.toThrow(/lane/);
  });

  it("resumes manually with a prompt, and starts fresh with a new session", async () => {
    project.scenario({ fixture: fixture("success-report"), resumeFixture: fixture("resume-success") });
    project.lane({ name: "m1-a" });
    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project), never())).toBe("success");
    expect(
      await runShepherd(project.root, "m1-a", { kind: "resume", prompt: "Also fix the README." }, testDeps(project), never()),
    ).toBe("success");
    expect(await runShepherd(project.root, "m1-a", { kind: "fresh" }, testDeps(project), never())).toBe("success");

    const started = [1, 2, 3].map((n) => readJsonFile<AttemptStarted>(attemptFiles(attemptDir("m1-a", n)).started));
    const summaries = [1, 2, 3].map((n) => readJsonFile<AttemptSummary>(attemptFiles(attemptDir("m1-a", n)).summary));
    expect(started[1]?.sessionId).toBe(started[0]?.sessionId);
    expect(started[2]?.sessionId).not.toBe(started[0]?.sessionId);
    expect(started[2]?.resume).toBe(false);
    expect(readFileSync(attemptFiles(attemptDir("m1-a", 2)).brief, "utf8")).toBe("Also fix the README.\n");
    expect(readFileSync(attemptFiles(attemptDir("m1-a", 3)).brief, "utf8")).toContain("## Project rules");
    expect(summaries[1]?.costDeltaUsd).toBeCloseTo(6.32 - 1.25);
    // A fresh session's cost starts over.
    expect(summaries[2]?.costDeltaUsd).toBe(1.25);
    expect(stateOf("m1-a")).toMatchObject({ state: "finished", endState: "success", attempt: 3 });
  });

  it("works in another lane's worktree and refuses one that does not exist", async () => {
    project.scenario({ fixture: fixture("success-report"), touch: "src/b.ts" });
    project.lane({ name: "m1-a" });
    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project), never())).toBe("success");
    project.lane({ name: "m1-v", role: "verifier", worktree: "m1-a" });
    expect(await runShepherd(project.root, "m1-v", { kind: "start" }, testDeps(project), never())).toBe("success");
    const a = readJsonFile<AttemptStarted>(attemptFiles(attemptDir("m1-a", 1)).started);
    const v = readJsonFile<AttemptStarted>(attemptFiles(attemptDir("m1-v", 1)).started);
    expect(v.cwd).toBe(a.cwd);

    project.lane({ name: "m1-w", role: "verifier", worktree: "m1-none" });
    expect(await runShepherd(project.root, "m1-w", { kind: "start" }, testDeps(project), never())).toBe("failed");
    expect(stateOf("m1-w")?.reason).toMatch(/m1-none's worktree, which does not exist/);
  });

  it("refuses to borrow a worktree whose owner never ran an attempt there, leaving it as it is", async () => {
    // The owner's setup fails before its first attempt (a missing merge branch, after the worktree exists).
    project.lane({ name: "m1-a", mergeBranches: ["arbab/none"] });
    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project), never())).toBe("failed");
    const worktree = join(project.root, ".arbab", "worktrees", "m1-a");
    expect(existsSync(worktree)).toBe(true);
    writeFileSync(join(worktree, "left.txt"), "left behind\n");
    project.lane({ name: "m1-v", role: "verifier", worktree: "m1-a" });
    expect(await runShepherd(project.root, "m1-v", { kind: "start" }, testDeps(project), never())).toBe("failed");
    expect(stateOf("m1-v")?.reason).toMatch(/m1-a's worktree, where no attempt has run yet; launch m1-a first/);
    expect(readFileSync(join(worktree, "left.txt"), "utf8")).toBe("left behind\n");
  });

  it("leases resources, exports them to the worker settings and releases them", async () => {
    project.cleanup();
    project = makeProject({ resources: { port: { range: [41000, 41010] } }, semaphores: { "test-db": 1 } });
    project.scenario({ fixture: fixture("success-report") });
    project.lane({ name: "m1-a", resources: { port: 2 }, semaphores: ["test-db"] });
    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project), never())).toBe("success");
    const started = readJsonFile<AttemptStarted>(attemptFiles(attemptDir("m1-a", 1)).started);
    expect(started.leases.map((l) => l.value)).toEqual([41000, 41001]);
    const settings = readJsonFile<{ env: Record<string, string> }>(attemptFiles(attemptDir("m1-a", 1)).settings);
    expect(settings.env).toMatchObject({ ARBAB_PORT_0: "41000", ARBAB_PORT_1: "41001" });
    expect(readFileSync(attemptFiles(attemptDir("m1-a", 1)).brief, "utf8")).toContain("ARBAB_PORT_0");
    expect(poolEntries("leases", "port")).toEqual([]);
    expect(poolEntries("semaphores", "test-db")).toEqual([]);
  });

  it("waits for the writer lock held by another worker", async () => {
    project.scenario({ fixture: fixture("success-report") });
    project.lane({ name: "m1-a" });
    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project), never())).toBe("success");
    const cwd = readJsonFile<AttemptStarted>(attemptFiles(attemptDir("m1-a", 1)).started).cwd;
    const lock = join(project.home, "locks", writerLockKey(cwd), "0.json");
    mkdirSync(join(lock, ".."), { recursive: true });
    writeFileSync(lock, JSON.stringify({ pid: process.pid, lane: "other", project: "/elsewhere", createdAt: new Date().toISOString() }));

    const done = runShepherd(project.root, "m1-a", { kind: "fresh" }, testDeps(project, { slotPollMs: 30 }), never());
    const waiting = await until(() => (stateOf("m1-a")?.reason === "waiting for the writer lock" ? stateOf("m1-a") : undefined));
    expect(waiting.state).toBe("preparing");
    rmSync(lock);
    expect(await done).toBe("success");
  });

  it("creates a new worktree only once it holds the writer lock, so no other lane can change it before it is prepared", async () => {
    project.scenario({ fixture: fixture("success-report") });
    project.lane({ name: "m1-a" });
    const worktreeRoot = join(project.root, ".arbab", "worktrees");
    mkdirSync(worktreeRoot, { recursive: true });
    const worktree = join(realpathSync(worktreeRoot), "m1-a");
    const lock = join(project.home, "locks", writerLockKey(worktree), "0.json");
    mkdirSync(join(lock, ".."), { recursive: true });
    writeFileSync(lock, JSON.stringify({ pid: process.pid, lane: "other", project: "/elsewhere", createdAt: new Date().toISOString() }));

    const done = runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project, { slotPollMs: 30 }), never());
    await until(() => (stateOf("m1-a")?.reason === "waiting for the writer lock" ? true : undefined));
    // Before this rule the worktree existed here, with nothing stopping a borrower's setup from changing it.
    expect(existsSync(worktree)).toBe(false);
    rmSync(lock);
    expect(await done).toBe("success");
    expect(readJsonFile<AttemptStarted>(attemptFiles(attemptDir("m1-a", 1)).started).cwd).toBe(worktree);
  });

  it("records a relaunch that fails before its attempt with attempt 0, so wait reports it", async () => {
    project.scenario({ fixture: fixture("success-report") });
    project.lane({ name: "m1-a" });
    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project), never())).toBe("success");
    expect(ack(join(project.root, ".arbab", "runs"), "m1-a", 1)).toBe(true);

    project.lane({ name: "m1-a", schema: "lanes/missing-schema.json" });
    expect(await runShepherd(project.root, "m1-a", { kind: "fresh" }, testDeps(project), never())).toBe("failed");
    expect(stateOf("m1-a")).toMatchObject({ state: "finished", endState: "failed", attempt: 0 });
    const pending = pendingFinished(join(project.root, ".arbab", "runs"), ["m1-a"], isAlive);
    expect(pending).toEqual([expect.objectContaining({ lane: "m1-a", attempt: null, endState: "failed", reason: expect.stringMatching(/schema/) })]);
  });

  it("refuses an attempt whose compiled profile has lint errors", async () => {
    project.scenario({ fixture: fixture("success-report") });
    project.lane({ name: "m1-a", allow: ["Bash"] });
    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project), never())).toBe("failed");
    const state = stateOf("m1-a");
    expect(state).toMatchObject({ state: "finished", endState: "failed", attempt: 0 });
    expect(state?.reason?.split(", ")).toContain("bare-bash-allow");
    expect(attempts("m1-a")).toEqual([]);
    expect(project.calls()).toEqual([]);
  });

  it("does not checkpoint when the worker moved its worktree's HEAD, and leaves main alone", async () => {
    project.scenario({ fixture: fixture("success-report"), touch: "src/a.ts" });
    project.lane({ name: "m1-a" });
    const main = mustGit(project.git, ["rev-parse", "main"], project.root).trim();
    // What a worker that can write the private git dir would do, done at spawn time.
    const spawnImpl: ShepherdDeps["spawnImpl"] = (command, args, options) => {
      writeFileSync(join(project.root, ".git", "worktrees", "m1-a", "HEAD"), "ref: refs/heads/main\n");
      return spawn(command, args, options);
    };
    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project, { spawnImpl }), never())).toBe("success");
    const exit = readJsonFile<AttemptExit>(attemptFiles(attemptDir("m1-a", 1)).exit);
    expect(exit.checkpoint).toBeNull();
    expect(exit.checkpointError).toMatch(/^checkpoint skipped: HEAD of .* is "ref: refs\/heads\/main", not ref: refs\/heads\/arbab\/m1-a$/);
    expect(mustGit(project.git, ["rev-parse", "main"], project.root).trim()).toBe(main);
  });

  it("runs the dependency command only in a worktree it created, holding the writer lock", async () => {
    project.cleanup();
    const script =
      "const fs = require('fs'); const [count, locks] = process.argv.slice(1); fs.appendFileSync(count, 'x');" +
      "process.exit(fs.existsSync(locks) && fs.readdirSync(locks).length > 0 ? 0 : 7)";
    const dir = mkdtempSync(join(tmpdir(), "arbab-deps-"));
    const count = join(dir, "count");
    try {
      project = makeProject({ dependencies: { strategy: "command", command: [process.execPath, "-e", script, count, "LOCKS"] } });
      const config = JSON.parse(readFileSync(join(project.root, "arbab.config.json"), "utf8")) as { dependencies: { command: string[] } };
      config.dependencies.command[4] = join(project.home, "locks");
      writeFileSync(join(project.root, "arbab.config.json"), JSON.stringify(config));
      project.scenario({ fixture: fixture("success-report"), touch: "package.json" });
      project.lane({ name: "m1-a" });

      expect(await runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project), never())).toBe("success");
      expect(readFileSync(count, "utf8")).toBe("x");
      expect(await runShepherd(project.root, "m1-a", { kind: "fresh" }, testDeps(project), never())).toBe("success");
      project.lane({ name: "m1-v", role: "verifier", worktree: "m1-a" });
      expect(await runShepherd(project.root, "m1-v", { kind: "start" }, testDeps(project), never())).toBe("success");
      expect(readFileSync(count, "utf8")).toBe("x");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails setup, installing nothing, when the worktree is gone and its branch holds worker commits", async () => {
    project.cleanup();
    const dir = mkdtempSync(join(tmpdir(), "arbab-deps-"));
    const count = join(dir, "count");
    try {
      const script = "require('fs').appendFileSync(process.argv[1], 'x')";
      project = makeProject({ dependencies: { strategy: "command", command: [process.execPath, "-e", script, count] } });
      project.scenario({ fixture: fixture("success-report"), touch: "package.json" });
      project.lane({ name: "m1-a" });
      expect(await runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project), never())).toBe("success");
      expect(readFileSync(count, "utf8")).toBe("x");

      const worktree = join(project.root, ".arbab", "worktrees", "m1-a");
      rmSync(worktree, { recursive: true, force: true });
      expect(await runShepherd(project.root, "m1-a", { kind: "fresh" }, testDeps(project), never())).toBe("failed");
      expect(stateOf("m1-a")).toMatchObject({ state: "finished", endState: "failed" });
      expect(stateOf("m1-a")?.reason).toMatch(/is missing, and its branch arbab\/m1-a holds worker commits that are not on main/);
      expect(readFileSync(count, "utf8")).toBe("x");
      expect(existsSync(worktree)).toBe(false);
      expect(attempts("m1-a")).toEqual(["attempt-1"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records quota as each rate_limit_event is read, so a newer reading is not overwritten at the end", async () => {
    project.scenario({ fixture: fixture("success-report"), hangMs: 400 });
    project.lane({ name: "m1-a" });
    const deps = testDeps(project);
    const quotaFile = join(project.home, "quota.json");
    let injected: RateLimitSnapshot | null = null;
    let readAt: string | null = null;
    const sleep = deps.sleep;
    deps.sleep = async (ms) => {
      if (injected === null && existsSync(quotaFile)) {
        readAt = readJsonFile<RateLimitSnapshot>(quotaFile).observedAt;
        // Another worker's newer reading, while this attempt is still running.
        injected = {
          observedAt: new Date(deps.clock.now() + 1).toISOString(),
          status: "allowed",
          type: "five_hour",
          fiveHour: { utilization: 0.77, resetsAt: FIXTURE_RESET_SEC },
          sevenDay: null,
        };
        writeFileSync(quotaFile, JSON.stringify(injected));
      }
      return sleep(ms);
    };

    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, deps, never())).toBe("success");
    expect(injected).not.toBeNull();
    expect(readJsonFile<RateLimitSnapshot>(quotaFile)).toEqual(injected);
    const finishedAt = readJsonFile<AttemptExit>(attemptFiles(attemptDir("m1-a", 1)).exit).finishedAt;
    expect(Date.parse(readAt ?? "")).toBeLessThan(Date.parse(finishedAt));
  });

  it("counts maxAttempts over this run's attempts, not the lane's history", async () => {
    project.scenario({ fixture: fixture("success-report"), resumeFixture: "usage-limit" });
    project.lane({ name: "m1-a", maxAttempts: 2 });
    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project), never())).toBe("success");
    expect(await runShepherd(project.root, "m1-a", { kind: "resume" }, testDeps(project), never())).toBe("usage-limit");
    expect(attempts("m1-a")).toEqual(["attempt-1", "attempt-2", "attempt-3"]);
    expect(stateOf("m1-a")).toMatchObject({ endState: "usage-limit", attempt: 3 });
  });

  it("pins the binary only for a resume, to the attempt it resumes", async () => {
    project.scenario({ fixture: fixture("success-report"), resumeFixture: fixture("resume-success") });
    project.lane({ name: "m1-a" });
    const version = (v: string): Partial<ShepherdDeps> => ({ run: () => `${v} (Claude Code)\n` });
    const binaryOf = (n: number): string => readJsonFile<AttemptStarted>(attemptFiles(attemptDir("m1-a", n)).started).binary.version;

    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project), never())).toBe("success");
    // A CLI upgrade: a fresh session takes the new binary…
    expect(await runShepherd(project.root, "m1-a", { kind: "fresh" }, testDeps(project, version("2.1.296")), never())).toBe("success");
    expect(binaryOf(2)).toBe("2.1.296");
    // …and a resume of that session keeps it.
    expect(await runShepherd(project.root, "m1-a", { kind: "resume" }, testDeps(project, version("2.1.296")), never())).toBe("success");
    expect(binaryOf(3)).toBe("2.1.296");
    expect(await runShepherd(project.root, "m1-a", { kind: "resume" }, testDeps(project, version("2.1.297")), never())).toBe("failed");
    expect(stateOf("m1-a")?.reason).toMatch(/2\.1\.297/);
    expect(attempts("m1-a")).toHaveLength(3);
  });

  it("takes a resume's cost base from the session's last attempt that had a cost", async () => {
    project.scenario({ fixture: fixture("success-report") });
    project.lane({ name: "m1-a", wallMin: 600, idleMin: 5 });
    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project), never())).toBe("success");
    project.scenario({ fixture: "truncated", hangMs: -1 });
    expect(await runShepherd(project.root, "m1-a", { kind: "resume" }, testDeps(project, {}, 60_000), never())).toBe("killed:idle");
    expect(readJsonFile<AttemptSummary>(attemptFiles(attemptDir("m1-a", 2)).summary).costUsd).toBeNull();
    project.scenario({ fixture: fixture("success-report"), resumeFixture: fixture("resume-success") });
    expect(await runShepherd(project.root, "m1-a", { kind: "resume" }, testDeps(project), never())).toBe("success");
    expect(readJsonFile<AttemptSummary>(attemptFiles(attemptDir("m1-a", 3)).summary).costDeltaUsd).toBeCloseTo(6.32 - 1.25);
  });

  /** A branch off main with one commit that writes `file`; returns its sha. The root stays on main. */
  const branchWith = (branch: string, file: string, text: string): string => {
    mustGit(project.git, ["checkout", "-q", "-b", branch, "main"], project.root);
    writeFileSync(join(project.root, file), text);
    mustGit(project.git, ["add", "-A"], project.root);
    mustGit(project.git, ["commit", "-q", "-m", `${branch} writes ${file}`], project.root);
    const sha = mustGit(project.git, ["rev-parse", "HEAD"], project.root).trim();
    mustGit(project.git, ["checkout", "-q", "main"], project.root);
    return sha;
  };

  it("merges the lane's branches into a worktree it created, after the dependencies, and records them", async () => {
    project.cleanup();
    // The dependency command runs on the base, before any worker-written branch is merged.
    project = makeProject({
      dependencies: { strategy: "command", command: [process.execPath, "-e", "process.exit(require('fs').existsSync('up.txt') ? 9 : 0)"] },
    });
    const up = branchWith("arbab/up", "up.txt", "from up\n");
    const other = branchWith("arbab/other", "other.txt", "from other\n");
    project.scenario({ fixture: fixture("success-report") });
    project.lane({ name: "m1-b", mergeBranches: ["arbab/up", "arbab/other"] });

    expect(await runShepherd(project.root, "m1-b", { kind: "start" }, testDeps(project), never())).toBe("success");
    const started = readJsonFile<AttemptStarted & { merged?: unknown }>(attemptFiles(attemptDir("m1-b", 1)).started);
    expect(started.merged).toEqual([
      { branch: "arbab/up", sha: up },
      { branch: "arbab/other", sha: other },
    ]);
    expect(existsSync(join(started.cwd, "up.txt")) && existsSync(join(started.cwd, "other.txt"))).toBe(true);
    const merges = (): string[] => mustGit(project.git, ["log", "--merges", "--format=%s"], started.cwd).trim().split("\n");
    // arbab/up descends from the base and is fast-forwarded; arbab/other is merged on top of it.
    expect(merges()).toEqual(["arbab: merge arbab/other for m1-b"]);

    // A reused worktree is never merged again, even when the branch moved on.
    branchWith("arbab/later", "later.txt", "later\n");
    mustGit(project.git, ["branch", "-f", "arbab/up", "arbab/later"], project.root);
    expect(await runShepherd(project.root, "m1-b", { kind: "fresh" }, testDeps(project), never())).toBe("success");
    expect(readJsonFile<{ merged?: unknown }>(attemptFiles(attemptDir("m1-b", 2)).started).merged).toBeUndefined();
    expect(merges()).toHaveLength(1);
  });

  it("fails setup on a conflicting merge, naming the path, and starts no worker", async () => {
    branchWith("arbab/a", "shared.txt", "from a\n");
    branchWith("arbab/c", "shared.txt", "from c\n");
    project.scenario({ fixture: fixture("success-report") });
    project.lane({ name: "m1-b", mergeBranches: ["arbab/a", "arbab/c"] });

    expect(await runShepherd(project.root, "m1-b", { kind: "start" }, testDeps(project), never())).toBe("failed");
    const state = stateOf("m1-b");
    expect(state).toMatchObject({ state: "finished", endState: "failed", attempt: 0 });
    expect(state?.reason).toMatch(/^merging arbab\/c into arbab\/m1-b conflicts in shared\.txt; the merge was aborted/);
    expect(attempts("m1-b")).toEqual([]);
    expect(project.calls()).toEqual([]);
    expect(poolEntries("slots")).toEqual([]);
    expect(lockEntries()).toEqual([]);
  });

  it("fails setup on a merge branch that changes a dependency manifest, after installing on the base, and starts no worker", async () => {
    project.cleanup();
    const dir = mkdtempSync(join(tmpdir(), "arbab-deps-"));
    const seen = join(dir, "seen");
    try {
      // Records what the install saw: the base's package.json, never the branch's.
      const script = "const fs = require('fs'); fs.appendFileSync(process.argv[1], fs.existsSync('package.json') ? 'branch' : 'base')";
      project = makeProject({ dependencies: { strategy: "command", command: [process.execPath, "-e", script, seen] } });
      branchWith("arbab/up", "package.json", '{"scripts":{"postinstall":"echo pwned"}}\n');
      project.scenario({ fixture: fixture("success-report") });
      project.lane({ name: "m1-b", mergeBranches: ["arbab/up"] });

      expect(await runShepherd(project.root, "m1-b", { kind: "start" }, testDeps(project), never())).toBe("failed");
      const state = stateOf("m1-b");
      expect(state).toMatchObject({ state: "finished", endState: "failed", attempt: 0 });
      expect(state?.reason).toMatch(/^arbab\/up changes dependency manifests \(package\.json\)/);
      expect(state?.reason).toContain("must review and land that dependency change on the base before dependent phases run");
      expect(readFileSync(seen, "utf8")).toBe("base");
      expect(project.calls()).toEqual([]);
      expect(lockEntries()).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a borrower on a worktree its owner never ran in; the owner's relaunch then prepares it on its own plan", async () => {
    project.cleanup();
    const dir = mkdtempSync(join(tmpdir(), "arbab-deps-"));
    const count = join(dir, "count");
    try {
      project = makeProject({
        dependencies: { strategy: "command", command: [process.execPath, "-e", "require('fs').appendFileSync(process.argv[1], 'x')", count] },
      });
      project.scenario({ fixture: fixture("success-report") });
      // The owner's setup fails on a missing branch and leaves its worktree behind, with no attempt.
      project.lane({ name: "m1-b", mergeBranches: ["arbab/late"] });
      expect(await runShepherd(project.root, "m1-b", { kind: "start" }, testDeps(project), never())).toBe("failed");
      expect(readFileSync(count, "utf8")).toBe("x");

      // A verifier may not prepare it on its own plan: the owner's merges would never happen.
      project.lane({ name: "m1-v", role: "verifier", worktree: "m1-b" });
      expect(await runShepherd(project.root, "m1-v", { kind: "start" }, testDeps(project), never())).toBe("failed");
      expect(stateOf("m1-v")?.reason).toMatch(/m1-b's worktree, where no attempt has run yet; launch m1-b first/);
      expect(readFileSync(count, "utf8")).toBe("x");
      expect(existsSync(join(runDir("m1-b"), "worktree-used"))).toBe(false);

      // The owner's relaunch builds it again, installs and merges as its own plan says.
      branchWith("arbab/late", "late.txt", "from late\n");
      expect(await runShepherd(project.root, "m1-b", { kind: "start" }, testDeps(project), never())).toBe("success");
      expect(readFileSync(count, "utf8")).toBe("xx");
      const started = readJsonFile<AttemptStarted>(attemptFiles(attemptDir("m1-b", 1)).started);
      expect(started.merged?.map((m) => m.branch)).toEqual(["arbab/late"]);
      expect(existsSync(join(started.cwd, "late.txt"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails setup when a merge branch does not exist", async () => {
    project.scenario({ fixture: fixture("success-report") });
    project.lane({ name: "m1-b", mergeBranches: ["arbab/none"] });
    expect(await runShepherd(project.root, "m1-b", { kind: "start" }, testDeps(project), never())).toBe("failed");
    expect(stateOf("m1-b")?.reason).toMatch(/branch arbab\/none does not exist/);
    expect(project.calls()).toEqual([]);
  });

  it("merges on a relaunch after a setup failure left the worktree behind, since no worker ran in it", async () => {
    project.scenario({ fixture: fixture("success-report") });
    project.lane({ name: "m1-b", mergeBranches: ["arbab/late"] });
    expect(await runShepherd(project.root, "m1-b", { kind: "start" }, testDeps(project), never())).toBe("failed");
    branchWith("arbab/late", "late.txt", "from late\n");

    expect(await runShepherd(project.root, "m1-b", { kind: "start" }, testDeps(project), never())).toBe("success");
    const started = readJsonFile<AttemptStarted>(attemptFiles(attemptDir("m1-b", 1)).started);
    expect(started.merged?.map((m) => m.branch)).toEqual(["arbab/late"]);
    expect(existsSync(join(started.cwd, "late.txt"))).toBe(true);
  });

  describe("a lane based on a worker's branch", () => {
    let dir: string;
    let seen: string;
    beforeEach(() => {
      project.cleanup();
      dir = mkdtempSync(join(tmpdir(), "arbab-deps-"));
      seen = join(dir, "seen");
      // The install runs scripts/setup.js from the worktree, as a package.json script would: worker code if the tree is.
      project = makeProject({ dependencies: { strategy: "command", command: [process.execPath, "scripts/setup.js", seen] } });
      mkdirSync(join(project.root, "scripts"));
      writeFileSync(join(project.root, "scripts", "setup.js"), setupScript("base"));
      mustGit(project.git, ["add", "--", "scripts/setup.js"], project.root);
      mustGit(project.git, ["commit", "-q", "-m", "setup script"], project.root);
      project.scenario({ fixture: fixture("success-report") });
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    const setupScript = (who: string): string => `require("fs").appendFileSync(process.argv[2], ${JSON.stringify(`${who}\n`)});\n`;
    const head = (branch: string): string => mustGit(project.git, ["rev-parse", branch], project.root).trim();
    /** Records integration `name` with a manifest change a human confirmed at `at`. */
    const writeConfirmed = (name: string, at: string): void => {
      const records = join(project.root, ".arbab", "integrations", name);
      mkdirSync(records, { recursive: true });
      writeFileSync(
        join(records, "integration.json"),
        JSON.stringify({
          name,
          branch: `integrate/${name}`,
          worktree: join(project.root, ".arbab", "worktrees", `integrate-${name}`),
          base: "main",
          baseSha: head("main"),
          merged: [],
          manifests: ["package.json"],
          depsConfirmedAt: at,
          depsConfirmed: true,
          headSha: at,
          updatedAt: "2026-10-09T12:00:00.000Z",
        }),
      );
    };

    it("installs on the base branch's commit with the base's script, then merges the base first", async () => {
      const up = branchWith("arbab/up", "scripts/setup.js", setupScript("worker"));
      const other = branchWith("arbab/other", "other.txt", "other\n");
      project.lane({ name: "m1-b", base: "arbab/up", mergeBranches: ["arbab/other"] });

      expect(await runShepherd(project.root, "m1-b", { kind: "start" }, testDeps(project), never())).toBe("success");
      expect(readFileSync(seen, "utf8")).toBe("base\n");
      const started = readJsonFile<AttemptStarted>(attemptFiles(attemptDir("m1-b", 1)).started);
      expect(started.merged).toEqual([
        { branch: "arbab/up", sha: up },
        { branch: "arbab/other", sha: other },
      ]);
      expect(readFileSync(join(started.cwd, "scripts", "setup.js"), "utf8")).toBe(setupScript("worker"));
      // The base is fast-forwarded: the lane's history is the base's, then the lane's merges.
      expect(mustGit(project.git, ["merge-base", "--is-ancestor", up, "arbab/m1-b"], project.root)).toBe("");
    });

    it("refuses a base that changes a dependency manifest, after installing on the base branch", async () => {
      branchWith("arbab/up", "package.json", '{"scripts":{"postinstall":"node scripts/setup.js"}}\n');
      project.lane({ name: "m1-b", base: "arbab/up" });

      expect(await runShepherd(project.root, "m1-b", { kind: "start" }, testDeps(project), never())).toBe("failed");
      const state = stateOf("m1-b");
      expect(state).toMatchObject({ state: "finished", endState: "failed", attempt: 0 });
      expect(state?.reason).toMatch(/^arbab\/up changes dependency manifests \(package\.json\), so it was not merged into arbab\/m1-b/);
      expect(state?.reason).toContain("must review and land that dependency change on the base before dependent phases run");
      expect(readFileSync(seen, "utf8")).toBe("base\n");
      expect(project.calls()).toEqual([]);
    });

    it("installs on a base that is an integration head a human confirmed", async () => {
      const confirmed = branchWith("integrate/m3", "scripts/setup.js", setupScript("confirmed"));
      writeConfirmed("m3", confirmed);
      project.lane({ name: "m1-b", base: "integrate/m3" });

      expect(await runShepherd(project.root, "m1-b", { kind: "start" }, testDeps(project), never())).toBe("success");
      expect(readFileSync(seen, "utf8")).toBe("confirmed\n");
      expect(readJsonFile<AttemptStarted>(attemptFiles(attemptDir("m1-b", 1)).started).merged).toBeUndefined();
    });

    it("installs on the confirmed head an integration moved past without a manifest change, then merges the head", async () => {
      const confirmed = branchWith("integrate/m3", "scripts/setup.js", setupScript("confirmed"));
      writeConfirmed("m3", confirmed);
      // integrate merges a lane that changes no manifest after the human confirmed.
      mustGit(project.git, ["checkout", "-q", "integrate/m3"], project.root);
      writeFileSync(join(project.root, "later.txt"), "later\n");
      mustGit(project.git, ["add", "--", "later.txt"], project.root);
      mustGit(project.git, ["commit", "-q", "-m", "a lane without manifests"], project.root);
      mustGit(project.git, ["checkout", "-q", "main"], project.root);
      const moved = head("integrate/m3");
      project.lane({ name: "m1-b", base: "integrate/m3" });

      expect(await runShepherd(project.root, "m1-b", { kind: "start" }, testDeps(project), never())).toBe("success");
      expect(readFileSync(seen, "utf8")).toBe("confirmed\n");
      const started = readJsonFile<AttemptStarted>(attemptFiles(attemptDir("m1-b", 1)).started);
      expect(started.merged).toEqual([{ branch: "integrate/m3", sha: moved }]);
      expect(existsSync(join(started.cwd, "later.txt"))).toBe(true);
    });

    it("refuses a base that shares no history with the base branch", async () => {
      mustGit(project.git, ["checkout", "-q", "--orphan", "arbab/alien"], project.root);
      mustGit(project.git, ["commit", "-q", "-m", "alien"], project.root);
      mustGit(project.git, ["checkout", "-q", "-f", "main"], project.root);
      project.lane({ name: "m1-b", base: "arbab/alien" });

      expect(await runShepherd(project.root, "m1-b", { kind: "start" }, testDeps(project), never())).toBe("failed");
      expect(stateOf("m1-b")?.reason).toMatch(/^base arbab\/alien shares no history with main/);
      expect(existsSync(seen)).toBe(false);
    });

    it("builds again, on the base branch, a worktree whose failed setup merged worker commits, never installing on them", async () => {
      const up = branchWith("arbab/up", "scripts/setup.js", setupScript("worker"));
      // The base is merged (fast-forwarded), then arbab/late is refused.
      branchWith("arbab/late", "package.json", "{}\n");
      project.lane({ name: "m1-b", base: "arbab/up", mergeBranches: ["arbab/late"] });
      expect(await runShepherd(project.root, "m1-b", { kind: "start" }, testDeps(project), never())).toBe("failed");
      expect(head("arbab/m1-b")).toBe(up);
      expect(stateOf("m1-b")?.reason).toMatch(/launch m1-b again: as long as no worker has run in its worktree, arbab builds it again/);

      // The relaunch removes the worktree and its branch, starts over on the base branch and merges again.
      mustGit(project.git, ["branch", "-D", "arbab/late"], project.root);
      const late = branchWith("arbab/late", "late.txt", "late\n");
      expect(await runShepherd(project.root, "m1-b", { kind: "start" }, testDeps(project), never())).toBe("success");
      expect(readFileSync(seen, "utf8")).toBe("base\nbase\n");
      expect(readJsonFile<AttemptStarted>(attemptFiles(attemptDir("m1-b", 1)).started).merged).toEqual([
        { branch: "arbab/up", sha: up },
        { branch: "arbab/late", sha: late },
      ]);
    });

    /**
     * A lane whose setup fails in the install, before any attempt, leaving its worktree at its start: the install
     * script cannot append to `seen` while it is a directory.
     */
    const failBeforeInstall = async (spec: Partial<LaneSpec> & { name: string }): Promise<void> => {
      mkdirSync(seen);
      project.lane(spec);
      expect(await runShepherd(project.root, spec.name, { kind: "start" }, testDeps(project), never())).toBe("failed");
      expect(stateOf(spec.name)?.reason).toMatch(/dependencies failed/);
      rmSync(seen, { recursive: true });
    };

    it("builds a left-behind worktree again on its base once a human confirmed it, so the lane has the base's code", async () => {
      const m3 = branchWith("integrate/m3", "scripts/setup.js", setupScript("confirmed"));
      // Unconfirmed at first: the worktree starts at the base branch, to merge integrate/m3 after the install.
      await failBeforeInstall({ name: "m1-b", base: "integrate/m3" });
      expect(head("arbab/m1-b")).toBe(head("main"));
      writeConfirmed("m3", m3);

      // Now trusted, the base is the install point and nothing is merged: reusing the worktree would leave it at main.
      expect(await runShepherd(project.root, "m1-b", { kind: "start" }, testDeps(project), never())).toBe("success");
      expect(readFileSync(seen, "utf8")).toBe("confirmed\n");
      const started = readJsonFile<AttemptStarted>(attemptFiles(attemptDir("m1-b", 1)).started);
      expect(started.merged).toBeUndefined();
      expect(readFileSync(join(started.cwd, "scripts", "setup.js"), "utf8")).toBe(setupScript("confirmed"));
      expect(mustGit(project.git, ["merge-base", "--is-ancestor", m3, "arbab/m1-b"], project.root)).toBe("");
    });

    it("refuses, removing and installing nothing, a worktree left with worker files under a trusted ref", async () => {
      await failBeforeInstall({ name: "m1-b" });
      const worktree = join(project.root, ".arbab", "worktrees", "m1-b");
      // A merge that wrote the files and died before it moved the ref (or a human's edits: arbab cannot tell).
      writeFileSync(join(worktree, "scripts", "setup.js"), setupScript("worker"));
      writeFileSync(join(worktree, "dropped.txt"), "worker\n");

      expect(await runShepherd(project.root, "m1-b", { kind: "start" }, testDeps(project), never())).toBe("failed");
      expect(stateOf("m1-b")?.reason).toMatch(/holds what arbab cannot rebuild: uncommitted changes \(.*setup\.js.*dropped\.txt/);
      expect(existsSync(seen)).toBe(false);
      expect(readFileSync(join(worktree, "dropped.txt"), "utf8")).toBe("worker\n");
      expect(project.calls()).toEqual([]);
    });

    it("refuses, removing nothing, a left-behind worktree whose branch holds a commit no source holds", async () => {
      await failBeforeInstall({ name: "m1-b" });
      const worktree = join(project.root, ".arbab", "worktrees", "m1-b");
      writeFileSync(join(worktree, "hand.txt"), "by hand\n");
      mustGit(project.git, ["add", "--", "hand.txt"], worktree);
      mustGit(project.git, ["commit", "-q", "-m", "by hand"], worktree);
      const own = head("arbab/m1-b");

      expect(await runShepherd(project.root, "m1-b", { kind: "start" }, testDeps(project), never())).toBe("failed");
      expect(stateOf("m1-b")?.reason).toMatch(
        new RegExp(`holds what arbab cannot rebuild: commits on arbab/m1-b that are not on its base, its merge branches or the trusted base: ${own}`),
      );
      expect(existsSync(seen)).toBe(false);
      expect(readFileSync(join(worktree, "hand.txt"), "utf8")).toBe("by hand\n");
      expect(head("arbab/m1-b")).toBe(own);
      expect(project.calls()).toEqual([]);
    });

    it("never removes a worktree a worker has run in", async () => {
      project.lane({ name: "m1-b" });
      expect(await runShepherd(project.root, "m1-b", { kind: "start" }, testDeps(project), never())).toBe("success");
      const worktree = join(project.root, ".arbab", "worktrees", "m1-b");
      writeFileSync(join(worktree, "kept.txt"), "uncommitted\n");
      // A base confirmed since changes nothing for a worktree in use.
      writeConfirmed("m3", branchWith("integrate/m3", "m3.txt", "m3\n"));
      project.lane({ name: "m1-b", base: "integrate/m3" });
      expect(await runShepherd(project.root, "m1-b", { kind: "fresh" }, testDeps(project), never())).toBe("success");
      expect(readFileSync(join(worktree, "kept.txt"), "utf8")).toBe("uncommitted\n");
      expect(existsSync(join(worktree, "m3.txt"))).toBe(false);
      expect(readFileSync(seen, "utf8")).toBe("base\n");
    });

    it("installs again in a worktree left on the base branch by a setup failure, and merges the base", async () => {
      const up = branchWith("arbab/up", "scripts/setup.js", setupScript("worker"));
      // The dependency command fails once, before anything is merged.
      writeFileSync(join(dir, "fail"), "");
      const config = JSON.parse(readFileSync(join(project.root, "arbab.config.json"), "utf8")) as { dependencies: { command: string[] } };
      const script = "const fs = require('fs'); const [seen, fail] = process.argv.slice(1); if (fs.existsSync(fail)) { fs.rmSync(fail); process.exit(3); } fs.appendFileSync(seen, fs.readFileSync('scripts/setup.js', 'utf8').includes('worker') ? 'worker\\n' : 'base\\n')";
      config.dependencies.command = [process.execPath, "-e", script, seen, join(dir, "fail")];
      writeFileSync(join(project.root, "arbab.config.json"), JSON.stringify(config));
      project.lane({ name: "m1-b", base: "arbab/up" });
      expect(await runShepherd(project.root, "m1-b", { kind: "start" }, testDeps(project), never())).toBe("failed");
      expect(head("arbab/m1-b")).toBe(head("main"));

      expect(await runShepherd(project.root, "m1-b", { kind: "start" }, testDeps(project), never())).toBe("success");
      expect(readFileSync(seen, "utf8")).toBe("base\n");
      expect(readJsonFile<AttemptStarted>(attemptFiles(attemptDir("m1-b", 1)).started).merged).toEqual([{ branch: "arbab/up", sha: up }]);
    });
  });

  it("starts a fresh session seeded with an attempt's digest, and fails without a stream to digest", async () => {
    project.scenario({ fixture: fixture("success-report") });
    project.lane({ name: "m1-a" });
    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project), never())).toBe("success");
    expect(await runShepherd(project.root, "m1-a", { kind: "fresh", digestFrom: 1 }, testDeps(project), never())).toBe("success");

    const [first, second] = [1, 2].map((n) => readJsonFile<AttemptStarted>(attemptFiles(attemptDir("m1-a", n)).started));
    expect(second?.resume).toBe(false);
    expect(second?.sessionId).not.toBe(first?.sessionId);
    const brief = readFileSync(attemptFiles(attemptDir("m1-a", 2)).brief, "utf8");
    expect(brief).toContain("## Head start\n\nA previous attempt (number 1)");
    expect(brief.indexOf("## Head start")).toBeGreaterThan(brief.indexOf("## Acceptance"));
    expect(brief.indexOf("## Head start")).toBeLessThan(brief.indexOf("## Tool belt"));
    expect(readFileSync(attemptFiles(attemptDir("m1-a", 1)).brief, "utf8")).not.toContain("## Head start");

    expect(await runShepherd(project.root, "m1-a", { kind: "fresh", digestFrom: 7 }, testDeps(project), never())).toBe("failed");
    expect(stateOf("m1-a")).toMatchObject({ attempt: 0, reason: expect.stringMatching(/attempt 7 of m1-a: .* does not exist/) });
    writeFileSync(attemptFiles(attemptDir("m1-a", 2)).stream, "");
    expect(await runShepherd(project.root, "m1-a", { kind: "fresh", digestFrom: 2 }, testDeps(project), never())).toBe("failed");
    expect(stateOf("m1-a")?.reason).toMatch(/has no events/);
    expect(attempts("m1-a")).toEqual(["attempt-1", "attempt-2"]);
  });

  it("reads a resume prompt from a file in the lane's run dir, and refuses one elsewhere", async () => {
    project.scenario({ fixture: fixture("success-report"), resumeFixture: fixture("resume-success") });
    project.lane({ name: "m1-a" });
    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project), never())).toBe("success");
    const promptFile = join(runDir("m1-a"), "resume-prompt.md");
    writeFileSync(promptFile, "Also fix the README.\n");
    expect(
      await runShepherd(project.root, "m1-a", { kind: "resume", promptFile, prompt: "not this" }, testDeps(project), never()),
    ).toBe("success");
    expect(readFileSync(attemptFiles(attemptDir("m1-a", 2)).brief, "utf8")).toBe("Also fix the README.\n");

    const outside = join(project.root, "lanes", "brief.md");
    expect(await runShepherd(project.root, "m1-a", { kind: "resume", promptFile: outside }, testDeps(project), never())).toBe("failed");
    expect(stateOf("m1-a")).toMatchObject({ attempt: 0, reason: expect.stringMatching(/not inside the lane's run dir/) });
    expect(attempts("m1-a")).toHaveLength(2);
  });
});

describe("runShepherd: slots, owners, events, timing and inputs (DESIGN.md §21)", () => {
  const nowSec = FIXTURE_RESET_SEC - 3600;
  const quota = (utilization: number): void => {
    mkdirSync(project.home, { recursive: true });
    const snapshot: RateLimitSnapshot = {
      observedAt: new Date(nowSec * 1000).toISOString(),
      status: "allowed_warning",
      type: "five_hour",
      fiveHour: { utilization, resetsAt: nowSec + 7200 },
      sevenDay: null,
    };
    writeFileSync(join(project.home, "quota.json"), JSON.stringify(snapshot));
  };
  /** Another live lane's slot entry. */
  const occupySlot = (n: number): string => {
    const file = join(project.home, "slots", `${n}.json`);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, JSON.stringify({ pid: process.pid, lane: "other", project: "/elsewhere", createdAt: new Date().toISOString() }));
    return file;
  };
  const machine = (text: string): void => {
    mkdirSync(project.home, { recursive: true });
    writeFileSync(join(project.home, "machine.json"), text);
  };
  const heldFor = (reason: RegExp): Promise<LaneStateRecord> =>
    until(() => {
      const s = stateOf("m1-a");
      return s?.state === "held" && reason.test(s.reason ?? "") ? s : undefined;
    });
  const settle = (): Promise<void> => new Promise((d) => setTimeout(d, 150));
  const runsRoot = (): string => join(project.root, ".arbab", "runs");

  it("waits for the quota before it takes a slot", async () => {
    quota(0.9);
    project.scenario({ fixture: fixture("success-report") });
    project.lane({ name: "m1-a" });
    const done = runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project, { holdPollMs: 30 }), never());
    await heldFor(/five-hour window at 90%/);
    await settle();
    expect(poolEntries("slots")).toEqual([]);
    quota(0.5);
    expect(await done).toBe("success");
    expect(poolEntries("slots")).toEqual([]);
  });

  it("checks the quota again once it has a slot, and gives the slot back while the quota holds", async () => {
    project.cleanup();
    project = makeProject({ maxParallel: 1 });
    const other = occupySlot(0);
    project.scenario({ fixture: fixture("success-report") });
    project.lane({ name: "m1-a" });
    const done = runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project, { holdPollMs: 30, slotPollMs: 30 }), never());
    await heldFor(/no free slot/);
    // The quota fills while the lane waits for the slot; then the slot frees.
    quota(0.9);
    rmSync(other);
    await heldFor(/five-hour window at 90%/);
    await settle();
    expect(poolEntries("slots")).toEqual([]);
    expect(project.calls()).toEqual([]);
    quota(0.5);
    expect(await done).toBe("success");
    const held = readLaneEvents(runsRoot(), "m1-a").filter((e) => e.state === "held").map((e) => e.reason);
    expect(held).toEqual(["no free slot", expect.stringMatching(/five-hour window/)]);
  });

  it("reads ~/.arbab/machine.json on every slot poll", async () => {
    machine(JSON.stringify({ maxParallel: 1 }));
    occupySlot(0);
    project.scenario({ fixture: fixture("success-report") });
    project.lane({ name: "m1-a" });
    const done = runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project, { slotPollMs: 30 }), never());
    // The project allows two; the machine one, which the other lane holds.
    await heldFor(/no free slot/);
    await settle();
    expect(project.calls()).toEqual([]);
    machine(JSON.stringify({ maxParallel: 2 }));
    expect(await done).toBe("success");
    expect(poolEntries("slots")).toEqual(["0.json"]);
  });

  it("keeps the project's maxParallel for a poll when machine.json is unreadable", async () => {
    machine("{");
    occupySlot(0);
    project.scenario({ fixture: fixture("success-report") });
    project.lane({ name: "m1-a" });
    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project, { slotPollMs: 30 }), never())).toBe("success");
    expect(readLaneEvents(runsRoot(), "m1-a").map((e) => e.state)).not.toContain("held");
  });

  it("records the owner in shepherd.json, and registers the shepherd and the project while it runs", async () => {
    quota(0.9);
    project.scenario({ fixture: fixture("success-report") });
    project.lane({ name: "m1-a" });
    const deps = testDeps(project, { holdPollMs: 30 });
    deps.hostEnv = { ...deps.hostEnv, CLAUDE_CODE_SESSION_ID: "session-a" };
    const done = runShepherd(project.root, "m1-a", { kind: "start" }, deps, never());
    await heldFor(/five-hour/);

    const record = readJsonFile<{ pid: number; startedAt: string; owner: string | null }>(join(runDir("m1-a"), "shepherd.json"));
    expect(record).toEqual({ pid: process.pid, startedAt: expect.any(String), owner: "session-a" });
    expect(listShepherds(project.home, isAlive)).toEqual([
      { pid: process.pid, lane: "m1-a", project: project.root, owner: "session-a", startedAt: record.startedAt },
    ]);
    expect(listProjects(project.home)).toEqual([{ root: project.root, lastLaunchAt: record.startedAt }]);

    quota(0.5);
    expect(await done).toBe("success");
    expect(listShepherds(project.home, isAlive)).toEqual([]);
    expect(poolEntries("shepherds")).toEqual([]);
    expect(listProjects(project.home)).toEqual([{ root: project.root, lastLaunchAt: record.startedAt }]);
  });

  it("records a null owner outside Claude Code, and unregisters a run that fails in setup", async () => {
    project.scenario({ fixture: fixture("success-report") });
    project.lane({ name: "m1-a", base: "no-such-branch" });
    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project), never())).toBe("failed");
    expect(readJsonFile<{ owner: unknown }>(join(runDir("m1-a"), "shepherd.json")).owner).toBeNull();
    expect(poolEntries("shepherds")).toEqual([]);
    expect(listProjects(project.home).map((p) => p.root)).toEqual([project.root]);
  });

  it("logs a state change once, however many polls rewrite it", async () => {
    project.cleanup();
    project = makeProject({ maxParallel: 1 });
    const other = occupySlot(0);
    project.scenario({ fixture: fixture("success-report") });
    project.lane({ name: "m1-a" });
    const deps = testDeps(project, { slotPollMs: 30 });
    let polls = 0;
    const sleep = deps.sleep;
    deps.sleep = (ms) => {
      if (stateOf("m1-a")?.state === "held") polls += 1;
      if (polls === 4) rmSync(other, { force: true });
      return sleep(ms);
    };
    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, deps, never())).toBe("success");
    expect(polls).toBeGreaterThanOrEqual(4);

    const events = readLaneEvents(runsRoot(), "m1-a");
    expect(events.map((e) => [e.state, e.reason])).toEqual([
      ["queued", undefined],
      ["held", "no free slot"],
      ["preparing", undefined],
      ["running", undefined],
      ["finished", undefined],
    ]);
    expect(events.every((e) => e.shepherdPid === process.pid)).toBe(true);
    expect(events.map((e) => e.attempt)).toEqual([0, 0, 0, 1, 1]);
    expect(events[4]?.endState).toBe("success");
    expect(events.map((e) => Date.parse(e.at))).toEqual([...events.map((e) => Date.parse(e.at))].sort((a, b) => a - b));
  });

  it("logs a new reason in the same state as a change", async () => {
    project.scenario({ fixture: fixture("success-report") });
    project.lane({ name: "m1-a" });
    const worktreeRoot = join(project.root, ".arbab", "worktrees");
    mkdirSync(worktreeRoot, { recursive: true });
    const lock = join(project.home, "locks", writerLockKey(join(realpathSync(worktreeRoot), "m1-a")), "0.json");
    mkdirSync(join(lock, ".."), { recursive: true });
    writeFileSync(lock, JSON.stringify({ pid: process.pid, lane: "other", project: "/elsewhere", createdAt: new Date().toISOString() }));
    const done = runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project, { slotPollMs: 30 }), never());
    await until(() => (stateOf("m1-a")?.reason === "waiting for the writer lock" ? true : undefined));
    await settle();
    rmSync(lock);
    expect(await done).toBe("success");
    expect(readLaneEvents(runsRoot(), "m1-a").map((e) => [e.state, e.reason])).toEqual([
      ["queued", undefined],
      ["preparing", undefined],
      ["preparing", "waiting for the writer lock"],
      ["running", undefined],
      ["finished", undefined],
    ]);
  });

  it("gives the first attempt how long the run was held and prepared, and later attempts nothing", async () => {
    project.cleanup();
    project = makeProject({ maxParallel: 1 });
    const other = occupySlot(0);
    project.scenario({ fixture: "usage-limit", resumeFixture: fixture("resume-success") });
    project.lane({ name: "m1-a" });
    const deps = testDeps(project, { slotPollMs: 15_000 });
    let polls = 0;
    let atReset: { slots: string[]; locks: string[] } | null = null;
    const sleep = deps.sleep;
    deps.sleep = (ms) => {
      const s = stateOf("m1-a");
      if (s?.state === "held" && ms === 15_000 && ++polls === 2) rmSync(other, { force: true });
      if (s?.state === "waiting-reset" && atReset === null) atReset = { slots: poolEntries("slots"), locks: lockEntries() };
      return sleep(ms);
    };
    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, deps, never())).toBe("success");

    const [first, second] = [1, 2].map((n) => readJsonFile<AttemptStarted>(attemptFiles(attemptDir("m1-a", n)).started));
    // Two virtual slot polls of 15 s each.
    expect(first?.heldMs).toBeGreaterThanOrEqual(30_000);
    expect(first?.heldMs).toBeLessThan(60_000);
    expect(first?.prepareMs).toBeGreaterThanOrEqual(0);
    expect(first?.prepareMs).toBeLessThan(30_000);
    expect(second).not.toHaveProperty("heldMs");
    expect(second).not.toHaveProperty("prepareMs");
    // While it waits for the reset, the lane keeps its worktree's lock but not its slot.
    expect(atReset).toEqual({ slots: [], locks: ["0.json"] });
  });

  it("copies the lane's inputs before the first attempt and names them in its started.json only", async () => {
    const outside = join(project.dir, "outside");
    mkdirSync(join(outside, "notes"), { recursive: true });
    writeFileSync(join(outside, "spec.md"), "spec\n");
    writeFileSync(join(outside, "notes", "a.txt"), "a\n");
    project.scenario({ fixture: "usage-limit", resumeFixture: fixture("resume-success") });
    // HOME is project.dir in testDeps.
    project.lane({ name: "m1-a", inputs: [join(outside, "spec.md"), "~/outside/notes"] });
    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project), never())).toBe("success");

    const [first, second] = [1, 2].map((n) => readJsonFile<AttemptStarted>(attemptFiles(attemptDir("m1-a", n)).started));
    expect(first?.inputs).toEqual(["spec.md", "notes"]);
    expect(second).not.toHaveProperty("inputs");
    const copied = join(first?.cwd ?? "", ".arbab-tmp", "inputs");
    expect(readFileSync(join(copied, "spec.md"), "utf8")).toBe("spec\n");
    expect(readFileSync(join(copied, "notes", "a.txt"), "utf8")).toBe("a\n");
    // Ignored, so the checkpoint commits none of it.
    expect(mustGit(project.git, ["status", "--porcelain"], first?.cwd ?? "")).toBe("");
  });

  it("copies the inputs again on a later run, and fails setup on a refused input without starting a worker", async () => {
    const spec = join(project.dir, "outside", "spec.md");
    mkdirSync(join(spec, ".."), { recursive: true });
    writeFileSync(spec, "v1\n");
    project.scenario({ fixture: fixture("success-report") });
    project.lane({ name: "m1-a", inputs: [spec] });
    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project), never())).toBe("success");
    writeFileSync(spec, "v2\n");
    expect(await runShepherd(project.root, "m1-a", { kind: "fresh" }, testDeps(project), never())).toBe("success");
    const cwd = readJsonFile<AttemptStarted>(attemptFiles(attemptDir("m1-a", 2)).started).cwd;
    expect(readFileSync(join(cwd, ".arbab-tmp", "inputs", "spec.md"), "utf8")).toBe("v2\n");

    // An input the lane dropped does not stay readable.
    project.lane({ name: "m1-a" });
    expect(await runShepherd(project.root, "m1-a", { kind: "fresh" }, testDeps(project), never())).toBe("success");
    expect(readdirSync(join(cwd, ".arbab-tmp", "inputs"))).toEqual([]);

    project.lane({ name: "m1-a", inputs: ["~/.ssh/id_ed25519"] });
    mkdirSync(join(project.dir, ".ssh"));
    writeFileSync(join(project.dir, ".ssh", "id_ed25519"), "not a key\n");
    expect(await runShepherd(project.root, "m1-a", { kind: "fresh" }, testDeps(project), never())).toBe("failed");
    expect(stateOf("m1-a")).toMatchObject({ endState: "failed", attempt: 0, reason: expect.stringMatching(/^input ~\/\.ssh\/id_ed25519 is under ~\/\.ssh/) });
    expect(attempts("m1-a")).toHaveLength(3);
    expect(poolEntries("slots")).toEqual([]);
    expect(lockEntries()).toEqual([]);
    expect(poolEntries("shepherds")).toEqual([]);
  });

  it("refuses an input under one of config.credentialPaths", async () => {
    project.cleanup();
    project = makeProject({ credentialPaths: ["~/vault/**"] });
    mkdirSync(join(project.dir, "vault"), { recursive: true });
    writeFileSync(join(project.dir, "vault", "token"), "not a token\n");
    project.scenario({ fixture: fixture("success-report") });
    // HOME is project.dir in testDeps.
    project.lane({ name: "m1-a", inputs: ["~/vault/token"] });
    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project), never())).toBe("failed");
    expect(stateOf("m1-a")).toMatchObject({ endState: "failed", attempt: 0, reason: expect.stringMatching(/^input ~\/vault\/token is under ~\/vault/) });
    expect(attempts("m1-a")).toHaveLength(0);
  });

  it("refuses a brief one of config.credentialPaths hits", async () => {
    project.cleanup();
    project = makeProject({ credentialPaths: ["lanes/brief.md"] });
    project.scenario({ fixture: fixture("success-report") });
    project.lane({ name: "m1-a" });
    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project), never())).toBe("failed");
    expect(stateOf("m1-a")).toMatchObject({ endState: "failed", reason: expect.stringMatching(/brief: lanes\/brief\.md matches the credential path lanes\/brief\.md/) });
    expect(attempts("m1-a")).toHaveLength(0);
  });
});

describe("slotCap", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "arbab-cap-"));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });
  const machine = (text: string): void => writeFileSync(join(home, "machine.json"), text);

  it("is the project's maxParallel without machine.json", () => {
    expect(slotCap(home, 4)).toBe(4);
    expect(slotCap(join(home, "none"), 4)).toBe(4);
  });

  it("is the lower of the project's and the machine's", () => {
    machine(JSON.stringify({ maxParallel: 2 }));
    expect(slotCap(home, 4)).toBe(2);
    machine(JSON.stringify({ maxParallel: 8 }));
    expect(slotCap(home, 4)).toBe(4);
    machine(JSON.stringify({ maxParallel: null }));
    expect(slotCap(home, 4)).toBe(4);
  });

  it("keeps the project's value when machine.json does not parse or is invalid", () => {
    for (const text of ["{", "[]", JSON.stringify({ maxParallel: 0 }), JSON.stringify({ maxParallel: 2, other: 1 })]) {
      machine(text);
      expect(slotCap(home, 4), text).toBe(4);
    }
  });
});

describe("usageLimitResetsAt", () => {
  const snap = (five: [number, number] | null, seven: [number, number] | null): RateLimitSnapshot => ({
    observedAt: "2026-10-09T10:00:00.000Z",
    status: "rejected",
    type: "five_hour",
    fiveHour: five && { utilization: five[0], resetsAt: five[1] },
    sevenDay: seven && { utilization: seven[0], resetsAt: seven[1] },
  });

  it("takes the latest future reset among full windows", () => {
    expect(usageLimitResetsAt(snap([1, 2000], [0.995, 5000]), 1000)).toBe(5000);
    expect(usageLimitResetsAt(snap([1, 2000], [0.5, 5000]), 1000)).toBe(2000);
  });

  it("keeps a full window's reset that has already passed, so the lane resumes without the fallback", () => {
    expect(usageLimitResetsAt(snap([1, 900], null), 1000)).toBe(900);
    expect(usageLimitResetsAt(snap([1, 900], [1, 800]), 1000)).toBe(900);
  });

  it("falls back to now + 15 min when no window is full", () => {
    expect(usageLimitResetsAt(snap([0.98, 2000], null), 1000)).toBe(1900);
    expect(usageLimitResetsAt(null, 1000)).toBe(1900);
  });
});

describe("resetSince", () => {
  it("ends the wait on a reset after the limited attempt began", () => {
    expect(resetSince(1001, 1000)).toBe(true);
  });

  it("does not end it without a reset, or on one at or before the attempt's start", () => {
    expect(resetSince(null, 1000)).toBe(false);
    expect(resetSince(1000, 1000)).toBe(false);
    expect(resetSince(999, 1000)).toBe(false);
  });
});

describe("ignoreEntries", () => {
  it("is arbab's own list: .arbab/ as a whole, .arbab-tmp/, and roots outside .arbab/", () => {
    expect(ignoreEntries("/p", defaultConfig())).toEqual([".arbab/", ".arbab-tmp/"]);
    expect(ignoreEntries("/p", { worktreeRoot: "./w/", runsRoot: "w" })).toEqual([".arbab/", ".arbab-tmp/", "w/"]);
  });

  it("refuses a root outside the project", () => {
    expect(() => ignoreEntries("/p", { worktreeRoot: "../x", runsRoot: "r" })).toThrow(/outside/);
  });
});

describe("a lane's tools in the shepherd", () => {
  it("compiles a lane with tools without the tools it leaves out", async () => {
    project.scenario({ fixture: fixture("success-report") });
    project.lane({ name: "m1-a", tools: ["Read", "Bash"] });
    expect(await runShepherd(project.root, "m1-a", { kind: "start" }, testDeps(project, { spawnImpl: registeringSpawn() }), never())).toBe("success");

    const files = attemptFiles(attemptDir("m1-a", 1));
    const args = readJsonFile<AttemptStarted>(files.started).args;
    expect(args[args.indexOf("--tools") + 1]).toBe("Read,Bash");
    const settings = readJsonFile<{ permissions: { allow: string[] } }>(files.settings);
    expect(settings.permissions.allow).toContain("Read");
    expect(settings.permissions.allow).not.toContain("Write");
    expect(settings.permissions.allow).not.toContain("Edit");
  });
});
