// The crew's avatars as the page shows them: every worker cast in every avatar pose on its tinted tile, and arbab on
// the empty state's tile. The strip is a golden in docs/ui/avatars.png, with the rule of frames.test.ts: a missing
// file is written, an existing one is compared by decoded pixels.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Pose } from "../../model";
import type { Canvas2D, CanvasElementLike, DocumentLike } from "../browser";
import { mix, parseHex } from "../palette";
import type { Raster } from "../raster";
import { createRaster, decodePng, encodePng } from "../raster";
import { createSpriteSet, WORKER_CASTS } from "../sprites";
import { AVATAR, AVATAR_ARBAB, avatarPose, createArbabTile, createAvatar } from "./crew";
import { FakeElement, fakeDocument } from "./fake-dom";
import { CHIPS, TOKENS } from "./tokens";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..");
const sprites = createSpriteSet();

/** A canvas whose 2D context is a raster of its current size, as a browser's is. */
class RasterCanvas extends FakeElement implements CanvasElementLike {
  width = 0;
  height = 0;
  raster: Raster | null = null;
  constructor() {
    super("canvas");
  }
  getContext(): Canvas2D {
    if (!this.raster || this.raster.width !== this.width || this.raster.height !== this.height) {
      this.raster = createRaster(Math.max(1, this.width), Math.max(1, this.height));
    }
    return this.raster;
  }
}

function rasterDocument(): DocumentLike {
  const doc = fakeDocument();
  return { ...doc, createElement: (tag) => (tag === "canvas" ? new RasterCanvas() : new FakeElement(tag)) };
}

/** The pose every lane state shows on its card, once each. */
const LOOKS: { pose: Pose; ghost: boolean }[] = (["running", "held", "waiting-reset", "preparing", "orphaned"] as const).map((state) =>
  avatarPose({ state }),
);

/** `.tile`'s background: color-mix(in srgb, chip 38%, bg-2). */
function tileColor(chip: string): string {
  return mix(TOKENS["bg-2"], chip, 0.38);
}

/** The avatar's canvas, drawn by the page's own code at one device pixel per CSS pixel. */
function avatarRaster(cast: (typeof WORKER_CASTS)[number], pose: Pose, ghost: boolean): Raster {
  const avatar = createAvatar(rasterDocument(), sprites, 1);
  avatar.set(cast, pose, ghost);
  const canvas = (avatar.el as FakeElement).children[0] as RasterCanvas;
  const raster = canvas.raster;
  if (!raster) throw new Error("the avatar drew nothing");
  return raster;
}

/** Fills a tile like the CSS does: the tint, an inset 2-px dark edge. */
function paintTile(out: Raster, x: number, y: number, w: number, h: number, color: string): void {
  out.fillStyle = TOKENS["frame-dark"];
  out.fillRect(x, y, w, h);
  out.fillStyle = color;
  out.fillRect(x + 2, y + 2, w - 4, h - 4);
}

/** Lays a canvas over the strip, source-over, at `opacity`. */
function blit(out: Raster, src: Raster, x0: number, y0: number, opacity = 1): void {
  for (let y = 0; y < src.height; y += 1) {
    for (let x = 0; x < src.width; x += 1) {
      const i = (y * src.width + x) * 4;
      const a = ((src.data[i + 3] ?? 0) / 255) * opacity;
      if (a <= 0) continue;
      const hex = (v: number | undefined): string => (v ?? 0).toString(16).padStart(2, "0");
      out.globalAlpha = a;
      out.fillStyle = `#${hex(src.data[i])}${hex(src.data[i + 1])}${hex(src.data[i + 2])}`;
      out.fillRect(x0 + x, y0 + y, 1, 1);
    }
  }
  out.globalAlpha = 1;
}

/** Pixels of the avatar's canvas that differ from its tile's tint once laid over it. */
function visible(raster: Raster, tint: string): number {
  const [r, g, b] = parseHex(tint);
  let n = 0;
  for (let i = 0; i < raster.data.length; i += 4) {
    if ((raster.data[i + 3] ?? 0) === 0) continue;
    if (raster.data[i] !== r || raster.data[i + 1] !== g || raster.data[i + 2] !== b) n += 1;
  }
  return n;
}

