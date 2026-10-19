// The sky (DESIGN.md §19, the game-studio pass): a dithered gradient per phase, the sun whose color follows its
// height, the moon and twinkling stars, a shooting star, three layers of drifting clouds and a flock of birds. Only
// the gradient is static; the rest is a function of the World's sun and clock.
import type { Sky } from "../../model";
import { HORIZON_Y, WIDTH } from "../../model";
import { BIRD, CLOUDS, MOON, MOON_SHADE, SKY_RAMP, STARS, SUN_HIGH, SUN_LOW, mix } from "../palette";
import type { Painter, Rect } from "./paint";
import { clock, disc, dithered, ditherRing, Pixmap, prng, wrap } from "./paint";

type Phase = Sky["phase"];

/** The sun's arc: a parabola through (40, 112), (240, 26) and (440, 112). */
export function sunPosition(sun: number): { x: number; y: number } {
  const t = Number.isFinite(sun) ? Math.min(1, Math.max(0, sun)) : 0.5;
  const x = 40 + 400 * t;
  return { x, y: 26 + (86 / 200 ** 2) * (x - 240) ** 2 };
}

export const MOON_AT = { x: 400, y: 30 } as const;

/** The sun's colors at a height: warm orange-gold on the horizon (y 112), pale yellow-white at the top (y 26). */
export function sunColors(y: number): { core: string; rim: string; halo: string } {
  const high = Math.min(1, Math.max(0, (112 - y) / 86));
  // Quantized, so a slow sun does not mint a new color every frame.
  const t = Math.round(high ** 0.8 * 24) / 24;
  return {
    core: mix(SUN_LOW.core, SUN_HIGH.core, t),
    rim: mix(SUN_LOW.rim, SUN_HIGH.rim, t),
    halo: mix(SUN_LOW.halo, SUN_HIGH.halo, t),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The gradient

/** Where each band of the ramp ends: tall bands overhead, thin ones near the horizon. */
function bandEnds(levels: number): number[] {
  const ends: number[] = [];
  for (let k = 1; k < levels; k++) ends.push(Math.round(HORIZON_Y * (k / levels) ** 0.78));
  return ends;
}

const skyCache = new Map<Phase, Rect[]>();

/** Rows a seam between two bands spans, half on each side. */
const SEAM = 6;

/**
 * Fills rows [y0, y1) with a ramp of colors in bands ending at `ends`, each boundary a SEAM-row Bayer blend: the share
 * of the next color climbs through the seam, and the base color swaps at its middle.
 */
function rampRows(map: Pixmap, ramp: readonly string[], ends: readonly number[], y0: number, y1: number): void {
  for (let y = y0; y < y1; y++) {
    let level = ends.findIndex((end) => y < end);
    if (level < 0) level = ramp.length - 1;
    let base = ramp[level] ?? "#000000";
    let other: string | null = null;
    let density = 0;
    const below = ends[level];
    const above = level > 0 ? ends[level - 1] : undefined;
    if (below !== undefined && below - y <= SEAM / 2) {
      // Above the boundary: the next band shows through.
      other = ramp[level + 1] ?? base;
      density = (SEAM / 2 - (below - y) + 0.5) / SEAM;
    } else if (above !== undefined && y - above < SEAM / 2) {
      // Below it: the band above lingers.
      other = ramp[level - 1] ?? base;
      density = (SEAM / 2 - (y - above) - 0.5) / SEAM;
    }
    if (other && density > 0.5) [base, other, density] = [other, base, 1 - density];
    for (let x = 0; x < WIDTH; x++) map.set(x, y, other && dithered(x, y, density) ? other : base);
  }
}

/** The sky's gradient down to the horizon: solid bands joined by Bayer seams. */
export function skyRects(phase: Phase): Rect[] {
  const cached = skyCache.get(phase);
  if (cached) return cached;
  const ramp = SKY_RAMP[phase];
  const map = new Pixmap(WIDTH, HORIZON_Y);
  rampRows(map, ramp, bandEnds(ramp.length), 0, HORIZON_Y);
  if (phase === "night") milkyWay(map);
  const rects = map.runs();
  skyCache.set(phase, rects);
  return rects;
}

/** A faint band of dust across the night sky, from the upper left down to the right. */
function milkyWay(map: Pixmap): void {
  const rand = prng(4242);
  for (let i = 0; i < 520; i++) {
    const u = rand();
    const x = Math.floor(u * WIDTH);
    const spread = (rand() + rand() + rand() - 1.5) * 14;
    const y = Math.round(8 + u * 70 + spread + 6 * Math.sin(u * 7));
    if (y < 0 || y >= 100) continue;
    const base = map.get(x, y);
    if (!base) continue;
    const near = Math.abs(spread) < 6;
    map.set(x, y, mix(base, STARS.dim, near ? 0.32 : 0.18));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Sun and moon

const haloCache = new Map<string, { inner: Rect[]; mid: Rect[]; outer: Rect[]; body: Rect[] }>();

function sunParts(colors: { core: string; rim: string; halo: string }): { inner: Rect[]; mid: Rect[]; outer: Rect[]; body: Rect[] } {
  const key = `${colors.core}${colors.rim}`;
  let parts = haloCache.get(key);
  if (!parts) {
    const outer: Rect[] = [];
    disc(outer, 0, 0, 14, colors.halo);
    ditherRing(outer, 0, 0, 15, 19, 0.5, colors.halo);
    const mid: Rect[] = [];
    disc(mid, 0, 0, 11, colors.halo);
    ditherRing(mid, 0, 0, 12, 13, 0.5, colors.rim);
    const inner: Rect[] = [];
    disc(inner, 0, 0, 9, colors.rim);
    const body: Rect[] = [];
    disc(body, 0, 0, 7, colors.rim);
    disc(body, 0, 0, 6, colors.core);
    // A brighter spot toward the upper left.
    body.push({ x: -3, y: -4, w: 4, h: 1, color: colors.rim }, { x: -4, y: -3, w: 3, h: 2, color: colors.rim });
    parts = { inner, mid, outer, body };
    haloCache.set(key, parts);
  }
  return parts;
}

function drawSun(p: Painter, sun: number): void {
  const at = sunPosition(sun);
  const x = Math.round(at.x);
  const y = Math.round(at.y);
  const parts = sunParts(sunColors(at.y));
  p.alpha(0.14);
  p.rects(parts.outer, x, y);
  p.alpha(1);
  p.alpha(0.22);
  p.rects(parts.mid, x, y);
  p.alpha(1);
  p.alpha(0.4);
  p.rects(parts.inner, x, y);
  p.alpha(1);
  p.rects(parts.body, x, y);
}

const MOON_HALO: Rect[] = (() => {
  const out: Rect[] = [];
  disc(out, MOON_AT.x, MOON_AT.y, 11, "#B9C3E6");
  ditherRing(out, MOON_AT.x, MOON_AT.y, 12, 15, 0.5, "#B9C3E6");
  return out;
})();

const MOON_RECTS: Rect[] = (() => {
  const out: Rect[] = [];
  disc(out, MOON_AT.x, MOON_AT.y, 7, MOON);
  // The limb away from the (absent) sun is a shade darker; craters.
  for (let dy = -6; dy <= 6; dy++) {
    const half = Math.floor(Math.sqrt(7.5 ** 2 - dy * dy));
    out.push({ x: MOON_AT.x + half - 1, y: MOON_AT.y + dy, w: 2, h: 1, color: MOON_SHADE });
  }
  out.push(
    { x: MOON_AT.x + 1, y: MOON_AT.y - 3, w: 2, h: 2, color: MOON_SHADE },
    { x: MOON_AT.x - 3, y: MOON_AT.y + 1, w: 3, h: 2, color: MOON_SHADE },
    { x: MOON_AT.x + 3, y: MOON_AT.y + 3, w: 1, h: 1, color: MOON_SHADE },
    { x: MOON_AT.x - 4, y: MOON_AT.y - 4, w: 2, h: 1, color: "#F6F4EA" },
  );
  return out;
})();

function drawMoon(p: Painter): void {
  p.alpha(0.1);
  p.rects(MOON_HALO);
  p.alpha(1);
  p.rects(MOON_RECTS);
}

// ---------------------------------------------------------------------------------------------------------------
// Stars

interface Star {
  x: number;
  y: number;
  /** 0 dim, 1 mid, 2 bright, 3 bright with a cross. */
  level: number;
  /** Radians per second, 0 for a steady star. */
  speed: number;
  phase: number;
}

const STAR_LIST: Star[] = (() => {
  const rand = prng(1907);
  const out: Star[] = [];
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(rand() * WIDTH);
    const y = 2 + Math.floor(rand() ** 1.3 * 98);
    const r = rand();
    const level = r < 0.45 ? 0 : r < 0.8 ? 1 : r < 0.95 ? 2 : 3;
    const twinkles = rand() < 0.3;
    const speed = twinkles ? 1.6 + rand() * 2.6 : 0;
    const phase = rand() * Math.PI * 2;
    if (Math.abs(x - MOON_AT.x) < 14 && Math.abs(y - MOON_AT.y) < 14) continue;
    out.push({ x, y, level, speed, phase });
  }
  return out;
})();

/** How bright a star is now: its level, moved by up to ±1 (and to off) if it twinkles. */
export function starLevel(index: number, time: number): number {
  const star = STAR_LIST[index];
  if (!star) return -1;
  if (star.speed === 0) return star.level;
  const s = Math.sin(clock(time) * star.speed + star.phase);
  return Math.max(-1, Math.min(3, star.level + (s > 0.55 ? 1 : s < -0.55 ? -1 : 0)));
}

export const STAR_COUNT = STAR_LIST.length;

const STEADY: Rect[] = (() => {
  const out: Rect[] = [];
  for (const s of STAR_LIST) if (s.speed === 0) pushStar(out, s.x, s.y, s.level);
  return out;
})();

function pushStar(out: Rect[], x: number, y: number, level: number): void {
  if (level < 0) return;
  const color = level === 0 ? STARS.dim : level === 1 ? STARS.mid : STARS.bright;
  out.push({ x, y, w: 1, h: 1, color });
  if (level >= 3) out.push({ x: x - 1, y, w: 1, h: 1, color: STARS.mid }, { x: x + 1, y, w: 1, h: 1, color: STARS.mid }, { x, y: y - 1, w: 1, h: 1, color: STARS.mid }, { x, y: y + 1, w: 1, h: 1, color: STARS.mid });
}

function drawStars(p: Painter, time: number): void {
  p.rects(STEADY);
  const out: Rect[] = [];
  STAR_LIST.forEach((s, i) => {
    if (s.speed !== 0) pushStar(out, s.x, s.y, starLevel(i, time));
  });
  p.rects(out);
}

/** Seconds between shooting stars, and how long one streaks. */
export const SHOOTING = { every: 40, lasts: 0.6 } as const;

/** The shooting star now: its head, direction and progress (0–1), or null between them. */
export function shootingStar(time: number): { x: number; y: number; dir: 1 | -1; progress: number } | null {
  const t = clock(time);
  const u = t % SHOOTING.every;
  if (u >= SHOOTING.lasts) return null;
  const rand = prng(Math.floor(t / SHOOTING.every) * 7919 + 13);
  const dir: 1 | -1 = rand() < 0.5 ? -1 : 1;
  const x0 = 90 + Math.floor(rand() * 260);
  const y0 = 8 + Math.floor(rand() * 30);
  const progress = u / SHOOTING.lasts;
  const run = 84 * progress;
  return { x: Math.round(x0 + dir * run), y: Math.round(y0 + run * 0.42), dir, progress };
}

const TRAIL = ["#FFFFFF", STARS.bright, STARS.bright, STARS.mid, STARS.mid, STARS.mid, STARS.dim, STARS.dim, STARS.dim, STARS.dim, STARS.dim, STARS.dim];

function drawShootingStar(p: Painter, time: number): void {
  const star = shootingStar(time);
  if (!star) return;
  const length = Math.min(TRAIL.length, 3 + Math.round(star.progress * 22));
  const fade = star.progress > 0.8 ? (1 - star.progress) / 0.2 : 1;
  if (fade < 1) p.alpha(fade);
  for (let i = length - 1; i >= 0; i--) {
    const x = star.x - star.dir * i;
    const y = Math.round(star.y - i * 0.42);
    p.rect(x, y, 1, 1, TRAIL[i] ?? STARS.dim);
  }
  // The head, a touch thicker.
  p.rect(star.x, star.y + 1, 1, 1, STARS.mid);
  if (fade < 1) p.alpha(1);
}

// ---------------------------------------------------------------------------------------------------------------
// Clouds

/** Three layers, far to near: higher layers are nearer, bigger and faster. */
const CLOUD_LAYERS = [
  { speed: 2, count: 4, minW: 24, maxW: 34, y0: 70, y1: 90, alpha: 0.7 },
  { speed: 4, count: 3, minW: 32, maxW: 46, y0: 42, y1: 62, alpha: 0.88 },
  { speed: 6, count: 2, minW: 44, maxW: 56, y0: 10, y1: 30, alpha: 1 },
] as const;

/** The loop a cloud drifts around: wider than the canvas plus the widest cloud. */
export const CLOUD_LOOP = 600;

interface Cloud {
  layer: number;
  x0: number;
  y: number;
  /** Tone per pixel: 0 lit, 1 body, 2 shade; -1 empty. */
  shape: { w: number; h: number; tones: number[] };
}

/** A cloud's shape: bumps on a flat base, lit on top and toward the upper left, shaded underneath. */
export function cloudShape(w: number, seed: number): { w: number; h: number; tones: number[] } {
  const rand = prng(seed);
  // Lobes of a cumulus, small at the ends and tallest left of the middle, on a flat base.
  const n = 4 + Math.floor(w / 18);
  const peak = Math.floor(n * 0.4 + rand() * 1.2);
  const weights: number[] = [];
  for (let i = 0; i < n; i++) weights.push(Math.max(0.35, 1 - Math.abs(i - peak) * (0.22 + rand() * 0.12)) * (0.85 + rand() * 0.3));
  // Neighbouring lobes overlap by a third; then the row is scaled to fit w.
  const centers: number[] = [];
  let c = weights[0] ?? 1;
  weights.forEach((k, i) => {
    if (i > 0) c += 0.65 * ((weights[i - 1] ?? k) + k);
    centers.push(c);
  });
  const extent = c + (weights[n - 1] ?? 1);
  const unit = (w - 1) / extent;
  const h = Math.max(6, Math.round(Math.max(...weights) * unit * 1.5));
  const base = h - 1;
  const bumps = weights.map((k, i) => {
    const r = k * unit;
    return { cx: (centers[i] ?? 0) * unit, cy: base - r * 0.5, r };
  });
  const tones = new Array<number>(w * h).fill(-1);
  const inside = (x: number, y: number): boolean => bumps.some((b) => (x - b.cx) ** 2 + (y - b.cy) ** 2 <= b.r * b.r);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // A flat base with rounded ends.
      const inset = y === h - 1 ? 2 : y === h - 2 ? 1 : 0;
      if (x < inset || x >= w - inset) continue;
      if (inside(x, y)) tones[y * w + x] = 1;
    }
  }
  for (let x = 0; x < w; x++) {
    let top = -1;
    for (let y = 0; y < h; y++) {
      if ((tones[y * w + x] ?? -1) >= 0) {
        top = y;
        break;
      }
    }
    if (top < 0) continue;
    for (let y = top; y < h; y++) {
      const i = y * w + x;
      if ((tones[i] ?? -1) < 0) continue;
      const fromTop = y - top;
      const fromBottom = h - 1 - y;
      // Light falls from the upper left: the left side of each bump keeps its lit rim a row longer.
      const leftLit = (tones[i - 1] ?? -1) < 0 || x === 0;
      if (fromTop <= 1 || (fromTop <= 2 && leftLit)) tones[i] = 0;
      else if (fromBottom <= 1 || (fromBottom === 2 && (x + y) % 2 === 0)) tones[i] = 2;
    }
  }
  return { w, h, tones };
}

const CLOUD_LIST: Cloud[] = (() => {
  const rand = prng(611);
  const out: Cloud[] = [];
  CLOUD_LAYERS.forEach((layer, li) => {
    for (let i = 0; i < layer.count; i++) {
      const w = layer.minW + Math.floor(rand() * (layer.maxW - layer.minW + 1));
      const y = layer.y0 + Math.floor(rand() * (layer.y1 - layer.y0));
      const x0 = (i * CLOUD_LOOP) / layer.count + Math.floor(rand() * 60);
      out.push({ layer: li, x0, y, shape: cloudShape(w, 100 + li * 10 + i) });
    }
  });
  return out;
})();

/** A cloud's left edge now: it drifts right at its layer's speed and wraps around CLOUD_LOOP. */
export function cloudX(index: number, time: number): number {
  const c = CLOUD_LIST[index];
  if (!c) return 0;
  const speed = CLOUD_LAYERS[c.layer]?.speed ?? 0;
  return Math.floor(wrap(c.x0 + speed * clock(time), CLOUD_LOOP)) - (CLOUD_LOOP - WIDTH);
}

export const CLOUD_COUNT = CLOUD_LIST.length;

const cloudRectCache = new Map<string, Rect[]>();
function cloudRects(index: number, phase: Phase): Rect[] {
  const key = `${index}:${phase}`;
  let rects = cloudRectCache.get(key);
  if (!rects) {
    const c = CLOUD_LIST[index];
    rects = [];
    if (c) {
      const { w, h, tones } = c.shape;
      const map = new Pixmap(w, h);
      const colors = CLOUDS[phase];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const t = tones[y * w + x] ?? -1;
        if (t >= 0) map.set(x, y, colors[t] ?? colors[1]);
      }
      rects = map.runs();
    }
    cloudRectCache.set(key, rects);
  }
  return rects;
}

