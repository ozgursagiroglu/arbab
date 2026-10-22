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
  /** Both orders, since overlap is symmetric. */
  const overlap = (a: string, b: string): boolean => {
    const ab = globsOverlap(a, b);
    expect(globsOverlap(b, a), `${b} vs ${a}`).toBe(ab);
    return ab;
  };

  it("overlaps a path with a ** under one of its directories", () => {
    expect(overlap("src/plan/**", "src/plan/x.ts")).toBe(true);
    expect(overlap("src/**", "src/a/b.ts")).toBe(true);
    expect(overlap("src/**/b.ts", "src/a/c/b.ts")).toBe(true);
    expect(overlap("src/**/b.ts", "src/a/c/*.md")).toBe(false);
    // A bare path may be a directory, and src/a/c/d.ts/b.ts is under it.
    expect(overlap("src/**/b.ts", "src/a/c/d.ts")).toBe(true);
  });

  it("overlaps ** with anything", () => {
    for (const other of ["docs/x.md", "src/*.ts", "x", "a/**/b/*.md", "**"]) expect(overlap("**", other), other).toBe(true);
  });

  it("lets ** match no segment at all", () => {
    expect(overlap("src/**/x.ts", "src/x.ts")).toBe(true);
    expect(overlap("src/plan/**", "src/plan")).toBe(true);
    expect(overlap("**/*.md", "README.md")).toBe(true);
  });

  it("overlaps equal paths and globs that can meet", () => {
    expect(overlap("src/plan/x.ts", "src/plan/x.ts")).toBe(true);
    expect(overlap("src/plan/*.ts", "src/plan/**")).toBe(true);
    expect(overlap("src/*/x.ts", "src/**/x.ts")).toBe(true);
    expect(overlap("src/*/x.ts", "src/plan/*")).toBe(true);
  });

  it("compares whole segments, not characters", () => {
    expect(overlap("src/plan/**", "src/planner/**")).toBe(false);
    expect(overlap("src/plan/x.ts", "src/plan/y.ts")).toBe(false);
    expect(overlap("src/a/**", "docs/**")).toBe(false);
    expect(overlap("src/plan", "src/planner.ts")).toBe(false);
  });

  it("lets a bare path cover what is under it", () => {
    expect(overlap("src/plan", "src/plan/graph.ts")).toBe(true);
    expect(overlap("src/plan", "src/plan/*.ts")).toBe(true);
    expect(overlap("src/plan", "src/plan")).toBe(true);
    expect(overlap("src/plan", "src/run")).toBe(false);
    expect(overlap("src/plan", "src/*.ts")).toBe(false);
    // A file cannot have children, but the name alone does not say it is a file.
    expect(overlap("src/plan.ts", "src/plan.ts/x")).toBe(true);
    // A glob stays what it matches.
    expect(overlap("src/*.ts", "src/x.ts/y")).toBe(false);
  });

  it("keeps * and ? within one segment", () => {
    expect(overlap("src/*.ts", "src/plan/x.ts")).toBe(false);
    expect(overlap("src/*.ts", "src/plan/**")).toBe(false);
    expect(overlap("src/*.ts", "src/x.ts")).toBe(true);
    expect(overlap("src/?.ts", "src/x.ts")).toBe(true);
    expect(overlap("src/?.ts", "src/xy.ts")).toBe(false);
  });

  it("matches a literal segment against a glob segment", () => {
    // The pair reported from real use.
    expect(overlap("src/lib/transition-*.ts", "src/lib/erase.ts")).toBe(false);
    expect(overlap("src/lib/transition-*.ts", "src/lib/transition-a.ts")).toBe(true);
    expect(overlap("src/[ab]/x", "src/a/x")).toBe(true);
    expect(overlap("src/[ab]/x", "src/c/x")).toBe(false);
    expect(overlap("src/[!ab]/x", "src/c/x")).toBe(true);
    expect(overlap("src/[!ab]/x", "src/a/x")).toBe(false);
    expect(overlap("src/[a-c].ts", "src/b.ts")).toBe(true);
    expect(overlap("src/[a-c].ts", "src/d.ts")).toBe(false);
  });

  it("overlaps two glob segments unless their literal prefixes or suffixes contradict", () => {
    expect(overlap("a/*.md", "a/*.ts")).toBe(false);
    expect(overlap("a/x-*", "a/y-*")).toBe(false);
    expect(overlap("a/x-*", "a/x-y*")).toBe(true);
    expect(overlap("a/*.test.ts", "a/*.ts")).toBe(true);
    expect(overlap("a/x*.ts", "a/*y.ts")).toBe(true);
    expect(overlap("a/[ab].md", "a/?.ts")).toBe(false);
  });

  it("expands brace sets", () => {
    expect(overlap("src/{plan,run}/**", "src/plan/x.ts")).toBe(true);
    expect(overlap("src/{plan,run}/**", "src/shepherd/x.ts")).toBe(false);
    expect(overlap("src/{a/b,c}/x.ts", "src/a/b/x.ts")).toBe(true);
    expect(overlap("src/*.{md,json}", "src/*.ts")).toBe(false);
    expect(overlap("src/{a,{b,c}}.ts", "src/c.ts")).toBe(true);
  });

  it("lets a bare brace alternative cover what is under it", () => {
    expect(overlap("src/{plan,run}", "src/plan/graph.ts")).toBe(true);
    expect(overlap("src/{plan,run}", "src/run")).toBe(true);
    expect(overlap("src/{plan,run}", "src/run/deps.ts")).toBe(true);
    expect(overlap("src/{plan,run}", "src/planner.ts")).toBe(false);
    expect(overlap("src/{plan,run}", "src/shepherd/x.ts")).toBe(false);
    // An alternative with a pattern character stays what it matches.
    expect(overlap("src/{a,b}/*.ts", "src/a/x/y.ts")).toBe(false);
    expect(overlap("src/{a,b/*.ts}", "src/a/x.ts")).toBe(true);
    expect(overlap("src/{a,b/*.ts}", "src/b/x.ts/y")).toBe(false);
  });

  it("overlaps an extglob with any literal its literal ends allow", () => {
    expect(overlap("src/@(plan|run)/x.ts", "src/run/x.ts")).toBe(true);
    expect(overlap("src/@(plan|run)/x.ts", "src/run/y.ts")).toBe(false);
    expect(overlap("src/!(plan)/**", "src/shepherd/**")).toBe(true);
    expect(overlap("src/x-@(a|b).ts", "src/y-a.ts")).toBe(false);
  });

  it("treats a trailing / as a directory", () => {
    expect(overlap("src/plan/", "src/plan/x.ts")).toBe(true);
    expect(overlap("./src//plan/", "src/plan/x.ts")).toBe(true);
  });

  it("falls back to fixed paths for globs it cannot read", () => {
    // A range, an escape, a "/" inside an extglob: conservative.
    expect(overlap("src/{1..3}/x", "src/plan/y")).toBe(true);
    expect(overlap("src/\\*/x", "src/plan/y")).toBe(true);
    expect(overlap("src/@(a/b|c)/x", "src/plan/y")).toBe(true);
    expect(overlap("src/{a,b/x", "docs/y")).toBe(false);
  });

  it("compares segments case-insensitively", () => {
    expect(overlap("src/Plan/**", "src/plan/x.ts")).toBe(true);
    expect(overlap("SRC/plan/X.ts", "src/plan/x.ts")).toBe(true);
    expect(overlap("src/Plan/**", "src/planner/**")).toBe(false);
    expect(overlap("src/*.TS", "src/x.ts")).toBe(true);
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

  it("does not report scopes that share a directory but no path", () => {
    const p = plan(phase("a", ["src/lib/transition-*.ts"]), phase("b", ["src/lib/erase.ts", "docs/*.md"]), phase("c", ["src/*.ts", "docs/*.ts"]));
    expect(codes(checkPlan(p))).toEqual([]);
  });

  it("reports overlapping scopes hidden behind a brace set or a different case", () => {
    const braces = checkPlan(plan(phase("a", ["src/{plan,run}/**"]), phase("b", ["src/plan/x.ts"])));
    expect(codes(braces)).toEqual(["overlapping-scope"]);
    const cased = checkPlan(plan(phase("a", ["src/Plan/**"]), phase("b", ["src/plan/x.ts"])));
    expect(codes(cased)).toEqual(["overlapping-scope"]);
  });

  it("reports a bare directory scope against a file under it", () => {
    const issues = checkPlan(plan(phase("a", ["src/plan"]), phase("b", ["src/plan/graph.ts"])));
    expect(issues).toEqual([expect.objectContaining({ code: "overlapping-scope", where: "a, b" })]);
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
