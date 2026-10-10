import type { LaneSpec, ProjectConfig, Role, RoleDefaults } from "../types";
import { ArbabError } from "../util/errors";

// Role presets (DESIGN.md §4).

const WRITE_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "Bash"];

function preset(d: RoleDefaults): RoleDefaults {
  Object.freeze(d.tools);
  return Object.freeze(d);
}

export const ROLE_DEFAULTS: Readonly<Record<Role, RoleDefaults>> = Object.freeze({
  implementer: preset({
    tools: [...WRITE_TOOLS],
    model: "claude-opus-5-5",
    effort: "high",
    budgetUsd: 10,
    wallMin: 60,
    idleMin: 20,
    loopback: true,
    checkpoint: true,
    autoResume: true,
    maxAttempts: 4,
  }),
  verifier: preset({
    tools: [...WRITE_TOOLS],
    model: "claude-opus-5-5",
    effort: "high",
    budgetUsd: 10,
    wallMin: 60,
    idleMin: 20,
    loopback: true,
    checkpoint: true,
    autoResume: true,
    maxAttempts: 4,
  }),
  reviewer: preset({
    tools: ["Read", "Glob", "Grep", "Bash"],
    model: "claude-opus-5-5",
    effort: "high",
    budgetUsd: 5,
    wallMin: 30,
    idleMin: 15,
    loopback: false,
    checkpoint: false,
    autoResume: true,
    maxAttempts: 3,
  }),
  researcher: preset({
    tools: ["WebSearch", "WebFetch"],
    model: "claude-opus-5-5",
    effort: "medium",
    budgetUsd: 5,
    wallMin: 40,
    idleMin: 15,
    loopback: false,
    checkpoint: false,
    autoResume: true,
    maxAttempts: 3,
  }),
  probe: preset({
    tools: ["Read", "Write", "Bash"],
    model: "claude-haiku-5-5",
    effort: "low",
    budgetUsd: 0.5,
    wallMin: 10,
    idleMin: 5,
    loopback: true,
    checkpoint: false,
    autoResume: false,
    maxAttempts: 1,
  }),
});

/** The role's preset overlaid with `config.roles[role]`; a fresh, mutable copy. */
export function resolveRole(config: ProjectConfig, role: Role): RoleDefaults {
  const out: RoleDefaults = { ...ROLE_DEFAULTS[role], tools: [...ROLE_DEFAULTS[role].tools] };
  const overrides = config.roles[role] ?? {};
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) Object.assign(out, { [key]: Array.isArray(value) ? [...value] : value });
  }
  return out;
}

/**
 * The role preset, overlaid with config.roles and then with the lane's own fields. The lane's `tools` only narrow:
 * the role's tools that the lane lists, in the role's order, so a lane can drop Write but never gain it.
 */
export function effectiveRole(config: ProjectConfig, lane: LaneSpec): RoleDefaults {
  const r = resolveRole(config, lane.role);
  const listed = lane.tools;
  const tools = listed === undefined ? r.tools : r.tools.filter((t) => listed.includes(t));
  if (tools.length === 0) {
    throw new ArbabError("config", `lane ${lane.name}: tools ${listed?.join(", ") ?? ""} name none of role ${lane.role}'s tools (${r.tools.join(", ")})`);
  }
  return {
    ...r,
    tools,
    model: lane.model ?? r.model,
    effort: lane.effort ?? r.effort,
    budgetUsd: lane.budgetUsd ?? r.budgetUsd,
    wallMin: lane.wallMin ?? r.wallMin,
    idleMin: lane.idleMin ?? r.idleMin,
    checkpoint: lane.checkpoint ?? r.checkpoint,
    autoResume: lane.autoResume ?? r.autoResume,
    maxAttempts: lane.maxAttempts ?? r.maxAttempts,
  };
}
