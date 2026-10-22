import { ROLE_DEFAULTS } from "../config/roles";
import type { LintIssue, PlanSpec } from "../types";
import { ArbabError } from "../util/errors";
import { isValidName } from "../util/names";

/** More phases than this in one wave is allowed but hard to supervise and to land. */
export const LONG_WAVE = 8;

/** A segment that matches more than itself: a wildcard, a class, a brace set or an extglob. */
const PATTERN_SEGMENT = /[*?[{}]|[@!+]\(/;

/**
 * The segments before the first pattern segment (`*`, `?`, `[`, `{`, `}`, or an extglob opener `@(`, `!(`, `+(`,
 * `*(`, `?(`); empty and "." segments are dropped.
 */
export function fixedPath(glob: string): string[] {
  const out: string[] = [];
  for (const segment of glob.split("/")) {
    if (PATTERN_SEGMENT.test(segment)) break;
    if (segment !== "" && segment !== ".") out.push(segment);
  }
  return out;
}

/** The fallback for globs the segment comparison cannot read: one fixed path is a segment-wise prefix of the other. */
function fixedPathsOverlap(a: string, b: string): boolean {
  const fa = fixedPath(a);
  const fb = fixedPath(b);
  const n = Math.min(fa.length, fb.length);
  for (let i = 0; i < n; i++) if (fa[i]?.toLowerCase() !== fb[i]?.toLowerCase()) return false;
  return true;
}

/** More alternatives than this and the brace sets are not expanded. */
const MAX_EXPANSIONS = 256;

/**
 * `{a,b}` sets expanded, nested ones included. null for what is not a plain set (a range `{1..3}`, a set without a
 * comma, an unbalanced brace) or for more than MAX_EXPANSIONS alternatives.
 */
function expandBraces(glob: string): string[] | null {
  const open = glob.indexOf("{");
  if (open === -1) return glob.includes("}") ? null : [glob];
  let depth = 0;
  let close = -1;
  const commas: number[] = [];
  for (let i = open; i < glob.length && close === -1; i++) {
    const c = glob[i];
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) close = i;
    else if (c === "," && depth === 1) commas.push(i);
  }
  if (close === -1 || commas.length === 0 || glob.slice(0, open).includes("}")) return null;
  const bounds = [open, ...commas, close];
  const out: string[] = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const alternative = glob.slice(0, open) + glob.slice((bounds[k] ?? 0) + 1, bounds[k + 1]) + glob.slice(close + 1);
    const expanded = expandBraces(alternative);
    if (expanded === null) return null;
    out.push(...expanded);
    if (out.length > MAX_EXPANSIONS) return null;
  }
  return out;
}

/**
 * A brace-free glob's segments, split on "/" outside parentheses; empty and "." segments are dropped, and a trailing
 * "/" names a directory, so it gains a `**`. null when a "/" sits inside an extglob group.
 */
