import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReadinessReport, ReviewRecord } from "../types";
import { readReadinessReport, readReviewHistory, readReviewRecord, readVerifyRecord } from "./records";
import { passedVerify } from "./testkit";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arbab-records-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const file = (value: unknown): string => {
  const path = join(dir, "r.json");
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
  return path;
};

const review: ReviewRecord = {
  name: "rel",
  headSha: "c".repeat(40),
  lenses: [{ lens: "security", lane: "rel-review-security", endState: "success", coverage: "all", pathsChecked: 2 }],
  skeptics: [{ lens: "security", lane: "rel-skeptic-security", endState: null }],
  findings: [
    { id: "security-1", lens: "security", title: "t", severity: "HIGH", file: "a.ts", line: 3, failureScenario: "s", evidence: "e", verdict: "confirmed" },
  ],
  finishedAt: "2026-10-09T12:00:00.000Z",
};

const readiness: ReadinessReport = {
  name: "rel",
  tier: "low",
  headSha: "c".repeat(40),
  verified: [{ id: "verify:pnpm test", text: "gate: exit 0" }],
  skipped: [{ id: "review", text: "no review", waived: true }],
  risks: [],
  ready: true,
  createdAt: "2026-10-09T12:00:00.000Z",
};

describe("readVerifyRecord", () => {
  it("reads a record, null when missing, and refuses a damaged one or another integration's", () => {
    expect(readVerifyRecord(join(dir, "none.json"), "rel")).toBeNull();
    expect(readVerifyRecord(file(passedVerify("c".repeat(40))), "rel")?.passed).toBe(true);
    expect(() => readVerifyRecord(file(passedVerify("c".repeat(40))), "other")).toThrow(/not a verify record for other/);
    expect(() => readVerifyRecord(file({ ...passedVerify("c"), results: [{ kind: "lint" }] }), "rel")).toThrow(/not a verify record/);
    expect(() => readVerifyRecord(file("{"), "rel")).toThrow();
  });

  it("reads a reason, and refuses one that is not a string", () => {
    const failed = { ...passedVerify("c".repeat(40)), passed: false, reason: "the lane left changes behind" };
    expect(readVerifyRecord(file(failed), "rel")?.reason).toBe("the lane left changes behind");
    expect(() => readVerifyRecord(file({ ...failed, reason: 7 }), "rel")).toThrow(/not a verify record/);
  });
});

describe("readReviewRecord", () => {
  it("reads a record and refuses a finding with an unknown verdict or severity", () => {
    expect(readReviewRecord(file(review), "rel")?.findings).toHaveLength(1);
    const bad = (finding: Record<string, unknown>): string => file({ ...review, findings: [{ ...review.findings[0], ...finding }] });
    expect(() => readReviewRecord(bad({ verdict: "maybe" }), "rel")).toThrow(/not a review record/);
    expect(() => readReviewRecord(bad({ severity: "CRITICAL" }), "rel")).toThrow(/not a review record/);
    expect(() => readReviewRecord(bad({ line: "3" }), "rel")).toThrow(/not a review record/);
    expect(() => readReviewRecord(file([review]), "rel")).toThrow(/not a review record/);
  });

  it("reads round and since when present, as a record from before them, and refuses ones that do not fit", () => {
    expect(readReviewRecord(file(review), "rel")).not.toHaveProperty("round");
    expect(readReviewRecord(file({ ...review, round: 2, since: "d".repeat(40) }), "rel")).toMatchObject({ round: 2, since: "d".repeat(40) });
    expect(readReviewRecord(file({ ...review, round: 1, since: null }), "rel")?.since).toBeNull();
    for (const bad of [{ round: 0 }, { round: 1.5 }, { round: "1" }, { since: 7 }]) {
      expect(() => readReviewRecord(file({ ...review, ...bad }), "rel")).toThrow(/not a review record/);
    }
  });
});

describe("readReviewHistory", () => {
  const integrationDir = (): string => join(dir, "rel");
  const round = (n: number, value: unknown): void => {
    mkdirSync(join(integrationDir(), "reviews"), { recursive: true });
    writeFileSync(join(integrationDir(), "reviews", `${n}.json`), JSON.stringify(value));
  };

  it("reads every round by round, and nothing before the first", () => {
    expect(readReviewHistory(integrationDir())).toEqual([]);
    round(2, { ...review, round: 2, headSha: "d".repeat(40) });
    round(1, { ...review, round: 1 });
    round(10, { ...review, round: 10 });
    writeFileSync(join(integrationDir(), "reviews", "notes.txt"), "not a round");
    expect(readReviewHistory(integrationDir()).map((r) => [r.round, r.headSha])).toEqual([
      [1, "c".repeat(40)],
      [2, "d".repeat(40)],
      [10, "c".repeat(40)],
    ]);
  });

  it("refuses a round file of another round, another integration or no record", () => {
    round(1, { ...review, round: 2 });
    expect(() => readReviewHistory(integrationDir())).toThrow(/is not the review record of round 1/);
    round(1, { ...review, round: 1, name: "other" });
    expect(() => readReviewHistory(integrationDir())).toThrow(/not a review record for rel/);
    round(1, review);
    expect(() => readReviewHistory(integrationDir())).toThrow(/is not the review record of round 1/);
  });
});

describe("readReadinessReport", () => {
  it("reads a report and refuses an unknown tier or a skipped item without its waiver flag", () => {
    expect(readReadinessReport(file(readiness), "rel")?.ready).toBe(true);
    expect(readReadinessReport(file("null"), "rel")).toBeNull();
    expect(() => readReadinessReport(file({ ...readiness, tier: "max" }), "rel")).toThrow(/not a readiness report/);
    expect(() => readReadinessReport(file({ ...readiness, skipped: [{ id: "x", text: "y" }] }), "rel")).toThrow(/not a readiness report/);
    expect(() => readReadinessReport(file({ ...readiness, ready: "yes" }), "rel")).toThrow(/not a readiness report/);
  });
});
