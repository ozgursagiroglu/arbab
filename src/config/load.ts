import { join, sep } from "node:path";
import { INTEGRATIONS_DIR, TIERS } from "../types";
import type { DependencyStrategy, ProjectConfig, Role, RoleDefaults, Tier } from "../types";
import { isForbiddenWorkerEnv, isReservedEnv } from "../util/env-policy";
import {
  argv,
  confined,
  existingFile,
  fail,
  integerIn,
  knownKeys,
  name,
  nonEmptyString,
  readJsonFile,
  record,
  ref,
  role,
  roleOverrides,
  stringArray,
} from "./check";

export const CONFIG_FILE = "arbab.config.json";

const TOP_LEVEL_KEYS: readonly (keyof ProjectConfig)[] = [
  "baseBranch",
  "worktreeRoot",
  "runsRoot",
  "instructions",
  "dependencies",
  "commands",
  "env",
  "passEnv",
  "credentialPaths",
  "resources",
  "semaphores",
  "gates",
  "preflight",
  "maxParallel",
  "quota",
  "roles",
  "minClaudeVersion",
  "verify",
  "review",
  "landing",
];

/** Every default; a fresh object per call so callers may mutate the result. */
export function defaultConfig(): ProjectConfig {
  return {
    baseBranch: "main",
    worktreeRoot: ".arbab/worktrees",
    runsRoot: ".arbab/runs",
    instructions: [],
    dependencies: { strategy: "none" },
    commands: {},
    env: {},
    passEnv: [],
    credentialPaths: [],
    resources: {},
    semaphores: {},
    gates: [],
    preflight: { steps: [] },
    maxParallel: 4,
    quota: { holdAbove: { fiveHour: 0.85, sevenDay: 0.95 } },
    roles: {},
    minClaudeVersion: "2.1.290",
    verify: { smoke: null },
    review: { lenses: {} },
    landing: { tier: "medium", squash: false },
    fence: { readableEnvFiles: [], bashOutputMaxChars: 100000 },
    hostGates: [],
  };
}

