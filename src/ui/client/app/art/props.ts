// The props of the plain (DESIGN.md §19, the game-studio pass): the camp's tents, fire and resting camel, the quarry,
// swaying palms, the well, arbab's dais under its canopy, braziers and torches. Each stands on a line, so actors pass
// in front of and behind it, and casts a shadow; flames are drawn in their own light.
import { PLACES, PYRAMID_AREA } from "../../model";
import {
  BRONZE,
  CAMEL,
  CANOPY,
  FIRE,
  GOLD,
  NEMES_BLUE,
  QUARRY,
  SMOKE,
  STONE_RING,
  TENT,
  WOOD,
  mix,
} from "../palette";
import type { Grid, Sprite } from "../sprites";
import { compile, compileProp, PROPS } from "../sprites";
import type { Painter, Rect } from "./paint";
import { clock, Pixmap, prng } from "./paint";

/** Something on the plain: drawn when the actors behind it are done. */
export interface Scenery {
  y: number;
  draw(p: Painter, time: number, light: ((color: string) => string) | null): void;
}

/** A shadow on the sand: centered on cx, on row y, rx px to each side. */
export interface ShadowSpot {
  cx: number;
  y: number;
  rx: number;
  ry: number;
}

/** A fire that lights the night around it. */
export interface LightSpot {
  x: number;
  y: number;
  radius: number;
  seed: number;
}

const OUTLINE_WARM = "#4A3020";

/** A Pixmap as a Sprite: its runs are one row high, and later runs draw over earlier ones. */
function sprite(map: Pixmap): Sprite {
  const runs = map.runs().map((r) => ({ x: r.x, y: r.y, w: r.w, color: r.color }));
  return { w: map.width, h: map.height, top: 0, runs, mirrored: runs.map((r) => ({ ...r, x: map.width - r.x - r.w })) };
}

function at(s: Sprite, cx: number, bottom: number): { left: number; top: number } {
  return { left: cx - Math.floor(s.w / 2), top: bottom - s.h };
}

// ---------------------------------------------------------------------------------------------------------------
// Tents

/** An A-frame tent of striped cloth, lit on its left slope, with guy ropes and a pennant. */
function tentSprite(w: number, h: number, seed: number): Sprite {
  const W = w + 8;
  const H = h + 5;
  const map = new Pixmap(W, H);
  const cx = Math.floor(W / 2);
  const top = 5;
  const bottom = H - 1;
  const hw = Math.floor(w / 2);
  // Ropes first, behind the cloth.
  for (const side of [-1, 1]) {
    const x0 = cx + side * 3;
    const x1 = cx + side * (hw + 3);
    for (let y = top + 3; y <= bottom; y++) {
      const t = (y - top - 3) / (bottom - top - 3);
      map.set(Math.round(x0 + (x1 - x0) * t), y, "#8A6A44");
    }
    map.set(x1, bottom, OUTLINE_WARM);
  }
  // The pole and its pennant.
  for (let y = 1; y < top; y++) map.set(cx, y, WOOD[1]);
  const red = seed % 2 === 0 ? TENT.stripe : NEMES_BLUE;
  map.fill(cx + 1, 1, 3, 1, red);
  map.fill(cx + 1, 2, 2, 1, red);
  for (let y = top; y <= bottom; y++) {
    const r = y - top;
    const half = Math.round((hw * r) / (bottom - top));
    for (let dx = -half; dx <= half; dx++) {
      const x = cx + dx;
      let color: string = dx < 0 ? (dx > -half + 1 || r < 3 ? TENT.cloth : "#F3E6C8") : TENT.shade;
      if (dx < 0 && dx >= -Math.max(1, Math.floor(half / 3))) color = mix(TENT.cloth, TENT.shade, 0.35);
      // Two stripes near the hem.
      const stripe = bottom - y === 3 || bottom - y === 4;
      if (stripe) color = dx < 0 ? TENT.stripe : "#8E2F2B";
      if (Math.abs(dx) === half) color = OUTLINE_WARM;
      map.set(x, y, color);
    }
  }
  // The door: dark inside, a flap folded back on the lit side.
  const doorTop = top + Math.floor((bottom - top) * 0.42);
  for (let y = doorTop; y < bottom; y++) {
    const half = Math.floor(((y - doorTop) * 3) / (bottom - doorTop)) + 1;
    for (let dx = -half; dx <= half; dx++) map.set(cx + dx, y, y === doorTop ? OUTLINE_WARM : "#3E2A1C");
    map.set(cx - half - 1, y, "#F6EBD2");
  }
  map.fill(cx - hw, bottom, 2 * hw + 1, 1, OUTLINE_WARM);
  return sprite(map);
}

