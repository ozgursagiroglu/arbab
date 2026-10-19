import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Canvas2D } from "./browser";
import { ASCENT, DESCENT, drawText, GLYPHS, LINE_HEIGHT, measureText } from "./font";
import type { Raster } from "./raster";
import { createRaster, decodePng, encodePng } from "./raster";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

const ASCII = Array.from({ length: 126 - 32 + 1 }, (_, i) => String.fromCharCode(32 + i));
const SYMBOLS = [..."✓✗·•→←↑↓…—–×°"];
const ALL = [...ASCII, ...SYMBOLS];
const UPPER = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
const LOWER = [..."abcdefghijklmnopqrstuvwxyz"];
const DIGITS = [..."0123456789"];
const PUNCTUATION = ASCII.filter((ch) => ch !== " " && !UPPER.includes(ch) && !LOWER.includes(ch) && !DIGITS.includes(ch));

interface Call {
  op: "fillRect" | "clearRect";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

function fakeCanvas(): Canvas2D & { calls: Call[] } {
  const calls: Call[] = [];
  const ctx = {
    calls,
    fillStyle: "#000000",
    globalAlpha: 1,
    imageSmoothingEnabled: false,
    fillRect(x: number, y: number, w: number, h: number) {
      calls.push({ op: "fillRect", x, y, w, h, color: ctx.fillStyle });
    },
    clearRect(x: number, y: number, w: number, h: number) {
      calls.push({ op: "clearRect", x, y, w, h, color: ctx.fillStyle });
    },
  };
  return ctx;
}

function grid(ch: string): readonly string[] {
  const g = GLYPHS[ch];
  if (!g) throw new Error(`no glyph for ${JSON.stringify(ch)}`);
  return g;
}

/** Rows 0–8, the missing descent rows read as empty. */
function inked(ch: string, row: number): boolean {
  return (grid(ch)[row] ?? "").includes("#");
}

describe("the glyphs", () => {
  it("cover printable ASCII and the symbols, each inside 5×9", () => {
    for (const ch of ALL) {
      const g = grid(ch);
      expect([ASCENT, ASCENT + DESCENT], ch).toContain(g.length);
      const w = g[0]?.length ?? 0;
      expect(w, ch).toBeGreaterThanOrEqual(1);
      expect(w, ch).toBeLessThanOrEqual(5);
      for (const row of g) expect(row, ch).toMatch(new RegExp(`^[#.]{${w}}$`));
    }
  });

  it("have no glyph outside that set", () => {
    expect(Object.keys(GLYPHS).sort()).toEqual([...ALL].sort());
  });

  it("only g j p q y and , ; _ use the descent rows", () => {
    const descending = ALL.filter((ch) => inked(ch, ASCENT) || inked(ch, ASCENT + 1));
    expect(descending.sort()).toEqual([..."gjpqy,;_"].sort());
  });

  it("are 1 wide for i l ! . : ' |, 3 for a space, and 5 for every digit", () => {
    for (const ch of "il!.:'|") expect(measureText(ch), ch).toBe(1);
    expect(measureText(" ")).toBe(3);
    expect(GLYPHS[" "]?.join("")).not.toContain("#");
    for (const ch of DIGITS) expect(measureText(ch), ch).toBe(5);
  });

  it("set capitals and digits from the top row down to the baseline", () => {
    for (const ch of [...UPPER, ...DIGITS]) {
      expect(inked(ch, 0), ch).toBe(true);
      expect(inked(ch, ASCENT - 1), ch).toBe(true);
    }
  });

  it("give lowercase a 5-row x-height", () => {
    for (const ch of "acegmnopqrsuvwxyz") {
      expect(inked(ch, 0) || inked(ch, 1), ch).toBe(false);
      expect(inked(ch, 2), ch).toBe(true);
      expect(inked(ch, ASCENT - 1), ch).toBe(true);
    }
    for (const ch of "bdfhklt") expect(inked(ch, 0), ch).toBe(true);
  });

  it("tell 0 from O", () => {
    expect(grid("0")).not.toEqual(grid("O"));
  });

  it("draw exactly their grids", () => {
    for (const ch of ALL) {
      const g = grid(ch);
      const raster = createRaster(5, ASCENT + DESCENT);
      drawText(raster, ch, 0, 0, "#ffffff");
      for (let y = 0; y < ASCENT + DESCENT; y++) {
        for (let x = 0; x < 5; x++) {
          const on = (g[y] ?? "")[x] === "#";
          expect(raster.data[(y * 5 + x) * 4 + 3], `${ch} at ${x},${y}`).toBe(on ? 255 : 0);
        }
      }
    }
  });
});

describe("measureText", () => {
  it("is 0 for no text", () => {
    expect(measureText("")).toBe(0);
  });

  it("is the glyph's width for one character", () => {
    expect(measureText("A")).toBe(grid("A")[0]?.length);
    expect(measureText("i")).toBe(1);
  });

  it("adds one pixel between letters", () => {
    const a = measureText("A");
    const b = measureText("B");
    expect(measureText("AB")).toBe(a + 1 + b);
    expect(measureText("A B")).toBe(a + 1 + 3 + 1 + b);
  });

  it("lines numbers up: every digit string of one length measures the same", () => {
    expect(measureText("1111")).toBe(measureText("8888"));
    expect(measureText("2024")).toBe(4 * 5 + 3);
  });
});

describe("drawText", () => {
  it("fills with the color and returns the width drawn", () => {
    const ctx = fakeCanvas();
    const width = drawText(ctx, "Hi", 0, 0, "#ffd54a");
    expect(width).toBe(measureText("Hi"));
    expect(ctx.calls.length).toBeGreaterThan(0);
    for (const call of ctx.calls) {
      expect(call.op).toBe("fillRect");
      expect(call.color).toBe("#ffd54a");
    }
  });

  it("merges a row's adjacent pixels into one rect", () => {
    const ctx = fakeCanvas();
    drawText(ctx, "E", 0, 0, "#ffffff");
    // Every row of E is one stretch of pixels.
    expect(ctx.calls.map((c) => [c.y, c.w])).toEqual([
      [0, 5],
      [1, 1],
      [2, 1],
      [3, 4],
      [4, 1],
      [5, 1],
      [6, 5],
    ]);
  });

  it("places the top of the ascent at y and scales every pixel", () => {
    const ctx = fakeCanvas();
    const width = drawText(ctx, "-", 10, 20, "#ffffff", 3);
    expect(width).toBe(3 * 3);
    expect(ctx.calls).toEqual([{ op: "fillRect", x: 10, y: 20 + 3 * 3, w: 9, h: 3, color: "#ffffff" }]);
  });

  it("advances by the glyph's width and one pixel of spacing", () => {
    const ctx = fakeCanvas();
    const width = drawText(ctx, ".-", 4, 0, "#ffffff", 2);
    expect(width).toBe((1 + 1 + 3) * 2);
    expect(ctx.calls).toEqual([
      { op: "fillRect", x: 4, y: 12, w: 2, h: 2, color: "#ffffff" },
      { op: "fillRect", x: 4 + 2 * 2, y: 6, w: 6, h: 2, color: "#ffffff" },
    ]);
  });

  it("draws descenders below the baseline", () => {
    const ctx = fakeCanvas();
    drawText(ctx, "g", 0, 0, "#ffffff");
    expect(Math.max(...ctx.calls.map((c) => c.y))).toBe(ASCENT + DESCENT - 1);
  });

  it("draws nothing for no text, or a scale that is not positive", () => {
    for (const [text, scale] of [
      ["", 1],
      ["A", 0],
      ["A", -1],
      ["A", Number.NaN],
    ] as const) {
      const ctx = fakeCanvas();
      expect(drawText(ctx, text, 0, 0, "#ffffff", scale)).toBe(0);
      expect(ctx.calls).toEqual([]);
    }
  });

  it("draws a character it lacks as a hollow box as wide as 0", () => {
    const w0 = measureText("0");
    for (const ch of ["☃", "é", "😀", "\t"]) {
      expect(measureText(ch), ch).toBe(w0);
      const raster = createRaster(w0, ASCENT);
      drawText(raster, ch, 0, 0, "#ffffff");
      for (let y = 0; y < ASCENT; y++) {
        for (let x = 0; x < w0; x++) {
          const edge = x === 0 || y === 0 || x === w0 - 1 || y === ASCENT - 1;
          expect(raster.data[(y * w0 + x) * 4 + 3], `${ch} at ${x},${y}`).toBe(edge ? 255 : 0);
        }
      }
    }
    // A surrogate pair is one character, not two boxes.
    expect(measureText("a😀b")).toBe(measureText("a0b"));
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The font sheet: every glyph in a cell, its 5×9 box shaded, then a few lines of text. A missing PNG is written; an
// existing one is compared by decoded pixels, like the frames.

const SHEET_SCALE = 4;
const MARGIN = 4;
const CELL = 8;
const ROW = LINE_HEIGHT + 3;
const BACKGROUND = "#1B2347";
const CELL_BOX = "#26315C";
const INK = "#FFD54A";
const TEXT = "#F4F0E2";

const SHEET_ROWS: readonly (readonly string[])[] = [
  UPPER,
  LOWER,
  DIGITS,
  PUNCTUATION.slice(0, 16),
  PUNCTUATION.slice(16),
  // The snowman has no glyph: the last cell shows the missing box.
  [...SYMBOLS, "☃"],
];

const SAMPLES = [
  "The site awakens…",
  "LIVE · 12:34 · $4.20 · 98% · 7d 61%",
  "✓ 3 landed  ✗ 1 failed  → verify",
  "Quick jumpy glyphs, fizz; wax_box!",
  "Monument #7 — 1,024 blocks × 2 (0/O)",
];

function fontSheet(): Raster {
  const columns = Math.max(...SHEET_ROWS.map((r) => r.length));
  const width = MARGIN * 2 + Math.max(columns * CELL - (CELL - 5), ...SAMPLES.map(measureText));
  const height = MARGIN * 2 + SHEET_ROWS.length * ROW + SAMPLES.length * LINE_HEIGHT;
  const s = SHEET_SCALE;
  const raster = createRaster(width * s, height * s);
  raster.fillStyle = BACKGROUND;
  raster.fillRect(0, 0, raster.width, raster.height);
  SHEET_ROWS.forEach((chars, row) => {
    chars.forEach((ch, col) => {
      const x = (MARGIN + col * CELL) * s;
      const y = (MARGIN + row * ROW) * s;
      raster.fillStyle = CELL_BOX;
      raster.fillRect(x, y, measureText(ch) * s, (ASCENT + DESCENT) * s);
      drawText(raster, ch, x, y, INK, s);
    });
  });
  SAMPLES.forEach((line, i) => {
    drawText(raster, line, MARGIN * s, (MARGIN + SHEET_ROWS.length * ROW + i * LINE_HEIGHT) * s, TEXT, s);
  });
  return raster;
}

function golden(name: string, raster: Raster): void {
  const file = join(ROOT, "docs", "ui", `${name}.png`);
  const png = encodePng(raster.width, raster.height, raster.data);
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, png);
    return;
  }
  const want = decodePng(readFileSync(file));
  const got = decodePng(png);
  const same = want.width === got.width && want.height === got.height && Buffer.from(want.data).equals(Buffer.from(got.data));
  if (!same) throw new Error(`docs/ui/${name}.png is stale: delete it and run the test again to accept the new sheet`);
}

describe("docs/ui/font.png", () => {
  it("shows every glyph", () => {
    const shown = SHEET_ROWS.flat();
    for (const ch of ALL) if (ch !== " ") expect(shown, ch).toContain(ch);
    golden("font", fontSheet());
  });
});
