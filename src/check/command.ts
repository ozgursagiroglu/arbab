// The contract between the shepherd, the fence and arbab-check (DESIGN.md §22): where a lane's script lives, the exact
// command line a worker runs, and the environment the script reads. Lanes build on these; they do not change them.
import { join } from "node:path";
import { CHECKS_ENV, CHECK_POLICY_ENV, CHECK_SCRIPT_FILE, type CheckFailure, type CheckPolicy } from "../types";
import { ArbabError } from "../util/errors";
import { commandLine } from "../util/shell";

/** A check name: lowercase, digits and `-`, as a word of the command line and of an allow rule. */
export const CHECK_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function isCheckName(name: string): boolean {
  return CHECK_NAME.test(name);
}

export function assertCheckName(name: string, field = "check name"): string {
  if (!isCheckName(name)) throw new ArbabError("config", `${field} ${JSON.stringify(name)} must match ${CHECK_NAME.source}`);
  return name;
}

/**
 * `<runsRoot>/<lane>/bin/arbab-check.mjs`: in the main checkout's run directory, outside the worktree, so neither the
 * worker nor the code it runs can rewrite the script that runs its checks.
 */
export function checkScriptPath(runsRoot: string, lane: string): string {
  return join(runsRoot, lane, "bin", CHECK_SCRIPT_FILE);
}

/** `node <script> <name>`, quoted as verify quotes its gates: the same text goes into the brief, the rule and the lookup. */
export function checkCommandLine(script: string, name: string): string {
  return commandLine(["node", script, assertCheckName(name)]);
}

/** The prefix of a failure line in arbab-check's summary (DESIGN.md §22). */
export const FAILURE_PREFIX = "arbab-check failure: ";
/** A failure's message is cut to this many characters. */
export const FAILURE_MESSAGE_MAX = 300;
/** A failure's file and test are each cut to this many characters. */
export const FAILURE_FIELD_MAX = 200;

// Worker-written text reaches a terminal and a model: colour sequences go whole, then every other C0 and C1 control
// (ESC, BEL, backspace, DEL…) so nothing can move a cursor, retitle a window or hide text.
const CSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/** One line without controls, trimmed, cut to `max` characters. Applying it twice changes nothing. */
const field = (s: string, max: number): string =>
  s.replace(CSI, "").replace(/[\r\n\t]+/g, " ").replace(CONTROL, "").trim().slice(0, max).trim();

/** A field as formatFailureLine cleans it, not cut: so a caller can tell a value that would be. */
export function failureFieldText(s: string): string {
  return field(s, Number.POSITIVE_INFINITY);
}

/**
 * `arbab-check failure: <file>[ > <test>] :: <message>`, `-` for a missing file; one line without control characters,
 * the file and the test cut to 200 characters, the message to FAILURE_MESSAGE_MAX. arbab-check prints it, verify reads
 * it back (parseFailureLine).
 */
export function formatFailureLine(failure: CheckFailure): string {
  const file = failure.file === null ? "" : field(failure.file, FAILURE_FIELD_MAX);
  const test = failure.test === null ? "" : field(failure.test, FAILURE_FIELD_MAX);
  return `${FAILURE_PREFIX}${file === "" ? "-" : file}${test === "" ? "" : ` > ${test}`} :: ${field(failure.message, FAILURE_MESSAGE_MAX)}`;
}

/**
 * The failure a formatFailureLine line holds, or null for any other line. The file ends at the first ` > `. The fields
 * are cleaned and cut as formatFailureLine does, since the line may not come from it.
 */
export function parseFailureLine(line: string): CheckFailure | null {
  if (!line.startsWith(FAILURE_PREFIX)) return null;
  const body = line.slice(FAILURE_PREFIX.length);
  const split = body.indexOf(" :: ");
  if (split < 0) return null;
  const where = body.slice(0, split).trim();
  const message = field(body.slice(split + 4), FAILURE_MESSAGE_MAX);
  const gt = where.indexOf(" > ");
  const file = field(gt < 0 ? where : where.slice(0, gt), FAILURE_FIELD_MAX);
  const test = gt < 0 ? "" : field(where.slice(gt + 3), FAILURE_FIELD_MAX);
  return { file: file === "" || file === "-" ? null : file, test: test === "" ? null : test, message };
}

/** The default number of heavy checks that may run at once on a machine with `cpus` CPUs. */
export function defaultCheckConcurrency(cpus: number): number {
  return Math.max(1, Math.floor(cpus / 4));
}

/** The environment entries an attempt gets for its checks. */
export function checksEnv(checks: Record<string, string[]>, policy: CheckPolicy): Record<string, string> {
  for (const name of Object.keys(checks)) assertCheckName(name);
  return { [CHECKS_ENV]: JSON.stringify(checks), [CHECK_POLICY_ENV]: JSON.stringify(policy) };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const positiveInt = (v: unknown, min: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min;

function parsed(env: Record<string, string | undefined>, key: string): unknown {
  const text = env[key];
  if (text === undefined || text === "") throw new ArbabError("usage", `${key} is not set: this lane has no checks`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ArbabError("usage", `${key} is not valid JSON`);
  }
}

/** Reads both entries back (arbab-check's side), validated; a usage error when either is missing or malformed. */
export function readChecksEnv(env: Record<string, string | undefined>): { checks: Record<string, string[]>; policy: CheckPolicy } {
  const rawChecks = parsed(env, CHECKS_ENV);
  if (!isRecord(rawChecks)) throw new ArbabError("usage", `${CHECKS_ENV} must be an object of name → argv`);
  const checks: Record<string, string[]> = {};
  for (const [name, argv] of Object.entries(rawChecks)) {
    if (!isCheckName(name)) throw new ArbabError("usage", `${CHECKS_ENV} names an invalid check ${JSON.stringify(name)}`);
    if (!Array.isArray(argv) || argv.length === 0 || !argv.every((a) => typeof a === "string" && a !== "" && !a.includes("\0"))) {
      throw new ArbabError("usage", `${CHECKS_ENV}.${name} must be a non-empty argv of strings`);
    }
    checks[name] = [...(argv as string[])];
  }
  const rawPolicy = parsed(env, CHECK_POLICY_ENV);
  if (!isRecord(rawPolicy) || !positiveInt(rawPolicy.cpus, 1) || !positiveInt(rawPolicy.concurrent, 1) || !positiveInt(rawPolicy.waitSec, 0)) {
    throw new ArbabError("usage", `${CHECK_POLICY_ENV} must be {"cpus": n ≥ 1, "concurrent": n ≥ 1, "waitSec": n ≥ 0}`);
  }
  return { checks, policy: { cpus: rawPolicy.cpus, concurrent: rawPolicy.concurrent, waitSec: rawPolicy.waitSec } };
}
