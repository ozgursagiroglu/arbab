import type { AttemptSummary, LaneState, LaneStateRecord, QuotaWindow, StatusRow, TokenUsage } from "../types";

const UNKNOWN = "—";

/** States in which the clock is still running for the current attempt. */
const LIVE: ReadonlySet<LaneState> = new Set<LaneState>(["queued", "held", "preparing", "running", "waiting-reset"]);

/** Whether the clock still runs for the current attempt in `state`. */
export const isLive = (state: LaneState): boolean => LIVE.has(state);

/**
 * One status row. Pass the record with its effective state (see effectiveState), the summary of the record's
 * attempt, if there is one, and the run's owner from shepherd.json.
 */
export function statusRow(record: LaneStateRecord, summary: AttemptSummary | null, nowMs: number, owner: string | null = null): StatusRow {
  return {
    lane: record.lane,
    state: record.state,
    attempt: record.attempt,
    endState: record.endState ?? (record.state === "finished" && summary ? summary.state : null),
    elapsedMs: elapsed(record, summary, nowMs),
    turns: summary?.turns ?? 0,
    toolCalls: summary?.toolCallTotal ?? 0,
    // AttemptSummary does not carry the stream's last tool yet.
    lastTool: summary?.lastTool ?? null,
    effort: dominantEffort(summary?.measuredEffort ?? null),
    failedTotal: summary?.failedTotal ?? 0,
    costUsd: summary?.costUsd ?? null,
    costDeltaUsd: summary?.costDeltaUsd ?? null,
    fiveHour: summary?.rateLimit?.fiveHour ?? null,
    sevenDay: summary?.rateLimit?.sevenDay ?? null,
    owner,
    reason: typeof record.reason === "string" ? record.reason : null,
    // Summaries written before §21 have no tokens.
    tokens: tokenUsage(summary?.tokens),
  };
}

/** The summary's tokens when every count is a non-negative number; summary.json is read from disk, not trusted. */
function tokenUsage(v: unknown): TokenUsage | null {
  if (typeof v !== "object" || v === null) return null;
  const t = v as Record<string, unknown>;
  const count = (k: string): number | null => {
    const n = t[k];
    return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
  };
  const [input, cacheCreation, cacheRead, output] = [count("input"), count("cacheCreation"), count("cacheRead"), count("output")];
  if (input === null || cacheCreation === null || cacheRead === null || output === null) return null;
  return { input, cacheCreation, cacheRead, output };
}

function elapsed(record: LaneStateRecord, summary: AttemptSummary | null, nowMs: number): number | null {
  if (!isLive(record.state)) return summary?.wallMs ?? null;
  const since = Date.parse(record.since);
  return Number.isNaN(since) ? null : Math.max(0, nowMs - since);
}

/** The effort with the most transcript entries; ties go to the alphabetically first, so output is stable. */
function dominantEffort(measured: Record<string, number> | null): string | null {
  if (!measured) return null;
  let best: string | null = null;
  let bestCount = -1;
  for (const [effort, count] of Object.entries(measured).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (count > bestCount) {
      best = effort;
      bestCount = count;
    }
  }
  return best;
}

/** `45s`, `12m03s`, `1h04m`. */
export function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number): string => String(n).padStart(2, "0");
  if (h > 0) return `${h}h${two(m)}m`;
  if (m > 0) return `${m}m${two(s)}s`;
  return `${s}s`;
}

/** `512 tok`, `41.2k tok`, `3.1M tok`: input, cache creation and output; cache reads are re-reads, left out. */
export function formatTokens(tokens: TokenUsage): string {
  const n = tokens.input + tokens.cacheCreation + tokens.output;
  if (n < 1000) return `${n} tok`;
  if (n < 999_950) return `${(n / 1000).toFixed(1)}k tok`;
  return `${(n / 1_000_000).toFixed(1)}M tok`;
}

function formatCost(row: StatusRow): string {
  const { costUsd: cost, costDeltaUsd: delta } = row;
  // A subscription or a killed attempt has no cost, but its tokens say how much it worked.
  if (cost === null) return row.tokens ? formatTokens(row.tokens) : UNKNOWN;
  const main = `$${cost.toFixed(2)}`;
  if (delta === null || delta.toFixed(2) === cost.toFixed(2)) return main;
  return `${main} (Δ$${delta.toFixed(2)})`;
}

const WHY_MAX = 40;

/** The state's reason on one line, cut to WHY_MAX characters; empty without one. */
export function formatWhy(reason: string | null | undefined): string {
  const text = (reason ?? "").trim().replace(/\s+/g, " ");
  return text.length > WHY_MAX ? `${text.slice(0, WHY_MAX - 1)}…` : text;
}

/** `5h 62% · 7d 60%`; windows that have already reset say nothing about now and are left out. */
export function formatWindows(fiveHour: QuotaWindow | null, sevenDay: QuotaWindow | null, nowSec: number): string {
  const parts: string[] = [];
  for (const [label, window] of [
    ["5h", fiveHour],
    ["7d", sevenDay],
  ] as const) {
    if (window && window.resetsAt > nowSec) parts.push(`${label} ${Math.round(window.utilization * 100)}%`);
  }
  return parts.length > 0 ? parts.join(" · ") : UNKNOWN;
}

const HEADERS = ["lane", "state", "attempt", "elapsed", "turns", "calls", "last tool", "effort", "failed", "cost", "quota", "why"];

/** Aligned plain-text columns, two spaces apart, no trailing blanks. */
export function formatStatusTable(rows: StatusRow[], nowSec: number): string {
  const cells = rows.map((row) => [
    row.lane,
    row.state === "finished" && row.endState ? `finished (${row.endState})` : row.state,
    String(row.attempt),
    row.elapsedMs === null ? UNKNOWN : formatElapsed(row.elapsedMs),
    String(row.turns),
    String(row.toolCalls),
    row.lastTool ?? UNKNOWN,
    row.effort ?? UNKNOWN,
    String(row.failedTotal),
    formatCost(row),
    formatWindows(row.fiveHour, row.sevenDay, nowSec),
    formatWhy(row.reason),
  ]);
  const table = [HEADERS, ...cells];
  const widths = HEADERS.map((_, i) => Math.max(...table.map((line) => (line[i] ?? "").length)));
  return table
    .map((line) =>
      line
        .map((cell, i) => cell.padEnd(widths[i] ?? 0))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}
