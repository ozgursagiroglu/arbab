import { describe, expect, it } from "vitest";
import type { AttemptSummary, LaneStateRecord, StatusRow } from "../types";
import { formatElapsed, formatStatusTable, statusRow } from "./index";
import { formatTokens, formatWhy, formatWindows, isLive } from "./status";

const FIVE_RESET = 1791549000; // 12:30Z
const SEVEN_RESET = 1792051200;
const NOW_SEC = FIVE_RESET - 9000; // 10:00Z

function summary(over: Partial<AttemptSummary> = {}): AttemptSummary {
  return {
    lane: "m1-stream",
    attempt: 1,
    role: "implementer",
    state: "success",
    sessionId: "00000000-0000-0000-0000-000000000001",
    binary: { path: "/usr/local/bin/claude", version: "2.1.295" },
    model: "claude-opus-5-5",
    requestedEffort: "high",
    measuredEffort: { medium: 4, high: 104 },
    wallMs: 723_000,
    turns: 41,
    toolCalls: { Bash: 60, Read: 50, Edit: 10 },
    toolCallTotal: 120,
    lastTool: null,
    failedByCause: { "Bash:sandbox": 2, "Bash:real": 1 },
    failedTotal: 3,
    permissionDenied: 0,
    costUsd: 1.23,
    costDeltaUsd: 1.23,
    resultEvents: 1,
    final: null,
    rateLimit: {
      observedAt: "2026-10-09T09:59:00.000Z",
      status: "allowed_warning",
      type: "seven_day",
      fiveHour: { utilization: 0.62, resetsAt: FIVE_RESET },
      sevenDay: { utilization: 0.6, resetsAt: SEVEN_RESET },
    },
    init: null,
    registration: null,
    reportValid: true,
    reportErrors: [],
    ...over,
  };
}

const record = (over: Partial<LaneStateRecord> = {}): LaneStateRecord => ({
  lane: "m1-stream",
  state: "finished",
  attempt: 1,
  since: "2026-10-09T10:00:00.000Z",
  shepherdPid: 1,
  endState: "success",
  ...over,
});

describe("statusRow", () => {
  it("takes metrics from the summary of a finished lane", () => {
    expect(statusRow(record(), summary(), Date.parse("2026-10-09T11:00:00Z"))).toEqual({
      lane: "m1-stream",
      state: "finished",
      attempt: 1,
      endState: "success",
      elapsedMs: 723_000,
      turns: 41,
      toolCalls: 120,
      lastTool: null,
      effort: "high",
      failedTotal: 3,
      costUsd: 1.23,
      costDeltaUsd: 1.23,
      fiveHour: { utilization: 0.62, resetsAt: FIVE_RESET },
      sevenDay: { utilization: 0.6, resetsAt: SEVEN_RESET },
      owner: null,
      reason: null,
      tokens: null,
    });
  });

  it("carries the owner, the state's reason and the summary's tokens", () => {
    const tokens = { input: 1000, cacheCreation: 200, cacheRead: 90_000, output: 40_000 };
    const row = statusRow(record({ state: "held", reason: "no free slot" }), summary({ tokens }), 0, "session-a");
    expect(row).toMatchObject({ owner: "session-a", reason: "no free slot", tokens });
  });

  it("ignores tokens that are not counts", () => {
    const bad = { input: 1, cacheCreation: "2", cacheRead: 0, output: 3 } as unknown as AttemptSummary["tokens"];
    expect(statusRow(record(), summary({ tokens: bad }), 0).tokens).toBeNull();
    expect(statusRow(record(), summary({ tokens: { input: -1, cacheCreation: 0, cacheRead: 0, output: 0 } }), 0).tokens).toBeNull();
    expect(statusRow(record(), summary({ tokens: null }), 0).tokens).toBeNull();
  });

  it("shows the summary's last tool", () => {
    expect(statusRow(record(), summary({ lastTool: "Edit" }), NOW_SEC * 1000).lastTool).toBe("Edit");
    expect(statusRow(record(), null, NOW_SEC * 1000).lastTool).toBeNull();
  });

  it("falls back to the summary's end state when the record has none", () => {
    expect(statusRow(record({ endState: undefined }), summary({ state: "budget" }), 0).endState).toBe("budget");
  });

  it("counts a live lane's elapsed time from the record", () => {
    const row = statusRow(record({ state: "running", endState: undefined }), null, Date.parse("2026-10-09T10:12:03Z"));
    expect(row).toMatchObject({ state: "running", endState: null, elapsedMs: 723_000, turns: 0, costUsd: null });
    expect(statusRow(record({ state: "running", since: "garbage" }), null, 0).elapsedMs).toBeNull();
    expect(statusRow(record({ state: "held" }), null, 0).elapsedMs).toBe(0);
  });

  it("knows no elapsed time for an orphan without a summary", () => {
    expect(statusRow(record({ state: "orphaned", endState: undefined }), null, 0).elapsedMs).toBeNull();
  });

  it("picks the effort with most entries, ties alphabetically, and none without a transcript", () => {
    expect(statusRow(record(), summary({ measuredEffort: { low: 3, max: 3 } }), 0).effort).toBe("low");
    expect(statusRow(record(), summary({ measuredEffort: {} }), 0).effort).toBeNull();
    expect(statusRow(record(), summary({ measuredEffort: null }), 0).effort).toBeNull();
  });
});

describe("formatElapsed", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(45_999)).toBe("45s");
    expect(formatElapsed(723_000)).toBe("12m03s");
    expect(formatElapsed(3_840_000)).toBe("1h04m");
    expect(formatElapsed(36_000_000)).toBe("10h00m");
  });
});

