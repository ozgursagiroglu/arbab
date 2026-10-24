import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readState, writeState } from "../registry";
import { markGenerated } from "./generated";
import { LAUNCH_LOCK_MS, assertInactive, assertNotGeneratedWorktree, assertNoLiveWorker, launchLane, launchLockPath, runLaunch, takeLaunchLock } from "./launch";
import { openProject } from "./project";
import { CLI_PID, DEFAULT_CONFIG, NOW_MS, SHEPHERD_PID, makeProject, writeLaneRun, type TestProject } from "./testkit";

let p: TestProject;
afterEach(() => p?.dispose());

const lockFile = (): string => join(p.runsRoot, "demo", "launch.lock");

function writeLock(pid: number | null, ageMs = 0): void {
  mkdirSync(join(p.runsRoot, "demo"), { recursive: true });
  writeFileSync(lockFile(), pid === null ? "" : JSON.stringify({ pid, lane: "demo", project: p.root, createdAt: "2026-10-09T11:59:00.000Z" }));
  const t = (NOW_MS - ageMs) / 1000;
  utimesSync(lockFile(), t, t);
}

describe("launchLane", () => {
  it("writes the validated spec and starts a shepherd in start mode", async () => {
    p = makeProject();
    const launched = await launchLane(p.ctx, openProject(p.ctx), "lanes/demo.json");
    expect(launched).toMatchObject({ lane: "demo", runDir: join(p.runsRoot, "demo"), shepherdPid: SHEPHERD_PID, mode: "start" });
    expect(p.spawned).toEqual([{ root: p.root, lane: "demo", mode: { kind: "start" } }]);
    const spec = JSON.parse(readFileSync(join(p.runsRoot, "demo", "lane.json"), "utf8")) as Record<string, unknown>;
    expect(spec).toEqual({ name: "demo", role: "implementer", brief: "lanes/demo.md" });
  });

  it("uses fresh mode for a lane that ran before", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "finished", endState: "success", summary: { state: "success" } });
    expect((await launchLane(p.ctx, openProject(p.ctx), "lanes/demo.json")).mode).toBe("fresh");
    expect(p.spawned[0]?.mode).toEqual({ kind: "fresh" });
  });

  it("refuses a lane that ran before with onlyNew, and starts nothing", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "finished", endState: "success", summary: { state: "success" } });
    await expect(launchLane(p.ctx, openProject(p.ctx), "lanes/demo.json", { onlyNew: true })).rejects.toMatchObject({
      code: "usage",
      message: "lane demo has already been launched",
    });
    expect(p.spawned).toEqual([]);
    expect(existsSync(lockFile())).toBe(false);
  });

  it("relaunches an orphaned lane", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "running", shepherdPid: 9999 });
    expect((await launchLane(p.ctx, openProject(p.ctx), "lanes/demo.json")).mode).toBe("fresh");
  });

  it("holds the launch lock until the shepherd writes state.json, then removes it", async () => {
    p = makeProject();
    let polls = 0;
    const sleep = p.ctx.sleep;
    p.ctx.sleep = async (ms) => {
      expect(existsSync(lockFile())).toBe(true);
      if (++polls === 3) writeState(p.runsRoot, { lane: "demo", state: "queued", attempt: 0, since: "2026-10-09T12:00:00.000Z", shepherdPid: SHEPHERD_PID });
      await sleep(ms);
    };
    await launchLane(p.ctx, openProject(p.ctx), "lanes/demo.json");
    expect(polls).toBe(3);
    expect(existsSync(lockFile())).toBe(false);
  });

  it("starts a sweep of idle worktrees once the shepherd has written its first state", async () => {
    p = makeProject();
    const seen: Array<string | undefined> = [];
    p.ctx.spawnSweep = (root) => {
      seen.push(readState(p.runsRoot, "demo")?.state);
      p.sweeps.push(root);
      return 0;
    };
    p.ctx.sleep = async (ms) => {
      writeState(p.runsRoot, { lane: "demo", state: "queued", attempt: 0, since: "2026-10-09T12:00:00.000Z", shepherdPid: SHEPHERD_PID });
      p.now.ms += ms;
    };
    await launchLane(p.ctx, openProject(p.ctx), "lanes/demo.json");
    expect(p.sweeps).toEqual([p.root]);
    expect(seen).toEqual(["queued"]);
  });

  it("launches all the same when the sweep cannot start, or is off", async () => {
    p = makeProject();
    p.ctx.spawnSweep = () => {
      throw new Error("no node");
    };
    expect((await launchLane(p.ctx, openProject(p.ctx), "lanes/demo.json")).lane).toBe("demo");
    p.dispose();
    p = makeProject({ config: { ...DEFAULT_CONFIG, worktrees: { idleDays: 0 } } });
    await launchLane(p.ctx, openProject(p.ctx), "lanes/demo.json");
    expect(p.sweeps).toEqual([]);
  });

  it("does not take an older shepherd's state.json for the new one's", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "finished", endState: "success", shepherdPid: 77 });
    const start = p.now.ms;
    await launchLane(p.ctx, openProject(p.ctx), "lanes/demo.json");
    expect(p.now.ms - start).toBeGreaterThanOrEqual(LAUNCH_LOCK_MS);
    expect(existsSync(lockFile())).toBe(false);
  });

  it("gives up on the lock after LAUNCH_LOCK_MS, or as soon as the shepherd dies", async () => {
    p = makeProject();
    let start = p.now.ms;
    await launchLane(p.ctx, openProject(p.ctx), "lanes/demo.json");
    expect(p.now.ms - start).toBeGreaterThanOrEqual(LAUNCH_LOCK_MS);
    expect(p.now.ms - start).toBeLessThan(LAUNCH_LOCK_MS + 1000);
    expect(existsSync(lockFile())).toBe(false);

    p.alive.clear();
    const spawn = p.ctx.spawnShepherd;
    p.ctx.spawnShepherd = (root, lane, mode) => {
      const pid = spawn(root, lane, mode);
      p.alive.delete(pid);
      return pid;
    };
    start = p.now.ms;
    await launchLane(p.ctx, openProject(p.ctx), "lanes/demo.json");
    expect(p.now.ms).toBe(start);
    expect(existsSync(lockFile())).toBe(false);
  });

  it("refuses while another live launch holds the lock, and starts nothing", async () => {
    p = makeProject();
    writeLock(5150);
    p.alive.add(5150);
    await expect(launchLane(p.ctx, openProject(p.ctx), "lanes/demo.json")).rejects.toThrow(/being launched by another arbab/);
    expect(p.spawned).toEqual([]);
    expect(existsSync(join(p.runsRoot, "demo", "lane.json"))).toBe(false);
    expect(JSON.parse(readFileSync(lockFile(), "utf8"))).toMatchObject({ pid: 5150 });
  });

  it("reclaims a lock whose holder died", async () => {
    p = makeProject();
    writeLock(5150);
    await launchLane(p.ctx, openProject(p.ctx), "lanes/demo.json");
    expect(p.spawned).toHaveLength(1);
    expect(existsSync(lockFile())).toBe(false);
  });

  it("releases the lock when the lane is refused as active", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "running", shepherdPid: 55 });
    p.alive.add(55);
    await expect(launchLane(p.ctx, openProject(p.ctx), "lanes/demo.json")).rejects.toMatchObject({ code: "usage" });
    expect(existsSync(lockFile())).toBe(false);
  });

  it("takes the lock as the context's pid, not the test runner's", async () => {
    p = makeProject();
    let holder: unknown;
    p.ctx.sleep = async () => {
      holder ??= JSON.parse(readFileSync(lockFile(), "utf8"));
      p.now.ms += LAUNCH_LOCK_MS;
    };
    await launchLane(p.ctx, openProject(p.ctx), "lanes/demo.json");
    expect(holder).toMatchObject({ pid: CLI_PID });
  });

  it("lets only one of two concurrent launches start a shepherd", async () => {
    p = makeProject();
    // Both launches run in this CLI process, which holds the lock.
    p.alive.add(p.ctx.pid);
    const project = openProject(p.ctx);
    const results = await Promise.allSettled([launchLane(p.ctx, project, "lanes/demo.json"), launchLane(p.ctx, project, "lanes/demo.json")]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(p.spawned).toHaveLength(1);
  });
});

