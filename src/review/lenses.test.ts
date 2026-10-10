import { describe, expect, it } from "vitest";
import { BUILTIN_LENSES, lensNames, lensText } from "./lenses";

describe("BUILTIN_LENSES", () => {
  it("has the three built-in lenses with what each looks for", () => {
    expect(Object.keys(BUILTIN_LENSES)).toEqual(["correctness", "security", "contracts"]);
    expect(BUILTIN_LENSES.correctness).toMatch(/resource leaks/);
    expect(BUILTIN_LENSES.security).toMatch(/path traversal/);
    expect(BUILTIN_LENSES.contracts).toMatch(/DESIGN\.md/);
    expect(Object.isFrozen(BUILTIN_LENSES)).toBe(true);
  });
});

describe("lensNames", () => {
  it("lists the built-ins when config has no lenses", () => {
    expect(lensNames({})).toEqual(["correctness", "security", "contracts"]);
  });

  it("appends config lenses after the built-ins, in config order", () => {
    expect(lensNames({ perf: "Hot paths.", docs: "Stale docs." })).toEqual(["correctness", "security", "contracts", "perf", "docs"]);
  });

  it("does not repeat a config lens that replaces a built-in", () => {
    expect(lensNames({ security: "Ours.", perf: "Hot paths." })).toEqual(["correctness", "security", "contracts", "perf"]);
  });
});

describe("lensText", () => {
  it("returns the built-in text", () => {
    expect(lensText("correctness", {})).toBe(BUILTIN_LENSES.correctness);
  });

  it("lets a config lens replace a built-in's text", () => {
    expect(lensText("security", { security: "Only secrets." })).toBe("Only secrets.");
  });

  it("returns a config lens's text", () => {
    expect(lensText("perf", { perf: "Hot paths." })).toBe("Hot paths.");
  });

  it("returns null for an unknown lens, inherited keys included", () => {
    expect(lensText("perf", {})).toBeNull();
    expect(lensText("toString", {})).toBeNull();
  });
});