const TILE = { w: 44, h: 62, pad: 4 } as const;
const ARBAB_TILE = { w: AVATAR_ARBAB.w + 8, h: AVATAR_ARBAB.h + 8 } as const;
const GAP = 6;

describe("the crew's avatars", () => {
  for (const cast of WORKER_CASTS) {
    for (const { pose, ghost } of LOOKS) {
      it(`${cast} ${pose}${ghost ? " (ghost)" : ""}: pixels other than the tile's, standing on the canvas's bottom edge`, () => {
        const raster = avatarRaster(cast, pose, ghost);
        expect([raster.width, raster.height]).toEqual([AVATAR.w, AVATAR.h]);
        expect(visible(raster, tileColor(CHIPS[cast]))).toBeGreaterThan(40);
        // The lowest drawn row is the canvas's last one.
        let bottom = -1;
        for (let i = 3; i < raster.data.length; i += 4) if ((raster.data[i] ?? 0) > 0) bottom = Math.floor((i - 3) / 4 / raster.width);
        expect(bottom).toBe(AVATAR.h - 1);
      });
    }
  }

  it("sleep: lies across the tile at 2×, its figure rows above the bottom edge", () => {
    const raster = avatarRaster("laborer", "sleep", false);
    let left: number = AVATAR.w;
    let right = -1;
    for (let y = 0; y < raster.height; y += 1) {
      for (let x = 0; x < raster.width; x += 1) {
        if ((raster.data[(y * raster.width + x) * 4 + 3] ?? 0) === 0) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
    }
    // 16 sprite pixels at 2× nearly span the 36-px canvas.
    expect(right - left + 1).toBeGreaterThanOrEqual(28);
  });

  it("the empty state: arbab's idle sprite at 3× on its tile", () => {
    const tile = createArbabTile(rasterDocument(), sprites, 1) as FakeElement;
    expect(tile.className).toBe("tile tile-arbab");
    const canvas = tile.children[0] as RasterCanvas;
    const raster = canvas.raster;
    if (!raster) throw new Error("arbab drew nothing");
    expect([raster.width, raster.height]).toEqual([AVATAR_ARBAB.w, AVATAR_ARBAB.h]);
    expect(visible(raster, TOKENS["bg-2"])).toBeGreaterThan(200);
  });

  it("docs/ui/avatars.png: the strip of every cast in every pose, and arbab", () => {
    const width = GAP + LOOKS.length * (TILE.w + GAP) + ARBAB_TILE.w + GAP;
    const height = Math.max(GAP + WORKER_CASTS.length * (TILE.h + GAP), ARBAB_TILE.h + 2 * GAP);
    const strip = createRaster(width, height);
    strip.fillStyle = TOKENS.panel;
    strip.fillRect(0, 0, width, height);
    WORKER_CASTS.forEach((cast, row) => {
      LOOKS.forEach(({ pose, ghost }, col) => {
        const x = GAP + col * (TILE.w + GAP);
        const y = GAP + row * (TILE.h + GAP);
        paintTile(strip, x, y, TILE.w, TILE.h, tileColor(CHIPS[cast]));
        // place-items: end center, with 4 px of padding below.
        blit(strip, avatarRaster(cast, pose, ghost), x + (TILE.w - AVATAR.w) / 2, y + TILE.h - TILE.pad - AVATAR.h, ghost ? 0.75 : 1);
      });
    });
    const tile = createArbabTile(rasterDocument(), sprites, 1) as FakeElement;
    const arbab = (tile.children[0] as RasterCanvas).raster;
    if (!arbab) throw new Error("arbab drew nothing");
    const ax = width - GAP - ARBAB_TILE.w;
    paintTile(strip, ax, GAP, ARBAB_TILE.w, ARBAB_TILE.h, TOKENS["bg-2"]);
    blit(strip, arbab, ax + 4, GAP + ARBAB_TILE.h - 4 - AVATAR_ARBAB.h);

    const file = join(ROOT, "docs", "ui", "avatars.png");
    const png = encodePng(strip.width, strip.height, strip.data, 3);
    if (!existsSync(file)) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, png);
      return;
    }
    const want = decodePng(readFileSync(file));
    const got = decodePng(png);
    const same = want.width === got.width && want.height === got.height && Buffer.from(want.data).equals(Buffer.from(got.data));
    if (!same) throw new Error("docs/ui/avatars.png is stale: delete it and run the test again to accept the new strip");
  });
});
