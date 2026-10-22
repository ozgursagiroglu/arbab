// arbab plan check <plan.json> [--json]
//
// Text: the plan's issues, each phase's lint issues and `<phase>: ok` or `<phase>: N error(s), M warning(s)`, one
// `wave <i>: <phases>` line per wave, then `plan <name>: ok` or `plan <name>: N error(s), M warning(s)`.
// --json: {"plan": string, "ok": boolean, "issues": LintIssue[], "phases": [{"phase": string, "issues": LintIssue[]}],
//          "waves": string[][] | null}
// Phases are linted only when the dependency graph resolves (waves is null otherwise). Exit 1 on any error.
//
// arbab plan next <plan.json> [--retry <phase>] [--json]
//
// Checks the plan (refuses on errors, launching nothing), then launches every phase that never ran and whose
// dependencies all succeeded (finished with success, and the latest attempt's exit.json has a checkpoint commit or
// recorded no changes), through the same path as `arbab launch`. Each launched phase's compiled lane spec is written
// to .arbab/plans/<plan>/<phase>.json first. An orphaned dependency, or one whose checkpoint failed, fails upstream.
// --retry first relaunches that phase (a fresh session in its worktree, on its checkpoint commits), listed first among
// the launched; it refuses (exit 1, nothing launched) a phase not in the plan, never run, active or that succeeded.
// Text: `launched <phase>  run <run dir>  shepherd <pid>`, `blocked <phase>  waiting for <deps>`,
// `failed-upstream <phase>  <dep> ended <end state>[; <reason>]`, `error <phase>  <message>`; `nothing launched` when
// nothing was.
// --json: {"plan": string, "launched": [{"phase", "laneFile", "runDir", "shepherdPid"}],
//          "blocked": [{"phase", "waitingFor": string[]}],
//          "failed": [{"phase", "dependency", "endState" (an end state, "orphaned" or null), "reason": string | null}],
//          "errors": [{"phase", "message"}], "warnings": [{"phase", "severity", "code", "message", "where"?}]}
// Exit 0, or the exit status of the worst launch error.
//
// arbab plan status <plan.json> [--json]
//
// Text: one row per phase: phase, wave, state, end state, dependencies. --json: {"plan": string, "phases":
// PlanStatusRow[]} (state and endState null for a phase never launched; state is the effective state).
import { join } from "node:path";
import { checkPlan, compilePhase, loadPlan, nextPhases, planStatus, planWaves, retryRefusal } from "../plan";
import type { NextPhases, PhaseState, PhaseStates, PlanStatusRow } from "../plan";
import { attemptFiles, effectiveState, listAttempts, readState, runPaths } from "../registry";
import { arbabIgnoreEntries, ensureArbabMarkers, ensureIgnored } from "../run";
import type { LaneSpec, LintIssue, PlanSpec } from "../types";
import { ArbabError, exitCodeFor } from "../util/errors";
import { readJson, writeJsonAtomic } from "../util/fs";
import { assertValidName } from "../util/names";
import type { CommandContext } from "./context";
import { launchLane } from "./launch";
import { formatIssue, hasErrors, issueSummary, lintLaneSpec, resolveGitCommonDir } from "./lint";
import { onePositional, openProject, parse, printJson, type Project } from "./project";

export interface PhaseCheck {
  phase: string;
  lane: LaneSpec;
  issues: LintIssue[];
}

export interface PlanCheck {
  plan: PlanSpec;
  /** checkPlan's graph and scope issues. */
  issues: LintIssue[];
  /** Empty when the graph does not resolve. */
  phases: PhaseCheck[];
  waves: string[][] | null;
}

/** Each phase name once, in plan order (a duplicate is checkPlan's error). */
const phaseNames = (plan: PlanSpec): string[] => [...new Set(plan.phases.map((p) => p.name))];

/** The generated lane files of a plan's phases; ignored by git, like the preflight probes. */
export const plansDir = (project: Project, plan: string): string => join(project.root, ".arbab", "plans", assertValidName(plan, "plan"));

/** loadPlan, checkPlan and planWaves, then every phase compiled and linted as `arbab lint` lints a lane file. */
export function checkPlanFile(ctx: Pick<CommandContext, "git">, project: Project, planPath: string): PlanCheck {
  const plan = loadPlan(project.root, planPath, project.config.credentialPaths);
  const issues = checkPlan(plan);
  let waves: string[][] | null = null;
  try {
    waves = planWaves(plan);
  } catch (err) {
    // checkPlan has already reported the cycle or the unknown dependency.
    if (!(err instanceof ArbabError)) throw err;
  }
  const phases: PhaseCheck[] = [];
  if (waves !== null) {
    const gitCommonDir = resolveGitCommonDir(ctx.git, project.root);
    for (const phase of phaseNames(plan)) {
      const lane = compilePhase(plan, phase);
      phases.push({ phase, lane, issues: lintLaneSpec(project, lane, gitCommonDir).issues });
    }
  }
  return { plan, issues, phases, waves };
}