function drawClouds(p: Painter, phase: Phase, time: number): void {
  for (let layer = 0; layer < CLOUD_LAYERS.length; layer++) {
    const alpha = (CLOUD_LAYERS[layer]?.alpha ?? 1) * (phase === "night" ? 0.5 : 1);
    if (alpha < 1) p.alpha(alpha);
    CLOUD_LIST.forEach((c, i) => {
      if (c.layer === layer) p.rects(cloudRects(i, phase), cloudX(i, time), c.y);
    });
    if (alpha < 1) p.alpha(1);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Birds

/** A flock crosses every `every` seconds at `speed` px/s. */
export const FLOCK = { every: 45, speed: 30 } as const;

const FLIGHT = (WIDTH + 90) / FLOCK.speed;

/** The birds in the sky now, with their wing frame (0 up, 1 down); none between crossings. */
export function flock(time: number): { x: number; y: number; frame: 0 | 1 }[] {
  const t = clock(time);
  const u = t % FLOCK.every;
  if (u >= FLIGHT) return [];
  const k = Math.floor(t / FLOCK.every);
  const rand = prng(k * 104729 + 7);
  const count = 3 + Math.floor(rand() * 3);
  const y0 = 44 + Math.floor(rand() * 28);
  const dir = k % 2 === 0 ? 1 : -1;
  const lead = dir === 1 ? -12 + FLOCK.speed * u : WIDTH + 12 - FLOCK.speed * u;
  const out: { x: number; y: number; frame: 0 | 1 }[] = [];
  for (let j = 0; j < count; j++) {
    const back = j === 0 ? 0 : 6 * Math.ceil(j / 2) + Math.floor(rand() * 3);
    const side = j === 0 ? 0 : (j % 2 === 1 ? -1 : 1) * (3 * Math.ceil(j / 2) + Math.floor(rand() * 2));
    const bob = Math.round(Math.sin(u * 2.1 + j * 1.7));
    const frame = (Math.floor(u * 6 + j * 0.5) % 2) as 0 | 1;
    out.push({ x: Math.round(lead - dir * back), y: y0 + side + bob, frame });
  }
  return out;
}

function drawBirds(p: Painter, phase: Phase, time: number): void {
  if (phase === "night") return;
  const color = BIRD[phase];
  for (const b of flock(time)) {
    if (b.frame === 0) {
      p.rect(b.x - 1, b.y, 1, 1, color);
      p.rect(b.x + 1, b.y, 1, 1, color);
      p.rect(b.x, b.y + 1, 1, 1, color);
    } else {
      p.rect(b.x, b.y, 1, 1, color);
      p.rect(b.x - 1, b.y + 1, 1, 1, color);
      p.rect(b.x + 1, b.y + 1, 1, 1, color);
    }
  }
}

/** Everything above the land: the gradient, the sun or the moon and stars, clouds and birds. */
export function drawSky(p: Painter, sky: Sky, time: number): void {
  p.rects(skyRects(sky.phase));
  if (sky.phase === "night") {
    drawStars(p, time);
    drawShootingStar(p, time);
    drawMoon(p);
  } else {
    drawSun(p, sky.sun);
  }
  drawClouds(p, sky.phase, time);
  drawBirds(p, sky.phase, time);
}
