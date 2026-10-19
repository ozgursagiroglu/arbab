// Draws a World (DESIGN.md §19) with solid rectangles and globalAlpha only, so the page and the PNG frames share it.
// It never changes the world. Everything goes through one clipping, rounding rect(); static layers are rect lists
// built once, so a frame's work follows what is on screen.
import type { Actor, Block, Bubble, Particle, Pyramid, Sky, World } from "../model";
import { HEIGHT, HORIZON_Y, PLACES, PYRAMID_AREA, WIDTH } from "../model";
import type { Canvas2D } from "./browser";
import {
  BUBBLE,
  COIN,
  DUNES,
  FALLEN,
  FLAG,
  FLASH,
  GOLD,
  LIMESTONE,
  MOON,
  MOON_SHADE,
  ORPHANED,
  OUTLINE,
  OUTLINE_EMPTY,
  OUTLINE_PLANNED,
  SAND,
  SKY,
  STAR,
  SUN,
  WOOD,
  desaturate,
  mix,
} from "./palette";
import type { Grid, Sprite } from "./sprites";
import { compileProp, createSpriteSet, GLYPHS, ICONS, MARKER, PROPS } from "./sprites";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

/** The ground line: ladders stand on it, and a worker above it works on a plank. */
export const GROUND_Y = PYRAMID_AREA.baseY + 2;

/** The sun's arc: a parabola through (40, 112), (240, 26) and (440, 112). */
export function sunPosition(sun: number): { x: number; y: number } {
  const t = Number.isFinite(sun) ? Math.min(1, Math.max(0, sun)) : 0.5;
  const x = 40 + 400 * t;
  return { x, y: 26 + (86 / 200 ** 2) * (x - 240) ** 2 };
}

export const MOON_AT = { x: 400, y: 30 } as const;

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

// ---------------------------------------------------------------------------------------------------------------
// The painter: rounds once, clips to the canvas, and sets fillStyle only when it changes.

interface Painter {
  rect(x: number, y: number, w: number, h: number, color: string): void;
  rects(list: readonly Rect[], dx?: number, dy?: number): void;
  sprite(sprite: Sprite, left: number, top: number, mirror?: boolean): void;
  alpha(value: number): void;
  /** Recolors what follows (dusk and night light), or stops recoloring with null. */
  tint(map: ((color: string) => string) | null): void;
}

function painter(ctx: Canvas2D): Painter {
  let current = "";
  let recolor: ((color: string) => string) | null = null;
  const rect = (x: number, y: number, w: number, h: number, original: string): void => {
    const color = recolor ? recolor(original) : original;
    let x0 = Math.round(x);
    let y0 = Math.round(y);
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
  };
}

/** The light of each phase on the land: none by day, warm at dusk, moonlit blue at night. */
const LIGHT: Readonly<Record<Sky["phase"], { color: string; amount: number } | null>> = {
  day: null,
  dusk: { color: SKY.dusk[1], amount: 0.2 },
  night: { color: SKY.night[1], amount: 0.48 },
};

