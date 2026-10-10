import { PHASE_LANE_KEYS } from "../config/lane";
import type { LaneSpec, PhaseLaneFields, PlanSpec } from "../types";
import { ArbabError } from "../util/errors";
import { planWaves } from "./graph";

export const COORDINATION_INTRO = "Other lanes run at the same time; do not edit their scopes:";

/**
 * A phase as a lane: its fields over the plan's defaults, its dependencies as upstream reports and merged branches,
 * and its wave siblings as coordination. Throws on a plan whose graph does not resolve (run checkPlan first).
 */
export function compilePhase(plan: PlanSpec, phaseName: string): LaneSpec {
  const phase = plan.phases.find((p) => p.name === phaseName);
  if (phase === undefined) throw new ArbabError("usage", `plan ${plan.name} has no phase ${phaseName}`);

  const { role, ...fields } = { ...laneFields(plan.defaults ?? {}), ...laneFields(phase) };
  const lane: LaneSpec = { name: phase.name, role: role ?? "implementer", brief: phase.brief };
  // Dependent phases start from the base too: their dependencies arrive through mergeBranches.
  if (plan.base !== undefined) lane.base = plan.base;
  Object.assign(lane, fields);

  const deps = phase.dependsOn ?? [];
  if (deps.length > 0) {
    lane.upstream = [...deps];
    lane.mergeBranches = deps.map((d) => `arbab/${d}`);
  }

  const siblings = (planWaves(plan).find((w) => w.includes(phase.name)) ?? []).filter((n) => n !== phase.name);
  if (siblings.length > 0) lane.coordination = coordination(plan, siblings);
  return lane;
}

/** The PhaseLaneFields set on `src`, with arrays and records copied so lanes never alias the plan. */
function laneFields(src: Partial<PhaseLaneFields>): Partial<PhaseLaneFields> {
  const out: Record<string, unknown> = {};
  for (const key of PHASE_LANE_KEYS) {
    const v: unknown = src[key];
    if (v === undefined) continue;
    out[key] = Array.isArray(v) ? [...(v as unknown[])] : typeof v === "object" && v !== null ? { ...v } : v;
  }
  return out as Partial<PhaseLaneFields>;
}

function coordination(plan: PlanSpec, siblings: string[]): string {
  const lines = siblings.map((name) => {
    const scope = plan.phases.find((p) => p.name === name)?.scope ?? [];
    return `- \`${name}\` owns ${scope.map((g) => `\`${g}\``).join(", ")}`;
  });
  return [COORDINATION_INTRO, ...lines].join("\n");
}
