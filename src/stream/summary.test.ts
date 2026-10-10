import { describe, expect, it } from "vitest";
import type { AttemptExit, AttemptStarted, StreamDigest } from "../types";
import { digestStream } from "./digest";
import { buildAttemptSummary } from "./summary";
import type { AttemptSummaryInput } from "./summary";

const SID = "11111111-2222-4333-8444-555555555555";
const STARTED_AT = "2026-10-09T10:00:00.000Z";

const started: AttemptStarted = {
  lane: "m1-stream",
  attempt: 2,
  resume: true,
  sessionId: SID,
  pid: 4242,
  binary: { path: "/opt/claude", version: "2.1.295" },
  cwd: "/work/repo",
  startedAt: STARTED_AT,
  args: ["-p"],
  envKeys: ["PATH"],
  leases: [],
};

const exit: AttemptExit = {
  exitCode: 0,
  signal: null,
  killedBy: null,
  finishedAt: "2026-10-09T10:05:00.000Z",
  wallMs: 300_000,
  reaped: [],
  checkpoint: null,
  checkpointError: null,
};

function digestWithCost(cost: number | null): StreamDigest {
  return digestStream(
    [
      { type: "system", subtype: "init", session_id: SID, model: "claude-opus-5-5" },
      { type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "a", name: "Bash" }] } },
      { type: "assistant", message: { id: "m2", content: [{ type: "tool_use", id: "b", name: "Bash" }] } },
      { type: "assistant", message: { id: "m3", content: [{ type: "tool_use", id: "c", name: "Read" }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "a", content: "Exit code 1", is_error: true }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "c", content: "Operation not permitted", is_error: true }] } },
      { type: "result", subtype: "success", is_error: false, total_cost_usd: 0.4 },
      { type: "result", subtype: "success", is_error: false, total_cost_usd: cost },
    ],
    "T",
  );
}

function input(extra: Partial<AttemptSummaryInput> = {}): AttemptSummaryInput {
  return {
    lane: "m1-stream",
    attempt: 2,
    role: "implementer",
    state: "success",
    started,
    exit,
    digest: digestWithCost(0.9),
    requestedEffort: "high",
    measuredEffort: { high: 3 },
    previousCostUsd: null,
    registration: { kind: "headless", entrypoint: "sdk-cli", name: "m1-stream" },
    reportValid: true,
    reportErrors: [],
    nowMs: Date.parse(STARTED_AT) + 60_000,
    ...extra,
  };
}

describe("buildAttemptSummary", () => {
  it("assembles every field", () => {
    const s = buildAttemptSummary(input());
    expect(s).toMatchObject({
      lane: "m1-stream",
      attempt: 2,
      role: "implementer",
      state: "success",
      sessionId: SID,
      binary: { path: "/opt/claude", version: "2.1.295" },
      model: "claude-opus-5-5",
      requestedEffort: "high",
      measuredEffort: { high: 3 },
      wallMs: 300_000,
      turns: 3,
      toolCalls: { Bash: 2, Read: 1 },
      toolCallTotal: 3,
      failedByCause: { "Bash:real": 1, "Read:sandbox": 1 },
      failedTotal: 2,
      permissionDenied: 0,
      costUsd: 0.9,
      costDeltaUsd: 0.9,
      resultEvents: 2,
      rateLimit: null,
      registration: { kind: "headless", entrypoint: "sdk-cli", name: "m1-stream" },
      reportValid: true,
      reportErrors: [],
    });
    expect(s.final?.totalCostUsd).toBe(0.9);
    expect(s.init?.model).toBe("claude-opus-5-5");
    expect(buildAttemptSummary(input({ digest: { ...digestWithCost(0.9), lastTool: "Edit" } })).lastTool).toBe("Edit");
  });

  it("takes the delta against the previous attempt's cost", () => {
    expect(buildAttemptSummary(input({ previousCostUsd: 0.4 })).costDeltaUsd).toBeCloseTo(0.5, 10);
    expect(buildAttemptSummary(input({ previousCostUsd: 0 })).costDeltaUsd).toBe(0.9);
  });

  it("uses the whole cost as the delta when there was no previous attempt", () => {
    expect(buildAttemptSummary(input({ previousCostUsd: null })).costDeltaUsd).toBe(0.9);
  });

  it("has no cost and no delta when the final result has no cost", () => {
    const s = buildAttemptSummary(input({ digest: digestWithCost(null), previousCostUsd: 0.4 }));
    expect(s.costUsd).toBeNull();
    expect(s.costDeltaUsd).toBeNull();
    const empty = buildAttemptSummary(input({ digest: digestStream([], "T"), previousCostUsd: 0.4 }));
    expect(empty.costUsd).toBeNull();
    expect(empty.costDeltaUsd).toBeNull();
    expect(empty.toolCallTotal).toBe(0);
    expect(empty.failedTotal).toBe(0);
    expect(empty.resultEvents).toBe(0);
  });

  it("measures wall time from the start while the attempt runs", () => {
    expect(buildAttemptSummary(input({ exit: null })).wallMs).toBe(60_000);
    expect(buildAttemptSummary(input({ exit: null, nowMs: Date.parse(STARTED_AT) - 5 })).wallMs).toBe(0);
    expect(buildAttemptSummary(input({ exit: null, started: null })).wallMs).toBeNull();
    expect(buildAttemptSummary(input({ exit: null, started: { ...started, startedAt: "garbage" } })).wallMs).toBeNull();
  });

  it("falls back to the started record for the session id and has no binary without it", () => {
    const s = buildAttemptSummary(input({ digest: digestStream([], "T") }));
    expect(s.sessionId).toBe(SID);
    expect(s.model).toBeNull();
    const none = buildAttemptSummary(input({ digest: digestStream([], "T"), started: null }));
    expect(none.sessionId).toBeNull();
    expect(none.binary).toBeNull();
  });

  it("does not share the digest's counters", () => {
    const d = digestWithCost(0.9);
    const s = buildAttemptSummary(input({ digest: d }));
    s.toolCalls.Bash = 99;
    expect(d.toolCalls.Bash).toBe(2);
  });
});
