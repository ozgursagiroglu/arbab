import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBriefSource, unknownSections } from "./parse";

const LANES = join(import.meta.dirname, "..", "..", "lanes");

describe("parseBriefSource", () => {
  it("reads the title and the known sections, trimmed", () => {
    const source = parseBriefSource("# My lane\n\n## Task\n\n  Do it.  \n\n## Scope\n\nsrc/x/**\n\n## Acceptance\n\n- [ ] done\n");
    expect(source).toEqual({ title: "My lane", sections: { Task: "Do it.", Scope: "src/x/**", Acceptance: "- [ ] done" } });
  });
  it("returns an empty title when there is no # heading", () => {
    expect(parseBriefSource("## Task\n\nx").title).toBe("");
  });
  it("matches section names exactly and case-sensitively", () => {
    const source = parseBriefSource("# T\n## task\nlower\n## Task\nreal\n### Task\nsub");
    expect(source.sections.Task).toBe("real\n### Task\nsub");
    expect(source.sections.Notes).toBe("### task\n\nlower");
  });
  it("appends unknown sections to Notes in document order", () => {
    const source = parseBriefSource("# T\n## Background\nwhy\n## Notes\nnote\n## Empty\n");
    expect(source.sections.Notes).toBe("### Background\n\nwhy\n\nnote\n\n### Empty");
  });
  it("keeps an empty known section as an empty string", () => {
    expect(parseBriefSource("# T\n## Scope\n\n## Task\nx").sections.Scope).toBe("");
  });
  it("ignores headings inside fenced code blocks", () => {
    const md = "# T\n## Task\n```md\n# Not a title\n## Scope\n```\n~~~\n## Acceptance\n~~~\n";
    const source = parseBriefSource(md);
    expect(source.title).toBe("T");
    expect(Object.keys(source.sections)).toEqual(["Task"]);
    expect(source.sections.Task).toContain("## Scope");
  });
  it("takes the first # heading only and drops text before the first section", () => {
    const source = parseBriefSource("preamble\n# First\n# Second\n## Task\n# Third\nx");
    expect(source.title).toBe("First");
    expect(source.sections.Task).toBe("# Third\nx");
  });
  it("joins a repeated section", () => {
    expect(parseBriefSource("## Facts\na\n## Facts\nb").sections.Facts).toBe("a\n\nb");
  });

  const laneFiles = readdirSync(LANES).filter((f) => /^m1-.*\.md$/.test(f));
  it("finds this repository's lane files", () => {
    expect(laneFiles.length).toBeGreaterThan(0);
  });
  it.each(laneFiles)("parses lanes/%s", (file) => {
    const md = readFileSync(join(LANES, file), "utf8");
    const source = parseBriefSource(md);
    // Every brief of this repository's own build parses with a title and the three required sections.
    expect(source.title).not.toBe("");
    expect(source.sections.Task).toBeTruthy();
    expect(source.sections.Scope).toBeTruthy();
    expect(source.sections.Acceptance).toBeTruthy();
    expect(unknownSections(md)).toEqual([]);
  });
});

describe("unknownSections", () => {
  it("lists unknown ## names, not ### or fenced ones", () => {
    expect(unknownSections("## Task\n## Background\n### Sub\n```\n## Fenced\n```\n## Other ##\n")).toEqual(["Background", "Other"]);
  });
  it("is empty for a brief with known sections only", () => {
    expect(unknownSections("## Task\n## Notes\n")).toEqual([]);
  });
});
