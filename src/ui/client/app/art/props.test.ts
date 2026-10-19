import { describe, expect, it } from "vitest";
import { ARBAB_BOX, CAMP, HEIGHT, PLACES, PYRAMID_AREA, WIDTH } from "../../model";
import { pyramidLayout } from "../../scene/layout";
import type { Canvas2D } from "../browser";
import { CANOPY, FIRE } from "../palette";
import { painter } from "./paint";
import {
  bannerFrame,
  CAMEL_AT,
  camelPose,
  CANOPY_BOTTOM,
  CANOPY_TOP,
  FIRE_AT,
  flameFrame,
  LIGHTS,
  PALM_COUNT,
  palmFrame,
  PROP_SHADOWS,
  propScenery,
  QUARRY_AT,
  smokePuffs,
  SMOKE_LOOP,
  SWAY_PERIOD,
  siteTorches,
  torchLight,
  torchScenery,
  torchShadow,
} from "./props";

interface Op {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  alpha: number;
}

function drawAll(time: number, light: ((c: string) => string) | null = null): Op[] {
  const ops: Op[] = [];
  const ctx: Canvas2D = {
    fillStyle: "#000000",
    globalAlpha: 1,
    imageSmoothingEnabled: false,
    fillRect(x, y, w, h) {
      ops.push({ x, y, w, h, color: this.fillStyle, alpha: this.globalAlpha });
    },
    clearRect() {},
  };
  const p = painter(ctx);
  p.tint(light);
  for (const s of propScenery()) s.draw(p, time, light);
  return ops;
}

describe("the camp fire", () => {
  it("cycles three flame frames at 8 fps, each fire on its own phase", () => {
    expect([0, 0.125, 0.25, 0.375].map((t) => flameFrame(t, 0))).toEqual([0, 1, 2, 0]);
    expect(flameFrame(0, 1)).toBe(1);
    expect(flameFrame(Number.NaN, 0)).toBe(0);
  });

  it("sends up smoke puffs that rise, spread and fade, looping every 4 s", () => {
    const puffs = smokePuffs(1.3);
    expect(puffs.length).toBeGreaterThanOrEqual(3);
    for (const s of puffs) {
      expect(s.y).toBeLessThan(FIRE_AT.y - 8);
      expect(s.alpha).toBeGreaterThan(0);
      expect(s.alpha).toBeLessThanOrEqual(0.7);
    }
    // The highest puff is the biggest and the faintest.
    const sorted = [...puffs].sort((a, b) => a.y - b.y);
    expect(sorted[0]?.r).toBeGreaterThanOrEqual(sorted[sorted.length - 1]?.r ?? 0);
    expect(sorted[0]?.alpha).toBeLessThan(sorted[sorted.length - 1]?.alpha ?? 0);
    const round = (list: typeof puffs): string => JSON.stringify(list.map((s) => ({ ...s, alpha: s.alpha.toFixed(6) })));
    expect(round(smokePuffs(1.3 + SMOKE_LOOP))).toBe(round(puffs));
  });

  it("draws its flames in their own colors, even at night", () => {
    const night = drawAll(1, () => "#101010");
    expect(night.some((op) => op.color === FIRE.yellow)).toBe(true);
    expect(night.filter((op) => op.alpha < 1).length).toBeGreaterThan(0);
  });
});

describe("the resting camel", () => {
  it("rests, blinks now and then, and chews for a while", () => {
    const poses = Array.from({ length: 400 }, (_, i) => camelPose(i * 0.05));
    expect(poses.filter((p) => p === "rest").length).toBeGreaterThan(250);
    expect(poses).toContain("blink");
    expect(poses).toContain("chew");
    expect(camelPose(0)).toBe("blink");
    expect(camelPose(5)).toBe("rest");
  });

  it("lies by the camp, behind its fire", () => {
    expect(Math.abs(CAMEL_AT.x - PLACES.camp.x)).toBeLessThan(CAMP.columns * CAMP.step * 2);
    expect(CAMEL_AT.y).toBeLessThan(FIRE_AT.y);
  });
});

describe("palms and banners", () => {
  it("sway every palm in two frames over 2.4 s, not all together", () => {
    for (let i = 0; i < PALM_COUNT; i++) {
      const frames = Array.from({ length: 24 }, (_, k) => palmFrame(i, k * 0.1));
      expect(new Set(frames)).toEqual(new Set([0, 1]));
      // Off a frame boundary, where rounding could tip either way.
      expect(palmFrame(i, 0.73 + SWAY_PERIOD)).toBe(palmFrame(i, 0.73));
    }
    const together = new Set(Array.from({ length: PALM_COUNT }, (_, i) => palmFrame(i, 0.5)));
    expect(together.size).toBe(2);
    expect(palmFrame(-1, 0)).toBe(0);
  });

  it("waves each banner in three frames", () => {
    expect(new Set([0, 0.2, 0.4].map((t) => bannerFrame(t, 0)))).toEqual(new Set([0, 1, 2]));
    expect(bannerFrame(0, 0)).not.toBe(bannerFrame(0, 1));
  });
});

