import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SweepRecord } from "../types";
import { UNPARSED_GRACE_MS } from "./cleanup";
import { openProject } from "./project";
import { maybeStartSweep, runSweepProcess, SWEEP_INTERVAL_MS, sweepProject } from "./sweep";
import { CLI_PID, NOW_MS, makeProject, writeLaneRun, type TestProject } from "./testkit";

let p: TestProject;
afterEach(() => p?.dispose());

const LIVE = 101;
const DEAD = 202;
/** 40 days before NOW_MS. */
const OLD = "2026-08-30T12:00:00.000Z";
const T = "2026-10-09T12:00:00.000Z";

const recordPath = (t: TestProject): string => join(t.root, ".arbab", "sweep.json");
const lockPath = (t: TestProject): string => join(t.root, ".arbab", "sweep.lock");
const readRecord = (t: TestProject): SweepRecord => JSON.parse(readFileSync(recordPath(t), "utf8")) as SweepRecord;
const hasBranch = (t: TestProject, branch: string): boolean => t.git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], t.root).code === 0;

function writeRecord(t: TestProject, startedAt: string): void {
  mkdirSync(join(t.root, ".arbab"), { recursive: true });
  writeFileSync(recordPath(t), JSON.stringify({ startedAt, finishedAt: startedAt, idleDays: 3, removed: [], kept: 0, warnings: [] }));
}

function writeLock(t: TestProject, pid: number | null, ageMs = 0): void {
  mkdirSync(join(t.root, ".arbab"), { recursive: true });
  writeFileSync(lockPath(t), pid === null ? "" : JSON.stringify({ pid, lane: "sweep", project: t.root, createdAt: T }));
  const sec = (NOW_MS - ageMs) / 1000;
  utimesSync(lockPath(t), sec, sec);
}

/** A finished lane `old`, unchanged for 40 days, whose worktree holds one commit and nothing uncommitted. */
function idleLane(t: TestProject): string {
  const path = join(t.worktreeRoot, "old");
  t.ok(["worktree", "add", "-q", "-b", "arbab/old", path, "main"]);
  writeFileSync(join(path, "o.txt"), "o\n");
  t.ok(["add", "--", "o.txt"], path);
  t.ok(["commit", "-q", "-m", "o"], path);
  writeLaneRun(t.runsRoot, "old", { state: "finished", endState: "success", since: OLD });
  return path;
}

describe("maybeStartSweep", () => {
  it("starts a sweep when none ran, and when the last began an hour ago or more", () => {
    p = makeProject();
    expect(maybeStartSweep(p.ctx, openProject(p.ctx))).toBe(true);
    writeRecord(p, new Date(NOW_MS - SWEEP_INTERVAL_MS).toISOString());
    expect(maybeStartSweep(p.ctx, openProject(p.ctx))).toBe(true);
    expect(p.sweeps).toEqual([p.root, p.root]);
  });

  it("starts nothing when worktrees.idleDays is 0", () => {
    p = makeProject({ config: { worktrees: { idleDays: 0 } } });
    expect(maybeStartSweep(p.ctx, openProject(p.ctx))).toBe(false);
    expect(p.sweeps).toEqual([]);
  });

  it("starts nothing when the last sweep began less than an hour ago, even one that never finished", () => {
    p = makeProject();
    writeRecord(p, new Date(NOW_MS - SWEEP_INTERVAL_MS + 60_000).toISOString());
    expect(maybeStartSweep(p.ctx, openProject(p.ctx))).toBe(false);
    writeFileSync(recordPath(p), JSON.stringify({ startedAt: T, finishedAt: null, idleDays: 3, removed: [], kept: 0, warnings: [] }));
    expect(maybeStartSweep(p.ctx, openProject(p.ctx))).toBe(false);
    expect(p.sweeps).toEqual([]);
  });

  it("starts one when sweep.json does not read or names a time in the future", () => {
    p = makeProject();
    mkdirSync(join(p.root, ".arbab"), { recursive: true });
    for (const text of ["{", "[]", JSON.stringify({ startedAt: "soon" }), JSON.stringify({ startedAt: "2027-01-01T00:00:00.000Z" })]) {
      writeFileSync(recordPath(p), text);
      expect(maybeStartSweep(p.ctx, openProject(p.ctx)), text).toBe(true);
    }
  });

  it("starts nothing while a live sweep holds the lock, or an unparsed lock is fresh; a dead or old one is no obstacle", () => {
    p = makeProject();
    p.alive.add(LIVE);
    writeLock(p, LIVE);
    expect(maybeStartSweep(p.ctx, openProject(p.ctx))).toBe(false);
    writeLock(p, null, 1000);
    expect(maybeStartSweep(p.ctx, openProject(p.ctx))).toBe(false);
    expect(p.sweeps).toEqual([]);
    writeLock(p, DEAD);
    expect(maybeStartSweep(p.ctx, openProject(p.ctx))).toBe(true);
    writeLock(p, null, UNPARSED_GRACE_MS + 1000);
    expect(maybeStartSweep(p.ctx, openProject(p.ctx))).toBe(true);
  });

  it("never throws: a sweep that cannot start is not started", () => {
    p = makeProject();
    p.ctx.spawnSweep = () => {
      throw new Error("spawn ENOENT");
    };
    expect(maybeStartSweep(p.ctx, openProject(p.ctx))).toBe(false);
  });
});

