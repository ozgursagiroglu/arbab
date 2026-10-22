// arbab verify <name> [--timeout-min N] [--json]
// arbab verify --ref <branch> [--timeout-min N] [--json]
//
// Runs config.gates, then config.verify.smoke when set, inside the fence: a probe lane <name>-verify in its own
// worktree, installed on a trusted commit and fast-forwarded to the recorded integration head (generatedBase,
// DESIGN.md §17). The gates run worker-written code (tests), so they never run on the host. Exit codes come from the
// stream's tool results for those exact command lines, never from the model's report.
// Refuses while a dependency manifest changed and no human confirmed the install.
// A re-run waits for, or adopts, a verify lane still running or finished on the same head after an earlier verify
// stopped waiting (DESIGN.md §21).
// Writes .arbab/integrations/<name>/verify.json (VerifyRecord, with a `reason` when it failed for something other than
// an exit code: the lane ran on another commit than the head, or its worktree has changes or fails verification after
// the run).
// --ref <branch>: the check after landing (§21). The same lane, ref-<slug>-verify, starts on the branch's head with no
// integration; the record, named ref:<branch>, goes to .arbab/refs/<slug>/verify.json.
// Text: one line per command, `exit <n>  <kind>  <command>` or `missing  <kind>  <command>`, then
// `verify <name>: passed|failed at <head> (lane <lane> <end state>)[: <reason>]`.
// --json: {"timedOut": boolean, "endState": string | null, "verify": VerifyRecord | null}
// Exit 0 when every command exited 0 and nothing gave a reason, 1 otherwise (and on usage errors, including no
// configured gates), 3 when the lane did not finish in time.
import { join } from "node:path";
import { reviewLaneFiles, type LaneStart } from "../review";
import { verifyWorktreeGit, worktreeStatus } from "../run";
import type { GateResult, VerifyRecord } from "../types";
import { ArbabError } from "../util/errors";
import { confine, writeJsonAtomic } from "../util/fs";
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
  openIntegration,
  runGeneratedLanes,
  settleGeneratedRuns,
  type GenerationOwner,
} from "./integration";
import { resolveGitCommonDir } from "./lint";
import { openProject, parse, printJson, type Project } from "./project";
import { WAIT_TIMEOUT_EXIT, parseTimeoutMin } from "./wait";

const DEFAULT_TIMEOUT_MIN = 90;

/** Where `verify --ref` keeps its lanes and records, under the project root. */
export const REFS_DIR = ".arbab/refs";
const REF_SLUG_MAX = 30;

export function formatGateResult(result: GateResult): string {
  const code = result.exitCode === null ? "missing" : `exit ${result.exitCode}`;
  return `${code.padEnd(8)}  ${result.kind.padEnd(5)}  ${result.command}`;
}

/** A branch name as a lane-name part: lowercased, every character outside [a-z0-9] turned into `-`, at most 30. */
export function refSlug(branch: string): string {
  return branch.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, REF_SLUG_MAX);
}

/** The commit refs/heads/<branch> points at, exactly that branch (no revision syntax); a usage error when none. */
function refHead(ctx: CommandContext, project: Project, branch: string): string {
  if (branch === "" || branch.startsWith("-")) throw new ArbabError("usage", `--ref ${JSON.stringify(branch)} is not a branch name`);
  const r = ctx.git(["show-ref", "--verify", "--hash", `refs/heads/${branch}`], project.root);
  const sha = r.stdout.trim();
  if (r.code !== 0 || !/^[0-9a-f]{40,64}$/.test(sha)) throw new ArbabError("usage", `there is no branch ${branch}`);
  return sha;
}

/** What one verify run works on: the lane's prefix, where its files and record go, and the head it checks. */
interface VerifyTarget {
  /** The record's name: the integration's, or ref:<branch>. */
  label: string;
  /** The lane is <prefix>-verify. */
  prefix: string;
  lanesDir: string;
  recordPath: string;
  start: LaneStart;
  owner: GenerationOwner;
  head: string;
  /** The command that runs this verify again. */
  again: string;
}

