// The scene and the renderer together (DESIGN.md §19): a scripted day of snapshots through the real createScene,
// stepped at 60 fps and drawn by the real renderWorld. Its moments are goldens in docs/ui/live-<moment>.png, with the
// rule of frames.test.ts: a missing frame is written, an existing one is compared by decoded pixels.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { UiIntegration, UiLane, UiSnapshot } from "../protocol";
import { plaqueBox, shakeOffset } from "./app/art/fx";
import { caravanAt, feluccaAt } from "./app/art/land";
import { siteTorches, torchLight } from "./app/art/props";
import type { Canvas2D } from "./app/browser";
import { BUBBLE, GOLD, PLATE } from "./app/palette";
import type { Raster } from "./app/raster";
import { createRaster, decodePng, encodePng } from "./app/raster";
import { GROUND_Y, ladderTop, PLAQUE_FOOT, renderWorld } from "./app/render";
import type { Actor, Scene, World } from "./model";
import { ACTOR_BOX, HEIGHT, PLACES, PYRAMID_AREA, WIDTH } from "./model";
import { pyramidLayout, workSpot } from "./scene/layout";
import { createScene } from "./scene/scene";
import { at, finishedLane, seededRandom, T0, uiIntegration, uiLane, uiQuota, uiSnapshot } from "./scene/testkit";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCALE = 2;
const FRAME_MS = 1000 / 60;

function golden(name: string, raster: Raster): void {
  const file = join(ROOT, "docs", "ui", `${name}.png`);
  const png = encodePng(raster.width, raster.height, raster.data, SCALE);
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, png);
    return;
  }
  const want = decodePng(readFileSync(file));
  const got = decodePng(png);
  const same = want.width === got.width && want.height === got.height && Buffer.from(want.data).equals(Buffer.from(got.data));
  if (!same) throw new Error(`docs/ui/${name}.png is stale: delete it and run the test again to accept the new frame`);
}

function rasterize(world: World): Raster {
  const raster = createRaster(WIDTH, HEIGHT);
  renderWorld(raster, world);
  return raster;
}

// ---------------------------------------------------------------------------------------------------------------
// The day

const NOW_SEC = Date.parse(T0) / 1000;

interface Moment {
  raster: Raster;
  /** Copies of what the moment's checks look at: the world goes on changing after it. */
  actors: Actor[];
  world: World;
}

/** The foreground's slots, in snapshot order (nine builders: base 4). */
const SLOT = {
  found: 0,
  walls: 1,
  shaft: 2,
  hall: 3,
  ramp: 4,
  gate: 5,
  court: 6,
  crypt: 7,
  obelisk: 8,
} as const;
const LAYOUT = pyramidLayout(9);

function spotOf(lane: keyof typeof SLOT): { x: number; y: number } {
  const slot = LAYOUT.slots[SLOT[lane]];
  if (!slot) throw new Error(`no slot for ${lane}`);
  return workSpot(slot);
}

