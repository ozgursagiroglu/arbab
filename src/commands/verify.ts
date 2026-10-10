// arbab verify <name> [--timeout-min N] [--json]
//
// Runs config.gates, then config.verify.smoke when set, inside the fence: a probe lane <name>-verify in its own
// worktree, installed on a trusted commit and fast-forwarded to the recorded integration head (generatedBase,
// DESIGN.md §17). The gates run worker-written code (tests), so they never run on the host. Exit codes come from the
// stream's tool results for those exact command lines, never from the model's report.
// Refuses while a dependency manifest changed and no human confirmed the install.
// Writes .arbab/integrations/<name>/verify.json (VerifyRecord, with a `reason` when it failed for something other than
// an exit code: the lane ran on another commit than the head, or its worktree has changes or fails verification after
// the run).
// Text: one line per command, `exit <n>  <kind>  <command>` or `missing  <kind>  <command>`, then
// `verify <name>: passed|failed at <head> (lane <lane> <end state>)[: <reason>]`.
// --json: {"timedOut": boolean, "endState": string | null, "verify": VerifyRecord | null}
// Exit 0 when every command exited 0 and nothing gave a reason, 1 otherwise (and on usage errors, including no
// configured gates), 3 when the lane did not finish in time.
import { join } from "node:path";
import { reviewLaneFiles } from "../review";
import { verifyWorktreeGit, worktreeStatus } from "../run";
import type { GateResult, VerifyRecord } from "../types";
import { ArbabError } from "../util/errors";
import { writeJsonAtomic } from "../util/fs";
import { assertValidName } from "../util/names";
import { isoAt } from "../util/proc";
import { gateResults, verifyBrief, verifyLaneSpec, verifyRecord } from "../verify";
import type { CommandContext } from "./context";
import {
  assertRecordedHead,
  attemptEvents,
  branchHead,
  generatedBase,
  generationOwner,
  lintGeneratedLanes,
  openIntegration,
  runGeneratedLanes,
  writeGeneratedLane,
} from "./integration";
import { resolveGitCommonDir } from "./lint";
import { onePositional, openProject, parse, printJson, type Project } from "./project";
import { WAIT_TIMEOUT_EXIT, parseTimeoutMin } from "./wait";

const DEFAULT_TIMEOUT_MIN = 90;

export function formatGateResult(result: GateResult): string {
  const code = result.exitCode === null ? "missing" : `exit ${result.exitCode}`;
  return `${code.padEnd(8)}  ${result.kind.padEnd(5)}  ${result.command}`;
}

export async function runVerify(argv: string[], ctx: CommandContext): Promise<number> {
  const { values, positionals } = parse("verify", {
    args: argv,
    options: { "timeout-min": { type: "string" }, json: { type: "boolean" } },
    allowPositionals: true,
  });
  const name = assertValidName(onePositional("verify", positionals, "name"), "integration");
  const timeoutMs = parseTimeoutMin(values["timeout-min"] ?? String(DEFAULT_TIMEOUT_MIN));
  const project = openProject(ctx);
  const { gates } = project.config;
  const smoke = project.config.verify.smoke;
  if (gates.length === 0) throw new ArbabError("usage", "no gates are configured (arbab.config.json gates); verify has nothing to run");

  const integration = openIntegration(project, name);
  const owner = generationOwner(integration);
  const start = generatedBase(integration.record);
  assertRecordedHead(ctx.git, project, integration);
  const head = integration.record.headSha;

  const lane = `${name}-verify`;
  const spec = verifyLaneSpec({ name, brief: reviewLaneFiles(integration.paths, lane).brief, gates, smoke, ...start });
  const file = writeGeneratedLane(project, integration.paths, { spec, brief: verifyBrief(gates, smoke) });
  lintGeneratedLanes(ctx, project, [file]);

  const run = await runGeneratedLanes(ctx, project, [{ lane: spec.name, file }], timeoutMs, owner);
  const outcome = run.outcomes[0];
  if (run.timedOut || outcome === undefined) {
    if (values.json === true) printJson(ctx, { timedOut: true, endState: null, verify: null });
    else ctx.stderr(`arbab verify: ${spec.name} did not finish in time; it keeps running\n`);
    return WAIT_TIMEOUT_EXIT;
  }
  // Without an attempt nothing ran: a setup that failed before the merge leaves the branch at its base, and every
  // command is missing anyway.
  const reasons: string[] = [];
  if (outcome.attempts.length > 0) {
    // The lane's branch is fast-forwarded to the integration head and never gets a commit; anything else verified
    // other code.
    const ran = branchHead(ctx.git, project.root, `arbab/${spec.name}`);
    if (ran !== head) reasons.push(`${spec.name} ran on ${ran ?? "no commit"}, not on the integration head ${head}; run arbab verify ${name} again`);
    const left = worktreeChanges(ctx, project, spec.name);
    if (left !== null) reasons.push(left);
  }

  const results = gateResults(attemptEvents(project.runsRoot, spec.name, outcome.attempts), gates, smoke);
  const record: VerifyRecord = verifyRecord({
    name,
    lane: spec.name,
    attempt: outcome.attempts.at(-1) ?? null,
    headSha: head,
    results,
    now: isoAt(ctx.clock),
    reasons,
  });
  writeJsonAtomic(integration.paths.verify, record);

  if (values.json === true) {
    printJson(ctx, { timedOut: false, endState: outcome.endState, verify: record });
  } else {
    for (const result of results) ctx.stdout(formatGateResult(result) + "\n");
    const ended = outcome.endState ?? "without an end state";
    const reason = outcome.reason === null ? "" : `; ${outcome.reason.trim().replace(/\s+/g, " ")}`;
    const why = record.reason === undefined ? "" : `: ${record.reason}`;
    ctx.stdout(`verify ${name}: ${record.passed ? "passed" : "failed"} at ${head} (lane ${spec.name} ${ended}${reason})${why}\n`);
  }
  return record.passed ? 0 : 1;
}

const MAX_LISTED = 5;

/**
 * Why the verify worktree cannot vouch for the head after the run, or null when it is clean. The gates ran on that
 * tree, so a change left in it (an edit, a file a gate wrote outside the ignored build outputs) means they may have
 * checked something other than the head. The git dir is verified first and named explicitly, as for a checkpoint:
 * the worktree's own .git file is worker-writable.
 */
export function worktreeChanges(ctx: CommandContext, project: Project, lane: string): string | null {
  const worktree = join(project.worktreeRoot, lane);
  const gitCommonDir = resolveGitCommonDir(ctx.git, project.root);
  if (gitCommonDir === undefined) return `the git directory of ${project.root} could not be resolved, so ${worktree} was not checked`;
  const verified = verifyWorktreeGit({ worktree, branch: `arbab/${lane}`, gitCommonDir });
  if (verified.gitDir === null) return `the worktree ${worktree} failed verification: ${verified.error}`;
  let entries: string[];
  try {
    entries = worktreeStatus(worktree, verified.gitDir, ctx.git).map((l) => l.trim());
  } catch (err) {
    return `the worktree ${worktree} could not be checked: ${err instanceof Error ? err.message : String(err)}`;
  }
  if (entries.length === 0) return null;
  const listed = entries.slice(0, MAX_LISTED).join(", ") + (entries.length > MAX_LISTED ? `, and ${entries.length - MAX_LISTED} more` : "");
  return `the worktree ${worktree} has changes after the run${listed === "" ? "" : `: ${listed}`}`;
}
