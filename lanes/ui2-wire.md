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
5. Anything the wave-1 reports left open that falls inside this scope.

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
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `git diff` touches only the Scope's paths.

## Notes

- **Do not run `pnpm build`** (this overrides the project rule for this lane). It rewrites the tracked `plugin/`; the
  orchestrator rebuilds it after integration.
