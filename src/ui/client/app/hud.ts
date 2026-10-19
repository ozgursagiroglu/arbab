// What the DOM around the canvas says (DESIGN.md §19), as pure functions of a snapshot: main.ts only puts these
// strings into elements with textContent.
// registry/status, never the registry index: the index pulls node:fs into the bundle.
import { formatElapsed, formatWindows, isLive } from "../../../registry/status";
import type { LaneState } from "../../../types";
import type { UiLane, UiSnapshot } from "../../protocol";
import { UI_PROTOCOL } from "../../protocol";
import { HEIGHT, WIDTH } from "../model";

const UNKNOWN = "—";

/**
 * CSS px per art pixel: the largest scale that fits the stage and is a whole number of *device* pixels,
 * `floor(min(w / 480, h / 270) × dpr) / dpr`, so a dpr-2 screen also gets the half steps (2.5× is 5 device px). 0 when
 * nothing fits.
 */
export function computeScale(stageWidth: number, stageHeight: number, dpr: number): number {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const fit = Math.min(stageWidth / WIDTH, stageHeight / HEIGHT);
  if (!Number.isFinite(fit) || fit <= 0) return 0;
  return Math.floor(fit * ratio + 1e-9) / ratio;
}

/** How the canvas is sized: whole device pixels per art pixel, or, below 1×, the stage's width (pixelated). */
export type SceneSize = { fluid: false; scale: number; width: number; height: number } | { fluid: true };

/**
 * The scene's CSS size for a stage `stageWidth` wide with `stageHeight` to spare on the first screen. Below 1× it is
 * fluid when the stage is narrower than the art (a phone); a wide but short window keeps 1× and scrolls.
 */
export function sceneSize(stageWidth: number, stageHeight: number, dpr: number): SceneSize {
  const scale = computeScale(stageWidth, stageHeight, dpr);
  if (scale >= 1) return { fluid: false, scale, width: WIDTH * scale, height: HEIGHT * scale };
  if (Number.isFinite(stageWidth) && stageWidth >= WIDTH) return { fluid: false, scale: 1, width: WIDTH, height: HEIGHT };
  return { fluid: true };
}

/** The page's vertical spacing around the scene card that the elements' boxes do not include (hud padding, gaps, margins). */
export const PAGE_GAPS = 40;

/**
 * The stage height that keeps the whole scene card on the first screen: the viewport less the top bar, the KPI row,
 * the card's chrome (its height less its stage's) and the page's gaps.
 */
export function stageRoom(viewport: number, header: number, kpis: number, chrome: number): number {
  const room = viewport - header - kpis - chrome - PAGE_GAPS;
  return Number.isFinite(room) ? Math.max(0, room) : 0;
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

export interface Header {
  project: string;
  version: string;
  /** The text equivalent of the KPI row and the gauges, for the document title and tests. */
  counts: string;
  cost: string;
  quota: string;
  held: boolean;
  /** `Read-only · arbab 0.2.0 · 3 older lanes not shown` */
  footer: string;
}

export function header(snapshot: UiSnapshot): Header {
  const nowMs = Date.parse(snapshot.now);
  const nowSec = Number.isNaN(nowMs) ? 0 : nowMs / 1000;
  const hidden = snapshot.hiddenLanes > 0 ? ` · ${snapshot.hiddenLanes} older ${snapshot.hiddenLanes === 1 ? "lane" : "lanes"} not shown` : "";
  return {
    project: snapshot.project,
    version: `v${snapshot.version}`,
    counts: formatCounts(laneCounts(snapshot.lanes)),
    cost: formatUsd(totalCost(snapshot.lanes)),
    quota: formatWindows(snapshot.quota.fiveHour, snapshot.quota.sevenDay, nowSec),
    held: snapshot.quota.hold.hold === true,
    footer: `Read-only · arbab ${snapshot.version}${hidden}`,
  };
}

/** `running`, `held (quota)`, `finished (success)`. */
export function formatState(lane: Pick<UiLane, "state" | "endState" | "hold">): string {
  if (lane.state === "finished" && lane.endState) return `finished (${lane.endState})`;
  if (lane.state === "held" && lane.hold) return `held (${lane.hold})`;
  return lane.state;
}

/**
 * A finished run's wall clock; live from `since` by the server's clock only while the state is live. A finished or
 * orphaned lane without a wall clock has none: its clock stopped with the run.
 */
export function laneElapsedMs(lane: Pick<UiLane, "elapsedMs" | "since" | "state">, serverNowMs: number): number | null {
  if (lane.elapsedMs !== null) return lane.elapsedMs;
  if (!isLive(lane.state)) return null;
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

/** The order of lane states on the page, at work first: the crew's cards and the ledger's state column. */
export const STATE_RANK: Readonly<Record<LaneState, number>> = {
  running: 0,
  preparing: 1,
  "waiting-reset": 2,
  held: 3,
  queued: 4,
  orphaned: 5,
  finished: 6,
};

const STARTED: ReadonlySet<LaneState> = new Set<LaneState>(["preparing", "running"]);
const RESUMING: ReadonlySet<LaneState> = new Set<LaneState>(["preparing", "running", "waiting-reset"]);

/**
 * The lane started since the last snapshot: it is preparing or running, and was not already (a lane back from its
 * usage-limit sleep started before it slept). For the live region and the chronicle alike.
 */
export function startedSince(lane: Pick<UiLane, "state">, was: Pick<UiLane, "state"> | undefined): boolean {
  return STARTED.has(lane.state) && !(was !== undefined && RESUMING.has(was.state));
}

/** What the live region says about the change from one snapshot to the next; nothing for the first. */
export function announcements(prev: UiSnapshot | null, next: UiSnapshot): string[] {
  if (!prev) return [];
  const out: string[] = [];
  const before = new Map(prev.lanes.map((lane) => [lane.name, lane]));
  for (const lane of next.lanes) {
    const was = before.get(lane.name);
    // A lane coming back from its usage-limit sleep was already announced when it started.
    if (startedSince(lane, was)) out.push(`${lane.name} started`);
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
