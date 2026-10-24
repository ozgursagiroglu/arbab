import { describe, expect, it } from "vitest";
import { formatCounts, formatSummary, table } from "./format";
import type { ProjectSummary } from "./project";

const NOW_SEC = Math.floor(Date.parse("2026-10-09T12:00:00.000Z") / 1000);

function summary(over: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    root: "/work/repo",
    lanes: {
      total: 0,
      counts: { byState: { running: 0, held: 0, preparing: 0, "waiting-reset": 0, queued: 0, orphaned: 0 }, finished: {} },
      active: [],
    },
    plans: [],
    integrations: [],
    attention: [],
    quota: {
      snapshot: null,
      hold: { hold: false, reason: null, until: null },
      slots: { inUse: [], cap: 4, projectMaxParallel: 4, machineMaxParallel: null },
    },
    worktrees: { total: 0, idle: 0, idleDays: 3, lastSweep: null },
    errors: [],
    ...over,
  };
}

describe("table", () => {
  it("pads every column but the last", () => {
    expect(table([["a", "bbb", "c"], ["dddd", "e", ""]])).toEqual(["a     bbb  c", "dddd  e"]);
  });

  it("is empty without rows", () => expect(table([])).toEqual([]));
});

describe("formatCounts", () => {
  it("names each state with lanes, finished lanes by end state, orphans last", () => {
    const counts = {
      byState: { running: 2, held: 1, preparing: 0, "waiting-reset": 1, queued: 0, orphaned: 1 },
      finished: { success: 3, "killed:wall": 1 },
    };
    expect(formatCounts(counts)).toBe("2 running · 1 held · 1 waiting-reset · 4 finished (1 killed:wall, 3 success) · 1 orphaned");
  });
});

describe("formatSummary", () => {
  it("prints only the quota section for an empty project", () => {
    expect(formatSummary(summary(), NOW_SEC)).toBe(
      [
        "Quota, slots and worktrees",
        "  quota: quota unknown",
        "  hold: no",
        "  slots: 0 in use machine-wide of 4 (maxParallel 4)",
        "  worktrees: 0 (0 unused for 3+ days)",
      ].join("\n"),
    );
  });

  it("says when the automatic sweep is off", () => {
    expect(formatSummary(summary({ worktrees: { total: 7, idle: 2, idleDays: 0, lastSweep: null } }), NOW_SEC)).toContain("\n  worktrees: 7 (automatic sweep off)");
  });

  it("prints every section", () => {
    const text = formatSummary(
      summary({
        lanes: {
          total: 3,
          counts: { byState: { running: 1, held: 0, preparing: 0, "waiting-reset": 0, queued: 0, orphaned: 1 }, finished: { failed: 1 } },
          active: [
            { lane: "core", state: "running", attempt: 1, elapsedMs: 723_000, owner: "01234567", reason: null },
            { lane: "dead", state: "orphaned", attempt: 2, elapsedMs: null, owner: null, reason: "no free slot" },
          ],
        },
        plans: [
          {
            plan: "field",
            phases: [
              { phase: "core", status: "running", endState: null },
              { phase: "docs", status: "failed", endState: "killed:wall" },
              { phase: "base", status: "done", endState: "success" },
            ],
          },
        ],
        integrations: [
          { name: "rel", stage: "verified", head: "b".repeat(40), waitsFor: ["review missing", "readiness has not run"] },
          { name: "old", stage: "landed", head: "c".repeat(40), waitsFor: [] },
        ],
        attention: [{ lane: "bad", state: "failed", attempt: 1, reason: "exit 1", todo: "read stderr.log" }],
        quota: {
          snapshot: {
            observedAt: "2026-10-09T11:55:00.000Z",
            status: "allowed",
            type: null,
            fiveHour: { utilization: 0.9, resetsAt: NOW_SEC + 1800 },
            sevenDay: null,
          },
          hold: { hold: true, reason: "five-hour window at 90% (hold above 85%)", until: NOW_SEC + 1800 },
          slots: { inUse: [{ slot: 0, pid: 1, lane: "core", project: "/work/repo" }], cap: 2, projectMaxParallel: 4, machineMaxParallel: 2 },
        },
        worktrees: { total: 14, idle: 5, idleDays: 3, lastSweep: { startedAt: "2026-10-09T10:00:00.000Z", finishedAt: "2026-10-09T10:00:04.000Z", removed: 9 } },
        errors: ["lane torn: bad"],
      }),
      NOW_SEC,
    );
    expect(text).toBe(
      [
        "Lanes (3)",
        "  1 running · 1 finished (1 failed) · 1 orphaned",
        "  LANE  STATE     ELAPSED  ATTEMPT  OWNER     REASON",
        "  core  running   12m03s   1        01234567  -",
        "  dead  orphaned  -        2        -         no free slot",
        "",
        "Plans",
        "  field:",
        `    ${"running".padEnd(20)}  core`,
        "    failed (killed:wall)  docs",
        `    ${"done".padEnd(20)}  base`,
        "  run `arbab plan status <plan file>` for the phases not launched yet",
        "",
        "Integrations",
        "  rel  verified  bbbbbbb  waits for: review missing; readiness has not run",
        "  old  landed    ccccccc  -",
        "",
        "Needs attention",
        "  bad: failed (attempt 1): exit 1",
        "    read stderr.log",
        "",
        "Quota, slots and worktrees",
        "  quota: 5h 90% (resets 12:30Z)",
        "  hold: yes, five-hour window at 90% (hold above 85%) (until 2026-10-09T12:30:00Z)",
        "  slots: 1 in use machine-wide of 2 (maxParallel 4, machine cap 2)",
        "  worktrees: 14 (5 unused for 3+ days); last sweep 2026-10-09T10:00:00Z: removed 9",
        "",
        "Unreadable records",
        "  lane torn: bad",
      ].join("\n"),
    );
  });
});
