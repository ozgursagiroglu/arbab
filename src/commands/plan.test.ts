import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeState } from "../registry";
import type { AttemptExit, LaneSpec, PlanSpec } from "../types";
import { launchLockPath, takeLaunchLock } from "./launch";
import { checkPlanFile, formatPlanStatus, latestExit, phaseStates, planNext, plansDir, runPlan } from "./plan";
import { openProject } from "./project";
import { SHEPHERD_PID, makeProject, writeLaneRun, type TestProject } from "./testkit";

let p: TestProject;
afterEach(() => p?.dispose());

const PLAN: PlanSpec = {
  name: "p1",
  phases: [
    { name: "a", brief: "lanes/demo.md", scope: ["src/a/**"] },
    { name: "b", brief: "lanes/demo.md", scope: ["src/b/**"], dependsOn: ["a"] },
    { name: "c", brief: "lanes/demo.md", scope: ["src/c/**"] },
  ],
};

function project(plan: unknown = PLAN): TestProject {
  p = makeProject({ files: { "plans/p1.json": JSON.stringify(plan) } });
  // A shepherd that writes its first state at once, as the real one does before launch returns.
  const spawn = p.ctx.spawnShepherd;
  p.ctx.spawnShepherd = (root, lane, mode) => {
    const pid = spawn(root, lane, mode);
    writeState(p.runsRoot, { lane, state: "queued", attempt: 0, since: "2026-10-09T12:00:00.000Z", shepherdPid: pid });
    return pid;
  };
  return p;
}

const SHA = "c".repeat(40);
/** The exit.json of an attempt whose work was committed as a checkpoint. */
const CHECKPOINTED: AttemptExit = {
  exitCode: 0,
  signal: null,
  killedBy: null,
  finishedAt: "2026-10-09T11:55:00.000Z",
  wallMs: 1000,
  reaped: [],
  checkpoint: SHA,
  checkpointError: null,
};

const json = <T>(): T => JSON.parse(p.stdout()) as T;
const reset = (): void => {
  p.out.length = 0;
  p.err.length = 0;
};

describe("checkPlanFile", () => {
  it("compiles and lints every phase and computes the waves", () => {
    project();
    const check = checkPlanFile(p.ctx, openProject(p.ctx), "plans/p1.json");
    expect(check.issues).toEqual([]);
    expect(check.waves).toEqual([["a", "c"], ["b"]]);
    expect(check.phases.map((x) => x.phase)).toEqual(["a", "b", "c"]);
    expect(check.phases.find((x) => x.phase === "b")?.lane).toMatchObject({ upstream: ["a"], mergeBranches: ["arbab/a"] });
    expect(check.phases.every((x) => x.issues.length === 0)).toBe(true);
  });

  it("lints a phase with the git common dir, as lint does", () => {
    project({ ...PLAN, phases: [{ name: "a", brief: "lanes/demo.md", scope: ["src/**"], allow: ["Bash"] }] });
    const check = checkPlanFile(p.ctx, openProject(p.ctx), "plans/p1.json");
    expect(check.phases[0]?.issues.map((i) => i.code)).toContain("bare-bash-allow");
  });
});

