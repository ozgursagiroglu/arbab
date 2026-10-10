---
name: arbab
description: Orchestrate long or multi-phase work through fenced headless Claude Code workers (claude -p), one git worktree per lane. Use when a job splits into independent parts that each take more than a few minutes, or must survive usage limits. You plan, write narrow decided briefs, launch lanes, react to each finish and land through gates and a human decision; the arbab runner handles worktrees, sandbox fences, quota holds, auto-resume and measured reports.
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/arbab.mjs" *)
---

# arbab — the method

You are the orchestrator. You plan, write briefs, read reports and land. The runner does the mechanics: it launches
headless `claude -p` workers in their own worktrees, fences them, supervises them and records everything on disk.
Never re-implement the mechanics in prompt text or scripts.

Every command below is the runner. `arbab <cmd>` is shorthand for:

```
node "${CLAUDE_PLUGIN_ROOT}/dist/arbab.mjs" <cmd>
```

Always type the full form, quotes included, so the skill's `allowed-tools` rule matches and a plugin path with
spaces in it stays one argument. Exit codes: 0 ok, 1 usage or lint error,
2 runtime error, 3 wait timeout.

## When to fan out

Fan out when the work is long or multi-phase and splits into parts that can be built independently. Measured:

- the same 7 lanes finished 0 of 7 in 73 min as Workflow agents, and 7 of 7 in 1.9–6.4 min each as headless
  workers;
- approval waits took 62–70% of the Workflow's wall time; a headless denial costs one turn, not a wait.

Stay in-session for small jobs (one change, one PR: for example `/ship`) and for short fan-outs that finish in
minutes (Workflow). A lane pays for a worktree, a brief and a report; it earns that back only on real work.

## Before the first launch

1. Run `arbab doctor`. It checks the claude binary and version, node, git, sandbox availability, the config and the
   ignored roots. Fix what it reports before anything else.
2. Write `arbab.config.json` at the project root. Missing means all defaults, which grant no project commands.
   The fields that matter first:
   - `commands.<role>`: command prefixes each role may run, e.g. `"implementer": ["pnpm test", "pnpm typecheck"]`.
     Each prefix becomes `Bash(<cmd>)` and `Bash(<cmd> *)`. Never a bare runner (`pnpm`, `node`, `npx`, `python`,
     …): lint refuses "any code" prefixes.
   - `gates`: the repository's gates as argv arrays, e.g. `[["pnpm", "typecheck"], ["pnpm", "test"]]`.
   - `preflight.steps`: argv arrays the preflight probe runs in the lane's worktree.
   - `instructions`: files inlined into every brief, e.g. `["CLAUDE.md"]`. Workers do not load CLAUDE.md.
   - `dependencies`: `{"strategy": "command", "command": [...]}` to install in each new worktree (outside the
     sandbox), or `none`. Never symlink the main checkout's `node_modules`.
   - `resources` (`{"port": {"range": [4100, 4199]}}`) and `semaphores` (`{"staging-db": 1}`) for shared things.
   - `env` (non-secret values), `passEnv` (names of host variables to pass), `credentialPaths` (extra denies),
     `maxParallel` (default 4, machine-wide), `quota.holdAbove`, `roles.<role>` overrides, `baseBranch`.
3. arbab keeps `.arbab/` git-ignored itself (it writes `info/exclude` and checks it).

## Plan

- Split the work into lanes whose **write scopes are disjoint**: each lane owns paths no other running lane
  writes. Shared contracts (types, interfaces, schemas) are written by you, before the wave, not by a lane.
- **Make the design decisions now.** Workers run headless; nobody answers their questions. Every choice you leave
  open becomes a guess, a stall or a conflict at landing.
