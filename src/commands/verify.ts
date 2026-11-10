// arbab verify <name> [--timeout-min N] [--json]
// arbab verify --ref <branch> [--timeout-min N] [--json]
//
// Runs config.gates, then config.verify.smoke when set, inside the fence: a probe lane <name>-verify in its own
// worktree, installed on a trusted commit and fast-forwarded to the recorded integration head (generatedBase,
// DESIGN.md §17). The gates run worker-written code (tests), so they never run on the host. The lane runs each one as a
// check through its arbab-check script (gate-1…gate-N, smoke; §22). Exit codes come from the stream's tool results for
// those exact command lines, never from the model's report, and so do the `arbab-check failure:` lines of a failed one.
// Refuses while a dependency manifest changed and no human confirmed the install.
// A re-run waits for, or adopts, a verify lane still running or finished on the same head after an earlier verify
// stopped waiting (DESIGN.md §21). While it waits, ~/.arbab/waiters/<pid>.json says so (the Stop hook reads it).
// Writes .arbab/integrations/<name>/verify.json (VerifyRecord, with a `reason` when it failed for something other than
// an exit code: the lane ran on another commit than the head, or its worktree has changes or fails verification after
// the run). Then the lane's worktree and branch are removed; its run dir and run record stay. On a timeout both stay,
// and so do they when the worktree had changes or failed verification (`arbab verify: kept <path> for inspection:
// <reason>` on stderr): the next verify resets it.
// --ref <branch>: the check after landing (§21). The same lane, <id>-verify, starts on the branch's head with no
// integration; the record, named ref:<branch>, goes to .arbab/refs/<id>/verify.json. <id> is ref-<slug>-<hash> (refId).
// After a failed verify of an integration in which a command ran and failed, a fix draft: the lane
// .arbab/integrations/<name>/fix/fix-<k>.json (<name>-fix-<k>, base integrate/<name>) and its brief fix-<k>.md, never
// launched (`arbab verify: fix draft <path>; review it, then arbab launch <path>` on stderr). Not for --ref.
// Text: one line per command, `exit <n>  <kind>  <command>` or `missing  <kind>  <command>`, up to 10 failure lines,
// then `verify <name>: passed|failed at <head> (lane <lane> <end state>)[: <reason>]`.
// --json: {"timedOut": boolean, "endState": string | null, "verify": VerifyRecord | null}, the record with its failures
// Exit 0 when every command exited 0 and nothing gave a reason, 1 otherwise (and on usage errors, including no
// configured gates), 3 when the lane did not finish in time.
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { checkScriptPath, formatFailureLine } from "../check/command";
import { reviewLaneFiles, type LaneStart } from "../review";
import { verifyWorktreeGit, worktreeStatus } from "../run";
import type { GateResult, VerifyRecord } from "../types";
import { ArbabError } from "../util/errors";
import { confine, createExclusive, writeJsonAtomic, writeTextAtomic } from "../util/fs";
import { assertValidName, isValidName } from "../util/names";
import { isoAt } from "../util/proc";
import { gateFailures, gateResults, verifyBrief, verifyLaneSpec, verifyRecord } from "../verify";
import { attributeFailures, fixDraft, fixLaneName, type LaneFiles } from "../verify/fix";
import type { CommandContext } from "./context";
import {
  assertRecordedHead,
  attemptEvents,
  branchHead,
  dropGeneratedWorktrees,
  generatedBase,
  generationOwner,
  openIntegration,
  runGeneratedLanes,
  settleGeneratedRuns,
  type GenerationOwner,
  type Integration,
} from "./integration";
import { resolveGitCommonDir } from "./lint";
import { openProject, parse, printJson, type Project } from "./project";
import { WAIT_TIMEOUT_EXIT, parseTimeoutMin } from "./wait";

const DEFAULT_TIMEOUT_MIN = 90;

/** Where `verify --ref` keeps its lanes and records, under the project root. */
export const REFS_DIR = ".arbab/refs";
/** The prefix of refId: an integration may not take it (integrate refuses it), so a generator so named is a ref's. */
export const REF_PREFIX = "ref-";
const REF_SLUG_MAX = 22;
const REF_HASH_HEX = 6;

export function formatGateResult(result: GateResult): string {
  const code = result.exitCode === null ? "missing" : `exit ${result.exitCode}`;
  return `${code.padEnd(8)}  ${result.kind.padEnd(5)}  ${result.command}`;
}

