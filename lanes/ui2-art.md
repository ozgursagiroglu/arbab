# UI2 · the scene, game-studio quality (src/ui/client/app renderer and art)

## Task

The owner looked at the first version of `arbab ui` and said: too empty and too plain; it should look as if it came
out of a game studio. Make the scene that good. DESIGN.md §19, "The game-studio pass", is the spec; this brief decides
the details. The art, its pixels and its colors within the palette's spirit are yours. This is the lane that makes
or breaks the result: take the time, look at every frame, and iterate.

The renderer keeps its rules:
- it draws the World and never changes it;
- `fillRect`, `clearRect`, `#rrggbb` colors and `globalAlpha` only;
- integer pixels;
- a frame is a pure function of the World.

Everything that moves without carrying data moves by `world.time` (seconds) and fixed seeds, so the goldens stay
deterministic.

### Bands (logical px of the 480×270 canvas; `PLACES`, `HORIZON_Y` and `PYRAMID_AREA` stay as they are)

- **0–104, the sky**:
  - a smooth vertical gradient per phase, with ordered (Bayer) dithering between bands;
  - the sun, with a two- or three-ring dithered halo. Its color follows its height: low, a warm orange-gold; high, a
    pale yellow-white;
  - at night the moon with a faint halo, stars that twinkle (a seeded subset dims and brightens by `time`), and a
    shooting star every 40 s that streaks for 0.6 s.
- **Clouds**: two or three parallax layers of pixel clouds, 24–56 px wide, drifting at 2, 4 and 6 px/s and wrapping
  around. White and cream by day, rose and orange at dusk, faint blue-grey at night.
- **Birds**: a flock of 3–5 birds (3×2 px, two-frame flap at 6 fps) crosses at y 40–80 every 45 s, at 30 px/s. None
  at night.
- **96–128, the far land**:
  - cliffs of the Nile valley as low layered silhouettes, the farthest palest and bluish;
  - the far dunes in front of them;
  - on the far bank, at `HORIZON_Y`, the far pyramids (`world.far`), a temple pylon and two obelisks as silhouettes,
    away from the far pyramids' x (152, 108, 64): put the temple and obelisks on the right, about x 400–470.
- **128–136, the Nile**: a band of water with glints that drift, reeds along the near bank, and palm groves at both
  ends. A felucca crosses every 120 s: left to right over 80 s, a white sail on a wooden hull, gently bobbing.
- **A camel caravan** (3 camels and a walker, two-frame walk) crosses the far dunes, right to left, every 180 s over
  70 s.
- **136–270, the plain**:
  - sand bands with dithered seams, ripples, scattered stones;
  - worn paths as lighter, dithered trails from the camp toward `PLACES.audience` and from there toward the site's
    foot;
  - a heat shimmer near the horizon by day: a faint dither row that shifts with `time`.
- **Props**, each with a shadow:
  - the camp's tents and a camp fire beside them (three-frame flames at 8 fps, and smoke puffs that rise and fade,
    looping by `time`), plus a resting camel by the camp (it blinks and chews now and then);
  - a stone quarry, stacked limestone blocks with a sledge, at about x 100–140, y 190–206;
  - palms that sway (two frames, about a 2.4 s period, each palm on its own phase);
  - the well;
  - **arbab's dais**: a wooden platform under arbab, a striped canopy on two poles above it (below y 232, so it never
    hides arbab's head), and a banner on each pole waving in three frames;
  - the bread-and-beer table with scrolls on it, and the treasury;
  - two braziers by the dais and two torches at the site's foot, their flames flickering.

### Light and juice

- **Shadows**: a dithered dark ellipse (alpha about 0.25) under every actor and prop. It is offset 1–3 px away from the
  sun's x (by day and dusk), and fainter at night.
- **Grading**: dusk tints warm (you already map the land per phase); night darkens. At night each brazier, torch and
  the camp fire lights a pool around it, a lighter dithered disc of radius 18–26 px that flickers with `time`.
- **The vignette**: a dithered darkening of the outer 12 px; stronger at night.
- **The camera shake**: the whole scene is offset by
  (round(shake·sin(53·time)), round(shake·cos(47·time))) while `world.shake` > 0. The vignette stays put.
- **The capstone's glow**: while `capstone.glow` > 0, a beam of gold light falls from the top of the canvas onto the
  apex (about 10 px wide, dithered, alpha glow·0.5), with a few rays.
