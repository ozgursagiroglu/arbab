# UI · the page: pixel art, renderer, frames, page, sound and build (src/ui/client/app)

## Task

Build what the viewer sees, as DESIGN.md §19 "Page" and "Build" describe. That is the pixel art, the renderer of a
`World` (`src/ui/client/model.ts`), PNG frames of it, the page with its DOM HUD, the sound, the served assets, and the
build step that puts the browser script into the runner bundle. The scene logic belongs to a sibling lane: you draw
the World exactly as given and never move anything. The design is decided; build it as written. The art is yours to
make good.

1. **`browser.ts`**: the browser surface the page uses, as minimal interfaces. The project's tsconfig has no DOM
   lib; do not add it.
   - `Canvas2D`: `fillStyle: string`, `globalAlpha: number`, `imageSmoothingEnabled: boolean`,
     `fillRect(x, y, w, h)` and `clearRect(x, y, w, h)`.
   - What `main.ts` needs of `document`, elements, `EventSource`, `AudioContext`, `localStorage`, `matchMedia`,
     `requestAnimationFrame`, `location` and `devicePixelRatio`.
   - `main.ts` reads them from `globalThis` once and passes them down; everything else takes them as parameters.

2. **`palette.ts`, `sprites.ts`**: pixel art as palette-indexed string grids (one character per pixel, `.`
   transparent), compiled once into horizontal runs of one color.
   - **Workers** fit `ACTOR_BOX` (12×18) and arbab fits `ARBAB_BOX` (16×26). Feet are at the bottom center, and
     sprites face right (the renderer mirrors them for facing −1).
   - **Frames per pose**:

     | Pose | Frames | Notes |
     | --- | --- | --- |
     | idle | 2 | |
     | walk | 4 | |
     | climb | 2 | |
     | sit | 1 | |
     | work | 2 | per cast: hammer (laborer, mason), reed pen (scribe, skeptic), rod (surveyor); the water carrier and the scout reuse idle |
     | sleep | 1 | lying, at most 16×7, at the bottom of the box |
     | talk | 2 | arm gesture |
     | carry-scroll | 4 | |
     | carry-stone | 4 | the stone on a shoulder |
     | carry-ration | 4 | tier 1 a loaf, 2 a loaf and a jug, 3 a basket and a jug |
     | slump | 4 | head down |
     | cheer | 2 | |

   - **The cast**: skin, white kilt, dark-brown outline, and a headcloth, sash or held item by cast:
     - laborer: tan headcloth, hammer;
     - mason: blue headcloth, plumb bob;
     - scribe: purple sash, papyrus;
     - skeptic: red sash, papyrus, a raised finger when talking;
     - surveyor: green headcloth, measuring rod;
     - water carrier: yellow headcloth, a jug on the head, a little shorter;
     - scout: green cloak, staff.
   - **arbab** wears a nemes headdress striped blue and gold, a white robe and a gold collar, and holds a staff. Its
     poses are idle 2, talk 2 (hand raised) and cheer 2; any other pose draws as idle.
   - **Props**:
     - two tents and three palms for the camp;
     - the bread-and-beer table with loaves and jugs;
     - the treasury chest with `world.coins` coins stacked beside it in a deterministic pile;
     - the well and the sledge;
     - the capstone, a gold pyramidion of about 10×7 that gleams when `ready`, with a green or red pennant on a pole
       by the sledge for `flag`;
     - icons: hourglass (5×7), dots, zzz, question mark;
     - a ladder and a plank.
   - **The speech bubble**:
     - white, with a 1 px dark outline, corners cut by 1 px, and a tail toward the speaker's head;
     - 1–2 lines of 3×4 px glyphs, picked from a fixed set of at least 12 hieroglyph-like glyphs (eye, bird, reed,
       water zigzag, loop, …) by a small PRNG seeded with `bubble.seed`;
     - 3–7 glyphs; it scales with `open` while popping;
     - drawn above the head and kept inside the canvas.
   - **Palette** (warm desert; adjust a shade if a frame shows it is needed, and say so in `decisions`):

     | Group | Colors |
     | --- | --- |
     | day sky, top to horizon | `#5BA8D9` `#8CC6E3` `#F2E2B6` |
     | dusk sky | `#3B2F5C` `#B4546A` `#F29B4B` |
     | night sky | `#0B1026` `#1B2347` `#33406B` |
     | sun (core, rim) | `#FFE07A` `#FFF4C2` |
     | moon, stars | `#E8E6D8`, `#F5F3E8` |
     | far dunes | `#D9B26F` `#C99A55` |
     | sand, light to dark | `#E9C886` `#DDB66E` `#C89A56` `#B5843F` |
     | limestone (light, face, mortar, edge) | `#F1E2BC` `#DCC796` `#B9A06C` `#8F7A50` |
     | planned outline, empty outline | `#8C7A5B`, `#CDB27E` |
     | fallen gap, crack | `#6E5A3C`, `#4A3B26` |
     | orphaned stone | `#A7A39A` `#85827A` |
     | gold (gleam, light, mid, shadow) | `#FFF6C9` `#FFD54A` `#E0A800` `#A87400` |
     | skin, skin shadow | `#B9784E` `#925A38` |
     | white cloth, shadow | `#F4F0E2` `#D6CFBC` |
     | outline | `#3A2716` |
     | headcloths: laborer, mason, scribe, skeptic, surveyor, water carrier, scout | `#C9A46B` `#3C6FB0` `#6E4C9E` `#B23A3A` `#3F8F5A` `#E2B23A` `#2F6B4F` |
     | nemes blue | `#2A4FA0` |
     | wood | `#8B5A2B` `#6B4220` |
     | palm leaves, trunk | `#3E7D3A` `#2D5E2B`, `#7A5230` |
     | tent, stripe | `#E7D6B0` `#C2A97A`, `#B23A3A` |
     | water | `#4F8FBF` |
     | bread, jug | `#C98A3E`, `#8E5B3E` |
     | bubble fill, glyph | `#FFFDF5`, `#5A4630` |
     | flags green, red | `#3FAF5A`, `#D04040` |
     | coin, coin shadow | `#F2C14E` `#C9962C` |

