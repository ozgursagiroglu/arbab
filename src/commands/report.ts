// arbab report <lane>
//
// A lane's latest report (DESIGN.md §21). A stub until its lane lands.
import { ArbabError } from "../util/errors";
import type { CommandContext } from "./context";

export async function runReport(argv: string[], ctx: CommandContext): Promise<number> {
  void argv;
  void ctx;
  throw new ArbabError("usage", "report is not implemented yet");
}