describe("arbab __sweep", () => {
  it("removes an idle finished lane's clean worktree, keeps its branch, records the sweep and releases the lock", async () => {
    p = makeProject();
    const old = idleLane(p);
    expect(await runSweepProcess([p.root], p.ctx)).toBe(0);
    expect(existsSync(old)).toBe(false);
    expect(hasBranch(p, "arbab/old")).toBe(true);
    expect(readRecord(p)).toEqual({
      startedAt: T,
      finishedAt: T,
      idleDays: 3,
      removed: [{ path: old, reason: "unchanged for 40 days; branch arbab/old kept" }],
      kept: 0,
      warnings: [],
    });
    expect(existsSync(lockPath(p))).toBe(false);
    expect(p.stdout()).toBe(`${T} sweep of ${p.root} (unused for 3+ days)\nremoved worktree ${old}: unchanged for 40 days; branch arbab/old kept\n`);
  });

  it("writes sweep.json with finishedAt null and holds the lock before it touches a worktree", async () => {
    p = makeProject();
    idleLane(p);
    const seen: Array<{ record: SweepRecord; lock: unknown }> = [];
    const git = p.ctx.git;
    p.ctx.git = (args, cwd) => {
      if (seen.length === 0) seen.push({ record: readRecord(p), lock: JSON.parse(readFileSync(lockPath(p), "utf8")) });
      return git(args, cwd);
    };
    expect(await runSweepProcess([p.root], p.ctx)).toBe(0);
    expect(seen).toEqual([
      {
        record: { startedAt: T, finishedAt: null, idleDays: 3, removed: [], kept: 0, warnings: [] },
        lock: { pid: CLI_PID, lane: "sweep", project: p.root, createdAt: T },
      },
    ]);
  });

  it("exits 0 and sweeps nothing while another live sweep holds the lock", async () => {
    p = makeProject();
    const old = idleLane(p);
    p.alive.add(LIVE);
    writeLock(p, LIVE);
    expect(await runSweepProcess([p.root], p.ctx)).toBe(0);
    expect(p.stdout()).toBe(`${T} another sweep of ${p.root} is running\n`);
    expect(existsSync(old)).toBe(true);
    expect(existsSync(recordPath(p))).toBe(false);
    expect(JSON.parse(readFileSync(lockPath(p), "utf8"))).toMatchObject({ pid: LIVE });
  });

  it("takes over the lock of a dead sweep", async () => {
    p = makeProject();
    const old = idleLane(p);
    writeLock(p, DEAD);
    expect(await runSweepProcess([p.root], p.ctx)).toBe(0);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(lockPath(p))).toBe(false);
  });

  it("records a sweep that removes nothing when idleDays is 0", async () => {
    p = makeProject({ config: { worktrees: { idleDays: 0 } } });
    const old = idleLane(p);
    expect(await runSweepProcess([p.root], p.ctx)).toBe(0);
    expect(existsSync(old)).toBe(true);
    expect(readRecord(p)).toMatchObject({ idleDays: 0, removed: [], finishedAt: T });
    expect(p.stdout()).toBe(`${T} sweep of ${p.root} (automatic sweep off)\nnothing to remove\n`);
  });

  it("keeps what cleanup keeps: a dirty tree and a lane that is not finished", async () => {
    p = makeProject();
    const old = idleLane(p);
    writeFileSync(join(old, "new.txt"), "x");
    p.alive.add(LIVE);
    mkdirSync(join(p.worktreeRoot, "busy"), { recursive: true });
    writeLaneRun(p.runsRoot, "busy", { state: "running", shepherdPid: LIVE, since: OLD });
    expect(await runSweepProcess([p.root], p.ctx)).toBe(0);
    expect(readRecord(p)).toMatchObject({ removed: [], kept: 1, warnings: [] });
    expect(existsSync(old) && existsSync(join(p.worktreeRoot, "busy"))).toBe(true);
  });

  it("records a failing sweep's error among its warnings", () => {
    p = makeProject();
    idleLane(p);
    const project = openProject(p.ctx);
    const swept = sweepProject(p.ctx, { ...project, config: { ...project.config, worktrees: { idleDays: 1.5 } } });
    expect(swept?.record.warnings).toEqual(["a sweep needs a positive whole number of days, not 1.5"]);
    expect(readRecord(p).finishedAt).toBe(T);
  });

  it("refuses bad arguments, a lane worktree and a directory inside a project", async () => {
    p = makeProject();
    const old = idleLane(p);
    await expect(runSweepProcess([], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runSweepProcess([p.root, "x"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runSweepProcess(["repo"], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/must be absolute/) });
    await expect(runSweepProcess([old], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/lane worktree/) });
    await expect(runSweepProcess([join(p.root, "lanes")], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/is not a project root/) });
    expect(existsSync(old)).toBe(true);
    expect(existsSync(recordPath(p))).toBe(false);
  });
});
