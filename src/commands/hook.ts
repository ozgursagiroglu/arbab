// arbab hook <pre-tool-use|stop>
//
// The plugin's Claude Code hooks: approve bare runner calls, keep an orchestrator with live shepherds from stopping
// unwatched (DESIGN.md §21). A stub until its lane lands.
import { ArbabError } from "../util/errors";
import type { CommandContext } from "./context";

export async function runHook(argv: string[], ctx: CommandContext): Promise<number> {
  void argv;
  void ctx;
  throw new ArbabError("usage", "hook is not implemented yet");
}
