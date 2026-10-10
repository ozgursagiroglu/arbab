// arbab cleanup [--worktrees] [--json]
//
// Marks lanes whose shepherd died orphaned and reaps their worker; removes pool entries (slots, semaphores, leases,
// writer locks) whose holder is dead; with --worktrees, removes the worktrees of finished lanes that are clean and
// merged into baseBranch, then the worktree and branch of every landed integration. Of lane branches only generated
// lanes' go: a later plan phase merges an earlier one's arbab/<lane> by name. The same rules (removeLaneWorktrees)
// serve `arbab land`, which cleans up what it landed.
// Text: one line per action (`orphaned <lane>`, `reaped <lane> pgid <n>`, `released <file>`,
// `removed worktree <path>`, `deleted branch <branch>`, `kept worktree <path>: <reason>`,
// `kept branch <branch>: <reason>`), or `nothing to clean`.
// --json: {"orphaned": string[], "reaped": [{"lane", "pgid"}], "released": string[], "worktreesRemoved": string[],
//          "branchesDeleted": string[], "worktreesKept": [{"path", "reason"}], "branchesKept": [{"branch", "reason"}],
//          "warnings": string[]}
import { existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { integrationPaths, listIntegrations, readIntegration, type IntegrationPaths } from "../integrate";
import { effectiveState, listAttempts, listLanes, readAttempt, readState, runPaths, writeState } from "../registry";
import { listPoolEntries, reap, releaseIfStale, untrustedTree, verifyWorktreeGit, worktreeStatus, type GitRunner } from "../run";
import type { LaneSpec, LaneState } from "../types";
import { ArbabError } from "../util/errors";
import { readJson } from "../util/fs";
import { isValidName } from "../util/names";
import { isoAt } from "../util/proc";
import type { CommandContext } from "./context";
import { readGenerated } from "./generated";
import { branchHead } from "./integration";
import { resolveGitCommonDir } from "./lint";
import { isActive, openProject, parse, printJson, type Project } from "./project";

/** An entry that never parsed is left this long for its creator to finish writing it. */
export const UNPARSED_GRACE_MS = 5 * 60_000;
const REAP_GRACE_MS = 10_000;

/** What removing worktrees and the branches that may go did. Run dirs and integration records are never removed. */
export interface WorktreeCleanup {
  worktreesRemoved: string[];
  branchesDeleted: string[];
  /** A kept worktree keeps its branch too. */
  worktreesKept: Array<{ path: string; reason: string }>;
  branchesKept: Array<{ branch: string; reason: string }>;
  warnings: string[];
}

export interface CleanupReport extends WorktreeCleanup {
  orphaned: string[];
  reaped: Array<{ lane: string; pgid: number }>;
  released: string[];
}

/** Pool entries whose holder pid is dead, entries unparsable for longer than the grace, and leftover tomb files. */
export function releaseStalePoolFiles(home: string, alive: (pid: number) => boolean, nowMs: number): string[] {
  const released: string[] = [];
  for (const path of listPoolEntries(home)) {
    let old: boolean;
    try {
      old = nowMs - statSync(path).mtimeMs > UNPARSED_GRACE_MS;
    } catch {
      continue;
    }
    if (path.endsWith(".stale")) {
      if (old) {
        rmSync(path, { force: true });
        released.push(path);
      }
      continue;
    }
    try {
      if (releaseIfStale(path, alive, old)) released.push(path);
    } catch {
      // An entry that cannot be read is left for the next cleanup.
    }
  }
  return released;
}

function runLaneSpec(project: Project, lane: string): Partial<LaneSpec> {
  try {
    const value = readJson<unknown>(runPaths(project.runsRoot, lane).laneFile);
    return typeof value === "object" && value !== null ? (value as Partial<LaneSpec>) : {};
  } catch {
    return {};
  }
}

/** Marks dead shepherds' lanes orphaned and reaps an orphan's worker group when it is still the worker. */
export async function reapOrphans(ctx: CommandContext, project: Project, report: CleanupReport): Promise<void> {
  for (const lane of listLanes(project.runsRoot)) {
    let record;
    try {
      record = readState(project.runsRoot, lane);
    } catch (err) {
      report.warnings.push(`${lane}: ${(err as Error).message}`);
      continue;
    }
    if (record === null) continue;
    const state = effectiveState(record, ctx.alive);
    if (state !== "orphaned") continue;
    if (record.state !== "orphaned") {
      writeState(project.runsRoot, {
        ...record,
        state: "orphaned",
        since: isoAt(ctx.clock),
        reason: `shepherd ${record.shepherdPid} died while ${record.state}`,
      });
      report.orphaned.push(lane);
    }
    const attempt = listAttempts(project.runsRoot, lane).at(-1);
    if (attempt === undefined) continue;
    let started;
    let exited: boolean;
    try {
      const rec = readAttempt(runPaths(project.runsRoot, lane).attemptDir(attempt));
      started = rec.started;
      exited = rec.exit !== null;
    } catch (err) {
      report.warnings.push(`${lane}: ${(err as Error).message}`);
      continue;
    }
    if (started === null || exited || !Number.isInteger(started.pid) || started.pid <= 1 || !ctx.alive(started.pid)) continue;
    // A recycled pid would not be running the lane's pinned binary.
    const command = ctx.processCommand(started.pid);
    if (command === null || typeof started.binary?.path !== "string" || !command.includes(started.binary.path)) continue;
    await reap({ pgid: started.pid, pids: [], signal: ctx.signal, alive: ctx.alive, sleep: ctx.sleep, graceMs: REAP_GRACE_MS });
    report.reaped.push({ lane, pgid: started.pid });
  }
}

/** A worktree and the branch checked out in it; either may be gone already. */
interface Removable {
  path: string;
  branch: string;
  /**
   * Whether the branch goes with the worktree. Only a generated lane's and a landed integration's do: a plan phase
   * merges its dependencies' arbab/<lane> by name, and a branch costs nothing.
   */
  deleteBranch: boolean;
}

/** The repository's shared git dir, asked of the project root once and only when a worktree needs checking. */
type CommonDir = () => string;

function commonDirOf(git: GitRunner, root: string): CommonDir {
  let dir: string | undefined;
  return () => {
    dir ??= resolveGitCommonDir(git, root);
    if (dir === undefined) throw new ArbabError("git", `cannot find the git dir of ${root}`);
    return dir;
  };
}

const gitMessage = (r: { stdout: string; stderr: string }): string => (r.stderr || r.stdout).trim();

/** Why the worktree and branch must stay by git's account: changes in the tree, or a branch not merged into base. */
function unmergedOrDirty(git: GitRunner, root: string, target: Removable, hasWorktree: boolean, hasBranch: boolean, base: string, common: CommonDir): string | null {
  if (hasWorktree) {
    try {
      // A worker can rewrite the worktree's .git file, and a git that followed it would load the worker's config
      // (core.fsmonitor runs a command) on the host; status runs only through the git dir git made for the branch.
      const verified = verifyWorktreeGit({ worktree: target.path, branch: target.branch, gitCommonDir: common() });
      if (verified.gitDir === null) return `cannot verify its git dir: ${verified.error}`;
      if (worktreeStatus(target.path, verified.gitDir, git).length > 0) return "uncommitted changes";
    } catch (err) {
      return (err as Error).message;
    }
  }
  if (!hasBranch) return `no branch ${target.branch}`;
  const merged = git(["merge-base", "--is-ancestor", `refs/heads/${target.branch}`, base], root);
  if (merged.code === 1) return `branch ${target.branch} is not merged into ${base}`;
  if (merged.code !== 0) return `git merge-base --is-ancestor failed (${merged.code}): ${gitMessage(merged)}`;
  return null;
}

/**
 * Removes the worktree, then deletes its branch when `target.deleteBranch` (a branch checked out in a worktree cannot
 * be deleted), unless `blocker` gives a reason to keep them, the tree fails verification or has uncommitted changes,
 * or the branch is not merged into `base`. Nothing is forced: what git refuses is kept with git's message. Hooks are
 * off, as the tree holds worker code.
 */
function removeWorktreeAndBranch(
  git: GitRunner,
  root: string,
  target: Removable,
  base: string,
  out: WorktreeCleanup,
  blocker: () => string | null,
  common: CommonDir,
): void {
  const hasWorktree = existsSync(target.path);
  if (!hasWorktree && !target.deleteBranch) return;
  const hasBranch = branchHead(git, root, target.branch) !== null;
  if (!hasWorktree && !hasBranch) return;
  const reason = blocker() ?? unmergedOrDirty(git, root, target, hasWorktree, hasBranch, base, common);
  if (reason !== null) {
    if (hasWorktree) out.worktreesKept.push({ path: target.path, reason });
    else out.branchesKept.push({ branch: target.branch, reason });
    return;
  }
  if (hasWorktree) {
    const removed = git([...untrustedTree(), "worktree", "remove", target.path], root);
    if (removed.code !== 0) {
      out.worktreesKept.push({ path: target.path, reason: `git worktree remove failed: ${gitMessage(removed)}` });
      return;
    }
    out.worktreesRemoved.push(target.path);
  }
  if (!target.deleteBranch) return;
  // -d, not -D: git itself refuses a branch that is not merged into HEAD.
  const deleted = git([...untrustedTree(), "branch", "-d", target.branch], root);
  if (deleted.code !== 0) out.branchesKept.push({ branch: target.branch, reason: `git branch -d failed: ${gitMessage(deleted)}` });
  else out.branchesDeleted.push(target.branch);
}

/** The lane whose worktree a run works in: its own unless lane.json names another (`worktree` may name itself). */
function worktreeOwner(project: Project, lane: string): unknown {
  const spec = runLaneSpec(project, lane);
  return spec.worktree === undefined ? lane : spec.worktree;
}

/**
 * Removes each finished lane's worktree once clean and merged into `base`, and deletes arbab/<lane> too when an
 * integration generated the lane (removeWorktreeAndBranch). Kept: a lane that is not finished (an orphan's worker may
 * still run), a lane an unfinished lane borrows the worktree of, and a lane whose run dir has no readable state (it
 * may be launching). A lane that works in another lane's worktree is kept with that reason when it has a worktree or
 * a generated branch of its own.
 */
export function removeLaneWorktrees(ctx: CommandContext, project: Project, lanes: string[], base: string, out: WorktreeCleanup): void {
  const states = new Map<string, LaneState>();
  const unreadable = new Map<string, string>();
  const all = listLanes(project.runsRoot);
  for (const lane of all) {
    try {
      const record = readState(project.runsRoot, lane);
      if (record !== null) states.set(lane, effectiveState(record, ctx.alive));
    } catch (err) {
      unreadable.set(lane, (err as Error).message);
    }
  }
  const borrowed = new Map<string, string>();
  for (const lane of all) {
    const state = states.get(lane);
    const owner = worktreeOwner(project, lane);
    if (state !== undefined && state !== "finished" && typeof owner === "string" && owner !== lane) borrowed.set(owner, lane);
  }
  const common = commonDirOf(ctx.git, project.root);
  for (const lane of new Set(lanes)) {
    if (!isValidName(lane)) {
      out.warnings.push(`${JSON.stringify(lane)} is not a valid lane name`);
      continue;
    }
    try {
      const target: Removable = {
        path: join(project.worktreeRoot, lane),
        branch: `arbab/${lane}`,
        deleteBranch: readGenerated(project.runsRoot, lane) !== null,
      };
      const owner = worktreeOwner(project, lane);
      if (owner !== lane) {
        const where = typeof owner === "string" && isValidName(owner) ? `lane ${owner}'s worktree` : `worktree ${JSON.stringify(owner)}`;
        const reason = `lane ${lane} works in ${where}`;
        if (existsSync(target.path)) out.worktreesKept.push({ path: target.path, reason });
        else if (target.deleteBranch && branchHead(ctx.git, project.root, target.branch) !== null) out.branchesKept.push({ branch: target.branch, reason });
        continue;
      }
      const blocker = (): string | null => {
        const state = states.get(lane);
        if (state === undefined) {
          const error = unreadable.get(lane);
          if (error !== undefined) return error;
          return existsSync(runPaths(project.runsRoot, lane).laneDir) ? "no run state" : null;
        }
        if (isActive(state)) return `lane ${lane} is ${state}`;
        if (state === "orphaned") return "orphaned: run arbab cleanup first";
        const user = borrowed.get(lane);
        return user === undefined ? null : `in use by lane ${user}`;
      };
      removeWorktreeAndBranch(ctx.git, project.root, target, base, out, blocker, common);
    } catch (err) {
      out.warnings.push(`${lane}: ${(err as Error).message}`);
    }
  }
}

/** Removes the integration worktree and deletes integrate/<name> once merged into `base`, by a lane's git rules. */
export function removeIntegrationWorktree(ctx: CommandContext, project: Project, paths: IntegrationPaths, base: string, out: WorktreeCleanup): void {
  try {
    const target: Removable = { path: paths.worktree, branch: paths.branch, deleteBranch: true };
    removeWorktreeAndBranch(ctx.git, project.root, target, base, out, () => null, commonDirOf(ctx.git, project.root));
  } catch (err) {
    out.warnings.push(`integration ${paths.name}: ${(err as Error).message}`);
  }
}

/** The integrations whose landing.json exists; their records stay, only the worktree and branch go. */
export function removeLandedIntegrations(ctx: CommandContext, project: Project, out: WorktreeCleanup): void {
  for (const name of listIntegrations(project.root)) {
    try {
      const paths = integrationPaths(project.root, project.config, name);
      if (!existsSync(paths.landing)) continue;
      const record = readIntegration(paths);
      if (record === null) {
        out.warnings.push(`integration ${name} landed but has no integration.json`);
        continue;
      }
      removeIntegrationWorktree(ctx, project, paths, record.base, out);
    } catch (err) {
      out.warnings.push(`integration ${name}: ${(err as Error).message}`);
    }
  }
}

/**
 * The worktrees of finished lanes (and generated lanes' branches), then landed integrations. A run dir without state.json
 * is reported as kept; other unfinished lanes are left alone.
 */
export function removeMergedWorktrees(ctx: CommandContext, project: Project, report: CleanupReport): void {
  const lanes = listLanes(project.runsRoot).filter((lane) => {
    try {
      const record = readState(project.runsRoot, lane);
      return record === null || effectiveState(record, ctx.alive) === "finished";
    } catch {
      // Unreadable state: reapOrphans warns about it.
      return false;
    }
  });
  removeLaneWorktrees(ctx, project, lanes, project.config.baseBranch, report);
  removeLandedIntegrations(ctx, project, report);
}

export const emptyWorktreeCleanup = (): WorktreeCleanup => ({
  worktreesRemoved: [],
  branchesDeleted: [],
  worktreesKept: [],
  branchesKept: [],
  warnings: [],
});

/** One line per removal, refusal and warning; none when nothing happened. */
export function formatWorktreeCleanup(c: WorktreeCleanup): string[] {
  return [
    ...c.worktreesRemoved.map((path) => `removed worktree ${path}`),
    ...c.branchesDeleted.map((branch) => `deleted branch ${branch}`),
    ...c.worktreesKept.map((k) => `kept worktree ${k.path}: ${k.reason}`),
    ...c.branchesKept.map((k) => `kept branch ${k.branch}: ${k.reason}`),
    ...c.warnings.map((w) => `warning ${w}`),
  ];
}

export function formatCleanup(report: CleanupReport): string {
  const lines = [
    ...report.orphaned.map((lane) => `orphaned ${lane}`),
    ...report.reaped.map((r) => `reaped ${r.lane} pgid ${r.pgid}`),
    ...report.released.map((path) => `released ${path}`),
    ...formatWorktreeCleanup(report),
  ];
  return lines.length === 0 ? "nothing to clean" : lines.join("\n");
}

export async function runCleanup(argv: string[], ctx: CommandContext): Promise<number> {
  const { values } = parse("cleanup", {
    args: argv,
    options: { worktrees: { type: "boolean" }, json: { type: "boolean" } },
    allowPositionals: false,
  });
  const project = openProject(ctx);
  const report: CleanupReport = { orphaned: [], reaped: [], released: [], ...emptyWorktreeCleanup() };
  await reapOrphans(ctx, project, report);
  report.released = releaseStalePoolFiles(ctx.home, ctx.alive, ctx.clock.now());
  if (values.worktrees === true) removeMergedWorktrees(ctx, project, report);
  if (values.json === true) printJson(ctx, report);
  else ctx.stdout(formatCleanup(report) + "\n");
  return 0;
}
