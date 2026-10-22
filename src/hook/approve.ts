import { isAbsolute } from "node:path";
import { tokenize } from "./command";

/** What the PreToolUse hook prints to approve a call; nothing else is ever printed by it. */
export const APPROVAL = JSON.stringify({
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "arbab runner" },
});

/** Commands never approved: the shepherd is the runner's own child, and the hook is Claude Code's to call. */
const NEVER = new Set(["__shepherd", "hook"]);

export interface ApproveOptions {
  /** The runner file this process runs from. */
  scriptPath: string;
  /** The runner's command names (the keys of COMMANDS). */
  commands: readonly string[];
  /** The real path of a file; throws when there is none. */
  realpath: (path: string) => string;
}

function sameFile(a: string, b: string, realpath: (path: string) => string): boolean {
  try {
    return realpath(a) === realpath(b);
  } catch {
    return false;
  }
}

/**
 * Whether `command` is a bare runner call: `node <runner> [-C <dir>] <command> [words…]`, where <runner> is an
 * absolute path to the same file as `scriptPath` and <command> is a runner command other than `__shepherd` and `hook`.
 */
export function isRunnerCall(command: string, opts: ApproveOptions): boolean {
  const words = tokenize(command);
  if (words === null || words.length < 3) return false;
  const [node, runner] = words;
  if (node?.value !== "node" || runner === undefined) return false;
  // Absolute only: a relative path would resolve against a working directory the hook cannot be sure of.
  if (!isAbsolute(runner.value) || !sameFile(runner.value, opts.scriptPath, opts.realpath)) return false;
  let at = 2;
  if (words[at]?.value === "-C") at += 2;
  const name = words[at]?.value;
  return name !== undefined && !NEVER.has(name) && opts.commands.includes(name);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const STRING_FIELDS = ["session_id", "transcript_path", "cwd", "permission_mode", "tool_use_id"];

/** Whether the PreToolUse hook input (raw stdin) asks to run a bare runner call; false for anything malformed. */
export function approves(input: string, opts: ApproveOptions): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input) as unknown;
  } catch {
    return false;
  }
  if (!isObject(parsed)) return false;
  for (const field of STRING_FIELDS) {
    if (parsed[field] !== undefined && typeof parsed[field] !== "string") return false;
  }
  if (parsed.hook_event_name !== undefined && parsed.hook_event_name !== "PreToolUse") return false;
  if (parsed.tool_name !== "Bash" || !isObject(parsed.tool_input)) return false;
  const command = parsed.tool_input.command;
  return typeof command === "string" && isRunnerCall(command, opts);
}
