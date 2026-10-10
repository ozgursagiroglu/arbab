#!/usr/bin/env node
// Measures one attempt directory written by launch.mjs: reads every event of stream.jsonl (never only the
// final result, which can describe just the last turn), classifies how the attempt ended from fields
// (never from `subtype` or the exit code alone), counts tool calls and failed results by cause, and takes
// the effort actually used from the session transcript.
//
//   node bench/bootstrap/summarize.mjs <attempt-dir>...   prints one line per attempt
//   node bench/bootstrap/summarize.mjs --json <attempt-dir>...
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);

function readEvents(path) {
  if (!existsSync(path)) return [];
  const events = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      /* a partial last line of a running attempt */
    }
  }
  return events;
}

const textOf = (content) =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => c.text ?? "").join("\n") : "";

// Why a tool result failed. Permission-layer refusals come first: they are the fence's cost.
export function failureCause(text, deniedType) {
  if (deniedType === "mode") return "dontAsk";
  if (deniedType === "rule") return "deny-rule";
  if (deniedType) return `denied-${deniedType}`;
  if (/can't be checked before it runs|expansion obfuscation|multiple targets|cannot be statically/i.test(text)) return "analyzer";
  if (/requires approval|contains multiple operations/i.test(text)) return "needs-approval";
  if (/^Blocked: sleep/i.test(text)) return "sleep-guard";
  if (/InputValidationError/.test(text)) return "input";
  if (/Operation not permitted|sandbox/i.test(text)) return "sandbox";
  if (/has been denied/i.test(text)) return "denied-other";
  return "real";
}

export function classify({ final, exit, schemaRequired }) {
  if (exit?.killedBy) return `killed:${exit.killedBy}`;
  if (!final) return exit ? "no-result" : "running";
  const text = String(final.result ?? "");
  if (final.is_error) {
    if (final.api_error_status === 429) return "usage-limit";
    if (final.api_error_status === 400 && /does not support this model|or newer is required/i.test(text)) return "unsupported-cli";
    if (/budget/i.test(`${final.subtype} ${final.terminal_reason}`)) return "budget";
    return "failed";
  }
  if (final.subtype && final.subtype !== "success") return /budget/i.test(final.subtype) ? "budget" : "failed";
  if (schemaRequired && final.structured_output == null) return "invalid-report";
  return "success";
}

function transcriptEfforts(sessionId) {
  const root = join(homedir(), ".claude", "projects");
  if (!sessionId || !existsSync(root)) return null;
  for (const dir of readdirSync(root)) {
    const p = join(root, dir, `${sessionId}.jsonl`);
    if (!existsSync(p)) continue;
    const counts = {};
    for (const e of readEvents(p)) if (e.type === "assistant" && e.effort) counts[e.effort] = (counts[e.effort] ?? 0) + 1;
    return { path: p, counts };
  }
  return null;
}

export function summarize(dir) {
  const started = readJson(join(dir, "started.json"));
  const exit = readJson(join(dir, "exit.json"));
  const lane = readJson(join(dir, "lane.json"));
  const registration = readJson(join(dir, "registration.json"));
  const events = readEvents(join(dir, "stream.jsonl"));

  const init = events.find((e) => e.type === "system" && e.subtype === "init") ?? null;
  const results = events.filter((e) => e.type === "result");
  const final = results.at(-1) ?? null;
  const toolNames = new Map();
  const toolCalls = {};
  const denied = new Map();
  const failed = {};
  const turns = new Set();
  let rateLimit = null;

  for (const e of events) {
    if (e.type === "assistant") {
      if (e.message?.id) turns.add(e.message.id);
      for (const c of e.message?.content ?? []) {
        if (c.type !== "tool_use") continue;
        toolNames.set(c.id, c.name);
        toolCalls[c.name] = (toolCalls[c.name] ?? 0) + 1;
      }
    } else if (e.type === "system" && e.subtype === "permission_denied") {
      denied.set(e.tool_use_id, e.decision_reason_type ?? "unknown");
    } else if (e.type === "rate_limit_event") {
      const i = e.rate_limit_info ?? {};
      rateLimit = {
        status: i.status ?? null,
        type: i.rateLimitType ?? null,
        fiveHour: i.unifiedWindows?.five_hour ?? null,
        sevenDay: i.unifiedWindows?.seven_day ?? null,
      };
    }
  }
  for (const e of events) {
    if (e.type !== "user") continue;
    for (const c of e.message?.content ?? []) {
      if (c.type !== "tool_result" || c.is_error !== true) continue;
      const cause = failureCause(textOf(c.content), denied.get(c.tool_use_id));
      const key = `${toolNames.get(c.tool_use_id) ?? "?"}:${cause}`;
      failed[key] = (failed[key] ?? 0) + 1;
    }
  }

  const efforts = transcriptEfforts(started?.sessionId);
  const wallMs = exit?.wallMs ?? (started ? Date.now() - Date.parse(started.startedAt) : null);
  return {
    name: started?.name ?? lane?.name ?? null,
    attempt: started?.attempt ?? null,
    role: started?.role ?? lane?.role ?? null,
    state: classify({ final, exit, schemaRequired: Boolean(lane?.jsonSchemaFile) }),
    sessionId: started?.sessionId ?? null,
    binary: started?.binary ?? null,
    model: init?.model ?? null,
    requestedEffort: lane?.effort ?? null,
    measuredEffort: efforts?.counts ?? null,
    wallMs,
    turns: turns.size,
    toolCalls,
    toolCallTotal: Object.values(toolCalls).reduce((a, b) => a + b, 0),
    failed,
    failedTotal: Object.values(failed).reduce((a, b) => a + b, 0),
    permissionDenied: denied.size,
    costUsd: final?.total_cost_usd ?? null,
    resultEvents: results.length,
    final: final && {
      subtype: final.subtype, is_error: final.is_error, terminal_reason: final.terminal_reason ?? null,
      api_error_status: final.api_error_status ?? null, num_turns: final.num_turns, duration_ms: final.duration_ms,
      has_structured_output: final.structured_output != null,
    },
    rateLimit,
    init: init && {
      tools: init.tools, permissionMode: init.permissionMode, version: init.claude_code_version,
      apiKeySource: init.apiKeySource, mcpServers: init.mcp_servers, plugins: (init.plugins ?? []).map((p) => p.name),
      skills: (init.skills ?? []).length, memoryPaths: "memory_paths" in init, messagingSocket: "messaging_socket_path" in init,
      entrypoint: init.startup_timing?.entrypoint ?? null,
    },
    registration,
    exit,
  };
}

const pct = (w) => (w?.utilization == null ? "?" : `${Math.round(w.utilization * 100)}%`);

export function formatLine(s) {
  const min = s.wallMs == null ? "?" : (s.wallMs / 60_000).toFixed(1);
  const eff = s.measuredEffort ? Object.entries(s.measuredEffort).map(([k, v]) => `${k}×${v}`).join(",") : "?";
  const fails = Object.entries(s.failed).map(([k, v]) => `${k}=${v}`).join(" ") || "none";
  const cost = s.costUsd == null ? "?" : `$${s.costUsd.toFixed(2)}`;
  return `${s.name}#${s.attempt} ${s.state} ${min}min turns=${s.turns} calls=${s.toolCallTotal} failed=${s.failedTotal} [${fails}] ` +
    `${cost} effort(req=${s.requestedEffort} got=${eff}) 5h=${pct(s.rateLimit?.fiveHour)} 7d=${pct(s.rateLimit?.sevenDay)}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const json = process.argv.includes("--json");
  for (const dir of process.argv.slice(2).filter((a) => a !== "--json")) {
    const s = summarize(dir);
    console.log(json ? JSON.stringify(s, null, 2) : formatLine(s));
  }
}
