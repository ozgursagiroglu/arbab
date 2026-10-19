// Draws a World (DESIGN.md §19) with solid rectangles and globalAlpha only, so the page and the PNG frames share it.
// It never changes the world, and a frame is a function of the world alone: what lives without data moves by
// world.time. The scenery lives in ./art; this file puts it together with the pyramid, the actors and their signs.
import type { Actor, Block, Bubble, Particle, Pyramid, World } from "../model";
import { HEIGHT, HORIZON_Y, PLACES, PYRAMID_AREA, WIDTH } from "../model";
import {
  drawGlowBeam,
  drawLightPools,
  drawNameplate,
  drawPlaque,
  drawPyramidShadow,
  drawShadows,
  drawVignette,
  shakeOffset,
} from "./art/fx";
import { drawFarLand, drawRiverAndPlain } from "./art/land";
import type { Painter, Rect } from "./art/paint";
import { clock, lightOf, painter, prng } from "./art/paint";
import type { Scenery, ShadowSpot } from "./art/props";
import { LIGHTS, PROP_SHADOWS, propScenery } from "./art/props";
import { drawSky } from "./art/sky";
import type { Canvas2D } from "./browser";
import {
  BUBBLE,
  COIN,
  FALLEN,
  FAR_STONE,
  FLAG,
  FLASH,
  GOLD,
  LIMESTONE,
  ORPHANED,
  OUTLINE,
  OUTLINE_EMPTY,
  OUTLINE_PLANNED,
  PLAIN,
  SAND,
  SKY_RAMP,
  WOOD,
  desaturate,
  mix,
} from "./palette";
import type { Grid, Sprite } from "./sprites";
import { compileProp, createSpriteSet, GLYPHS, ICONS, MARKER, PROPS } from "./sprites";

export { MOON_AT, sunPosition } from "./art/sky";
export { prng } from "./art/paint";

/** The ground line: ladders stand on it, and a worker above it works on a plank. */
export const GROUND_Y = PYRAMID_AREA.baseY + 2;

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

function spriteRects(sprite: Sprite, left: number, top: number): Rect[] {
  return sprite.runs.map((r) => ({ x: left + r.x, y: top + r.y, w: r.w, h: 1, color: r.color }));
}

/** A sprite placed by the center of its bottom edge. */
function placed(grid: Grid, cx: number, bottom: number): Rect[] {
  const s = prop(grid);
  return spriteRects(s, cx - Math.floor(s.w / 2), bottom - s.h);
}

// ---------------------------------------------------------------------------------------------------------------
// Scenery in front of the pyramid's foot

/** The table stands just in front of the rations spot, so a worker taking bread and beer stands behind it. */
const TABLE_BOTTOM = PLACES.rations.y + 3;
const SLEDGE_BOTTOM = PLACES.sledge.y + 6;

const fixed = (y: number, rects: readonly Rect[]): Scenery => ({ y, draw: (p) => p.rects(rects) });

const FIXED_SCENERY: readonly Scenery[] = [
  fixed(SLEDGE_BOTTOM, placed(PROPS.sledge, PLACES.sledge.x + 1, SLEDGE_BOTTOM)),
  fixed(PLACES.treasury.y, placed(PROPS.chest, PLACES.treasury.x, PLACES.treasury.y)),
  fixed(TABLE_BOTTOM, placed(PROPS.table, PLACES.rations.x, TABLE_BOTTOM)),
];

const FIXED_SHADOWS: readonly ShadowSpot[] = [
  { cx: PLACES.sledge.x + 1, y: SLEDGE_BOTTOM, rx: 12, ry: 1 },
  { cx: PLACES.treasury.x, y: PLACES.treasury.y, rx: 8, ry: 1 },
  { cx: PLACES.rations.x, y: TABLE_BOTTOM, rx: 11, ry: 1 },
  { cx: PLACES.treasury.x - 22, y: PLACES.treasury.y + 1, rx: 12, ry: 1 },
];

/** Where the monument's plaque stands: on the ground at the pyramid's foot, centered. */
export const PLAQUE_FOOT = { x: PYRAMID_AREA.centerX, y: PYRAMID_AREA.baseY + 18 } as const;

const PROPS_ON_PLAIN = propScenery();
/** Props standing behind the pyramid's foot are drawn before it; the rest go in line with the actors. */
const BEHIND = PROPS_ON_PLAIN.filter((s) => s.y < PYRAMID_AREA.baseY).sort((a, b) => a.y - b.y);
const IN_FRONT = PROPS_ON_PLAIN.filter((s) => s.y >= PYRAMID_AREA.baseY);

