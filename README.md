# arbab

**Run fenced, headless Claude Code workers from your interactive session.**

arbab is a [Claude Code](https://docs.claude.com/en/docs/claude-code) plugin for long or multi-part work. Your
interactive session plans and decides. arbab runs the parts as headless `claude -p` workers, each in its own git
worktree behind a sandboxed fence. It waits out usage limits and resumes, then takes the results through
integrate → verify → review → readiness → land, with a human decision at the end.

[![ci](https://github.com/ozgursagiroglu/arbab/actions/workflows/ci.yml/badge.svg)](https://github.com/ozgursagiroglu/arbab/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-d97757)
![Zero runtime dependencies](https://img.shields.io/badge/runtime%20deps-0-brightgreen)

> *arbab*: master, the one who gives the orders. Your session is the arbab; the headless workers do the work.

## Why

Long interactive sessions drift. One session plans, implements, waits on tools and tests, and fills its own context
until every step gets slower. Subagents inside that session share its limits.

arbab splits the roles:

- **You and your interactive session** plan, write narrow briefs, and decide.
- **Headless workers** each take one brief, in their own worktree and fence, with a budget and a clock. They run in
  parallel and report back in a fixed schema.
- **The arbab runner** does the mechanics:
  - worktrees, sandbox profiles and quota holds;
  - auto-resume after usage limits;
  - stream accounting: what was refused, what it cost, how hard the model thought;
  - integration, fenced verification, adversarial review and landing.

On the machines where the method was first measured, headless workers finished 7 of 7 parts in minutes. The same
work through the in-session Workflow tool had finished 0 of 7 after 73 minutes. This was not a controlled benchmark:
the Workflow run was stopped at that point, and 5 of the 7 headless lanes started from digests of the stopped work
(the two that did not were still among the fastest). [REQUIREMENTS.md §1](REQUIREMENTS.md#1-problem-measured) has
every measurement and confound. arbab packages that method so it is repeatable and safe.

## How it works

```
 you ──▶ interactive Claude Code session (the orchestrator, using the /arbab skill)
              │  plan · briefs · decisions
              ▼
          arbab runner ──▶ shepherd ──▶ claude -p worker   (worktree .arbab/worktrees/<lane>, fenced)
              │            shepherd ──▶ claude -p worker   (…)
              │            usage limit? wait for the reset, resume the same session
              ▼
          integrate ──▶ verify (gates inside the fence) ──▶ review (lenses + skeptics)
              ──▶ readiness report ──▶ you approve ──▶ land (merge into main; never pushes)
```

- **Lanes.** A lane is one unit of work: a brief (task, scope, facts, acceptance), a role (`implementer`,
  `verifier`, `reviewer`, `researcher`, `probe`), and limits.
- **Plans.** A plan is a DAG of lanes; `arbab plan next` launches every phase whose dependencies succeeded.
- **The fence.** Each worker runs under Claude Code's sandbox with:
  - `dontAsk` permissions and a role's exact tool list;
  - an allowlist of project commands;
  - no background shells;
  - no writes to the shared `.git`.

  Refused calls are counted, not guessed at.
- **Verification runs inside the fence.** `arbab verify` runs your gates (`pnpm typecheck`, `pnpm test`, …) in a
  probe lane without file-editing tools. Exit codes are read from the stream, never from the model's summary.
- **Reviews with a depth floor.** `arbab review` runs one reviewer per lens (correctness, security, contracts, or
  your own), then skeptics that try to refute every MEDIUM+ finding. The readiness report lists what was verified,
  what was skipped and every remaining risk.
- **Landing is yours.** `arbab land` merges only a tree that was verified, into a clean base. It never pushes; push
  and deploy stay human actions.

`arbab status` after part of arbab's own M3 build. Each role runs at its own effort; costs are Claude Code's
API-equivalent estimates, and the run was on a subscription.

```
lane                    state               attempt  elapsed  turns  calls  last tool  effort  failed  cost   quota
m3-fix-hostgit          finished (success)  1        13m27s   59     127    Bash       high    4       $4.12  7d 12%
m3-fix-trust            finished (success)  1        14m52s   54     110    Bash       high    3       $4.14  7d 14%
m3-fix-verify           finished (success)  1        7m51s    51     100    Bash       high    0       $2.91  7d 9%
m3-package              finished (success)  1        2m04s    14     30     Bash       medium  0       $0.45  7d 7%
m3-review-security      finished (success)  14       7m42s    29     41     Grep       high    1       $2.84  5h 9% · 7d 28%
m3-skeptic-security     finished (success)  14       51s      6      9      Read       high    0       $0.31  5h 9% · 7d 29%
m3-verify               finished (success)  16       1m14s    4      3      Bash       low     0       $0.00  5h 7% · 7d 28%
quota: 5h 40% (resets Oct 11 01:30Z) · 7d 35% (resets Oct 16 18:00Z)
```

## Install

Requirements:

- [Claude Code](https://docs.claude.com/en/docs/claude-code) 2.1.290 or newer;
- Node.js 20 or newer, and git;
- macOS (tested; the fence uses Claude Code's sandbox). Linux is untested.

```sh
claude plugin marketplace add ozgursagiroglu/arbab
claude plugin install arbab@arbab
```

The install copies only `plugin/`: the skill and a single-file runner, about 370 KB, with zero runtime
dependencies. To update: `claude plugin marketplace update arbab`.

## Quick start

1. **Configure the project.** Add an `arbab.config.json` at its root:

   ```json
   {
     "baseBranch": "main",
     "instructions": ["CLAUDE.md"],
     "dependencies": { "strategy": "command", "command": ["pnpm", "install", "--frozen-lockfile"] },
     "commands": {
       "implementer": ["pnpm test", "pnpm typecheck", "pnpm build"],
       "reviewer": ["pnpm test", "pnpm typecheck"]
     },
     "gates": [["pnpm", "typecheck"], ["pnpm", "test"], ["pnpm", "build"]],
     "maxParallel": 4
   }
   ```

   - `instructions` are inlined into every brief. Workers do not load `CLAUDE.md` on their own.
   - `commands` are the only project commands each role may run.
   - `gates` are what `verify` runs.

   The skill's "Before the first launch" section explains every field. [arbab.config.json](arbab.config.json) is
   this repository's own.
2. **Open Claude Code in the project and run the skill:** `/arbab`. Ask it to check the setup first; it runs
   `arbab doctor` (node, git, the claude binary, the sandbox, the config, the ignored roots).
3. **Hand it the work:** "Plan this and run it with arbab." The orchestrator:
   - splits the work into lanes and writes their briefs;
   - lints them and launches them;
   - reacts as each one finishes.
4. **Watch:** `arbab status` shows each lane's state, turns, tool calls, refusals, cost and the quota.
5. **Land:** the orchestrator integrates, verifies, reviews and writes `readiness.md`, then asks you. You say yes; it
   lands.

Two steps are always yours:

- **Dependency changes.** If a worker changed `package.json` or a lockfile, nothing is installed. You review the
  change, install it yourself, and confirm with `arbab integrate <name> --deps-installed <sha>` in your own
  terminal. The CLI refuses that confirmation without a terminal, so an agent cannot give it for you.
- **Landing.** `land` is the orchestrator's command, but the skill asks you first. It never pushes.

## Commands

| Command | What it does |
| --- | --- |
| `doctor` | Checks node, git, the claude binary, the sandbox, the config, the ignored roots and `~/.arbab`. |
| `lint <lane.json>` | Lints the profile, brief and schema. Exit 1 on errors. |
| `launch <lane.json>` | Lints the lane, then starts its shepherd. |
| `plan check \| next \| status <plan.json>` | Validates a plan, launches the ready phases, or shows the waves. |
| `status [lane…]` | One row per lane: state, attempt, elapsed, turns, calls, last tool, effort, refusals, cost, quota. |
| `wait [--any\|--all] [lane…]` | Reports finished lanes not yet seen. Exit 3 on timeout. |
| `resume <lane> [--prompt f \| --digest]` | Starts a new attempt in the same session, or a fresh one seeded with a digest. |
| `stop <lane>` | Stops the lane's shepherd and worker. |
| `preflight <lane.json>` | Probes the lane's fence and model before a long run. |
| `quota [--reset]` | Shows the account snapshot and the hold decision. Use `--reset` after switching accounts. |
| `cleanup [--worktrees]` | Reaps orphans and releases stale locks. `--worktrees` removes merged, clean worktrees. |
| `integrate <name> --lanes a,b \| --plan p` | Merges lane branches into `integrate/<name>`. |
| `verify <name>` | Runs the gates inside the fence on the integration head. |
| `review <name> [--lenses a,b]` | One reviewer per lens, then skeptics for MEDIUM+ findings. |
| `readiness <name> [--tier low\|medium\|high]` | Writes the readiness report: verified, skipped, risks. |
| `land <name>` | Merges a ready integration into the base. Never pushes. |

The skill runs these as `node "${CLAUDE_PLUGIN_ROOT}/dist/arbab.mjs" <command>`. From a clone, run
`node dist/arbab.mjs <command>` after `pnpm build`.

## Safety model

Workers write code, and that code is untrusted until a human lands it. arbab never runs it on your machine outside
the fence:

- **Tests run in the fence.** `verify` runs the gates in a sandboxed lane without file-editing tools, and the tree
  must be clean after the run.
- **Installs happen only on trusted commits.** The dependency command runs on the host, so it only ever runs on a
  commit from your base branch, or one you confirmed. Worker code is merged after the install.
- **Host git never runs worker code.** No hooks, no `core.fsmonitor`, no submodule recursion. Checkpoints never
  commit nested repositories or arbab's own state.
- **Refusals are surfaced, not bypassed.** Worker runs that hit the fence show up in `status`, never as a hidden
  retry.
- **Every gate is checked, nothing is pushed.** A readiness report lists every confirmed or unverified risk, and
  `land` lands only the tree that was verified.

The full threat model and the review history are in [DESIGN.md](DESIGN.md). Found a hole? See
[SECURITY.md](SECURITY.md).

## Built with itself

arbab was built by its own method, as an interactive orchestrator with headless workers. Milestones M1–M3 took 146
worker attempts and 5,091 tool calls. Only 1.3% of those calls were refused by the fence; hand-made fences on other
machines measured 5.8–15%. The notional API-equivalent cost was about $225, run on a subscription.

M3 alone went through 14 review rounds, 10 of them with all three lenses. Among what the review lanes found and the
fix lanes closed were two paths by which worker code could have run on the host. Every run is in [bench/RUNS.md](bench/RUNS.md), with notes in [bench/README.md](bench/README.md).

## FAQ

**What is arbab?**
A Claude Code plugin: a skill that teaches your session the orchestration method, plus a runner CLI that launches,
fences, supervises and measures headless `claude -p` workers.

**How is it different from Claude Code subagents or the Task tool?**
Subagents run inside your session and share its context, limits and lifetime. arbab workers are separate
`claude -p` processes, each in its own git worktree with its own fence, budget and clock. They survive usage limits:
a worker waits for the reset and resumes the same session. Their work is reviewed and landed through gates instead of
being merged as it comes.

**How is it different from Workflows, agent teams and agent view?**
As of Claude Code 2.1.295:

- [Workflows](https://code.claude.com/docs/en/workflows) run their agents inside your session, under one sandbox.
  They document no per-agent effort or $ cap, and `parallel()` waits for every agent before the script continues.
- [Agent teams](https://code.claude.com/docs/en/agent-teams) are experimental, and teammates inherit the lead's
  effort level.
- [Agent view](https://code.claude.com/docs/en/agent-view) runs background sessions (`--bg`), which cannot be
  combined with `-p`. They get no budget cap and no report schema, and Claude Code's usage-limit wait does not apply
  to them.

For a short fan-out inside your session, Workflows are the simpler tool. arbab is for long, risky or unattended work
that has to survive usage limits and land through gates.

**How is it different from claude-squad, Conductor and other worktree managers?**
They give each agent a worktree and a UI, and you drive each agent yourself. With arbab your interactive session
drives the workers: it writes the briefs, launches the lanes, reacts as each one finishes, and takes the results
through verify, review and readiness before you decide.

**Does it work with a Claude subscription or the API?**
Both. It runs the unmodified `claude` binary under your own login, on your machine. It never reads, stores or
proxies your credentials, and there is no hosted mode. What your plan allows is set by Anthropic; check the
[legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance) before you run large fleets.
Costs in the reports are Claude Code's API-equivalent estimates.

**Is it safe to let workers run unattended?**
Workers are fenced by Claude Code's sandbox and an exact permission profile. arbab never runs their code on the host
outside that fence, and nothing lands without your approval. See the safety model above.

**Does arbab push to my remote?**
Never. `land` merges locally and prints the push command.

**What happens when I hit a usage limit?**
New launches are held while the quota is above your threshold. A running worker that hits the limit waits for the
reset, plus a little jitter, and resumes the same session. After switching accounts, run `arbab quota --reset`.

Parallel workers use quota in proportion: N workers use it about N times as fast as one. Each attempt's budget is
passed as `--max-budget-usd`, which is Claude Code's client-side cost estimate; it does not cap subscription quota.

**Which platforms are supported?**
macOS is tested. Linux should work wherever Claude Code's sandbox works, but it is untested so far.

## Documentation

| Document | What it holds |
| --- | --- |
| [skills/arbab/SKILL.md](skills/arbab/SKILL.md) | The method the orchestrator follows: briefs, lanes, plans, quota, review, landing |
| [DESIGN.md](DESIGN.md) | The source of truth for behaviour: process model, fence, brief contract, CLI, landing, security rules |
| [REQUIREMENTS.md](REQUIREMENTS.md) | Why: the measured problem, requirements, decisions, milestones |
| [research/](research/) | What Claude Code does natively, run metrics, retrospectives, prior art |
| [bench/](bench/) | The run ledger of arbab's own build |

## Contributing

Issues and pull requests are welcome.

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build      # bundles dist/arbab.mjs and assembles plugin/; commit plugin/ with your change
```

The project rules (zero runtime dependencies, tests for every export, no shell strings) are in
[CLAUDE.md](CLAUDE.md).

## License

[MIT](LICENSE) © Özgür Sağıroğlu
