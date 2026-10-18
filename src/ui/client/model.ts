// The scene the page draws (DESIGN.md §19). src/ui/client/scene builds a World from snapshots and animates it;
// src/ui/client/app draws it and never changes it. Coordinates are logical pixels of a WIDTH × HEIGHT canvas, y down;
// an actor's (x, y) is the point between its feet. Both sides import these types, so a change here is a change to both.
import type { UiSnapshot } from "../protocol";

export const WIDTH = 480;
export const HEIGHT = 270;

/** The line where the sky meets the dunes; far pyramids stand on it. */
export const HORIZON_Y = 128;

/** Where things stand (feet positions). arbab is at the front of the scene; the site is further back. */
export const PLACES = {
  /** Workers come in from the village path off the left edge… */
  spawn: { x: -16, y: 248 },
  /** …and leave the same way. */
  exit: { x: -16, y: 258 },
  /** The first seat of the camp of waiting workers; see CAMP. */
  camp: { x: 22, y: 204 },
  /** arbab, facing right toward the site. */
  arbab: { x: 116, y: 262 },
  /** Where a worker stands to talk to arbab, facing left. */
  audience: { x: 144, y: 260 },
  /** The bread-and-beer table, left of arbab. */
  rations: { x: 86, y: 262 },
  /** The coin chest and its pile. */
  treasury: { x: 62, y: 264 },
  /** Water carriers fetch from here. */
  well: { x: 444, y: 206 },
  /** Scouts walk off past the dunes here, and come back. */
  horizon: { x: 496, y: 196 },
  /** The capstone's sledge, at the pyramid's right foot. */
  sledge: { x: 402, y: 208 },
} as const;

/** Camp seats: `columns` per row, `step` px apart; the second row sits `rowStep` px lower. */
export const CAMP = { columns: 5, rows: 2, step: 12, rowStep: 9 } as const;

/** The foreground pyramid's box: centered on centerX, its bottom course standing on baseY. */
export const PYRAMID_AREA = { centerX: 268, baseY: 208, maxWidth: 228, maxHeight: 104 } as const;

/** Sprite boxes, anchored at the feet (bottom center). The renderer draws inside them; pick() hits them. */
export const ACTOR_BOX = { w: 12, h: 18 } as const;
export const ARBAB_BOX = { w: 16, h: 26 } as const;

/** arbab, or what a lane's worker is (DESIGN.md §19, the cast). */
export type Cast = "arbab" | "laborer" | "mason" | "scribe" | "skeptic" | "surveyor" | "waterboy" | "scout";

export type Pose =
  | "idle"
  | "walk"
  | "climb"
  | "sit"
  | "work"
  | "sleep"
  | "talk"
  | "carry-scroll"
  | "carry-stone"
  | "carry-ration"
  | "slump"
  | "cheer";

/** Above the head: held for the quota, held for a slot, asleep (usage limit), lost its shepherd. */
export type Icon = "hourglass" | "dots" | "zzz" | "question";

/** A speech bubble of meaningless glyphs: arbab and a worker "talking". */
export interface Bubble {
  /** Picks the glyphs: the same seed draws the same gibberish. */
  seed: number;
  /** 0 → 1 while it pops open; 1 while shown. */
  open: number;
}

export interface Actor {
  /** "arbab", or the lane's name. */
  id: string;
  /** null for arbab. */
  lane: string | null;
  cast: Cast;
  x: number;
  y: number;
  facing: 1 | -1;
  pose: Pose;
  /** Seconds in the current pose; the renderer picks the animation frame from it. */
  poseTime: number;
  /** 0 → 1 through one hammer (or pen, or rod) stroke in the work pose; 0 between strokes. */
  stroke: number;
  /** What a carry-ration worker takes home: 1 a loaf, 2 a loaf and a jug, 3 a basket and a jug; 0 otherwise. */
  ration: 0 | 1 | 2 | 3;
  icon: Icon | null;
  bubble: Bubble | null;
  /** 1 normally; falls to 0 while the actor fades out. */
  alpha: number;
  /** An orphaned lane's worker: drawn pale and half transparent. */
  ghost: boolean;
  highlight: boolean;
}

