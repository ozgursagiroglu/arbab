import { describe, expect, it } from "vitest";
import type { Capstone } from "../../model";
import { HEIGHT, PYRAMID_AREA, WIDTH } from "../../model";
import type { Canvas2D } from "../browser";
import { measureText } from "../font";
import { GOLD, NIGHT_SHADOW, PLATE, SHADOW, VIGNETTE } from "../palette";
import {
  drawGlowBeam,
  drawLightPools,
  drawNameplate,
  drawPlaque,
  drawPyramidShadow,
  drawShadows,
  drawVignette,
  fitText,
  plaqueBox,
  plateBox,
  poolFlicker,
  shadowShift,
  shakeOffset,
} from "./fx";
import type { Painter } from "./paint";
import { painter } from "./paint";

interface Op {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  alpha: number;
}

function record(draw: (p: Painter) => void): Op[] {
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
  draw(painter(ctx));
  return ops;
}

const inside = (op: Op): boolean => op.x >= 0 && op.y >= 0 && op.x + op.w <= WIDTH && op.y + op.h <= HEIGHT;

describe("shakeOffset", () => {
  it("is (round(s·sin 53t), round(s·cos 47t)) while shaking", () => {
    const want = (s: number, t: number): { dx: number; dy: number } => ({
      dx: Math.round(s * Math.sin(53 * t)) || 0,
      dy: Math.round(s * Math.cos(47 * t)) || 0,
    });
    for (const [s, t] of [
      [3, 0.5],
      [2.4, 1.1],
      [1, 0.03],
      [5, 7.77],
    ] as const) {
      expect(shakeOffset(s, t)).toEqual(want(s, t));
    }
    expect(shakeOffset(5, 7.77)).not.toEqual({ dx: 0, dy: 0 });
  });

  it("is still when there is no shake, or nonsense", () => {
    for (const s of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) expect(shakeOffset(s, 1)).toEqual({ dx: 0, dy: 0 });
    // A −0 comes out as 0.
    expect(Object.is(shakeOffset(1, 0).dx, 0)).toBe(true);
  });

  it("never moves further than the shake", () => {
    for (let t = 0; t < 3; t += 0.01) {
      const { dx, dy } = shakeOffset(2, t);
      expect(Math.abs(dx)).toBeLessThanOrEqual(2);
      expect(Math.abs(dy)).toBeLessThanOrEqual(2);
    }
  });
});

describe("shadows", () => {
  it("fall away from the sun's x, longer when it is low, and straight down at night", () => {
    // On the horizon at either end, then halfway up, then high.
    expect(shadowShift({ phase: "day", sun: 0 }, 300)).toBe(3);
    expect(shadowShift({ phase: "day", sun: 1 }, 100)).toBe(-3);
    expect(shadowShift({ phase: "day", sun: 0.1 }, 300)).toBe(2);
    expect(Math.abs(shadowShift({ phase: "day", sun: 0.45 }, 400))).toBe(1);
    expect(shadowShift({ phase: "dusk", sun: 1 }, 100)).toBe(-3);
    expect(shadowShift({ phase: "night", sun: 0.1 }, 300)).toBe(0);
    expect(shadowShift({ phase: "day", sun: 0.5 }, 240)).toBe(0);
  });

  it("are dark dithered ellipses at about 0.25, fainter at night, with alpha put back", () => {
    // Right under the sun: no lean.
    const spot = { cx: 240, y: 200, rx: 5, ry: 1 };
    const day = record((p) => drawShadows(p, { phase: "day", sun: 0.5 }, [spot]));
    expect(day.length).toBeGreaterThan(3);
    expect(day.every((op) => op.color === SHADOW && op.alpha === 0.25)).toBe(true);
    const night = record((p) => drawShadows(p, { phase: "night", sun: 0.5 }, [spot]));
    expect(night.every((op) => op.color === NIGHT_SHADOW && op.alpha < 0.25)).toBe(true);
    const half = record((p) => drawShadows(p, { phase: "day", sun: 0.5 }, [spot], 0.5));
    expect(half[0]?.alpha).toBe(0.125);
    expect(record((p) => drawShadows(p, { phase: "day", sun: 0.5 }, [spot], 0))).toEqual([]);
    expect(record((p) => drawShadows(p, { phase: "day", sun: 0.5 }, []))).toEqual([]);
    // Rows y − 1 to y + 1, widest on y, the pixel line x = 239.5 its axis.
    expect(new Set(day.map((op) => op.y))).toEqual(new Set([199, 200, 201]));
    const widest = day.filter((op) => op.y === 200).reduce((a, b) => (b.w > a.w ? b : a));
    expect(widest.x + widest.w / 2).toBe(240);
    const leaning = record((p) => drawShadows(p, { phase: "day", sun: 0 }, [spot]));
    expect(leaning.find((op) => op.w === widest.w && op.y === 200)?.x).toBe(widest.x + 3);
  });

  it("lays the pyramid's shadow beside its foot, away from the sun, but not at night", () => {
    const size = { base: 4, blockW: 32, blockH: 16 };
    const morning = record((p) => drawPyramidShadow(p, { phase: "day", sun: 0.1 }, PYRAMID_AREA, size));
    expect(morning.length).toBeGreaterThan(10);
    const right = PYRAMID_AREA.centerX + 64;
    for (const op of morning) {
      expect(op.y).toBeLessThan(PYRAMID_AREA.baseY);
      expect(op.x).toBeGreaterThanOrEqual(PYRAMID_AREA.centerX);
    }
    // The bottom row starts at the base's right corner.
    expect(morning.find((op) => op.y === PYRAMID_AREA.baseY - 1)?.x).toBe(right);
    const evening = record((p) => drawPyramidShadow(p, { phase: "day", sun: 0.9 }, PYRAMID_AREA, size));
    for (const op of evening) expect(op.x + op.w).toBeLessThanOrEqual(PYRAMID_AREA.centerX);
    const bottom = evening.filter((op) => op.y === PYRAMID_AREA.baseY - 1 && op.w > 1);
    expect(bottom[0] && bottom[0].x + bottom[0].w).toBe(PYRAMID_AREA.centerX - 64);
    expect(record((p) => drawPyramidShadow(p, { phase: "night", sun: 0.1 }, PYRAMID_AREA, size))).toEqual([]);
    expect(record((p) => drawPyramidShadow(p, { phase: "day", sun: 0.1 }, PYRAMID_AREA, { ...size, base: 0 }))).toEqual([]);
  });
});

