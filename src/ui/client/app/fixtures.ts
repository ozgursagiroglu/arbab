// Hand-built Worlds for the renderer's tests and the docs/ui frames. Test-only: the real worlds come from
// src/ui/client/scene; the geometry here is the scene's own (layout.ts), so the frames show what the page shows.
import type { UiIntegration, UiLane, UiSnapshot } from "../../protocol";
import { UI_PROTOCOL } from "../../protocol";
import type { Actor, Block, BlockLook, Capstone, FarPyramid, Particle, World } from "../model";
import { PLACES } from "../model";
import type { PyramidLayout, Slot } from "../scene/layout";
import { campSeat, farPyramidPlace, pyramidLayout, workSpot } from "../scene/layout";

const NO_SLOT: Slot = { x: 0, y: 0, w: 0, h: 0, course: 0 };

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

function blocks(l: PyramidLayout, specs: readonly BlockSpec[]): Block[] {
  return l.slots.map((slot, i) => {
    const spec = specs[i] ?? { look: "empty" };
    const fill = spec.fill ?? (spec.look === "set" ? 1 : 0);
    return {
      lane: spec.look === "empty" ? null : `lane-${i + 1}`,
      x: slot.x,
      y: slot.y,
      w: slot.w,
      h: slot.h,
      look: spec.look,
      fill,
      flash: spec.flash ?? 0,
      highlight: spec.highlight ?? false,
    };
  });
}

function capstone(fields: Partial<Capstone>): Capstone {
  return { state: "none", integration: null, ...PLACES.sledge, flag: "none", ready: false, glow: 0, ...fields };
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
    time: 0,
    shake: 0,
    ...fields,
  };
}

/** Landed integrations on the horizon, newest first, by how many lanes each merged. */
function farPyramids(lanes: readonly number[]): FarPyramid[] {
  return lanes.map((n, i) => ({ integration: `int-${lanes.length - 1 - i}`, ...farPyramidPlace(i, n) }));
}

function slotOf(l: PyramidLayout): (i: number) => Slot {
  return (i) => l.slots[i] ?? NO_SLOT;
}

function particle(kind: Particle["kind"], x: number, y: number, life = 0.5): Particle {
  return { kind, x, y, vx: 0, vy: 0, life };
}

/** Midday: building, a fallen gap, a talk with arbab, a capstone waiting with a green pennant. */
export function dayWorld(): World {
  const l = pyramidLayout(10);
  const s = slotOf(l);
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
      monument: null,
      apex: l.apex,
      capstone: capstone({ state: "waiting", integration: "int-1", flag: "passed" }),
    },
    far: farPyramids([7]),
    actors: [
      arbab({ pose: "talk", poseTime: 0.3 }),
      actor({ id: "audience", cast: "laborer", ...PLACES.audience, facing: -1, pose: "talk", bubble: { seed: 11, open: 1 } }),
      actor({ id: "builder-a", cast: "laborer", ...workSpot(s(3)), pose: "work", stroke: 0.7 }),
      actor({ id: "builder-b", cast: "mason", ...workSpot(s(5)), facing: -1, pose: "work", stroke: 0.2 }),
      actor({ id: "builder-c", cast: "laborer", ...workSpot(s(6)), facing: -1, pose: "work", stroke: 0.6, highlight: true, poseTime: 0.1 }),
      actor({ id: "climber", cast: "mason", x: workSpot(s(7)).x, y: workSpot(s(7)).y + 8, pose: "climb-stone", poseTime: 0.1 }),
      actor({ id: "held-quota", cast: "laborer", ...campSeat(0), pose: "sit", icon: "hourglass" }),
      actor({ id: "held-slot", cast: "mason", ...campSeat(1), pose: "sit", icon: "dots" }),
      actor({ id: "scribe", cast: "scribe", ...workSpot(s(4)), pose: "work", stroke: 0.7 }),
      actor({ id: "surveyor", cast: "surveyor", x: PLACES.sledge.x - 14, y: PLACES.sledge.y + 2, facing: -1, pose: "work", stroke: 0.8 }),
      actor({ id: "water", cast: "waterboy", x: 420, y: 208, facing: -1, pose: "walk", poseTime: 0.2 }),
    ],
    particles: [
      particle("dust", workSpot(s(3)).x + 7, 204),
      particle("dust", workSpot(s(3)).x + 9, 202),
      particle("dust", workSpot(s(3)).x + 5, 201),
      particle("stone", workSpot(s(3)).x + 11, 199),
      particle("dust", workSpot(s(6)).x - 9, 186),
    ],
    coins: 20,
    // Birds overhead, the felucca clear of the grove, the caravan passing behind the temple.
    time: 14,
  });
}

