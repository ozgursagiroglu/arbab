// arbab summary [--all] [--json]
//
// Plans, lanes by state, integrations by stage and what needs the human (DESIGN.md §21). A stub until its lane lands.
import { ArbabError } from "../util/errors";
import type { CommandContext } from "./context";

export async function runSummary(argv: string[], ctx: CommandContext): Promise<number> {
  void argv;
  void ctx;
  throw new ArbabError("usage", "summary is not implemented yet");
}
