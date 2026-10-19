// A Canvas2D that draws into an RGBA buffer, and PNG for it, so tests rasterize the scene with the renderer the page
// runs (DESIGN.md §19). Imported only by tests and the frames, never by main.ts: it needs node:zlib.
import { deflateSync, inflateSync } from "node:zlib";
import type { Canvas2D } from "./browser";
import { parseHex } from "./palette";

export interface Raster extends Canvas2D {
  readonly width: number;
  readonly height: number;
  /** RGBA, row by row. */
  readonly data: Uint8Array;
}

/** Clips to the buffer, rounds coordinates, blends source-over by globalAlpha, and accepts only `#rrggbb`. */
export function createRaster(width: number, height: number): Raster {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`raster size must be positive integers, not ${width}×${height}`);
  }
  const data = new Uint8Array(width * height * 4);
  let style = "#000000";
  let rgb: [number, number, number] = [0, 0, 0];
  let alpha = 1;

  const span = (x: number, y: number, w: number, h: number): [number, number, number, number] | null => {
    if (![x, y, w, h].every(Number.isFinite)) return null;
    const x0 = Math.max(0, Math.round(Math.min(x, x + w)));
    const x1 = Math.min(width, Math.round(Math.max(x, x + w)));
    const y0 = Math.max(0, Math.round(Math.min(y, y + h)));
    const y1 = Math.min(height, Math.round(Math.max(y, y + h)));
    return x0 < x1 && y0 < y1 ? [x0, y0, x1, y1] : null;
  };

  return {
    width,
    height,
    data,
    imageSmoothingEnabled: false,
    get fillStyle() {
      return style;
    },
    set fillStyle(value: string) {
      rgb = parseHex(value);
      style = value;
    },
    get globalAlpha() {
      return alpha;
    },
    set globalAlpha(value: number) {
      // Like a canvas: values outside 0–1 are ignored.
      if (Number.isFinite(value) && value >= 0 && value <= 1) alpha = value;
    },
    fillRect(x, y, w, h) {
      const s = span(x, y, w, h);
      if (!s || alpha === 0) return;
      const [x0, y0, x1, y1] = s;
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const i = (py * width + px) * 4;
          const da = (data[i + 3] ?? 0) / 255;
          const oa = alpha + da * (1 - alpha);
          for (let c = 0; c < 3; c++) {
            const d = data[i + c] ?? 0;
            data[i + c] = oa === 0 ? 0 : Math.round(((rgb[c] ?? 0) * alpha + d * da * (1 - alpha)) / oa);
          }
          data[i + 3] = Math.round(oa * 255);
        }
      }
    },
    clearRect(x, y, w, h) {
      const s = span(x, y, w, h);
      if (!s) return;
      const [x0, y0, x1, y1] = s;
      for (let py = y0; py < y1; py++) data.fill(0, (py * width + x0) * 4, (py * width + x1) * 4);
    },
  };
}

const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** An 8-bit RGBA PNG of the buffer, upscaled `scale` times by nearest neighbour; filter 0 on every row. */
export function encodePng(width: number, height: number, rgba: Uint8Array, scale = 1): Buffer {
  if (!Number.isInteger(scale) || scale < 1) throw new Error(`scale must be a positive integer, not ${scale}`);
  if (rgba.length !== width * height * 4) throw new Error(`${rgba.length} bytes is not ${width}×${height} RGBA`);
  const w = width * scale;
  const h = height * scale;
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const src = Math.floor(y / scale) * width;
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const s = (src + Math.floor(x / scale)) * 4;
      const d = row + 1 + x * 4;
      raw[d] = rgba[s] ?? 0;
      raw[d + 1] = rgba[s + 1] ?? 0;
      raw[d + 2] = rgba[s + 2] ?? 0;
      raw[d + 3] = rgba[s + 3] ?? 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from(SIGNATURE), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))]);
}

/** Decodes what encodePng writes: 8-bit RGBA, not interlaced, filter 0. Anything else throws. */
export function decodePng(bytes: Uint8Array): { width: number; height: number; data: Uint8Array } {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  let ended = false;
  while (offset + 12 <= buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > buf.length) throw new Error("truncated PNG chunk");
    const body = buf.subarray(offset + 8, offset + 8 + length);
    if (crc32(buf.subarray(offset + 4, offset + 8 + length)) !== buf.readUInt32BE(offset + 8 + length)) {
      throw new Error(`bad CRC in ${type}`);
    }
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, color, compression, filter, interlace] = body.subarray(8, 13);
      if (depth !== 8 || color !== 6 || compression !== 0 || filter !== 0 || interlace !== 0) {
        throw new Error("only 8-bit RGBA PNGs without interlace are supported");
      }
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      ended = true;
      break;
    }
    offset = end;
  }
  if (!ended || width === 0 || height === 0) throw new Error("incomplete PNG");
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4 + 1;
  if (raw.length !== stride * height) throw new Error("PNG data does not match its size");
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    if (raw[y * stride] !== 0) throw new Error(`PNG row ${y} uses filter ${raw[y * stride]}`);
    data.set(raw.subarray(y * stride + 1, (y + 1) * stride), y * width * 4);
  }
  return { width, height, data };
}
