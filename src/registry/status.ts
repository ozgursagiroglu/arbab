import type { AttemptSummary, LaneStateRecord, QuotaWindow, StatusRow } from "../types";

const UNKNOWN = "—";

/** States in which the clock is still running for the current attempt. */
const LIVE = new Set(["queued", "held", "preparing", "running", "waiting-reset"]);

/**
 * One status row. Pass the record with its effective state (see effectiveState) and the summary of the record's
 * attempt, if there is one.
 */
export function statusRow(record: LaneStateRecord, summary: AttemptSummary | null, nowMs: number): StatusRow {
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
  };
}

function elapsed(record: LaneStateRecord, summary: AttemptSummary | null, nowMs: number): number | null {
  if (!LIVE.has(record.state)) return summary?.wallMs ?? null;
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

function formatCost(cost: number | null, delta: number | null): string {
  if (cost === null) return UNKNOWN;
  const main = `$${cost.toFixed(2)}`;
  if (delta === null || delta.toFixed(2) === cost.toFixed(2)) return main;
  return `${main} (Δ$${delta.toFixed(2)})`;
}

/** `5h 62% · 7d 60%`; windows that have already reset say nothing about now and are left out. */
function formatWindows(fiveHour: QuotaWindow | null, sevenDay: QuotaWindow | null, nowSec: number): string {
  const parts: string[] = [];
  for (const [label, window] of [
    ["5h", fiveHour],
    ["7d", sevenDay],
  ] as const) {
    if (window && window.resetsAt > nowSec) parts.push(`${label} ${Math.round(window.utilization * 100)}%`);
  }
  return parts.length > 0 ? parts.join(" · ") : UNKNOWN;
}

const HEADERS = ["lane", "state", "attempt", "elapsed", "turns", "calls", "last tool", "effort", "failed", "cost", "quota"];

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
    formatCost(row.costUsd, row.costDeltaUsd),
    formatWindows(row.fiveHour, row.sevenDay, nowSec),
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
