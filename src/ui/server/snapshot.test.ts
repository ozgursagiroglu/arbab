import { mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { markGenerated } from "../../commands/generated";
import { openProject } from "../../commands/project";
import { DEFAULT_CONFIG, NOW_MS, SHEPHERD_PID, makeProject, writeLaneRun, type LaneRun, type TestProject } from "../../commands/testkit";
import { updateQuota } from "../../quota";
import { readState, runPaths, writeState } from "../../registry";
import { INTEGRATIONS_DIR, NO_FREE_SLOT_REASON } from "../../types";
import type { IntegrationRecord, LaneStateRecord, ReadinessReport, ReviewFinding, ReviewRecord } from "../../types";
import type { UiLane, UiSnapshot } from "../protocol";
import { MAX_LANES, createSnapshotBuilder, type SnapshotSource } from "./snapshot";
import { createToolCallCounter, type ToolCallCounter } from "./tail";

let p: TestProject;
afterEach(() => p?.dispose());

const HOUR = 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString();
const ago = (hours: number): string => iso(NOW_MS - hours * HOUR);
const SHA = (c: string): string => c.repeat(40);

function source(over: Partial<SnapshotSource> = {}): SnapshotSource {
  const project = openProject(p.ctx);
  return {
    root: project.root,
    runsRoot: project.runsRoot,
    config: project.config,
    home: p.home,
    version: "9.9.9",
    alive: (pid) => p.alive.has(pid),
    windowHours: 24,
    counter: createToolCallCounter(),
    ...over,
  };
}

const build = (over: Partial<SnapshotSource> = {}, nowMs = NOW_MS): UiSnapshot => createSnapshotBuilder(source(over)).build(nowMs);
const lane = (snapshot: UiSnapshot, name: string): UiLane | undefined => snapshot.lanes.find((l) => l.name === name);
const names = (snapshot: UiSnapshot): string[] => snapshot.lanes.map((l) => l.name);

/** writeLaneRun, then the state fields it does not write (reason, until) and a since of our choosing. */
function run(name: string, spec: LaneRun & { reason?: string; until?: number }): void {
  writeLaneRun(p.runsRoot, name, spec);
  if (spec.reason !== undefined || spec.until !== undefined) {
    const record = readState(p.runsRoot, name) as LaneStateRecord;
    writeState(p.runsRoot, { ...record, ...(spec.reason !== undefined && { reason: spec.reason }), ...(spec.until !== undefined && { until: spec.until }) });
  }
}

const finished = (since: string, extra: Partial<LaneRun> = {}): LaneRun => ({
  state: "finished",
  endState: "success",
  since,
  started: { startedAt: since },
  summary: { state: "success", wallMs: 1000, turns: 2, toolCallTotal: 3, costUsd: 0.5, costDeltaUsd: 0.5 },
  ...extra,
});

function integrationDir(name: string): string {
  const dir = join(p.root, INTEGRATIONS_DIR, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function integration(name: string, lanes: string[], updatedAt: string, head = SHA("a")): void {
  const record: IntegrationRecord = {
    name,
    branch: `integrate/${name}`,
    worktree: "/nonexistent",
    base: "main",
    baseSha: SHA("b"),
    merged: lanes.map((l) => ({ lane: l, branch: `arbab/${l}`, sha: SHA("c"), manifests: [] })),
    manifests: [],
    depsConfirmedAt: null,
    depsConfirmed: true,
    headSha: head,
    updatedAt,
  };
  writeFileSync(join(integrationDir(name), "integration.json"), JSON.stringify(record));
}

function landed(name: string, landedAt: string): void {
  writeFileSync(
    join(integrationDir(name), "landing.json"),
    JSON.stringify({ name, into: "main", integrationHead: SHA("a"), mergeSha: SHA("d"), landedAt, pushed: false }),
  );
}

const finding = (id: string, verdict: ReviewFinding["verdict"]): ReviewFinding => ({
  id,
  lens: "security",
  title: "t",
  severity: "MEDIUM",
  file: "src/a.ts",
  failureScenario: "f",
  evidence: "e",
  verdict,
});

describe("createSnapshotBuilder: the snapshot's frame", () => {
  it("carries the protocol, version, project name, the clock, maxParallel and the quota", () => {
    p = makeProject({ config: { ...DEFAULT_CONFIG, maxParallel: 6, quota: { holdAbove: { fiveHour: 0.8, sevenDay: 0.95 } } } });
    const nowSec = NOW_MS / 1000;
    updateQuota(p.home, {
      observedAt: ago(0.1),
      status: "allowed",
      type: null,
      fiveHour: { utilization: 0.85, resetsAt: nowSec + 600 },
      sevenDay: { utilization: 0.2, resetsAt: nowSec + 86_400 },
    });
    const s = build();
    expect(s).toMatchObject({ protocol: 1, version: "9.9.9", project: "repo", now: iso(NOW_MS), maxParallel: 6, lanes: [], hiddenLanes: 0, integrations: [] });
    expect(s.quota).toEqual({
      status: "allowed",
      fiveHour: { utilization: 0.85, resetsAt: nowSec + 600 },
      sevenDay: { utilization: 0.2, resetsAt: nowSec + 86_400 },
      observedAt: ago(0.1),
      hold: { hold: true, reason: "five-hour window at 85% (hold above 80%)", until: nowSec + 600 },
      holdAbove: { fiveHour: 0.8, sevenDay: 0.95 },
    });
  });

  it("has an empty quota without a snapshot", () => {
    p = makeProject();
    expect(build().quota).toMatchObject({ status: null, fiveHour: null, sevenDay: null, observedAt: null, hold: { hold: false, reason: null, until: null } });
  });

  it("skips a lane without a state record and does not count it", () => {
    p = makeProject();
    mkdirSync(runPaths(p.runsRoot, "starting").laneDir, { recursive: true });
    const s = build();
    expect(s.lanes).toEqual([]);
    expect(s.hiddenLanes).toBe(0);
  });

  it("holds neither the temporary directory's path nor an environment value", () => {
    const secret = "s3cr3t-value-never-shown";
    p = makeProject({ config: { ...DEFAULT_CONFIG, env: { DEMO_SECRET: secret } } });
    p.alive.add(SHEPHERD_PID);
    run("live", { state: "running", started: { cwd: p.root, envKeys: ["DEMO_SECRET"] }, stream: "", lane: { name: "live", role: "implementer", brief: join(p.root, "lanes/demo.md") } });
    run("done", finished(ago(1), { report: { status: "done", summary: `${secret} at ${p.dir}` } }));
    integration("rel", ["done"], ago(1));
    writeFileSync(join(integrationDir("rel"), "verify.json"), JSON.stringify({ name: "rel", lane: "rel-verify", attempt: 1, headSha: SHA("a"), results: [], passed: true, finishedAt: ago(1) }));
    const json = JSON.stringify(build());
    expect(names(JSON.parse(json) as UiSnapshot)).toEqual(["done", "live"].sort());
    expect(json).not.toContain(p.dir);
    expect(json).not.toContain(secret);
    expect(json).not.toContain("DEMO_SECRET");
  });
});

describe("createSnapshotBuilder: the window", () => {
  it("keeps lanes not finished, finished within --hours, or merged into an integration not landed or landed within --hours", () => {
    p = makeProject();
    p.alive.add(SHEPHERD_PID);
    run("live-old", { state: "running", since: ago(100), started: { startedAt: ago(100) } });
    run("orphan-old", { state: "running", shepherdPid: 1, since: ago(100) });
    run("recent", finished(ago(23)));
    run("stale", finished(ago(25)));
    run("merged-open", finished(ago(100)));
    run("merged-landed-recent", finished(ago(100)));
    run("merged-landed-old", finished(ago(100)));
    integration("open", ["merged-open"], ago(90));
    integration("fresh", ["merged-landed-recent"], ago(90));
    landed("fresh", ago(2));
    integration("old", ["merged-landed-old"], ago(90));
    landed("old", ago(30));
    const s = build();
    expect(names(s).sort()).toEqual(["live-old", "merged-landed-recent", "merged-open", "orphan-old", "recent"]);
    expect(lane(s, "orphan-old")?.state).toBe("orphaned");
    expect(s.hiddenLanes).toBe(2);
    // A wider window takes them in.
    const wide = build({ windowHours: 48 });
    expect(names(wide)).toContain("stale");
    expect(names(wide)).toContain("merged-landed-old");
    expect(wide.hiddenLanes).toBe(0);
  });

  it("caps the lanes at 300, the newest by firstSeen, and sorts them by firstSeen, then name", () => {
    p = makeProject();
    const total = MAX_LANES + 5;
    for (let i = 0; i < total; i++) {
      const name = `l${String(i).padStart(3, "0")}`;
      run(name, finished(ago(1), { started: { startedAt: iso(NOW_MS - 20 * HOUR + i * 60_000) } }));
    }
    const s = build();
    expect(s.lanes).toHaveLength(MAX_LANES);
    expect(s.hiddenLanes).toBe(5);
    expect(s.lanes[0]?.name).toBe("l005");
    expect(s.lanes.at(-1)?.name).toBe(`l${total - 1}`);
    const keys = s.lanes.map((l) => `${l.firstSeen} ${l.name}`);
    expect(keys).toEqual([...keys].sort());
  });

  it("orders lanes by firstSeen, then name, oldest first", () => {
    p = makeProject();
    run("b", finished(ago(1), { started: { startedAt: ago(3) } }));
    run("a", finished(ago(1), { started: { startedAt: ago(3) } }));
    run("c", finished(ago(1), { started: { startedAt: ago(5) } }));
    expect(names(build())).toEqual(["c", "a", "b"]);
  });
});

describe("createSnapshotBuilder: lane fields", () => {
  it("says why a held lane waits: slot for NO_FREE_SLOT_REASON, else quota; with the reason cut to 200 and until", () => {
    p = makeProject();
    p.alive.add(SHEPHERD_PID);
    run("slot", { state: "held", reason: NO_FREE_SLOT_REASON, until: 1_900_000_000 });
    run("quota", { state: "held", reason: `five-hour window at 95% ${"x".repeat(300)}`, until: 1_900_000_100 });
    run("busy", { state: "running", reason: "leftover", until: 5 });
    const s = build();
    expect(lane(s, "slot")).toMatchObject({ hold: "slot", reason: NO_FREE_SLOT_REASON, until: 1_900_000_000 });
    expect(lane(s, "quota")?.hold).toBe("quota");
    expect(lane(s, "quota")?.reason).toHaveLength(200);
    expect(lane(s, "quota")?.until).toBe(1_900_000_100);
    expect(lane(s, "busy")).toMatchObject({ hold: null, reason: "leftover", until: null });
  });

  it("tells generated lanes, probes and the project's own lanes apart, and names the generating integration", () => {
    p = makeProject();
    const owner = { integration: "rel", branch: "integrate/rel", head: SHA("a") };
    for (const name of ["rel-verify", "rel-review-security", "rel-skeptic-security", "rel-extra"]) {
      run(name, finished(ago(1)));
      markGenerated(p.runsRoot, name, owner, ago(1));
    }
    run("other-verify", finished(ago(1)));
    run("x-review-security", finished(ago(1)));
    // What `arbab preflight` writes: the probed lane's role, the brief under .arbab/preflight/.
    run("demo-pf-tools", finished(ago(1), { lane: { name: "demo-pf-tools", role: "implementer", brief: ".arbab/preflight/demo/demo-pf-tools.md" } }));
    run("demo-pf-model", finished(ago(1), { lane: { name: "demo-pf-model", role: "verifier", brief: join(p.root, ".arbab/preflight/demo/demo-pf-model.md") } }));
    // The name alone does not make a probe.
    run("own-pf-tools", finished(ago(1), { lane: { name: "own-pf-tools", role: "implementer", brief: "lanes/own-pf-tools.md" } }));
    run("near-pf-model", finished(ago(1), { lane: { name: "near-pf-model", role: "implementer", brief: ".arbab/preflight-x/near-pf-model.md" } }));
    run("out-pf-model", finished(ago(1), { lane: { name: "out-pf-model", role: "implementer", brief: ".arbab/preflight/../out-pf-model.md" } }));
    run("demo-pf-other", finished(ago(1), { lane: { name: "demo-pf-other", role: "implementer", brief: ".arbab/preflight/demo/demo-pf-other.md" } }));
    run("plain", finished(ago(1)));
    const s = build();
    const kinds = Object.fromEntries(s.lanes.map((l) => [l.name, [l.kind, l.integration]]));
    expect(kinds).toEqual({
      "rel-verify": ["verify", "rel"],
      "rel-review-security": ["review", "rel"],
      "rel-skeptic-security": ["skeptic", "rel"],
      "rel-extra": ["lane", "rel"],
      "other-verify": ["lane", null],
      "x-review-security": ["lane", null],
      "demo-pf-tools": ["preflight", null],
      "demo-pf-model": ["preflight", null],
      "own-pf-tools": ["lane", null],
      "near-pf-model": ["lane", null],
      "out-pf-model": ["lane", null],
      "demo-pf-other": ["lane", null],
      plain: ["lane", null],
    });
    expect(lane(s, "demo-pf-tools")?.role).toBe("implementer");
  });

  it("names the integration with the newest updatedAt that merged the lane; the generator wins over a merge", () => {
    p = makeProject();
    run("a", finished(ago(1)));
    run("rel-verify", finished(ago(1)));
    markGenerated(p.runsRoot, "rel-verify", { integration: "rel", branch: "integrate/rel", head: SHA("a") }, ago(1));
    integration("newer", ["a", "rel-verify"], ago(1));
    integration("older", ["a"], ago(5));
    const s = build();
    expect(lane(s, "a")?.integration).toBe("newer");
    expect(lane(s, "rel-verify")?.integration).toBe("rel");
  });

  it("takes worktreeOf from a valid lane field worktree", () => {
    p = makeProject();
    run("check", finished(ago(1), { lane: { name: "check", role: "verifier", brief: "b.md", worktree: "build" } }));
    run("odd", finished(ago(1), { lane: { name: "odd", role: "verifier", brief: "b.md", worktree: "../x" } }));
    const s = build();
    expect(lane(s, "check")).toMatchObject({ role: "verifier", worktreeOf: "build" });
    expect(lane(s, "odd")?.worktreeOf).toBeNull();
  });

  it("gives worktreeOf null to a lane in its own worktree", () => {
    p = makeProject();
    run("check", finished(ago(1), { lane: { name: "check", role: "verifier", brief: "b.md", worktree: "check" } }));
    expect(lane(build(), "check")).toMatchObject({ role: "verifier", worktreeOf: null });
  });

  it("takes firstSeen from the lowest attempt's start, else the shepherd's start, else since", () => {
    p = makeProject();
    // Attempts 2 and 3 only: the lowest is 2.
    run("late", finished(ago(1), { attempt: 3, started: { startedAt: ago(2) } }));
    mkdirSync(runPaths(p.runsRoot, "late").attemptDir(2));
    writeFileSync(join(runPaths(p.runsRoot, "late").attemptDir(2), "started.json"), JSON.stringify({ startedAt: ago(7) }));
    // No attempt: shepherd.json (writeLaneRun writes 2026-10-09T11:00:00.000Z).
    run("shepherd", { state: "finished", endState: "failed", since: ago(1) });
    // A start that does not parse falls through too.
    run("unparsed", { state: "finished", since: ago(1), started: { startedAt: "soon" } });
    writeFileSync(runPaths(p.runsRoot, "unparsed").shepherdFile, JSON.stringify({ pid: 1, startedAt: "later" }));
    run("bare", { state: "finished", since: ago(0.5) });
    rmSync(runPaths(p.runsRoot, "bare").shepherdFile);
    const s = build();
    expect(lane(s, "late")?.firstSeen).toBe(ago(7));
    expect(lane(s, "shepherd")?.firstSeen).toBe("2026-10-09T11:00:00.000Z");
    expect(lane(s, "unparsed")?.firstSeen).toBe(ago(1));
    expect(lane(s, "bare")?.firstSeen).toBe(ago(0.5));
    expect(lane(s, "bare")?.since).toBe(ago(0.5));
  });

  it("counts a finished attempt from its summary and a running one from its stream", () => {
    p = makeProject();
    p.alive.add(SHEPHERD_PID);
    run("done", finished(ago(1), { summary: { state: "success", wallMs: 4200, turns: 5, toolCallTotal: 9, lastTool: "Edit", failedTotal: 2, costUsd: 1.25, costDeltaUsd: 0.75, model: "claude-opus-5-5", measuredEffort: { high: 4, low: 1 } } }));
    const use = (id: string, name: string): string => JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id, name }] } }) + "\n";
    run("live", { state: "running", since: ago(0.2), started: {}, stream: use("a", "Bash") + use("b", "Read") + use("s", "StructuredOutput") });
    const s = build();
    expect(lane(s, "done")).toMatchObject({ elapsedMs: 4200, turns: 5, toolCalls: 9, lastTool: "Edit", failedTotal: 2, costUsd: 1.25, costDeltaUsd: 0.75, model: "claude-opus-5-5", effort: "high", endState: "success" });
    expect(lane(s, "live")).toMatchObject({ state: "running", elapsedMs: null, toolCalls: 2, lastTool: "Read", costUsd: null, model: null, endState: null });
  });

  it("takes the cost and model from the newest attempt that has a summary while a later one runs", () => {
    p = makeProject();
    p.alive.add(SHEPHERD_PID);
    writeLaneRun(p.runsRoot, "resumed", { state: "finished", attempt: 1, summary: { state: "usage-limit", costUsd: 1.5, costDeltaUsd: 1.5, model: "m-1", toolCallTotal: 40 } });
    run("resumed", { state: "waiting-reset", attempt: 2, since: ago(0.1) });
    const s = build();
    expect(lane(s, "resumed")).toMatchObject({ state: "waiting-reset", attempt: 2, costUsd: 1.5, costDeltaUsd: 1.5, model: "m-1", toolCalls: 0, elapsedMs: null });
  });

  it("nulls a last tool that does not look like a tool name", () => {
    p = makeProject();
    run("weird", finished(ago(1), { summary: { state: "success", lastTool: "rm -rf /tmp" } }));
    run("long", finished(ago(1), { summary: { state: "success", lastTool: "x".repeat(65) } }));
    run("mcp", finished(ago(1), { summary: { state: "success", lastTool: "mcp__srv.tool:v-1" } }));
    const s = build();
    expect(lane(s, "weird")?.lastTool).toBeNull();
    expect(lane(s, "long")?.lastTool).toBeNull();
    expect(lane(s, "mcp")?.lastTool).toBe("mcp__srv.tool:v-1");
  });

  it("reads the latest attempt's report only: an older attempt's never stands in", () => {
    p = makeProject();
    run("impl", finished(ago(1), { report: { status: "partial" } }));
    run("impl", finished(ago(1)));
    run("rev", finished(ago(1), { lane: { name: "rev", role: "reviewer", brief: "b.md" }, report: { findings: [{}] } }));
    run("rev", finished(ago(1), { lane: { name: "rev", role: "reviewer", brief: "b.md" } }));
    const s = build();
    expect(lane(s, "impl")).toMatchObject({ attempt: 2, reportStatus: null });
    expect(lane(s, "rev")).toMatchObject({ attempt: 2, findings: null });
  });

  it("shows no report for a run without an attempt, or whose attempt is not the latest", () => {
    p = makeProject();
    // A rerun that failed in setup: the state is back at attempt 0, attempt 1's report belongs to the run before.
    run("impl", finished(ago(2), { report: { status: "done" } }));
    run("impl", { state: "finished", endState: "failed", attempt: 0, since: ago(1) });
    run("rev", finished(ago(2), { lane: { name: "rev", role: "reviewer", brief: "b.md" }, report: { findings: [{}] } }));
    run("rev", { state: "finished", endState: "failed", attempt: 0, since: ago(1), lane: { name: "rev", role: "reviewer", brief: "b.md" } });
    // The state names attempt 1 while attempt 2's directory, with a report, already exists.
    run("lag", finished(ago(2), { report: { status: "partial" } }));
    run("lag", finished(ago(1), { report: { status: "done" } }));
    writeState(p.runsRoot, { ...(readState(p.runsRoot, "lag") as LaneStateRecord), attempt: 1 });
    const s = build();
    expect(lane(s, "impl")).toMatchObject({ attempt: 0, reportStatus: null });
    expect(lane(s, "rev")).toMatchObject({ attempt: 0, findings: null });
    expect(lane(s, "lag")).toMatchObject({ attempt: 1, reportStatus: null });
  });

  it("takes a report that does not parse for no report, and still shows the lane", () => {
    p = makeProject();
    run("impl", finished(ago(1), { report: { status: "done" } }));
    run("impl", finished(ago(1), { report: { status: "done" } }));
    writeFileSync(join(runPaths(p.runsRoot, "impl").attemptDir(2), "report.json"), "{");
    run("rev", finished(ago(1), { lane: { name: "rev", role: "reviewer", brief: "b.md" }, report: { findings: [] } }));
    writeFileSync(join(runPaths(p.runsRoot, "rev").attemptDir(1), "report.json"), "[1,");
    const s = build();
    expect(s.hiddenLanes).toBe(0);
    expect(lane(s, "impl")).toMatchObject({ attempt: 2, reportStatus: null });
    expect(lane(s, "rev")?.findings).toBeNull();
  });

  it("reads reportStatus for implementers and verifiers and findings for reviewers, from the newest report", () => {
    p = makeProject();
    run("impl", finished(ago(1), { report: { status: "partial" } }));
    run("impl", finished(ago(1), { report: { status: "blocked" } }));
    run("ver", finished(ago(1), { lane: { name: "ver", role: "verifier", brief: "b.md" }, report: { status: "done" } }));
    run("bad", finished(ago(1), { report: { status: "finished" } }));
    run("none", finished(ago(1)));
    run("rev", finished(ago(1), { lane: { name: "rev", role: "reviewer", brief: "b.md" }, report: { findings: [{}, {}, {}], status: "done" } }));
    run("rev-odd", finished(ago(1), { lane: { name: "rev-odd", role: "reviewer", brief: "b.md" }, report: { findings: "3" } }));
    run("res", finished(ago(1), { lane: { name: "res", role: "researcher", brief: "b.md" }, report: { status: "done", findings: [1] } }));
    const s = build();
    expect(lane(s, "impl")).toMatchObject({ attempt: 2, reportStatus: "blocked", findings: null });
    expect(lane(s, "ver")?.reportStatus).toBe("done");
    expect(lane(s, "bad")?.reportStatus).toBeNull();
    expect(lane(s, "none")?.reportStatus).toBeNull();
    expect(lane(s, "rev")).toMatchObject({ reportStatus: null, findings: 3 });
    expect(lane(s, "rev-odd")?.findings).toBeNull();
    expect(lane(s, "res")).toMatchObject({ reportStatus: null, findings: null });
  });

  it("counts a lane whose records do not parse in hiddenLanes and builds the rest", () => {
    p = makeProject();
    for (const name of ["state", "summary", "lanefile", "role", "started", "good"]) run(name, finished(ago(1), { report: { status: "done" } }));
    const dir = (name: string): string => runPaths(p.runsRoot, name).laneDir;
    writeFileSync(join(dir("state"), "state.json"), "{not json");
    writeFileSync(join(dir("summary"), "attempt-1", "summary.json"), "[1,");
    writeFileSync(join(dir("lanefile"), "lane.json"), "");
    writeFileSync(join(dir("role"), "lane.json"), JSON.stringify({ name: "role", role: "boss" }));
    writeFileSync(join(dir("started"), "attempt-1", "started.json"), "nope");
    const s = build();
    expect(names(s)).toEqual(["good"]);
    expect(s.hiddenLanes).toBe(5);
  });
});