describe("takeLaunchLock", () => {
  it("writes this process as the holder and releases only its own lock", () => {
    p = makeProject();
    const project = openProject(p.ctx);
    const release = takeLaunchLock(p.ctx, project, "demo", 4321);
    expect(launchLockPath(project, "demo")).toBe(lockFile());
    expect(JSON.parse(readFileSync(lockFile(), "utf8"))).toEqual({
      pid: 4321,
      lane: "demo",
      project: p.root,
      createdAt: "2026-10-09T12:00:00.000Z",
    });
    writeLock(999);
    release();
    expect(existsSync(lockFile())).toBe(true);
  });

  it("treats an unparsable lock as held until it is older than LAUNCH_LOCK_MS", () => {
    p = makeProject();
    const project = openProject(p.ctx);
    writeLock(null, 1000);
    expect(() => takeLaunchLock(p.ctx, project, "demo", 4321)).toThrow(/being launched/);
    writeLock(null, LAUNCH_LOCK_MS + 1000);
    const release = takeLaunchLock(p.ctx, project, "demo", 4321);
    release();
    expect(existsSync(lockFile())).toBe(false);
  });
});

describe("assertInactive", () => {
  it("refuses a lane whose shepherd is alive and not finished", () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "running", shepherdPid: 77 });
    p.alive.add(77);
    expect(() => assertInactive(p.ctx, openProject(p.ctx), "demo")).toThrow(/is running/);
    p.alive.delete(77);
    expect(() => assertInactive(p.ctx, openProject(p.ctx), "demo")).not.toThrow();
  });
  it("accepts a lane that never ran", () => {
    p = makeProject();
    expect(() => assertInactive(p.ctx, openProject(p.ctx), "demo")).not.toThrow();
  });
});