describe("firelight", () => {
  const fire = { x: 100, y: 100, radius: 22, seed: 1 };

  it("flickers its pool's radius and strength with the clock", () => {
    const seen = new Set<number>();
    for (let t = 0; t < 2; t += 0.05) {
      const { radius, alpha } = poolFlicker(fire, t);
      seen.add(radius);
      expect(radius).toBeGreaterThanOrEqual(20);
      expect(radius).toBeLessThanOrEqual(24);
      expect(alpha).toBeGreaterThan(0.05);
      expect(alpha).toBeLessThan(0.2);
    }
    expect(seen.size).toBeGreaterThan(1);
    expect(poolFlicker(fire, 0.7)).toEqual(poolFlicker(fire, 0.7));
  });

  it("lights a dithered disc around the fire, alpha put back after each", () => {
    const ops = record((p) => drawLightPools(p, [fire, { ...fire, x: 300 }], 0.4));
    const { radius } = poolFlicker(fire, 0.4);
    for (const op of ops.filter((o) => o.x < 200)) {
      expect(Math.abs(op.x - fire.x)).toBeLessThanOrEqual(radius + 1);
      expect(Math.abs(op.y - fire.y)).toBeLessThanOrEqual(radius + 1);
    }
    expect(ops.some((op) => op.w === 1)).toBe(true);
    expect(ops.every((op) => op.alpha < 0.2)).toBe(true);
  });
});

describe("the vignette", () => {
  it("darkens only the outer 12 px, stronger at night", () => {
    const strength = (phase: "day" | "dusk" | "night"): number => {
      const ops = record((p) => drawVignette(p, phase));
      for (const op of ops) {
        expect(op.color).toBe(VIGNETTE[phase]);
        const inner = op.x >= 13 && op.y >= 13 && op.x + op.w <= WIDTH - 13 && op.y + op.h <= HEIGHT - 13;
        expect(inner, JSON.stringify(op)).toBe(false);
      }
      return ops[0]?.alpha ?? 0;
    };
    expect(strength("night")).toBeGreaterThan(strength("day"));
    expect(strength("dusk")).toBeGreaterThan(strength("day"));
  });

  it("ignores the camera shake", () => {
    const still = record((p) => drawVignette(p, "day"));
    const shaken = record((p) => {
      p.offset(0, 0);
      drawVignette(p, "day");
    });
    expect(shaken).toEqual(still);
  });
});

