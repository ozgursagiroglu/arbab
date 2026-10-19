import { describe, expect, it } from "vitest";
import { HEIGHT, HORIZON_Y, WIDTH } from "../../model";
import type { Canvas2D } from "../browser";
import { FAR_STONE, GLINT, parseHex, SAIL } from "../palette";
import { createRaster } from "../raster";
import {
  CARAVAN,
  caravanAt,
  drawFarLand,
  drawRiverAndPlain,
  feluccaAt,
  GLINT_LOOP,
  glints,
  landLayers,
  RIVER_BOTTOM,
  RIVER_TOP,
  SAILING,
  shimmerShift,
} from "./land";
import { painter } from "./paint";

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

function coverage(rects: readonly { x: number; y: number; w: number; h: number }[]): Uint8Array {
  const out = new Uint8Array(WIDTH * HEIGHT);
  for (const r of rects) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT) out[y * WIDTH + x] = 1;
  return out;
}

describe("landLayers", () => {
  it("builds each phase once, in the bands of the brief", () => {
    const day = landLayers("day");
    expect(landLayers("day")).toBe(day);
    const rows = (rects: readonly { y: number }[]): [number, number] => [Math.min(...rects.map((r) => r.y)), Math.max(...rects.map((r) => r.y))];
    // The cliffs and far dunes: 96–128.
    const [farTop, farBottom] = rows(day.far);
    expect(farTop).toBeGreaterThanOrEqual(90);
    expect(farBottom).toBe(HORIZON_Y - 1);
    // The river: 128–136, every pixel of it.
    const water = coverage(day.water);
    for (let y = RIVER_TOP; y < RIVER_BOTTOM; y++) for (let x = 0; x < WIDTH; x++) expect(water[y * WIDTH + x]).toBe(1);
    expect(rows(day.water)).toEqual([RIVER_TOP, RIVER_BOTTOM - 1]);
    // The plain covers the rest of the canvas; reeds rise over the water's edge.
    const plain = coverage(day.plain);
    for (let y = RIVER_BOTTOM; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x += 7) expect(plain[y * WIDTH + x]).toBe(1);
    expect(rows(day.plain)[0]).toBeLessThan(RIVER_BOTTOM);
  });

  it("puts the temple pylon and the obelisks on the right of the far bank, clear of the far pyramids", () => {
    // Composited, since a row's runs may lay one color under the rest.
    const raster = createRaster(WIDTH, HEIGHT);
    for (const r of landLayers("day").bank) {
      raster.fillStyle = r.color;
      raster.fillRect(r.x, r.y, r.w, r.h);
    }
    const stone = new Set([FAR_STONE.light, FAR_STONE.face].map((c) => parseHex(c).join(",")));
    let n = 0;
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const i = (y * WIDTH + x) * 4;
        if (!stone.has(Array.from(raster.data.subarray(i, i + 3)).join(","))) continue;
        n++;
        expect(x, `${x},${y}`).toBeGreaterThanOrEqual(395);
        expect(x).toBeLessThan(470);
        expect(y).toBeLessThan(HORIZON_Y);
      }
    }
    expect(n).toBeGreaterThan(100);
  });

  it("lights each phase differently", () => {
    const first = (phase: "day" | "dusk" | "night"): string => landLayers(phase).plain[0]?.color ?? "";
    expect(new Set([first("day"), first("dusk"), first("night")]).size).toBe(3);
  });
});

