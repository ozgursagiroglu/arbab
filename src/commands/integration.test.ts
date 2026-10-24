import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { integrationPaths } from "../integrate";
import { isAcked } from "../registry";
import type { IntegrationRecord, LaneSpec } from "../types";
import { runIntegrate } from "./integrate";
import {
  assertNotBorrowed,
  assertRecordedHead,
  attemptEvents,
  branchHead,
  collectRun,
  dropGeneratedWorktrees,
  generatedBase,
  generationOwner,
  laneFingerprint,
  latestReport,
  lintGeneratedLanes,
  manifestAdvice,
  openIntegration,
  markGenerated,
  readGeneratedRun,
  resetGeneratedWorktree,
  runGeneratedLanes,
  settleGeneratedRuns,
  unconfirmedManifests,
  writeGeneratedLane,
  type GeneratedLane,
  type LaneOutcome,
} from "./integration";
import { openProject } from "./project";
import { branchWith, makeProject, simulateShepherds, writeLaneRun, type LaneRun, type TestProject } from "./testkit";

let p: TestProject;
afterEach(() => p?.dispose());

// No command spans: the probe role has no project commands in the test config.
const DEFAULT_BRIEF = "# Generated\n\n## Task\n\nRead the tree.\n\n## Scope\n\nNothing is written.\n\n## Acceptance\n\n- Nothing changed.\n";

const record = (merged: IntegrationRecord["merged"], depsConfirmed: boolean): IntegrationRecord => {
  const manifests = [...new Set(merged.flatMap((m) => m.manifests))].sort();
  return {
    name: "rel",
    branch: "integrate/rel",
    worktree: "/w/integrate-rel",
    base: "main",
    baseSha: "b".repeat(40),
    merged,
    manifests,
    depsConfirmedAt: depsConfirmed && manifests.length > 0 ? "c".repeat(40) : null,
    depsConfirmed,
    headSha: "c".repeat(40),
    updatedAt: "2026-10-09T12:00:00.000Z",
  };
};
const lane = (name: string, manifests: string[]): IntegrationRecord["merged"][number] => ({ lane: name, branch: `arbab/${name}`, sha: "a".repeat(40), manifests });

const spec = (name: string, extra: Partial<LaneSpec> = {}): LaneSpec => ({
  name,
  role: "probe",
  brief: `.arbab/integrations/rel/lanes/${name}.md`,
  ...extra,
});

describe("unconfirmedManifests and manifestAdvice", () => {
  it("lists manifest lanes until the install is confirmed, with what to do", () => {
    const merged = [lane("a", []), lane("b", ["package.json", "pnpm-lock.yaml"])];
    expect(unconfirmedManifests(record(merged, false))).toEqual([{ by: "b", manifests: ["package.json", "pnpm-lock.yaml"] }]);
    expect(unconfirmedManifests(record(merged, true))).toEqual([]);
    expect(manifestAdvice(record(merged, false))).toEqual([
      "dependency manifests changed and were not installed (installing would run worker code on the host); a human, not the orchestrator:",
      "  b: package.json, pnpm-lock.yaml",
      `review the change and what an install at ${"c".repeat(40)} runs (package.json scripts and the files they run, .npmrc, ` +
        `.pnpmfile.*), install the dependencies in /w/integrate-rel yourself, then run: arbab integrate rel --deps-installed ${"c".repeat(40)}`,
      "confirming lets arbab install at that head on this machine for verify and review",
    ]);
    expect(manifestAdvice(record(merged, true))).toEqual([]);
  });

  it("lists every manifest of the record, naming every lane that changed it, and the ones no merged lane changed", () => {
    const merged = [lane("a", ["package.json"]), lane("b", ["package.json", "pnpm-lock.yaml"]), lane("c", [])];
    // Changed by a hand commit in the integration worktree, or by a merge whose record was lost.
    const rec = { ...record(merged, false), manifests: [".npmrc", "package.json", "pnpm-lock.yaml", "web/yarn.lock"] };
    expect(unconfirmedManifests(rec)).toEqual([
      { by: "a commit arbab did not merge", manifests: [".npmrc", "web/yarn.lock"] },
      { by: "a, b", manifests: ["package.json"] },
      { by: "b", manifests: ["pnpm-lock.yaml"] },
    ]);
    expect(manifestAdvice(rec).slice(1, -2)).toEqual([
      "  a commit arbab did not merge: .npmrc, web/yarn.lock",
      "  a, b: package.json",
      "  b: pnpm-lock.yaml",
    ]);
    // A manifest no merged lane changed is still one to confirm.
    const unmerged = { ...record([lane("a", [])], true), manifests: ["package.json"], depsConfirmedAt: null, depsConfirmed: false };
    expect(manifestAdvice(unmerged)[1]).toBe("  a commit arbab did not merge: package.json");
    expect(manifestAdvice({ ...unmerged, depsConfirmedAt: "c".repeat(40), depsConfirmed: true })).toEqual([]);
  });
});

