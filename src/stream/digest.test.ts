import { describe, expect, it } from "vitest";
import type { FailureCause } from "../types";
import { contentBlocks, digestStream, failureCause, parseStream, rateLimitFromEvent, toolResultText } from "./digest";

const T = "2026-10-09T10:00:00.000Z";
const SID = "11111111-2222-4333-8444-555555555555";

const toolUse = (msg: string, id: string, name: string) => ({
  type: "assistant",
  session_id: SID,
  message: { id: msg, content: [{ type: "tool_use", id, name, input: {} }] },
});
const toolResult = (id: string, content: unknown, isError = true) => ({
  type: "user",
  message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] },
});
const denied = (id: string, type: unknown) => ({
  type: "system",
  subtype: "permission_denied",
  tool_use_id: id,
  decision_reason_type: type,
});
const result = (extra: Record<string, unknown>) => ({ type: "result", subtype: "success", is_error: false, ...extra });

describe("parseStream", () => {
  it("parses one value per line and skips blank lines", () => {
    expect(parseStream('{"a":1}\n\n  \n[2]\r\n"x"\n')).toEqual({ events: [{ a: 1 }, [2], "x"], unparsedLines: 0 });
  });
  it("counts lines that do not parse instead of throwing", () => {
    expect(parseStream('{"a":1}\n{"type":"assi')).toEqual({ events: [{ a: 1 }], unparsedLines: 1 });
    expect(parseStream("nope\n{\n")).toEqual({ events: [], unparsedLines: 2 });
  });
  it("handles empty input", () => {
    expect(parseStream("")).toEqual({ events: [], unparsedLines: 0 });
  });
});

describe("failureCause", () => {
  const rows: Array<[string, string | undefined, FailureCause]> = [
    ["anything", "mode", "dontAsk"],
    ["anything", "rule", "deny-rule"],
    ["anything", "other", "scope"],
    ["Permission to use Bash with command cat .env has been denied.", "subcommandResults", "subcommand"],
    ["anything", "classifier", "denied-other"],
    ["anything", "__proto__", "denied-other"],
    ["A variable in this command can't be checked before it runs", undefined, "analyzer"],
    ["Command contains expansion obfuscation", undefined, "analyzer"],
    ["rm with multiple targets", undefined, "analyzer"],
    ["This command cannot be statically analyzed", undefined, "analyzer"],
    ["The following parts require approval: break", undefined, "needs-approval"],
    ["This command requires approval", undefined, "needs-approval"],
    ["This Bash command contains multiple operations.", undefined, "needs-approval"],
    ["Blocked: sleep 60 followed by: cat log", undefined, "sleep-guard"],
    ["<tool_use_error>InputValidationError: bad</tool_use_error>", undefined, "input"],
    ["File is in a directory that is denied by your permission settings.", undefined, "deny-rule"],
    ["touch: /x: Operation not permitted", undefined, "sandbox"],
    ["deny network-outbound example.com:443", undefined, "sandbox"],
    ["<sandbox_violations>", undefined, "sandbox"],
    ["Permission to use Bash has been denied.", undefined, "denied-other"],
    ["Exit code 1\nFAIL src/a.test.ts", undefined, "real"],
    ["", undefined, "real"],
    ["", "", "real"],
  ];
  it.each(rows)("%j with %j → %s", (text, type, cause) => {
    expect(failureCause(text, type)).toBe(cause);
  });
  it("lets the denial type outrank the text", () => {
    expect(failureCause("Operation not permitted", "mode")).toBe("dontAsk");
  });
  it("anchors the sleep guard at the start", () => {
    expect(failureCause("echo Blocked: sleep")).toBe("real");
  });
  it("is case-sensitive only for InputValidationError", () => {
    expect(failureCause("inputvalidationerror")).toBe("real");
  });
});

describe("rateLimitFromEvent", () => {
  const event = {
    type: "rate_limit_event",
    rate_limit_info: {
      status: "rejected",
      rateLimitType: "five_hour",
      unifiedWindows: { five_hour: { utilization: 1, resetsAt: 100 }, seven_day: { utilization: 0.4, resetsAt: 200 } },
      futureField: true,
    },
  };
  it("reads status, type and both windows", () => {
    expect(rateLimitFromEvent(event, T)).toEqual({
      observedAt: T,
      status: "rejected",
      type: "five_hour",
      fiveHour: { utilization: 1, resetsAt: 100 },
      sevenDay: { utilization: 0.4, resetsAt: 200 },
    });
  });
  it("nulls absent or malformed windows and fields", () => {
    expect(
      rateLimitFromEvent(
        { type: "rate_limit_event", rate_limit_info: { status: 3, unifiedWindows: { five_hour: { utilization: "1", resetsAt: 1 } } } },
        T,
      ),
    ).toEqual({ observedAt: T, status: null, type: null, fiveHour: null, sevenDay: null });
    expect(rateLimitFromEvent({ type: "rate_limit_event", rate_limit_info: { unifiedWindows: [] } }, T)?.fiveHour).toBeNull();
  });
  it("returns null for anything that is not a rate_limit_event with info", () => {
    expect(rateLimitFromEvent(null, T)).toBeNull();
    expect(rateLimitFromEvent("rate_limit_event", T)).toBeNull();
    expect(rateLimitFromEvent({ type: "result", rate_limit_info: {} }, T)).toBeNull();
    expect(rateLimitFromEvent({ type: "rate_limit_event" }, T)).toBeNull();
    expect(rateLimitFromEvent({ type: "rate_limit_event", rate_limit_info: [] }, T)).toBeNull();
  });
});

