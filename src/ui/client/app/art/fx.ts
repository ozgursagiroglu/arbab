// Light and juice (DESIGN.md §19, the game-studio pass): shadows cast from where the sun stands, pools of firelight
// at night, the vignette, the camera shake, the beam on a capstone being set, the nameplate over a highlighted worker
// and the monument's plaque.
import type { Capstone, Sky } from "../../model";
import { HEIGHT, WIDTH } from "../../model";
import { ASCENT, DESCENT, measureText } from "../font";
import { FIRELIGHT, GOLD, NIGHT_SHADOW, PLATE, SHADOW, VIGNETTE } from "../palette";
import type { LightSpot, ShadowSpot } from "./props";
import type { Painter, Rect } from "./paint";
import { clock, disc, dithered, ditherRing, softEllipse } from "./paint";
import { sunPosition } from "./sky";

type Phase = Sky["phase"];

// ---------------------------------------------------------------------------------------------------------------
// Camera shake

/** The whole scene's offset while it shakes: (round(s·sin 53t), round(s·cos 47t)), and none when still. */
export function shakeOffset(shake: number, time: number): { dx: number; dy: number } {
  if (!(shake > 0) || !Number.isFinite(shake)) return { dx: 0, dy: 0 };
  const t = clock(time);
  // `|| 0` folds a −0 into 0.
  return { dx: Math.round(shake * Math.sin(53 * t)) || 0, dy: Math.round(shake * Math.cos(47 * t)) || 0 };
}

// ---------------------------------------------------------------------------------------------------------------
// Shadows

/**
 * How far a shadow falls from what casts it, away from the sun's x: 1 px with the sun high, 3 px with it low. At
 * night there is no sun, and shadows fall straight down.
 */
export function shadowShift(sky: Sky, x: number): number {
  if (sky.phase === "night") return 0;
  const sun = sunPosition(sky.sun);
  const high = Math.min(1, Math.max(0, (112 - sun.y) / 86));
  const k = 1 + Math.round(2 * (1 - high));
  const away = Math.sign(Math.round(x) - Math.round(sun.x));
  return away * k;
}

const shapeCache = new Map<string, { dx: number; dy: number; w: number }[]>();
function shape(rx: number, ry: number): { dx: number; dy: number; w: number }[] {
  const key = `${rx}x${ry}`;
  let s = shapeCache.get(key);
  if (!s) {
    s = softEllipse(rx, ry);
    shapeCache.set(key, s);
  }
  return s;
}

/** Soft dark ellipses on the ground; the caller has set the phase's alpha. */
export function drawShadows(p: Painter, sky: Sky, spots: readonly ShadowSpot[], strength = 1): void {
  if (spots.length === 0) return;
  const night = sky.phase === "night";
  const alpha = (night ? 0.14 : 0.25) * Math.min(1, Math.max(0, strength));
  if (alpha <= 0) return;
  const color = night ? NIGHT_SHADOW : SHADOW;
  p.alpha(alpha);
  for (const s of spots) {
    const cx = Math.round(s.cx) + shadowShift(sky, s.cx);
    const cy = Math.round(s.y);
    for (const r of shape(Math.max(1, Math.round(s.rx)), Math.max(0, Math.round(s.ry)))) p.rect(cx + r.dx, cy + r.dy, r.w, 1, color);
  }
  p.alpha(1);
}

// ---------------------------------------------------------------------------------------------------------------
// Firelight at night

/** A pool's radius and strength now: it flickers with the clock, each fire on its own phase. */
export function poolFlicker(light: LightSpot, time: number): { radius: number; alpha: number } {
  const t = clock(time);
  const f = Math.sin(t * 9.1 + light.seed * 1.7) * 0.6 + Math.sin(t * 23.3 + light.seed * 2.9) * 0.4;
  return { radius: light.radius + Math.round(f * 1.5), alpha: 0.11 + 0.025 * f };
}

const poolCache = new Map<number, { outer: Rect[]; mid: Rect[]; core: Rect[] }>();
function pool(r: number): { outer: Rect[]; mid: Rect[]; core: Rect[] } {
  let parts = poolCache.get(r);
  if (!parts) {
    const outer: Rect[] = [];
    ditherRing(outer, 0, 0, Math.round(r * 0.66), r, 0.5, FIRELIGHT);
    const mid: Rect[] = [];
    disc(mid, 0, 0, Math.round(r * 0.66), FIRELIGHT);
    const core: Rect[] = [];
    disc(core, 0, 0, Math.round(r * 0.33), FIRELIGHT);
    parts = { outer, mid, core };
    poolCache.set(r, parts);
  }
  return parts;
}