export const planHasErrors = (check: PlanCheck): boolean => hasErrors(check.issues) || check.phases.some((p) => hasErrors(p.issues));

function planSummary(check: PlanCheck): string {
  return issueSummary(`plan ${check.plan.name}`, [...check.issues, ...check.phases.flatMap((p) => p.issues)]);
}

/**
 * The checkpoint fields of a lane's latest attempt's exit.json; null when there is no attempt, no exit.json, or one
 * that does not parse or holds the wrong types (then a success cannot be shown to have reached its branch).
 */
export function latestExit(runsRoot: string, lane: string): PhaseState["exit"] {
  let value: unknown;
  try {
    const n = listAttempts(runsRoot, lane).at(-1);
    if (n === undefined) return null;
    value = readJson<unknown>(attemptFiles(runPaths(runsRoot, lane).attemptDir(n)).exit);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { checkpoint, checkpointError } = value as Record<string, unknown>;
  const field = (v: unknown): v is string | null => v === null || typeof v === "string";
  if (!field(checkpoint) || !field(checkpointError)) return null;
  return { checkpoint, checkpointError };
}

/** The registry state of each phase's lane: undefined when it never ran, the effective state otherwise. */
export function phaseStates(project: Project, plan: PlanSpec, alive: (pid: number) => boolean): PhaseStates {
  const states: PhaseStates = {};
  for (const phase of phaseNames(plan)) {
    const record = readState(project.runsRoot, phase);
    states[phase] =
      record === null
        ? undefined
        : { state: effectiveState(record, alive), endState: record.endState ?? null, exit: latestExit(project.runsRoot, phase) };
  }
  return states;
}

export interface PlanNext {
  plan: string;
  launched: Array<{ phase: string; laneFile: string; runDir: string; shepherdPid: number }>;
  blocked: NextPhases["blocked"];
  failed: NextPhases["failed"];
  errors: Array<{ phase: string; message: string }>;
  /** Lint warnings of the launched phases. */
  warnings: Array<{ phase: string; issue: LintIssue }>;
  /** The exit status: 0, or the worst launch error's. */
  code: number;
}

/**
 * `plan next`: refuses a plan with errors (they go to stderr), then launches each launchable phase. A failed launch
 * does not stop the others; it is listed under errors. `retry` first relaunches that phase, which must have ended in
 * anything but success or been orphaned, as `arbab launch` relaunches its lane file: a fresh session in its worktree,
 * on top of its checkpoint commits. Its dependents then wait for it instead of failing upstream.
 */
export async function planNext(ctx: CommandContext, project: Project, planPath: string, opts: { retry?: string } = {}): Promise<PlanNext> {
  const check = checkPlanFile(ctx, project, planPath);
  const plan = check.plan;
  if (planHasErrors(check)) {
    for (const issue of check.issues) ctx.stderr(formatIssue(issue) + "\n");
    for (const p of check.phases) for (const issue of p.issues) ctx.stderr(`${p.phase}: ${formatIssue(issue)}\n`);
    throw new ArbabError("lint", `${planSummary(check)}; nothing launched`);
  }
  const states = phaseStates(project, plan, ctx.alive);
  if (opts.retry !== undefined) {
    const refusal = retryRefusal(plan, states, opts.retry);
    if (refusal !== null) throw new ArbabError("usage", `cannot retry: ${refusal}; nothing launched`);
  }
  const out: PlanNext = { plan: plan.name, launched: [], blocked: [], failed: [], errors: [], warnings: [], code: 0 };

  let prepared = false;
  const launch = async (phase: string, onlyNew: boolean): Promise<boolean> => {
    if (!prepared) {
      // The generated lane files live under .arbab/plans/, which arbab's own entries cover.
      ensureIgnored(project.root, arbabIgnoreEntries(project.root, project.config), ctx.git);
      ensureArbabMarkers(project.root);
      prepared = true;
    }
    const lane = check.phases.find((p) => p.phase === phase)?.lane ?? compilePhase(plan, phase);
    const laneFile = join(plansDir(project, plan.name), `${phase}.json`);
    try {
      writeJsonAtomic(laneFile, lane);
      const launched = await launchLane(ctx, project, laneFile, { onlyNew });
      out.launched.push({ phase, laneFile, runDir: launched.runDir, shepherdPid: launched.shepherdPid });
      for (const issue of launched.warnings) out.warnings.push({ phase, issue });
      return true;
    } catch (err) {
      out.errors.push({ phase, message: err instanceof Error ? err.message : String(err) });
      out.code = Math.max(out.code, exitCodeFor(err));
      return false;
    }
  };

  // The relaunched phase counts as queued, so its dependents are blocked on it rather than failed upstream.
  if (opts.retry !== undefined && (await launch(opts.retry, false))) states[opts.retry] = { state: "queued", endState: null, exit: null };
  const next = nextPhases(plan, states);
  out.blocked = next.blocked;
  out.failed = next.failed;
  for (const phase of next.launch) await launch(phase, true);
  return out;
}

/** Columns padded to their widest cell; the last column is not padded. */
function table(rows: string[][]): string {
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length))) ?? [];
  return rows.map((r) => r.map((cell, i) => (i === r.length - 1 ? cell : cell.padEnd(widths[i] ?? 0))).join("  ").trimEnd()).join("\n");
}

