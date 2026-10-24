import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { registerProject } from "../registry";
import type { ProjectSummary } from "../summary";
import {
  integrationDir,
  writeIntegration,
  writeLanding,
  writeOwner,
  writePlanPhase,
  writeQuota,
  writeReview,
  writeSlot,
  writeVerify,
} from "../summary/testkit";
import { parseSince, runSummary } from "./summary";
import { NOW_MS, makeProject, writeLaneRun, type TestProject } from "./testkit";

const made: TestProject[] = [];
const project = (opts?: Parameters<typeof makeProject>[0]): TestProject => {
  const t = makeProject(opts);
  made.push(t);
  return t;
};
afterEach(() => {
  for (const t of made.splice(0)) t.dispose();
});

const LIVE = 5000;
const NOW_SEC = Math.floor(NOW_MS / 1000);

/** A project with something in every section. */
function busy(t: TestProject): void {
  t.alive.add(LIVE);
  writePlanPhase(t.root, "field", "core");
  writePlanPhase(t.root, "field", "docs");
  writeLaneRun(t.runsRoot, "core", { state: "running", shepherdPid: LIVE, started: {} });
  writeOwner(t.runsRoot, "core", "feedfacecafebeef");
  writeLaneRun(t.runsRoot, "docs", { state: "finished", endState: "invalid-report", summary: { state: "invalid-report" } });
  writeLaneRun(t.runsRoot, "gone", { state: "running", shepherdPid: 31337 });
  writeIntegration(t.root, "rel");
  writeVerify(t.root, "rel");
  writeReview(t.root, "rel");
  writeQuota(t.home, 0.4, 0.2, NOW_SEC + 3600);
  writeSlot(t.home, 0, { pid: LIVE, lane: "core", project: t.root, createdAt: "2026-10-09T11:00:00.000Z" });
}

/**
 * Five worktree directories: lane `old` finished 40 days ago and integration `wip` unused as long (idle), lane `young`
 * finished a day ago, lane `core` running, and one no run owns; and a sweep that removed one.
 */
function worktrees(t: TestProject): void {
  t.alive.add(LIVE);
  for (const dir of ["old", "young", "core", "stray", "integrate-wip"]) mkdirSync(join(t.worktreeRoot, dir), { recursive: true });
  writeLaneRun(t.runsRoot, "old", { state: "finished", endState: "success", since: "2026-08-30T12:00:00.000Z" });
  writeLaneRun(t.runsRoot, "young", { state: "finished", endState: "success", since: "2026-10-08T12:00:00.000Z" });
  writeLaneRun(t.runsRoot, "core", { state: "running", shepherdPid: LIVE, since: "2026-08-30T12:00:00.000Z" });
  writeIntegration(t.root, "wip");
  const old = Date.parse("2026-08-30T12:00:00.000Z") / 1000;
  utimesSync(join(integrationDir(t.root, "wip"), "integration.json"), old, old);
  writeFileSync(
    join(t.root, ".arbab", "sweep.json"),
    JSON.stringify({
      startedAt: "2026-10-09T11:00:00.000Z",
      finishedAt: "2026-10-09T11:00:02.000Z",
      idleDays: 3,
      removed: [{ path: "/w/x", reason: "merged into main" }],
      kept: 2,
      warnings: [],
    }),
  );
}

