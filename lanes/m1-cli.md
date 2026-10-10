# M1 · the command line (src/cli.ts, src/commands)

## Task

Replace the stub `src/cli.ts` with the dispatcher and implement the commands of DESIGN.md §10 in `src/commands/`, one
file per command, each exporting `run<Name>(argv: string[], ctx: CommandContext): Promise<number>` (the exit status).
`CommandContext` (in `src/commands/context.ts`) carries:
- `cwd`, `stdout` and `stderr` writers;
- `hostEnv`, `home` (`~/.arbab`), `claudeHome`;
- `clock`, `sleep`, `alive`, `signal`;
- `spawnShepherd(projectRoot, lane, mode)`;
- `shepherdDeps()` (from `defaultDeps()` of `src/shepherd`).

Tests inject everything. Parse arguments with `node:util` `parseArgs` (strict; unknown flags are usage errors,
exit 1). Every command that prints data supports `--json` (stable, documented in a comment at the top of the
command file). Errors are `ArbabError`s mapped by `exitCodeFor`.

The project root is the nearest ancestor of `cwd` that contains `arbab.config.json`, else the git top level
(`git rev-parse --show-toplevel`).

Commands:

- **`doctor`**. Checks:
  - node ≥ 20;
  - `git --version` ≥ 2.20;
  - `resolveBinary` succeeds and is ≥ `config.minClaudeVersion`;
  - sandbox support: macOS needs `/usr/bin/sandbox-exec`; Linux needs `bwrap` and `socat` on PATH;
  - `loadConfig`;
  - the worktree and runs roots are ignored: `git check-ignore`; a warning, not a failure, since the shepherd adds
    them;
  - `home` is writable.

  Each line is `ok|warn|fail  <check>  <detail>`. Exit 1 if any check fails.
- **`lint <lane.json>`**:
  - `loadLane`;
  - compile the profile with the placeholder worktree `<root>/<worktreeRoot>/<lane>` and placeholder leases (value
    0);
  - `lintProfile`, then `parseBriefSource` + `lintBrief` on the brief source;
  - check the schema file loads as JSON.

  Print the issues (`error|warning  <code>  <message>  (<where>)`). Exit 1 on any error.
- **`launch <lane.json>`**:
  - run lint first and refuse on errors;
  - refuse when the lane is active, i.e. its effective state is neither `finished` nor `orphaned`;
  - write the validated spec to `<runs>/<lane>/lane.json`;
  - call `spawnShepherd(root, lane, {kind: "start"})`, or `{kind: "fresh"}` when the lane ran before;
  - print the lane, its run directory and the shepherd pid.

  The default `spawnShepherd` starts `process.execPath <this script> __shepherd <root> <lane> <mode-json>` detached
  (own process group), with stdout and stderr appended to `<runs>/<lane>/shepherd.log`, and unrefs it.
- **`__shepherd <root> <lane> <mode-json>`** (internal): an AbortController wired to SIGTERM and SIGINT, then
  `runShepherd(root, lane, mode, defaultDeps(), signal)`. Exit 0 whatever the end state; the state is on disk.
- **`status [--json] [lane…]`**:
  - one `statusRow` per lane, from `readState` and the latest attempt's `summary.json`;
  - for a running attempt with no summary yet, compute a live one: `parseStream` + `digestStream` of the partial
    stream, then `buildAttemptSummary` with state `running`;
  - print `formatStatusTable`, then the `formatQuota` line.
- **`wait [--any|--all] [--timeout-min N] [--json] [lane…]`**: `waitForFinished` (default `--any`). For each
  finished item print `<lane>#<attempt> <endState> <wall> turns=<n> calls=<n> failed=<n> cost=$<Δ> report=<path or
  —>`. Exit 0, or 3 on timeout.
- **`resume <lane> [--prompt <file>]`**: only for an inactive lane whose latest attempt has a session id;
  `spawnShepherd(root, lane, {kind: "resume", prompt})`.
- **`stop <lane>`**: read `shepherd.json`. Signal only if `alive(pid)` and `ps -p <pid> -o command=` contains
  `__shepherd` and the lane name, so a recycled pid is never hit. Then SIGTERM. Exit 1 when the lane is not running.
- **`preflight <lane.json>`**:
  1. Write two probe lanes next to the lane, `<lane>-pf-tools` and `<lane>-pf-model`, with the lane's role, tools
     and fence:
     - `-pf-tools` runs on `claude-haiku-5-5` at effort `low`. Its brief lists `config.preflight.steps` as single
       commands, foreground, each with the Bash timeout parameter.
     - `-pf-model` runs on the lane's model and answers `OK <sha>` after running `git rev-parse --short HEAD`.
  2. Launch both and wait for both.
  3. Pass only if all of these hold:
     - the init tools equal the expected tools;
     - permission mode `dontAsk`, no MCP servers, `memoryPaths` and `messagingSocket` false, and the version equals
       the pinned binary's;
     - stderr has no "has not been trusted" and no "Ignoring";
     - the registration (if any) is not `claude-vscode`;
     - each probe made at least one real tool call;
     - every step exited 0 (from the `-pf-tools` report);
     - the sha in `-pf-model`'s answer equals `git rev-parse --short HEAD` of the worktree.

  Print each check. Exit 1 on any failure.
- **`quota [--json]`**: `formatQuota` and the `holdDecision`.
- **`cleanup [--worktrees]`**:
  - mark lanes whose shepherd is dead (and not finished) `orphaned`, and reap their recorded worker pgid if it is
    still alive;
  - remove pool files (slots, leases, locks, semaphores) whose holder pid is dead;
  - with `--worktrees`, `git worktree remove` the worktrees of finished lanes that are clean and whose branch is
    merged into `baseBranch`;
  - print what was done.
- **`--help`, `help`, `--version`, `version`**, as in the stub.

## Scope

You own `src/cli.ts` and `src/commands/**`. Read everything else; do not edit other modules (report gaps in
`open_questions`). `src/shepherd/` is written in parallel by another lane: code against the contract in its stub
(`runShepherd`, `defaultDeps`, `ShepherdMode`), and test commands with an injected `spawnShepherd` and
`shepherdDeps`.

## Facts

- The CLI is bundled by `scripts/build.mjs` into `dist/arbab.mjs` and run as `node dist/arbab.mjs …` (the plugin runs
  `node "${CLAUDE_PLUGIN_ROOT}/dist/arbab.mjs" …`), so "this script" is `process.argv[1]`.
- Machine 2's `stop` by pid hit nothing wrong only by luck; pids are recycled.
- Edge-triggered watchers missed finishes on machine 2; `wait` is level-triggered with acks (src/registry).

## Acceptance

- [ ] Every command above, with tests per command using a temporary project (git repository + config + lane file +
  brief) and injected context. Cover usage errors, `--json` output shape, lint refusal in `launch`, the active-lane
  refusal, `wait` timeout (exit 3), `stop`'s recycled-pid guard, `cleanup` of a stale pool file, and `preflight`'s
  pass/fail evaluation (feed it summaries and reports as files; do not run real probes in tests).
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0, and `node dist/arbab.mjs --help` lists every command.
