import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireWriterLock, writerLockKey } from "../run";
import { openProject } from "./project";
import { CLI_PID, NOW_MS, makeProject, type TestProject } from "./testkit";
import { holdWorktree, lockWorktree, withWorktreeLock, WORKTREE_LOCK_POLL_MS, WORKTREE_LOCK_WAIT_MS } from "./worktree-lock";

let p: TestProject;
afterEach(() => p?.dispose());

const LIVE = 101;
const DEAD = 202;
const T = "2026-10-09T12:00:00.000Z";

const lockFile = (t: TestProject, name: string): string => join(t.home, "locks", writerLockKey(join(realpathSync(t.worktreeRoot), name)), "0.json");

/** Has `pid` hold the writer lock of <worktreeRoot>/<name>. */
function heldBy(t: TestProject, name: string, pid: number): void {
  mkdirSync(t.worktreeRoot, { recursive: true });
  const holder = { pid, lane: name, project: t.root, createdAt: T };
  expect(acquireWriterLock(t.home, writerLockKey(join(realpathSync(t.worktreeRoot), name)), holder, () => true)).toBe(true);
}

describe("lockWorktree", () => {
  it("takes the lock as the shepherd keys it, even before the worktree root exists, and releases it", () => {
    p = makeProject();
    rmSync(p.worktreeRoot, { recursive: true, force: true });
    const release = lockWorktree(p.ctx, openProject(p.ctx), "integrate-rel");
    expect(release).not.toBeNull();
    expect(JSON.parse(readFileSync(lockFile(p, "integrate-rel"), "utf8"))).toEqual({ pid: CLI_PID, lane: "integrate-rel", project: p.root, createdAt: T });
    release?.();
    expect(existsSync(lockFile(p, "integrate-rel"))).toBe(false);
  });

  it("is null while a live process holds it, and takes over a dead holder's", () => {
    p = makeProject();
    p.alive.add(LIVE);
    heldBy(p, "a", LIVE);
    expect(lockWorktree(p.ctx, openProject(p.ctx), "a")).toBeNull();
    heldBy(p, "b", DEAD);
    expect(lockWorktree(p.ctx, openProject(p.ctx), "b")).not.toBeNull();
  });

  it("refuses a name that is not one directory", () => {
    p = makeProject();
    for (const name of ["", ".", "..", "a/b"]) expect(() => lockWorktree(p.ctx, openProject(p.ctx), name)).toThrow(/is not a directory name/);
  });
});

describe("holdWorktree", () => {
  it("takes a free lock at once, without waiting or saying anything", async () => {
    p = makeProject();
    const release = await holdWorktree(p.ctx, openProject(p.ctx), "a", "integrate");
    expect(p.now.ms).toBe(NOW_MS);
    expect(p.stderr()).toBe("");
    release();
    expect(existsSync(lockFile(p, "a"))).toBe(false);
  });

  it("waits, polling, while a live process holds it, and takes it once that process is gone", async () => {
    p = makeProject();
    p.alive.add(LIVE);
    heldBy(p, "a", LIVE);
    const sleeps: number[] = [];
    p.ctx.sleep = async (ms) => {
      sleeps.push(ms);
      p.now.ms += ms;
      if (sleeps.length === 3) p.alive.delete(LIVE);
    };
    const release = await holdWorktree(p.ctx, openProject(p.ctx), "a", "host-check");
    expect(sleeps).toEqual([WORKTREE_LOCK_POLL_MS, WORKTREE_LOCK_POLL_MS, WORKTREE_LOCK_POLL_MS]);
    expect(p.stderr()).toBe(`arbab host-check: waiting for ${join(p.worktreeRoot, "a")}: pid ${LIVE} holds its writer lock\n`);
    expect((JSON.parse(readFileSync(lockFile(p, "a"), "utf8")) as { pid: number }).pid).toBe(CLI_PID);
    release();
  });

  it("refuses after the wait, naming the holder's pid, and leaves its lock alone", async () => {
    p = makeProject();
    p.alive.add(LIVE);
    heldBy(p, "a", LIVE);
    await expect(holdWorktree(p.ctx, openProject(p.ctx), "a", "integrate")).rejects.toMatchObject({
      code: "lock",
      message: `${join(p.worktreeRoot, "a")} is in use: pid ${LIVE} holds its writer lock, and arbab integrate waited 2 minutes for it; try again once that process has finished`,
    });
    expect(p.now.ms - NOW_MS).toBe(WORKTREE_LOCK_WAIT_MS);
    expect((JSON.parse(readFileSync(lockFile(p, "a"), "utf8")) as { pid: number }).pid).toBe(LIVE);
  });

  it("names no pid when the lock's entry does not read", async () => {
    p = makeProject();
    heldBy(p, "a", LIVE);
    // A fresh unparsable entry is its creator's, still writing it.
    writeFileSync(lockFile(p, "a"), "{");
    await expect(holdWorktree(p.ctx, openProject(p.ctx), "a", "integrate")).rejects.toThrow(/is in use: another process holds its writer lock/);
  });
});

describe("withWorktreeLock", () => {
  it("holds the lock while the function runs and releases it after a return or a throw", async () => {
    p = makeProject();
    const project = openProject(p.ctx);
    expect(await withWorktreeLock(p.ctx, project, "a", "integrate", () => (existsSync(lockFile(p, "a")) ? "held" : "free"))).toBe("held");
    expect(existsSync(lockFile(p, "a"))).toBe(false);
    await expect(
      withWorktreeLock(p.ctx, project, "a", "integrate", async () => {
        await Promise.resolve();
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(existsSync(lockFile(p, "a"))).toBe(false);
  });
});