- Order lanes into waves: a lane that needs another's output goes in the next wave (a plan does this for you;
  see [Plans](#plans)). A verifier that may fix code
  runs after its builder, in the builder's worktree (lane field `worktree`), under the same writer lock.
- Pick the role per lane: `implementer` builds, `verifier` checks and fixes, `reviewer` reads, `researcher` reads
  the web only, `probe` is for preflights.

## Write each brief

A brief source is Markdown with `##` sections; arbab assembles the prompt around it (role and isolation, project
rules, tool belt, report schema). Sections:

- `## Task` (required): what to build, decided. Name files, functions and behaviour.
- `## Scope` (required): the paths this lane owns. Everything else is read-only.
- `## Acceptance` (required): checkboxes the report can be judged against, including the checks by name.
- `## Facts`: measured things, each with its source (a file, a command and its output, a doc).
- `## Unverified`: guesses and assumptions, kept apart from Facts so the worker checks them first.
- `## Notes`: anything else. Unknown sections are moved under Notes (lint warns).

Rules:

- **Narrow and decided.** One task, its choices made. A worker that has to design burns turns.
- **Facts apart from guesses.** A guess written as a fact is the most expensive line in a brief.
- **Exact signatures** where lanes must fit together. Put them in a `ts` (or other language) code fence: lint
  reads shell fences (and fences with no language) as commands.
- **No compound commands.** One command per line. Lint checks **command spans** only: every line of a shell
  fence, inline code in `## Acceptance`, and inline code its line introduces as something to run (the text before
  it ends with "run", "runs", "execute", "call", "with the command" or "Bash:"). There it refuses `cd`, `&&`,
  `||`, `;`, `$(…)`, backticks, `sleep`, `echo $?`, `| tail` and `| head`, and any command the lane's profile
  would deny. Inline code elsewhere is descriptive (a parameter name, a command in Facts, a command a test should
  reject); write it freely, but never introduce a command the worker may not run with "Run".
- **Name the checks** the worker must run and report, e.g. `pnpm typecheck` and `pnpm test`.
- Point at files rather than pasting them; the brief warns above 40,000 characters.

A complete example: [references/brief-template.md](references/brief-template.md).

## Lane file

A lane file (`lanes/<name>.json`) names the brief and overrides role defaults. Paths are project-relative.

| Field | Meaning |
| --- | --- |
| `name` | Required. `^[a-z0-9][a-z0-9-]{0,47}$`; also the branch `arbab/<name>` and the worktree name |
| `role` | Required. `implementer`, `verifier`, `reviewer`, `researcher` or `probe` |
| `brief` | Required. The brief source |
| `base` | Branch or commit the worktree starts from (default config `baseBranch`) |
| `worktree` | Work in another lane's worktree (a verifier after its builder) |
| `tools` | Narrow the role's tools (never widens): e.g. `["Read", "Bash"]` for a lane that must not write |
| `model`, `effort` | Override the role's model and effort (`low` … `max`) |
| `budgetUsd`, `wallMin`, `idleMin` | Per-attempt budget, wall clock and idle limits |
| `fence` | `strict` (default) or `sandbox-auto` (sandbox is the only wall; broader commands) |
| `allow` | Extra permission allow rules (linted) |
| `schema` | A report schema file; defaults to the role's schema |
| `resources`, `semaphores` | Leases (`{"port": 2}` → `ARBAB_PORT_0`, `ARBAB_PORT_1`) and semaphore names |
| `checkpoint`, `autoResume`, `maxAttempts` | Commit WIP on exit; resume after usage limits; attempt cap |
| `coordination` | Sibling lanes and their scopes, inlined into the brief |

Role defaults:

| Role | Tools | Model / effort | Budget / wall / idle | Loopback | Writes |
| --- | --- | --- | --- | --- | --- |
| implementer | Read Edit Write Glob Grep Bash | opus / high | $10 / 60 / 20 min | yes | worktree |
| verifier | Read Edit Write Glob Grep Bash | opus / high | $10 / 60 / 20 min | yes | worktree (after the builder) |
| reviewer | Read Glob Grep Bash | opus / high | $5 / 30 / 15 min | no | none |
| researcher | WebSearch WebFetch | opus / medium | $5 / 40 / 15 min | n/a | none (no local tools) |
| probe | Read Write Bash | haiku / low | $0.5 / 10 / 5 min | yes | worktree |

Set effort explicitly when it matters; do not raise it by habit. Example:
[references/lane-example.json](references/lane-example.json).

The fence also denies writes to the repository's shared git directory (the main checkout's `.git`). Measured in
M1: without that deny, code a worktree's worker runs can write loose refs there. Do not add an allow rule or a
`sandbox-auto` fence to get around it; the runner, not the worker, commits, merges and creates branches.

## Plans

For more than a handful of lanes, write a plan (`plans/<name>.json`) instead of launching lanes one by one:

```json
{
  "name": "m2",
  "base": "main",
  "defaults": { "role": "implementer", "effort": "high", "budgetUsd": 10 },
  "phases": [
    { "name": "m2-plan", "brief": "lanes/m2-plan.md", "scope": ["src/plan/**"] },
    { "name": "m2-wire", "brief": "lanes/m2-wire.md", "scope": ["src/commands/plan*.ts"], "dependsOn": ["m2-plan"] }
  ]
}
```

