import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { crc32, createRaster, decodePng, encodePng } from "./raster";

function px(data: Uint8Array, width: number, x: number, y: number): number[] {
  const i = (y * width + x) * 4;
  return Array.from(data.subarray(i, i + 4));
}

describe("createRaster", () => {
  it("fills, clips to the buffer and rounds coordinates", () => {
    const r = createRaster(4, 3);
    r.fillStyle = "#FF0000";
    r.fillRect(-2, -2, 3.4, 3.6);
    expect(px(r.data, 4, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(r.data, 4, 0, 1)).toEqual([255, 0, 0, 255]);
    expect(px(r.data, 4, 1, 0)).toEqual([0, 0, 0, 0]);
    r.fillRect(3, 2, 10, 10);
    expect(px(r.data, 4, 3, 2)).toEqual([255, 0, 0, 255]);
    // Negative sizes fill toward the origin, like a canvas.
    r.fillStyle = "#00ff00";
    r.fillRect(3, 1, -1, 1);
    expect(px(r.data, 4, 2, 1)).toEqual([0, 255, 0, 255]);
  });

  it("blends source-over by globalAlpha", () => {
    const r = createRaster(1, 1);
    r.fillStyle = "#000000";
    r.fillRect(0, 0, 1, 1);
    r.globalAlpha = 0.5;
    r.fillStyle = "#FFFFFF";
    r.fillRect(0, 0, 1, 1);
    expect(px(r.data, 1, 0, 0)).toEqual([128, 128, 128, 255]);
    const t = createRaster(1, 1);
    t.globalAlpha = 0.5;
    t.fillStyle = "#FFFFFF";
    t.fillRect(0, 0, 1, 1);
    expect(px(t.data, 1, 0, 0)).toEqual([255, 255, 255, 128]);
  });

  it("ignores a globalAlpha outside 0–1 and draws nothing at 0", () => {
    const r = createRaster(1, 1);
    r.globalAlpha = 2;
    expect(r.globalAlpha).toBe(1);
    r.globalAlpha = Number.NaN;
    expect(r.globalAlpha).toBe(1);
    r.globalAlpha = 0;
    r.fillStyle = "#FFFFFF";
    r.fillRect(0, 0, 1, 1);
    expect(px(r.data, 1, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it("accepts only #rrggbb", () => {
    const r = createRaster(1, 1);
    for (const bad of ["red", "#fff", "#12345g", "rgb(0,0,0)", "#1234567"]) {
      expect(() => {
        r.fillStyle = bad;
      }, bad).toThrow(/#rrggbb/);
    }
    r.fillStyle = "#a1B2c3";
    expect(r.fillStyle).toBe("#a1B2c3");
  });

  it("clears to transparent", () => {
    const r = createRaster(2, 1);
    r.fillStyle = "#123456";
    r.fillRect(0, 0, 2, 1);
    r.clearRect(1, 0, 5, 5);
    expect(px(r.data, 2, 0, 0)).toEqual([0x12, 0x34, 0x56, 255]);
    expect(px(r.data, 2, 1, 0)).toEqual([0, 0, 0, 0]);
  });

  it("ignores non-finite rectangles and refuses a bad size", () => {
    const r = createRaster(1, 1);
    r.fillRect(Number.NaN, 0, 1, 1);
    expect(px(r.data, 1, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(() => createRaster(0, 1)).toThrow(/positive/);
    expect(() => createRaster(1.5, 1)).toThrow(/positive/);
  });
});

describe("PNG", () => {
  it("computes the standard CRC32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("round-trips pixels, upscaled by nearest neighbour", () => {
    const rgba = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 1, 2, 3, 0]);
    const png = encodePng(2, 2, rgba, 3);
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const back = decodePng(png);
    expect(back.width).toBe(6);
    expect(back.height).toBe(6);
    expect(px(back.data, 6, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(back.data, 6, 2, 2)).toEqual([255, 0, 0, 255]);
    expect(px(back.data, 6, 3, 0)).toEqual([0, 255, 0, 128]);
    expect(px(back.data, 6, 5, 5)).toEqual([1, 2, 3, 0]);
    expect(Array.from(decodePng(encodePng(2, 2, rgba)).data)).toEqual(Array.from(rgba));
  });

  it("refuses a bad scale or buffer", () => {
    expect(() => encodePng(1, 1, new Uint8Array(4), 0)).toThrow(/scale/);
    expect(() => encodePng(2, 1, new Uint8Array(4))).toThrow(/RGBA/);
  });

  it("refuses what it did not write", () => {
    const png = encodePng(1, 1, Uint8Array.from([1, 2, 3, 4]));
    expect(() => decodePng(Uint8Array.from([1, 2, 3]))).toThrow(/not a PNG/);
    const corrupt = Buffer.from(png);
    corrupt[20] = (corrupt[20] ?? 0) ^ 0xff;
    expect(() => decodePng(corrupt)).toThrow(/CRC/);
    expect(() => decodePng(png.subarray(0, png.length - 12))).toThrow(/incomplete/);
  });

  it("refuses rows with another filter", () => {
    // Re-pack the IDAT with filter 1 on the only row.
    const png = encodePng(1, 1, Uint8Array.from([1, 2, 3, 4]));
    const raw = deflateSync(Buffer.from([1, 1, 2, 3, 4]));
    const ihdrEnd = 8 + 12 + 13;
    const head = Buffer.alloc(8);
    head.writeUInt32BE(raw.length, 0);
    head.write("IDAT", 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), raw])), 0);
    const iend = png.subarray(png.length - 12);
    const forged = Buffer.concat([png.subarray(0, ihdrEnd), head, raw, crc, iend]);
    expect(() => decodePng(forged)).toThrow(/filter 1/);
  });
});