/**
 * The tents stand behind the heads and icons of the front row of seats (CAMP), so waiting workers sit in front of the
 * tents rather than on their slopes, and their hourglasses do not hide in a tent's door.
 */
const TENTS = [
  { x: 24, bottom: PLACES.camp.y - 24, sprite: tentSprite(28, 15, 0) },
  { x: 63, bottom: PLACES.camp.y - 26, sprite: tentSprite(24, 13, 1) },
] as const;

// ---------------------------------------------------------------------------------------------------------------
// The camp fire

export const FIRE_AT = { x: 86, y: 197 } as const;

const FLAME_FRAMES: readonly Grid[] = [
  ["...r...", "..ro...", "..roy..", ".royyr.", ".oyWyo.", "royWyor", ".ryyyr."],
  ["....r..", "...or..", "..ryo..", ".roWyr.", ".oyWyo.", "royyWor", ".ryyyr."],
  ["..r....", "..oy...", ".royo..", ".ryWyr.", "royWyo.", "royWyor", ".ryyyr."],
];
const SMALL_FLAMES: readonly Grid[] = [
  ["..r..", ".roy.", ".oWo.", "ryWyr", ".ryr."],
  ["...r.", "..or.", ".ryo.", "royWr", ".ryr."],
  [".r...", ".oy..", ".oWr.", "ryWyo", ".ryr."],
];
const FLAME_COLORS: Readonly<Record<string, string>> = { W: FIRE.white, y: FIRE.yellow, o: FIRE.orange, r: FIRE.red };
const FLAMES: Sprite[] = FLAME_FRAMES.map((g) => compile(g, FLAME_COLORS));
const SMALL: Sprite[] = SMALL_FLAMES.map((g) => compile(g, FLAME_COLORS));

/** A flame's frame now: three frames at 8 fps, each fire on its own phase. */
export function flameFrame(time: number, seed: number): number {
  return (Math.floor(clock(time) * 8) + seed) % 3;
}

const FIRE_BASE: Sprite = compile(
  [
    "..ennnNe..",
    ".gnNnnNNg.",
    "GgsgGgsgGg",
    ".gGgsgGg..",
  ],
  { n: WOOD[0], N: WOOD[1], e: FIRE.ember, g: STONE_RING.shade, G: STONE_RING.light, s: "#5A4636" },
);

/** Smoke puffs rising from the fire: where each is and how opaque, looping every `SMOKE_LOOP` seconds. */
export const SMOKE_LOOP = 4;

export function smokePuffs(time: number): { x: number; y: number; r: number; alpha: number }[] {
  const t = clock(time);
  const out: { x: number; y: number; r: number; alpha: number }[] = [];
  for (let i = 0; i < 5; i++) {
    const u = ((t + i * (SMOKE_LOOP / 5)) % SMOKE_LOOP) / SMOKE_LOOP;
    out.push({
      // It drifts with the wind as it rises, and spreads.
      x: Math.round(FIRE_AT.x + Math.sin(u * 5 + i) * 1.5 + u * 9),
      y: Math.round(FIRE_AT.y - 11 - u * 30),
      r: u < 0.25 ? 1 : u < 0.6 ? 2 : 3,
      alpha: 0.7 * (1 - u) ** 1.2,
    });
  }
  return out;
}

