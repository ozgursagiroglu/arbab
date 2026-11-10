// Verification inside the fence (DESIGN.md §17, §22): the gates and smoke command run worker-written code, so a probe
// lane runs them, each through its arbab-check script, and the exit codes are read from the stream's tool results,
// never from the model's report.
import { checkCommandLine, parseFailureLine } from "../check/command";
import { contentBlocks, toolResultText } from "../stream";
import { isRecord, stringOrNull } from "../stream/json";
import type { JsonRecord } from "../stream/json";
import type { CheckFailure, GateResult, LaneSpec, VerifyRecord } from "../types";
import { assertValidName } from "../util/names";
import { commandLine } from "../util/shell";

// readiness and host-check import it from here.
export { commandLine };

/** The Bash timeout the brief asks for: the tool's maximum, since gates can be slow. */
export const VERIFY_TIMEOUT_MS = 900_000;

/** At most this many failures are kept from one command's output, and this many in all. */
export const FAILURES_PER_RESULT = 30;
export const FAILURES_MAX = 100;

// arbab-check's marker: what follows it is the child's raw output, which the child could fill with lookalike lines.
const RAW_OUTPUT_MARKER = "--- last ";

interface Expected {
  kind: GateResult["kind"];
  argv: string[];
  /** The gate's own command line. */
  command: string;
  /** Its check's name, and the line the lane runs: `node <script> <name>`. */
  check: string;
  line: string;
}

function expectedCommands(script: string, gates: string[][], smoke: string[] | null): Expected[] {
  const out: Expected[] = gates.map((argv, i) => {
    const check = `gate-${i + 1}`;
    return { kind: "gate", argv, command: commandLine(argv), check, line: checkCommandLine(script, check) };
  });
  if (smoke !== null) out.push({ kind: "smoke", argv: smoke, command: commandLine(smoke), check: "smoke", line: checkCommandLine(script, "smoke") });
  return out;
}

export function verifyBrief(script: string, gates: string[][], smoke: string[] | null): string {
  const commands = expectedCommands(script, gates, smoke);
  return [
    "# Verify",
    "",
    "## Task",
    "",
    "Run each command below exactly once, in order, as its own Bash call in the foreground, with the Bash timeout " +
      `parameter set to ${VERIFY_TIMEOUT_MS}. Do not edit any file and do not try to fix a failing command.`,
    "",
    // "Run" makes each one a command span, so lint checks it against the lane's allow rules before launch.
    ...commands.map((c, i) => `${i + 1}. Run \`${c.line}\``),
    "",
    "## Scope",
    "",
    "Nothing is written: this lane only runs the commands above.",
    "",
    "## Acceptance",
    "",
    "- Every command above ran exactly once.",
    "",
  ].join("\n");
}

/**
 * The verify lane. `base` and `mergeBranches` come from generatedBase: a commit the install may run on, and the
 * integration head merged on top of it. `script` is the lane's arbab-check (checkScriptPath).
 */
export function verifyLaneSpec(input: {
  name: string;
  brief: string;
  script: string;
  gates: string[][];
  smoke: string[] | null;
  base: string;
  mergeBranches?: string[];
}): LaneSpec {
  assertValidName(input.name, "integration name");
  const name = assertValidName(`${input.name}-verify`, "verify lane");
  const commands = expectedCommands(input.script, input.gates, input.smoke);
  return {
    name,
    role: "probe",
    // Without Write the lane cannot change the tree it verifies; a test's output could otherwise steer it into an edit.
    tools: ["Read", "Bash"],
    brief: input.brief,
    base: input.base,
    ...(input.mergeBranches === undefined ? {} : { mergeBranches: [...input.mergeBranches] }),
    // Exact rules, no wildcard: the lane may run these commands and nothing else of its own choosing.
    allow: commands.map((c) => `Bash(${c.line})`),
    checks: Object.fromEntries(commands.map((c) => [c.check, [...c.argv]])),
    checkpoint: false,
    autoResume: true,
    maxAttempts: 2,
    wallMin: 60,
    idleMin: 20,
  };
}

