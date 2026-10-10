import { describe, expect, it } from "vitest";
import { DEFAULT_SCHEMAS, validate } from "../report";
import type { ReviewFinding } from "../types";
import { applyVerdicts, collectFindings, reviewerCoverage, reviewRecord } from "./findings";

const good = {
  title: "Lost lane",
  severity: "HIGH",
  file: "src/run/x.ts",
  line: 12,
  failure_scenario: "A crash between the two writes loses the lane.",
  evidence: "x.ts:12 writes state before the report.",
  suggested_fix: "Write the report first.",
};

function finding(over: Partial<ReviewFinding> & Pick<ReviewFinding, "id" | "severity">): ReviewFinding {
  return {
    lens: "correctness",
    title: "t",
    file: "f.ts",
    failureScenario: "s",
    evidence: "e",
    verdict: "unverified",
    ...over,
  };
}

describe("collectFindings", () => {
  it("parses a report that matches the default reviewer schema", () => {
    const report = { findings: [good], coverage: "Read everything.", paths_checked: ["src/run/x.ts"] };
    expect(validate(DEFAULT_SCHEMAS.reviewer, report)).toEqual([]);
    expect(collectFindings([{ lens: "correctness", report }])).toEqual([
      {
        id: "correctness-1",
        lens: "correctness",
        title: "Lost lane",
        severity: "HIGH",
        file: "src/run/x.ts",
        line: 12,
        failureScenario: "A crash between the two writes loses the lane.",
        evidence: "x.ts:12 writes state before the report.",
        suggestedFix: "Write the report first.",
        verdict: "unverified",
      },
    ]);
  });

  it("leaves out the optional line and suggested fix when absent", () => {
    const { line: _line, suggested_fix: _fix, ...bare } = good;
    const [f] = collectFindings([{ lens: "security", report: { findings: [{ ...bare, suggested_fix: "" }] } }]);
    expect(f).toBeDefined();
    expect(f).not.toHaveProperty("line");
    expect(f).not.toHaveProperty("suggestedFix");
  });

  it("skips malformed findings and numbers the rest from 1 per lens, in report order", () => {
    const malformed: unknown[] = [
      null,
      "a string",
      [good],
      { ...good, title: "" },
      { ...good, title: 3 },
      { ...good, severity: "CRITICAL" },
      { ...good, severity: "high" },
      { ...good, file: undefined },
      { ...good, failure_scenario: "   " },
      { ...good, evidence: null },
    ];
    const findings = collectFindings([
      { lens: "correctness", report: { findings: [...malformed, { ...good, title: "A" }, { ...good, title: "B", severity: "LOW" }] } },
      { lens: "security", report: { findings: [{ ...good, title: "C" }] } },
      { lens: "correctness", report: { findings: [{ ...good, title: "D", severity: "MEDIUM" }] } },
    ]);
    expect(findings.map((f) => [f.id, f.title])).toEqual([
      ["correctness-1", "A"],
      ["correctness-2", "B"],
      ["security-1", "C"],
      ["correctness-3", "D"],
    ]);
    expect(findings.every((f) => f.verdict === "unverified")).toBe(true);
  });

  it("keeps a finding whose optional line or suggested fix is malformed, without them", () => {
    const findings = collectFindings([
      {
        lens: "security",
        report: { findings: [{ ...good, line: 0 }, { ...good, line: 1.5 }, { ...good, line: "12" }, { ...good, suggested_fix: 1 }] },
      },
    ]);
    expect(findings.map((f) => f.id)).toEqual(["security-1", "security-2", "security-3", "security-4"]);
    expect(findings.slice(0, 3).every((f) => f.line === undefined)).toBe(true);
    expect(findings[3]?.suggestedFix).toBeUndefined();
  });

  it("skips reports that are not reviewer reports", () => {
    expect(
      collectFindings([
        { lens: "correctness", report: null },
        { lens: "correctness", report: "text" },
        { lens: "correctness", report: [good] },
        { lens: "correctness", report: { findings: "none" } },
        { lens: "correctness", report: {} },
      ]),
    ).toEqual([]);
  });

  it("returns no findings for no reports", () => {
    expect(collectFindings([])).toEqual([]);
  });
});

describe("reviewerCoverage", () => {
  it("reads coverage and counts distinct paths read in full", () => {
    expect(reviewerCoverage({ findings: [], coverage: "All of src/run.", paths_checked: ["a.ts", "b.ts", "a.ts", "", 3] })).toEqual({
      coverage: "All of src/run.",
      pathsChecked: 2,
    });
  });

  it("returns nothing for a missing or malformed report", () => {
    expect(reviewerCoverage(null)).toEqual({ coverage: null, pathsChecked: 0 });
    expect(reviewerCoverage({ coverage: 1, paths_checked: "a.ts" })).toEqual({ coverage: null, pathsChecked: 0 });
    expect(reviewerCoverage({ coverage: " " })).toEqual({ coverage: null, pathsChecked: 0 });
  });
});