const puffCache = new Map<number, Rect[]>();
function puff(r: number): Rect[] {
  let rects = puffCache.get(r);
  if (!rects) {
    rects = [];
    for (let dy = -r; dy <= r; dy++) {
      const half = Math.round(Math.sqrt(Math.max(0, (r + 0.4) ** 2 - dy * dy)));
      rects.push({ x: -half, y: dy, w: 2 * half + 1, h: 1, color: dy < 0 ? mix(SMOKE, "#FFFFFF", 0.2) : SMOKE });
    }
    puffCache.set(r, rects);
  }
  return rects;
}

function drawFire(p: Painter, time: number, light: ((color: string) => string) | null): void {
  const base = at(FIRE_BASE, FIRE_AT.x, FIRE_AT.y);
  p.sprite(FIRE_BASE, base.left, base.top);
  for (const s of smokePuffs(time)) {
    p.alpha(s.alpha);
    p.rects(puff(s.r), s.x, s.y);
    p.alpha(1);
  }
  // Flames carry their own light.
  p.tint(null);
  const flame = FLAMES[flameFrame(time, 0)] ?? FLAMES[0];
  if (flame) p.sprite(flame, FIRE_AT.x - 3, FIRE_AT.y - 3 - flame.h);
  // An ember now and then.
  const e = Math.floor(clock(time) * 3) % 5;
  p.rect(FIRE_AT.x - 2 + e, FIRE_AT.y - 11 - (e % 3), 1, 1, FIRE.yellow);
  p.tint(light);
}

// ---------------------------------------------------------------------------------------------------------------
// The resting camel

/** Kneeling, facing left: the long neck up from the chest, the head forward, a saddle blanket on the hump. */
const RESTING_CAMEL: Grid = [
  "..oo....................",
  ".olloo..................",
  "olllffo.................",
  "offeffo.................",
  "ommfffo.................",
  ".oofffo.................",
  "...offfo.......ooooo....",
  "...offfo.....oolllllo...",
  "....offfo...ollllllllo..",
  "....offffo.ollqqqqqllfo.",
  "....offfffollqrrrrrqfffo",
  "....offffffffqqqqqqqffso",
  "...ooffffffffffffffsssso",
  "..offssooooooooooossssso",
  "..oooooo..........oooooo",
];
const CAMEL_COLORS: Readonly<Record<string, string>> = {
  o: "#5A3A20",
  l: CAMEL.light,
  f: CAMEL.face,
  s: CAMEL.shade,
  e: "#2E1E12",
  m: "#E2C090",
  q: CANOPY.cream,
  r: CANOPY.red,
};
const patchGrid = (grid: Grid, cells: readonly [number, number, string][]): string[] => {
  const rows = [...grid];
  for (const [y, x, ch] of cells) {
    const row = rows[y] ?? "";
    rows[y] = row.slice(0, x) + ch + row.slice(x + 1);
  }
  return rows;
};
const CAMEL_SPRITES = {
  rest: compile(RESTING_CAMEL, CAMEL_COLORS),
  blink: compile(patchGrid(RESTING_CAMEL, [[3, 3, "s"]]), CAMEL_COLORS),
  // The lower jaw drops a pixel.
  chew: compile(patchGrid(RESTING_CAMEL, [[4, 1, "f"], [4, 2, "f"], [5, 1, "m"], [5, 2, "m"], [6, 1, "o"], [6, 2, "o"]]), CAMEL_COLORS),
};

/** Right of the fire's smoke, which drifts with the wind and would cross its head. */
export const CAMEL_AT = { x: 112, y: 178 } as const;

/** The resting camel's look now: it blinks every few seconds and chews for a while now and then. */
export function camelPose(time: number): "rest" | "blink" | "chew" {
  const t = clock(time);
  if (t % 3.7 < 0.15) return "blink";
  const u = t % 9;
  if (u < 3 && Math.floor(u * 4) % 2 === 1) return "chew";
  return "rest";
}

// ---------------------------------------------------------------------------------------------------------------
// The quarry

