import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { registerProject } from "../registry";
import type { ProjectSummary } from "../summary";
import {
  writeIntegration,
  writeOwner,
  writePlanPhase,
  writeQuota,
  writeReview,
  writeSlot,
  writeVerify,
} from "../summary/testkit";
import { runSummary } from "./summary";
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
    expect(p.stdout()).toBe("Quota and slots\n  quota: quota unknown\n  hold: no\n  slots: 0 in use machine-wide of 4 (maxParallel 4)\n");
    expect(existsSync(join(p.root, ".arbab"))).toBe(false);
    expect(existsSync(p.home)).toBe(false);
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
