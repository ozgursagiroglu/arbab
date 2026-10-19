// Small DOM helpers the HUD components share. They take the document as a parameter, like everything in app/.
import type { CanvasElementLike, DocumentLike, ElementLike } from "../browser";

/** An element with a class and, optionally, its text. */
export function make(doc: DocumentLike, tag: string, className = "", text: string | null = null): ElementLike {
  const el = doc.createElement(tag);
  if (className !== "") el.className = className;
  if (text !== null) el.textContent = text;
  return el;
}

export function asCanvas(element: ElementLike | null): CanvasElementLike | null {
  return element && typeof (element as Partial<CanvasElementLike>).getContext === "function" ? (element as CanvasElementLike) : null;
}

/** `max(1, round(devicePixelRatio))`: canvases are drawn at whole device pixels. */
export function devicePixels(ratio: number): number {
  return Number.isFinite(ratio) ? Math.max(1, Math.round(ratio)) : 1;
}

/** A canvas sized `cssW` × `cssH` CSS px at `dpr` device pixels each, hidden from assistive technology. */
export function makeCanvas(doc: DocumentLike, cssW: number, cssH: number, dpr: number, className = "px"): CanvasElementLike | null {
  const canvas = asCanvas(doc.createElement("canvas"));
  if (!canvas) return null;
  canvas.className = className;
  canvas.setAttribute("aria-hidden", "true");
  sizeCanvas(canvas, cssW, cssH, dpr);
  return canvas;
}

export function sizeCanvas(canvas: CanvasElementLike, cssW: number, cssH: number, dpr: number): void {
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
}

/** The indices (into `positions`) of a longest increasing subsequence of `positions` over `indices`. */
function increasing(positions: readonly number[], indices: readonly number[]): number[] {
  const tails: number[] = [];
  const prev = new Map<number, number>();
  for (const i of indices) {
    const p = positions[i] ?? 0;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((positions[tails[mid] ?? 0] ?? 0) < p) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev.set(i, tails[lo - 1] ?? -1);
    tails[lo] = i;
  }
  const out: number[] = [];
  for (let i = tails[tails.length - 1]; i !== undefined && i >= 0; i = prev.get(i)) out.push(i);
  return out;
}

/**
 * The moves that turn the order `current` into `next`: the items already in order (a longest increasing subsequence
 * of their old positions) stay put, every other one goes before its successor (null: at the end). `keep` (the focused
 * item) is always among those that stay, so it never moves and keeps its focus.
 */
export function planMoves(current: readonly string[], next: readonly string[], keep: string | null = null): { key: string; before: string | null }[] {
  const at = new Map(current.map((key, i) => [key, i]));
  const positions = next.map((key) => at.get(key) ?? -1);
  const existing = next.map((_, i) => i).filter((i) => (positions[i] ?? -1) >= 0);
  const k = keep === null ? -1 : next.indexOf(keep);
  const kp = positions[k] ?? -1;
  let stayed: number[];
  if (k < 0 || kp < 0) {
    stayed = increasing(positions, existing);
  } else {
    // The longest run in order before it and after it, around it.
    const before = existing.filter((i) => i < k && (positions[i] ?? 0) < kp);
    const after = existing.filter((i) => i > k && (positions[i] ?? 0) > kp);
    stayed = [...increasing(positions, before), k, ...increasing(positions, after)];
  }
  const stay = new Set(stayed);
  const moves: { key: string; before: string | null }[] = [];
  for (let i = next.length - 1; i >= 0; i--) {
    if (stay.has(i)) continue;
    moves.push({ key: next[i] ?? "", before: next[i + 1] ?? null });
  }
  return moves;
}

/**
 * Puts `parent`'s keyed children in the order `next`: removes those not in it, then inserts or moves only the ones
 * out of order. Returns the new order, which the caller keeps for the next call.
 */
export function reorder(
  parent: ElementLike,
  current: readonly string[],
  next: readonly string[],
  elementOf: (key: string) => ElementLike | undefined,
  focused: string | null = null,
): string[] {
  const keep = new Set(next);
  const left = current.filter((key) => {
    if (keep.has(key)) return true;
    elementOf(key)?.remove();
    return false;
  });
  for (const { key, before } of planMoves(left, next, focused)) {
    const el = elementOf(key);
    if (!el) continue;
    parent.insertBefore(el, before === null ? null : (elementOf(before) ?? null));
  }
  return [...next];
}
