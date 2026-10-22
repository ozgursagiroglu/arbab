import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArbabError } from "../util/errors";
import { loadPlan } from "./index";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arbab-plan-"));
  mkdirSync(join(dir, "plans"));
  mkdirSync(join(dir, "lanes"));
  writeFileSync(join(dir, "lanes", "a.md"), "## Task\n");
  writeFileSync(join(dir, "lanes", "b.md"), "## Task\n");
  writeFileSync(join(dir, "lanes", "schema.json"), "{}");
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

function writePlan(plan: unknown): string {
  writeFileSync(join(dir, "plans", "p.json"), JSON.stringify(plan));
  return "plans/p.json";
}

function planError(plan: unknown, field: string): void {
  const err = errorOf(() => loadPlan(dir, writePlan(plan)));
  expect(err.code).toBe("config");
  expect(err.message).toContain(field);
}

const phaseA = { name: "m2-a", brief: "lanes/a.md", scope: ["src/a/**"] };
const phaseB = { name: "m2-b", brief: "lanes/b.md", scope: ["src/b/**"], dependsOn: ["m2-a"] };
const base = { name: "m2", phases: [phaseA] };

function withPhase(extra: Record<string, unknown>): unknown {
  return { ...base, phases: [{ ...phaseA, ...extra }] };
}

