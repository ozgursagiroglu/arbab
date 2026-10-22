// arbab report <lane> [--attempt <n>] [--json]
//
// One attempt of a lane, the latest unless --attempt names one (DESIGN.md §21).
// Text: a header (lane, role, attempt, end state, wall time, turns, cost or tokens when cost is null, effort), then
// report.json: a worker's status, summary, files changed (count and the first 10), checks, decisions, open questions,
// not verified and notes for the reviewer; a reviewer's coverage and findings; a skeptic's verdicts. A missing report
// names stderr.log and the stream's size without printing either. A running attempt without summary.json shows its
// live figures from the partial stream.
// --json: {"summary": AttemptSummary | null, "report": unknown | null}, both as read from disk.
// Read-only.
import { effectiveState, readState } from "../registry";
import { formatLaneReport, readLaneReport } from "../summary";
import type { AttemptSummary } from "../types";
import { ArbabError } from "../util/errors";
import { assertValidName } from "../util/names";
import type { CommandContext } from "./context";
import { onePositional, openProject, parse, printJson } from "./project";
import { liveSummary } from "./status";

function attemptNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new ArbabError("usage", `--attempt ${JSON.stringify(value)} must be a positive integer`);
  }
  return Number(value);
}

export async function runReport(argv: string[], ctx: CommandContext): Promise<number> {
  const { values, positionals } = parse("report", {
    args: argv,
    options: { attempt: { type: "string" }, json: { type: "boolean" } },
    allowPositionals: true,
  });
  const lane = assertValidName(onePositional("report", positionals, "lane"), "lane");
  const attempt = attemptNumber(values.attempt);
  const project = openProject(ctx);
  const r = readLaneReport(project.runsRoot, lane, attempt);
  if (values.json === true) {
    printJson(ctx, { summary: r.record.summary, report: r.report });
    if (r.reportError !== null) ctx.stderr(`report.json cannot be read: ${r.reportError}\n`);
    return 0;
  }
  let live: AttemptSummary | null = null;
  if (r.record.summary === null && r.record.started !== null && r.attempt === r.latest) {
    const state = readState(project.runsRoot, lane);
    if (state !== null && state.attempt === r.attempt && effectiveState(state, ctx.alive) === "running") {
      live = liveSummary(project.runsRoot, lane, r.attempt, r.record, ctx.clock.now());
    }
  }
  ctx.stdout(formatLaneReport(r, live) + "\n");
  return 0;
}
