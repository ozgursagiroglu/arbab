import { describe, expect, it } from "vitest";
import { inlineCodeSpans, scanLines } from "./markdown";

describe("scanLines", () => {
  it("marks fenced lines, delimiters and the info word", () => {
    const lines = scanLines("a\n```sh extra\nb\n```\nc");
    expect(lines.map((l) => [l.inFence, l.delimiter, l.info])).toEqual([
      [false, false, null],
      [true, true, "sh"],
      [true, false, "sh"],
      [true, true, "sh"],
      [false, false, null],
    ]);
  });
  it("closes a fence only with the same character and at least the same length", () => {
    const lines = scanLines("````\n```\n~~~~\n````\nafter");
    expect(lines.map((l) => l.inFence)).toEqual([true, true, true, true, false]);
  });
  it("handles tilde fences, CRLF and unterminated fences", () => {
    expect(scanLines("~~~\r\nx\r\n~~~\r\ny").map((l) => l.inFence)).toEqual([true, true, true, false]);
    expect(scanLines("```\nnever closed").map((l) => l.inFence)).toEqual([true, true]);
  });
  it("does not treat a backtick line with a backtick in its info string as a fence", () => {
    expect(scanLines("``` a ` b\nx").map((l) => l.inFence)).toEqual([false, false]);
  });
});

describe("inlineCodeSpans", () => {
  it("returns span contents", () => {
    expect(inlineCodeSpans("run `pnpm test` then `git status`")).toEqual(["pnpm test", "git status"]);
  });
  it("matches runs of equal length, so double-backtick spans can hold a backtick", () => {
    expect(inlineCodeSpans("x `` a ` b `` y")).toEqual([" a ` b "]);
  });
  it("ignores an unmatched run", () => {
    expect(inlineCodeSpans("a ` b")).toEqual([]);
    expect(inlineCodeSpans("a `` b `c`")).toEqual(["c"]);
  });
});