describe("generatedBase", () => {
  const BASE = "b".repeat(40);
  const HEAD = "c".repeat(40);
  const CONFIRMED = "d".repeat(40);

  it("starts on the integration's base commit and merges the head when no manifest changed", () => {
    expect(generatedBase(record([lane("a", [])], true))).toEqual({ base: BASE, mergeBranches: [HEAD] });
    // Nothing merged since the base: nothing to merge either.
    expect(generatedBase({ ...record([], true), headSha: BASE })).toEqual({ base: BASE });
  });

  it("starts on the head a human confirmed when manifests changed, merging the head only when it moved on", () => {
    const merged = [lane("m", ["package.json"]), lane("b", [])];
    expect(generatedBase({ ...record(merged, true), depsConfirmedAt: CONFIRMED })).toEqual({ base: CONFIRMED, mergeBranches: [HEAD] });
    expect(generatedBase({ ...record(merged, true), depsConfirmedAt: HEAD })).toEqual({ base: HEAD });
  });

  it("never starts on the integration branch, whose name a later integrate moves", () => {
    for (const rec of [record([lane("a", [])], true), record([lane("m", ["package.json"])], true)]) {
      expect(JSON.stringify(generatedBase(rec))).not.toContain("integrate/");
    }
  });

  it("refuses unconfirmed manifest changes with what to do, naming who changed each", () => {
    const merged = [lane("a", []), lane("b", ["package.json"]), lane("c", ["go.mod", "go.sum"])];
    // In the order the record lists its manifests.
    expect(() => generatedBase(record(merged, false))).toThrow(
      `c changed go.mod, go.sum; b changed package.json: review the change and what an install at ${HEAD} runs ` +
        "(package.json scripts and the files they run, .npmrc, .pnpmfile.*), install the dependencies in /w/integrate-rel " +
        `yourself, then run arbab integrate rel --deps-installed ${HEAD}`,
    );
    expect(() => generatedBase(record(merged, false))).toThrow(expect.objectContaining({ code: "usage" }));
    // A manifest no merged lane changed refuses as well: the record's manifests decide, not the lanes'.
    const unmerged = { ...record([lane("a", [])], true), manifests: ["package.json"], depsConfirmedAt: null, depsConfirmed: false };
    expect(() => generatedBase(unmerged)).toThrow(/^a commit arbab did not merge changed package\.json: review the change/);
  });
});

describe("generationOwner", () => {
  it("names the integration, its branch and its recorded head", async () => {
    p = makeProject();
    branchWith(p, "arbab/a", "a.txt", "a\n");
    expect(await runIntegrate(["rel", "--lanes", "a"], p.ctx)).toBe(0);
    const integration = openIntegration(openProject(p.ctx), "rel");
    expect(generationOwner(integration)).toEqual({ integration: "rel", branch: "integrate/rel", head: integration.record.headSha });
  });
});

describe("openIntegration, branchHead and assertRecordedHead", () => {
  it("opens an existing integration and checks its branch against the record", async () => {
    p = makeProject();
    const project = openProject(p.ctx);
    expect(() => openIntegration(project, "rel")).toThrow(/does not exist; run arbab integrate rel first/);
    branchWith(p, "arbab/a", "a.txt", "a\n");
    expect(await runIntegrate(["rel", "--lanes", "a"], p.ctx)).toBe(0);
    const integration = openIntegration(project, "rel");
    expect(branchHead(p.git, p.root, "integrate/rel")).toBe(integration.record.headSha);
    expect(branchHead(p.git, p.root, "no-such")).toBeNull();
    expect(() => assertRecordedHead(p.git, project, integration)).not.toThrow();
    p.ok(["commit", "-q", "--allow-empty", "-m", "by hand"], integration.record.worktree);
    expect(() => assertRecordedHead(p.git, project, integration)).toThrow(/run arbab integrate rel again/);
  });
});