/** A branch name as a lane-name part: lowercased, every character outside [a-z0-9] turned into `-`, at most 22. */
export function refSlug(branch: string): string {
  return branch.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, REF_SLUG_MAX);
}

/**
 * `ref-<slug>-<6 hex of sha1(branch)>`: the lane prefix and record directory of `verify --ref <branch>`. The slug drops
 * case, characters and length, so two branches can share one (Release/Next and release-next); the hash keeps them apart.
 */
export function refId(branch: string): string {
  const hash = createHash("sha1").update(branch).digest("hex").slice(0, REF_HASH_HEX);
  return `${REF_PREFIX}${refSlug(branch)}-${hash}`;
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
  /** The integration verified; null for --ref, which gets no fix draft. */
  integration: Integration | null;
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
      integration,
    };
  } else {
    const branch = ref ?? "";
    const head = refHead(ctx, project, branch);
    const prefix = refId(branch);
    const dir = confine(project.root, join(REFS_DIR, prefix));
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
      integration: null,
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
  const script = checkScriptPath(project.runsRoot, lane);
  const spec = verifyLaneSpec({ name: target.prefix, brief: reviewLaneFiles(paths, lane).brief, script, gates, smoke, ...target.start });

  // A verify run is usable once it made an attempt: its stream holds the exit codes.
  const run = await runGeneratedLanes(ctx, project, paths, [{ spec, brief: verifyBrief(script, gates, smoke) }], timeoutMs, target.owner, (o) => o.attempts.length > 0);
  const outcome = run.outcomes[0];
  if (run.timedOut || outcome === undefined) {
    if (json) printJson(ctx, { timedOut: true, endState: null, verify: null });
    else ctx.stderr(`arbab verify: ${spec.name} did not finish in time; it keeps running\n`);
    return WAIT_TIMEOUT_EXIT;
  }
  // Without an attempt nothing ran: a setup that failed before the merge leaves the branch at its base, and every
  // command is missing anyway.
  const reasons: string[] = [];
  let left: string | null = null;
  if (outcome.attempts.length > 0) {
    // The lane's branch is fast-forwarded to the head and never gets a commit; anything else verified other code.
    const ran = branchHead(ctx.git, project.root, `arbab/${spec.name}`);
    const what = target.label.startsWith("ref:") ? `the head of ${target.label.slice(4)}` : "the integration head";
    if (ran !== head) reasons.push(`${spec.name} ran on ${ran ?? "no commit"}, not on ${what} ${head}; run ${target.again} again`);
    left = worktreeChanges(ctx, project, spec.name);
    if (left !== null) reasons.push(left);
  }

  const events = attemptEvents(project.runsRoot, spec.name, outcome.attempts);
  const results = gateResults(events, script, gates, smoke);
  const record: VerifyRecord = verifyRecord({
    name: target.label,
    lane: spec.name,
    attempt: outcome.attempts.at(-1) ?? null,
    headSha: head,
    results,
    now: isoAt(ctx.clock),
    reasons,
    failures: gateFailures(events, script, gates, smoke),
  });
  writeJsonAtomic(target.recordPath, record);
  settleGeneratedRuns(target.lanesDir, [spec.name]);
  // The results are recorded; the worktree holds a dependency install the next verify builds again anyway. A tree the
  // check found wrong is what the record's reason points at, so it stays to be looked at; the next verify resets it.
  if (left !== null) ctx.stderr(`arbab verify: kept ${join(project.worktreeRoot, spec.name)} for inspection: ${left}\n`);
  else for (const warning of dropGeneratedWorktrees(ctx, project, [spec.name], target.owner)) ctx.stderr(`arbab verify: ${warning}\n`);
  if (target.integration !== null && results.some(failedCommand)) writeFixDraft(ctx, project, target.integration, record);

  if (json) {
    printJson(ctx, { timedOut: false, endState: outcome.endState, verify: record });
  } else {
    for (const result of results) ctx.stdout(formatGateResult(result) + "\n");
    const failures = record.failures ?? [];
    for (const failure of failures.slice(0, MAX_PRINTED_FAILURES)) ctx.stdout(formatFailureLine(failure) + "\n");
    if (failures.length > MAX_PRINTED_FAILURES) ctx.stdout(`and ${failures.length - MAX_PRINTED_FAILURES} more failures in ${target.recordPath}\n`);
    const ended = outcome.endState ?? "without an end state";
    const reason = outcome.reason === null ? "" : `; ${outcome.reason.trim().replace(/\s+/g, " ")}`;
    const why = record.reason === undefined ? "" : `: ${record.reason}`;
    ctx.stdout(`verify ${target.label}: ${record.passed ? "passed" : "failed"} at ${head} (lane ${spec.name} ${ended}${reason})${why}\n`);
  }
  return record.passed ? 0 : 1;
}

