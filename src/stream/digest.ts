import type {
  FailureCause,
  InitFacts,
  QuotaWindow,
  RateLimitSnapshot,
  ResultFacts,
  StreamDigest,
} from "../types";
import { Counter, arrayOrEmpty, isRecord, numberOrNull, stringOrNull } from "./json";
import type { JsonRecord } from "./json";

/** The report mechanism of --json-schema runs: neither work nor a failure worth counting. */
const REPORT_TOOL = "StructuredOutput";

/**
 * One JSON value per non-empty line. A line that does not parse is counted, never thrown: the last line of a live
 * stream is often cut mid-write.
 */
export function parseStream(text: string): { events: unknown[]; unparsedLines: number } {
  const events: unknown[] = [];
  let unparsedLines = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      unparsedLines++;
    }
  }
  return { events, unparsedLines };
}

const DENIED_TYPE_CAUSES: ReadonlyMap<string, FailureCause> = new Map([
  ["mode", "dontAsk"],
  ["rule", "deny-rule"],
  ["other", "scope"],
  ["subcommandResults", "subcommand"],
]);

// Ordered: the first match wins. Permission-layer texts come before "sandbox" so that a refusal that merely
// mentions the sandbox is not blamed on it.
const TEXT_CAUSES: ReadonlyArray<readonly [RegExp, FailureCause]> = [
  [/can't be checked before it runs|expansion obfuscation|multiple targets|cannot be statically analy/i, "analyzer"],
  [/requires? approval|contains multiple operations/i, "needs-approval"],
  [/^Blocked: sleep/i, "sleep-guard"],
  [/InputValidationError/, "input"],
  [/denied by your permission settings/i, "deny-rule"],
  [/Operation not permitted|network-outbound|sandbox/i, "sandbox"],
  [/has been denied/i, "denied-other"],
];

/**
 * Why a tool result failed. `deniedType` is the `decision_reason_type` of the `permission_denied` event for the
 * same tool_use id; it outranks the text because it is the permission layer's own account.
 */
export function failureCause(text: string, deniedType?: string): FailureCause {
  if (deniedType) return DENIED_TYPE_CAUSES.get(deniedType) ?? "denied-other";
  for (const [pattern, cause] of TEXT_CAUSES) {
    if (pattern.test(text)) return cause;
  }
  return "real";
}

function quotaWindow(value: unknown): QuotaWindow | null {
  if (!isRecord(value)) return null;
  const utilization = numberOrNull(value.utilization);
  const resetsAt = numberOrNull(value.resetsAt);
  return utilization === null || resetsAt === null ? null : { utilization, resetsAt };
}

/**
 * The quota snapshot a `rate_limit_event` carries, or null when `event` is not one (or has no `rate_limit_info`).
 * A window that is absent or malformed is null; the rest of the snapshot still counts.
 */
export function rateLimitFromEvent(event: unknown, observedAt: string): RateLimitSnapshot | null {
  if (!isRecord(event) || event.type !== "rate_limit_event") return null;
  const info = event.rate_limit_info;
  if (!isRecord(info)) return null;
  const windows = isRecord(info.unifiedWindows) ? info.unifiedWindows : {};
  return {
    observedAt,
    status: stringOrNull(info.status),
    type: stringOrNull(info.rateLimitType),
    fiveHour: quotaWindow(windows.five_hour),
    sevenDay: quotaWindow(windows.seven_day),
  };
}

function initFacts(event: JsonRecord): InitFacts {
  const plugins: string[] = [];
  for (const p of arrayOrEmpty(event.plugins)) {
    if (typeof p === "string") plugins.push(p);
    else if (isRecord(p) && typeof p.name === "string") plugins.push(p.name);
  }
  const timing = isRecord(event.startup_timing) ? event.startup_timing : {};
  return {
    tools: arrayOrEmpty(event.tools).filter((t): t is string => typeof t === "string"),
    permissionMode: stringOrNull(event.permissionMode),
    version: stringOrNull(event.claude_code_version),
    model: stringOrNull(event.model),
    apiKeySource: stringOrNull(event.apiKeySource),
    mcpServers: arrayOrEmpty(event.mcp_servers),
    plugins,
    skills: arrayOrEmpty(event.skills).length,
    memoryPaths: Object.hasOwn(event, "memory_paths"),
    messagingSocket: Object.hasOwn(event, "messaging_socket_path"),
    entrypoint: stringOrNull(timing.entrypoint),
  };
}

function resultFacts(event: JsonRecord): ResultFacts {
  return {
    subtype: stringOrNull(event.subtype),
    isError: event.is_error === true,
    terminalReason: stringOrNull(event.terminal_reason),
    apiErrorStatus: numberOrNull(event.api_error_status),
    numTurns: numberOrNull(event.num_turns),
    durationMs: numberOrNull(event.duration_ms),
    totalCostUsd: numberOrNull(event.total_cost_usd),
    resultText: stringOrNull(event.result),
    structuredOutput: event.structured_output === undefined ? null : event.structured_output,
  };
}

/** Tool-result text: `content` when it is a string, else the joined `text` of its items. */
export function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  return arrayOrEmpty(content)
    .map((item) => (isRecord(item) && typeof item.text === "string" ? item.text : ""))
    .join("\n");
}