/** Launches held: dusk, workers waiting in the camp, one asleep on the pyramid, an orphan's ghost. */
export function duskWorld(): World {
  const l = pyramidLayout(8);
  const s = slotOf(l);
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
      monument: null,
      apex: l.apex,
      capstone: capstone({}),
    },
    far: farPyramids([7]),
    actors: [
      arbab(),
      ...[0, 1, 2, 3, 5, 6].map((seat, i) =>
        actor({
          id: `held-${seat}`,
          cast: (["laborer", "mason", "laborer", "scribe", "laborer", "surveyor"] as const)[i] ?? "laborer",
          ...campSeat(seat),
          facing: i % 2 === 0 ? 1 : -1,
          pose: "sit",
          icon: "hourglass",
        }),
      ),
      actor({ id: "sleeper", cast: "laborer", ...workSpot(s(4)), pose: "sleep", icon: "zzz" }),
      actor({ id: "ghost", cast: "mason", ...workSpot(s(6)), ghost: true, icon: "question" }),
    ],
    coins: 12,
    // Birds against the low sun, the felucca nearly across, the caravan leaving.
    time: 60,
  });
}

/** An integration landed: every block set, the capstone on the apex, arbab cheering, a worker going home fed. */
export function capstoneWorld(): World {
  const l = pyramidLayout(15);
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
      monument: null,
      apex: l.apex,
      capstone: capstone({ state: "set", integration: "int-3", ...l.apex, flag: "passed", ready: true, glow: 0.8 }),
    },
    far: farPyramids([10, 3, 0]),
    time: 150,
    actors: [
      arbab({ pose: "cheer", poseTime: 0.1 }),
      // On the way from the table to the village path.
      actor({ id: "fed", cast: "laborer", x: 34, y: 260, facing: -1, pose: "carry-ration", ration: 3, poseTime: 0.05 }),
    ],
    particles: [
      particle("sparkle", l.apex.x - 9, l.apex.y - 9, 0.5),
      particle("sparkle", l.apex.x + 8, l.apex.y - 12, 0.45),
      particle("sparkle", l.apex.x - 14, l.apex.y - 2, 0.3),
      particle("sparkle", l.apex.x + 13, l.apex.y - 4, 0.6),
      particle("sparkle", l.apex.x + 2, l.apex.y - 15, 0.55),
      particle("sparkle", l.apex.x - 4, l.apex.y - 18, 0.35),
      particle("coin", PLACES.treasury.x - 2, PLACES.treasury.y - 14, 0.4),
    ],
    coins: 34,
  });
}

/** The account rejected: night, the moon and stars, everyone asleep. */
export function nightWorld(): World {
  const l = pyramidLayout(6);
  const s = slotOf(l);
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
      monument: null,
      apex: l.apex,
      capstone: capstone({}),
    },
    far: farPyramids([2, 7]),
    actors: [
      arbab(),
      actor({ id: "sleeper-a", cast: "laborer", ...workSpot(s(1)), pose: "sleep", icon: "zzz" }),
      actor({ id: "sleeper-b", cast: "mason", ...workSpot(s(2)), pose: "sleep", icon: "zzz" }),
      actor({ id: "sleeper-c", cast: "laborer", ...workSpot(s(4)), pose: "sleep", icon: "zzz" }),
      actor({ id: "sleeper-d", cast: "scribe", ...campSeat(1), pose: "sleep", icon: "zzz" }),
      actor({ id: "sleeper-e", cast: "laborer", ...campSeat(3), pose: "sleep", icon: "zzz" }),
    ],
    coins: 8,
    // A shooting star halfway through its streak.
    time: 120.3,
  });
}

/**
 * Nobody at work: the last landing stands as the monument with its plaque, while the valley goes on living (a felucca
 * mid-river, the caravan mid-crossing, the camp fire, birds overhead).
 */
export function idleWorld(): World {
  const l = pyramidLayout(15);
  return world({
    sky: { phase: "day", sun: 0.3 },
    pyramid: {
      base: l.base,
      blockW: l.blockW,
      blockH: l.blockH,
      blocks: blocks(
        l,
        l.slots.map(() => ({ look: "set" })),
      ),
      rubble: 0,
      monument: "int-walls",
      apex: l.apex,
      capstone: capstone({ state: "set", integration: "int-walls", ...l.apex, flag: "passed", ready: true }),
    },
    far: farPyramids([6, 9]),
    actors: [arbab()],
    coins: 26,
    time: 49,
  });
}

export const FRAMES = { day: dayWorld, dusk: duskWorld, capstone: capstoneWorld, night: nightWorld, idle: idleWorld } as const;

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
