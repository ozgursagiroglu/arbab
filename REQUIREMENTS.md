# arbab — requirements

arbab packages a method for running headless Claude Code workers. One interactive Claude Code session acts as
the orchestrator: it plans the work and launches headless `claude -p` workers, each in an isolated git worktree
with a role-based permission profile. Then it reviews and lands what they produce.

Date: 2026-10-09 · Status: requirements complete, owner decisions recorded (§10); next step `/sc:design`

Sources:

- **Machine 1** (machine-1): three orchestrator sessions that ran the method that day — project-a `project-a-7e`,
  project-a `project-a-bb` and project-b `project-b-ai-app-57`:
  - their written retrospectives ([research/retrospectives.md](research/retrospectives.md));
  - their launch scripts, settings and stream logs (kept private; the measurements are in
    [research/run-metrics.md](research/run-metrics.md)).
- **Machine 2** (machine-2): two orchestrators, `project-c-ce` and `project-d-88`, with 41 headless runs
  measured from result JSON and transcripts, and Workflow baselines for the same work
  (machine 2's report, kept private).
- The Claude Code 2.1.295 `--help` output and docs ([research/native-claude-code.md](research/native-claude-code.md)).
- An open-source landscape scan ([research/landscape.md](research/landscape.md)).

---

## 1. Problem, measured

Long multi-phase coding work with Claude Code's built-in multi-agent tooling (Workflow / "ultracode", run from
sessions at max or xhigh effort) took days:

- Data-deletion work (project-a, 2026-09-29/30) took about 1.5 days:
  - agents waited 390 min and 177 min on single shell commands, most likely unanswered permission prompts;
  - the session limit killed the run three times;
  - the review fan-out used 38 agents for 3 of 7 phases.
- In a translation workflow (2026-10-07), each subagent shell call waited about 20 min (1266 s, 1167 s) on a
  permission prompt.
- project-b P0.1 used 33 agents, took about 9.6 h, and hit session limits.
- In the WhatsApp/purge wave (2026-10-09), 4 workflow agents ran for 32 min:
  - they made 103–181 tool calls each, 3–5 tool calls per minute;
  - one agent sat for 8+ minutes in a single thinking step.

Machine 2 measured the same work before and after the switch (2026-10-08/09):

- **project-c-ce, 7 read-only research lanes.**
  - Workflow: 72.8 min plus a 10-min re-run, max effort, 602 tool calls, **0 of 7 finished**. Waits took 62–70%
    of wall time: 41 tool results took 70–1,629 s and ended in batches, which fits queued approvals.
  - Headless: 1.9–6.4 min per lane, medium effort, 198 tool calls, **7 of 7 finished**, no gap of 3 min or more.
  - Confound: 5 of the headless lanes were seeded with digests of the killed Workflow lanes. The two unseeded
    lanes were still among the fastest (1.9 and 4.7 min).
- **project-d-88, slice 3 and slice-4 prep.**
  - Workflow: slice 3 ran 960.7 min from launch to kill (about 196 active minutes) and left 3 tasks unfinished.
    In one segment, 103 of 221 tool results were approved by hand: about 64 agent-minutes of waiting.
  - Headless wave 1: 6 workers, **6 of 6 finished** within about 45 min, 0 manual approvals. They ran at
    **xhigh**, above the Workflow's high, and still made 1.35–1.7× more tool calls per agent-minute than 3 of the
    4 Workflow segments.

### Contributing causes

The relative weight of each cause is not isolated (§11, Q-bench). Machine 2 shows that unattended prompts (3) and
lost runs (7) dominate: headless won there even at a higher effort.

1. **Narrow, decided briefs.** A worker gets one task with its design choices already made, so it needs few turns.
   project-b P1.3: 49 turns in 6.1 min.
2. **Effort.**
   - The workflow agents ran at the parent session's max effort. A workflow script cannot set effort or model per
     agent; the documented `agent()` options have neither.
   - Headless workers at `--effort high` ran 5–6 tool calls per minute (stream logs: 67 calls in 13.6 min, 90 in
     15.2 min, 97 in 16.1 min).
   - The user settings set Opus 5.5 to `xhigh`, so any worker launched without `--effort` (and without
     `--restricted`/`--setting-sources`) runs at xhigh.
   - Machine 2 passed no `--effort` anywhere. Workers that inherited the user settings ran at xhigh (3.0–5.9 calls
     per minute, build and test work). Workers launched with `--setting-sources ""` ran at medium, the CLI default
     for Opus 5.5 (6.6–9.3 calls per minute, read-only research). Neither orchestrator knew which effort its
     workers used.
3. **Unattended permission prompts.** A background agent that hits a prompt waits for a human. In `-p` mode with
   `--permission-mode dontAsk --permission-prompts none`, a denial costs one turn. Machine 2: denials returned in
   0.02–0.54 s; Workflow approvals waited up to 1,629 s.
4. **Barrier.** `parallel()` waits for every agent before it continues (documented). Separate OS processes do not.
   The orchestrator handles each result as it lands, and keeps doing its own work in the meantime.
5. **Usage-limit stops.** Older workflow runs restarted from zero. Workflows now auto-continue at the limit in
   interactive sessions (v2.1.271+); `-p` workers do not. The limit is per account: on machine 2 it stopped every
   running worker of both orchestrators, and the orchestrators themselves, within 8 minutes.