describe("the capstone's beam", () => {
  const cap = (fields: Partial<Capstone>): Capstone => ({ state: "set", integration: "i", x: 268, y: 100, flag: "none", ready: true, glow: 0.8, ...fields });

  it("falls from the top of the canvas onto the apex while the capstone glows", () => {
    const ops = record((p) => drawGlowBeam(p, cap({}), { x: 268, y: 100 }));
    expect(ops.some((op) => op.y === 0 && op.h >= 90)).toBe(true);
    expect(ops.every((op) => Math.abs(op.alpha - 0.4) < 1e-9)).toBe(true);
    // Eight pixels of solid light and a dithered pixel each side: about ten wide.
    const xs = ops.filter((op) => op.h > 1).flatMap((op) => [op.x, op.x + op.w]);
    expect(Math.max(...xs) - Math.min(...xs)).toBe(8);
    const edges = new Set(ops.filter((op) => op.h === 1 && op.w === 1 && op.y < 80).map((op) => op.x));
    expect([...edges].sort()).toEqual([268 - 5, 268 + 4]);
    // Rays reach out to the sides.
    expect(ops.some((op) => op.x < 268 - 10)).toBe(true);
    expect(ops.some((op) => op.x > 268 + 10)).toBe(true);
  });

  it("is not there without a glow or a capstone", () => {
    expect(record((p) => drawGlowBeam(p, cap({ glow: 0 }), { x: 268, y: 100 }))).toEqual([]);
    expect(record((p) => drawGlowBeam(p, cap({ glow: Number.NaN }), { x: 268, y: 100 }))).toEqual([]);
    expect(record((p) => drawGlowBeam(p, cap({ state: "none" }), { x: 268, y: 100 }))).toEqual([]);
  });

  it("follows a capstone on its way up", () => {
    const ops = record((p) => drawGlowBeam(p, cap({ state: "hoisting", x: 300, y: 160, glow: 0.2 }), { x: 268, y: 100 }));
    expect(ops.some((op) => op.x <= 300 && 300 < op.x + op.w && op.h > 140)).toBe(true);
    expect(ops[0]?.alpha).toBeCloseTo(0.1);
  });
});

describe("the nameplate", () => {
  it("fits a long name with an ellipsis", () => {
    expect(fitText("short", 100)).toBe("short");
    const long = fitText("a-very-long-lane-name-that-goes-on-and-on-and-on-and-on-and-on-and-on-and-on", 120);
    expect(long.endsWith("…")).toBe(true);
    expect(measureText(long)).toBeLessThanOrEqual(120);
    expect(fitText("", 10)).toBe("");
  });

  it("keeps its box on the canvas, shaken or not", () => {
    for (const [cx, bottom] of [
      [0, 5],
      [WIDTH, 5],
      [0, HEIGHT + 20],
      [WIDTH, HEIGHT + 20],
      [240, 100],
    ] as const) {
      for (const offset of [
        { dx: 0, dy: 0 },
        { dx: 3, dy: -3 },
        { dx: -3, dy: 3 },
      ]) {
        const box = plateBox("lane-name", cx, bottom, offset);
        expect(box.x + offset.dx).toBeGreaterThanOrEqual(0);
        expect(box.y + offset.dy).toBeGreaterThanOrEqual(0);
        expect(box.x + offset.dx + box.w).toBeLessThanOrEqual(WIDTH);
        expect(box.y + offset.dy + box.h).toBeLessThanOrEqual(HEIGHT);
      }
    }
    const centered = plateBox("lane", 240, 100, { dx: 0, dy: 0 });
    expect(centered.y + centered.h).toBe(100);
    expect(Math.abs(centered.x + centered.w / 2 - 240)).toBeLessThanOrEqual(1);
  });

  it("draws white-gold letters on a dark plate with a gold rim", () => {
    const ops = record((p) => drawNameplate(p, "lane-x", 240, 100, { dx: 0, dy: 0 }));
    const colors = new Set(ops.map((op) => op.color));
    for (const c of [PLATE.fill, PLATE.rim, PLATE.text]) expect(colors.has(c)).toBe(true);
    expect(PLATE.rim).toBe(GOLD.mid);
    expect(ops.every(inside)).toBe(true);
  });
});

describe("the monument's plaque", () => {
  it("is centered on its foot, in capitals, wide enough for the name", () => {
    const box = plaqueBox("int-walls", 268, 226);
    expect(box.text).toBe("INT-WALLS");
    expect(box.w).toBe(measureText("INT-WALLS") + 12);
    expect(Math.abs(box.x + box.w / 2 - 268)).toBeLessThanOrEqual(1);
    expect(box.y + box.h).toBe(226 - 3);
    expect(plaqueBox("x".repeat(200), 268, 226).w).toBeLessThanOrEqual(212);
  });

  it("draws a slab on its plinth with gilded letters", () => {
    const ops = record((p) => drawPlaque(p, "int-walls", 268, 226));
    expect(ops.filter((op) => op.color === GOLD.light).length).toBeGreaterThan(10);
    expect(ops.filter((op) => op.color === GOLD.shadow).length).toBeGreaterThan(10);
    const box = plaqueBox("int-walls", 268, 226);
    for (const op of ops) {
      expect(op.x).toBeGreaterThanOrEqual(box.x - 2);
      expect(op.x + op.w).toBeLessThanOrEqual(box.x + box.w + 2);
      expect(op.y).toBeGreaterThanOrEqual(box.y);
      expect(op.y + op.h).toBeLessThanOrEqual(226);
    }
  });
});
