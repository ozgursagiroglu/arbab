import { describe, expect, it } from "vitest";
import { HORIZON_Y, WIDTH } from "../../model";
import type { Canvas2D } from "../browser";
import { BIRD, MOON, parseHex, SKY_RAMP, STARS } from "../palette";
import { painter } from "./paint";
import {
  CLOUD_COUNT,
  CLOUD_LOOP,
  cloudShape,
  cloudX,
  drawSky,
  FLOCK,
  flock,
  MOON_AT,
  SHOOTING,
  shootingStar,
  skyRects,
  STAR_COUNT,
  starLevel,
  sunColors,
  sunPosition,
} from "./sky";

interface Op {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  alpha: number;
}

function record(draw: (ctx: Canvas2D) => void): Op[] {
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
  draw(ctx);
  return ops;
}

const warmth = (color: string): number => {
  const [r, , b] = parseHex(color);
  return r - b;
};

describe("the sun", () => {
  it("rides its arc", () => {
    expect(sunPosition(0)).toEqual({ x: 40, y: 112 });
    expect(sunPosition(0.5)).toEqual({ x: 240, y: 26 });
    expect(sunPosition(Number.NaN)).toEqual({ x: 240, y: 26 });
  });

  it("is orange-gold low and pale yellow-white high", () => {
    const low = sunColors(112);
    const high = sunColors(26);
    expect(warmth(low.core)).toBeGreaterThan(warmth(high.core) + 60);
    const [r, g, b] = parseHex(high.core);
    expect(Math.min(r, g, b)).toBeGreaterThan(200);
    // Past either end it stays at the end's colors.
    expect(sunColors(500)).toEqual(low);
    expect(sunColors(-50)).toEqual(high);
  });
});

describe("skyRects", () => {
  for (const phase of ["day", "dusk", "night"] as const) {
    it(`${phase}: covers every pixel down to the horizon with the ramp's colors, dithered at the seams`, () => {
      const rects = skyRects(phase);
      expect(skyRects(phase)).toBe(rects);
      const covered = new Uint8Array(WIDTH * HORIZON_Y);
      for (const r of rects) for (let x = r.x; x < r.x + r.w; x++) covered[r.y * WIDTH + x] = 1;
      expect(covered.every((c) => c === 1)).toBe(true);
      const ramp = new Set(SKY_RAMP[phase]);
      if (phase !== "night") expect(rects.every((r) => ramp.has(r.color))).toBe(true);
      // The zenith is the ramp's first color and the horizon its last.
      expect(rects.find((r) => r.y === 0)?.color).toBe(SKY_RAMP[phase][0]);
      const bottom = rects.filter((r) => r.y === HORIZON_Y - 1);
      expect(bottom[0]?.color).toBe(SKY_RAMP[phase][SKY_RAMP[phase].length - 1]);
      // Dithered seams: some rows carry two colors.
      const twoColors = new Set(rects.filter((r) => r.w === 1).map((r) => r.y));
      expect(twoColors.size).toBeGreaterThan(10);
    });
  }
});

describe("stars", () => {
  it("twinkles a subset by the clock, the rest steady", () => {
    let twinkling = 0;
    let steady = 0;
    for (let i = 0; i < STAR_COUNT; i++) {
      const levels = new Set([0, 0.4, 0.9, 1.3, 2.1, 2.8, 3.6].map((t) => starLevel(i, t)));
      if (levels.size > 1) twinkling++;
      else steady++;
      for (const l of levels) expect(l >= -1 && l <= 3).toBe(true);
    }
    expect(twinkling).toBeGreaterThan(10);
    expect(steady).toBeGreaterThan(twinkling);
    expect(starLevel(-1, 0)).toBe(-1);
  });

  it("streaks a shooting star for 0.6 s every 40 s", () => {
    expect(shootingStar(0.59)).not.toBeNull();
    expect(shootingStar(0.61)).toBeNull();
    expect(shootingStar(20)).toBeNull();
    const a = shootingStar(40.1);
    const b = shootingStar(40.4);
    if (!a || !b) throw new Error("no shooting star");
    // It moves along its direction and down.
    expect(Math.sign(b.x - a.x)).toBe(a.dir);
    expect(b.y).toBeGreaterThan(a.y);
    expect(b.progress).toBeGreaterThan(a.progress);
    expect(shootingStar(SHOOTING.every * 3 + 0.3)?.progress).toBeCloseTo(0.5);
    expect(shootingStar(Number.NaN)?.progress).toBe(0);
  });
});