/** The text output prints this many failure lines; verify.json has them all. */
const MAX_PRINTED_FAILURES = 10;

/** A command that ran and failed: a missing one (null) never ran, so a fix cannot be about its output. */
const failedCommand = (result: GateResult): boolean => result.exitCode !== null && result.exitCode !== 0;

const FIX_DIR = "fix";
const FIX_FILE = /^fix-([1-9][0-9]{0,8})\.json$/;
const SHA = /^[0-9a-f]{40,64}$/;
// Another verify of the same integration may claim a number at the same moment; a few tries settle it.
const FIX_TRIES = 5;

const projectRelative = (root: string, path: string): string => relative(root, path).split(sep).join("/");

/** One more than the highest `fix-<k>.json` in `dir`, 1 when there is none. */
export function nextFixNumber(dir: string): number {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return 1;
  }
  let max = 0;
  for (const entry of entries) {
    const k = FIX_FILE.exec(entry)?.[1];
    if (k !== undefined) max = Math.max(max, Number(k));
  }
  return max + 1;
}

/**
 * The files each merged lane changed: `git diff --name-only <merge-base of baseSha and sha>..<sha>`. A lane git cannot
 * answer for gets no files, and a warning.
 */
function mergedLaneFiles(ctx: CommandContext, project: Project, integration: Integration): LaneFiles[] {
  const { baseSha, merged } = integration.record;
  return merged.map(({ lane, sha }) => {
    const fail = (why: string): LaneFiles => {
      ctx.stderr(`arbab verify: could not list the files ${lane} changed: ${why}\n`);
      return { lane, files: [] };
    };
    if (!SHA.test(baseSha) || !SHA.test(sha)) return fail("the integration record holds no commit for it");
    const mb = ctx.git(["merge-base", baseSha, sha], project.root);
    const base = mb.stdout.trim();
    if (mb.code !== 0 || !SHA.test(base)) return fail(`git merge-base failed (${mb.code}): ${(mb.stderr || mb.stdout).trim()}`);
    // -z: names as git stores them, unquoted.
    const diff = ctx.git(["diff", "--name-only", "-z", `${base}..${sha}`], project.root);
    if (diff.code !== 0) return fail(`git diff failed (${diff.code}): ${diff.stderr.trim()}`);
    return { lane, files: diff.stdout.split("\0").filter((f) => f !== "") };
  });
}

/**
 * Writes `.arbab/integrations/<name>/fix/fix-<k>.json` and `.md` for a failed verify and says so on stderr. Nothing
 * launches: the orchestrator reviews the draft. A failure here never changes verify's result, only what it prints.
 */
function writeFixDraft(ctx: CommandContext, project: Project, integration: Integration, record: VerifyRecord): void {
  const name = integration.paths.name;
  const dir = join(integration.paths.dir, FIX_DIR);
  try {
    const candidates = attributeFailures(record.failures ?? [], mergedLaneFiles(ctx, project, integration));
    const first = nextFixNumber(dir);
    for (let k = first; k < first + FIX_TRIES; k++) {
      const lane = fixLaneName(name, k);
      if (!isValidName(lane)) {
        ctx.stderr(`arbab verify: no fix draft: ${lane} is not a valid lane name (at most 48 characters); write the fix lane yourself\n`);
        return;
      }
      const briefFile = join(dir, `fix-${k}.md`);
      const draft = fixDraft({ name, k, briefPath: projectRelative(project.root, briefFile), record, candidates });
      const laneFile = join(dir, `fix-${k}.json`);
      if (!createExclusive(laneFile, JSON.stringify(draft.lane, null, 2) + "\n")) continue;
      writeTextAtomic(briefFile, draft.brief);
      const shown = projectRelative(project.root, laneFile);
      ctx.stderr(`arbab verify: fix draft ${shown}; review it, then arbab launch ${shown}\n`);
      return;
    }
    ctx.stderr(`arbab verify: no fix draft: fix-${first}.json to fix-${first + FIX_TRIES - 1}.json were all taken\n`);
  } catch (err) {
    ctx.stderr(`arbab verify: no fix draft: ${err instanceof Error ? err.message : String(err)}\n`);
  }
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
