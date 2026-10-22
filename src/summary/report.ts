// `arbab report <lane>`: one attempt's summary and report, read and rendered. report.json is a worker's structured
// output (validated by the shepherd against the lane's schema, which may not be the default), so every field is
// narrowed before it is printed.
import { existsSync, statSync } from "node:fs";
import { attemptFiles, listAttempts, readAttempt, runPaths, formatElapsed } from "../registry";
import type { AttemptRecord } from "../registry";
import type { AttemptSummary, Role, TokenUsage } from "../types";
import { ROLES } from "../types";
import { ArbabError } from "../util/errors";
import { readJson } from "../util/fs";

export interface LaneReport {
  lane: string;
  role: Role | null;
  attempt: number;
  /** The lane's latest attempt number. */
  latest: number;
  record: AttemptRecord;
  /** report.json as read; null when missing or unreadable. */
  report: unknown;
  /** Why report.json could not be read, when it exists but does not parse. */
  reportError: string | null;
  stderr: { path: string; bytes: number | null };
  stream: { path: string; bytes: number | null };
}

export const FILES_SHOWN = 10;

function size(path: string): number | null {
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

function laneFileRole(path: string): Role | null {
  try {
    const spec = readJson<unknown>(path);
    const role = typeof spec === "object" && spec !== null ? (spec as Record<string, unknown>)["role"] : undefined;
    return ROLES.includes(role as Role) ? (role as Role) : null;
  } catch {
    return null;
  }
}

/** The lane's attempt `n`, or its latest when `n` is undefined. */
export function readLaneReport(runsRoot: string, lane: string, n?: number): LaneReport {
  const paths = runPaths(runsRoot, lane);
  if (!existsSync(paths.laneDir)) throw new ArbabError("usage", `no runs for lane ${lane}`);
  const attempts = listAttempts(runsRoot, lane);
  const latest = attempts.at(-1);
  if (latest === undefined) throw new ArbabError("usage", `lane ${lane} has no attempt yet`);
  const attempt = n ?? latest;
  if (!attempts.includes(attempt)) throw new ArbabError("usage", `lane ${lane} has no attempt ${attempt} (attempts: ${attempts.join(", ")})`);
  const dir = paths.attemptDir(attempt);
  const files = attemptFiles(dir);
  const record = readAttempt(dir);
  let report: unknown = null;
  let reportError: string | null = null;
  try {
    report = readJson<unknown>(files.report);
  } catch (err) {
    reportError = (err as Error).message;
  }
  const summaryRole = record.summary !== null && ROLES.includes(record.summary.role) ? record.summary.role : null;
  return {
    lane,
    role: summaryRole ?? laneFileRole(paths.laneFile),
    attempt,
    latest,
    record,
    report,
    reportError,
    stderr: { path: files.stderr, bytes: size(files.stderr) },
    stream: { path: files.stream, bytes: size(files.stream) },
  };
}

// --- narrowing -------------------------------------------------------------------------------------------------

type Fields = Record<string, unknown>;
const isObject = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const strings = (v: unknown): string[] | null => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null);
const objects = (v: unknown): Fields[] | null => (Array.isArray(v) ? v.filter(isObject) : null);

const INDENT = "  ";
/** A possibly multi-line value under its label, continuation lines indented. */
const block = (text: string, indent = INDENT): string => text.split("\n").join(`\n${indent}`);

// --- header ----------------------------------------------------------------------------------------------------

export function formatTokens(t: TokenUsage): string {
  return `${t.input} in · ${t.cacheCreation} cache write · ${t.cacheRead} cache read · ${t.output} out`;
}

function isTokens(v: unknown): v is TokenUsage {
  return isObject(v) && ["input", "cacheCreation", "cacheRead", "output"].every((k) => Number.isFinite(v[k]));
}

function costLine(s: AttemptSummary): string {
  if (typeof s.costUsd === "number") {
    const delta = typeof s.costDeltaUsd === "number" && s.costDeltaUsd.toFixed(2) !== s.costUsd.toFixed(2) ? ` (Δ$${s.costDeltaUsd.toFixed(2)})` : "";
    return `cost:      $${s.costUsd.toFixed(2)}${delta}`;
  }
  return isTokens(s.tokens) ? `tokens:    ${formatTokens(s.tokens)}` : "cost:      -";
}

function effortText(s: AttemptSummary): string {
  const measured = isObject(s.measuredEffort)
    ? Object.entries(s.measuredEffort)
        .filter(([, n]) => Number.isFinite(n))
        .map(([e, n]) => `${e} ${n as number}`)
    : [];
  const requested = s.requestedEffort ?? "-";
  return measured.length > 0 ? `${requested} (measured: ${measured.join(", ")})` : requested;
}

