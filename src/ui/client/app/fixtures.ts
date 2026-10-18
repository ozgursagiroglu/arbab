// Hand-built Worlds for the renderer's tests and the docs/ui frames. Test-only: the real layout and the real worlds
// come from src/ui/client/scene. The pyramids follow the scene's layout rules (DESIGN.md §19).
import type { UiIntegration, UiLane, UiSnapshot } from "../../protocol";
import { UI_PROTOCOL } from "../../protocol";
import type { Actor, Block, BlockLook, Capstone, FarPyramid, Particle, World } from "../model";
import { CAMP, HORIZON_Y, PLACES, PYRAMID_AREA } from "../model";

export interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Layout {
  base: number;
  blockW: number;
  blockH: number;
  slots: Slot[];
  apex: { x: number; y: number };
}

/** The scene's pyramid layout for n lanes: the bottom course first, each course left to right. */
export function layout(n: number): Layout {
  let least = 1;
  while ((least * (least + 1)) / 2 < n) least++;
  const base = Math.max(4, least);
  let blockW = Math.min(32, Math.floor(PYRAMID_AREA.maxWidth / base));
  blockW -= blockW % 2;
  const blockH = Math.min(blockW / 2, Math.floor(PYRAMID_AREA.maxHeight / base));
  blockW = Math.min(blockW, 2 * blockH);
  const slots: Slot[] = [];
  for (let k = 0; k < base; k++) {
    for (let j = 0; j < base - k; j++) {
      slots.push({
        x: PYRAMID_AREA.centerX - ((base - k) * blockW) / 2 + j * blockW,
        y: PYRAMID_AREA.baseY - (k + 1) * blockH,
        w: blockW,
        h: blockH,
      });
    }
  }
  return { base, blockW, blockH, slots, apex: { x: PYRAMID_AREA.centerX, y: PYRAMID_AREA.baseY - base * blockH } };
}

/** A worker's feet at its slot. */
export function feet(slot: Slot): { x: number; y: number } {
  return { x: slot.x + slot.w / 2, y: slot.y + slot.h };
}

export function camp(seat: number): { x: number; y: number } {
  const col = seat % CAMP.columns;
  const row = Math.floor(seat / CAMP.columns);
  return { x: PLACES.camp.x + col * CAMP.step, y: PLACES.camp.y + row * CAMP.rowStep };
}

export function actor(fields: Partial<Actor> & Pick<Actor, "id" | "cast" | "x" | "y">): Actor {
  return {
    lane: fields.cast === "arbab" ? null : fields.id,
    facing: 1,
    pose: "idle",
    poseTime: 0,
    stroke: 0,
    ration: 0,
    icon: null,
    bubble: null,
    alpha: 1,
    ghost: false,
    highlight: false,
    ...fields,
  };
}

export function arbab(fields: Partial<Actor> = {}): Actor {
  return actor({ id: "arbab", cast: "arbab", ...PLACES.arbab, ...fields });
}

interface BlockSpec {
  look: BlockLook;
  fill?: number;
  flash?: number;
  highlight?: boolean;
}

function blocks(l: Layout, specs: readonly BlockSpec[]): Block[] {
  return l.slots.map((slot, i) => {
    const spec = specs[i] ?? { look: "empty" };
    const fill = spec.fill ?? (spec.look === "set" ? 1 : 0);
    return {
      lane: spec.look === "empty" ? null : `lane-${i + 1}`,
      ...slot,
      look: spec.look,
      fill,
      flash: spec.flash ?? 0,
      highlight: spec.highlight ?? false,
    };
  });
}

function capstone(fields: Partial<Capstone>): Capstone {
  return { state: "none", integration: null, ...PLACES.sledge, flag: "none", ready: false, ...fields };
}

function world(fields: Partial<World> & Pick<World, "pyramid">): World {
  return {
    sky: { phase: "day", sun: 0.5 },
    far: [],
    actors: [],
    particles: [],
    coins: 0,
    events: [],
    reducedMotion: false,
    ...fields,
  };
}

function far(x: number, height: number, integration: string): FarPyramid {
  return { integration, x, y: HORIZON_Y, height };
}

function particle(kind: Particle["kind"], x: number, y: number, life = 0.5): Particle {
  return { kind, x, y, vx: 0, vy: 0, life };
}