/**
 * empty: an outline slot no lane has taken. planned: taken, no stone yet (queued, held, preparing). building: stones
 * going up. set: finished with success. stalled: waiting for a reset, or finished with a partial or blocked report.
 * fallen: finished otherwise; its stones lie at the foot. orphaned: its shepherd died.
 */
export type BlockLook = "empty" | "planned" | "building" | "set" | "stalled" | "fallen" | "orphaned";

export interface Block {
  lane: string | null;
  /** Top-left corner and size, integer px. */
  x: number;
  y: number;
  w: number;
  h: number;
  look: BlockLook;
  /** 0–1: the share of its stones in place. */
  fill: number;
  /** 0–1: a shine that fades after a stone is placed or the block is set. */
  flash: number;
  highlight: boolean;
}

export interface Capstone {
  /** none: no integration for these lanes. waiting: on its sledge. hoisting: on its way up (land). set: on the apex. */
  state: "none" | "waiting" | "hoisting" | "set";
  integration: string | null;
  /** Center of its base: the sledge while waiting, the apex once set, in between while hoisting. */
  x: number;
  y: number;
  /** verify on the integration's current head. */
  flag: "none" | "passed" | "failed";
  /** readiness says ready: it gleams. */
  ready: boolean;
}

export interface Pyramid {
  /** Blocks in the bottom course; course k holds base − k. */
  base: number;
  blockW: number;
  blockH: number;
  /** Every slot of the outline: the bottom course first, each course left to right. */
  blocks: Block[];
  /** Stones knocked down by fallen blocks, lying at the foot. */
  rubble: number;
  /** Center of the top course's top edge, where a set capstone stands. */
  apex: { x: number; y: number };
  capstone: Capstone;
}

/** A landed integration: a small finished pyramid on the horizon. */
export interface FarPyramid {
  integration: string;
  /** Center of its base, on HORIZON_Y. */
  x: number;
  y: number;
  height: number;
}

export type ParticleKind = "dust" | "stone" | "sparkle" | "coin";

export interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds left. */
  life: number;
}

export interface Sky {
  /** day: the quota is fine. dusk: launches are held. night: the account is rejected. */
  phase: "day" | "dusk" | "night";
  /** 0 → 1 through the five-hour window: where the sun stands on its arc (0.5 when unknown). */
  sun: number;
}

/** What happened in the scene, for sounds: a brief handed out, a stone placed, a report delivered, … */
export type SceneEventKind = "brief" | "stone" | "report" | "set" | "fall" | "capstone";

export interface SceneEvent {
  kind: SceneEventKind;
  lane: string | null;
}

export interface World {
  sky: Sky;
  pyramid: Pyramid;
  /** At most three, newest first. */
  far: FarPyramid[];
  /** arbab first. The renderer draws actors in y order. */
  actors: Actor[];
  particles: Particle[];
  /** Coins in the treasury pile, 0–48: it grows with the spend of the lanes in view. */
  coins: number;
  /** Events since the page last emptied this array (it plays sounds, then sets length to 0). */
  events: SceneEvent[];
  reducedMotion: boolean;
}

export interface SceneOptions {
  /** prefers-reduced-motion: actors move at once, no particles. */
  reducedMotion: boolean;
  /** 0 ≤ r < 1; injected so tests are deterministic. */
  random: () => number;
}

export interface Scene {
  /** What the renderer draws; apply and step change it in place. */
  readonly world: World;
  /**
   * Folds in a snapshot. The first one sets the scene as it stands, without walks; later ones animate what changed.
   * Time-based choices (the sun, a recent landing) use snapshot.now.
   */
  apply(snapshot: UiSnapshot): void;
  /** Advances walks, strokes, talks, fades and particles by dtMs (a larger dtMs is cut to 100). */
  step(dtMs: number): void;
  /** The lane of the topmost actor, else block, at a logical point; null when there is none. */
  pick(x: number, y: number): string | null;
  /** Marks one lane's actor and block; null clears the mark. */
  highlight(lane: string | null): void;
}