describe("arbab's dais", () => {
  it("hangs its canopy above arbab's head", () => {
    const head = PLACES.arbab.y - ARBAB_BOX.h;
    expect(CANOPY_BOTTOM).toBeLessThan(232);
    expect(CANOPY_BOTTOM).toBeLessThan(head);
    // The camel's saddle blanket and the dais's rug share the cloth; the canopy is the one over arbab's head.
    const canopy = drawAll(0).filter(
      (op) => (op.color === CANOPY.red || op.color === CANOPY.cream) && Math.abs(op.x - PLACES.arbab.x) < 30 && op.y > 200 && op.y < head,
    );
    expect(canopy.length).toBeGreaterThan(10);
    for (const op of canopy) {
      expect(op.y).toBeGreaterThanOrEqual(CANOPY_TOP);
      expect(op.y + op.h - 1).toBeLessThanOrEqual(CANOPY_BOTTOM);
      expect(Math.abs(op.x - PLACES.arbab.x)).toBeLessThan(24);
    }
  });
});

describe("the props on the plain", () => {
  it("are drawn inside the canvas and stand on their lines", () => {
    const list = propScenery();
    expect(list.length).toBeGreaterThan(12);
    for (const s of list) {
      expect(s.y).toBeGreaterThan(136);
      expect(s.y).toBeLessThan(HEIGHT);
    }
    const ops = drawAll(2.2);
    for (const op of ops) {
      expect(op.x + op.w).toBeGreaterThan(0);
      expect(op.x).toBeLessThan(WIDTH);
      expect(op.y).toBeGreaterThanOrEqual(0);
    }
    // Every alpha below 1 is put back.
    expect(ops[ops.length - 1]?.alpha).toBe(1);
  });

  it("put the quarry about x 100–140, y 190–206", () => {
    expect(QUARRY_AT.x).toBeGreaterThan(100);
    expect(QUARRY_AT.x).toBeLessThan(140);
    expect(QUARRY_AT.y).toBeGreaterThanOrEqual(200);
    expect(QUARRY_AT.y).toBeLessThanOrEqual(208);
  });

  it("give every prop a shadow and every fire a pool of 18–26 px", () => {
    expect(PROP_SHADOWS.length).toBeGreaterThan(12);
    for (const s of PROP_SHADOWS) expect(s.rx).toBeGreaterThan(0);
    // The camp fire, two braziers and the sledge's torch; the site's two follow the pyramid.
    expect(LIGHTS).toHaveLength(4);
    for (const l of [...LIGHTS, ...siteTorches({ base: 4, blockW: 32 }).map(torchLight)]) {
      expect(l.radius).toBeGreaterThanOrEqual(18);
      expect(l.radius).toBeLessThanOrEqual(26);
    }
  });

  it("stand the site's torches just outside the bottom course, clear of the sledge, at any size", () => {
    for (const lanes of [1, 8, 30, 300]) {
      const l = pyramidLayout(lanes);
      const half = (l.base * l.blockW) / 2;
      const [left, right] = siteTorches(l);
      expect(left?.x).toBeLessThan(PYRAMID_AREA.centerX - half);
      expect(left?.x).toBeGreaterThan(PYRAMID_AREA.centerX - half - 12);
      expect(right?.x).toBeGreaterThan(PYRAMID_AREA.centerX + half);
      expect(right?.x).toBeLessThanOrEqual(PLACES.sledge.x - 26);
      for (const t of [left, right]) expect(t?.y).toBeGreaterThan(PYRAMID_AREA.baseY);
      // Their light reaches the bottom course's corner blocks.
      const light = left ? torchLight(left) : null;
      expect((light?.x ?? 0) + (light?.radius ?? 0)).toBeGreaterThan(PYRAMID_AREA.centerX - half + l.blockW / 2);
    }
    // A pyramid with no size yet: the smallest one's foot.
    expect(siteTorches({ base: 0, blockW: 0 })).toEqual(siteTorches({ base: 4, blockW: 32 }));
    const t = siteTorches({ base: 4, blockW: 32 })[0];
    if (!t) throw new Error("no torch");
    expect(torchShadow(t)).toMatchObject({ cx: t.x, y: t.y });
    expect(torchScenery(t).y).toBe(t.y);
  });

  it("changes with the clock: flames, smoke, palms and banners", () => {
    expect(JSON.stringify(drawAll(0.1))).not.toBe(JSON.stringify(drawAll(0.3)));
    expect(JSON.stringify(drawAll(0.1))).toBe(JSON.stringify(drawAll(0.1)));
  });
});