function quarrySprite(): Sprite {
  const map = new Pixmap(46, 22);
  const block = (x: number, y: number, w: number, h: number): void => {
    // Top face, front face, a shaded right side, and a dark joint below and to the right.
    map.fill(x, y, w, 2, QUARRY.light);
    map.fill(x, y + 2, w, h - 2, QUARRY.face);
    map.fill(x + w - 2, y + 2, 1, h - 3, QUARRY.shade);
    map.fill(x, y + h - 2, w - 1, 1, QUARRY.shade);
    map.fill(x, y + h - 1, w, 1, QUARRY.edge);
    map.fill(x + w - 1, y, 1, h, QUARRY.edge);
    map.fill(x, y + 2, 1, h - 3, mix(QUARRY.light, QUARRY.face, 0.4));
    // Chisel marks.
    for (let k = 2; k < w - 3; k += 3) map.set(x + k, y + 3 + (k % 2), QUARRY.shade);
  };
  // The cut face of the bedrock behind the stacks, darker and stepped where blocks were taken.
  for (let x = 0; x < 32; x++) {
    const h = 9 + Math.round(3 * Math.sin(x / 5)) - (x > 22 ? x - 22 : 0) - (x < 3 ? 3 - x : 0);
    for (let y = 15 - h; y < 15; y++) {
      const step = (y + Math.floor(x / 6)) % 4 === 0;
      const color = y === 15 - h ? QUARRY.face : step ? QUARRY.edge : x % 6 === 5 ? QUARRY.edge : QUARRY.shade;
      map.set(x, y, color);
    }
  }
  block(2, 14, 10, 7);
  block(12, 14, 10, 7);
  block(22, 14, 10, 7);
  block(7, 8, 10, 6);
  block(17, 8, 10, 6);
  block(12, 3, 9, 5);
  // The sledge with a block on it, and its rope.
  map.fill(33, 19, 13, 1, WOOD[0]);
  map.fill(33, 20, 13, 1, WOOD[1]);
  map.set(45, 18, WOOD[0]);
  block(35, 13, 9, 6);
  for (let x = 44; x < 46; x++) map.set(x, 16, "#8A6A44");
  // Chips on the ground.
  for (const [x, y] of [[0, 21], [31, 21], [4, 20], [27, 21]] as const) map.set(x, y, QUARRY.light);
  return sprite(map);
}

const QUARRY_SPRITE = quarrySprite();
export const QUARRY_AT = { x: 128, y: 204 } as const;

// ---------------------------------------------------------------------------------------------------------------
// Palms

const LEAF = { light: "#79A84C", face: "#4C8A3C", shade: "#2F612C", dark: "#234A22" } as const;
const TRUNK = { light: "#A47447", face: "#7A5230", shade: "#563A22" } as const;

