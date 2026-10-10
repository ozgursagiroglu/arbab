import { describe, expect, it } from "vitest";
import type { AttemptExit, KillReason, ResultFacts, StreamDigest } from "../types";
import { classifyAttempt } from "./classify";
import type { ClassifyInput } from "./classify";
import { digestStream } from "./digest";

const ok: ResultFacts = {
  subtype: "success",
  isError: false,
  terminalReason: "completed",
  apiErrorStatus: null,
  numTurns: 3,
  durationMs: 1000,
  totalCostUsd: 0.5,
  resultText: "done",
  structuredOutput: { status: "done" },
};

function digest(final: Partial<ResultFacts> | null): StreamDigest {
  const d = digestStream([], "T");
  if (final === null) return d;
  const r = { ...ok, ...final };
  return { ...d, results: [r], final: r };
}

function exit(killedBy: KillReason | null, exitCode: number | null = 0): AttemptExit {
  return { exitCode, signal: null, killedBy, finishedAt: "T", wallMs: 1, reaped: [], checkpoint: null, checkpointError: null };
}

function classify(final: Partial<ResultFacts> | null, extra: Partial<ClassifyInput> = {}) {
  return classifyAttempt({ digest: digest(final), exit: exit(null), alive: false, schemaRequired: false, reportValid: null, ...extra });
}

describe("classifyAttempt", () => {
  it("reports a wall, idle or stop kill first, whatever the stream says", () => {
    expect(classify({}, { exit: exit("wall") })).toBe("killed:wall");
    expect(classify({ isError: true, apiErrorStatus: 429 }, { exit: exit("idle") })).toBe("killed:idle");
    expect(classify({}, { exit: exit("stopped") })).toBe("killed:stopped");
    expect(classify(null, { exit: exit("hang-after-result"), alive: true })).toBe("killed:hang-after-result");
    expect(classify(null, { exit: exit("hang-after-error") })).toBe("killed:hang-after-error");
  });

  it("classifies a hang kill by the result the worker had already given", () => {
    const hangError = { exit: exit("hang-after-error", null) };
    expect(classify({ isError: true, apiErrorStatus: 429, subtype: "success" }, hangError)).toBe("usage-limit");
    expect(classify({ isError: true, subtype: "error_during_execution" }, hangError)).toBe("failed");
    const hangResult = { exit: exit("hang-after-result", null), schemaRequired: true };
    expect(classify({}, { ...hangResult, reportValid: true })).toBe("success");
    expect(classify({}, { ...hangResult, reportValid: false })).toBe("invalid-report");
    expect(classify({ isError: true, subtype: "error_max_budget_usd" }, hangResult)).toBe("budget");
  });

  it("without a final result: running while alive, else no-result", () => {
    expect(classify(null, { exit: null, alive: true })).toBe("running");
    expect(classify(null, { exit: null, alive: false })).toBe("no-result");
    expect(classify(null, { exit: exit(null, 1) })).toBe("no-result");
  });

  it("reads usage limits from the API status, not the subtype", () => {
    expect(classify({ isError: true, apiErrorStatus: 429, subtype: "success" })).toBe("usage-limit");
  });

  it("recognises an outdated CLI only on a 400 with the matching text", () => {
    expect(classify({ isError: true, apiErrorStatus: 400, resultText: "API Error: 400 Claude Code 2.1.217 does not support this model" })).toBe(
      "unsupported-cli",
    );
    expect(classify({ isError: true, apiErrorStatus: 400, resultText: "version 2.1.280 OR NEWER IS REQUIRED" })).toBe("unsupported-cli");
    expect(classify({ isError: true, apiErrorStatus: 400, resultText: "bad request" })).toBe("failed");
    expect(classify({ isError: true, apiErrorStatus: 400, resultText: null })).toBe("failed");
    expect(classify({ isError: true, apiErrorStatus: 500, resultText: "or newer is required" })).toBe("failed");
  });

  it("maps the limit subtypes", () => {
    expect(classify({ isError: true, subtype: "error_max_budget_usd" })).toBe("budget");
    expect(classify({ isError: true, subtype: "error_max_turns" })).toBe("max-turns");
    expect(classify({ isError: true, subtype: "error_max_structured_output_retries" })).toBe("invalid-report");
  });

  it("fails on is_error, an unknown subtype or a missing one", () => {
    expect(classify({ isError: true })).toBe("failed");
    expect(classify({ subtype: "error_during_execution" })).toBe("failed");
    expect(classify({ subtype: null })).toBe("failed");
  });

  it("requires a valid structured output when the lane has a schema", () => {
    expect(classify({ structuredOutput: null }, { schemaRequired: true })).toBe("invalid-report");
    expect(classify({}, { schemaRequired: true, reportValid: false })).toBe("invalid-report");
    expect(classify({}, { schemaRequired: true, reportValid: true })).toBe("success");
    expect(classify({}, { schemaRequired: true, reportValid: null })).toBe("success");
    expect(classify({ structuredOutput: null }, { schemaRequired: false })).toBe("success");
  });

  it("ignores the exit code", () => {
    expect(classify({}, { exit: exit(null, 1) })).toBe("success");
    expect(classify({ isError: true }, { exit: exit(null, 0) })).toBe("failed");
  });
});
