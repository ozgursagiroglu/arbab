// arbab status [--json] [lane…]
//
// Text: formatStatusTable (lane, state, attempt, elapsed, turns, calls, last tool, effort, failed, cost, quota),
// then a `quota: <formatQuota>` line.
// --json: {"lanes": StatusRow[], "quota": {"snapshot": RateLimitSnapshot | null, "hold": HoldDecision}}
// StatusRow and the others are the types of src/types.ts; `state` is the effective state (a dead shepherd's lane
// is "orphaned").
import { existsSync } from "node:fs";
import { attemptFiles, effectiveState, formatStatusTable, listLanes, readAttempt, readState, runPaths, statusRow } from "../registry";
import { formatQuota, holdDecision, readQuota } from "../quota";
import { buildAttemptSummary, digestStream, parseStream } from "../stream";
import type { AttemptRecord } from "../registry";
import type { AttemptSummary, LaneStateRecord, Role, StatusRow } from "../types";
import { ROLES } from "../types";
import { ArbabError } from "../util/errors";
import { readJson, readText } from "../util/fs";
import { assertValidName } from "../util/names";
import type { CommandContext } from "./context";
import { openProject, parse, printJson, type Project } from "./project";

function laneRole(runsRoot: string, lane: string): Role {
  const spec = readJson<unknown>(runPaths(runsRoot, lane).laneFile);
  const role = typeof spec === "object" && spec !== null ? (spec as { role?: unknown }).role : undefined;
  // statusRow does not read the role; a lane file the launch wrote always has a valid one.
  return ROLES.includes(role as Role) ? (role as Role) : "implementer";
}

/** A summary of a running attempt from its partial stream (the shepherd writes summary.json only at exit). */
export function liveSummary(
  runsRoot: string,
  lane: string,
  attempt: number,
  record: AttemptRecord,
  nowMs: number,
): AttemptSummary {
  const dir = runPaths(runsRoot, lane).attemptDir(attempt);
  const { events, unparsedLines } = parseStream(readText(attemptFiles(dir).stream) ?? "");
  const observedAt = new Date(nowMs).toISOString();
  let previousCostUsd: number | null = null;
  if (record.started?.resume === true && attempt > 1) {
    previousCostUsd = readAttempt(runPaths(runsRoot, lane).attemptDir(attempt - 1)).summary?.costUsd ?? null;
  }
  return buildAttemptSummary({
    lane,
    attempt,
    role: laneRole(runsRoot, lane),
    state: "running",
    started: record.started,
    exit: null,
    digest: digestStream(events, observedAt, unparsedLines),
    requestedEffort: null,
    measuredEffort: null,
    previousCostUsd,
    registration: null,
    reportValid: null,
    reportErrors: [],
    nowMs,
  });
}

/** One row per lane, with the effective state; null for a lane whose shepherd has not written a state yet. */
export function laneStatus(project: Project, lane: string, alive: (pid: number) => boolean, nowMs: number): StatusRow | null {
  const record = readState(project.runsRoot, lane);
  if (record === null) return null;
  const effective: LaneStateRecord = { ...record, state: effectiveState(record, alive) };
  let summary: AttemptSummary | null = null;
  if (record.attempt >= 1) {
    const dir = runPaths(project.runsRoot, lane).attemptDir(record.attempt);
    if (existsSync(dir)) {
      const attempt = readAttempt(dir);
      summary = attempt.summary;
      if (summary === null && effective.state === "running" && attempt.started !== null) {
        summary = liveSummary(project.runsRoot, lane, record.attempt, attempt, nowMs);
      }
    }
  }
  return statusRow(effective, summary, nowMs);
}

export async function runStatus(argv: string[], ctx: CommandContext): Promise<number> {
  const { values, positionals } = parse("status", {
    args: argv,
    options: { json: { type: "boolean" } },
    allowPositionals: true,
  });
  const project = openProject(ctx);
  const named = positionals.length > 0;
  for (const lane of positionals) {
    assertValidName(lane, "lane");
    if (!existsSync(runPaths(project.runsRoot, lane).laneDir)) throw new ArbabError("usage", `no runs for lane ${lane}`);
  }
  const nowMs = ctx.clock.now();
  const rows: StatusRow[] = [];
  for (const lane of named ? positionals : listLanes(project.runsRoot)) {
    const row = laneStatus(project, lane, ctx.alive, nowMs);
    if (row !== null) rows.push(row);
    else if (named) ctx.stderr(`${lane}: no state yet (the shepherd is starting)\n`);
  }
  const snapshot = readQuota(ctx.home);
  const nowSec = Math.floor(nowMs / 1000);
  if (values.json === true) {
    printJson(ctx, { lanes: rows, quota: { snapshot, hold: holdDecision(snapshot, project.config.quota.holdAbove, nowSec) } });
  } else {
    ctx.stdout((rows.length > 0 ? formatStatusTable(rows, nowSec) : "no lanes") + "\n");
    ctx.stdout(`quota: ${formatQuota(snapshot, nowSec)}\n`);
  }
  return 0;
}
