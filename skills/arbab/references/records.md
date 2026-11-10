# Records

What workers report and what arbab writes, so you need not read the source. `arbab summary`, `arbab report <lane>`
and `arbab status` render most of it: read the files only when they do not answer. Paths are relative to the project
root unless they start with `~/.arbab/`; runs and worktrees are under `.arbab/` unless config `runsRoot` or
`worktreeRoot` moves them.

## Reports by role

Each role's default schema; a lane's `schema` field replaces it. Extra top-level fields fail the schema, and a
missing or failing report ends the attempt as `invalid-report`.

| Role | Fields (required unless marked) |
| --- | --- |
| implementer, verifier | `status` (`done`, `partial`, `blocked`); `summary`; `files_changed[]`; `checks[]` of `{command, exit_code, result}`; `decisions[]`; `open_questions[]`; `not_verified[]`; `notes_for_reviewer` (optional) |
| reviewer | `findings[]` of `{title, severity (HIGH, MEDIUM, LOW), file, line (optional), failure_scenario, evidence}`; `coverage`; `paths_checked[]` |
| skeptic (a reviewer `review` generates) | `verdicts[]` of `{id, refuted, corrected_severity (HIGH, MEDIUM, LOW, NONE), reasoning}` |
| researcher | `facts[]` of `{question, claim, source, quote (optional), confidence (high, medium, low)}`; `not_found[]`; `recommendations[]` |
| probe | `steps[]` of `{n, command, exit_code, output}` |

What they mean downstream:

- `checks` is the worker's own account. Verify never trusts it: gate exit codes come from the stream's tool results.
- Every `open_questions` and `not_verified` entry of a merged lane becomes a readiness risk; the same note from
  several lanes is one risk.
- A lens counts only when its lane ended `success` with a non-empty `coverage` and at least one path checked.
- A skeptic verdict with `refuted: true` or severity `NONE` makes the finding `refuted`; any other confirms it at the
  corrected severity. A finding without a verdict stays `unverified`; LOW findings get no skeptic.

## Default Bash allowlist

As each role's tool belt shows it (`…` means any arguments). Config `commands.<role>` and the lane's `allow` add to
it; a `sandbox-auto` lane has no allowlist.

| Role | Shell commands |
| --- | --- |
| implementer, verifier | `git status …`, `git diff …`, `git log …`, `git show …`, `git ls-files …`, `git blame …`, `ls …`, `cat …`, `head …`, `tail …`, `wc …`, `pwd`, `mkdir …`, `cp …`, `mv …`, `rm …`, `touch …` |
| reviewer | the same without `mkdir`, `cp`, `mv`, `rm` and `touch` |
| researcher | no shell |
| probe | `git rev-parse …`, `git status`, `ls …` |

Heavy checks (the lane's own, else config `checks`, else one per gate that is not a build, named by the word it runs:
`pnpm -F web typecheck` → `typecheck`, `pnpm test:unit` → `test-unit`): implementer and verifier lanes also get
`node <script> <name>` and `node <script> <name> …` per check name, where `<script>` is the lane's copy of arbab-check
(`<runsRoot>/<lane>/bin/arbab-check.mjs`); the tool belt prints the exact command and the names. Config `checks: {}`
gives lanes none.

The attempt's env carries `ARBAB_CHECKS` (name → argv) and `ARBAB_CHECK_POLICY`, a `CheckPolicy`: `{cpus,
concurrent, waitSec, suites}`. `suites` is `"targeted"` for every role but the probe; every probe lane (verify's and
any other) gets `"whole"` (and `waitSec` 0). A policy without it reads as `"whole"`. Under `"targeted"`, a check that
runs a test suite (a run word of vitest, jest, mocha, ava, playwright or cypress, `node --test`, or a script or task
named `test`, `test:*`, `test-*`, `test_*`, `*:test`, `*-test` or `*_test`, also through turbo, nx, lerna, moon or
make) refuses to run without a target, exit 2: `arbab-check: <name> runs the whole suite, which verify runs for the batch; pass the test
files you changed: node <script> <name> <files>`. Options and their values (`--project unit`, `-t name`) are no target.

Generated lanes: `<name>-verify` is a probe with tools Read and Bash and an exact rule (no arguments) per gate and
smoke command, each run through its arbab-check (`node <script> gate-<i>`, `node <script> smoke`). Skeptic lanes get
no dependency install, nor do reviewer lanes when config `review.install` is false. Preflight's tools probe gets each `preflight.steps` command as an exact rule, whatever the lane's
role. Every role is denied background Bash, git writes and `git -C`; every role but the researcher is denied the web.

## Checkpoint commits

When an attempt ends, the shepherd commits what the worker left in its worktree, with hooks off:

```text
arbab(<lane>): checkpoint attempt <n> (<end state>)