/** The content blocks of an assistant or user event; empty for anything else. */
export function contentBlocks(event: unknown): JsonRecord[] {
  return isRecord(event) && isRecord(event.message) ? arrayOrEmpty(event.message.content).filter(isRecord) : [];
}

/**
 * Everything one attempt's events say, computed from all of them: a run with background work can emit several
 * `result` events, and the last one may describe only the last turn. Unknown event types and fields are ignored.
 *
 * `unparsedLines` is passed through from parseStream (the events alone cannot know it).
 */
export function digestStream(events: unknown[], observedAt: string, unparsedLines = 0): StreamDigest {
  const records = events.filter(isRecord);

  let sessionId: string | null = null;
  let init: InitFacts | null = null;
  const results: ResultFacts[] = [];
  const toolNames = new Map<string, string>();
  const countedToolUses = new Set<string>();
  const toolCalls = new Counter();
  let lastTool: string | null = null;
  const messageIds = new Set<string>();
  const deniedTypes = new Map<string, string>();
  let permissionDenied = 0;
  let rateLimit: RateLimitSnapshot | null = null;

  for (const e of records) {
    if (sessionId === null && typeof e.session_id === "string" && e.session_id !== "") sessionId = e.session_id;

    if (e.type === "system" && e.subtype === "init") {
      if (init === null) {
        init = initFacts(e);
        // The init event names the session even when an earlier event carried another id.
        if (typeof e.session_id === "string" && e.session_id !== "") sessionId = e.session_id;
      }
    } else if (e.type === "system" && e.subtype === "permission_denied") {
      permissionDenied++;
      const type = stringOrNull(e.decision_reason_type);
      if (typeof e.tool_use_id === "string" && type) deniedTypes.set(e.tool_use_id, type);
    } else if (e.type === "assistant") {
      if (isRecord(e.message) && typeof e.message.id === "string") messageIds.add(e.message.id);
      for (const block of contentBlocks(e)) {
        if (block.type !== "tool_use" || typeof block.name !== "string") continue;
        const id = stringOrNull(block.id);
        if (id !== null) {
          // A replayed block (same tool_use id) is one call, not two.
          if (countedToolUses.has(id)) continue;
          countedToolUses.add(id);
          toolNames.set(id, block.name);
        }
        if (block.name === REPORT_TOOL) continue;
        toolCalls.add(block.name);
        lastTool = block.name;
      }
    } else if (e.type === "rate_limit_event") {
      rateLimit = rateLimitFromEvent(e, observedAt) ?? rateLimit;
    } else if (e.type === "result") {
      results.push(resultFacts(e));
    }
  }

  // A second pass: the permission_denied event and the tool_use may be emitted after the tool_result they explain.
  const failed = new Counter();
  for (const e of records) {
    if (e.type !== "user") continue;
    for (const block of contentBlocks(e)) {
      if (block.type !== "tool_result" || block.is_error !== true) continue;
      const id = stringOrNull(block.tool_use_id);
      const tool = (id !== null ? toolNames.get(id) : undefined) ?? "?";
      if (tool === REPORT_TOOL) continue;
      const cause = failureCause(toolResultText(block.content), id !== null ? deniedTypes.get(id) : undefined);
      failed.add(`${tool}:${cause}`);
    }
  }

  return {
    sessionId,
    init,
    results,
    final: results.at(-1) ?? null,
    toolCalls: toolCalls.toObject(),
    failedByCause: failed.toObject(),
    permissionDenied,
    turns: messageIds.size,
    lastTool,
    rateLimit,
    unparsedLines,
  };
}
