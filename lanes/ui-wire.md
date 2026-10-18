# UI · wire the scene, the renderer and the server together, and polish (wave 2)

## Task

Wave 1 built the three parts of `arbab ui` apart: the server (`src/ui/server`), the scene (`src/ui/client/scene`) and
the page with its renderer (`src/ui/client/app`). Their reports are inlined below. This lane makes them one working
thing, fixes what the reports left open, and checks the result by eye, as DESIGN.md §19 describes.

1. **`src/ui/client/pipeline.test.ts`**: drive the real `createScene` with a scripted day of snapshots, built with the
   scene's test kit (`src/ui/client/scene/testkit.ts`: `uiLane`, `finishedLane`, `uiIntegration`, `uiQuota`,
   `uiSnapshot`, `at`, `seededRandom`). Step it at 60 fps and draw it with the real `renderWorld` into the raster
   (`src/ui/client/app/raster.ts`). Write frames at 2× as goldens `docs/ui/live-<moment>.png`, with the same golden
   rule as `frames.test.ts`. The moments:
   - `baseline`: the first snapshot of a session in progress: 8 lanes in mixed states, one integration waiting with a
     green pennant, and one landed far away;
   - `talk`: a new lane talking with arbab, the worker's bubble open;
   - `strike`: a builder mid-stroke on an upper course, on its plank;
   - `climb`: a builder on its ladder carrying a stone;
   - `fall`: a failed lane's stones in the air;
   - `ration`: a worker at the bread-and-beer table;
   - `capstone`: hoisting halfway, then set.
2. **Look at every frame**, the four goldens of wave 1 included, with the Read tool. Fix whatever does not fit between
   scene and renderer, on either side of the line. Look for:
   - feet off the courses or the ground;
   - ladders that do not reach;
   - bubbles off the canvas or over each other;
   - wrong draw order;
   - the camp or the talk line overlapping props;
   - the capstone missing the apex;
   - rubble outside the foot.
3. **The talk line stays on the canvas**: at most 6 workers stand in line behind the audience spot (k = 1…6). The
   others wait where they are (their seat, spot or place) and join when a place frees up, in arrival order. Test it
   with 20 lanes starting at once.
4. Replace the test-only pyramid helper in `src/ui/client/app/fixtures.ts` with `pyramidLayout` from the scene (one
   source of geometry). Regenerate the goldens this changes: delete them, run the tests, look at them.
5. **`test/e2e/ui.test.ts`**: assert that the bundle serves the real page script. `/app.js` contains a marker from
   `main.ts` and is not the placeholder.
6. **A cost bound**: render a 300-lane world through a `Canvas2D` fake that counts calls, and assert fewer than
   40,000 `fillRect` calls per frame. If it fails, precompute more (static layers as run lists) until it passes.
7. **`src/commands/ui.ts`**: when `ctx.openUrl` returns false, print `open the URL above in a browser` on stderr.
   The URL carries the token, which goes to stdout only. Update its test.
8. **`src/stream/index.test.ts`**: add `toolUses` and `REPORT_TOOL` to the export list it checks.
9. **One cast mapping**: `src/ui/client/app/hud.ts` copies the cast table to color the crew list. Make it use
   `castOf` from `src/ui/client/scene/scene.ts` and delete the copy.
10. **Far pyramids on the left horizon** (the owner's composition, from the wave-1 frames): `farPyramidPlace` takes
    its x from [152, 108, 64], so the newest stands nearest the site. Update the scene's test and the fixtures.
11. **The camp**: the seats overlap the tents when five or more workers wait (`docs/ui/dusk.png`). Move the tents or
    the seats (`CAMP` is a contract: move the tents, or report the change you need) so the waiting workers sit in
    front of the tents, not on them.
12. Drop the palette characters no sprite uses (ui-art's report lists i, x, u, f, F, g and E).

## Scope

- `src/ui/**` except the contracts `src/ui/protocol.ts` and `src/ui/client/model.ts`
- `docs/ui/**`
- `test/e2e/ui.test.ts`
- `src/commands/ui.ts`, `src/commands/ui.test.ts`
- `src/stream/index.test.ts`

Read anything else; change nothing else. Report a contract change you need in `open_questions`.

## Facts

- The upstream reports below say what each wave-1 lane built, decided and left open; start from them.
- From ui-server's report: the stderr advice currently prints the token-bearing URL; `src/stream/index.test.ts` was
  outside that lane's scope.
- From ui-scene's report: nothing was checked visually. Its open points are bubble overlap, ladders and planks, and
  the talk line running off the right edge with many lanes.
- From ui-art's report: `main.ts` ran only against the scene stub; `hud.ts` holds a copy of the cast table; bottom-course
  workers (feet at baseY 208, above the ground line 210) get a plank by the literal rule (judge it by eye); the page
  never ran in a browser (the orchestrator checks that after integration).
- `docs/ui/day.png`, `dusk.png`, `capstone.png` and `night.png` are the renderer's goldens from hand-built Worlds.
- Claude Code's Read tool displays PNG files.

## Acceptance

- [ ] `pipeline.test.ts` writes and checks the seven live goldens, and you looked at each, the wave-1 ones included.
      In `decisions`, say what you fixed after looking.
- [ ] The talk line holds at most 6, with a test.
- [ ] `castOf` exists once; far pyramids stand on the left horizon; the camp's workers sit clear of the tents.
- [ ] The fixtures use `pyramidLayout`.
- [ ] The e2e test proves the real script is served.
- [ ] The fillRect bound holds for 300 lanes.
- [ ] The stderr advice carries no token.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `git diff` touches only the Scope's paths.

## Notes

- **Do not run `pnpm build`** (this overrides the project rule for this lane). It rewrites the tracked `plugin/`; the
  orchestrator rebuilds it after integration.
