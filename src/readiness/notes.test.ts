import { describe, expect, it } from "vitest";
import { fenceKind, groupLaneNotes, noteKey, uniqueTexts, type LaneEntry } from "./notes";

const note = (lane: string, n: number, text: string): LaneEntry => ({
  note: { id: `not_verified:${lane}:${n}`, lane, label: "not verified", text },
});

describe("fenceKind", () => {
  it("classifies the most specific kind first", () => {
    expect(fenceKind("Playwright cannot run in the sandbox: no browser")).toBe("browser");
    expect(fenceKind("no database in the sandbox")).toBe("database");
    expect(fenceKind("the network is blocked")).toBe("network");
    expect(fenceKind("operation not permitted")).toBe("sandbox");
    expect(fenceKind("listen EPERM 0.0.0.0")).toBe("sandbox");
    expect(fenceKind("Docker cannot run here")).toBe("sandbox");
    expect(fenceKind("the networking module is untested")).toBeNull();
    expect(fenceKind("Windows")).toBeNull();
  });
});

describe("noteKey", () => {
  it("lowercases, writes digits as N and collapses spaces", () => {
    expect(noteKey("  Ran 12 tests\non Linux ")).toBe("ran N tests on linux");
    expect(noteKey("ran 400 tests on linux")).toBe(noteKey("Ran 3 tests  on LINUX"));
    expect(noteKey("ran tests on linux")).not.toBe(noteKey("ran 3 tests on linux"));
  });
});

describe("groupLaneNotes", () => {
  it("nothing in, nothing out; report risks pass through in place", () => {
    expect(groupLaneNotes([])).toEqual([]);
    const risk = { id: "report:b", text: "b: the report is missing or not an object" };
    expect(groupLaneNotes([note("a", 1, "Q"), { risk }, note("c", 1, "R")])).toEqual([
      { id: "not_verified:a:1", text: "a (not verified): Q" },
      risk,
      { id: "not_verified:c:1", text: "c (not verified): R" },
    ]);
  });

  it("one item for a note repeated by several lanes, counting lanes, at its first place", () => {
    expect(groupLaneNotes([note("a", 1, "Linux 1"), note("b", 1, "other"), note("b", 2, "linux 22"), note("c", 1, "LINUX 3")])).toEqual([
      { id: "notes:not_verified:a:1", text: "3 lanes: Linux 1" },
      { id: "not_verified:b:1", text: "b (not verified): other" },
    ]);
  });

  it("keeps a lane's own repeated note per note", () => {
    expect(groupLaneNotes([note("a", 1, "Linux 1"), note("a", 2, "linux 2")])).toEqual([
      { id: "not_verified:a:1", text: "a (not verified): Linux 1" },
      { id: "not_verified:a:2", text: "a (not verified): linux 2" },
    ]);
  });

  it("one fence item per kind with up to three distinct examples, long ones cut", () => {
    const long = `sandbox ${"x".repeat(200)}`;
    const [item, ...rest] = groupLaneNotes([note("a", 1, long), note("b", 1, long), note("c", 1, long), note("d", 1, "sandbox")]);
    expect(rest).toEqual([]);
    expect(item).toEqual({
      id: "fence:sandbox",
      text: `Not run inside the fence (4 notes): a: ${long.slice(0, 99)}…; b: ${long.slice(0, 99)}…; c: ${long.slice(0, 99)}…`,
    });
    expect(groupLaneNotes([note("a", 1, "EPERM"), note("a", 2, "EPERM")])).toEqual([
      { id: "fence:sandbox", text: "Not run inside the fence (2 notes): a: EPERM" },
    ]);
  });
});

describe("uniqueTexts", () => {
  it("keeps the first item of each text", () => {
    expect(
      uniqueTexts([
        { id: "a", text: "same" },
        { id: "b", text: "other" },
        { id: "c", text: "same" },
      ]),
    ).toEqual([
      { id: "a", text: "same" },
      { id: "b", text: "other" },
    ]);
  });
});
