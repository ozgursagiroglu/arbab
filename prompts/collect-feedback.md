# Collect headless-worker retrospectives on this machine (project "arbab")

You are collecting evidence for **arbab**, an open-source project that will package a method the owner uses across
several Claude Code sessions. In that method:

- an interactive "orchestrator" session launches headless `claude -p` workers, usually one per git worktree;
- each worker gets its own permission profile and prompt file;
- the orchestrator then monitors the workers, reviews their output and lands it.

Three orchestrator sessions on another machine have already reported. Do the same on THIS machine, so the two sets
can be merged. Work read-only. The only exceptions are the report file and the evidence copies described below.

## 1. Find the sessions and their artifacts

- **Sessions.** `ListAgents` shows the live peer sessions. `~/.claude/sessions/*.json` maps each live session's
  name to its `sessionId`, `cwd` and `kind`.
- **Orchestrators.** Transcripts are at `~/.claude/projects/<cwd with / replaced by ->/<sessionId>.jsonl`. Search
  them for `claude -p`, both in Bash tool calls and in scripts the session wrote; the sessions that match are the
  orchestrators.
- **Headless workers.** Their transcripts are under the project folder of their worktree. Their outputs —
  `stream.jsonl` / `out.json`, report files, and `started`/`finished`/`exit` markers — are usually in the
  orchestrator's scratchpad, under `/private/tmp/claude-<uid>/<project folder>/<sessionId>/scratchpad/` on macOS.
- **Evidence copies.** Copy the launcher scripts, settings JSON, prompt templates, report schemas and review
  drivers into `~/Workspace/Diojen/arbab/evidence/<session-name>/`.
  - Check each file for secrets before you copy it.
  - Never copy `.env` files, token files, key files or anything that holds customer data.
- **Running workers.** Do NOT message headless workers that are still running. They are mid-task, and their
  prompts say nobody will answer. Read their logs instead.

## 2. Measure every headless run you find

- **From the run's final `result` event:**
  - wall clock (`duration_ms`), `num_turns`, `total_cost_usd`;
  - `is_error` and the `permission_denials` count;
  - the models used.
- **From the stream:**
  - the number of tool calls;
  - every failed tool result, with its cause: denied by the permission mode, outside the `--restricted` scope,
    blocked by the sandbox, or a real error.
- **Launch flags:**
  - permission mode and allow/deny lists;
  - OS sandbox and `--restricted`;
  - `--effort`, `--model` and `--max-budget-usd`;
  - who commits.
- **Settings that change workers:** whether `~/.claude/settings.json` sets a default effort (`modelSettings`) or a
  `sandbox` block, and whether the project settings do.
- **Credential exposure:** whether files holding credentials sit near the worktrees, for example in a parent folder,
  and whether a worker's fence would let it read them. Check names and permissions only; never open a credential
  file.
- **Workflow baseline:** if the same work was tried earlier with the Workflow tool / ultracode or with subagents,
  find its numbers too: agents, wall clock, tool calls per minute, stalls, restarts. They are in
  `<session>/subagents/workflows/`.
- **Gotchas:**
  - Parse with `python3`, not `echo "$line" | jq`; zsh's echo expands backslashes and breaks the JSON.
  - A usage-limit stop reports `subtype: "success"` with `is_error: true`. Classify a run by `is_error` and the
    result text.
  - The session id is in the stream's `init` event.
  - After a `--resume`, the cost looks cumulative for the whole session.

## 3. Ask each orchestrator session (never the workers)

- **Send one message to each orchestrator** with `SendMessage`. Make the first line a self-contained sentence.
- **Ask it to answer at its next natural pause**, without stopping its current work: at most 300 words, numbered,
  sent back to you with `SendMessage`.
- **Tell it what you already have**, so it does not repeat that.

Ask these questions word for word, so the answers from both machines can be compared:

1. Why was headless faster than Workflow/subagents for you? Give your causal explanation with any numbers (wall
   clock, tool calls per minute, agent count, stalls, restarts) and the effort level used on each side.
2. What broke or cost time? Cover the usage-limit stop and resume, landing worker commits, per-worktree resources
   (DB, Redis, ports), prompt gaps, monitoring/polling, and anything else.
