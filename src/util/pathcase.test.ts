import { describe, expect, it } from "vitest";
import { foldPath, sameOrInside } from "./pathcase";

describe("foldPath", () => {
  it("folds what APFS folds", () => {
    // ſ (U+017F) is s; toLowerCase alone keeps it.
    expect(foldPath(".arbab/integrationſ")).toBe(".arbab/integrations");
    // The Kelvin sign (U+212A) is K.
    expect(foldPath("Key")).toBe("key");
    expect(foldPath("Key")).toBe(foldPath("KEY"));
    // NFC and NFD é are one name.
    expect(foldPath("café")).toBe(foldPath("café"));
    expect(foldPath("CAFÉ")).toBe(foldPath("café"));
    expect(foldPath("straße")).toBe("strasse");
    expect(foldPath("/Work/.ARBAB/WorkTrees")).toBe("/work/.arbab/worktrees");
  });

  it("leaves separators and plain lower-case names alone", () => {
    expect(foldPath("/a/b/c.txt")).toBe("/a/b/c.txt");
    expect(foldPath("")).toBe("");
  });
});

describe("sameOrInside", () => {
  it("is true for the path itself and what lies inside it, whatever the spelling", () => {
    expect(sameOrInside("/a/b", "/a/b")).toBe(true);
    expect(sameOrInside("/a/b", "/a/b/c/d")).toBe(true);
    expect(sameOrInside("/A/B", "/a/b/c")).toBe(true);
    expect(sameOrInside("/a/b", "/A/B/C")).toBe(true);
    expect(sameOrInside("/a/.arbab/integrations", "/a/.ARBAB/integrationſ/x")).toBe(true);
    expect(sameOrInside("/a/café", "/a/café/x")).toBe(true);
    expect(sameOrInside("/a/straße", "/a/STRASSE/x")).toBe(true);
  });

  it("ignores a trailing separator on either side", () => {
    expect(sameOrInside("/a/b/", "/a/b")).toBe(true);
    expect(sameOrInside("/a/b", "/a/b/")).toBe(true);
    expect(sameOrInside("/a/b/", "/a/b/c")).toBe(true);
  });

  it("stops at a separator boundary", () => {
    expect(sameOrInside("/a/bc", "/a/b")).toBe(false);
    expect(sameOrInside("/a/b", "/a/bc")).toBe(false);
    expect(sameOrInside("/a/b", "/a/b-old/c")).toBe(false);
  });

  it("is false for a parent, a sibling or an unrelated path", () => {
    expect(sameOrInside("/a/b", "/a")).toBe(false);
    expect(sameOrInside("/a/b", "/a/c")).toBe(false);
    expect(sameOrInside("/a/b", "/x/y")).toBe(false);
    expect(sameOrInside("/", "/a")).toBe(true);
  });

  it("takes a name starting with two dots as inside", () => {
    expect(sameOrInside("/a", "/a/..b")).toBe(true);
  });
});
