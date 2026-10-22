import type {
  AttemptExit,
  AttemptStarted,
  AttemptSummary,
  Effort,
  EndState,
  Role,
  StreamDigest,
  ValidationError,
} from "../types";
import { sumValues } from "./json";

export interface AttemptSummaryInput {
  lane: string;
  attempt: number;
  role: Role;
  state: EndState;
  started: AttemptStarted | null;
  exit: AttemptExit | null;
  digest: StreamDigest;
  requestedEffort: Effort | null;
  /** From measuredEffort(); null when the transcript was not found. */
  measuredEffort: Record<string, number> | null;
  /**
   * The previous attempt's costUsd in the same session. Pass null for a first attempt or a fresh session:
   * total_cost_usd is cumulative only across --resume.
   */
  previousCostUsd: number | null;
  registration: AttemptSummary["registration"];
  reportValid: boolean | null;
  reportErrors: ValidationError[];
  /** The caller's clock, for the wall time of an attempt that has not exited. */
  nowMs: number;
}

function wallMsOf(started: AttemptStarted | null, exit: AttemptExit | null, nowMs: number): number | null {
  if (exit) return exit.wallMs;
  if (!started) return null;
  const startedMs = Date.parse(started.startedAt);
  return Number.isNaN(startedMs) ? null : Math.max(0, nowMs - startedMs);
}

/** Assembles summary.json from facts gathered elsewhere; no I/O and no clock of its own. */
export function buildAttemptSummary(input: AttemptSummaryInput): AttemptSummary {
  const { digest, started, exit } = input;
  const costUsd = digest.final?.totalCostUsd ?? null;
  let costDeltaUsd: number | null = null;
  if (costUsd !== null) costDeltaUsd = input.previousCostUsd === null ? costUsd : costUsd - input.previousCostUsd;

  return {
    lane: input.lane,
    attempt: input.attempt,
    role: input.role,
    state: input.state,
    sessionId: digest.sessionId ?? started?.sessionId ?? null,
    binary: started?.binary ?? null,
    model: digest.init?.model ?? null,
    requestedEffort: input.requestedEffort,
    measuredEffort: input.measuredEffort,
    wallMs: wallMsOf(started, exit, input.nowMs),
    turns: digest.turns,
    toolCalls: { ...digest.toolCalls },
    toolCallTotal: sumValues(digest.toolCalls),
    lastTool: digest.lastTool,
    failedByCause: { ...digest.failedByCause },
    failedTotal: sumValues(digest.failedByCause),
    permissionDenied: digest.permissionDenied,
    costUsd,
    costDeltaUsd,
    resultEvents: digest.results.length,
    final: digest.final,
    rateLimit: digest.rateLimit,
    init: digest.init,
    registration: input.registration,
    reportValid: input.reportValid,
    reportErrors: input.reportErrors,
    // From the stream itself, so a killed attempt without a result still has them.
    tokens: digest.tokens ? { ...digest.tokens } : null,
    maxGapMs: digest.maxGapMs ?? null,
  };
}