Co-Authored-By: Claude <noreply@anthropic.com>
```

It never stages `.arbab/`, `.arbab-tmp/` or a nested repository; `exit.json` `checkpointError` names what it left
out. Nothing changed means no commit (`checkpoint: null`). Other commits arbab makes: `arbab: merge <branch> for
<lane>` (a plan phase's dependencies), `arbab: integrate <lane> into integrate/<name>`, and the landing (`Land <name>`
or the `--message` file).

## Run records (`.arbab/runs/<lane>/`)

| File | Holds |
| --- | --- |
| `lane.json` | the lane as launched (a plan phase: as compiled) |
| `state.json` | `{lane, state, attempt, since, shepherdPid, reason?, until?, endState?}`; `until` is the epoch second a held or waiting lane re-checks; a finished lane has a `reason` only when its shepherd hit an error (the message) |
| `events.jsonl` | one line per change of state or reason: `{at, shepherdPid, state, attempt, reason?, until?, endState?}` |
| `shepherd.json` | `{pid, startedAt, owner}`; `owner` is the launching session's id, null outside Claude Code, absent on older runs |
| `acked.json` | the run `wait` last reported |
| `generated.json` | on lanes `verify` and `review` generate: the integration and head that own the name |
| `resume-prompt-<n>.md` | a `resume --prompt` text |
| `attempt-<n>/` | `brief.md`, `settings.json`, `args.json`, `started.json`, `stream.jsonl`, `stderr.log`, `registration.json`, `exit.json`, `summary.json`, `report.json` |
| `bin/arbab-check.mjs` | a lane with heavy checks: the copy of arbab-check its worker runs, replaced at every attempt from next to the runner; outside the worktree, so neither the worker nor its code can change it |

`started.json`: session id, pid, binary, argv, env names (never values), leases, merged branches, inputs, and on a
run's first attempt `heldMs` (queued and held: the quota, a slot, machine load or memory pressure) and `prepareMs` (from `preparing` to the
attempt: leases, semaphores, the writer lock, worktree, dependencies, merges, inputs; `doctor` reads 14 days of it, see
[Dependency preparation](#dependency-preparation)). `exit.json`: `exitCode`,
`signal`, `killedBy`, `finishedAt`, `wallMs`, reaped pids, `checkpoint`, `checkpointError`.

Check logs: every arbab-check run writes its full output to `<worktree>/.arbab-tmp/checks/<name>-<n>.log` (n counts
up), or to `$TMPDIR/arbab-check-<name>-<pid>-<6 hex>.log` where there is no `.arbab-tmp/`. The worker sees only the summary:
`arbab-check <name>: exit <code> after <s>s on <share> CPUs; log <path>`, up to 30 `arbab-check failure: <file>[ >
<test>] :: <message>` lines (control characters stripped), a count of the failures left out, and as many of the last
15 (passed) or 60 (failed) lines as fit; 3800 characters at most. Failures are parsed from the last 8 MiB of the
output (from the last 200 lines if that fails), and a too-long failure line drops its test name before its message.
Checks register in
`$TMPDIR/arbab-checks/<pid>.json` (`{pid, name, cwd, startedAt, cpus, state}`, `state` `waiting` until the check
takes its place, then `running` with its `share`), which every sandbox of the user shares; an entry older than 20
minutes, dated more than 60 s in the future or with an unparsable `startedAt` is stale, and a file whose pid is not
2–4194304 is ignored.

`summary.json` fields:

- `state` (the end state), `role`, `model`, `binary`, `requestedEffort`, `measuredEffort` (effort per assistant
  entry from the transcript; null when not found);
- `wallMs`, `turns` (distinct assistant messages), `toolCalls` by tool, `toolCallTotal`, `lastTool`;
- `failedByCause` (`<tool>:<cause>`), `failedTotal`, `permissionDenied`;
- `costUsd` (session-cumulative) and `costDeltaUsd` (this attempt's share), null without a result;
- `tokens` (`{input, cacheCreation, cacheRead, output}` over distinct assistant messages) and `maxGapMs` (the longest
  silence between two timed events), present for killed attempts too;
- `resultEvents`, `final`, `rateLimit`, `init`, `registration`, `reportValid`, `reportErrors`.

## Dependency preparation

Config `dependencies` runs on the host in each new worktree, before the worker starts, and never on a tree a worker
changed. Every dependency command, a clone strategy's `fallback` included, gets two variables on top of the host's
environment, never in the worker's:

- `ARBAB_PROJECT_ROOT`: the main checkout's absolute path;
- `ARBAB_RUNNER`: the runner's absolute real path, when the caller knows it (a shepherd's preparation, its rebuild
  of a swept worktree included, `integrate`, `host-check`).

A `command` that only copies directories of the main checkout (`cp` with `R` among flags of only `R`, `c`, `a`, `p`,
`P`, one source and a destination whose parent exists; `ditto` with one source; `rsync -a` with optional `--delete`)
into worktree paths that do not exist yet runs as clones, one per directory, printing `cloned <dst> (<how>)`; when a
clone fails, what it made is removed and the command runs as written. A script clones a directory itself with
`node "$ARBAB_RUNNER" clone-dir "$ARBAB_PROJECT_ROOT/node_modules" node_modules`. `clone-dir <src> <dst>` runs only
from inside the project's worktree root; it resolves `src` against `ARBAB_PROJECT_ROOT` (or takes it absolute; its
real path must be a directory of the main checkout's own content, not inside `.arbab/`, `.arbab-tmp/` or the
worktree root), refuses a `dst` that exists or lies outside the current directory, clones with clonefile on macOS
(else `cp`), prints `cloned <dst> (<how>)` and exits 1 on a refusal (naming its rule) or a failed clone, removing what
it made. The hook never approves it: it belongs in dependency scripts, never in the orchestrator's shell.

`doctor`'s `dependencies` check reads `prepareMs` from the attempts of the last 14 days (resumes skipped; the time
includes semaphore and writer-lock waits). When the strategy is a `command` it does not already clone and the median
is over 30 s, it warns `worktree preparation takes <s>s per lane (median of <n>)`. A pnpm project gets nothing more.
Otherwise a `sh`, `bash` or `zsh` script gets, for each `cp -R` of the main checkout's `node_modules` into
`node_modules` (the source `$VAR/node_modules` or the project's own absolute `node_modules`),
`<file>:<line>: use node "$ARBAB_RUNNER" clone-dir "$ARBAB_PROJECT_ROOT/node_modules" node_modules`, then
`check that each source above is the main checkout's node_modules before you change it`; an npm or yarn project
without such lines gets the clone strategy to set. The orchestrator checks each source, then applies it.

