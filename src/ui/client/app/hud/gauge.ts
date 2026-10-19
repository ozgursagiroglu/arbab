// The top bar's quota gauges (DESIGN.md §19): a stepped bar per window with a tick at its hold threshold.
import type { QuotaWindow } from "../../../../types";
import type { DocumentLike, ElementLike } from "../browser";
import { make } from "./dom";
import { createPixelText } from "./pixel-text";
import { TOKENS } from "./tokens";

export const GAUGE_W = 96;
/** The bar fills in steps of this many px (CSS draws the gaps). */
export const GAUGE_STEP = 4;
/** From here on a window shows amber. */
export const WARN_AT = 0.7;

export type GaugeLevel = "ok" | "warn" | "hold";

/** Sand under 70%, amber from 70%, red at or above the hold threshold. */
export function gaugeLevel(utilization: number, holdAbove: number): GaugeLevel {
  if (utilization >= holdAbove) return "hold";
  return utilization >= WARN_AT ? "warn" : "ok";
}

export const LEVEL_COLORS: Readonly<Record<GaugeLevel, string>> = {
  ok: TOKENS.sand,
  warn: TOKENS["gold-2"],
  hold: TOKENS["st-failed"],
};

/** `2h 05m`, `45m`, `3d 04h`; under a minute `<1m`. */
export function formatReset(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const two = (n: number): string => String(n).padStart(2, "0");
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${two(h)}h`;
  if (h > 0) return `${h}h ${two(m)}m`;
  return m > 0 ? `${m}m` : "<1m";
}

export interface GaugeView {
  /** `62%`, or `—` without a current reading. */
  percent: string;
  /** The filled width in px, a whole number of steps. */
  fill: number;
  /** The tick's left edge in px. */
  tick: number;
  level: GaugeLevel;
  title: string;
}

export function gaugeView(label: string, window: QuotaWindow | null, holdAbove: number, nowSec: number): GaugeView {
  const tick = Math.max(0, Math.min(GAUGE_W - 1, Math.round(holdAbove * GAUGE_W)));
  const threshold = `hold at ${Math.round(holdAbove * 100)}%`;
  // A window that already reset says nothing about now.
  if (!window || !Number.isFinite(window.utilization) || window.resetsAt <= nowSec) {
    return { percent: "—", fill: 0, tick, level: "ok", title: `${label} window: no current reading · ${threshold}` };
  }
  const u = Math.max(0, Math.min(1, window.utilization));
  const steps = GAUGE_W / GAUGE_STEP;
  const fill = Math.min(steps, Math.ceil(u * steps)) * GAUGE_STEP;
  const percent = `${Math.round(window.utilization * 100)}%`;
  return {
    percent,
    fill,
    tick,
    level: gaugeLevel(window.utilization, holdAbove),
    title: `${label} window ${percent} · resets in ${formatReset(window.resetsAt - nowSec)} · ${threshold}`,
  };
}

export interface Gauge {
  update(view: GaugeView): void;
}

/** Fills `root` (an element of the page) with the label, the bar and the percentage. */
export function mountGauge(doc: DocumentLike, root: ElementLike, label: string, dpr: number): Gauge {
  const name = createPixelText(doc, { scale: 1, color: TOKENS.muted, dpr, className: "gauge-label" }, label.toUpperCase());
  const bar = make(doc, "span", "gauge-bar");
  const fill = make(doc, "span", "gauge-fill");
  const tick = make(doc, "span", "gauge-tick");
  bar.appendChild(fill);
  bar.appendChild(tick);
  const percent = createPixelText(doc, { scale: 1, color: TOKENS.sand, dpr, className: "gauge-pct" });
  root.replaceChildren(name.el, bar, percent.el);
  return {
    update(view) {
      root.setAttribute("title", view.title);
      root.setAttribute("data-level", view.level);
      fill.style.width = `${view.fill}px`;
      tick.style.left = `${view.tick}px`;
      percent.set(view.percent, view.percent === "—" ? TOKENS.muted : LEVEL_COLORS[view.level]);
    },
  };
}