/** A palm in two frames: the fronds swing a pixel between them. `scale` shortens the fronds of a distant palm. */
function palmFrames(height: number, lean: number, seed: number, scale = 1): Sprite[] {
  const rand = prng(seed);
  const fronds = [
    { a: 168, len: 12 },
    { a: 148, len: 13 },
    { a: 118, len: 9 },
    { a: 88, len: 7 },
    { a: 60, len: 10 },
    { a: 30, len: 13 },
    { a: 10, len: 12 },
    { a: 200, len: 9 },
    { a: -22, len: 9 },
  ].map((f) => ({ a: f.a + (rand() - 0.5) * 12, len: Math.max(3, Math.round((f.len + Math.floor(rand() * 3)) * scale)) }));
  const W = 34;
  const H = height + 10;
  return [0, 1].map((frame) => {
    const map = new Pixmap(W, H);
    const base = { x: Math.floor(W / 2), y: H - 1 };
    const crown = { x: base.x + lean, y: H - 1 - height };
    // The trunk: two pixels wide, curving toward the crown, ringed.
    for (let y = base.y; y >= crown.y; y--) {
      const t = (base.y - y) / height;
      const x = Math.round(base.x + lean * t * t + (frame === 1 ? Math.round(t * t * 1.2) : 0));
      const ring = (base.y - y) % 3 === 0;
      map.set(x, y, ring ? TRUNK.face : TRUNK.light);
      map.set(x + 1, y, ring ? TRUNK.shade : TRUNK.face);
      if (y > base.y - 3) map.set(x + 2, y, TRUNK.shade);
    }
    const cx = crown.x + (frame === 1 ? 1 : 0);
    const cy = crown.y;
    for (const f of fronds) {
      const rad = (f.a * Math.PI) / 180;
      for (let s = 1; s <= f.len; s++) {
        const u = s / f.len;
        const sway = frame === 1 ? Math.round(u * u * 1.4) : 0;
        const x = Math.round(cx + Math.cos(rad) * s) + sway;
        const y = Math.round(cy - Math.sin(rad) * s + u * u * f.len * 0.55);
        map.set(x, y, u < 0.4 ? LEAF.face : LEAF.light);
        // Leaflets hang below the rib, darker toward the tips.
        if (s > 2) map.set(x, y + 1, u > 0.7 ? LEAF.shade : LEAF.face);
        if (s > 3 && s % 2 === 0) map.set(x, y + 2, LEAF.dark);
      }
    }
    // The heart of the crown and its dates.
    map.fill(cx - 1, cy - 1, 3, 2, LEAF.shade);
    map.set(cx - 1, cy + 1, "#B8642E");
    map.set(cx + 1, cy + 2, "#8E4A22");
    map.set(cx, cy + 1, "#B8642E");
    return sprite(map);
  });
}

interface Palm {
  x: number;
  bottom: number;
  frames: Sprite[];
  phase: number;
}

const PALMS: Palm[] = [
  { x: 7, bottom: 194, frames: palmFrames(30, 2, 1), phase: 0 },
  { x: 470, bottom: 202, frames: palmFrames(32, -3, 2), phase: 0.7 },
  { x: 182, bottom: 156, frames: palmFrames(22, 1, 3), phase: 1.3 },
  { x: 424, bottom: 258, frames: palmFrames(36, 3, 4), phase: 1.9 },
  { x: 456, bottom: 266, frames: palmFrames(40, -2, 5), phase: 0.4 },
  // The groves at both ends of the river's near bank: small with the distance.
  { x: 6, bottom: 142, frames: palmFrames(16, 1, 6, 0.6), phase: 0.2 },
  { x: 19, bottom: 140, frames: palmFrames(12, -1, 7, 0.5), phase: 1.1 },
  { x: 31, bottom: 143, frames: palmFrames(18, 2, 8, 0.62), phase: 2.0 },
  { x: 447, bottom: 141, frames: palmFrames(14, -1, 9, 0.55), phase: 0.9 },
  { x: 460, bottom: 143, frames: palmFrames(19, -2, 10, 0.65), phase: 1.6 },
  { x: 474, bottom: 140, frames: palmFrames(12, 1, 11, 0.5), phase: 0.5 },
];

/** Each palm swings between two frames on a 2.4 s period, on its own phase. */
export const SWAY_PERIOD = 2.4;

export function palmFrame(index: number, time: number): number {
  const palm = PALMS[index];
  if (!palm) return 0;
  return Math.floor(((clock(time) + palm.phase) % SWAY_PERIOD) / (SWAY_PERIOD / 2));
}

export const PALM_COUNT = PALMS.length;

// ---------------------------------------------------------------------------------------------------------------
// arbab's dais

const DAIS = { left: 97, right: 135, top: 257, bottom: 266 } as const;
const POLES = [98, 134] as const;

