import { resolve } from "node:path";
import type { FenceLevel, LaneSpec, PhaseLaneFields } from "../types";
import { ArbabError } from "../util/errors";
import {
  MAX_ATTEMPTS,
  boolean,
  effort,
  existingFile,
  fail,
  integerIn,
  knownKeys,
  name,
  nameArray,
  nonEmptyString,
  positiveNumber,
  readJsonFile,
  record,
  ref,
  role,
  stringArray,
} from "./check";

const LANE_KEYS: readonly (keyof LaneSpec)[] = [
  "name",
  "role",
  "brief",
  "base",
  "worktree",
  "tools",
  "model",
  "effort",
  "budgetUsd",
  "wallMin",
  "idleMin",
  "fence",
  "allow",
  "schema",
  "resources",
  "semaphores",
  "checkpoint",
  "autoResume",
  "maxAttempts",
  "coordination",
  "upstream",
  "mergeBranches",
  "inputs",
];

/** The lane fields a plan's defaults and phases may set (PhaseLaneFields). */
export const PHASE_LANE_KEYS: readonly (keyof PhaseLaneFields)[] = [
  "role",
  "model",
  "effort",
  "budgetUsd",
  "wallMin",
  "idleMin",
  "fence",
  "allow",
  "schema",
  "resources",
  "semaphores",
  "worktree",
  "checkpoint",
  "autoResume",
  "maxAttempts",
  "inputs",
];

const FENCES: readonly FenceLevel[] = ["strict", "sandbox-auto"];

/**
 * Integration worktrees are `<worktreeRoot>/integrate-<name>`, and arbab merges in them on the host. A lane (or a
 * phase) with such a name, or borrowing such a worktree, would run a worker there.
 */
export const INTEGRATION_WORKTREE_PREFIX = "integrate-";

/** A name that becomes a lane's worktree: a valid name outside the integration worktrees' prefix. */
export function worktreeName(v: unknown, field: string): string {
  const valid = name(v, field);
  if (valid.startsWith(INTEGRATION_WORKTREE_PREFIX)) {
    fail(field, `${JSON.stringify(valid)} must not start with ${INTEGRATION_WORKTREE_PREFIX}: those worktrees are reserved for arbab integrate`);
  }
  return valid;
}

// A tool name as --tools takes it: built-in tools and mcp__server__tool, never a comma or a space.
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

/** A lane's `tools`: a non-empty array of tool names, each once. effectiveRole narrows the role's tools to it. */
export function toolList(v: unknown, field: string): string[] {
  if (!Array.isArray(v) || v.length === 0) fail(field, "must be a non-empty array of tool names");
  const seen = new Set<string>();
  return v.map((item, i) => {
    if (typeof item !== "string" || !TOOL_NAME.test(item)) fail(`${field}[${i}]`, `${JSON.stringify(item)} is not a tool name`);
    if (seen.has(item)) fail(`${field}[${i}]`, `${item} is listed twice`);
    seen.add(item);
    return item;
  });
}

/**
 * Validates the PhaseLaneFields keys present in `obj` with the lane-file rules; other keys are left to the caller.
 * `prefix` is prepended to field names in errors ("phases[1]" → "phases[1].effort"). `credentialPaths`
 * (config.credentialPaths) is checked against `schema` besides the built-in list.
 */