/** Midday: building, a fallen gap, a talk with arbab, a capstone waiting with a green pennant. */
export function dayWorld(): World {
  const l = layout(10);
  const s = (i: number): Slot => l.slots[i] ?? { x: 0, y: 0, w: 0, h: 0 };
  return world({
    sky: { phase: "day", sun: 0.38 },
    pyramid: {
      base: l.base,
      blockW: l.blockW,
      blockH: l.blockH,
      blocks: blocks(l, [
        { look: "set" },
        { look: "set", flash: 0.35 },
        { look: "fallen" },
        { look: "building", fill: 0.7 },
        { look: "set" },
        { look: "building", fill: 0.45 },
        { look: "building", fill: 0.6, highlight: true },
        { look: "building", fill: 0.2 },
        { look: "planned" },
      ]),
      rubble: 7,
      apex: l.apex,
      capstone: capstone({ state: "waiting", integration: "int-1", flag: "passed" }),
    },
    far: [far(64, 12, "int-0")],
    actors: [
      arbab({ pose: "talk", poseTime: 0.3 }),
      actor({ id: "audience", cast: "laborer", ...PLACES.audience, facing: -1, pose: "talk", bubble: { seed: 11, open: 1 } }),
      actor({ id: "builder-a", cast: "laborer", ...feet(s(3)), pose: "work", stroke: 0.7 }),
      actor({ id: "builder-b", cast: "mason", ...feet(s(5)), facing: -1, pose: "work", stroke: 0.2 }),
      actor({ id: "builder-c", cast: "laborer", ...feet(s(6)), facing: -1, pose: "work", stroke: 0.6, highlight: true, poseTime: 0.1 }),
      actor({ id: "climber", cast: "mason", x: feet(s(7)).x, y: 192, pose: "climb", poseTime: 0.1 }),
      actor({ id: "held-quota", cast: "laborer", ...camp(0), pose: "sit", icon: "hourglass" }),
      actor({ id: "held-slot", cast: "mason", ...camp(1), pose: "sit", icon: "dots" }),
      actor({ id: "scribe", cast: "scribe", x: s(0).x + 10, y: s(0).y, pose: "work", stroke: 0.7 }),
      actor({ id: "surveyor", cast: "surveyor", x: PLACES.sledge.x - 20, y: PLACES.sledge.y + 2, pose: "work", stroke: 0.8 }),
      actor({ id: "water", cast: "waterboy", x: 420, y: 222, facing: -1, pose: "walk", poseTime: 0.2 }),
    ],
    particles: [
      particle("dust", feet(s(3)).x + 7, 204),
      particle("dust", feet(s(3)).x + 9, 202),
      particle("dust", feet(s(3)).x + 5, 201),
      particle("stone", feet(s(3)).x + 11, 199),
      particle("dust", feet(s(6)).x - 9, 186),
    ],
    coins: 20,
  });
}

/** Launches held: dusk, workers waiting in the camp, one asleep on the pyramid, an orphan's ghost. */
export function duskWorld(): World {
  const l = layout(8);
  const s = (i: number): Slot => l.slots[i] ?? { x: 0, y: 0, w: 0, h: 0 };
  return world({
    sky: { phase: "dusk", sun: 0.88 },
    pyramid: {
      base: l.base,
      blockW: l.blockW,
      blockH: l.blockH,
      blocks: blocks(l, [
        { look: "set" },
        { look: "set" },
        { look: "set" },
        { look: "planned" },
        { look: "stalled", fill: 0.4 },
        { look: "building", fill: 0.3 },
        { look: "orphaned", fill: 0.5 },
        { look: "planned" },
      ]),
      rubble: 0,
      apex: l.apex,
      capstone: capstone({}),
    },
    far: [far(64, 12, "int-0")],
    actors: [
      arbab(),
      ...[0, 1, 2, 3, 5, 6].map((seat, i) =>
        actor({
          id: `held-${seat}`,
          cast: (["laborer", "mason", "laborer", "scribe", "laborer", "surveyor"] as const)[i] ?? "laborer",
          ...camp(seat),
          facing: i % 2 === 0 ? 1 : -1,
          pose: "sit",
          icon: "hourglass",
        }),
      ),
      actor({ id: "sleeper", cast: "laborer", ...feet(s(4)), pose: "sleep", icon: "zzz" }),
      actor({ id: "ghost", cast: "mason", ...feet(s(6)), ghost: true, icon: "question" }),
    ],
    coins: 12,
  });
}

