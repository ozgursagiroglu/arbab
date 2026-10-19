// The land (DESIGN.md §19, the game-studio pass), back to front: the valley's cliffs and the far dunes, a caravan
// crossing them, the far bank with its fields, temple pylon and obelisks, the Nile with its glints and a felucca, and
// the plain with its worn paths. The layers are drawn once per phase into run lists; what moves is drawn per frame.
import type { Sky } from "../../model";
import { HEIGHT, HORIZON_Y, PLACES, WIDTH } from "../../model";
import {
  BANK_GREEN,
  CAMEL,
  CLIFFS,
  FAR_DUNES,
  FAR_STONE,
  GLINT,
  GOLD,
  PATH,
  PEBBLE,
  PLAIN,
  REED,
  RIVER,
  SAIL,
  SCRUB,
  SKY_RAMP,
  WOOD,
  mix,
} from "../palette";
import type { Sprite } from "../sprites";
import { compile } from "../sprites";
import type { Painter, Rect } from "./paint";
import { clock, dithered, lightOf, Pixmap, prng, wrap } from "./paint";

type Phase = Sky["phase"];

/** The rows of the river: its far edge is the horizon. */
export const RIVER_TOP = HORIZON_Y;
export const RIVER_BOTTOM = 136;

// ---------------------------------------------------------------------------------------------------------------
// Cliffs and far dunes

interface Mesa {
  c: number;
  half: number;
  h: number;
}

function mesas(seed: number, count: number, minH: number, maxH: number): Mesa[] {
  const rand = prng(seed);
  const out: Mesa[] = [];
  for (let i = 0; i < count; i++) {
    const big = rand() < 0.55;
    out.push({
      c: Math.floor(((i + rand() * 0.9) / count) * (WIDTH + 80)) - 40,
      half: big ? 14 + Math.floor(rand() * 26) : 3 + Math.floor(rand() * 8),
      h: big ? minH + Math.floor(rand() * (maxH - minH + 1)) : minH - 2 + Math.floor(rand() * 6),
    });
  }
  return out;
}

/** A small integer hash, for texture that must not change between frames. */
function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A row of flat-topped hills: steep faces, a gentler talus at the foot, a worn edge with notches. */
function mesaHeights(list: readonly Mesa[], floor: (x: number) => number, seed: number): number[] {
  const out: number[] = [];
  for (let x = 0; x < WIDTH; x++) {
    let h = floor(x);
    for (const m of list) {
      const d = Math.abs(x - m.c) - m.half;
      // Plateaus sag a little toward their ends.
      const top = m.h - (d <= 0 ? Math.round(((Math.abs(x - m.c) / Math.max(1, m.half)) ** 3) * 1.5) : 0);
      const at = d <= 0 ? top : Math.max(m.h - 2.6 * d, m.h * 0.6 - 0.5 * d);
      h = Math.max(h, at);
    }
    out.push(h);
  }
  // Notches: narrow gullies cut into the rims.
  const rand = prng(seed);
  for (let i = 0; i < 14; i++) {
    const cx = Math.floor(rand() * WIDTH);
    const depth = 1 + Math.floor(rand() * 3);
    const half = 1 + Math.floor(rand() * 2);
    for (let dx = -half; dx <= half; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= WIDTH) continue;
      out[x] = (out[x] ?? 0) - Math.max(0, depth - Math.abs(dx));
    }
  }
  return out.map((h, x) => Math.round(h - (hash(x * 3 + seed) % 7 === 0 ? 1 : 0)));
}

interface Shades {
  light: string;
  face: string;
  shade: string;
}

/**
 * Fills each column from its top down to `bottom`: a lit rim, faces toward the light (rising to the right) lit and
 * faces away shaded, with broken strata and gullies on the cliffs.
 */
