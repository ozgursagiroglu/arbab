// The worktree lifecycle end to end: a removed worktree rebuilt on resume, the detached sweep of idle worktrees, and
// summary's worktree counts, through the real bundle, real shepherds and the fake claude.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SweepRecord } from "../../src/types";
import { buildBundle, fakeFixture, makeE2eProject, until, type E2eProject } from "./harness";

let bundle: { bundle: string; dispose(): void };
let p: E2eProject | undefined;

beforeAll(async () => {
  bundle = await buildBundle();
}, 60_000);
afterAll(() => bundle?.dispose());
afterEach(() => {
  p?.dispose();
  p = undefined;
});

const DAY_MS = 86_400_000;

/** Sets worktrees.idleDays (undefined drops the key, for the default) and commits the config. */
function setIdleDays(project: E2eProject, idleDays: number | undefined): void {
  const path = join(project.root, "arbab.config.json");
  const { worktrees: _, ...config } = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  writeFileSync(path, JSON.stringify(idleDays === undefined ? config : { ...config, worktrees: { idleDays } }, null, 2));
  project.git(["add", "--", "arbab.config.json"]);
  project.git(["commit", "-q", "-m", "idle days"]);
}

/** Moves the lane's last state change `days` back, as if it had finished then. */
function backdate(project: E2eProject, lane: string, days: number): void {
  const path = join(project.laneDir(lane), "state.json");
  const state = project.json(path);
  writeFileSync(path, JSON.stringify({ ...state, since: new Date(Date.now() - days * DAY_MS).toISOString() }));
}

async function waitFor(project: E2eProject, lane: string, attempt: number): Promise<void> {
  const wait = await project.cli("wait", "--any", "--timeout-min", "2", "--json", lane);
  expect(wait.code, wait.stderr).toBe(0);
  expect((JSON.parse(wait.stdout) as { finished: unknown[] }).finished).toEqual([expect.objectContaining({ lane, attempt, endState: "success" })]);
}

/** Launches the lane with the fake worker writing `touch`, and waits for its success. */
async function runLane(project: E2eProject, lane: string, touch: string): Promise<void> {
  project.scenario({ fixture: fakeFixture("success-report"), touch });
  const launch = await project.cli("launch", project.lane(lane));
  expect(launch.code, launch.stderr).toBe(0);
  await waitFor(project, lane, 1);
}

const subjects = (project: E2eProject, branch: string): string[] =>
  project.git(["log", "--format=%s", `main..${branch}`]).trim().split("\n");

