# M1 · runtime mechanics (src/run)

## Task

Implement `src/run/`: worktrees, dependencies, leases, locks and pools, spawning a detached worker, tracking its
process tree, the kill timers, reaping, and the runner-owned checkpoint. DESIGN.md §2, §3, §9 and §15 are the
specification. Every function takes what it touches (paths, the `~/.arbab` directory as `home`, a git runner, a
clock, a ps reader, signal functions) so tests inject fakes or temporary directories. Never touch the real
`~/.arbab`.

Export from `src/run/index.ts`:

1. **Git** (`git.ts`):
   - `type GitRunner = (args: string[], cwd: string) => { code: number; stdout: string; stderr: string }` and
     `nodeGit: GitRunner` (spawnSync `git` with an argv array, no shell).
   - `ensureIgnored(projectRoot, entries: string[], git)`: append missing entries to the file that
     `git rev-parse --git-path info/exclude` names (relative to projectRoot), then verify each with
     `git check-ignore -q <entry>/x`; throw `ArbabError("git")` if one is not ignored.
   - `createWorktree({ projectRoot, root, lane, base, git }): { path, branch, created }`: path
     `<projectRoot>/<root>/<lane>`, branch `arbab/<lane>`. When the path is already a worktree of this repository
     (`git worktree list --porcelain`), reuse it (`created: false`). Otherwise use
     `git worktree add -b <branch> <path> <base>`, or `git worktree add <path> <branch>` when the branch already
     exists. `lane` must pass `assertValidName`.
   - `isDirty(worktree, git): boolean` (`git status --porcelain` non-empty).
2. **Dependencies** (`deps.ts`): `prepareDependencies(strategy: DependencyStrategy, worktree: string, run: (argv:
   string[], cwd: string) => { code: number; output: string }): { ok: boolean; code: number; output: string }` —
   `none` → ok; `command` → run the argv in the worktree.
3. **Pools, locks, leases** (`pool.ts`, `leases.ts`). One generic exclusive-file pool, reused for everything:
   - `acquireFromPool(dir, values: number[], holder: Holder, alive: (pid) => boolean): number | null` — try each
     value in order with `createExclusive(<dir>/<value>.json, JSON holder)`. When one exists, read it: if its pid is
     dead, remove it and retry that value once. Returns the value taken, or null.
   - `releaseToPool(dir, value, holder)` — remove the file only when its content matches holder pid and lane.
   - `Holder = { pid: number; lane: string; project: string; createdAt: string }`.
   - Slots: `acquireSlot(home, maxParallel, holder, alive)` over `<home>/slots`, values `0..max-1`;
     `releaseSlot(home, slot, holder)`.
   - Semaphores: the same over `<home>/semaphores/<name>` with values `0..capacity-1`.
   - Writer lock: `writerLockKey(worktreeRealpath)` = sha1 hex; `acquireWriterLock(home, key, holder, alive):
     boolean` and `releaseWriterLock(home, key, holder)` (a pool of one value under `<home>/locks/<key>`).
   - Leases: `acquireLeases({ home, requests: Record<string, number>, ranges: ProjectConfig["resources"], holder,
     alive, probePort })` — for each type in name order, take the lowest free values in its range from the pool
     `<home>/leases/<type>`. For type `port`, a value must also pass `probePort(port)`; a busy port is skipped
     without being kept. All-or-nothing: on failure release what was taken and throw `ArbabError("lease")`. Returns
     `Lease[]`. Also `releaseLeases(home, leases, holder)` and `leaseEnv(leases)` → `{ARBAB_<TYPE>_<i>: value}`.
   - `isPortFree(port): Promise<boolean>` — listen on 127.0.0.1 and close.
4. **Spawn** (`spawn.ts`): `spawnWorker({ binary, args, cwd, env, promptFile, streamFile, stderrFile, spawnImpl? }):
   { pid: number; exited: Promise<{ code: number | null; signal: string | null }> }`:
   - stdin is the prompt file, opened read-only;
   - stdout and stderr go to the stream and stderr files, opened with `wx` so they are never overwritten;
   - `detached: true`, so the worker gets its own process group;
   - the parent closes its copies of the descriptors;
   - `spawnImpl` defaults to `child_process.spawn`.
