# UI · fix the review's findings on the integration (`arbab review ui`)

## Task

The review of integration `ui` (head `53ba445`) confirmed or raised the findings below. Fix each as decided here, on
the integration as it stands. The design is DESIGN.md §19; where this brief changes it, this brief wins (the
orchestrator updates DESIGN.md and the skill).

1. **Reports from the latest attempt only** (correctness-2, contracts-3).
   - `src/ui/server/snapshot.ts` reads `reportStatus` and `findings` from a loop that falls back to older attempts.
     Use `latestReport(runsRoot, lane)` (`src/commands/integration.ts`) instead. An older attempt's report never
     stands in, and a report that does not parse is no report: no hidden lane.
   - Fix the `reportStatus` comment in `src/ui/protocol.ts` to say so: "The latest attempt's report status
     (implementer and verifier); null when it has none".
   - Test: attempt 1 reports `partial`, attempt 2 has no report, so `reportStatus` is null. Also test an unparsable
     report.json.
2. **Preflight probes are water carriers** (contracts-2). `arbab preflight` gives its probes the probed lane's role.
   - In `snapshot.ts`, a lane is kind "preflight" when its name ends in `-pf-tools` or `-pf-model` *and* its
     lane.json `brief` is under `.arbab/preflight/`, whatever its role. Take that directory from where
     `src/commands/preflight.ts` defines it: export it there if it is not exported.
   - In `src/ui/client/scene/scene.ts`, `castOf` decides by kind before role: verify is a surveyor, review a scribe,
     skeptic a skeptic, preflight a water carrier. Then by role for kind "lane".
   - Tests on both sides use an implementer-role preflight probe (what preflight really writes).
3. **No token on stdout when the browser opened** (security-1, contracts-4). Claude Code stores a background command's
   output on disk and in the transcript, so `arbab ui` prints the token only when someone needs it. In
   `src/commands/ui.ts`:
   - When `ctx.openUrl(url)` returns true, print `arbab ui: <project> at http://127.0.0.1:<port>/ (opened in your
     browser)` and `read-only; Ctrl-C stops it`, with no token.
   - With `--no-open`, or when the opener returns false, print the URL with the token, as now, and say on stderr
     `open the URL above in a browser` when the opener failed.
   - `--json` keeps printing the URL with the token: it is asked for explicitly.
   - Update the tests for every branch.
4. **The problem banner and recovery** (correctness-3). In `src/ui/server/http.ts`:
   - The first successful build after a `problem` was sent goes to every client at once, changed or not.
   - A client that connects while the problem stands (three or more failures in a row, a problem sent) gets the
     `problem` event right after `retry`, and after the latest snapshot when there is one.
   - Test both.
5. **A closed stream says so** (correctness-4). In `src/ui/client/app/main.ts`:
   - On `error`, when the EventSource's `readyState` is CLOSED (2), show the notice: "This session ended or
     restarted: open the URL `arbab ui` printed." Set the connection text to `disconnected`.
   - While it is CONNECTING (0), keep "reconnecting". Add `readyState` to the EventSource interface in
     `browser.ts`.
   - Test with the fakes.
6. **One copy of each helper** (contracts-5):
   - `src/commands/generated.ts`: export `generatingIntegration(by: string | null): string | null` (the name after
     `integration:`, else null). Use it in `assertNotGenerated` and in `snapshot.ts`, and drop snapshot.ts's own
     `BY`.
   - `src/registry/status.ts`: export the live states (`LIVE_STATES` or an `isLive(state)` function) and
     `formatWindows`. `snapshot.ts` uses the first. `src/ui/client/app/hud.ts` uses the second, importing
     `src/registry/status.ts` directly (it has type imports only; never the registry index, which pulls `node:fs`).
     Delete the copies.
   - Test the new exports where they live.
7. **Palette tests** (contracts-6): `src/ui/client/app/palette.test.ts` tests `toHex`, `shade`, `mix`, `desaturate`
   and `ghostly`: clamping, rounding and lowercase hex.
8. **Contract changes the frames showed** (from ui-wire's report). You may change `src/ui/client/model.ts` for
   exactly these two:
   - `CAMP.rowStep` becomes 16. A second-row worker's icon covered a first-row worker's face (`docs/ui/dusk.png`).
   - `Pose` gets `"climb-stone"`:
     - the scene uses it for a builder climbing up to its block with its stone, and `"climb"` for every other
       climb (climbing down to report, or a scribe going up a course);
     - the renderer draws `"climb"` empty-handed and `"climb-stone"` with the stone on the back;
     - the sprite tests cover both.
9. **Goldens**: regenerate every `docs/ui/*.png` these changes alter (delete them, run the tests) and look at each
   with the Read tool. In particular, look at the camp in `dusk.png` and at the climbs in `live-climb.png`. Say what
   you saw in `decisions`.

## Scope

- `src/ui/**` (including the contracts `src/ui/client/model.ts`, for item 8 only, and `src/ui/protocol.ts`, for
  item 1's comment only)
- `docs/ui/**`
- `src/commands/ui.ts`, `src/commands/ui.test.ts`
- `src/commands/generated.ts`, `src/commands/generated.test.ts`
- `src/commands/preflight.ts` (exporting the directory constant only), `src/commands/preflight.test.ts`
- `src/registry/status.ts`, `src/registry/status.test.ts`

Read anything else; change nothing else.

## Facts

- `.arbab/runs/ui-preflight-pf-tools/lane.json` (written by `arbab preflight lanes/ui-preflight.json`, 2026-10-18) has
  `"role": "implementer"` and `"brief": ".arbab/preflight/ui-preflight/ui-preflight-pf-tools.md"`.
- `latestReport` (`src/commands/integration.ts:311`) reads the latest attempt's report.json through `readReport`,
  which returns null for a report that does not parse.
- `src/registry/status.ts:6` holds `LIVE`; `:72` holds `formatWindows` (not exported); `generated.ts:33` holds
  `BY = "integration:"`.
- The review's evidence lists the file and line of every finding: `.arbab/integrations/ui/review.json` (readable
  from the main checkout; your worktree is under `.arbab/worktrees/`).
- Claude Code's Read tool displays PNG files.

## Acceptance

- [ ] Items 1–9 are done, each with tests. In `notes_for_reviewer`, list them by number with their tests.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` exits 0, except `test/assemble-plugin.test.ts > the committed plugin/` (the stale plugin/, which
      the orchestrator rebuilds next). Report its failure message as it is.
- [ ] `git diff` touches only the Scope's paths.

## Notes

- **Do not run `pnpm build`** (this overrides the project rule for this lane). It rewrites the tracked `plugin/`; a
  separate lane rebuilds it after this one.