function terrain(map: Pixmap, heights: readonly number[], c: Shades, bottom: number, strata: boolean): void {
  for (let x = 0; x < WIDTH; x++) {
    const h = heights[x] ?? 0;
    const top = bottom - h;
    const slope = (heights[x + 1] ?? h) - (heights[x - 1] ?? h);
    const gully = strata && hash(x * 11 + 5) % 13 === 0 ? 2 + (hash(x) % 6) : 0;
    for (let y = top; y < bottom; y++) {
      const depth = y - top;
      let color = c.face;
      if (slope >= 2 && depth < Math.max(2, h * 0.55)) color = c.light;
      else if (slope <= -2 && depth < Math.max(2, h * 0.6)) color = c.shade;
      else if (slope <= -2 && depth < h * 0.75) color = dithered(x, y, 0.5) ? c.shade : c.face;
      else if (depth === 0) color = c.light;
      if (strata && depth >= 3) {
        // A layer line every four rows, running on for a while and then breaking off.
        const row = bottom - y;
        const line = row % 4 === 0 && hash(Math.floor((x + row * 13) / 17) * 7 + row) % 4 !== 0;
        if (line) color = color === c.light ? c.face : c.shade;
        if (depth > 1 && depth < 2 + gully) color = c.shade;
      }
      map.set(x, y, color);
    }
  }
}

function farDuneHeights(): number[] {
  const out: number[] = [];
  for (let x = 0; x < WIDTH; x++) out.push(Math.max(3, Math.round(8 + 3 * Math.sin(x / 37 + 0.5) + 2 * Math.sin(x / 13 + 2))));
  return out;
}

/** The cliffs, farthest and palest first, and the far dunes in front of them. */
function farLand(map: Pixmap): void {
  const [far, near] = CLIFFS;
  const back = mesaHeights(mesas(31, 11, 21, 31), (x) => 14 + 2 * Math.sin(x / 29), 3);
  terrain(map, back, far, HORIZON_Y, true);
  const front = mesaHeights(mesas(57, 9, 12, 19), (x) => 9 + 2 * Math.sin(x / 23 + 1), 4);
  terrain(map, front, near, HORIZON_Y, true);
  terrain(map, farDuneHeights(), FAR_DUNES, HORIZON_Y, false);
}

// ---------------------------------------------------------------------------------------------------------------
// The far bank: fields, trees, the temple pylon and two obelisks

const PYLON_X = 428;
const OBELISKS = [404, 454] as const;

function farBank(map: Pixmap): void {
  const rand = prng(97);
  // A strip of fields along the water.
  for (let x = 0; x < WIDTH; x++) {
    map.set(x, HORIZON_Y - 3, dithered(x, HORIZON_Y - 3, 0.5) ? BANK_GREEN.light : BANK_GREEN.face);
    map.set(x, HORIZON_Y - 2, BANK_GREEN.face);
    map.set(x, HORIZON_Y - 1, BANK_GREEN.shade);
  }
  // Groves of round trees and a few palms.
  let x = 4;
  while (x < WIDTH) {
    const n = 1 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      const cx = x + i * 4;
      if (rand() < 0.3) {
        // A small palm: a trunk and a fan of fronds.
        const top = HORIZON_Y - 9 - Math.floor(rand() * 2);
        for (let y = top + 2; y < HORIZON_Y - 2; y++) map.set(cx, y, BANK_GREEN.shade);
        map.fill(cx - 2, top, 5, 1, BANK_GREEN.face);
        map.set(cx - 3, top + 1, BANK_GREEN.shade);
        map.set(cx + 3, top + 1, BANK_GREEN.shade);
        map.fill(cx - 1, top - 1, 3, 1, BANK_GREEN.light);
      } else {
        const r = 2 + Math.floor(rand() * 2);
        const cy = HORIZON_Y - 3 - r;
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (dx * dx + dy * dy > r * r + 1) continue;
            const lit = dx + dy < -1;
            const dark = dx + dy > 1;
            map.set(cx + dx, cy + dy, lit ? BANK_GREEN.light : dark ? BANK_GREEN.shade : BANK_GREEN.face);
          }
        }
      }
    }
    x += n * 4 + 10 + Math.floor(rand() * 26);
  }
  pylon(map, PYLON_X, HORIZON_Y - 1);
  for (const ox of OBELISKS) obelisk(map, ox, HORIZON_Y - 1);
}