3. What did you do by hand that a tool should do?
4. Describe your fence: permission mode, allow/deny lists, OS sandbox, `--restricted`, budget/time caps, and who
   commits. Which layer actually stopped something, which was overhead, and what would you change?
5. If this became an open-source skill or CLI, what are the 3 must-haves and one thing it must NOT do?
6. Which Claude Code version and which auth (subscription plan or API key) do you use? Did you try anything that
   did not work (`claude --bg`, agent teams, `--json-schema`, …)?

Replies arrive on their own, so do not poll `ListAgents` in a loop. If a session holds your message for approval,
or has not answered after about 30 minutes, say so in the report and use the evidence from its transcript instead.

## 4. What the other machine already found (report differences, not repeats)

**Three hand-built setups:**

- **(a) Strict.**
  - Fence: `--restricted`; `dontAsk` with `--permission-prompts none`; an OS sandbox with loopback-only network.
  - Allowlisted wrapper scripts are the worker's only shell; `--max-budget-usd` caps the spend; the worker never
    commits.
  - A read-only reviewer runs afterwards.
  - Cheap haiku preflight runs ($0.017 for 3) caught 4 harness bugs before the expensive run.
- **(b) Loose.**
  - `acceptEdits` with a bare `Bash` allow and a prefix denylist; workers commit locally.
  - Prompts are generated from a plan, with the upstream JSON report pasted into the downstream prompt.
  - A resume script handles usage-limit stops.
  - A review driver runs lens finders, then 3 skeptics per MEDIUM+ finding, using `--json-schema`.
- **(c) Role launchers.**
  - Separate launchers for code, read-only review, web-only research and resume.
  - Templates are fanned out per item.
  - Each phase gets a 3-lens review.

**Reported speed causes:**

- narrow, decided briefs;
- effort: workflow agents inherited the session's max effort and made 3–5 tool calls per minute, while headless
  workers at `--effort high` made 5–6;
- no permission-prompt stalls: a denial costs one turn instead of 20 minutes to 6 hours;
- no `parallel()` barrier;
- JSON reports that keep the orchestrator's context small.

**Problems:**

- A usage-limit stop looks like `success`.
- Prefix denylists leak (`git -C x push`, `node -e fetch`), and `Bash(pnpm:*)` amounts to "run any code".
- A strict allowlist wasted about 15% of calls on:
  - compound commands (`; echo $?`, `cd &&`);
  - `lsof` and `ps`;
  - wrapper scripts the worker could not read.
- Wrapper scripts kept in a writable `/tmp`.
- Shallow reviewers: 6 lenses found 1 bug.
- Mocked-DB tests passed while production crashed.
- Hand-picked Redis slots nearly collided.
- A `| tail` hid a failing typecheck.
- Only setup (a) had an OS sandbox. The loose setups could read credential files one folder above the worktrees.

## 5. Rules

- Stay read-only. Do not edit other sessions' files, settings or worktrees. Do not start `claude -p` runs or
  workflows. Do not commit or push.
- Never put a secret in the report or in the evidence copies: no tokens, keys, `.env` values, emails or customer
  data. Paths and flag names are fine.
- Quote only numbers that you measured or that a session reported, and say which they are.

## 6. Output

Write `~/Workspace/Diojen/arbab/research/feedback-<hostname>-<YYYY-MM-DD>.md`, creating the folders if needed.
Print the same content as your final message, in English, with exactly these sections:

0. **Özet** — 3 lines in Turkish, for the owner.
1. **Machine** — hostname, Claude Code version, the sessions found (name → role → project), and the auth type if
   known.
2. **Runs** — one table row per headless run: session, worker label, role, model/effort, wall clock, turns, cost,
   `is_error`, denials, and failed tool calls with their causes.
3. **Workflow/subagent baseline** — for the same work, if there is one.
4. **Setups** — for each orchestrator: launcher, fence, commit policy, prompt source, report format, monitoring,
   review, resume, the settings that change workers, and credential exposure. Give the paths of the evidence
   copies.
5. **Answers** — each session's reply verbatim, or "no reply" and the reason.
6. **Differences from §4** — what is new, and what contradicts it.
7. **Gotchas worth a requirement** — each with its evidence (file:line, or a log excerpt of at most 3 lines).