describe("digestStream", () => {
  it("returns an empty digest for no events", () => {
    expect(digestStream([], T)).toEqual({
      sessionId: null,
      init: null,
      results: [],
      final: null,
      toolCalls: {},
      failedByCause: {},
      permissionDenied: 0,
      turns: 0,
      lastTool: null,
      rateLimit: null,
      unparsedLines: 0,
    });
  });

  it("ignores malformed and unknown events without throwing", () => {
    const events: unknown[] = [
      null,
      42,
      "text",
      [1, 2],
      { type: "future_event", payload: {} },
      { type: "assistant" },
      { type: "assistant", message: null },
      { type: "assistant", message: { id: 7, content: "not an array" } },
      { type: "assistant", message: { content: [null, 1, { type: "tool_use" }, { type: "tool_use", name: 5 }] } },
      { type: "user", message: { content: [{ type: "tool_result" }, { type: "tool_result", is_error: "true" }] } },
      { type: "system" },
      { type: "system", subtype: "init", tools: "Bash", plugins: [1, null, { name: 2 }], skills: {} },
      { type: "rate_limit_event", rate_limit_info: "x" },
      { type: "result", is_error: "yes", api_error_status: "429", structured_output: undefined },
    ];
    const d = digestStream(events, T, 3);
    expect(d.toolCalls).toEqual({});
    expect(d.failedByCause).toEqual({});
    expect(d.turns).toBe(0);
    expect(d.rateLimit).toBeNull();
    expect(d.unparsedLines).toBe(3);
    expect(d.init).toEqual({
      tools: [],
      permissionMode: null,
      version: null,
      model: null,
      apiKeySource: null,
      mcpServers: [],
      plugins: [],
      skills: 0,
      memoryPaths: false,
      messagingSocket: false,
      entrypoint: null,
    });
    expect(d.final).toEqual({
      subtype: null,
      isError: false,
      terminalReason: null,
      apiErrorStatus: null,
      numTurns: null,
      durationMs: null,
      totalCostUsd: null,
      resultText: null,
      structuredOutput: null,
    });
  });

  it("reads init facts, including key presence and the startup entrypoint", () => {
    const d = digestStream(
      [
        {
          type: "system",
          subtype: "init",
          session_id: SID,
          tools: ["Bash", 3, "Read"],
          permissionMode: "dontAsk",
          claude_code_version: "2.1.295",
          model: "m",
          apiKeySource: "none",
          mcp_servers: [{ name: "x", status: "connected" }],
          plugins: [{ name: "p1", path: "/x" }, "p2"],
          skills: ["a", "b"],
          memory_paths: null,
          messaging_socket_path: "/tmp/s",
          startup_timing: { entrypoint: "sdk-cli" },
        },
      ],
      T,
    );
    expect(d.sessionId).toBe(SID);
    expect(d.init).toEqual({
      tools: ["Bash", "Read"],
      permissionMode: "dontAsk",
      version: "2.1.295",
      model: "m",
      apiKeySource: "none",
      mcpServers: [{ name: "x", status: "connected" }],
      plugins: ["p1", "p2"],
      skills: 2,
      memoryPaths: true,
      messagingSocket: true,
      entrypoint: "sdk-cli",
    });
  });

  it("takes the session id from init, else from the first event that has one", () => {
    const other = "99999999-2222-4333-8444-555555555555";
    expect(digestStream([{ type: "x", session_id: other }, { type: "system", subtype: "init", session_id: SID }], T).sessionId).toBe(SID);
    expect(digestStream([{ type: "x" }, { type: "x", session_id: other }, { type: "y", session_id: SID }], T).sessionId).toBe(other);
  });

  it("counts tool calls without StructuredOutput, turns by message id, and the last tool", () => {
    const d = digestStream(
      [
        toolUse("m1", "a", "Bash"),
        toolUse("m1", "b", "Read"),
        toolUse("m2", "c", "Bash"),
        toolUse("m2", "c", "Bash"), // replayed block
        toolUse("m3", "d", "StructuredOutput"),
        { type: "assistant", message: { id: "m4", content: [{ type: "text", text: "done" }] } },
      ],
      T,
    );
    expect(d.toolCalls).toEqual({ Bash: 2, Read: 1 });
    expect(d.turns).toBe(4);
    expect(d.lastTool).toBe("Bash");
  });

  it("keys failed results by tool and cause, using the matching permission_denied event", () => {
    const d = digestStream(
      [
        toolUse("m1", "a", "Bash"),
        toolResult("a", "Permission to use Bash has been denied."),
        toolUse("m2", "b", "Read"),
        toolResult("b", [{ type: "text", text: "File is in a directory" }, { type: "text", text: "that is denied by your permission settings." }]),
        toolUse("m3", "c", "StructuredOutput"),
        toolResult("c", "schema mismatch"),
        toolResult("unknown-id", "Exit code 2"),
        toolUse("m4", "e", "Bash"),
        toolResult("e", "all good", false),
        // Emitted after the result it explains: still applies.
        denied("a", "mode"),
        denied("zzz", "rule"),
      ],
      T,
    );
    expect(d.failedByCause).toEqual({ "Bash:dontAsk": 1, "Read:deny-rule": 1, "?:real": 1 });
    expect(d.permissionDenied).toBe(2);
  });

  it("joins array content text with newlines before matching", () => {
    const d = digestStream([toolUse("m1", "a", "Bash"), toolResult("a", [{ type: "text", text: "x" }, { type: "image" }, "y", { text: "Blocked: sleep" }])], T);
    // "Blocked: sleep" is not at the start of the joined text, so it is a real failure.
    expect(d.failedByCause).toEqual({ "Bash:real": 1 });
  });

  it("keeps every result in order and makes the last one final", () => {
    const d = digestStream(
      [
        result({ total_cost_usd: 0.4, result: "first" }),
        { type: "system", subtype: "task_notification" },
        result({ total_cost_usd: 0.9, result: "second", structured_output: { ok: true }, api_error_status: 0 }),
      ],
      T,
    );
    expect(d.results.map((r) => r.resultText)).toEqual(["first", "second"]);
    expect(d.final?.totalCostUsd).toBe(0.9);
    expect(d.final?.structuredOutput).toEqual({ ok: true });
    expect(d.final?.apiErrorStatus).toBe(0);
  });

  it("uses the last valid rate_limit_event", () => {
    const rl = (u: number) => ({
      type: "rate_limit_event",
      rate_limit_info: { status: "allowed", unifiedWindows: { five_hour: { utilization: u, resetsAt: 1 } } },
    });
    expect(digestStream([rl(0.2), rl(0.5)], T).rateLimit?.fiveHour?.utilization).toBe(0.5);
    expect(digestStream([rl(0.2), { type: "rate_limit_event" }], T).rateLimit?.fiveHour?.utilization).toBe(0.2);
    expect(digestStream([rl(0.2)], T).rateLimit?.observedAt).toBe(T);
  });
});

