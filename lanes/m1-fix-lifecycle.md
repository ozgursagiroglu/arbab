# M1 fixes · lane lifecycle (shepherd, run, stream, registry, quota, wait)

## Task

The M1 review found lifecycle defects, several by two lenses independently. Fix the ones in your scope; each fix
gets a test that fails without it.

1. **A finish before the first attempt is lost (L1 + C1, HIGH).** Setup failures end a lane `finished`/`failed`
   with no attempt directory. These include worktree, dependencies, leases, semaphores, binary, brief and schema.
   `pendingFinished` skips such lanes, so `arbab wait` never reports them. The same happens to a relaunch whose
   new run fails before its attempt. Ack per lane run, not per attempt:
   - a finished lane is pending until `<laneDir>/acked.json` records its current `state.json` (`shepherdPid` and
     `since`);
   - `FinishedItem` gains `endState: EndState | null` and `reason: string | null`, and `attempt` and `summary`
     become nullable;
   - `src/commands/wait.ts` prints the lane's end state and reason from `state.json` (fixing L9: the last
     attempt's state is not the lane's end state), the attempt only when there is one, and the report path when
     there is one;
   - keep `arbab wait --any` returning at once for every finish that has not been acked.
2. **Recycled pids (L2 + S6, HIGH).** The descendant set only grows, and kill/reap signal every pid in it.
   - Keep a pid only while it appears in the latest ps snapshot.
   - At kill and reap time, signal a pid only if a fresh snapshot shows it in the worker's process group or under a
     pid that is still a tracked descendant.
   - A snapshot failure (ps refused) degrades to the process group only, as now.
3. **Git calls on a worker's worktree (S1, HIGH, measured).** The shepherd runs git status, add and commit
   unsandboxed in the worktree. A worker can write its worktree's private git directory (`HEAD`, `commondir`) unless
   the shared git dir is denied. With those files it could move the checkpoint onto `main`, or point git at
   attacker-controlled hooks. Fix in three places:
   - `createWorktree` also returns `gitCommonDir`, the absolute path git rev-parse --git-common-dir prints;
   - the shepherd passes it into `ProfileInput.gitCommonDir`, so the fence denies writes there (lane
     `m1-fix-fence` makes `compileProfile` use it);
   - before `checkpoint`, verify that the worktree's git dir `HEAD` is `ref: refs/heads/arbab/<owner>` and that
     `commondir` resolves to `gitCommonDir`; on a mismatch, skip the commit and record a `checkpointError`. Run
     checkpoint git with the git dir and work tree passed explicitly (`--git-dir`, `--work-tree`), never read from
     the worktree.
4. **Dependencies run unsandboxed in a reused worktree (S2, HIGH).** `prepare()` reruns `dependencies.command` on
   every shepherd start: resume, fresh relaunch, and a verifier borrowing a worktree. By then the worktree has a
   worker's `package.json`, so pnpm can run worker-written lifecycle scripts outside the sandbox. Run the dependency
   command only when `createWorktree` created the worktree, and take the writer lock before it.
5. **Usage limit, then a hang (L4).** A worker that emits a 429 result and then hangs is killed after 2 minutes as
   `killed:hang-after-error`, and never auto-resumes. In `classifyAttempt`, when `killedBy` is `hang-after-error`
   or `hang-after-result` and a final result exists, classify by the result: 429 → `usage-limit`, success with a
   valid report → `success`, and so on. Wall, idle and stop kills keep `killed:*`.
6. **Stale quota (L5 + C4).** `quota.json` is updated only at attempt end, with the end time stamped on every event,
   so an old reading can overwrite a newer one.
   - `createWatcher.tick()` also returns the latest `rate_limit_event` seen in the new bytes.
   - The shepherd calls `updateQuota` with `observedAt` = the time the event was read.
   - Drop the end-of-attempt `updateQuota`.
7. **`maxAttempts` counts the lane's whole history (L7 + C10).** Count the attempts this shepherd run made.
8. **The binary pin (L8 + C2, HIGH for preflight after a CLI upgrade).** Pin the binary only for a resume of the
   same session: the previous attempt's binary, when this attempt resumes its session. `start` and `fresh`
   resolve anew.
9. **Cost delta (L10).** For a resume, walk back to the most recent attempt of the same session that has a cost; a
   killed attempt without a result does not reset the base.
10. **Lint on every attempt (S7).** `runAttempt` runs `lintProfile` on the compiled profile and refuses on errors
    (setup failure, end state `failed`, reason = the lint codes), so a config changed after launch cannot slip in.
11. **Pool reclaim with three racers (S9).** After reclaiming a stale entry and creating your own, re-read it and
    confirm it is still yours before you count it as held.
12. **Read with `readText`.** Replace the private file-reading helpers in your scope with `readText` from
    `src/util/fs`.
13. **The resume prompt from a file.** `ShepherdMode` now has `promptFile` (the type is already in
    `src/shepherd/index.ts`). For a resume, read the prompt from `promptFile` when it is set: an absolute path that
    must be inside the lane's run dir after realpath. Otherwise use `prompt`, else the continuation prompt.

## Scope

You own `src/shepherd/**`, `src/run/**`, `src/stream/**`, `src/registry/**`, `src/quota/**`,
`src/commands/wait.ts` and `src/commands/wait.test.ts`, `test/fake-claude/**` and `test/e2e/**`. Change nothing
else.

## Facts

- Measured on CLI 2.1.295, from code a worker ran in its sandbox: new files and loose refs in the shared `.git`, and
  new files in the worktree's private git dir, were writable. `.git/config`, `.git/hooks` and the worktree's `.git`
  pointer were not (EPERM). With `sandbox.filesystem.denyWrite: ["<repo>/.git"]` all were blocked, and git
  status/log/diff still worked.
- `ps` is refused (EPERM) inside your sandbox; tests inject `readPs`.
- `total_cost_usd` is session-cumulative across `--resume`; `--max-budget-usd` counts only one invocation.

## Acceptance

- [ ] Each numbered fix is done, with a test that fails without it. The e2e suite (`test/e2e`) still passes, and
      covers fix 1 with a lane whose setup fails (for example a bad base ref): `wait --any` reports it.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
