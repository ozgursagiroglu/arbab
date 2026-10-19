# UI2 · fix the review's findings (`arbab review ui2` at dafa4c8)

## Task

The review of integration `ui2` found only LOW findings. One of them three lenses found independently, so it counts
as confirmed. Fix these on the integration as it stands (the pay sound is already merged):

1. **A bounded first read** (correctness-2, security-1, contracts-2), in `src/ui/server/tail.ts`.
   - The first `count()` of an attempt now reads the whole stream in one synchronous call. A long run's stream (hundreds
     of MB) then blocks the server's event loop: every page, asset and SSE tick stalls.
   - Bound it: the first count of an attempt reads at most 8 chunks of `maxBytesPerCall` (64 MiB at the default),
     and the rest continues on later calls, one chunk each, as before.
   - Make the module's header and `count()`'s comment say exactly that.
   - Tests: a stream larger than the cap takes several calls to count fully; a stream under it is counted on the first
     call.
2. **A crew card removed under the pointer** (correctness-1), in `src/ui/client/app/main.ts`.
   - When a crew card goes away (its lane finished or left the snapshot), browsers fire no `mouseleave` or `blur`, so
     `focused` keeps naming it and overrides the pinned lane's highlight and tooltip.
   - After each crew update, clear `focused` (and `hovered`, for the canvas) when it names a lane no longer in the
     crew list or the snapshot.
   - Test it with the fakes.
3. **One rule for the featured integration** (contracts-1). The Monument panel (`hud/monument.ts` `pickMonument`)
   picks its integration by another rule than the scene and the caption, so they can name different integrations.
   - Export from `src/ui/client/scene/scene.ts` one function, `featuredIntegration(snapshot): UiIntegration | null`.
     It returns the capstone's integration as `foreground()` decides it (a recent landing, else the newest open
     integration that merged a foreground lane), else the monument's, else the newest open integration, else the
     newest landed one.
   - Use it for the panel. Make sure the caption agrees: test the cases the finding names (a recent landing with
     another integration open; an open integration that merged no foreground builder).
4. **Rules copied between modules** (contracts-4): keep one copy of each and import it.
   - `STARTED` and `RESUMING`, and the started condition: `hud.ts` `announcements()` and `hud/chronicle.ts`.
   - The state order: `hud/crew.ts` `RANK` and `hud/ledger.ts` `STATE_RANK`.
   - The cast colors: `hud/tokens.ts` `CHIPS` repeats `palette.ts` `HEADCLOTH`. Derive `CHIPS` from it.
   - Is a lane's block set: `hud/crew.ts` `isSet` re-implements the scene's rule. Export the rule from `scene.ts` and
     use it.
   - `epochMs` and `newest`: `hud/monument.ts` copies them from `scene.ts`. Export them there and import them (or
     drop them with item 3).

   Behaviour stays the same; the existing tests stay green.

## Scope

- `src/ui/server/tail.ts`, `src/ui/server/tail.test.ts`
- `src/ui/client/scene/**`
- `src/ui/client/app/**`

Read anything else; change nothing else. `src/ui/client/model.ts` and `src/ui/protocol.ts` are contracts.

## Facts

- The review's records: `.arbab/integrations/ui2/review.json`, findings correctness-1, correctness-2, security-1,
  contracts-1, contracts-2 and contracts-4. The orchestrator quoted their evidence above.
- `tail.ts:127-135` loops `readMore` until a chunk comes back short. `tail.test.ts:58` asserts the whole-stream first
  read: change that test to the bounded rule.

## Acceptance

- [ ] Items 1–4 are done, with tests; list them by number in `notes_for_reviewer`.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` exits 0, except `test/assemble-plugin.test.ts > the committed plugin/` if `plugin/` is stale. Report
      its message as it is.
- [ ] `git diff` touches only the Scope's paths.

## Notes

- **Do not run `pnpm build`** (this overrides the project rule for this lane). It rewrites the tracked `plugin/`; a
  build lane rebuilds it after this one.
