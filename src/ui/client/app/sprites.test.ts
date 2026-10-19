import { describe, expect, it } from "vitest";
import type { Pose } from "../model";
import { ACTOR_BOX, ARBAB_BOX } from "../model";
import { castColors, SPRITE_CHARS } from "./palette";
import {
  arbabGrids,
  compile,
  compileProp,
  compose,
  createSpriteSet,
  GLYPHS,
  ICONS,
  MARKER,
  POSES,
  PROPS,
  SLEEP_BOX,
  WORKER_CASTS,
  workerGrids,
} from "./sprites";

const FRAMES: Readonly<Record<Pose, number>> = {
  idle: 2,
  walk: 4,
  climb: 2,
  "climb-stone": 2,
  sit: 1,
  work: 2,
  sleep: 1,
  talk: 2,
  "carry-scroll": 4,
  "carry-stone": 4,
  "carry-ration": 4,
  slump: 4,
  cheer: 2,
};

function size(grid: readonly string[]): { w: number; h: number } {
  return { w: Math.max(...grid.map((row) => row.length)), h: grid.length };
}

function chars(grid: readonly string[]): Set<string> {
  return new Set(grid.join("").replaceAll(".", ""));
}

describe("worker sprites", () => {
  for (const cast of WORKER_CASTS) {
    it(`${cast}: every pose, with its frame count, inside its box`, () => {
      const grids = workerGrids(cast);
      for (const pose of POSES) {
        const frames = grids[pose];
        expect(frames, pose).toBeDefined();
        expect(frames?.length, pose).toBe(FRAMES[pose]);
        for (const grid of frames ?? []) {
          const box = pose === "sleep" ? SLEEP_BOX : ACTOR_BOX;
          expect(size(grid), pose).toEqual({ w: box.w, h: box.h });
          // Feet on the bottom row: the box is anchored there.
          expect(grid[grid.length - 1]?.replaceAll(".", "").length, pose).toBeGreaterThan(0);
        }
      }
      for (const tier of ["carry-ration-2", "carry-ration-3"]) expect(grids[tier]?.length).toBe(4);
    });

    it(`${cast}: every character is in the palette`, () => {
      for (const frames of Object.values(workerGrids(cast))) {
        for (const grid of frames) for (const ch of chars(grid)) expect(SPRITE_CHARS, `${cast} ${ch}`).toHaveProperty(ch);
      }
    });
  }

  it("draws the water carrier shorter, with a jug on the head", () => {
    const top = (grid: readonly string[]): number => grid.findIndex((row) => row.includes("h"));
    const waterboy = workerGrids("waterboy").idle?.[0] ?? [];
    const laborer = workerGrids("laborer").idle?.[0] ?? [];
    expect(top(waterboy)).toBeGreaterThan(top(laborer));
    expect(waterboy.slice(0, top(waterboy)).join("")).toContain("j");
  });

  it("gives the hammer, pen and rod casts two distinct work frames, and the others idle", () => {
    for (const cast of ["laborer", "mason", "scribe", "skeptic", "surveyor"] as const) {
      const [a, b] = workerGrids(cast).work ?? [];
      expect(a?.join("\n"), cast).not.toBe(b?.join("\n"));
    }
    for (const cast of ["waterboy", "scout"] as const) {
      const grids = workerGrids(cast);
      expect(grids.work).toEqual(grids.idle);
    }
  });

  it("climbs empty-handed in climb and with the stone on its back in climb-stone", () => {
    // The stone's colors (l, L, e) appear in no other part of a climbing worker.
    const stone = (grid: readonly string[]): boolean => [...chars(grid)].some((ch) => "lLe".includes(ch));
    for (const cast of WORKER_CASTS) {
      const grids = workerGrids(cast);
      const climb = grids.climb ?? [];
      const climbStone = grids["climb-stone"] ?? [];
      expect(climb.length, cast).toBe(2);
      expect(climb.some(stone), cast).toBe(false);
      expect(climbStone.every(stone), cast).toBe(true);
      // The same climber under the stone: the frames differ only where the stone lies, on the back (left half).
      climb.forEach((grid, i) => {
        const other = climbStone[i] ?? [];
        grid.forEach((row, y) => {
          for (let x = 0; x < row.length; x++) if (row[x] !== other[y]?.[x]) expect(x, `${cast} (${x}, ${y})`).toBeLessThan(6);
        });
      });
    }
  });

  it("raises the skeptic's finger when it talks", () => {
    expect(workerGrids("skeptic").talk?.[0]?.join("\n")).not.toBe(workerGrids("scribe").talk?.[0]?.join("\n"));
  });

  it("sleeps lying down, at most 16 × 7", () => {
    for (const cast of WORKER_CASTS) {
      const sleep = workerGrids(cast).sleep?.[0] ?? [];
      expect(size(sleep).w).toBeLessThanOrEqual(16);
      expect(size(sleep).h).toBeLessThanOrEqual(7);
    }
  });
});

describe("arbab", () => {
  it("has idle, talk and cheer, two frames each, inside ARBAB_BOX", () => {
    const grids = arbabGrids();
    expect(Object.keys(grids).sort()).toEqual(["cheer", "idle", "talk"]);
    for (const frames of Object.values(grids)) {
      expect(frames).toHaveLength(2);
      for (const grid of frames) {
        expect(size(grid)).toEqual({ w: ARBAB_BOX.w, h: ARBAB_BOX.h });
        for (const ch of chars(grid)) expect(SPRITE_CHARS).toHaveProperty(ch);
      }
    }
  });

  it("draws any other pose as idle", () => {
    const set = createSpriteSet();
    expect(set.frames("arbab", "walk", 0, false)).toBe(set.frames("arbab", "idle", 0, false));
  });
});

