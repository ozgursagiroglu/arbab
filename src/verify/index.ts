// Verification inside the fence (DESIGN.md §17): the gates and smoke command run worker-written code, so a probe
// lane runs them and the exit codes are read from the stream's tool results, never from the model's report.
import { contentBlocks, toolResultText } from "../stream";
import { isRecord, stringOrNull } from "../stream/json";
import type { JsonRecord } from "../stream/json";
import type { GateResult, LaneSpec, VerifyRecord } from "../types";
import { assertValidName } from "../util/names";

/** The Bash timeout the brief asks for: the tool's maximum, since gates can be slow. */
export const VERIFY_TIMEOUT_MS = 900_000;

// Anything outside these characters may mean something to the shell (`;`, `|`, `$`, `*`, …), so it is quoted. The
// empty argument is quoted too, so that it survives the round trip.
const NEEDS_QUOTES = /[^A-Za-z0-9_./:@%+=,-]|^$/;

/**
 * The argv as one command line, POSIX-quoted only where needed, so every argument stays one literal word. The same
 * text goes into the brief, the allow rule and the stream lookup, so the three always agree.
 */
export function commandLine(argv: string[]): string {
  return argv.map((arg) => (NEEDS_QUOTES.test(arg) ? `'${arg.replace(/'/g, "'\\''")}'` : arg)).join(" ");
}

interface Expected {
  kind: GateResult["kind"];
  argv: string[];
  command: string;
}

function expectedCommands(gates: string[][], smoke: string[] | null): Expected[] {
  const out: Expected[] = gates.map((argv) => ({ kind: "gate", argv, command: commandLine(argv) }));
  if (smoke !== null) out.push({ kind: "smoke", argv: smoke, command: commandLine(smoke) });
  return out;
}

export function verifyBrief(gates: string[][], smoke: string[] | null): string {
  const commands = expectedCommands(gates, smoke);
  return [
    "# Verify",
    "",
    "## Task",
    "",
    "Run each command below exactly once, in order, as its own Bash call in the foreground, with the Bash timeout " +
      `parameter set to ${VERIFY_TIMEOUT_MS}. Do not edit any file and do not try to fix a failing command.`,
    "",
    // "Run" makes each one a command span, so lint checks it against the lane's allow rules before launch.
    ...commands.map((c, i) => `${i + 1}. Run \`${c.command}\``),
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
 * integration head merged on top of it.
 */
export function verifyLaneSpec(input: {
  name: string;
  brief: string;
  gates: string[][];
  smoke: string[] | null;
  base: string;
  mergeBranches?: string[];
}): LaneSpec {
  assertValidName(input.name, "integration name");
  const name = assertValidName(`${input.name}-verify`, "verify lane");
  return {
    name,
    role: "probe",
    // Without Write the lane cannot change the tree it verifies; a test's output could otherwise steer it into an edit.
    tools: ["Read", "Bash"],
    brief: input.brief,
    base: input.base,
    ...(input.mergeBranches === undefined ? {} : { mergeBranches: [...input.mergeBranches] }),
    // Exact rules, no wildcard: the lane may run these commands and nothing else of its own choosing.
    allow: expectedCommands(input.gates, input.smoke).map((c) => `Bash(${c.command})`),
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
 * Each expected command's exit code from the stream: the first Bash call with exactly that command line decides. A
 * rerun is ignored, so a gate that failed cannot pass after something changed the tree in between.
 */
export function gateResults(events: unknown[], gates: string[][], smoke: string[] | null): GateResult[] {
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
  return expectedCommands(gates, smoke).map(({ kind, argv, command }) => {
    const id = firstCall.get(command);
    return { kind, argv, command, exitCode: exitCodeOf(id !== undefined ? results.get(id) : undefined) };
  });
}

/** verify.json: a VerifyRecord, plus why it failed when the exit codes alone do not say. */
/** The record; any `reasons` (the lane ran on other code, left changes behind) fail it whatever the exit codes. */
export function verifyRecord(input: {
  name: string;
  lane: string;
  attempt: number | null;
  headSha: string;
  results: GateResult[];
  now: string;
  reasons?: string[];
}): VerifyRecord {
  const reasons = input.reasons ?? [];
  return {
    name: input.name,
    lane: input.lane,
    attempt: input.attempt,
    headSha: input.headSha,
    results: input.results,
    passed: reasons.length === 0 && input.results.length > 0 && input.results.every((r) => r.exitCode === 0),
    ...(reasons.length > 0 && { reason: reasons.join("; ") }),
    finishedAt: input.now,
  };
}