describe("writeGeneratedLane and lintGeneratedLanes", () => {
  it("writes the brief, the schema and the lane file under the integration's lanes dir", () => {
    p = makeProject();
    const project = openProject(p.ctx);
    const paths = integrationPaths(project.root, project.config, "rel");
    const file = writeGeneratedLane(project, paths, {
      spec: spec("rel-x", { schema: ".arbab/integrations/rel/lanes/rel-x.schema.json" }),
      brief: DEFAULT_BRIEF,
      schema: { type: "object" },
    });
    expect(file).toBe(join(paths.lanesDir, "rel-x.json"));
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ name: "rel-x", role: "probe" });
    expect(readFileSync(join(paths.lanesDir, "rel-x.md"), "utf8")).toBe(DEFAULT_BRIEF);
    expect(JSON.parse(readFileSync(join(paths.lanesDir, "rel-x.schema.json"), "utf8"))).toEqual({ type: "object" });
    expect(() => lintGeneratedLanes(p.ctx, project, [file])).not.toThrow();
  });

  it("writes the lane file in paths.lanesDir, wherever that is", () => {
    p = makeProject();
    const project = openProject(p.ctx);
    const paths = { ...integrationPaths(project.root, project.config, "rel"), lanesDir: join(p.root, ".arbab", "generated") };
    expect(writeGeneratedLane(project, paths, { spec: spec("rel-x"), brief: DEFAULT_BRIEF })).toBe(join(p.root, ".arbab", "generated", "rel-x.json"));
    expect(existsSync(join(p.root, ".arbab", "integrations", "rel", "lanes", "rel-x.json"))).toBe(false);
  });

  it("refuses a schema without a path, a brief outside the project, and a lane that fails lint", () => {
    p = makeProject();
    const project = openProject(p.ctx);
    const paths = integrationPaths(project.root, project.config, "rel");
    expect(() => writeGeneratedLane(project, paths, { spec: spec("rel-x"), brief: "b", schema: {} })).toThrow(/no schema path/);
    expect(() => writeGeneratedLane(project, paths, { spec: spec("rel-x", { brief: "../out.md" }), brief: "b" })).toThrow(/outside/);
    const bad = writeGeneratedLane(project, paths, { spec: spec("rel-bad", { allow: ["Bash"] }), brief: DEFAULT_BRIEF });
    expect(() => lintGeneratedLanes(p.ctx, project, [bad])).toThrow(/rel-bad: 1 error\(s\).*nothing launched/);
    expect(p.stderr()).toContain("bare-bash-allow");
  });
});

