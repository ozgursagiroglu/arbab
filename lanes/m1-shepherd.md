# M1 · the shepherd (src/shepherd) and a fake claude (test/fake-claude)

## Task

Implement `src/shepherd/`: the long-running process that supervises one lane from launch to finish, wiring the M1
modules together. DESIGN.md §2 (process model, kill rules, auto-resume), §3 (files), §7 (accounting) and §8 (quota)
are the specification. Also write `test/fake-claude/`, a stand-in for the `claude` binary, so the whole lifecycle is
tested without spending quota.

### Contract (the stub in `src/shepherd/index.ts` fixes these signatures; keep them)

```ts
export type ShepherdMode = { kind: "start" } | { kind: "resume"; prompt?: string } | { kind: "fresh" };
export interface ShepherdDeps { /* see below */ }
export function defaultDeps(): ShepherdDeps;
export async function runShepherd(projectRoot: string, lane: string, mode: ShepherdMode,
  deps: ShepherdDeps, stop: AbortSignal): Promise<EndState>;
```

`ShepherdDeps` carries everything the shepherd touches:
- `home` (the `~/.arbab` directory), `claudeHome` (`~/.claude`, for `projects/` and `sessions/`);
- `clock`, `sleep`, `random`;
- `hostEnv`, `nodeDir`, `pnpmDir`;
- `git` (GitRunner), `runCommand` (dependency strategy), `spawnImpl`, `readPs`, `signal`, `alive`, `probePort`;
- `resolveBinary` inputs: `explicitClaude`, `pathEnv`, `run`, `exists` and `realpath`;
- `tickMs` (default 10 000), `holdPollMs` (default 60 000), `slotPollMs` (default 15 000), `reapGraceMs`
  (default 10 000).

`defaultDeps()` builds the real ones.

### Lifecycle (`runShepherd`)

1. `loadConfig(projectRoot)`; the lane spec is `<runs>/<lane>/lane.json` (the launch command wrote it, already
   validated). Write `shepherd.json` `{pid, startedAt}` and state `queued`.
2. **Slot:** `acquireSlot(home, config.maxParallel, holder)`; while none is free, write state `held`
   (reason "no free slot") and poll.
3. **Quota:** `holdDecision(readQuota(home), config.quota.holdAbove, now)`; while it holds, write state `held` with
   reason and `until`, and sleep `min(until − now, holdPollMs)`.
