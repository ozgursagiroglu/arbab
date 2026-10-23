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

**Runner calls are bare.** Type that one form, quotes included, and nothing around it: no `cd`, `&&`, `;`, pipes,
`2>&1`, `tail` or shell variables. From a parent folder of several repositories, put `-C <repo>` before the command:
`node "${CLAUDE_PLUGIN_ROOT}/dist/arbab.mjs" -C <repo> status`. The plugin's PreToolUse hook approves bare calls (the
skill's `allowed-tools` grant lasts only for the turn that loaded it); a wrapped call waits for a person's click,
which is what stalled real runs overnight. It never approves `land`, and approves `-C <repo>` only for an absolute
path to a project that has launched a lane, never a lane worktree (arbab refuses those as projects) or a temp dir.
`arbab <command> --help` prints a command's options. Exit codes: 0 ok, 1 usage or lint error, 2 runtime error,
3 wait timeout.

## When to fan out

Fan out when the work is long or multi-phase and splits into parts that can be built independently. Measured:

- the same 7 lanes finished 0 of 7 in 73 min as Workflow agents, and 7 of 7 in 1.9–6.4 min each as headless
  workers;
- approval waits took 62–70% of the Workflow's wall time; a headless denial costs one turn, not a wait.

Stay in-session for small jobs (one change, one PR: for example `/ship`) and for short fan-outs that finish in
minutes (Workflow). A lane pays for a worktree, a brief and a report; it earns that back only on real work. An
urgent small fix (a demo is running, a one-line change) stays in-session, even inside an arbab session.

## Before the first launch

1. Run `arbab doctor`. It checks the claude binary and version, node, git, sandbox availability, the config, the
   ignored roots, the plugin hook, the gates against the repository's check scripts and CI, env templates, lint and
   test configs that would scan `.arbab/`, disk and the machine cap. Fix every failure; read every warning.
