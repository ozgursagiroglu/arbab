import { describe, expect, it } from "vitest";
import { HEADCLOTH } from "../palette";
import { CHIPS } from "./tokens";

describe("CHIPS", () => {
  it("is each cast's headcloth color, lower-cased like the other tokens", () => {
    expect(Object.keys(CHIPS)).toEqual(Object.keys(HEADCLOTH));
    for (const [cast, color] of Object.entries(HEADCLOTH)) expect(CHIPS[cast as keyof typeof CHIPS]).toBe(color.toLowerCase());
    expect(CHIPS).toEqual({
      laborer: "#c9a46b",
      mason: "#3c6fb0",
      scribe: "#6e4c9e",
      skeptic: "#b23a3a",
      surveyor: "#3f8f5a",
      waterboy: "#e2b23a",
      scout: "#2f6b4f",
    });
  });
});