6. **Orchestrator context.** Workers write JSON reports to files, so the orchestrator reads summaries instead of
   transcripts.
7. **Lost runs in the Workflow tool** (machine 2):
   - an editor restart ended an in-process workflow;
   - a SendMessage to a running workflow agent started a duplicate writer in the same worktree;
   - a resume re-ran cached agents while reporting "from cache";
   - a run record said `completed` with 3 failed agents;
   - one mistaken "no" to an approval killed a lane after 81 tool calls.

### The same work with headless `claude -p` workers, started from one interactive orchestrator (2026-10-09)

| Run | Kind | Wall clock | Turns | Cost |
| --- | --- | --- | --- | --- |
| project-a purge-B3 | implement on a stopped agent's WIP, + 21 integration tests | 13.6 min | 68 | $4.42 |
| project-a wa-B | implement | 15.2 min | 91 | $6.23 |
| project-a wa-D | implement; usage-limit stop, then `--resume` | 16.1 + 3.1 min | 98 + 15 | — |
| project-b P1.3 / P1.4 | implement | 6.1 / 4.6 min | 49 / 38 | $1.58 / $1.74 |
| project-b P0.7 × 6 sectors | research, in parallel | 5.7–12.5 min each | 54–99 | $1.05–2.36 each |
| project-b reviews × 6 | read-only lenses | about 20 s each | 2–6 | $0.33–0.52 each |
| project-a fix-404 preflight × 3 | haiku toolchain probes | under 30 s each | 2–8 | $0.017 in total |
| project-c-ce research × 7 | read-only research, medium effort | 1.9–6.4 min each | 19–43 | $1.21–2.89 each |
| project-c-ce impl × 4 | implement; all 4 hit the usage limit, then `--resume` | 11.8–20.2 min, then 0.4–43.8 min | † | $19.06 in total |
| project-d-88 wave 1 × 6 | implement, content, verify; xhigh | 12.9–42.4 min each | 77–174 | $4.58–15.55 each |

† The final JSON reports 1–3 turns for these runs, because it covers only the last turn (§3). The transcripts show
38–83 tool calls before the stop and 3–80 after the resume.

Machine 1 ran about 30 headless runs that day; project-b's 19 runs cost $21.35. Machine 2 ran 41: project-c-ce's cost
$31.98 and project-d-88's 13 finished segments $130.05. All costs are notional API-equivalent figures: both
machines run on subscriptions.

## 2. What each orchestrator built by hand

Machine 1:

| Piece | project-a-7e | project-a-bb | project-b |
| --- | --- | --- | --- |
| Launcher | `launch.sh`, `launch-review.sh` | `run.sh`, `resume.sh` | `launch-code`, `-review`, `-research`, `-code-resume` |
| Fence | `--restricted`, dontAsk + prompts none, OS sandbox (loopback-only network), allowlisted wrapper scripts, budget cap | acceptEdits, a bare `Bash` allow plus a prefix denylist, no sandbox | acceptEdits, allowlist incl. `Bash(pnpm:*)`, denylist, no sandbox; research worker gets web tools only |
| Commits | orchestrator only | worker commits locally | worker commits locally |
| Prompt source | hand-written brief | generated from the old workflow script (`gen.mjs`, `gen2.mjs`); upstream JSON report pasted in; a COORDINATION block names sibling scopes | templates with `__TASK__` and `__LENS__` placeholders |
| Report | fixed prose sections | JSON file (summary, commit, files, tests, decisions, open questions) | JSON-only final answer |
| Monitoring | `Monitor` + `tail -f \| jq`, `until [ -f exit ]` loops | `run_in_background` completion notices, ad-hoc Python | polling scripts |
| Review | one read-only reviewer | `review.mjs`: lens finders → 3 skeptics per MEDIUM+ finding, `--json-schema` | 3 lenses per phase |
| Preflight | 3 haiku runs, 4 harness bugs found | — | — |

Machine 2:

