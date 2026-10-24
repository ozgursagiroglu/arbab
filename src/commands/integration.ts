// Shared by the landing commands (DESIGN.md §17): the integration a command works on, and the lanes those commands
// generate (verify, reviewers, skeptics). Generated lanes get a new worktree each time, installed on a trusted commit
// and fast-forwarded to the integration head (generatedBase), are launched through launchLane and are awaited by their
// shepherd's pid. A re-run waits for or adopts an earlier run of the same lane on the same head instead (§21).
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { confirmCommand, integrationPaths, readIntegration, type IntegrationPaths } from "../integrate";
import { ackRun, attemptFiles, effectiveState, listAttempts, listLanes, readState, runPaths } from "../registry";
import { untrustedTree } from "../run";
import { parseStream } from "../stream";
import type { EndState, IntegrationRecord, JsonSchema, LaneSpec } from "../types";
import { ArbabError } from "../util/errors";
import { confine, readJson, readText, writeJsonAtomic, writeTextAtomic } from "../util/fs";
import { assertValidName } from "../util/names";
import type { CommandContext } from "./context";
import { markGenerated, ownerTag, readGenerated, type GenerationOwner } from "./generated";
import { assertInactive, assertNoLiveWorker, launchLane } from "./launch";
import { formatIssue, hasErrors, issueSummary, lintLane, resolveGitCommonDir } from "./lint";
import { waitForProbes, whileWaiting } from "./preflight";
import { isActive, type Project } from "./project";

export { markGenerated, type GenerationOwner } from "./generated";

export interface Integration {
  paths: IntegrationPaths;
  record: IntegrationRecord;
}

/** The integration and its record; a usage error before the first `integrate`. */
export function openIntegration(project: Project, name: string): Integration {
  const paths = integrationPaths(project.root, project.config, name);
  const record = readIntegration(paths);
  if (record === null) throw new ArbabError("usage", `integration ${paths.name} does not exist; run arbab integrate ${paths.name} first`);
  return { paths, record };
}

const SHA = /^[0-9a-f]{40,64}$/;

