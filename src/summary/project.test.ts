import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openProject } from "../commands/project";
import { NOW_MS, makeProject, writeLaneRun, type TestProject } from "../commands/testkit";
import { projectSummary } from "./project";
import { integrationDir, writeIntegration, writePlanPhase, writeSlot } from "./testkit";

let p: TestProject;
afterEach(() => p?.dispose());

describe("projectSummary", () => {
  it("gathers every section of one project", () => {
    p = makeProject();
    p.alive.add(5000);
    writePlanPhase(p.root, "field", "core");
    writeLaneRun(p.runsRoot, "core", { state: "running", shepherdPid: 5000 });
    writeLaneRun(p.runsRoot, "docs", { state: "finished", endState: "no-result" });
    writeIntegration(p.root, "rel");
    writeSlot(p.home, 0, { pid: 5000, lane: "core", project: p.root, createdAt: "2026-10-09T11:00:00.000Z" });
    const s = projectSummary({ project: openProject(p.ctx), home: p.home, machine: { maxParallel: 2 }, alive: p.ctx.alive, nowMs: NOW_MS });
    expect(s.root).toBe(p.root);
    expect(s.lanes.total).toBe(2);
    expect(s.lanes.active.map((l) => l.lane)).toEqual(["core"]);
    expect(s.plans).toEqual([{ plan: "field", phases: [{ phase: "core", status: "running", endState: null }] }]);
    expect(s.integrations.map((i) => [i.name, i.stage])).toEqual([["rel", "integrated"]]);
    expect(s.attention.map((a) => a.lane)).toEqual(["docs"]);
    expect(s.quota.slots).toMatchObject({ cap: 2, inUse: [{ lane: "core" }] });
    expect(s.errors).toEqual([]);
  });

  it("collects the unreadable records of every section", () => {
    p = makeProject();
    mkdirSync(join(p.runsRoot, "torn"), { recursive: true });
    writeFileSync(join(p.runsRoot, "torn", "state.json"), "{");
    writePlanPhase(p.root, "field", "torn");
    mkdirSync(integrationDir(p.root, "bad"), { recursive: true });
    writeFileSync(join(integrationDir(p.root, "bad"), "integration.json"), "{}");
    const s = projectSummary({ project: openProject(p.ctx), home: p.home, machine: { maxParallel: null }, alive: p.ctx.alive, nowMs: NOW_MS });
    expect(s.errors.map((e) => e.split(":")[0])).toEqual(["lane torn", "plan field phase torn", "integration bad"]);
  });
});
