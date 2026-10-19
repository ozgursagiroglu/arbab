// The KPI row (DESIGN.md §19): five framed cards, each a pixel icon, a big pixel-font number that counts to its new
// value, and a label.
import type { UiSnapshot } from "../../../protocol";
import type { DocumentLike, ElementLike } from "../browser";
import { measureText } from "../font";
import { laneCounts, totalCost } from "../hud";
import { make } from "./dom";
import type { IconName } from "./icons";
import { createIcon } from "./icons";
import type { PixelText } from "./pixel-text";
import { createPixelText } from "./pixel-text";
import { TOKENS } from "./tokens";

/** How long a number counts to its new value. */
export const COUNT_MS = 600;
/** The widest a number may be, in CSS px, before it steps down a scale. */
export const NUMBER_MAX_W = 136;

export interface KpiValues {
  /** running and preparing. */
  atWork: number;
  /** queued and held. */
  waiting: number;
  /** waiting-reset. */
  asleep: number;
  succeeded: number;
  failed: number;
  /** The cost of the lanes in view, in USD. */
  treasury: number;
}

export function kpiValues(snapshot: UiSnapshot): KpiValues {
  const c = laneCounts(snapshot.lanes);
  return {
    atWork: c.running + c.preparing,
    waiting: c.waiting,
    asleep: c.asleep,
    succeeded: c.succeeded,
    failed: c.failed,
    treasury: totalCost(snapshot.lanes),
  };
}

function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** The value `elapsedMs` into a count from `from` to `to`, easing out; `to` once the count is over. */
export function countAt(from: number, to: number, elapsedMs: number, durationMs = COUNT_MS): number {
  if (!(elapsedMs < durationMs) || durationMs <= 0) return to;
  const t = Math.max(0, elapsedMs / durationMs);
  return from + (to - from) * easeOut(t);
}

export interface Counter {
  /** Starts a count from what shows now to `target`; at once with reduced motion. */
  set(target: readonly number[], nowMs: number): void;
  value(nowMs: number): number[];
}

export function createCounter(reducedMotion: boolean, durationMs = COUNT_MS): Counter {
  let from: number[] = [];
  let to: number[] = [];
  let start = 0;
  const value = (nowMs: number): number[] => to.map((v, i) => countAt(from[i] ?? 0, v, nowMs - start, durationMs));
  return {
    set(target, nowMs) {
      if (target.length === to.length && target.every((v, i) => v === to[i])) return;
      const shown = value(nowMs);
      from = reducedMotion ? [...target] : target.map((_, i) => shown[i] ?? 0);
      to = [...target];
      start = nowMs;
    },
    value,
  };
}

/** 4, or less when the text would be wider than a card holds. */
export function kpiScale(text: string): number {
  const w = measureText(text);
  if (w * 4 <= NUMBER_MAX_W) return 4;
  return w * 3 <= NUMBER_MAX_W ? 3 : 2;
}

interface CardSpec {
  key: string;
  label: string;
  icon: IconName;
  values: (v: KpiValues) => number[];
  format: (n: readonly number[]) => string;
  color: string;
}

const whole = (n: number | undefined): number => Math.round(n ?? 0);

export const KPI_CARDS: readonly CardSpec[] = [
  { key: "at-work", label: "AT WORK", icon: "hammer", values: (v) => [v.atWork], format: (n) => String(whole(n[0])), color: TOKENS.text },
  { key: "waiting", label: "WAITING", icon: "hourglass", values: (v) => [v.waiting], format: (n) => String(whole(n[0])), color: TOKENS.text },
  { key: "asleep", label: "ASLEEP", icon: "zzz", values: (v) => [v.asleep], format: (n) => String(whole(n[0])), color: TOKENS.text },
  {
    key: "finished",
    label: "FINISHED",
    icon: "check",
    values: (v) => [v.succeeded, v.failed],
    format: (n) => `✓${whole(n[0])} ✗${whole(n[1])}`,
    color: TOKENS.text,
  },
  { key: "treasury", label: "TREASURY", icon: "coin", values: (v) => [v.treasury], format: (n) => `$${(n[0] ?? 0).toFixed(2)}`, color: TOKENS.gold },
];

/** The text a card shows for its values, and whether it is all zeros (shown muted). */
export function kpiText(spec: CardSpec, values: readonly number[]): { text: string; zero: boolean } {
  const text = spec.format(values);
  return { text, zero: !/[1-9]/.test(text) };
}

export interface KpiRow {
  update(snapshot: UiSnapshot, nowMs: number): void;
  /** Draws the counts at `nowMs`; call it every frame. */
  tick(nowMs: number): void;
}

interface Card {
  spec: CardSpec;
  counter: Counter;
  number: PixelText;
  li: ElementLike;
}

export function mountKpis(doc: DocumentLike, list: ElementLike, options: { dpr: number; reducedMotion: boolean }): KpiRow {
  const cards: Card[] = KPI_CARDS.map((spec) => {
    const li = make(doc, "li", "kpi frame");
    li.setAttribute("data-kpi", spec.key);
    const icon = createIcon(doc, spec.icon, 2, options.dpr, 16);
    const number = createPixelText(doc, { scale: 4, color: TOKENS.muted, dpr: options.dpr, className: "kpi-number" });
    const label = createPixelText(doc, { scale: 1, color: TOKENS.muted, dpr: options.dpr, className: "kpi-label" }, spec.label);
    if (icon) li.appendChild(icon);
    li.appendChild(number.el);
    li.appendChild(label.el);
    return { spec, counter: createCounter(options.reducedMotion), number, li };
  });
  list.replaceChildren(...cards.map((c) => c.li));
  const draw = (card: Card, nowMs: number): void => {
    const { text, zero } = kpiText(card.spec, card.counter.value(nowMs));
    card.li.setAttribute("data-zero", String(zero));
    card.number.set(text, zero ? TOKENS.muted : card.spec.color, kpiScale(text));
  };
  return {
    update(snapshot, nowMs) {
      const values = kpiValues(snapshot);
      for (const card of cards) {
        card.counter.set(card.spec.values(values), nowMs);
        draw(card, nowMs);
      }
    },
    tick(nowMs) {
      for (const card of cards) draw(card, nowMs);
    },
  };
}
