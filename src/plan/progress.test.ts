import { describe, expect, it } from "vitest";
import type { EndState, LaneState, PlanPhase, PlanSpec } from "../types";
import type { PhaseState, PhaseStates } from "./index";
import { nextPhases, planStatus, retryRefusal } from "./index";

function phase(name: string, dependsOn?: string[]): PlanPhase {
  const p: PlanPhase = { name, role: "implementer", brief: `lanes/${name}.md`, scope: [`src/${name}/**`] };
  if (dependsOn !== undefined) p.dependsOn = dependsOn;
  return p;
}

const SHA = "c".repeat(40);
const st = (state: LaneState, endState: EndState | null = null, exit: PhaseState["exit"] = { checkpoint: SHA, checkpointError: null }): PhaseState => ({
  state,
  endState,
  exit,
});

// a ← b, a ← c, {b, c} ← d
const diamond: PlanSpec = { name: "p", phases: [phase("a"), phase("b", ["a"]), phase("c", ["a"]), phase("d", ["b", "c"])] };

describe("nextPhases", () => {
  it("launches every root phase of a fresh plan and blocks the rest", () => {
    expect(nextPhases(diamond, {})).toEqual({
      launch: ["a"],
      blocked: [
        { phase: "b", waitingFor: ["a"] },
        { phase: "c", waitingFor: ["a"] },
        { phase: "d", waitingFor: ["b", "c"] },
      ],
      failed: [],
    });
  });

  it("leaves phases that already have a state out of every list", () => {
    const states: PhaseStates = { a: st("finished", "success"), b: st("running"), c: st("queued") };
    expect(nextPhases(diamond, states)).toEqual({
      launch: [],
      blocked: [{ phase: "d", waitingFor: ["b", "c"] }],
      failed: [],
    });
  });

  it("launches a phase once all its dependencies finished with success", () => {
    const states: PhaseStates = { a: st("finished", "success"), b: st("finished", "success"), c: st("finished", "success") };
    expect(nextPhases(diamond, states)).toEqual({ launch: ["d"], blocked: [], failed: [] });
  });

  it("launches several phases at once", () => {
    expect(nextPhases(diamond, { a: st("finished", "success") }).launch).toEqual(["b", "c"]);
  });

  it("blocks while any dependency has not finished and its shepherd lives", () => {
    for (const state of ["queued", "held", "preparing", "running", "waiting-reset"] as LaneState[]) {
      const states: PhaseStates = { a: st("finished", "success"), b: st("finished", "success"), c: st(state, "running") };
      expect(nextPhases(diamond, states).blocked).toEqual([{ phase: "d", waitingFor: ["c"] }]);
    }
  });

  it("fails a phase whose dependency is orphaned, with end state orphaned", () => {
    const states: PhaseStates = { a: st("finished", "success"), b: st("finished", "success"), c: st("orphaned", "running") };
    expect(nextPhases(diamond, states)).toEqual({
      launch: [],
      blocked: [],
      failed: [{ phase: "d", dependency: "c", endState: "orphaned", reason: null }],
    });
  });

  it("launches after a dependency that succeeded and recorded no changes", () => {
    const states: PhaseStates = { a: st("finished", "success", { checkpoint: null, checkpointError: null }) };
    expect(nextPhases(diamond, states).launch).toEqual(["b", "c"]);
  });

  it("fails a phase whose dependency succeeded but whose checkpoint failed, with the error", () => {
    const states: PhaseStates = { a: st("finished", "success", { checkpoint: null, checkpointError: "git commit failed (1): boom" }) };
    expect(nextPhases(diamond, states).failed).toEqual([
      { phase: "b", dependency: "a", endState: "success", reason: "its checkpoint failed: git commit failed (1): boom" },
      { phase: "c", dependency: "a", endState: "success", reason: "its checkpoint failed: git commit failed (1): boom" },
    ]);
    expect(nextPhases(diamond, states).launch).toEqual([]);
  });

  it("fails a phase whose dependency succeeded without a readable exit.json", () => {
    const out = nextPhases(diamond, { a: st("finished", "success", null) });
    expect(out.launch).toEqual([]);
    expect(out.failed[0]).toEqual({ phase: "b", dependency: "a", endState: "success", reason: "its latest attempt has no readable exit.json" });
  });

  it("blocks on a dependency that was never launched", () => {
    const states: PhaseStates = { a: st("finished", "success"), b: st("finished", "success") };
    expect(nextPhases(diamond, states).blocked).toEqual([{ phase: "d", waitingFor: ["c"] }]);
  });

  it("fails a phase whose dependency finished with anything but success", () => {
    const ends: Array<EndState | null> = ["failed", "budget", "invalid-report", "killed:wall", "no-result", null];
    for (const endState of ends) {
      const out = nextPhases(diamond, { a: st("finished", endState) });
      expect(out.launch).toEqual([]);
      expect(out.failed).toEqual([
        { phase: "b", dependency: "a", endState, reason: null },
        { phase: "c", dependency: "a", endState, reason: null },
      ]);
      expect(out.blocked).toEqual([{ phase: "d", waitingFor: ["b", "c"] }]);
    }
  });

  it("fails with the first failed dependency even when others are pending or succeeded", () => {
    const states: PhaseStates = { a: st("finished", "success"), b: st("running"), c: st("finished", "failed") };
    expect(nextPhases(diamond, states)).toEqual({
      launch: [],
      blocked: [],
      failed: [{ phase: "d", dependency: "c", endState: "failed", reason: null }],
    });
    const both: PhaseStates = { a: st("finished", "success"), b: st("finished", "budget"), c: st("finished", "failed") };
    expect(nextPhases(diamond, both).failed).toEqual([{ phase: "d", dependency: "b", endState: "budget", reason: null }]);
  });

  it("blocks forever on an unknown dependency rather than launching", () => {
    const p: PlanSpec = { name: "p", phases: [phase("a", ["ghost"])] };
    expect(nextPhases(p, {})).toEqual({ launch: [], blocked: [{ phase: "a", waitingFor: ["ghost"] }], failed: [] });
  });

  it("lists a duplicated phase once", () => {
    const p: PlanSpec = { name: "p", phases: [phase("a"), phase("a")] };
    expect(nextPhases(p, {}).launch).toEqual(["a"]);
  });
});

