# Retrospectives from the orchestrator sessions (2026-10-09, machine 1)

Each session got the same five questions from session `project-a-da` and answered over cross-session messaging.
The answers below are verbatim. The synthesis is at the end.

## project-a-bb (session 4b61acfe — WhatsApp, purge and inbox work)

> Headless claude -p retrospective from session 4b61acfe (WA/purge/inbox), 5 answers.
> 1. Speed: effort, not shell. Workflow subagents inherited the session's max effort: 4 agents, 32 min, 103–181 tool calls each (~3–5/min), wa:B silent 8+ min in one thinking step (last tool 05:30:39, nothing by 05:39). Shell latency was 4 s. Headless at --effort high ran ~6 tool calls/min. B3 finished in 13.6 min including 21 new itests on top of its predecessor's uncommitted code. parallel() is also a barrier; separate background processes are not.
> 2. Cost me time: a limit stop still reports result subtype "success" (is_error true, exit 1), and session_id is only in the stream init event, so check is_error. Stopping the workflow threw away the agents' context; B7's report I pulled from its transcript's StructuredOutput call. The old DAG script had another machine's paths and "npx eslint", so I spliced the current shared rules with the old specs by hand. I picked Redis DBs by hand and nearly gave B4 the 13/14 wa-D was using. My own `tc | tail` hid a typecheck failure and the commit went through. Nothing has landed on main yet.
> 3. By hand: prompts from the plan; worktree + pnpm install; DB/Redis slots; the dependency waves; reading reports; resume; review.mjs.
> 4. I'd move toward yours. A denylist on prefixes is weak: Bash(git push:*) doesn't match `git -C x push`, and `node -e fetch(...)` gets past the curl deny. I'd keep workers committing locally in isolated worktrees (cheap checkpoints, easy to resume) and have only the orchestrator merge and push. Add --max-budget-usd and an OS sandbox with network off except the model API and localhost.
> 5. Must-haves: (a) a plan file → DAG launcher that hands each phase its worktree, DB, Redis DB and port; (b) lifecycle: detect is_error/limit and auto-resume via session_id at reset, plus a schema'd report file; (c) live per-session progress and cost. Must NOT: push, deploy or call billed/outward APIs without the human, or redo work that a resume would finish.

## project-a-7e (session 0bc0d144 — the fix-404 worker)

> Headless `claude -p` retrospective from project-a-7e. The opus fix run is still going (105 tool calls so far), so review and landing are not covered yet.
>
> 1. The worker runs code it writes itself (tests, the build), so permission rules alone can't contain it. The OS sandbox is the real wall: no writes outside the worktree, loopback-only network, `.env` and `~/.ssh` unreadable. `--restricted` drops the user/project allow rules and confines the file tools. dontAsk with `--permission-prompts none` exists because past agents stalled 20 min to 6 h on prompts nobody answered; here a denial costs one turn. Wrapper scripts pin the env and port and cut 100 KB of HTML down to 15 lines. What actually stopped things: dontAsk, 7 times (`cmd; echo EXIT=$?`, `cd && …`, lsof, ps, `node -e`, blame chains). `--restricted`, twice (reading the wrappers). The sandbox, once, and that was a false positive (tsx's IPC socket). The explicit deny list is redundant under dontAsk.
>
> 2. Yes, generalise it. Three haiku runs cost about $0.017 and caught four harness bugs: tsx's IPC socket refused (EPERM); a port-less Host header, so Next proxied the rewrite to itself; HOSTNAME=127.0.0.1 against NextURL's localhost normalisation (500s); no BETTER_AUTH_SECRET. Each would have had opus debugging my harness instead of the bug. Caveat: haiku backgrounded serve.sh and ran the steps out of order, so make "foreground" explicit.
>
> 3. The worker keeps writing compound commands, so the prompt should say "single commands". The sandbox blocks pgrep/ps (no sysmond). The worker can't read its own wrappers. The /tmp scratchpad is writable from inside the sandbox, so I moved the scripts to $HOME. The session limit killed a probe; rerunning was safe because runs are idempotent. stream-json monitoring needed a jq filter.
>
> 4. Done by hand: the wrappers and allowlist for each task, finding the env needed to serve the app, writing the baseline facts into the prompt, polling, the review fan-out, rebase/commit/push/CI.
>
> 5. Must-haves: (a) generate the profile (settings, wrappers, sandbox) from the commands a task needs, then validate it with a cheap pre-flight run; (b) a structured final report plus denial stats; (c) isolation by default: worktree, no secrets, no commits, budget and time caps. It must NOT give the worker git write access, `Bash(*)` or skip-permissions "for speed".

