import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkScriptPath } from "../check/command";
import { defaultConfig, resolveRole } from "../config";
import { compileProfile, lintProfile } from "../profile";
import { DEFAULT_SCHEMAS } from "../report";
import type { GitRunner } from "../run";
import { CHECK_POLICY_ENV, CHECK_SCRIPT_FILE, CHECKS_ENV, DEFAULT_CHECK_WAIT_SEC, MACHINE_CONFIG_FILE } from "../types";
import type { LaneSpec, Role } from "../types";
import { ArbabError } from "../util/errors";
import {
  checkPolicy,
  elideSchema,
  installCheckScript,
  laneChecks,
  laneSchema,
  prepareChecks,
  previousSession,
  profileInput,
  readRegistration,
  startedFields,
  worktreeUsedFile,
} from "./attempt";

// envFileAllowReads has its own tests; here only whether and how the attempt calls it matters.
type EnvFileCall = { worktree: string; branch: string; gitCommonDir: string; readable: string[] };
const envFileCalls = vi.hoisted(() => [] as EnvFileCall[]);
vi.mock("../profile/envfiles", () => ({
  envFileAllowReads: (input: EnvFileCall) => {
    envFileCalls.push({ worktree: input.worktree, branch: input.branch, gitCommonDir: input.gitCommonDir, readable: input.readable });
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
      branch: "arbab/m1-a",
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

  it("asks envFileAllowReads, with the branch and git dir to verify the worktree by, for the templates to re-open", () => {
    envFileCalls.length = 0;
    const input = profileInput(ctx({ readableEnvFiles: [".env.example"], bashOutputMaxChars: 4000 }));
    expect(input).toMatchObject({
      readableEnvFiles: [".env.example"],
      bashOutputMaxChars: 4000,
      envFileAllowReads: ["/repo/.arbab/worktrees/m1-a/.env.example"],
      worktree: "/repo/.arbab/worktrees/m1-a",
    });
    expect(input).not.toHaveProperty("envFileDenies");
    expect(envFileCalls).toEqual([
      { worktree: "/repo/.arbab/worktrees/m1-a", branch: "arbab/m1-a", gitCommonDir: "/repo/.git", readable: [".env.example"] },
    ]);
  });

  it("passes the main checkout as projectRoot, so the relative credential denies are anchored there", () => {
    const input = profileInput(ctx({ readableEnvFiles: [], bashOutputMaxChars: 100000 }));
    expect(input.projectRoot).toBe("/repo");
    expect(compileProfile(input).settings.permissions.deny).toContain("Read(//repo/**/.env*)");
  });
});

describe("laneChecks", () => {
  const config = { checks: { typecheck: ["pnpm", "typecheck"], lint: ["pnpm", "lint"] } };

  it.each(["implementer", "verifier"] as const)("gives a %s lane config checks", (role) => {
    expect(laneChecks({ role }, config)).toEqual(config.checks);
  });

  it.each(["reviewer", "researcher", "probe"] as const)("gives a %s lane none", (role) => {
    expect(laneChecks({ role }, config)).toEqual({});
  });

  it("takes the lane's own checks for any role, even none", () => {
    const own = { "gate-1": ["pnpm", "test"] };
    expect(laneChecks({ role: "probe", checks: own }, config)).toBe(own);
    expect(laneChecks({ role: "implementer", checks: own }, config)).toBe(own);
    expect(laneChecks({ role: "implementer", checks: {} }, config)).toEqual({});
  });
});

describe("installCheckScript", () => {
  const runner = (): string => {
    mkdirSync(join(dir, "dist"), { recursive: true });
    return join(dir, "dist", "arbab.mjs");
  };

  it("copies the script next to the runner into the lane's bin directory, and refreshes it at every call", () => {
    const r = runner();
    writeFileSync(join(dir, "dist", CHECK_SCRIPT_FILE), "// one\n");
    const runs = join(dir, "runs");
    const target = installCheckScript(r, runs, "m1-a");
    expect(target).toBe(checkScriptPath(runs, "m1-a"));
    expect(readFileSync(target, "utf8")).toBe("// one\n");
    writeFileSync(join(dir, "dist", CHECK_SCRIPT_FILE), "// two\n");
    expect(installCheckScript(r, runs, "m1-a")).toBe(target);
    expect(readFileSync(target, "utf8")).toBe("// two\n");
    // No temporary file is left behind.
    expect(readdirSync(join(runs, "m1-a", "bin"))).toEqual([CHECK_SCRIPT_FILE]);
  });

  it("is a setup error when the script is missing next to the runner", () => {
    const r = runner();
    const err = (() => {
      try {
        installCheckScript(r, join(dir, "runs"), "m1-a");
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(ArbabError);
    expect((err as ArbabError).code).toBe("runtime");
    expect((err as ArbabError).message).toBe(
      `arbab-check.mjs is missing next to the runner (${join(dir, "dist", CHECK_SCRIPT_FILE)}): reinstall or rebuild arbab`,
    );
    expect(existsSync(join(dir, "runs", "m1-a"))).toBe(false);
  });
});

describe("checkPolicy", () => {
  it("defaults concurrent to a quarter of the CPUs and waitSec to the default", () => {
    expect(DEFAULT_CHECK_WAIT_SEC).toBe(60);
    expect(checkPolicy(dir, 8, "implementer")).toEqual({ cpus: 8, concurrent: 2, waitSec: DEFAULT_CHECK_WAIT_SEC });
    expect(checkPolicy(dir, 2, "verifier")).toEqual({ cpus: 2, concurrent: 1, waitSec: DEFAULT_CHECK_WAIT_SEC });
  });

  it("takes machine.json's values", () => {
    writeFileSync(join(dir, MACHINE_CONFIG_FILE), JSON.stringify({ checks: { concurrent: 3, waitSec: 0 } }));
    expect(checkPolicy(dir, 8, "implementer")).toEqual({ cpus: 8, concurrent: 3, waitSec: 0 });
  });

  it("never makes a probe wait, whatever machine.json says, and still gives it the fair share", () => {
    expect(checkPolicy(dir, 8, "probe")).toEqual({ cpus: 8, concurrent: 2, waitSec: 0 });
    writeFileSync(join(dir, MACHINE_CONFIG_FILE), JSON.stringify({ checks: { concurrent: 3, waitSec: 300 } }));
    expect(checkPolicy(dir, 8, "probe")).toEqual({ cpus: 8, concurrent: 3, waitSec: 0 });
    for (const role of ["implementer", "verifier", "reviewer", "researcher"] as const) {
      expect(checkPolicy(dir, 8, role).waitSec).toBe(300);
    }
  });

  it("falls back to the checks' defaults when machine.json cannot be read or its checks are invalid", () => {
    writeFileSync(join(dir, MACHINE_CONFIG_FILE), "{");
    expect(checkPolicy(dir, 16, "implementer")).toEqual({ cpus: 16, concurrent: 4, waitSec: DEFAULT_CHECK_WAIT_SEC });
    writeFileSync(join(dir, MACHINE_CONFIG_FILE), JSON.stringify({ checks: { concurrent: 0 } }));
    expect(checkPolicy(dir, 16, "implementer")).toEqual({ cpus: 16, concurrent: 4, waitSec: DEFAULT_CHECK_WAIT_SEC });
  });

  it("keeps machine.json's checks when another field is invalid", () => {
    writeFileSync(join(dir, MACHINE_CONFIG_FILE), JSON.stringify({ maxParallel: 0, checks: { concurrent: 3, waitSec: 10 }, admission: [] }));
    expect(checkPolicy(dir, 16, "implementer")).toEqual({ cpus: 16, concurrent: 3, waitSec: 10 });
  });
});

describe("prepareChecks and the fence", () => {
  const git: GitRunner = () => ({ code: 0, stdout: "", stderr: "" });
  const checks = { typecheck: ["pnpm", "typecheck"], lint: ["pnpm", "lint"] };
  let runner: string;
  let home: string;
  let runsRoot: string;
  beforeEach(() => {
    mkdirSync(join(dir, "dist"));
    runner = join(dir, "dist", "arbab.mjs");
    writeFileSync(join(dir, "dist", CHECK_SCRIPT_FILE), "// check\n");
    home = join(dir, "home");
    mkdirSync(home);
    runsRoot = join(dir, "runs");
  });
  const ctx = (role: Role, over: { runner?: string; lane?: Partial<LaneSpec>; env?: Record<string, string> } = {}) => {
    const config = { ...defaultConfig(), checks, env: over.env ?? {} };
    const deps = { git, home, cpus: () => 8, ...(over.runner === undefined ? {} : { runner: over.runner }) };
    return {
      projectRoot: "/repo",
      runsRoot,
      config,
      lane: { name: "m1-a", role, brief: "b.md", ...over.lane },
      role: resolveRole(config, role),
      fence: "strict" as const,
      leases: [],
      worktree: "/repo/.arbab/worktrees/m1-a",
      branch: "arbab/m1-a",
      gitCommonDir: "/repo/.git",
      deps,
    };
  };
  const compiled = (c: ReturnType<typeof ctx>) => {
    const input = profileInput(c, prepareChecks(c));
    const profile = compileProfile(input);
    return { input, profile, lint: lintProfile(profile, input) };
  };

  it("gives an implementer the copy, both env entries, the checks' fields and their rules", () => {
    const c = ctx("implementer", { runner });
    const prepared = prepareChecks(c);
    const script = checkScriptPath(runsRoot, "m1-a");
    expect(prepared).toEqual({ script, checks, policy: { cpus: 8, concurrent: 2, waitSec: DEFAULT_CHECK_WAIT_SEC } });
    expect(readFileSync(script, "utf8")).toBe("// check\n");
    const { input, profile, lint } = compiled(c);
    expect(input).toMatchObject({ checkScript: script, checkNames: ["lint", "typecheck"] });
    expect(profile.settings.env[CHECKS_ENV]).toBe(JSON.stringify(checks));
    expect(profile.settings.env[CHECK_POLICY_ENV]).toBe(JSON.stringify({ cpus: 8, concurrent: 2, waitSec: DEFAULT_CHECK_WAIT_SEC }));
    expect(profile.settings.permissions.allow).toContain(`Bash(node ${script} typecheck)`);
    expect(profile.settings.permissions.allow).toContain(`Bash(node ${script} lint *)`);
    expect(lint).toEqual([]);
  });

  it("puts the checks' env entries after config env, so a config value cannot replace them", () => {
    const { profile } = compiled(ctx("verifier", { runner, env: { [CHECKS_ENV]: "{}", KEEP: "1" } }));
    expect(profile.settings.env[CHECKS_ENV]).toBe(JSON.stringify(checks));
    expect(profile.settings.env["KEEP"]).toBe("1");
  });

  it("gives a reviewer neither the copy, the env nor the rules", () => {
    const c = ctx("reviewer", { runner });
    expect(prepareChecks(c)).toBeNull();
    const { input, profile } = compiled(c);
    expect(existsSync(join(runsRoot, "m1-a"))).toBe(false);
    expect(profile.settings.env).not.toHaveProperty(CHECKS_ENV);
    expect(profile.settings.env).not.toHaveProperty(CHECK_POLICY_ENV);
    expect(input).not.toHaveProperty("checkScript");
    expect(profile.settings.permissions.allow.some((rule) => rule.includes(CHECK_SCRIPT_FILE))).toBe(false);
  });

  it("gives no checks at all without a runner (test deps)", () => {
    const c = ctx("implementer");
    expect(prepareChecks(c)).toBeNull();
    expect(existsSync(join(runsRoot, "m1-a"))).toBe(false);
    expect(compiled(c).profile.settings.env).not.toHaveProperty(CHECKS_ENV);
  });

  it("follows the lane's own checks, and an empty set means none", () => {
    const own = { "gate-1": ["pnpm", "test"] };
    expect(prepareChecks(ctx("probe", { runner, lane: { checks: own } }))?.checks).toBe(own);
    expect(prepareChecks(ctx("implementer", { runner, lane: { checks: {} } }))).toBeNull();
  });

  it("refuses a lane whose script is missing, before anything is copied", () => {
    rmSync(join(dir, "dist", CHECK_SCRIPT_FILE));
    expect(() => prepareChecks(ctx("implementer", { runner }))).toThrow(/arbab-check\.mjs is missing next to the runner/);
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
