// What to do about a lane that needs the orchestrator, condensed from skills/arbab/references/end-states.md.
import type { EndState } from "../types";

/** The end states a lane's latest run may end in that need someone to act (usage-limit resumes by itself). */
export const ATTENTION_END_STATES: ReadonlySet<string> = new Set<string>([
  "failed",
  "invalid-report",
  "no-result",
  "budget",
  "max-turns",
  "unsupported-cli",
]);

/** Whether a finished run's end state needs the orchestrator: the set above and every killed:*. */
export function needsAttention(endState: EndState | null): boolean {
  if (endState === null) return false;
  return ATTENTION_END_STATES.has(endState) || endState.startsWith("killed:");
}

const ADVICE: Readonly<Record<string, string>> = {
  "killed:wall": "ran past wallMin: read the last events; split the task or name the timeout, then relaunch or resume",
  "killed:idle": "no stream growth for idleMin (often a foreground server or watcher): fix the brief, then resume or relaunch",
  "killed:hang-after-result": "the work ended but the process hung: read report.json as for success; check the reaped pids in exit.json",
  "killed:hang-after-error": "treat as the error it followed: read stderr.log and the last result",
  "killed:stopped": "stopped by arbab stop: resume or relaunch when you have the correction",
  "no-result": "crashed before a result: read stderr.log and exit.json, then decide as for failed",
  "unsupported-cli": "the claude binary is too old for the model: run arbab doctor, upgrade or pin it, then relaunch",
  budget: "spent budgetUsd: check the report and checkpoint, split or decide more, then resume or relaunch",
  "max-turns": "hit the turn cap: check the report and checkpoint, split or decide more, then resume or relaunch",
  "invalid-report": "the report is not usable: check the diff and reportErrors in summary.json; resume asking only for the report",
  failed:
    "read the report, stderr.log and the last events; then arbab resume <lane> --prompt <file>, arbab resume <lane> --digest, or relaunch with a corrected brief",
  orphaned: "the shepherd died before finishing: arbab cleanup, then decide as for failed",
};

/** The advice for an end state or "orphaned"; a generic pointer for anything the table does not name. */
export function adviceFor(state: EndState | "orphaned"): string {
  return Object.hasOwn(ADVICE, state) ? (ADVICE[state] as string) : "see references/end-states.md";
}
