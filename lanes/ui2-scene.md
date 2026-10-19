# UI2 · the scene: the idle monument, time, shake and glow (src/ui/client/scene)

## Task

The game-studio pass (DESIGN.md §19, "The game-studio pass") adds four fields to the World:
- `World.time`
- `World.shake`
- `Capstone.glow`
- `Pyramid.monument`

They are on this lane's base, in `src/ui/client/model.ts`; read their comments. The renderer of the next wave draws
them. Make the scene fill them as decided here, and fix two leftovers of the first version.

1. **Time**: `step(dtMs)` adds the step's seconds (after the 100 ms cut) to `world.time`. It starts at 0.
2. **The idle monument**: while the foreground holds no building lane, the newest landed integration (by `landedAt`)
   stands in the foreground as a finished pyramid.
   - `pyramid.monument` is its name. The layout is `pyramidLayout(integration.lanes.length)`. Every block is `set`,
     fill 1, and carries the lane names in order.
   - Its capstone is `set` on the apex, with `flag: "passed"` when its verify passed, `ready` true and `glow` 0.
   - It is not also drawn far away: `far` leaves it out.
   - When a building lane appears, the monument leaves: `monument` becomes null, the layout becomes the new work's,
     and the monument joins `far` (newest first).
   - At the baseline, and in reduced motion, this happens at once. Live, the new work's empty outline appears at
     once too: the horizon is the transition. A landing still within its 10 minutes is the foreground (as now), not
     a monument.
   - With nothing landed, the foreground stays the empty outline, as now.
3. **Shake**:
   - A live fall sets `world.shake` to max(shake, 2). A live capstone set sets it to max(shake, 3).
   - It decays linearly at 6 px per second to 0. Reduced motion never shakes.
4. **Glow**:
   - A capstone set live (the hoist ends) gets `glow` 1, which decays linearly to 0 over 4 s.
   - A capstone already set at the baseline has glow 0.
5. **Dust underfoot**: a walking or slumping actor (pose `walk`, `slump`, `carry-*`, not `climb`) makes one `dust`
   particle at its feet every 0.25 s of walking, with vx −4…4 and vy −6…−2. Never in reduced motion. The particle cap
   holds.
6. **Two landings** (the review's LOW): when a second landing arrives while the first capstone is hoisting, the
   first now sets and then stays on the apex for 1.5 s before the next hoist starts from the sledge (today the next
   starts in the same step). Test it.
7. **The first read of a long stream** (the review's LOW, `src/ui/server/tail.ts`): the first `count` of an attempt
   reads in `maxBytesPerCall` chunks until the end of the file, so the first snapshot counts the whole stream. Later
   calls still read at most `maxBytesPerCall`. Test it with a tiny `maxBytesPerCall`.

Keep every existing behaviour and test. Determinism stays: same inputs and seeded random give deep-equal worlds,
`time` and `shake` included.

## Scope

- `src/ui/client/scene/**`
- `src/ui/server/tail.ts`, `src/ui/server/tail.test.ts`

Read anything else; change nothing else. `src/ui/client/model.ts` and `src/ui/protocol.ts` are contracts: report a
change you need in `open_questions`.

## Facts

- `src/ui/client/model.ts` (on this lane's base) holds the new fields with their comments; `createScene` already
  initialises them to 0, 0, 0 and null.
- `foreground()` in `scene.ts` decides recent landings (10 minutes), the capstone and `far`. `farPyramidPlace` is in
  `layout.ts`.
- `UiIntegration.lanes` lists the merged lanes in order. `verify` is "passed", "failed" or null.

## Acceptance

- [ ] Items 1–7 are done, each with tests in `scene.test.ts`, `layout.test.ts` or `tail.test.ts`:
      - time adds up;
      - the monument at the baseline, live and with nothing landed;
      - it leaving when work starts;
      - shake decay and its reduced-motion zero;
      - glow decay;
      - dust only while walking;
      - the 1.5 s hold;
      - the full first read.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` exits 0, except `src/ui/client/pipeline.test.ts` when its live goldens (`docs/ui/live-*.png`) go
      stale from your changes. Those goldens belong to the wave-2 lane `ui2-wire`: do **not** delete or regenerate
      them. Report the failure's message as it is.
- [ ] `git diff` touches only the Scope's paths.

## Notes

- **Do not run `pnpm build`** (this overrides the project rule for this lane). It rewrites the tracked `plugin/`; the
  orchestrator rebuilds it after integration.
- A sibling lane writes the pixel font in parallel; the renderer and the page come in the next wave.