export function drawLightPools(p: Painter, lights: readonly LightSpot[], time: number): void {
  for (const light of lights) {
    const { radius, alpha } = poolFlicker(light, time);
    const parts = pool(radius);
    p.alpha(alpha);
    p.rects(parts.outer, light.x, light.y);
    p.rects(parts.mid, light.x, light.y);
    p.rects(parts.core, light.x, light.y);
    p.alpha(1);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The vignette

/** The vignette's strength per band, outermost first, per phase. */
const VIGNETTE_ALPHA: Readonly<Record<Phase, number>> = { day: 0.045, dusk: 0.06, night: 0.1 };
const BANDS = [12, 10, 8, 6, 4, 2] as const;

function frame(out: Rect[], t: number, color: string): void {
  out.push(
    { x: 0, y: 0, w: WIDTH, h: t, color },
    { x: 0, y: HEIGHT - t, w: WIDTH, h: t, color },
    { x: 0, y: t, w: t, h: HEIGHT - 2 * t, color },
    { x: WIDTH - t, y: t, w: t, h: HEIGHT - 2 * t, color },
  );
}

const vignetteCache = new Map<Phase, Rect[]>();
function vignetteRects(phase: Phase): Rect[] {
  let rects = vignetteCache.get(phase);
  if (!rects) {
    const color = VIGNETTE[phase];
    rects = [];
    for (const t of BANDS) frame(rects, t, color);
    // A dithered row just inside the outer edge, so the darkening has no hard line.
    const t = BANDS[0];
    for (let x = 0; x < WIDTH; x++) {
      if (dithered(x, t, 0.5)) rects.push({ x, y: t, w: 1, h: 1, color });
      if (dithered(x, HEIGHT - t - 1, 0.5)) rects.push({ x, y: HEIGHT - t - 1, w: 1, h: 1, color });
    }
    for (let y = t + 1; y < HEIGHT - t - 1; y++) {
      if (dithered(t, y, 0.5)) rects.push({ x: t, y, w: 1, h: 1, color });
      if (dithered(WIDTH - t - 1, y, 0.5)) rects.push({ x: WIDTH - t - 1, y, w: 1, h: 1, color });
    }
    vignetteCache.set(phase, rects);
  }
  return rects;
}

/** Darkens the outer 12 px in steps, dithered at its inner edge; it does not shake. */
export function drawVignette(p: Painter, phase: Phase): void {
  p.alpha(VIGNETTE_ALPHA[phase]);
  p.rects(vignetteRects(phase));
  p.alpha(1);
}

// ---------------------------------------------------------------------------------------------------------------
// The capstone's beam

/** How far above the capstone's base its tip stands: the beam ends there. */
const CAPSTONE_TIP = 6;

/**
 * Gold light falling from the top of the canvas onto the capstone's tip, with a few rays, while its glow lasts. The
 * caller draws the capstone again over it, so the light haloes the stone instead of washing it out.
 */
export function drawGlowBeam(p: Painter, cap: Capstone, apex: { x: number; y: number }): void {
  const glow = Number.isFinite(cap.glow) ? Math.min(1, cap.glow) : 0;
  if (!(glow > 0) || cap.state === "none") return;
  const cx = Math.round(cap.state === "set" ? apex.x : cap.x);
  const foot = Math.round(cap.state === "set" ? apex.y : cap.y) - CAPSTONE_TIP;
  const a = glow * 0.5;
  p.alpha(a);
  // Ten pixels wide: a gold sheath, a pale core, a white heart, dithered at its edges.
  p.rect(cx - 4, 0, 8, foot, GOLD.light);
  p.rect(cx - 2, 0, 4, foot, GOLD.gleam);
  p.rect(cx - 1, 0, 2, foot, "#FFFFFF");
  for (let y = 0; y < foot; y++) {
    if (dithered(cx - 5, y, 0.5)) p.rect(cx - 5, y, 1, 1, GOLD.light);
    if (dithered(cx + 4, y, 0.5)) p.rect(cx + 4, y, 1, 1, GOLD.light);
  }
  // Rays fanning out from the apex.
  for (const deg of [-75, -50, -28, 28, 50, 75]) {
    const rad = (deg * Math.PI) / 180;
    const len = 16 + Math.abs(deg) / 4;
    for (let s = 5; s < len; s++) {
      if (s > len * 0.6 && s % 2 === 1) continue;
      p.rect(Math.round(cx + Math.sin(rad) * s), Math.round(foot - Math.cos(rad) * s * 0.7), 1, 1, s < 9 ? GOLD.gleam : GOLD.light);
    }
  }
  const splash: Rect[] = [];
  disc(splash, cx, foot, 5, GOLD.light);
  disc(splash, cx, foot, 3, GOLD.gleam);
  p.rects(splash);
  p.alpha(1);
}

// ---------------------------------------------------------------------------------------------------------------
// The pyramid's shadow

/**
 * The pyramid's shadow on the ground: a wedge beside its foot, away from the sun, as long as two courses are tall and
 * thinning as it rises. None at night, and none without blocks.
 */
export function drawPyramidShadow(
  p: Painter,
  sky: Sky,
  foot: { centerX: number; baseY: number },
  size: { base: number; blockW: number; blockH: number },
): void {
  const { base, blockW, blockH } = size;
  if (sky.phase === "night" || !(base > 0) || !(blockW > 0) || !(blockH > 0)) return;
  const half = (base * blockW) / 2;
  const shift = shadowShift(sky, foot.centerX);
  // Straight overhead, the sun throws it to neither side; then it falls to the right.
  const towardRight = shift >= 0;
  const length = 4 + 4 * Math.max(1, Math.abs(shift));
  const rows = Math.min(2 * blockH, 24);
  p.alpha(0.25);
  for (let r = 0; r < rows; r++) {
    const y = foot.baseY - 1 - r;
    const w = Math.round(length * (1 - r / rows));
    if (w <= 0) continue;
    // Each course is half a block narrower on each side than the one below it.
    const edge = half - Math.floor(r / blockH) * (blockW / 2);
    const x = towardRight ? foot.centerX + edge : foot.centerX - edge - w;
    p.rect(x, y, w, 1, SHADOW);
    const tip = towardRight ? x + w : x - 1;
    if (dithered(tip, y, 0.5)) p.rect(tip, y, 1, 1, SHADOW);
  }
  p.alpha(1);
}

// ---------------------------------------------------------------------------------------------------------------
// The nameplate

const PLATE_H = ASCENT + DESCENT + 4;

/** `text` cut with an ellipsis to at most `width` px of the pixel font. */
export function fitText(text: string, width: number): string {
  if (measureText(text) <= width) return text;
  const chars = [...text];
  while (chars.length > 0 && measureText(`${chars.join("")}…`) > width) chars.pop();
  return `${chars.join("")}…`;
}

/**
 * The nameplate's box for a name centered on cx with its bottom on `bottom`, kept inside the canvas once the camera's
 * offset is added.
 */
export function plateBox(name: string, cx: number, bottom: number, offset: { dx: number; dy: number }): { text: string; x: number; y: number; w: number; h: number } {
  const text = fitText(name, WIDTH - 12);
  const w = measureText(text) + 8;
  const h = PLATE_H;
  const x = Math.min(WIDTH - 1 - w, Math.max(1, Math.round(cx - w / 2) + offset.dx)) - offset.dx;
  const y = Math.min(HEIGHT - 1 - h, Math.max(1, Math.round(bottom - h) + offset.dy)) - offset.dy;
  return { text, x, y, w, h };
}

export function drawNameplate(p: Painter, name: string, cx: number, bottom: number, offset: { dx: number; dy: number }): void {
  const box = plateBox(name, cx, bottom, offset);
  const { x, y, w, h } = box;
  // A dark plate with a gold rim, its corners cut.
  p.rect(x + 1, y, w - 2, 1, PLATE.rim);
  p.rect(x + 1, y + h - 1, w - 2, 1, PLATE.rim);
  p.rect(x, y + 1, 1, h - 2, PLATE.rim);
  p.rect(x + w - 1, y + 1, 1, h - 2, PLATE.rim);
  p.rect(x + 1, y + 1, w - 2, h - 2, PLATE.fill);
  p.rect(x + 1, y + h - 2, w - 2, 1, "#1F140D");
  p.text(box.text, x + 4, y + 2, PLATE.text);
}

// ---------------------------------------------------------------------------------------------------------------
// The monument's plaque

const GRANITE = { light: "#9C8E84", face: "#7E7068", shade: "#5C5049", dark: "#463C37" } as const;

const SLAB_H = ASCENT + 8;

/** The plaque's slab: centered on cx above a 3-px plinth standing on `bottom`, wide enough for the name in capitals. */
export function plaqueBox(name: string, cx: number, bottom: number): { text: string; x: number; y: number; w: number; h: number } {
  const text = fitText(name.toUpperCase(), 200);
  const w = measureText(text) + 12;
  return { text, x: Math.round(cx - w / 2), y: Math.round(bottom) - 3 - SLAB_H, w, h: SLAB_H };
}

/** A granite slab on a plinth, its edges bevelled, the name cut into it and gilded. */
export function drawPlaque(p: Painter, name: string, cx: number, bottom: number): void {
  const { text, x, y: top, w, h } = plaqueBox(name, cx, bottom);
  // The plinth.
  p.rect(x - 2, top + h, w + 4, 3, GRANITE.shade);
  p.rect(x - 2, top + h, w + 4, 1, GRANITE.face);
  p.rect(x - 2, top + h + 2, w + 4, 1, GRANITE.dark);
  // The slab.
  p.rect(x, top, w, h, GRANITE.face);
  p.rect(x, top, w, 1, GRANITE.light);
  p.rect(x, top, 1, h, GRANITE.light);
  p.rect(x + w - 1, top + 1, 1, h - 1, GRANITE.shade);
  // A carved border.
  p.rect(x + 2, top + 2, w - 4, 1, GRANITE.shade);
  p.rect(x + 2, top + h - 3, w - 4, 1, GRANITE.light);
  p.rect(x + 2, top + 2, 1, h - 4, GRANITE.shade);
  p.rect(x + w - 3, top + 3, 1, h - 5, GRANITE.light);
  // The letters: cut (their lower edges catch the light), then gilded.
  p.text(text, x + 6, top + 4, GOLD.shadow);
  p.text(text, x + 6, top + 3, GOLD.light);
}
