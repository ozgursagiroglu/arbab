// What the DOM around the canvas says (DESIGN.md §19), as pure functions of a snapshot: main.ts only puts these
// strings into elements with textContent.
import { formatElapsed } from "../../../registry/status";
import type { QuotaWindow } from "../../../types";
import type { UiLane, UiQuota, UiSnapshot } from "../../protocol";
import { UI_PROTOCOL } from "../../protocol";
import { HEIGHT, WIDTH } from "../model";

const UNKNOWN = "—";

/** The largest integer scale that fits the stage's width and the window below the header; at least 1. */
export function computeScale(stageWidth: number, windowHeight: number, headerHeight: number): number {
  const byWidth = Math.floor(stageWidth / WIDTH);
  const byHeight = Math.floor((windowHeight - headerHeight) / HEIGHT);
  const scale = Math.min(byWidth, byHeight);
  return Number.isFinite(scale) && scale >= 1 ? scale : 1;
}

/** `#token=<hex>` from the page URL's fragment; null without a well-formed one. */
export function parseToken(hash: string): string | null {
  const match = /^#?(?:.*&)?token=([0-9a-fA-F]{8,128})(?:&.*)?$/.exec(hash);
  return match?.[1] ?? null;
}

export type Parsed = { ok: true; snapshot: UiSnapshot } | { ok: false; message: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A `snapshot` event's data: JSON, this page's protocol, and the fields the page reads. */
export function parseSnapshot(data: string): Parsed {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return { ok: false, message: "The server sent a snapshot that is not JSON." };
  }
  if (!isObject(value)) return { ok: false, message: "The server sent a snapshot that is not an object." };
  if (value.protocol !== UI_PROTOCOL) {
    return {
      ok: false,
      message: `This page speaks protocol ${UI_PROTOCOL} and the server speaks ${String(value.protocol)}: reload the page.`,
    };
  }
  if (!Array.isArray(value.lanes) || !Array.isArray(value.integrations) || !isObject(value.quota)) {
    return { ok: false, message: "The server sent a snapshot without lanes, integrations or quota." };
  }
  if (!value.lanes.every((lane) => isObject(lane) && typeof lane.name === "string" && typeof lane.state === "string")) {
    return { ok: false, message: "The server sent a lane without a name or state." };
  }
  return { ok: true, snapshot: value as unknown as UiSnapshot };
}

/** A `problem` event's message. */
export function parseProblem(data: string): string {
  try {
    const value: unknown = JSON.parse(data);
    if (isObject(value) && typeof value.message === "string" && value.message !== "") return value.message;
  } catch {
    // Fall through to the generic message.
  }
  return "The server reported a problem.";
}

export interface Counts {
  running: number;
  preparing: number;
  /** held and queued. */
  waiting: number;
  /** waiting-reset. */
  asleep: number;
  orphaned: number;
  succeeded: number;
  failed: number;
}

export function laneCounts(lanes: readonly UiLane[]): Counts {
  const counts: Counts = { running: 0, preparing: 0, waiting: 0, asleep: 0, orphaned: 0, succeeded: 0, failed: 0 };
  for (const lane of lanes) {
    switch (lane.state) {
      case "running":
        counts.running++;
        break;
      case "preparing":
        counts.preparing++;
        break;
      case "queued":
      case "held":
        counts.waiting++;
        break;
      case "waiting-reset":
        counts.asleep++;
        break;
      case "orphaned":
        counts.orphaned++;
        break;
      case "finished":
        if (lane.endState === "success") counts.succeeded++;
        else counts.failed++;
        break;
    }
  }
  return counts;
}

/** `2 running · 1 waiting · ✓ 4 ✗ 1`; parts that are zero are left out. */
export function formatCounts(counts: Counts): string {
  const parts: string[] = [];
  for (const [label, n] of [
    ["running", counts.running],
    ["preparing", counts.preparing],
    ["waiting", counts.waiting],
    ["asleep", counts.asleep],
    ["orphaned", counts.orphaned],
  ] as const) {
    if (n > 0) parts.push(`${n} ${label}`);
  }
  const done: string[] = [];
  if (counts.succeeded > 0) done.push(`✓ ${counts.succeeded}`);
  if (counts.failed > 0) done.push(`✗ ${counts.failed}`);
  if (done.length > 0) parts.push(done.join(" "));
  return parts.length > 0 ? parts.join(" · ") : "no lanes";
}

export function formatUsd(value: number | null): string {
  return value === null || !Number.isFinite(value) ? UNKNOWN : `$${value.toFixed(2)}`;
}

/** The session cost of every lane in the snapshot. */
export function totalCost(lanes: readonly UiLane[]): number {
  return lanes.reduce((sum, lane) => sum + (typeof lane.costUsd === "number" && Number.isFinite(lane.costUsd) ? lane.costUsd : 0), 0);
}

