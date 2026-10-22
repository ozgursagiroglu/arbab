import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeProject, writeLaneRun, type TestProject } from "../commands/testkit";
import type { AttemptSummary } from "../types";
import { formatHeader, formatLaneReport, formatReportBody, formatTokens, readLaneReport } from "./report";

let p: TestProject;
afterEach(() => p?.dispose());

const TOKENS = { input: 1200, cacheCreation: 300, cacheRead: 5000, output: 800 };

describe("readLaneReport", () => {
  it("reads the latest attempt by default and attempt n on request", () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "finished", summary: { state: "failed", role: "implementer" }, report: { status: "blocked" } });
    writeLaneRun(p.runsRoot, "demo", { state: "finished", summary: { state: "success", role: "implementer" }, report: { status: "done" } });
    const latest = readLaneReport(p.runsRoot, "demo");
    expect(latest).toMatchObject({ lane: "demo", role: "implementer", attempt: 2, latest: 2, report: { status: "done" }, reportError: null });
    expect(readLaneReport(p.runsRoot, "demo", 1)).toMatchObject({ attempt: 1, latest: 2, report: { status: "blocked" } });
  });

  it("takes the role from the lane file when there is no summary", () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "rev", { state: "running", started: {}, lane: { name: "rev", role: "reviewer", brief: "x.md" } });
    expect(readLaneReport(p.runsRoot, "rev")).toMatchObject({ role: "reviewer", report: null });
  });

  it("measures stderr.log and the stream without reading them in", () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "finished", summary: { state: "no-result" }, stderr: "boom\n", stream: "{}\n{}\n" });
    const r = readLaneReport(p.runsRoot, "demo");
    expect(r.stderr).toEqual({ path: join(p.runsRoot, "demo", "attempt-1", "stderr.log"), bytes: 5 });
    expect(r.stream.bytes).toBe(6);
  });

  it("keeps going when report.json does not parse", () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "finished", summary: { state: "success" } });
    writeFileSync(join(p.runsRoot, "demo", "attempt-1", "report.json"), "{cut");
    expect(readLaneReport(p.runsRoot, "demo")).toMatchObject({ report: null, reportError: expect.stringContaining("not valid JSON") as unknown });
  });

  it("refuses an unknown lane, a lane without attempts and a missing attempt", () => {
    p = makeProject();
    expect(() => readLaneReport(p.runsRoot, "nope")).toThrow("no runs for lane nope");
    mkdirSync(join(p.runsRoot, "fresh"), { recursive: true });
    expect(() => readLaneReport(p.runsRoot, "fresh")).toThrow("lane fresh has no attempt yet");
    writeLaneRun(p.runsRoot, "demo", { state: "finished", summary: { state: "success" } });
    expect(() => readLaneReport(p.runsRoot, "demo", 3)).toThrow("lane demo has no attempt 3 (attempts: 1)");
  });
});

describe("formatTokens", () => {
  it("names each kind", () => expect(formatTokens(TOKENS)).toBe("1200 in · 300 cache write · 5000 cache read · 800 out"));
});

describe("formatHeader", () => {
  it("shows cost with its delta, wall time, turns and effort", () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", {
      state: "finished",
      summary: { state: "success", role: "implementer", wallMs: 90_000, turns: 12, costUsd: 1.5, costDeltaUsd: 0.5, requestedEffort: "high", measuredEffort: { high: 20 } },
    });
    expect(formatHeader(readLaneReport(p.runsRoot, "demo"))).toEqual([
      "lane:      demo",
      "role:      implementer",
      "attempt:   1",
      "end state: success",
      "wall:      1m30s",
      "turns:     12",
      "cost:      $1.50 (Δ$0.50)",
      "effort:    high (measured: high 20)",
    ]);
  });

  it("shows tokens when the cost is null, and the exit's wall time when the summary has none", () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", {
      state: "finished",
      summary: { state: "killed:wall", wallMs: null, turns: 3, costUsd: null, tokens: TOKENS, requestedEffort: null, measuredEffort: null },
      exit: { wallMs: 3_600_000 },
    });
    writeLaneRun(p.runsRoot, "demo", { state: "finished", summary: { state: "success" } });
    const lines = formatHeader(readLaneReport(p.runsRoot, "demo", 1));
    expect(lines).toContain("attempt:   1 (latest 2)");
    expect(lines).toContain("wall:      1h00m");
    expect(lines).toContain(`tokens:    ${formatTokens(TOKENS)}`);
    expect(lines).toContain("effort:    -");
  });

  it("says when there is neither a summary nor a live one", () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "running", started: {} });
    expect(formatHeader(readLaneReport(p.runsRoot, "demo")).at(-1)).toBe("end state: - (no summary.json)");
  });

  it("uses a live summary for a running attempt", () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "running", started: {} });
    const live = { state: "running", turns: 4, wallMs: 60_000, costUsd: null, tokens: null, requestedEffort: null, measuredEffort: null } as unknown as AttemptSummary;
    const lines = formatHeader(readLaneReport(p.runsRoot, "demo"), live);
    expect(lines).toContain("end state: running (live, no summary.json yet)");
    expect(lines).toContain("turns:     4");
    expect(lines).toContain("cost:      -");
  });
});