describe("resetGeneratedWorktree", () => {
  const T = "2026-10-09T00:00:00.000Z";
  // The integration branch is main here; its head is the lane's base.
  const owner = (t: TestProject, integration = "rel") => ({ integration, branch: "main", head: t.ok(["rev-parse", "main"]).trim() });

  it("removes the worktree and branch of a lane it generated, and does nothing when there are none", () => {
    p = makeProject();
    const project = openProject(p.ctx);
    expect(() => resetGeneratedWorktree(p.ctx, project, "rel-verify", owner(p))).not.toThrow();
    const path = join(p.worktreeRoot, "rel-verify");
    p.ok(["worktree", "add", "-q", "-b", "arbab/rel-verify", path, "main"]);
    writeFileSync(join(path, "scratch.txt"), "left by the worker\n");
    markGenerated(project.runsRoot, "rel-verify", owner(p), T);
    resetGeneratedWorktree(p.ctx, project, "rel-verify", owner(p));
    expect(existsSync(path)).toBe(false);
    expect(branchHead(p.git, p.root, "arbab/rel-verify")).toBeNull();
  });

  it("refuses a lane with the same name that it did not generate, and removes nothing", () => {
    p = makeProject();
    const project = openProject(p.ctx);
    const path = join(p.worktreeRoot, "rel-verify");
    p.ok(["worktree", "add", "-q", "-b", "arbab/rel-verify", path, "main"]);
    expect(() => resetGeneratedWorktree(p.ctx, project, "rel-verify", owner(p))).toThrow(/was not generated for integration rel/);
    markGenerated(project.runsRoot, "rel-verify", owner(p, "other"), T);
    expect(() => resetGeneratedWorktree(p.ctx, project, "rel-verify", owner(p))).toThrow(/nothing was removed/);
    expect(existsSync(path)).toBe(true);
    expect(branchHead(p.git, p.root, "arbab/rel-verify")).not.toBeNull();
  });

  it("never deletes a branch with commits that are not on the integration branch", () => {
    p = makeProject();
    const project = openProject(p.ctx);
    const path = join(p.worktreeRoot, "rel-verify");
    p.ok(["worktree", "add", "-q", "-b", "arbab/rel-verify", path, "main"]);
    writeFileSync(join(path, "work.txt"), "a commit of its own\n");
    p.ok(["add", "-A"], path);
    p.ok(["commit", "-q", "-m", "own work"], path);
    markGenerated(project.runsRoot, "rel-verify", owner(p), T);
    expect(() => resetGeneratedWorktree(p.ctx, project, "rel-verify", owner(p))).toThrow(/commits that are not on main/);
    expect(existsSync(join(path, "work.txt"))).toBe(true);
  });

  it("resets a lane still at the head it started from after the integration branch was recreated without it", () => {
    p = makeProject();
    const project = openProject(p.ctx);
    // The old integration head, which the recreated integration branch (main here) does not contain.
    const old = branchWith(p, "integrate/old", "x.txt", "x\n");
    const path = join(p.worktreeRoot, "rel-verify");
    p.ok(["worktree", "add", "-q", "-b", "arbab/rel-verify", path, old]);
    markGenerated(project.runsRoot, "rel-verify", { ...owner(p), head: old }, T);
    expect(JSON.parse(readFileSync(join(p.runsRoot, "rel-verify", "generated.json"), "utf8"))).toEqual({ by: "integration:rel", createdAt: T, baseSha: old });
    resetGeneratedWorktree(p.ctx, project, "rel-verify", owner(p));
    expect(existsSync(path)).toBe(false);
    expect(branchHead(p.git, p.root, "arbab/rel-verify")).toBeNull();
  });

  it("keeps the old rule for a marker without baseSha: commits off the integration branch are never deleted", () => {
    p = makeProject();
    const project = openProject(p.ctx);
    const old = branchWith(p, "integrate/old", "x.txt", "x\n");
    p.ok(["branch", "arbab/rel-verify", old]);
    mkdirSync(join(p.runsRoot, "rel-verify"), { recursive: true });
    writeFileSync(join(p.runsRoot, "rel-verify", "generated.json"), JSON.stringify({ by: "integration:rel", createdAt: T }));
    expect(() => resetGeneratedWorktree(p.ctx, project, "rel-verify", owner(p))).toThrow(/commits that are not on main/);
    expect(branchHead(p.git, p.root, "arbab/rel-verify")).toBe(old);
    p.ok(["branch", "-f", "arbab/rel-verify", "main"]);
    expect(() => resetGeneratedWorktree(p.ctx, project, "rel-verify", owner(p))).not.toThrow();
    expect(branchHead(p.git, p.root, "arbab/rel-verify")).toBeNull();
  });

  it("refuses a lane that is still active", () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "rel-verify", { state: "running", shepherdPid: 6000 });
    p.alive.add(6000);
    expect(() => resetGeneratedWorktree(p.ctx, openProject(p.ctx), "rel-verify", owner(p))).toThrow(/is running/);
  });

  it("refuses, removing nothing, while an active lane borrows the generated worktree", () => {
    p = makeProject();
    const project = openProject(p.ctx);
    const path = join(p.worktreeRoot, "rel-verify");
    p.ok(["worktree", "add", "-q", "-b", "arbab/rel-verify", path, "main"]);
    markGenerated(project.runsRoot, "rel-verify", owner(p), T);
    writeLaneRun(p.runsRoot, "borrower", { state: "running", shepherdPid: 6001, lane: { name: "borrower", role: "implementer", brief: "lanes/demo.md", worktree: "rel-verify" } });
    p.alive.add(6001);
    expect(() => resetGeneratedWorktree(p.ctx, project, "rel-verify", owner(p))).toThrow(
      "lane borrower works in lane rel-verify's worktree and is running, so nothing was removed; stop it or wait for it first",
    );
    expect(existsSync(path)).toBe(true);
    expect(branchHead(p.git, p.root, "arbab/rel-verify")).not.toBeNull();
    // Once the borrower's shepherd is gone and its run finished, the reset goes ahead.
    writeLaneRun(p.runsRoot, "borrower", { state: "finished", endState: "success", shepherdPid: 6001, lane: { name: "borrower", role: "implementer", brief: "lanes/demo.md", worktree: "rel-verify" } });
    p.alive.delete(6001);
    resetGeneratedWorktree(p.ctx, project, "rel-verify", owner(p));
    expect(existsSync(path)).toBe(false);
  });
});

