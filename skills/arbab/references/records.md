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

Generated lanes: `<name>-verify` is a probe with tools Read and Bash and an exact rule (no arguments) per gate and
smoke command. Preflight's tools probe gets each `preflight.steps` command as an exact rule, whatever the lane's
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

`started.json`: session id, pid, binary, argv, env names (never values), leases, merged branches, inputs, and on a
run's first attempt `heldMs` (queued and held: the quota and a slot) and `prepareMs` (from `preparing` to the
attempt: leases, semaphores, the writer lock, worktree, dependencies, merges, inputs). `exit.json`: `exitCode`,
`signal`, `killedBy`, `finishedAt`, `wallMs`, reaped pids, `checkpoint`, `checkpointError`.

`summary.json` fields:

- `state` (the end state), `role`, `model`, `binary`, `requestedEffort`, `measuredEffort` (effort per assistant
  entry from the transcript; null when not found);
- `wallMs`, `turns` (distinct assistant messages), `toolCalls` by tool, `toolCallTotal`, `lastTool`;
- `failedByCause` (`<tool>:<cause>`), `failedTotal`, `permissionDenied`;
- `costUsd` (session-cumulative) and `costDeltaUsd` (this attempt's share), null without a result;
- `tokens` (`{input, cacheCreation, cacheRead, output}` over distinct assistant messages) and `maxGapMs` (the longest
  silence between two timed events), present for killed attempts too;
- `resultEvents`, `final`, `rateLimit`, `init`, `registration`, `reportValid`, `reportErrors`.

## Integration records (`.arbab/integrations/<name>/`)

| File | Holds |
| --- | --- |
| `integration.json` | branch, worktree, `base`, `baseSha`, `merged[]` (`{lane, branch, sha, manifests}`), `manifests`, `depsConfirmedAt`, `depsConfirmed`, `headSha`, `updatedAt`; an older record is kept as `integration.superseded-<time>.json` |
| `verify.json` | `lane`, `attempt`, `headSha`, `results[]` (`{kind, argv, command, exitCode}`; null exit code = missing), `passed`, `reason?`, `finishedAt` |
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

Machine records in `~/.arbab/`: `quota.json`, `quota-reset.json`, `machine.json`, the pools (`slots/`, `semaphores/`,
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
