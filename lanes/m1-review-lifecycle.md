# M1 review · lifecycle correctness lens

## Task

Review the M1 runner on this branch for correctness defects in how a lane lives and ends. The owner will leave
fleets of workers running overnight on this code, so a wrong end state, a lost finish, a duplicate run or an
orphaned process is a real cost. DESIGN.md §2 (process model, kill rules, auto-resume), §3 (files), §7 (accounting)
and §8 (quota) are the specification.

Look for:

1. **End-state classification.** Every branch of `classifyAttempt` and its callers. Usage limit vs real failure vs
   budget vs invalid report vs killed. A real failure that would be auto-resumed; a usage-limit stop that would not.
2. **Auto-resume.**
   - the same session id and the same pinned binary;
   - attempt numbering, and `maxAttempts`;
   - the quota re-check before resuming;
   - waiting until the right reset (seconds vs milliseconds!);
   - cost deltas across resume versus a fresh session.
3. **Kill and reap.** The watcher rules (wall, idle, hang after result or error). Process-group and descendant
   reaping. Races at exit: a worker that exits during a kill; a reap that misses children reparented to PID 1.
4. **Wait and status.**
   - Level-triggered `wait` with acks: can a finish be missed, or reported twice?
   - Orphan detection: a shepherd that died before writing `finished`.
   - Live summaries of running attempts.
5. **Resource release.** Slots, leases, semaphores and writer locks released on every path, including errors, stop
   and setup failure. No release of another lane's resources.
6. **Time and units.** Epoch seconds (`resetsAt`) against `Date.now()` milliseconds; minutes in lane files against
   ms in timers.

## Scope

Read-only. Read in full, at least: `src/shepherd/**`, `src/stream/**`, `src/registry/**`, `src/quota/**`,
`src/run/watch.ts`, `src/run/tree.ts`, `src/run/spawn.ts`, `src/run/pool.ts`, `src/run/checkpoint.ts`,
`src/commands/**`. Read others as needed. You may run `pnpm test` and `pnpm typecheck`.

## Facts

- From two machines' runs:
  - usage-limit stops report `subtype: "success"` with `is_error: true` and `api_error_status: 429`;
  - `total_cost_usd` is session-cumulative across `--resume`;
  - `--max-budget-usd` counts only the current invocation;
  - a limit-stopped worker with a background child hung for 1 h 49 min;
  - an edge-triggered watcher missed a finish for 13 minutes.
- `rate_limit_event.resetsAt` is in epoch seconds.

## Acceptance

- [ ] Every file in Scope is listed in `paths_checked`, and `coverage` says what you verified and how.
- [ ] Each finding names the file and line, gives a concrete failure scenario, and cites its evidence. No style
      remarks.
- [ ] At most 10 findings, strongest first.