const tintCache = new Map<Sky["phase"], Map<string, string>>();
function lightOf(phase: Sky["phase"]): ((color: string) => string) | null {
  const light = LIGHT[phase];
  if (!light) return null;
  let cache = tintCache.get(phase);
  if (!cache) {
    cache = new Map();
    tintCache.set(phase, cache);
  }
  const table = cache;
  return (color) => {
    let out = table.get(color);
    if (out === undefined) {
      out = mix(color, light.color, light.amount);
      table.set(color, out);
    }
    return out;
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Static layers

const SPRITES = createSpriteSet();
const propCache = new Map<Grid, Sprite>();
function prop(grid: Grid): Sprite {
  let sprite = propCache.get(grid);
  if (!sprite) {
    sprite = compileProp(grid);
    propCache.set(grid, sprite);
  }
  return sprite;
}

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

/** Rows y0..y1 shading from one color to the next through an ordered (Bayer) dither. */
function ditherBand(out: Rect[], y0: number, y1: number, from: string, to: string): void {
  const n = y1 - y0;
  for (let i = 0; i < n; i++) {
    const y = y0 + i;
    const t = (i + 0.5) / n;
    const [base, other, density] = t < 0.5 ? [from, to, t] : [to, from, 1 - t];
    out.push({ x: 0, y, w: WIDTH, h: 1, color: base });
    const row = BAYER[y % 4] ?? BAYER[0];
    for (let x = 0; x < WIDTH; x++) {
      if ((row[x % 4] ?? 0) < density * 16) out.push({ x, y, w: 1, h: 1, color: other });
    }
  }
}

/** Solid bands with dithered seams: `stops` are [y, color] from the top. */
function bands(stops: readonly [number, string][], end: number, seam: number): Rect[] {
  const out: Rect[] = [];
  for (let i = 0; i < stops.length; i++) {
    const [y, color] = stops[i] ?? [0, "#000000"];
    const next = stops[i + 1];
    const solidEnd = next ? next[0] - seam / 2 : end;
    const solidStart = i === 0 ? y : y + seam / 2;
    if (solidEnd > solidStart) out.push({ x: 0, y: solidStart, w: WIDTH, h: solidEnd - solidStart, color });
    if (next) ditherBand(out, next[0] - seam / 2, next[0] + seam / 2, color, next[1]);
  }
  return out;
}

const skyCache = new Map<Sky["phase"], Rect[]>();
function skyRects(phase: Sky["phase"]): Rect[] {
  let rects = skyCache.get(phase);
  if (!rects) {
    const [top, mid, low] = SKY[phase];
    rects = bands(
      [
        [0, top],
        [52, mid],
        [100, low],
      ],
      HORIZON_Y,
      16,
    );
    skyCache.set(phase, rects);
  }
  return rects;
}

function disc(out: Rect[], cx: number, cy: number, r: number, color: string): void {
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.floor(Math.sqrt((r + 0.5) ** 2 - dy * dy));
    out.push({ x: cx - half, y: cy + dy, w: half * 2 + 1, h: 1, color });
  }
}

const STARS: Rect[] = (() => {
  const rand = prng(1907);
  const out: Rect[] = [];
  for (let i = 0; i < 46; i++) {
    const x = Math.floor(rand() * WIDTH);
    const y = Math.floor(rand() * 104);
    if (Math.abs(x - MOON_AT.x) < 12 && Math.abs(y - MOON_AT.y) < 12) continue;
    out.push({ x, y, w: 1, h: 1, color: i % 5 === 0 ? MOON : STAR });
    // A few bright ones get a cross.
    if (i % 9 === 0) out.push({ x: x - 1, y, w: 3, h: 1, color: STAR }, { x, y: y - 1, w: 1, h: 3, color: STAR });
  }
  return out;
})();

const MOON_RECTS: Rect[] = (() => {
  const out: Rect[] = [];
  disc(out, MOON_AT.x, MOON_AT.y, 7, MOON);
  out.push(
    { x: MOON_AT.x + 1, y: MOON_AT.y - 3, w: 2, h: 2, color: MOON_SHADE },
    { x: MOON_AT.x - 3, y: MOON_AT.y + 1, w: 3, h: 2, color: MOON_SHADE },
    { x: MOON_AT.x + 3, y: MOON_AT.y + 3, w: 1, h: 1, color: MOON_SHADE },
  );
  return out;
})();

const SUN_RECTS: Rect[] = (() => {
  const out: Rect[] = [];
  disc(out, 0, 0, 8, SUN.rim);
  disc(out, 0, 0, 6, SUN.core);
  return out;
})();

/** Columns → row runs of one color. */
function columnsToRows(heights: number[], colors: string[], baseY: number): Rect[] {
  const out: Rect[] = [];
  const maxH = Math.max(0, ...heights);
  for (let row = 1; row <= maxH; row++) {
    const y = baseY - row;
    let x = 0;
    while (x < heights.length) {
      if ((heights[x] ?? 0) < row) {
        x++;
        continue;
      }
      const color = colors[x] ?? DUNES[0];
      let end = x + 1;
      while (end < heights.length && (heights[end] ?? 0) >= row && colors[end] === color) end++;
      out.push({ x, y, w: end - x, h: 1, color });
      x = end;
    }
  }
  return out;
}

/** Two rows of dunes on the horizon, shaded on their right-facing slopes. */
const DUNE_RECTS: Rect[] = (() => {
  const far: number[] = [];
  const farShade: string[] = [];
  const near: number[] = [];
  for (let x = 0; x < WIDTH; x++) {
    far.push(Math.max(0, Math.round(7 + 4 * Math.sin(x / 41) + 3 * Math.sin(x / 17 + 1.3))));
    // Slopes falling to the right face away from the light.
    farShade.push((4 / 41) * Math.cos(x / 41) + (3 / 17) * Math.cos(x / 17 + 1.3) < 0 ? DUNES[1] : DUNES[0]);
    near.push(Math.max(0, Math.round(2 + 3 * Math.sin(x / 29 + 2.1) + 1.5 * Math.sin(x / 11))));
  }
  return [...columnsToRows(far, farShade, HORIZON_Y), ...columnsToRows(near, near.map(() => DUNES[1]), HORIZON_Y)];
})();

/** Sand, darker toward the horizon, with ripples. */
const GROUND_RECTS: Rect[] = (() => {
  const out = bands(
    [
      [HORIZON_Y, SAND[2]],
      [HORIZON_Y + 20, SAND[1]],
      [HORIZON_Y + 60, SAND[0]],
    ],
    HEIGHT,
    8,
  );
  out.push({ x: 0, y: HORIZON_Y, w: WIDTH, h: 1, color: SAND[3] });
  const rand = prng(77);
  for (let i = 0; i < 70; i++) {
    const y = HORIZON_Y + 4 + Math.floor(rand() ** 1.6 * (HEIGHT - HORIZON_Y - 6));
    const x = Math.floor(rand() * WIDTH);
    const w = 3 + Math.floor(rand() * 6);
    const near = y > HORIZON_Y + 60;
    out.push({ x, y, w, h: 1, color: near ? SAND[1] : y > HORIZON_Y + 20 ? SAND[2] : SAND[3] });
    if (near) out.push({ x: x + 1, y: y - 1, w: Math.max(1, w - 2), h: 1, color: mix(SAND[0], "#FFFFFF", 0.25) });
  }
  return out;
})();

function spriteRects(sprite: Sprite, left: number, top: number): Rect[] {
  return sprite.runs.map((r) => ({ x: left + r.x, y: top + r.y, w: r.w, h: 1, color: r.color }));
}

/** A sprite placed by the center of its bottom edge. */
function placed(grid: Grid, cx: number, bottom: number): Rect[] {
  const s = prop(grid);
  return spriteRects(s, cx - Math.floor(s.w / 2), bottom - s.h);
}

/**
 * The tents' bottom edge: behind the heads and icons of the front row of seats (CAMP), so waiting workers sit in front
 * of the tents rather than on their slopes, and their hourglasses do not hide in a tent's door.
 */
export const TENT_BOTTOM = PLACES.camp.y - 24;

/** The table stands just in front of the rations spot, so a worker taking bread and beer stands behind it. */
const TABLE_BOTTOM = PLACES.rations.y + 3;

/** The palms, the camp's tents, the well and the shadows of the props: they never move. */
const PROP_RECTS: Rect[] = (() => {
  const shadow = (cx: number, y: number, w: number): Rect => ({ x: cx - Math.floor(w / 2), y, w, h: 1, color: SAND[2] });
  return [
    shadow(23, TENT_BOTTOM, 26),
    ...placed(PROPS.tent, 24, TENT_BOTTOM),
    shadow(63, TENT_BOTTOM - 2, 24),
    ...placed(PROPS.tent, 63, TENT_BOTTOM - 2),
    ...placed(PROPS.palm, 6, 192),
    ...placed(PROPS.palm, 96, 200),
    ...placed(PROPS.palm, 466, 196),
    shadow(PLACES.well.x, 204, 20),
    ...placed(PROPS.well, PLACES.well.x, 204),
    shadow(PLACES.rations.x, TABLE_BOTTOM, 22),
    shadow(PLACES.treasury.x, PLACES.treasury.y, 16),
  ];
})();

interface Scenery {
  /** The line it stands on: actors with their feet further back are drawn before it. */
  y: number;
  rects: readonly Rect[];
}

const FIXED_SCENERY: readonly Scenery[] = [
  { y: PLACES.sledge.y + 6, rects: placed(PROPS.sledge, PLACES.sledge.x + 1, PLACES.sledge.y + 6) },
  { y: PLACES.treasury.y, rects: placed(PROPS.chest, PLACES.treasury.x, PLACES.treasury.y) },
  { y: TABLE_BOTTOM, rects: placed(PROPS.table, PLACES.rations.x, TABLE_BOTTOM) },
];

/** The props actors walk in front of and behind, back to front, with the coin pile of this frame. */
function sceneryOf(coins: number): Scenery[] {
  const all = [...FIXED_SCENERY, { y: PLACES.treasury.y + 1, rects: coinRects(coins) }];
  return all.sort((a, b) => a.y - b.y);
}

const STACKS = 6;
const coinCache = new Map<number, Rect[]>();
/** The coin pile left of the chest: a mound of stacks, the same for the same count. */
export function coinRects(count: number): Rect[] {
  const n = Math.max(0, Math.min(48, Math.floor(Number.isFinite(count) ? count : 0)));
  let rects = coinCache.get(n);
  if (rects) return rects;
  const heights = new Array<number>(STACKS).fill(0);
  for (let i = 0; i < n; i++) {
    let best = 0;
    let score = Infinity;
    for (let s = 0; s < STACKS; s++) {
      const value = (heights[s] ?? 0) + Math.abs(s - (STACKS - 1) / 2) * 1.8;
      if (value < score) {
        score = value;
        best = s;
      }
    }
    heights[best] = (heights[best] ?? 0) + 1;
  }
  rects = [];
  const bottom = PLACES.treasury.y + 1;
  for (let s = 0; s < STACKS; s++) {
    const h = heights[s] ?? 0;
    if (h === 0) continue;
    const x = PLACES.treasury.x - 10 - (STACKS - s) * 4;
    rects.push({ x: x - 1, y: bottom - h, w: 1, h, color: OUTLINE });
    for (let k = 0; k < h; k++) rects.push({ x, y: bottom - 1 - k, w: 3, h: 1, color: k % 2 === 0 ? COIN.shadow : COIN.face });
    rects.push({ x, y: bottom - h - 1, w: 3, h: 1, color: COIN.face }, { x: x + 1, y: bottom - h - 1, w: 1, h: 1, color: GOLD.gleam });
  }
  coinCache.set(n, rects);
  return rects;
}

// ---------------------------------------------------------------------------------------------------------------
// The pyramid

interface Stone {
  dx: number;
  dy: number;
  w: number;
  h: number;
}

const stoneCache = new Map<string, Stone[]>();
/** A block's stones in placing order: the bottom row first, each left to right, every other row staggered. */
export function stoneLayout(w: number, h: number): Stone[] {
  const key = `${w}x${h}`;
  let stones = stoneCache.get(key);
  if (stones) return stones;
  const big = w >= 16;
  const sw = big ? 8 : 4;
  const sh = big ? 4 : 2;
  stones = [];
  const rows = Math.max(1, Math.ceil(h / sh));
  for (let r = 0; r < rows; r++) {
    const y1 = h - r * sh;
    const y0 = Math.max(0, y1 - sh);
    for (let x = r % 2 === 1 ? -sw / 2 : 0; x < w; x += sw) {
      const x0 = Math.max(0, x);
      const x1 = Math.min(w, x + sw);
      if (x1 > x0) stones.push({ dx: x0, dy: y0, w: x1 - x0, h: y1 - y0 });
    }
  }
  stoneCache.set(key, stones);
  return stones;
}

interface StoneColors {
  light: string;
  face: string;
  mortar: string;
  edge: string;
}

const STONE_SET: StoneColors = LIMESTONE;
const STONE_STALLED: StoneColors = {
  light: desaturate(LIMESTONE.light),
  face: desaturate(LIMESTONE.face),
  mortar: desaturate(LIMESTONE.mortar),
  edge: desaturate(LIMESTONE.edge),
};
const STONE_ORPHANED: StoneColors = {
  light: mix(ORPHANED.light, "#FFFFFF", 0.25),
  face: ORPHANED.light,
  mortar: ORPHANED.dark,
  edge: ORPHANED.dark,
};

function drawStone(p: Painter, x: number, y: number, s: Stone, c: StoneColors): void {
  // The cell is mortar; the stone leaves a mortar line on its right and bottom and is lit on its top and left.
  p.rect(x + s.dx, y + s.dy, s.w, s.h, c.mortar);
  const w = Math.max(1, s.w - 1);
  const h = Math.max(1, s.h - 1);
  p.rect(x + s.dx, y + s.dy, w, h, c.face);
  if (s.h >= 3) {
    p.rect(x + s.dx, y + s.dy, w, 1, c.light);
    p.rect(x + s.dx, y + s.dy, 1, h, c.light);
  }
}

function outline(p: Painter, b: Block, color: string): void {
  p.rect(b.x, b.y, b.w, 1, color);
  p.rect(b.x, b.y + b.h - 1, b.w, 1, color);
  p.rect(b.x, b.y, 1, b.h, color);
  p.rect(b.x + b.w - 1, b.y, 1, b.h, color);
}

function dotted(p: Painter, b: Block, color: string): void {
  for (let x = 0; x < b.w; x += 2) {
    p.rect(b.x + x, b.y, 1, 1, color);
    p.rect(b.x + x, b.y + b.h - 1, 1, 1, color);
  }
  for (let y = 2; y < b.h - 1; y += 2) {
    p.rect(b.x, b.y + y, 1, 1, color);
    p.rect(b.x + b.w - 1, b.y + y, 1, 1, color);
  }
}

function stones(p: Painter, b: Block, share: number, colors: StoneColors): void {
  const layout = stoneLayout(b.w, b.h);
  const fill = Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0;
  const count = Math.round(fill * layout.length);
  for (let i = 0; i < count; i++) {
    const s = layout[i];
    if (s) drawStone(p, b.x, b.y, s, colors);
  }
}

function drawBlock(p: Painter, b: Block): void {
  switch (b.look) {
    case "empty":
      outline(p, b, OUTLINE_EMPTY);
      break;
    case "planned":
      dotted(p, b, OUTLINE_PLANNED);
      break;
    case "building":
      dotted(p, b, OUTLINE_PLANNED);
      stones(p, b, b.fill, STONE_SET);
      break;
    case "stalled":
      dotted(p, b, desaturate(OUTLINE_PLANNED));
      stones(p, b, b.fill, STONE_STALLED);
      break;
    case "orphaned":
      dotted(p, b, ORPHANED.dark);
      stones(p, b, Math.max(b.fill, 0.15), STONE_ORPHANED);
      break;
    case "set":
      stones(p, b, 1, STONE_SET);
      p.rect(b.x, b.y, b.w, 1, LIMESTONE.light);
      p.rect(b.x + b.w - 1, b.y + 1, 1, b.h - 1, LIMESTONE.edge);
      break;
    case "fallen": {
      p.rect(b.x, b.y, b.w, b.h, FALLEN.gap);
      p.rect(b.x, b.y, b.w, 1, FALLEN.crack);
      // A zigzag crack from the top edge to the bottom, the same for the same block.
      const rand = prng(b.x * 31 + b.y * 17);
      let cx = b.x + Math.floor(b.w / 2);
      for (let y = b.y + 1; y < b.y + b.h; y++) {
        cx = Math.min(b.x + b.w - 2, Math.max(b.x + 1, cx + Math.floor(rand() * 3) - 1));
        p.rect(cx, y, 1, 1, FALLEN.crack);
        if (y % 3 === 0) p.rect(cx + 1, y, 1, 1, FALLEN.crack);
      }
      break;
    }
  }
}

function rubbleAt(i: number, pyramid: Pyramid): { x: number; y: number } {
  const width = pyramid.base > 0 ? pyramid.base * pyramid.blockW : PYRAMID_AREA.maxWidth / 2;
  const h = Math.imul(i + 1, 2654435761) >>> 0;
  // Inside the foot, less the widest rubble sprite, so no stone lies beyond the bottom course.
  const spread = Math.max(0, width - 4);
  return {
    x: PYRAMID_AREA.centerX - spread / 2 + (h % 1000) / 1000 * spread,
    y: PYRAMID_AREA.baseY + 1 + ((h >>> 12) % 7),
  };
}

function drawPyramid(p: Painter, pyramid: Pyramid): void {
  for (const b of pyramid.blocks) drawBlock(p, b);
  for (const b of pyramid.blocks) {
    if (b.flash > 0) {
      p.alpha(Math.min(1, b.flash) * 0.6);
      p.rect(b.x, b.y, b.w, b.h, FLASH);
      p.alpha(1);
    }
  }
  for (const b of pyramid.blocks) if (b.highlight) outline(p, b, GOLD.light);
  const rubble = Math.max(0, Math.min(200, Math.floor(pyramid.rubble)));
  for (let i = 0; i < rubble; i++) {
    const at = rubbleAt(i, pyramid);
    const grid = PROPS.rubble[i % PROPS.rubble.length] ?? PROPS.rubble[0];
    const s = prop(grid);
    p.sprite(s, Math.round(at.x) - Math.floor(s.w / 2), Math.round(at.y) - s.h + 1);
  }
  const cap = pyramid.capstone;
  if (cap.state === "none") return;
  if (cap.flag !== "none") {
    const px = PLACES.sledge.x + 15;
    const base = PLACES.sledge.y + 5;
    p.rect(px, base - 18, 1, 18, WOOD[1]);
    p.rect(px, base - 19, 1, 1, GOLD.light);
    const color = cap.flag === "passed" ? FLAG.green : FLAG.red;
    for (let i = 0; i < 4; i++) p.rect(px + 1, base - 18 + i, 6 - i * 1.5, 1, color);
    p.rect(px + 1, base - 15, 1, 1, OUTLINE);
  }
  const sprite = prop(cap.ready ? PROPS.capstoneGleam : PROPS.capstone);
  const left = Math.round(cap.x) - Math.floor(sprite.w / 2);
  const top = Math.round(cap.y) - sprite.h;
  p.sprite(sprite, left, top);
  if (cap.ready) p.sprite(prop(PROPS.glint), left - 3, top - 2);
}

// ---------------------------------------------------------------------------------------------------------------
// Actors

const WALKING = new Set(["walk", "carry-scroll", "carry-stone", "carry-ration"]);
const TOOLED = new Set(["laborer", "mason", "scribe", "skeptic", "surveyor"]);

/** The frame an actor shows now. */
export function frameIndex(actor: Actor, frames: number): number {
  if (frames <= 1) return 0;
  if (actor.pose === "work" && TOOLED.has(actor.cast)) return actor.stroke < 0.5 ? 1 : 0;
  const fps = WALKING.has(actor.pose) ? 8 : 4;
  const t = Number.isFinite(actor.poseTime) ? Math.max(0, actor.poseTime) : 0;
  return Math.floor(t * fps) % frames;
}

function spriteOf(actor: Actor): Sprite | null {
  const frames = SPRITES.frames(actor.cast, actor.pose, actor.ration, actor.ghost);
  return frames[frameIndex(actor, frames.length)] ?? null;
}

/**
 * Where a climber's ladder leans: the first course edge at least 6 px above its feet, so the ladder rests on the
 * pyramid instead of ending in the air; above the pyramid, 8 px over the feet.
 */
export function ladderTop(feet: number, pyramid: Pick<Pyramid, "base" | "blockH">): number {
  const h = pyramid.blockH;
  if (!(h > 0) || !Number.isFinite(feet)) return feet - 8;
  const k = Math.max(1, Math.ceil((PYRAMID_AREA.baseY - (feet - 6)) / h));
  return k <= pyramid.base ? PYRAMID_AREA.baseY - k * h : feet - 8;
}

function drawLadder(p: Painter, x: number, feet: number, pyramid: Pyramid): void {
  const top = ladderTop(feet, pyramid);
  if (top >= GROUND_Y) return;
  p.rect(x - 4, top, 1, GROUND_Y - top, WOOD[1]);
  p.rect(x + 3, top, 1, GROUND_Y - top, WOOD[1]);
  for (let y = GROUND_Y - 2; y >= top; y -= 3) p.rect(x - 3, y, 6, 1, WOOD[0]);
}

function drawPlank(p: Painter, x: number, feet: number): void {
  p.rect(x - 7, feet + 2, 1, GROUND_Y - feet - 2, WOOD[1]);
  p.rect(x + 6, feet + 2, 1, GROUND_Y - feet - 2, WOOD[1]);
  p.rect(x - 9, feet, 18, 1, WOOD[0]);
  p.rect(x - 9, feet + 1, 18, 1, WOOD[1]);
}

/** Where the head starts: the top of the sprite's pixels. */
function headTop(actor: Actor, sprite: Sprite): number {
  return Math.round(actor.y) - sprite.h + sprite.top;
}

function drawBubble(p: Painter, bubble: Bubble, speakerX: number, head: number): void {
  const rand = prng(bubble.seed);
  const count = 3 + Math.floor(rand() * 5);
  const lines = count > 4 ? 2 : 1;
  const perLine = Math.ceil(count / lines);
  const fullW = perLine * 4 - 1 + 6;
  const fullH = lines * 5 - 1 + 6;
  const open = Number.isFinite(bubble.open) ? Math.min(1, Math.max(0, bubble.open)) : 1;
  if (open <= 0) return;
  const w = Math.max(4, Math.round(fullW * open));
  const h = Math.max(4, Math.round(fullH * open));
  const tailH = open >= 0.5 ? 3 : 1;
  const bottom = Math.max(h + 1, head - 1 - tailH);
  const top = bottom - h;
  const left = Math.min(WIDTH - 1 - w, Math.max(1, speakerX - Math.floor(w / 2) - 2));
  // The outline, with its corners cut, then the fill.
  p.rect(left + 1, top, w - 2, 1, OUTLINE);
  p.rect(left + 1, top + h - 1, w - 2, 1, OUTLINE);
  p.rect(left, top + 1, 1, h - 2, OUTLINE);
  p.rect(left + w - 1, top + 1, 1, h - 2, OUTLINE);
  p.rect(left + 1, top + 1, w - 2, h - 2, BUBBLE.fill);
  // The tail, toward the speaker's head.
  const tx = Math.min(left + w - 4, Math.max(left + 2, speakerX - 1));
  p.rect(tx, top + h - 1, 2, 1, BUBBLE.fill);
  if (tailH >= 3) {
    p.rect(tx - 1, top + h - 1, 1, 2, OUTLINE);
    p.rect(tx, top + h, 1, 1, BUBBLE.fill);
    p.rect(tx + 1, top + h, 1, 1, OUTLINE);
    p.rect(tx + 2, top + h - 1, 1, 1, OUTLINE);
    p.rect(tx, top + h + 1, 1, 1, OUTLINE);
  }
  if (open < 1) return;
  for (let i = 0; i < count; i++) {
    const glyph = GLYPHS[Math.floor(rand() * GLYPHS.length)] ?? GLYPHS[0] ?? [];
    const line = Math.floor(i / perLine);
    const gx = left + 3 + (i % perLine) * 4;
    const gy = top + 3 + line * 5;
    glyph.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === "#") p.rect(gx + x, gy + y, 1, 1, BUBBLE.glyph);
    });
  }
}

