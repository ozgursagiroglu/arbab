import { describe, expect, it } from "vitest";
import { desaturate, ghostly, mix, MOON, parseHex, shade, SPRITE_CHARS, toHex } from "./palette";

const HEX = /^#[0-9A-F]{6}$/;

describe("toHex", () => {
  it("writes two digits per channel, padded, in the palette's upper case", () => {
    expect(toHex(0, 10, 255)).toBe("#000AFF");
    expect(toHex(171, 205, 239)).toBe("#ABCDEF");
    expect(toHex(1, 2, 3)).toMatch(HEX);
  });

  it("rounds each channel to the nearest integer, halves up", () => {
    expect(toHex(0.5, 1.49, 15.5)).toBe("#010110");
    expect(toHex(254.6, 127.5, 0.4)).toBe("#FF8000");
  });

  it("clamps each channel to 0–255", () => {
    expect(toHex(-3, 300, 255.4)).toBe("#00FFFF");
    expect(toHex(-0.6, 1e9, -1e9)).toBe("#00FF00");
  });

  it("round-trips with parseHex, whatever the input's case", () => {
    expect(toHex(...parseHex("#a1b2c3"))).toBe("#A1B2C3");
    expect(parseHex(toHex(18, 52, 86))).toEqual([18, 52, 86]);
  });
});

describe("shade", () => {
  it("darkens every channel by the factor, rounded", () => {
    expect(shade("#FF8040", 0.5)).toBe("#804020");
    expect(shade("#ff8040", 1)).toBe("#FF8040");
    expect(shade("#FF8040", 0)).toBe("#000000");
  });

  it("clamps a factor that would overflow or go below zero", () => {
    expect(shade("#808080", 3)).toBe("#FFFFFF");
    expect(shade("#808080", -1)).toBe("#000000");
  });

  it("throws on a color that is not #rrggbb", () => {
    expect(() => shade("#fff", 0.5)).toThrow(/#rrggbb/);
  });
});

describe("mix", () => {
  it("moves toward the second color by t, rounded", () => {
    expect(mix("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    expect(mix("#102030", "#ffffff", 0)).toBe("#102030");
    expect(mix("#102030", "#ffffff", 1)).toBe("#FFFFFF");
    expect(mix("#000000", "#0A0A0A", 0.25)).toBe("#030303");
  });

  it("clamps a t outside 0–1 to the channel range", () => {
    expect(mix("#000000", "#808080", 3)).toBe("#FFFFFF");
    expect(mix("#808080", "#FFFFFF", -1)).toBe("#010101");
    expect(mix("#808080", "#000000", -2)).toBe("#FFFFFF");
  });
});

describe("desaturate", () => {
  it("keeps a grey and takes most of the color out of a hue", () => {
    expect(desaturate("#808080")).toBe("#808080");
    // Luma of pure red is 76.5 → 77; 65% of the way there.
    expect(desaturate("#FF0000")).toBe("#8B3232");
    const [r, g, b] = parseHex(desaturate("#3C6FB0"));
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(0.5 * (0xb0 - 0x3c));
  });
});

describe("ghostly", () => {
  it("is the grey washed 55% toward the moon's cream", () => {
    expect(ghostly("#000000")).toBe(mix("#000000", MOON, 0.55));
    expect(ghostly("#000000")).toBe("#807F77");
    expect(ghostly("#FFFFFF")).toBe("#F2F1EA");
  });

  it("forgets the hue: colors of one luma look the same", () => {
    expect(ghostly("#FF0000")).toBe(ghostly("#4D4D4D"));
  });

  it("writes every sprite color as #RRGGBB", () => {
    for (const color of Object.values(SPRITE_CHARS)) expect(ghostly(color)).toMatch(HEX);
  });
});
