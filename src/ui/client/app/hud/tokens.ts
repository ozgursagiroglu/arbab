// The page's colors (DESIGN.md §19, the game-studio pass). PAGE_CSS writes them as CSS variables and the canvases
// (pixel text, icons, avatars) draw with the same hex values: a canvas cannot read a CSS variable.
import type { LaneState } from "../../../../types";

export const TOKENS = {
  bg: "#120d0a",
  "bg-2": "#1b140f",
  panel: "#241a12",
  "panel-2": "#2e2116",
  "panel-hi": "#3a2a1b",
  "frame-dark": "#0b0705",
  frame: "#6b4a26",
  "frame-hi": "#a87a3f",
  "frame-lo": "#3a2716",
  text: "#f4ead2",
  muted: "#b89f74",
  faint: "#7d6a4d",
  gold: "#ffd54a",
  "gold-2": "#e0a800",
  sand: "#e9c886",
  sky: "#5ba8d9",
  "st-running": "#5ba8d9",
  "st-preparing": "#8cc6e3",
  "st-waiting": "#e0a800",
  "st-asleep": "#8e7cc3",
  "st-success": "#3faf5a",
  "st-failed": "#d04040",
  "st-orphaned": "#85827a",
  /** The failed badge's ground: darker than st-failed, so light ink reads on it. */
  "badge-failed": "#b23a3a",
} as const;

export type Token = keyof typeof TOKENS;

/** The cast chips (and the avatar tiles' tint). */
export const CHIPS = {
  laborer: "#c9a46b",
  mason: "#3c6fb0",
  scribe: "#6e4c9e",
  skeptic: "#b23a3a",
  surveyor: "#3f8f5a",
  waterboy: "#e2b23a",
  scout: "#2f6b4f",
} as const;

/** Ink on a state badge: dark on every state color, which are all light enough for it, but the failed one. */
export const BADGE_INK = TOKENS.bg;

/** A badge's ground and ink: light ink on the failed badge's dark red, dark ink on the rest (4.5:1 or better). */
export function badgeColors(tone: BadgeTone): { ground: string; ink: string } {
  return tone === "failed" ? { ground: TOKENS["badge-failed"], ink: TOKENS.text } : { ground: toneColor(tone), ink: BADGE_INK };
}

export type BadgeTone = "running" | "preparing" | "waiting" | "asleep" | "success" | "failed" | "orphaned";

/** A lane's badge: its tone and its word. */
export function badgeOf(lane: { state: LaneState; endState: string | null }): { tone: BadgeTone; label: string } {
  switch (lane.state) {
    case "running":
      return { tone: "running", label: "RUNNING" };
    case "preparing":
      return { tone: "preparing", label: "PREPARING" };
    case "queued":
      return { tone: "waiting", label: "QUEUED" };
    case "held":
      return { tone: "waiting", label: "HELD" };
    case "waiting-reset":
      return { tone: "asleep", label: "ASLEEP" };
    case "orphaned":
      return { tone: "orphaned", label: "ORPHANED" };
    case "finished":
      return lane.endState === "success" ? { tone: "success", label: "✓ DONE" } : { tone: "failed", label: "✗ FAILED" };
    default:
      return { tone: "orphaned", label: String(lane.state).toUpperCase() };
  }
}

export function toneColor(tone: BadgeTone): string {
  return TOKENS[`st-${tone}`];
}
