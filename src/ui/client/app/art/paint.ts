// The renderer's tools (DESIGN.md §19): one painter that rounds, clips, shifts (the camera shake) and recolors (dusk and
// night) every rectangle, and a pixel buffer that static layers are drawn into once and kept as run lists, so a frame
// pays for each layer's runs and nothing else.
import { HEIGHT, WIDTH } from "../../model";
import type { Canvas2D } from "../browser";
import { drawText } from "../font";
import { mix } from "../palette";
import type { Sprite } from "../sprites";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface Painter {
  rect(x: number, y: number, w: number, h: number, color: string): void;
  rects(list: readonly Rect[], dx?: number, dy?: number): void;
  sprite(sprite: Sprite, left: number, top: number, mirror?: boolean): void;
  alpha(value: number): void;
  /** Recolors what follows (dusk and night light), or stops recoloring with null. */
  tint(map: ((color: string) => string) | null): void;
  /** Shifts what follows by whole pixels: the camera shake. */
  offset(dx: number, dy: number): void;
  /** Pixel-font text with the top of its ascent at (x, y), recolored like rects; the caller keeps it on the canvas. */
  text(text: string, x: number, y: number, color: string): number;
}

export function painter(ctx: Canvas2D): Painter {
  let current = "";
  let recolor: ((color: string) => string) | null = null;
  let ox = 0;
  let oy = 0;
  const rect = (x: number, y: number, w: number, h: number, original: string): void => {
    const color = recolor ? recolor(original) : original;
    let x0 = Math.round(x) + ox;
    let y0 = Math.round(y) + oy;
    let x1 = x0 + Math.round(w);
    let y1 = y0 + Math.round(h);
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(WIDTH, x1);
    y1 = Math.min(HEIGHT, y1);
    if (x1 <= x0 || y1 <= y0) return;
    if (color !== current) {
      ctx.fillStyle = color;
      current = color;
    }
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  };
  return {
    rect,
    rects(list, dx = 0, dy = 0) {
      for (const r of list) rect(r.x + dx, r.y + dy, r.w, r.h, r.color);
    },
    sprite(sprite, left, top, mirror = false) {
      for (const run of mirror ? sprite.mirrored : sprite.runs) rect(left + run.x, top + run.y, run.w, 1, run.color);
    },
    alpha(value) {
      ctx.globalAlpha = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1));
    },
    tint(map) {
      recolor = map;
    },
    offset(dx, dy) {
      ox = Number.isFinite(dx) ? Math.round(dx) : 0;
      oy = Number.isFinite(dy) ? Math.round(dy) : 0;
    },
    text(text, x, y, original) {
      const color = recolor ? recolor(original) : original;
      // drawText sets fillStyle itself.
      current = color;
      return drawText(ctx, text, Math.round(x) + ox, Math.round(y) + oy, color, 1);
    },
  };
}

type Phase = "day" | "dusk" | "night";

/** The light of each phase on the land: none by day, warm at dusk, a dark moonlit blue at night. */
const LIGHT: Readonly<Record<Phase, { color: string; amount: number } | null>> = {
  day: null,
  dusk: { color: "#B04A64", amount: 0.3 },
  night: { color: "#16286A", amount: 0.58 },
};

const tintCache = new Map<Phase, (color: string) => string>();

/** The phase's light as a recoloring (null by day), memoized per color. */
export function lightOf(phase: Phase): ((color: string) => string) | null {
  const light = LIGHT[phase];
  if (!light) return null;
  let fn = tintCache.get(phase);
  if (!fn) {
    const table = new Map<string, string>();
    fn = (color) => {
      let out = table.get(color);
      if (out === undefined) {
        out = mix(color, light.color, light.amount);
        table.set(color, out);
      }
      return out;
    };
    tintCache.set(phase, fn);
  }
  return fn;
}

/** A small deterministic PRNG (mulberry32): the same seed gives the same sequence. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BAYER: readonly (readonly number[])[] = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** The ordered-dither threshold of a pixel, 0–15. */
export function bayer(x: number, y: number): number {
  return BAYER[y & 3]?.[x & 3] ?? 0;
}

/** Whether a pixel is lit in an ordered dither of `density` (0–1). */
export function dithered(x: number, y: number, density: number): boolean {
  return bayer(x, y) < density * 16;
}

/** Seconds as a finite, non-negative clock. */
export function clock(time: number): number {
  return Number.isFinite(time) && time > 0 ? time : 0;
}

/** The positive remainder: wraps a position around a loop of `length`. */
export function wrap(value: number, length: number): number {
  return ((value % length) + length) % length;
}

