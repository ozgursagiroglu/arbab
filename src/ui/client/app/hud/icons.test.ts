import { describe, expect, it } from "vitest";
import type { FakeCanvas } from "./fake-dom";
import { FakeCanvas as Canvas, fakeDocument } from "./fake-dom";
import { createIcon, drawGrid, gridSize, ICON_COLORS, ICONS, PYRAMID_GRID } from "./icons";

describe("ICONS", () => {
  it("are grids of known colors, at most 8 × 8 but the 16 × 16 logo", () => {
    for (const [name, grid] of Object.entries(ICONS)) {
      const { w, h } = gridSize(grid);
      expect(grid.every((row) => row.length === w), name).toBe(true);
      for (const row of grid) for (const ch of row) expect(ch === "." || ICON_COLORS[ch] !== undefined, `${name} ${ch}`).toBe(true);
      if (name === "logo") expect([w, h]).toEqual([16, 16]);
      else expect(w <= 8 && h <= 8, name).toBe(true);
    }
  });

  it("the pyramid is stepped, symmetric in shape, with a gold capstone", () => {
    expect(PYRAMID_GRID[0]).toBe(".......Wy.......");
    expect(PYRAMID_GRID[3]).toBe("......YYyy......");
    expect(PYRAMID_GRID[15]).toBe("llllllllssssssss");
    for (const row of PYRAMID_GRID) expect(row.replace(/[^.]/g, "#")).toBe([...row.replace(/[^.]/g, "#")].reverse().join(""));
  });
});

describe("drawGrid", () => {
  it("draws one rect per run of one color, scaled", () => {
    const canvas = new Canvas();
    drawGrid(canvas.ctx, ["YY.y", "...."], 10, 20, 2);
    expect(canvas.fills).toEqual([
      { x: 10, y: 20, w: 4, h: 2, color: ICON_COLORS.Y },
      { x: 16, y: 20, w: 2, h: 2, color: ICON_COLORS.y },
    ]);
  });
});

describe("createIcon", () => {
  it("centers the grid in its box, at device pixels", () => {
    const canvas = createIcon(fakeDocument(), "hourglass", 2, 2, 16) as FakeCanvas;
    expect([canvas.width, canvas.height, canvas.style.width]).toEqual([32, 32, "16px"]);
    expect(canvas.className).toBe("px icon icon-hourglass");
    // 7 wide at 2: 14 px in 16, one px in from the left.
    expect(Math.min(...canvas.fills.map((f) => f.x))).toBe(2);
    expect(canvas.fills.every((f) => f.h === 4)).toBe(true);
  });

  it("is the grid's size without a box", () => {
    const canvas = createIcon(fakeDocument(), "logo", 2, 1) as FakeCanvas;
    expect(canvas.style.width).toBe("32px");
  });
});