A phase is a lane (the lane-file fields) plus `scope`, its write globs (required), and `dependsOn`. A phase starts
in a new worktree with its dependencies' branches merged in and their reports inlined into its brief; the other
phases of its wave become its `coordination`.

Converting a design document into a plan:

- **One phase per lane**, each with a brief written as above.
- **Disjoint scopes.** `plan check` refuses overlapping write scopes between phases not ordered by a dependency.
- **Dependencies only where a phase needs another's code.** Every extra edge serialises the plan for nothing.
- **Shared contracts first.** Write and commit the types, interfaces and schemas the phases share on the plan's
  `base` yourself, before the first wave; no phase owns them.

Commands:

- `arbab plan check plans/<name>.json`: validates the plan, lints every phase's lane and prints the waves. Fix
  every error before launching.
- `arbab plan next plans/<name>.json`: launches every phase whose dependencies all finished `success` and that has
  not run yet; lists blocked and failed dependencies. It is idempotent. Run it once to start, then **after each
  `wait` notification**, once you have handled the finished lane. There is no plan daemon.
- `arbab plan status plans/<name>.json`: one row per phase with its wave, dependencies and lane state.

A merge conflict while a phase's worktree is set up fails that launch with the conflicting paths: you resolve it
(usually a scope that should have been disjoint), never the worker.

## Launch

1. `arbab lint lanes/<name>.json` for every lane: profile, brief and config. Fix every error; read every warning.
2. Before the **first wave of a project** (and after a CLI upgrade or a fence change), run
   `arbab preflight lanes/<name>.json`. A cheap probe attempt checks the toolchain, the fence, the isolation
   flags and the pinned version, and makes one call on the lane's own model. Do not launch a wave until it passes.
3. `arbab launch lanes/<name>.json` for each lane. It returns as soon as the lane's shepherd has started and prints
   the lane, its run dir and the shepherd pid. A lane without a free slot, or launched above the quota threshold,
   waits in state `held`. A lane that is already running (or being launched) is refused.

## Wait

- Start `arbab wait --any` as a **background** Bash call (`run_in_background: true`). You get a task
  notification when a lane finishes; keep working meanwhile.
- `wait` is level-triggered: it prints every finished lane not yet acknowledged, acknowledges it and exits. After
  each notification, handle that lane, run `arbab plan next` if the lane belongs to a plan, then start a new
  background `wait --any` for the rest.
- React to each finish while the others run: review it, fix its brief, launch its follow-up. No barrier.
- `arbab status` shows one row per lane (state, attempt, elapsed, turns, calls, last tool, effort, failures by
  cause, cost Δ, quota). Use it when you need a picture, not in a loop.
