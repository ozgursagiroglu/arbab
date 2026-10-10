import { describe, expect, it } from "vitest";
import type { AttemptSummary, LaneStateRecord, StatusRow } from "../types";
import { formatElapsed, formatStatusTable, statusRow } from "./index";

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
    });
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
        "lane       state               attempt  elapsed  turns  calls  last tool  effort  failed  cost            quota",
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
      "lane  state  attempt  elapsed  turns  calls  last tool  effort  failed  cost  quota",
    );
  });
});
