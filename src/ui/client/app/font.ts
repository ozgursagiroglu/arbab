// The pixel font (DESIGN.md §19, the game-studio pass): glyphs drawn with fillRect, so the scene (nameplates, the
// monument's plaque) and the page's display text (titles, numbers) share one hand-made look without a font file.
// Contract stub: lane ui2-font replaces this file and keeps every export below.
import type { Canvas2D } from "./browser";

/** Font pixels above the baseline (capitals and digits are this tall). */
export const ASCENT = 7;
/** Font pixels below the baseline (g, j, p, q, y). */
export const DESCENT = 2;
/** A line's height in font pixels: ASCENT + DESCENT + 2 of leading. */
export const LINE_HEIGHT = 11;

/** Width in font pixels of `text` drawn at scale 1, letter spacing included (no trailing space). */
export function measureText(text: string): number {
  return Math.max(0, text.length * 6 - 1);
}

/**
 * Draws `text` with the top of its ascent at (x, y), each font pixel a `scale` × `scale` square of `color`, and
 * returns the width drawn in px. Characters the font lacks draw as a hollow box of the same width as "0".
 */
export function drawText(ctx: Canvas2D, text: string, x: number, y: number, color: string, scale = 1): number {
  void ctx;
  void x;
  void y;
  void color;
  return measureText(text) * scale;
}
