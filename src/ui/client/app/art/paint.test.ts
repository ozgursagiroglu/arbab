import { describe, expect, it } from "vitest";
import { HEIGHT, WIDTH } from "../../model";
import type { Canvas2D } from "../browser";
import { measureText } from "../font";
import { createRaster } from "../raster";
import type { Rect } from "./paint";
import { bayer, clock, disc, dithered, ditherRing, lightOf, painter, Pixmap, prng, softEllipse, wrap } from "./paint";

interface Op {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

function recorder(): Canvas2D & { ops: Op[]; styles: string[] } {
  const ops: Op[] = [];
  const styles: string[] = [];
  let style = "#000000";
  return {
    ops,
    styles,
    get fillStyle() {
      return style;
    },
    set fillStyle(value: string) {
      styles.push(value);
      style = value;
    },
    globalAlpha: 1,
    imageSmoothingEnabled: false,
    fillRect(x, y, w, h) {
      ops.push({ x, y, w, h, color: style });
    },
    clearRect() {},
  };
}

describe("painter", () => {
  it("rounds, clips to the canvas and skips empty rects", () => {
    const ctx = recorder();
    const p = painter(ctx);
    p.rect(-3.4, 2.6, 10, 2, "#112233");
    p.rect(WIDTH - 2, HEIGHT - 1, 9, 9, "#112233");
    p.rect(10, 10, 0, 5, "#112233");
    p.rect(WIDTH + 1, 0, 4, 4, "#112233");
    expect(ctx.ops).toEqual([
      { x: 0, y: 3, w: 7, h: 2, color: "#112233" },
      { x: WIDTH - 2, y: HEIGHT - 1, w: 2, h: 1, color: "#112233" },
    ]);
    // fillStyle is set once for a run of one color.
    expect(ctx.styles).toEqual(["#112233"]);
  });

  it("shifts by the offset before clipping, and ignores a non-finite offset", () => {
    const ctx = recorder();
    const p = painter(ctx);
    p.offset(2.4, -1.6);
    p.rect(0, 0, 4, 4, "#112233");
    p.offset(Number.NaN, 3);
    p.rect(5, 5, 1, 1, "#112233");
    expect(ctx.ops).toEqual([
      { x: 2, y: 0, w: 4, h: 2, color: "#112233" },
      { x: 5, y: 8, w: 1, h: 1, color: "#112233" },
    ]);
  });

  it("recolors through the tint until it is cleared, text included", () => {
    const ctx = recorder();
    const p = painter(ctx);
    p.tint(() => "#ABCDEF");
    p.rect(0, 0, 1, 1, "#112233");
    p.text("I", 10, 10, "#112233");
    p.tint(null);
    p.rect(1, 0, 1, 1, "#112233");
    expect(ctx.ops[0]?.color).toBe("#ABCDEF");
    expect(ctx.ops.slice(1, -1).every((op) => op.color === "#ABCDEF")).toBe(true);
    expect(ctx.ops[ctx.ops.length - 1]?.color).toBe("#112233");
  });

  it("draws text at the offset, returns its width, and keeps fillStyle in step after it", () => {
    const ctx = recorder();
    const p = painter(ctx);
    p.offset(3, 4);
    expect(p.text("Hi", 10, 20, "#FFFFFF")).toBe(measureText("Hi"));
    expect(Math.min(...ctx.ops.map((op) => op.x))).toBe(13);
    expect(Math.min(...ctx.ops.map((op) => op.y))).toBe(24);
    // The next rect in the text's color does not set fillStyle again; another color does.
    const before = ctx.styles.length;
    p.rect(0, 0, 1, 1, "#FFFFFF");
    expect(ctx.styles.length).toBe(before);
    p.rect(0, 0, 1, 1, "#000001");
    expect(ctx.styles.length).toBe(before + 1);
  });

  it("clamps alpha to 0–1 and reads a non-finite alpha as 1", () => {
    const ctx = recorder();
    const p = painter(ctx);
    p.alpha(2);
    expect(ctx.globalAlpha).toBe(1);
    p.alpha(-1);
    expect(ctx.globalAlpha).toBe(0);
    p.alpha(Number.NaN);
    expect(ctx.globalAlpha).toBe(1);
  });

  it("draws a sprite's runs, mirrored on request", () => {
    const ctx = recorder();
    const p = painter(ctx);
    const sprite = { w: 4, h: 1, top: 0, runs: [{ x: 0, y: 0, w: 1, color: "#112233" }], mirrored: [{ x: 3, y: 0, w: 1, color: "#112233" }] };
    p.sprite(sprite, 10, 10);
    p.sprite(sprite, 10, 10, true);
    expect(ctx.ops.map((op) => op.x)).toEqual([10, 13]);
  });
});

describe("lightOf", () => {
  it("leaves the day alone, and warms dusk and darkens night", () => {
    expect(lightOf("day")).toBeNull();
    const dusk = lightOf("dusk");
    const night = lightOf("night");
    if (!dusk || !night) throw new Error("no light");
    const sum = (c: string): number => [1, 3, 5].reduce((s, i) => s + Number.parseInt(c.slice(i, i + 2), 16), 0);
    expect(sum(night("#E9C886"))).toBeLessThan(sum(dusk("#E9C886")));
    expect(sum(dusk("#E9C886"))).toBeLessThan(sum("#E9C886"));
    // Memoized: the same function, the same answer.
    expect(lightOf("dusk")).toBe(dusk);
    expect(dusk("#E9C886")).toBe(dusk("#E9C886"));
  });
});

describe("helpers", () => {
  it("repeats a PRNG sequence from its seed", () => {
    const a = prng(5);
    const b = prng(5);
    expect([a(), a()]).toEqual([b(), b()]);
  });

  it("orders the Bayer thresholds 0–15 over a 4 × 4 tile", () => {
    const seen = new Set<number>();
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) seen.add(bayer(x, y));
    expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(bayer(4, 4)).toBe(bayer(0, 0));
    let lit = 0;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (dithered(x, y, 0.25)) lit++;
    expect(lit).toBe(4);
    expect(dithered(0, 0, 0)).toBe(false);
    expect(dithered(3, 1, 1)).toBe(true);
  });

  it("keeps the clock finite and non-negative", () => {
    expect(clock(3.5)).toBe(3.5);
    expect(clock(-2)).toBe(0);
    expect(clock(Number.NaN)).toBe(0);
    expect(clock(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("wraps around a loop, below zero too", () => {
    expect(wrap(7, 5)).toBe(2);
    expect(wrap(-1, 5)).toBe(4);
    expect(wrap(0, 5)).toBe(0);
  });

  it("draws a disc as one rect per row, widest in the middle", () => {
    const out: Rect[] = [];
    disc(out, 10, 10, 3, "#112233");
    expect(out).toHaveLength(7);
    expect(Math.max(...out.map((r) => r.w))).toBe(7);
    expect(out[3]).toEqual({ x: 7, y: 10, w: 7, h: 1, color: "#112233" });
  });

  it("dithers a ring between its radii and nothing inside", () => {
    const out: Rect[] = [];
    ditherRing(out, 0, 0, 5, 8, 0.5, "#112233");
    expect(out.length).toBeGreaterThan(10);
    for (const r of out) {
      const d = Math.hypot(r.x, r.y);
      expect(d).toBeGreaterThanOrEqual(4.5);
      expect(d).toBeLessThanOrEqual(8.5);
    }
  });

  it("builds a soft ellipse that mirrors about the pixel line x = −½", () => {
    const rows = softEllipse(5, 1);
    const cells = new Set<string>();
    for (const r of rows) for (let x = r.dx; x < r.dx + r.w; x++) cells.add(`${x},${r.dy}`);
    for (const cell of cells) {
      const [x, y] = cell.split(",").map(Number);
      expect(cells.has(`${-1 - (x ?? 0)},${y}`), cell).toBe(true);
    }
    expect(Math.max(...rows.map((r) => r.w))).toBe(10);
    expect(softEllipse(0, 2)).toEqual([]);
  });
});

describe("Pixmap", () => {
  it("stores colors per pixel and ignores pixels outside it", () => {
    const map = new Pixmap(4, 3);
    map.set(1, 1, "#112233");
    map.set(-1, 0, "#112233");
    map.set(4, 0, "#112233");
    expect(map.get(1, 1)).toBe("#112233");
    expect(map.get(0, 0)).toBeNull();
    expect(map.get(9, 9)).toBeNull();
  });

  it("turns into runs that redraw it exactly, laying a dithered row's main color under it once", () => {
    const map = new Pixmap(16, 3);
    for (let x = 0; x < 16; x++) map.set(x, 0, x % 2 === 0 ? "#111111" : "#222222");
    map.fill(2, 1, 5, 1, "#333333");
    map.fill(9, 1, 3, 1, "#444444");
    map.set(0, 2, "#555555");
    const runs = map.runs();
    // Row 0: one underlay and the 8 pixels of the other color, not 16 runs.
    expect(runs.filter((r) => r.y === 0)).toHaveLength(9);
    const raster = createRaster(16, 3);
    for (const r of runs) {
      raster.fillStyle = r.color;
      raster.fillRect(r.x, r.y, r.w, r.h);
    }
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 16; x++) {
        const i = (y * 16 + x) * 4;
        const want = map.get(x, y);
        if (want === null) expect(raster.data[i + 3], `${x},${y}`).toBe(0);
        else expect(Array.from(raster.data.subarray(i, i + 3)).map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()).toBe(want.slice(1));
      }
    }
  });

  it("recolors and places its runs", () => {
    const map = new Pixmap(2, 1);
    map.fill(0, 0, 2, 1, "#111111");
    expect(map.runs(() => "#999999", 5, 6)).toEqual([{ x: 5, y: 6, w: 2, h: 1, color: "#999999" }]);
  });
});
