// arbab cleanup [--worktrees [--older-than <days>]] [--mine] [--json]
//
// Marks lanes whose shepherd died orphaned and reaps their worker; removes pool entries (slots, semaphores, leases,
// writer locks) whose holder is dead, then the empty directories under <home>/locks/; with --worktrees, removes the
// worktrees of finished lanes that are clean and merged into baseBranch or landed by record (a landing.json lists the
// lane, and its branch head is that sha or an ancestor of it), then the worktree and branch of every landed
// integration. --older-than also removes a finished lane's clean, unborrowed worktree whose state is older than that
// many days, keeping its branch. --mine touches only the lanes this session owns (ownerless runs are not its own).
// Of lane branches only generated lanes' go: a later plan phase merges an earlier one's arbab/<lane> by name. The
// same rules (removeLaneWorktrees) serve `arbab land`, which cleans up what it landed.
// Text: one line per action (`orphaned <lane>`, `reaped <lane> pgid <n>`, `released <file>`,
// `removed <n> empty lock directories`, `removed worktree <path>: <reason>`, `deleted branch <branch>`,
// `kept worktree <path>: <reason>`, `kept branch <branch>: <reason>`), or `nothing to clean`.
// --json: {"orphaned": string[], "reaped": [{"lane", "pgid"}], "released": string[], "worktreesRemoved": string[],
//          "branchesDeleted": string[], "worktreesKept": [{"path", "reason"}], "branchesKept": [{"branch", "reason"}],
//          "warnings": string[], "worktreeRemovals": [{"path", "reason"}], "lockDirsRemoved": number}
import { existsSync, readdirSync, rmdirSync, rmSync, statSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { INTEGRATION_WORKTREE_PREFIX } from "../config/lane";
import { integrationPaths, listIntegrations, readIntegration, type IntegrationPaths } from "../integrate";
import { effectiveState, listAttempts, listLanes, ownedBy, readAttempt, readShepherdRecord, readState, runPaths, sessionOf, writeState } from "../registry";
import { listPoolEntries, reap, releaseIfStale, untrustedTree, verifyWorktreeGit, WORKER_TMP_DIR, worktreeStatus, type GitRunner } from "../run";
import type { LaneSpec, LaneState, LaneStateRecord } from "../types";
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
  /** Why each of worktreesRemoved went, in its order. */
  worktreeRemovals: Array<{ path: string; reason: string }>;
  lockDirsRemoved: number;
}

/** What `cleanup --worktrees` adds to the rules land shares; land passes none. */
export interface LaneCleanupOptions {
  /** --older-than: a finished lane's clean, unborrowed worktree whose last state change is older goes, its branch kept. */
  olderThanMs?: number;
  /** Receives why each worktree went. */
  removals?: Array<{ path: string; reason: string }>;
}

const DAY_MS = 86_400_000;

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

/** Removes the empty directories under <home>/locks/ and returns how many went; a non-empty or vanished one stays. */
export function removeEmptyLockDirs(home: string): number {
  const root = join(home, "locks");
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      // rmdir, never recursive: it refuses a directory a writer has put an entry in.
      rmdirSync(join(root, entry.name));
      removed++;
    } catch {
      // Not empty, or gone already.
    }
  }
  return removed;
}

function runLaneSpec(project: Project, lane: string): Partial<LaneSpec> {
  try {
    const value = readJson<unknown>(runPaths(project.runsRoot, lane).laneFile);
    return typeof value === "object" && value !== null ? (value as Partial<LaneSpec>) : {};
  } catch {
    return {};
  }
}

/**
 * Marks dead shepherds' lanes orphaned and reaps an orphan's worker group when it is still the worker. Only the lanes
 * `include` accepts (--mine).
 */