## project-b-ai-app-57 (session 550c5086 — project-b research and implementation)

> Retrospective from the project-b session on the headless `claude -p` method (≤300 words).
>
> 1. **Why it was faster.** Each agent is its own OS process. It gets one decided, narrow brief with fixed design choices, so it uses few turns. It returns JSON into a file, so my context stays small, and I handle each result when it lands, with no barrier.
>    - P1.3: 49 turns, 6 min, $1.6.
>    - P1.4: 38 turns, 5 min, $1.7.
>    - P0.5 research: about 2.7 min, $0.6.
>    - P0.7: 6 sectors in parallel, 3–10 min each.
>    - Earlier, the P0.1 Workflow took 33 agents and about 9.6 h, and hit session limits.
>
> 2. **Roles.**
>    - **Code:** a worktree plus an allowlist (pnpm, git status/diff/add/commit; deny push, checkout, docker, web). This was solid.
>    - **Research:** only WebSearch/WebFetch, which leaves no exfiltration path for prompt injection. But WebFetch's user agent got 403s from bot-blocking publishers, and it can't return raw status or XML, so I re-verified everything with my own fetch script. Change: give research workers a sandboxed raw-HTTP tool.
>    - **Reviewers:** too shallow. They took 2–6 turns, and 6 lenses produced 1 finding; I found the real bugs myself. They need a minimum depth, or evidence for every path they check.
>
> 3. **What broke.**
>    - The session limit killed an agent mid-edit. `--resume <session_id>` with a "check git status, continue" prompt worked.
>    - `$(...)` was blocked inside agents.
>    - drizzle-kit gave the migration a random name.
>    - The worst one: unit tests with a mocked DB passed, but a bare `Date` in raw SQL crashed in prod. Only a live run against a real DB caught it.
>
> 4. **Done by hand:**
>    - instantiating templates;
>    - launch scripts and polling;
>    - parsing and merging JSON;
>    - mechanical verification;
>    - reading diffs;
>    - amend, fast-forward and push;
>    - re-running Gate 0 and Gate 1;
>    - cleaning up worktrees.
>
> 5. **Must-haves:**
>    - per-role permission profiles, with worktree isolation and a guarantee of no push;
>    - a run registry with auto-resume after usage limits and structured results;
>    - a built-in verify step (gates plus a real-DB smoke test) before landing.
>
>    **Must NOT:** auto-merge, push or deploy without a passed gate and a human decision.

## Synthesis

**All three asked for:**

- role-based permission profiles with worktree isolation, and a hard no-push guarantee;
- a run registry with structured, schema'd results;
- auto-resume of a usage-limit stop through `--resume <session_id>`;
- a human-gated landing: no merge, push or deploy without a passed gate and a human decision.

**Two of three asked for:**

- live per-worker progress and cost (bb; 7e's denial stats point the same way);
- a plan → dependency-graph launcher that hands out resources (bb). project-b instantiated its templates by hand,
  which is the same need.

**Raised once, with evidence:**

- profile generation plus a cheap preflight run (7e: $0.017 caught 4 harness bugs);
- a verify step with a live smoke test (project-b: a mocked DB hid a production crash);
- a depth floor for reviewers (project-b: 6 lenses, 1 finding);
- a raw-HTTP tool for research workers (project-b).

**Disagreement — who commits:**

- bb and project-b let workers commit locally. bb wants cheap checkpoints and an easy resume.
- 7e forbids any git write by a worker.
- Proposed resolution: the runner commits a checkpoint when a worker exits ([REQUIREMENTS.md](../REQUIREMENTS.md) FR-8).

**Disagreement — why it was faster:**

- bb says effort.
- project-b says narrow briefs, separate processes and a small orchestrator context.
- 7e says no permission stalls.
- These are compatible, and the evidence supports all three. No controlled comparison separates them yet
  (REQUIREMENTS §11, Q-bench).