/**
 * A pixel buffer for static art: drawn once, then turned into runs. A row's most fragmented color is laid under the
 * whole opaque stretch as one rect, so a dithered row costs one rect plus its dither pixels.
 */
export class Pixmap {
  readonly width: number;
  readonly height: number;
  private readonly cells: Int32Array;
  private readonly palette: string[] = [];
  private readonly index = new Map<string, number>();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.cells = new Int32Array(width * height).fill(-1);
  }

  set(x: number, y: number, color: string): void {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    let i = this.index.get(color);
    if (i === undefined) {
      i = this.palette.length;
      this.palette.push(color);
      this.index.set(color, i);
    }
    this.cells[py * this.width + px] = i;
  }

  get(x: number, y: number): string | null {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    const i = this.cells[y * this.width + x] ?? -1;
    return i < 0 ? null : (this.palette[i] ?? null);
  }

  fill(x: number, y: number, w: number, h: number, color: string): void {
    for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) this.set(px, py, color);
  }

  /** Runs, top to bottom, optionally recolored; `dx`, `dy` place the buffer on the canvas. */
  runs(recolor: ((color: string) => string) | null = null, dx = 0, dy = 0): Rect[] {
    const out: Rect[] = [];
    const color = (i: number): string => {
      const c = this.palette[i] ?? "#000000";
      return recolor ? recolor(c) : c;
    };
    for (let y = 0; y < this.height; y++) {
      const row = y * this.width;
      let x = 0;
      while (x < this.width) {
        if ((this.cells[row + x] ?? -1) < 0) {
          x++;
          continue;
        }
        // One opaque stretch [x, end).
        let end = x;
        while (end < this.width && (this.cells[row + end] ?? -1) >= 0) end++;
        const counts = new Map<number, number>();
        for (let k = x; k < end; k++) {
          const c = this.cells[row + k] ?? -1;
          if (k === x || this.cells[row + k - 1] !== c) counts.set(c, (counts.get(c) ?? 0) + 1);
        }
        let under = -1;
        let most = 1;
        for (const [c, n] of counts) {
          if (n > most) {
            most = n;
            under = c;
          }
        }
        if (under >= 0) out.push({ x: x + dx, y: y + dy, w: end - x, h: 1, color: color(under) });
        let k = x;
        while (k < end) {
          const c = this.cells[row + k] ?? -1;
          if (c === under) {
            k++;
            continue;
          }
          let stop = k + 1;
          while (stop < end && this.cells[row + stop] === c) stop++;
          out.push({ x: k + dx, y: y + dy, w: stop - k, h: 1, color: color(c) });
          k = stop;
        }
        x = end;
      }
    }
    return out;
  }
}

/** A filled disc, as one rect per row. */
export function disc(out: Rect[], cx: number, cy: number, r: number, color: string): void {
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.floor(Math.sqrt((r + 0.5) ** 2 - dy * dy));
    out.push({ x: cx - half, y: cy + dy, w: half * 2 + 1, h: 1, color });
  }
}

/** A ring between radii r0 and r1 of pixels lit by an ordered dither of `density`, around (cx, cy). */
export function ditherRing(out: Rect[], cx: number, cy: number, r0: number, r1: number, density: number, color: string): void {
  for (let dy = -r1; dy <= r1; dy++) {
    for (let dx = -r1; dx <= r1; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < r0 - 0.5 || d > r1 + 0.5) continue;
      // Thinner toward the outside.
      const t = r1 === r0 ? 1 : 1 - (d - r0) / (r1 - r0 + 1);
      if (dithered(cx + dx, cy + dy, density * t)) out.push({ x: cx + dx, y: cy + dy, w: 1, h: 1, color });
    }
  }
}

/**
 * A soft ellipse centered between pixels x0 − 1 and x0 (an even width, so it mirrors with the sprites): solid rows
 * of half-width rx and a dithered rim, symmetric left to right.
 */
export function softEllipse(rx: number, ry: number): { dx: number; dy: number; w: number }[] {
  const out: { dx: number; dy: number; w: number }[] = [];
  for (let dy = -ry; dy <= ry; dy++) {
    const t = ry === 0 ? 0 : dy / (ry + 0.5);
    const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - t * t)));
    if (half <= 0) continue;
    out.push({ dx: -half, dy, w: half * 2 });
    // One rim pixel each side, every other row: a dithered edge that mirrors.
    if ((dy & 1) === 0) {
      out.push({ dx: -half - 1, dy, w: 1 }, { dx: half, dy, w: 1 });
    }
  }
  return out;
}
