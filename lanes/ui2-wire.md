# UI2 · wire the game-studio pass together (wave 2)

## Task

Wave 1 of the game-studio pass (DESIGN.md §19, "The game-studio pass") built four parts apart: the pixel font, the
scene (the monument, time, shake, glow), the renderer (scenery, life, light, juice) and the page (a game-interface
dashboard). Their reports are inlined below. Make them one working thing, and check it by eye.

1. **Live goldens**: `src/ui/client/pipeline.test.ts` drives the real scene and renderer. Delete the stale
   `docs/ui/live-*.png` files, run it, and look at every frame with the Read tool. Add these moments:
   - `idle`: nothing at work, the monument with its plaque, and the life around it (time chosen so that the felucca
     and the caravan are on screen);
   - `night-work`: workers at the site under the torches' light;
   - `fall-shake`: a block falling while the camera shakes;
   - `capstone-glow`: the beam on a capstone just set.

   Fix whatever does not fit between the scene and the renderer, on either side. Look for:
   - shadows under feet;
   - nameplates over bubbles;
   - the plaque under a monument of 1, 8 and 30 blocks;
   - the dust underfoot;
   - the shake offset;
   - the beam on the apex.
2. **The cost bound**: raise the pipeline test's bound to 60,000 `fillRect` calls for the 300-lane world, and make
   it hold.
3. **The page with the real scene**: `main.ts` with the real scene and renderer.
   - The crew avatars, from the new sprites, look right: draw a strip of every cast's avatar in every avatar pose into
     a golden `docs/ui/avatars.png`, and look at it.
   - The caption agrees with the World: monument or work, blocks set, capstone state.
4. **The e2e test** (`test/e2e/ui.test.ts`): the bundle serves `/icon.svg` as `image/svg+xml`.
5. **Page polish**, from the orchestrator's screenshots of `ui2-hud`'s page in a real browser (headless Brave at
   1440×900, 1920×1080, 1024 and 420 px wide, fixture snapshots):
   1. **Balance**: the side column is as tall as the scene card (grid `align-items: stretch`). CREW grows to fill it
      and scrolls inside, with a fade at its bottom edge when it overflows; MONUMENT keeps its natural height at the
      bottom of the column. Today the left column ends 400 px above the right one, with dead space under the scene.
      CHRONICLE and LEDGER stay side by side underneath.
   2. **The scene's scale**: whole *device* pixels per art pixel:
      `scale = floor(min(stageW / 480, stageH / 270) × dpr) / dpr`. Here `stageW` is the stage's content width and
      `stageH` the viewport height minus the top bar, the KPI row and the card's chrome, so the whole card fits the
      first screen.
      - On a dpr-2 screen this allows half steps (2.5× CSS is 5× device).
      - Make the 1920×1080 (dpr 1) layout reach 3×: today the stage is about 20 px short of 1,440, so the canvas
        stays at 960×540 between wide dark bars. Trim the side column to 360 px and the paddings.
      - Below 1×, on narrow screens, the canvas takes the stage's width (`width: 100%`, the height by aspect ratio),
        still pixelated.
   3. **One full-screen button**: remove the top bar's and keep the scene card's.
   4. **The ASLEEP avatar is blank**: the sleep pose (16×7) draws nothing visible on its tile. Fix it: anchor it to
      the bottom and scale it 2×. Add a test that every cast's avatar in every avatar pose has pixels other than the
      tile's.
   5. **The empty crew state**: the plain brown tile becomes arbab's idle sprite at 3× on the tile.
   6. **Narrow screens** (420 px): no horizontal overflow anywhere.
      - Today the sound button, the scene card's button and the crew badges are cut off.
      - The top bar wraps into rows (logo; gauges; buttons).
      - KPI cards sit two per row.
      - A crew card's badge and numbers wrap under the name.
      - The ledger scrolls inside its panel.
      - Give `min-width: 0` to the grid and flex children that need it.
   7. **The failed badge**: light ink (`--text`) on `#b23a3a`, for 4.5:1 or better.
   8. The headless screenshots show the title card still up after the first snapshot unless motion is reduced. That
      is the headless renderer not advancing the CSS transition in virtual time, not a bug in the page. Make sure the
      card is also `hidden` after its 0.6 s (a timer), so no renderer can leave it up.
6. Anything the wave-1 reports left open that falls inside this scope.

## Scope

- `src/ui/**` except the contracts `src/ui/protocol.ts` and `src/ui/client/model.ts`
- `docs/ui/**`
- `test/e2e/ui.test.ts`

Read anything else; change nothing else. Report a contract change you need in `open_questions`.

## Facts

- The upstream reports below say what each wave-1 lane built, decided and left open; start from them.
- Claude Code's Read tool displays PNG files.
- The orchestrator renders the page in a real browser after this lane and sends a polish round for what it sees
  there. This lane's eye is on the canvas frames and the avatars.

## Acceptance

- [ ] The live goldens, the new moments among them, are regenerated, and you looked at each. In `decisions`, say what
      you fixed after looking.
- [ ] The 60,000 bound holds.
- [ ] `docs/ui/avatars.png` exists, and you looked at it.
- [ ] The page polish items 5.1–5.8 are done, with tests where logic changed (the scale rule, avatar pixels, the
      title card's timer). Say which ones need the orchestrator's eye in a browser.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `git diff` touches only the Scope's paths.

## Notes

- **Do not run `pnpm build`** (this overrides the project rule for this lane). It rewrites the tracked `plugin/`; the
  orchestrator rebuilds it after integration.
