# What Claude Code already does (2.1.295, 2026-10-09)

arbab must compose these features, not rebuild them. Each fact is tagged with how it was checked:

- **[help]** — the local `claude --help` / `claude agents --help` output on 2.1.295;
- **[docs]** — the official docs, read by a research agent (not run locally);
- **[observed]** — seen in our own run logs;
- **[not documented]** — nothing found.

## Print mode (`-p`): the worker primitive

- **[help]** Output: `--output-format text|json|stream-json`.
- **[help]** `--json-schema <schema>` validates a structured final output.
- **[help]** `--max-budget-usd <amount>` caps spend; print mode only.
- **[help]** `--permission-prompts host|none`. With `none`, "anything that would prompt is denied automatically;
  the permission mode still decides everything else".
- **[help]** `--permission-mode` accepts `acceptEdits | auto | bypassPermissions | manual | dontAsk | plan`.
- **[help]** `--restricted`:
  - removes Bash, PowerShell, REPL and the other code-running tools, and WebFetch, unless `--tools` names them;
  - ignores user, project and local settings (managed settings and `--settings` still apply);
  - confines the file tools to the working directories;
  - refuses bypassPermissions;
  - leaves writes to settings, git and tool-configuration files to a person or the permission handler.
- **[help]** Other flags:
  - tools: `--tools`, `--allowedTools`, `--disallowedTools`;
  - configuration: `--settings <file-or-json>`, `--setting-sources`, `--strict-mcp-config`, `--mcp-config`;
  - model: `--model`, `--effort low|medium|high|xhigh|max`, `--fallback-model`;
  - session: `-n/--name`, `--resume <id>`, `--session-id <uuid>`, `--fork-session`, `--no-session-persistence`;
  - isolation: `-w/--worktree [name]`;
  - minimal mode: `--bare`.
- **[docs]** A Bash rule matches the command as written, by prefix: `Bash(git push *)` does not match
  `git -C dir push`. bb observed the same thing.
- **[observed]** Fields of the `result` event, in our parsed logs:
  - `subtype`, `is_error`, `result`;
  - `duration_ms`, `duration_api_ms`, `num_turns`;
  - `total_cost_usd`, `permission_denials`, `modelUsage`.
- **[observed]** A usage-limit stop:
  - the result is `subtype: "success"`, `is_error: true`;
  - the result text reads `You've hit your session limit · resets 11:30am (Asia/Dubai)`;
  - the exit code is 1 (bb);
  - the session id appears in the stream's `init` event.
- **[observed]** After a usage-limit stop, `claude -p --resume <session-id>` with a "the limit has reset;
  continue" prompt finished the work (wa-D, project-b).
- **[observed]** The `result` of a resumed run reported a cost that looks cumulative over the session
  (wa-D resume1: 3.1 min wall clock, $7.27). Treat it as a session total, not a per-run figure.
- **[observed]** Inside workers, `sleep N; cmd` is blocked, and the worker is told to use Monitor (purge-B3 log).
  project-b saw `$(...)` blocked.
- **[observed]** The OS sandbox:
  - blocks `pgrep`/`ps` (no sysmond);
  - refused tsx's IPC socket (EPERM);
  - allowed loopback.
- **[observed]** Messages from a worker's helper model show up as `claude-haiku-5-5` in `modelUsage`, even on
  Opus runs.
- **[not documented]** A schema for the result event; a dedicated usage-limit event in stream-json; built-in
  auto-resume for `-p`.

## Background sessions

- **[help]** `claude --bg` starts a session in the background and prints an id. The commands that use it:
  - `claude agents` lists sessions (`--json` for scripts) and offers an "agent view" that dispatches sessions,
    with defaults for `--model`, `--effort`, `--permission-mode`, `--restricted`, `--settings` and
    `--strict-mcp-config`;
  - `attach`, `logs`, `stop` (the conversation is kept), `rm` (removes the session and, when safe, its worktree)
    and `respawn`.
- **[help]** `--bg --resume <id>` continues a session in the background.
- **[docs]** `--bg` cannot be combined with `-p` (not run locally). That means it has no `--max-budget-usd`,
  no `--json-schema` and no `--permission-prompts none`, all of which are print-only.
