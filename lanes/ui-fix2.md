# UI · fix the second review's findings (`arbab review ui` at 89508cc)

## Task

The second review of integration `ui` found the items below. Fix each as decided here, on the integration as it
stands. The design is DESIGN.md §19; where this brief changes it, this brief wins (the orchestrator updates DESIGN.md).

1. **An opener that fails is not "opened"** (correctness-1 and contracts-1, MEDIUM, confirmed; security-2).
   - `makeOpenUrl` (`src/commands/context.ts`) returns true as soon as it spawns the opener, so a failed `open` (a
     sandbox that blocks Launch Services) or a missing `xdg-open` still prints the URL without its token. Make
     `CommandContext.openUrl` `(url: string) => Promise<boolean>`, resolving:
     - false on the child's `error` event (ENOENT and the like) or on an exit with a code other than 0;
     - true on an exit with code 0;
     - true when the opener is still running after 5 s (some `xdg-open`s wait for the browser they start). The
       timer is `unref`'d and cleared when the child exits first, and the child stays detached and `unref`'d.
   - `runUi` (`src/commands/ui.ts`) awaits it.
   - Update the testkit fake (`opened` still records the URLs) and test every outcome with a fake spawn: error,
     exit 0, exit 1, still running.
   - The comment "the URL is printed anyway" goes: it is no longer true.
2. **Elapsed time stops with the run** (correctness-2). The page counts from `since` only while the lane's state is
   live (`isLive` from `src/registry/status.ts`). A finished or orphaned lane whose `elapsedMs` is null shows `—`.
   This is in `src/ui/client/app/hud.ts` (`laneElapsedMs` and the tooltip lines); test both.
3. **Ports**: `--port` takes 0 or 1024–65535 (security-1). A browser leaves port 80 out of `Host` and `Origin`, so
   the server's own checks would refuse every request. Anything else is a usage error (exit 1), tested.
4. **A run without an attempt has no report** (contracts-2). In `src/ui/server/snapshot.ts`, `reportStatus` and
   `findings` come from `latestReport` only when the state's `attempt` is the lane's latest attempt. A run that failed
   in setup (attempt 0) has none, so it shows no report of an earlier run. Test it.
5. **`worktreeOf` is another lane** (contracts-3): a `worktree` equal to the lane's own name gives `worktreeOf: null`,
   so a verifier in its own worktree builds a block. Test it.
6. **Two landings within the 10 minutes** (correctness-3). In `foreground()` (`src/ui/client/scene/scene.ts`):
   - Every integration landed less than 10 minutes ago keeps its lanes in the foreground, not only the newest.
   - The capstone shows the newest landing.
   - A landing that arrives while another's capstone is still hoisting lets that hoist finish (it sets) before the
     new one starts from the sledge.
   - Test both.

## Scope

- `src/commands/context.ts`, `src/commands/testkit.ts`, `src/commands/ui.ts`, `src/commands/ui.test.ts`
- `src/ui/**` except `src/ui/protocol.ts` and `src/ui/client/model.ts`
- `docs/ui/**` (only if a golden changes; look at it)

Read anything else; change nothing else.

## Facts

- `src/commands/context.ts:56-66` (at 89508cc): `makeOpenUrl` spawns `open`/`xdg-open` detached with stdio ignored,
  swallows `error`, `unref`s and returns true.
- `src/commands/ui.ts:68-71` (at 89508cc) prints the URL without its token when `openUrl` returns true, and with it
  otherwise.
- `isLive` is exported by `src/registry/status.ts`, which has type imports only (safe for the page bundle).
- `latestReport` is in `src/commands/integration.ts`. `snapshot.ts` already computes the state's current attempt.

## Acceptance

- [ ] Items 1–6 are done, each with tests; list them by number in `notes_for_reviewer`.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` exits 0, except `test/assemble-plugin.test.ts > the committed plugin/`, if `plugin/` is stale
      after your changes (the orchestrator rebuilds it next). Report its message as it is.
- [ ] `git diff` touches only the Scope's paths.

## Notes

- **Do not run `pnpm build`** (this overrides the project rule for this lane). It rewrites the tracked `plugin/`; a
  separate lane rebuilds it after this one.
