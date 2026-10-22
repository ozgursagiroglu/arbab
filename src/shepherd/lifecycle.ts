import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { effectiveRole, loadConfig, loadLane } from "../config";
import { holdDecision, lastQuotaReset, readQuota, resumeAt } from "../quota";
import { listAttempts, runPaths, writeState } from "../registry";
import {
  acquireLeases,
  acquireSemaphore,
  acquireSlot,
  acquireWriterLock,
  arbabIgnoreEntries,
  createWorktree,
  discardWorktree,
  ensureArbabMarkers,
  ensureIgnored,
  ensureWorkerTmp,
  prepareDependencies,
  releaseLeases,
  releaseSemaphore,
  releaseSlot,
  releaseWriterLock,
  writerLockKey,
  type Holder,
} from "../run";
import type {
  EndState,
  LaneSpec,
  LaneState,
  LaneStateRecord,
  Lease,
  ProjectConfig,
  RateLimitSnapshot,
} from "../types";
import { NO_FREE_SLOT_REASON } from "../types";
import { ArbabError } from "../util/errors";
import { confine, writeJsonAtomic } from "../util/fs";
import { assertValidName } from "../util/names";
import { isoAt } from "../util/proc";
import { runAttempt, worktreeUsedFile, type AttemptRequest } from "./attempt";
import type { ShepherdDeps, ShepherdMode } from "./index";
import { mergeBranches, type MergedBranch } from "./merge";
import { digestHeadStart, resumePrompt } from "./prompt";
import { confirmedHeads, installPlan, isTrustedInstallPoint, resolveCommit, type InstallPlan, type TrustInput } from "./trust";

/** Thrown out of any wait once the stop signal has aborted. */
class Stopped extends Error {}

/** A window at or above this utilization is the one that stopped the worker. */
const FULL = 0.99;
const FALLBACK_RESET_SEC = 15 * 60;

/**
 * When a usage-limited lane may resume: the latest reset among the windows at utilization ≥ 0.99, or now + 15 min
 * when no window says so. A full window whose reset has already passed resumes without waiting for the fallback
 * (DESIGN.md §2: resetsAt + 60–120 s).
 */
export function usageLimitResetsAt(snapshot: RateLimitSnapshot | null, nowSec: number): number {
  const full = [snapshot?.fiveHour, snapshot?.sevenDay].filter(
    (w): w is NonNullable<typeof w> => w != null && w.utilization >= FULL,
  );
  return full.length > 0 ? Math.max(...full.map((w) => w.resetsAt)) : nowSec + FALLBACK_RESET_SEC;
}

/**
 * Whether a lane waiting for a usage-limit reset may resume early: `arbab quota --reset` ran after the attempt that
 * hit the limit began, so the human switched accounts (possibly while that attempt was still finishing) and the old
 * account's resetsAt says nothing about the new one. A snapshot cannot say so: it carries only the five-hour and
 * seven-day windows, and another lane's events look fine while this lane's own limit (seven_day_opus, say) still
 * holds. A reset before the attempt began is one the attempt already ran under.
 */
export function resetSince(lastReset: number | null, attemptBeganMs: number): boolean {
  return lastReset !== null && lastReset > attemptBeganMs;
}

/** The info/exclude entries the shepherd adds: arbab's own (src/run/project-files.ts). */
export const ignoreEntries = arbabIgnoreEntries;

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** What a lane holds machine-wide, released together when the lane finishes. */
interface Held {
  slot: number | null;
  leases: Lease[];
  semaphores: Array<{ name: string; slot: number }>;
  lockKey: string | null;
}

function releaseAll(home: string, held: Held, holder: Holder): void {
  const quietly = (fn: () => unknown): void => {
    try {
      fn();
    } catch {
      // A failed release leaves a stale entry, which the next acquirer reclaims once our pid is gone.
    }
  };
  if (held.lockKey !== null) {
    const key = held.lockKey;
    quietly(() => releaseWriterLock(home, key, holder));
  }
  for (const s of held.semaphores) quietly(() => releaseSemaphore(home, s.name, s.slot, holder));
  quietly(() => releaseLeases(home, held.leases, holder));
  if (held.slot !== null) {
    const slot = held.slot;
    quietly(() => releaseSlot(home, slot, holder));
  }
}