2. Write `arbab.config.json` at the project root, or `.arbab/config.json` in a client repository that should carry
   no arbab file (the root file wins when both exist). Missing means all defaults, which grant no project commands.
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
   - `hostGates`: argv arrays for checks the fence cannot run (Docker, a browser, a database); see [Land](#land).
   - `fence.readableEnvFiles`: tracked env templates (`[".env.example"]`) that workers may read with shell commands
     (not the Read tool; `doctor` warns about untracked ones); `fence.bashOutputMaxChars`
     (4000–128000, default 100000): longer Bash output goes to a file workers cannot read.
   - `landing.tier` (default `medium`), `landing.squash` (one commit per landing), `verify.smoke`, `review.lenses`.
   - `env` (non-secret values), `passEnv` (names of host variables to pass), `credentialPaths` (extra denies),
     `maxParallel` (default 4), `quota.holdAbove`, `roles.<role>` overrides, `baseBranch`.
3. Machine-wide parallelism goes in `~/.arbab/machine.json` (`{"maxParallel": 6}`): it caps every project's
   `maxParallel`.
4. arbab excludes `.arbab/` as a whole, and `.arbab-tmp/`, in `info/exclude` and checks it. Lane files, briefs, plans
   and helpers you keep under `.arbab/` (say `.arbab/lanes/`) do not dirty a client repository's checkout; arbab
   itself writes `.arbab/plans/<plan>/`.

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
| `inputs` | Files or folders outside the repository the worker must read (absolute, `~/` or project-relative; at most 20, 50 MB in all). Copied afresh to `.arbab-tmp/inputs/<name>` on every run and named in the brief; credential paths are refused |

Role defaults:

| Role | Tools | Model / effort | Budget / wall / idle | Loopback | Writes |
| --- | --- | --- | --- | --- | --- |
| implementer | Read Edit Write Glob Grep Bash | opus / high | $10 / 60 / 20 min | yes | worktree |
| verifier | Read Edit Write Glob Grep Bash | opus / high | $10 / 60 / 20 min | yes | worktree (after the builder) |
| reviewer | Read Glob Grep Bash | opus / high | $5 / 30 / 15 min | yes (tests listen) | none |
| researcher | WebSearch WebFetch | opus / medium | $5 / 40 / 15 min | n/a | none (no local tools) |
| probe | Read Write Bash | haiku / low | $0.5 / 10 / 5 min | yes | worktree |

Set effort explicitly when it matters; do not raise it by habit. Example:
[references/lane-example.json](references/lane-example.json). Each role's report fields and default Bash allowlist,
and every record arbab writes: [references/records.md](references/records.md).

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
- **Disjoint scopes.** `plan check` refuses overlapping write scopes between phases not ordered by a dependency;
  a bare path (`src/plan`) covers everything under it.
- **Dependencies only where a phase needs another's code.** Every extra edge serialises the plan for nothing.
- **Shared contracts first.** Write and commit the types, interfaces and schemas the phases share on the plan's
  `base` yourself, before the first wave; no phase owns them.

Commands:

- `arbab plan check plans/<name>.json`: validates the plan, lints every phase's lane and prints the waves. Fix
  every error before launching.
- `arbab plan next plans/<name>.json`: launches every phase whose dependencies all finished `success` and that has
  not run yet; lists blocked and failed dependencies. It is idempotent. Run it once to start, then **after each
  `wait` notification**, once you have handled the finished lane. There is no plan daemon.
- `arbab plan next plans/<name>.json --retry <phase>`: first relaunches a phase that ended in anything but
  `success`, or was orphaned, as a fresh session in its own worktree on its checkpoint commits; its dependents then
  wait for it. Fix its brief first when the brief was the cause.
- `arbab plan status plans/<name>.json`: one row per phase with its wave, dependencies and lane state.

A merge conflict while a phase's worktree is set up fails that launch with the conflicting paths: you resolve it
(usually a scope that should have been disjoint), never the worker.

## Launch

1. `arbab lint lanes/<name>.json` for every lane: profile, brief and config. Fix every error; read every warning.
2. Before the **first wave of a project** (and after a CLI upgrade or a fence change), run
   `arbab preflight lanes/<name>.json`. A cheap probe attempt checks the toolchain, the fence, the isolation
   flags and the pinned version, and makes one call on the lane's own model. Do not launch a wave until it passes.
3. Once per session, before launching, start `arbab ui` as a **background** Bash call (`run_in_background: true`).
   - It serves a read-only scene of the lanes on 127.0.0.1: each lane a worker building a pyramid. It opens the scene
     in the human's browser, and then its output carries no token.
   - When no browser opens, it prints the URL with this session's token instead: give that URL to the human.
   - The scene is for the human. You still react to `wait` and read `arbab report <lane>`.
4. `arbab launch lanes/<name>.json` for each lane. It returns as soon as the lane's shepherd has started and prints
   the lane, its run dir and the shepherd pid. A lane without a free slot, or launched above the quota threshold,
   waits in state `held`. A lane that is already running (or being launched) is refused.

## Wait

- Start `arbab wait --any` as a **background** Bash call (`run_in_background: true`). You get a task
  notification when a lane finishes; keep working meanwhile.
- `wait` is level-triggered: it prints every finished lane not yet acknowledged, acknowledges it and exits. After
  each notification, handle that lane, run `arbab plan next` if the lane belongs to a plan, then start a new
  background `wait --any` for the rest.
- Without lane names, `wait --any` (and `--all`, which waits until every run finished) covers this session's runs
  and older runs without an owner; `--all-sessions` covers every session's runs. Named lanes are waited for whoever
  launched them. `wait --notify` also sends a desktop notification per finished lane.
- The plugin's Stop hook blocks ending your turn while lanes this session launched run and no `wait` of this session
  watches them (`verify`, `review` and `preflight` count while they wait); it names the `wait` command to start.
- With its next message, a returning session hears what **other** sessions landed while it was away (its own are left
  out), here or below its folder; `summary --since <when>` (`2h`, `1d`, `YYYY-MM-DD` as midnight UTC, ISO with `Z` or an offset) lists them.
- React to each finish while the others run: review it, fix its brief, launch its follow-up. No barrier.
- When the human asks where things stand, answer from `arbab summary` (lanes by state, plans, integrations by stage,
  what needs attention, quota and slots; `--all` across every repository that launched a lane on this machine) and
  `arbab report <lane>` (an attempt's metrics and report; `--attempt <n>` for an earlier one), not from JSON read by
  hand. `arbab status [--active] [--mine]` gives one row per lane; use it when you need a picture, not in a loop.
- **Never poll or tail streams into your context.** `arbab report <lane>` reads the attempt's `summary.json` and
  `report.json` under `.arbab/runs/<lane>/attempt-<n>/` for you.
- Use `arbab stop <lane>` to kill a worker that is going the wrong way; it will not auto-resume.

## End states

Each attempt's `summary.json` carries one end state, classified from the whole stream, never from the exit code.
The full table, with what to do for each: [references/end-states.md](references/end-states.md).

- `success`: read the report (`arbab report <lane>`). A `done` with failing checks or a `partial`/`blocked` is still
  your decision.
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
  bounds them (slots are shared by every project on the machine), and `~/.arbab/machine.json` caps it.
- The margin below 1.0 is **your** headroom: you must still be able to read reports and land. Do not set the
  thresholds to 1.0. Snapshots are lower bounds; other sessions keep spending.
- After the human switches to another account because one is full, run `arbab quota --refresh`: one tool-less
  haiku call reads the new account's windows, replaces the snapshot and counts as a reset. `arbab quota --reset`
  only deletes the old snapshot; use it when the refresh call cannot run. Without either, the old account's snapshot
  holds every lane until its reset. Held lanes re-read the quota every minute; lanes in `waiting-reset` go on only
  after such a reset (or at the old reset time).

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

Review rounds:

- A round that finds only LOW findings ends the review: they go to risks, not to another round.
- A fix round runs `arbab review <name> --since <sha>`, with the head the last round reviewed: the reviewers diff
  from that commit (an ancestor of the head) instead of the base.
- A lens text for one round goes in a file inside the project (no credential file, `.env*` included, in any case):
  `--lens-file <lens>=<file>` adds that lens, or replaces its text, for this run only. Do not edit `review.lenses`.
- `--lenses a,b` re-runs some lenses and keeps the others' findings when the head is the same. Every round is kept
  in `reviews/<round>.json`; readiness shows each round's counts.
- A re-run of `review` or `verify` on the same head, after a timeout, takes the results of its lanes that finished
  meanwhile and waits for those still running.

A verifier lane that may fix runs after its builder, in the builder's worktree, from the builder's commit.

## Land

Landing works on a named integration; its records live in `.arbab/integrations/<name>/`. The detail, step by step:
[references/landing-checklist.md](references/landing-checklist.md).

1. `arbab integrate <name> --lanes a,b` (or `--plan plans/<p>.json`, in wave order) merges each finished lane's
   branch into `integrate/<name>`, in its own worktree, never the main checkout. A conflict aborts and names the
   paths. `arbab integrate <name> --adopt <ref> [--base <branch>]` instead makes an integration of a branch built
   outside lanes, so it gets verify and review; the base must be a branch (`land` merges into it) and, as the install
   runs at the fork point, one contained in config `baseBranch`. A lane whose change can alter an install (a lockfile, `.npmrc` or another manifest, or
   a `package.json`'s dependency fields or install scripts) is merged but flagged and **not installed** (that would run
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
   - **risks**: other sessions the landing affects (`session:<id>`), confirmed and unverified findings, the merged
     lanes' `open_questions` and `not_verified`, and manifest changes. Add what arbab cannot see: facts from live
     data, an eval not re-run, a page never opened.

   Each skipped item has an id (`verify`, `review`, `review:<lens>`, `skeptic`, `smoke`, `deps`, `host`) and stays
   until it runs or the **human** waives it by that id. Waivers are the human's: `--waive` needs a terminal, so your
   shell cannot run it; show the human the command. `verify` cannot be waived: readiness and `land` require it to have
   passed on the head. A review stays current when the head adds only a clean merge of the integration's own base;
   verify never carries over. Exit 0 when ready.

   Checks the fence cannot run (Docker, a browser, a database) go in config `hostGates`. Readiness lists them
   (`host`) until they passed on the head; the human starts `arbab host-check <name>` in a terminal, because it runs
   worker code on the host. Never run them on the host yourself.
5. **Ask the human**, showing `readiness.md`. On a yes, `arbab land <name>` (one commit: `--squash --message <file>`,
   a file inside the project and no credential file, or config `landing.squash`). The hook never approves `land`.
   - Tell each session readiness names, with SendMessage, what the landing changes and when, then land. Find it in
     ListAgents by the lanes and projects named, not the 8-character id. `land` merges in the same call as its
     warnings: a last record, naming sessions new since. Run in a terminal, both name yours too. Hold if one asks.
   - It refuses unless:
     - readiness is ready for the integration head, newer than its verify and review, and at least
       `config.landing.tier`;
     - verify passed there;
     - the main checkout is on the integration's recorded base, with no tracked change and no untracked file where
       the merge writes (other untracked files are left alone and listed);
     - the base has not moved past the integration: its HEAD is contained in the verified head. If it moved, merge
       the base into the integration worktree with hooks off (the command `land` prints:
       `git -C <integration worktree> -c core.hooksPath=/dev/null -c core.fsmonitor=false -c diff.ignoreSubmodules=all -c submodule.recurse=false merge --no-verify --no-edit <base>`; a plain `git merge` there would run worker-written hooks on the host), then record
       the new head with `arbab integrate <name> --refresh` and run verify, review and readiness again.
   - Then it merges `--no-ff` (`Land <name>`), or makes one squash commit, with hooks disabled (the branch holds
     worker code), writes `landing.json` and prints the push command.
   - **It never pushes.** Push and deploy are human actions; say that nothing was pushed.
   - Then it removes the worktrees of the lanes it landed, the generated lanes and the integration (`--keep-worktrees`
     skips this) and deletes the generated lanes' and the integration's branches; lane branches stay, as later plan
     phases merge them by name. It keeps anything active, orphaned, dirty or unmerged and says why; tell the human.
   - A landed integration's name is closed: the next round gets a new name.
6. After landing, `arbab verify --ref <base>` checks the base once more, in the fence: M1 had a test failing only on `main`.

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