| Piece | project-c-ce | project-d-88 |
| --- | --- | --- |
| Launcher | `run.sh`, `run-impl.sh`, `run-resume.sh`, `run-eval.sh`; one background Bash call per lane | `hl-run.sh NAME [resume]`: zsh + python, `setsid` double-fork so workers survive the orchestrator |
| Fence | research dontAsk, impl acceptEdits; both `--setting-sources ""` and `--strict-mcp-config`; allowlist of read utilities + `Bash(git -C:*)`; about 60 mid-string git denies; no sandbox, no budget | acceptEdits; bare `Read` and bare `Bash` allowed; 10 prefix denies; no sandbox, no budget, setting sources not cut |
| Commits | impl workers commit on `wt/<lane>`; identity from `GIT_*` env | workers commit on feature branches; only the orchestrator pushes, applies SQL and deploys |
| Prompt source | header + lane file; research lanes seeded with digests of the killed Workflow transcripts | `common.md` + lane file; upstream findings appended with `cat >>`; a plan worker writes the next wave's prompts |
| Report | `--json-schema` (research and impl schemas) | free-text Markdown in `result`; fuller reports in project files |
| Monitoring | task notifications + about 21 status polls | `watch.sh`, restarted after every finish; `progress.py` over transcripts; `ps`/`lsof` |
| Review | the orchestrator itself (the Workflow's critic phase was dropped) | verifier lanes in the builder's worktree; they fix and commit |
| Preflight | 3 haiku runs on the PATH CLI | 3 smoke runs |

### Defects caused by hand-rolling

Machine 1:

- A `tc | tail` pipeline hid a typecheck failure, and a commit went through.
- Redis DB slots were picked by hand, and one worker nearly got the slots another was using.
- A usage-limit stop reports `subtype: "success"` with `is_error: true` and exit code 1. The reset time is only
  in the result text. The session id is only in the stream's `init` event.
- **Prefix denylists leak.** `Bash(git push:*)` does not match `git -C dir push`, and `node -e "fetch(...)"`
  gets past a `curl` deny.
- **A bare `Bash` allow or `Bash(pnpm:*)` is "any code".** `pnpm exec node -e …` and `pnpm dlx …` run anything,
  network included.
- **Credentials one directory up are exposed.** Live credential files sit one directory above the worktrees.
  Neither loose setup confined Read to the worktree or ran an OS sandbox. The strict setup's deny list covered
  `.env`, `~/.ssh`, `~/.config/gh`, `~/.aws`, `~/.netrc` and `~/.npmrc`, but not those files; its loopback-only
  network still kept them from leaving the machine.
- **A strict allowlist charges a "denial tax".** In the fix-404 run, 10 of the first 64 tool calls failed:
  - 6 were dontAsk denials: `cmd; echo EXIT=$?`, `cd … && …`, `lsof`, `ps`, `node -e`, `cat`;
  - 2 were `--restricted` refusals to read the wrapper scripts the worker was told to use, which lived outside
    the worktree;
  - 1 was `pgrep` failing inside the sandbox (no sysmond);
  - 1 was a wrong path.
- Harness behaviours the brief must anticipate:
  - `sleep N; cmd` is blocked (the worker is told to use Monitor);
  - `$(...)` was blocked inside project-b's agents;
  - haiku put `serve.sh` in the background and ran steps out of order unless told "foreground".
- Wrapper scripts kept in `/tmp` were writable from inside the sandbox, so a worker could have edited its own
  fence.
- A reused prompt carried another machine's paths and an `npx eslint` command.
- **Shallow reviewers.** Without a depth floor, 6 lenses ran 2–6 turns each and produced 1 finding. The
  orchestrator found the real bugs itself.
- Mocked-DB unit tests passed, and a bare `Date` in raw SQL crashed in production. Only a run against a real
  database would have caught it.

Machine 2:

- **Version drift.**
  - The PATH CLI (2.1.217) cannot run Opus 5.5: 7 lanes failed in 3 s with `subtype: success`, `is_error: true`.
    The haiku preflights had passed on that same CLI, because the version gate applies only to the newer model.
  - One launcher hardcoded a 2.1.294 path. Another picked the newest editor-bundled binary by lexical sort, and
    three resumed sessions switched from 2.1.294 to 2.1.295 mid-session.
- **A smoke test that lies.** On the old CLI's default model, a smoke run answered "OK 42a1a7a" — an invented
  commit SHA — in 1.8 s with no tool call.
- **Lost attempt records.**
  - One launcher overwrote the session-id file and appended every result to one JSON file. A relaunched worker's
    first session id survived only inside that appended file.
  - The other took resume ids from the error JSONs, because none were pre-assigned.
- **Missed finishes and miscounted processes.** An edge-triggered watcher missed a finish for 13 min. `ps | grep`
  counted another session's workers ("resumed procs: 7" after resuming 4).
- **A hung worker.** A limit-stopped `-p` with a background `next dev` never exited; it was killed by pid after
  1 h 49 min. Orphan listeners stayed on three ports, one reparented to PID 1.
- **Deny rules that misfire.** `Bash(timeout:*)` also blocked the Bash tool's own `timeout` parameter (5 of 5
  calls). The mid-string deny `git -C * push*` blocked `git -C x grep -n push`.
- **Tools outside the allowlist ran.** With `--allowedTools Read,Edit,Write,Glob,Grep,Bash,TodoWrite`, workers
  called `Agent` (4 Explore subagents in one lane), `Monitor` and `ToolSearch` with 0 denials. `--allowedTools`
  pre-approves; only `--tools` restricts the set (§3).
- **Inherited host configuration.** Workers whose setting sources were not cut loaded the user's allow rules,
  a plugin's hook and the MCP servers; two wrote to the shared auto-memory folder. Workers registered as interactive
  editor sessions and accepted cross-session messages.
- **Credentials inside every fence.** No setup had an OS sandbox. The workers' cwds and `--add-dir`s held private
  keys, environment files with production values, and session transcripts and scratchpads that can hold copies of
  both. One worker grepped an environment file (it masked the values).
- **Shared resources without owners.** Concurrent MongoMemoryServer starts can crash; real-model evals share a
  production API deployment's rate limit; symlinked `node_modules` let a Next standalone build reach the main
  checkout; the worktree root was not git-ignored.
- **Landing errors after the workers were done.**
  - The integration branch failed the repository's boot-smoke gate although every lane's tests had passed.
  - A push guard skipped a push silently when main moved, leaving a commit on no remote branch.
  - A DB dry run read a worktree that a verifier was rewriting.
