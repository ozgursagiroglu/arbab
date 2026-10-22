// The recorded streams in test/fixtures/stream (see its README), end to end through parse, digest and classify.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { EndState, StreamDigest } from "../types";
import { classifyAttempt } from "./classify";
import { digestStream, parseStream } from "./digest";

const FIXTURES = fileURLToPath(new URL("../../test/fixtures/stream/", import.meta.url));
const T = "2026-10-09T10:00:00.000Z";

function load(name: string): StreamDigest {
  const { events, unparsedLines } = parseStream(readFileSync(`${FIXTURES}${name}.jsonl`, "utf8"));
  return digestStream(events, T, unparsedLines);
}

function classify(name: string, schemaRequired: boolean): EndState {
  return classifyAttempt({ digest: load(name), exit: null, alive: false, schemaRequired, reportValid: null });
}

describe("fixture classification", () => {
  const table: Array<[string, boolean, EndState]> = [
    ["probe-strict", true, "success"],
    ["probe-walls", true, "success"],
    ["probe-params", true, "success"],
    ["probe-tools", false, "success"],
    ["probe-unrestricted", false, "success"],
    ["smoke-opus", false, "success"],
    ["research", true, "success"],
    ["usage-limit", true, "usage-limit"],
    ["unsupported-cli", true, "unsupported-cli"],
    ["budget", true, "budget"],
    ["structured-retries", true, "invalid-report"],
    ["background-multi-result", false, "success"],
    ["truncated", false, "no-result"],
    ["refusals", false, "success"],
  ];

  it("covers every fixture file", () => {
    const files = readdirSync(FIXTURES)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => f.slice(0, -".jsonl".length))
      .sort();
    expect(table.map(([name]) => name).sort()).toEqual(files);
  });

  it.each(table)("%s (schema %s) → %s", (name, schemaRequired, state) => {
    expect(classify(name, schemaRequired)).toBe(state);
  });

  it("calls a schema lane without structured output an invalid report", () => {
    expect(classify("smoke-opus", true)).toBe("invalid-report");
    expect(classify("refusals", true)).toBe("invalid-report");
  });

  it("calls a truncated stream running while the worker is alive", () => {
    expect(classifyAttempt({ digest: load("truncated"), exit: null, alive: true, schemaRequired: false, reportValid: null })).toBe("running");
  });
});