- **A block's shine**: while a `set` block's `flash` > 0, a diagonal band of light crosses it, positioned by the flash
  value, on top of the white overlay.
- **The nameplate**: above a highlighted actor, its lane name in the pixel font (scale 1), white-gold on a dark plate
  with a 1 px gold rim. It sits above icons and bubbles and is kept inside the canvas.
- **The monument's plaque**: while `pyramid.monument` is set, a small carved stone plaque on the ground at the
  pyramid's foot, centered, with the integration's name in capitals in the pixel font.

### Frames

Update the fixtures and goldens, and look at every one with the Read tool:
- `docs/ui/day.png`, `dusk.png`, `capstone.png` and `night.png`, each with the new scenery and life.
- `night.png` shows the light pools, the twinkling stars, and a shooting star mid-streak.
- A new `docs/ui/idle.png`: the monument standing with its plaque, nobody at work, a felucca mid-river, the caravan
  mid-crossing, the camp fire burning, birds in the sky.
- Also look at an enlarged crop of every new sprite. In `decisions`, say what you changed after looking.

### Cost

A 300-lane world must stay under 60,000 `fillRect` calls per frame; put that bound in `render.test.ts`. Precompute
static layers as run lists, and keep per-frame work proportional to what moves. `src/ui/client/pipeline.test.ts`
holds a 40,000 bound that belongs to the wave-2 lane, which raises it.

## Scope

- `src/ui/client/app/render.ts`, `sprites.ts`, `palette.ts`, `raster.ts`, `fixtures.ts`, `frames.test.ts`,
  `render.test.ts`, `sprites.test.ts`, `palette.test.ts`, `raster.test.ts`
- `src/ui/client/app/art/**` (new modules, if you split the renderer)
- `docs/ui/day.png`, `docs/ui/dusk.png`, `docs/ui/capstone.png`, `docs/ui/night.png`, `docs/ui/idle.png`

Read anything else; change nothing else. `src/ui/client/model.ts`, `src/ui/protocol.ts` and
`src/ui/client/app/font.ts` (the font lane's, upstream of you) are not yours.

## Facts

- `src/ui/client/model.ts` (on this lane's base) has `World.time`, `World.shake`, `Capstone.glow` and
  `Pyramid.monument`, with their comments. The fixtures already set them to 0, 0, 0 and null.
- The pixel font is upstream: `measureText` and `drawText(ctx, text, x, y, color, scale)` in
  `src/ui/client/app/font.ts`, with `ASCENT` 7 and `DESCENT` 2. Its report is inlined below.
- The page (a sibling lane, `ui2-hud`) draws lane avatars with `createSpriteSet().frames(cast, pose, ration, ghost)`.
  Keep `createSpriteSet`, `SpriteSet.frames`, `Sprite` and `Run` as they are (you may add, never change).
- The first version's frames are in `docs/ui/*.png`. The owner's screenshot of the empty page: the foreground was an
  empty outline, arbab stood alone, the sky was half the canvas and flat, and nothing moved.
- Claude Code's Read tool displays PNG files.

## Acceptance

- [ ] Every element above is drawn, with tests in `render.test.ts` (and new test files beside new modules):
      - the ambient elements move with `time` and repeat on their cycles;
      - the shake offset; the glow beam only while glow > 0;
      - the nameplate only on a highlighted actor, and inside the canvas;
      - the plaque only with a monument;
      - shadows under actors;
      - a frame is deterministic for a given World;
      - the 60,000 bound.
- [ ] The five goldens are regenerated and you looked at each, and at enlarged crops of the new sprites.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` exits 0, except `src/ui/client/pipeline.test.ts`, whose live goldens (`docs/ui/live-*.png`) and
      40,000 bound belong to `ui2-wire`: do **not** delete or regenerate those goldens. Report its failure message as
      it is.
- [ ] `git diff` touches only the Scope's paths.

## Notes

- **Do not run `pnpm build`** (this overrides the project rule for this lane). It rewrites the tracked `plugin/`; the
  orchestrator rebuilds it after integration.
- Art direction:
  - modern indie pixel art: a coherent, limited palette per material, 2–4 shades, light from the sun's side;
  - readable silhouettes, and no pure black;
  - atmosphere through layering and dithering, not noise;
  - detail where the eye goes (arbab, the pyramid, the workers), calm elsewhere.

  Compare yourself to the best desert scenes you know of in pixel-art games, and do not stop at "fine".