describe("toolResultText", () => {
  it("returns string content as it is", () => {
    expect(toolResultText("Exit code 1\nboom")).toBe("Exit code 1\nboom");
    expect(toolResultText("")).toBe("");
  });

  it("joins the text of content items with newlines, an item without text counting as empty", () => {
    expect(toolResultText([{ type: "text", text: "a" }, { type: "text", text: "b" }])).toBe("a\nb");
    expect(toolResultText([{ type: "image", source: {} }, { type: "text", text: "b" }, "x", null, { text: 3 }])).toBe("\nb\n\n\n");
  });

  it("is empty for anything else", () => {
    for (const content of [undefined, null, 3, { text: "not a list" }, []]) expect(toolResultText(content)).toBe("");
  });
});

describe("contentBlocks", () => {
  it("returns the object blocks of an event's message content", () => {
    expect(contentBlocks(toolUse("m1", "t1", "Bash"))).toEqual([{ type: "tool_use", id: "t1", name: "Bash", input: {} }]);
    expect(contentBlocks(toolResult("t1", "out"))).toEqual([{ type: "tool_result", tool_use_id: "t1", content: "out", is_error: true }]);
    expect(contentBlocks({ message: { content: [{ type: "text" }, "x", null, [1], 2] } })).toEqual([{ type: "text" }]);
  });

  it("is empty for events without a message or with content that is not a list", () => {
    const events: unknown[] = [
      null,
      "assistant",
      [toolUse("m1", "t1", "Bash")],
      { type: "result" },
      { type: "assistant", message: "text" },
      { type: "assistant", message: { content: "plain text" } },
      { type: "assistant", message: {} },
    ];
    for (const event of events) expect(contentBlocks(event)).toEqual([]);
  });
});