5. **Process tree** (`tree.ts`):
   - `parsePs(output: string): Array<{ pid; ppid; pgid }>` (output of `ps -A -o pid=,ppid=,pgid=`);
   - `readPs(): string` (execFileSync);
   - `descendantsOf(root: number, table, known: Set<number>): Set<number>` — transitive descendants in this
     snapshot, unioned with `known` (children reparented to PID 1 after their parent died are kept from earlier
     snapshots);
   - `reap({ pgid, pids, signal, alive, sleep, graceMs })`: SIGTERM to `-pgid` and every pid, wait `graceMs`, then
     SIGKILL the survivors; returns the pids that were alive at the start. `signal` defaults to `sendSignal`; never
     signals 0, 1 or the caller's own pid.
6. **Watcher** (`watch.ts`): `createWatcher({ streamPath, startedAtMs, wallMs, idleMs, hangAfterResultMs = 15 min,
   hangAfterErrorMs = 2 min, clock, readSize, readRange })`. It has a `tick(): KillReason | null` method that reads
   only the bytes appended since the last tick, tracks the time of the last growth, and remembers the last `result`
   event (`is_error`). Kill rules, checked in this order:
   1. now − start > wallMs → `wall`;
   2. the last result was an error and quiet > hangAfterErrorMs → `hang-after-error`;
   3. a result was seen and quiet > hangAfterResultMs → `hang-after-result`;
   4. quiet > idleMs → `idle`.

   Partial last lines are carried over to the next tick.
7. **Checkpoint** (`checkpoint.ts`): `checkpoint({ worktree, lane, attempt, endState, git }): { sha: string | null;
   error: string | null }`:
   - when the worktree is clean, return `{sha: null, error: null}`;
   - otherwise `git add -A`, then `git commit -m "arbab(<lane>): checkpoint attempt <n> (<endState>)"` plus a blank
     line and `Co-Authored-By: Claude <noreply@anthropic.com>`;
   - never pass `--no-verify`: when a hook or the commit fails, return the error text and no sha;
   - on success return the new HEAD.

## Scope

You own `src/run/**` (code and tests). Change nothing else.

## Facts

- Machine 2's failures this module prevents:
  - an edge-triggered watcher missed a finish;
  - `ps | grep` counted other sessions' workers;
  - a limit-stopped worker with a background `next dev` hung for 1 h 49 min;
  - orphan listeners stayed on three ports;
  - ports were hand-picked;
  - a session-id file was overwritten.
- `child_process.spawn` with `detached: true` calls setsid: the child leads a new process group, so `-pid` signals
  the whole group. Children that create their own group must be tracked through the ps snapshots.
- `git worktree add` needs the main repository; a worktree's `.git` is a file pointing into the main `.git`.
- The tests run inside an OS sandbox: you can write in your worktree and in `os.tmpdir()`, and you can listen on
  127.0.0.1. You cannot reach the network or write elsewhere. Spawning child processes (node, sh, git) works.

## Acceptance

- [ ] Every export above, using `src/types.ts` and `src/util/*` unchanged.
- [ ] Tests, with temporary directories and temporary git repositories (`git init` inside `os.tmpdir()`):
  - worktree creation and reuse, and `ensureIgnored`;
  - pool contention and stale-holder reclaim (use a dead pid such as a finished child's);
  - lease all-or-nothing, port skipping and `leaseEnv`;
  - the writer lock;
  - `spawnWorker` with a real short-lived `node -e` child writing to stdout, checking the stream file and that the
    child's pgid equals its pid;
  - `descendantsOf` with a synthetic table;
  - `reap` with fakes;
  - every watcher rule with a fake clock;
  - `checkpoint` on a clean worktree, on a dirty one, and with a failing pre-commit hook.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