3. **`render.ts`**: `renderWorld(ctx: Canvas2D, world: World): void`. Draw back to front:
   1. **The sky** as horizontal, dithered bands of its phase.
      - The sun is on an arc through (40, 112), (240, 26) and (440, 112), placed by `sky.sun`.
      - At night there is no sun; there is a moon at (400, 30) and fixed stars.
   2. The far dunes on `HORIZON_Y`, and the `world.far` pyramids: small stepped pyramids with gold tips.
   3. The ground: sand bands, darker toward the horizon.
   4. The props: the camp, the well, the table, the treasury and the coins.
   5. **The pyramid**'s blocks by `look`:
      - empty: a faint 1 px outline;
      - planned: a dotted outline;
      - building: staggered courses of stones, placed bottom row first and left to right up to `fill`. Stones are
        about 8×4 px when blockW ≥ 16, else 4×2.
      - set: all stones, mortar lines and a lit top edge;
      - stalled: building, desaturated;
      - fallen: a dark gap with a crack;
      - orphaned: grey stones.

      Then the rest of the pyramid:
      - `flash` as a white overlay at alpha flash·0.6;
      - a 1 px gold frame on a highlighted block;
      - the rubble at the foot, at deterministic places from its index;
      - the capstone (on the sledge, moving, or on the apex) with its pennant.
   6. **The actors** in y order.
      - The frame is floor(poseTime·fps) mod frames, with fps 8 for walk and the carry poses and 4 otherwise. In the
        work pose, `stroke` < 0.5 shows frame 1, else frame 0.
      - Mirror for facing −1; draw `alpha` with `globalAlpha`. A ghost is a pale palette at alpha 0.5.
      - A highlighted actor gets a gold marker above its head that blinks at 2 Hz.
      - A ladder goes under a `climb` actor, from the ground line (`PYRAMID_AREA.baseY + 2`) up to its feet. A plank
        goes under a `work` actor whose feet are above that line.
      - Then the icons, then the bubbles.
   7. **The particles**:
      - dust 1×1, sand;
      - stone 2×2, limestone;
      - sparkle 1×1, gleam or gold;
      - coin 2×2, gold.

   Use only `fillRect`/`clearRect`, `#rrggbb` colors and `globalAlpha`, with integer coordinates (round once at draw
   time). Restore `globalAlpha` to 1 after each use.

