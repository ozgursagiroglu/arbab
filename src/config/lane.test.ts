import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  INTEGRATION_WORKTREE_PREFIX,
  MAX_INPUTS,
  PHASE_LANE_KEYS,
  inputList,
  loadLane,
  phaseLaneFields,
  toolList,
  worktreeName,
} from "./lane";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arbab-lane-"));
  mkdirSync(join(dir, "lanes"));
  writeFileSync(join(dir, "lanes", "schema.json"), "{}");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("phaseLaneFields", () => {
  it("returns only the phase lane fields that are set", () => {
    const fields = { role: "verifier", effort: "low", schema: "lanes/schema.json", resources: { port: 2 } };
    expect(phaseLaneFields(dir, { ...fields, name: "ignored", scope: ["x"] })).toEqual(fields);
    expect(phaseLaneFields(dir, {})).toEqual({});
  });

  it("prefixes field names in errors", () => {
    expect(() => phaseLaneFields(dir, { effort: "huge" }, "phases[2]")).toThrow(/^phases\[2\]\.effort:/);
    expect(() => phaseLaneFields(dir, { resources: { port: 9 } }, "defaults")).toThrow(/^defaults\.resources\.port:/);
    expect(() => phaseLaneFields(dir, { fence: "none" })).toThrow(/^fence:/);
  });

  it("refuses a worktree that names an integration worktree", () => {
    expect(() => phaseLaneFields(dir, { worktree: "integrate-m3" }, "phases[0]")).toThrow(
      /^phases\[0\]\.worktree: "integrate-m3" must not start with integrate-: those worktrees are reserved for arbab integrate$/,
    );
    expect(phaseLaneFields(dir, { worktree: "integrated" })).toEqual({ worktree: "integrated" });
  });

  it("covers exactly the PhaseLaneFields keys", () => {
    expect([...PHASE_LANE_KEYS].sort()).toEqual(
      [
        "allow",
        "autoResume",
        "budgetUsd",
        "checkpoint",
        "effort",
        "fence",
        "idleMin",
        "inputs",
        "maxAttempts",
        "model",
        "resources",
        "role",
        "schema",
        "semaphores",
        "wallMin",
        "worktree",
      ].sort(),
    );
  });
});

describe("worktreeName", () => {
  it("accepts a valid name outside the integration prefix", () => {
    for (const ok of ["m3-a", "integrate", "integrated-x", "x-integrate-y"]) expect(worktreeName(ok, "name")).toBe(ok);
  });

  it("refuses an invalid name and one starting with integrate-, as a config error", () => {
    for (const bad of ["integrate-m3", "integrate-", "M3", "a/b", 3]) {
      let err: unknown;
      try {
        worktreeName(bad, "name");
      } catch (e) {
        err = e;
      }
      expect(err, String(bad)).toMatchObject({ code: "config" });
    }
    expect(INTEGRATION_WORKTREE_PREFIX).toBe("integrate-");
  });
});

