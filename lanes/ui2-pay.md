# UI2 · coins drop from the treasury when a worker takes its bread (integration ui2)

## Task

The owner, watching the scene: "when the man takes his bread, there should be the sound of money dropping from the
treasury." Add that moment as a scene event, a sound and a small sight.

1. **The event** (`src/ui/client/model.ts`, the one change allowed there):
   - Add `"pay"` to `SceneEventKind`, with a comment: a worker takes its ration from the table, and coins drop from
     the treasury.
   - Nothing else in the contract changes.
2. **The scene** (`src/ui/client/scene/scene.ts`): at the moment a finished worker's 0.6 s pause at the ration table
   ends and it starts to carry its ration (ration > 0), push `{ kind: "pay", lane }`, once per worker.
   - A worker that leaves empty-handed (ration 0, slumped) fires nothing.
   - In the same step, unless motion is reduced, 3–5 `coin` particles jump from the treasury (`PLACES.treasury`, a
     few px above the chest) and fall back with the existing coin physics.
   - The event fires in reduced motion too: it is sound, not motion.
   - Tests: the event fires once, in that step, with the lane; never for ration 0; the coin particles appear only
     without reduced motion; determinism holds.
3. **The sound** (`src/ui/client/app/sound.ts`): `"pay"` plays coins dropping into the chest.
   - Two to four short metallic clinks, 45–90 ms apart, each a bright partial or two (about 2–4.5 kHz, sine or
     triangle) with a fast exponential decay (80–160 ms). Their pitches vary slightly, from a fixed sequence, so the
     sound is deterministic.
   - Under the first clink, a soft, low wooden knock of the chest (about 120–180 Hz, 60 ms).
   - Throttle it like the stone drum: at most two pays a second.
   - Quieter than the horn.
   - Off while the sound is off, like every other sound.
   - Tests with the fake AudioContext: the nodes and their timing, the throttle, silence while off.
4. **Goldens**: if `live-ration` (or another live golden) changes because of the coins, delete it, regenerate it and
   look at it with the Read tool.

## Scope

- `src/ui/client/model.ts` (the `SceneEventKind` union only)
- `src/ui/client/scene/**`
- `src/ui/client/app/sound.ts`, `src/ui/client/app/sound.test.ts`
- `src/ui/client/pipeline.test.ts`, `docs/ui/live-*.png`

Read anything else; change nothing else.

## Facts

- `scene.ts` at the integration's head: the ration step is `hold("idle", RATION_PAUSE)` followed by
  `go({ ...PLACES.exit }, ration > 0 ? "carry-ration" : "slump", { ration })` (around line 532). `RATION_PAUSE` is
  0.6, and coin particles are already made at the treasury when the spend grows (around line 1057).
- `sound.ts` has `createSound(deps)` with `play(kind: SceneEventKind)`, a `switch` over the kinds, and the stone
  throttle on the injected clock (`deps.now`). Its tests use a fake AudioContext.
- `main.ts` plays every event in `world.events` through `sound.play`, so the new kind needs no change there.

## Acceptance

- [ ] Items 1–4 are done, with the tests named.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` exits 0, except `test/assemble-plugin.test.ts > the committed plugin/` if it fails because
      `plugin/` is stale (the orchestrator rebuilds it next). Report its message as it is.
- [ ] `git diff` touches only the Scope's paths.

## Notes

- **Do not run `pnpm build`** (this overrides the project rule for this lane). It rewrites the tracked `plugin/`; a
  build lane rebuilds it after this one.
