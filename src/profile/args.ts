import type { ClaudeArgsInput } from "../types";
import { EFFORTS } from "../types";
import { ArbabError } from "../util/errors";
import { assertValidName } from "../util/names";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The worker's argv after the claude binary (DESIGN.md §4, "Compiled flags"). */
export function buildClaudeArgs(input: ClaudeArgsInput): string[] {
  if (input.model === "" || input.model.startsWith("-")) {
    throw new ArbabError("usage", `model ${JSON.stringify(input.model)} is not a model name`);
  }
  if (!EFFORTS.includes(input.effort)) {
    throw new ArbabError("usage", `effort ${JSON.stringify(input.effort)} must be one of ${EFFORTS.join(", ")}`);
  }
  if (!Number.isFinite(input.budgetUsd) || input.budgetUsd <= 0) {
    throw new ArbabError("usage", `budget ${String(input.budgetUsd)} must be a positive number`);
  }
  if (input.settingsPath === "") throw new ArbabError("usage", "settings path is empty");
  assertValidName(input.name, "lane name");
  if (!UUID.test(input.session.id)) {
    throw new ArbabError("usage", `session id ${JSON.stringify(input.session.id)} is not a UUID`);
  }
  if (input.tools.length === 0) throw new ArbabError("usage", "tool list is empty");
  for (const tool of input.tools) {
    if (tool === "" || tool.includes(",")) {
      throw new ArbabError("usage", `tool ${JSON.stringify(tool)} must be a non-empty name without commas`);
    }
  }

  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    input.model,
    "--effort",
    input.effort,
    "--permission-mode",
    "dontAsk",
    "--permission-prompts",
    "none",
    "--strict-mcp-config",
    // An empty source list: no user, project or local settings reach the worker.
    "--setting-sources",
    "",
    "--restricted",
    "--tools",
    input.tools.join(","),
    "--settings",
    input.settingsPath,
    "--max-budget-usd",
    String(input.budgetUsd),
    "-n",
    input.name,
    input.session.kind === "new" ? "--session-id" : "--resume",
    input.session.id,
  ];
  if (input.schema !== null) args.push("--json-schema", JSON.stringify(input.schema));
  return args;
}
