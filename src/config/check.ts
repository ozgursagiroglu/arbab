import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import type { Effort, Role, RoleDefaults } from "../types";
import { EFFORTS, ROLES } from "../types";
// The module itself, not ../profile's index: config needs none of the rest of the profile.
import { credentialMatcher, credentialReason } from "../profile/credentials";
import { ArbabError } from "../util/errors";
import { confine, readText } from "../util/fs";
import { isValidName } from "../util/names";

// Field checkers shared by loadConfig and loadLane. Every failure is an ArbabError("config") naming the field.

export function fail(field: string, message: string): never {
  throw new ArbabError("config", `${field}: ${message}`);
}

/** Parsed JSON, or null when the file is missing. Unreadable is io; unparsable is the author's error (config). */
export function readJsonFile(path: string): unknown {
  const text = readText(path);
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw new ArbabError("config", `${path} is not valid JSON: ${(err as Error).message}`, { cause: err });
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function record(v: unknown, field: string): Record<string, unknown> {
  if (!isRecord(v)) fail(field, "must be an object");
  return v;
}

export function knownKeys(obj: Record<string, unknown>, allowed: readonly string[], field: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) fail(field === "" ? key : `${field}.${key}`, "unknown key");
  }
}

export function nonEmptyString(v: unknown, field: string): string {
  if (typeof v !== "string" || v.trim() === "") fail(field, "must be a non-empty string");
  return v;
}

export function stringArray(v: unknown, field: string): string[] {
  if (!Array.isArray(v)) fail(field, "must be an array of strings");
  return v.map((item, i) => nonEmptyString(item, `${field}[${i}]`));
}

/** An argv: a non-empty array of non-empty strings. */
export function argv(v: unknown, field: string): string[] {
  if (!Array.isArray(v) || v.length === 0) fail(field, "must be a non-empty array of strings");
  return stringArray(v, field);
}

export function boolean(v: unknown, field: string): boolean {
  if (typeof v !== "boolean") fail(field, "must be true or false");
  return v;
}

export function positiveNumber(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) fail(field, "must be a positive number");
  return v;
}

export function integerIn(v: unknown, lo: number, hi: number, field: string): number {
  if (!Number.isInteger(v) || (v as number) < lo || (v as number) > hi) {
    fail(field, `must be an integer from ${lo} to ${hi}`);
  }
  return v as number;
}

export function name(v: unknown, field: string): string {
  if (!isValidName(v)) fail(field, `${JSON.stringify(v)} must match ^[a-z0-9][a-z0-9-]{0,47}$`);
  return v;
}

export function nameArray(v: unknown, field: string): string[] {
  if (!Array.isArray(v)) fail(field, "must be an array of names");
  return v.map((item, i) => name(item, `${field}[${i}]`));
}

export function role(v: unknown, field: string): Role {
  if (!ROLES.includes(v as Role)) fail(field, `must be one of ${ROLES.join(", ")}`);
  return v as Role;
}

export function effort(v: unknown, field: string): Effort {
  if (!EFFORTS.includes(v as Effort)) fail(field, `must be one of ${EFFORTS.join(", ")}`);
  return v as Effort;
}

/** A git ref given to git as an argument: a leading "-" would be read as an option. */
export function ref(v: unknown, field: string): string {
  const s = nonEmptyString(v, field);
  if (s.startsWith("-") || /\s/.test(s)) fail(field, "must not start with '-' or contain whitespace");
  return s;
}

/** Lexically confined to the project; returns the absolute path. */
export function confined(root: string, v: unknown, field: string): string {
  const s = nonEmptyString(v, field);
  try {
    return confine(root, s);
  } catch {
    return fail(field, `${s} is outside the project`);
  }
}

/**
 * An existing file inside the project, returned as written. Confined lexically, then again after resolving symlinks,
 * so a link inside the project cannot point outside it. Its contents go into workers' prompts: neither spelling may hit
 * the credential list (`.env*`, `*.pem`, `*.key`, …) plus `credentialPaths` (config.credentialPaths). No homes, so
 * `~/` entries match nothing; the name rules look only below the project root, which may itself sit under a directory
 * named like a credential.
 */
export function existingFile(projectRoot: string, v: unknown, field: string, credentialPaths: readonly string[] = []): string {
  const s = nonEmptyString(v, field);
  const credential = credentialMatcher(credentialPaths, []);
  const full = confined(projectRoot, s, field);
  const hit = credential(full, projectRoot);
  if (hit !== null) fail(field, `${s} ${credentialReason(hit)}; its text would go into a worker's prompt`);
  let real: string;
  try {
    if (!statSync(full).isFile()) fail(field, `${s} is not a file`);
    real = realpathSync(full);
  } catch (err) {
    if (err instanceof ArbabError) throw err;
    return fail(field, `${s} does not exist`);
  }
  const realRoot = realpathSync(projectRoot);
  const rel = relative(realRoot, real);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail(field, `${s} resolves outside the project`);
  const realHit = credential(real, realRoot);
  if (realHit !== null) fail(field, `${s} resolves to ${real}, which ${credentialReason(realHit)}; its text would go into a worker's prompt`);
  return s;
}

export const ROLE_FIELDS:readonly (keyof RoleDefaults)[] = [
  "tools",
  "model",
  "effort",
  "budgetUsd",
  "wallMin",
  "idleMin",
  "loopback",
  "checkpoint",
  "autoResume",
  "maxAttempts",
];

export const MAX_ATTEMPTS = 10;

/** A partial RoleDefaults (config `roles.<role>`); unknown fields are errors. */
export function roleOverrides(v: unknown, field: string): Partial<RoleDefaults> {
  const obj = record(v, field);
  knownKeys(obj, ROLE_FIELDS, field);
  const out: Partial<RoleDefaults> = {};
  const f = (key: string): string => `${field}.${key}`;
  if (obj.tools !== undefined) out.tools = stringArray(obj.tools, f("tools"));
  if (obj.model !== undefined) out.model = nonEmptyString(obj.model, f("model"));
  if (obj.effort !== undefined) out.effort = effort(obj.effort, f("effort"));
  if (obj.budgetUsd !== undefined) out.budgetUsd = positiveNumber(obj.budgetUsd, f("budgetUsd"));
  if (obj.wallMin !== undefined) out.wallMin = positiveNumber(obj.wallMin, f("wallMin"));
  if (obj.idleMin !== undefined) out.idleMin = positiveNumber(obj.idleMin, f("idleMin"));
  if (obj.loopback !== undefined) out.loopback = boolean(obj.loopback, f("loopback"));
  if (obj.checkpoint !== undefined) out.checkpoint = boolean(obj.checkpoint, f("checkpoint"));
  if (obj.autoResume !== undefined) out.autoResume = boolean(obj.autoResume, f("autoResume"));
  if (obj.maxAttempts !== undefined) out.maxAttempts = integerIn(obj.maxAttempts, 1, MAX_ATTEMPTS, f("maxAttempts"));
  return out;
}
