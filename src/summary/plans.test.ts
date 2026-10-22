import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeProject, writeLaneRun, type TestProject } from "../commands/testkit";
import { planOverview } from "./plans";
import { writePlanPhase } from "./testkit";

let p: TestProject;
afterEach(() => p?.dispose());

const LIVE = 5000;

describe("planOverview", () => {
  it("lists each launched phase with its state", () => {
    p = makeProject();
    p.alive.add(LIVE);
    for (const phase of ["core", "cli", "docs", "fence", "ghost", "idle", "new"]) writePlanPhase(p.root, "field", phase);
    writeLaneRun(p.runsRoot, "core", { state: "finished", endState: "success" });
    writeLaneRun(p.runsRoot, "cli", { state: "running", shepherdPid: LIVE });
    writeLaneRun(p.runsRoot, "docs", { state: "finished", endState: "killed:wall" });
    writeLaneRun(p.runsRoot, "fence", { state: "held", shepherdPid: LIVE });
    writeLaneRun(p.runsRoot, "ghost", { state: "running", shepherdPid: 31337 });
    writeLaneRun(p.runsRoot, "idle", { state: "finished", summary: { state: "success" } });
    const { plans, errors } = planOverview(p.root, p.runsRoot, p.ctx.alive);
    expect(errors).toEqual([]);
    expect(plans).toEqual([
      {
        plan: "field",
        phases: [
          { phase: "cli", status: "running", endState: null },
          { phase: "core", status: "done", endState: "success" },
          { phase: "docs", status: "failed", endState: "killed:wall" },
          { phase: "fence", status: "held", endState: null },
          { phase: "ghost", status: "failed", endState: "orphaned" },
          { phase: "idle", status: "done", endState: "success" },
          { phase: "new", status: "launched", endState: null },
        ],
      },
    ]);
  });

  it("keeps plans apart, ignores other files and leaves out empty plan directories", () => {
    p = makeProject();
    writePlanPhase(p.root, "beta", "one");
    writePlanPhase(p.root, "alpha", "two");
    mkdirSync(join(p.root, ".arbab", "plans", "empty"), { recursive: true });
    mkdirSync(join(p.root, ".arbab", "plans", "Not_Valid"), { recursive: true });
    writeFileSync(join(p.root, ".arbab", "plans", "alpha", "notes.txt"), "x");
    writeFileSync(join(p.root, ".arbab", "plans", "alpha", "Bad_Name.json"), "{}");
    const { plans } = planOverview(p.root, p.runsRoot, p.ctx.alive);
    expect(plans.map((x) => [x.plan, x.phases.map((ph) => ph.phase)])).toEqual([
      ["alpha", ["two"]],
      ["beta", ["one"]],
    ]);
  });

  it("reports a phase whose state cannot be read", () => {
    p = makeProject();
    writePlanPhase(p.root, "field", "torn");
    mkdirSync(join(p.runsRoot, "torn"), { recursive: true });
    writeFileSync(join(p.runsRoot, "torn", "state.json"), "[]");
    const { plans, errors } = planOverview(p.root, p.runsRoot, p.ctx.alive);
    expect(plans).toEqual([]);
    expect(errors[0]).toMatch(/^plan field phase torn: /);
  });

  it("is empty without a plans directory", () => {
    p = makeProject();
    expect(planOverview(p.root, p.runsRoot, p.ctx.alive)).toEqual({ plans: [], errors: [] });
  });
});
