import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReviewFinding, ReviewRecord } from "../types";
import { keepOtherLenses, reviewRoundPath, reviewRounds, writeReviewRound } from "./history";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arbab-history-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const HEAD = "c".repeat(40);

const finding = (lens: string, n: number, verdict: ReviewFinding["verdict"] = "unverified"): ReviewFinding => ({
  id: `${lens}-${n}`,
  lens,
  title: `${lens} ${n}`,
  severity: "HIGH",
  file: "a.ts",
  failureScenario: "s",
  evidence: "e",
  verdict,
});

const record = (lenses: string[], extra: Partial<ReviewRecord> = {}): ReviewRecord => ({
  name: "rel",
  headSha: HEAD,
  lenses: lenses.map((lens) => ({ lens, lane: `rel-review-${lens}`, endState: "success", coverage: "all", pathsChecked: 1 })),
  skeptics: lenses.map((lens) => ({ lens, lane: `rel-skeptic-${lens}`, endState: "success" })),
  findings: lenses.map((lens) => finding(lens, 1)),
  finishedAt: "2026-10-09T12:00:00.000Z",
  ...extra,
});

describe("reviewRoundPath and reviewRounds", () => {
  it("lists the rounds on disk in numeric order, skipping other files, and none before the first", () => {
    expect(reviewRounds(dir)).toEqual([]);
    mkdirSync(join(dir, "reviews"));
    for (const file of ["10.json", "2.json", "1.json", "0.json", "01.json", "x.json", "3.json.tmp", ".abc.tmp"]) writeFileSync(join(dir, "reviews", file), "{}");
    expect(reviewRounds(dir)).toEqual([1, 2, 10]);
    expect(reviewRoundPath(dir, 3)).toBe(join(dir, "reviews", "3.json"));
    expect(() => reviewRoundPath(dir, 0)).toThrow(/not a positive integer/);
    expect(() => reviewRoundPath(dir, 1.5)).toThrow(/not a positive integer/);
  });
});

describe("writeReviewRound", () => {
  it("writes round 1, then 1 + the highest round, and returns the record with its round", () => {
    const first = writeReviewRound(dir, record(["security"]));
    expect(first.round).toBe(1);
    expect(JSON.parse(readFileSync(join(dir, "reviews", "1.json"), "utf8"))).toEqual(first);
    writeFileSync(join(dir, "reviews", "7.json"), "{}");
    expect(writeReviewRound(dir, record(["security"])).round).toBe(8);
    expect(reviewRounds(dir)).toEqual([1, 7, 8]);
  });

  it("ignores a round the record carries already", () => {
    expect(writeReviewRound(dir, record(["security"], { round: 5 })).round).toBe(1);
  });
});

describe("keepOtherLenses", () => {
  it("keeps the previous lenses not run now, with their skeptics and verdicts, in the previous order", () => {
    const previous = record(["correctness", "security", "contracts"], {
      findings: [finding("correctness", 1, "confirmed"), finding("security", 1, "refuted"), finding("contracts", 1, "confirmed"), finding("contracts", 2)],
    });
    const current = record(["security", "perf"], { findings: [finding("perf", 1), finding("security", 1)] });
    const merged = keepOtherLenses(previous, current, ["security", "perf"]);
    expect(merged.lenses.map((l) => l.lens)).toEqual(["correctness", "security", "contracts", "perf"]);
    expect(merged.skeptics.map((s) => s.lens)).toEqual(["correctness", "security", "contracts", "perf"]);
    expect(merged.findings.map((f) => [f.id, f.verdict])).toEqual([
      ["correctness-1", "confirmed"],
      ["security-1", "unverified"],
      ["contracts-1", "confirmed"],
      ["contracts-2", "unverified"],
      ["perf-1", "unverified"],
    ]);
    expect(merged.finishedAt).toBe(current.finishedAt);
    // A re-run lens's earlier skeptic is dropped with its findings when it has none now.
    const noSkeptic = keepOtherLenses(previous, { ...current, skeptics: [] }, ["security", "perf"]);
    expect(noSkeptic.skeptics.map((s) => s.lens)).toEqual(["correctness", "contracts"]);
  });

  it("keeps nothing from another head or without a previous record", () => {
    const current = record(["security"]);
    expect(keepOtherLenses(record(["correctness"], { headSha: "d".repeat(40) }), current, ["security"])).toBe(current);
    expect(keepOtherLenses(null, current, ["security"])).toBe(current);
  });
});