function playDay(): Map<string, Moment> {
  const scene: Scene = createScene({ reducedMotion: false, random: seededRandom(1907) });
  const moments = new Map<string, Moment>();
  let seconds = 0;

  const lanes = new Map<string, UiLane>(
    [
      finishedLane({ name: "found", integration: "int-walls", toolCalls: 44, costUsd: 1.4 }),
      finishedLane({ name: "walls", integration: "int-walls", toolCalls: 38, costUsd: 0.9 }),
      finishedLane({ name: "shaft", endState: "failed", reportStatus: null, toolCalls: 30, costUsd: 0.6 }),
      uiLane({ name: "hall", state: "waiting-reset", toolCalls: 18, costUsd: 0.7 }),
      uiLane({ name: "ramp", state: "running", toolCalls: 10, costUsd: 0.3 }),
      uiLane({ name: "gate", state: "running", toolCalls: 70, costUsd: 2.1 }),
      uiLane({ name: "court", state: "running", toolCalls: 24, costUsd: 3.2 }),
      uiLane({ name: "crypt", state: "held", hold: "quota" }),
    ].map((l) => [l.name, l]),
  );
  const integrations = new Map<string, UiIntegration>([
    [
      "int-old",
      uiIntegration({
        name: "int-old",
        lanes: ["old-1", "old-2", "old-3", "old-4", "old-5", "old-6"],
        updatedAt: at(-7300),
        verify: "passed",
        landedAt: at(-7200),
      }),
    ],
    ["int-walls", uiIntegration({ name: "int-walls", lanes: ["found", "walls"], updatedAt: at(-300), verify: "passed" })],
  ]);
  const change = (name: string, fields: Partial<UiLane>): void => {
    const lane = lanes.get(name) ?? uiLane({ name });
    lanes.set(name, { ...lane, ...fields });
  };
  const snapshot = (): UiSnapshot =>
    uiSnapshot({
      now: at(seconds),
      lanes: [...lanes.values()],
      integrations: [...integrations.values()],
      quota: uiQuota({ fiveHour: { utilization: 0.4, resetsAt: NOW_SEC + 10_800 } }),
    });

  const frame = (): void => {
    scene.step(FRAME_MS);
    // The page plays the events and empties the array every frame.
    scene.world.events.length = 0;
    seconds += FRAME_MS / 1000;
  };
  const stepFor = (s: number): void => {
    for (let i = 0; i < Math.round(s * 60); i += 1) frame();
  };
  const stepUntil = (label: string, cond: () => boolean, maxSeconds: number): void => {
    for (let i = 0; i < maxSeconds * 60; i += 1) {
      if (cond()) return;
      frame();
    }
    if (!cond()) throw new Error(`${label}: not reached in ${maxSeconds} s`);
  };
  const actor = (lane: string): Actor | undefined => scene.world.actors.find((a) => a.lane === lane);
  const capture = (name: string): void => {
    moments.set(name, {
      raster: rasterize(scene.world),
      actors: scene.world.actors.map((a) => ({ ...a })),
      world: structuredClone(scene.world),
    });
  };

  // A session in progress: the first snapshot sets the scene as it stands.
  scene.apply(snapshot());
  capture("baseline");

  // A new lane comes in from the village and talks with arbab.
  stepFor(0.5);
  change("obelisk", { state: "running", firstSeen: at(seconds), since: at(seconds) });
  scene.apply(snapshot());
  stepUntil("talk", () => actor("obelisk")?.bubble?.open === 1, 20);
  stepFor(0.2);
  // Hovered while it talks: its nameplate stands over its bubble.
  scene.highlight("obelisk");
  capture("talk");
  scene.highlight(null);

  // After the brief it carries a stone up its ladder to course 2.
  stepUntil("climb", () => {
    const a = actor("obelisk");
    return a !== undefined && a.pose === "climb-stone" && a.y <= GROUND_Y - 20;
  }, 30);
  capture("climb");

  // New tool calls once the climber is on its plank: the blow of a stroke on an upper course, stone placed.
  stepUntil("at work", () => actor("obelisk")?.pose === "work", 10);
  change("ramp", { toolCalls: 16 });
  scene.apply(snapshot());
  stepUntil("strike", () => (actor("ramp")?.stroke ?? 0) >= 0.55, 5);
  capture("strike");

  // A failure: the block's stones tumble and the camera shakes.
  change("gate", { state: "finished", endState: "failed", reportStatus: null, elapsedMs: 600_000 });
  scene.apply(snapshot());
  const fellAt = seconds;
  stepUntil("fall-shake", () => {
    const o = shakeOffset(scene.world.shake, scene.world.time);
    return Math.abs(o.dx) >= 1 && Math.abs(o.dy) >= 1;
  }, 0.15);
  capture("fall-shake");
  stepFor(0.2 - (seconds - fellAt));
  capture("fall");

  // A success: the worker reports, then takes bread and beer at the table.
  change("court", { state: "finished", endState: "success", reportStatus: "done", elapsedMs: 900_000 });
  scene.apply(snapshot());
  // It climbs down from course 1 empty-handed: the stone stays in the wall.
  stepUntil("climb-down", () => {
    const a = actor("court");
    return a !== undefined && a.pose === "climb" && a.y >= spotOf("court").y + 4;
  }, 10);
  capture("climb-down");
  stepUntil("ration", () => {
    const a = actor("court");
    return a !== undefined && a.pose === "idle" && a.x === PLACES.rations.x && a.y === PLACES.rations.y;
  }, 60);
  stepFor(0.2);
  capture("ration");

  // The integration lands: the capstone goes up.
  const walls = integrations.get("int-walls");
  if (walls) integrations.set("int-walls", { ...walls, landedAt: at(seconds - 1), updatedAt: at(seconds - 1) });
  scene.apply(snapshot());
  stepFor(1.5);
  capture("capstone-hoist");
  stepUntil("capstone", () => scene.world.pyramid.capstone.state === "set", 3);
  capture("capstone-glow");
  stepFor(0.25);
  capture("capstone");

  return moments;
}