/** Two battered towers with a gate between them, on the ground line `base`. */
function pylon(map: Pixmap, cx: number, base: number): void {
  const tower = (left: number, right: number): void => {
    const h = 17;
    for (let r = 0; r < h; r++) {
      const y = base - r;
      // The walls lean in: one pixel every six rows on each side.
      const inset = Math.floor(r / 6);
      const x0 = left + inset;
      const x1 = right - inset;
      for (let x = x0; x <= x1; x++) {
        let color: string = FAR_STONE.face;
        if (x === x0) color = FAR_STONE.light;
        else if (x >= x1 - 1) color = FAR_STONE.shade;
        map.set(x, y, color);
      }
    }
    // The cornice and its shadow.
    const top = base - h;
    const inset = Math.floor((h - 1) / 6);
    map.fill(left + inset - 1, top, right - left - 2 * inset + 3, 1, FAR_STONE.light);
    map.fill(left + inset, top + 1, right - left - 2 * inset + 1, 1, FAR_STONE.shade);
    // Carved reliefs: faint figures.
    for (let k = 0; k < 2; k++) {
      const fx = left + 3 + k * 4;
      map.fill(fx, base - 11, 1, 5, FAR_STONE.shade);
      map.set(fx + 1, base - 10, FAR_STONE.shade);
    }
    // A flagstaff with a red pennant in front of the tower.
    const fx = left + 1 + Math.floor((right - left) / 2);
    for (let y = top - 6; y <= base; y++) map.set(fx, y, FAR_STONE.dark);
    map.fill(fx + 1, top - 6, 2, 1, "#B8433A");
    map.set(fx + 1, top - 5, "#8E2F2B");
  };
  tower(cx - 15, cx - 4);
  tower(cx + 4, cx + 15);
  // The gate: a lintel over a dark doorway.
  map.fill(cx - 4, base - 11, 9, 1, FAR_STONE.light);
  map.fill(cx - 4, base - 10, 9, 1, FAR_STONE.face);
  map.fill(cx - 3, base - 9, 7, 10, FAR_STONE.face);
  map.fill(cx - 2, base - 8, 5, 9, FAR_STONE.dark);
  map.fill(cx - 2, base - 8, 5, 1, FAR_STONE.shade);
}

function obelisk(map: Pixmap, cx: number, base: number): void {
  const h = 21;
  for (let r = 0; r < h - 3; r++) {
    const y = base - r;
    const wide = r < 9;
    map.set(cx - 1, y, FAR_STONE.light);
    map.set(cx, y, FAR_STONE.face);
    if (wide) map.set(cx + 1, y, FAR_STONE.shade);
  }
  // The gilded pyramidion.
  map.set(cx - 1, base - h + 3, GOLD.light);
  map.set(cx, base - h + 3, GOLD.mid);
  map.set(cx, base - h + 2, GOLD.light);
  // Its plinth.
  map.fill(cx - 2, base, 5, 1, FAR_STONE.shade);
}

// ---------------------------------------------------------------------------------------------------------------
// The river

