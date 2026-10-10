import type { AttemptExit, EndState, KillReason, StreamDigest } from "../types";

export interface ClassifyInput {
  digest: StreamDigest;
  exit: AttemptExit | null;
  /** The worker process is still running. */
  alive: boolean;
  /** The lane has a report schema, so success needs a structured output. */
  schemaRequired: boolean;
  /** The report validated against the schema; null when it was not validated. */
  reportValid: boolean | null;
}

const UNSUPPORTED_CLI = /does not support this model|or newer is required/i;

const HANG_KILLS: ReadonlySet<KillReason> = new Set(["hang-after-result", "hang-after-error"]);

const SUBTYPE_STATES: ReadonlyMap<string, EndState> = new Map([
  ["error_max_budget_usd", "budget"],
  ["error_max_turns", "max-turns"],
  ["error_max_structured_output_retries", "invalid-report"],
]);

/**
 * How an attempt ended (DESIGN.md §7), decided from the final result's fields in a fixed order. Never from `subtype`
 * alone (a usage-limit stop reports `subtype: "success"` with `is_error: true`) and never from the exit code.
 *
 * A final result without a subtype counts as failed: success has to be stated, not inferred.
 *
 * A worker killed for hanging after a result had already said how it ended (a 429 then a hang is a usage limit, so
 * it auto-resumes), so that result decides. Wall, idle and stop kills keep `killed:*`.
 */
export function classifyAttempt(input: ClassifyInput): EndState {
  const { digest, exit, alive, schemaRequired, reportValid } = input;
  const final = digest.final;
  const killedBy = exit?.killedBy ?? null;
  if (killedBy !== null && !(final !== null && HANG_KILLS.has(killedBy))) return `killed:${killedBy}`;

  if (final === null) return alive ? "running" : "no-result";

  if (final.apiErrorStatus === 429) return "usage-limit";
  if (final.apiErrorStatus === 400 && UNSUPPORTED_CLI.test(final.resultText ?? "")) return "unsupported-cli";

  const bySubtype = final.subtype === null ? undefined : SUBTYPE_STATES.get(final.subtype);
  if (bySubtype) return bySubtype;
  if (final.isError || final.subtype !== "success") return "failed";

  if (schemaRequired && (final.structuredOutput == null || reportValid === false)) return "invalid-report";
  return "success";
}