function drawActors(p: Painter, world: World): void {
  const order = world.actors.map((actor, i) => ({ actor, i }));
  order.sort((a, b) => a.actor.y - b.actor.y || a.i - b.i);
  const scenery = sceneryOf(world.coins);
  let next = 0;
  const shown: { actor: Actor; sprite: Sprite }[] = [];
  for (const { actor } of order) {
    // Scenery standing further back than this actor goes first, so the actor passes in front of it.
    for (; next < scenery.length && (scenery[next]?.y ?? 0) <= actor.y; next++) p.rects(scenery[next]?.rects ?? []);
    const sprite = spriteOf(actor);
    if (!sprite) continue;
    const x = Math.round(actor.x);
    const y = Math.round(actor.y);
    if (actor.pose === "climb" || actor.pose === "climb-stone") drawLadder(p, x, y, world.pyramid);
    // A worker above the pyramid's foot stands on a plank; on the foot itself it stands on the base.
    if (actor.pose === "work" && y < PYRAMID_AREA.baseY) drawPlank(p, x, y);
    const alpha = Math.min(1, Math.max(0, Number.isFinite(actor.alpha) ? actor.alpha : 1)) * (actor.ghost ? 0.5 : 1);
    if (alpha <= 0) continue;
    if (alpha < 1) p.alpha(alpha);
    p.sprite(sprite, x - Math.floor(sprite.w / 2), y - sprite.h, actor.facing === -1);
    if (alpha < 1) p.alpha(1);
    shown.push({ actor, sprite });
  }
  for (; next < scenery.length; next++) p.rects(scenery[next]?.rects ?? []);
  // Icons, markers and bubbles are signs for the viewer: they keep their colors at dusk and at night.
  p.tint(null);
  for (const { actor, sprite } of shown) {
    const x = Math.round(actor.x);
    let top = headTop(actor, sprite);
    if (actor.icon) {
      const icon = prop(ICONS[actor.icon]);
      top -= icon.h + 2;
      p.sprite(icon, x - Math.floor(icon.w / 2), top);
    }
    const blinkOn = world.reducedMotion || Math.floor(Math.max(0, actor.poseTime) * 4) % 2 === 0;
    if (actor.highlight && blinkOn) {
      const marker = prop(MARKER);
      p.sprite(marker, x - Math.floor(marker.w / 2), top - marker.h - 1);
    }
  }
  for (const { actor, sprite } of shown) if (actor.bubble) drawBubble(p, actor.bubble, Math.round(actor.x), headTop(actor, sprite));
}