function daisSprite(): Sprite {
  const w = DAIS.right - DAIS.left + 1;
  const map = new Pixmap(w, DAIS.bottom - DAIS.top + 1);
  const plankLight = "#A86E38";
  // The deck seen from above: planks with staggered seams.
  for (let r = 0; r < 5; r++) {
    for (let x = 0; x < w; x++) {
      const seam = (x + (r % 2) * 5) % 10 === 0;
      map.set(x, r, seam ? WOOD[1] : r === 0 ? plankLight : r % 2 === 0 ? WOOD[0] : mix(WOOD[0], plankLight, 0.4));
    }
  }
  // A red rug with a gold border where arbab stands.
  map.fill(9, 0, 21, 5, CANOPY.red);
  map.fill(9, 0, 21, 1, GOLD.mid);
  map.fill(9, 4, 21, 1, GOLD.shadow);
  for (let x = 11; x < 28; x += 3) map.set(x, 2, GOLD.light);
  // The front face: a gold trim, boards, three posts.
  map.fill(0, 5, w, 1, GOLD.mid);
  map.fill(0, 6, w, 3, WOOD[1]);
  for (let x = 2; x < w; x += 4) map.fill(x, 6, 1, 3, "#553418");
  for (const x of [0, Math.floor(w / 2), w - 2]) map.fill(x, 6, 2, 4, "#553418");
  map.fill(0, 9, w, 1, "#3E2614");
  return sprite(map);
}

/** The canopy's rows: its peak, and its hem, above arbab's head (which starts at y 236). */
export const CANOPY_TOP = 219;
export const CANOPY_BOTTOM = 231;

function canopySprite(): Sprite {
  const left = POLES[0] - 2;
  const right = POLES[1] + 2;
  const w = right - left + 1;
  const h = CANOPY_BOTTOM - CANOPY_TOP + 1;
  const map = new Pixmap(w, h);
  const mid = Math.floor(w / 2);
  const stripe = (x: number): boolean => Math.floor((x + 1) / 4) % 2 === 0;
  // A low roof, rows 0–3, rising to the middle.
  for (let r = 0; r < 4; r++) {
    const half = Math.round(mid * (0.6 + 0.4 * (r / 3)));
    for (let x = mid - half; x <= mid + half; x++) {
      const lit = x < mid;
      let color: string = stripe(x) ? (lit ? CANOPY.red : CANOPY.redShade) : lit ? CANOPY.cream : CANOPY.creamShade;
      if (Math.abs(x - mid) === half || r === 0) color = OUTLINE_WARM;
      map.set(x, r, color);
    }
  }
  map.fill(mid - 1, 0, 3, 1, GOLD.light);
  // A gold trim and the valance, rows 4–9, darker toward its hem.
  for (let r = 4; r < 10; r++) {
    for (let x = 0; x < w; x++) {
      const shade = r >= 8;
      let color: string = stripe(x) ? (shade ? CANOPY.redShade : CANOPY.red) : shade ? CANOPY.creamShade : CANOPY.cream;
      if (r === 4) color = GOLD.mid;
      if (r === 5) color = GOLD.shadow;
      if (x === 0 || x === w - 1) color = OUTLINE_WARM;
      map.set(x, r, color);
    }
  }
  // The scalloped hem: one tab per stripe, tipped with gold.
  for (let x = 1; x < w - 1; x++) {
    const tab = (x + 1) % 4;
    if (tab >= 1) map.set(x, 10, stripe(x) ? CANOPY.redShade : CANOPY.creamShade);
    if (tab === 2) map.set(x, 11, stripe(x) ? CANOPY.redShade : CANOPY.creamShade);
    if (tab === 2) map.set(x, 12, GOLD.mid);
  }
  return sprite(map);
}

const BANNER_FRAMES: readonly Grid[] = [
  ["yyyyy..", "yBBBBy.", "yBGBBBy", "yBBBBy.", "yyyyy.."],
  ["yyyy...", "yBBBy..", "yBGBBy.", "yBBBBBy", "yyyyyy."],
  ["yyyyyy.", "yBBBBBy", "yBGBBy.", "yBBBy..", "yyyy..."],
];
const BANNERS: Sprite[] = BANNER_FRAMES.map((g) => compile(g, { y: GOLD.mid, B: NEMES_BLUE, G: GOLD.gleam }));

