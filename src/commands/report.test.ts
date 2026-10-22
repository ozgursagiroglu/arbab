import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runReport } from "./report";
import { makeProject, writeLaneRun, type TestProject } from "./testkit";

let p: TestProject;
afterEach(() => p?.dispose());

const LIVE = 5000;
const TOKENS = { input: 10, cacheCreation: 20, cacheRead: 30, output: 40 };
const WORKER_REPORT = {
  status: "done",
  summary: "greeting added",
  files_changed: ["src/hello.ts"],
  checks: [{ command: "pnpm test", exit_code: 0, result: "passed" }],
  decisions: [],
  open_questions: ["name the greeting?"],
  not_verified: [],
};

describe("arbab report", () => {
  it("prints the latest attempt's header and report", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "finished", summary: { state: "failed", role: "implementer" } });
    writeLaneRun(p.runsRoot, "demo", {
      state: "finished",
      endState: "success",
      summary: { state: "success", role: "implementer", wallMs: 45_000, turns: 7, costUsd: 0.8, costDeltaUsd: 0.3, requestedEffort: "medium" },
      report: WORKER_REPORT,
    });
    expect(await runReport(["demo"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe(
      [
        "lane:      demo",
        "role:      implementer",
        "attempt:   2",
        "end state: success",
        "wall:      45s",
        "turns:     7",
        "cost:      $0.80 (Δ$0.30)",
        "effort:    medium",
        "",
        "status: done",
        "summary: greeting added",
        "files changed (1): src/hello.ts",
        "checks:",
        "  pnpm test → 0  passed",
        "decisions: none",
        "open questions:",
        "  - name the greeting?",
        "not verified: none",
        "",
      ].join("\n"),
    );
  });

  it("prints attempt n with --attempt", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "finished", summary: { state: "failed" }, report: { ...WORKER_REPORT, status: "blocked" } });
    writeLaneRun(p.runsRoot, "demo", { state: "finished", summary: { state: "success" }, report: WORKER_REPORT });
    await runReport(["demo", "--attempt", "1"], p.ctx);
    expect(p.stdout()).toContain("attempt:   1 (latest 2)\nend state: failed\n");
    expect(p.stdout()).toContain("status: blocked");
  });

  it("prints summary and report as read with --json", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "finished", summary: { state: "success", turns: 3 }, report: WORKER_REPORT });
    await runReport(["demo", "--json"], p.ctx);
    const out = JSON.parse(p.stdout()) as { summary: Record<string, unknown>; report: unknown };
    expect(out.summary).toMatchObject({ lane: "demo", attempt: 1, state: "success", turns: 3 });
    expect(out.report).toEqual(WORKER_REPORT);
  });

  it("prints nulls with --json when nothing was written yet, and names an unreadable report on stderr", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "running", started: {} });
    await runReport(["demo", "--json"], p.ctx);
    expect(JSON.parse(p.stdout())).toEqual({ summary: null, report: null });
    writeFileSync(join(p.runsRoot, "demo", "attempt-1", "report.json"), "{");
    p.out.length = 0;
    await runReport(["demo", "--json"], p.ctx);
    expect(JSON.parse(p.stdout())).toEqual({ summary: null, report: null });
    expect(p.stderr()).toContain("report.json cannot be read: ");
  });

  it("shows a running lane without a summary from its live stream", async () => {
    p = makeProject();
    p.alive.add(LIVE);
    const stream = [
      { type: "system", subtype: "init", session_id: "s1", tools: ["Bash"], model: "claude-opus-5-5" },
      { type: "assistant", session_id: "s1", message: { id: "m1", content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] } },
    ]
      .map((e) => JSON.stringify(e))
      .join("\n");
    writeLaneRun(p.runsRoot, "demo", { state: "running", shepherdPid: LIVE, started: { startedAt: "2026-10-09T11:59:00.000Z" }, stream, stderr: "" });
    await runReport(["demo"], p.ctx);
    const out = p.stdout();
    expect(out).toContain("end state: running (live, no summary.json yet)\nwall:      1m00s\nturns:     1\n");
    expect(out).toContain("no report.json; see ");
  });

  it("says there is no summary for a running lane whose shepherd died", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "running", shepherdPid: 31337, started: {} });
    await runReport(["demo"], p.ctx);
    expect(p.stdout()).toContain("end state: - (no summary.json)\n");
  });

  it("shows tokens for a killed attempt with no cost, and names stderr.log and the stream's size", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", {
      state: "finished",
      endState: "killed:wall",
      summary: { state: "killed:wall", wallMs: 3_720_000, turns: 88, costUsd: null, costDeltaUsd: null, tokens: TOKENS },
      stream: "0123456789",
      stderr: "private text",
    });
    await runReport(["demo"], p.ctx);
    const out = p.stdout();
    expect(out).toContain("end state: killed:wall\nwall:      1h02m\nturns:     88\ntokens:    10 in · 20 cache write · 30 cache read · 40 out\n");
    expect(out).toContain(`no report.json; see ${join(p.runsRoot, "demo", "attempt-1", "stderr.log")} (12 bytes); stream.jsonl: 10 bytes`);
    expect(out).not.toContain("private text");
    expect(out).not.toContain("0123456789");
  });

  it("prints a reviewer's coverage and findings", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "rel-review-correctness", {
      state: "finished",
      endState: "success",
      lane: { name: "rel-review-correctness", role: "reviewer", brief: "x.md" },
      summary: { state: "success", role: "reviewer", costUsd: 0.2 },
      report: {
        coverage: "every changed file",
        paths_checked: ["src/a.ts"],
        findings: [{ title: "Null deref", severity: "MEDIUM", file: "src/a.ts", line: 3, failure_scenario: "x", evidence: "y" }],
      },
    });
    await runReport(["rel-review-correctness"], p.ctx);
    expect(p.stdout()).toContain("role:      reviewer\n");
    expect(p.stdout()).toContain("coverage: every changed file\npaths checked: 1\nfindings (1):\n  1  MEDIUM  Null deref  src/a.ts:3\n");
  });

  it("refuses a bad lane, a bad attempt and missing runs", async () => {
    p = makeProject();
    await expect(runReport([], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runReport(["Bad_Name"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runReport(["demo"], p.ctx)).rejects.toThrow("no runs for lane demo");
    mkdirSync(join(p.runsRoot, "demo"), { recursive: true });
    await expect(runReport(["demo"], p.ctx)).rejects.toThrow("lane demo has no attempt yet");
    for (const bad of ["0", "-1", "1.5", "two", ""]) {
      await expect(runReport(["demo", `--attempt=${bad}`], p.ctx)).rejects.toThrow("must be a positive integer");
    }
  });
});