export async function runShepherd(
  projectRoot: string,
  laneName: string,
  mode: ShepherdMode,
  deps: ShepherdDeps,
  stop: AbortSignal,
): Promise<EndState> {
  assertValidName(laneName, "lane");
  const root = resolve(projectRoot);
  const config = loadConfig(root);
  const runsRoot = confine(root, config.runsRoot);
  const paths = runPaths(runsRoot, laneName);
  const pid = process.pid;
  writeJsonAtomic(paths.shepherdFile, { pid, startedAt: isoAt(deps.clock) });

  // The attempt this run made last; 0 until it makes one, so a run that fails in setup is not pinned on an attempt
  // of an earlier run (arbab wait reports the run, with its attempt only when it has one).
  let attempt = 0;
  let current: { state: LaneState; since: string } | null = null;
  const setState = (state: LaneState, extra: Pick<LaneStateRecord, "reason" | "until" | "endState"> = {}): void => {
    // `since` marks when the state began, so a poll that rewrites the same state keeps it.
    const next = current !== null && current.state === state ? current : { state, since: isoAt(deps.clock) };
    current = next;
    writeState(runsRoot, { lane: laneName, state, attempt, since: next.since, shepherdPid: pid, ...extra });
  };

  const pause = (ms: number): Promise<void> =>
    new Promise((done) => {
      if (stop.aborted) return done();
      const onAbort = (): void => done();
      stop.addEventListener("abort", onAbort, { once: true });
      void deps.sleep(Math.max(0, ms)).then(() => {
        stop.removeEventListener("abort", onAbort);
        done();
      });
    });
  const checkStop = (): void => {
    if (stop.aborted) throw new Stopped();
  };
  const nowSec = (): number => Math.floor(deps.clock.now() / 1000);

  const holder: Holder = { pid, lane: laneName, project: root, createdAt: isoAt(deps.clock) };
  const held: Held = { slot: null, leases: [], semaphores: [], lockKey: null };

  const awaitQuota = async (): Promise<void> => {
    for (;;) {
      checkStop();
      const decision = holdDecision(readQuota(deps.home), config.quota.holdAbove, nowSec());
      if (!decision.hold) return;
      setState("held", { reason: decision.reason ?? "quota", ...(decision.until === null ? {} : { until: decision.until }) });
      const untilMs = decision.until === null ? Infinity : decision.until * 1000 - deps.clock.now();
      await pause(Math.min(untilMs, deps.holdPollMs));
    }
  };

  let endState: EndState;
  let reason: string | undefined;
  try {
    setState("queued");
    const lane = loadLane(root, paths.laneFile);
    if (lane.name !== laneName) throw new ArbabError("usage", `${paths.laneFile} names lane ${lane.name}, not ${laneName}`);
    const role = effectiveRole(config, lane);
    // Read before anything is held, so a bad prompt file or digest source fails the run at once.
    const resumeText = mode.kind === "resume" ? resumePrompt(paths.laneDir, mode) : null;
    const seed = mode.kind === "fresh" && mode.digestFrom !== undefined ? digestHeadStart(runsRoot, laneName, mode.digestFrom) : null;

    for (;;) {
      checkStop();
      held.slot = acquireSlot(deps.home, config.maxParallel, holder, deps.alive);
      if (held.slot !== null) break;
      setState("held", { reason: NO_FREE_SLOT_REASON });
      await pause(deps.slotPollMs);
    }
    await awaitQuota();

    setState("preparing");
    const prepared = await prepare(root, config, lane, deps, holder, held, async (why) => {
      checkStop();
      setState("preparing", { reason: why });
      await pause(deps.slotPollMs);
    });

    let request: AttemptRequest = resumeText === null ? { kind: mode.kind } : { kind: "resume", prompt: resumeText };
    if (seed !== null) request.headStart = seed;
    // The merges happened once, before this run's first attempt; that attempt records them.
    if (prepared.merged.length > 0) request.merged = prepared.merged;
    // maxAttempts bounds this run's auto-resumes, not the lane's history: a manual resume starts the count again.
    let made = 0;
    for (;;) {
      checkStop();
      const attemptBegan = deps.clock.now();
      const outcome = await runAttempt(
        {
          projectRoot: root,
          runsRoot,
          config,
          lane,
          role,
          fence: lane.fence ?? "strict",
          worktree: prepared.worktree,
          branch: prepared.branch,
          gitCommonDir: prepared.gitCommonDir,
          leases: held.leases,
          deps,
          stop,
          pause,
          onStarted: (n) => {
            attempt = n;
            setState("running");
          },
        },
        request,
      );
      if (outcome.n > 0) made += 1;
      checkStop();
      if (outcome.state !== "usage-limit" || !role.autoResume || made >= role.maxAttempts) {
        endState = outcome.state;
        break;
      }

      const resetsAt = usageLimitResetsAt(outcome.rateLimit ?? readQuota(deps.home), nowSec());
      const jitter = Math.min(60, Math.max(0, deps.random() * 60));
      const until = Math.ceil(resumeAt(resetsAt, jitter));
      setState("waiting-reset", { reason: "usage limit", until });
      // Re-read every poll: an account switch can lift the limit long before the old account's reset.
      while (deps.clock.now() < until * 1000) {
        checkStop();
        await pause(Math.min(until * 1000 - deps.clock.now(), deps.holdPollMs));
        checkStop();
        if (resetSince(lastQuotaReset(deps.home), attemptBegan)) break;
      }
      await awaitQuota();
      request = { kind: "resume" };
    }
  } catch (err) {
    if (err instanceof Stopped || stop.aborted) {
      endState = "killed:stopped";
    } else {
      endState = "failed";
      reason = message(err);
    }
  } finally {
    releaseAll(deps.home, held, holder);
  }
  if (stop.aborted) endState = "killed:stopped";
  setState("finished", { endState, ...(reason === undefined ? {} : { reason }) });
  return endState;
}