describe("arbab plan check", () => {
  it("prints the waves and exits 0 for a clean plan", async () => {
    project();
    expect(await runPlan(["check", "plans/p1.json"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe("a: ok\nb: ok\nc: ok\nwave 0: a, c\nwave 1: b\nplan p1: ok\n");
  });

  it("prints --json with the plan issues, each phase's issues and the waves", async () => {
    project();
    expect(await runPlan(["check", "--json", "plans/p1.json"], p.ctx)).toBe(0);
    expect(json()).toEqual({
      plan: "p1",
      ok: true,
      issues: [],
      phases: [
        { phase: "a", issues: [] },
        { phase: "b", issues: [] },
        { phase: "c", issues: [] },
      ],
      waves: [["a", "c"], ["b"]],
    });
  });

  it("exits 1 on overlapping scopes and on a phase's lint errors", async () => {
    project({ ...PLAN, phases: [...PLAN.phases.slice(0, 2), { name: "c", brief: "lanes/demo.md", scope: ["src/a/x.ts"], allow: ["Bash"] }] });
    expect(await runPlan(["check", "plans/p1.json"], p.ctx)).toBe(1);
    const out = p.stdout();
    expect(out).toMatch(/^error {2}overlapping-scope {2}a \(src\/a\/\*\*\) and c/);
    expect(out).toContain("  error  bare-bash-allow");
    expect(out).toContain("c: 1 error(s)");
    expect(out).toMatch(/plan p1: 2 error\(s\)/);
  });

  it("does not lint phases whose graph does not resolve", async () => {
    project({
      name: "p1",
      phases: [
        { name: "a", brief: "lanes/demo.md", scope: ["src/a/**"], dependsOn: ["b"] },
        { name: "b", brief: "lanes/demo.md", scope: ["src/b/**"], dependsOn: ["a"] },
      ],
    });
    expect(await runPlan(["check", "--json", "plans/p1.json"], p.ctx)).toBe(1);
    const out = json<{ ok: boolean; issues: Array<{ code: string }>; phases: unknown[]; waves: unknown }>();
    expect(out).toMatchObject({ ok: false, phases: [], waves: null });
    expect(out.issues.map((i) => i.code)).toContain("dependency-cycle");
    reset();
    expect(await runPlan(["check", "plans/p1.json"], p.ctx)).toBe(1);
    expect(p.stdout()).toContain("phases not linted: the dependency graph does not resolve\n");
  });

  it("refuses an invalid plan file and usage errors", async () => {
    project({ name: "p1", phases: [] });
    await expect(runPlan(["check", "plans/p1.json"], p.ctx)).rejects.toMatchObject({ code: "config" });
    await expect(runPlan(["check", "plans/none.json"], p.ctx)).rejects.toThrow(/does not exist/);
    await expect(runPlan(["check"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runPlan(["check", "a", "b"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runPlan(["check", "--nope", "plans/p1.json"], p.ctx)).rejects.toMatchObject({ code: "usage" });
  });
});

describe("arbab plan next", () => {
  it("launches the phases without dependencies, writing each compiled lane spec, and lists the blocked ones", async () => {
    project();
    expect(await runPlan(["next", "plans/p1.json"], p.ctx)).toBe(0);
    expect(p.spawned.map((s) => [s.lane, s.mode])).toEqual([
      ["a", { kind: "start" }],
      ["c", { kind: "start" }],
    ]);
    const dir = plansDir(openProject(p.ctx), "p1");
    const a = JSON.parse(readFileSync(join(dir, "a.json"), "utf8")) as LaneSpec;
    expect(a).toEqual({ name: "a", role: "implementer", brief: "lanes/demo.md", coordination: expect.stringContaining("`c` owns `src/c/**`") });
    expect(JSON.parse(readFileSync(join(p.runsRoot, "a", "lane.json"), "utf8"))).toEqual(a);
    expect(existsSync(join(dir, "b.json"))).toBe(false);
    expect(p.stdout()).toBe(
      `launched a  run ${join(p.runsRoot, "a")}  shepherd ${SHEPHERD_PID}\n` +
        `launched c  run ${join(p.runsRoot, "c")}  shepherd ${SHEPHERD_PID + 1}\n` +
        "blocked b  waiting for a\n",
    );
    // The generated lane files stay out of git status.
    expect(p.git(["check-ignore", "-q", ".arbab/plans/p1/a.json"], p.root).code).toBe(0);
    expect(readFileSync(join(p.root, ".git", "info", "exclude"), "utf8")).toMatch(/^\.arbab\/$/m);
    expect(JSON.parse(readFileSync(join(p.root, ".arbab", ".eslintrc.json"), "utf8"))).toEqual({ root: true });

    // Twice in a row: nothing more.
    reset();
    expect(await runPlan(["next", "plans/p1.json"], p.ctx)).toBe(0);
    expect(p.spawned).toHaveLength(2);
    expect(p.stdout()).toBe("nothing launched\nblocked b  waiting for a\n");
  });

  it("launches a dependent phase once its dependency succeeded, with its merge branches and upstream", async () => {
    project();
    for (const lane of ["a", "c"]) {
      writeLaneRun(p.runsRoot, lane, { state: "finished", endState: "success", summary: { state: "success" }, exit: CHECKPOINTED });
    }
    expect(await runPlan(["next", "--json", "plans/p1.json"], p.ctx)).toBe(0);
    expect(json()).toEqual({
      plan: "p1",
      launched: [{ phase: "b", laneFile: join(p.root, ".arbab", "plans", "p1", "b.json"), runDir: join(p.runsRoot, "b"), shepherdPid: SHEPHERD_PID }],
      blocked: [],
      failed: [],
      errors: [],
      warnings: [],
    });
    const b = JSON.parse(readFileSync(join(p.runsRoot, "b", "lane.json"), "utf8")) as LaneSpec;
    expect(b).toMatchObject({ name: "b", upstream: ["a"], mergeBranches: ["arbab/a"] });
  });

  it("launches nothing while a dependency runs, and lists a dependency that failed", async () => {
    project();
    p.alive.add(501);
    writeLaneRun(p.runsRoot, "a", { state: "running", shepherdPid: 501 });
    writeLaneRun(p.runsRoot, "c", { state: "finished", endState: "success" });
    expect(await runPlan(["next", "plans/p1.json"], p.ctx)).toBe(0);
    expect(p.spawned).toEqual([]);
    expect(p.stdout()).toBe("nothing launched\nblocked b  waiting for a\n");

    reset();
    writeLaneRun(p.runsRoot, "a", { state: "finished", endState: "killed:wall", shepherdPid: 501 });
    expect(await runPlan(["next", "plans/p1.json"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe("nothing launched\nfailed-upstream b  a ended killed:wall\n");
    expect(p.spawned).toEqual([]);
  });

  it("lists an orphaned dependency as failed upstream, not blocked", async () => {
    project();
    writeLaneRun(p.runsRoot, "a", { state: "running", shepherdPid: 501 });
    writeLaneRun(p.runsRoot, "c", { state: "finished", endState: "success" });
    expect(await runPlan(["next", "plans/p1.json"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe("nothing launched\nfailed-upstream b  a ended orphaned\n");
    reset();
    expect(await runPlan(["next", "--json", "plans/p1.json"], p.ctx)).toBe(0);
    expect(json<{ failed: unknown }>().failed).toEqual([{ phase: "b", dependency: "a", endState: "orphaned", reason: null }]);
    expect(p.spawned).toEqual([]);
  });

  it("fails a dependent whose dependency succeeded but whose checkpoint failed, with the error", async () => {
    project();
    writeLaneRun(p.runsRoot, "a", {
      state: "finished",
      endState: "success",
      exit: { ...CHECKPOINTED, checkpoint: null, checkpointError: "git commit failed (128): index.lock exists" },
    });
    writeLaneRun(p.runsRoot, "c", { state: "finished", endState: "success", exit: CHECKPOINTED });
    expect(await runPlan(["next", "plans/p1.json"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe(
      "nothing launched\nfailed-upstream b  a ended success; its checkpoint failed: git commit failed (128): index.lock exists\n",
    );
    expect(p.spawned).toEqual([]);
  });

  it("launches after a dependency that succeeded and recorded no changes, and not after one without exit.json", async () => {
    project();
    writeLaneRun(p.runsRoot, "a", { state: "finished", endState: "success" });
    expect(await runPlan(["next", "plans/p1.json"], p.ctx)).toBe(0);
    expect(p.stdout()).toContain("failed-upstream b  a ended success; its latest attempt has no readable exit.json\n");
    expect(p.spawned.map((s) => s.lane)).toEqual(["c"]);

    reset();
    writeLaneRun(p.runsRoot, "a", { state: "finished", endState: "success", exit: { ...CHECKPOINTED, checkpoint: null } });
    expect(await runPlan(["next", "plans/p1.json"], p.ctx)).toBe(0);
    expect(p.spawned.map((s) => s.lane)).toEqual(["c", "b"]);
  });

  it("refuses a plan with errors and launches nothing", async () => {
    project({ ...PLAN, phases: [...PLAN.phases.slice(0, 2), { name: "c", brief: "lanes/demo.md", scope: ["src/a/**"] }] });
    await expect(runPlan(["next", "plans/p1.json"], p.ctx)).rejects.toMatchObject({ code: "lint", message: expect.stringMatching(/nothing launched/) });
    expect(p.stderr()).toContain("overlapping-scope");
    expect(p.spawned).toEqual([]);
    expect(existsSync(join(p.root, ".arbab", "plans"))).toBe(false);
  });

  it("reports a phase whose launch fails and still launches the others", async () => {
    project();
    const proj = openProject(p.ctx);
    p.alive.add(5150);
    const release = takeLaunchLock(p.ctx, proj, "a", 5150);
    try {
      const next = await planNext(p.ctx, proj, "plans/p1.json");
      expect(next.launched.map((l) => l.phase)).toEqual(["c"]);
      expect(next.errors).toEqual([{ phase: "a", message: expect.stringMatching(/being launched by another arbab process/) }]);
      expect(next.code).toBe(1);
    } finally {
      release();
    }
    expect(existsSync(launchLockPath(proj, "a"))).toBe(false);
    reset();
    p.alive.add(5150);
    takeLaunchLock(p.ctx, proj, "a", 5150);
    expect(await runPlan(["next", "plans/p1.json"], p.ctx)).toBe(1);
    expect(p.stderr()).toMatch(/^error a {2}lane a is being launched/m);
  });
});

describe("arbab plan status", () => {
  it("prints one row per phase with its wave, state and dependencies", async () => {
    project();
    p.alive.add(501);
    writeLaneRun(p.runsRoot, "a", { state: "running", shepherdPid: 501 });
    writeLaneRun(p.runsRoot, "c", { state: "running", shepherdPid: 502 });
    expect(await runPlan(["status", "plans/p1.json"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe(
      "PHASE  WAVE  STATE     END  DEPENDS ON\n" +
        "a      0     running   -    -\n" +
        "b      1     -         -    a\n" +
        "c      0     orphaned  -    -\n",
    );
    reset();
    expect(await runPlan(["status", "--json", "plans/p1.json"], p.ctx)).toBe(0);
    expect(json()).toEqual({
      plan: "p1",
      phases: [
        { phase: "a", wave: 0, dependsOn: [], state: "running", endState: null },
        { phase: "b", wave: 1, dependsOn: ["a"], state: null, endState: null },
        { phase: "c", wave: 0, dependsOn: [], state: "orphaned", endState: null },
      ],
    });
  });
});

describe("phaseStates", () => {
  it("maps never-launched phases to undefined and others to their effective state and latest exit", () => {
    project();
    writeLaneRun(p.runsRoot, "a", { state: "finished", endState: "success", exit: CHECKPOINTED });
    writeLaneRun(p.runsRoot, "c", { state: "running", shepherdPid: 501 });
    expect(phaseStates(openProject(p.ctx), PLAN, () => false)).toEqual({
      a: { state: "finished", endState: "success", exit: { checkpoint: SHA, checkpointError: null } },
      b: undefined,
      c: { state: "orphaned", endState: null, exit: null },
    });
  });
});

describe("latestExit", () => {
  it("reads the checkpoint fields of the latest attempt only", () => {
    project();
    writeLaneRun(p.runsRoot, "a", { state: "finished", endState: "success", exit: { ...CHECKPOINTED, checkpointError: "old" } });
    expect(latestExit(p.runsRoot, "a")).toEqual({ checkpoint: SHA, checkpointError: "old" });
    writeLaneRun(p.runsRoot, "a", { state: "finished", endState: "success", exit: { ...CHECKPOINTED, checkpoint: null } });
    expect(latestExit(p.runsRoot, "a")).toEqual({ checkpoint: null, checkpointError: null });
  });

  it("is null without an attempt, without exit.json, or with one that does not hold the fields", () => {
    project();
    expect(latestExit(p.runsRoot, "a")).toBeNull();
    const n = writeLaneRun(p.runsRoot, "a", { state: "finished", endState: "success", summary: { state: "success" } });
    expect(latestExit(p.runsRoot, "a")).toBeNull();
    const exit = join(p.runsRoot, "a", `attempt-${n}`, "exit.json");
    for (const text of ["{nope", "[]", "null", JSON.stringify({ checkpoint: 5, checkpointError: null }), JSON.stringify({ checkpoint: null })]) {
      writeFileSync(exit, text);
      expect(latestExit(p.runsRoot, "a"), text).toBeNull();
    }
  });
});

describe("formatPlanStatus", () => {
  it("prints the header alone for no rows", () => {
    expect(formatPlanStatus([])).toBe("PHASE  WAVE  STATE  END  DEPENDS ON");
  });
});

describe("runPlan", () => {
  it("refuses an unknown or missing sub-command", async () => {
    project();
    await expect(runPlan([], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/check\|next\|status/) });
    await expect(runPlan(["launch", "plans/p1.json"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runPlan(["__proto__", "plans/p1.json"], p.ctx)).rejects.toMatchObject({ code: "usage" });
  });
});
