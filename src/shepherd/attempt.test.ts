import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultConfig, resolveRole } from "../config";
import { compileProfile } from "../profile";
import { DEFAULT_SCHEMAS } from "../report";
import type { GitRunner } from "../run";
import { ArbabError } from "../util/errors";
import { elideSchema, laneSchema, previousSession, profileInput, readRegistration, startedFields, worktreeUsedFile } from "./attempt";

// envFileAllowReads has its own tests; here only whether and how the attempt calls it matters.
const envFileCalls = vi.hoisted(() => [] as Array<{ worktree: string; readable: string[] }>);
vi.mock("../profile/envfiles", () => ({
  envFileAllowReads: (input: { worktree: string; readable: string[] }) => {
    envFileCalls.push({ worktree: input.worktree, readable: input.readable });
    return [`${input.worktree}/.env.example`];
  },
}));

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arbab-attempt-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("elideSchema", () => {
  it("replaces only the value after --json-schema", () => {
    expect(elideSchema(["-p", "--json-schema", '{"type":"object"}', "-n", "x"])).toEqual(["-p", "--json-schema", "<schema>", "-n", "x"]);
    expect(elideSchema(["-p", "-n", "x"])).toEqual(["-p", "-n", "x"]);
  });
});

describe("startedFields", () => {
  it("adds nothing for a bare request, so started.json keeps its old shape", () => {
    expect(startedFields({ kind: "start" })).toEqual({});
    expect(startedFields({ kind: "resume", prompt: "go on" })).toEqual({});
  });

  it("records timing as heldMs and prepareMs, the inputs and the merged branches", () => {
    expect(
      startedFields({
        kind: "start",
        timing: { heldMs: 1500, prepareMs: 0 },
        inputs: ["design", "handoff.md"],
        merged: [{ branch: "arbab/a", sha: "a".repeat(40) }],
      }),
    ).toEqual({ heldMs: 1500, prepareMs: 0, inputs: ["design", "handoff.md"], merged: [{ branch: "arbab/a", sha: "a".repeat(40) }] });
    expect(startedFields({ kind: "start", inputs: [] })).toEqual({ inputs: [] });
  });
});

describe("profileInput", () => {
  const git: GitRunner = () => ({ code: 0, stdout: "", stderr: "" });
  const ctx = (fence: { readableEnvFiles: string[]; bashOutputMaxChars: number }) => {
    const config = { ...defaultConfig(), fence };
    return {
      projectRoot: "/repo",
      config,
      lane: { name: "m1-a", role: "implementer" as const, brief: "b.md" },
      role: resolveRole(config, "implementer"),
      fence: "strict" as const,
      leases: [],
      worktree: "/repo/.arbab/worktrees/m1-a",
      gitCommonDir: "/repo/.git",
      deps: { git },
    };
  };

  it("passes the fence options and does not look for env files when none are readable", () => {
    envFileCalls.length = 0;
    const input = profileInput(ctx({ readableEnvFiles: [], bashOutputMaxChars: 100000 }));
    expect(input).toMatchObject({ readableEnvFiles: [], bashOutputMaxChars: 100000, envFileAllowReads: [] });
    expect(input).not.toHaveProperty("envFileDenies");
    expect(envFileCalls).toEqual([]);
  });

  it("asks envFileAllowReads for the templates to re-open when some are readable", () => {
    envFileCalls.length = 0;
    const input = profileInput(ctx({ readableEnvFiles: [".env.example"], bashOutputMaxChars: 4000 }));
    expect(input).toMatchObject({
      readableEnvFiles: [".env.example"],
      bashOutputMaxChars: 4000,
      envFileAllowReads: ["/repo/.arbab/worktrees/m1-a/.env.example"],
      worktree: "/repo/.arbab/worktrees/m1-a",
    });
    expect(input).not.toHaveProperty("envFileDenies");
    expect(envFileCalls).toEqual([{ worktree: "/repo/.arbab/worktrees/m1-a", readable: [".env.example"] }]);
  });

  it("passes the main checkout as projectRoot, so the relative credential denies are anchored there", () => {
    const input = profileInput(ctx({ readableEnvFiles: [], bashOutputMaxChars: 100000 }));
    expect(input.projectRoot).toBe("/repo");
    expect(compileProfile(input).settings.permissions.deny).toContain("Read(//repo/**/.env*)");
  });
});