describe("retryRefusal", () => {
  it("allows a phase that ended in anything but success, or whose shepherd died", () => {
    const ends: Array<EndState | null> = ["failed", "budget", "max-turns", "invalid-report", "no-result", "unsupported-cli", "killed:wall", null];
    for (const endState of ends) expect(retryRefusal(diamond, { b: st("finished", endState) }, "b"), String(endState)).toBeNull();
    expect(retryRefusal(diamond, { b: st("orphaned", "running") }, "b")).toBeNull();
  });

  it("refuses a phase that succeeded, is active, never ran or is not in the plan, naming the reason", () => {
    expect(retryRefusal(diamond, { a: st("finished", "success") }, "a")).toBe("phase a succeeded; there is nothing to retry");
    for (const state of ["queued", "held", "preparing", "running", "waiting-reset"] as LaneState[]) {
      expect(retryRefusal(diamond, { a: st(state, "running") }, "a")).toBe(`phase a is ${state}; stop it or wait for it first`);
    }
    expect(retryRefusal(diamond, {}, "a")).toMatch(/^phase a never ran; /);
    expect(retryRefusal(diamond, {}, "ghost")).toBe("phase ghost is not in plan p");
  });
});

describe("planStatus", () => {
  it("returns one row per phase with its wave, dependencies and state", () => {
    const states: PhaseStates = { a: st("finished", "success"), b: st("running", "running") };
    expect(planStatus(diamond, states)).toEqual([
      { phase: "a", wave: 0, dependsOn: [], state: "finished", endState: "success" },
      { phase: "b", wave: 1, dependsOn: ["a"], state: "running", endState: "running" },
      { phase: "c", wave: 1, dependsOn: ["a"], state: null, endState: null },
      { phase: "d", wave: 2, dependsOn: ["b", "c"], state: null, endState: null },
    ]);
  });

  it("does not alias the plan's dependency arrays", () => {
    const rows = planStatus(diamond, {});
    rows[3]?.dependsOn.push("x");
    expect(diamond.phases[3]?.dependsOn).toEqual(["b", "c"]);
  });

  it("throws on a plan that does not resolve", () => {
    const p: PlanSpec = { name: "p", phases: [phase("a", ["b"]), phase("b", ["a"])] };
    expect(() => planStatus(p, {})).toThrow(/cycle/);
  });
});