describe("loadLane", () => {
  const writeLane = (lane: Record<string, unknown>): string => {
    writeFileSync(join(dir, "lanes", "brief.md"), "## Task\n");
    writeFileSync(join(dir, "lanes", "l.json"), JSON.stringify({ role: "implementer", brief: "lanes/brief.md", ...lane }));
    return "lanes/l.json";
  };

  it("refuses a lane named like an integration worktree, or borrowing one", () => {
    expect(() => loadLane(dir, writeLane({ name: "integrate-m3" }))).toThrow(/^name: "integrate-m3" must not start with integrate-/);
    expect(() => loadLane(dir, writeLane({ name: "m3-a", worktree: "integrate-m3" }))).toThrow(
      /^worktree: "integrate-m3" must not start with integrate-/,
    );
    expect(loadLane(dir, writeLane({ name: "m3-a", worktree: "m3-b" }))).toMatchObject({ name: "m3-a", worktree: "m3-b" });
  });

  it("refuses a brief or schema that a credentialPaths entry hits, and passes one that matches nothing", () => {
    writeFileSync(join(dir, "lanes", "schema.secret"), "{}");
    writeFileSync(join(dir, "lanes", "schema.json"), "{}");
    const extra = ["**/*.secret", "lanes/brief.md"];
    expect(() => loadLane(dir, writeLane({ name: "m3-a" }), extra)).toThrow(/^brief: lanes\/brief\.md matches the credential path lanes\/brief\.md/);
    writeFileSync(join(dir, "lanes", "other.md"), "## Task\n");
    const lane = { name: "m3-a", brief: "lanes/other.md" };
    expect(() => loadLane(dir, writeLane({ ...lane, schema: "lanes/schema.secret" }), extra)).toThrow(
      /^schema: lanes\/schema\.secret is named like a credential file \(schema\.secret\)/,
    );
    expect(loadLane(dir, writeLane({ ...lane, schema: "lanes/schema.json" }), extra)).toMatchObject({ brief: "lanes/other.md", schema: "lanes/schema.json" });
    // Without the list, only the built-in names apply.
    expect(loadLane(dir, writeLane({ ...lane, schema: "lanes/schema.secret" })).schema).toBe("lanes/schema.secret");
  });

  it("keeps a valid tools list", () => {
    expect(loadLane(dir, writeLane({ name: "m3-a", tools: ["Read", "Bash", "mcp__srv-1__q"] })).tools).toEqual(["Read", "Bash", "mcp__srv-1__q"]);
    expect(loadLane(dir, writeLane({ name: "m3-a" })).tools).toBeUndefined();
  });

  it("refuses an invalid tools list as a config error", () => {
    const cases: Array<[unknown, RegExp]> = [
      [[], /^tools: must be a non-empty array of tool names$/],
      ["Read", /^tools: must be a non-empty array of tool names$/],
      [["Read", "Read"], /^tools\[1\]: Read is listed twice$/],
      [["Read,Write"], /^tools\[0\]: "Read,Write" is not a tool name$/],
      [["Bash", ""], /^tools\[1\]: "" is not a tool name$/],
      [[" Bash"], /^tools\[0\]: " Bash" is not a tool name$/],
      [[3], /^tools\[0\]: 3 is not a tool name$/],
    ];
    for (const [tools, message] of cases) {
      expect(() => loadLane(dir, writeLane({ name: "m3-a", tools })), JSON.stringify(tools)).toThrow(message);
    }
  });
});

describe("inputs", () => {
  const writeLane = (lane: Record<string, unknown>): string => {
    writeFileSync(join(dir, "lanes", "brief.md"), "## Task\n");
    writeFileSync(join(dir, "lanes", "l.json"), JSON.stringify({ name: "m3-a", role: "implementer", brief: "lanes/brief.md", ...lane }));
    return "lanes/l.json";
  };

  it("keeps the paths as written, without checking that they exist", () => {
    const inputs = ["/abs/design", "~/notes/handoff.md", "docs/missing.md"];
    expect(loadLane(dir, writeLane({ inputs })).inputs).toEqual(inputs);
    expect(loadLane(dir, writeLane({ inputs: [] })).inputs).toEqual([]);
    expect(phaseLaneFields(dir, { inputs: ["a"] })).toEqual({ inputs: ["a"] });
  });

  it("accepts MAX_INPUTS paths and refuses one more", () => {
    const many = Array.from({ length: MAX_INPUTS }, (_, i) => `f${i}`);
    expect(inputList(many, "inputs")).toEqual(many);
    expect(() => inputList([...many, "x"], "inputs")).toThrow(/^inputs: must list at most 20 paths$/);
  });

  it("refuses a non-array and bad entries as config errors", () => {
    const cases: Array<[unknown, RegExp]> = [
      ["a", /^inputs: must be an array of paths$/],
      [[""], /^inputs\[0\]: must be a non-empty string$/],
      [["a", 3], /^inputs\[1\]: must be a non-empty string$/],
      [["a\nb"], /^inputs\[0\]: must not contain NUL or a newline$/],
      [["a\0b"], /^inputs\[0\]: must not contain NUL or a newline$/],
    ];
    for (const [inputs, message] of cases) {
      let err: unknown;
      try {
        loadLane(dir, writeLane({ inputs }));
      } catch (e) {
        err = e;
      }
      expect(err, JSON.stringify(inputs)).toMatchObject({ code: "config" });
      expect((err as Error).message).toMatch(message);
    }
    expect(() => phaseLaneFields(dir, { inputs: [""] }, "phases[1]")).toThrow(/^phases\[1\]\.inputs\[0\]:/);
  });
});

describe("toolList", () => {
  it("returns the names in order and names the field in errors", () => {
    expect(toolList(["Bash", "Read"], "tools")).toEqual(["Bash", "Read"]);
    expect(() => toolList(["Bash", "-x"], "lane.tools")).toThrow(/^lane\.tools\[1\]: "-x" is not a tool name$/);
  });
});