- **[not documented]** The schema of `claude agents --json`; auto-resume of a background session after a usage
  limit.

## Workflow tool ("ultracode")

- **[docs]** `parallel()` "runs a set of agent tasks at the same time and waits for all of them". It is a barrier.
- **[docs]** No `effort` or `model` option is documented for `agent()` or `pipeline()`.
- **[observed]** bb: workflow agents ran at the parent session's max effort, 3–5 tool calls per minute.
- **[docs]** When an agent hits the claude.ai usage limit, the run pauses and continues
  (`autoContinueAtUsageLimit`, interactive sessions, v2.1.271+). Earlier versions failed the agent.
- **[docs]** Subagents use the parent's permission rules. An unattended prompt waits for a human.
- **[observed]** 2026-09-30 and 2026-10-07: subagent shell calls waited 20 min to 6.5 h on prompts.

## Agent teams

- **[docs]** Experimental; enabled with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. Teammates share a task list
  with dependencies: when a teammate finishes a task, the tasks that depend on it unblock.
- **[docs]** Teammates inherit the lead's effort level. This is not a declarative DAG.

## Plugins (the likely distribution vehicle)

- **[docs]** A plugin can ship skills (`skills/<name>/SKILL.md`), commands, agents, hooks, MCP servers and
  scripts.
- **[docs]** Ways to distribute it:
  - a directory or `.zip` (`--plugin-dir`, `--plugin-url`);
  - a `marketplace.json` in a git repository that users add;
  - Anthropic's directory, which requires a paid plan.
- **[not documented]** Any limit on a plugin that launches `claude -p` subprocesses.

## Observed on machine 2 (CLI 2.1.294 and 2.1.295)

Source: machine 2's report (kept private).

- **Tool set vs approval.**
  - **[help]** `--tools` specifies "the list of available tools from the built-in set". `--allowedTools` lists
    tools "to allow", i.e. pre-approves them. Restricting a worker needs `--tools`.
  - **[observed]** With only `--allowedTools Read,Edit,Write,Glob,Grep,Bash,TodoWrite`, workers called `Agent`
    (4 Explore subagents in one lane), `Monitor` and `ToolSearch` with 0 denials.
- **[observed] Effort.** With no `--effort`, a worker inherits `effortLevel` from the user settings (xhigh on both
  machines). With `--setting-sources ""` it falls to the CLI default, which was **medium** for Opus 5.5, not high.
  The `effort` field on assistant events shows the effort actually used.
