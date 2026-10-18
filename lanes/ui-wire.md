# UI · wire the scene, the renderer and the server together, and polish (wave 2)

## Task

Wave 1 built the three parts of `arbab ui` apart: the server (`src/ui/server`), the scene (`src/ui/client/scene`) and
the page with its renderer (`src/ui/client/app`). Their reports are inlined below. This lane makes them one working
thing and checks it by eye, as DESIGN.md §19 describes.

1. **`src/ui/client/pipeline.test.ts`**: drive the real `createScene` with a scripted day of snapshots, built with the
   scene's test kit (`src/ui/client/scene/testkit.ts`). Step it at 60 fps and draw it with the real `renderWorld` into
   the raster (`src/ui/client/app/raster.ts`). Write frames at 2× as goldens `docs/ui/live-<moment>.png`, with the
   same golden rule as `frames.test.ts`. The moments:
   - `baseline`: the first snapshot of a session in progress: 8 lanes in mixed states, one integration waiting with a
     green pennant, and one landed far away;
   - `talk`: a new lane talking with arbab, the worker's bubble open;
   - `strike`: a builder mid-stroke on an upper course, on its plank;
   - `climb`: a builder on its ladder carrying a stone;
   - `fall`: a failed lane's stones in the air;
   - `ration`: a worker at the bread-and-beer table;
   - `capstone`: hoisting halfway, then set.
2. **Look at every frame** with the Read tool. Fix whatever does not fit between scene and renderer, on either side
   of the line. Look for:
   - feet off the courses or the ground;
   - ladders that do not reach;
   - bubbles off the canvas or over each other;
   - wrong draw order;
   - the camp or the talk queue overlapping props;
   - the capstone missing the apex;
   - rubble outside the foot.
3. Replace the test-only pyramid helper in `src/ui/client/app/fixtures.ts` with `pyramidLayout` from the scene (one
   source of geometry). Regenerate the goldens this changes: delete them, run the tests, look at them.
4. **`test/e2e/ui.test.ts`**: assert that the bundle serves the real page script. `/app.js` contains a marker from
   `main.ts` and is not the placeholder.
5. **A cost bound**: render a 300-lane world through a `Canvas2D` fake that counts calls, and assert fewer than
   40,000 `fillRect` calls per frame. If it fails, precompute more (static layers as run lists) until it passes.

## Scope

`src/ui/**` except the contracts `src/ui/protocol.ts` and `src/ui/client/model.ts`; `docs/ui/**`;
`test/e2e/ui.test.ts`. Read anything else; change nothing else. Report a contract change you need in
`open_questions`.

## Facts

- The upstream reports below say what each wave-1 lane built, decided and left open; start from them.
- `docs/ui/day.png`, `dusk.png`, `capstone.png` and `night.png` are the renderer's goldens from hand-built Worlds
  (lane ui-art).
- Claude Code's Read tool displays PNG files.

## Acceptance

- [ ] `pipeline.test.ts` writes and checks the seven live goldens, and you looked at each (in `decisions`, say what
      you fixed after looking).
- [ ] The fixtures use `pyramidLayout`.
- [ ] The e2e test proves the real script is served.
- [ ] The fillRect bound holds for 300 lanes.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `git diff` touches only the Scope's paths.

## Notes

- **Do not run `pnpm build`** (this overrides the project rule for this lane). It rewrites the tracked `plugin/`; the
  orchestrator rebuilds it after integration.