/** The scenery actors walk in front of and behind, back to front, with this frame's coins and plaque. */
function sceneryOf(world: World): Scenery[] {
  const all = [...IN_FRONT, ...FIXED_SCENERY, fixed(PLACES.treasury.y + 1, coinRects(world.coins))];
  const monument = world.pyramid.monument;
  if (monument) all.push({ y: PLAQUE_FOOT.y, draw: (p) => drawPlaque(p, monument, PLAQUE_FOOT.x, PLAQUE_FOOT.y) });
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

/**
 * Where a set block's shine stands: the x of its top row, from just left of the block (flash 1) to past its right
 * edge plus its height (flash 0), so the band sweeps across as the flash fades.
 */
export function shineOffset(flash: number, w: number, h: number): number {
  const f = Number.isFinite(flash) ? Math.min(1, Math.max(0, flash)) : 0;
  return Math.round((1 - f) * (w + h + 4)) - 2;
}

function drawShine(p: Painter, b: Block): void {
  const pos = shineOffset(b.flash, b.w, b.h);
  p.alpha(0.75);
  for (let r = 0; r < b.h; r++) {
    // Leaning like light off a facet: each row a pixel left of the one above.
    const x0 = b.x + pos - r;
    for (const [dx, w, color] of [
      [0, 3, FLASH],
      [-3, 1, GOLD.gleam],
    ] as const) {
      const from = Math.max(b.x, x0 + dx);
      const to = Math.min(b.x + b.w, x0 + dx + w);
      if (to > from) p.rect(from, b.y + r, to - from, 1, color);
    }
  }
  p.alpha(1);
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
      if (b.look === "set") drawShine(p, b);
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

/** A small stepped pyramid with a gold tip, standing on (x, y), softened by the distance. */
function drawFarPyramid(p: Painter, cx: number, base: number, height: number): void {
  const h = Math.max(4, Math.min(40, Math.round(height)));
  const x = Math.round(cx);
  const y = Math.round(base);
  for (let r = 0; r < h; r++) {
    const half = h - (r - (r % 2));
    const row = y - 1 - r;
    const tip = r >= h - 3;
    // Every other row a course line, a shade darker.
    const course = r % 2 === 1;
    p.rect(x - half, row, half, 1, tip ? GOLD.light : course ? FAR_STONE.face : FAR_STONE.light);
    p.rect(x, row, half, 1, tip ? GOLD.mid : course ? FAR_STONE.dark : FAR_STONE.shade);
  }
  p.rect(x - h - 1, y - 1, 2 * h + 2, 1, FAR_STONE.dark);
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

/** Draws a speech bubble over a head and returns the row of its top edge. */
function drawBubble(p: Painter, bubble: Bubble, speakerX: number, head: number): number {
  const rand = prng(bubble.seed);
  const count = 3 + Math.floor(rand() * 5);
  const lines = count > 4 ? 2 : 1;
  const perLine = Math.ceil(count / lines);
  const fullW = perLine * 4 - 1 + 6;
  const fullH = lines * 5 - 1 + 6;
  const open = Number.isFinite(bubble.open) ? Math.min(1, Math.max(0, bubble.open)) : 1;
  if (open <= 0) return head;
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
  if (open < 1) return top;
  for (let i = 0; i < count; i++) {
    const glyph = GLYPHS[Math.floor(rand() * GLYPHS.length)] ?? GLYPHS[0] ?? [];
    const line = Math.floor(i / perLine);
    const gx = left + 3 + (i % perLine) * 4;
    const gy = top + 3 + line * 5;
    glyph.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === "#") p.rect(gx + x, gy + y, 1, 1, BUBBLE.glyph);
    });
  }
  return top;
}

function actorAlpha(actor: Actor): number {
  return Math.min(1, Math.max(0, Number.isFinite(actor.alpha) ? actor.alpha : 1)) * (actor.ghost ? 0.5 : 1);
}

/** Every actor on its feet casts a shadow; a climber on its ladder does not. */
function actorShadows(world: World): { solid: ShadowSpot[]; faded: { spot: ShadowSpot; alpha: number }[] } {
  const solid: ShadowSpot[] = [];
  const faded: { spot: ShadowSpot; alpha: number }[] = [];
  for (const actor of world.actors) {
    if (actor.pose === "climb" || actor.pose === "climb-stone") continue;
    if (!Number.isFinite(actor.x) || !Number.isFinite(actor.y)) continue;
    const alpha = actorAlpha(actor);
    if (alpha <= 0) continue;
    const rx = actor.cast === "arbab" ? 7 : actor.pose === "sleep" ? 8 : 5;
    const spot = { cx: Math.round(actor.x), y: Math.round(actor.y), rx, ry: 1 };
    if (alpha >= 1) solid.push(spot);
    else faded.push({ spot, alpha });
  }
  return { solid, faded };
}