describe("the river's life", () => {
  it("drifts glints downstream and blinks them", () => {
    const a = glints(1);
    expect(a.length).toBeGreaterThan(5);
    for (const g of [...a, ...glints(30)]) {
      expect(g.y).toBeGreaterThan(RIVER_TOP);
      expect(g.y).toBeLessThan(RIVER_BOTTOM);
      expect(g.x).toBeGreaterThanOrEqual(-4);
      expect(g.x).toBeLessThan(GLINT_LOOP);
    }
    expect(glints(1)).toEqual(a);
    expect(glints(1.5)).not.toEqual(a);
  });

  it("sails the felucca left to right for 80 s of every 120 s, gently bobbing", () => {
    expect(feluccaAt(SAILING.crossing + 1)).toBeNull();
    expect(feluccaAt(SAILING.every - 0.1)).toBeNull();
    const start = feluccaAt(0);
    const mid = feluccaAt(40);
    const end = feluccaAt(79.9);
    if (!start || !mid || !end) throw new Error("no felucca");
    expect(start.x).toBeLessThan(0);
    expect(end.x).toBeGreaterThan(WIDTH - 4);
    expect(mid.x).toBeGreaterThan(WIDTH / 2 - 40);
    expect(mid.x).toBeLessThan(WIDTH / 2 + 20);
    // The next crossing is the same.
    expect(feluccaAt(40 + SAILING.every)).toEqual(mid);
    const bobs = new Set(Array.from({ length: 40 }, (_, i) => feluccaAt(i * 0.37)?.y));
    expect([...bobs].sort()).toEqual([RIVER_BOTTOM - 2, RIVER_BOTTOM - 1]);
  });

  it("draws the felucca's white sail on the river", () => {
    const ops = record((ctx) => drawRiverAndPlain(painter(ctx), "day", 40));
    const sail = ops.filter((op) => op.color === SAIL.light);
    expect(sail.length).toBeGreaterThan(5);
    for (const op of sail) expect(op.y).toBeLessThan(RIVER_BOTTOM);
    expect(ops.some((op) => op.color === GLINT.day)).toBe(true);
    expect(record((ctx) => drawRiverAndPlain(painter(ctx), "day", 100)).some((op) => op.color === SAIL.light)).toBe(false);
  });
});

describe("the caravan", () => {
  it("crosses the far dunes right to left for 70 s of every 180 s", () => {
    expect(caravanAt(CARAVAN.crossing + 0.5)).toEqual([]);
    const start = caravanAt(0);
    const later = caravanAt(35);
    expect(start.map((m) => m.kind)).toEqual(["walker", "camel", "camel", "camel"]);
    expect(start[0]?.x).toBeGreaterThan(WIDTH - 10);
    expect((later[0]?.x ?? 0) < (start[0]?.x ?? 0)).toBe(true);
    expect((caravanAt(69.9)[3]?.x ?? 0) + 12).toBeLessThan(10);
    expect(caravanAt(35 + CARAVAN.every)).toEqual(later);
  });

  it("walks in two frames", () => {
    const frames = new Set([0, 0.25, 0.5, 0.75].map((t) => caravanAt(t)[0]?.frame));
    expect([...frames].sort()).toEqual([0, 1]);
  });

  it("is drawn on the far dunes, above the horizon", () => {
    const ops = record((ctx) => drawFarLand(painter(ctx), "day", 35));
    const away = record((ctx) => drawFarLand(painter(ctx), "day", 100));
    expect(ops.length).toBeGreaterThan(away.length);
    const extra = ops.filter((op) => op.y >= CARAVAN.feet - 12 && op.y < CARAVAN.feet && !away.some((a) => a.x === op.x && a.y === op.y && a.color === op.color));
    expect(extra.length).toBeGreaterThan(10);
  });
});

describe("the heat shimmer", () => {
  it("crawls with the clock by day only", () => {
    expect(shimmerShift(0)).toBe(0);
    expect(shimmerShift(0.2)).toBe(1);
    expect(shimmerShift(1.6)).toBe(0);
    const day = record((ctx) => drawRiverAndPlain(painter(ctx), "day", 3)).filter((op) => op.alpha < 1);
    const night = record((ctx) => drawRiverAndPlain(painter(ctx), "night", 3)).filter((op) => op.alpha < 1);
    expect(day.length).toBeGreaterThan(20);
    expect(night).toEqual([]);
    for (const op of day) expect(op.y).toBeLessThan(RIVER_BOTTOM + 10);
  });
});