/** The finished lanes an integration merged, and the integration landed two hours ago. */
function landed(name: string, count: number): { lanes: UiLane[]; integration: UiIntegration } {
  const names = Array.from({ length: count }, (_, i) => `${name}-${i + 1}`);
  return {
    lanes: names.map((n) => finishedLane({ name: n, integration: name, toolCalls: 30, costUsd: 0.8 })),
    integration: uiIntegration({ name, lanes: names, updatedAt: at(-7300), verify: "passed", ready: true, landedAt: at(-7200) }),
  };
}

/**
 * Nobody at work: the last landing stands as the monument with its plaque, and the valley goes on living. At 49 s the
 * felucca is mid-river and the caravan mid-crossing.
 */
const IDLE_SECONDS = 49;

function playIdle(blocks: number, seconds: number): Moment {
  const scene = createScene({ reducedMotion: false, random: seededRandom(77) });
  const old = landed("int-quarry", 5);
  const last = landed("int-walls", blocks);
  scene.apply(
    uiSnapshot({
      lanes: [...old.lanes, ...last.lanes],
      integrations: [{ ...old.integration, landedAt: at(-9000) }, last.integration],
      quota: uiQuota({ fiveHour: { utilization: 0.2, resetsAt: NOW_SEC + 12_600 } }),
    }),
  );
  for (let i = 0; i < Math.round(seconds * 60); i += 1) scene.step(FRAME_MS);
  return { raster: rasterize(scene.world), actors: scene.world.actors.map((a) => ({ ...a })), world: structuredClone(scene.world) };
}

/** The account rejected while lanes still run: night over the site, the builders at work under the torches. */
function playNightWork(): Moment {
  const scene = createScene({ reducedMotion: false, random: seededRandom(4242) });
  const lanes = [
    uiLane({ name: "walls", state: "running", toolCalls: 30, costUsd: 1.2 }),
    finishedLane({ name: "found", toolCalls: 40 }),
    uiLane({ name: "shaft", state: "running", toolCalls: 12, costUsd: 0.4 }),
    uiLane({ name: "hall", state: "running", toolCalls: 22, costUsd: 0.9 }),
    uiLane({ name: "ramp", state: "running", toolCalls: 6, costUsd: 0.2 }),
    uiLane({ name: "gate", state: "running", toolCalls: 50, costUsd: 1.6 }),
    uiLane({ name: "court", state: "held", hold: "quota" }),
  ];
  scene.apply(
    uiSnapshot({
      lanes,
      quota: uiQuota({ status: "rejected", fiveHour: { utilization: 1, resetsAt: NOW_SEC + 3_600 } }),
    }),
  );
  for (let i = 0; i < 90; i += 1) scene.step(FRAME_MS);
  return { raster: rasterize(scene.world), actors: scene.world.actors.map((a) => ({ ...a })), world: structuredClone(scene.world) };
}

const DAY = playDay();
DAY.set("idle", playIdle(8, IDLE_SECONDS));
DAY.set("night-work", playNightWork());

function moment(name: string): Moment {
  const m = DAY.get(name);
  if (!m) throw new Error(`no moment ${name}`);
  return m;
}

function actorIn(m: Moment, lane: string): Actor {
  const a = m.actors.find((x) => x.lane === lane);
  if (!a) throw new Error(`no actor for ${lane}`);
  return a;
}

/** Feet on the ground, on the pyramid's foot, or on the top of a course (where the course below ends). */
function standsOnSomething(a: Actor): boolean {
  if (a.y >= PYRAMID_AREA.baseY) return true;
  const half = (LAYOUT.base * LAYOUT.blockW) / 2;
  if (Math.abs(a.x - PYRAMID_AREA.centerX) > half) return true; // the dunes: camp, well, horizon
  return (PYRAMID_AREA.baseY - a.y) % LAYOUT.blockH === 0;
}

