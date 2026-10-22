import { listShepherds, listWaiters } from "../registry";
import type { ShepherdEntry } from "../types";
import { shellWord } from "./command";

/** How many lanes the reason names; the rest are counted. */
export const NAMED_LANES = 5;

export interface StopOptions {
  /** ~/.arbab */
  home: string;
  alive: (pid: number) => boolean;
  /** The runner file this process runs from. */
  scriptPath: string;
  /** The hook process's working directory, used when the input has no `cwd`. */
  cwd: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The runner path as `node "<path>"` writes it, unless double quotes would not keep it literal. */
function runnerWord(path: string): string {
  return /[$`\\!"]/.test(path) ? shellWord(path) : `"${path}"`;
}

/** The command that starts a waiter for `lanes`, with `-C` when they share one project other than `cwd`. */
export function waitCommand(scriptPath: string, lanes: readonly ShepherdEntry[], cwd: string): string {
  const projects = new Set(lanes.map((l) => l.project));
  const [project] = projects;
  const dir = projects.size === 1 && project !== undefined && project !== cwd ? ` -C ${shellWord(project)}` : "";
  return `node ${runnerWord(scriptPath)}${dir} wait --any`;
}

/** Why the orchestrator may not stop yet: its unwatched lanes and the command to watch them. */
export function blockReason(lanes: readonly ShepherdEntry[], scriptPath: string, cwd: string): string {
  const named = lanes.slice(0, NAMED_LANES).map((l) => `${l.lane} (${l.project})`);
  const more = lanes.length > NAMED_LANES ? ` and ${lanes.length - NAMED_LANES} more` : "";
  const subject = lanes.length === 1 ? "lane is" : "lanes are";
  return (
    `arbab: ${lanes.length} ${subject} still running for this session and no \`arbab wait\` is running for them: ` +
    `${named.join(", ")}${more}. Start one in the background (run_in_background) so their results reach you: ` +
    waitCommand(scriptPath, lanes, cwd)
  );
}

/**
 * The Stop hook's answer to its input (raw stdin): a block decision when this session owns live shepherds and no live
 * waiter, else null. Malformed input, a stop already continued by a stop hook, or a missing session id is null.
 */
export function stopDecision(input: string, opts: StopOptions): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input) as unknown;
  } catch {
    return null;
  }
  if (!isObject(parsed)) return null;
  const { session_id: session, stop_hook_active: active, cwd } = parsed;
  if (typeof session !== "string" || session === "") return null;
  if (active !== undefined && typeof active !== "boolean") return null;
  if (active === true) return null;
  if (cwd !== undefined && typeof cwd !== "string") return null;
  if (parsed.hook_event_name !== undefined && parsed.hook_event_name !== "Stop") return null;

  const lanes = listShepherds(opts.home, opts.alive).filter((s) => s.owner === session);
  if (lanes.length === 0) return null;
  if (listWaiters(opts.home, opts.alive).some((w) => w.owner === session)) return null;
  return JSON.stringify({ decision: "block", reason: blockReason(lanes, opts.scriptPath, cwd ?? opts.cwd) });
}
