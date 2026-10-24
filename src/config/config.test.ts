import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProjectConfig } from "../types";
import { ROLES } from "../types";
import { ArbabError } from "../util/errors";
import {
  CONFIG_FILE,
  LOCAL_CONFIG_FILE,
  ROLE_DEFAULTS,
  configPath,
  defaultConfig,
  effectiveRole,
  loadConfig,
  loadLane,
  resolveRole,
} from "./index";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arbab-config-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function errorOf(fn: () => unknown): ArbabError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ArbabError);
    return err as ArbabError;
  }
  throw new Error("expected an ArbabError");
}

function configError(config: unknown, field: string): void {
  writeFileSync(join(dir, CONFIG_FILE), JSON.stringify(config));
  const err = errorOf(() => loadConfig(dir));
  expect(err.code).toBe("config");
  expect(err.message).toContain(field);
}

function loadWith(config: unknown): ProjectConfig {
  writeFileSync(join(dir, CONFIG_FILE), JSON.stringify(config));
  return loadConfig(dir);
}

describe("ROLE_DEFAULTS", () => {
  it("matches the presets", () => {
    expect(ROLE_DEFAULTS.implementer).toEqual({
      tools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash"],
      model: "claude-opus-5-5",
      effort: "high",
      budgetUsd: 10,
      wallMin: 60,
      idleMin: 20,
      loopback: true,
      checkpoint: true,
      autoResume: true,
      maxAttempts: 4,
    });
    expect(ROLE_DEFAULTS.verifier).toEqual(ROLE_DEFAULTS.implementer);
    expect(ROLE_DEFAULTS.reviewer).toEqual({
      tools: ["Read", "Glob", "Grep", "Bash"],
      model: "claude-opus-5-5",
      effort: "high",
      budgetUsd: 5,
      wallMin: 30,
      idleMin: 15,
      loopback: true,
      checkpoint: false,
      autoResume: true,
      maxAttempts: 3,
    });
    expect(ROLE_DEFAULTS.researcher).toEqual({
      tools: ["WebSearch", "WebFetch"],
      model: "claude-opus-5-5",
      effort: "medium",
      budgetUsd: 5,
      wallMin: 40,
      idleMin: 15,
      loopback: false,
      checkpoint: false,
      autoResume: true,
      maxAttempts: 3,
    });
    expect(ROLE_DEFAULTS.probe).toEqual({
      tools: ["Read", "Write", "Bash"],
      model: "claude-haiku-5-5",
      effort: "low",
      budgetUsd: 0.5,
      wallMin: 10,
      idleMin: 5,
      loopback: true,
      checkpoint: false,
      autoResume: false,
      maxAttempts: 1,
    });
  });

  it("is frozen", () => {
    expect(Object.isFrozen(ROLE_DEFAULTS)).toBe(true);
    for (const r of ROLES) {
      expect(Object.isFrozen(ROLE_DEFAULTS[r])).toBe(true);
      expect(Object.isFrozen(ROLE_DEFAULTS[r].tools)).toBe(true);
    }
  });
});

describe("resolveRole", () => {
  it("returns the preset without overrides", () => {
    expect(resolveRole(defaultConfig(), "reviewer")).toEqual(ROLE_DEFAULTS.reviewer);
  });

  it("overlays config.roles and leaves the preset untouched", () => {
    const config = defaultConfig();
    config.roles = { implementer: { model: "claude-sonnet-5-5", budgetUsd: 3, tools: ["Read"] } };
    const resolved = resolveRole(config, "implementer");
    expect(resolved).toEqual({ ...ROLE_DEFAULTS.implementer, model: "claude-sonnet-5-5", budgetUsd: 3, tools: ["Read"] });
    resolved.tools.push("Bash");
    expect(config.roles.implementer?.tools).toEqual(["Read"]);
    expect(resolveRole(config, "verifier")).toEqual(ROLE_DEFAULTS.verifier);
  });

  it("returns a mutable copy", () => {
    const resolved = resolveRole(defaultConfig(), "probe");
    resolved.tools.push("Glob");
    expect(ROLE_DEFAULTS.probe.tools).toEqual(["Read", "Write", "Bash"]);
  });
});

