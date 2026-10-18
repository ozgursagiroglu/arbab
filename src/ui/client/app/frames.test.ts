// The docs/ui frames: the README's pictures and the renderer's goldens. A missing frame is written; an existing one is
// compared by decoded pixels, so another zlib cannot fail it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { World } from "../model";
import { HEIGHT, WIDTH } from "../model";
import { FRAMES } from "./fixtures";
import { GOLD, parseHex, SKY } from "./palette";
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

  it("day: a day sky in the top-left corner", () => {
    expect(pixel(rasterize(FRAMES.day()), 0, 0).slice(0, 3)).toEqual(parseHex(SKY.day[0]));
  });

  it("dusk: a dusk sky in the top-left corner", () => {
    expect(pixel(rasterize(FRAMES.dusk()), 0, 0).slice(0, 3)).toEqual(parseHex(SKY.dusk[0]));
  });

  it("night: the sky's top-left is dark", () => {
    const [r, g, b] = pixel(rasterize(FRAMES.night()), 0, 0);
    expect(Math.max(r, g, b)).toBeLessThan(48);
  });

  it("capstone: gold at the apex", () => {
    const world = FRAMES.capstone();
    const { x, y } = world.pyramid.apex;
    const golds = Object.values(GOLD).map((c) => parseHex(c).join(","));
    const raster = rasterize(world);
    const around = [-1, 0].flatMap((dx) => [2, 3, 4].map((dy) => pixel(raster, x + dx, y - dy).slice(0, 3).join(",")));
    expect(around.some((c) => golds.includes(c))).toBe(true);
  });
});
