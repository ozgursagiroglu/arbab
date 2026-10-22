// arbab hook <pre-tool-use|stop>
//
// The plugin's Claude Code hooks: approve bare runner calls, keep an orchestrator with live shepherds from stopping
// unwatched (DESIGN.md §21). A hook that cannot decide prints nothing and exits 0, so Claude Code goes on as without it.
import { realpathSync } from "node:fs";
import { approves, APPROVAL, TEMP_DIRS } from "../hook/approve";
import { stopDecision } from "../hook/stop";
import { listProjects } from "../registry";
import { ArbabError } from "../util/errors";
import type { CommandContext } from "./context";
import { COMMANDS } from "./index";

export const HOOK_EVENTS = ["pre-tool-use", "stop"] as const;

async function answer(event: (typeof HOOK_EVENTS)[number], ctx: CommandContext, tempDirs: readonly string[]): Promise<string | null> {
  const input = await ctx.readStdin();
  if (event === "pre-tool-use") {
    const tmp = ctx.hostEnv["TMPDIR"];
    const ok = approves(input, {
      scriptPath: ctx.scriptPath,
      // COMMANDS is read here, not at load: index.ts imports this module.
      commands: Object.keys(COMMANDS),
      // The native one returns the spelling on disk, so a case-insensitive file system's other spellings compare equal.
      realpath: (path) => realpathSync.native(path),
      projectRoots: () => listProjects(ctx.home).map((entry) => entry.root),
      tempDirs: tmp === undefined || tmp === "" ? tempDirs : [...tempDirs, tmp],
    });
    return ok ? APPROVAL : null;
  }
  return stopDecision(input, { home: ctx.home, alive: ctx.alive, scriptPath: ctx.scriptPath, cwd: ctx.cwd });
}

/** `tempDirs`: where `-C` is never approved besides the hook's TMPDIR; a parameter so tests under them can differ. */
export async function runHook(argv: string[], ctx: CommandContext, tempDirs: readonly string[] = TEMP_DIRS): Promise<number> {
  const [event, ...rest] = argv;
  if (event !== "pre-tool-use" && event !== "stop") {
    throw new ArbabError("usage", `hook takes one of ${HOOK_EVENTS.join(", ")}, got ${JSON.stringify(event ?? "")}`);
  }
  if (rest.length > 0) throw new ArbabError("usage", `hook ${event} takes no arguments`);
  let out: string | null = null;
  try {
    out = await answer(event, ctx, tempDirs);
  } catch {
    // A broken registry or stdin is no reason to stop Claude Code, nor to approve anything.
    out = null;
  }
  if (out !== null) ctx.stdout(out);
  return 0;
}