4. **Prepare** (state `preparing`):
   - `ensureIgnored` for the worktree root, the runs root and `.arbab-tmp/`;
   - `createWorktree` (or, when `lane.worktree` names another lane, that lane's existing worktree);
   - `prepareDependencies`; create `<worktree>/.arbab-tmp/xdg-config`;
   - `acquireLeases` for `lane.resources`, the semaphores, and the writer lock (wait while the lock is held).

   A setup failure finishes the lane with end state `failed` and the reason in `state.json`.
5. **Attempt** (state `running`; `createAttempt`):
   - **Binary:** `resolveBinary`, pinned to attempt 1's `started.json` binary on later attempts.
   - **Fence:** `resolveRole` and `compileProfile`, with a `ProfileInput` built from the role defaults, config and
     lane: `config.commands[role]`, `lane.allow`, `config.credentialPaths`, `config.env` + `leaseEnv(leases)`, and
     the worktree.
   - **Brief:** for a `start`/`fresh` attempt, the instruction files' contents, `parseBriefSource` +
     `assembleBrief` (coordination from the lane; `upstream` items as the upstream lanes' latest `summary.json`
     `final.resultText` or report summary); for a resume attempt, the continuation prompt — `mode.prompt`, or:
     > "The run stopped because the account hit its usage limit, not because of anything in your work. The limit
     > has reset. The runner committed your work so far as a checkpoint: check `git log --oneline -5` and
     > `git status --short` to re-orient, then continue exactly where you left off, finish the task, run the
     > checks the brief names, and end with the report the brief asks for."
   - **Launch:** write `settings.json`, `brief.md` and `args.json` (the `--json-schema` value replaced by
     `"<schema>"`), with `buildClaudeArgs` (session: new UUID for `start`/`fresh`, the lane's session for resume)
     and `workerEnv(hostEnv, {passEnv, extra: {}, nodeDir, pnpmDir})`; `spawnWorker`; write `started.json`.
6. **Watch** every `tickMs`:
   - `watcher.tick()` (wall, idle, hang rules) → kill;
   - a ps snapshot → `descendantsOf`;
   - once, `<claudeHome>/sessions/<pid>.json` → `registration.json` (kind, entrypoint, name only);
   - `stop` aborted → kill with reason `stopped`.

   A kill sends SIGTERM to `-pgid` and the descendants, then SIGKILL after `reapGraceMs`.
7. **After exit:**
   - `reap` (process group + descendants);
   - `checkpoint` when the role's `checkpoint` is true;
   - `parseStream` + `digestStream`;
   - validate `structured_output` against the lane schema (`lane.schema` file or `DEFAULT_SCHEMAS[role]`); write
     `report.json` when it validates;
   - `findTranscript` + `measuredEffort`;
   - `classifyAttempt`;
   - `buildAttemptSummary`, with `previousCostUsd` from the previous attempt's summary;
   - write `exit.json` and `summary.json`;
   - `updateQuota(home, digest.rateLimit)`.
8. **Next:**
   - **`usage-limit`**, when `autoResume` is set and the attempt count is below `maxAttempts`: state `waiting-reset`
     until `resumeAt(resetsAt, random 0–60)`, where `resetsAt` is the latest of the windows at utilization ≥ 0.99
     whose reset is in the future (if none, now + 15 min). Then re-check the quota and run a resume attempt.
   - **Anything else:** release the leases, semaphores, writer lock and slot; write state `finished` with
     `endState`; return it.
   - **`stop`** always finishes with `killed:stopped`.

### Fake claude (`test/fake-claude/fake-claude.mjs`, executable, `#!/usr/bin/env node`)

- `--version` prints `2.1.295 (Claude Code)`.
- Otherwise it reads the scenario from the JSON file named by env `FAKE_CLAUDE_SCENARIO`. Scenario fields:
  - `fixture` (a name under `test/fixtures/stream/` or an absolute path);
  - `resumeFixture` (used when argv has `--resume`);
  - `lineDelayMs`;
  - `touch` (a relative file to write in cwd, simulating an edit);
  - `spawnChild` (start a detached `node -e "setInterval(()=>{},1e3)"` in its own process group and do not wait for
    it);
  - `hangMs` (sleep after the last line; -1 means forever);
  - `exitCode`.
- It reads stdin to the end, rewrites every `session_id` to the `--session-id`/`--resume` value, and appends one
  line per call to `FAKE_CLAUDE_LOG` (argv and the env keys it received), so tests can assert flags and env.

## Scope

You own `src/shepherd/**` and `test/fake-claude/**`. Read everything else. The M1 modules are merged and their
exports are in the `index.ts` of each `src/<module>/`; if one does not do what this brief needs, do not edit it:
work around it inside `src/shepherd/` and report the gap in `open_questions`.

## Facts

- Every M1 module (stream, profile, config, binary, report, brief, run, registry, quota) is merged on this
  branch, with 528 tests. The APIs differ from this brief's wording in a few places; the code wins:
  - `acquireLeases(req: LeaseRequest)` is async. `leaseEnv` numbers from 0 per type (`ARBAB_PORT_0`).
  - Pool files are `<dir>/<value>.json`; the writer lock is `locks/<sha1>/0.json`. A stale entry is reclaimed
    through a tomb rename.
  - `readPs(exec?)`, `reap(input: ReapInput)`, `createWatcher(input: WatcherInput)` (with `tick()` and `state()`).
  - `resolveBinary(opts: ResolveBinaryOptions)`; the real `run`/`exists`/`realpath` are `runVersion`, `pathExists`
    and `realpath` from `src/binary`.
  - `buildAttemptSummary(input: AttemptSummaryInput)`: pass `previousCostUsd: null` for an attempt that starts a
    new session (`start`, `fresh`), and the previous attempt's `costUsd` only for a resume, because
    `total_cost_usd` is cumulative only across `--resume`.
  - `holdDecision(snapshot, holdAbove, nowSec)` and `resumeAt(resetsAt, jitterSec)` in `src/quota`.
- **`ps` is refused (EPERM) inside your sandbox**, so tests must inject `readPs`. Spawning node children, detached
  process groups and `process.kill(-pgid, 0)` work.
- Measured in w0: a deny rule `Bash(run_in_background:true)` stops background Bash calls, so a fenced worker
  should not leave children behind. The reap still runs, because a worker of another fence level, or a killed
  worker, can.
- `total_cost_usd` is session-cumulative; `--max-budget-usd` counts only the current invocation.

## Acceptance

- [ ] `runShepherd` and `defaultDeps` exist with the contract's signatures.
- [ ] Lifecycle tests use temporary project directories (a `git init` repository with one commit and an
  `arbab.config.json`), a temporary `home` and `claudeHome`, the fake claude as the binary, and small `tickMs`
  values. They cover:
  - success, with every attempt file written and a checkpoint commit for a `touch` scenario;
  - usage-limit, then auto-resume with the same session id, then success;
  - `hang-after-result` with `spawnChild`: the worker and its child are reaped and the end state is
    `killed:hang-after-result`;
  - idle and wall kills;
  - a quota hold, released by rewriting `quota.json`;
  - waiting for a slot;
  - stop through the AbortSignal;
  - a pinned binary that changed version between attempts (it fails);
  - setup failure (a bad base ref).
- [ ] The fake claude is covered by its own small test.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
