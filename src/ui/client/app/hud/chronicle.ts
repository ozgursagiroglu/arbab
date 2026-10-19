// The chronicle (DESIGN.md §19): what happened, newest first. Seeded from the first snapshot, then grown by each
// snapshot's changes. Pure: the panel only draws these entries.
import type { UiIntegration, UiLane, UiSnapshot } from "../../../protocol";
import { formatUsd } from "../hud";

export const CHRONICLE_MAX = 60;

export type ChronicleKind = "started" | "finished" | "failed" | "landed" | "verify-passed" | "verify-failed" | "held" | "waiting";

export interface ChronicleEntry {
  /** Stable across snapshots: the same happening never shows twice. */
  id: string;
  /** Epoch ms. */
  at: number;
  kind: ChronicleKind;
  text: string;
}

/** `just now`, `2m ago`, `11h ago`, `3d ago`. */
export function formatAgo(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function epochMs(iso: string | null, fallback: number): number {
  if (iso === null) return fallback;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : fallback;
}

function snapshotMs(s: UiSnapshot): number {
  return epochMs(s.now, 0);
}

function started(lane: UiLane, fallback: number): ChronicleEntry {
  const at = epochMs(lane.since, fallback);
  const attempt = lane.attempt > 1 ? ` (attempt ${lane.attempt})` : "";
  return { id: `started:${lane.name}:${lane.attempt}:${at}`, at, kind: "started", text: `${lane.name} started${attempt}` };
}

function finished(lane: UiLane, fallback: number): ChronicleEntry {
  const at = epochMs(lane.since, fallback);
  const end = lane.endState ?? "unknown";
  const cost = lane.costUsd === null ? "" : ` · ${formatUsd(lane.costUsd)}`;
  return {
    id: `finished:${lane.name}:${lane.attempt}:${at}`,
    at,
    kind: lane.endState === "success" ? "finished" : "failed",
    text: `${lane.name} finished: ${end}${cost}`,
  };
}

function waiting(lane: UiLane, fallback: number): ChronicleEntry {
  const at = epochMs(lane.since, fallback);
  if (lane.state === "held") {
    const why = lane.hold === "slot" ? "a free slot" : "the quota";
    return { id: `held:${lane.name}:${at}`, at, kind: lane.hold === "slot" ? "waiting" : "held", text: `${lane.name} held for ${why}` };
  }
  const what = lane.state === "waiting-reset" ? "asleep until the quota resets" : "queued";
  return { id: `waiting:${lane.name}:${lane.state}:${at}`, at, kind: "waiting", text: `${lane.name} ${what}` };
}

function landed(integration: UiIntegration, fallback: number): ChronicleEntry {
  return { id: `landed:${integration.name}`, at: epochMs(integration.landedAt, fallback), kind: "landed", text: `${integration.name} landed` };
}

function verified(integration: UiIntegration, at: number): ChronicleEntry {
  const passed = integration.verify === "passed";
  return {
    id: `verify:${integration.name}:${integration.headSha}:${integration.verify}`,
    at,
    kind: passed ? "verify-passed" : "verify-failed",
    text: `${integration.name} verify ${passed ? "passed" : "failed"}`,
  };
}

/** Newest first, at most `max`, each id once (the first seen wins). */
export function mergeChronicle(existing: readonly ChronicleEntry[], added: readonly ChronicleEntry[], max = CHRONICLE_MAX): ChronicleEntry[] {
  const seen = new Set<string>();
  const all: ChronicleEntry[] = [];
  for (const entry of [...added, ...existing]) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    all.push(entry);
  }
  // Stable: at a tie, what was added comes first.
  return all.sort((a, b) => b.at - a.at).slice(0, max);
}

/** The first snapshot as it stands: finishes, landings, and where each active lane is. */
export function seedChronicle(snapshot: UiSnapshot): ChronicleEntry[] {
  const now = snapshotMs(snapshot);
  const out: ChronicleEntry[] = [];
  for (const lane of snapshot.lanes) {
    if (lane.state === "finished") out.push(finished(lane, now));
    else if (lane.state === "running" || lane.state === "preparing") out.push(started(lane, now));
    else if (lane.state === "queued" || lane.state === "held" || lane.state === "waiting-reset") out.push(waiting(lane, now));
  }
  for (const integration of snapshot.integrations) if (integration.landedAt !== null) out.push(landed(integration, now));
  return mergeChronicle([], out);
}

const STARTED = new Set(["preparing", "running"]);
const RESUMING = new Set(["preparing", "running", "waiting-reset"]);

/** What changed from one snapshot to the next: starts, finishes, landings, verify results and quota holds. */
export function chronicleDiff(prev: UiSnapshot, next: UiSnapshot): ChronicleEntry[] {
  const now = snapshotMs(next);
  const out: ChronicleEntry[] = [];
  const before = new Map(prev.lanes.map((lane) => [lane.name, lane]));
  for (const lane of next.lanes) {
    const was = before.get(lane.name);
    // A lane back from its usage-limit sleep already started.
    if (STARTED.has(lane.state) && !(was && RESUMING.has(was.state))) out.push(started(lane, now));
    if (lane.state === "finished" && was && was.state !== "finished") out.push(finished(lane, now));
    if (lane.state === "held" && lane.hold === "quota" && !(was && was.state === "held" && was.hold === "quota")) out.push(waiting(lane, now));
  }
  const old = new Map(prev.integrations.map((i) => [i.name, i]));
  for (const integration of next.integrations) {
    const was = old.get(integration.name);
    if (integration.landedAt !== null && (!was || was.landedAt === null)) out.push(landed(integration, now));
    if (integration.verify !== null && (!was || was.verify !== integration.verify || was.headSha !== integration.headSha)) {
      out.push(verified(integration, now));
    }
  }
  return out;
}

/** The glyph a line starts with: the font's arrow, check and cross, and the icons' diamond and hourglass. */
export function glyphOf(kind: ChronicleKind): "→" | "✓" | "✗" | "◆" | "⏳" {
  switch (kind) {
    case "started":
      return "→";
    case "finished":
    case "verify-passed":
      return "✓";
    case "failed":
    case "verify-failed":
      return "✗";
    case "landed":
      return "◆";
    default:
      return "⏳";
  }
}