/** Header lines; `live` stands in for a running attempt that has no summary.json yet. */
export function formatHeader(r: LaneReport, live: AttemptSummary | null = null): string[] {
  const s = r.record.summary ?? live;
  const lines = [
    `lane:      ${r.lane}`,
    `role:      ${r.role ?? "-"}`,
    `attempt:   ${r.attempt}${r.attempt === r.latest ? "" : ` (latest ${r.latest})`}`,
  ];
  if (s === null) {
    lines.push("end state: - (no summary.json)");
    return lines;
  }
  const wallMs = s.wallMs ?? r.record.exit?.wallMs ?? null;
  lines.push(
    `end state: ${s.state}${r.record.summary === null ? " (live, no summary.json yet)" : ""}`,
    `wall:      ${typeof wallMs === "number" ? formatElapsed(wallMs) : "-"}`,
    `turns:     ${s.turns}`,
    costLine(s),
    `effort:    ${effortText(s)}`,
  );
  return lines;
}

// --- report bodies ---------------------------------------------------------------------------------------------

function listSection(title: string, items: string[] | null): string[] {
  if (items === null) return [];
  if (items.length === 0) return [`${title}: none`];
  return [`${title}:`, ...items.map((i) => `${INDENT}- ${block(i, INDENT + "  ")}`)];
}

function workerBody(rep: Fields): string[] {
  const lines: string[] = [];
  const status = str(rep["status"]);
  if (status !== null) lines.push(`status: ${status}`);
  const summary = str(rep["summary"]);
  if (summary !== null) lines.push(`summary: ${block(summary)}`);
  const files = strings(rep["files_changed"]);
  if (files !== null) {
    const more = files.length > FILES_SHOWN ? `, … ${files.length - FILES_SHOWN} more` : "";
    lines.push(`files changed (${files.length})${files.length > 0 ? `: ${files.slice(0, FILES_SHOWN).join(", ")}${more}` : ""}`);
  }
  const checks = objects(rep["checks"]);
  if (checks !== null) {
    if (checks.length === 0) lines.push("checks: none");
    else {
      lines.push("checks:");
      for (const c of checks) {
        const code = Number.isInteger(c["exit_code"]) ? String(c["exit_code"]) : "?";
        const result = str(c["result"]);
        lines.push(`${INDENT}${str(c["command"]) ?? "?"} → ${code}${result === null || result === "" ? "" : `  ${block(result, INDENT + "  ")}`}`);
      }
    }
  }
  lines.push(...listSection("decisions", strings(rep["decisions"])));
  lines.push(...listSection("open questions", strings(rep["open_questions"])));
  lines.push(...listSection("not verified", strings(rep["not_verified"])));
  const notes = str(rep["notes_for_reviewer"]);
  if (notes !== null) lines.push(`notes for reviewer: ${block(notes)}`);
  return lines;
}

function reviewerBody(rep: Fields, findings: Fields[]): string[] {
  const lines: string[] = [];
  const coverage = str(rep["coverage"]);
  if (coverage !== null) lines.push(`coverage: ${block(coverage)}`);
  const paths = strings(rep["paths_checked"]);
  if (paths !== null) lines.push(`paths checked: ${paths.length}`);
  lines.push(findings.length === 0 ? "findings: none" : `findings (${findings.length}):`);
  findings.forEach((f, i) => {
    const line = Number.isInteger(f["line"]) ? `:${f["line"] as number}` : "";
    const id = str(f["id"]) ?? String(i + 1);
    lines.push(`${INDENT}${id}  ${str(f["severity"]) ?? "?"}  ${str(f["title"]) ?? "?"}  ${str(f["file"]) ?? "?"}${line}`);
  });
  return lines;
}

function skepticBody(verdicts: Fields[]): string[] {
  const lines = [verdicts.length === 0 ? "verdicts: none" : `verdicts (${verdicts.length}):`];
  for (const v of verdicts) {
    const refuted = v["refuted"] === true ? "refuted" : v["refuted"] === false ? "stands" : "?";
    const reasoning = str(v["reasoning"]);
    lines.push(
      `${INDENT}${str(v["id"]) ?? "?"}  ${refuted}  ${str(v["corrected_severity"]) ?? "?"}${reasoning === null ? "" : `  ${block(reasoning, INDENT + "  ")}`}`,
    );
  }
  return lines;
}

/** The report's lines, by its shape: a reviewer's findings, a skeptic's verdicts, else a worker's fields. */
export function formatReportBody(report: unknown): string[] {
  if (!isObject(report)) return ["report.json is not an object (see --json)"];
  const findings = objects(report["findings"]);
  if (findings !== null) return reviewerBody(report, findings);
  const verdicts = objects(report["verdicts"]);
  if (verdicts !== null) return skepticBody(verdicts);
  const worker = workerBody(report);
  if (worker.length > 0) return worker;
  return [`report fields: ${Object.keys(report).join(", ") || "none"} (see --json)`];
}

const bytes = (n: number | null): string => (n === null ? "missing" : `${n} bytes`);

export function formatLaneReport(r: LaneReport, live: AttemptSummary | null = null): string {
  const lines = formatHeader(r, live);
  lines.push("");
  if (r.reportError !== null) {
    lines.push(`report.json cannot be read: ${r.reportError}`);
  } else if (r.report === null) {
    lines.push(`no report.json; see ${r.stderr.path} (${bytes(r.stderr.bytes)}); stream.jsonl: ${bytes(r.stream.bytes)}`);
  } else {
    lines.push(...formatReportBody(r.report));
  }
  return lines.join("\n");
}