describe("assertNotBorrowed", () => {
  it("ignores lanes with their own worktree, other borrowings and inactive borrowers, and refuses an unreadable one", () => {
    p = makeProject();
    const project = openProject(p.ctx);
    const run = (name: string, worktree: string | undefined, state: "running" | "finished"): void => {
      writeLaneRun(p.runsRoot, name, { state, shepherdPid: 7001, lane: { name, role: "implementer", brief: "lanes/demo.md", ...(worktree && { worktree }) } });
    };
    p.alive.add(7001);
    run("own", undefined, "running");
    run("other", "elsewhere", "running");
    run("done", "rel-verify", "finished");
    expect(() => assertNotBorrowed(p.ctx, project, "rel-verify")).not.toThrow();
    run("broken", "rel-verify", "running");
    writeFileSync(join(p.runsRoot, "broken", "state.json"), "{not json");
    expect(() => assertNotBorrowed(p.ctx, project, "rel-verify")).toThrow(/^lane broken works in lane rel-verify's worktree and is unreadable/);
  });
});

describe("collectRun, attemptEvents and latestReport", () => {
  it("collects this run's attempts and latest report, and acks the run", () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "x", { state: "finished", endState: "usage-limit", stream: '{"n":1}\n', report: { old: true } });
    writeLaneRun(p.runsRoot, "x", { state: "finished", endState: "success", shepherdPid: 7001, stream: '{"n":2}\nnot json\n{"n":3}\n' });
    const outcome = collectRun(p.runsRoot, { lane: "x", pid: 7001, before: 0 });
    expect(outcome).toEqual({ lane: "x", endState: "success", reason: null, attempts: [1, 2], report: null });
    expect(isAcked(p.runsRoot, "x", { shepherdPid: 7001, since: "2026-10-09T11:50:00.000Z" })).toBe(true);
    expect(attemptEvents(p.runsRoot, "x", outcome.attempts)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    // The latest attempt has no report: an older attempt's report never stands in for it.
    expect(latestReport(p.runsRoot, "x")).toBeNull();
    writeLaneRun(p.runsRoot, "x", { state: "finished", endState: "success", shepherdPid: 7002, report: { latest: true } });
    expect(latestReport(p.runsRoot, "x")).toEqual({ latest: true });
    expect(latestReport(p.runsRoot, "none")).toBeNull();
  });

  it("gives no end state when the run's own shepherd never finished it", () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "x", { state: "finished", endState: "success", shepherdPid: 7001 });
    expect(collectRun(p.runsRoot, { lane: "x", pid: 7002, before: 0 })).toMatchObject({ endState: null, attempts: [] });
  });

  it("reads a report that does not parse as none", () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "x", { state: "finished", endState: "success", stream: "" });
    mkdirSync(join(p.runsRoot, "x", "attempt-1"), { recursive: true });
    writeFileSync(join(p.runsRoot, "x", "attempt-1", "report.json"), "{");
    expect(latestReport(p.runsRoot, "x")).toBeNull();
  });
});

const generated = (names: string[], brief = DEFAULT_BRIEF): GeneratedLane[] => names.map((name) => ({ spec: spec(name), brief }));
const setup = (t: TestProject) => {
  const project = openProject(t.ctx);
  const paths = integrationPaths(project.root, project.config, "rel");
  const owner = { integration: "rel", branch: "main", head: t.ok(["rev-parse", "main"]).trim() };
  return { project, paths, owner };
};

/** simulateShepherds, plus the worktree a real shepherd checks the lane's branch out in. */
function simulateWithWorktrees(t: TestProject, runs: Record<string, (pid: number) => LaneRun | null>): void {
  simulateShepherds(t, runs);
  const spawn = t.ctx.spawnShepherd;
  t.ctx.spawnShepherd = (root, lane, mode) => {
    const pid = spawn(root, lane, mode);
    const worktree = join(t.worktreeRoot, lane);
    if (!existsSync(worktree)) t.ok(["worktree", "add", "-q", worktree, `arbab/${lane}`]);
    return pid;
  };
}