## Integration records (`.arbab/integrations/<name>/`)

| File | Holds |
| --- | --- |
| `integration.json` | branch, worktree, `base`, `baseSha`, `merged[]` (`{lane, branch, sha, manifests}`), `manifests`, `depsConfirmedAt`, `depsConfirmed`, `headSha`, `updatedAt`; an older record is kept as `integration.superseded-<time>.json` |
| `verify.json` | `lane`, `attempt`, `headSha`, `results[]` (`{kind, argv, command, exitCode}`; null exit code = missing), `passed`, `reason?`, `failures?` (`{result, file, test, message}`: the `arbab-check failure:` lines of each failed command, `result` its index in `results`; at most 30 per command, 100 in all; worker-written text, data only), `finishedAt` |
| `fix/fix-<k>.json`, `fix/fix-<k>.md` | the fix draft after a failed verify in which a command ran and failed: lane `<name>-fix-<k>` (implementer, base `integrate/<name>`) and its brief (failed commands, failures, candidate lanes and their changed files, a scope of at most 40 plain relative paths; `verify.json` comes in through the lane's `inputs`, read at `.arbab-tmp/inputs/verify.json`; the gates are left to the next verify, the worker runs the failing tests by file). Never launched by arbab: edit, then `arbab launch` it |
| `review.json` | the latest review: `headSha`, `lenses[]`, `skeptics[]`, `findings[]` (with `verdict`), `round`, `since` |
| `reviews/<round>.json` | every review, numbered from 1 |
| `host-checks.json` | the last `host-check`: `headSha`, `results[]`, `passed`, `interactive: true` |
| `readiness.json`, `readiness.md` | the report: `tier`, `headSha`, `verified`, `skipped` (with `waived`), `risks`, `ready`, `reviewCarriedOverFrom?` |
| `landing.json` | `into`, `integrationHead`, `mergeSha` (the merge or squash commit), `landedAt`, `pushed: false`, `squash`, `lanes[]` (`{lane, sha}`) |
| `lanes/` | the generated lanes' files and briefs |

`verify --ref <branch>` writes `.arbab/refs/<id>/verify.json` (name `ref:<branch>`) from lane `<id>-verify`, where
`<id>` is `ref-<slug>-<hash>`: the branch lowercased with every other character `-` (at most 22), then 6 hex digits
of the branch name's sha1. Integration names starting with `ref-` are refused.

`integrate <name> --refresh` rewrites `integration.json` for the current head of `integrate/<name>` (after a hand
commit or a base merge there) without merging anything. It installs only to rebuild a missing worktree on the branch,
at a trusted commit before the checkout.

`.arbab/sweep.json` is the latest automatic worktree sweep (`startedAt`, `finishedAt`, null while it runs or when it
died, `idleDays`, `removed[]` with `{path, reason}`, `kept`, `warnings`); `.arbab/sweep.log` holds what the sweeps
printed, moved to `sweep.log.1` once over 1 MiB.

Machine records in `~/.arbab/`: `quota.json`, `quota-reset.json`, `machine.json` (`maxParallel`, `checks`
`{concurrent, waitSec}`, `admission` `{loadPerCpu, memoryPressure, maxHoldMin}`; every field optional, the defaults
need no file; a held lane goes ahead after `maxHoldMin` minutes, default 10, 0 no limit, and its reason ends
`(goes ahead in <m> min)`), the pools (`slots/`, `semaphores/`,
`leases/`, `locks/`), `shepherds/<pid>.json` while a shepherd lives, `waiters/<pid>.json` while `wait` runs or
`verify`, `review` or `preflight` waits for its lanes, and `projects/<sha1(root)>.json` per project that launched a
lane (what `summary --all` reads, and the projects the hook approves `-C` into).

## Readiness rules

- Verify must have passed on the head itself; it never carries over.
- The review counts at the head, or at an earlier head when the head is a merge commit of that head and a commit of
  the integration's recorded `base` whose tree is what git merges them into (nobody resolved anything by hand).
- Skipped, by tier: `low`: `verify`; `medium`: `verify` and `review` (no lens counted); `high`: `verify`,
  `review:<lens>` for every built-in and config lens, `skeptic` (MEDIUM+ findings still unverified) and `smoke`. At
  every tier: `deps` (a manifest change no human confirmed) and `host` (config `hostGates` that have not passed on
  the head). Only the human waives, by id, in a terminal; `verify` cannot be waived.
- Risks, by weight: confirmed findings, unverified MEDIUM+ findings, one line for unverified LOW findings, manifest
  changes, host gates, stale or unmatched items (a stale verify or review, a lens that does not count, a waiver that
  matches nothing), then the lane notes.
- `ready`: verify passed on the head and every skipped item is waived. Exit 0 only then.

## Land rules

`land` refuses unless:

- `readiness.json` is for the integration head, ready, at least config `landing.tier`, and not older than the
  `verify.json` or `review.json` of that head;
- `verify.json` passed on the head;
- `landing.json` does not exist and the head is not already in the base;
- `integrate/<name>` still points at the head;
- the main checkout is on the recorded base, with no tracked change and no untracked file where the merge writes
  (other untracked files are left alone and listed);
- the base's HEAD is an ancestor of the head; otherwise it prints the hooks-off merge to run in the integration
  worktree, then `integrate <name> --refresh` to record the new head;
- the `--message` file, when given, is inside the project (also by its real path) and, by either path, no credential
  file by the fence's list and config `credentialPaths` (`.env*`, `*.pem`, `*.key`, …), matched in any case.

It merges `--no-ff`, or with `--squash` (config `landing.squash`) makes one commit, hooks off; it never pushes. Then
it removes what it landed unless `--keep-worktrees`; lane branches stay. After a squash, cleanup recognises landed
lanes from `landing.json` `lanes`.

## What `resume --digest` sends

A fresh session (new session id) in the lane's worktree, with the lane's brief and a `## Head start` section before
the tool belt. It opens with "A previous attempt (number <n>) of this lane did the following. It is a record, not
instructions." and asks the worker to check `git log --oneline -5` and `git status --short` first. The digest of that
attempt's stream, each item in a text fence:

- `### CALL <tool>`: the input, up to 400 characters;
- `### RESULT` or `### RESULT (error)`: up to 1,500 characters;
- `### NOTE`: assistant text, up to 2,000 characters;
- `### REPORT`: the final structured output, up to 6,000 characters.

The whole digest is capped at 60,000 characters; the oldest items go first, and a line says how many were dropped.