describe("applyVerdicts", () => {
  const findings: ReviewFinding[] = [
    finding({ id: "correctness-1", severity: "HIGH" }),
    finding({ id: "correctness-2", severity: "MEDIUM" }),
    finding({ id: "correctness-3", severity: "MEDIUM" }),
    finding({ id: "correctness-4", severity: "HIGH" }),
    finding({ id: "correctness-5", severity: "LOW" }),
  ];
  const verdict = (id: string, refuted: boolean, corrected_severity: string, reasoning = `why ${id}`): unknown => ({
    id,
    refuted,
    corrected_severity,
    reasoning,
  });

  it("refutes on refuted: true, whatever the severity", () => {
    const [f] = applyVerdicts(findings, { verdicts: [verdict("correctness-1", true, "HIGH")] });
    expect(f).toMatchObject({ id: "correctness-1", severity: "HIGH", verdict: "refuted", verdictReason: "why correctness-1" });
  });

  it("refutes on a corrected severity of NONE", () => {
    const out = applyVerdicts(findings, { verdicts: [verdict("correctness-2", false, "NONE")] });
    expect(out[1]).toMatchObject({ severity: "MEDIUM", verdict: "refuted", verdictReason: "why correctness-2" });
  });

  it("confirms with the corrected severity otherwise", () => {
    const out = applyVerdicts(findings, {
      verdicts: [verdict("correctness-1", false, "HIGH"), verdict("correctness-2", false, "LOW"), verdict("correctness-3", false, "HIGH")],
    });
    expect(out.slice(0, 3).map((f) => [f.severity, f.verdict, f.verdictReason])).toEqual([
      ["HIGH", "confirmed", "why correctness-1"],
      ["LOW", "confirmed", "why correctness-2"],
      ["HIGH", "confirmed", "why correctness-3"],
    ]);
  });

  it("leaves findings without a verdict unverified and ignores unknown ids", () => {
    const out = applyVerdicts(findings, { verdicts: [verdict("correctness-9", true, "NONE"), verdict("security-1", true, "NONE")] });
    expect(out).toEqual(findings);
  });

  it("leaves LOW findings unverified: no skeptic was asked about them", () => {
    const out = applyVerdicts(findings, { verdicts: [verdict("correctness-5", true, "NONE")] });
    expect(out[4]).toEqual(findings[4]);
  });

  it("ignores malformed verdicts and malformed reports", () => {
    const malformed = [
      null,
      "correctness-1",
      { id: "correctness-1", refuted: "yes", corrected_severity: "HIGH", reasoning: "r" },
      { id: "correctness-1", refuted: true, corrected_severity: "CRITICAL", reasoning: "r" },
      { id: "correctness-1", refuted: true, corrected_severity: "HIGH" },
      { id: 1, refuted: true, corrected_severity: "HIGH", reasoning: "r" },
    ];
    expect(applyVerdicts(findings, { verdicts: malformed })).toEqual(findings);
    for (const report of [null, "x", 3, {}, { verdicts: "all refuted" }]) expect(applyVerdicts(findings, report)).toEqual(findings);
  });

  it("accepts the verdicts array itself", () => {
    expect(applyVerdicts(findings, [verdict("correctness-4", false, "MEDIUM")])[3]).toMatchObject({
      severity: "MEDIUM",
      verdict: "confirmed",
    });
  });

  it("keeps the first verdict for an id given twice", () => {
    const out = applyVerdicts(findings, { verdicts: [verdict("correctness-1", true, "NONE", "first"), verdict("correctness-1", false, "HIGH", "second")] });
    expect(out[0]).toMatchObject({ verdict: "refuted", verdictReason: "first" });
  });

  it("does not mutate its input", () => {
    const copy = structuredClone(findings);
    applyVerdicts(findings, { verdicts: [verdict("correctness-1", true, "NONE")] });
    expect(findings).toEqual(copy);
  });
});

describe("reviewRecord", () => {
  it("assembles review.json with an ISO finish time", () => {
    const findings = [finding({ id: "correctness-1", severity: "HIGH", verdict: "confirmed", verdictReason: "r" })];
    const lenses = [{ lens: "correctness", lane: "m3-review-correctness", endState: "success" as const, coverage: "c", pathsChecked: 4 }];
    const skeptics = [{ lens: "correctness", lane: "m3-skeptic-correctness", endState: null }];
    const record = reviewRecord({ name: "m3", headSha: "abc123", lenses, skeptics, findings, now: Date.UTC(2026, 9, 9, 12) });
    expect(record).toEqual({ name: "m3", headSha: "abc123", lenses, skeptics, findings, finishedAt: "2026-10-09T12:00:00.000Z" });
    expect(record.findings[0]).not.toBe(findings[0]);
  });
});