/** An integration landed: every block set, the capstone on the apex, arbab cheering, a worker going home fed. */
export function capstoneWorld(): World {
  const l = layout(15);
  return world({
    sky: { phase: "day", sun: 0.62 },
    pyramid: {
      base: l.base,
      blockW: l.blockW,
      blockH: l.blockH,
      blocks: blocks(
        l,
        l.slots.map((_, i) => ({ look: "set", flash: i === 14 ? 0.4 : 0 })),
      ),
      rubble: 0,
      apex: l.apex,
      capstone: capstone({ state: "set", integration: "int-3", ...l.apex, flag: "passed", ready: true }),
    },
    far: [far(56, 14, "int-2"), far(104, 10, "int-1"), far(150, 8, "int-0")],
    actors: [
      arbab({ pose: "cheer", poseTime: 0.1 }),
      actor({ id: "fed", cast: "laborer", x: 178, y: 252, facing: -1, pose: "carry-ration", ration: 3, poseTime: 0.05 }),
    ],
    particles: [
      particle("sparkle", l.apex.x - 9, l.apex.y - 9, 0.5),
      particle("sparkle", l.apex.x + 8, l.apex.y - 12, 0.45),
      particle("sparkle", l.apex.x - 14, l.apex.y - 2, 0.3),
      particle("sparkle", l.apex.x + 13, l.apex.y - 4, 0.6),
      particle("sparkle", l.apex.x + 2, l.apex.y - 15, 0.55),
      particle("sparkle", l.apex.x - 4, l.apex.y - 18, 0.35),
      particle("coin", 178, 238, 0.4),
    ],
    coins: 34,
  });
}

/** The account rejected: night, the moon and stars, everyone asleep. */
export function nightWorld(): World {
  const l = layout(6);
  const s = (i: number): Slot => l.slots[i] ?? { x: 0, y: 0, w: 0, h: 0 };
  return world({
    sky: { phase: "night", sun: 0.5 },
    pyramid: {
      base: l.base,
      blockW: l.blockW,
      blockH: l.blockH,
      blocks: blocks(l, [
        { look: "set" },
        { look: "stalled", fill: 0.6 },
        { look: "stalled", fill: 0.3 },
        { look: "set" },
        { look: "stalled", fill: 0.5 },
        { look: "planned" },
      ]),
      rubble: 0,
      apex: l.apex,
      capstone: capstone({}),
    },
    far: [far(64, 12, "int-1"), far(112, 9, "int-0")],
    actors: [
      arbab(),
      actor({ id: "sleeper-a", cast: "laborer", ...feet(s(1)), pose: "sleep", icon: "zzz" }),
      actor({ id: "sleeper-b", cast: "mason", ...feet(s(2)), pose: "sleep", icon: "zzz" }),
      actor({ id: "sleeper-c", cast: "laborer", ...feet(s(4)), pose: "sleep", icon: "zzz" }),
      actor({ id: "sleeper-d", cast: "scribe", ...camp(1), pose: "sleep", icon: "zzz" }),
      actor({ id: "sleeper-e", cast: "laborer", ...camp(3), pose: "sleep", icon: "zzz" }),
    ],
    coins: 8,
  });
}

export const FRAMES = { day: dayWorld, dusk: duskWorld, capstone: capstoneWorld, night: nightWorld } as const;

// ---------------------------------------------------------------------------------------------------------------
// Snapshots for the HUD and page tests

export function lane(fields: Partial<UiLane> & Pick<UiLane, "name">): UiLane {
  return {
    role: "implementer",
    kind: "lane",
    integration: null,
    worktreeOf: null,
    state: "running",
    endState: null,
    hold: null,
    reason: null,
    until: null,
    attempt: 1,
    firstSeen: "2026-10-19T10:00:00.000Z",
    since: "2026-10-19T10:00:00.000Z",
    elapsedMs: null,
    toolCalls: 0,
    lastTool: null,
    turns: 0,
    failedTotal: 0,
    costUsd: null,
    costDeltaUsd: null,
    model: null,
    effort: null,
    reportStatus: null,
    findings: null,
    ...fields,
  };
}

export function snapshot(fields: Partial<UiSnapshot> = {}): UiSnapshot {
  return {
    protocol: UI_PROTOCOL,
    version: "0.2.0",
    project: "demo",
    now: "2026-10-19T10:05:00.000Z",
    lanes: [],
    hiddenLanes: 0,
    integrations: [],
    quota: {
      status: "allowed",
      fiveHour: null,
      sevenDay: null,
      observedAt: null,
      hold: { hold: false, reason: null, until: null },
      holdAbove: { fiveHour: 0.9, sevenDay: 0.95 },
    },
    maxParallel: 4,
    ...fields,
  };
}

export function integration(fields: Partial<UiIntegration> & Pick<UiIntegration, "name">): UiIntegration {
  return {
    lanes: [],
    headSha: "0".repeat(40),
    updatedAt: "2026-10-19T10:00:00.000Z",
    verify: null,
    review: null,
    ready: null,
    landedAt: null,
    ...fields,
  };
}