/** `5h 62% · 7d 40%`; windows that have already reset say nothing about now and are left out. */
export function formatQuota(quota: Pick<UiQuota, "fiveHour" | "sevenDay">, nowSec: number): string {
  const parts: string[] = [];
  for (const [label, window] of [
    ["5h", quota.fiveHour],
    ["7d", quota.sevenDay],
  ] as const satisfies readonly (readonly [string, QuotaWindow | null])[]) {
    if (window && window.resetsAt > nowSec) parts.push(`${label} ${Math.round(window.utilization * 100)}%`);
  }
  return parts.length > 0 ? parts.join(" · ") : UNKNOWN;
}

export interface Header {
  title: string;
  counts: string;
  cost: string;
  quota: string;
  held: boolean;
  hidden: string;
}

export function header(snapshot: UiSnapshot): Header {
  const nowMs = Date.parse(snapshot.now);
  const nowSec = Number.isNaN(nowMs) ? 0 : nowMs / 1000;
  return {
    title: `${snapshot.project} · ${snapshot.version}`,
    counts: formatCounts(laneCounts(snapshot.lanes)),
    cost: formatUsd(totalCost(snapshot.lanes)),
    quota: formatQuota(snapshot.quota, nowSec),
    held: snapshot.quota.hold.hold === true,
    hidden: snapshot.hiddenLanes > 0 ? `${snapshot.hiddenLanes} older lanes are not shown.` : "",
  };
}

/** `running`, `held (quota)`, `finished (success)`. */
export function formatState(lane: Pick<UiLane, "state" | "endState" | "hold">): string {
  if (lane.state === "finished" && lane.endState) return `finished (${lane.endState})`;
  if (lane.state === "held" && lane.hold) return `held (${lane.hold})`;
  return lane.state;
}

/** A finished run's wall clock, else live from `since` by the server's clock. */
export function laneElapsedMs(lane: Pick<UiLane, "elapsedMs" | "since">, serverNowMs: number): number | null {
  if (lane.elapsedMs !== null) return lane.elapsedMs;
  const since = Date.parse(lane.since);
  return Number.isNaN(since) ? null : Math.max(0, serverNowMs - since);
}

/**
 * The tooltip's lines. `offsetMs` is the server's clock minus the client's when the snapshot came, so the elapsed time
 * counts on between snapshots.
 */
export function tooltipLines(lane: UiLane, clientNowMs: number, offsetMs: number): string[] {
  const elapsed = laneElapsedMs(lane, clientNowMs + offsetMs);
  const lines = [
    lane.name,
    `${lane.role} · ${lane.kind}`,
    formatState(lane),
    `attempt ${lane.attempt}`,
    `elapsed ${elapsed === null ? UNKNOWN : formatElapsed(elapsed)}`,
    `tool calls ${lane.toolCalls}`,
    `last tool ${lane.lastTool ?? UNKNOWN}`,
    `cost ${formatUsd(lane.costUsd)}`,
    `${lane.model ?? UNKNOWN} · ${lane.effort ?? UNKNOWN}`,
  ];
  if (lane.hold) lines.push(`held for ${lane.hold === "quota" ? "the quota" : "a free slot"}`);
  if (lane.reason) lines.push(lane.reason);
  return lines;
}

/** One row of the lanes table: lane, role, state, end state, attempt, calls, cost. */
export function tableRow(lane: UiLane): string[] {
  return [lane.name, lane.role, lane.state, lane.endState ?? UNKNOWN, String(lane.attempt), String(lane.toolCalls), formatUsd(lane.costUsd)];
}

/** The lanes in the crew list: every lane not finished. */
export function crew(snapshot: UiSnapshot): UiLane[] {
  return snapshot.lanes.filter((lane) => lane.state !== "finished");
}

const STARTED = new Set(["preparing", "running"]);
const RESUMING = new Set(["preparing", "running", "waiting-reset"]);

/** What the live region says about the change from one snapshot to the next; nothing for the first. */
export function announcements(prev: UiSnapshot | null, next: UiSnapshot): string[] {
  if (!prev) return [];
  const out: string[] = [];
  const before = new Map(prev.lanes.map((lane) => [lane.name, lane]));
  for (const lane of next.lanes) {
    const was = before.get(lane.name);
    // A lane coming back from its usage-limit sleep was already announced when it started.
    if (STARTED.has(lane.state) && !(was && RESUMING.has(was.state))) out.push(`${lane.name} started`);
    if (lane.state === "finished" && was && was.state !== "finished") out.push(`${lane.name} finished: ${lane.endState ?? "unknown"}`);
  }
  const landed = new Set(prev.integrations.filter((i) => i.landedAt !== null).map((i) => i.name));
  for (const integration of next.integrations) {
    if (integration.landedAt !== null && !landed.has(integration.name) && prev.integrations.some((i) => i.name === integration.name)) {
      out.push(`${integration.name} landed`);
    }
  }
  return out;
}