describe("runGeneratedLanes", () => {
  const pidOf = (t: TestProject, lane: string): number => (JSON.parse(readFileSync(join(t.runsRoot, lane, "state.json"), "utf8")) as { shepherdPid: number }).shepherdPid;

  it("writes, lints and launches every lane, waits for all and collects them; times out without collecting", async () => {
    p = makeProject();
    const { project, paths, owner } = setup(p);
    simulateShepherds(p, {
      "rel-a": () => ({ state: "finished", endState: "success", report: { a: 1 } }),
      "rel-b": () => ({ state: "finished", endState: "failed" }),
    });
    const run = await runGeneratedLanes(p.ctx, project, paths, generated(["rel-a", "rel-b"]), 60_000, owner);
    expect(run.timedOut).toBe(false);
    expect(run.outcomes.map((o) => [o.lane, o.endState, o.report])).toEqual([
      ["rel-a", "success", { a: 1 }],
      ["rel-b", "failed", null],
    ]);
    expect(readFileSync(join(paths.lanesDir, "rel-a.md"), "utf8")).toBe(DEFAULT_BRIEF);
    expect(readGeneratedRun(paths.lanesDir, "rel-a")).toEqual({
      lane: "rel-a",
      shepherdPid: pidOf(p, "rel-a"),
      before: 0,
      head: owner.head,
      fingerprint: laneFingerprint(generated(["rel-a"])[0] as GeneratedLane),
      settled: false,
    });
    expect(p.stderr()).toBe("launched rel-a, rel-b; waiting\n");

    settleGeneratedRuns(paths.lanesDir, ["rel-a", "rel-b", "rel-none"]);
    expect(readGeneratedRun(paths.lanesDir, "rel-a")?.settled).toBe(true);
    simulateShepherds(p, { "rel-a": () => ({ state: "running" }) });
    // A settled run is not taken again: the lane is reset and relaunched, which `arbab launch` would refuse.
    expect(await runGeneratedLanes(p.ctx, project, paths, generated(["rel-a"]), 60_000, owner)).toEqual({ timedOut: true, outcomes: [] });
    expect(p.spawned.map((s) => s.lane)).toEqual(["rel-a", "rel-b", "rel-a"]);
  });

  it("lints every lane before launching any", async () => {
    p = makeProject();
    const { project, paths, owner } = setup(p);
    simulateShepherds(p, {});
    const lanes = [...generated(["rel-a"]), { spec: spec("rel-bad", { allow: ["Bash"] }), brief: DEFAULT_BRIEF }];
    await expect(runGeneratedLanes(p.ctx, project, paths, lanes, 60_000, owner)).rejects.toMatchObject({ code: "lint" });
    expect(p.spawned).toEqual([]);
  });

  it("after a timeout, waits for a run still active on the same head instead of relaunching it", async () => {
    p = makeProject();
    const { project, paths, owner } = setup(p);
    simulateShepherds(p, { "rel-a": () => ({ state: "running" }) });
    expect(await runGeneratedLanes(p.ctx, project, paths, generated(["rel-a"]), 60_000, owner)).toEqual({ timedOut: true, outcomes: [] });
    const pid = pidOf(p, "rel-a");
    // The run finishes while the second command waits.
    const sleep = p.ctx.sleep;
    p.ctx.sleep = async (ms) => {
      writeLaneRun(p.runsRoot, "rel-a", { state: "finished", endState: "success", shepherdPid: pid, report: { late: true } });
      p.alive.delete(pid);
      await sleep(ms);
    };
    p.err.length = 0;
    const run = await runGeneratedLanes(p.ctx, project, paths, generated(["rel-a"]), 60_000, owner);
    expect(run).toEqual({ timedOut: false, outcomes: [{ lane: "rel-a", endState: "success", reason: null, attempts: [1], report: { late: true } }] });
    expect(p.spawned.map((s) => s.lane)).toEqual(["rel-a"]);
    expect(p.stderr()).toBe("rel-a still running for this head from an earlier run; waiting\n");
  });

  it("after a timeout, adopts a run that finished on the same head, launching only the others", async () => {
    p = makeProject();
    const { project, paths, owner } = setup(p);
    simulateWithWorktrees(p, { "rel-a": () => ({ state: "running" }), "rel-b": () => ({ state: "running" }) });
    expect((await runGeneratedLanes(p.ctx, project, paths, generated(["rel-a", "rel-b"]), 60_000, owner)).timedOut).toBe(true);
    writeLaneRun(p.runsRoot, "rel-a", { state: "finished", endState: "success", shepherdPid: pidOf(p, "rel-a"), report: { a: 1 } });
    // rel-b's shepherd died: its run never finished, so it is launched again.
    p.alive.delete(pidOf(p, "rel-b"));
    simulateShepherds(p, { "rel-b": () => ({ state: "finished", endState: "success", report: { b: 2 } }) });
    p.err.length = 0;
    const run = await runGeneratedLanes(p.ctx, project, paths, generated(["rel-a", "rel-b"]), 60_000, owner);
    expect(run.outcomes.map((o) => [o.lane, o.endState, o.report])).toEqual([
      ["rel-a", "success", { a: 1 }],
      ["rel-b", "success", { b: 2 }],
    ]);
    expect(p.spawned.map((s) => s.lane)).toEqual(["rel-a", "rel-b", "rel-b"]);
    expect(p.stderr()).toBe("adopted rel-a: finished for this head after an earlier run stopped waiting\nlaunched rel-b; waiting\n");
  });

  it("relaunches a finished, unsettled run whose worktree is gone instead of adopting it", async () => {
    p = makeProject();
    const { project, paths, owner } = setup(p);
    simulateWithWorktrees(p, { "rel-a": () => ({ state: "running" }) });
    expect((await runGeneratedLanes(p.ctx, project, paths, generated(["rel-a"]), 60_000, owner)).timedOut).toBe(true);
    writeLaneRun(p.runsRoot, "rel-a", { state: "finished", endState: "success", shepherdPid: pidOf(p, "rel-a"), report: { old: true } });
    // Removed by hand, or by an idle sweep, before the next command came for it.
    p.ok(["worktree", "remove", "--force", join(p.worktreeRoot, "rel-a")]);
    expect(readGeneratedRun(paths.lanesDir, "rel-a")?.settled).toBe(false);
    simulateWithWorktrees(p, { "rel-a": () => ({ state: "finished", endState: "success", report: { fresh: true } }) });
    p.err.length = 0;
    const run = await runGeneratedLanes(p.ctx, project, paths, generated(["rel-a"]), 60_000, owner);
    expect(run.outcomes.map((o) => [o.lane, o.endState, o.report])).toEqual([["rel-a", "success", { fresh: true }]]);
    expect(p.spawned.map((s) => s.lane)).toEqual(["rel-a", "rel-a"]);
    expect(p.stderr()).toBe("launched rel-a; waiting\n");
  });

  it("relaunches a finished run that failed, left no usable report, or ran another lane or head", async () => {
    const cases: Array<{ why: string; run: LaneRun; again?: (t: TestProject) => { brief?: string; head?: string }; usable?: (o: LaneOutcome) => boolean }> = [
      { why: "failed", run: { state: "finished", endState: "failed", report: { a: 1 } } },
      { why: "no report", run: { state: "finished", endState: "success" } },
      { why: "not usable", run: { state: "finished", endState: "success", report: { a: 1 } }, usable: () => false },
      { why: "other brief", run: { state: "finished", endState: "success", report: { a: 1 } }, again: () => ({ brief: DEFAULT_BRIEF.replace("Read", "Scan") }) },
      { why: "other head", run: { state: "finished", endState: "success", report: { a: 1 } }, again: (t) => ({ head: branchWith(t, "integrate/next", "n.txt", "n\n") }) },
    ];
    for (const c of cases) {
      p = makeProject();
      const { project, paths, owner } = setup(p);
      // With its worktree: a run without one is relaunched whatever else it left.
      simulateWithWorktrees(p, { "rel-a": () => ({ state: "running" }) });
      expect((await runGeneratedLanes(p.ctx, project, paths, generated(["rel-a"]), 60_000, owner)).timedOut, c.why).toBe(true);
      writeLaneRun(p.runsRoot, "rel-a", { ...c.run, shepherdPid: pidOf(p, "rel-a") });
      const again = c.again?.(p) ?? {};
      simulateShepherds(p, { "rel-a": () => ({ state: "finished", endState: "success", report: { fresh: true } }) });
      const run = await runGeneratedLanes(p.ctx, project, paths, generated(["rel-a"], again.brief), 60_000, { ...owner, head: again.head ?? owner.head }, c.usable);
      expect(run.outcomes.map((o) => o.report), c.why).toEqual([{ fresh: true }]);
      expect(p.spawned.map((s) => s.lane), c.why).toEqual(["rel-a", "rel-a"]);
      p.dispose();
    }
  });

  it("refuses, writing nothing, a lane still running for another brief", async () => {
    p = makeProject();
    const { project, paths, owner } = setup(p);
    simulateShepherds(p, { "rel-a": () => ({ state: "running" }) });
    expect((await runGeneratedLanes(p.ctx, project, paths, generated(["rel-a"]), 60_000, owner)).timedOut).toBe(true);
    await expect(runGeneratedLanes(p.ctx, project, paths, generated(["rel-a"], "# Other\n"), 60_000, owner)).rejects.toThrow(/lane rel-a is running/);
    expect(readFileSync(join(paths.lanesDir, "rel-a.md"), "utf8")).toBe(DEFAULT_BRIEF);
    expect(p.spawned.map((s) => s.lane)).toEqual(["rel-a"]);
  });
});