// Claude Code's own prefix, at the very start: the rest of the text is the command's output, which worker code wrote.
const EXIT_CODE = /^Exit code (\d+)/;

function exitCodeOf(result: JsonRecord | undefined): number | null {
  if (result === undefined) return null;
  if (result.is_error !== true) return 0;
  const match = EXIT_CODE.exec(toolResultText(result.content));
  // An error without an exit code is a refusal or a sandbox block: the command never ran.
  return match?.[1] !== undefined ? Number(match[1]) : null;
}

/**
 * Each expected command with the tool result of the first Bash call with exactly its line. A rerun is ignored, so a
 * gate that failed cannot pass after something changed the tree in between.
 */
function firstResults(events: unknown[], script: string, gates: string[][], smoke: string[] | null): Array<{ expected: Expected; result: JsonRecord | undefined }> {
  const firstCall = new Map<string, string>();
  const results = new Map<string, JsonRecord>();
  for (const event of Array.isArray(events) ? events : []) {
    for (const block of contentBlocks(event)) {
      if (block.type === "tool_use" && block.name === "Bash" && isRecord(block.input)) {
        const id = stringOrNull(block.id);
        const command = stringOrNull(block.input.command)?.trim() ?? null;
        if (id !== null && command !== null && !firstCall.has(command)) firstCall.set(command, id);
      } else if (block.type === "tool_result") {
        const id = stringOrNull(block.tool_use_id);
        if (id !== null) results.set(id, block);
      }
    }
  }
  return expectedCommands(script, gates, smoke).map((expected) => {
    const id = firstCall.get(expected.line);
    return { expected, result: id !== undefined ? results.get(id) : undefined };
  });
}

/** Each expected command's exit code from the stream; `command` stays the gate's own line, for readiness and land. */
export function gateResults(events: unknown[], script: string, gates: string[][], smoke: string[] | null): GateResult[] {
  return firstResults(events, script, gates, smoke).map(({ expected: { kind, argv, command }, result }) => ({
    kind,
    argv,
    command,
    exitCode: exitCodeOf(result),
  }));
}

/**
 * The failures arbab-check printed for each command that failed (an exit code other than 0 or null), with the index
 * of its result: only the summary lines before the raw-output marker count, at most FAILURES_PER_RESULT per command
 * and FAILURES_MAX in all.
 */
export function gateFailures(events: unknown[], script: string, gates: string[][], smoke: string[] | null): Array<{ result: number } & CheckFailure> {
  const out: Array<{ result: number } & CheckFailure> = [];
  firstResults(events, script, gates, smoke).forEach(({ result }, index) => {
    const code = exitCodeOf(result);
    if (result === undefined || code === null || code === 0) return;
    let kept = 0;
    for (const line of toolResultText(result.content).split(/\r?\n/)) {
      if (line.startsWith(RAW_OUTPUT_MARKER) || kept >= FAILURES_PER_RESULT || out.length >= FAILURES_MAX) break;
      const failure = parseFailureLine(line);
      if (failure === null) continue;
      out.push({ result: index, ...failure });
      kept++;
    }
  });
  return out;
}

/**
 * verify.json. Any `reasons` (the lane ran on other code, left changes behind) fail it whatever the exit codes;
 * `failures` (gateFailures) are written only when there is one.
 */
export function verifyRecord(input: {
  name: string;
  lane: string;
  attempt: number | null;
  headSha: string;
  results: GateResult[];
  now: string;
  reasons?: string[];
  failures?: Array<{ result: number } & CheckFailure>;
}): VerifyRecord {
  const reasons = input.reasons ?? [];
  const failures = input.failures ?? [];
  return {
    name: input.name,
    lane: input.lane,
    attempt: input.attempt,
    headSha: input.headSha,
    results: input.results,
    passed: reasons.length === 0 && input.results.length > 0 && input.results.every((r) => r.exitCode === 0),
    ...(reasons.length > 0 && { reason: reasons.join("; ") }),
    ...(failures.length > 0 && { failures }),
    finishedAt: input.now,
  };
}