- **Never poll or tail streams into your context.** Read the attempt's `summary.json` (classification and metrics)
  and `report.json` (the worker's validated report) under `.arbab/runs/<lane>/attempt-<n>/`.
- Use `arbab stop <lane>` to kill a worker that is going the wrong way; it will not auto-resume.

## End states

Each attempt's `summary.json` carries one end state, classified from the whole stream, never from the exit code.
The full table, with what to do for each: [references/end-states.md](references/end-states.md).

- `success`: read `report.json`. A `done` with failing checks or a `partial`/`blocked` is still your decision.
- `usage-limit`: the shepherd sleeps until the reset and resumes by itself (state `waiting-reset`), up to
  `maxAttempts`. Do nothing.
- `failed`: read the report (if any), `stderr.log` and the last events of the stream (only those). Then choose:
  - `arbab resume <lane> --prompt <file>` with a correction prompt, for a short, recent stop with a clear cause;
  - `arbab resume <lane> --digest`, for a long attempt that stopped long ago (a plain resume re-pays the whole
    context on a cold cache) or a session that went wrong. It starts a fresh session in the lane's worktree with
    a bounded digest of the latest attempt as a head start; the brief stays as it is;
  - a fresh relaunch with a corrected brief, when the brief was wrong. Relaunching a
    finished lane with the same lane file (`arbab launch lanes/<lane>.json` again) starts a fresh session in the
    same worktree, continuing from its checkpoint commits. Choose a new lane name (with `base` set to
    `arbab/<lane>` to keep the checkpoint) only when the scope changes.
- `invalid-report`: the work may be fine but the report is missing or fails its schema. Resume with a prompt
  asking for the report only.
- `unsupported-cli`: the binary cannot run the model. Run `arbab doctor`, fix the binary or the model, relaunch.
- `budget`, `max-turns`: the task was too big or the brief too open. Split it or decide more, then relaunch.
- `killed:wall`, `killed:idle`, `killed:hang-after-result`, `killed:hang-after-error`: read the last events;
  usually a stuck command or an open brief. `killed:stopped` is your own `stop`.
- `no-result`: the worker exited without a result. Treat as `failed`.
- A lane shown as `orphaned` lost its shepherd: run `arbab cleanup`, then decide as for `failed`.

## Quota

- The limit is per account: your session and every worker spend the same windows. One limit has stopped two fleets
  and both orchestrators at once.
- `arbab status` and `arbab quota` show the five-hour and seven-day windows and the hold decision.
- Launches are held while the account is rejected, five-hour use is at or above `quota.holdAbove.fiveHour`
  (default 0.85) or seven-day use at or above `quota.holdAbove.sevenDay` (default 0.95). Held lanes re-check every
  minute and after each reset.
- Parallel workers spend quota in proportion: four workers burn the window four times as fast. `maxParallel`
  bounds them machine-wide.
- The margin below 1.0 is **your** headroom: you must still be able to read reports and land. Do not set the
  thresholds to 1.0. Snapshots are lower bounds; other sessions keep spending.
- After switching to another account because one is full, run `arbab quota --reset`. The old account's snapshot
  would otherwise hold every lane until its reset. Held lanes re-read the quota every minute; lanes in
  `waiting-reset` go on only after such a reset (or at the old reset time).

## Review

Shallow review finds little: six lenses of 2–6 turns each found one bug. Review an integration (see [Land](#land))
with `arbab review <name>`, as a background Bash call; it waits for its lanes (`--timeout-min`, default 120):

- **One reviewer lane per lens**, `<name>-review-<lens>`, read-only, on the integration head, diffing against the
  integration's base. Lenses: the built-ins `correctness`, `security`, `contracts`, plus config `review.lenses`
  (`{"name": "what to look for"}`); `--lenses a,b` picks some.
- **A depth floor** in every brief: read in full every file the diff changes, and the code a finding depends on.
- **Evidence per finding**: `file`, `line`, a `failure_scenario` and `evidence`; `paths_checked` lists what was read.
- **A coverage section** (`coverage`, required by the reviewer schema). A review without coverage counts as failed.
- **A skeptic pass**: one skeptic lane per lens with MEDIUM or HIGH findings, `<name>-skeptic-<lens>`, tries to
  refute them (trace, reachability, provenance). LOW findings get none.

`review.json` keeps every finding with its verdict: `confirmed`, `refuted` or `unverified`. Exit 1 when a lane did
not succeed, 3 on timeout. Then:

- **A probe for testable findings.** When a finding can be tested (a write the fence should refuse, an input that
  should be rejected), settle it with a deterministic probe lane: a small command list the worker runs, reporting
  each step's command, exit code and output. A measured outcome beats an argued one; M1 settled both of its
  security findings this way.
- **Independent agreement counts.** Two lenses that find the same defect independently confirm it.
- Fix each confirmed finding (a new lane, then `integrate` again) or leave it as a risk for the human.

A verifier lane that may fix runs after its builder, in the builder's worktree, from the builder's commit.

## Land

Landing works on a named integration; its records live in `.arbab/integrations/<name>/`. The detail, step by step:
[references/landing-checklist.md](references/landing-checklist.md).

1. `arbab integrate <name> --lanes a,b` (or `--plan plans/<p>.json`, in wave order) merges each finished lane's
   branch into `integrate/<name>`, in its own worktree, never the main checkout. A conflict aborts and names the
   paths. A lane that changed a dependency manifest is merged but flagged and **not installed** (that would run
   worker code on the host). **This is the human's step, never yours**: show the human the manifest changes and what
   an install at that head runs (package.json scripts and the files they run, `.npmrc`, `.pnpmfile.*`); the human
   reviews them, installs in the integration worktree and runs `arbab integrate <name> --deps-installed <sha>` with
   the head `integrate` printed, in their own terminal (the CLI refuses it without one, so your shell cannot). Never
   run that install yourself: confirming lets verify and review install at that head on the host. Until then
   `verify` refuses.
2. `arbab verify <name>` runs config `gates`, then `verify.smoke`, in a probe lane `<name>-verify` on the
   integration head. **Verification runs inside the fence, never on the host**: the gates run worker-written code
   (the tests), and on the host that code would run with your credentials, network and files. Exit codes are read
   from the stream's tool results for the exact command lines, never from the model's report; a gate that did not
   run counts as failed. Lane-level green is not repo-level green: every lane's tests passed while an integration
   branch failed boot-smoke. Verify again after every `integrate`.
3. `arbab review <name>` when the tier asks for it (above).
4. `arbab readiness <name> [--tier low|medium|high] [--waive id,…]` writes the **readiness report** (FR-21):
   - **verified**: each gate and smoke command with its exit code, the lenses that ran, the findings' verdicts;
   - **skipped**: what the tier requires that did not run or did not pass. `low`: verify. `medium` (the default,
     config `landing.tier`): verify and at least one lens. `high`: verify, every lens, the skeptic pass and smoke;
   - **risks**: confirmed and unverified findings, the merged lanes' `open_questions` and `not_verified`, and
     manifest changes. Add what arbab cannot see: facts from live data, an eval not re-run, a page never opened.

   Each skipped item has an id (`verify`, `review`, `review:<lens>`, `skeptic`, `smoke`, `deps`) and stays until it
   runs or the **human** waives it by that id. Never waive on your own. `verify` cannot be waived: readiness and
   `land` require it to have passed on the head. Exit 0 when ready.
5. **Ask the human**, showing `readiness.md`. On a yes, `arbab land <name>`.
   - It refuses unless:
     - readiness is ready for the integration head, newer than its verify and review, and at least
       `config.landing.tier`;
     - verify passed there;
     - the main checkout is on the integration's recorded base and clean;
     - the base has not moved past the integration: its HEAD is contained in the verified head. If it moved, merge
       the base into the integration worktree with hooks off (the command `land` prints:
       `git -C <integration worktree> -c core.hooksPath=/dev/null -c core.fsmonitor=false -c diff.ignoreSubmodules=all -c submodule.recurse=false merge --no-verify --no-edit <base>`; a plain `git merge` there would run worker-written hooks on the host), then integrate,
       verify, review and readiness again.
   - Then it merges `--no-ff` (`Land <name>`) with hooks disabled (the branch holds worker code), writes
     `landing.json` and prints the push command.
   - **It never pushes.** Push and deploy are human actions; say that nothing was pushed.
   - Then it removes the worktrees of the lanes it landed, of the lanes generated for the integration and of the
     integration itself (`--keep-worktrees` skips this), and deletes the generated lanes' and the integration's
     branches. Lane branches stay: later plan phases merge them by name. It keeps anything active, orphaned, dirty
     or unmerged and says why; pass what it kept on to the human.
   - A landed integration's name is closed: the next round gets a new name.
6. After landing, verify the base branch once more, inside the fence (a probe lane with `base` set to it that runs
   the gates). M1's own landing found a test that failed only on `main`.

## Do not

- Name a lane `integrate-…` (the integration worktrees' namespace), or launch a lane under a name that `verify` or
  `review` generated (`<name>-verify`, `<name>-review-<lens>`, `<name>-skeptic-<lens>`): arbab refuses both.
- Expect arbab's own commits and merges to run your repository's git hooks: on the host they would be worker code
  (a hooks path like husky's resolves inside the worker-written tree). The checks those hooks run belong in
  `gates`, which run inside the fence.
- Keep executable helpers, wrappers or prompt files in your scratchpad or `$TMPDIR` while workers run: every
  sandbox can write to that per-user temp dir. Keep them in the project or `.arbab/`.
- Pass `CLAUDE_*` or editor environment (`VSCODE_*`, `CURSOR_*`, `TERM_PROGRAM`) to workers. Workers get a
  scrubbed environment and config `passEnv` refuses these names; do not work around it.
- Message workers. They are fenced off from cross-session messages; correct them with `stop` and `resume`.
- Give workers production access. They write read-only queries into their report or worktree; you review and run
  them, and put what you learn under risks.
- Raise a worker's fence (bare `Bash`, any-code prefixes, `sandbox-auto`) to make a brief pass. Fix the brief.
- Read whole streams or transcripts into your context.
- Run `stop` or `cleanup` from a sandboxed shell. They read `ps`, which a sandbox refuses, and `stop` then refuses
  to signal (the safe direction). Run them from an unsandboxed shell.
