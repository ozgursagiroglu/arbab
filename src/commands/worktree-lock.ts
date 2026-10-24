// The writer lock of a worktree under the project's worktreeRoot, keyed as the shepherd keys it (the root's real path
// and the directory name). Cleanup and the sweep take it to remove a worktree; integrate and host-check hold it while
// they create, rebuild or work in the integration worktree, so neither removes it under the other.
import { realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { acquireWriterLock, releaseWriterLock, writerLockKey, type Holder } from "../run";
import { ArbabError } from "../util/errors";
import { ensureDir, readJson } from "../util/fs";
import { isoAt } from "../util/proc";
import type { CommandContext } from "./context";
import type { Project } from "./project";

/** How often a command waiting for a worktree's writer lock tries again. */
export const WORKTREE_LOCK_POLL_MS = 250;
/** How long it waits before it refuses. */
export const WORKTREE_LOCK_WAIT_MS = 120_000;

/** The lock key of `<worktreeRoot>/<name>`; the root is created first, so the key is known before the worktree exists. */
function lockKey(project: Project, name: string): string {
  if (name === "" || name === "." || name === ".." || basename(name) !== name) {
    throw new ArbabError("usage", `worktree name ${JSON.stringify(name)} is not a directory name`);
  }
  ensureDir(project.worktreeRoot);
  return writerLockKey(join(realpathSync(project.worktreeRoot), name));
}

/**
 * Takes the writer lock of the worktree `<worktreeRoot>/<name>` for this process. Returns its release, or null when a
 * live holder has it.
 */
export function lockWorktree(ctx: CommandContext, project: Project, name: string): (() => void) | null {
  const key = lockKey(project, name);
  const holder: Holder = { pid: ctx.pid, lane: name, project: project.root, createdAt: isoAt(ctx.clock) };
  if (!acquireWriterLock(ctx.home, key, holder, ctx.alive)) return null;
  return () => {
    releaseWriterLock(ctx.home, key, holder);
  };
}

/** The pid the lock's entry names, or null when it does not read (its holder may be writing it, or just released it). */
function holderPid(ctx: CommandContext, project: Project, name: string): number | null {
  try {
    const raw = readJson<unknown>(join(ctx.home, "locks", lockKey(project, name), "0.json"));
    const pid = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>)["pid"] : undefined;
    return typeof pid === "number" && Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Takes the worktree's writer lock (lockWorktree) for `command`, waiting while another live process holds it: tried
 * every WORKTREE_LOCK_POLL_MS for up to WORKTREE_LOCK_WAIT_MS, then refused with the holder's pid. Says once, on
 * stderr, that it waits. Returns the release.
 */
export async function holdWorktree(ctx: CommandContext, project: Project, name: string, command: string): Promise<() => void> {
  const path = join(project.worktreeRoot, name);
  const startMs = ctx.clock.now();
  let told = false;
  for (;;) {
    const release = lockWorktree(ctx, project, name);
    if (release !== null) return release;
    const pid = holderPid(ctx, project, name);
    const who = pid === null ? "another process" : `pid ${pid}`;
    if (ctx.clock.now() - startMs >= WORKTREE_LOCK_WAIT_MS) {
      throw new ArbabError(
        "lock",
        `${path} is in use: ${who} holds its writer lock, and arbab ${command} waited ${WORKTREE_LOCK_WAIT_MS / 60_000} minutes for it; ` +
          `try again once that process has finished`,
      );
    }
    if (!told) {
      ctx.stderr(`arbab ${command}: waiting for ${path}: ${who} holds its writer lock\n`);
      told = true;
    }
    await ctx.sleep(WORKTREE_LOCK_POLL_MS);
  }
}

/** Runs `fn` holding the worktree's writer lock (holdWorktree), released when it returns or throws. */
export async function withWorktreeLock<T>(ctx: CommandContext, project: Project, name: string, command: string, fn: () => T | Promise<T>): Promise<T> {
  const release = await holdWorktree(ctx, project, name, command);
  try {
    return await fn();
  } finally {
    release();
  }
}