- **The orchestrator went deaf.** It shares the account limit. It answered lane notifications and the owner with
  synthetic rate-limit replies for about 1.5 h, until the owner re-prompted it.
- **Self-reports drift from measurements.** Both orchestrators said "CLI default effort" (measured: medium and
  xhigh). One named the wrong CLI versions. One reported "2–4 turns" for resumes that made 3–80 tool calls.

## 3. What Claude Code already provides — use it, do not rebuild it

Native in 2.1.295 (details in [research/native-claude-code.md](research/native-claude-code.md)):

- **Print mode.** `-p` with:
  - output: `--output-format json|stream-json`, `--json-schema`;
  - permissions: `--permission-mode dontAsk`, `--permission-prompts none`, `--restricted`, `--tools`,
    `--allowedTools`, `--disallowedTools`;
  - configuration: `--settings` (including a `sandbox` block), `--strict-mcp-config`, `--setting-sources`;
  - model and limits: `--model`, `--effort`, `--fallback-model`, `--max-budget-usd`;
  - sessions: `-n`, `--resume <session-id>`, `--session-id`, `--fork-session`, `-w/--worktree`.
- **`--tools` restricts, `--allowedTools` approves.** `--tools` sets which built-in tools exist. `--allowedTools`
  only pre-approves; tools that need no approval (`Agent`, `Monitor`, `ToolSearch`) still run.
- **Background sessions.** `--bg`, plus `claude agents` (with `--json`), `attach`, `logs`, `stop`, `rm` and
  `respawn`. According to the docs, `--bg` cannot be combined with `-p`; this was not run locally.