/** The commit refs/heads/<branch> points at, or null when there is no such branch. */
export function branchHead(git: CommandContext["git"], root: string, branch: string): string | null {
  const r = git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`], root);
  const sha = r.stdout.trim();
  return r.code === 0 && SHA.test(sha) ? sha : null;
}

/** Refuses when integrate/<name> no longer points where integration.json says (a commit made there by hand). */
export function assertRecordedHead(git: CommandContext["git"], project: Project, integration: Integration): void {
  const { paths, record } = integration;
  const head = branchHead(git, project.root, paths.branch);
  if (head !== record.headSha) {
    throw new ArbabError(
      "usage",
      `${paths.branch} is at ${head ?? "no commit"}, but integration.json records ${record.headSha}; run arbab integrate ${paths.name} again`,
    );
  }
}

const UNMERGED = "a commit arbab did not merge";

/**
 * The record's changed manifests while no human has confirmed their install, grouped by who changed them: the merged
 * lanes that did, or a commit arbab did not merge (a hand commit, a merge whose record was lost). Empty once confirmed.
 */
export function unconfirmedManifests(record: IntegrationRecord): Array<{ by: string; manifests: string[] }> {
  if (record.manifests.length === 0 || record.depsConfirmedAt !== null) return [];
  const groups = new Map<string, string[]>();
  for (const manifest of record.manifests) {
    const lanes = record.merged.filter((m) => m.manifests.includes(manifest)).map((m) => m.lane);
    const by = lanes.length > 0 ? lanes.join(", ") : UNMERGED;
    groups.set(by, [...(groups.get(by) ?? []), manifest]);
  }
  return [...groups].map(([by, manifests]) => ({ by, manifests }));
}

/**
 * Where a generated lane's worktree starts and what is merged into it (DESIGN.md §17). The shepherd installs the
 * dependencies in a new worktree before it merges, on the host: the integration tree is worker code, and an install
 * can run any file in it (a lifecycle script's own file, setup.py, a Makefile), not only the manifests. So the lane
 * starts on a commit whose install is trusted, and the integration head is merged on top: the base commit when no
 * manifest changed, else the head at which a human installed them. Refuses while changed manifests are unconfirmed.
 * Both are commits from the record, so a later `integrate` that moves the branch does not change what the lane gets.
 */
export function generatedBase(record: IntegrationRecord): { base: string; mergeBranches?: string[] } {
  const base = record.manifests.length === 0 ? record.baseSha : record.depsConfirmedAt;
  if (base === null) {
    const changes = unconfirmedManifests(record).map((g) => `${g.by} changed ${g.manifests.join(", ")}`);
    throw new ArbabError(
      "usage",
      `${changes.join("; ")}: ${installReview(record.headSha)}, install the dependencies in ${record.worktree} ` +
        `yourself, then run ${confirmCommand(record.name, record.headSha)}`,
    );
  }
  return base === record.headSha ? { base } : { base, mergeBranches: [record.headSha] };
}

/**
 * What the human reviews before confirming: an install at that head runs more than the manifests (the scripts they
 * name and the files those run), and a confirmation lets arbab run the same install there again.
 */
function installReview(head: string): string {
  return `review the change and what an install at ${head} runs (package.json scripts and the files they run, .npmrc, .pnpmfile.*)`;
}

/** What the human must do about unconfirmed manifest changes, one line each. */
export function manifestAdvice(record: IntegrationRecord): string[] {
  const groups = unconfirmedManifests(record);
  if (groups.length === 0) return [];
  return [
    "dependency manifests changed and were not installed (installing would run worker code on the host); a human, not the orchestrator:",
    ...groups.map((g) => `  ${g.by}: ${g.manifests.join(", ")}`),
    `${installReview(record.headSha)}, install the dependencies in ${record.worktree} yourself, then run: ` +
      confirmCommand(record.name, record.headSha),
    "confirming lets arbab install at that head on this machine for verify and review",
  ];
}

export interface GeneratedLane {
  spec: LaneSpec;
  /** The brief's text; written to spec.brief. */
  brief: string;
  /** Written to spec.schema, which must then be set. */
  schema?: JsonSchema;
}

/** Writes the brief, the schema and the lane file under paths.lanesDir; returns the lane file's path. */
export function writeGeneratedLane(project: Project, paths: Pick<IntegrationPaths, "lanesDir">, lane: GeneratedLane): string {
  const name = assertValidName(lane.spec.name, "lane");
  writeTextAtomic(confine(project.root, lane.spec.brief), lane.brief);
  if (lane.schema !== undefined) {
    if (lane.spec.schema === undefined) throw new ArbabError("usage", `lane ${name} has a schema but no schema path`);
    writeJsonAtomic(confine(project.root, lane.spec.schema), lane.schema);
  }
  const file = join(paths.lanesDir, `${name}.json`);
  writeJsonAtomic(file, lane.spec);
  return file;
}

/** Lints every lane file before any is launched, so a refused lane never leaves the others running. */
export function lintGeneratedLanes(ctx: CommandContext, project: Project, files: string[]): void {
  const gitCommonDir = resolveGitCommonDir(ctx.git, project.root);
  for (const file of files) {
    const { lane, issues } = lintLane(project, file, gitCommonDir);
    if (hasErrors(issues)) {
      for (const issue of issues) ctx.stderr(formatIssue(issue) + "\n");
      throw new ArbabError("lint", `${issueSummary(lane.name, issues)}; nothing launched`);
    }
  }
}

function mustGit(ctx: CommandContext, args: string[], cwd: string): void {
  const r = ctx.git(args, cwd);
  if (r.code !== 0) throw new ArbabError("git", `git ${args.join(" ")} failed (${r.code}): ${(r.stderr || r.stdout).trim()}`);
}

/** The owner of the lanes generated for this integration, which start from its recorded head. */
export function generationOwner(integration: Integration): GenerationOwner {
  return { integration: integration.paths.name, branch: integration.record.branch, head: integration.record.headSha };
}

/**
 * Refuses while an active lane's run lane.json names `lane` as its worktree: removing the worktree would pull it out
 * from under that worker. A borrower whose state cannot be read may be running, so it refuses too.
 */
export function assertNotBorrowed(ctx: CommandContext, project: Project, lane: string): void {
  for (const other of listLanes(project.runsRoot)) {
    if (other === lane) continue;
    let spec: unknown;
    try {
      spec = readJson<unknown>(runPaths(project.runsRoot, other).laneFile);
    } catch {
      continue;
    }
    const worktree = typeof spec === "object" && spec !== null ? Reflect.get(spec, "worktree") : undefined;
    if (worktree !== lane) continue;
    let state: string;
    try {
      const record = readState(project.runsRoot, other);
      if (record === null) continue;
      const current = effectiveState(record, ctx.alive);
      if (!isActive(current)) continue;
      state = current;
    } catch (err) {
      state = `unreadable (${err instanceof Error ? err.message : String(err)})`;
    }
    throw new ArbabError(
      "usage",
      `lane ${other} works in lane ${lane}'s worktree and is ${state}, so nothing was removed; stop it or wait for it first`,
    );
  }
}

