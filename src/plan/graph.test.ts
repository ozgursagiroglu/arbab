import { describe, expect, it } from "vitest";
import type { LintIssue, PlanPhase, PlanSpec } from "../types";
import { ArbabError } from "../util/errors";
import { LONG_WAVE, checkPlan, dependencyMap, fixedPath, globsOverlap, integrationLanes, planWaves } from "./index";

function phase(name: string, scope: string[], dependsOn?: string[]): PlanPhase {
  const p: PlanPhase = { name, role: "implementer", brief: `lanes/${name}.md`, scope };
  if (dependsOn !== undefined) p.dependsOn = dependsOn;
  return p;
}

function plan(...phases: PlanPhase[]): PlanSpec {
  return { name: "p", phases };
}

function codes(issues: LintIssue[]): string[] {
  return issues.map((i) => i.code);
}

function errorOf(fn: () => unknown): ArbabError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ArbabError);
    return err as ArbabError;
  }
  throw new Error("expected an ArbabError");
}

// a ← b, a ← c, {b, c} ← d
const diamond = plan(
  phase("d", ["src/d/**"], ["b", "c"]),
  phase("c", ["src/c/**"], ["a"]),
  phase("b", ["src/b/**"], ["a"]),
  phase("a", ["src/a/**"]),
);

describe("fixedPath", () => {
  it("keeps the segments before the first wildcard", () => {
    expect(fixedPath("src/plan/**")).toEqual(["src", "plan"]);
    expect(fixedPath("src/commands/plan*.ts")).toEqual(["src", "commands"]);
    expect(fixedPath("src/a?/x")).toEqual(["src"]);
    expect(fixedPath("src/[ab]/x")).toEqual(["src"]);
    expect(fixedPath("src/plan/x.ts")).toEqual(["src", "plan", "x.ts"]);
    expect(fixedPath("**")).toEqual([]);
  });

  it("drops empty and '.' segments", () => {
    expect(fixedPath("./src//plan/")).toEqual(["src", "plan"]);
  });

  it("ends at a brace set or an extglob", () => {
    expect(fixedPath("src/{plan,shepherd}/**")).toEqual(["src"]);
    expect(fixedPath("src/plan}/x")).toEqual(["src"]);
    for (const opener of ["@(", "!(", "+(", "*(", "?("]) {
      expect(fixedPath(`src/${opener}plan|run)/x.ts`), opener).toEqual(["src"]);
    }
    // A parenthesis alone is a literal character.
    expect(fixedPath("src/(plan)/x.ts")).toEqual(["src", "(plan)", "x.ts"]);
  });
});

describe("globsOverlap", () => {
  it("overlaps when one fixed path is a prefix of the other", () => {
    expect(globsOverlap("src/plan/**", "src/plan/x.ts")).toBe(true);
    expect(globsOverlap("src/plan/x.ts", "src/plan/**")).toBe(true);
    expect(globsOverlap("src/*.ts", "src/plan/**")).toBe(true);
    expect(globsOverlap("**", "docs/x.md")).toBe(true);
  });

  it("overlaps when the fixed paths are equal", () => {
    expect(globsOverlap("src/plan/x.ts", "src/plan/x.ts")).toBe(true);
    expect(globsOverlap("src/plan/*.ts", "src/plan/**")).toBe(true);
  });

  it("compares whole segments, not characters", () => {
    expect(globsOverlap("src/plan/**", "src/planner/**")).toBe(false);
    expect(globsOverlap("src/plan/x.ts", "src/plan/y.ts")).toBe(false);
    expect(globsOverlap("src/a/**", "docs/**")).toBe(false);
  });

  it("overlaps a brace set or an extglob with any path under its fixed prefix", () => {
    expect(globsOverlap("src/{plan,run}/**", "src/plan/x.ts")).toBe(true);
    expect(globsOverlap("src/@(plan|run)/x.ts", "src/run/y.ts")).toBe(true);
    expect(globsOverlap("src/!(plan)/**", "src/shepherd/**")).toBe(true);
  });

  it("compares segments case-insensitively", () => {
    expect(globsOverlap("src/Plan/**", "src/plan/x.ts")).toBe(true);
    expect(globsOverlap("SRC/plan/X.ts", "src/plan/x.ts")).toBe(true);
    expect(globsOverlap("src/Plan/**", "src/planner/**")).toBe(false);
  });
});

