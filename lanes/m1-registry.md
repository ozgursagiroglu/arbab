# M1 · run registry, status, wait and quota (src/registry, src/quota)

## Task

Implement two modules. DESIGN.md §2, §3, §7, §8 and §10 are the specification. Functions take the runs root, the
`~/.arbab` directory (`home`), a clock and liveness checks as parameters; tests use temporary directories.

### `src/registry/` (export from `index.ts`)

1. `runPaths(runsRoot: string, lane: string)` → `{ laneDir, laneFile, stateFile, shepherdFile, attemptDir(n) }` and
   `attemptFiles(dir)` → `{ brief, settings, args, started, stream, stderr, registration, exit, summary, report,
   acked }` (file names as in DESIGN.md §3: `brief.md settings.json args.json started.json stream.jsonl stderr.log
   registration.json exit.json summary.json report.json acked`). Lane names pass `assertValidName`.
2. `createAttempt(runsRoot, lane): { n: number; dir: string }` — the next number after the highest existing
   `attempt-<n>`, created with a non-recursive `mkdir` of the final directory, so two creators cannot get the same
   one. Also `listAttempts(runsRoot, lane): number[]` (ascending) and `listLanes(runsRoot): string[]` (directories
   whose names are valid, sorted).
3. `readAttempt(dir)` → `{ started: AttemptStarted | null; exit: AttemptExit | null; summary: AttemptSummary | null;
   acked: boolean }`.
4. State: `writeState(runsRoot, record: LaneStateRecord)` (atomic), `readState(runsRoot, lane)`, and
   `effectiveState(record, alive: (pid) => boolean): LaneState` — a record that is not `finished` but whose
   shepherd pid is dead is `orphaned`.
5. `statusRow(record: LaneStateRecord, summary: AttemptSummary | null, nowMs: number): StatusRow` and
   `formatStatusTable(rows: StatusRow[], nowSec: number): string`. Columns: lane, state (and end state when
   finished), attempt, elapsed (`12m03s`, `1h04m`), turns, calls, last tool, effort (the measured effort with the
   most entries), failed, cost (`$1.23`, Δ in parentheses when it differs), and quota (`5h 62% · 7d 60%` from the
   summary's rate limit). Aligned plain-text columns; `—` for unknowns.
6. Wait (level-triggered, with acks):
   - `pendingFinished(runsRoot, lanes: string[] | null, alive)` returns
     `Array<{ lane, attempt, state: LaneState, summary }>`: lanes whose effective state is `finished` or `orphaned`
     and whose latest attempt has no `acked` file.
   - `ack(runsRoot, lane, attempt)`: `createExclusive` of `acked`.
   - `waitForFinished({ runsRoot, lanes, mode: "any" | "all", timeoutMs, pollMs, clock, sleep, alive })` resolves to
     `{ finished: [...]; timedOut: boolean }`:
     - `any`: as soon as at least one pending item exists, return all pending items and ack them;
     - `all`: once every named lane (or every lane when `lanes` is null) is finished or orphaned, return the pending
       ones and ack them;
     - an item that finished before the call is returned too (that is the point: machine 2's edge-triggered watcher
       missed a finish).

### `src/quota/` (export from `index.ts`)

1. `readQuota(home): RateLimitSnapshot | null` and `updateQuota(home, snapshot): boolean` — write
   `<home>/quota.json` atomically, only when there is no stored snapshot or `snapshot.observedAt` is newer than the
   stored one. Return whether it wrote.
2. `holdDecision(snapshot: RateLimitSnapshot | null, holdAbove: { fiveHour: number; sevenDay: number }, nowSec:
   number): HoldDecision`:
   - `hold: true` when:
     - `status === "rejected"` and a window's `resetsAt` is in the future;
     - five-hour utilisation ≥ holdAbove.fiveHour and its `resetsAt` > nowSec;
     - seven-day utilisation ≥ holdAbove.sevenDay and its `resetsAt` > nowSec.
   - `until` is the latest `resetsAt` among the windows that hold.
   - `reason` names the window and its utilisation.
   - Expired windows (resetsAt ≤ nowSec) never hold.
   - A null snapshot never holds.
3. `resumeAt(resetsAt: number, jitterSec: number): number` — `resetsAt + 60 + jitterSec`, where the caller passes a
   jitter in 0–60.
4. `formatQuota(snapshot, nowSec): string` — e.g. `5h 62% (resets 12:30Z) · 7d 60% (resets Oct 15 08:00Z)`, or
   `quota unknown`.

## Scope

You own `src/registry/**` and `src/quota/**` (code and tests). Change nothing else.

## Facts

- Machine 2 lost attempt records:
  - a launcher overwrote its session-id file;
  - another appended every result to one file;
  - an edge-triggered watcher missed a finish for 13 minutes;
  - `ps | grep` counted another session's workers.
- One account-wide usage limit stopped every worker of two orchestrators within 8 minutes. The orchestrators went
  deaf until the reset.
- A real snapshot from today: five_hour utilization 0.6, resetsAt 1791549000 (12:30Z); seven_day utilization 0.6,
  resetsAt 1792051200; status `allowed_warning`, rateLimitType `seven_day`.
- `src/stream` (which produces `AttemptSummary`) is written in parallel by another lane and is not available to
  you; build test summaries as literal objects typed `AttemptSummary`.

## Acceptance

- [ ] Every export above, using `src/types.ts` and `src/util/*` unchanged.
- [ ] Tests:
  - concurrent `createAttempt` (two calls never return the same n);
  - state round-trip and the `orphaned` rule;
  - status rows and the table format (exact string for a fixed input);
  - `waitForFinished`: any, all, timeout, already-finished-before-the-call, and acks preventing a second return;
  - `updateQuota` newer/older ordering;
  - every `holdDecision` rule, including expired windows and a null snapshot.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