describe("isLive", () => {
  it("is true while the clock runs and false once it stopped", () => {
    for (const state of ["queued", "held", "preparing", "running", "waiting-reset"] as const) expect(isLive(state)).toBe(true);
    for (const state of ["finished", "orphaned"] as const) expect(isLive(state)).toBe(false);
  });
});

describe("formatWindows", () => {
  const window = (utilization: number, resetsAt: number) => ({ utilization, resetsAt });

  it("rounds each window that has not reset to a percentage, 5h first", () => {
    expect(formatWindows(window(0.62, FIVE_RESET), window(0.604, SEVEN_RESET), NOW_SEC)).toBe("5h 62% · 7d 60%");
    expect(formatWindows(null, window(0.125, NOW_SEC + 1), NOW_SEC)).toBe("7d 13%");
    expect(formatWindows(window(1, NOW_SEC + 1), null, NOW_SEC)).toBe("5h 100%");
  });

  it("leaves out windows that have reset, and is — without any", () => {
    expect(formatWindows(window(0.9, NOW_SEC), window(0.4, SEVEN_RESET), NOW_SEC)).toBe("7d 40%");
    expect(formatWindows(window(0.9, NOW_SEC - 1), null, NOW_SEC)).toBe("—");
    expect(formatWindows(null, null, NOW_SEC)).toBe("—");
  });
});

describe("formatStatusTable", () => {
  const rows: StatusRow[] = [
    statusRow(record(), summary(), 0),
    {
      lane: "m1-run",
      state: "running",
      attempt: 2,
      endState: null,
      elapsedMs: 3_840_000,
      turns: 7,
      toolCalls: 15,
      lastTool: "Bash",
      effort: null,
      failedTotal: 0,
      costUsd: 2.5,
      costDeltaUsd: 0.4,
      fiveHour: null,
      sevenDay: null,
    },
    statusRow(record({ lane: "m1-config", state: "orphaned", endState: undefined }), null, 0),
  ];

  it("aligns columns and marks unknowns", () => {
    expect(formatStatusTable(rows, NOW_SEC)).toBe(
      [
        "lane       state               attempt  elapsed  turns  calls  last tool  effort  failed  cost            quota            why",
        "m1-stream  finished (success)  1        12m03s   41     120    —          high    3       $1.23           5h 62% · 7d 60%",
        "m1-run     running             2        1h04m    7      15     Bash       —       0       $2.50 (Δ$0.40)  —",
        "m1-config  orphaned            1        —        0      0      —          —       0       —               —",
      ].join("\n"),
    );
  });

  it("drops quota windows that have reset", () => {
    const table = formatStatusTable([rows[0] as StatusRow], FIVE_RESET);
    expect(table.split("\n")[1]?.endsWith("$1.23  7d 60%")).toBe(true);
  });

  it("prints only the header without rows", () => {
    expect(formatStatusTable([], NOW_SEC)).toBe(
      "lane  state  attempt  elapsed  turns  calls  last tool  effort  failed  cost  quota  why",
    );
  });

  it("shows tokens in the cost column when there is no cost, and the cost when there is one", () => {
    const tokens = { input: 1200, cacheCreation: 5000, cacheRead: 900_000, output: 35_000 };
    const killed = statusRow(record({ endState: "killed:wall" }), summary({ costUsd: null, costDeltaUsd: null, tokens, rateLimit: null }), 0);
    expect(formatStatusTable([killed], NOW_SEC).split("\n")[1]).toMatch(/ 41\.2k tok {2}—$/);
    const paid = statusRow(record(), summary({ tokens, rateLimit: null }), 0);
    expect(formatStatusTable([paid], NOW_SEC).split("\n")[1]).toMatch(/ \$1\.23 {2}—$/);
  });

  it("shows the state's reason in the why column, on one line and cut to 40 characters", () => {
    const held = statusRow(record({ state: "held", reason: "no free slot", endState: undefined }), null, 0);
    const long = "dependencies failed (1):\n  ERR_PNPM_NO_LOCKFILE  Cannot install with frozen-lockfile";
    const failed = statusRow(record({ lane: "x", endState: "failed", reason: long }), null, 0);
    const lines = formatStatusTable([held, failed], NOW_SEC).split("\n");
    expect(lines[1]).toMatch(/ no free slot$/);
    const why = lines[2]?.split("  ").at(-1);
    expect(why).toBe("dependencies failed (1): ERR_PNPM_NO_LO…");
    expect(why).toHaveLength(40);
  });
});

describe("formatTokens", () => {
  const t = (input: number, cacheCreation = 0, output = 0) => ({ input, cacheCreation, cacheRead: 7_000_000, output });

  it("adds input, cache creation and output, and leaves cache reads out", () => {
    expect(formatTokens(t(0))).toBe("0 tok");
    expect(formatTokens(t(500, 400, 99))).toBe("999 tok");
    expect(formatTokens(t(1000))).toBe("1.0k tok");
    expect(formatTokens(t(1200, 5000, 35_000))).toBe("41.2k tok");
    expect(formatTokens(t(999_949))).toBe("999.9k tok");
    expect(formatTokens(t(999_950))).toBe("1.0M tok");
    expect(formatTokens(t(3_140_000))).toBe("3.1M tok");
  });
});

describe("formatWhy", () => {
  it("is empty without a reason and keeps a short one whole", () => {
    expect(formatWhy(null)).toBe("");
    expect(formatWhy(undefined)).toBe("");
    expect(formatWhy("  ")).toBe("");
    expect(formatWhy("quota 5h 91%")).toBe("quota 5h 91%");
    expect(formatWhy("x".repeat(40))).toBe("x".repeat(40));
    expect(formatWhy("x".repeat(41))).toBe(`${"x".repeat(39)}…`);
  });
});
