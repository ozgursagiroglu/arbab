# UI2 · the pixel font (src/ui/client/app/font.ts)

## Task

The game-studio pass of `arbab ui` (DESIGN.md §19, "The game-studio pass") draws its display text in a pixel font of
our own: no font file, glyph grids drawn with `fillRect`, like the sprites. The scene uses it for nameplates and the
monument's plaque; the page uses it in small canvases for titles, big numbers and badges. Make it handsome: this font
is the face of the whole interface.

1. **`src/ui/client/app/font.ts`**: replace the stub and keep every export and its meaning.
   - Exports: `ASCENT` 7, `DESCENT` 2, `LINE_HEIGHT` 11, `measureText(text)`, and
     `drawText(ctx, text, x, y, color, scale = 1)`, which returns the width drawn.
   - Glyphs are grids like the sprites' (`#` for a pixel, `.` for none), 7 rows above the baseline plus 2 below. Widths
     vary: 1 for `i`, `l`, `!`, `.`, `:`, `'` and `|`; 5 for most; and 5 for every digit, so numbers line up. One font
     pixel separates letters; a space is 3 wide.
   - Cover printable ASCII 32–126, plus `✓ ✗ · • → ← ↑ ↓ … — – × °` and `$ %` (both in ASCII). A character it lacks
     draws as a hollow box as wide as `0`.
   - Style: crisp and readable at scale 1, classic 5×7 proportions, round shapes cut at the corners.
     - Capitals have flat tops and sit on the baseline.
     - Lowercase has a 5-row x-height, and `g j p q y` descend 2.
     - `0` has a slash or a dot, so it is not `O`.
   - `drawText` merges each glyph row's adjacent pixels into one `fillRect`; compile the glyphs once into runs.
   - `y` is the top of the ascent. Lines do not wrap (callers place each line).
2. **`src/ui/client/app/font.test.ts`**:
   - every character above has a glyph inside 5×9 (9 rows: 7 + 2), and only `g j p q y` and `, ; _` use the descent
     rows;
   - `measureText` of "" is 0; of "A" is A's width; of "AB" is A + 1 + B; digits all measure 5;
   - `drawText` with a counting `Canvas2D` fake: color, scale and position;
   - the box for a missing character.
3. **The font sheet**: render every glyph (in rows: A–Z, a–z, 0–9, punctuation, symbols) at scale 4 onto the raster
   (`src/ui/client/app/raster.ts`, `createRaster`). Write it as the golden `docs/ui/font.png` with the same golden rule
   as `frames.test.ts`: a missing PNG is written, an existing one is compared by pixel. Put this in `font.test.ts`.
   Look at the sheet with the Read tool and refine the glyphs until every one reads at a glance; say what you changed
   after looking.

## Scope

- `src/ui/client/app/font.ts`, `src/ui/client/app/font.test.ts`
- `docs/ui/font.png` (new)

Read anything else; change nothing else.

## Facts

- `src/ui/client/app/font.ts` is a stub on this lane's base. Two lanes after you (the scene's renderer and the page)
  call its exports.
- `Canvas2D` (`src/ui/client/app/browser.ts`) has `fillStyle`, `globalAlpha`, `fillRect` and `clearRect` only.
- `createRaster`, `encodePng` and `decodePng` are in `src/ui/client/app/raster.ts`. `frames.test.ts` shows the golden
  rule in code.
- Claude Code's Read tool displays PNG files.

## Acceptance

- [ ] Every export above, with the tests named.
- [ ] `docs/ui/font.png` exists and you looked at it.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `git diff` touches only the Scope's paths.

## Notes

- **Do not run `pnpm build`** (this overrides the project rule for this lane). It rewrites the tracked `plugin/`; the
  orchestrator rebuilds it after integration.