const WORKER_PID = 7000;
const WORKER_COMMAND = "/opt/claude/bin/claude -p --output-format stream-json";

describe("assertNoLiveWorker", () => {
  it("refuses an orphan whose worker still runs the pinned binary, pointing at cleanup", () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "running", shepherdPid: 9999, started: { pid: WORKER_PID } });
    p.alive.add(WORKER_PID);
    p.commands.set(WORKER_PID, WORKER_COMMAND);
    expect(() => assertNoLiveWorker(p.ctx, openProject(p.ctx), "demo")).toThrow(
      expect.objectContaining({ code: "usage", message: expect.stringMatching(/pid 7000.*arbab cleanup/) }),
    );
  });

  it("refuses whenever the pid is alive and ps cannot tell", () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "running", shepherdPid: 9999, started: { pid: WORKER_PID } });
    p.alive.add(WORKER_PID);
    expect(() => assertNoLiveWorker(p.ctx, openProject(p.ctx), "demo")).toThrow(/arbab cleanup/);
  });

  it("accepts a dead worker, a recycled pid, an exited attempt and a lane without attempts", () => {
    p = makeProject();
    const project = openProject(p.ctx);
    expect(() => assertNoLiveWorker(p.ctx, project, "demo")).not.toThrow();
    writeLaneRun(p.runsRoot, "demo", { state: "running", shepherdPid: 9999, started: { pid: WORKER_PID } });
    expect(() => assertNoLiveWorker(p.ctx, project, "demo")).not.toThrow();
    p.alive.add(WORKER_PID);
    p.commands.set(WORKER_PID, "/usr/bin/vim notes.md");
    expect(() => assertNoLiveWorker(p.ctx, project, "demo")).not.toThrow();
    p.commands.set(WORKER_PID, WORKER_COMMAND);
    writeLaneRun(p.runsRoot, "demo", { state: "finished", endState: "success", started: { pid: WORKER_PID }, exit: { exitCode: 0 } });
    expect(() => assertNoLiveWorker(p.ctx, project, "demo")).not.toThrow();
  });

  it("keeps launch from starting a second writer, and releases the lock", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "running", shepherdPid: 9999, started: { pid: WORKER_PID } });
    p.alive.add(WORKER_PID);
    p.commands.set(WORKER_PID, WORKER_COMMAND);
    await expect(launchLane(p.ctx, openProject(p.ctx), "lanes/demo.json")).rejects.toThrow(/arbab cleanup/);
    expect(p.spawned).toEqual([]);
    expect(existsSync(lockFile())).toBe(false);
  });
});

