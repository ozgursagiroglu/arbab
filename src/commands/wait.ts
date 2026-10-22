// arbab wait [--any|--all] [--timeout-min N] [--notify] [--json] [lane…]
//
// Level-triggered: reports lane runs that finished (or were orphaned) and are not acked yet, and acks them; otherwise
// blocks until one finishes. A run that failed before its first attempt (worktree, dependencies, leases, binary,
// brief…) is reported too.
// Without lanes, --any (the default) waits for the runs this session owns and the ownerless ones (DESIGN.md §21);
// --all for every run. With lanes, --any waits for one of them and --all for every one, whoever owns them.
// When nothing is pending and none of those runs is running, it prints `no lanes are running` and exits 0.
// While it waits, ~/.arbab/waiters/<pid>.json says so (the Stop hook reads it).
// Text: one line per finished run; the attempt part only when the run made one, the report only when there is one,
// the reason only when state.json gives one:
//   `<lane>[#<attempt>] <endState>[ <wall> turns=<n> calls=<n> failed=<n> cost=$<Δ>][ report=<path>][ reason: <text>]`
// --json: {"timedOut": boolean, "finished": [{"lane", "attempt", "state", "endState", "reason", "wallMs", "turns",
//          "toolCalls", "failed", "costDeltaUsd", "report"}]} (`attempt`, `reason` and `report` may be null; `report`
//          is an absolute path); idle: {"timedOut": false, "finished": [], "idle": true}
// `endState` is the lane's, from state.json; the last attempt's state is only its fallback.
// --notify: a desktop notification `<lane>: <endState>` per finished run.
// Exit 0, or 3 on timeout.
import { existsSync } from "node:fs";
import {
  attemptFiles,
  formatElapsed,
  ownedBy,
  readShepherdRecord,
  registerWaiter,
  runPaths,
  sessionOf,
  unregisterWaiter,
  waitForFinished,
  type FinishedItem,
  type WaitResult,
} from "../registry";
import type { LaneState } from "../types";
import { ArbabError } from "../util/errors";
import { assertValidName } from "../util/names";
import { isoAt } from "../util/proc";
import type { CommandContext } from "./context";
import { openProject, parse, printJson } from "./project";

export const WAIT_TIMEOUT_EXIT = 3;
const POLL_MS = 2000;
const NONE = "—";

export interface FinishedLine {
  lane: string;
  attempt: number | null;
  state: LaneState;
  endState: string;
  reason: string | null;
  wallMs: number | null;
  turns: number;
  toolCalls: number;
  failed: number;
  costDeltaUsd: number | null;
  report: string | null;
}

export function describeFinished(runsRoot: string, item: FinishedItem): FinishedLine {
  const s = item.summary;
  const report = item.attempt === null ? null : attemptFiles(runPaths(runsRoot, item.lane).attemptDir(item.attempt)).report;
  const endState = item.endState ?? (item.state === "orphaned" ? "orphaned" : (s?.state ?? item.state));
  return {
    lane: item.lane,
    attempt: item.attempt,
    state: item.state,
    endState,
    reason: item.reason,
    wallMs: s?.wallMs ?? null,
    turns: s?.turns ?? 0,
    toolCalls: s?.toolCallTotal ?? 0,
    failed: s?.failedTotal ?? 0,
    costDeltaUsd: s?.costDeltaUsd ?? null,
    report: report !== null && existsSync(report) ? report : null,
  };
}

export function formatFinished(line: FinishedLine): string {
  const parts = [line.attempt === null ? line.lane : `${line.lane}#${line.attempt}`, line.endState];
  if (line.attempt !== null) {
    const wall = line.wallMs === null ? NONE : formatElapsed(line.wallMs);
    const cost = line.costDeltaUsd === null ? NONE : `$${line.costDeltaUsd.toFixed(2)}`;
    parts.push(wall, `turns=${line.turns}`, `calls=${line.toolCalls}`, `failed=${line.failed}`, `cost=${cost}`);
  }
  if (line.report !== null) parts.push(`report=${line.report}`);
  // A reason can span lines (a dependency command's output); one finish stays one line.
  if (line.reason !== null && line.reason.trim() !== "") parts.push(`reason: ${line.reason.trim().replace(/\s+/g, " ")}`);
  return parts.join(" ");
}

export function parseTimeoutMin(text: string | undefined): number {
  if (text === undefined) return Infinity;
  const n = Number(text);
  if (text.trim() === "" || !Number.isFinite(n) || n < 0) {
    throw new ArbabError("usage", `--timeout-min ${JSON.stringify(text)} must be a non-negative number`);
  }
  return n * 60_000;
}

export async function runWait(argv: string[], ctx: CommandContext): Promise<number> {
  const { values, positionals } = parse("wait", {
    args: argv,
    options: {
      any: { type: "boolean" },
      all: { type: "boolean" },
      "timeout-min": { type: "string" },
      notify: { type: "boolean" },
      json: { type: "boolean" },
    },
    allowPositionals: true,
  });
  if (values.any === true && values.all === true) throw new ArbabError("usage", "--any and --all exclude each other");
  const timeoutMs = parseTimeoutMin(values["timeout-min"]);
  for (const lane of positionals) assertValidName(lane, "lane");
  const project = openProject(ctx);
  const named = positionals.length > 0;
  const session = sessionOf(ctx.hostEnv);

  registerWaiter(ctx.home, { pid: ctx.pid, project: project.root, owner: session, startedAt: isoAt(ctx.clock) });
  let result: WaitResult;
  try {
    result = await waitForFinished({
      runsRoot: project.runsRoot,
      lanes: named ? positionals : null,
      // Unnamed, --any is this session's runs (and the ownerless); --all is everyone's, one at a time as --any was.
      ...(!named && values.all !== true && { include: (lane: string) => ownedBy(readShepherdRecord(project.runsRoot, lane), session) }),
      mode: named && values.all === true ? "all" : "any",
      timeoutMs,
      pollMs: POLL_MS,
      clock: ctx.clock,
      sleep: ctx.sleep,
      alive: ctx.alive,
      stopWhenIdle: true,
    });
  } finally {
    unregisterWaiter(ctx.home, ctx.pid);
  }
  const lines = result.finished.map((item) => describeFinished(project.runsRoot, item));
  const idle = result.idle === true;
  if (values.json === true) {
    printJson(ctx, idle ? { timedOut: false, finished: [], idle: true } : { timedOut: result.timedOut, finished: lines });
  } else {
    for (const line of lines) ctx.stdout(formatFinished(line) + "\n");
    if (idle) ctx.stdout("no lanes are running\n");
    if (result.timedOut) ctx.stderr("arbab wait: timed out\n");
  }
  if (values.notify === true) {
    // A notification is a courtesy: whether it showed changes nothing.
    for (const line of lines) await ctx.notify("arbab", `${line.lane}: ${line.endState}`);
  }
  return result.timedOut ? WAIT_TIMEOUT_EXIT : 0;
}