describe("createSnapshotBuilder: the cache", () => {
  it("reuses a finished lane while its state record is unchanged, and reads it again when it changes", () => {
    p = makeProject();
    run("done", finished(ago(1)));
    const builder = createSnapshotBuilder(source());
    expect(lane(builder.build(NOW_MS), "done")?.turns).toBe(2);
    const summary = join(runPaths(p.runsRoot, "done").attemptDir(1), "summary.json");
    writeFileSync(summary, JSON.stringify({ ...JSON.parse(readFileSync(summary, "utf8")), turns: 77 }));
    expect(lane(builder.build(NOW_MS), "done")?.turns).toBe(2);
    const record = readState(p.runsRoot, "done") as LaneStateRecord;
    writeState(p.runsRoot, { ...record, since: ago(0.5) });
    expect(lane(builder.build(NOW_MS), "done")?.turns).toBe(77);
  });

  it("reads a live lane again on every build", () => {
    p = makeProject();
    p.alive.add(SHEPHERD_PID);
    run("live", { state: "running", started: {}, stream: "" });
    const builder = createSnapshotBuilder(source());
    expect(lane(builder.build(NOW_MS), "live")?.toolCalls).toBe(0);
    writeFileSync(join(runPaths(p.runsRoot, "live").attemptDir(1), "stream.jsonl"), JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "a", name: "Bash" }] } }) + "\n");
    expect(lane(builder.build(NOW_MS), "live")).toMatchObject({ toolCalls: 1, lastTool: "Bash" });
    // The shepherd dies: the lane is orphaned at once, though its record did not change.
    p.alive.delete(SHEPHERD_PID);
    expect(lane(builder.build(NOW_MS), "live")?.state).toBe("orphaned");
  });

  it("names the merging integration of a cached lane once it is merged", () => {
    p = makeProject();
    run("done", finished(ago(1)));
    const builder = createSnapshotBuilder(source());
    expect(lane(builder.build(NOW_MS), "done")?.integration).toBeNull();
    integration("rel", ["done"], ago(0.5));
    expect(lane(builder.build(NOW_MS), "done")?.integration).toBe("rel");
  });

  it("forgets a hidden lane: a corrupt record that is fixed shows again", () => {
    p = makeProject();
    run("done", finished(ago(1)));
    const builder = createSnapshotBuilder(source());
    expect(builder.build(NOW_MS).lanes).toHaveLength(1);
    const lanePath = runPaths(p.runsRoot, "done").laneFile;
    const good = readFileSync(lanePath, "utf8");
    const record = readState(p.runsRoot, "done") as LaneStateRecord;
    writeState(p.runsRoot, { ...record, since: ago(0.9) });
    writeFileSync(lanePath, "{");
    expect(builder.build(NOW_MS).hiddenLanes).toBe(1);
    writeFileSync(lanePath, good);
    expect(builder.build(NOW_MS).lanes).toHaveLength(1);
  });

  it("retains the counter's lanes to the ones in the snapshot", () => {
    p = makeProject();
    p.alive.add(SHEPHERD_PID);
    run("live", { state: "running", started: {}, stream: "" });
    run("stale", finished(ago(48)));
    const inner = createToolCallCounter();
    const retained: string[][] = [];
    const counter: ToolCallCounter = {
      count: (...args) => inner.count(...args),
      retain: (lanes) => {
        retained.push([...lanes].sort());
        inner.retain(lanes);
      },
    };
    build({ counter });
    expect(retained).toEqual([["live"]]);
  });
});