- **[observed] Version gate.** CLI 2.1.217 answers an Opus 5.5 run with API 400 ("version 2.1.280 or newer is
  required"): `subtype: success`, `is_error: true`, exit code 1, about 3 s. Haiku runs pass on the same CLI.
  2.1.217's default model is `claude-opus-4-8[1m]`; a smoke run on it invented a commit SHA without a tool call.
- **[observed] Usage-limit stop.** `api_error_status: 429`, `terminal_reason: "api_error"`, exit code 1. The
  result text names the limit (session or weekly) and the reset time.
- **[observed] The final JSON can describe only the last turn.** When a worker uses `run_in_background`, task
  notifications start new turns (`origin.kind = task-notification`), and `--output-format json` keeps only the
  last `result`. `duration_ms`, `num_turns` and `usage` then cover only that turn; `total_cost_usd` stays
  session-cumulative. 8 of 15 limit-stop and resume results were affected.
- **[observed] Deny rules match tool parameters.** `Bash(timeout:*)` in `--disallowedTools` also denies Bash calls
  that set the tool's own `timeout` parameter (5 of 5; 0 of the other 211 calls).
- **[observed] The Bash static analyzer is its own refusal layer**, independent of allow rules:
  - "A variable in this command can't be checked before it runs" (`cmd; echo x=$?`);
  - "Contains brace with quote character (expansion obfuscation)";
  - "Redirect has multiple targets".

  Compound commands such as a loop with `break` "require approval", which `-p` denies. `cd X && …` is denied even
  with `Bash(cd:*)` allowed.
- **[observed] Waiting is fenced.** `sleep N; …` is blocked by a built-in guard that points to Monitor. Monitor is
  a deferred tool in `-p`: calling it without loading its schema gives an InputValidationError. The Bash tool's
  120 s limit pushes longer waits into the background, which triggers the last-turn JSON problem above.
- **[observed] Untrusted workspace.** In `-p`, project `permissions.allow` entries are ignored with a stderr
  warning ("this workspace has not been trusted"). User settings still load: allow rules, plugin hooks, MCP servers,
  skills, effort and auto-memory. Two workers wrote to the shared memory folder.
- **[observed] Workers inherit the IDE environment.** Launched from an editor session, they register in
  `~/.claude/sessions/<pid>.json` as `kind: interactive`, `entrypoint: claude-vscode`, appear in `ListAgents` and
  accept cross-session messages.
- **[observed] A limit-stopped `-p` with a background child does not exit.** One held a `next dev` server and MCP
  children; it was killed by pid after 1 h 49 min.
- **[observed] The usage limit is per account.** Every running worker of both orchestrators stopped within
  8 minutes (05:59–06:07Z), and the orchestrators themselves got synthetic rate-limit replies until the reset.
  Machine 1's workers stopped and resumed in the same windows, so the two machines most likely share one account
  (inferred).
- **[observed] A cold resume re-pays the context.** Per-resume cost deltas were $1.01–$4.82 at medium and
  $5.95–$18.17 at xhigh; one resume cost $18.17 for 63 tool calls, against $8.87 for the first 79.
- **[not established]** Whether CLAUDE.md and memory still load under `--setting-sources ""`; whether an unscoped
  `Read` reaches `~/.claude/sessions/*.key`.

## Measured in w0 (2026-10-09, CLI 2.1.295, this machine)

The analysis wave of arbab's own build: 8 headless runs, about $3.4 in total. Six probes (5 haiku, 1 opus) ran in a
throwaway repository, and two web-research workers covered the docs. Their full reports, with a source URL for every
claim, are in [w0/docs-claude-code.json](w0/docs-claude-code.json) and
[w0/docs-plugins-sdk.json](w0/docs-plugins-sdk.json). Every run used the same launcher:
`--restricted --setting-sources "" --strict-mcp-config`, dontAsk + `--permission-prompts none`, `--tools`, a
`--settings` file, and a scrubbed environment.

- **[observed] Isolation.**
  - With `--restricted`, the init event has no `memory_paths` and no `messaging_socket_path`. Without it (all
    other flags equal), both are present, so auto-memory and cross-session messaging are on.
  - In both cases three `cc-plugin-*` plugins and 19 skills still load.
- **[observed] CLAUDE.md does not load under `--setting-sources ""`.** A project CLAUDE.md canary and the user
  CLAUDE.md's pnpm rule appear nowhere in the transcripts, with or without `--restricted`. (The docs do not say what
  an empty value does.)
- **[observed] Scrubbed environment.** The init event's `startup_timing.entrypoint` is absent, and Bash children see
  `CLAUDE_CODE_ENTRYPOINT=sdk-cli`. An inherited editor environment gives `claude-vscode`. This session's own
  environment carries `CLAUDE_EFFORT`, `CLAUDE_CODE_MESSAGING_SOCKET`/`_TOKEN`, `CLAUDE_CODE_ENTRYPOINT` and
  `VSCODE_*`, which a launcher must not pass on.
- **[observed] Sandbox walls**, with Read deny rules for credential paths:
  - writes to `~` and `/private/tmp` fail with EPERM; writes in the working directory succeed;
  - `cat .env` is refused twice: by the permission layer (`decision_reason_type: subcommandResults`) and, under
    auto-allow, by the sandbox (EPERM);
  - `ls ~/.ssh`: EPERM;
  - curl and Node `fetch` to example.com fail (the proxy has no allowed domains);
  - listening on 127.0.0.1 works with `allowLocalBinding`;
  - `git status` works but prints EPERM warnings for denied files (`.env`, `~/.config/git/ignore`).