/**
 * Removes the worktree and branch an earlier run of the same generated lane left behind. The shepherd reuses an
 * existing worktree as it is, so without this a second verify or review would check the tree of an older integration
 * head. Only a lane this integration generated is touched: a lane name can belong to someone else (an integration
 * called "m3" generates "m3-verify", which was also the name of a lane in arbab's own build, and a reset here once
 * deleted that lane's branch). A foreign lane is refused with nothing removed. A branch is deleted only when it is
 * still at the head the marker recorded (the lane never committed, even if the integration branch was recreated
 * since), or when it has no commits that are not on the integration branch.
 */
export function resetGeneratedWorktree(ctx: CommandContext, project: Project, lane: string, owner: GenerationOwner): void {
  const name = assertValidName(lane, "lane");
  assertInactive(ctx, project, name);
  assertNoLiveWorker(ctx, project, name);
  assertNotBorrowed(ctx, project, name);
  const runDir = join(project.runsRoot, name);
  const path = join(project.worktreeRoot, name);
  const branch = `arbab/${name}`;
  const head = branchHead(ctx.git, project.root, branch);
  if (!existsSync(runDir) && !existsSync(path) && head === null) return;
  const marker = readGenerated(project.runsRoot, name);
  if (marker === null || marker.by !== ownerTag(owner)) {
    throw new ArbabError(
      "usage",
      `lane ${name} already exists and was not generated for integration ${owner.integration}, so nothing was removed; ` +
        "use another integration name, or rename that lane",
    );
  }
  if (head !== null && head !== marker.baseSha) {
    const extra = ctx.git(["rev-list", branch, "--not", owner.branch], project.root);
    if (extra.code !== 0 || extra.stdout.trim() !== "") {
      throw new ArbabError("git", `${branch} has commits that are not on ${owner.branch}, so nothing was removed`);
    }
  }
  // The lane's tree is worker code: the same git options as every other host-side call in such a tree.
  if (existsSync(path)) mustGit(ctx, [...untrustedTree(), "worktree", "remove", "--force", path], project.root);
  mustGit(ctx, ["worktree", "prune"], project.root);
  if (head !== null) mustGit(ctx, [...untrustedTree(), "branch", "-D", branch], project.root);
}

/**
 * Removes the worktrees and branches of generated lanes whose results a command has just recorded, as the next
 * run's resetGeneratedWorktree would. Never throws: each lane that could not go comes back as one warning line.
 */