describe("dependencyMap", () => {
  it("maps each name to its dependencies, first occurrence wins", () => {
    const p = plan(phase("a", ["x"], ["b"]), phase("b", ["y"]), phase("a", ["z"], ["c"]));
    expect(dependencyMap(p)).toEqual(
      new Map([
        ["a", ["b"]],
        ["b", []],
      ]),
    );
  });
});

describe("integrationLanes", () => {
  it("lists the phases in wave order", () => {
    expect(integrationLanes(diamond)).toEqual(["a", "b", "c", "d"]);
  });

  it("leaves out phases that borrow another lane's worktree: their work is on the owner's branch", () => {
    const verify: PlanPhase = { ...phase("v", ["docs/**"], ["b"]), worktree: "b" };
    const own: PlanPhase = { ...phase("c", ["src/c/**"], ["a"]), worktree: "c" };
    const p = plan(phase("a", ["src/a/**"]), phase("b", ["src/b/**"], ["a"]), own, verify);
    expect(integrationLanes(p)).toEqual(["a", "b", "c"]);
  });

  it("applies a worktree set in the defaults to every phase that does not set its own", () => {
    const p: PlanSpec = {
      ...plan(phase("owner", ["src/**"]), { ...phase("x", ["docs/**"], ["owner"]), worktree: "x" }, phase("y", ["test/**"], ["owner"])),
      defaults: { role: "implementer", worktree: "owner" },
    };
    expect(integrationLanes(p)).toEqual(["owner", "x"]);
  });

  it("merges an owner that is not a phase once, at the first borrowing phase's place", () => {
    // m2-core is an earlier lane: its branch holds the fixes, and would otherwise be lost silently.
    const fix1: PlanPhase = { ...phase("fix1", ["src/x/**"], ["a"]), worktree: "m2-core" };
    const fix2: PlanPhase = { ...phase("fix2", ["src/y/**"], ["fix1"]), worktree: "m2-core" };
    const p = plan(phase("a", ["src/a/**"]), fix1, phase("b", ["src/b/**"], ["a"]), fix2, phase("z", ["src/z/**"], ["fix2"]));
    expect(integrationLanes(p)).toEqual(["a", "b", "m2-core", "z"]);

    const byDefault: PlanSpec = { ...plan(phase("x", ["docs/**"]), phase("y", ["test/**"], ["x"])), defaults: { role: "implementer", worktree: "outside" } };
    expect(integrationLanes(byDefault)).toEqual(["outside"]);
  });

  it("lists a name that appears twice once", () => {
    expect(integrationLanes(plan(phase("a", ["src/a/**"]), phase("a", ["src/b/**"])))).toEqual(["a"]);
  });

  it("throws on a graph that does not resolve", () => {
    expect(errorOf(() => integrationLanes(plan(phase("a", ["x"], ["b"]), phase("b", ["y"], ["a"])))).code).toBe("config");
  });
});

describe("planWaves", () => {
  it("levels a diamond graph", () => {
    expect(planWaves(diamond)).toEqual([["a"], ["b", "c"], ["d"]]);
  });

  it("puts independent phases in wave 0, sorted by name", () => {
    expect(planWaves(plan(phase("z", ["z"]), phase("m", ["m"]), phase("a", ["a"])))).toEqual([["a", "m", "z"]]);
  });

  it("places a phase one wave after its deepest dependency", () => {
    const p = plan(phase("a", ["a"]), phase("b", ["b"], ["a"]), phase("c", ["c"], ["b"]), phase("x", ["x"], ["a", "c"]));
    expect(planWaves(p)).toEqual([["a"], ["b"], ["c"], ["x"]]);
  });

  it("throws a config error naming the cycle", () => {
    const p = plan(phase("a", ["a"]), phase("b", ["b"], ["c", "a"]), phase("c", ["c"], ["b"]));
    const err = errorOf(() => planWaves(p));
    expect(err.code).toBe("config");
    expect(err.message).toContain("b → c → b");
  });

  it("throws on a self-dependency", () => {
    expect(errorOf(() => planWaves(plan(phase("a", ["a"], ["a"])))).message).toContain("a → a");
  });

  it("throws on an unknown dependency", () => {
    const err = errorOf(() => planWaves(plan(phase("a", ["a"], ["ghost"]))));
    expect(err.code).toBe("config");
    expect(err.message).toContain("ghost");
  });
});