describe("worktreeUsedFile", () => {
  it("lives in the owner's run dir and refuses an owner name that is not a lane name", () => {
    expect(worktreeUsedFile(dir, "m1-a")).toBe(join(dir, "m1-a", "worktree-used"));
    expect(() => worktreeUsedFile(dir, "../x")).toThrow(/lane/);
  });
});

describe("laneSchema", () => {
  it("defaults to the role's schema", () => {
    expect(laneSchema(dir, { name: "x", role: "reviewer", brief: "b.md" })).toBe(DEFAULT_SCHEMAS.reviewer);
  });

  it("reads the lane's own schema file", () => {
    mkdirSync(join(dir, "schemas"));
    writeFileSync(join(dir, "schemas", "s.json"), JSON.stringify({ type: "object", required: ["ok"] }));
    expect(laneSchema(dir, { name: "x", role: "implementer", brief: "b.md", schema: "schemas/s.json" })).toEqual({
      type: "object",
      required: ["ok"],
    });
  });

  it("refuses a schema that is not an object, or outside the project", () => {
    writeFileSync(join(dir, "s.json"), "[1]");
    expect(() => laneSchema(dir, { name: "x", role: "implementer", brief: "b.md", schema: "s.json" })).toThrow(ArbabError);
    expect(() => laneSchema(dir, { name: "x", role: "implementer", brief: "b.md", schema: "../s.json" })).toThrow(/outside/);
  });
});

describe("previousSession", () => {
  const write = (n: number, session: string, version: string, cost?: number | null): void => {
    const d = join(dir, "x", `attempt-${n}`);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "started.json"), JSON.stringify({ sessionId: session, binary: { path: "/c", version } }));
    if (cost !== undefined) writeFileSync(join(d, "summary.json"), JSON.stringify({ costUsd: cost }));
  };

  it("resumes the latest started attempt's session on its binary", () => {
    write(1, "s1", "2.1.295", 1);
    write(2, "s2", "2.1.296", 2);
    mkdirSync(join(dir, "x", "attempt-3"));
    expect(previousSession(dir, "x")).toEqual({ sessionId: "s2", binary: { path: "/c", version: "2.1.296" }, costUsd: 2 });
  });

  it("walks back past attempts of the session without a cost, but not into another session", () => {
    write(1, "s1", "v", 5);
    write(2, "s2", "v", 1.25);
    write(3, "s2", "v", null);
    write(4, "s2", "v");
    expect(previousSession(dir, "x").costUsd).toBe(1.25);
    write(5, "s3", "v", null);
    expect(previousSession(dir, "x")).toMatchObject({ sessionId: "s3", costUsd: null });
  });

  it("refuses a lane with no attempt that started", () => {
    mkdirSync(join(dir, "x", "attempt-1"), { recursive: true });
    expect(() => previousSession(dir, "x")).toThrow(/no earlier attempt to resume/);
  });
});

describe("readRegistration", () => {
  it("keeps kind, entrypoint and name only", () => {
    const path = join(dir, "1.json");
    writeFileSync(path, JSON.stringify({ pid: 1, kind: "sdk", entrypoint: "sdk-cli", name: "lane", cwd: "/x", extra: 1 }));
    expect(readRegistration(path)).toEqual({ kind: "sdk", entrypoint: "sdk-cli", name: "lane" });
  });

  it("maps fields of the wrong type to null", () => {
    const path = join(dir, "1.json");
    writeFileSync(path, JSON.stringify({ kind: 3, entrypoint: null }));
    expect(readRegistration(path)).toEqual({ kind: null, entrypoint: null, name: null });
  });

  it("returns null for a missing, partial or non-object file", () => {
    expect(readRegistration(join(dir, "missing.json"))).toBeNull();
    writeFileSync(join(dir, "partial.json"), '{"kind":');
    expect(readRegistration(join(dir, "partial.json"))).toBeNull();
    writeFileSync(join(dir, "array.json"), "[]");
    expect(readRegistration(join(dir, "array.json"))).toBeNull();
  });
});