describe("compile", () => {
  it("merges runs of one color and mirrors them", () => {
    const sprite = compile(["..ab", "aa.."], { a: "#111111", b: "#222222" });
    expect(sprite).toMatchObject({ w: 4, h: 2, top: 0 });
    expect(sprite.runs).toEqual([
      { x: 2, y: 0, w: 1, color: "#111111" },
      { x: 3, y: 0, w: 1, color: "#222222" },
      { x: 0, y: 1, w: 2, color: "#111111" },
    ]);
    expect(sprite.mirrored).toEqual([
      { x: 1, y: 0, w: 1, color: "#111111" },
      { x: 0, y: 0, w: 1, color: "#222222" },
      { x: 2, y: 1, w: 2, color: "#111111" },
    ]);
  });

  it("finds the first row with a pixel", () => {
    expect(compile(["...", ".a."], { a: "#111111" }).top).toBe(1);
  });

  it("throws on a character without a color", () => {
    expect(() => compile(["?"], {})).toThrow(/has no color/);
  });
});

describe("compose", () => {
  it("draws layers in order and skips transparent pixels", () => {
    expect(compose(3, 2, [{ grid: ["aaa", "aaa"] }, { grid: [".b"], dx: 1, dy: 1 }])).toEqual(["aaa", "aab"]);
  });

  it("throws on a pixel outside the box", () => {
    expect(() => compose(2, 2, [{ grid: ["a"], dx: 2 }])).toThrow(/outside 2×2/);
    expect(() => compose(2, 2, [{ grid: ["a"], dy: -1 }])).toThrow(/outside/);
  });
});

describe("the palette", () => {
  it("has no character that no sprite uses", () => {
    const used = new Set<string>();
    const add = (grid: readonly string[]): void => {
      for (const ch of chars(grid)) used.add(ch);
    };
    for (const cast of WORKER_CASTS) for (const frames of Object.values(workerGrids(cast))) frames.forEach(add);
    for (const frames of Object.values(arbabGrids())) frames.forEach(add);
    for (const prop of Object.values(PROPS)) {
      if (typeof prop[0] === "string") add(prop as readonly string[]);
      else for (const grid of prop as readonly (readonly string[])[]) add(grid);
    }
    Object.values(ICONS).forEach(add);
    add(MARKER);
    expect(Object.keys(SPRITE_CHARS).filter((ch) => !used.has(ch))).toEqual([]);
  });
});

describe("cast colors", () => {
  it("tells every cast apart by its headcloth, sash or cloak", () => {
    const signature = (cast: (typeof WORKER_CASTS)[number]): string => JSON.stringify(castColors(cast));
    expect(new Set(WORKER_CASTS.map(signature)).size).toBe(WORKER_CASTS.length);
  });
});

describe("props, icons and glyphs", () => {
  it("compiles every prop and icon with the palette", () => {
    const grids = [
      PROPS.tent,
      PROPS.palm,
      PROPS.table,
      PROPS.chest,
      PROPS.well,
      PROPS.sledge,
      PROPS.capstone,
      PROPS.capstoneGleam,
      PROPS.glint,
      ...PROPS.rubble,
      ...Object.values(ICONS),
      MARKER,
    ];
    for (const grid of grids) expect(compileProp(grid).runs.length).toBeGreaterThan(0);
  });

  it("draws the capstone about 10 × 7 and the hourglass 5 × 7", () => {
    expect(size(PROPS.capstone)).toEqual({ w: 10, h: 7 });
    expect(size(PROPS.capstoneGleam)).toEqual({ w: 10, h: 7 });
    expect(size(ICONS.hourglass)).toEqual({ w: 5, h: 7 });
  });

  it("has at least 12 distinct 3 × 4 glyphs", () => {
    expect(GLYPHS.length).toBeGreaterThanOrEqual(12);
    for (const glyph of GLYPHS) {
      expect(size(glyph)).toEqual({ w: 3, h: 4 });
      expect(glyph.join("")).toMatch(/^[#.]+$/);
    }
    expect(new Set(GLYPHS.map((g) => g.join("/"))).size).toBe(GLYPHS.length);
  });
});

describe("createSpriteSet", () => {
  it("compiles once per cast and look, and picks the ration tier", () => {
    const set = createSpriteSet();
    expect(set.frames("laborer", "idle", 0, false)).toBe(set.frames("laborer", "idle", 0, false));
    expect(set.frames("laborer", "carry-ration", 3, false)).not.toBe(set.frames("laborer", "carry-ration", 1, false));
    expect(set.frames("laborer", "carry-ration", 0, false)).toBe(set.frames("laborer", "carry-ration", 1, false));
  });

  it("draws a ghost in a pale palette", () => {
    const set = createSpriteSet();
    const solid = new Set(set.frames("mason", "idle", 0, false)[0]?.runs.map((r) => r.color));
    const ghost = set.frames("mason", "idle", 0, true)[0]?.runs.map((r) => r.color) ?? [];
    expect(ghost.length).toBeGreaterThan(0);
    expect(ghost.some((c) => solid.has(c))).toBe(false);
  });
});