- **Agent teams.** A shared task list with dependencies; experimental, behind
  `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.
- **Plugins.** A plugin can ship skills, commands, agents, hooks, MCP servers and scripts, and is distributed
  through a `marketplace.json` in a git repository.
- **`rate_limit_event` in stream-json** (checked in our wa-D log):
  - `status` is `allowed_warning` from 90% utilisation and `rejected` at the stop;
  - `resetsAt` is in epoch seconds;
  - `utilization` is reported for the `five_hour` and `seven_day` windows.
  - So limit-aware resume and quota-aware dispatch can work from data, without parsing text.
- **A usage-limit stop is classifiable from fields.** The result carries `api_error_status: 429` and
  `terminal_reason: "api_error"` (machine 2).
- **The sandbox covers shell commands only.** The file tools, MCP servers and hooks run outside it (docs, via the
  landscape scan). `--restricted` confines the file tools; `--strict-mcp-config` drops MCP. Confining the whole
  process needs `srt` (Anthropic's sandbox-runtime) or a container.

Traps a launcher must handle (observed on machine 2; details in the research file):

- The final JSON describes only the last turn when the worker used background tasks.
- Effort is inherited from user settings, or falls to medium when settings are cut. It is never "high" by default.
- An untrusted workspace drops project settings silently, while user settings, hooks, MCP servers and auto-memory
  still load.
- The Bash static analyzer, the "needs approval" rule for compound commands and the `sleep` guard refuse calls
  independently of the allow and deny lists.
- Monitor is a deferred tool in `-p`.
- Workers started from an editor register as interactive sessions.

Not native:

- a plan → dependency graph with report hand-off between tasks;
- auto-resume of a `-p` worker when a usage limit resets;
- effort or model per agent inside a workflow;
- pinning one binary across a worker's attempts;
- isolating a worker from the host's settings, environment and session registry, as one profile;
- leasing per-worker resources (ports, database names, Redis DB indexes);
- role profiles with a preflight check;
- one status view across workers, with cost and denials, and one quota view across orchestrators;
- reviewer depth floors;
- a human-gated landing protocol.

## 4. Prior art (open source)

Details are in [research/landscape.md](research/landscape.md). In short:

- **Session managers** — claude-squad, ccmanager, Conductor, Superset, Emdash, vibe-kanban, Crystal/Nimbalyst,
  and Claude Code's own agent view. They give each agent a worktree, and a human drives each one.
- **Orchestrators** — Gas Town, ruflo (formerly claude-flow), ccswarm, tsk, container-use, Aperant, CCPM,
  superpowers, and Claude Code's dynamic workflows and agent teams. Each covers part of the job.
- **Closest to arbab** — AgentOrchestration, a 1-star PowerShell prototype built on `claude -p` workers.
- **Gaps no one fills:**
  - one profile that combines an allowlist, a sandbox and a $ cap;
  - leasing a database or Redis index per worker (others handle ports only);
  - resuming a headless worker after a usage limit (Anthropic's wait does not apply to `-p` or background
    sessions);
  - human-gated merge as the default (agent view pushes; Gas Town auto-merges to main);
  - a dependency graph with schema checks across separate processes;
  - a fleet-wide cost view.

arbab is therefore a policy and composition layer over `claude -p`, not a new runtime or UI.

## 5. Goals and non-goals

Goals:

- **G1** Multi-phase work in hours, not days, without lowering the safety bar.
- **G2** Reproducible: no hand-written launch scripts, settings or pollers per task.
- **G3** Safe to leave unattended overnight: nothing stalls, nothing escapes the fence, usage-limit stops resume.
- **G4** The orchestrator's context stays small: it reads summaries and reports, not streams.
- **G5** Quota-aware: one account's limit never strands the fleet or silences the orchestrator, and effort is
  chosen per role, never inherited.

Non-goals (v1):

- a GUI, or a replacement for `claude agents`;
- cloud or remote execution;
- auto-merge, auto-push or auto-deploy;
- agent CLIs other than Claude Code;
- replacing the planning step. arbab starts from a decided plan. Analysis and design stay in the interactive
  session (for example `/sc:analyze` and `/sc:design`), and small jobs stay in-session (for example `/ship`).

## 6. Users and stories

- **U1** A solo developer on a Claude subscription (the owner). Takes half-specified briefs, analyses and designs
  them in an interactive session, then runs the phases of the plan in parallel.
- **U2** A small-team lead running an overnight batch of independent fixes.

Stories:

- **S1** As U1, I hand the orchestrator a plan, and the independent phases run as isolated headless workers
  without me writing a launch script.
  - *Accept:* no hand-written script; each worker has its own worktree and resource slots; zero permission stalls.
- **S2** As U1, I see every worker at once.
  - *Accept:* one command prints, for each worker, its state, elapsed time, turns, tool calls, last tool, measured
    effort, cost and denials, and can print the same as JSON.
- **S3** As U1, asleep at 03:00, I want a worker that the usage limit stopped to continue after the reset.
  - *Accept:* the stop is classified as a usage-limit stop from `api_error_status`, `terminal_reason` and the
    last `rate_limit_event`, and the same session id resumes after the reset, on the same binary, with the
    standard continuation message.
  - *Accept:* a real failure is never auto-resumed.
- **S4** As the owner, I want a worker that cannot push, deploy, reach the network or read secrets, even through
  code it writes and runs.
  - *Accept:* the OS sandbox blocks those actions; there is no `Bash(*)` and no skip-permissions.
  - *Accept:* the worker's cwd is its worktree. `**/.env*`, `*.pem`, `~/.ssh` and `~/.claude*` are unreadable,
    including through `--add-dir`.
  - *Accept:* the worker loads none of the host's settings, hooks, MCP servers or memory, and cannot be messaged
    by other sessions.
- **S5** As U1, I want reviewers that find real bugs.
  - *Accept:* findings follow a schema, with evidence for every path checked; MEDIUM+ findings get a skeptic pass.
  - *Accept:* a review without coverage notes counts as failed.
- **S6** As U1, I land worker output myself.
  - *Accept:* integration and verify run in a clean worktree, with the repository's gates and an optional live
    smoke test; pushing stays a human action.
  - *Accept:* every skipped or failed push is reported.
- **S7** As U1, I turn a design document (for example `/sc:design` output) into an arbab plan without
  hand-editing.
  - *Accept:* the skill writes the plan in arbab's format; the runner validates it and refuses overlapping write
    scopes.
- **S8** As U1, when the account nears its limit, new launches wait, and the orchestrator keeps enough headroom
  to answer me.
  - *Accept:* dispatch holds above a configurable threshold; status shows both windows; the queue resumes after
    the reset without me.
- **S9** As U1, every number arbab shows me is measured, not self-reported.
  - *Accept:* effort, model, binary version, wall clock, turns, tool calls, denials by cause and the cost delta of
    each attempt come from the stream and the transcript.

## 7. Functional requirements

Priority is MoSCoW. Milestone is the dogfood build order (§10); the first public release includes every row.

| ID | Requirement | Priority | Milestone |
| --- | --- | --- | --- |
| FR-1 | **Role profiles**: implementer, verifier, reviewer, researcher, probe. A profile compiles to an explicit flag set: `--tools` (the tool set itself, not only `--allowedTools`); an allowlist anchored on single commands; `--setting-sources ""` and `--strict-mcp-config`; dontAsk with `--permission-prompts none`; explicit `--model` and `--effort`; a sandbox; a budget and a time cap. The sandbox allows writes in the worktree only, loopback-only network, and no reads of credential paths (`**/.env*`, `*.pem`, `*.key`, `~/.ssh`, `~/.aws`, `~/.config/gh`, `~/.claude*`, plus project-defined paths). The worker's cwd is its worktree; `--add-dir`s are narrow and never cover transcripts or scratchpads. `Agent` is left out of the tool set unless the profile names it, and then nested agents count against the budget. Profiles are generated from the commands a task needs; a project config file can override them. | Must | M1 |
| FR-2 | **Preflight** with the same binary, flags and profile as the lanes. A cheap model checks the toolchain and the wrappers, and one call on the lanes' model catches a binary that cannot run it. It asserts at least one real tool call; an answer without one fails. It fails on the "workspace has not been trusted" warning and on any setting it did not set. It tests the generated deny rules against tool parameters (for example a `timeout:*` rule against the Bash `timeout` parameter). Every step runs in the foreground. | Must | M1 |
| FR-3 | **Worker brief contract.** The brief has these sections: role and isolation; binding rules; the task; measured facts, kept apart from unverified guesses; acceptance; a tool belt generated from the profile, with a "do not try" list; coordination (what siblings own); upstream reports; the report schema. The tool belt names the shapes the Bash analyzer and guards refuse (`cmd; echo $?`, `cd X && …`, `$(...)`, `sleep N; …`, compound loops) and the sanctioned long-wait primitive (FR-4). The brief is linted against the profile: it never asks for something the profile denies, and it says "single commands" and "foreground". | Must | M1 |
| FR-4 | **Launch.** Resolves the `claude` binary once, by numeric version at or above the declared minimum; records its path and version; reuses it for every attempt of the lane. Creates or reuses the worktree under a git-ignored worktree root; applies the project's dependency strategy (never a symlink to the main checkout's `node_modules`); leases resource slots (project-defined types: port, database, Redis DB, …) and semaphores for shared resources (for example a rate-limited external API). Takes a one-writer lock on the worktree. Pre-assigns the session id and names the session. Starts the worker in its own process group, detached from the orchestrator, with a scrubbed environment. Sets a long default Bash timeout or preloads Monitor, so the worker can wait. Writes one record per attempt (session id, binary, prompt hash, profile, start, end, exit, result) and the stream-json log into the run directory; never overwrites or appends over an earlier attempt. | Must | M1 |
| FR-5 | **Supervisor, registry and status.** One persistent supervisor per machine tracks only its own pids and session ids. Status prints one line per worker — state, elapsed, turns, tool calls, last tool, measured effort and model, cost delta, denials by cause — and the same as JSON. A level-triggered `wait` (any or all) returns as soon as a lane has finished, including lanes that finished before it was called, so the orchestrator can block on it from a background call. State is rebuilt from the run directories after any restart, never from task handles. | Must | M1 |
| FR-6 | **Lifecycle.** Classifies how each attempt ended — success, failed, usage limit, unsupported CLI or model, budget, timeout, idle, killed, invalid report — from `is_error`, `api_error_status`, `terminal_reason`, the last `rate_limit_event` and the exit code. Never from `subtype`, and never from the exit code alone. Auto-resumes usage-limit stops after `resetsAt` with the same session id and binary. Never auto-resumes a real failure. Reruns are idempotent. | Must | M1 |
| FR-7 | **Structured report**, schema-validated by the runner: summary, files, checks with exit codes, decisions, open questions, what was not verified, denial stats. An invalid report is its own end state. Metrics come from the stream and the transcript, not from the final `result`, which describes only the last turn when a worker used background tasks. | Must | M1 |
| FR-8 | **Runner-owned checkpoints**: when a worker exits, the runner (not the worker) commits a WIP checkpoint in the worktree. Workers get no git write access. This settles bb's "cheap checkpoints" against 7e's "no git writes". Revised in M3: the runner commits with hooks disabled, because a repository's hooks path can resolve inside the worker-written tree (husky); the project's checks run inside the fence through `arbab verify` instead (DESIGN.md §17). | Should | M3 |
| FR-9 | **Plan format → dependency graph.** arbab defines its own plan format: phases, dependencies, path scopes, roles, acceptance, and the commands each phase needs. The skill converts any design document (for example `/sc:design` output) into it; arbab does not depend on SuperClaude. The runner validates the plan and refuses overlapping write scopes. Downstream briefs receive upstream reports and the commit SHAs they build on. Coordination text is generated from sibling scopes. | Should | M2 |
| FR-10 | **Review pipeline**: read-only lens finders (schema'd findings, evidence per path, effort high, a coverage section), then a skeptic pass on every MEDIUM+ finding. Risk tiers follow `/ship`. | Should | M3 |
| FR-11 | **Verify before landing**: project-defined gate commands, plus an optional live smoke test (for example against a real database), in an integration worktree. The integration worktree runs the repository-level gates (for example boot-smoke), not only each lane's targeted tests. A step that reads a worktree (a DB dry run, for example) takes a commit SHA and refuses uncommitted changes. | Should | M3 |
| FR-12 | **Landing**: integrates worker commits in an integration worktree, runs verify, then asks the human. Push and deploy are never automatic. Every skipped or failed push is reported; nothing is skipped silently. | Must (the human gate) / Should (the helper) | M3 |
| FR-13 | **Denial telemetry**: aggregates refusals by cause — permission mode, deny rule, Bash analyzer, needs-approval, built-in guard, sandbox, `--restricted`, input error — and failed calls per profile, and suggests allowlist changes. | Could | M4 |
| FR-14 | **Research role with a sandboxed raw-HTTP tool** (status, headers, raw body, configurable user agent) and no local file access. WebFetch got 403s from bot-blocking publishers and cannot return raw status or XML. | Could | M4 |
| FR-15 | **Cost controls**: a budget per attempt (Must); per-attempt cost deltas, since `total_cost_usd` is cumulative per session (Must); a per-run total cap and a summary (Should). | Must / Should | M1 |
| FR-16 | **Process hygiene and cleanup**: idle and wall-clock timeouts per worker. On exit or timeout, the supervisor kills the worker's process group, reaps children (dev servers, MCP children), and releases its ports and slots. Removes worktrees when that is safe. Raised from Should: a limit-stopped worker with a background child hung for 1 h 49 min. | Must | M1 |
| FR-17 | **Quota-aware dispatch**: reads `utilization` and `resetsAt` for the five-hour and seven-day windows from the workers' `rate_limit_event`s. The limit is per account, so the threshold covers every orchestrator and worker on it. Above a configurable threshold it holds new launches and keeps headroom for the orchestrators; it resumes the queue after the reset. Status shows the windows. Raised from Should: one limit stopped two fleets and both orchestrators. | Must | M1 |
| FR-18 | **Worker isolation from the host**: workers load none of the host's user, project or local settings, plugins, hooks, MCP servers, skills or auto-memory. They do not register as interactive sessions and cannot receive cross-session messages. The preflight (FR-2) checks this. | Must | M1 |
| FR-19 | **Transcript digest seeding**: renders a killed or failed attempt's transcript into a bounded digest (calls, results, notes) that seeds a fresh attempt, as the alternative to a cold resume. Evidence: project-c-ce seeded 5 of 7 research lanes this way; a cold resume cost $18.17 for 63 tool calls, against $8.87 for the first 79. | Should | M2 |
| FR-21 | **Readiness report at landing**: three lists and a human decision. *Verified*: every gate, review verdict, smoke test and eval that ran, each with its command and exit code. *Skipped*: every check the risk tier requires that did not run; each one needs an explicit human waiver. *Risks*: open questions and `not_verified` items from worker reports, plus facts found in live data. Read-only production queries are written by workers and run only by the orchestrator. Evidence (2026-10-09, an owner's session after a fast landing): no independent review of ~1,150 changed lines (earlier rounds found 3–9 findings each), a money-path eval not re-run, a changed page never opened in a browser, a narrow sample (~290 calls), and two live-data risks found only after landing. | Must | M3 (method in M1) |
| FR-20 | **The skill (the method)**: when to fan out and when to stay in-session; how to write a decided, narrow brief; per-role model and effort defaults; how to read reports, triage reviews and land. It drives the runner through its CLI and never re-implements the mechanics in prompt text. | Must | M1 |

## 8. Non-functional requirements

- **Safe by default.**
  - The fence is an explicit tool set, an allowlist, an OS sandbox and dontAsk with prompts set to none.
  - There is no `Bash(*)`, no "any code" prefix (`pnpm:*`, `node:*`, `python3`), no skip-permissions and no
    denylist-only mode.
  - Credential paths are unreadable by default, including through the cwd and `--add-dir`.
  - Workers inherit nothing from the host: no settings, hooks, MCP servers, memory or IDE environment.
  - Wrappers and profiles live where the worker can read them but not write them.
- **Deterministic mechanics.** Launching, classifying, resuming, leasing and reaping are tested code, not prompt
  text. Exit codes are read directly, never through a pipeline.
- **Measured, not self-reported.** arbab records effort, model, binary version, turns, tool calls, wall clock and
  denials itself. Orchestrators misreported all of these on machine 2.
- **Native-first.** arbab composes Claude Code flags and features, declares a minimum CLI version, compares
  versions numerically, and fails clearly on an unsupported one.
- **Small footprint.** Few or no runtime dependencies; macOS and Linux (where the Claude Code sandbox runs).
- **Everything on disk.** Each run has one directory with human-readable files and JSON. Nothing lives only in the
  orchestrator's context.
- **Honest claims.** The README publishes only measured numbers, together with how they were measured. That
  includes the fence's cost (6–15% of tool calls refused, §9) and the confounds of every comparison.
- **Portable.** No project-specific code. Project specifics (resource types, gate commands, credential paths,
  dependency strategy) live in a config file.
- **Private research stays private.** `evidence/` and the machine reports name credential files, their locations
  and project internals; they are git-ignored and never published.
- **Within the terms.**
  - arbab runs the unmodified `claude` binary under the user's own login. It never reads, stores or proxies
    credentials, and it has no hosted mode.
  - It says plainly that N parallel workers use quota about N times as fast.
  - It calls `--max-budget-usd` what it is: a client-side estimate that does not cap subscription quota.
  - It detects the planned change that makes `--bare` the default for `-p` (bare mode does not read OAuth) and fails
    clearly.

## 9. Design tensions and the recommended resolution

| Tension | Evidence | Recommendation |
| --- | --- | --- |
| Strict fence vs denial tax | Denylists leak and "any code" prefixes leak (bb). The sandbox is the real wall (7e). A strict fence refused about 15% of calls in one machine-1 run, and 7.1% (research, dontAsk) and 5.8% (impl) on machine 2. project-d-88's bare `Bash` had 0 denials, and no wall against code it ran. | Strict by default. Preflight, brief linting and denial telemetry shrink the tax. |
| Worker commits vs no git writes | bb: cheap checkpoints, easy resume. 7e: no git write access for workers. 4 of 5 orchestrators let workers commit; their hooks were skipped or failed silently. | Runner-owned checkpoints (FR-8). |
| `-p` workers vs `--bg` sessions | `-p` has a budget cap, a JSON schema and prompts set to none. `--bg` can be attached to, but per the docs it cannot be combined with `-p`. | `-p` workers. A human takes over with `claude --resume <id>` after a stop. |
| Reviewer speed vs depth | 6 shallow lenses found 1 bug (project-b). Finders + skeptics worked (bb). project-d-88's verifier lanes, which could fix and commit, found real defects: a rollback gap, 7 fixes, 2 money defects. | A depth floor, and skeptics only for MEDIUM+. A verifier that may fix runs after the builder, under the writer lock, from a commit SHA. |
| Resume vs fresh restart | A resume keeps the context but re-pays it when the cache is cold: $5.95–$18.17 per resume at xhigh. A digest-seeded fresh run was fast on machine 2. | Resume short, recent stops; offer a digest-seeded fresh attempt for long, cold ones (FR-19). The exact rule is for `/sc:design`. |
| Effort vs quota | Medium research workers: 6.6–9.3 calls per minute and cheap. Xhigh build workers: 3.0–5.9. One account limit stops everything. | Explicit effort per role, recorded from the transcript. Never inherited. |
| Native dynamic workflows vs arbab | Workflows: one session, one sandbox, no $ cap, no per-agent effort documented, a `parallel()` barrier, no limit wait under `-p`. Machine 2 adds lost runs: an editor restart killed one, SendMessage forked a duplicate writer, a resume re-ran cached agents. Strengths: in-session, schema'd outputs, auto-continue when interactive. | arbab for long, risky or unattended multi-phase work. Workflows stay right for short in-session fan-outs. The README says so. |

## 10. Form factor and release plan (decided 2026-10-09)

The options considered:

**A — Skill only.** A SKILL.md plus reference profiles and templates, shipped as a plugin.

- *For:* nothing to install beyond the plugin; fastest to ship; matches how the method emerged; there is precedent
  (superpowers, CCPM).
- *Against:*
  - the mechanics stay as model-written scripts, so the defects in §2 come back (hidden exit codes, slot
    collisions, misread limit stops, writable wrappers, binary drift, missed finishes);
  - there is no registry or status view without code;
  - it is hard to test.

**B — Standalone CLI.** Its own repository, published as `arbab` on npm.

- *For:* deterministic and testable; runs from cron or CI without an interactive session; a clear open-source
  identity.
- *Against:* the judgement work — planning, writing briefs, triaging reviews, landing — still needs Claude, so
  either the CLI calls Claude for it or the user writes plans by hand. It also looks like the session managers.

**C — Plugin = skill + bundled runner.** The skill carries the method: when to fan out, how to write a brief, how
to review and land, the `/ship` risk tiers. A small runner CLI does the mechanics: profiles, preflight, launch,
supervisor and status, lifecycle and resume, report validation, leasing. Profile presets and brief templates come
with it.

- *For:*
  - the interactive session stays the brain, which is what worked in all five sessions;
  - the hands become tested code, which fixes §2;
  - one install from a marketplace;
  - the runner also works on its own (`arbab status`, `arbab resume`), so B stays possible later.
- *Against:* two parts to version together (one repository, one release).

**Owner decisions:**

- **Form: C.**
- **Audience and timing:** a personal tool first. Dogfood it on Project C, Project D, Project A and project-b, run
  Q-bench, then publish it as open source.
- **Scope of v1 (the first public release):** every requirement in §7.
- **Plan input:** arbab's own plan format. The skill converts design documents into it (FR-9); no SuperClaude
  dependency.

**Build order while dogfooding:**

1. **M1 — core:** FR-1 to FR-7, FR-15 to FR-18, and the skill (FR-20). From M1 on, arbab builds the rest of
   arbab.
2. **M2 — plan and seeding:** FR-9 and FR-19.
3. **M3 — checkpoints, review, verify, landing:** FR-8 and FR-10 to FR-12.
4. **M4 — telemetry and research:** FR-13 and FR-14.
5. **Public release:** Q-bench measured, a README with measured numbers only, licence and GitHub home chosen.

## 11. Open questions

Resolved on 2026-10-09:

- **Q-audience** → personal first, then open source (§10).
- **Q-form** → C.
- **Q-v1** → everything, built in milestones M1–M4.
- **Q-machine-2** → merged into this document.

Open:

- **Q-runtime** (for `/sc:design`). TypeScript on Node ≥ 20 (the owner's stack, pnpm), or a single binary?
  Claude Code's native installer does not need Node.
- **Q-sandbox** (for `/sc:design`). The Claude Code sandbox plus `--restricted` (covers Bash and the file tools),
  or whole-process `srt` or a container (also covers MCP and hooks, but heavier)? No machine-2 setup had any
  sandbox, so its credential exposure was total.
- **Q-supervisor** (for `/sc:design`). One supervisor per machine, or coordination across machines? The limit is
  per account, and the two machines most likely share one (inferred from matching stop and resume times). Every
  worker's `rate_limit_event` already carries account-wide utilisation, so per-machine dispatch may be enough.
- **Q-auth.** Both machines run on subscription OAuth. Proposed: defaults target Pro/Max subscriptions, and API
  keys are supported. Waiting on the owner.
- **Q-settings-cut** (test in M1). Do CLAUDE.md and memory still load under `--setting-sources ""`? Can an
  unscoped `Read` reach `~/.claude/sessions/*.key`?
- **Q-license.** MIT, the ecosystem default, or Apache-2.0, which adds a patent grant? Decide before the release.
- **Q-home.** The owner's GitHub account or a Diojen org? Decide before the release.
- **Q-bench.** Before the README claims any speed-up, run one controlled comparison: the same task as a Workflow at
  high effort with approvals pre-allowed, and as a headless worker at medium, high and xhigh. Machine 2's
  comparisons are confounded (digest seeding, different efforts, approval waits).
