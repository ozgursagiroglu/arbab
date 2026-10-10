# Open-source landscape and terms (2026-10-09)

**Sources.** A web-research agent compiled this on 2026-10-09. Stars and last-push dates come from the GitHub API
on that day; dates are 2026 unless marked otherwise. Each claim links its source. Unless marked **[verified]**,
nothing here was checked independently.

**Bottom line.** Many tools give each agent its own git worktree. None combines the six capabilities arbab
targets:

1. role profiles with an allowlist, an OS sandbox and a $ cap;
2. a worktree plus leased resources;
3. a schema-validated report;
4. resuming headless workers after a usage limit;
5. live progress and cost;
6. a human-gated merge.

The closest coverage is Anthropic's own: dynamic workflows and agent view. Every building block exists as a
`claude -p` flag, so arbab's value is the policy and composition layer, not the plumbing.

Legend: Y = yes · P = partial · N = no · – = not documented.

## Orchestrators

| Tool | Licence · ★ · last push | Form | DAG | 1 profile/sandbox/$ cap | 2 worktree/resources | 3 schema report | 4 limit-resume | 5 progress/cost | 6 human-gated merge |
|---|---|---|---|---|---|---|---|---|---|
| [CC dynamic workflows](https://code.claude.com/docs/en/workflows) | Anthropic | in-session script | Y | P agent type/tools per agent; no $ cap | P worktree subagents | Y `schema` + retries | P interactive only | Y tokens | N |
| [CC agent teams](https://code.claude.com/docs/en/agent-teams) | Anthropic, experimental | interactive session | Y | P tools; teammates get the lead's mode | N | N | N | P | – shared checkout |
| [CC agent view](https://code.claude.com/docs/en/agent-view) | Anthropic, preview | `claude agents` / `--bg` | N | P mode per session | P automatic worktree | N | – | P | N "pushes the branch" |
| [claude-code-action](https://github.com/anthropics/claude-code-action) | MIT · 9.5k · 10-08 | GitHub Action | N | P tools, domain allowlist | N | Y | N | P | P human merges the PR |
| [Gas Town](https://github.com/gastownhall/gastown) | MIT · 18.3k · 10-08 | CLI/tmux + web | Y | P roles | P worktree | P beads | P throttles dispatch | P | N Refinery merges to main |
| [ruflo](https://github.com/ruvnet/ruflo) (formerly claude-flow) | MIT · 74k · 10-09 | CLI/MCP/plugins | P | P access levels, budgets | – | – | – | Y | – |
| [ccswarm](https://github.com/nwiizo/ccswarm) | MIT · 153 · 09-14 | Rust CLI | P | P roles, `--max-budget-usd` | P worktree | P NDJSON log | – (an `on_rate_limit` key) | P `cost` per agent | P `approve` gate; `auto` opens PRs |
| [tsk-tsk](https://github.com/dtormoen/tsk-tsk) | MIT · 171 · 07-29 | CLI/TUI | P `--parent` | P container + proxy domain allowlist | P repo copy | N | N | P logs | Y branches come back for review |
| [container-use](https://github.com/dagger/container-use) | Apache · 4.1k · 09-21 | MCP server | N | P container | P container + branch | N | N | P logs | P you check the branch out |
| [Aperant](https://github.com/AndyMik90/Aperant) (formerly Auto-Claude) | AGPL · 14.6k · 06-14, 2.x in maintenance | desktop kanban | P | P OS sandbox, command allowlist | P worktree | P QA loop | – | – | – AI merge |
| [CCPM](https://github.com/automazeio/ccpm) | MIT · 8.4k · 03-18 | skill | Y | – | P one worktree per epic | P issue comments | – | P | – |
| [superpowers](https://github.com/obra/superpowers) | MIT · 297k · 10-09 | plugin | P | – | P one worktree | P review reports | – | – | Y human chooses |
| [AgentOrchestration](https://github.com/fuzz74/AgentOrchestration) | no licence · 1 | PowerShell | Y | P roles, `--max-budget-usd` | P worktree; workers share ports/DBs | Y `--json-schema` | P resumes on failure | Y incl. cost | Y "nothing is pushed" |

## Worktree session managers

In these tools a human drives each agent. The scores are the same for all of them: 1 N · 2 P · 3 N · 4 N ·
5 P (status only; none documents cost) · 6 P (a human reviews the diff or PR).

| Tool | Licence · ★ · last push | Form | Notable |
|---|---|---|---|
| [claude-squad](https://github.com/smtg-ai/claude-squad) | AGPL · 8.6k · v1.0.20 08-20 | TUI/tmux | yolo mode |
| [vibe-kanban](https://github.com/BloopAI/vibe-kanban) | Apache · 28.3k · 09-19 | local web app | the company behind it shut down 04-10; now [community-maintained](https://vibekanban.com/blog/shutdown) |
| [ccmanager](https://github.com/kbwo/ccmanager) | MIT · 1.3k · 10-08 | TUI | worktree hooks, `.worktreeinclude` |
| [Crystal](https://github.com/stravu/crystal) → [Nimbalyst](https://github.com/nimbalyst/nimbalyst) | MIT · 3.1k / 1.9k · 02-26 / 10-09 | desktop | Crystal is deprecated |
| [Conductor](https://www.conductor.build/) | [closed source, free](https://codepick.dev/en/tool/conductor/) | macOS app | [10 ports per workspace; with a shared DB, workspaces have to run one at a time](https://conductor.build/docs/reference/scripts) |
| [Superset](https://github.com/superset-sh/superset) | Elastic-2.0 · 15k · 10-09 | desktop | setup scripts, port detection |
| [Emdash](https://github.com/generalaction/emdash) | Apache · 5.9k · 10-08 | desktop | SSH remotes |
| [Sculptor](https://github.com/imbue-ai/sculptor) | MIT · 237 · 10-08 | desktop | containers are experimental |
| [uzi](https://github.com/devflowinc/uzi) | MIT · 582 · 2025-06-04 | CLI | stale; allocates dev-server ports |
| [Terragon](https://github.com/terragon-labs/terragon-oss) | Apache · 260 · 02-10 | cloud | shut down; open-source snapshot only |

## Gaps (what arbab would fill)

- **Profile.** Nobody combines a whole-process sandbox with a tool allowlist and a $ cap in one profile. Claude
  Code's sandbox covers shell commands only; its file tools, MCP servers and hooks
  "[run outside it](https://code.claude.com/docs/en/sandboxing)". Confining the whole process needs
  [srt](https://github.com/anthropics/sandbox-runtime) or a container. tsk has the sandbox but no roles or $ cap;
  ccswarm and AgentOrchestration have roles and $ caps but no sandbox.
- **Resources.** No tool hands out databases or Redis indexes per worker; only ports are handled (Conductor, uzi,
  Superset).
- **Limit resume.** Nothing resumes headless workers after a usage limit. Anthropic's own wait does not apply "in
  non-interactive mode with `claude -p` or the Agent SDK, in a background session"
  ([workflows](https://code.claude.com/docs/en/workflows)). The pieces exist: `rate_limit_event` carries reset
  timestamps ([#26392](https://github.com/anthropics/claude-code/issues/26392)), and there is `--resume`.
  - **[verified]** Our wa-D stream log has 13 `rate_limit_event` lines. Each carries `rate_limit_info.status`
    (`allowed_warning` from 90% utilisation, then `rejected` at the stop), `resetsAt` (epoch seconds),
    `rateLimitType` (`five_hour`), `utilization`, and `unifiedWindows.five_hour` / `seven_day`.
- **Merge defaults.** Defaults run the other way: agent view pushes branches, Gas Town auto-merges to main, and
  ccswarm's `auto` mode opens PRs.
- **Graph with separate processes.** Nothing popular combines a dependency graph and schema checks with separate
  worker processes. Dynamic workflows run subagents inside one session, with one shared sandbox, no $ cap, no
  merge step, and 16 concurrent agents by default. Only a 1-star prototype builds this from `claude -p` workers.
- **Fleet cost.** There is no live $ view across a fleet. Each run reports `total_cost_usd`, but only ruflo,
  ccswarm and AgentOrchestration add it up.

## What this means for arbab

- **Do not build:**
  - a session-manager UI (claude-squad, ccmanager, Conductor, agent view);
  - a container runtime (container-use, tsk);
  - plan-as-GitHub-issues (CCPM).
- **Build the policy and composition layer:**
  - safe-by-default role profiles with preflight;
  - leasing of resources beyond ports;
  - quota-aware dispatch, and auto-resume from `rate_limit_event`;
  - a dependency graph with schema'd reports across separate processes;
  - human-gated landing as the default;
  - a fleet view of cost and quota.
- **Precedent for the form factor:** methodology spreads in this ecosystem as plugins and skills (superpowers,
  CCPM).
- **Closest to the concept:**
  - AgentOrchestration (a 1-star PowerShell prototype — it validates the idea, but has no traction);
  - ccswarm (a Rust CLI with roles, budgets, worktrees and an approve gate).

## Terms and risks

All quotes are from the cited sources and were not verified independently.

- **[Consumer Terms](https://www.anthropic.com/legal/consumer-terms)** (effective 2025-10-08) prohibit, "Except
  when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, to
  access the Services through automated or non-human means, whether through a bot, script, or otherwise."
- **Currently permitted, but the policy keeps moving.**
  - The [support article](https://support.claude.com/en/articles/15036540) says (2026-10-07): "You can still use
    the Claude Agent SDK, `claude -p`, and third-party apps with your subscription limits."
  - On 2026-06-15 Anthropic "paused the previously-announced changes to Claude Agent SDK usage".
  - `claude setup-token` mints a subscription token "for CI and scripts".
- **The [legal & compliance page](https://code.claude.com/docs/en/legal-and-compliance) sets the boundaries.**
  - "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent
    SDK."
  - Developers may not "route requests through Free, Pro, or Max plan credentials on behalf of their users", and
    may not "collect, store, or intermediate Claude.ai credentials or session tokens".
  - Anthropic may enforce this "without prior notice".
- **Quota use grows with each worker.** "Running ten agents in parallel uses quota roughly ten times as fast as
  running one" ([agent view](https://code.claude.com/docs/en/agent-view)). The weekly limits target people running
  Claude Code "continuously in the background, 24/7".
- **The $ cap is an estimate.** `--max-budget-usd` checks a "client-side cost estimate", and "Spend can pass the
  cap". It does not limit subscription quota.
- **API credits.** Max 5x and Max 20x include $100 and $200 of monthly API credits that cover `claude -p`. Pro is
  not eligible.
- **Bare mode.** `--bare` "will become the default for `-p`", and bare mode "never reads OAuth credentials". Workers
  logged in with a subscription may then need an explicit opt-out (the research agent's inference).
- **Concurrency cap:** not found.

**Implications for arbab:**

- run the unmodified `claude` binary under the user's own login;
- never read, store or proxy credentials, and offer no hosted mode;
- say plainly that parallel workers consume quota in proportion;
- describe the $ cap as an estimate;
- detect the `--bare` default change and fail clearly.