4. **`raster.ts`** (imported only by tests and frames, never by `main.ts`):
   - `createRaster(width, height)`: a `Canvas2D` drawing into an RGBA buffer. It clips, rounds coordinates, and
     blends source-over by `globalAlpha`; it accepts only `#rrggbb`.
   - `encodePng(width, height, rgba, scale)`: nearest-neighbour upscale, 8-bit RGBA, filter 0 on every row,
     `zlib.deflateSync`, CRC32.
   - `decodePng(bytes)` for its own output.

5. **`frames.test.ts`** with `fixtures.ts` (hand-built Worlds). Render each at 2× into `docs/ui/<name>.png`:
   - `day.png`: about 10 blocks.
     - Blocks: set ones, building ones with workers striking, and one fallen gap with rubble.
     - Workers: one carrying a stone up a ladder; one talking with arbab, both bubbles shown in turn (draw the
       worker's); two in the camp, with an hourglass and with dots.
     - Others: a scribe on the lower course, a surveyor by the sledge with a waiting capstone and a green pennant,
       a water carrier.
     - Coins: about 20. One far pyramid.
   - `dusk.png`: held. A dusk sky, workers sitting in the camp with hourglasses, one asleep (zzz) on the pyramid, a
     ghost.
   - `capstone.png`: a full 15-block pyramid, all set, with the capstone on the apex and sparkles. arbab cheering, a
     worker walking off with a basket and a jug, three far pyramids.
   - `night.png`: rejected. Night, the moon and stars, workers asleep.

   Build the fixtures' pyramids with the scene's layout rules:
   - base = max(4, least b with b(b+1)/2 ≥ n);
   - blockW = min(32, floor(228/base)), rounded down to even; blockH = min(blockW/2, floor(104/base)); then
     blockW = min(blockW, 2·blockH);
   - course k holds base − k slots, at x = 268 − (base − k)·blockW/2 + j·blockW and y = 208 − (k + 1)·blockH;
   - a worker's feet are at (slot.x + w/2, slot.y + h).

   That helper is test-only; the real layout comes from the sibling lane.

   Goldens:
   - A missing PNG is written, and the test passes.
   - An existing one is decoded and compared pixel by pixel. A mismatch fails with
     `docs/ui/<name>.png is stale: delete it and run the test again to accept the new frame`.
   - Each frame also asserts a few pixels: the night sky's top-left is dark; gold is at the apex in `capstone.png`.

   Look at every frame you produce with the Read tool (it shows PNGs), and iterate on the art until it reads well at
   1× and 2×:
   - clear silhouettes, and each cast told apart by color;
   - the pyramid's stones and gaps;
   - arbab clearly the foreman at the front;
   - the bubbles reading as speech full of glyphs.

6. **`page.ts`**: `PAGE_HTML` and `PAGE_CSS`.
   - Semantic HTML: `<header>`, `<main>`, `<aside>`, `<footer>`, `lang="en"`, `<title>arbab · pyramid</title>`, a
     viewport meta and `<meta name="robots" content="noindex">`.
   - `<link rel="stylesheet" href="/app.css">` and `<script src="/app.js" defer>`, from `UI_ROUTES`. No inline
     script or style: the CSP refuses them.
   - Elements carry the ids `main.ts` fills. The canvas has `role="img"` and an `aria-label`.
   - CSS:
     - a dark desert HUD in CSS variables, with a light variant under `prefers-color-scheme: light`;
     - `image-rendering: pixelated` on the canvas;
     - the crew list beside the canvas on wide screens and below it on narrow ones;
     - a visually-hidden class for the live region, visible focus styles, and no transitions under
       `prefers-reduced-motion`.

7. **`hud.ts`** (pure, tested) and **`main.ts`** (thin glue; its import graph must never reach a `node:` module).
   `main.ts` exports `startPage(env)`, taking everything from `browser.ts`, and calls it with the real globals.
   - **Token**: from `location.hash` (`#token=<hex>`). Without one, show a panel saying "Open the URL `arbab ui`
     printed: it carries this session's token" and stop.
   - **Events**: `new EventSource(UI_ROUTES.events + "?" + UI_TOKEN_PARAM + "=" + encodeURIComponent(token))`.
     - `snapshot` events go through `JSON.parse` and a protocol check (another `protocol` shows a banner), then
       into `scene.apply` and the DOM.
     - `problem` events show a banner.
     - `error` shows "reconnecting" (EventSource retries by itself).
   - **Loop**: `requestAnimationFrame`, then `scene.step(dt)`, then `renderWorld`. Then play `world.events` and set
     their length to 0.
   - **Scale**: the largest integer s with 480·s ≤ the stage's width and 270·s ≤ the window height minus the header,
     at least 1. Set on resize.
   - **Hover**: the pointer becomes logical coordinates, then `scene.pick` and `scene.highlight`. The tooltip is
     placed near the pointer. Its lines:
     - lane; role · kind; state (end state); attempt;
     - elapsed, live from `since` and the offset between the server's `now` and the client's clock (use
       `formatElapsed` from `src/registry/status.ts`; import that file, not the registry index, which pulls
       `node:fs`);
     - tool calls; last tool; cost; model · effort; hold or reason.
   - **Header**:
     - project · version;
     - counts: running, preparing, waiting (held and queued), asleep (waiting-reset), orphaned, and finished as ✓
       and ✗;
     - total cost and quota `5h 62% · 7d 40%`, with a "held" badge while `hold.hold`;
     - a connection dot;
     - the sound toggle (`aria-pressed`).
   - **Crew list**: `<li><button>` per lane not finished, with a cast-colored chip, the name and the state. Focus or
     hover highlights the lane; Enter pins its tooltip.
   - **Table** in a `<details>`: every lane in the snapshot (lane, role, state, end state, attempt, calls, cost).
   - **Live region** (`aria-live="polite"`): `<lane> started`, `<lane> finished: <end state>`,
     `<integration> landed`.
   - `prefers-reduced-motion` sets `SceneOptions.reducedMotion`.
   - Text goes in through `textContent` only. Never use `innerHTML`, `outerHTML`, `insertAdjacentHTML`,
     `document.write`, `eval`, `new Function`, or a string passed to `setTimeout`.

8. **`sound.ts`**: procedural WebAudio.
   - The sounds:
     - drum: a short low sine with a pitch drop, plus a noise burst;
     - horn: two detuned oscillators through a lowpass, about 0.4 s;
     - fanfare: the horn, then a fifth up;
     - thud: a low drum.
   - Events map to sounds: `brief` → horn, `stone` → drum (at most 3 a second), `report` → horn, `set` → fanfare,
     `fall` → thud, `capstone` → fanfare and a drum roll.
   - Off by default; no AudioContext before the first toggle on (autoplay policy). The choice is remembered in
     `localStorage["arbab-ui-sound"]`, read and written inside try/catch.

9. **`assets.ts`** and **`bundle.ts`**:
   - `bundle.ts` is `export const UI_SCRIPT: string | null = null;`.
   - `uiAssets()` keeps the stub's signature and returns `{ html: PAGE_HTML, css: PAGE_CSS, js: UI_SCRIPT ??
     PLACEHOLDER_SCRIPT }`.
   - The placeholder script puts "The page script is built by pnpm build." into the page with `textContent`.

10. **`scripts/build.mjs`**: `bundleOptions` gets an esbuild plugin that loads `src/ui/client/app/bundle.ts`.
    - Match it by an `onLoad` filter of `/src[\\/]ui[\\/]client[\\/]app[\\/]bundle\.ts$/`.
    - The plugin builds `src/ui/client/app/main.ts` with bundle, platform `browser`, format `iife`, target `es2020`,
      minify, `write: false` and `legalComments: "none"`, and returns `export const UI_SCRIPT = <JSON string>;`.
    - Keep `bundleOptions`' signature and its existing fields; update `scripts/build.d.mts`.
    - In `test/build.test.ts`:
      - building a tiny entry that imports `bundle.ts` with `bundleOptions`' plugins yields a non-null `UI_SCRIPT`
        containing a marker from `main.ts`;
      - building `main.ts` for the browser alone succeeds;
      - the script contains none of the forbidden calls above.

## Scope

`src/ui/client/app/**`, `scripts/build.mjs`, `scripts/build.d.mts`, `test/build.test.ts`, `docs/ui/**` (new). Read
anything else; change nothing else. `src/ui/client/model.ts` and `src/ui/protocol.ts` are contracts: report a change
you need in `open_questions`.

## Facts

- `src/ui/client/model.ts` (on this lane's base) holds the World you draw, with `WIDTH`, `HEIGHT`, `HORIZON_Y`,
  `PLACES`, `CAMP`, `PYRAMID_AREA`, `ACTOR_BOX` and `ARBAB_BOX`. Its comments are part of the spec.
- `src/ui/protocol.ts` holds the snapshot types, `UI_ROUTES`, `UI_TOKEN_PARAM`, `UI_EVENTS` and `UiAssets`.
- `src/ui/client/scene/index.ts` is a stub on this lane's base: `createScene` returns a world holding only arbab.
  Lane ui-scene replaces it with the same signature. `main.ts` uses it; the frames use your fixtures, not the scene.
- The server sends `assets.html`, `assets.js` and `assets.css` at `UI_ROUTES`. Its CSP (DESIGN.md §19) allows only
  same-origin scripts, styles and connections, with no inline code and no `data:` images.
- tsconfig: lib ES2023, types node, no DOM. vitest runs in node over `src/**/*.test.ts` and `test/**/*.test.ts`.
- `scripts/build.mjs` today: `bundleOptions({ version, outfile })` returns esbuild options. `test/build.test.ts` and
  `test/e2e/harness.ts` call it. esbuild is `^0.28.2` (package.json), whose plugins can return `contents` and a
  `loader` from `onLoad`.
- Claude Code's Read tool displays PNG files.
- `formatElapsed` (`src/registry/status.ts`) imports only types.

## Unverified

- Whether `zlib.deflateSync` gives the same bytes on every machine. Do not rely on it: compare decoded pixels.
- Whether esbuild resolves the nested browser build's paths from `absWorkingDir`. Pass absolute paths derived from
  the build's working directory, and test the plugin from a temporary output directory as `test/build.test.ts` does.

## Acceptance

- [ ] Every file above exists, with tests:
      - sprites: every frame inside its box, every character in the palette, every pose of every cast present;
      - render, through the raster: draw order, mirroring, alpha restored, nothing outside the canvas;
      - the raster and a PNG round trip;
      - the four frames' goldens;
      - hud: scale, counts, tooltip lines, announcements;
      - sound, with a fake AudioContext: off by default, the stone throttle;
      - `startPage` with fakes: no token, the EventSource URL, a snapshot updating the header;
      - assets; the build plugin.
- [ ] `docs/ui/day.png`, `dusk.png`, `capstone.png` and `night.png` exist, and you looked at each (say what you
      changed after looking, in `decisions`).
- [ ] A test fails if a non-test file under `src/ui/client/app/` contains `innerHTML`, `outerHTML`,
      `insertAdjacentHTML`, `document.write`, `eval(` or `new Function`.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `git diff` touches only the Scope's paths.

## Notes

- **Do not run `pnpm build`** (this overrides the project rule for this lane). It rewrites the tracked `plugin/`,
  and three lanes' bundles would conflict at integration. `test/build.test.ts` builds the bundle into a temporary
  directory; the orchestrator rebuilds `plugin/` after integration.
- Art direction:
  - SNES-era pixel art, warm and readable, lit from the upper left;
  - 2–3 shades per material, characters outlined in dark brown (not black);
  - small and charming rather than detailed.
- The renderer runs every frame in the browser. Precompute sprite runs and static backgrounds' rect lists once, and
  keep per-frame work proportional to what is on screen.