export function dropGeneratedWorktrees(ctx: CommandContext, project: Project, lanes: string[], owner: GenerationOwner): string[] {
  // Run dirs, markers and run records stay: they are the measurements, and the next run reads them.
  const warnings: string[] = [];
  for (const lane of lanes) {
    try {
      resetGeneratedWorktree(ctx, project, lane, owner);
    } catch (err) {
      warnings.push(`could not remove ${lane}'s worktree and branch: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return warnings;
}

/** What one generated lane's run left: its end state, its attempts and its latest report. */
export interface LaneOutcome {
  lane: string;
  /** null when the run never wrote a finished state (its shepherd died). */
  endState: EndState | null;
  reason: string | null;
  /** This run's attempts, oldest first. */
  attempts: number[];
  /** The latest attempt's report.json, or null. */
  report: unknown;
}

interface Started {
  lane: string;
  pid: number;
  /** The lane's last attempt before this run. */
  before: number;
}

function readReport(path: string): unknown {
  try {
    return readJson<unknown>(path);
  } catch {
    // A report that does not parse is no report.
    return null;
  }
}

function readOwnFinished(runsRoot: string, run: Started): ReturnType<typeof readState> {
  let state: ReturnType<typeof readState> = null;
  try {
    state = readState(runsRoot, run.lane);
  } catch {
    // A damaged state.json says nothing about this run.
  }
  return state !== null && state.shepherdPid === run.pid && state.state === "finished" ? state : null;
}

/** What a run left, without acking it. */
function readOutcome(runsRoot: string, run: Started): LaneOutcome {
  const own = readOwnFinished(runsRoot, run);
  const attempts = listAttempts(runsRoot, run.lane).filter((n) => n > run.before);
  const latest = attempts.at(-1) ?? null;
  const report = latest === null ? null : readReport(attemptFiles(runPaths(runsRoot, run.lane).attemptDir(latest)).report);
  return { lane: run.lane, endState: own?.endState ?? null, reason: own?.reason ?? null, attempts, report };
}

/** Collects a finished run and acks it, so a background `arbab wait` does not report it a second time. */
export function collectRun(runsRoot: string, run: Started): LaneOutcome {
  const outcome = readOutcome(runsRoot, run);
  const own = readOwnFinished(runsRoot, run);
  if (own !== null) ackRun(runsRoot, run.lane, { shepherdPid: own.shepherdPid, since: own.since }, outcome.attempts.at(-1) ?? null);
  return outcome;
}

/**
 * <lanesDir>/<lane>.run.json: the run a verify or review launched for a generated lane. A later command finds it there
 * when the earlier one stopped waiting (DESIGN.md §21), and knows which attempts are that run's.
 */
export interface GeneratedRun {
  lane: string;
  shepherdPid: number;
  /** The lane's last attempt before this run. */
  before: number;
  /** The head the run works on. */
  head: string;
  /** laneFingerprint of what was launched. */
  fingerprint: string;
  /** A command took the run's results into its record; a later command launches afresh. */
  settled: boolean;
}

const runRecordPath = (lanesDir: string, lane: string): string => join(lanesDir, `${assertValidName(lane, "lane")}.run.json`);

/** The lane's run record with its fields checked; null when there is none or it does not fit. */
export function readGeneratedRun(lanesDir: string, lane: string): GeneratedRun | null {
  let raw: unknown;
  try {
    raw = readJson<unknown>(runRecordPath(lanesDir, lane));
  } catch {
    // A damaged record cannot vouch for a run: the lane is launched afresh.
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const valid =
    r["lane"] === lane &&
    Number.isInteger(r["shepherdPid"]) &&
    Number.isInteger(r["before"]) &&
    typeof r["head"] === "string" &&
    SHA.test(r["head"]) &&
    typeof r["fingerprint"] === "string" &&
    typeof r["settled"] === "boolean";
  return valid ? (r as unknown as GeneratedRun) : null;
}

/** Marks the lanes' runs as taken into a record, so the next command launches them afresh. */
export function settleGeneratedRuns(lanesDir: string, lanes: string[]): void {
  for (const lane of lanes) {
    const run = readGeneratedRun(lanesDir, lane);
    if (run !== null && !run.settled) writeJsonAtomic(runRecordPath(lanesDir, lane), { ...run, settled: true });
  }
}

/** What a generated lane is launched with: its spec, brief and schema. A run of another fingerprint did other work. */
export function laneFingerprint(lane: GeneratedLane): string {
  return createHash("sha256")
    .update(JSON.stringify([lane.spec, lane.brief, lane.schema ?? null]))
    .digest("hex");
}

/** Which runs a re-run may take as they are: a finished run with a usable report, by default one that has a report. */
export type UsableRun = (outcome: LaneOutcome) => boolean;

const hasReport: UsableRun = (o) => o.report !== null;

/**
 * The earlier run of a generated lane that a re-run takes instead of launching: an unsettled run this command recorded
 * for the same head and the same lane, which is still active (wait for it) or finished with success and a usable report
 * and still has its worktree (adopt it). Null when the lane must be launched: the head or the lane changed, the run
 * failed, left nothing usable or lost its worktree, or a command already settled it.
 */
function reusableRun(
  ctx: CommandContext,
  project: Project,
  lanesDir: string,
  lane: string,
  owner: GenerationOwner,
  fingerprint: string,
  usable: UsableRun = hasReport,
): { kind: "wait" | "adopt"; run: Started } | null {
  const prior = readGeneratedRun(lanesDir, lane);
  if (prior === null || prior.settled || prior.head !== owner.head || prior.fingerprint !== fingerprint) return null;
  const marker = readGenerated(project.runsRoot, lane);
  if (marker === null || marker.by !== ownerTag(owner) || marker.baseSha !== owner.head) return null;
  let state: ReturnType<typeof readState>;
  try {
    state = readState(project.runsRoot, lane);
  } catch {
    return null;
  }
  if (state === null || state.shepherdPid !== prior.shepherdPid) return null;
  const run: Started = { lane, pid: prior.shepherdPid, before: prior.before };
  if (isActive(effectiveState(state, ctx.alive))) return { kind: "wait", run };
  // A command reads the adopted lane's tree (verify checks its branch and changes): without it, the run starts afresh.
  if (!existsSync(join(project.worktreeRoot, lane))) return null;
  const outcome = readOutcome(project.runsRoot, run);
  return outcome.endState === "success" && usable(outcome) ? { kind: "adopt", run } : null;
}

/** Every event of the given attempts' streams, in attempt order (a resumed attempt continues the previous one). */
export function attemptEvents(runsRoot: string, lane: string, attempts: number[]): unknown[] {
  const paths = runPaths(runsRoot, lane);
  return attempts.flatMap((n) => parseStream(readText(attemptFiles(paths.attemptDir(n)).stream) ?? "").events);
}

/**
 * Runs each lane and waits until every one has finished or `timeoutMs` has passed; outcomes come in the lanes' order.
 * A lane whose earlier run is reusable (reusableRun) is waited for or adopted as it is. Every other lane is written
 * and linted (all before any launch), started from the integration head (resetGeneratedWorktree) and launched, and its
 * run recorded in paths.lanesDir. While it waits, this process is a registered waiter (whileWaiting). On timeout the
 * lanes keep running and nothing is collected.
 */
export async function runGeneratedLanes(
  ctx: CommandContext,
  project: Project,
  paths: Pick<IntegrationPaths, "lanesDir">,
  lanes: GeneratedLane[],
  timeoutMs: number,
  owner: GenerationOwner,
  usable: UsableRun = hasReport,
): Promise<{ timedOut: boolean; outcomes: LaneOutcome[] }> {
  const plans = lanes.map((lane) => {
    const name = assertValidName(lane.spec.name, "lane");
    const fingerprint = laneFingerprint(lane);
    return { lane, name, fingerprint, prior: reusableRun(ctx, project, paths.lanesDir, name, owner, fingerprint, usable) };
  });
  const fresh = plans.filter((p) => p.prior === null);
  // Before anything is written: a running lane's brief is what its next attempt reads.
  for (const p of fresh) assertInactive(ctx, project, p.name);
  const written = fresh.map((p) => ({ ...p, file: writeGeneratedLane(project, paths, p.lane) }));
  lintGeneratedLanes(ctx, project, written.map((p) => p.file));
  for (const p of written) {
    resetGeneratedWorktree(ctx, project, p.name, owner);
    markGenerated(project.runsRoot, p.name, owner, new Date(ctx.clock.now()).toISOString());
  }
  const runs = new Map<string, Started>();
  for (const p of plans) if (p.prior !== null) runs.set(p.name, p.prior.run);
  for (const p of written) {
    const before = listAttempts(project.runsRoot, p.name).at(-1) ?? 0;
    const launched = await launchLane(ctx, project, p.file, { generated: true });
    const run: Started = { lane: p.name, pid: launched.shepherdPid, before };
    const record: GeneratedRun = { lane: p.name, shepherdPid: run.pid, before, head: owner.head, fingerprint: p.fingerprint, settled: false };
    writeJsonAtomic(runRecordPath(paths.lanesDir, p.name), record);
    runs.set(p.name, run);
  }

  const named = (kind: "wait" | "adopt"): string => plans.filter((p) => p.prior?.kind === kind).map((p) => p.name).join(", ");
  if (named("adopt") !== "") ctx.stderr(`adopted ${named("adopt")}: finished for this head after an earlier run stopped waiting\n`);
  if (named("wait") !== "") ctx.stderr(`${named("wait")} still running for this head from an earlier run; waiting\n`);
  if (fresh.length > 0) ctx.stderr(`launched ${fresh.map((p) => p.name).join(", ")}; waiting\n`);

  const started = plans.flatMap((p) => runs.get(p.name) ?? []);
  if (!(await whileWaiting(ctx, project.root, () => waitForProbes(ctx, project.runsRoot, started, timeoutMs)))) return { timedOut: true, outcomes: [] };
  return { timedOut: false, outcomes: started.map((run) => collectRun(project.runsRoot, run)) };
}

/**
 * The latest attempt's report.json, or null when it has none. An older attempt's report describes work the latest
 * attempt may have changed since, so it never stands in.
 */
export function latestReport(runsRoot: string, lane: string): unknown {
  const latest = listAttempts(runsRoot, lane).at(-1);
  return latest === undefined ? null : readReport(attemptFiles(runPaths(runsRoot, lane).attemptDir(latest)).report);
}
