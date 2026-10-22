import { describe, expect, it } from "vitest";
import { BUILTIN_LENSES, MAX_LENS_FILE_TEXT, lensFileText, lensNames, lensText, parseLensFileOption } from "./lenses";

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

describe("parseLensFileOption", () => {
  it("splits <name>=<file> at the first =", () => {
    expect(parseLensFileOption("perf=lenses/perf.md")).toEqual({ name: "perf", file: "lenses/perf.md" });
    expect(parseLensFileOption("a-1=/abs/x=y.md")).toEqual({ name: "a-1", file: "/abs/x=y.md" });
  });

  it("refuses a missing name or file, and a name that cannot be part of a lane name", () => {
    for (const bad of ["perf", "=x.md", "perf=", ""]) expect(() => parseLensFileOption(bad)).toThrow(/must be <name>=<file>/);
    expect(() => parseLensFileOption("Perf=x.md")).toThrow(expect.objectContaining({ code: "usage", message: expect.stringMatching(/^lens "Perf" must match/) }));
    expect(() => parseLensFileOption("a_b=x.md")).toThrow(/must match/);
  });
});

describe("lensFileText", () => {
  it("takes 1 to 8,000 characters, trimmed", () => {
    expect(lensFileText("perf", "\n  Hot paths.\n")).toBe("Hot paths.");
    expect(lensFileText("perf", "x".repeat(MAX_LENS_FILE_TEXT))).toHaveLength(8_000);
    expect(() => lensFileText("perf", " \n\t")).toThrow("the file of lens perf has 0 characters; a lens text has 1 to 8000");
    expect(() => lensFileText("perf", "x".repeat(8_001))).toThrow(expect.objectContaining({ code: "usage", message: expect.stringMatching(/has 8001 characters/) }));
  });
});