export async function reapOrphans(ctx: CommandContext, project: Project, report: CleanupReport, include: (lane: string) => boolean = () => true): Promise<void> {
  for (const lane of listLanes(project.runsRoot).filter(include)) {
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

/** A landing that carried a branch: the integration and the commit it integrated last. */
interface Landed {
  integration: string;
  sha: string;
}

/** What decides a target besides the tree's state. */
interface Rules {
  base: string;
  /** The branch counts as landed when its head is one of these commits or an ancestor of one. */
  landed: Landed[];
  /** Set when the clean worktree of an unmerged branch may go anyway (--older-than): the reason given. */
  stale: string | null;
  removals: Array<{ path: string; reason: string }> | undefined;
}

const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** The lanes landing records list, each with the landings that carried it. A record that does not read vouches for nothing. */
function landedLanes(project: Project): Map<string, Landed[]> {
  const out = new Map<string, Landed[]>();
  for (const name of listIntegrations(project.root)) {
    let raw: unknown;
    try {
      raw = readJson<unknown>(integrationPaths(project.root, project.config, name).landing);
    } catch {
      continue;
    }
    if (typeof raw !== "object" || raw === null) continue;
    const lanes = (raw as Record<string, unknown>)["lanes"];
    if (!Array.isArray(lanes)) continue;
    for (const entry of lanes as unknown[]) {
      if (typeof entry !== "object" || entry === null) continue;
      const { lane, sha } = entry as Record<string, unknown>;
      if (typeof lane !== "string" || !isValidName(lane) || typeof sha !== "string" || !SHA.test(sha)) continue;
      out.set(lane, [...(out.get(lane) ?? []), { integration: name, sha }]);
    }
  }
  return out;
}

/** The head a landing record says the integration landed at, so a squash landing's integration worktree can go too. */
function landedIntegration(paths: IntegrationPaths): Landed[] {
  try {
    const raw = readJson<unknown>(paths.landing);
    const head = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>)["integrationHead"] : undefined;
    return typeof head === "string" && SHA.test(head) ? [{ integration: paths.name, sha: head }] : [];
  } catch {
    return [];
  }
}

type Verdict = { keep: string } | { remove: string; deleteBranch: boolean };

/**
 * Whether the worktree and branch may go by git's account. Kept: changes in the tree (untracked files under
 * .arbab-tmp/ aside), or a branch neither merged into base nor landed by record, unless `rules.stale` lets its clean
 * worktree go. Only a branch merged into base may be deleted: `branch -d` would refuse the others.
 */
function judge(git: GitRunner, root: string, target: Removable, hasWorktree: boolean, hasBranch: boolean, rules: Rules, common: CommonDir): Verdict {
  if (hasWorktree) {
    try {
      // A worker can rewrite the worktree's .git file, and a git that followed it would load the worker's config
      // (core.fsmonitor runs a command) on the host; status runs only through the git dir git made for the branch.
      const verified = verifyWorktreeGit({ worktree: target.path, branch: target.branch, gitCommonDir: common() });
      if (verified.gitDir === null) return { keep: `cannot verify its git dir: ${verified.error}` };
      const changes = worktreeStatus(target.path, verified.gitDir, git).filter((line) => !line.startsWith(`?? ${WORKER_TMP_DIR}/`));
      if (changes.length > 0) return { keep: "uncommitted changes" };
    } catch (err) {
      return { keep: (err as Error).message };
    }
  }
  if (!hasBranch) return { keep: `no branch ${target.branch}` };
  const ref = `refs/heads/${target.branch}`;
  const merged = git(["merge-base", "--is-ancestor", ref, rules.base], root);
  if (merged.code === 0) return { remove: `merged into ${rules.base}`, deleteBranch: true };
  if (merged.code !== 1) return { keep: `git merge-base --is-ancestor failed (${merged.code}): ${gitMessage(merged)}` };
  // A squash landing or a reshaped base leaves the branch off the base; the landing record still names what it carried.
  for (const landing of rules.landed) {
    if (git(["merge-base", "--is-ancestor", ref, landing.sha], root).code === 0) {
      return { remove: `landed by integration ${landing.integration}`, deleteBranch: false };
    }
  }
  if (rules.stale !== null && hasWorktree) return { remove: rules.stale, deleteBranch: false };
  return { keep: `branch ${target.branch} is not merged into ${rules.base}` };
}

/**
 * Removes the worktree, then deletes its branch when `target.deleteBranch` (a branch checked out in a worktree cannot
 * be deleted) and the branch is merged into the base, unless `blocker` gives a reason to keep them or `judge` does.
 * Nothing is forced: what git refuses is kept with git's message. Hooks are off, as the tree holds worker code.
 */
function removeWorktreeAndBranch(
  git: GitRunner,
  root: string,
  target: Removable,
  rules: Rules,
  out: WorktreeCleanup,
  blocker: () => string | null,
  common: CommonDir,
): void {
  const hasWorktree = existsSync(target.path);
  if (!hasWorktree && !target.deleteBranch) return;
  const hasBranch = branchHead(git, root, target.branch) !== null;
  if (!hasWorktree && !hasBranch) return;
  const blocked = blocker();
  const verdict = blocked === null ? judge(git, root, target, hasWorktree, hasBranch, rules, common) : { keep: blocked };
  if ("keep" in verdict) {
    if (hasWorktree) out.worktreesKept.push({ path: target.path, reason: verdict.keep });
    else out.branchesKept.push({ branch: target.branch, reason: verdict.keep });
    return;
  }
  if (hasWorktree) {
    const removed = git([...untrustedTree(), "worktree", "remove", target.path], root);
    if (removed.code !== 0) {
      out.worktreesKept.push({ path: target.path, reason: `git worktree remove failed: ${gitMessage(removed)}` });
      return;
    }
    out.worktreesRemoved.push(target.path);
    rules.removals?.push({ path: target.path, reason: verdict.remove });
  }
  if (!target.deleteBranch || !verdict.deleteBranch) return;
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
 * Removes each finished lane's worktree once clean and merged into `base` or landed by record, and deletes
 * arbab/<lane> too when an integration generated the lane and it is merged into `base` (removeWorktreeAndBranch).
 * With `opts.olderThanMs`, a finished lane's clean worktree whose last state change is older goes too, its branch
 * kept. Kept: a lane that is not finished (an orphan's worker may still run), a lane an unfinished lane borrows the
 * worktree of, and a lane whose run dir has no readable state (it may be launching). A lane that works in another
 * lane's worktree is kept with that reason when it has a worktree or a generated branch of its own.
 */
export function removeLaneWorktrees(ctx: CommandContext, project: Project, lanes: string[], base: string, out: WorktreeCleanup, opts: LaneCleanupOptions = {}): void {
  const states = new Map<string, LaneState>();
  const records = new Map<string, LaneStateRecord>();
  const unreadable = new Map<string, string>();
  const all = listLanes(project.runsRoot);
  for (const lane of all) {
    try {
      const record = readState(project.runsRoot, lane);
      if (record === null) continue;
      states.set(lane, effectiveState(record, ctx.alive));
      records.set(lane, record);
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
  const landed = landedLanes(project);
  const nowMs = ctx.clock.now();
  const stale = (lane: string, branch: string): string | null => {
    const record = records.get(lane);
    if (opts.olderThanMs === undefined || record === undefined || states.get(lane) !== "finished") return null;
    // An integration's worktree is the landing's to remove, by its own rules.
    if (lane.startsWith(INTEGRATION_WORKTREE_PREFIX)) return null;
    const age = nowMs - Date.parse(record.since);
    // An unparsable `since` gives NaN, which is never older.
    if (!(age > opts.olderThanMs)) return null;
    return `unchanged for ${Math.floor(age / DAY_MS)} days; branch ${branch} kept`;
  };
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
      const rules: Rules = { base, landed: landed.get(lane) ?? [], stale: stale(lane, target.branch), removals: opts.removals };
      removeWorktreeAndBranch(ctx.git, project.root, target, rules, out, blocker, common);
    } catch (err) {
      out.warnings.push(`${lane}: ${(err as Error).message}`);
    }
  }
}

/**
 * Removes the integration worktree and deletes integrate/<name> once merged into `base`, by a lane's git rules. A
 * branch whose head the landing record names as landed (a squash landing) loses its worktree and keeps the branch.
 */
export function removeIntegrationWorktree(
  ctx: CommandContext,
  project: Project,
  paths: IntegrationPaths,
  base: string,
  out: WorktreeCleanup,
  opts: Pick<LaneCleanupOptions, "removals"> = {},
): void {
  try {
    const target: Removable = { path: paths.worktree, branch: paths.branch, deleteBranch: true };
    const rules: Rules = { base, landed: landedIntegration(paths), stale: null, removals: opts.removals };
    removeWorktreeAndBranch(ctx.git, project.root, target, rules, out, () => null, commonDirOf(ctx.git, project.root));
  } catch (err) {
    out.warnings.push(`integration ${paths.name}: ${(err as Error).message}`);
  }
}

/** The integrations whose landing.json exists; their records stay, only the worktree and branch go. */
export function removeLandedIntegrations(ctx: CommandContext, project: Project, out: WorktreeCleanup, opts: Pick<LaneCleanupOptions, "removals"> = {}): void {
  for (const name of listIntegrations(project.root)) {
    try {
      const paths = integrationPaths(project.root, project.config, name);
      if (!existsSync(paths.landing)) continue;
      const record = readIntegration(paths);
      if (record === null) {
        out.warnings.push(`integration ${name} landed but has no integration.json`);
        continue;
      }
      removeIntegrationWorktree(ctx, project, paths, record.base, out, opts);
    } catch (err) {
      out.warnings.push(`integration ${name}: ${(err as Error).message}`);
    }
  }
}

/**
 * The worktrees of finished lanes (and generated lanes' branches), then landed integrations. A run dir without state.json
 * is reported as kept; other unfinished lanes are left alone. With `include` (--mine) only the lanes it accepts are
 * considered, and no integration: an integration has no owner.
 */
export function removeMergedWorktrees(
  ctx: CommandContext,
  project: Project,
  report: CleanupReport,
  opts: { olderThanMs?: number; include?: (lane: string) => boolean } = {},
): void {
  const { include } = opts;
  const lanes = listLanes(project.runsRoot).filter((lane) => {
    if (include !== undefined && !include(lane)) return false;
    try {
      const record = readState(project.runsRoot, lane);
      return record === null || effectiveState(record, ctx.alive) === "finished";
    } catch {
      // Unreadable state: reapOrphans warns about it.
      return false;
    }
  });
  const removals = report.worktreeRemovals;
  removeLaneWorktrees(ctx, project, lanes, project.config.baseBranch, report, { olderThanMs: opts.olderThanMs, removals });
  if (include === undefined) removeLandedIntegrations(ctx, project, report, { removals });
}

export const emptyWorktreeCleanup = (): WorktreeCleanup => ({
  worktreesRemoved: [],
  branchesDeleted: [],
  worktreesKept: [],
  branchesKept: [],
  warnings: [],
});

/** One line per removal, refusal and warning; none when nothing happened. A removal in `removals` carries its reason. */
export function formatWorktreeCleanup(c: WorktreeCleanup, removals: Array<{ path: string; reason: string }> = []): string[] {
  const why = new Map(removals.map((r) => [r.path, r.reason]));
  return [
    ...c.worktreesRemoved.map((path) => {
      const reason = why.get(path);
      return reason === undefined ? `removed worktree ${path}` : `removed worktree ${path}: ${reason}`;
    }),
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
    ...(report.lockDirsRemoved > 0 ? [`removed ${report.lockDirsRemoved} empty lock ${report.lockDirsRemoved === 1 ? "directory" : "directories"}`] : []),
    ...formatWorktreeCleanup(report, report.worktreeRemovals),
  ];
  return lines.length === 0 ? "nothing to clean" : lines.join("\n");
}

/** --older-than's days as milliseconds. */
function olderThanMs(value: string): number {
  const ms = Number(value) * DAY_MS;
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(ms)) {
    throw new ArbabError("usage", `--older-than takes a positive whole number of days, not ${JSON.stringify(value)} (see arbab cleanup --help)`);
  }
  return ms;
}

export async function runCleanup(argv: string[], ctx: CommandContext): Promise<number> {
  const { values } = parse("cleanup", {
    args: argv,
    options: { worktrees: { type: "boolean" }, "older-than": { type: "string" }, mine: { type: "boolean" }, json: { type: "boolean" } },
    allowPositionals: false,
  });
  const days = values["older-than"];
  if (days !== undefined && values.worktrees !== true) throw new ArbabError("usage", "--older-than needs --worktrees (see arbab cleanup --help)");
  const ageMs = days === undefined ? undefined : olderThanMs(days);
  const project = openProject(ctx);
  // Cleanup removes things, so a run without an owner is nobody's here. Outside Claude Code (no session) everything is
  // the caller's, as ownedBy has it, integrations included.
  const session = sessionOf(ctx.hostEnv);
  const include =
    values.mine === true && session !== null ? (lane: string) => ownedBy(readShepherdRecord(project.runsRoot, lane), session, { ownerless: false }) : undefined;
  const report: CleanupReport = { orphaned: [], reaped: [], released: [], ...emptyWorktreeCleanup(), worktreeRemovals: [], lockDirsRemoved: 0 };
  await reapOrphans(ctx, project, report, include);
  report.released = releaseStalePoolFiles(ctx.home, ctx.alive, ctx.clock.now());
  // After the release: a dead holder's entry was what kept its directory.
  report.lockDirsRemoved = removeEmptyLockDirs(ctx.home);
  if (values.worktrees === true) removeMergedWorktrees(ctx, project, report, { olderThanMs: ageMs, include });
  if (values.json === true) printJson(ctx, report);
  else ctx.stdout(formatCleanup(report) + "\n");
  return 0;
}