describe("the live scene", () => {
  for (const name of DAY.keys()) {
    it(`live-${name}.png matches the scene drawn by the renderer`, () => {
      const m = moment(name);
      for (let i = 3; i < m.raster.data.length; i += 4) expect(m.raster.data[i]).toBe(255);
      golden(`live-${name}`, m.raster);
    });

    it(`${name}: every worker not climbing stands on the ground or a course`, () => {
      for (const a of moment(name).actors) {
        if (a.pose === "climb" || a.pose === "climb-stone" || a.alpha === 0) continue;
        expect(standsOnSomething(a), `${a.id} at ${a.x},${a.y} (${a.pose})`).toBe(true);
      }
    });
  }

  it("baseline: 8 lanes in mixed states, a capstone waiting with a green pennant, one far pyramid", () => {
    const { world } = moment("baseline");
    const looks = world.pyramid.blocks.filter((b) => b.lane !== null).map((b) => b.look);
    expect(looks).toEqual(["set", "set", "fallen", "stalled", "building", "building", "building", "planned"]);
    expect(world.pyramid.capstone).toMatchObject({ state: "waiting", flag: "passed" });
    expect(world.far.map((f) => f.integration)).toEqual(["int-old"]);
    expect(world.pyramid.rubble).toBeGreaterThan(0);
    expect(world.sky.phase).toBe("day");
  });

  it("talk: the new worker faces arbab at the audience spot with its bubble open", () => {
    const m = moment("talk");
    expect(actorIn(m, "obelisk")).toMatchObject({ ...PLACES.audience, facing: -1, pose: "talk", bubble: { open: 1 } });
    expect(m.actors[0]?.bubble).toBeNull();
  });

  it("climb: the ladder stands under the slot and reaches from the ground line to the climber", () => {
    const m = moment("climb");
    const a = actorIn(m, "obelisk");
    expect(a.pose).toBe("climb-stone");
    expect(a.x).toBe(spotOf("obelisk").x);
    expect(a.y).toBeGreaterThanOrEqual(spotOf("obelisk").y);
    expect(a.y).toBeLessThan(GROUND_Y);
    const top = ladderTop(Math.round(a.y), m.world.pyramid);
    expect((PYRAMID_AREA.baseY - top) % LAYOUT.blockH).toBe(0);
    expect(top).toBeLessThan(a.y);
    expect(top).toBeGreaterThanOrEqual(spotOf("obelisk").y - LAYOUT.blockH);
  });

  it("climb-down: the finished builder climbs down its ladder empty-handed", () => {
    const a = actorIn(moment("climb-down"), "court");
    expect(a.pose).toBe("climb");
    expect(a.x).toBe(spotOf("court").x);
    expect(a.y).toBeGreaterThan(spotOf("court").y);
    expect(a.y).toBeLessThan(GROUND_Y);
  });

  it("strike: the builder on course 1 is past the middle of a stroke, its stone just placed", () => {
    const m = moment("strike");
    const a = actorIn(m, "ramp");
    expect(a).toMatchObject({ ...spotOf("ramp"), pose: "work" });
    expect(a.stroke).toBeGreaterThanOrEqual(0.5);
    expect(a.stroke).toBeLessThan(0.8);
    expect(spotOf("ramp").y).toBeLessThan(PYRAMID_AREA.baseY);
    expect(m.world.pyramid.blocks.find((b) => b.lane === "ramp")?.flash).toBeGreaterThan(0.5);
    expect(actorIn(m, "obelisk")).toMatchObject({ ...spotOf("obelisk"), pose: "work" });
  });

  it("fall: the failed block's stones are in the air above the foot", () => {
    const { world } = moment("fall");
    const block = world.pyramid.blocks.find((b) => b.lane === "gate");
    expect(block?.look).toBe("fallen");
    const stones = world.particles.filter((p) => p.kind === "stone");
    expect(stones.length).toBeGreaterThanOrEqual(4);
    const half = (LAYOUT.base * LAYOUT.blockW) / 2;
    for (const p of stones) {
      expect(p.y).toBeLessThan(PYRAMID_AREA.baseY);
      expect(Math.abs(p.x - PYRAMID_AREA.centerX)).toBeLessThanOrEqual(half);
    }
  });

  it("ration: the worker pauses at the bread-and-beer table", () => {
    expect(actorIn(moment("ration"), "court")).toMatchObject({ ...PLACES.rations, pose: "idle" });
  });

  it("capstone: halfway up, then on the apex", () => {
    const hoist = moment("capstone-hoist").world.pyramid;
    expect(hoist.capstone.state).toBe("hoisting");
    expect(hoist.capstone.y).toBeLessThan(PLACES.sledge.y);
    expect(hoist.capstone.y).toBeGreaterThan(hoist.apex.y);
    const set = moment("capstone").world.pyramid;
    expect(set.capstone).toMatchObject({ state: "set", ...set.apex });
    expect(moment("capstone").actors[0]?.pose).toBe("cheer");
  });

  it("talk: the hovered worker's nameplate stands above its bubble", () => {
    const m = moment("talk");
    expect(actorIn(m, "obelisk").highlight).toBe(true);
    // The plate's rim is gold over a dark fill; the bubble's is white. Above the speaker's head, the plate comes first.
    const column = PLACES.audience.x;
    let plate = -1;
    let bubble = -1;
    for (let y = 0; y < PLACES.audience.y; y += 1) {
      const c = pixelAt(m.raster, column, y);
      if (plate < 0 && c === PLATE.fill.toLowerCase()) plate = y;
      if (bubble < 0 && c === BUBBLE.fill.toLowerCase()) bubble = y;
    }
    expect(plate).toBeGreaterThan(0);
    expect(bubble).toBeGreaterThan(plate);
  });

  it("fall-shake: the stones in the air while the camera is off by a pixel or more each way", () => {
    const { world } = moment("fall-shake");
    expect(world.particles.filter((p) => p.kind === "stone").length).toBeGreaterThanOrEqual(4);
    const o = shakeOffset(world.shake, world.time);
    expect(Math.abs(o.dx)).toBeGreaterThanOrEqual(1);
    expect(Math.abs(o.dy)).toBeGreaterThanOrEqual(1);
    // The shake moves the scene, not the frame: the shaken and the still frame differ in the middle.
    const still = rasterize({ ...world, shake: 0 });
    expect(Buffer.from(still.data).equals(Buffer.from(moment("fall-shake").raster.data))).toBe(false);
  });

  it("capstone-glow: the stone just set on the apex, gold inside its beam", () => {
    const m = moment("capstone-glow");
    const cap = m.world.pyramid.capstone;
    expect(cap).toMatchObject({ state: "set", ...m.world.pyramid.apex });
    expect(cap.glow).toBeGreaterThan(0.95);
    // The stone keeps its own gold under the light: its shaded right side at the base row.
    const shade = pixelAt(m.raster, cap.x + 2 + shakeOffset(m.world.shake, m.world.time).dx, cap.y - 1 + shakeOffset(m.world.shake, m.world.time).dy);
    expect(Object.values(GOLD).map((c) => c.toLowerCase())).toContain(shade);
  });

  it("idle: nobody at work, the monument with its plaque, the felucca and the caravan on screen", () => {
    const { world } = moment("idle");
    expect(world.actors.map((a) => a.id)).toEqual(["arbab"]);
    expect(world.pyramid.monument).toBe("int-walls");
    expect(world.pyramid.blocks.every((b) => b.look === "set")).toBe(true);
    expect(world.pyramid.capstone).toMatchObject({ state: "set", ...world.pyramid.apex });
    expect(world.far.map((f) => f.integration)).toEqual(["int-quarry"]);
    const boat = feluccaAt(world.time);
    expect(boat?.x).toBeGreaterThan(0);
    expect(boat?.x).toBeLessThan(WIDTH);
    const caravan = caravanAt(world.time);
    expect(caravan.length).toBeGreaterThan(0);
    expect(caravan.every((c) => c.x > 0 && c.x < WIDTH)).toBe(true);
  });

  it("night-work: night over the site, builders at work, the corner workers in the torches' light", () => {
    const { world, actors } = moment("night-work");
    expect(world.sky.phase).toBe("night");
    const working = actors.filter((a) => a.pose === "work");
    expect(working.length).toBe(5);
    const lights = siteTorches(world.pyramid).map(torchLight);
    const lit = working.filter((a) => lights.some((l) => Math.hypot(a.x - l.x, a.y - 8 - l.y) <= l.radius));
    expect(lit.length).toBeGreaterThanOrEqual(2);
  });

  for (const blocks of [1, 8, 30]) {
    it(`a monument of ${blocks} blocks: the plaque stands on the sand in front of its foot, clear of the dais`, () => {
      const { world, raster } = playIdle(blocks, 1);
      expect(world.pyramid.monument).toBe("int-walls");
      expect(world.pyramid.blocks.length).toBe((world.pyramid.base * (world.pyramid.base + 1)) / 2);
      const box = plaqueBox("int-walls", PLAQUE_FOOT.x, PLAQUE_FOOT.y);
      const without = rasterize({ ...world, pyramid: { ...world.pyramid, monument: null } });
      const changed = (y: number): number => {
        let n = 0;
        for (let x = box.x - 4; x < box.x + box.w + 4; x += 1) if (pixelAt(raster, x, y) !== pixelAt(without, x, y)) n += 1;
        return n;
      };
      // The slab is drawn; between it and the bottom course lies untouched sand.
      for (let y = box.y; y < box.y + box.h; y += 1) expect(changed(y)).toBeGreaterThan(box.w / 2);
      expect(box.y).toBeGreaterThanOrEqual(PYRAMID_AREA.baseY + 3);
      for (let y = PYRAMID_AREA.baseY; y < box.y; y += 1) expect(changed(y), `row ${y}`).toBe(0);
      // Clear of arbab's audience and of the capstone's sledge.
      expect(box.x).toBeGreaterThan(PLACES.audience.x + ACTOR_BOX.w);
      expect(box.x + box.w).toBeLessThan(PLACES.sledge.x - 12);
    });
  }
});

