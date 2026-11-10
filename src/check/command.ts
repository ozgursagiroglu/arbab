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
  // A policy written before 0.3.1 has no `suites`: it ran every check whole.
  const suites = rawPolicy.suites === undefined ? "whole" : rawPolicy.suites;
  if (suites !== "targeted" && suites !== "whole") throw new ArbabError("usage", `${CHECK_POLICY_ENV}.suites must be "targeted" or "whole"`);
  return { checks, policy: { cpus: rawPolicy.cpus, concurrent: rawPolicy.concurrent, waitSec: rawPolicy.waitSec, suites } };
}

// ---------------------------------------------------------------------------------------------------------------
// Checks without config (DESIGN.md §23): derived from the gates, suites told apart from the rest.

const PACKAGE_MANAGERS = new Set(["pnpm", "npm", "yarn", "bun", "npx", "bunx"]);
const PM_SUBCOMMANDS = new Set(["run", "exec", "dlx", "x", "run-script"]);
// Package-manager options that take a value: their value is not the script. In pnpm `-w` is `--workspace-root` and
// `--workspace` a switch; in npm, yarn and bun both name a workspace.
const PM_VALUE_FLAGS = new Set(["-F", "--filter", "-C", "--dir", "--prefix", "--cwd", "-w", "--workspace"]);
const PNPM_SWITCHES = new Set(["-w", "--workspace"]);
// Task-runner options that take a value, so it is not read as the task. Make's `-j`/`-l` take one only when it is a
// number, handled apart.
const TASK_VALUE_FLAGS: Record<string, Set<string>> = {
  turbo: new Set(["-F", "--filter", "--cwd", "--cache-dir", "--concurrency", "--output-logs", "--log-order", "--env-mode", "--log-prefix"]),
  nx: new Set(["-p", "--projects", "-c", "--configuration", "--exclude", "--base", "--head", "--output-style"]),
  lerna: new Set(["--scope", "--ignore", "--concurrency"]),
  moon: new Set(["--log", "--log-file", "--cache", "--concurrency", "--status"]),
  make: new Set(["-C", "--directory", "-f", "--file", "--makefile", "-I", "--include-dir", "-o", "--old-file", "-W", "--what-if"]),
};
const NODE_VALUE_FLAGS = new Set(["-r", "--require", "--import", "--loader", "--experimental-loader", "-C", "--conditions"]);
const TEST_RUNNERS = new Set(["vitest", "jest", "mocha", "ava", "playwright", "cypress"]);
const BUILD_TOOLS = new Set(["tsup", "esbuild", "webpack", "rollup", "parcel"]);
const BUILDS_WITH_ARG = new Set(["next", "vite", "nest", "astro", "nuxt", "remix"]);

const base = (p: string): string => p.replace(/\\/g, "/").split("/").at(-1) ?? p;

/** The argv a package manager runs, from the script or binary on (`pnpm -F web exec eslint .` → `eslint .`). */
function unwrapPackageManager(argv: string[]): string[] {
  const program = base(argv[0] ?? "").toLowerCase();
  if (!PACKAGE_MANAGERS.has(program)) return argv;
  let rest = argv.slice(1);
  while (rest.length > 0) {
    const t = rest[0] ?? "";
    if (program === "yarn" && t === "workspace") rest = rest.slice(2);
    else if (t.startsWith("-")) {
      const takesValue = !t.includes("=") && PM_VALUE_FLAGS.has(t) && !(program === "pnpm" && PNPM_SWITCHES.has(t));
      rest = rest.slice(takesValue ? 2 : 1);
    } else if (PM_SUBCOMMANDS.has(t)) rest = rest.slice(1);
    else break;
  }
  return rest;
}

/** The positional arguments of a task runner's argv, without its options and their values. */
function positionals(runner: string, args: string[]): string[] {
  const valueFlags = TASK_VALUE_FLAGS[runner] ?? new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a === "--") break;
    if (a.startsWith("-")) {
      const next = args[i + 1];
      const numeric = runner === "make" && (a === "-j" || a === "-l") && next !== undefined && /^\d+(\.\d+)?$/.test(next);
      if ((!a.includes("=") && valueFlags.has(a)) || numeric) i++;
      continue;
    }
    // Make's variable assignments are no targets.
    if (runner === "make" && a.includes("=")) continue;
    out.push(a);
  }
  return out;
}

/** The value of nx's `-t`/`--target`/`--targets`, its first task when it lists several. */
function nxTargetFlag(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a === "--") break;
    const eq = /^(?:-t|--targets?)=(.*)$/.exec(a);
    const value = eq !== null ? eq[1] : a === "-t" || a === "--target" || a === "--targets" ? args[i + 1] : undefined;
    if (value !== undefined) return value.split(",")[0];
  }
  return undefined;
}

// `project:task[:configuration]` → `task`; a word without `:` is the task itself.
const targetTask = (t: string): string => (t.includes(":") ? (t.split(":")[1] ?? "") : t);