function drawParticle(p: Painter, particle: Particle): void {
  const { x, y } = particle;
  switch (particle.kind) {
    case "dust":
      p.rect(x, y, 1, 1, SAND[2]);
      break;
    case "stone":
      p.rect(x, y, 2, 2, LIMESTONE.face);
      p.rect(x, y, 1, 1, LIMESTONE.light);
      break;
    case "sparkle":
      p.rect(x, y, 1, 1, Math.floor(particle.life * 10) % 2 === 0 ? GOLD.gleam : GOLD.light);
      break;
    case "coin":
      p.rect(x, y, 2, 2, GOLD.light);
      break;
  }
}

// ---------------------------------------------------------------------------------------------------------------

/** Draws the world back to front. globalAlpha is 1 when it returns. */
export function renderWorld(ctx: Canvas2D, world: World): void {
  ctx.imageSmoothingEnabled = false;
  ctx.globalAlpha = 1;
  const p = painter(ctx);

  p.rects(skyRects(world.sky.phase));
  if (world.sky.phase === "night") {
    p.rects(STARS);
    p.rects(MOON_RECTS);
  } else {
    const sun = sunPosition(world.sky.sun);
    p.rects(SUN_RECTS, Math.round(sun.x), Math.round(sun.y));
  }

  p.tint(lightOf(world.sky.phase));
  p.rects(DUNE_RECTS);
  for (const far of world.far.slice(0, 3)) drawFarPyramid(p, far.x, far.y, far.height);

  p.rects(GROUND_RECTS);
  p.rects(PROP_RECTS);

  drawPyramid(p, world.pyramid);
  drawActors(p, world);
  for (const particle of world.particles) drawParticle(p, particle);
  ctx.globalAlpha = 1;
}

/** A small stepped pyramid with a gold tip, standing on (x, y). */
function drawFarPyramid(p: Painter, cx: number, base: number, height: number): void {
  const h = Math.max(4, Math.min(40, Math.round(height)));
  const x = Math.round(cx);
  const y = Math.round(base);
  for (let r = 0; r < h; r++) {
    const half = h - (r - (r % 2));
    const row = y - 1 - r;
    const tip = r >= h - 3;
    p.rect(x - half, row, half, 1, tip ? GOLD.light : LIMESTONE.light);
    p.rect(x, row, half, 1, tip ? GOLD.mid : LIMESTONE.mortar);
  }
  p.rect(x - h - 1, y - 1, 2 * h + 2, 1, LIMESTONE.edge);
}
