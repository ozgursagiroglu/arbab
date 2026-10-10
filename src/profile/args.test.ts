import { describe, expect, it } from "vitest";
import type { ClaudeArgsInput, Effort, JsonSchema } from "../types";
import { ArbabError } from "../util/errors";
import { buildClaudeArgs } from "./args";

const ID = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
const SCHEMA: JsonSchema = { type: "object", properties: { status: { type: "string" } }, required: ["status"] };

function args(over: Partial<ClaudeArgsInput> = {}): ClaudeArgsInput {
  return {
    model: "opus",
    effort: "high",
    tools: ["Read", "Edit", "Bash"],
    settingsPath: "/runs/lane-a/attempt-1/settings.json",
    budgetUsd: 10,
    name: "lane-a",
    session: { kind: "new", id: ID },
    schema: null,
    ...over,
  };
}

const HEAD = [
  "-p",
  "--output-format",
  "stream-json",
  "--verbose",
  "--model",
  "opus",
  "--effort",
  "high",
  "--permission-mode",
  "dontAsk",
  "--permission-prompts",
  "none",
  "--strict-mcp-config",
  "--setting-sources",
  "",
  "--restricted",
  "--tools",
  "Read,Edit,Bash",
  "--settings",
  "/runs/lane-a/attempt-1/settings.json",
  "--max-budget-usd",
  "10",
  "-n",
  "lane-a",
];

function codeOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err instanceof ArbabError ? err.code : err;
  }
  return "no error";
}

describe("buildClaudeArgs", () => {
  it("builds a new session without a schema", () => {
    expect(buildClaudeArgs(args())).toEqual([...HEAD, "--session-id", ID]);
  });

  it("builds a new session with a schema", () => {
    expect(buildClaudeArgs(args({ schema: SCHEMA }))).toEqual([
      ...HEAD,
      "--session-id",
      ID,
      "--json-schema",
      '{"type":"object","properties":{"status":{"type":"string"}},"required":["status"]}',
    ]);
  });

  it("builds a resumed session without a schema", () => {
    expect(buildClaudeArgs(args({ session: { kind: "resume", id: ID } }))).toEqual([...HEAD, "--resume", ID]);
  });

  it("builds a resumed session with a schema", () => {
    expect(buildClaudeArgs(args({ session: { kind: "resume", id: ID }, schema: SCHEMA }))).toEqual([
      ...HEAD,
      "--resume",
      ID,
      "--json-schema",
      JSON.stringify(SCHEMA),
    ]);
  });

  it("formats fractional budgets", () => {
    const argv = buildClaudeArgs(args({ budgetUsd: 0.5 }));
    expect(argv[argv.indexOf("--max-budget-usd") + 1]).toBe("0.5");
  });

  it.each<[string, Partial<ClaudeArgsInput>]>([
    ["an unknown effort", { effort: "extreme" as Effort }],
    ["a zero budget", { budgetUsd: 0 }],
    ["a negative budget", { budgetUsd: -1 }],
    ["an infinite budget", { budgetUsd: Number.POSITIVE_INFINITY }],
    ["a NaN budget", { budgetUsd: Number.NaN }],
    ["an invalid name", { name: "Lane A" }],
    ["a name that looks like a flag", { name: "-x" }],
    ["a session id that is not a UUID", { session: { kind: "new", id: "abc" } }],
    ["a resume id that is not a UUID", { session: { kind: "resume", id: `${ID}x` } }],
    ["an empty tool list", { tools: [] }],
    ["a tool with a comma", { tools: ["Read,Bash"] }],
    ["an empty tool name", { tools: ["Read", ""] }],
    ["an empty model", { model: "" }],
    ["a model that looks like a flag", { model: "--verbose" }],
    ["an empty settings path", { settingsPath: "" }],
  ])("rejects %s", (_label, over) => {
    expect(codeOf(() => buildClaudeArgs(args(over)))).toBe("usage");
  });
});
