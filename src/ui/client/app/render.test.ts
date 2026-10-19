import { describe, expect, it } from "vitest";
import type { UiLane } from "../../protocol";
import type { Actor, World } from "../model";
import { ACTOR_BOX, HEIGHT, HORIZON_Y, PLACES, PYRAMID_AREA, WIDTH } from "../model";
import { pyramidLayout, workSpot } from "../scene/layout";
import { createScene } from "../scene/scene";
import { finishedLane, seededRandom, uiLane, uiSnapshot } from "../scene/testkit";
import { plaqueBox, shakeOffset } from "./art/fx";
import { FIRE_AT } from "./art/props";
import { sunColors } from "./art/sky";
import type { Canvas2D } from "./browser";
import { actor, arbab, dayWorld, duskWorld, FRAMES, nightWorld } from "./fixtures";
import { BUBBLE, FLAG, GOLD, LIMESTONE, MOON, OUTLINE, parseHex, PLATE, VIGNETTE, WOOD } from "./palette";
import type { Raster } from "./raster";
import { createRaster } from "./raster";
import {
  coinRects,
  frameIndex,
  GROUND_Y,
  ladderTop,
  MOON_AT,
  PLAQUE_FOOT,
  prng,
  renderWorld,
  shineOffset,
  stoneLayout,
  sunPosition,
} from "./render";

interface Op {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  alpha: number;
}

/** A Canvas2D that records every rectangle and every alpha it is given. */
function recorder(): Canvas2D & { ops: Op[]; alphas: number[] } {
  const ops: Op[] = [];
  const alphas: number[] = [];
  let alpha = 1;
  return {
    ops,
    alphas,
    fillStyle: "#000000",
    imageSmoothingEnabled: true,
    get globalAlpha() {
      return alpha;
    },
    set globalAlpha(value: number) {
      alphas.push(value);
      alpha = value;
    },
    fillRect(x, y, w, h) {
      ops.push({ x, y, w, h, color: this.fillStyle, alpha });
    },
    clearRect() {},
  };
}

function empty(): World {
  const w = dayWorld();
  return { ...w, actors: [], particles: [], far: [], coins: 0, pyramid: { ...w.pyramid, blocks: [], rubble: 0, capstone: { ...w.pyramid.capstone, state: "none", flag: "none" } } };
}

function rasterize(world: World): Raster {
  const r = createRaster(WIDTH, HEIGHT);
  renderWorld(r, world);
  return r;
}

function pixel(r: Raster, x: number, y: number): string {
  const i = (y * r.width + x) * 4;
  return Array.from(r.data.subarray(i, i + 3)).join(",");
}

const hex = (color: string): string => parseHex(color).join(",");

