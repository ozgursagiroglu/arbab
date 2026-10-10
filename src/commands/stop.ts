// arbab stop <lane> [--json]
//
// SIGTERMs the lane's shepherd, which kills its worker and finishes the lane as killed:stopped (no auto-resume).
// Text: `stopping <lane> (shepherd <pid>)`.
// --json: {"lane": string, "shepherdPid": number}
// Exit 1 when the lane is not running.
import { readJson } from "../util/fs";
import { runPaths, readState } from "../registry";
import { ArbabError } from "../util/errors";
import { assertValidName } from "../util/names";
import type { CommandContext } from "./context";
import { onePositional, openProject, parse, printJson } from "./project";

/**
 * True when `command` (a `ps -o command=` line) is the shepherd of `lane`: pids are recycled, so a live pid alone
 * proves nothing. The lane must appear as a whole argument, so lane "a" never matches lane "ab".
 */
export function isShepherdOf(command: string | null, lane: string): boolean {
  if (command === null) return false;
  const words = command.split(/\s+/);
  return words.includes("__shepherd") && words.includes(lane);
}

function shepherdPid(file: string): number | null {
  const value = readJson<unknown>(file);
  const pid = typeof value === "object" && value !== null ? (value as { pid?: unknown }).pid : undefined;
  return Number.isInteger(pid) && (pid as number) > 1 ? (pid as number) : null;
}

export async function runStop(argv: string[], ctx: CommandContext): Promise<number> {
  const { values, positionals } = parse("stop", {
    args: argv,
    options: { json: { type: "boolean" } },
    allowPositionals: true,
  });
  const lane = assertValidName(onePositional("stop", positionals, "lane"), "lane");
  const project = openProject(ctx);
  const paths = runPaths(project.runsRoot, lane);

  const state = readState(project.runsRoot, lane);
  if (state?.state === "finished") throw new ArbabError("usage", `lane ${lane} is not running (finished)`);
  const pid = shepherdPid(paths.shepherdFile);
  if (pid === null || !ctx.alive(pid)) throw new ArbabError("usage", `lane ${lane} is not running`);
  if (!isShepherdOf(ctx.processCommand(pid), lane)) {
    throw new ArbabError("usage", `lane ${lane} is not running: pid ${pid} is no longer its shepherd; nothing signalled`);
  }
  ctx.signal(pid, "SIGTERM");
  if (values.json === true) printJson(ctx, { lane, shepherdPid: pid });
  else ctx.stdout(`stopping ${lane} (shepherd ${pid})\n`);
  return 0;
}