describe("fixture digests", () => {
  it("probe-strict: tool calls, subcommand denials, a sandbox refusal and a Read deny", () => {
    const d = load("probe-strict");
    expect(d.toolCalls).toEqual({ Bash: 8, Read: 2, Write: 1 });
    expect(d.failedByCause).toEqual({ "Bash:subcommand": 2, "Bash:sandbox": 1, "Read:deny-rule": 1 });
    expect(d.permissionDenied).toBe(2);
    expect(d.final?.structuredOutput).not.toBeNull();
    expect(d.init?.tools).toContain("StructuredOutput");
    expect(d.sessionId).toBe("3f0be056-3590-47bb-9add-97bf3226e46d");
    expect(d.unparsedLines).toBe(0);
  });

  it("probe-walls: EPERM refusals and dontAsk denials", () => {
    expect(load("probe-walls").failedByCause).toEqual({ "Bash:sandbox": 5, "Bash:dontAsk": 2 });
  });

  it("probe-params: a parameter deny rule", () => {
    const d = load("probe-params");
    expect(d.failedByCause).toEqual({ "Bash:deny-rule": 1 });
    expect(d.permissionDenied).toBe(1);
  });

  it("probe-tools: --tools names Task and Monitor", () => {
    const d = load("probe-tools");
    expect(d.init?.tools).toEqual(expect.arrayContaining(["Task", "Monitor"]));
    expect(d.toolCalls).toEqual({});
    expect(d.lastTool).toBeNull();
  });

  it("probe-unrestricted: memory and messaging are on, unlike the restricted probes", () => {
    expect(load("probe-unrestricted").init).toMatchObject({ memoryPaths: true, messagingSocket: true });
    expect(load("probe-strict").init).toMatchObject({ memoryPaths: false, messagingSocket: false });
  });

  it("probe init facts: version, mode, plugins and skills", () => {
    expect(load("probe-strict").init).toMatchObject({
      version: "2.1.295",
      permissionMode: "dontAsk",
      model: "claude-haiku-5-5",
      apiKeySource: "none",
      mcpServers: [],
      plugins: ["cc-plugin-agents-md", "cc-plugin-telemetry", "cc-plugin-plugin-authoring"],
      skills: 1,
      entrypoint: null,
    });
  });

  it("smoke-opus: one tool call, then the answer", () => {
    const d = load("smoke-opus");
    expect(d.toolCalls).toEqual({ Bash: 1 });
    expect(d.turns).toBe(2);
    expect(d.final?.resultText).toMatch(/^OK/);
  });

  it("smoke-opus: tokens over both messages and the longest gap", () => {
    const d = load("smoke-opus");
    expect(d.tokens).toEqual({ input: 4, cacheCreation: 7742, cacheRead: 7603, output: 24 });
    // 09:32:52.511 → 09:32:53.844 → 09:32:54.781; the system and rate-limit events carry no timestamp.
    expect(d.maxGapMs).toBe(1_333);
  });

  it("research: a real stream with usage on every assistant message", () => {
    const d = load("research");
    expect(d.tokens).not.toBeNull();
    expect(d.tokens?.output).toBeGreaterThan(0);
    expect(d.maxGapMs).toBeGreaterThan(0);
  });

  it("unsupported-cli: no assistant message, no tokens", () => {
    expect(load("unsupported-cli").tokens).toBeNull();
  });

  it("research: WebFetch-heavy, StructuredOutput not counted", () => {
    const d = load("research");
    expect(d.toolCalls).toEqual({ WebFetch: 34, WebSearch: 4 });
    expect(d.final?.structuredOutput).not.toBeNull();
    expect(d.failedByCause).toEqual({});
  });

  it("usage-limit: the last rate_limit_event wins", () => {
    const d = load("usage-limit");
    expect(d.rateLimit).toEqual({
      observedAt: T,
      status: "rejected",
      type: "five_hour",
      fiveHour: { utilization: 1, resetsAt: 1791531000 },
      sevenDay: { utilization: 0.44, resetsAt: 1792051200 },
    });
    expect(d.final).toMatchObject({ subtype: "success", isError: true, apiErrorStatus: 429, totalCostUsd: 4.82 });
  });

  it("unsupported-cli: an old version and a 400", () => {
    const d = load("unsupported-cli");
    expect(d.init?.version).toBe("2.1.217");
    expect(d.final?.apiErrorStatus).toBe(400);
    expect(d.turns).toBe(0);
  });

  it("budget and structured-retries: error subtypes with costs", () => {
    expect(load("budget").final).toMatchObject({ subtype: "error_max_budget_usd", totalCostUsd: 1.07, resultText: null });
    expect(load("structured-retries").final).toMatchObject({ subtype: "error_max_structured_output_retries", structuredOutput: null });
  });

  it("background-multi-result: both results kept, the last is final", () => {
    const d = load("background-multi-result");
    expect(d.results.map((r) => r.totalCostUsd)).toEqual([0.4, 0.9]);
    expect(d.final?.totalCostUsd).toBe(0.9);
    expect(d.final?.resultText).toBe("All tests pass.");
    expect(d.toolCalls).toEqual({ Bash: 1, Read: 1 });
    expect(d.turns).toBe(4);
  });

  it("truncated: no result and one unparsable last line", () => {
    const d = load("truncated");
    expect(d.final).toBeNull();
    expect(d.results).toEqual([]);
    expect(d.unparsedLines).toBe(1);
    expect(d.toolCalls).toEqual({ Bash: 1 });
    expect(d.lastTool).toBe("Bash");
    // No usage anywhere, and the second timed event is the cut line: one timed event, no gap.
    expect(d.tokens).toBeNull();
    expect(d.maxGapMs).toBeNull();
  });

  it("refusals: one failure of each cause", () => {
    const d = load("refusals");
    expect(d.failedByCause).toEqual({
      "Bash:analyzer": 1,
      "Bash:needs-approval": 1,
      "Bash:sleep-guard": 1,
      "Monitor:input": 1,
      "Bash:dontAsk": 1,
      "Read:scope": 1,
      "Bash:sandbox": 1,
      "Read:deny-rule": 1,
      "Bash:real": 1,
    });
    expect(d.permissionDenied).toBe(2);
  });
});