function river(map: Pixmap, bank: Pixmap, phase: Phase): void {
  // The far half mirrors the sky at the horizon: pale blue by day, gold at dusk, deep blue at night.
  const ramp = SKY_RAMP[phase];
  const mirror = mix(RIVER.sky, ramp[ramp.length - 1] ?? RIVER.sky, 0.6);
  const mirrorLow = mix(RIVER.light, ramp[ramp.length - 2] ?? RIVER.light, 0.45);
  const rows: [string, string, number][] = [
    [mix(BANK_GREEN.shade, RIVER.face, 0.45), mirror, 0.25],
    [mirror, mirrorLow, 0.25],
    [mirrorLow, mirror, 0.25],
    [mirrorLow, RIVER.face, 0.5],
    [RIVER.face, RIVER.light, 0.12],
    [RIVER.face, RIVER.deep, 0.25],
    [RIVER.deep, RIVER.face, 0.25],
    [RIVER.deep, RIVER.bank, 0.12],
  ];
  rows.forEach(([base, other, density], i) => {
    const y = RIVER_TOP + i;
    for (let x = 0; x < WIDTH; x++) map.set(x, y, dithered(x, y, density) ? other : base);
  });
  // The far bank's tall things mirrored in the first rows, broken by ripples.
  for (let x = 0; x < WIDTH; x++) {
    for (let k = 1; k <= 5; k++) {
      const above = bank.get(x, HORIZON_Y - 3 - k);
      if (!above || !dithered(x, RIVER_TOP + k, 0.55 - k * 0.08)) continue;
      const y = RIVER_TOP + k;
      map.set(x, y, mix(map.get(x, y) ?? RIVER.face, above, 0.45));
    }
  }
}

/** Glints on the water: short dashes that drift downstream and blink. */
const GLINTS = (() => {
  const rand = prng(23);
  return Array.from({ length: 26 }, () => ({
    x: rand() * WIDTH,
    y: RIVER_TOP + 1 + Math.floor(rand() * 6),
    w: 1 + Math.floor(rand() * 3),
    speed: 3 + rand() * 4,
    blink: 1.2 + rand() * 2.4,
    phase: rand() * Math.PI * 2,
  }));
})();

export const GLINT_LOOP = WIDTH + 8;