describe("createSnapshotBuilder: integrations", () => {
  const verify = (head: string, passed: boolean) => ({ name: "rel", lane: "rel-verify", attempt: 1, headSha: head, results: [], passed, finishedAt: ago(1) });
  const review = (head: string): ReviewRecord => ({
    name: "rel",
    headSha: head,
    lenses: [
      { lens: "security", lane: "rel-review-security", endState: "success", coverage: null, pathsChecked: 1 },
      { lens: "contracts", lane: "rel-review-contracts", endState: "success", coverage: null, pathsChecked: 1 },
    ],
    skeptics: [],
    findings: [finding("security-1", "confirmed"), finding("security-2", "refuted"), finding("security-3", "unverified"), finding("security-4", "confirmed")],
    finishedAt: ago(1),
  });
  const readiness = (head: string, ready: boolean): ReadinessReport => ({ name: "rel", tier: "low", headSha: head, verified: [], skipped: [], risks: [], ready, createdAt: ago(1) });

  it("counts verify, review and readiness only for the integration's current head", () => {
    p = makeProject();
    integration("rel", ["a", "b"], ago(1), SHA("a"));
    const dir = integrationDir("rel");
    writeFileSync(join(dir, "verify.json"), JSON.stringify(verify(SHA("a"), false)));
    writeFileSync(join(dir, "review.json"), JSON.stringify(review(SHA("a"))));
    writeFileSync(join(dir, "readiness.json"), JSON.stringify(readiness(SHA("a"), true)));
    expect(build().integrations).toEqual([
      {
        name: "rel",
        lanes: ["a", "b"],
        headSha: SHA("a"),
        updatedAt: ago(1),
        verify: "failed",
        review: { lenses: 2, confirmed: 2, refuted: 1, unverified: 1 },
        ready: true,
        landedAt: null,
      },
    ]);
    integration("rel", ["a", "b"], ago(0.5), SHA("e"));
    expect(build().integrations[0]).toMatchObject({ headSha: SHA("e"), verify: null, review: null, ready: null });
    writeFileSync(join(dir, "verify.json"), JSON.stringify(verify(SHA("e"), true)));
    expect(build().integrations[0]?.verify).toBe("passed");
  });

  it("takes landedAt from landing.json when its name matches and the time parses", () => {
    p = makeProject();
    for (const name of ["good", "other", "bad"]) integration(name, [], ago(1));
    landed("good", ago(2));
    writeFileSync(join(integrationDir("other"), "landing.json"), JSON.stringify({ name: "someone", landedAt: ago(2) }));
    writeFileSync(join(integrationDir("bad"), "landing.json"), JSON.stringify({ name: "bad", landedAt: "yesterday" }));
    const s = build();
    expect(Object.fromEntries(s.integrations.map((i) => [i.name, i.landedAt]))).toEqual({ good: ago(2), other: null, bad: null });
  });

  it("leaves out an integration whose records do not parse, and directories that are not integrations", () => {
    p = makeProject();
    integration("good", [], ago(1));
    integration("broken", [], ago(1));
    writeFileSync(join(integrationDir("broken"), "review.json"), "{");
    writeFileSync(join(integrationDir("mismatch"), "integration.json"), JSON.stringify({ name: "else" }));
    integrationDir("empty");
    integrationDir("integrate-x");
    integrationDir("Not_Valid");
    expect(build().integrations.map((i) => i.name)).toEqual(["good"]);
  });

  it("keeps every integration not landed and the five landed most recently, by updatedAt", () => {
    p = makeProject();
    for (let i = 0; i < 7; i++) {
      integration(`landed-${i}`, [], ago(50 - i));
      landed(`landed-${i}`, ago(20 - i));
    }
    integration("open-old", [], ago(100));
    integration("open-new", [], ago(0.1));
    const s = build();
    expect(s.integrations.map((i) => i.name)).toEqual(["open-old", "landed-2", "landed-3", "landed-4", "landed-5", "landed-6", "open-new"]);
  });

  it("reads an integration again only when the size or mtime of one of its record files changed", () => {
    p = makeProject();
    integration("rel", ["a"], ago(1));
    const dir = integrationDir("rel");
    const file = join(dir, "verify.json");
    writeFileSync(file, JSON.stringify(verify(SHA("a"), true)));
    const past = Math.floor(NOW_MS / 1000) - 3600;
    utimesSync(file, past, past);
    const builder = createSnapshotBuilder(source());
    expect(builder.build(NOW_MS).integrations[0]?.verify).toBe("passed");
    // Same size, same mtime: the cached record stands, though the file would no longer parse.
    const size = statSync(file).size;
    writeFileSync(file, JSON.stringify(verify(SHA("a"), true)).replace("true", "fals"));
    utimesSync(file, past, past);
    expect(statSync(file).size).toBe(size);
    expect(builder.build(NOW_MS).integrations[0]?.verify).toBe("passed");
    writeFileSync(file, JSON.stringify(verify(SHA("a"), false)));
    expect(builder.build(NOW_MS).integrations[0]?.verify).toBe("failed");
    // A new record file (landing.json) changes the signature too.
    landed("rel", ago(0.5));
    expect(builder.build(NOW_MS).integrations[0]?.landedAt).toBe(ago(0.5));
    rmSync(join(dir, "integration.json"));
    expect(builder.build(NOW_MS).integrations).toEqual([]);
  });
});