describe("dropGeneratedWorktrees", () => {
  it("removes the lanes' worktrees and branches, keeping their run dirs, markers and run records, and a next run launches afresh", async () => {
    p = makeProject();
    const { project, paths, owner } = setup(p);
    const ok = () => ({ state: "finished" as const, endState: "success" as const, report: { a: 1 } });
    simulateWithWorktrees(p, { "rel-a": ok, "rel-b": ok });
    expect((await runGeneratedLanes(p.ctx, project, paths, generated(["rel-a", "rel-b"]), 60_000, owner)).timedOut).toBe(false);
    settleGeneratedRuns(paths.lanesDir, ["rel-a", "rel-b"]);
    // A lane that left nothing behind is passed over.
    expect(dropGeneratedWorktrees(p.ctx, project, ["rel-a", "rel-b", "rel-none"], owner)).toEqual([]);
    for (const lane of ["rel-a", "rel-b"]) {
      expect(existsSync(join(p.worktreeRoot, lane))).toBe(false);
      expect(branchHead(p.git, p.root, `arbab/${lane}`)).toBeNull();
      expect(existsSync(join(p.runsRoot, lane, "state.json"))).toBe(true);
      expect(existsSync(join(p.runsRoot, lane, "generated.json"))).toBe(true);
      expect(readGeneratedRun(paths.lanesDir, lane)?.settled).toBe(true);
    }
    expect(p.ok(["worktree", "list", "--porcelain"])).not.toContain("rel-a");

    simulateWithWorktrees(p, { "rel-a": ok, "rel-b": ok });
    const again = await runGeneratedLanes(p.ctx, project, paths, generated(["rel-a", "rel-b"]), 60_000, owner);
    expect(again.outcomes.map((o) => [o.lane, o.endState, o.attempts])).toEqual([
      ["rel-a", "success", [2]],
      ["rel-b", "success", [2]],
    ]);
    expect(p.spawned.map((s) => s.lane)).toEqual(["rel-a", "rel-b", "rel-a", "rel-b"]);
  });

  it("never throws: each lane it refuses is one warning, kept as it was, and the other lanes still go", async () => {
    p = makeProject();
    const { project, paths, owner } = setup(p);
    const ok = () => ({ state: "finished" as const, endState: "success" as const, report: { a: 1 } });
    simulateWithWorktrees(p, { "rel-a": ok, "rel-b": ok, "rel-c": () => ({ state: "running" }) });
    expect((await runGeneratedLanes(p.ctx, project, paths, generated(["rel-a", "rel-b"]), 60_000, owner)).timedOut).toBe(false);
    expect((await runGeneratedLanes(p.ctx, project, paths, generated(["rel-c"]), 60_000, owner)).timedOut).toBe(true);
    const commit = join(p.worktreeRoot, "rel-a");
    writeFileSync(join(commit, "work.txt"), "a commit of its own\n");
    p.ok(["add", "-A"], commit);
    p.ok(["commit", "-q", "-m", "own work"], commit);
    // A lane of the same name that this integration did not generate.
    const foreign = join(p.worktreeRoot, "rel-x");
    p.ok(["worktree", "add", "-q", "-b", "arbab/rel-x", foreign, "main"]);

    expect(dropGeneratedWorktrees(p.ctx, project, ["rel-a", "rel-x", "rel-c", "rel-b"], owner)).toEqual([
      "could not remove rel-a's worktree and branch: arbab/rel-a has commits that are not on main, so nothing was removed",
      "could not remove rel-x's worktree and branch: lane rel-x already exists and was not generated for integration rel, so nothing was removed; " +
        "use another integration name, or rename that lane",
      expect.stringMatching(/^could not remove rel-c's worktree and branch: lane rel-c is running \(shepherd \d+\); stop it or wait for it first$/),
    ]);
    expect(existsSync(join(commit, "work.txt"))).toBe(true);
    expect(existsSync(foreign)).toBe(true);
    expect(existsSync(join(p.worktreeRoot, "rel-c"))).toBe(true);
    expect(branchHead(p.git, p.root, "arbab/rel-c")).not.toBeNull();
    expect(existsSync(join(p.worktreeRoot, "rel-b"))).toBe(false);
    expect(branchHead(p.git, p.root, "arbab/rel-b")).toBeNull();
  });
});

describe("readGeneratedRun", () => {
  it("reads a run record whose fields fit, and null for anything else", () => {
    p = makeProject();
    const dir = join(p.root, ".arbab", "integrations", "rel", "lanes");
    mkdirSync(dir, { recursive: true });
    const valid = { lane: "rel-a", shepherdPid: 9000, before: 2, head: "c".repeat(40), fingerprint: "f", settled: false };
    const write = (value: unknown): void => writeFileSync(join(dir, "rel-a.run.json"), typeof value === "string" ? value : JSON.stringify(value));
    expect(readGeneratedRun(dir, "rel-a")).toBeNull();
    write(valid);
    expect(readGeneratedRun(dir, "rel-a")).toEqual(valid);
    for (const bad of [{ ...valid, lane: "rel-b" }, { ...valid, head: "main" }, { ...valid, before: "2" }, { ...valid, settled: 1 }, [valid], "{"]) {
      write(bad);
      expect(readGeneratedRun(dir, "rel-a")).toBeNull();
    }
  });
});

describe("laneFingerprint", () => {
  it("changes with the spec, the brief and the schema", () => {
    const lane: GeneratedLane = { spec: spec("rel-a"), brief: DEFAULT_BRIEF };
    const variants: GeneratedLane[] = [lane, { ...lane, brief: "x" }, { ...lane, spec: spec("rel-a", { base: "main" }) }, { ...lane, schema: { type: "object" } }];
    const prints = variants.map(laneFingerprint);
    expect(new Set(prints).size).toBe(4);
    expect(laneFingerprint({ ...lane })).toBe(prints[0]);
  });
});