describe("clouds", () => {
  it("are lobed on a flat base, lit on top and shaded beneath", () => {
    for (const w of [24, 40, 56]) {
      const { w: width, h, tones } = cloudShape(w, 3);
      expect(width).toBe(w);
      expect(h).toBeGreaterThanOrEqual(6);
      expect(h).toBeLessThan(w / 2);
      const at = (x: number, y: number): number => tones[y * w + x] ?? -1;
      // The base row is solid apart from its rounded ends, and shaded.
      const base = Array.from({ length: w }, (_, x) => at(x, h - 1));
      expect(base.filter((t) => t >= 0).length).toBeGreaterThan(w - 6);
      expect(base.filter((t) => t >= 0).every((t) => t === 2)).toBe(true);
      // Every column's top pixel is lit.
      for (let x = 0; x < w; x++) {
        const top = Array.from({ length: h }, (_, y) => at(x, y)).find((t) => t >= 0);
        if (top !== undefined) expect(top).toBe(0);
      }
      // Lobes: the top edge is not flat.
      const tops = new Set(Array.from({ length: w }, (_, x) => Array.from({ length: h }, (_, y) => at(x, y)).findIndex((t) => t >= 0)));
      expect(tops.size).toBeGreaterThan(3);
    }
  });

  it("drift right at 2, 4 and 6 px/s and come round again", () => {
    const speeds = new Set<number>();
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const speed = cloudX(i, 1) - cloudX(i, 0);
      // A wrap in the first second would show as a jump back; none of these clouds is at the loop's end.
      speeds.add(speed);
      expect(cloudX(i, 10 + CLOUD_LOOP / speed)).toBe(cloudX(i, 10));
    }
    expect([...speeds].sort()).toEqual([2, 4, 6]);
    expect(cloudX(-1, 0)).toBe(0);
  });

  it("are drawn white by day, rose at dusk and faint at night", () => {
    const colorsOf = (phase: "day" | "dusk" | "night"): Op[] =>
      record((ctx) => drawSky(painter(ctx), { phase, sun: 0.5 }, 5)).filter((op) => op.y >= 0 && op.w > 0);
    const day = colorsOf("day");
    expect(day.some((op) => op.color === "#FFFDF6")).toBe(true);
    expect(colorsOf("dusk").some((op) => op.color === "#E8968A")).toBe(true);
    const night = colorsOf("night");
    expect(night.filter((op) => op.color === "#46507A").every((op) => op.alpha < 1)).toBe(true);
  });
});

describe("birds", () => {
  it("cross every 45 s at 30 px/s, 3 to 5 of them, between y 40 and 80", () => {
    for (const k of [0, 1, 2, 7]) {
      const t = k * FLOCK.every + 4;
      const birds = flock(t);
      expect(birds.length).toBeGreaterThanOrEqual(3);
      expect(birds.length).toBeLessThanOrEqual(5);
      for (const b of birds) {
        expect(b.y).toBeGreaterThanOrEqual(40);
        expect(b.y).toBeLessThanOrEqual(80);
      }
      const later = flock(t + 1);
      expect(Math.abs((later[0]?.x ?? 0) - (birds[0]?.x ?? 0))).toBe(FLOCK.speed);
      // Gone well before the next crossing.
      expect(flock(k * FLOCK.every + 30)).toEqual([]);
    }
  });

  it("flap in two frames at 6 fps", () => {
    const frames = [0, 1 / 6, 2 / 6, 3 / 6].map((dt) => flock(5 + dt)[0]?.frame);
    expect(frames).toEqual([frames[0], 1 - (frames[0] ?? 0), frames[0], 1 - (frames[0] ?? 0)]);
  });

  it("are drawn by day and dusk, not at night", () => {
    const birdOps = (phase: "day" | "dusk" | "night"): number =>
      record((ctx) => drawSky(painter(ctx), { phase, sun: 0.2 }, 5)).filter((op) => op.color === BIRD.day || op.color === BIRD.dusk).length;
    expect(birdOps("day")).toBeGreaterThan(8);
    expect(birdOps("dusk")).toBeGreaterThan(8);
    expect(birdOps("night")).toBe(0);
  });
});

describe("drawSky", () => {
  it("draws the moon and stars at night, and the sun by day, with alpha back to 1", () => {
    const night = record((ctx) => drawSky(painter(ctx), { phase: "night", sun: 0.5 }, 0.3));
    expect(night.some((op) => op.color === MOON && op.x <= MOON_AT.x && MOON_AT.x < op.x + op.w)).toBe(true);
    expect(night.some((op) => op.color === STARS.bright)).toBe(true);
    // The streak of the shooting star.
    expect(night.some((op) => op.color === "#FFFFFF")).toBe(true);
    const day = record((ctx) => drawSky(painter(ctx), { phase: "day", sun: 0.5 }, 0.3));
    expect(day.some((op) => op.color === MOON)).toBe(false);
    expect(day.some((op) => op.color === sunColors(26).core)).toBe(true);
    expect(day[day.length - 1]?.alpha).toBe(1);
  });
});