describe("formatReportBody", () => {
  it("renders a worker's report, the first 10 files and every list", () => {
    const files = Array.from({ length: 12 }, (_, i) => `src/f${i}.ts`);
    const lines = formatReportBody({
      status: "partial",
      summary: "did most\nof it",
      files_changed: files,
      checks: [
        { command: "pnpm test", exit_code: 0, result: "41 passed" },
        { command: "pnpm typecheck", exit_code: 2, result: "" },
      ],
      decisions: ["kept the API"],
      open_questions: [],
      not_verified: ["the browser"],
      notes_for_reviewer: "1, 2 and 3 done",
    });
    expect(lines).toEqual([
      "status: partial",
      "summary: did most\n  of it",
      `files changed (12): ${files.slice(0, 10).join(", ")}, … 2 more`,
      "checks:",
      "  pnpm test → 0  41 passed",
      "  pnpm typecheck → 2",
      "decisions:",
      "  - kept the API",
      "open questions: none",
      "not verified:",
      "  - the browser",
      "notes for reviewer: 1, 2 and 3 done",
    ]);
  });

  it("renders a reviewer's coverage, then its findings", () => {
    expect(
      formatReportBody({
        coverage: "all of src/summary",
        paths_checked: ["a", "b"],
        findings: [
          { title: "Off by one", severity: "HIGH", file: "src/a.ts", line: 12, failure_scenario: "x", evidence: "y" },
          { title: "Naming", severity: "LOW", file: "src/b.ts", failure_scenario: "x", evidence: "y" },
        ],
      }),
    ).toEqual(["coverage: all of src/summary", "paths checked: 2", "findings (2):", "  1  HIGH  Off by one  src/a.ts:12", "  2  LOW  Naming  src/b.ts"]);
  });

  it("says a reviewer found nothing", () => {
    expect(formatReportBody({ coverage: "c", paths_checked: [], findings: [] })).toContain("findings: none");
  });

  it("renders a skeptic's verdicts", () => {
    expect(
      formatReportBody({
        verdicts: [
          { id: "correctness-1", refuted: true, corrected_severity: "NONE", reasoning: "cannot happen" },
          { id: "correctness-2", refuted: false, corrected_severity: "MEDIUM", reasoning: "real" },
        ],
      }),
    ).toEqual(["verdicts (2):", "  correctness-1  refuted  NONE  cannot happen", "  correctness-2  stands  MEDIUM  real"]);
  });

  it("names the fields of another shape and refuses a non-object", () => {
    expect(formatReportBody({ facts: [], not_found: [] })).toEqual(["report fields: facts, not_found (see --json)"]);
    expect(formatReportBody([1, 2])).toEqual(["report.json is not an object (see --json)"]);
  });

  it("tolerates fields of the wrong type", () => {
    expect(formatReportBody({ status: 3, summary: "ok", checks: [{ command: 1, exit_code: "0" }, "junk"] })).toEqual([
      "summary: ok",
      "checks:",
      "  ? → ?",
    ]);
  });
});

describe("formatLaneReport", () => {
  it("names stderr.log and the stream's size when the report is missing", () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "finished", summary: { state: "no-result" }, stderr: "secret output", stream: "x" });
    const text = formatLaneReport(readLaneReport(p.runsRoot, "demo"));
    expect(text).toContain(`no report.json; see ${join(p.runsRoot, "demo", "attempt-1", "stderr.log")} (13 bytes); stream.jsonl: 1 bytes`);
    expect(text).not.toContain("secret output");
  });

  it("says the files are missing when they are", () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "finished", summary: { state: "no-result" } });
    expect(formatLaneReport(readLaneReport(p.runsRoot, "demo"))).toMatch(/\(missing\); stream\.jsonl: missing$/);
  });

  it("says when report.json cannot be read", () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "finished", summary: { state: "success" } });
    writeFileSync(join(p.runsRoot, "demo", "attempt-1", "report.json"), "{cut");
    expect(formatLaneReport(readLaneReport(p.runsRoot, "demo"))).toContain("report.json cannot be read: ");
  });
});