export async function runVerify(argv: string[], ctx: CommandContext): Promise<number> {
  const { values, positionals } = parse("verify", {
    args: argv,
    options: { ref: { type: "string" }, "timeout-min": { type: "string" }, json: { type: "boolean" } },
    allowPositionals: true,
  });
  const ref = values.ref;
  if (ref !== undefined && positionals.length > 0) throw new ArbabError("usage", "usage: arbab verify <name> or arbab verify --ref <branch>, not both");
  if (ref === undefined && positionals.length !== 1) throw new ArbabError("usage", "usage: arbab verify <name>");
  const name = ref === undefined ? assertValidName(positionals[0], "integration") : null;
  const timeoutMs = parseTimeoutMin(values["timeout-min"] ?? String(DEFAULT_TIMEOUT_MIN));
  const project = openProject(ctx);
  const { gates } = project.config;
  if (gates.length === 0) throw new ArbabError("usage", "no gates are configured (arbab.config.json gates); verify has nothing to run");

  let target: VerifyTarget;
  if (name !== null) {
    const integration = openIntegration(project, name);
    const owner = generationOwner(integration);
    const start = generatedBase(integration.record);
    assertRecordedHead(ctx.git, project, integration);
    target = {
      label: name,
      prefix: name,
      lanesDir: integration.paths.lanesDir,
      recordPath: integration.paths.verify,
      start,
      owner,
      head: integration.record.headSha,
      again: `arbab verify ${name}`,
    };
  } else {
    const branch = ref ?? "";
    const head = refHead(ctx, project, branch);
    const slug = refSlug(branch);
    const prefix = `ref-${slug}`;
    const dir = confine(project.root, join(REFS_DIR, slug));
    target = {
      label: `ref:${branch}`,
      prefix,
      lanesDir: join(dir, "lanes"),
      recordPath: join(dir, "verify.json"),
      // The branch head is landed code, so the install runs on it: nothing is merged on top.
      start: { base: head },
      owner: { integration: prefix, branch: `refs/heads/${branch}`, head },
      head,
      again: `arbab verify --ref ${branch}`,
    };
  }
  return verifyTarget(ctx, project, target, timeoutMs, values.json === true);
}

async function verifyTarget(ctx: CommandContext, project: Project, target: VerifyTarget, timeoutMs: number, json: boolean): Promise<number> {
  const { gates } = project.config;
  const smoke = project.config.verify.smoke;
  const { head } = target;
  const paths = { name: target.prefix, projectRoot: project.root, lanesDir: target.lanesDir };
  const lane = `${target.prefix}-verify`;
  const spec = verifyLaneSpec({ name: target.prefix, brief: reviewLaneFiles(paths, lane).brief, gates, smoke, ...target.start });

  // A verify run is usable once it made an attempt: its stream holds the exit codes.
  const run = await runGeneratedLanes(ctx, project, paths, [{ spec, brief: verifyBrief(gates, smoke) }], timeoutMs, target.owner, (o) => o.attempts.length > 0);
  const outcome = run.outcomes[0];
  if (run.timedOut || outcome === undefined) {
    if (json) printJson(ctx, { timedOut: true, endState: null, verify: null });
    else ctx.stderr(`arbab verify: ${spec.name} did not finish in time; it keeps running\n`);
    return WAIT_TIMEOUT_EXIT;
  }
  // Without an attempt nothing ran: a setup that failed before the merge leaves the branch at its base, and every
  // command is missing anyway.
  const reasons: string[] = [];
  if (outcome.attempts.length > 0) {
    // The lane's branch is fast-forwarded to the head and never gets a commit; anything else verified other code.
    const ran = branchHead(ctx.git, project.root, `arbab/${spec.name}`);
    const what = target.label.startsWith("ref:") ? `the head of ${target.label.slice(4)}` : "the integration head";
    if (ran !== head) reasons.push(`${spec.name} ran on ${ran ?? "no commit"}, not on ${what} ${head}; run ${target.again} again`);
    const left = worktreeChanges(ctx, project, spec.name);
    if (left !== null) reasons.push(left);
  }

  const results = gateResults(attemptEvents(project.runsRoot, spec.name, outcome.attempts), gates, smoke);
  const record: VerifyRecord = verifyRecord({
    name: target.label,
    lane: spec.name,
    attempt: outcome.attempts.at(-1) ?? null,
    headSha: head,
    results,
    now: isoAt(ctx.clock),
    reasons,
  });
  writeJsonAtomic(target.recordPath, record);
  settleGeneratedRuns(target.lanesDir, [spec.name]);

  if (json) {
    printJson(ctx, { timedOut: false, endState: outcome.endState, verify: record });
  } else {
    for (const result of results) ctx.stdout(formatGateResult(result) + "\n");
    const ended = outcome.endState ?? "without an end state";
    const reason = outcome.reason === null ? "" : `; ${outcome.reason.trim().replace(/\s+/g, " ")}`;
    const why = record.reason === undefined ? "" : `: ${record.reason}`;
    ctx.stdout(`verify ${target.label}: ${record.passed ? "passed" : "failed"} at ${head} (lane ${spec.name} ${ended}${reason})${why}\n`);
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
