import { describe, expect, it } from "vitest";
import type { PlanPhase, PlanSpec } from "../types";
import { ArbabError } from "../util/errors";
import { COORDINATION_INTRO, compilePhase } from "./index";

function phase(name: string, scope: string[], extra: Partial<PlanPhase> = {}): PlanPhase {
  return { name, role: "implementer", brief: `lanes/${name}.md`, scope, ...extra };
}

const plan: PlanSpec = {
  name: "m2",
  base: "main",
  defaults: { role: "implementer", effort: "high", budgetUsd: 10, allow: ["Bash(make)"], resources: { port: 1 } },
  phases: [
    phase("m2-plan", ["src/plan/**"]),
    phase("m2-digest", ["src/digest/**", "src/stream/digest.ts"], { role: "researcher", effort: "low" }),
    phase("m2-wire", ["src/commands/plan*.ts"], { dependsOn: ["m2-plan", "m2-digest"], model: "claude-opus-5-5" }),
  ],
};

describe("compilePhase", () => {
  it("compiles a root phase: defaults, plan base, siblings as coordination", () => {
    expect(compilePhase(plan, "m2-plan")).toEqual({
      name: "m2-plan",
      role: "implementer",
      brief: "lanes/m2-plan.md",
      base: "main",
      effort: "high",
      budgetUsd: 10,
      allow: ["Bash(make)"],
      resources: { port: 1 },
      coordination: `${COORDINATION_INTRO}\n- \`m2-digest\` owns \`src/digest/**\`, \`src/stream/digest.ts\``,
    });
  });

  it("lets phase fields override the defaults", () => {
    const lane = compilePhase(plan, "m2-digest");
    expect(lane.role).toBe("researcher");
    expect(lane.effort).toBe("low");
    expect(lane.budgetUsd).toBe(10);
    expect(lane.coordination).toBe(`${COORDINATION_INTRO}\n- \`m2-plan\` owns \`src/plan/**\``);
  });

  it("compiles a dependent phase: upstream reports and merged branches, alone in its wave", () => {
    expect(compilePhase(plan, "m2-wire")).toEqual({
      name: "m2-wire",
      role: "implementer",
      brief: "lanes/m2-wire.md",
      base: "main",
      model: "claude-opus-5-5",
      effort: "high",
      budgetUsd: 10,
      allow: ["Bash(make)"],
      resources: { port: 1 },
      upstream: ["m2-plan", "m2-digest"],
      mergeBranches: ["arbab/m2-plan", "arbab/m2-digest"],
    });
  });

  it("leaves base out when the plan has none, and defaults the role", () => {
    const bare: PlanSpec = { name: "p", phases: [{ name: "a", brief: "a.md", scope: ["a"] } as PlanPhase] };
    expect(compilePhase(bare, "a")).toEqual({ name: "a", role: "implementer", brief: "a.md" });
  });

  it("never drops scope or dependsOn into the lane", () => {
    const lane = compilePhase(plan, "m2-wire") as unknown as Record<string, unknown>;
    expect(lane.scope).toBeUndefined();
    expect(lane.dependsOn).toBeUndefined();
  });

  it("copies arrays and records so the lane does not alias the plan", () => {
    const lane = compilePhase(plan, "m2-plan");
    lane.allow?.push("Bash(x)");
    if (lane.resources) lane.resources.port = 8;
    const wire = compilePhase(plan, "m2-wire");
    wire.upstream?.push("x");
    expect(plan.defaults?.allow).toEqual(["Bash(make)"]);
    expect(plan.defaults?.resources).toEqual({ port: 1 });
    expect(plan.phases[2]?.dependsOn).toEqual(["m2-plan", "m2-digest"]);
  });

  it("lists several siblings in wave order", () => {
    const p: PlanSpec = { name: "p", phases: [phase("c", ["c"]), phase("a", ["a"]), phase("b", ["b/**"])] };
    expect(compilePhase(p, "a").coordination).toBe(`${COORDINATION_INTRO}\n- \`b\` owns \`b/**\`\n- \`c\` owns \`c\``);
  });

  it("throws usage for an unknown phase and config for a plan that does not resolve", () => {
    const unknown = (() => {
      try {
        compilePhase(plan, "m2-none");
      } catch (err) {
        return err;
      }
      return null;
    })();
    expect(unknown).toBeInstanceOf(ArbabError);
    expect((unknown as ArbabError).code).toBe("usage");

    const cyclic: PlanSpec = { name: "p", phases: [phase("a", ["a"], { dependsOn: ["a"] })] };
    expect(() => compilePhase(cyclic, "a")).toThrow(/cycle/);
  });
});