describe("loadPlan", () => {
  it("loads a minimal plan, filling in the default role", () => {
    expect(loadPlan(dir, writePlan(base))).toEqual({ name: "m2", phases: [{ ...phaseA, role: "implementer" }] });
  });

  it("loads a full plan; phases take the defaults' role unless they set one", () => {
    const fields = {
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
      worktree: "m2-x",
      checkpoint: false,
      autoResume: true,
      maxAttempts: 3,
    };
    const plan = {
      name: "m2",
      base: "main",
      defaults: { role: "researcher", ...fields },
      phases: [phaseA, { ...phaseB, role: "verifier", ...fields }],
    };
    expect(loadPlan(dir, writePlan(plan))).toEqual({
      ...plan,
      phases: [
        { ...phaseA, role: "researcher" },
        { ...phaseB, role: "verifier", ...fields },
      ],
    });
  });

  it("gives defaults without a role the implementer role", () => {
    const plan = loadPlan(dir, writePlan({ ...base, defaults: { effort: "high" } }));
    expect(plan.defaults).toEqual({ role: "implementer", effort: "high" });
    expect(plan.phases[0]?.role).toBe("implementer");
  });

  it("refuses a phase brief or schema, or a defaults schema, that a credentialPaths entry hits", () => {
    const extra = ["lanes/b.md", "**/*.json"];
    const err = (plan: unknown): string => errorOf(() => loadPlan(dir, writePlan(plan), extra)).message;
    expect(err({ ...base, phases: [phaseA, { ...phaseB, brief: "lanes/b.md" }] })).toMatch(/^phases\[1\]\.brief: lanes\/b\.md matches the credential path lanes\/b\.md/);
    expect(err(withPhase({ schema: "lanes/schema.json" }))).toMatch(/^phases\[0\]\.schema: lanes\/schema\.json is named like a credential file \(schema\.json\)/);
    expect(err({ ...base, defaults: { schema: "lanes/schema.json" } })).toMatch(/^defaults\.schema: /);
    // One that matches nothing passes, and without the list the same files pass.
    expect(loadPlan(dir, writePlan(base), extra).phases).toHaveLength(1);
    expect(loadPlan(dir, writePlan(withPhase({ brief: "lanes/b.md", schema: "lanes/schema.json" }))).phases).toHaveLength(1);
  });

  it("accepts an absolute plan path", () => {
    writePlan(base);
    expect(loadPlan(dir, join(dir, "plans", "p.json")).name).toBe("m2");
  });

  it("reports a missing plan file as a usage error", () => {
    expect(errorOf(() => loadPlan(dir, "plans/none.json")).code).toBe("usage");
  });

  it("rejects a plan that is not JSON or not an object", () => {
    writeFileSync(join(dir, "plans", "bad.json"), "{");
    expect(errorOf(() => loadPlan(dir, "plans/bad.json")).code).toBe("config");
    planError([], "plans/p.json");
  });

  it("rejects unknown keys at every level", () => {
    planError({ ...base, owner: "x" }, "owner");
    planError({ ...base, defaults: { scope: ["x"] } }, "defaults.scope");
    planError({ ...base, defaults: { name: "x" } }, "defaults.name");
    planError(withPhase({ budget: 3 }), "phases[0].budget");
    planError(withPhase({ coordination: "x" }), "phases[0].coordination");
    planError(withPhase({ base: "main" }), "phases[0].base");
  });

  it("rejects an invalid plan name", () => {
    planError({ ...base, name: "M2" }, "name");
    planError({ ...base, name: "../m2" }, "name");
    planError({ ...base, name: undefined }, "name");
  });

  it("rejects a base that is empty or starts with '-'", () => {
    planError({ ...base, base: "" }, "base");
    planError({ ...base, base: "--upload-pack=x" }, "base");
    planError({ ...base, base: 3 }, "base");
  });

  it("rejects defaults that are not an object or break lane rules", () => {
    planError({ ...base, defaults: [] }, "defaults");
    planError({ ...base, defaults: { role: "builder" } }, "defaults.role");
    planError({ ...base, defaults: { effort: "huge" } }, "defaults.effort");
    planError({ ...base, defaults: { budgetUsd: 0 } }, "defaults.budgetUsd");
    planError({ ...base, defaults: { schema: "lanes/none.json" } }, "defaults.schema");
    planError({ ...base, defaults: { resources: { port: 9 } } }, "defaults.resources.port");
  });

  it("rejects phases that are missing, empty or not objects", () => {
    planError({ name: "m2" }, "phases");
    planError({ ...base, phases: [] }, "phases");
    planError({ ...base, phases: {} }, "phases");
    planError({ ...base, phases: ["m2-a"] }, "phases[0]");
  });

  it("applies the lane rules to every phase field", () => {
    planError(withPhase({ role: "builder" }), "phases[0].role");
    planError(withPhase({ model: 5 }), "phases[0].model");
    planError(withPhase({ effort: "huge" }), "phases[0].effort");
    planError(withPhase({ budgetUsd: -1 }), "phases[0].budgetUsd");
    planError(withPhase({ wallMin: "5" }), "phases[0].wallMin");
    planError(withPhase({ idleMin: 0 }), "phases[0].idleMin");
    planError(withPhase({ fence: "none" }), "phases[0].fence");
    planError(withPhase({ allow: [1] }), "phases[0].allow[0]");
    planError(withPhase({ schema: "/etc/hosts" }), "phases[0].schema");
    planError(withPhase({ resources: { Port: 1 } }), "phases[0].resources.Port");
    planError(withPhase({ semaphores: ["Shared"] }), "phases[0].semaphores[0]");
    planError(withPhase({ worktree: "../other" }), "phases[0].worktree");
    planError(withPhase({ checkpoint: "yes" }), "phases[0].checkpoint");
    planError(withPhase({ autoResume: 0 }), "phases[0].autoResume");
    planError(withPhase({ maxAttempts: 11 }), "phases[0].maxAttempts");
  });

  it("rejects an invalid phase name", () => {
    planError(withPhase({ name: "M2-A" }), "phases[0].name");
    planError(withPhase({ name: "a/b" }), "phases[0].name");
    planError(withPhase({ name: undefined }), "phases[0].name");
  });

  it("rejects a phase name or worktree that is an integration worktree's", () => {
    const err = errorOf(() => loadPlan(dir, writePlan(withPhase({ name: "integrate-m2" }))));
    expect(err.code).toBe("config");
    expect(err.message).toBe('phases[0].name: "integrate-m2" must not start with integrate-: those worktrees are reserved for arbab integrate');
    planError(withPhase({ worktree: "integrate-m2" }), "phases[0].worktree: \"integrate-m2\" must not start with integrate-");
    planError({ ...base, defaults: { worktree: "integrate-m2" } }, "defaults.worktree: \"integrate-m2\" must not start with integrate-");
  });

  it("rejects a brief that is outside the project, missing or not a file", () => {
    planError(withPhase({ brief: "../a.md" }), "phases[0].brief");
    planError(withPhase({ brief: "lanes/missing.md" }), "phases[0].brief");
    planError(withPhase({ brief: "lanes" }), "phases[0].brief");
    planError(withPhase({ brief: undefined }), "phases[0].brief");
  });

  it("rejects a brief symlinked to outside the project", () => {
    const outside = mkdtempSync(join(tmpdir(), "arbab-outside-"));
    try {
      writeFileSync(join(outside, "secret.md"), "x");
      symlinkSync(join(outside, "secret.md"), join(dir, "lanes", "link.md"));
      planError(withPhase({ brief: "lanes/link.md" }), "phases[0].brief");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects a scope that is missing, empty or not relative globs", () => {
    planError(withPhase({ scope: undefined }), "phases[0].scope");
    planError(withPhase({ scope: [] }), "phases[0].scope");
    planError(withPhase({ scope: "src/**" }), "phases[0].scope");
    planError(withPhase({ scope: ["src/**", ""] }), "phases[0].scope[1]");
    planError(withPhase({ scope: [3] }), "phases[0].scope[0]");
    planError(withPhase({ scope: ["/etc/**"] }), "phases[0].scope[0]");
    planError(withPhase({ scope: ["C:/x/**"] }), "phases[0].scope[0]");
    planError(withPhase({ scope: ["../other/**"] }), "phases[0].scope[0]");
    planError(withPhase({ scope: ["src/../../x"] }), "phases[0].scope[0]");
  });

  it("accepts scope segments that merely contain dots", () => {
    const plan = loadPlan(dir, writePlan(withPhase({ scope: ["src/..x/**", "./docs/*.md"] })));
    expect(plan.phases[0]?.scope).toEqual(["src/..x/**", "./docs/*.md"]);
  });

  it("rejects dependsOn entries that are not names", () => {
    planError(withPhase({ dependsOn: "m2-b" }), "phases[0].dependsOn");
    planError(withPhase({ dependsOn: ["m2-b", "a/b"] }), "phases[0].dependsOn[1]");
  });

  it("leaves graph rules to checkPlan", () => {
    const plan = { ...base, phases: [phaseA, { ...phaseA, dependsOn: ["m2-none"] }] };
    expect(loadPlan(dir, writePlan(plan)).phases).toHaveLength(2);
  });
});
