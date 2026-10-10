// arbab __shepherd <root> <lane> <mode-json> (internal; started detached by launch and resume)
//
// Runs one lane's shepherd until the lane finishes. SIGTERM and SIGINT abort it, which finishes the lane as
// killed:stopped. Exit 0 whatever the end state (state.json holds it); 1 on bad arguments; 2 when the shepherd
// itself fails.
import { isAbsolute } from "node:path";
import type { ShepherdMode } from "../shepherd";
import { ArbabError } from "../util/errors";
import { assertValidName } from "../util/names";
import type { CommandContext } from "./context";

export function parseMode(text: string): ShepherdMode {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ArbabError("usage", `shepherd mode ${JSON.stringify(text)} is not JSON`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ArbabError("usage", "shepherd mode must be an object");
  const { kind, prompt, promptFile, digestFrom } = value as { kind?: unknown; prompt?: unknown; promptFile?: unknown; digestFrom?: unknown };
  if (kind === "start") return { kind };
  if (kind === "fresh") {
    if (digestFrom === undefined) return { kind };
    if (Number.isSafeInteger(digestFrom) && (digestFrom as number) >= 1) return { kind, digestFrom: digestFrom as number };
    throw new ArbabError("usage", "shepherd mode digestFrom must be a positive integer");
  }
  if (kind === "resume") {
    if (prompt !== undefined && promptFile !== undefined) throw new ArbabError("usage", "shepherd mode takes prompt or promptFile, not both");
    if (promptFile !== undefined) {
      if (typeof promptFile === "string" && isAbsolute(promptFile)) return { kind, promptFile };
      throw new ArbabError("usage", "shepherd mode promptFile must be an absolute path");
    }
    if (prompt === undefined) return { kind };
    if (typeof prompt === "string" && prompt.trim() !== "") return { kind, prompt };
    throw new ArbabError("usage", "shepherd mode prompt must be a non-empty string");
  }
  throw new ArbabError("usage", `shepherd mode kind ${JSON.stringify(kind)} must be start, resume or fresh`);
}

export async function runShepherdProcess(argv: string[], ctx: CommandContext): Promise<number> {
  const [root, lane, modeText, ...rest] = argv;
  if (root === undefined || lane === undefined || modeText === undefined || rest.length > 0) {
    throw new ArbabError("usage", "usage: arbab __shepherd <root> <lane> <mode-json>");
  }
  if (!isAbsolute(root)) throw new ArbabError("usage", `project root ${root} must be absolute`);
  assertValidName(lane, "lane");
  const mode = parseMode(modeText);

  const controller = new AbortController();
  const untrap = ctx.trapSignals(() => controller.abort());
  try {
    const end = await ctx.runShepherd(root, lane, mode, ctx.shepherdDeps(), controller.signal);
    ctx.stdout(`${lane}: ${end}\n`);
    return 0;
  } finally {
    untrap();
  }
}