export function phaseLaneFields(
  projectRoot: string,
  obj: Record<string, unknown>,
  prefix = "",
  credentialPaths: readonly string[] = [],
): Partial<PhaseLaneFields> {
  const f = (key: string): string => (prefix === "" ? key : `${prefix}.${key}`);
  const out: Partial<PhaseLaneFields> = {};
  if (obj.role !== undefined) out.role = role(obj.role, f("role"));
  if (obj.worktree !== undefined) out.worktree = worktreeName(obj.worktree, f("worktree"));
  if (obj.model !== undefined) out.model = nonEmptyString(obj.model, f("model"));
  if (obj.effort !== undefined) out.effort = effort(obj.effort, f("effort"));
  if (obj.budgetUsd !== undefined) out.budgetUsd = positiveNumber(obj.budgetUsd, f("budgetUsd"));
  if (obj.wallMin !== undefined) out.wallMin = positiveNumber(obj.wallMin, f("wallMin"));
  if (obj.idleMin !== undefined) out.idleMin = positiveNumber(obj.idleMin, f("idleMin"));
  if (obj.fence !== undefined) {
    if (!FENCES.includes(obj.fence as FenceLevel)) fail(f("fence"), `must be one of ${FENCES.join(", ")}`);
    out.fence = obj.fence as FenceLevel;
  }
  if (obj.allow !== undefined) out.allow = stringArray(obj.allow, f("allow"));
  if (obj.schema !== undefined) out.schema = existingFile(projectRoot, obj.schema, f("schema"), credentialPaths);
  if (obj.resources !== undefined) {
    const res = record(obj.resources, f("resources"));
    out.resources = {};
    for (const [type, count] of Object.entries(res)) {
      name(type, f(`resources.${type}`));
      out.resources[type] = integerIn(count, 1, 8, f(`resources.${type}`));
    }
  }
  if (obj.semaphores !== undefined) out.semaphores = nameArray(obj.semaphores, f("semaphores"));
  if (obj.checkpoint !== undefined) out.checkpoint = boolean(obj.checkpoint, f("checkpoint"));
  if (obj.autoResume !== undefined) out.autoResume = boolean(obj.autoResume, f("autoResume"));
  if (obj.maxAttempts !== undefined) {
    out.maxAttempts = integerIn(obj.maxAttempts, 1, MAX_ATTEMPTS, f("maxAttempts"));
  }
  if (obj.inputs !== undefined) out.inputs = inputList(obj.inputs, f("inputs"));
  return out;
}

export const MAX_INPUTS = 20;

/**
 * A lane's `inputs`: at most MAX_INPUTS paths, each a non-empty string without NUL or newline. Whether they exist is
 * checked when the shepherd copies them, which may be on another day than the lane was written.
 */
export function inputList(v: unknown, field: string): string[] {
  if (!Array.isArray(v)) fail(field, "must be an array of paths");
  if (v.length > MAX_INPUTS) fail(field, `must list at most ${MAX_INPUTS} paths`);
  return v.map((item, i) => {
    if (typeof item !== "string" || item === "") fail(`${field}[${i}]`, "must be a non-empty string");
    if (/[\0\n\r]/.test(item)) fail(`${field}[${i}]`, "must not contain NUL or a newline");
    return item;
  });
}

/**
 * Reads and validates a lane file. `lanePath` is resolved against the project root; `brief` and `schema` are kept as
 * written (project-relative) after checking that they stay inside the project, exist and hit neither the built-in
 * credential list nor `credentialPaths` (config.credentialPaths).
 */
export function loadLane(projectRoot: string, lanePath: string, credentialPaths: readonly string[] = []): LaneSpec {
  const file = resolve(projectRoot, lanePath);
  const raw = readJsonFile(file);
  if (raw === null) throw new ArbabError("usage", `lane file ${lanePath} does not exist`);
  const obj = record(raw, lanePath);
  knownKeys(obj, LANE_KEYS, "");

  const lane: LaneSpec = {
    name: worktreeName(obj.name, "name"),
    role: role(obj.role, "role"),
    brief: existingFile(projectRoot, obj.brief, "brief", credentialPaths),
  };
  if (obj.base !== undefined) lane.base = ref(obj.base, "base");
  if (obj.tools !== undefined) lane.tools = toolList(obj.tools, "tools");
  Object.assign(lane, phaseLaneFields(projectRoot, obj, "", credentialPaths));
  if (obj.coordination !== undefined) {
    if (typeof obj.coordination !== "string") fail("coordination", "must be a string");
    lane.coordination = obj.coordination;
  }
  if (obj.upstream !== undefined) lane.upstream = nameArray(obj.upstream, "upstream");
  if (obj.mergeBranches !== undefined) {
    // Each one becomes a git argument, so the ref rule applies.
    if (!Array.isArray(obj.mergeBranches)) fail("mergeBranches", "must be an array of branch names");
    lane.mergeBranches = obj.mergeBranches.map((b, i) => ref(b, `mergeBranches[${i}]`));
  }
  return lane;
}