describe("checkPlan", () => {
  it("accepts a valid plan", () => {
    expect(checkPlan(diamond)).toEqual([]);
  });

  it("reports duplicate phases once per name", () => {
    const issues = checkPlan(plan(phase("a", ["x"]), phase("a", ["y"]), phase("a", ["z"])));
    const dup = issues.filter((i) => i.code === "duplicate-phase");
    expect(dup).toHaveLength(1);
    expect(dup[0]).toMatchObject({ severity: "error", where: "a" });
    expect(dup[0]?.message).toContain("3 times");
    expect(codes(issues)).not.toContain("overlapping-scope");
  });

  it("reports invalid phase names", () => {
    expect(codes(checkPlan(plan(phase("Bad", ["x"]))))).toEqual(["invalid-name"]);
  });

  it("reports unknown dependencies", () => {
    const issues = checkPlan(plan(phase("a", ["a"]), phase("b", ["b"], ["a", "ghost"])));
    expect(issues).toEqual([
      expect.objectContaining({ severity: "error", code: "unknown-dependency", where: "b" }),
    ]);
    expect(issues[0]?.message).toContain("ghost");
    expect(codes(checkPlan(plan(phase("a", ["a"]), phase("b", ["b"], ["a"]))))).toEqual([]);
  });

  it("reports each dependency cycle once, named", () => {
    const p = plan(phase("a", ["a"], ["c"]), phase("b", ["b"], ["a"]), phase("c", ["c"], ["b"]), phase("d", ["d"], ["a"]));
    const cycles = checkPlan(p).filter((i) => i.code === "dependency-cycle");
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toMatchObject({ severity: "error", where: "a" });
    expect(cycles[0]?.message).toContain("a → c → b → a");
  });

  it("reports separate cycles separately, and self-dependencies", () => {
    const p = plan(phase("a", ["a"], ["b"]), phase("b", ["b"], ["a"]), phase("x", ["x"], ["x"]));
    const messages = checkPlan(p)
      .filter((i) => i.code === "dependency-cycle")
      .map((i) => i.message);
    expect(messages).toEqual(["dependency cycle: a → b → a", "dependency cycle: x → x"]);
  });

  it("does not report a cycle for a diamond", () => {
    expect(codes(checkPlan(diamond))).not.toContain("dependency-cycle");
  });

  it("reports an empty scope", () => {
    const issues = checkPlan(plan(phase("a", [])));
    expect(issues).toEqual([expect.objectContaining({ severity: "error", code: "empty-scope", where: "a" })]);
    expect(codes(checkPlan(plan(phase("a", ["a"]))))).toEqual([]);
  });

  it("reports overlapping scopes of unordered phases", () => {
    const issues = checkPlan(plan(phase("m2-plan", ["docs/**", "src/plan/**"]), phase("m2-x", ["src/plan/x.ts"])));
    expect(issues).toEqual([
      expect.objectContaining({ severity: "error", code: "overlapping-scope", where: "m2-plan, m2-x" }),
    ]);
    expect(issues[0]?.message).toContain("src/plan/**");
    expect(issues[0]?.message).toContain("src/plan/x.ts");
  });

  it("does not report scopes that only share a name prefix", () => {
    expect(checkPlan(plan(phase("m2-plan", ["src/plan/**"]), phase("m2-planner", ["src/planner/**"])))).toEqual([]);
  });

  it("allows an overlap between phases ordered by a dependency, directly or transitively", () => {
    const direct = plan(phase("a", ["src/plan/**"]), phase("b", ["src/plan/x.ts"], ["a"]));
    expect(checkPlan(direct)).toEqual([]);
    const chain = plan(phase("a", ["src/plan/**"]), phase("b", ["docs/**"], ["a"]), phase("c", ["src/plan/x.ts"], ["b"]));
    expect(checkPlan(chain)).toEqual([]);
  });

  it("reports overlapping scopes hidden behind a brace set or a different case", () => {
    const braces = checkPlan(plan(phase("a", ["src/{plan,run}/**"]), phase("b", ["src/plan/x.ts"])));
    expect(codes(braces)).toEqual(["overlapping-scope"]);
    const cased = checkPlan(plan(phase("a", ["src/Plan/**"]), phase("b", ["src/plan/x.ts"])));
    expect(codes(cased)).toEqual(["overlapping-scope"]);
  });

  it("reports a dependency that sets checkpoint: false, naming its dependents", () => {
    const a = { ...phase("a", ["src/a/**"]), checkpoint: false };
    const issues = checkPlan(plan(a, phase("b", ["src/b/**"], ["a"]), phase("c", ["src/c/**"], ["a"])));
    expect(issues).toEqual([expect.objectContaining({ severity: "error", code: "dependency-without-checkpoint", where: "a" })]);
    expect(issues[0]?.message).toBe("a sets checkpoint: false, but b, c depend on it and receive its work only as its checkpoint commit");
    // A phase nothing depends on may skip its checkpoint.
    expect(checkPlan(plan({ ...phase("a", ["src/a/**"]), checkpoint: false }))).toEqual([]);
  });

  it("reports a dependency whose role does not checkpoint by default unless it sets checkpoint", () => {
    const reviewer: PlanPhase = { name: "a", role: "reviewer", brief: "lanes/a.md", scope: ["src/a/**"] };
    const issues = checkPlan(plan(reviewer, phase("b", ["src/b/**"], ["a"])));
    expect(issues).toEqual([expect.objectContaining({ severity: "error", code: "dependency-without-checkpoint", where: "a" })]);
    expect(issues[0]?.message).toMatch(/^a uses role reviewer, which does not checkpoint by default, but b depends on it .*; set checkpoint: true$/);
    expect(checkPlan(plan({ ...reviewer, checkpoint: true }, phase("b", ["src/b/**"], ["a"])))).toEqual([]);
    // The plan's defaults count as set, for the role and for checkpoint.
    const roleless: PlanPhase = { name: "a", brief: "lanes/a.md", scope: ["src/a/**"] };
    const viaDefaults: PlanSpec = { name: "p", defaults: { role: "researcher" }, phases: [roleless, phase("b", ["src/b/**"], ["a"])] };
    expect(codes(checkPlan(viaDefaults))).toEqual(["dependency-without-checkpoint"]);
    expect(checkPlan({ ...viaDefaults, defaults: { role: "researcher", checkpoint: true } })).toEqual([]);
  });

  it("still reports an overlap between siblings of a diamond", () => {
    const p = plan(phase("a", ["src/**"]), phase("b", ["src/b/**"], ["a"]), phase("c", ["src/b/c.ts"], ["a"]));
    expect(checkPlan(p)).toEqual([expect.objectContaining({ code: "overlapping-scope", where: "b, c" })]);
  });

  it("warns about a wave with more than eight phases", () => {
    const many = (n: number): PlanPhase[] => Array.from({ length: n }, (_, i) => phase(`p${i}`, [`src/p${i}/**`]));
    expect(checkPlan(plan(...many(LONG_WAVE)))).toEqual([]);
    const issues = checkPlan(plan(...many(LONG_WAVE + 1)));
    expect(issues).toEqual([
      expect.objectContaining({ severity: "warning", code: "long-wave", where: "wave 0" }),
    ]);
    expect(issues[0]?.message).toContain("9 phases");
  });

  it("still checks the waves it can place when the plan has a cycle", () => {
    const wide = Array.from({ length: 9 }, (_, i) => phase(`p${i}`, [`src/p${i}/**`]));
    const issues = checkPlan(plan(...wide, phase("x", ["x"], ["y"]), phase("y", ["y"], ["x"])));
    expect(codes(issues).sort()).toEqual(["dependency-cycle", "long-wave"]);
  });
});
