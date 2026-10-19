import { describe, expect, it } from "vitest";
import type { Actor, World } from "../model";
import { ACTOR_BOX, HEIGHT, PLACES, PYRAMID_AREA, WIDTH } from "../model";
import type { Canvas2D } from "./browser";
import { pyramidLayout, workSpot } from "../scene/layout";
import { actor, arbab, dayWorld, duskWorld, FRAMES, nightWorld } from "./fixtures";
import { BUBBLE, GOLD, LIMESTONE, OUTLINE, parseHex, WOOD } from "./palette";
import type { Raster } from "./raster";
import { createRaster } from "./raster";
import { coinRects, frameIndex, GROUND_Y, ladderTop, prng, renderWorld, stoneLayout, sunPosition } from "./render";

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
    const base = rasterize(empty());
    const at = { x: 240, y: 240 };
    const right = empty();
    right.actors = [actor({ id: "a", cast: "laborer", ...at, facing: 1 })];
    const left = empty();
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
    const world = empty();
    world.sky = { phase: "day", sun: 0.5 };
    const day = rasterize(world);
    const sun = sunPosition(0.5);
    expect(pixel(day, Math.round(sun.x), Math.round(sun.y))).toBe(hex("#FFE07A"));
    const night = rasterize(nightWorld());
    expect(pixel(night, 400, 30)).toBe(hex("#E8E6D8"));
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
