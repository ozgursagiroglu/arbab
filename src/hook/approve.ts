import { isAbsolute, resolve, sep } from "node:path";
import { inLaneWorktree } from "../commands/project";
import { tokenize } from "./command";

/** What the PreToolUse hook prints to approve a call; nothing else is ever printed by it. */
export const APPROVAL = JSON.stringify({
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "arbab runner" },
});

/**
 * Commands never approved: the shepherd is the runner's own child, the hook is Claude Code's to call, and `land`
 * merges into the base branch and removes worktrees, which the human confirms first.
 */
const NEVER = new Set(["__shepherd", "hook", "land"]);

/** Temporary directories `-C` is never approved into, besides the hook's TMPDIR: anyone on the machine writes there. */
export const TEMP_DIRS: readonly string[] = ["/tmp", "/private/tmp"];

export interface ApproveOptions {
  /** The runner file this process runs from. */
  scriptPath: string;
  /** The runner's command names (the keys of COMMANDS). */
  commands: readonly string[];
  /** The real path of a file, in the spelling on disk; throws when there is none. */
  realpath: (path: string) => string;
  /** The roots of the projects registered on this machine; read only for a `-C` call. */
  projectRoots: () => readonly string[];
  /** Directories `-C` is never approved into, nor anywhere under them. */
  tempDirs: readonly string[];
}

function real(path: string, realpath: (path: string) => string): string | null {
  try {
    return realpath(path);
  } catch {
    return null;
  }
}

function sameFile(a: string, b: string, realpath: (path: string) => string): boolean {
  const ra = real(a, realpath);
  return ra !== null && ra === real(b, realpath);
}

function under(base: string, path: string): boolean {
  const b = resolve(base);
  return path === b || path.startsWith(b.endsWith(sep) ? b : b + sep);
}

/**
 * Whether `-C <dir>` points at a project the human has already launched from: the runner loads that directory's
 * config, which may run commands, so a directory a worker could have written (its worktree, a temp dir) never passes.
 */
function knownProject(dir: string, opts: ApproveOptions): boolean {
  // Absolute only, as for the runner: a relative one resolves against a working directory the hook cannot be sure of.
  if (!isAbsolute(dir)) return false;
  const path = real(dir, opts.realpath);
  if (path === null || inLaneWorktree(dir, { realpath: opts.realpath })) return false;
  for (const temp of opts.tempDirs) {
    if (!isAbsolute(temp)) continue;
    const realTemp = real(temp, opts.realpath);
    if (under(temp, path) || (realTemp !== null && under(realTemp, path))) return false;
  }
  return opts.projectRoots().some((root) => isAbsolute(root) && (root === path || real(root, opts.realpath) === path));
}

/**
 * Whether `command` is a bare runner call: `node <runner> [-C <dir>] <command> [words…]`, where <runner> is an
 * absolute path to the same file as `scriptPath`, <dir> a registered project root outside lane worktrees and temp
 * dirs, and <command> a runner command other than `__shepherd`, `hook` and `land`.
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
  if (name === undefined || NEVER.has(name) || !opts.commands.includes(name)) return false;
  const dir = at === 4 ? words[3]?.value : undefined;
  return dir === undefined || knownProject(dir, opts);
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