describe("arbab summary", () => {
  it("prints every section for the project", async () => {
    const p = project();
    busy(p);
    expect(await runSummary([], p.ctx)).toBe(0);
    const out = p.stdout();
    expect(out).toContain("Lanes (3)\n  1 running · 1 finished (1 invalid-report) · 1 orphaned\n");
    expect(out).toMatch(/core\s+running\s+10m00s\s+1\s+feedface\s+-/);
    expect(out).toContain("Plans\n  field:\n");
    expect(out).toContain("failed (invalid-report)  docs");
    expect(out).toContain("run `arbab plan status <plan file>` for the phases not launched yet");
    expect(out).toContain("rel  reviewed  bbbbbbb  waits for: readiness has not run");
    expect(out).toContain("Needs attention\n  docs: invalid-report (attempt 1)\n");
    expect(out).toContain("  gone: orphaned (attempt 0)\n    the shepherd died before finishing");
    expect(out).toContain("quota: 5h 40% (resets 13:00Z)");
    expect(out).toContain("hold: no");
    expect(out).toContain("slots: 1 in use machine-wide of 4 (maxParallel 4)");
    expect(out).not.toContain("Unreadable records");
  });

  it("prints the same data as one object with --json", async () => {
    const p = project();
    busy(p);
    await runSummary(["--json"], p.ctx);
    const s = JSON.parse(p.stdout()) as ProjectSummary;
    expect(s.root).toBe(p.root);
    expect(s.lanes.counts.byState.running).toBe(1);
    expect(s.lanes.active.find((l) => l.lane === "core")?.owner).toBe("feedface");
    expect(s.plans[0]?.phases.map((ph) => ph.status)).toEqual(["running", "failed"]);
    expect(s.integrations[0]).toMatchObject({ name: "rel", stage: "reviewed" });
    expect(s.attention.map((a) => a.lane)).toEqual(["docs", "gone"]);
    expect(s.quota.slots.cap).toBe(4);
    expect(s.quota.snapshot?.fiveHour?.utilization).toBe(0.4);
  });

  it("leaves out empty sections and writes nothing", async () => {
    const p = project();
    await runSummary([], p.ctx);
    expect(p.stdout()).toBe(
      "Quota, slots and worktrees\n  quota: quota unknown\n  hold: no\n  slots: 0 in use machine-wide of 4 (maxParallel 4)\n" +
        "  worktrees: 0 (0 unused for 3+ days)\n",
    );
    expect(existsSync(join(p.root, ".arbab"))).toBe(false);
    expect(existsSync(p.home)).toBe(false);
  });

  it("counts the worktrees, the unused ones and the last sweep, in text and --json", async () => {
    const p = project();
    worktrees(p);
    expect(await runSummary([], p.ctx)).toBe(0);
    expect(p.stdout()).toContain("\n  worktrees: 5 (2 unused for 3+ days); last sweep 2026-10-09T11:00:00Z: removed 1\n");
    p.out.length = 0;
    expect(await runSummary(["--json"], p.ctx)).toBe(0);
    expect((JSON.parse(p.stdout()) as ProjectSummary).worktrees).toEqual({
      total: 5,
      idle: 2,
      idleDays: 3,
      lastSweep: { startedAt: "2026-10-09T11:00:00.000Z", finishedAt: "2026-10-09T11:00:02.000Z", removed: 1 },
    });
  });

  it("says when the automatic sweep is off", async () => {
    const p = project({ config: { worktrees: { idleDays: 0 } } });
    mkdirSync(join(p.worktreeRoot, "a"), { recursive: true });
    expect(await runSummary([], p.ctx)).toBe(0);
    expect(p.stdout()).toContain("\n  worktrees: 1 (automatic sweep off)\n");
  });

  it("caps the slots by machine.json and reports a machine.json it cannot read", async () => {
    const p = project();
    mkdirSync(p.home, { recursive: true });
    writeFileSync(join(p.home, "machine.json"), JSON.stringify({ maxParallel: 2 }));
    await runSummary([], p.ctx);
    expect(p.stdout()).toContain("slots: 0 in use machine-wide of 2 (maxParallel 4, machine cap 2)");
    writeFileSync(join(p.home, "machine.json"), JSON.stringify({ maxParallel: "many" }));
    p.out.length = 0;
    await runSummary([], p.ctx);
    expect(p.stdout()).toContain("of 4 (maxParallel 4)");
    expect(p.stdout()).toMatch(/Unreadable records\n {2}machine config: /);
  });

  it("covers every recorded project that still exists with --all", async () => {
    const a = project();
    const b = project({ config: { baseBranch: "main", maxParallel: 2 } });
    busy(a);
    writeLaneRun(b.runsRoot, "solo", { state: "finished", endState: "success" });
    registerProject(a.home, a.root, "2026-10-09T10:00:00.000Z");
    registerProject(a.home, b.root, "2026-10-09T10:00:00.000Z");
    registerProject(a.home, join(a.dir, "vanished"), "2026-10-09T10:00:00.000Z");
    await runSummary(["--all"], a.ctx);
    const out = a.stdout();
    const roots = [a.root, b.root].sort();
    expect(out.indexOf(`== ${roots[0]} ==`)).toBe(0);
    expect(out).toContain(`\n\n== ${roots[1]} ==\n`);
    expect(out).not.toContain("vanished");
    // Each project's config comes from its own root.
    expect(out).toContain("slots: 1 in use machine-wide of 2 (maxParallel 2)");
    expect(out).toContain("1 finished (1 success)");
    expect(a.stderr()).toBe("");
  });

  it("shows each project's worktrees with --all", async () => {
    const a = project();
    const b = project({ config: { baseBranch: "main", worktrees: { idleDays: 0 } } });
    worktrees(a);
    registerProject(a.home, a.root, "2026-10-09T10:00:00.000Z");
    registerProject(a.home, b.root, "2026-10-09T10:00:00.000Z");
    await runSummary(["--all"], a.ctx);
    const sections = new Map(a.stdout().split("\n\n== ").map((s) => [s.replace(/^== /, "").split(" ==")[0], s]));
    expect(sections.get(a.root)).toContain("worktrees: 5 (2 unused for 3+ days); last sweep");
    expect(sections.get(b.root)).toContain("worktrees: 0 (automatic sweep off)");
    a.out.length = 0;
    await runSummary(["--all", "--json"], a.ctx);
    const list = JSON.parse(a.stdout()) as ProjectSummary[];
    expect(new Map(list.map((s) => [s.root, s.worktrees.total]))).toEqual(new Map([[a.root, 5], [b.root, 0]]));
  });

  it("prints an array with --all --json", async () => {
    const a = project();
    const b = project();
    registerProject(a.home, a.root, "2026-10-09T10:00:00.000Z");
    registerProject(a.home, b.root, "2026-10-09T10:00:00.000Z");
    registerProject(a.home, join(a.dir, "vanished"), "2026-10-09T10:00:00.000Z");
    await runSummary(["--all", "--json"], a.ctx);
    const list = JSON.parse(a.stdout()) as ProjectSummary[];
    expect(list.map((s) => s.root)).toEqual([a.root, b.root].sort());
  });

  it("skips a project whose config does not load, naming it on stderr", async () => {
    const a = project();
    const b = project({ config: { maxParallel: "lots" } });
    registerProject(a.home, a.root, "2026-10-09T10:00:00.000Z");
    registerProject(a.home, b.root, "2026-10-09T10:00:00.000Z");
    await runSummary(["--all"], a.ctx);
    expect(a.stdout()).toContain(`== ${a.root} ==`);
    expect(a.stdout()).not.toContain(b.root);
    expect(a.stderr()).toContain(`${b.root}: skipped: `);
  });

  it("says so when no project is recorded", async () => {
    const p = project();
    await runSummary(["--all"], p.ctx);
    expect(p.stdout()).toBe("no projects recorded on this machine\n");
    p.out.length = 0;
    await runSummary(["--all", "--json"], p.ctx);
    expect(JSON.parse(p.stdout())).toEqual([]);
  });

  it("refuses arguments it does not know", async () => {
    const p = project();
    await expect(runSummary(["demo"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runSummary(["--mine"], p.ctx)).rejects.toMatchObject({ code: "usage" });
  });
});

describe("arbab summary --since", () => {
  const OTHER = "bbbbbbbb-1111-2222-3333-444444444444";
  const SHA = "1".repeat(40);

  /** Landings at 09:00 (before 2h ago), 11:00 by another session and 11:30 from outside Claude Code, squashed. */
  function landed(t: TestProject): void {
    writeLanding(t.root, "early", { landedAt: "2026-10-09T09:00:00.000Z", owner: OTHER });
    writeLanding(t.root, "rel", { landedAt: "2026-10-09T11:00:00.000Z", owner: OTHER, lanes: [{ lane: "a", sha: SHA }, { lane: "b", sha: SHA }] });
    writeLanding(t.root, "hot", { landedAt: "2026-10-09T11:30:00.000Z", owner: null, squash: true, lanes: [{ lane: "c", sha: SHA }] });
  }

  it("lists the landings after 2h ago, oldest first", async () => {
    const p = project();
    landed(p);
    expect(await runSummary(["--since", "2h"], p.ctx)).toBe(0);
    expect(p.stdout()).toContain(
      "Landed since 2026-10-09T10:00:00.000Z\n" +
        "  rel  into main  2026-10-09T11:00:00.000Z  session bbbbbbbb     2 lanes\n" +
        "  hot  into main  2026-10-09T11:30:00.000Z  outside Claude Code  1 lane, squashed\n",
    );
    expect(p.stdout()).not.toContain("early");
  });

  it("adds since and landedSince to --json", async () => {
    const p = project();
    landed(p);
    expect(await runSummary(["--since", "2026-10-09T10:30:00Z", "--json"], p.ctx)).toBe(0);
    const s = JSON.parse(p.stdout()) as ProjectSummary;
    expect(s.since).toBe("2026-10-09T10:30:00.000Z");
    expect(s.landedSince).toEqual([
      { name: "rel", into: "main", landedAt: "2026-10-09T11:00:00.000Z", owner: OTHER, mergeSha: "c".repeat(40), squash: false, lanes: 2 },
      { name: "hot", into: "main", landedAt: "2026-10-09T11:30:00.000Z", owner: null, mergeSha: "c".repeat(40), squash: true, lanes: 1 },
    ]);
  });

  it("says nothing landed when nothing did, and leaves output unchanged without --since", async () => {
    const p = project();
    expect(await runSummary(["--since", "30m"], p.ctx)).toBe(0);
    expect(p.stdout()).toContain("Landed since 2026-10-09T11:30:00.000Z\n  nothing landed\n");
    landed(p);
    p.out.length = 0;
    expect(await runSummary([], p.ctx)).toBe(0);
    expect(p.stdout()).not.toContain("Landed since");
    p.out.length = 0;
    expect(await runSummary(["--json"], p.ctx)).toBe(0);
    const s = JSON.parse(p.stdout()) as ProjectSummary;
    expect(s).not.toHaveProperty("landedSince");
    expect(s).not.toHaveProperty("since");
  });

  it("lists each project's landings with --all", async () => {
    const a = project();
    const b = project();
    landed(a);
    writeLanding(b.root, "other", { landedAt: "2026-10-09T11:45:00.000Z", owner: OTHER });
    registerProject(a.home, a.root, "2026-10-09T10:00:00.000Z");
    registerProject(a.home, b.root, "2026-10-09T10:00:00.000Z");
    expect(await runSummary(["--all", "--since", "1d", "--json"], a.ctx)).toBe(0);
    const list = JSON.parse(a.stdout()) as ProjectSummary[];
    const names = new Map(list.map((s) => [s.root, s.landedSince?.map((l) => l.name)]));
    expect(names.get(a.root)).toEqual(["early", "rel", "hot"]);
    expect(names.get(b.root)).toEqual(["other"]);
  });

  it("takes a bare date as midnight UTC and a date-time with Z", async () => {
    const p = project();
    expect(await runSummary(["--since", "2026-10-20", "--json"], p.ctx)).toBe(0);
    expect((JSON.parse(p.stdout()) as ProjectSummary).since).toBe("2026-10-20T00:00:00.000Z");
    p.out.length = 0;
    expect(await runSummary(["--since", "2026-10-20T10:00:00Z", "--json"], p.ctx)).toBe(0);
    expect((JSON.parse(p.stdout()) as ProjectSummary).since).toBe("2026-10-20T10:00:00.000Z");
    p.out.length = 0;
    expect(await runSummary(["--since", "3650d"], p.ctx)).toBe(0);
    expect(p.stdout()).toContain(`Landed since ${new Date(NOW_MS - 3650 * 86_400_000).toISOString()}\n`);
  });

  it("refuses a --since that is neither an ISO time nor <n>m, <n>h, <n>d", async () => {
    const p = project();
    for (const when of [
      "",
      "2",
      "2w",
      "-2h",
      "2 hours",
      "1.5h",
      "yesterday",
      "2026-13-45",
      "10/09/2026",
      // Too far back, and far enough to overflow a Date.
      "3651d",
      "87601h",
      "5256001m",
      "99999999d",
      "1000000000d",
      // No offset: the machine's time zone would decide.
      "2026-10-20T10:00:00",
      "2026-10-20T10:00",
      // No such date or time.
      "2026-02-30",
      "2026-02-29T10:00:00Z",
      "2026-04-31",
      "2026-10-20T24:00:00Z",
      "2026-10-20T10:60:00Z",
      "2026-10-20T10:00:61Z",
      "2026-10-20T10:00:00+24:00",
      "2026-10-20T10:00:00+05:60",
    ]) {
      await expect(runSummary([`--since=${when}`], p.ctx), when).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/^--since takes /) });
    }
    await expect(runSummary(["--since"], p.ctx)).rejects.toMatchObject({ code: "usage" });
  });
});

