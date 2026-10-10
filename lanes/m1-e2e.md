# M1 · end-to-end tests and integration fixes

## Task

The M1 modules, the shepherd and the CLI are merged on this branch, each tested in isolation. Prove they work
together through the real bundle, and fix the seams the earlier lanes reported.

1. **End-to-end tests** in `test/e2e/*.test.ts`. A `beforeAll` builds the bundle into a temporary directory with
   esbuild's JS API (same options as `scripts/build.mjs`, `outfile` in the temp dir). Each test:
   - creates a temporary project (the test code initialises a git repository with one commit, and writes
     `arbab.config.json`, `lanes/<lane>.json` and the brief source);
   - uses a temporary `HOME`, so `~/.arbab` and `~/.claude` are temporary;
   - points `ARBAB_CLAUDE` at `test/fake-claude/fake-claude.mjs`, with `FAKE_CLAUDE_SCENARIO` and `FAKE_CLAUDE_LOG`
     listed in the test config's `passEnv` (see Facts);
   - runs the bundle with node through execFile (no shell), with that environment.

   Cover:
   - **Happy path.** `launch`, then `wait --any --timeout-min 2`, which returns the lane with end state `success`.
     Then `status --json` shows it finished. The run directory has every attempt file, and the checkpoint commit
     exists for a `touch` scenario. The fake claude's log shows the argv of DESIGN.md §4: `--restricted`,
     `--setting-sources ""`, `dontAsk`, `--permission-prompts none`, `--strict-mcp-config`, `--tools`, `--settings`,
     `--session-id`. Its environment has no `CLAUDE_*` or `VSCODE_*` names, even though the test's own environment
     sets `CLAUDE_CODE_ENTRYPOINT=claude-vscode` and `VSCODE_PID=1`.
   - **Usage limit.** A usage-limit fixture whose reset is already in the past: auto-resume, the same session id,
     end state `success`, two attempts.
   - **Stop.** `stop` on a hanging scenario: end state `killed:stopped`, no auto-resume, the worker's process group
     gone.
   - **Second launch.** A second `launch` of a running lane is refused (exit 1).
   - **Lint refusal.** `launch` of a lane whose brief asks, in inline code, for a compound command (cd into src,
     then pnpm test, joined by two ampersands) is refused (exit 1) and starts nothing.

   Use small timeouts: the shepherd's tick is not configurable from the CLI, so if a test needs a faster tick, add
   an `ARBAB_TICK_MS` override to `defaultDeps()`, documented as a test hook.
2. **Launch race.** Two concurrent `arbab launch` calls on the same lane can both pass the active-lane check
   before the first shepherd writes `state.json`. Fix it: `launch` takes `createExclusive(<runs>/<lane>/launch.lock)`
   before the checks (refuse if held by a live pid; reclaim if the holder is dead). It removes the lock once the
   shepherd has written its first `state.json`, or after 10 s. Test it.
3. **One pool implementation.** `src/commands/cleanup.ts` repeats `src/run/pool.ts`'s move-aside reclaim logic.
   Export from `src/run`:
   - `releaseIfStale(path, alive): boolean`, the pool's own reclaim, used by both;
   - `listPoolEntries(home): string[]`, every pool file under slots, semaphores, leases and locks.

   Make cleanup use them and delete its copy. Keep the existing tests passing; adjust them only where they tested
   the copy.
4. **Skill corrections** in `skills/arbab/SKILL.md` and its references:
   - Quote the plugin path everywhere, because a home directory can contain spaces. The command and the
     `allowed-tools` rule become:

     ```text
     node "${CLAUDE_PLUGIN_ROOT}/dist/arbab.mjs" <cmd>
     Bash(node "${CLAUDE_PLUGIN_ROOT}/dist/arbab.mjs" *)
     ```
   - Relaunching a finished lane with the same lane file starts a fresh session in the same worktree, continuing
     from its checkpoint commits (that is what `launch` does: mode `fresh`). Say so where the skill suggests a new
     lane name for a corrected relaunch; a new lane name stays the right choice when the scope changes.
   - Add to "Do not": run `stop` and `cleanup` from an unsandboxed shell. They read `ps`, which a sandbox refuses,
     and `stop` then refuses to signal (the safe direction).
   - Update `src/skill.test.ts` for the quoted rule.

## Scope

You own `test/e2e/**`, `src/commands/launch.ts`, `src/commands/cleanup.ts`, `src/run/pool.ts`, `src/run/index.ts`,
their tests, `src/shepherd/index.ts` (only the `ARBAB_TICK_MS` hook in `defaultDeps`, if you need it), `skills/**`
and `src/skill.test.ts`. If an e2e test exposes a bug elsewhere, fix it only when it is small and obvious, and list
it under `decisions`; otherwise report it in `open_questions` with the failing test marked `.fails`.

## Facts

- The orchestrator ran the happy path by hand through the bundle with the fake claude, and it passed: launch,
  shepherd, worktree, the exact argv of DESIGN.md §4, the checkpoint commit, wait and status. Your job is to make it
  a test, then add the other cases.
- **Worker environments are scrubbed.** The fake claude sees `FAKE_CLAUDE_*` only when the test project's config
  lists them in `passEnv`. Without that it exits 2 with "FAKE_CLAUDE_SCENARIO is not set", and the lane ends
  `no-result`.
- Earlier lanes' reports name the contracts that `stop`, `cleanup` and `preflight` rely on:
  - `shepherd.json` `{pid}`;
  - `state.json` with `shepherdPid` set to the shepherd's own pid;
  - `started.json` with `pid`, `binary.path` and `cwd`.

  Verify them end to end.
- `ps` is refused (EPERM) inside your sandbox. The shepherd's `readPs` will fail during e2e tests. If that breaks
  the run, report it and make the shepherd degrade (no descendant tracking, group kill only) rather than fail.
- Spawning node children, detached process groups and listening on 127.0.0.1 work inside your sandbox.

## Acceptance

- [ ] The e2e tests above pass, run by `pnpm test` (no network, no real claude, no real `~/.arbab` or `~/.claude`).
- [ ] The launch lock, the shared pool helpers and the skill corrections, each with tests.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