function splitSegments(glob: string): string[] | null {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  const push = (): void => {
    if (current !== "" && current !== ".") out.push(current);
    current = "";
  };
  for (const c of glob) {
    if (c === "/") {
      if (depth > 0) return null;
      push();
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    current += c;
  }
  push();
  if (glob.endsWith("/")) out.push("**");
  return out;
}

/** Each alternative of a glob as segments; null when the glob is beyond this reader (escapes, odd braces). */
function globSegments(glob: string): string[][] | null {
  if (glob.includes("\\")) return null;
  const alternatives = expandBraces(glob);
  if (alternatives === null) return null;
  const out: string[][] = [];
  for (const alternative of alternatives) {
    const segments = splitSegments(alternative);
    if (segments === null) return null;
    out.push(segments);
  }
  return out;
}

const EXTGLOB = /[@!+*?]\(/;

/** A case-insensitive matcher for one segment pattern of `*`, `?` and `[...]`; null for an extglob or a POSIX class. */
function segmentRegExp(pattern: string): RegExp | null {
  if (EXTGLOB.test(pattern)) return null;
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] ?? "";
    if (c === "*") source += "[^/]*";
    else if (c === "?") source += "[^/]";
    else if (c === "[" && pattern.indexOf("]", i + 2) !== -1) {
      // As in globs, a "]" right after the opener (or its negation) is a member.
      const negated = pattern[i + 1] === "!" || pattern[i + 1] === "^";
      const start = i + 1 + (negated ? 1 : 0);
      const end = pattern.indexOf("]", start + 1);
      if (end === -1) return null;
      const body = pattern.slice(start, end);
      if (body.includes("[:")) return null;
      source += `[${negated ? "^/" : ""}${body.replace(/[\\\]^[]/g, "\\$&")}]`;
      i = end;
    } else source += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  try {
    return new RegExp(`^${source}$`, "i");
  } catch {
    return null;
  }
}

/** The literal text of a segment pattern before its first and after its last wildcard, class or extglob. */
function literalEnds(pattern: string): { prefix: string; suffix: string } {
  const first = pattern.search(/[*?[]|[@!+]\(/);
  const last = Math.max(...["*", "?", "]", ")"].map((c) => pattern.lastIndexOf(c)));
  return { prefix: pattern.slice(0, first), suffix: pattern.slice(last + 1) };
}

/** Whether some single path segment matches both segment patterns. */
function segmentsMeet(a: string, b: string): boolean {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  const globA = PATTERN_SEGMENT.test(a);
  const globB = PATTERN_SEGMENT.test(b);
  if (!globA && !globB) return la === lb;
  if (globA && globB) {
    const ea = literalEnds(la);
    const eb = literalEnds(lb);
    const prefixes = ea.prefix.startsWith(eb.prefix) || eb.prefix.startsWith(ea.prefix);
    const suffixes = ea.suffix.endsWith(eb.suffix) || eb.suffix.endsWith(ea.suffix);
    return prefixes && suffixes;
  }
  const [glob, literal] = globA ? [la, lb] : [lb, la];
  const re = segmentRegExp(glob);
  if (re !== null) return re.test(literal);
  // An extglob: only its literal ends can rule the literal out.
  const { prefix, suffix } = literalEnds(glob);
  return literal.startsWith(prefix) && literal.endsWith(suffix) && literal.length >= prefix.length + suffix.length;
}

/** Whether some path matches both segment lists; `**` matches any number of segments, none included. */
function pathsMeet(a: string[], b: string[]): boolean {
  const memo = new Map<number, boolean>();
  const meet = (i: number, j: number): boolean => {
    const key = i * (b.length + 1) + j;
    const known = memo.get(key);
    if (known !== undefined) return known;
    let result: boolean;
    if (a[i] === "**") result = meet(i + 1, j) || (j < b.length && meet(i, j + 1));
    else if (b[j] === "**") result = meet(i, j + 1) || (i < a.length && meet(i + 1, j));
    else if (i === a.length || j === b.length) result = i === a.length && j === b.length;
    else result = segmentsMeet(a[i] ?? "", b[j] ?? "") && meet(i + 1, j + 1);
    memo.set(key, result);
    return result;
  };
  return meet(0, 0);
}

/**
 * Whether some path matches both globs, compared segment by segment: `**` spans any number of segments, `*`, `?` and
 * classes stay within one, literals compare case-insensitively (on a case-insensitive file system `src/Plan` and
 * `src/plan` are one directory). Two pattern segments meet unless their literal prefixes or suffixes contradict, and
 * an extglob meets any literal its literal ends allow, so the answer errs toward overlap. Brace sets are expanded;
 * a glob this cannot read (escapes, ranges, a "/" inside an extglob) falls back to comparing fixed paths.
 */
export function globsOverlap(a: string, b: string): boolean {
  const sa = globSegments(a);
  const sb = globSegments(b);
  if (sa === null || sb === null) return fixedPathsOverlap(a, b);
  return sa.some((x) => sb.some((y) => pathsMeet(x, y)));
}

/** Name → dependencies, from each name's first occurrence (duplicates are checkPlan's error). */
export function dependencyMap(plan: PlanSpec): Map<string, string[]> {
  const deps = new Map<string, string[]>();
  for (const phase of plan.phases) if (!deps.has(phase.name)) deps.set(phase.name, phase.dependsOn ?? []);
  return deps;
}

/** Topological levels over known dependencies; `stuck` holds the phases a cycle keeps out of every level. */
function levels(deps: Map<string, string[]>): { waves: string[][]; stuck: string[] } {
  const placed = new Set<string>();
  const waves: string[][] = [];
  let pending = [...deps.keys()];
  while (pending.length > 0) {
    const wave = pending.filter((n) => (deps.get(n) ?? []).every((d) => placed.has(d) || !deps.has(d))).sort();
    if (wave.length === 0) break;
    for (const n of wave) placed.add(n);
    waves.push(wave);
    pending = pending.filter((n) => !placed.has(n));
  }
  return { waves, stuck: pending.sort() };
}

/** Each distinct cycle once, rotated to start at its smallest name; edges point from a phase to its dependency. */
function findCycles(deps: Map<string, string[]>): string[][] {
  const visiting = new Set<string>();
  const done = new Set<string>();
  const stack: string[] = [];
  const seen = new Set<string>();
  const cycles: string[][] = [];
  const visit = (n: string): void => {
    visiting.add(n);
    stack.push(n);
    for (const d of deps.get(n) ?? []) {
      if (!deps.has(d) || done.has(d)) continue;
      if (visiting.has(d)) {
        const cycle = stack.slice(stack.indexOf(d));
        const start = cycle.indexOf([...cycle].sort()[0] ?? d);
        const rotated = [...cycle.slice(start), ...cycle.slice(0, start)];
        const key = rotated.join(" ");
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(rotated);
        }
      } else {
        visit(d);
      }
    }
    stack.pop();
    visiting.delete(n);
    done.add(n);
  };
  for (const n of [...deps.keys()].sort()) if (!done.has(n)) visit(n);
  return cycles;
}

function describeCycle(cycle: string[]): string {
  return [...cycle, cycle[0]].join(" → ");
}

/** Every phase each phase depends on, directly or transitively. */
function ancestors(deps: Map<string, string[]>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const start of deps.keys()) {
    const reached = new Set<string>();
    const todo = [...(deps.get(start) ?? [])];
    for (let d = todo.pop(); d !== undefined; d = todo.pop()) {
      if (reached.has(d)) continue;
      reached.add(d);
      todo.push(...(deps.get(d) ?? []));
    }
    out.set(start, reached);
  }
  return out;
}

/** The plan's waves: wave 0 has no dependencies; each wave is sorted by name. */
export function planWaves(plan: PlanSpec): string[][] {
  const deps = dependencyMap(plan);
  for (const [name, ds] of deps) {
    for (const d of ds) if (!deps.has(d)) throw new ArbabError("config", `phase ${name} depends on unknown phase ${d}`);
  }
  const { waves, stuck } = levels(deps);
  if (stuck.length > 0) {
    const cycle = findCycles(deps)[0] ?? stuck;
    throw new ArbabError("config", `plan ${plan.name} has a dependency cycle: ${describeCycle(cycle)}`);
  }
  return waves;
}

/**
 * The lanes whose branches an integration of the plan merges, in wave order, each once. A phase that borrows another
 * lane's worktree has no branch of its own: its work is on the owner's branch. An owner that is a phase is merged at
 * its own place; one that is not (an earlier lane) is merged at the first borrowing phase's place.
 */
export function integrationLanes(plan: PlanSpec): string[] {
  const owners = new Map<string, string>();
  for (const phase of plan.phases) {
    if (owners.has(phase.name)) continue;
    owners.set(phase.name, phase.worktree ?? plan.defaults?.worktree ?? phase.name);
  }
  const lanes = new Set<string>();
  for (const name of planWaves(plan).flat()) {
    const owner = owners.get(name) ?? name;
    if (owner === name || !owners.has(owner)) lanes.add(owner);
  }
  return [...lanes];
}

/** Graph and scope rules of DESIGN.md §16; field rules are loadPlan's. */
export function checkPlan(plan: PlanSpec): LintIssue[] {
  const issues: LintIssue[] = [];
  const error = (code: string, message: string, where: string): void => {
    issues.push({ severity: "error", code, message, where });
  };

  const counts = new Map<string, number>();
  for (const phase of plan.phases) counts.set(phase.name, (counts.get(phase.name) ?? 0) + 1);
  for (const [name, count] of counts) {
    if (count > 1) error("duplicate-phase", `phase ${name} appears ${count} times`, name);
  }

  for (const phase of plan.phases) {
    if (!isValidName(phase.name)) {
      error("invalid-name", `phase name ${JSON.stringify(phase.name)} is not a valid lane name`, phase.name);
    }
    for (const d of phase.dependsOn ?? []) {
      if (!counts.has(d)) error("unknown-dependency", `${phase.name} depends on ${d}, which is not a phase`, phase.name);
    }
    if (phase.scope.length === 0) error("empty-scope", `${phase.name} has no write scope`, phase.name);
  }

  const deps = dependencyMap(plan);
  for (const cycle of findCycles(deps)) {
    error("dependency-cycle", `dependency cycle: ${describeCycle(cycle)}`, cycle[0] ?? "");
  }

  // A dependency's work reaches its dependents only as its checkpoint commit (merged into their worktrees), and a
  // lane that never checkpoints records the same nothing as one that changed nothing.
  const dependents = new Map<string, string[]>();
  for (const [name, ds] of deps) for (const d of new Set(ds)) dependents.set(d, [...(dependents.get(d) ?? []), name]);
  const checked = new Set<string>();
  for (const phase of plan.phases) {
    const users = dependents.get(phase.name);
    if (users === undefined || checked.has(phase.name)) continue;
    checked.add(phase.name);
    const role = phase.role ?? plan.defaults?.role ?? "implementer";
    const checkpoint = phase.checkpoint ?? plan.defaults?.checkpoint;
    const needs = `${users.join(", ")} ${users.length === 1 ? "depends" : "depend"} on it and receive its work only as its checkpoint commit`;
    if (checkpoint === false) {
      error("dependency-without-checkpoint", `${phase.name} sets checkpoint: false, but ${needs}`, phase.name);
    } else if (checkpoint === undefined && Object.hasOwn(ROLE_DEFAULTS, role) && !ROLE_DEFAULTS[role].checkpoint) {
      error(
        "dependency-without-checkpoint",
        `${phase.name} uses role ${role}, which does not checkpoint by default, but ${needs}; set checkpoint: true`,
        phase.name,
      );
    }
  }

  const reach = ancestors(deps);
  const ordered = (a: string, b: string): boolean => Boolean(reach.get(a)?.has(b) || reach.get(b)?.has(a));
  for (let i = 0; i < plan.phases.length; i++) {
    for (let j = i + 1; j < plan.phases.length; j++) {
      const a = plan.phases[i];
      const b = plan.phases[j];
      if (a === undefined || b === undefined || a.name === b.name || ordered(a.name, b.name)) continue;
      const pair = firstOverlap(a.scope, b.scope);
      if (pair === null) continue;
      error(
        "overlapping-scope",
        `${a.name} (${pair[0]}) and ${b.name} (${pair[1]}) can run at the same time with overlapping scopes; ` +
          "make one depend on the other or split the scopes",
        `${a.name}, ${b.name}`,
      );
    }
  }

  levels(deps).waves.forEach((wave, i) => {
    if (wave.length > LONG_WAVE) {
      issues.push({
        severity: "warning",
        code: "long-wave",
        message: `wave ${i} has ${wave.length} phases (more than ${LONG_WAVE}); consider splitting it`,
        where: `wave ${i}`,
      });
    }
  });
  return issues;
}

function firstOverlap(a: string[], b: string[]): [string, string] | null {
  for (const ga of a) for (const gb of b) if (globsOverlap(ga, gb)) return [ga, gb];
  return null;
}
