import { isRecord } from "../stream/json";
import type { ReviewFinding, ReviewRecord } from "../types";

// Reviewer and skeptic reports are worker output: every field is checked, and what does not fit is skipped.

type Severity = ReviewFinding["severity"];
const SEVERITIES: readonly Severity[] = ["HIGH", "MEDIUM", "LOW"];


function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function severity(v: unknown): Severity | null {
  return SEVERITIES.includes(v as Severity) ? (v as Severity) : null;
}

function parseFinding(lens: string, raw: unknown): Omit<ReviewFinding, "id"> | null {
  if (!isRecord(raw)) return null;
  const title = text(raw.title);
  const sev = severity(raw.severity);
  const file = text(raw.file);
  const failureScenario = text(raw.failure_scenario);
  const evidence = text(raw.evidence);
  if (title === null || sev === null || file === null || failureScenario === null || evidence === null) return null;

  const finding: Omit<ReviewFinding, "id"> = { lens, title, severity: sev, file, failureScenario, evidence, verdict: "unverified" };
  // The optional fields only locate or suggest: a malformed one is left out, never the finding, which would otherwise
  // vanish from review.json, the skeptic pass and readiness (a file-level finding may well say line 0).
  if (Number.isInteger(raw.line) && (raw.line as number) >= 1) finding.line = raw.line as number;
  if (text(raw.suggested_fix) !== null) finding.suggestedFix = raw.suggested_fix as string;
  return finding;
}

/**
 * The findings of reviewer reports (the default reviewer schema), unverified. Malformed findings are skipped; ids are
 * `<lens>-<n>`, numbered from 1 over a lens's kept findings in report order.
 */
export function collectFindings(reports: Array<{ lens: string; report: unknown }>): ReviewFinding[] {
  const out: ReviewFinding[] = [];
  const counts = new Map<string, number>();
  for (const { lens, report } of reports) {
    if (!isRecord(report) || !Array.isArray(report.findings)) continue;
    for (const raw of report.findings) {
      const finding = parseFinding(lens, raw);
      if (finding === null) continue;
      const n = (counts.get(lens) ?? 0) + 1;
      counts.set(lens, n);
      out.push({ id: `${lens}-${n}`, ...finding });
    }
  }
  return out;
}

/** What a reviewer report says about its own depth: its coverage text and how many files it read in full. */
export function reviewerCoverage(report: unknown): { coverage: string | null; pathsChecked: number } {
  if (!isRecord(report)) return { coverage: null, pathsChecked: 0 };
  const paths = Array.isArray(report.paths_checked) ? report.paths_checked.filter((p) => text(p) !== null) : [];
  return { coverage: text(report.coverage), pathsChecked: new Set(paths).size };
}

interface Verdict {
  refuted: boolean;
  severity: Severity | "NONE";
  reasoning: string;
}

function parseVerdicts(raw: unknown): Map<string, Verdict> {
  const list = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.verdicts) ? raw.verdicts : [];
  const out = new Map<string, Verdict>();
  for (const v of list) {
    if (!isRecord(v) || typeof v.id !== "string" || typeof v.refuted !== "boolean" || typeof v.reasoning !== "string") {
      continue;
    }
    const sev = v.corrected_severity === "NONE" ? "NONE" : severity(v.corrected_severity);
    if (sev === null) continue;
    // A skeptic that answers one id twice does not get to overrule itself.
    if (!out.has(v.id)) out.set(v.id, { refuted: v.refuted, severity: sev, reasoning: v.reasoning });
  }
  return out;
}

/**
 * Applies a skeptic report (`{verdicts: […]}`, or the array itself) to the findings. A refutation or a corrected
 * severity of NONE refutes; any other verdict confirms with the corrected severity. Findings without a verdict, and
 * LOW findings (no skeptic is asked about them), keep their verdict; verdicts for unknown ids are ignored.
 */
export function applyVerdicts(findings: ReviewFinding[], verdicts: unknown): ReviewFinding[] {
  const byId = parseVerdicts(verdicts);
  return findings.map((f) => {
    const v = byId.get(f.id);
    if (v === undefined || f.severity === "LOW") return { ...f };
    if (v.refuted || v.severity === "NONE") return { ...f, verdict: "refuted", verdictReason: v.reasoning };
    return { ...f, severity: v.severity, verdict: "confirmed", verdictReason: v.reasoning };
  });
}

export function reviewRecord(input: {
  name: string;
  headSha: string;
  lenses: ReviewRecord["lenses"];
  skeptics: ReviewRecord["skeptics"];
  findings: ReviewFinding[];
  /** Epoch milliseconds. */
  now: number;
}): ReviewRecord {
  return {
    name: input.name,
    headSha: input.headSha,
    lenses: input.lenses.map((l) => ({ ...l })),
    skeptics: input.skeptics.map((s) => ({ ...s })),
    findings: input.findings.map((f) => ({ ...f })),
    finishedAt: new Date(input.now).toISOString(),
  };
}