describe("runLaunch", () => {
  it("prints the lane, its run directory and the shepherd pid", async () => {
    p = makeProject();
    expect(await runLaunch(["lanes/demo.json"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe(`launched demo  run ${join(p.runsRoot, "demo")}  shepherd ${SHEPHERD_PID}\n`);
  });

  it("prints JSON with --json", async () => {
    p = makeProject();
    expect(await runLaunch(["--json", "lanes/demo.json"], p.ctx)).toBe(0);
    expect(JSON.parse(p.stdout())).toEqual({
      lane: "demo",
      runDir: join(p.runsRoot, "demo"),
      shepherdPid: SHEPHERD_PID,
      mode: "start",
      warnings: [],
    });
  });

  it("refuses a lane that fails lint, without starting anything", async () => {
    p = makeProject({ lanes: { "lanes/bad.json": { name: "bad", role: "implementer", brief: "lanes/demo.md", allow: ["Bash(npx *)"] } } });
    await expect(runLaunch(["lanes/bad.json"], p.ctx)).rejects.toMatchObject({ code: "lint" });
    expect(p.stderr()).toContain("any-code-allow");
    expect(p.spawned).toEqual([]);
    expect(existsSync(join(p.runsRoot, "bad"))).toBe(false);
  });

  it("refuses an active lane and leaves its lane.json alone", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "preparing", shepherdPid: 55, lane: { name: "demo", role: "implementer", brief: "old.md" } });
    p.alive.add(55);
    await expect(runLaunch(["lanes/demo.json"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    expect(p.spawned).toEqual([]);
    expect(readFileSync(join(p.runsRoot, "demo", "lane.json"), "utf8")).toContain("old.md");
  });

  it("refuses a lane whose name an integration generated, naming the integration, and leaves it alone", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "finished", endState: "success", lane: { name: "demo", role: "probe", brief: "gen.md" } });
    markGenerated(p.runsRoot, "demo", { integration: "rel", branch: "integrate/rel", head: "a".repeat(40) }, "2026-10-09T11:00:00.000Z");
    await expect(runLaunch(["lanes/demo.json"], p.ctx)).rejects.toMatchObject({
      code: "usage",
      message: expect.stringMatching(/^lane demo was generated by integration rel/),
    });
    expect(p.spawned).toEqual([]);
    expect(readFileSync(join(p.runsRoot, "demo", "lane.json"), "utf8")).toContain("gen.md");
    expect(existsSync(lockFile())).toBe(false);
    // The integration's own command launches it.
    await launchLane(p.ctx, openProject(p.ctx), "lanes/demo.json", { generated: true });
    expect(p.spawned.map((s) => s.lane)).toEqual(["demo"]);
  });

  it("refuses a lane that borrows a generated lane's worktree, naming the integration", async () => {
    p = makeProject({ lanes: { "lanes/borrow.json": { name: "borrow", role: "implementer", brief: "lanes/demo.md", worktree: "rel-verify" } } });
    markGenerated(p.runsRoot, "rel-verify", { integration: "rel", branch: "integrate/rel", head: "a".repeat(40) }, "2026-10-09T11:00:00.000Z");
    await expect(runLaunch(["lanes/borrow.json"], p.ctx)).rejects.toMatchObject({
      code: "usage",
      message: expect.stringMatching(/^lane borrow borrows the worktree of lane rel-verify, which was generated by integration rel, which owns it/),
    });
    expect(p.spawned).toEqual([]);
    expect(existsSync(join(p.runsRoot, "borrow", "lane.json"))).toBe(false);
    expect(existsSync(join(p.runsRoot, "borrow", "launch.lock"))).toBe(false);
    // Borrowing a lane no integration generated is fine.
    p.write("lanes/ok.json", JSON.stringify({ name: "ok", role: "implementer", brief: "lanes/demo.md", worktree: "demo" }));
    await launchLane(p.ctx, openProject(p.ctx), "lanes/ok.json");
    expect(p.spawned.map((s) => s.lane)).toEqual(["ok"]);
  });

  it("names no integration for a damaged marker", () => {
    p = makeProject();
    mkdirSync(join(p.runsRoot, "gen"), { recursive: true });
    writeFileSync(join(p.runsRoot, "gen", "generated.json"), "{oops");
    expect(() => assertNotGeneratedWorktree(p.runsRoot, "x", "gen")).toThrow(/of lane gen, which was generated by an integration, which owns it/);
    expect(() => assertNotGeneratedWorktree(p.runsRoot, "x", "demo")).not.toThrow();
  });

  it("rejects usage errors", async () => {
    p = makeProject();
    await expect(runLaunch([], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runLaunch(["lanes/demo.json", "--force"], p.ctx)).rejects.toMatchObject({ code: "usage" });
  });
});
