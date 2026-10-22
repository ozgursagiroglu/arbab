import { isAbsolute, resolve } from "node:path";
import { existingFile, fail, knownKeys, name, nameArray, nonEmptyString, readJsonFile, record, ref } from "../config/check";
import { PHASE_LANE_KEYS, phaseLaneFields, worktreeName } from "../config/lane";
import type { PlanPhase, PlanSpec, Role } from "../types";
import { ArbabError } from "../util/errors";

const PLAN_KEYS: readonly (keyof PlanSpec)[] = ["name", "base", "defaults", "phases"];
const PHASE_KEYS: readonly string[] = ["name", "brief", "scope", "dependsOn", ...PHASE_LANE_KEYS];

/**
 * Reads and validates plans/<name>.json. Field rules are the lane file's; `brief` and `schema` are kept as written
 * after checking that they stay inside the project, exist and hit neither the built-in credential list nor
 * `credentialPaths` (config.credentialPaths). Graph rules (cycles, overlaps) are checkPlan's.
 */
export function loadPlan(projectRoot: string, planPath: string, credentialPaths: readonly string[] = []): PlanSpec {
  const file = resolve(projectRoot, planPath);
  const raw = readJsonFile(file);
  if (raw === null) throw new ArbabError("usage", `plan file ${planPath} does not exist`);
  const obj = record(raw, planPath);
  knownKeys(obj, PLAN_KEYS, "");

  const plan: PlanSpec = { name: name(obj.name, "name"), phases: [] };
  if (obj.base !== undefined) plan.base = ref(obj.base, "base");
  if (obj.defaults !== undefined) {
    const defaults = record(obj.defaults, "defaults");
    knownKeys(defaults, PHASE_LANE_KEYS, "defaults");
    // PhaseLaneFields makes role required, so the default role is filled in here rather than left to compilePhase.
    plan.defaults = { role: "implementer", ...phaseLaneFields(projectRoot, defaults, "defaults", credentialPaths) };
  }
  if (!Array.isArray(obj.phases) || obj.phases.length === 0) fail("phases", "must be a non-empty array of phases");
  const defaultRole = plan.defaults?.role ?? "implementer";
  plan.phases = obj.phases.map((p, i) => loadPhase(projectRoot, p, `phases[${i}]`, defaultRole, credentialPaths));
  return plan;
}

function loadPhase(
  projectRoot: string,
  v: unknown,
  field: string,
  defaultRole: Role,
  credentialPaths: readonly string[],
): PlanPhase {
  const obj = record(v, field);
  knownKeys(obj, PHASE_KEYS, field);
  const phase: PlanPhase = {
    // A phase becomes a lane of the same name.
    name: worktreeName(obj.name, `${field}.name`),
    brief: existingFile(projectRoot, obj.brief, `${field}.brief`, credentialPaths),
    scope: scope(obj.scope, `${field}.scope`),
    role: defaultRole,
    ...phaseLaneFields(projectRoot, obj, field, credentialPaths),
  };
  if (obj.dependsOn !== undefined) phase.dependsOn = nameArray(obj.dependsOn, `${field}.dependsOn`);
  return phase;
}

/** Write globs relative to the project root; they are compared, never resolved, so they must not climb out. */
function scope(v: unknown, field: string): string[] {
  if (!Array.isArray(v) || v.length === 0) fail(field, "must be a non-empty array of globs");
  return v.map((item, i) => {
    const glob = nonEmptyString(item, `${field}[${i}]`);
    if (isAbsolute(glob) || /^[A-Za-z]:/.test(glob)) fail(`${field}[${i}]`, `${glob} must be relative`);
    if (glob.split(/[\\/]/).includes("..")) fail(`${field}[${i}]`, `${glob} must not contain ".."`);
    return glob;
  });
}
