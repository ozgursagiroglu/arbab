import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findTranscript, measuredEffort } from "./transcript";

const SID = "3f0be056-3590-47bb-9add-97bf3226e46d";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arbab-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("findTranscript", () => {
  it("finds the session file in a direct subdirectory", () => {
    mkdirSync(join(dir, "-work-a"));
    mkdirSync(join(dir, "-work-b"));
    writeFileSync(join(dir, "-work-b", `${SID}.jsonl`), "{}\n");
    expect(findTranscript(dir, SID)).toBe(join(dir, "-work-b", `${SID}.jsonl`));
  });

  it("returns the first match in name order", () => {
    for (const d of ["-z", "-a"]) {
      mkdirSync(join(dir, d));
      writeFileSync(join(dir, d, `${SID}.jsonl`), "");
    }
    expect(findTranscript(dir, SID)).toBe(join(dir, "-a", `${SID}.jsonl`));
  });

  it("does not look at the top level, deeper levels or directories named like the file", () => {
    writeFileSync(join(dir, `${SID}.jsonl`), "");
    mkdirSync(join(dir, "-p", "deep"), { recursive: true });
    writeFileSync(join(dir, "-p", "deep", `${SID}.jsonl`), "");
    mkdirSync(join(dir, "-q", `${SID}.jsonl`), { recursive: true });
    expect(findTranscript(dir, SID)).toBeNull();
  });

  it("returns null when nothing matches or the directory is missing", () => {
    mkdirSync(join(dir, "-p"));
    expect(findTranscript(dir, SID)).toBeNull();
    expect(findTranscript(join(dir, "missing"), SID)).toBeNull();
    writeFileSync(join(dir, "file"), "");
    expect(findTranscript(join(dir, "file"), SID)).toBeNull();
  });

  it("refuses session ids that are not UUIDs, even when such a file exists", () => {
    mkdirSync(join(dir, "-p"));
    writeFileSync(join(dir, "-p", "not-a-uuid.jsonl"), "");
    writeFileSync(join(dir, "secret.jsonl"), "");
    for (const bad of ["not-a-uuid", "", "../secret", `${SID}/../x`, `${SID}x`, `x${SID}`, `${SID}\n`]) {
      expect(findTranscript(dir, bad)).toBeNull();
    }
  });

  it("accepts upper-case UUIDs", () => {
    const upper = SID.toUpperCase();
    mkdirSync(join(dir, "-p"));
    writeFileSync(join(dir, "-p", `${upper}.jsonl`), "");
    expect(findTranscript(dir, upper)).toBe(join(dir, "-p", `${upper}.jsonl`));
  });
});

describe("measuredEffort", () => {
  it("counts the effort of assistant entries only", () => {
    const text = [
      { type: "user", effort: "high" },
      { type: "assistant", effort: "high" },
      { type: "assistant", effort: "high" },
      { type: "assistant", effort: "medium" },
      { type: "assistant" },
      { type: "assistant", effort: 3 },
      { type: "assistant", effort: "" },
    ]
      .map((e) => JSON.stringify(e))
      .join("\n");
    expect(measuredEffort(text)).toEqual({ high: 2, medium: 1 });
  });

  it("skips unparsable lines and non-object values", () => {
    expect(measuredEffort('{"type":"assistant","effort":"low"}\n{"type":"assis\nnull\n[1]\n"x"\n')).toEqual({ low: 1 });
  });

  it("returns an empty count for an empty transcript", () => {
    expect(measuredEffort("")).toEqual({});
  });
});
