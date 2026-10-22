// The Plans section of `arbab summary`: the phases each plan launched, from the lane files `plan next` wrote under
// .arbab/plans/<plan>/. The plan file itself (with the phases not launched yet) is not recorded.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { effectiveState, readAttempt, readState, runPaths } from "../registry";
import type { EndState, LaneState } from "../types";
import { isValidName } from "../util/names";

/** done = finished with success; failed = finished otherwise, or orphaned; launched = no state written yet. */
export type PhaseStatus = "done" | "failed" | "launched" | Exclude<LaneState, "finished" | "orphaned">;

export interface PhaseLine {
  phase: string;
  status: PhaseStatus;
  /** The end state of a finished phase, "orphaned" for a dead shepherd's, else null. */
  endState: EndState | "orphaned" | null;
}

export interface PlanOverview {
  plan: string;
  phases: PhaseLine[];
}

export const PLANS_DIR = join(".arbab", "plans");

function names(dir: string, keep: (entry: { name: string; isDirectory(): boolean; isFile(): boolean }) => boolean): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(keep)
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

function phaseLine(runsRoot: string, phase: string, alive: (pid: number) => boolean): PhaseLine {
  const record = readState(runsRoot, phase);
  if (record === null) return { phase, status: "launched", endState: null };
  const state = effectiveState(record, alive);
  if (state === "orphaned") return { phase, status: "failed", endState: "orphaned" };
  if (state !== "finished") return { phase, status: state, endState: null };
  let end = record.endState ?? null;
  if (end === null && record.attempt >= 1) end = readAttempt(runPaths(runsRoot, phase).attemptDir(record.attempt)).summary?.state ?? null;
  return { phase, status: end === "success" ? "done" : "failed", endState: end };
}

/** Each plan directory with its launched phases, by name; unreadable phases go to `errors`. */
export function planOverview(
  projectRoot: string,
  runsRoot: string,
  alive: (pid: number) => boolean,
): { plans: PlanOverview[]; errors: string[] } {
  const root = join(projectRoot, PLANS_DIR);
  const plans: PlanOverview[] = [];
  const errors: string[] = [];
  for (const plan of names(root, (e) => e.isDirectory() && isValidName(e.name))) {
    const phases: PhaseLine[] = [];
    for (const file of names(join(root, plan), (e) => e.isFile() && e.name.endsWith(".json"))) {
      const phase = file.slice(0, -".json".length);
      if (!isValidName(phase)) continue;
      try {
        phases.push(phaseLine(runsRoot, phase, alive));
      } catch (err) {
        errors.push(`plan ${plan} phase ${phase}: ${(err as Error).message}`);
      }
    }
    if (phases.length > 0) plans.push({ plan, phases });
  }
  return { plans, errors };
}
