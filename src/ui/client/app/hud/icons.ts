// The HUD's pixel icons (DESIGN.md §19): tiny grids like the sprites', one character per pixel and `.` none, drawn
// with fillRect into small canvases. The logo is the same grid as the tab's icon (ICON_SVG).
import type { Canvas2D, DocumentLike, ElementLike } from "../browser";
import { makeCanvas } from "./dom";
import { TOKENS } from "./tokens";

export const ICON_COLORS: Readonly<Record<string, string>> = {
  // Gold: light, mid, gleam.
  Y: TOKENS.gold,
  y: TOKENS["gold-2"],
  W: "#fff6c9",
  // Sandstone: the lit face, its course line, the shaded face, its course line.
  L: "#f1e2bc",
  l: "#dcc796",
  S: "#b5843f",
  s: "#8f6a33",
  // Iron, wood, glass and sand, ink.
  i: "#c9c3b0",
  I: "#85827a",
  w: "#8b5a2b",
  g: TOKENS.sand,
  m: TOKENS.muted,
  // States.
  b: TOKENS["st-running"],
  p: TOKENS["st-asleep"],
  e: TOKENS["st-success"],
  r: TOKENS["st-failed"],
  a: TOKENS["st-waiting"],
};

/** The pixel pyramid: a gold capstone on a stepped sandstone pyramid, lit from the left. 16 × 16. */
export const PYRAMID_GRID: readonly string[] = pyramidGrid();

function pyramidGrid(): string[] {
  const rows: string[] = [];
  for (let y = 0; y < 16; y++) {
    const k = Math.floor(y / 2);
    let row = "";
    for (let x = 0; x < 16; x++) {
      if (x < 7 - k || x > 8 + k) row += ".";
      else if (y === 0 && x === 7) row += "W";
      else if (y < 4) row += x <= 7 ? "Y" : "y";
      else if (y % 2 === 1) row += x <= 7 ? "l" : "s";
      else row += x <= 7 ? "L" : "S";
    }
    rows.push(row);
  }
  return rows;
}

export const ICONS = {
  logo: PYRAMID_GRID,
  hammer: ["iiiiiii.", "IiiiiiI.", "...w....", "...w....", "...w....", "...w....", "...w....", "...w...."],
  hourglass: ["yyyyyyy", ".mgggm.", "..mgm..", "...m...", "..mgm..", ".mgggm.", "yyyyyyy"],
  zzz: ["...pppp", ".....p.", "....p..", "...pppp", "ppp....", ".p.....", "ppp...."],
  check: [".......", "......e", ".....ee", "e...ee.", "ee.ee..", ".eee...", "..e...."],
  coin: ["..YYY..", ".YyyyY.", "YyYYYyY", "YyYyyyY", "YyYYYyY", ".YyyyY.", "..YYY.."],
  cross: [".......", "r.....r", "rr...rr", ".rr.rr.", "..rrr..", ".rr.rr.", "rr...rr"],
  arrow: [".......", "...b...", "....b..", "bbbbbb.", "....b..", "...b...", "......."],
  diamond: [".......", "...Y...", "..YYy..", ".YYyyy.", "..Yyy..", "...y...", "......."],
  wait: ["aaaaaaa", ".aggga.", "..aga..", "...a...", "..a.a..", ".aggga.", "aaaaaaa"],
} as const satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof ICONS;

/** One fillRect per stretch of same-colored pixels in a row, each pixel `scale` × `scale`, from (x, y). */
export function drawGrid(ctx: Canvas2D, grid: readonly string[], x: number, y: number, scale: number): void {
  grid.forEach((row, gy) => {
    let gx = 0;
    while (gx < row.length) {
      const color = ICON_COLORS[row[gx] ?? "."];
      if (color === undefined) {
        gx++;
        continue;
      }
      let end = gx + 1;
      while (end < row.length && ICON_COLORS[row[end] ?? "."] === color) end++;
      ctx.fillStyle = color;
      ctx.fillRect(x + gx * scale, y + gy * scale, (end - gx) * scale, scale);
      gx = end;
    }
  });
}

export function gridSize(grid: readonly string[]): { w: number; h: number } {
  return { w: Math.max(0, ...grid.map((row) => row.length)), h: grid.length };
}

/**
 * An icon in a `box` × `box` CSS px canvas (default: the grid's size × scale), drawn at `scale` CSS px per pixel and
 * centered. Hidden from assistive technology: the text beside it says the same.
 */
export function createIcon(doc: DocumentLike, name: IconName, scale: number, dpr: number, box?: number): ElementLike | null {
  const grid = ICONS[name];
  const { w, h } = gridSize(grid);
  const cssW = box ?? w * scale;
  const cssH = box ?? h * scale;
  const canvas = makeCanvas(doc, cssW, cssH, dpr, `px icon icon-${name}`);
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const px = scale * dpr;
    drawGrid(ctx, grid, Math.floor((cssW - w * scale) / 2) * dpr, Math.floor((cssH - h * scale) / 2) * dpr, px);
  }
  return canvas;
}
