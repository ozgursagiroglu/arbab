# M1 review · security lens

## Task

Review the M1 runner on this branch (`src/`) for security defects. arbab launches AI coding agents on a developer's
machine next to production credentials. Its fence is the only thing keeping a worker from pushing code, reaching
the network, reading secrets or touching other projects. A defect here is a defect in that fence. DESIGN.md §4
(the fence), §3 (files), §15 (security notes) and CLAUDE.md are the standard.

Look for, in this order of importance:

1. **Fence escapes.** Compiled allow rules that let a worker run arbitrary code or reach a write it should not
   have. Deny rules a worker can bypass (prefix tricks, wrappers, compound commands, parameter rules).
   Sandbox settings that fail open: `failIfUnavailable`, `allowUnsandboxedCommands`, `autoAllowBashIfSandboxed`,
   network. Settings, wrappers or run files a worker can write. A worker inheriting the host's environment, settings,
   MCP servers or messaging.
2. **Path traversal and symlinks.** Lane names, brief/schema/instruction paths, run directories, worktree paths
   and pool files: can input escape its root? Can a symlink planted inside a worktree redirect a write made by
   the runner (checkpoint, reports, `.arbab-tmp`)?
3. **Command and argument injection.** Shell strings anywhere. Argv elements starting with `-` (a git base ref,
   a lane name, a model). Values interpolated into git, ps or claude arguments.
4. **Secrets on disk or in logs.** Environment values, prompt contents with secrets, `stderr.log`, `args.json`,
   `started.json`.
5. **Process safety.** Signals that could hit pid 0, -1, the runner itself, or a recycled pid. Races in pools,
   locks and leases: TOCTOU, two holders, a stale reclaim that steals a live holder.
6. **Input validation.** Config, lane files and stream events: crash or misbehave on hostile or malformed input.

## Scope

Read-only. Read in full, at least: `src/profile/**`, `src/util/**`, `src/config/**`, `src/run/**`,
`src/shepherd/**`, `src/commands/**`, `src/cli.ts`. Read others as needed. You may run `pnpm test` and
`pnpm typecheck`.

## Facts

- Measured on CLI 2.1.295 (research/native-claude-code.md, "Measured in w0"):
  - Read deny rules block both the Read tool and Bash commands that name the path;
  - the sandbox blocks writes outside the working directory, and blocks the network;
  - a deny rule on the Bash tool's run_in_background parameter refuses background calls;
  - `--restricted` turns off auto-memory and messaging;
  - a scrubbed environment makes the worker's entrypoint `sdk-cli`.
- Claude Code splits compound commands on the and/or operators, semicolons, pipes, a trailing ampersand and
  newlines. Every part must match an allow rule; a deny rule matches if any part matches. Wrappers (timeout, nice,
  nohup, xargs, …) are stripped before matching.
- The per-user temp dir (`/tmp/claude-<uid>`) is writable from every sandbox.

## Acceptance

- [ ] Every file in Scope is listed in `paths_checked`, and `coverage` says what you verified and how.
- [ ] Each finding names the file and line, gives a concrete failure scenario (input or state → what goes wrong),
      and cites its evidence (the code path, or a test you ran). No style remarks.
- [ ] At most 10 findings, strongest first.