describe("arbab worktree lifecycle end to end", () => {
  it("rebuilds a removed worktree at the same path on resume, keeping the branch's commits", async () => {
    p = makeE2eProject(bundle.bundle);
    const project = p;
    await runLane(project, "r", "r/one.txt");
    const worktree = join(project.worktreeRoot, "r");
    const first = project.git(["rev-parse", "refs/heads/arbab/r"]).trim();

    // Removed while idle, as cleanup or a sweep would; the branch stays.
    project.git(["worktree", "remove", "--force", worktree]);
    expect(existsSync(worktree)).toBe(false);
    expect(project.git(["rev-parse", "refs/heads/arbab/r"]).trim()).toBe(first);

    project.scenario({ fixture: fakeFixture("success-report"), resumeFixture: fakeFixture("resume-success"), touch: "r/two.txt" });
    const resume = await project.cli("resume", "r");
    expect(resume.code, resume.stderr).toBe(0);
    await waitFor(project, "r", 2);

    const call = project.calls().at(-1);
    expect(project.calls()).toHaveLength(2);
    expect(call?.argv).toContain("--resume");
    expect(call?.cwd).toBe(worktree);
    expect(project.json(join(project.attemptDir("r", 2), "summary.json"))).toMatchObject({ state: "success" });
    // Checked out on the branch again, which moved only forward: attempt 1's commit and file are still there.
    expect(project.git(["symbolic-ref", "--short", "HEAD"], worktree).trim()).toBe("arbab/r");
    project.git(["merge-base", "--is-ancestor", first, "refs/heads/arbab/r"]);
    expect(subjects(project, "arbab/r")).toEqual(["arbab(r): checkpoint attempt 2 (success)", "arbab(r): checkpoint attempt 1 (success)"]);
    expect(existsSync(join(worktree, "r", "one.txt")) && existsSync(join(worktree, "r", "two.txt"))).toBe(true);
    expect(project.git(["status", "--porcelain"], worktree)).toBe("");
  }, 240_000);

  it("starts the detached sweep on launch, which removes a finished lane's idle worktree and keeps its branch", async () => {
    p = makeE2eProject(bundle.bundle);
    const project = p;
    await runLane(project, "old", "old/out.txt");
    const checkpoint = project.git(["rev-parse", "refs/heads/arbab/old"]).trim();
    backdate(project, "old", 4);
    // The default idleDays (3): the next launch starts a sweep.
    setIdleDays(project, undefined);
    const sweepFile = join(project.root, ".arbab", "sweep.json");
    const sweepLock = join(project.root, ".arbab", "sweep.lock");
    expect(existsSync(sweepFile)).toBe(false);

    await runLane(project, "new", "new/out.txt");
    const record = await until(
      () => {
        const r = project.json<SweepRecord>(sweepFile);
        return r.finishedAt === null ? undefined : r;
      },
      30_000,
      "the sweep to finish",
    );
    await until(() => (existsSync(sweepLock) ? undefined : true), 15_000, "the sweep lock's release");

    const old = join(project.worktreeRoot, "old");
    expect(record).toMatchObject({ idleDays: 3, warnings: [] });
    expect(record.removed).toEqual([{ path: old, reason: "unchanged for 4 days; branch arbab/old kept" }]);
    expect(existsSync(old)).toBe(false);
    expect(project.git(["rev-parse", "refs/heads/arbab/old"]).trim()).toBe(checkpoint);
    expect(existsSync(join(project.laneDir("old"), "state.json"))).toBe(true);
    // The lane that launched it was active, and keeps its worktree.
    expect(existsSync(join(project.worktreeRoot, "new"))).toBe(true);
    expect(readFileSync(join(project.root, ".arbab", "sweep.log"), "utf8")).toContain(`removed worktree ${old}: unchanged for 4 days; branch arbab/old kept`);

    const summary = await project.cli("summary", "--json");
    expect(summary.code, summary.stderr).toBe(0);
    expect((JSON.parse(summary.stdout) as { worktrees: unknown }).worktrees).toEqual({
      total: 1,
      idle: 0,
      idleDays: 3,
      lastSweep: { startedAt: record.startedAt, finishedAt: record.finishedAt, removed: 1 },
    });
  }, 240_000);

  it("reports the worktree counts in summary --json", async () => {
    p = makeE2eProject(bundle.bundle);
    const project = p;
    await runLane(project, "a", "a/out.txt");
    await runLane(project, "b", "b/out.txt");

    // With the sweep off, every finished lane's worktree counts as unused for more than 0 days; the text hides it.
    const off = await project.cli("summary", "--json");
    expect(off.code, off.stderr).toBe(0);
    expect((JSON.parse(off.stdout) as { worktrees: unknown }).worktrees).toEqual({ total: 2, idle: 2, idleDays: 0, lastSweep: null });
    expect((await project.cli("summary")).stdout).toContain("worktrees: 2 (automatic sweep off)");

    // Summary is read-only: it counts the idle worktree and starts no sweep.
    setIdleDays(project, 3);
    backdate(project, "a", 4);
    const on = await project.cli("summary", "--json");
    expect(on.code, on.stderr).toBe(0);
    expect((JSON.parse(on.stdout) as { worktrees: unknown }).worktrees).toEqual({ total: 2, idle: 1, idleDays: 3, lastSweep: null });
    const text = await project.cli("summary");
    expect(text.code, text.stderr).toBe(0);
    expect(text.stdout).toContain("worktrees: 2 (1 unused for 3+ days)");
    expect(existsSync(join(project.root, ".arbab", "sweep.json"))).toBe(false);
    expect(existsSync(join(project.worktreeRoot, "a"))).toBe(true);
  }, 240_000);
});