const SHELL_META = /[;&|`$<>()\\\n\r]/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const VERSION = /^\d+\.\d+\.\d+$/;

/** Reads `<projectRoot>/arbab.config.json` (missing = all defaults) and returns a fully filled, validated config. */
export function loadConfig(projectRoot: string): ProjectConfig {
  const raw = readJsonFile(join(projectRoot, CONFIG_FILE));
  const config = defaultConfig();
  if (raw === null) return config;
  const obj = record(raw, CONFIG_FILE);
  knownKeys(obj, TOP_LEVEL_KEYS, "");

  if (obj.baseBranch !== undefined) config.baseBranch = ref(obj.baseBranch, "baseBranch");
  if (obj.worktreeRoot !== undefined) config.worktreeRoot = arbabRoot(projectRoot, obj.worktreeRoot, "worktreeRoot");
  if (obj.runsRoot !== undefined) config.runsRoot = arbabRoot(projectRoot, obj.runsRoot, "runsRoot");
  if (obj.instructions !== undefined) {
    // Inlined into every prompt, so a symlink to a credential file must not get through.
    config.instructions = stringArray(obj.instructions, "instructions").map((p, i) =>
      existingFile(projectRoot, p, `instructions[${i}]`),
    );
  }
  if (obj.dependencies !== undefined) config.dependencies = dependencies(obj.dependencies);
  if (obj.commands !== undefined) config.commands = commands(obj.commands);
  if (obj.env !== undefined) config.env = env(obj.env);
  if (obj.passEnv !== undefined) config.passEnv = passEnv(obj.passEnv);
  if (obj.credentialPaths !== undefined) config.credentialPaths = stringArray(obj.credentialPaths, "credentialPaths");
  if (obj.resources !== undefined) config.resources = resources(obj.resources);
  if (obj.semaphores !== undefined) config.semaphores = semaphores(obj.semaphores);
  if (obj.gates !== undefined) config.gates = argvList(obj.gates, "gates");
  if (obj.preflight !== undefined) {
    const pre = record(obj.preflight, "preflight");
    knownKeys(pre, ["steps"], "preflight");
    if (pre.steps !== undefined) config.preflight = { steps: argvList(pre.steps, "preflight.steps") };
  }
  if (obj.maxParallel !== undefined) config.maxParallel = integerIn(obj.maxParallel, 1, 32, "maxParallel");
  if (obj.quota !== undefined) config.quota = quota(obj.quota, config.quota);
  if (obj.roles !== undefined) config.roles = roles(obj.roles);
  if (obj.minClaudeVersion !== undefined) {
    const v = nonEmptyString(obj.minClaudeVersion, "minClaudeVersion");
    if (!VERSION.test(v)) fail("minClaudeVersion", `${JSON.stringify(v)} must be x.y.z`);
    config.minClaudeVersion = v;
  }
  if (obj.verify !== undefined) {
    const v = record(obj.verify, "verify");
    knownKeys(v, ["smoke"], "verify");
    if (v.smoke !== undefined) config.verify = { smoke: v.smoke === null ? null : argv(v.smoke, "verify.smoke") };
  }
  if (obj.review !== undefined) {
    const r = record(obj.review, "review");
    knownKeys(r, ["lenses"], "review");
    if (r.lenses !== undefined) config.review = { lenses: lenses(r.lenses) };
  }
  if (obj.landing !== undefined) {
    const l = record(obj.landing, "landing");
    knownKeys(l, ["tier"], "landing");
    if (l.tier !== undefined) config.landing = { ...config.landing, tier: tier(l.tier) };
  }
  return config;
}

// A lens name becomes a lane-name suffix (<integration>-review-<lens>); its text goes into a reviewer's brief.
function lenses(v: unknown): Record<string, string> {
  const obj = record(v, "review.lenses");
  const out: Record<string, string> = {};
  for (const [key, text] of Object.entries(obj)) {
    name(key, `review.lenses key ${JSON.stringify(key)}`);
    const t = nonEmptyString(text, `review.lenses.${key}`);
    if (t.length > 2000) fail(`review.lenses.${key}`, "must be at most 2000 characters");
    out[key] = t;
  }
  return out;
}

function tier(v: unknown): Tier {
  if (typeof v !== "string" || !(TIERS as readonly string[]).includes(v)) fail("landing.tier", `must be one of ${TIERS.join(", ")}`);
  return v as Tier;
}

// arbab owns these directories, so the project root itself is refused as well as anything outside it.

function arbabRoot(projectRoot: string, v: unknown, field: string): string {
  const s = nonEmptyString(v, field);
  const path = confined(projectRoot, s, field);
  if (path === confined(projectRoot, ".", field)) fail(field, "must not be the project root");
  // Integration records vouch for install points (depsConfirmedAt): no worker's worktree or run dir may overlap them.
  const records = confined(projectRoot, INTEGRATIONS_DIR, field);
  const inside = (a: string, b: string): boolean => a === b || a.startsWith(`${b}${sep}`);
  if (inside(path, records) || inside(records, path)) fail(field, `must not overlap ${INTEGRATIONS_DIR}, where integration records live`);
  return s;
}

function dependencies(v: unknown): DependencyStrategy {
  const obj = record(v, "dependencies");
  if (obj.strategy === "none") {
    knownKeys(obj, ["strategy"], "dependencies");
    return { strategy: "none" };
  }
  if (obj.strategy === "command") {
    knownKeys(obj, ["strategy", "command"], "dependencies");
    return { strategy: "command", command: argv(obj.command, "dependencies.command") };
  }
  return fail("dependencies.strategy", 'must be "none" or "command"');
}

function commands(v: unknown): Partial<Record<Role, string[]>> {
  const obj = record(v, "commands");
  const out: Partial<Record<Role, string[]>> = {};
  for (const [key, list] of Object.entries(obj)) {
    const r = role(key, `commands.${key}`);
    out[r] = stringArray(list, `commands.${key}`).map((prefix, i) => {
      if (SHELL_META.test(prefix)) fail(`commands.${key}[${i}]`, `${JSON.stringify(prefix)} contains a shell metacharacter`);
      return prefix;
    });
  }
  return out;
}

function env(v: unknown): Record<string, string> {
  const obj = record(v, "env");
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!ENV_NAME.test(key)) fail(`env.${key}`, "is not a valid environment variable name");
    if (isReservedEnv(key)) fail(`env.${key}`, "is reserved");
    if (typeof value !== "string") fail(`env.${key}`, "must be a string");
    out[key] = value;
  }
  return out;
}

function passEnv(v: unknown): string[] {
  return stringArray(v, "passEnv").map((key, i) => {
    if (!ENV_NAME.test(key)) fail(`passEnv[${i}]`, `${JSON.stringify(key)} is not a valid environment variable name`);
    // ANTHROPIC_API_KEY may be passed through for API-key users; session and editor markers may not.
    if (isForbiddenWorkerEnv(key)) fail(`passEnv[${i}]`, `${key} may not be passed through`);
    return key;
  });
}

function resources(v: unknown): Record<string, { range: [number, number] }> {
  const obj = record(v, "resources");
  const out: Record<string, { range: [number, number] }> = {};
  for (const [key, spec] of Object.entries(obj)) {
    const field = `resources.${key}`;
    name(key, field);
    const s = record(spec, field);
    knownKeys(s, ["range"], field);
    const range = s.range;
    if (!Array.isArray(range) || range.length !== 2) fail(`${field}.range`, "must be [lo, hi]");
    const [lo, hi] = key === "port" ? [1024, 65535] : [0, Number.MAX_SAFE_INTEGER];
    const a = integerIn(range[0], lo, hi, `${field}.range[0]`);
    const b = integerIn(range[1], lo, hi, `${field}.range[1]`);
    if (a > b) fail(`${field}.range`, "lo must not exceed hi");
    out[key] = { range: [a, b] };
  }
  return out;
}

function semaphores(v: unknown): Record<string, number> {
  const obj = record(v, "semaphores");
  const out: Record<string, number> = {};
  for (const [key, capacity] of Object.entries(obj)) {
    name(key, `semaphores.${key}`);
    out[key] = integerIn(capacity, 1, Number.MAX_SAFE_INTEGER, `semaphores.${key}`);
  }
  return out;
}

function argvList(v: unknown, field: string): string[][] {
  if (!Array.isArray(v)) fail(field, "must be an array of argv arrays");
  return v.map((item, i) => argv(item, `${field}[${i}]`));
}

function quota(v: unknown, defaults: ProjectConfig["quota"]): ProjectConfig["quota"] {
  const obj = record(v, "quota");
  knownKeys(obj, ["holdAbove"], "quota");
  const holdAbove = { ...defaults.holdAbove };
  if (obj.holdAbove !== undefined) {
    const h = record(obj.holdAbove, "quota.holdAbove");
    knownKeys(h, ["fiveHour", "sevenDay"], "quota.holdAbove");
    if (h.fiveHour !== undefined) holdAbove.fiveHour = threshold(h.fiveHour, "quota.holdAbove.fiveHour");
    if (h.sevenDay !== undefined) holdAbove.sevenDay = threshold(h.sevenDay, "quota.holdAbove.sevenDay");
  }
  return { holdAbove };
}

function threshold(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > 1) fail(field, "must be in (0, 1]");
  return v;
}

function roles(v: unknown): Partial<Record<Role, Partial<RoleDefaults>>> {
  const obj = record(v, "roles");
  const out: Partial<Record<Role, Partial<RoleDefaults>>> = {};
  for (const [key, overrides] of Object.entries(obj)) {
    out[role(key, `roles.${key}`)] = roleOverrides(overrides, `roles.${key}`);
  }
  return out;
}