describe("parseSince", () => {
  it("reads minutes, hours and days back from the clock, and ISO times", () => {
    expect(parseSince("30m", NOW_MS)).toBe(NOW_MS - 30 * 60_000);
    expect(parseSince("2h", NOW_MS)).toBe(NOW_MS - 2 * 3_600_000);
    expect(parseSince("7d", NOW_MS)).toBe(NOW_MS - 7 * 86_400_000);
    expect(parseSince("0m", NOW_MS)).toBe(NOW_MS);
    expect(parseSince("2026-10-09T08:00:00Z", NOW_MS)).toBe(Date.parse("2026-10-09T08:00:00Z"));
    expect(parseSince("2026-10-09T08:00:00.250+02:00", NOW_MS)).toBe(Date.parse("2026-10-09T06:00:00.250Z"));
    expect(parseSince("2026-10-09", NOW_MS)).toBe(Date.parse("2026-10-09T00:00:00Z"));
    expect(parseSince("2026-10-09T08:00-05:30", NOW_MS)).toBe(Date.parse("2026-10-09T13:30:00Z"));
    expect(parseSince("2026-10-09T08:00:00.5Z", NOW_MS)).toBe(Date.parse("2026-10-09T08:00:00.500Z"));
    expect(parseSince("2024-02-29T00:00:00Z", NOW_MS)).toBe(Date.parse("2024-02-29T00:00:00Z"));
    expect(parseSince("0050-01-01", NOW_MS)).toBe(Date.parse("0050-01-01T00:00:00Z"));
  });

  it("reaches back at most 3650 days, in any unit", () => {
    expect(parseSince("3650d", NOW_MS)).toBe(NOW_MS - 3650 * 86_400_000);
    expect(parseSince("87600h", NOW_MS)).toBe(NOW_MS - 3650 * 86_400_000);
    expect(parseSince("5256000m", NOW_MS)).toBe(NOW_MS - 3650 * 86_400_000);
    for (const when of ["3651d", "87601h", "5256001m", "999999999d"]) {
      expect(() => parseSince(when, NOW_MS), when).toThrow(expect.objectContaining({ code: "usage", message: expect.stringContaining("at most 3650 days") }));
    }
  });
});