describe("renderWorld", () => {
  for (const [name, make] of Object.entries(FRAMES)) {
    it(`${name}: integer rectangles inside the canvas, #rrggbb colors, alpha back to 1`, () => {
      const ctx = recorder();
      renderWorld(ctx, make());
      expect(ctx.ops.length).toBeGreaterThan(100);
      for (const op of ctx.ops) {
        expect(Number.isInteger(op.x) && Number.isInteger(op.y) && Number.isInteger(op.w) && Number.isInteger(op.h)).toBe(true);
        expect(op.x).toBeGreaterThanOrEqual(0);
        expect(op.y).toBeGreaterThanOrEqual(0);
        expect(op.w).toBeGreaterThan(0);
        expect(op.h).toBeGreaterThan(0);
        expect(op.x + op.w).toBeLessThanOrEqual(WIDTH);
        expect(op.y + op.h).toBeLessThanOrEqual(HEIGHT);
        expect(op.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
      expect(ctx.globalAlpha).toBe(1);
      expect(ctx.imageSmoothingEnabled).toBe(false);
    });
  }

  it("clips actors walking in off the edge and keeps bubbles inside", () => {
    const world = empty();
    world.actors = [
      actor({ id: "in", cast: "laborer", ...PLACES.spawn, pose: "walk", bubble: { seed: 3, open: 1 } }),
      actor({ id: "edge", cast: "scout", x: WIDTH + 2, y: 200, pose: "walk", bubble: { seed: 9, open: 1 } }),
      actor({ id: "top", cast: "mason", x: 240, y: 12, pose: "climb", bubble: { seed: 4, open: 1 } }),
    ];
    const ctx = recorder();
    renderWorld(ctx, world);
    for (const op of ctx.ops) {
      expect(op.x >= 0 && op.y >= 0 && op.x + op.w <= WIDTH && op.y + op.h <= HEIGHT).toBe(true);
    }
    // Bubble fill was drawn for all three, inside the canvas.
    expect(ctx.ops.filter((op) => op.color === BUBBLE.fill).length).toBeGreaterThanOrEqual(3);
  });

  it("restores globalAlpha after a fading actor, a ghost and a flash", () => {
    const world = dayWorld();
    world.actors.push(actor({ id: "fade", cast: "laborer", x: 200, y: 240, alpha: 0.3 }));
    world.actors.push(actor({ id: "ghost", cast: "laborer", x: 230, y: 240, ghost: true }));
    const ctx = recorder();
    renderWorld(ctx, world);
    expect(ctx.alphas).toContain(0.3);
    expect(ctx.alphas).toContain(0.5);
    // flash 0.35 → 0.21
    expect(ctx.alphas.some((a) => Math.abs(a - 0.21) < 1e-9)).toBe(true);
    // Every alpha below 1 is followed by a 1 before the next one.
    let open = false;
    for (const a of ctx.alphas) {
      if (a < 1) {
        expect(open).toBe(false);
        open = true;
      } else open = false;
    }
    expect(ctx.globalAlpha).toBe(1);
  });

  it("does not draw an actor whose alpha is 0", () => {
    const world = empty();
    world.actors = [actor({ id: "gone", cast: "laborer", x: 240, y: 240, alpha: 0 })];
    const without = rasterize(empty());
    const with0 = rasterize(world);
    expect(Buffer.from(with0.data).equals(Buffer.from(without.data))).toBe(true);
  });

  it("draws back to front: the pyramid over the ground, actors over blocks, bubbles over actors", () => {
    const l = pyramidLayout(10);
    const world = dayWorld();
    const slot = l.slots[0];
    if (!slot) throw new Error("no slot");
    const at = workSpot(slot);
    world.actors = [actor({ id: "front", cast: "laborer", ...at, bubble: null })];
    const r = rasterize(world);
    // The worker's dark outline covers the set block it stands in front of (block 0 is set).
    const body = (): number => {
      let n = 0;
      for (let y = at.y - ACTOR_BOX.h; y < at.y; y++) {
        for (let x = at.x - 6; x < at.x + 6; x++) if (pixel(r, x, y) === hex(OUTLINE)) n++;
      }
      return n;
    };
    expect(body()).toBeGreaterThan(20);
    // A bubble over a worker below: the bubble's fill wins.
    world.actors = [actor({ id: "low", cast: "laborer", x: 240, y: 250 }), actor({ id: "talker", cast: "laborer", x: 240, y: 270, bubble: { seed: 1, open: 1 } })];
    const r2 = rasterize(world);
    let fill = 0;
    for (let y = 225; y < 250; y++) for (let x = 230; x < 250; x++) if (pixel(r2, x, y) === hex(BUBBLE.fill)) fill++;
    expect(fill).toBeGreaterThan(10);
  });

  it("draws actors in y order, the lower one in front", () => {
    const world = empty();
    world.actors = [
      actor({ id: "front", cast: "mason", x: 240, y: 244 }),
      actor({ id: "back", cast: "laborer", x: 240, y: 240 }),
    ];
    const r = rasterize(world);
    // The mason's blue headcloth shows where the two overlap.
    const blue = "60,111,176";
    let n = 0;
    for (let y = 226; y < 236; y++) for (let x = 234; x < 246; x++) if (pixel(r, x, y) === blue) n++;
    expect(n).toBeGreaterThan(5);
  });

  it("mirrors an actor facing −1", () => {
    // The sun straight overhead, so the actor's shadow falls under its feet and mirrors with it.
    const overhead = (): World => ({ ...empty(), sky: { phase: "day", sun: 0.5 } });
    const base = rasterize(overhead());
    const at = { x: 240, y: 240 };
    const right = overhead();
    right.actors = [actor({ id: "a", cast: "laborer", ...at, facing: 1 })];
    const left = overhead();
    left.actors = [actor({ id: "a", cast: "laborer", ...at, facing: -1 })];
    const r = rasterize(right);
    const l = rasterize(left);
    let changed = 0;
    for (let y = at.y - ACTOR_BOX.h; y < at.y; y++) {
      for (let c = 0; c < ACTOR_BOX.w; c++) {
        const x = at.x - 6 + c;
        const mx = at.x - 6 + (ACTOR_BOX.w - 1 - c);
        const drawnRight = pixel(r, x, y) !== pixel(base, x, y);
        const drawnLeft = pixel(l, mx, y) !== pixel(base, mx, y);
        expect(drawnLeft, `${c},${y}`).toBe(drawnRight);
        if (drawnRight) {
          changed++;
          expect(pixel(l, mx, y)).toBe(pixel(r, x, y));
        }
      }
    }
    expect(changed).toBeGreaterThan(60);
  });

  it("puts a ladder under a climber and a plank under a worker above the ground line", () => {
    const climb = empty();
    climb.actors = [actor({ id: "c", cast: "laborer", x: 240, y: 180, pose: "climb" })];
    const r = rasterize(climb);
    expect(pixel(r, 236, GROUND_Y - 1)).toBe(hex(WOOD[1]));
    expect(pixel(r, 243, GROUND_Y - 1)).toBe(hex(WOOD[1]));
    const work = empty();
    work.actors = [actor({ id: "w", cast: "laborer", x: 240, y: 180, pose: "work" })];
    const p = rasterize(work);
    expect(pixel(p, 232, 180)).toBe(hex(WOOD[0]));
    const ground = empty();
    ground.actors = [actor({ id: "g", cast: "laborer", x: 240, y: 240, pose: "work" })];
    expect(pixel(rasterize(ground), 232, 240)).not.toBe(hex(WOOD[0]));
    // The bottom course's workers stand on the pyramid's foot, two pixels above the ground line: no plank.
    const foot = empty();
    foot.actors = [actor({ id: "f", cast: "laborer", x: 240, y: PYRAMID_AREA.baseY, pose: "work" })];
    const plain = rasterize(empty());
    const onFoot = rasterize(foot);
    for (const x of [231, 232, 247, 248]) expect(pixel(onFoot, x, PYRAMID_AREA.baseY)).toBe(pixel(plain, x, PYRAMID_AREA.baseY));
  });

  it("draws climb empty-handed and climb-stone with the stone on the back, both on a ladder", () => {
    const at = { x: 240, y: 180 };
    const stone = new Set([LIMESTONE.light, LIMESTONE.face, LIMESTONE.edge].map(hex));
    const stonePixels = (r: Raster): number => {
      let n = 0;
      for (let y = at.y - ACTOR_BOX.h; y < at.y; y++) for (let x = at.x - 6; x < at.x + 6; x++) if (stone.has(pixel(r, x, y))) n++;
      return n;
    };
    const plain = rasterize(empty());
    const draw = (pose: Actor["pose"]): Raster => {
      const world = empty();
      world.actors = [actor({ id: "c", cast: "laborer", ...at, pose })];
      return rasterize(world);
    };
    const climb = draw("climb");
    const carrying = draw("climb-stone");
    expect(stonePixels(climb)).toBe(stonePixels(plain));
    expect(stonePixels(carrying)).toBeGreaterThanOrEqual(stonePixels(plain) + 12);
    for (const r of [climb, carrying]) {
      expect(pixel(r, 236, GROUND_Y - 1)).toBe(hex(WOOD[1]));
      expect(pixel(r, 243, GROUND_Y - 1)).toBe(hex(WOOD[1]));
    }
  });

  it("leans a ladder on the first course edge at least 6 px above the climber's feet", () => {
    const pyramid = { base: 4, blockH: 16 };
    expect(ladderTop(205, pyramid)).toBe(192);
    expect(ladderTop(198, pyramid)).toBe(192);
    expect(ladderTop(197, pyramid)).toBe(176);
    expect(ladderTop(182, pyramid)).toBe(176);
    expect(ladderTop(176, pyramid)).toBe(160);
    // Above the top course, or without courses: just over the feet.
    expect(ladderTop(140, pyramid)).toBe(132);
    expect(ladderTop(200, { base: 4, blockH: 0 })).toBe(192);
    const climb = empty();
    climb.actors = [actor({ id: "c", cast: "laborer", x: 240, y: 200, pose: "climb" })];
    const ctx = recorder();
    renderWorld(ctx, climb);
    const top = ladderTop(200, climb.pyramid);
    const rails = ctx.ops.filter((op) => op.color === WOOD[1] && op.w === 1 && (op.x === 236 || op.x === 243));
    expect(rails.map((op) => [op.y, op.y + op.h])).toEqual([
      [top, GROUND_Y],
      [top, GROUND_Y],
    ]);
  });

  it("draws a worker at the table behind it, and one in front of the table in front of it", () => {
    const at = PLACES.rations;
    const plain = rasterize(empty());
    const same = (r: Raster, y: number): boolean => {
      for (let x = at.x - 5; x <= at.x + 5; x++) if (pixel(r, x, y) !== pixel(plain, x, y)) return false;
      return true;
    };
    const behind = empty();
    behind.actors = [actor({ id: "fed", cast: "mason", ...at })];
    // The table's top hides the legs of the worker standing at it.
    expect(same(rasterize(behind), at.y - 2)).toBe(true);
    const front = empty();
    front.actors = [actor({ id: "near", cast: "mason", x: at.x, y: at.y + 6 })];
    expect(same(rasterize(front), at.y)).toBe(false);
  });

  it("keeps rubble on the pyramid's foot", () => {
    const world = empty();
    world.pyramid = { ...dayWorld().pyramid, blocks: [], rubble: 60, capstone: empty().pyramid.capstone };
    const ctx = recorder();
    renderWorld(ctx, world);
    const half = (world.pyramid.base * world.pyramid.blockW) / 2;
    const rubble = ctx.ops.filter((op) => op.y >= PYRAMID_AREA.baseY - 3 && op.y <= PYRAMID_AREA.baseY + 8 && op.color === LIMESTONE.light);
    expect(rubble.length).toBeGreaterThan(0);
    for (const op of rubble) {
      expect(op.x).toBeGreaterThanOrEqual(PYRAMID_AREA.centerX - half);
      expect(op.x + op.w).toBeLessThanOrEqual(PYRAMID_AREA.centerX + half);
    }
  });

  it("blinks a gold marker over a highlighted actor at 2 Hz", () => {
    const at = { x: 240, y: 240 };
    const golds = (r: Raster): number => {
      let n = 0;
      for (let y = at.y - 30; y < at.y - 18; y++) for (let x = at.x - 4; x < at.x + 4; x++) if (pixel(r, x, y) === hex(GOLD.light)) n++;
      return n;
    };
    const world = (poseTime: number, reducedMotion = false): World => ({
      ...empty(),
      reducedMotion,
      actors: [actor({ id: "h", cast: "laborer", ...at, highlight: true, poseTime })],
    });
    expect(golds(rasterize(world(0.1)))).toBeGreaterThan(0);
    expect(golds(rasterize(world(0.3)))).toBe(0);
    expect(golds(rasterize(world(0.3, true)))).toBeGreaterThan(0);
  });

  it("gives every cast a different look", () => {
    const looks = new Set<string>();
    for (const cast of ["laborer", "mason", "scribe", "skeptic", "surveyor", "waterboy", "scout"] as const) {
      const world = empty();
      world.actors = [actor({ id: cast, cast, x: 240, y: 240 })];
      const r = rasterize(world);
      const box: string[] = [];
      for (let y = 222; y < 240; y++) for (let x = 234; x < 246; x++) box.push(pixel(r, x, y));
      looks.add(box.join(";"));
    }
    expect(looks.size).toBe(7);
  });

  it("shows the sun by day and the moon at night", () => {
    const covers = (ops: Op[], x: number, y: number, color: string): boolean =>
      ops.some((op) => op.color === color && op.alpha === 1 && op.x <= x && x < op.x + op.w && op.y <= y && y < op.y + op.h);
    const world = empty();
    world.sky = { phase: "day", sun: 0.5 };
    const day = recorder();
    renderWorld(day, world);
    const sun = sunPosition(0.5);
    expect(covers(day.ops, Math.round(sun.x), Math.round(sun.y), sunColors(sun.y).core)).toBe(true);
    expect(day.ops.some((op) => op.color === MOON)).toBe(false);
    const night = recorder();
    renderWorld(night, nightWorld());
    expect(covers(night.ops, MOON_AT.x, MOON_AT.y, MOON)).toBe(true);
    expect(night.ops.some((op) => op.color === sunColors(sun.y).core)).toBe(false);
  });

  it("draws the same frame for the same world", () => {
    expect(Buffer.from(rasterize(duskWorld()).data).equals(Buffer.from(rasterize(duskWorld()).data))).toBe(true);
  });

  it("draws arbab and survives odd numbers", () => {
    const world = empty();
    const odd: Actor = arbab({ poseTime: Number.NaN, alpha: Number.POSITIVE_INFINITY, x: 116.6, y: 261.4 });
    world.actors = [odd];
    world.sky = { phase: "day", sun: Number.NaN };
    world.coins = 1000;
    const ctx = recorder();
    expect(() => renderWorld(ctx, world)).not.toThrow();
    expect(ctx.globalAlpha).toBe(1);
  });
});

describe("the scene's life and light", () => {
  const diff = (a: Raster, b: Raster, x0: number, y0: number, x1: number, y1: number): number => {
    let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (pixel(a, x, y) !== pixel(b, x, y)) n++;
    return n;
  };

  it("moves the life that carries no data with world.time, and nothing else", () => {
    const at = (time: number): Raster => rasterize({ ...empty(), time });
    const a = at(8);
    const b = at(9);
    // Clouds and birds in the sky, glints and the felucca on the river, the fire and its smoke at the camp.
    expect(diff(a, b, 0, 0, WIDTH, HORIZON_Y)).toBeGreaterThan(50);
    expect(diff(a, b, 0, HORIZON_Y, WIDTH, 136)).toBeGreaterThan(5);
    expect(diff(a, b, FIRE_AT.x - 6, FIRE_AT.y - 40, FIRE_AT.x + 12, FIRE_AT.y)).toBeGreaterThan(3);
    // The same clock draws the same frame.
    expect(Buffer.from(at(8).data).equals(Buffer.from(a.data))).toBe(true);
  });

  it("offsets the whole scene by the camera shake, and keeps the vignette still", () => {
    const still = { ...dayWorld(), time: 3.1 };
    const shaken = { ...still, shake: 3 };
    const { dx, dy } = shakeOffset(3, 3.1);
    expect(dx !== 0 || dy !== 0).toBe(true);
    const a = rasterize(still);
    const b = rasterize(shaken);
    for (let y = 40; y < 230; y += 3) {
      for (let x = 40; x < 440; x += 3) expect(pixel(b, x + dx, y + dy), `${x},${y}`).toBe(pixel(a, x, y));
    }
    const vignette = (world: World): string => {
      const ctx = recorder();
      renderWorld(ctx, world);
      return JSON.stringify(ctx.ops.filter((op) => op.color === VIGNETTE.day));
    };
    expect(vignette(shaken)).toBe(vignette(still));
    // Still, every pixel is covered even at the edges the shake uncovers.
    for (let i = 3; i < b.data.length; i += 4) expect(b.data[i]).toBe(255);
  });

  it("draws the capstone's beam only while it glows", () => {
    const world = (glow: number): World => {
      const w = dayWorld();
      const l = pyramidLayout(10);
      return { ...w, pyramid: { ...w.pyramid, apex: l.apex, capstone: { ...w.pyramid.capstone, state: "set", ...l.apex, glow } } };
    };
    const beam = (w: World): Op[] => {
      const ctx = recorder();
      renderWorld(ctx, w);
      const x = w.pyramid.apex.x;
      // What is laid over the apex's column on row 20: below the vignette's band, above the clouds of this frame.
      return ctx.ops.filter((op) => op.y <= 20 && 20 < op.y + op.h && op.x <= x && x < op.x + op.w && op.alpha < 1);
    };
    expect(beam(world(0))).toEqual([]);
    const lit = beam(world(0.8));
    expect(lit.length).toBeGreaterThan(0);
    expect(lit.every((op) => Math.abs(op.alpha - 0.4) < 1e-9)).toBe(true);
    // About ten pixels wide.
    const r = rasterize(world(0.8));
    const plain = rasterize(world(0));
    const x = world(0).pyramid.apex.x;
    let wide = 0;
    for (let c = x - 8; c < x + 8; c++) if (pixel(r, c, 30) !== pixel(plain, c, 30)) wide++;
    expect(wide).toBeGreaterThanOrEqual(8);
    expect(wide).toBeLessThanOrEqual(12);
  });

  it("flies the verify pennant on the sledge only while the capstone waits there", () => {
    const l = pyramidLayout(10);
    const pennant = (state: World["pyramid"]["capstone"]["state"], flag: "passed" | "failed"): Op[] => {
      const w = dayWorld();
      const at = state === "waiting" || state === "hoisting" ? PLACES.sledge : l.apex;
      const ctx = recorder();
      renderWorld(ctx, { ...w, pyramid: { ...w.pyramid, apex: l.apex, capstone: { ...w.pyramid.capstone, state, ...at, flag } } });
      const color = flag === "passed" ? FLAG.green : FLAG.red;
      return ctx.ops.filter((op) => op.color === color && op.x > PLACES.sledge.x + 15 && op.x <= PLACES.sledge.x + 22 && op.y < PLACES.sledge.y + 5);
    };
    expect(pennant("waiting", "passed").length).toBeGreaterThan(0);
    expect(pennant("waiting", "failed").length).toBeGreaterThan(0);
    for (const state of ["hoisting", "set"] as const) {
      expect(pennant(state, "passed"), state).toEqual([]);
      expect(pennant(state, "failed"), state).toEqual([]);
    }
    // A monument's capstone is set too: an empty sledge.
    const idle = FRAMES.idle();
    const ctx = recorder();
    renderWorld(ctx, idle);
    expect(idle.pyramid.capstone.flag).toBe("passed");
    expect(ctx.ops.filter((op) => op.color === FLAG.green && op.x > PLACES.sledge.x + 15 && op.x <= PLACES.sledge.x + 22)).toEqual([]);
  });

  it("puts a nameplate over a highlighted actor only, inside the canvas", () => {
    const plates = (world: World): Op[] => {
      const ctx = recorder();
      renderWorld(ctx, world);
      return ctx.ops.filter((op) => op.color === PLATE.fill);
    };
    const one = (fields: Partial<Actor>): World => ({ ...empty(), actors: [actor({ id: "lane-x", cast: "laborer", x: 240, y: 240, ...fields })] });
    expect(plates(one({ highlight: false }))).toEqual([]);
    expect(plates(one({ highlight: true })).length).toBeGreaterThan(0);
    // In each corner, the plate and its letters stay on the canvas.
    for (const at of [
      { x: 2, y: 30 },
      { x: WIDTH - 2, y: 30 },
      { x: 2, y: HEIGHT },
      { x: WIDTH - 2, y: HEIGHT },
    ]) {
      const ctx = recorder();
      renderWorld(ctx, { ...one({ ...at, highlight: true, icon: "hourglass", bubble: { seed: 3, open: 1 } }), shake: 4, time: 1.3 });
      const plate = ctx.ops.filter((op) => op.color === PLATE.fill);
      expect(plate.length).toBeGreaterThan(0);
      for (const op of ctx.ops) expect(op.x >= 0 && op.y >= 0 && op.x + op.w <= WIDTH && op.y + op.h <= HEIGHT, JSON.stringify(op)).toBe(true);
      const text = ctx.ops.filter((op) => op.color === PLATE.text);
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it("puts the nameplate above the actor's icon and bubble", () => {
    const ctx = recorder();
    renderWorld(ctx, { ...empty(), actors: [actor({ id: "lane-x", cast: "laborer", x: 240, y: 240, highlight: true, icon: "dots", bubble: { seed: 3, open: 1 } })] });
    const plateBottom = Math.max(...ctx.ops.filter((op) => op.color === PLATE.fill).map((op) => op.y + op.h));
    const bubbleTop = Math.min(...ctx.ops.filter((op) => op.color === BUBBLE.fill).map((op) => op.y));
    expect(plateBottom).toBeLessThan(bubbleTop);
  });

  it("stands the monument's plaque at the pyramid's foot only while there is a monument", () => {
    const idle = FRAMES.idle();
    const name = idle.pyramid.monument ?? "";
    const box = plaqueBox(name, PLAQUE_FOOT.x, PLAQUE_FOOT.y);
    const without = rasterize({ ...idle, pyramid: { ...idle.pyramid, monument: null } });
    const withIt = rasterize(idle);
    expect(diff(without, withIt, box.x, box.y, box.x + box.w, box.y + box.h)).toBeGreaterThan(box.w * box.h * 0.5);
    // Centered under the apex, below the bottom course.
    expect(Math.abs(box.x + box.w / 2 - PYRAMID_AREA.centerX)).toBeLessThanOrEqual(1);
    expect(box.y).toBeGreaterThanOrEqual(PYRAMID_AREA.baseY);
    // Its letters are the name in capitals, in gold.
    const ctx = recorder();
    renderWorld(ctx, idle);
    expect(ctx.ops.filter((op) => op.color === GOLD.light && op.y >= box.y && op.y < box.y + box.h).length).toBeGreaterThan(10);
  });

  it("casts a shadow under an actor, away from the sun", () => {
    const at = { x: 240, y: 240 };
    const lone = (sun: number, fields: Partial<Actor> = {}): World => ({ ...empty(), sky: { phase: "day", sun }, actors: [actor({ id: "a", cast: "laborer", ...at, ...fields })] });
    const darker = (a: Raster, b: Raster, x: number, y: number): boolean => {
      const sum = (r: Raster): number => pixel(r, x, y).split(",").reduce((s, v) => s + Number(v), 0);
      return sum(a) < sum(b);
    };
    const plain = rasterize({ ...empty(), sky: { phase: "day", sun: 0.1 } });
    const morning = rasterize(lone(0.1));
    // Under the feet, and leaning right of them with the sun on the left.
    expect(darker(morning, plain, at.x, at.y)).toBe(true);
    expect(darker(morning, plain, at.x + 6, at.y)).toBe(true);
    expect(darker(morning, plain, at.x - 7, at.y)).toBe(false);
    // A climber on its ladder casts none, and an invisible actor none.
    const none = rasterize(lone(0.1, { alpha: 0 }));
    expect(darker(none, plain, at.x, at.y)).toBe(false);
  });

  it("draws the same frame for the same world, clock included", () => {
    const idle = FRAMES.idle();
    expect(Buffer.from(rasterize(idle).data).equals(Buffer.from(rasterize(FRAMES.idle()).data))).toBe(true);
  });

  it("keeps a 300-lane world under 60,000 fillRect calls a frame, at any hour", () => {
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
    for (const phase of ["day", "dusk", "night"] as const) {
      for (let f = 0; f < 40; f += 1) {
        scene.step(1000 / 60);
        const fills = { n: 0 };
        const ctx: Canvas2D = { fillStyle: "#000000", globalAlpha: 1, imageSmoothingEnabled: false, fillRect: () => void fills.n++, clearRect() {} };
        // A clock that visits the felucca, the caravan, the birds and a shooting star, and a capstone in its glow.
        const world = scene.world;
        renderWorld(ctx, { ...world, sky: { phase, sun: 0.3 }, time: 49 + f * 3.01, shake: f % 2, pyramid: { ...world.pyramid, capstone: { ...world.pyramid.capstone, glow: 0.5 } } });
        most = Math.max(most, fills.n);
      }
    }
    expect(scene.world.actors.length).toBeGreaterThan(200);
    expect(most).toBeLessThan(60_000);
  });
});

describe("shineOffset", () => {
  it("sweeps the shine across a set block as its flash fades", () => {
    expect(shineOffset(1, 32, 16)).toBe(-2);
    expect(shineOffset(0, 32, 16)).toBe(50);
    expect(shineOffset(0.5, 32, 16)).toBeGreaterThan(shineOffset(0.9, 32, 16));
    expect(shineOffset(Number.NaN, 32, 16)).toBe(50);
  });

  it("draws a bright diagonal band on a set block while it flashes", () => {
    const world = (flash: number): World => {
      const w = empty();
      const l = pyramidLayout(10);
      const s = l.slots[0];
      if (!s) throw new Error("no slot");
      return { ...w, pyramid: { ...w.pyramid, blocks: [{ lane: "a", x: s.x, y: s.y, w: s.w, h: s.h, look: "set", fill: 1, flash, highlight: false }] } };
    };
    const ops = (w: World): Op[] => {
      const ctx = recorder();
      renderWorld(ctx, w);
      return ctx.ops.filter((op) => op.color === "#FFFFFF" && op.alpha === 0.75);
    };
    expect(ops(world(0))).toEqual([]);
    const band = ops(world(0.5));
    expect(band.length).toBeGreaterThan(4);
    // Each row's piece sits further left as the rows go down: a diagonal.
    const rows = [...band].sort((a, b) => a.y - b.y);
    expect((rows[rows.length - 1]?.x ?? 0) < (rows[0]?.x ?? 0)).toBe(true);
  });
});

describe("frameIndex", () => {
  const a = (fields: Partial<Actor>): Actor => actor({ id: "a", cast: "laborer", x: 0, y: 0, ...fields });

  it("runs walking and carrying at 8 fps and the rest at 4", () => {
    expect(frameIndex(a({ pose: "walk", poseTime: 0.13 }), 4)).toBe(1);
    expect(frameIndex(a({ pose: "carry-stone", poseTime: 0.5 }), 4)).toBe(0);
    expect(frameIndex(a({ pose: "idle", poseTime: 0.26 }), 2)).toBe(1);
    expect(frameIndex(a({ pose: "slump", poseTime: 0.13 }), 4)).toBe(0);
  });

  it("shows frame 1 while a stroke is under half, else frame 0", () => {
    expect(frameIndex(a({ pose: "work", stroke: 0 }), 2)).toBe(1);
    expect(frameIndex(a({ pose: "work", stroke: 0.49 }), 2)).toBe(1);
    expect(frameIndex(a({ pose: "work", stroke: 0.5 }), 2)).toBe(0);
    // The water carrier works by reusing idle, on the clock.
    expect(frameIndex(a({ cast: "waterboy", pose: "work", stroke: 0.9, poseTime: 0.3 }), 2)).toBe(1);
  });

  it("is 0 for one frame and for nonsense times", () => {
    expect(frameIndex(a({ pose: "sit", poseTime: 5 }), 1)).toBe(0);
    expect(frameIndex(a({ pose: "idle", poseTime: -3 }), 2)).toBe(0);
    expect(frameIndex(a({ pose: "idle", poseTime: Number.NaN }), 2)).toBe(0);
  });
});

describe("stoneLayout", () => {
  it("places the bottom row first, left to right, staggered, covering the block", () => {
    const stones = stoneLayout(32, 16);
    expect(stones[0]).toEqual({ dx: 0, dy: 12, w: 8, h: 4 });
    expect(stones[1]?.dx).toBe(8);
    // The second row starts with a half stone.
    const second = stones.filter((s) => s.dy === 8);
    expect(second[0]).toEqual({ dx: 0, dy: 8, w: 4, h: 4 });
    expect(stones.reduce((sum, s) => sum + s.w * s.h, 0)).toBe(32 * 16);
  });

  it("uses 4 × 2 stones for narrow blocks", () => {
    const stones = stoneLayout(12, 6);
    expect(stones[0]).toEqual({ dx: 0, dy: 4, w: 4, h: 2 });
    expect(stones.reduce((sum, s) => sum + s.w * s.h, 0)).toBe(72);
  });
});

describe("helpers", () => {
  it("puts the sun on its arc", () => {
    expect(sunPosition(0)).toEqual({ x: 40, y: 112 });
    expect(sunPosition(0.5)).toEqual({ x: 240, y: 26 });
    expect(sunPosition(1)).toEqual({ x: 440, y: 112 });
    expect(sunPosition(Number.NaN)).toEqual({ x: 240, y: 26 });
    expect(sunPosition(7)).toEqual({ x: 440, y: 112 });
  });

  it("draws a deterministic, growing coin pile capped at 48", () => {
    expect(coinRects(0)).toEqual([]);
    expect(coinRects(20)).toBe(coinRects(20));
    const height = (n: number): number => Math.min(...coinRects(n).map((r) => r.y));
    expect(height(40)).toBeLessThan(height(10));
    expect(coinRects(100)).toBe(coinRects(48));
  });

  it("repeats a PRNG sequence from its seed", () => {
    const a = prng(42);
    const b = prng(42);
    const seq = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(seq);
    for (const v of seq) expect(v >= 0 && v < 1).toBe(true);
    expect(prng(43)()).not.toBe(seq[0]);
  });
});
