import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ReadinessReport, ReviewRecord } from "../types";
import { readReadinessReport, readReviewRecord, readVerifyRecord } from "./records";
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