/** A banner's frame now: three frames, each pole's banner on its own phase. */
export function bannerFrame(time: number, pole: number): number {
  return (Math.floor(clock(time) * 5) + pole) % 3;
}

const DAIS_SPRITE = daisSprite();
const CANOPY_SPRITE = canopySprite();

function drawDais(p: Painter, time: number): void {
  p.sprite(DAIS_SPRITE, DAIS.left, DAIS.top);
  const top = CANOPY_TOP - 6;
  POLES.forEach((x, i) => {
    p.rect(x - 1, top, 1, DAIS.top + 6 - top, "#7E522A");
    p.rect(x, top, 1, DAIS.top + 6 - top, "#5A3618");
    p.rect(x - 1, top - 2, 2, 2, GOLD.light);
    // Both banners stream the same way, with the wind.
    const banner = BANNERS[bannerFrame(time, i)] ?? BANNERS[0];
    if (banner) p.sprite(banner, x + 1, top);
  });
  p.sprite(CANOPY_SPRITE, POLES[0] - 2, CANOPY_TOP);
}

// ---------------------------------------------------------------------------------------------------------------
// Braziers and torches

const BRAZIER: Sprite = compile(
  ["oyyyyyyo", "obbbbbbo", ".oBBBBo.", "..oBBo..", "...oo...", "..o..o..", ".o....o.", "o......o"],
  { o: "#4A2E18", y: BRONZE.light, b: BRONZE.face, B: BRONZE.shade },
);
const TORCH: Sprite = compile(
  ["oyyyo", "obbbo", ".oBo.", "..n..", "..n..", "..N..", "..n..", "..n..", "..N..", "..n..", "..n..", "..N..", "..n..", ".nNn."],
  { o: "#4A2E18", y: BRONZE.light, b: BRONZE.face, B: BRONZE.shade, n: WOOD[0], N: WOOD[1] },
);

const BRAZIERS = [
  { x: 103, y: 259, seed: 1 },
  { x: 129, y: 259, seed: 2 },
] as const;
/** Right of the capstone's sledge (clear of the surveyor's spot); the site's own two follow the pyramid's foot. */
const TORCHES = [{ x: 422, y: 214, seed: 2 }] as const;

export interface Torch {
  x: number;
  y: number;
  seed: number;
}

/** Bottom-course width of the smallest pyramid (base 4 of 32 px blocks), for a pyramid that has no size yet. */
const SMALLEST_FOOT = 128;
const SITE_TORCH_LIGHT = 26;

/**
 * The two torches that light the site: 7 px out from the bottom course's corners, so the night's work stands in their
 * light whatever the pyramid's size, the right one kept clear of the sledge and its surveyor.
 */
export function siteTorches(pyramid: { base: number; blockW: number }): Torch[] {
  const width = pyramid.base > 0 && pyramid.blockW > 0 ? pyramid.base * pyramid.blockW : SMALLEST_FOOT;
  const half = Math.min(PYRAMID_AREA.maxWidth, width) / 2;
  const y = PYRAMID_AREA.baseY + 6;
  return [
    { x: Math.round(PYRAMID_AREA.centerX - half - 7), y, seed: 0 },
    { x: Math.min(Math.round(PYRAMID_AREA.centerX + half + 7), PLACES.sledge.x - 26), y, seed: 1 },
  ];
}

export function torchScenery(t: Torch): Scenery {
  return { y: t.y, draw: (p, time, light) => drawStand(p, TORCH, t.x, t.y, t.seed, time, light) };
}

export function torchLight(t: Torch): LightSpot {
  return { x: t.x, y: t.y - 16, radius: SITE_TORCH_LIGHT, seed: t.seed + 3 };
}

export function torchShadow(t: Torch): ShadowSpot {
  return { cx: t.x, y: t.y, rx: 3, ry: 1 };
}

function drawStand(p: Painter, body: Sprite, x: number, y: number, seed: number, time: number, light: ((color: string) => string) | null): void {
  const pos = at(body, x, y);
  p.sprite(body, pos.left, pos.top);
  p.tint(null);
  const flame = SMALL[flameFrame(time, seed)] ?? SMALL[0];
  if (flame) p.sprite(flame, x - 2, pos.top - flame.h + 1);
  p.tint(light);
}