function drawActors(p: Painter, world: World, light: ((color: string) => string) | null, time: number): { actor: Actor; sprite: Sprite }[] {
  const order = world.actors.map((actor, i) => ({ actor, i }));
  order.sort((a, b) => a.actor.y - b.actor.y || a.i - b.i);
  const scenery = sceneryOf(world);
  let next = 0;
  const shown: { actor: Actor; sprite: Sprite }[] = [];
  for (const { actor } of order) {
    // Scenery standing further back than this actor goes first, so the actor passes in front of it.
    for (; next < scenery.length && (scenery[next]?.y ?? 0) <= actor.y; next++) scenery[next]?.draw(p, time, light);
    const sprite = spriteOf(actor);
    if (!sprite) continue;
    const x = Math.round(actor.x);
    const y = Math.round(actor.y);
    if (actor.pose === "climb" || actor.pose === "climb-stone") drawLadder(p, x, y, world.pyramid);
    // A worker above the pyramid's foot stands on a plank; on the foot itself it stands on the base.
    if (actor.pose === "work" && y < PYRAMID_AREA.baseY) drawPlank(p, x, y);
    const alpha = actorAlpha(actor);
    if (alpha <= 0) continue;
    if (alpha < 1) p.alpha(alpha);
    p.sprite(sprite, x - Math.floor(sprite.w / 2), y - sprite.h, actor.facing === -1);
    if (alpha < 1) p.alpha(1);
    shown.push({ actor, sprite });
  }
  for (; next < scenery.length; next++) scenery[next]?.draw(p, time, light);
  return shown;
}

/** Icons, markers, bubbles and nameplates: signs for the viewer, in their own colors at any hour. */
function drawSigns(p: Painter, world: World, shown: { actor: Actor; sprite: Sprite }[], offset: { dx: number; dy: number }): void {
  const tops = new Map<Actor, number>();
  for (const { actor, sprite } of shown) {
    const x = Math.round(actor.x);
    let top = headTop(actor, sprite);
    if (actor.icon) {
      const icon = prop(ICONS[actor.icon]);
      top -= icon.h + 2;
      p.sprite(icon, x - Math.floor(icon.w / 2), top);
    }
    if (actor.highlight) {
      const marker = prop(MARKER);
      const blinkOn = world.reducedMotion || Math.floor(Math.max(0, actor.poseTime) * 4) % 2 === 0;
      if (blinkOn) p.sprite(marker, x - Math.floor(marker.w / 2), top - marker.h - 1);
      // The nameplate keeps the marker's place whether it shows or not, so it does not jump.
      top -= marker.h + 1;
    }
    tops.set(actor, top);
  }
  for (const { actor, sprite } of shown) {
    if (!actor.bubble) continue;
    const top = drawBubble(p, actor.bubble, Math.round(actor.x), headTop(actor, sprite));
    tops.set(actor, Math.min(tops.get(actor) ?? top, top));
  }
  for (const { actor } of shown) {
    if (!actor.highlight) continue;
    drawNameplate(p, actor.lane ?? actor.id, Math.round(actor.x), (tops.get(actor) ?? Math.round(actor.y)) - 2, offset);
  }
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
  const phase = world.sky.phase;
  const time = clock(world.time);
  const light = lightOf(phase);
  const offset = shakeOffset(world.shake, time);

  if (offset.dx !== 0 || offset.dy !== 0) {
    // A shaken scene uncovers a sliver at the edges: fill it with the sky and the sand.
    p.rect(0, 0, WIDTH, HORIZON_Y, SKY_RAMP[phase][0] ?? "#000000");
    p.tint(light);
    p.rect(0, HORIZON_Y, WIDTH, HEIGHT - HORIZON_Y, PLAIN[4]);
    p.tint(null);
  }
  p.offset(offset.dx, offset.dy);

  drawSky(p, world.sky, time);
  drawFarLand(p, phase, time);
  p.tint(light);
  for (const far of world.far.slice(0, 3)) drawFarPyramid(p, far.x, far.y, far.height);
  p.tint(null);
  drawRiverAndPlain(p, phase, time);

  drawShadows(p, world.sky, [...PROP_SHADOWS, ...FIXED_SHADOWS]);
  if (world.pyramid.blocks.some((b) => b.look !== "empty" && b.look !== "planned")) {
    drawPyramidShadow(p, world.sky, PYRAMID_AREA, world.pyramid);
  }
  p.tint(light);
  for (const s of BEHIND) s.draw(p, time, light);
  drawPyramid(p, world.pyramid);

  p.tint(null);
  const shadows = actorShadows(world);
  drawShadows(p, world.sky, shadows.solid);
  for (const f of shadows.faded) drawShadows(p, world.sky, [f.spot], f.alpha);

  p.tint(light);
  const shown = drawActors(p, world, light, time);
  for (const particle of world.particles) drawParticle(p, particle);
  p.tint(null);

  if (phase === "night") drawLightPools(p, LIGHTS, time);
  drawGlowBeam(p, world.pyramid.capstone, world.pyramid.apex);
  drawSigns(p, world, shown, offset);

  p.offset(0, 0);
  drawVignette(p, phase);
  ctx.globalAlpha = 1;
}
