// Test-only builders for the scene: lanes, integrations and snapshots with sane defaults, and a seeded random.
import type { UiIntegration, UiLane, UiQuota, UiSnapshot } from "../../protocol";
import { UI_PROTOCOL } from "../../protocol";

export const T0 = "2026-10-18T12:00:00.000Z";

/** An ISO time `seconds` after T0 (negative: before). */
export function at(seconds: number): string {
  return new Date(Date.parse(T0) + seconds * 1000).toISOString();
}

export function uiLane(overrides: Partial<UiLane> = {}): UiLane {
  return {
    name: "lane-a",
    role: "implementer",
    kind: "lane",
    integration: null,
    worktreeOf: null,
    state: "queued",
    endState: null,
    hold: null,
    reason: null,
    until: null,
    attempt: 1,
    firstSeen: at(-3600),
    since: at(-60),
    elapsedMs: null,
    toolCalls: 0,
    lastTool: null,
    turns: 0,
    failedTotal: 0,
    costUsd: null,
    costDeltaUsd: null,
    model: null,
    effort: null,
    reportStatus: null,
    findings: null,
    ...overrides,
  };
}

/** A lane finished with `endState` (success by default). */
export function finishedLane(overrides: Partial<UiLane> = {}): UiLane {
  return uiLane({ state: "finished", endState: "success", reportStatus: "done", elapsedMs: 60_000, ...overrides });
}

export function uiIntegration(overrides: Partial<UiIntegration> = {}): UiIntegration {
  return {
    name: "int-a",
    lanes: [],
    headSha: "0000000000000000000000000000000000000000",
    updatedAt: at(-600),
    verify: null,
    review: null,
    ready: null,
    landedAt: null,
    ...overrides,
  };
}

export function uiQuota(overrides: Partial<UiQuota> = {}): UiQuota {
  return {
    status: "allowed",
    fiveHour: null,
    sevenDay: null,
    observedAt: null,
    hold: { hold: false, reason: null, until: null },
    holdAbove: { fiveHour: 0.9, sevenDay: 0.95 },
    ...overrides,
  };
}

export function uiSnapshot(overrides: Partial<UiSnapshot> = {}): UiSnapshot {
  return {
    protocol: UI_PROTOCOL,
    version: "0.1.0",
    project: "demo",
    now: T0,
    lanes: [],
    hiddenLanes: 0,
    integrations: [],
    quota: uiQuota(),
    maxParallel: 4,
    ...overrides,
  };
}

/** mulberry32: a small seeded PRNG, 0 ≤ r < 1. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
