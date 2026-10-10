# M1 fixes · the fence (profile, config, report, brief)

## Task

The M1 review found fence defects. Fix the ones in your scope; each fix gets tests.

1. **Deny writes to the shared git directory (review S4, HIGH, confirmed by a measurement).** When
   `ProfileInput.gitCommonDir` is set, `compileProfile` adds:
   - `sandbox.filesystem = { denyWrite: [gitCommonDir] }`;
   - the deny rules `Edit(//<gitCommonDir without its leading slash>/**)` and `Write(//…/**)`.

   `lintProfile` reports a new warning `shared-git-writable` when a role that runs Bash has no `gitCommonDir`.
   (`types.ts` already has both fields.)
2. **Drop `git grep` from the read-only git verbs (review S3).** Its `-O`/`--open-files-in-pager` option runs a
   program the caller names; workers have the Grep tool. Keep status, diff, log, show, ls-files and blame. Remove it
   from `GIT_READ_VERBS` and everywhere that list is copied.
3. **One environment-name policy (review C9).** `config/load.ts` refuses `^(CLAUDE|ANTHROPIC|VSCODE|CURSOR)`, `HOME`
   and `PATH`, but not `TERM_PROGRAM`. `profile/env.ts` refuses `TERM_PROGRAM` but not the others. Write one
   policy in `src/util/env-policy.ts` and use it in both:
   - `isForbiddenWorkerEnv(name)`: true for `^(CLAUDE|VSCODE|CURSOR|TERM_PROGRAM)` and `CLAUDECODE`;
   - `isReservedEnv(name)`: forbidden, plus `^ANTHROPIC`, `HOME`, `PATH`;
   - `ANTHROPIC_API_KEY` stays allowed in `passEnv` (API-key users).
4. **One list of git write verbs (review C9).** `src/brief/toolbelt.ts` and `src/brief/test-profiles.ts` copy
   `GIT_WRITE_VERBS`; import it from `src/profile/presets` instead.
5. **Instruction files after symlinks (review S8).** `config/load.ts` confines `instructions` lexically, but a
   symlinked CLAUDE.md could point at a credential file and be inlined into every prompt. Resolve with realpath and
   confine the real path, as `config/lane.ts` already does for briefs (reuse that helper; do not copy it).
6. **The probe schema (review C7).** `DEFAULT_SCHEMAS.probe` requires steps `{n, command, outcome}`, but preflight
   checks `exit_code`. Make it `{n: integer, command: string, exit_code: integer, output: string}`, all required.
7. **Brief lint tests against real profiles (review C8).** `src/brief/*.test.ts` use hand-made profiles that no
   longer match `compileProfile` (implementers may now run rm, and git -C is denied). Build the test profiles
   with `compileProfile` and fix the expectations that change.
8. **Read with `readText`.** Replace the private file-reading helpers in your scope with `readText` from
   `src/util/fs`.

## Scope

You own `src/profile/**`, `src/config/**`, `src/report/**`, `src/brief/**` and the new `src/util/env-policy.ts`
(with tests). Change nothing else.

## Facts

- Measured on CLI 2.1.295 from code a worker ran inside its sandbox (the default worktree sandbox, no
  `filesystem` block):
  - writable: new files in the shared `.git`, new loose refs (`refs/heads/…`), new files in the worktree's own git
    directory;
  - blocked (EPERM): `.git/config`, `.git/hooks`, the worktree's `.git` pointer file, `$HOME`.
- With `sandbox.filesystem.denyWrite: ["<repo>/.git"]`, every one of those writes was blocked (EPERM), while
  `git status`, `git log` and `git diff` in the worktree kept working.
- Read/Edit rule paths need `//` for absolute paths (`/path` is relative to the settings file).

## Acceptance

- [ ] Each numbered fix is done, with a test that fails without it.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