/** The glints showing now: position and width. */
export function glints(time: number): { x: number; y: number; w: number }[] {
  const t = clock(time);
  const out: { x: number; y: number; w: number }[] = [];
  for (const g of GLINTS) {
    if (Math.sin(t * g.blink + g.phase) < -0.3) continue;
    out.push({ x: Math.floor(wrap(g.x + g.speed * t, GLINT_LOOP)) - 4, y: g.y, w: g.w });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The felucca

const FELUCCA_GRID = [
  "....y................",
  "....nS...............",
  "....nSS..............",
  "....nsSS.............",
  "....nsSSS............",
  "....nssSSS...........",
  ".....nsSSSS..........",
  ".....nssSSSS.........",
  ".....nssSSSSS........",
  ".....nssSSSSSS.......",
  ".....nssSSSSSSS......",
  "...k.nssSSSSSSSn.....",
  "...w.NnnnnnnnnnnN...n",
  "n..w.....N.........nN",
  "NnnnnnnnnnnnnnnnnnnN.",
  ".NNNNNNNNNNNNNNNNNNN.",
  "..oooooooooooooooo...",
] as const;

const FELUCCA_COLORS: Readonly<Record<string, string>> = {
  S: SAIL.light,
  s: SAIL.shade,
  n: WOOD[0],
  N: WOOD[1],
  o: "#4A2E18",
  y: GOLD.light,
  k: "#B9784E",
  w: "#F4F0E2",
};

const FELUCCA: Sprite = compile(FELUCCA_GRID, FELUCCA_COLORS);

/** A felucca sails left to right for `crossing` seconds out of every `every`. */
export const SAILING = { every: 120, crossing: 80 } as const;

/** Where the felucca's hull bottom is now, or null while it is off the river. */
export function feluccaAt(time: number): { x: number; y: number } | null {
  const u = clock(time) % SAILING.every;
  if (u >= SAILING.crossing) return null;
  const from = -FELUCCA.w - 2;
  const to = WIDTH + 2;
  const x = Math.round(from + ((to - from) * u) / SAILING.crossing);
  // A gentle bob of one pixel.
  const bob = Math.sin(u * 1.9) > 0.55 ? -1 : 0;
  return { x, y: RIVER_BOTTOM - 1 + bob };
}

function drawFelucca(p: Painter, time: number): void {
  const at = feluccaAt(time);
  if (!at) return;
  const top = at.y - FELUCCA.h + 1;
  p.sprite(FELUCCA, at.x, top);
  // The sail's reflection, broken by the water.
  for (let x = 6; x < 15; x++) if ((x + at.x) % 2 === 0) p.rect(at.x + x, at.y + 1, 1, 1, SAIL.shade);
}

// ---------------------------------------------------------------------------------------------------------------
// The caravan

const CAMEL_FRAMES = [
  [
    ".ll.........",
    "lffl........",
    "o.ff..rqr...",
    "..ff.lrqrl..",
    "..fflffffffl",
    "...ffffffffs",
    "...sssssss..",
    "...f.s..f.s.",
    "...f.s..f.s.",
    "...d.d..d.d.",
  ],
  [
    ".ll.........",
    "lffl........",
    "o.ff..rqr...",
    "..ff.lrqrl..",
    "..fflffffffl",
    "...ffffffffs",
    "...sssssss..",
    "....fs...fs.",
    "....fs...fs.",
    "....dd...dd.",
  ],
] as const;

const WALKER_FRAMES = [
  [".w..", "wwk.", ".wn.", ".Bn.", ".Bn.", ".Wn.", ".W.n", "k.k."],
  [".w..", "wwk.", ".wn.", ".Bn.", ".Bn.", ".Wn.", ".Wn.", ".kk."],
] as const;

const CARAVAN_COLORS: Readonly<Record<string, string>> = {
  l: CAMEL.light,
  f: CAMEL.face,
  s: CAMEL.shade,
  d: CAMEL.dark,
  o: CAMEL.dark,
  r: "#B8433A",
  q: "#F2E4C2",
  w: "#F4F0E2",
  W: "#D6CFBC",
  B: "#3C6FB0",
  k: "#925A38",
  n: WOOD[0],
};

const CAMELS: Sprite[] = CAMEL_FRAMES.map((g) => compile(g, CARAVAN_COLORS));
const WALKERS: Sprite[] = WALKER_FRAMES.map((g) => compile(g, CARAVAN_COLORS));

/** The caravan crosses the far dunes right to left for `crossing` seconds out of every `every`. */
export const CARAVAN = { every: 180, crossing: 70, feet: HORIZON_Y - 4 } as const;

/** The caravan's members now (the walker first), with their walk frame; empty while it is away. */
export function caravanAt(time: number): { kind: "walker" | "camel"; x: number; frame: number }[] {
  const u = clock(time) % CARAVAN.every;
  if (u >= CARAVAN.crossing) return [];
  const span = WIDTH + 70;
  const lead = Math.round(WIDTH + 6 - (span * u) / CARAVAN.crossing);
  const step = Math.floor(u * 4);
  return [
    { kind: "walker", x: lead, frame: step % 2 },
    { kind: "camel", x: lead + 6, frame: (step + 1) % 2 },
    { kind: "camel", x: lead + 20, frame: step % 2 },
    { kind: "camel", x: lead + 34, frame: (step + 1) % 2 },
  ];
}

function drawCaravan(p: Painter, time: number): void {
  for (const m of caravanAt(time)) {
    const sprite = (m.kind === "walker" ? WALKERS : CAMELS)[m.frame] ?? CAMELS[0];
    if (sprite) p.sprite(sprite, m.x, CARAVAN.feet - sprite.h);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The plain

/** Points of the worn paths: from the village path and the camp to the audience spot, and on to the site's foot. */
const PATHS: readonly (readonly [number, number])[][] = [
  [
    [-12, 250],
    [40, 252],
    [96, 256],
    [PLACES.audience.x, PLACES.audience.y - 1],
  ],
  [
    [52, 230],
    [84, 240],
    [118, 250],
    [PLACES.audience.x, PLACES.audience.y - 1],
  ],
  [
    [PLACES.audience.x, PLACES.audience.y - 1],
    [176, 246],
    [206, 230],
    [236, 216],
    [258, 211],
  ],
];

function distanceToPath(x: number, y: number, path: readonly (readonly [number, number])[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, ay] = path[i] ?? [0, 0];
    const [bx, by] = path[i + 1] ?? [0, 0];
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len));
    const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
    best = Math.min(best, d);
  }
  return best;
}

function plain(map: Pixmap): void {
  const top = RIVER_BOTTOM;
  // Sand bands from the bank to the front, joined by dithered seams.
  const stops = [top, 146, 166, 196, 232, 262];
  for (let y = top; y < HEIGHT; y++) {
    let level = stops.findIndex((s, i) => y >= s && y < (stops[i + 1] ?? HEIGHT));
    if (level < 0) level = 0;
    const here = PLAIN[level] ?? PLAIN[0];
    const next = stops[level + 1];
    const prev = stops[level];
    let other: string | null = null;
    let density = 0;
    if (next !== undefined && next - y <= 2) {
      other = PLAIN[level + 1] ?? here;
      density = next - y === 1 ? 3 / 8 : 1 / 8;
    } else if (prev !== undefined && level > 0 && y - prev <= 1) {
      other = PLAIN[level - 1] ?? here;
      density = y - prev === 0 ? 3 / 8 : 1 / 8;
    }
    for (let x = 0; x < WIDTH; x++) map.set(x, y, other && dithered(x, y, density) ? other : here);
  }
  // The wet bank.
  for (let x = 0; x < WIDTH; x++) {
    map.set(x, top, RIVER.bank);
    if (dithered(x, top + 1, 0.5)) map.set(x, top + 1, RIVER.bank);
  }
  dunes(map);
  ripples(map);
  paths(map);
  pebbles(map);
  boulders(map);
  scrub(map);
  reeds(map);
}

/** Low dunes rising from the front edge: the slope toward the light lighter, the lee side darker, a crisp crest. */
const FRONT_DUNES = [
  { cx: 300, hw: 120, h: 16, bottom: HEIGHT + 2 },
  { cx: 470, hw: 86, h: 26, bottom: HEIGHT + 2 },
  { cx: 214, hw: 56, h: 7, bottom: 238 },
  { cx: 372, hw: 50, h: 6, bottom: 224 },
] as const;

function dunes(map: Pixmap): void {
  for (const d of FRONT_DUNES) {
    const peakY = d.bottom - d.h;
    for (let x = Math.max(0, d.cx - d.hw); x < Math.min(WIDTH, d.cx + d.hw); x++) {
      const u = (x - d.cx) / d.hw;
      const crest = Math.round(d.bottom - d.h * (1 - u * u) ** 0.8);
      for (let y = crest; y < Math.min(HEIGHT, d.bottom); y++) {
        const base = map.get(x, y);
        if (!base) continue;
        // The spine leans to the right as it comes down from the peak.
        const spine = d.cx + (y - peakY) * 0.9;
        const lit = x < spine;
        const edge = Math.abs(x - spine) < 2;
        const sunny = mix(base, "#FFF4D6", 0.26);
        const lee = mix(base, "#8A5E2E", 0.17);
        let color: string;
        if (y === crest) color = lit ? mix(base, "#FFF4D6", 0.5) : mix(base, "#8A5E2E", 0.26);
        else if (edge) color = dithered(x, y, 0.5) ? sunny : lee;
        else if (y - crest < 2) color = dithered(x, y, 0.5) ? (lit ? sunny : lee) : base;
        else color = lit ? sunny : lee;
        map.set(x, y, color);
      }
    }
  }
}

/** A few boulders half sunk in the sand. */
function boulders(map: Pixmap): void {
  const list = [
    { x: 6, y: 266, w: 10, h: 6 },
    { x: 16, y: 268, w: 6, h: 4 },
    { x: 228, y: 266, w: 9, h: 5 },
    { x: 238, y: 267, w: 5, h: 3 },
    { x: 404, y: 240, w: 8, h: 5 },
    { x: 336, y: 228, w: 6, h: 4 },
    { x: 182, y: 186, w: 7, h: 4 },
  ];
  for (const b of list) {
    const ground = map.get(b.x + b.w, b.y);
    if (ground) map.fill(b.x + 2, b.y, b.w, 1, mix(ground, "#6B4A28", 0.35));
    for (let r = 0; r < b.h; r++) {
      const y = b.y - b.h + r;
      // Rounded: the top row is the narrowest.
      const inset = r === 0 ? 2 : r === 1 ? 1 : 0;
      for (let x = b.x + inset; x < b.x + b.w - inset; x++) {
        const t = (x - b.x) / b.w + r / b.h;
        let color: string = t < 0.5 ? PEBBLE.light : t < 1.15 ? PEBBLE.face : PEBBLE.shade;
        if (r === b.h - 1 || x === b.x + b.w - inset - 1) color = PEBBLE.shade;
        map.set(x, y, color);
      }
    }
  }
}

/** Wind ripples: short arcs, lit on top and shaded below, longer toward the front. */
function ripples(map: Pixmap): void {
  const rand = prng(77);
  for (let i = 0; i < 150; i++) {
    const depth = rand() ** 0.8;
    const y = Math.floor(RIVER_BOTTOM + 6 + depth * (HEIGHT - RIVER_BOTTOM - 8));
    const x0 = Math.floor(rand() * WIDTH);
    const len = 3 + Math.floor(depth * 12 + rand() * 4);
    const rise = Math.max(1, Math.round(len / 9));
    for (let k = 0; k < len; k++) {
      const x = x0 + k;
      const off = -Math.round(Math.sin((Math.PI * k) / Math.max(1, len - 1)) * rise);
      const base = map.get(x, y + off);
      if (!base) continue;
      map.set(x, y + off, mix(base, "#FFF4DA", 0.32));
      const below = map.get(x, y + off + 1);
      if (below) map.set(x, y + off + 1, mix(below, "#8A5E2E", 0.22));
    }
  }
}

function paths(map: Pixmap): void {
  for (let y = RIVER_BOTTOM; y < HEIGHT; y++) {
    // Wider toward the front.
    const r = 2 + (y - 200) / 40;
    if (r < 1.5) continue;
    for (let x = 0; x < WIDTH; x++) {
      let d = Infinity;
      for (const path of PATHS) d = Math.min(d, distanceToPath(x, y, path));
      if (d > r + 1) continue;
      const core = d < r - 0.5;
      if (!core && !dithered(x, y, 0.5)) continue;
      let color: string = core ? PATH.face : PATH.light;
      // Footprints and wheel marks, sparse.
      if (core && ((x * 13 + y * 7) % 17 === 0 || (x * 5 + y * 11) % 23 === 0)) color = PATH.track;
      else if (core && dithered(x, y, 0.2)) color = PATH.light;
      map.set(x, y, color);
    }
  }
}

function pebbles(map: Pixmap): void {
  const rand = prng(301);
  for (let i = 0; i < 56; i++) {
    const depth = rand();
    const y = Math.floor(RIVER_BOTTOM + 8 + depth * (HEIGHT - RIVER_BOTTOM - 12));
    const x = Math.floor(rand() * WIDTH);
    const size = depth > 0.6 && rand() < 0.5 ? 3 : depth > 0.25 ? 2 : 1;
    const ground = map.get(x + size, y + 1);
    if (ground) map.fill(x + 1, y + 1, size, 1, mix(ground, "#6B4A28", 0.3));
    if (size === 1) {
      map.set(x, y, PEBBLE.face);
      continue;
    }
    map.fill(x, y, size, size - 1, PEBBLE.face);
    map.fill(x, y, size - 1, 1, PEBBLE.light);
    map.fill(x, y + size - 1, size, 1, PEBBLE.shade);
  }
}

/** Dry scrub, mostly along the bank and the edges. */
function scrub(map: Pixmap): void {
  const rand = prng(503);
  for (let i = 0; i < 22; i++) {
    const nearBank = i < 12;
    const x = Math.floor(rand() * WIDTH);
    const y = nearBank ? RIVER_BOTTOM + 4 + Math.floor(rand() * 14) : 150 + Math.floor(rand() * 110);
    const w = 3 + Math.floor(rand() * 4);
    const ground = map.get(x, y + 1);
    if (ground) map.fill(x, y + 1, w, 1, mix(ground, "#6B4A28", 0.25));
    for (let k = 0; k < w; k++) {
      const h = 1 + Math.round(Math.sin((Math.PI * (k + 0.5)) / w) * (1 + (w > 4 ? 1 : 0)));
      for (let j = 0; j < h; j++) {
        const color = j === h - 1 ? (k < w / 2 ? SCRUB.light : SCRUB.face) : (k + j) % 2 === 0 ? SCRUB.face : SCRUB.shade;
        map.set(x + k, y - j, color);
      }
    }
  }
}

/** Reeds along the near bank, rising over the water's edge. */
function reeds(map: Pixmap): void {
  const rand = prng(211);
  let x = 0;
  while (x < WIDTH) {
    const n = 2 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      const rx = x + i;
      const h = 2 + Math.floor(rand() * 4);
      for (let j = 0; j < h; j++) {
        const y = RIVER_BOTTOM + 1 - j;
        map.set(rx, y, j === h - 1 && rand() < 0.4 ? REED.tip : i % 2 === 0 ? REED.face : j > h / 2 ? REED.light : REED.shade);
      }
    }
    x += n + 2 + Math.floor(rand() * 9);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Layers

interface Layers {
  far: Rect[];
  bank: Rect[];
  water: Rect[];
  plain: Rect[];
}

const layerCache = new Map<Phase, Layers>();

/** The static land of a phase, lit by its light: built once, then drawn as runs. */
export function landLayers(phase: Phase): Layers {
  let layers = layerCache.get(phase);
  if (!layers) {
    const light = lightOf(phase);
    const far = new Pixmap(WIDTH, HEIGHT);
    farLand(far);
    const bank = new Pixmap(WIDTH, HEIGHT);
    farBank(bank);
    const water = new Pixmap(WIDTH, HEIGHT);
    river(water, bank, phase);
    const ground = new Pixmap(WIDTH, HEIGHT);
    plain(ground);
    layers = { far: far.runs(light), bank: bank.runs(light), water: water.runs(light), plain: ground.runs(light) };
    layerCache.set(phase, layers);
  }
  return layers;
}

/** The cliffs and far dunes, and the caravan crossing them. */
export function drawFarLand(p: Painter, phase: Phase, time: number): void {
  const layers = landLayers(phase);
  p.rects(layers.far);
  p.tint(lightOf(phase));
  drawCaravan(p, time);
  p.tint(null);
  p.rects(layers.bank);
}

/** The river with its glints and the felucca, then the plain and the reeds of the near bank. */
export function drawRiverAndPlain(p: Painter, phase: Phase, time: number): void {
  const layers = landLayers(phase);
  p.rects(layers.water);
  const color = GLINT[phase];
  for (const g of glints(time)) p.rect(g.x, g.y, g.w, 1, color);
  p.tint(lightOf(phase));
  drawFelucca(p, time);
  p.tint(null);
  p.rects(layers.plain);
  if (phase === "day") drawShimmer(p, time);
}

/** The heat over the sand by day: a faint row of dashes that crawls with the clock. */
export function shimmerShift(time: number): number {
  return Math.floor(clock(time) * 5) % 8;
}

function drawShimmer(p: Painter, time: number): void {
  const shift = shimmerShift(time);
  p.alpha(0.22);
  for (let row = 0; row < 3; row++) {
    const y = RIVER_BOTTOM + 3 + row * 2;
    const s = row % 2 === 0 ? shift : 7 - shift;
    for (let x = -8 + s; x < WIDTH; x += 8) p.rect(x, y, 3, 1, "#FFF6E0");
  }
  p.alpha(1);
}
