// The docs/ui frames: the README's pictures and the renderer's goldens. A missing frame is written; an existing one is
// compared by decoded pixels, so another zlib cannot fail it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { World } from "../model";
import { HEIGHT, WIDTH } from "../model";
import { caravanAt, feluccaAt } from "./art/land";
import { FIRE_AT } from "./art/props";
import { flock, shootingStar } from "./art/sky";
import { FRAMES } from "./fixtures";
import { GOLD, parseHex, SKY_RAMP } from "./palette";
import type { Raster } from "./raster";
import { createRaster, decodePng, encodePng } from "./raster";
import { renderWorld } from "./render";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const SCALE = 2;

function rasterize(world: World): Raster {
  const raster = createRaster(WIDTH, HEIGHT);
  renderWorld(raster, world);
  return raster;
}

function pixel(raster: Raster, x: number, y: number): [number, number, number, number] {
  const i = (y * raster.width + x) * 4;
  return [raster.data[i] ?? 0, raster.data[i + 1] ?? 0, raster.data[i + 2] ?? 0, raster.data[i + 3] ?? 0];
}

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

describe("docs/ui frames", () => {
  for (const [name, make] of Object.entries(FRAMES)) {
    it(`${name}.png matches the renderer`, () => {
      const raster = rasterize(make());
      // Every pixel is drawn: the sky and the ground cover the canvas.
      for (let i = 3; i < raster.data.length; i += 4) expect(raster.data[i]).toBe(255);
      golden(name, raster);
    });
  }

  // Inside the vignette, at the zenith, clear of the sun and the clouds of these frames.
  it("day: the zenith's blue at the top, inside the vignette", () => {
    expect(pixel(rasterize(FRAMES.day()), 150, 13).slice(0, 3)).toEqual(parseHex(SKY_RAMP.day[0] ?? ""));
  });

  it("dusk: the dusk's indigo at the top, inside the vignette", () => {
    expect(pixel(rasterize(FRAMES.dusk()), 150, 13).slice(0, 3)).toEqual(parseHex(SKY_RAMP.dusk[0] ?? ""));
  });

  it("night: the sky's top-left is dark", () => {
    const [r, g, b] = pixel(rasterize(FRAMES.night()), 0, 0);
    expect(Math.max(r, g, b)).toBeLessThan(48);
  });

  it("night: a shooting star mid-streak, and fires lighting the dark", () => {
    const world = FRAMES.night();
    const star = shootingStar(world.time);
    expect(star?.progress).toBeGreaterThan(0.3);
    expect(star?.progress).toBeLessThan(0.7);
    const lit = rasterize(world);
    // The camp fire's pool is brighter than the sand far from any fire.
    const glow = pixel(lit, FIRE_AT.x + 12, FIRE_AT.y + 4);
    const dark = pixel(lit, 300, 250);
    expect(glow[0] + glow[1]).toBeGreaterThan(dark[0] + dark[1]);
  });

  it("idle: the monument, its plaque, the felucca, the caravan and the birds", () => {
    const world = FRAMES.idle();
    expect(world.pyramid.monument).not.toBeNull();
    expect(world.actors.filter((a) => a.cast !== "arbab")).toEqual([]);
    expect(world.pyramid.blocks.every((b) => b.look === "set")).toBe(true);
    const boat = feluccaAt(world.time);
    expect(boat?.x).toBeGreaterThan(WIDTH / 4);
    expect(boat?.x).toBeLessThan((WIDTH * 3) / 4);
    const caravan = caravanAt(world.time);
    expect(caravan.length).toBeGreaterThan(0);
    expect(caravan.every((m) => m.x > 0 && m.x < WIDTH)).toBe(true);
    expect(flock(world.time).length).toBeGreaterThanOrEqual(3);
  });

  it("capstone: gold at the apex", () => {
    // Without the beam, which washes over it.
    const made = FRAMES.capstone();
    const world = { ...made, pyramid: { ...made.pyramid, capstone: { ...made.pyramid.capstone, glow: 0 } } };
    const { x, y } = world.pyramid.apex;
    const golds = Object.values(GOLD).map((c) => parseHex(c).join(","));
    const raster = rasterize(world);
    const around = [-1, 0].flatMap((dx) => [2, 3, 4].map((dy) => pixel(raster, x + dx, y - dy).slice(0, 3).join(",")));
    expect(around.some((c) => golds.includes(c))).toBe(true);
  });
});