function pixelAt(raster: Raster, x: number, y: number): string {
  const i = (Math.round(y) * raster.width + Math.round(x)) * 4;
  const hex = (v: number | undefined): string => (v ?? 0).toString(16).padStart(2, "0");
  return `#${hex(raster.data[i])}${hex(raster.data[i + 1])}${hex(raster.data[i + 2])}`;
}

// ---------------------------------------------------------------------------------------------------------------
// The cost of a frame

/** A Canvas2D that only counts. */
function counter(): Canvas2D & { fills: number } {
  return {
    fills: 0,
    fillStyle: "#000000",
    globalAlpha: 1,
    imageSmoothingEnabled: false,
    fillRect() {
      this.fills += 1;
    },
    clearRect() {},
  };
}

describe("a 300-lane world", () => {
  it("draws with fewer than 60,000 fillRect calls a frame", () => {
    const states = ["running", "running", "running", "queued", "held", "waiting-reset", "orphaned", "preparing"] as const;
    const lanes: UiLane[] = [];
    for (const role of ["reviewer", "probe", "researcher"] as const) {
      for (let i = 0; i < 4; i += 1) lanes.push(uiLane({ name: `${role}-${i}`, role, state: "running" }));
    }
    for (let i = lanes.length; i < 300; i += 1) {
      const name = `lane-${String(i).padStart(3, "0")}`;
      if (i % 5 === 4) lanes.push(finishedLane({ name, endState: i % 10 === 4 ? "failed" : "success", reportStatus: null }));
      else lanes.push(uiLane({ name, state: states[i % states.length] ?? "running", hold: "quota", toolCalls: i % 60 }));
    }
    const scene = createScene({ reducedMotion: false, random: seededRandom(3) });
    scene.apply(uiSnapshot({ lanes }));
    let most = 0;
    for (let f = 0; f < 120; f += 1) {
      scene.step(FRAME_MS);
      const ctx = counter();
      renderWorld(ctx, scene.world);
      most = Math.max(most, ctx.fills);
    }
    expect(scene.world.actors.length).toBeGreaterThan(200);
    expect(most).toBeLessThan(60_000);
  });
});
