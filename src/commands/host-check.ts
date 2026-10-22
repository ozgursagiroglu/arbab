// arbab host-check <name>
//
// Runs the configured hostGates on the integration head, on the host, from a terminal only (DESIGN.md §21). A stub
// until its lane lands.
import { ArbabError } from "../util/errors";
import type { CommandContext } from "./context";

export async function runHostCheck(argv: string[], ctx: CommandContext): Promise<number> {
  void argv;
  void ctx;
  throw new ArbabError("usage", "host-check is not implemented yet");
}