- **[observed] `$TMPDIR` inside the sandbox** is `/tmp/claude-<uid>`, set by Claude Code. A `settings.env.TMPDIR`
  does not override it. That directory holds every session's scratchpad.
- **[observed] Auto-allow does not allow everything.** With `autoAllowBashIfSandboxed: true`, a `node -e` that uses
  `fetch` and `ps -p 1` were still refused in dontAsk mode.
- **[observed] Parameter rules.** A deny rule `Bash(run_in_background:true)` refuses a background Bash call
  (`decision_reason_type: rule`), and calls that set the `timeout` parameter still run. This explains machine 2's
  `Bash(timeout:*)` trap: the docs say `Tool(param:value)` deny rules match top-level input parameters.
- **[observed] `--tools`.** `--tools "Read,Bash,Monitor,ToolSearch,Agent,TodoWrite"` gives the tools Task, Bash,
  Monitor, Read and ToolSearch. Agent appears as `Task`, and TodoWrite is not a tool in this version.
- **[observed] Structured output** arrives through a `StructuredOutput` tool call and lands in the result's
  `structured_output`.
- **[observed] Effort** is not in stream-json events. Only the transcript has it, as `effort` on each assistant
  entry. The opus smoke run asked for high and got high; the probes asked for low and got low.
- **[observed] Quota.** A haiku probe's events showed the five-hour and seven-day windows at 60% each. During
  13 minutes of w0, the five-hour window rose to 68%, and about 3 points of that were w0's own spend. Other sessions
  on the same account spend from the same window.
- **[docs, w0 research]** The research reports cover, with sources:
  - `autoAllowBashIfSandboxed` defaults to true;
  - an allow rule can approve an unsandboxed retry unless `allowUnsandboxedCommands` is false;
  - `sandbox.failIfUnavailable`;
  - `//` for absolute paths in Read/Edit rules (`/` is relative to the settings file);
  - `--max-budget-usd` ignores spend restored by `--resume`;
  - `--json-schema` results and the `error_max_structured_output_retries` subtype;
  - SIGTERM gives exit code 143 with no result;
  - plugin `bin/`, `${CLAUDE_PLUGIN_ROOT}` and node_modules rules;
  - `srt` can wrap the whole process;
  - the Agent SDK bundles its own binary;
  - `--bg` cannot be combined with `-p`.

## Measured during M3/M4 (2026-10-09, CLI 2.1.295, Node 24)

- **[observed] Network allowlist.**
  - With `sandbox.network.allowedDomains: ["example.com"]`, sandboxed `curl https://example.com` returns 200.
  - A host outside the list fails: `CONNECT tunnel failed, response 403`, plus a `<sandbox_violations>` entry
    "deny network-outbound www.iana.org:443".
- **[observed] Proxy environment.** The sandbox sets `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` (and lowercase) and
  `NO_PROXY` for Bash commands.
  - Node's `fetch` ignores them by default: `ENOTFOUND`, because direct DNS is blocked.
  - `node --use-env-proxy` routes `fetch` through the proxy: the allowed host returns 200, and others are refused.
- **[observed] The shared git directory.**
  - Without a `filesystem.denyWrite`, code a worktree's worker runs can create files and loose refs in the
    repository's shared `.git` and in the worktree's own git dir. `.git/config`, `.git/hooks` and the worktree's
    `.git` pointer are protected.
  - `sandbox.filesystem.denyWrite: ["<repo>/.git"]` blocks all of it while git reads keep working (see DESIGN.md §4).

## Local settings that change worker behaviour (both machines)

- `~/.claude/settings.json` sets `effortLevel` and `modelSettings.claude-opus-5-5.effortLevel` to `"xhigh"`. A
  worker launched without `--effort` (and without `--restricted` or `--setting-sources`) inherits xhigh.
- The user settings also carry 222 allow rules (incl. `WebSearch` and 8 `mcp__` rules), a plugin's SessionStart
  hook and MCP servers. All of them reach a worker unless the launcher cuts the setting sources.
- Neither the user nor the project settings define a `sandbox` block, so a worker has no OS sandbox unless its
  launcher passes one (only project-a-7e's did; none on machine 2).