export function formatPlanStatus(rows: PlanStatusRow[]): string {
  return table([
    ["PHASE", "WAVE", "STATE", "END", "DEPENDS ON"],
    ...rows.map((r) => [r.phase, String(r.wave), r.state ?? "-", r.endState ?? "-", r.dependsOn.length > 0 ? r.dependsOn.join(", ") : "-"]),
  ]);
}

async function runCheck(argv: string[], ctx: CommandContext): Promise<number> {
  const { values, positionals } = parse("plan check", { args: argv, options: { json: { type: "boolean" } }, allowPositionals: true });
  const planPath = onePositional("plan check", positionals, "plan.json");
  const check = checkPlanFile(ctx, openProject(ctx), planPath);
  const ok = !planHasErrors(check);
  if (values.json === true) {
    printJson(ctx, {
      plan: check.plan.name,
      ok,
      issues: check.issues,
      phases: check.phases.map((p) => ({ phase: p.phase, issues: p.issues })),
      waves: check.waves,
    });
  } else {
    for (const issue of check.issues) ctx.stdout(formatIssue(issue) + "\n");
    for (const p of check.phases) {
      for (const issue of p.issues) ctx.stdout(`  ${formatIssue(issue)}\n`);
      ctx.stdout(issueSummary(p.phase, p.issues) + "\n");
    }
    if (check.waves === null) ctx.stdout("phases not linted: the dependency graph does not resolve\n");
    else check.waves.forEach((wave, i) => ctx.stdout(`wave ${i}: ${wave.join(", ")}\n`));
    ctx.stdout(planSummary(check) + "\n");
  }
  return ok ? 0 : 1;
}

async function runNext(argv: string[], ctx: CommandContext): Promise<number> {
  const { values, positionals } = parse("plan next", {
    args: argv,
    options: { json: { type: "boolean" }, retry: { type: "string" } },
    allowPositionals: true,
  });
  const planPath = onePositional("plan next", positionals, "plan.json");
  const next = await planNext(ctx, openProject(ctx), planPath, values.retry === undefined ? {} : { retry: values.retry });
  if (values.json === true) {
    printJson(ctx, {
      plan: next.plan,
      launched: next.launched,
      blocked: next.blocked,
      failed: next.failed,
      errors: next.errors,
      warnings: next.warnings.map((w) => ({ phase: w.phase, ...w.issue })),
    });
    return next.code;
  }
  for (const w of next.warnings) ctx.stderr(`${w.phase}: ${formatIssue(w.issue)}\n`);
  for (const l of next.launched) ctx.stdout(`launched ${l.phase}  run ${l.runDir}  shepherd ${l.shepherdPid}\n`);
  if (next.launched.length === 0) ctx.stdout("nothing launched\n");
  for (const b of next.blocked) ctx.stdout(`blocked ${b.phase}  waiting for ${b.waitingFor.join(", ")}\n`);
  for (const f of next.failed) {
    const reason = f.reason === null ? "" : `; ${f.reason}`;
    ctx.stdout(`failed-upstream ${f.phase}  ${f.dependency} ended ${f.endState ?? "without an end state"}${reason}\n`);
  }
  for (const e of next.errors) ctx.stderr(`error ${e.phase}  ${e.message}\n`);
  return next.code;
}

async function runPlanStatus(argv: string[], ctx: CommandContext): Promise<number> {
  const { values, positionals } = parse("plan status", { args: argv, options: { json: { type: "boolean" } }, allowPositionals: true });
  const planPath = onePositional("plan status", positionals, "plan.json");
  const project = openProject(ctx);
  const plan = loadPlan(project.root, planPath, project.config.credentialPaths);
  const rows = planStatus(plan, phaseStates(project, plan, ctx.alive));
  if (values.json === true) printJson(ctx, { plan: plan.name, phases: rows });
  else ctx.stdout(formatPlanStatus(rows) + "\n");
  return 0;
}

const SUBCOMMANDS: Readonly<Record<string, (argv: string[], ctx: CommandContext) => Promise<number>>> = {
  check: runCheck,
  next: runNext,
  status: runPlanStatus,
};

export async function runPlan(argv: string[], ctx: CommandContext): Promise<number> {
  const [sub, ...rest] = argv;
  const command = sub !== undefined && Object.hasOwn(SUBCOMMANDS, sub) ? SUBCOMMANDS[sub] : undefined;
  if (command === undefined) throw new ArbabError("usage", "usage: arbab plan check|next|status <plan.json> [--json] (next also takes --retry <phase>)");
  return command(rest, ctx);
}