/** The first task a task runner's argv runs, or undefined when `runner` is none (or names no task). */
function taskOf(runner: string, args: string[]): string | undefined {
  const pos = positionals(runner, args);
  switch (runner) {
    case "turbo": {
      // `web#test` runs one package's task.
      const task = pos[0] === "run" ? pos[1] : pos[0];
      return task?.split("#").at(-1);
    }
    case "nx": {
      if (pos[0] === "run") return pos[1] === undefined ? undefined : targetTask(pos[1]);
      if (pos[0] === "run-many" || pos[0] === "affected") return nxTargetFlag(args);
      return pos[0];
    }
    case "lerna":
      return pos[0] === "run" ? pos[1] : undefined;
    case "moon":
      if (pos[0] === "run") return pos[1] === undefined ? undefined : targetTask(pos[1]);
      return pos[0]?.includes(":") ? targetTask(pos[0]) : undefined;
    case "make":
      return pos[0];
    default:
      return undefined;
  }
}

/**
 * The word an argv runs: the script or binary after a package manager and its options (`pnpm -F web typecheck` →
 * `typecheck`, `pnpm exec eslint` → `eslint`, `yarn workspace web test` → `test`), the script a bare `node` runs
 * (without its extension), the first task a task runner runs (`turbo run test`, `nx run web:test`, `nx test web`,
 * `nx run-many -t test`, `lerna run test`, `moon run web:test`, `make test` → `test`; a bare `make` → `make`), or the
 * program's own name. Lowercased; "" when there is none.
 */
export function runWord(argv: string[]): string {
  const inner = unwrapPackageManager(argv);
  if (inner.length === 0) return "";
  const program = base(inner[0] ?? "").toLowerCase();
  const rest = inner.slice(1);
  if (program === "node" && rest[0] !== undefined && !rest[0].startsWith("-")) {
    return base(rest[0]).replace(/\.(m?js|cjs|ts)$/, "").toLowerCase();
  }
  const task = taskOf(program, rest);
  return task === undefined || task === "" ? program : task.toLowerCase();
}

/** Whether a `node` argv has `--test` among the options before its script. */
function isNodeTest(argv: string[]): boolean {
  if (base(argv[0] ?? "").toLowerCase() !== "node") return false;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (!a.startsWith("-")) return false;
    if (a === "--test") return true;
    if (!a.includes("=") && NODE_VALUE_FLAGS.has(a)) i++;
  }
  return false;
}

/**
 * Whether an argv runs a test suite, judged only by what it runs (`runWord`): a test runner (vitest, jest, mocha,
 * ava, playwright, cypress), `node --test`, or a script or task named `test`, `test:*`, `test-*`, `test_*`, `*:test`,
 * `*-test` or `*_test`. A runner's name elsewhere (`eslint --plugin jest`) makes no suite.
 */
export function isSuiteArgv(argv: string[]): boolean {
  if (isNodeTest(unwrapPackageManager(argv))) return true;
  const word = runWord(argv);
  return TEST_RUNNERS.has(word) || word === "test" || /^test[:_-]/.test(word) || /[:_-]test$/.test(word);
}

/** Whether an argv builds rather than checks (a `build` script, `next build`, tsup…): such a gate is no lane check. */
export function isBuildArgv(argv: string[]): boolean {
  const word = runWord(argv);
  if (word === "build" || /^build[:_-]/.test(word) || /[:_-]build$/.test(word) || BUILD_TOOLS.has(word)) return true;
  return BUILDS_WITH_ARG.has(word) && argv.slice(1).some((a) => a === "build");
}

const looksLikePath = (a: string): boolean => a.includes("/") || /\.(test|spec|itest|e2e)\b|\.[cm]?[jt]sx?$/.test(a);

/**
 * Whether the extra arguments of a suite check name what to run: at least one positional argument that is not the
 * value of an option. A word right after an option without `=` is taken as its value (`--project unit` names a
 * project, `-t name` filters test names: both still collect every file) unless it looks like a path.
 */
export function hasTargets(extra: string[]): boolean {
  for (let i = 0; i < extra.length; i++) {
    const a = extra[i] ?? "";
    if (a.startsWith("-")) {
      const next = extra[i + 1];
      if (!a.includes("=") && next !== undefined && !next.startsWith("-") && !looksLikePath(next)) i++;
      continue;
    }
    return true;
  }
  return false;
}

/**
 * The checks a project gets without config `checks` (DESIGN.md §23): one per gate that is not a build, named by
 * `runWord` (lowercase, every other character `-`, at most 32; `gate-<i>` when nothing is left), a repeat getting `-2`,
 * `-3`…, in gate order.
 */
export function deriveChecks(gates: string[][]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  gates.forEach((argv, i) => {
    if (argv.length === 0 || isBuildArgv(argv)) return;
    let name = runWord(argv).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/, "");
    if (!isCheckName(name)) name = `gate-${i + 1}`;
    let unique = name;
    for (let n = 2; Object.hasOwn(out, unique); n++) unique = `${name.slice(0, 29)}-${n}`;
    out[unique] = [...argv];
  });
  return out;
}
