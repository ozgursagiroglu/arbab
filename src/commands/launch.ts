// arbab launch <lane.json> [--json]
//
// Text: lint issues (if any) on stderr, then `launched <lane>  run <run dir>  shepherd <pid>`.
// --json: {"lane": string, "runDir": string, "shepherdPid": number, "mode": "start" | "fresh",
//          "warnings": [{"severity", "code", "message", "where"?}]}
// Exit 1 on lint errors, when the lane is active, when an orphaned lane's worker still runs, while another launch
// of it holds <runs>/<lane>/launch.lock, or when an integration generated a lane of that name (generated.json) or the
// lane whose worktree it borrows.
import { rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { listAttempts, readAttempt, readState, effectiveState, runPaths } from "../registry";
import { releaseIfStale, type Holder } from "../run";
import type { LintIssue } from "../types";
import { ArbabError } from "../util/errors";
import { createExclusive, readText, writeJsonAtomic } from "../util/fs";
import { isoAt } from "../util/proc";
import type { CommandContext } from "./context";
import { assertNotGenerated, ownerTag, readGenerated } from "./generated";
import { formatIssue, hasErrors, issueSummary, lintLane, resolveGitCommonDir } from "./lint";
import { isActive, onePositional, openProject, parse, printJson, type Project } from "./project";
import { maybeStartSweep } from "./sweep";

export interface Launched {
  lane: string;
  runDir: string;
  shepherdPid: number;
  mode: "start" | "fresh";
  warnings: LintIssue[];
}

/** How long a launch holds its lock while the shepherd it started has not written state.json yet. */
export const LAUNCH_LOCK_MS = 10_000;
export const LAUNCH_POLL_MS = 50;

export const launchLockPath = (project: Project, lane: string): string => join(runPaths(project.runsRoot, lane).laneDir, "launch.lock");

/**
 * Takes the lane's launch lock, so two launches cannot both pass the active-lane check before the first shepherd
 * writes state.json. A lock whose holder is dead is reclaimed, as is one that never parsed within LAUNCH_LOCK_MS;
 * one held by a live pid refuses. Returns the release function.
 */
export function takeLaunchLock(ctx: CommandContext, project: Project, lane: string, pid: number): () => void {
  const path = launchLockPath(project, lane);
  const holder: Holder = { pid, lane, project: project.root, createdAt: isoAt(ctx.clock) };
  const data = JSON.stringify(holder);
  const unparsedIsStale = (): boolean => {
    try {
      return ctx.clock.now() - statSync(path).mtimeMs > LAUNCH_LOCK_MS;
    } catch {
      return false;
    }
  };
  if (!createExclusive(path, data) && !(releaseIfStale(path, ctx.alive, unparsedIsStale()) && createExclusive(path, data))) {
    throw new ArbabError("usage", `lane ${lane} is being launched by another arbab process (${path}); wait for it or check status`);
  }
  return () => {
    try {
      if (readText(path) === data) rmSync(path, { force: true });
    } catch {
      // Already gone.
    }
  };
}

/** Waits until the shepherd has written its first state.json, has died, or LAUNCH_LOCK_MS has passed. */
export async function awaitFirstState(ctx: CommandContext, project: Project, lane: string, shepherdPid: number): Promise<void> {
  const deadline = ctx.clock.now() + LAUNCH_LOCK_MS;
  while (ctx.clock.now() < deadline && ctx.alive(shepherdPid)) {
    try {
      if (readState(project.runsRoot, lane)?.shepherdPid === shepherdPid) return;
    } catch {
      // Not readable yet; poll again.
    }
    await ctx.sleep(LAUNCH_POLL_MS);
  }
}

/**
 * Lints, takes the launch lock, refuses an active lane, records the lane spec in its run directory and starts a
 * shepherd; the lock is released once the shepherd has written state.json, and a background sweep of idle worktrees
 * may start then (maybeStartSweep). Lint errors throw a lint ArbabError after
 * the issues are written to stderr. `onlyNew` refuses, under the lock, a lane that has run before: plan next launches a
 * phase once, even when two of them race. A lane an integration generated is refused unless `generated` says the
 * caller is that integration's command (which checked the marker itself).
 */
export async function launchLane(
  ctx: CommandContext,
  project: Project,
  lanePath: string,
  opts: { onlyNew?: boolean; generated?: boolean } = {},
): Promise<Launched> {
  const { lane, issues } = lintLane(project, lanePath, resolveGitCommonDir(ctx.git, project.root));
  if (hasErrors(issues)) {
    for (const issue of issues) ctx.stderr(formatIssue(issue) + "\n");
    throw new ArbabError("lint", `${issueSummary(lane.name, issues)}; not launched`);
  }
  // The holder is this CLI process: the lock lives exactly as long as this launch.
  const release = takeLaunchLock(ctx, project, lane.name, ctx.pid);
  try {
    if (opts.generated !== true) assertNotGenerated(project.runsRoot, lane.name);
    if (lane.worktree !== undefined && lane.worktree !== lane.name) assertNotGeneratedWorktree(project.runsRoot, lane.name, lane.worktree);
    assertInactive(ctx, project, lane.name);
    assertNoLiveWorker(ctx, project, lane.name);
    const paths = runPaths(project.runsRoot, lane.name);
    const ranBefore = readState(project.runsRoot, lane.name) !== null || listAttempts(project.runsRoot, lane.name).length > 0;
    if (ranBefore && opts.onlyNew === true) throw new ArbabError("usage", `lane ${lane.name} has already been launched`);
    writeJsonAtomic(paths.laneFile, lane);
    const mode = ranBefore ? "fresh" : "start";
    const shepherdPid = ctx.spawnShepherd(project.root, lane.name, { kind: mode });
    await awaitFirstState(ctx, project, lane.name, shepherdPid);
    // After the first state, so the sweep sees this lane active and leaves its worktree.
    maybeStartSweep(ctx, project);
    return { lane: lane.name, runDir: paths.laneDir, shepherdPid, mode, warnings: issues };
  } finally {
    release();
  }
}

/**
 * Refuses a lane that borrows a generated lane's worktree: the integration that generated it resets that worktree on
 * its next verify or review, under a running borrower, and a borrower could change the tree a verify vouches for.
 */
export function assertNotGeneratedWorktree(runsRoot: string, lane: string, worktree: string): void {
  const marker = readGenerated(runsRoot, worktree);
  if (marker === null) return;
  const prefix = ownerTag({ integration: "" });
  const owner = marker.by?.startsWith(prefix) === true ? marker.by.slice(prefix.length) : null;
  throw new ArbabError(
    "usage",
    `lane ${lane} borrows the worktree of lane ${worktree}, which was generated by ` +
      `${owner === null ? "an integration" : `integration ${owner}`}, which owns it; only its arbab verify or arbab review ` +
      "works there. Borrow another lane's worktree",
  );
}

/** Refuses a lane whose shepherd is still alive and not finished. */
export function assertInactive(ctx: CommandContext, project: Project, lane: string): void {
  const record = readState(project.runsRoot, lane);
  if (record === null) return;
  const state = effectiveState(record, ctx.alive);
  if (isActive(state)) {
    throw new ArbabError("usage", `lane ${lane} is ${state} (shepherd ${record.shepherdPid}); stop it or wait for it first`);
  }
}

/**
 * Refuses a lane whose latest worker outlived its shepherd: a new shepherd would be a second writer on the same
 * worktree and session. A live pid counts as the worker when its command line holds the pinned binary, or when ps
 * cannot tell (null), which errs on the safe side.
 */
export function assertNoLiveWorker(ctx: CommandContext, project: Project, lane: string): void {
  const attempt = listAttempts(project.runsRoot, lane).at(-1);
  if (attempt === undefined) return;
  const { started, exit } = readAttempt(runPaths(project.runsRoot, lane).attemptDir(attempt));
  if (started === null || exit !== null) return;
  const pid = started.pid;
  if (!Number.isInteger(pid) || pid <= 1 || !ctx.alive(pid)) return;
  const command = ctx.processCommand(pid);
  const binary = typeof started.binary?.path === "string" ? started.binary.path : null;
  if (command !== null && binary !== null && !command.includes(binary)) return;
  throw new ArbabError("usage", `lane ${lane}'s worker from attempt ${attempt} (pid ${pid}) is still running without its shepherd; run arbab cleanup first`);
}

export async function runLaunch(argv: string[], ctx: CommandContext): Promise<number> {
  const { values, positionals } = parse("launch", {
    args: argv,
    options: { json: { type: "boolean" } },
    allowPositionals: true,
  });
  const lanePath = onePositional("launch", positionals, "lane.json");
  const launched = await launchLane(ctx, openProject(ctx), lanePath);
  if (values.json === true) {
    printJson(ctx, launched);
  } else {
    for (const issue of launched.warnings) ctx.stderr(formatIssue(issue) + "\n");
    ctx.stdout(`launched ${launched.lane}  run ${launched.runDir}  shepherd ${launched.shepherdPid}\n`);
  }
  return 0;
}