describe("loadConfig", () => {
  it("fills every default when the file is missing", () => {
    expect(loadConfig(dir)).toEqual({
      baseBranch: "main",
      worktreeRoot: ".arbab/worktrees",
      runsRoot: ".arbab/runs",
      instructions: [],
      dependencies: { strategy: "none" },
      commands: {},
      env: {},
      passEnv: [],
      credentialPaths: [],
      resources: {},
      semaphores: {},
      gates: [],
      preflight: { steps: [] },
      maxParallel: 4,
      quota: { holdAbove: { fiveHour: 0.85, sevenDay: 0.95 } },
      roles: {},
      minClaudeVersion: "2.1.290",
      verify: { smoke: null },
      review: { lenses: {} },
      landing: { tier: "medium", squash: false },
      fence: { readableEnvFiles: [], bashOutputMaxChars: 100000 },
      hostGates: [],
      worktrees: { idleDays: 3 },
    });
  });

  it("reads worktrees.idleDays from 0 to 365 and refuses anything else", () => {
    expect(loadWith({ worktrees: { idleDays: 0 } }).worktrees).toEqual({ idleDays: 0 });
    expect(loadWith({ worktrees: { idleDays: 365 } }).worktrees).toEqual({ idleDays: 365 });
    expect(loadWith({ worktrees: {} }).worktrees).toEqual({ idleDays: 3 });
    configError({ worktrees: { idleDays: -1 } }, "worktrees.idleDays");
    configError({ worktrees: { idleDays: 366 } }, "worktrees.idleDays");
    configError({ worktrees: { idleDays: 1.5 } }, "worktrees.idleDays");
    configError({ worktrees: { idleDays: "3" } }, "worktrees.idleDays");
    configError({ worktrees: { keepDays: 3 } }, "worktrees.keepDays");
    configError({ worktrees: 3 }, "worktrees");
  });

  it("fills defaults for an empty object", () => {
    expect(loadWith({})).toEqual(defaultConfig());
  });

  it("loads this repository's own config", () => {
    const root = fileURLToPath(new URL("../..", import.meta.url));
    const config = loadConfig(root);
    expect(config.instructions).toEqual(["CLAUDE.md"]);
    expect(config.maxParallel).toBe(6);
    expect(config.dependencies).toEqual({
      strategy: "command",
      command: ["pnpm", "install", "--offline", "--frozen-lockfile"],
    });
    expect(config.commands.reviewer).toContain("pnpm test");
    expect(config.worktreeRoot).toBe(".arbab/worktrees");
    expect(config.minClaudeVersion).toBe("2.1.290");
  });

  it("accepts a full valid config", () => {
    mkdirSync(join(dir, "docs"));
    writeFileSync(join(dir, "docs", "RULES.md"), "# Rules\n");
    const config = loadWith({
      baseBranch: "develop",
      worktreeRoot: "tmp/wt",
      runsRoot: "tmp/runs",
      instructions: ["docs/RULES.md"],
      dependencies: { strategy: "none" },
      commands: { probe: ["make check"] },
      env: { CI: "1", _x: "y" },
      passEnv: ["ANTHROPIC_API_KEY", "GOPATH"],
      credentialPaths: ["~/.secrets/**"],
      resources: { port: { range: [4000, 4010] }, "redis-db": { range: [0, 15] } },
      semaphores: { "shared-db": 1 },
      gates: [["make", "test"]],
      preflight: { steps: [["make", "lint"]] },
      maxParallel: 32,
      quota: { holdAbove: { fiveHour: 1 } },
      roles: { probe: { effort: "medium", loopback: false, maxAttempts: 2 } },
      minClaudeVersion: "2.1.295",
      verify: { smoke: ["make", "smoke"] },
      review: { lenses: { perf: "Hot paths that allocate per request." } },
      landing: { tier: "high" },
    });
    expect(config.quota.holdAbove).toEqual({ fiveHour: 1, sevenDay: 0.95 });
    expect(config.verify).toEqual({ smoke: ["make", "smoke"] });
    expect(config.review.lenses).toEqual({ perf: "Hot paths that allocate per request." });
    expect(config.landing).toEqual({ tier: "high", squash: false });
    expect(config.resources["redis-db"]).toEqual({ range: [0, 15] });
    expect(config.roles.probe).toEqual({ effort: "medium", loopback: false, maxAttempts: 2 });
  });

  it("rejects a file that is not JSON or not an object", () => {
    writeFileSync(join(dir, CONFIG_FILE), "{");
    expect(errorOf(() => loadConfig(dir)).code).toBe("config");
    configError([], CONFIG_FILE);
  });

  it("rejects an unknown top-level key", () => configError({ maxparallel: 2 }, "maxparallel"));

  it("reads .arbab/config.json when the repository has no arbab.config.json", () => {
    expect(configPath(dir)).toBeNull();
    mkdirSync(join(dir, ".arbab"));
    writeFileSync(join(dir, LOCAL_CONFIG_FILE), JSON.stringify({ maxParallel: 3 }));
    expect(configPath(dir)).toBe(join(dir, ".arbab", "config.json"));
    expect(loadConfig(dir).maxParallel).toBe(3);
  });

  it("prefers arbab.config.json when both exist", () => {
    mkdirSync(join(dir, ".arbab"));
    writeFileSync(join(dir, LOCAL_CONFIG_FILE), JSON.stringify({ maxParallel: 3 }));
    writeFileSync(join(dir, CONFIG_FILE), JSON.stringify({ maxParallel: 5 }));
    expect(configPath(dir)).toBe(join(dir, CONFIG_FILE));
    expect(loadConfig(dir).maxParallel).toBe(5);
  });

  it("validates .arbab/config.json as strictly, naming that file", () => {
    mkdirSync(join(dir, ".arbab"));
    writeFileSync(join(dir, LOCAL_CONFIG_FILE), "[]");
    const err = errorOf(() => loadConfig(dir));
    expect(err.code).toBe("config");
    expect(err.message).toContain(LOCAL_CONFIG_FILE);
    writeFileSync(join(dir, LOCAL_CONFIG_FILE), JSON.stringify({ bogus: 1 }));
    expect(errorOf(() => loadConfig(dir)).message).toContain("bogus");
    writeFileSync(join(dir, LOCAL_CONFIG_FILE), "{");
    expect(errorOf(() => loadConfig(dir)).code).toBe("config");
  });

  it("accepts a null smoke and rejects bad verify, review and landing values", () => {
    expect(loadWith({ verify: { smoke: null } }).verify).toEqual({ smoke: null });
    configError({ verify: { smoke: [] } }, "verify.smoke");
    configError({ verify: { smoke: "make smoke" } }, "verify.smoke");
    configError({ verify: { other: 1 } }, "other");
    configError({ review: { lenses: { "Bad Name": "x" } } }, "review.lenses");
    configError({ review: { lenses: { perf: "" } } }, "review.lenses.perf");
    configError({ review: { lenses: { perf: "x".repeat(2001) } } }, "review.lenses.perf");
    configError({ landing: { tier: "extreme" } }, "landing.tier");
    configError({ landing: { tier: 1 } }, "landing.tier");
  });

  it("rejects wrong types", () => {
    configError({ baseBranch: 1 }, "baseBranch");
    configError({ instructions: "CLAUDE.md" }, "instructions");
    configError({ env: [] }, "env");
    configError({ credentialPaths: [1] }, "credentialPaths[0]");
    configError({ maxParallel: "4" }, "maxParallel");
    configError({ dependencies: { strategy: "clone" } }, "dependencies.strategy");
    configError({ dependencies: { strategy: "command" } }, "dependencies.command");
    configError({ dependencies: { strategy: "none", command: ["x"] } }, "dependencies.command");
    configError({ env: { CI: 1 } }, "env.CI");
    configError({ quota: { holdAbove: { hourly: 0.5 } } }, "quota.holdAbove.hourly");
  });

  it("rejects a base branch that git would read as an option", () => configError({ baseBranch: "-x" }, "baseBranch"));

  it("rejects roots that overlap the integration records, which vouch for install points", () => {
    for (const root of [".arbab/integrations", ".arbab/integrations/x", ".arbab", "./.arbab/integrations/"]) {
      configError({ worktreeRoot: root }, "worktreeRoot");
      configError({ runsRoot: root }, "runsRoot");
    }
    expect(loadWith({ worktreeRoot: ".arbab/integrations-wt" }).worktreeRoot).toBe(".arbab/integrations-wt");
  });

  it("rejects roots and instructions outside the project", () => {
    configError({ worktreeRoot: "../wt" }, "worktreeRoot");
    configError({ runsRoot: "/tmp/runs" }, "runsRoot");
    configError({ runsRoot: "." }, "runsRoot");
    writeFileSync(join(dir, "ok.md"), "ok");
    configError({ instructions: ["ok.md", "../../etc/passwd"] }, "instructions[1]");
  });

  it("rejects instruction files that are missing or not files", () => {
    configError({ instructions: ["NOPE.md"] }, "instructions[0]");
    mkdirSync(join(dir, "docs"));
    configError({ instructions: ["docs"] }, "instructions[0]");
  });

  it("rejects an instruction file symlinked to outside the project", () => {
    const outside = mkdtempSync(join(tmpdir(), "arbab-outside-"));
    try {
      writeFileSync(join(outside, "credentials"), "secret");
      symlinkSync(join(outside, "credentials"), join(dir, "CLAUDE.md"));
      configError({ instructions: ["CLAUDE.md"] }, "instructions[0]");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("accepts an instruction file symlinked inside the project", () => {
    mkdirSync(join(dir, "docs"));
    writeFileSync(join(dir, "docs", "RULES.md"), "# Rules\n");
    symlinkSync(join(dir, "docs", "RULES.md"), join(dir, "CLAUDE.md"));
    expect(loadWith({ instructions: ["CLAUDE.md"] }).instructions).toEqual(["CLAUDE.md"]);
  });

  it("rejects command prefixes with shell metacharacters", () => {
    for (const bad of [";", "&", "|", "`", "$", "<", ">", "(", ")", "\\", "\n"]) {
      configError({ commands: { implementer: ["pnpm test", `pnpm test ${bad} x`] } }, "commands.implementer[1]");
    }
  });

  it("rejects command lists for unknown roles", () => configError({ commands: { builder: ["make"] } }, "commands.builder"));

  it("rejects invalid and reserved env keys", () => {
    for (const key of ["1X", "A-B", "CLAUDE_X", "ANTHROPIC_API_KEY", "VSCODE_PID", "CURSOR_X", "HOME", "PATH", "CLAUDECODE",
      "TERM_PROGRAM", "TERM_PROGRAM_VERSION"]) {
      configError({ env: { [key]: "v" } }, `env.${key}`);
    }
  });

  it("rejects reserved passEnv names and allows ANTHROPIC_API_KEY", () => {
    for (const key of ["CLAUDE_CODE_X", "CLAUDECODE", "VSCODE_PID", "CURSOR_TRACE", "TERM_PROGRAM", "TERM_PROGRAM_VERSION", "a b"]) {
      configError({ passEnv: [key] }, "passEnv[0]");
    }
    expect(loadWith({ passEnv: ["ANTHROPIC_API_KEY"] }).passEnv).toEqual(["ANTHROPIC_API_KEY"]);
  });

  it("rejects invalid resource and semaphore names", () => {
    configError({ resources: { Port: { range: [1, 2] } } }, "resources.Port");
    configError({ semaphores: { "../x": 1 } }, "semaphores.../x");
  });

  it("rejects bad ranges", () => {
    configError({ resources: { db: { range: [3, 1] } } }, "resources.db.range");
    configError({ resources: { db: { range: [0.5, 1] } } }, "resources.db.range[0]");
    configError({ resources: { db: { range: [1] } } }, "resources.db.range");
    configError({ resources: { db: { range: [-1, 1] } } }, "resources.db.range[0]");
    configError({ resources: { db: {} } }, "resources.db.range");
    configError({ resources: { db: { range: [1, 2], extra: 1 } } }, "resources.db.extra");
    configError({ resources: { port: { range: [80, 90] } } }, "resources.port.range[0]");
    configError({ resources: { port: { range: [4000, 70000] } } }, "resources.port.range[1]");
  });

  it("rejects a semaphore capacity below 1", () => {
    configError({ semaphores: { db: 0 } }, "semaphores.db");
    configError({ semaphores: { db: 1.5 } }, "semaphores.db");
  });

  it("rejects gates and preflight steps that are not non-empty string arrays", () => {
    configError({ gates: [[]] }, "gates[0]");
    configError({ gates: ["pnpm test"] }, "gates[0]");
    configError({ gates: [["pnpm", 1]] }, "gates[0][1]");
    configError({ preflight: { steps: [[""]] } }, "preflight.steps[0][0]");
    configError({ preflight: { steps: "x" } }, "preflight.steps");
    configError({ preflight: { step: [] } }, "preflight.step");
  });

  it("reads landing.squash, fence and hostGates", () => {
    const config = loadWith({
      landing: { squash: true },
      fence: { readableEnvFiles: [".env.example", "apps/web/.env.sample"], bashOutputMaxChars: 4000 },
      hostGates: [["docker", "compose", "up", "--wait"]],
    });
    expect(config.landing).toEqual({ tier: "medium", squash: true });
    expect(config.fence).toEqual({ readableEnvFiles: [".env.example", "apps/web/.env.sample"], bashOutputMaxChars: 4000 });
    expect(config.hostGates).toEqual([["docker", "compose", "up", "--wait"]]);
    expect(loadWith({ fence: { bashOutputMaxChars: 128000 } }).fence).toEqual({ readableEnvFiles: [], bashOutputMaxChars: 128000 });
    expect(loadWith({ fence: {} }).fence).toEqual(defaultConfig().fence);
  });

  it("rejects bad landing.squash, fence and hostGates values", () => {
    configError({ landing: { squash: "yes" } }, "landing.squash");
    configError({ landing: { merge: true } }, "landing.merge");
    configError({ fence: [] }, "fence");
    configError({ fence: { other: 1 } }, "fence.other");
    configError({ fence: { bashOutputMaxChars: 3999 } }, "fence.bashOutputMaxChars");
    configError({ fence: { bashOutputMaxChars: 128001 } }, "fence.bashOutputMaxChars");
    configError({ fence: { bashOutputMaxChars: 5000.5 } }, "fence.bashOutputMaxChars");
    configError({ fence: { readableEnvFiles: ".env.example" } }, "fence.readableEnvFiles");
    for (const bad of ["/repo/.env.example", "~/.env.example", "../.env.example", "a/../.env.example", "a\\..\\.env.x", "config.env",
      "env.example", ".env.example/", "", "a/.en"]) {
      configError({ fence: { readableEnvFiles: [".env.sample", bad] } }, "fence.readableEnvFiles[1]");
    }
    configError({ fence: { readableEnvFiles: [".env.example", ".env.example"] } }, "fence.readableEnvFiles[1]");
    configError({ hostGates: [[]] }, "hostGates[0]");
    configError({ hostGates: ["docker compose up"] }, "hostGates[0]");
    configError({ hostGates: "x" }, "hostGates");
  });

  it("rejects maxParallel outside 1–32", () => {
    configError({ maxParallel: 0 }, "maxParallel");
    configError({ maxParallel: 33 }, "maxParallel");
    configError({ maxParallel: 2.5 }, "maxParallel");
  });

  it("rejects thresholds outside (0, 1]", () => {
    configError({ quota: { holdAbove: { fiveHour: 0 } } }, "quota.holdAbove.fiveHour");
    configError({ quota: { holdAbove: { sevenDay: 1.01 } } }, "quota.holdAbove.sevenDay");
    configError({ quota: { holdAbove: { sevenDay: "0.9" } } }, "quota.holdAbove.sevenDay");
  });

  it("rejects unknown role keys and role fields of the wrong type", () => {
    configError({ roles: { builder: {} } }, "roles.builder");
    configError({ roles: { probe: { color: "red" } } }, "roles.probe.color");
    configError({ roles: { probe: { tools: "Read" } } }, "roles.probe.tools");
    configError({ roles: { probe: { model: "" } } }, "roles.probe.model");
    configError({ roles: { probe: { effort: "huge" } } }, "roles.probe.effort");
    configError({ roles: { probe: { budgetUsd: -1 } } }, "roles.probe.budgetUsd");
    configError({ roles: { probe: { wallMin: 0 } } }, "roles.probe.wallMin");
    configError({ roles: { probe: { idleMin: "5" } } }, "roles.probe.idleMin");
    configError({ roles: { probe: { loopback: "yes" } } }, "roles.probe.loopback");
    configError({ roles: { probe: { checkpoint: 1 } } }, "roles.probe.checkpoint");
    configError({ roles: { probe: { autoResume: null } } }, "roles.probe.autoResume");
    configError({ roles: { probe: { maxAttempts: 11 } } }, "roles.probe.maxAttempts");
  });

  it("rejects a minClaudeVersion that is not x.y.z", () => {
    configError({ minClaudeVersion: "2.1" }, "minClaudeVersion");
    configError({ minClaudeVersion: "v2.1.290" }, "minClaudeVersion");
    configError({ minClaudeVersion: 2 }, "minClaudeVersion");
  });
});

describe("loadLane", () => {
  beforeEach(() => {
    mkdirSync(join(dir, "lanes"));
    writeFileSync(join(dir, "lanes", "x.md"), "## Task\n");
    writeFileSync(join(dir, "lanes", "schema.json"), "{}");
  });

  const base = { name: "m1-x", role: "implementer", brief: "lanes/x.md" };

  function writeLane(lane: unknown): string {
    writeFileSync(join(dir, "lanes", "x.json"), JSON.stringify(lane));
    return "lanes/x.json";
  }

  function laneError(lane: unknown, field: string): void {
    const err = errorOf(() => loadLane(dir, writeLane(lane)));
    expect(err.code).toBe("config");
    expect(err.message).toContain(field);
  }

  it("loads a minimal lane", () => {
    expect(loadLane(dir, writeLane(base))).toEqual(base);
  });

  it("loads a full lane", () => {
    const lane = {
      ...base,
      base: "main",
      worktree: "m1-build",
      model: "claude-sonnet-5-5",
      effort: "xhigh",
      budgetUsd: 2.5,
      wallMin: 30,
      idleMin: 10,
      fence: "sandbox-auto",
      allow: ["Bash(make check)"],
      schema: "lanes/schema.json",
      resources: { port: 2 },
      semaphores: ["shared-db"],
      checkpoint: false,
      autoResume: true,
      maxAttempts: 10,
      coordination: "siblings",
      upstream: ["m1-a"],
      mergeBranches: ["arbab/m1-a"],
    };
    expect(loadLane(dir, writeLane(lane))).toEqual(lane);
  });

  it("rejects merge branches that are not refs git could take as arguments", () => {
    laneError({ ...base, mergeBranches: "arbab/a" }, "mergeBranches");
    laneError({ ...base, mergeBranches: ["arbab/a", "--upload-pack=x"] }, "mergeBranches[1]");
    laneError({ ...base, mergeBranches: ["a b"] }, "mergeBranches[0]");
    laneError({ ...base, mergeBranches: [""] }, "mergeBranches[0]");
  });

  it("accepts an absolute lane path", () => {
    writeLane(base);
    expect(loadLane(dir, join(dir, "lanes", "x.json")).name).toBe("m1-x");
  });

  it("reports a missing lane file as a usage error", () => {
    expect(errorOf(() => loadLane(dir, "lanes/none.json")).code).toBe("usage");
  });

  it("rejects a lane that is not JSON or not an object", () => {
    writeFileSync(join(dir, "lanes", "bad.json"), "{");
    expect(errorOf(() => loadLane(dir, "lanes/bad.json")).code).toBe("config");
    laneError([], "lanes/x.json");
  });

  it("rejects an unknown key", () => laneError({ ...base, budget: 3 }, "budget"));
  it("rejects an invalid name", () => {
    laneError({ ...base, name: "../x" }, "name");
    laneError({ ...base, name: undefined }, "name");
  });
  it("rejects an invalid role", () => laneError({ ...base, role: "builder" }, "role"));

  it("rejects a brief outside the project or missing", () => {
    laneError({ ...base, brief: "../x.md" }, "brief");
    laneError({ ...base, brief: "lanes/missing.md" }, "brief");
    laneError({ ...base, brief: "lanes" }, "brief");
    laneError({ ...base, brief: undefined }, "brief");
  });

  it("rejects a brief symlinked to outside the project", () => {
    const outside = mkdtempSync(join(tmpdir(), "arbab-outside-"));
    try {
      writeFileSync(join(outside, "secret.md"), "x");
      symlinkSync(join(outside, "secret.md"), join(dir, "lanes", "link.md"));
      laneError({ ...base, brief: "lanes/link.md" }, "brief");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects a schema outside the project or missing", () => {
    laneError({ ...base, schema: "/etc/hosts" }, "schema");
    laneError({ ...base, schema: "lanes/none.json" }, "schema");
  });

  it("rejects an invalid effort", () => laneError({ ...base, effort: "huge" }, "effort"));

  it("rejects non-positive or non-finite numbers", () => {
    laneError({ ...base, budgetUsd: 0 }, "budgetUsd");
    laneError({ ...base, wallMin: -5 }, "wallMin");
    laneError({ ...base, idleMin: "5" }, "idleMin");
  });

  it("rejects allow entries that are not strings", () => {
    laneError({ ...base, allow: [1] }, "allow[0]");
    laneError({ ...base, allow: "Bash(x)" }, "allow");
  });

  it("rejects bad resources", () => {
    laneError({ ...base, resources: { Port: 1 } }, "resources.Port");
    laneError({ ...base, resources: { port: 0 } }, "resources.port");
    laneError({ ...base, resources: { port: 9 } }, "resources.port");
    laneError({ ...base, resources: { port: 1.5 } }, "resources.port");
    laneError({ ...base, resources: [] }, "resources");
  });

  it("rejects invalid semaphore, upstream and worktree names", () => {
    laneError({ ...base, semaphores: ["Shared"] }, "semaphores[0]");
    laneError({ ...base, upstream: ["ok", "a/b"] }, "upstream[1]");
    laneError({ ...base, worktree: "../other" }, "worktree");
  });

  it("rejects an unknown fence", () => laneError({ ...base, fence: "none" }, "fence"));

  it("rejects maxAttempts outside 1–10", () => {
    laneError({ ...base, maxAttempts: 0 }, "maxAttempts");
    laneError({ ...base, maxAttempts: 11 }, "maxAttempts");
    laneError({ ...base, maxAttempts: 2.5 }, "maxAttempts");
  });

  it("rejects other wrong types", () => {
    laneError({ ...base, base: "--upload-pack=x" }, "base");
    laneError({ ...base, model: 5 }, "model");
    laneError({ ...base, checkpoint: "yes" }, "checkpoint");
    laneError({ ...base, autoResume: 0 }, "autoResume");
    laneError({ ...base, coordination: [] }, "coordination");
  });
});

describe("effectiveRole", () => {
  it("overlays config.roles and then the lane's fields", () => {
    const config = defaultConfig();
    config.roles.implementer = { wallMin: 30, idleMin: 7 };
    const role = effectiveRole(config, { name: "x", role: "implementer", brief: "b.md", idleMin: 3, checkpoint: false, maxAttempts: 2 });
    expect(role).toMatchObject({ wallMin: 30, idleMin: 3, checkpoint: false, maxAttempts: 2, autoResume: true, effort: "high" });
  });

  it("narrows the role's tools to the lane's, in the role's order, and never widens them", () => {
    const config = defaultConfig();
    const lane = { name: "x", role: "probe" as const, brief: "b.md" };
    expect(effectiveRole(config, lane).tools).toEqual(["Read", "Write", "Bash"]);
    expect(effectiveRole(config, { ...lane, tools: ["Bash", "Read"] }).tools).toEqual(["Read", "Bash"]);
    // Edit is not a probe tool: listing it adds nothing.
    expect(effectiveRole(config, { ...lane, tools: ["Bash", "Edit"] }).tools).toEqual(["Bash"]);
    config.roles.probe = { tools: ["Read", "Bash"] };
    expect(effectiveRole(config, { ...lane, tools: ["Read", "Write"] }).tools).toEqual(["Read"]);
  });

  it("refuses tools that leave the lane none", () => {
    expect(() => effectiveRole(defaultConfig(), { name: "x", role: "probe", brief: "b.md", tools: ["Edit"] })).toThrow(
      /lane x: tools Edit name none of role probe's tools \(Read, Write, Bash\)/,
    );
  });
});
