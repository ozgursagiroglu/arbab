# M1 fixes · the command line (launch, resume, preflight, lint, context)

## Task

The M1 review and the end-to-end lane found defects in the commands. Fix them; each fix gets a test that fails
without it.

1. **An orphan whose worker still runs (L3).** If a shepherd dies while its detached worker keeps running, the lane
   is `orphaned`, and `launch` or `resume` would start a second writer on the same worktree and session.
   - Before starting a shepherd, refuse (`usage`, exit 1) when the latest attempt's `started.json` pid is alive and
     its ps command line contains `started.binary.path`.
   - The message tells the user to run `arbab cleanup`.
   - When ps is unavailable, refuse whenever the pid is alive: the safe direction.
2. **The resume race.** Two concurrent `arbab resume` calls (or a launch and a resume) can both pass the
   active-lane check. Reuse `takeLaunchLock` from `launch.ts` in `resume.ts`, the way launch does.
3. **The resume prompt in argv (S10, S8).** `resume --prompt` passes up to 64 KB of prompt text inside the
   shepherd's JSON mode argument, readable by any local process through ps.
   - Write the prompt to `<runs>/<lane>/resume-prompt-<n>.md` (exclusive create) and pass its path in the mode
     (`{kind: "resume", promptFile}`; the field is already in `ShepherdMode`). `parseMode` in
     `src/commands/shepherd.ts` accepts `promptFile` (an absolute path). The shepherd lane reads that field; keep
     accepting `prompt` too.
   - Confine the `--prompt` source file with realpath, not lexically: a symlink must not pull in a file outside
     the project.
4. **Preflight writes into the project (C5).**
   - Write the probe lane files under `.arbab/preflight/<lane>/`, never next to the lane file in `lanes/`.
   - When the lane already has a worktree, the probes run in it (lane field `worktree: <lane>`); otherwise they get
     their own.
   - A lane name too long for the `-pf-tools` suffix gets a clear usage error naming the 40-character limit, not a
     generic name error.
5. **`gitCommonDir` in commands.** `lint` and `preflight` compile profiles; pass
   `ProfileInput.gitCommonDir`, from git rev-parse --git-common-dir resolved to an absolute path, so their lint
   sees the same fence the shepherd will use.
6. **`CommandContext.pid`.** Add a `pid` field (default `process.pid`) and use it instead of reading
   `process.pid` in `launch.ts` (side effects at the edges).
7. **Read with `readText`.** Replace the private file-reading helpers in your scope with `readText` from
   `src/util/fs`.

## Scope

You own `src/commands/**` except `wait.ts` and `wait.test.ts`, and `src/cli.ts`. Change nothing else.

## Facts

- `ps` is refused (EPERM) inside your sandbox; tests inject the process-command reader.
- The e2e lane added `takeLaunchLock` in `launch.ts`. It holds a pool `Holder` and is released when the new
  shepherd writes its first `state.json` with its own pid, or after 10 s.

## Acceptance

- [ ] Each numbered fix is done, with a test that fails without it.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
