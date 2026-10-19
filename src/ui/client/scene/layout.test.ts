import { describe, expect, it } from "vitest";
import { CAMP, HORIZON_Y, PLACES, PYRAMID_AREA } from "../model";
import { campSeat, farPyramidPlace, pyramidLayout, workSpot } from "./layout";

describe("pyramidLayout", () => {
  const cases: Array<[number, number]> = [
    [0, 4],
    [1, 4],
    [10, 4],
    [11, 5],
    [15, 5],
    [16, 6],
    [78, 12],
    [79, 13],
    [300, 24],
  ];

  it.each(cases)("%i lanes: base %i, integer slots inside the area, no overlaps", (lanes, base) => {
    const p = pyramidLayout(lanes);
    expect(p.base).toBe(base);
    expect(p.slots).toHaveLength((base * (base + 1)) / 2);
    expect(p.slots.length).toBeGreaterThanOrEqual(lanes);
    expect(p.blockW % 2).toBe(0);
    expect(p.blockW).toBeLessThanOrEqual(32);
    expect(p.blockW).toBeLessThanOrEqual(2 * p.blockH);
    expect(p.blockH).toBeGreaterThan(0);

    const left = PYRAMID_AREA.centerX - PYRAMID_AREA.maxWidth / 2;
    const right = PYRAMID_AREA.centerX + PYRAMID_AREA.maxWidth / 2;
    const top = PYRAMID_AREA.baseY - PYRAMID_AREA.maxHeight;
    for (const s of p.slots) {
      for (const v of [s.x, s.y, s.w, s.h]) expect(Number.isInteger(v)).toBe(true);
      expect(s.w).toBe(p.blockW);
      expect(s.h).toBe(p.blockH);
      expect(s.x).toBeGreaterThanOrEqual(left);
      expect(s.x + s.w).toBeLessThanOrEqual(right);
      expect(s.y).toBeGreaterThanOrEqual(top);
      expect(s.y + s.h).toBeLessThanOrEqual(PYRAMID_AREA.baseY);
      expect(s.y).toBe(PYRAMID_AREA.baseY - (s.course + 1) * p.blockH);
    }

    for (let k = 0; k < base; k += 1) {
      const course = p.slots.filter((s) => s.course === k);
      expect(course).toHaveLength(base - k);
    }
    // Course 0 first, each course left to right.
    for (let i = 1; i < p.slots.length; i += 1) {
      const a = p.slots[i - 1]!;
      const b = p.slots[i]!;
      expect(b.course === a.course ? b.x > a.x : b.course === a.course + 1).toBe(true);
    }

    for (let i = 0; i < p.slots.length; i += 1) {
      for (let j = i + 1; j < p.slots.length; j += 1) {
        const a = p.slots[i]!;
        const b = p.slots[j]!;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    }

    const topCourse = p.slots.filter((s) => s.course === base - 1);
    expect(topCourse).toHaveLength(1);
    expect(p.apex).toEqual({ x: PYRAMID_AREA.centerX, y: topCourse[0]!.y });
    expect(p.apex.y).toBe(PYRAMID_AREA.baseY - base * p.blockH);
  });

  it("sizes blocks by the rules", () => {
    expect(pyramidLayout(10)).toMatchObject({ base: 4, blockW: 32, blockH: 16 });
    // 228/5 = 45 → 32; 104/5 = 20 → min(16, 20).
    expect(pyramidLayout(15)).toMatchObject({ base: 5, blockW: 32, blockH: 16 });
    // 228/13 = 17 → 16; 104/13 = 8.
    expect(pyramidLayout(79)).toMatchObject({ base: 13, blockW: 16, blockH: 8 });
    // 228/24 = 9 → 8; 104/24 = 4.
    expect(pyramidLayout(300)).toMatchObject({ base: 24, blockW: 8, blockH: 4 });
  });

  it("centers each course", () => {
    const p = pyramidLayout(10);
    expect(p.slots[0]).toEqual({ x: 204, y: 192, w: 32, h: 16, course: 0 });
    expect(p.slots[4]).toEqual({ x: 220, y: 176, w: 32, h: 16, course: 1 });
    expect(p.slots[9]).toEqual({ x: 252, y: 144, w: 32, h: 16, course: 3 });
  });

  it("treats odd input as no lanes", () => {
    expect(pyramidLayout(-3).base).toBe(4);
    expect(pyramidLayout(Number.NaN).base).toBe(4);
  });
});

describe("campSeat", () => {
  it("fills a row, then the next row, offset by half a step", () => {
    expect(campSeat(0)).toEqual(PLACES.camp);
    expect(campSeat(1)).toEqual({ x: PLACES.camp.x + CAMP.step, y: PLACES.camp.y });
    expect(campSeat(5)).toEqual({ x: PLACES.camp.x + CAMP.step / 2, y: PLACES.camp.y + CAMP.rowStep });
    expect(campSeat(9)).toEqual({ x: PLACES.camp.x + 4 * CAMP.step + CAMP.step / 2, y: PLACES.camp.y + CAMP.rowStep });
  });

  it("wraps around the seats", () => {
    expect(campSeat(10)).toEqual(campSeat(0));
    expect(campSeat(13)).toEqual(campSeat(3));
    expect(campSeat(-1)).toEqual(campSeat(9));
  });
});

describe("farPyramidPlace", () => {
  it("stands on the left horizon, the newest nearest the site", () => {
    expect(farPyramidPlace(0, 5)).toEqual({ x: 152, y: HORIZON_Y, height: 11 });
    expect(farPyramidPlace(1, 5).x).toBe(108);
    expect(farPyramidPlace(2, 5).x).toBe(64);
  });

  it("clamps the height and the index", () => {
    expect(farPyramidPlace(0, 0).height).toBe(8);
    expect(farPyramidPlace(0, 100).height).toBe(22);
    expect(farPyramidPlace(0, 10).height).toBe(14);
    expect(farPyramidPlace(7, 1).x).toBe(64);
    expect(farPyramidPlace(-1, 1).x).toBe(152);
  });
});

describe("workSpot", () => {
  it("puts the feet on the slot's bottom edge, centered", () => {
    expect(workSpot({ x: 204, y: 192, w: 32, h: 16, course: 0 })).toEqual({ x: 220, y: 208 });
  });
});
