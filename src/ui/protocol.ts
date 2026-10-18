// What `arbab ui` sends its page (DESIGN.md §19): one UiSnapshot per server-sent `snapshot` event. The server builds
// it from the registry (src/ui/server); the page (src/ui/client) only reads it. Both sides import these types, so a
// change here is a change to both.
import type { EndState, HoldDecision, LaneState, QuotaWindow, Role } from "../types";

export const UI_PROTOCOL = 1;

/** The server's routes. The page and its assets are public code; the data routes need the session token. */
export const UI_ROUTES = {
  page: "/",
  script: "/app.js",
  style: "/app.css",
  events: "/events",
  snapshot: "/snapshot.json",
} as const;

/**
 * The session token travels as `?token=<hex>` on the data routes and as `#token=<hex>` in the page URL `arbab ui`
 * prints: a fragment never reaches a server, a log or a Referer.
 */
export const UI_TOKEN_PARAM = "token";

/** The SSE event names: a snapshot, or a problem the page shows in a banner (`data` is `{"message": string}`). */
export const UI_EVENTS = { snapshot: "snapshot", problem: "problem" } as const;

/** The page, its stylesheet and its script, served from memory (never from disk). */
export interface UiAssets {
  html: string;
  css: string;
  js: string;
}

/**
 * What a lane is to the scene: one of the project's own lanes, a lane `verify` or `review` generated, or a probe
 * `arbab preflight` generated.
 */
export type UiLaneKind = "lane" | "verify" | "review" | "skeptic" | "preflight";

export interface UiLane {
  name: string;
  role: Role;
  kind: UiLaneKind;
  /** The integration that generated this lane, or the newest one that merged it; null when none did. */
  integration: string | null;
  /** The lane whose worktree this one works in (lane field `worktree`); null when it has its own. */
  worktreeOf: string | null;
  /** The effective state: a lane whose shepherd died is "orphaned". */
  state: LaneState;
  endState: EndState | null;
  /** Why a held lane waits: no free machine-wide slot, or the account quota; null unless held. */
  hold: "slot" | "quota" | null;
  /** state.json `reason` (a hold, a setup failure), cut to 200 characters; null when there is none. */
  reason: string | null;
  /** Epoch seconds at which a held or waiting lane checks again; null when none. */
  until: number | null;
  attempt: number;
  /**
   * The lane's place in the build order (ISO): its first attempt's start, else its shepherd's start, else its state's
   * `since`.
   */
  firstSeen: string;
  /** When the lane entered its current state (state.json `since`, ISO). The page counts live elapsed time from it. */
  since: string;
  /** A finished run's wall clock; null while the run is live (the page counts from `since`). */
  elapsedMs: number | null;
  /** Tool calls of the current attempt, counted from its stream while it runs. */
  toolCalls: number;
  /** The last tool called, when the name looks like a tool name (`^[A-Za-z0-9_.:-]{1,64}$`); null otherwise. */
  lastTool: string | null;
  turns: number;
  failedTotal: number;
  /** Session-cumulative cost after the newest attempt that has a summary; null while unknown. */
  costUsd: number | null;
  /** That attempt's own share. */
  costDeltaUsd: number | null;
  model: string | null;
  /** The effort most transcript entries carried; null while unknown. */
  effort: string | null;
  /** The latest attempt's report status (implementer and verifier); null when it has none. */
  reportStatus: "done" | "partial" | "blocked" | null;
  /** The newest reviewer report's finding count; null for other roles or without a report. */
  findings: number | null;
}

export interface UiIntegration {
  name: string;
  /** The merged lanes, in the order first integrated. */
  lanes: string[];
  headSha: string;
  updatedAt: string;
  /** verify.json for the current head; null when verify did not run on it. */
  verify: "passed" | "failed" | null;
  /** review.json for the current head; null when no review ran on it. */
  review: { lenses: number; confirmed: number; refuted: number; unverified: number } | null;
  /** readiness.json for the current head; null when there is none for it. */
  ready: boolean | null;
  /** landing.json `landedAt`; null until landed. */
  landedAt: string | null;
}

export interface UiQuota {
  /** The snapshot's status ("allowed", "rejected", …); null when there is no snapshot. */
  status: string | null;
  fiveHour: QuotaWindow | null;
  sevenDay: QuotaWindow | null;
  observedAt: string | null;
  hold: HoldDecision;
  holdAbove: { fiveHour: number; sevenDay: number };
}

export interface UiSnapshot {
  protocol: typeof UI_PROTOCOL;
  /** The arbab version serving the page. */
  version: string;
  /** The project root's directory name. */
  project: string;
  /** The server's clock (ISO) when it built this snapshot. */
  now: string;
  /** The lanes in the window (DESIGN.md §19), by firstSeen (oldest first), then name. */
  lanes: UiLane[];
  /** Lanes the window or the cap left out. */
  hiddenLanes: number;
  /** Every integration not landed, and the five landed most recently; by updatedAt (oldest first). */
  integrations: UiIntegration[];
  quota: UiQuota;
  /** config.maxParallel. */
  maxParallel: number;
}