/**
 * The worktree, its dependencies and the lane's machine-wide resources (DESIGN.md §9). `wait` is called, with what
 * the lane waits for, while a semaphore or the writer lock is taken.
 *
 * The dependency command runs unsandboxed, so it runs only in a worktree no worker has run in yet (created now; one a
 * setup failure left before any attempt is removed and created again), holding the writer lock, on a trusted commit
 * (installPlan), and before the merges: the lane's base and merge branches may be worker-written, and an install runs
 * any file of the tree (package.json scripts and the files they run, .npmrc, .pnpmfile.cjs). A base that is not
 * trusted is merged first. A branch that changes a manifest is refused (mergeBranches), so the merged tree installs the
 * same as the install point. A used worktree (resume, fresh, a verifier borrowing it) is neither merged nor installed
 * again, nor removed.
 */
async function prepare(
  root: string,
  config: ProjectConfig,
  lane: LaneSpec,
  deps: ShepherdDeps,
  holder: Holder,
  held: Held,
  wait: (why: string) => Promise<void>,
): Promise<{ worktree: string; branch: string; gitCommonDir: string; merged: MergedBranch[] }> {
  ensureIgnored(root, arbabIgnoreEntries(root, config), deps.git);
  ensureArbabMarkers(root);

  const owner = lane.worktree ?? lane.name;
  if (owner !== lane.name && !existsSync(join(confine(root, config.worktreeRoot), owner))) {
    throw new ArbabError("usage", `lane ${lane.name} works in lane ${owner}'s worktree, which does not exist`);
  }
  // The lane's base can be a worker's branch (an integration, another lane), so a new worktree starts on a trusted
  // commit and the base is merged after the install. Resolved only when needed: a reused worktree keeps its base.
  const base = lane.base ?? config.baseBranch;
  let trust: TrustInput | null = null;
  const trusted = (): TrustInput =>
    (trust ??= { projectRoot: root, baseBranch: config.baseBranch, confirmed: confirmedHeads(root, config, deps.git), git: deps.git });
  let plan: InstallPlan | null = null;
  const planned = (): InstallPlan => (plan ??= installPlan(base, trusted()));
  const worktreeInput = {
    projectRoot: root,
    root: config.worktreeRoot,
    lane: owner,
    base: () => planned().start,
    trustedBase: config.baseBranch,
    git: deps.git,
  };
  // Created, checked and prepared under the worktree's writer lock, so no other lane's setup or worker can change the
  // tree between its creation and the decision below. The lock is keyed by the worktree's real path, known before the
  // worktree exists: its root is real, and its name is a lane name, never a link.
  const worktreeRoot = confine(root, config.worktreeRoot);
  mkdirSync(worktreeRoot, { recursive: true });
  const worktree = join(realpathSync(worktreeRoot), owner);

  held.leases = await acquireLeases({
    home: deps.home,
    requests: lane.resources ?? {},
    ranges: config.resources,
    holder,
    alive: deps.alive,
    probePort: deps.probePort,
  });

  for (const name of lane.semaphores ?? []) {
    if (!Object.hasOwn(config.semaphores, name)) throw new ArbabError("config", `semaphore ${name} is not configured`);
    const capacity = config.semaphores[name] as number;
    for (;;) {
      const slot = acquireSemaphore(deps.home, name, capacity, holder, deps.alive);
      if (slot !== null) {
        held.semaphores.push({ name, slot });
        break;
      }
      await wait(`waiting for semaphore ${name}`);
    }
  }

  // Semaphores before the lock, in every lane, so two lanes never wait on each other.
  const key = writerLockKey(worktree);
  while (!acquireWriterLock(deps.home, key, holder, deps.alive)) await wait("waiting for the writer lock");
  held.lockKey = key;
  let wt = createWorktree(worktreeInput);
  if (realpathSync(wt.path) !== worktree) throw new ArbabError("git", `${wt.path} is not the worktree ${worktree}`);

  let merged: MergedBranch[] = [];
  // A worktree no worker has run in yet (created now, or left behind by a setup failure before any attempt) holds
  // nothing of the lane's own, so the shepherd prepares it, merges included. Decided under the writer lock, which the
  // worktree was also created under: an attempt marks the worktree used before it starts, whichever lane runs it. The
  // owner's attempts also count, for runs recorded before the marker existed. A used worktree is never removed.
  const runsRoot = confine(root, config.runsRoot);
  const pristine = wt.created || (!existsSync(worktreeUsedFile(runsRoot, owner)) && listAttempts(runsRoot, owner).length === 0);
  if (pristine && owner !== lane.name) {
    // The owner's setup never finished: preparing it here would follow this lane's base and merges, not the owner's.
    throw new ArbabError("usage", `lane ${lane.name} works in lane ${owner}'s worktree, where no attempt has run yet; launch ${owner} first`);
  }
  if (pristine && !wt.created) {
    // A left-behind worktree is built again rather than reused: it sits where an older plan put it (the base may have
    // been confirmed since, and the plan would skip the base merge). discardWorktree removes it only when it holds
    // nothing arbab could not rebuild; files a merge left uncommitted, or a hand-made commit, refuse the launch.
    const sources = [config.baseBranch, base, ...(lane.mergeBranches ?? [])].flatMap((rev) => {
      try {
        return [resolveCommit(root, rev, deps.git)].filter((sha): sha is string => sha !== null);
      } catch {
        // Not a revision: it vouches for no commit.
        return [];
      }
    });
    discardWorktree({ projectRoot: root, root: config.worktreeRoot, lane: owner, sources, gitCommonDir: wt.gitCommonDir, git: deps.git });
    wt = createWorktree(worktreeInput);
    if (realpathSync(wt.path) !== worktree) throw new ArbabError("git", `${wt.path} moved while it was built again`);
  }
  if (pristine) {
    const { merge } = planned();
    // Checked again, by commit: the branch may have existed (on the trusted base) when the worktree was created.
    const installedAt = resolveCommit(root, `refs/heads/${wt.branch}`, deps.git);
    if (installedAt === null) throw new ArbabError("git", `cannot read branch ${wt.branch}`);
    if (!isTrustedInstallPoint(installedAt, trusted())) {
      throw new ArbabError(
        "git",
        `${worktree} is at ${installedAt}, which is neither on ${config.baseBranch} nor an integration head a human ` +
          `confirmed, so arbab will not install dependencies there. Remove the worktree and the branch ${wt.branch}, ` +
          `then launch ${lane.name} again`,
      );
    }
    const dependencies = prepareDependencies(config.dependencies, worktree, deps.runCommand);
    if (!dependencies.ok) {
      const tail = dependencies.output.trim().split("\n").slice(-5).join("\n");
      throw new ArbabError("runtime", `dependencies failed (${dependencies.code}): ${tail}`);
    }
    // The base first: the lane's own branches were written on top of it.
    const branches = [...(merge === null ? [] : [{ branch: base, sha: merge }]), ...(lane.mergeBranches ?? [])];
    if (branches.length > 0) {
      merged = mergeBranches({ worktree, branch: wt.branch, gitCommonDir: wt.gitCommonDir, lane: lane.name, branches, git: deps.git });
    }
  }
  ensureWorkerTmp(worktree);
  return { worktree, branch: wt.branch, gitCommonDir: wt.gitCommonDir, merged };
}
