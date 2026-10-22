import type { AttemptExit, EndState, LaneState, PlanSpec } from "../types";
import { planWaves } from "./graph";

/** A launched phase: its lane's registry state and what its latest attempt's exit.json says of the checkpoint. */
export interface PhaseState {
  state: LaneState;
  endState: EndState | null;
  /** null when the latest attempt has no readable exit.json (or there is no attempt). */
  exit: Pick<AttemptExit, "checkpoint" | "checkpointError"> | null;
}

/** Each phase's state; undefined when the phase was never launched. */
export type PhaseStates = Record<string, PhaseState | undefined>;

export interface NextPhases {
  /** Never launched, every dependency succeeded (finished with success and its work checkpointed). */
  launch: string[];
  /** Never launched, some dependencies not finished yet. */
  blocked: Array<{ phase: string; waitingFor: string[] }>;
  /**
   * Never launched, and a dependency did not succeed: it finished otherwise, its checkpoint failed, or its shepherd
   * died (`orphaned`). The orchestrator decides.
   */
  failed: Array<{ phase: string; dependency: string; endState: EndState | "orphaned" | null; reason: string | null }>;
}

export interface PlanStatusRow {
  phase: string;
  wave: number;
  dependsOn: string[];
  state: LaneState | null;
  endState: EndState | null;
}

type Outcome = { kind: "succeeded" } | { kind: "waiting" } | { kind: "failed"; endState: EndState | "orphaned" | null; reason: string | null };

/**
 * Whether a dependency's work can be merged: success alone is not enough, since dependents receive only its checkpoint
 * commit. No checkpoint and no checkpoint error means the attempt changed nothing.
 */
function outcome(s: PhaseState | undefined): Outcome {
  if (s === undefined) return { kind: "waiting" };
  // A dead shepherd never finishes the lane; waiting for it would block the plan forever.
  if (s.state === "orphaned") return { kind: "failed", endState: "orphaned", reason: null };
  if (s.state !== "finished") return { kind: "waiting" };
  if (s.endState !== "success") return { kind: "failed", endState: s.endState, reason: null };
  if (s.exit === null) return { kind: "failed", endState: s.endState, reason: "its latest attempt has no readable exit.json" };
  if (s.exit.checkpointError !== null) {
    return { kind: "failed", endState: s.endState, reason: `its checkpoint failed: ${s.exit.checkpointError}` };
  }
  return { kind: "succeeded" };
}

/** What `plan next` would do. Phases that already have a state are left alone, so calling it again is harmless. */
export function nextPhases(plan: PlanSpec, states: PhaseStates): NextPhases {
  const out: NextPhases = { launch: [], blocked: [], failed: [] };
  const seen = new Set<string>();
  for (const phase of plan.phases) {
    if (seen.has(phase.name)) continue;
    seen.add(phase.name);
    if (states[phase.name] !== undefined) continue;

    const deps = phase.dependsOn ?? [];
    const outcomes = deps.map((d) => ({ dependency: d, outcome: outcome(states[d]) }));
    const failed = outcomes.find((o) => o.outcome.kind === "failed");
    if (failed !== undefined && failed.outcome.kind === "failed") {
      const { endState, reason } = failed.outcome;
      out.failed.push({ phase: phase.name, dependency: failed.dependency, endState, reason });
      continue;
    }
    const waitingFor = outcomes.filter((o) => o.outcome.kind === "waiting").map((o) => o.dependency);
    if (waitingFor.length === 0) out.launch.push(phase.name);
    else out.blocked.push({ phase: phase.name, waitingFor });
  }
  return out;
}

/**
 * Why `plan next --retry <phase>` must refuse the phase, or null when it may be relaunched: its lane's latest run
 * ended in anything but success, or its shepherd died.
 */
export function retryRefusal(plan: PlanSpec, states: PhaseStates, phase: string): string | null {
  if (!plan.phases.some((p) => p.name === phase)) return `phase ${phase} is not in plan ${plan.name}`;
  const s = states[phase];
  if (s === undefined) return `phase ${phase} never ran; plan next launches it when its dependencies succeed`;
  if (s.state === "orphaned") return null;
  if (s.state !== "finished") return `phase ${phase} is ${s.state}; stop it or wait for it first`;
  if (s.endState === "success") return `phase ${phase} succeeded; there is nothing to retry`;
  return null;
}

/** One row per phase, in plan order. Throws like planWaves on a graph that does not resolve. */
export function planStatus(plan: PlanSpec, states: PhaseStates): PlanStatusRow[] {
  const waveOf = new Map<string, number>();
  planWaves(plan).forEach((wave, i) => {
    for (const name of wave) waveOf.set(name, i);
  });
  const seen = new Set<string>();
  const rows: PlanStatusRow[] = [];
  for (const phase of plan.phases) {
    if (seen.has(phase.name)) continue;
    seen.add(phase.name);
    const s = states[phase.name];
    rows.push({
      phase: phase.name,
      wave: waveOf.get(phase.name) ?? 0,
      dependsOn: [...(phase.dependsOn ?? [])],
      state: s?.state ?? null,
      endState: s?.endState ?? null,
    });
  }
  return rows;
}