// ---------------------------------------------------------------------------------------------------------------
// The list

const WELL = compileProp(PROPS.well);

/** The fires that light pools at night. */
export const LIGHTS: readonly LightSpot[] = [
  { x: FIRE_AT.x, y: FIRE_AT.y - 4, radius: 26, seed: 0 },
  ...BRAZIERS.map((b) => ({ x: b.x, y: b.y - 12, radius: 20, seed: b.seed })),
  ...TORCHES.map((t) => ({ x: t.x, y: t.y - 16, radius: 20, seed: t.seed + 3 })),
];

/** Where the props' shadows fall (before the sun's offset). */
export const PROP_SHADOWS: readonly ShadowSpot[] = [
  ...TENTS.map((t) => ({ cx: t.x, y: t.bottom, rx: Math.floor(t.sprite.w / 2) - 3, ry: 2 })),
  ...PALMS.map((palm) => ({ cx: palm.x + 1, y: palm.bottom, rx: palm.bottom < 150 ? 3 : 6, ry: 1 })),
  { cx: FIRE_AT.x, y: FIRE_AT.y, rx: 6, ry: 1 },
  { cx: CAMEL_AT.x, y: CAMEL_AT.y, rx: 12, ry: 2 },
  { cx: QUARRY_AT.x, y: QUARRY_AT.y, rx: 23, ry: 2 },
  { cx: PLACES.well.x, y: PLACES.well.y - 2, rx: 11, ry: 2 },
  { cx: Math.round((DAIS.left + DAIS.right) / 2) + 1, y: DAIS.bottom, rx: 21, ry: 2 },
  ...BRAZIERS.map((b) => ({ cx: b.x, y: b.y, rx: 4, ry: 1 })),
  ...TORCHES.map((t) => ({ cx: t.x, y: t.y, rx: 3, ry: 1 })),
];

/** The props on the plain, each with the line actors pass it on. */
export function propScenery(): Scenery[] {
  const out: Scenery[] = [];
  for (const t of TENTS) {
    const pos = at(t.sprite, t.x, t.bottom);
    out.push({ y: t.bottom, draw: (p) => p.sprite(t.sprite, pos.left, pos.top) });
  }
  PALMS.forEach((palm, i) => {
    out.push({
      y: palm.bottom,
      draw: (p, time) => {
        const s = palm.frames[palmFrame(i, time)] ?? palm.frames[0];
        if (!s) return;
        const pos = at(s, palm.x, palm.bottom + 1);
        p.sprite(s, pos.left, pos.top);
      },
    });
  });
  out.push({
    y: CAMEL_AT.y,
    draw: (p, time) => {
      const s = CAMEL_SPRITES[camelPose(time)];
      const pos = at(s, CAMEL_AT.x, CAMEL_AT.y);
      p.sprite(s, pos.left, pos.top);
    },
  });
  out.push({ y: FIRE_AT.y, draw: drawFire });
  const quarry = at(QUARRY_SPRITE, QUARRY_AT.x, QUARRY_AT.y);
  out.push({ y: QUARRY_AT.y, draw: (p) => p.sprite(QUARRY_SPRITE, quarry.left, quarry.top) });
  const well = at(WELL, PLACES.well.x, PLACES.well.y - 2);
  out.push({ y: PLACES.well.y - 2, draw: (p) => p.sprite(WELL, well.left, well.top) });
  out.push({ y: DAIS.top + 1, draw: (p, time) => drawDais(p, time) });
  for (const b of BRAZIERS) out.push({ y: b.y, draw: (p, time, light) => drawStand(p, BRAZIER, b.x, b.y, b.seed, time, light) });
  for (const t of TORCHES) out.push({ y: t.y, draw: (p, time, light) => drawStand(p, TORCH, t.x, t.y, t.seed, time, light) });
  return out;
}
