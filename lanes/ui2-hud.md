# UI2 · the page as a game interface (src/ui/client/app page, HUD and glue)

## Task

The owner looked at the first version of `arbab ui` and said: too empty and too plain; it should look as if it came
out of a game studio. They chose a **dashboard around the scene**. DESIGN.md §19, "The game-studio pass", is the
spec; this brief decides the details. You cannot see the page (no browser in the fence), so build exactly to this
spec. The orchestrator renders it in a real browser after integration and sends a polish round with what it sees.

### Look

A dark night-desert game interface (dark only: drop the light variant and set `color-scheme: dark`). Pixel frames,
gold accents, and the pixel font for display text.

- **Tokens** (CSS variables on `:root`):
  - backgrounds: `--bg #120d0a`, `--bg-2 #1b140f`, `--panel #241a12`, `--panel-2 #2e2116`, `--panel-hi #3a2a1b`;
  - frame: `--frame-dark #0b0705`, `--frame #6b4a26`, `--frame-hi #a87a3f`, `--frame-lo #3a2716`;
  - text: `--text #f4ead2`, `--muted #b89f74`, `--faint #7d6a4d`;
  - accents: `--gold #ffd54a`, `--gold-2 #e0a800`, `--sand #e9c886`, `--sky #5ba8d9`;
  - states: `--st-running #5ba8d9`, `--st-preparing #8cc6e3`, `--st-waiting #e0a800`, `--st-asleep #8e7cc3`,
    `--st-success #3faf5a`, `--st-failed #d04040`, `--st-orphaned #85827a`;
  - cast chips: keep `--chip-*`;
  - spacing: a 4 px scale.

  Body text is the system UI font at 14 px (13 px in dense tables), with tabular numbers.
- **Pixel frames**, pure CSS: corners stay square and notched, never rounded. A class `.frame` draws:
  - the outer 4 px dark edge on each side with `box-shadow` (no spread, so the corners notch);
  - an inner 2 px bevel: `--frame-hi` top and left, `--frame-lo` bottom and right, with inset shadows;
  - a margin of 4 px so the outer edge has room.

  Buttons use a 2 px version, with a pressed look (the bevel inverted) on `:active` and `[aria-pressed=true]`. No
  images: the CSP allows none.
- **The pixel font in the page**: a helper (`src/ui/client/app/hud/pixel-text.ts`) renders text with
  `drawText`/`measureText` (`src/ui/client/app/font.ts`) into a `<canvas>`:
  - the width is measureText × scale × dpr and the height LINE_HEIGHT × scale × dpr, where dpr is
    `max(1, round(devicePixelRatio))`, with matching CSS px and `image-rendering: pixelated`;
  - the canvas is `aria-hidden="true"`, and a visually-hidden `<span>` beside it carries the same text;
  - it updates only when the text changes.

  Use it for the wordmark, panel titles (capitals, scale 2), KPI numbers (scale 4), KPI labels (scale 1), badges
  (scale 1) and the stepper's labels.

### Layout

CSS grid: two columns at ≥ 1280 px (the scene card `1fr`, the side `380px`), the side under the scene from 900 px, one
column below 900 px.

1. **Top bar** (sticky, 56 px, `--bg-2`, a 2 px `--frame` line under it):
   - left: the logo (the pixel-pyramid icon drawn on a canvas at 2×), the wordmark "ARBAB" (pixel font, scale 3,
     gold), then the project name and the version (muted);
   - right: two quota gauges, the LIVE pill and the sound and full-screen buttons.
   - **Quota gauges** "5H" and "7D": a stepped bar 96×10 px with a 1 px tick at `holdAbove`, the percentage in the
     pixel font, and the color by level (sand under 70%, amber from 70%, red at or above the hold). The `title` gives
     the reset ("resets in 2h 05m").
   - **The LIVE pill** pulses gently while live; it says "RECONNECTING" in amber and "OFFLINE" in red.
2. **KPI row** (`auto-fit, minmax(170px, 1fr)`), five framed cards:
   - AT WORK (running + preparing), WAITING (queued + held), ASLEEP (waiting-reset), FINISHED (✓ n · ✗ m), TREASURY
     ($ in view);
   - each card holds a 16 px pixel icon (a hammer, an hourglass, zzz, a check, a coin: tiny grids drawn on a canvas),
     the number in the pixel font at scale 4, which counts up over 0.6 s when it changes (immediately with reduced
     motion), and the label;
   - a zero is shown muted.
3. **The scene card**, "THE SITE":
   - a framed panel with a title bar (the title in the pixel font, and a full-screen button on the right);
   - the canvas centered at its integer device-pixel scale (keep `computeScale`'s rule) on a dark textured fill made
     of CSS gradients;
   - a caption bar under it, in the pixel font scale 1: the integration and its counts. While working: "UI2 · 3/10
     BLOCKS SET · CAPSTONE WAITING · VERIFY ✓". While a monument stands: "MONUMENT · UI · 8 BLOCKS · LANDED 11H AGO".
     With nothing: "THE SITE IS QUIET";
   - **a title card** over the canvas until the first snapshot: the logo, "ARBAB" in the pixel font at scale 6 and
     "the site awakens…" under it. It fades out over 0.6 s when the first snapshot arrives (no fade with reduced
     motion);
   - **full screen**: the button calls `requestFullscreen` on the scene card where it exists. In full screen the
     canvas takes the largest integer scale that fits the screen, on `--bg`; Escape leaves it.
4. **The side panel**, two framed panels:
   - **CREW** ("CREW · n AT WORK"):
     - one card per lane not finished, ordered running, preparing, waiting-reset, held, queued, orphaned, then by
       name;
     - each card holds the **avatar**: the lane's sprite (`createSpriteSet().frames(castOf(lane), pose, 0, ghost)[0]`,
       with pose `work` while running, `sit` while held or queued, `sleep` while waiting-reset, `idle` otherwise, and
       ghost when orphaned), drawn from its runs at 3× into a 36×54 canvas on a tile tinted with the cast's chip
       color;
     - the name (semibold) and "role · kind" (muted);
     - a state badge: a pixel-font label on the state's color;
     - the elapsed time (live);
     - a stepped progress bar of the block's fill (`fillFor(toolCalls)` from the scene; full for a set block), with
       "93 calls";
     - a stats line: last tool · cost;
     - then a folded group "RECENTLY FINISHED" with the last 6 finished lanes (avatar, name, ✓/✗ badge, cost,
       elapsed);
     - the empty state: the sleeping sprite and "The site is quiet." with "No lane is at work. Launch one with arbab
       launch, or arbab plan next: workers walk in from the village.";
     - hover or focus on a card highlights its lane in the scene; a click or Enter pins it (as the crew list does
       now).
   - **MONUMENT**: the newest integration not landed, else the newest landed one:
     - its name and a short head (7 characters);
     - a vertical stepper of pixel nodes joined by a line: INTEGRATED ✓, VERIFY (✓ passed, ✗ failed, · not run),
       REVIEW ("2 lenses · 1 confirmed · 2 unverified", or ·), READY (✓, ✗, ·), LANDED (✓ with "11h ago", or ·);
     - a done step is gold, a failed one red, a pending one faint;
     - empty: "No integration yet.".
5. **Below the two columns**, two framed panels side by side (stacked under 900 px):
   - **CHRONICLE**: a feed of events, newest first, at most 60.
     - On the first snapshot it is seeded from the snapshot: a finished lane gives "finished" or "failed" at its
       `since`, an integration gives "landed" at `landedAt`, and an active lane gives "started" or "waiting" at its
       `since`.
     - Each later snapshot adds its changes: started, finished with its end state and cost, landed, verify passed or
       failed, held for the quota.
     - Each line holds a colored pixel glyph (→ ✓ ✗ ◆ ⏳ as the font has them), the text, and a relative time ("2m
       ago", refreshed every 30 s).
     - A new line slides in, except with reduced motion.
     - Pure logic in `src/ui/client/app/hud/chronicle.ts`, with tests.
   - **LEDGER**: every lane in the snapshot, in a table:
     - columns: lane, role, state (badge), attempt, calls, last tool, elapsed, cost;
     - a sticky header, zebra rows, and right-aligned tabular numbers;
     - sortable by clicking a header (`aria-sort`; the default is state, then name);
     - hovering a row highlights its lane in the scene, and a click pins it;
     - it keeps the accessible table it has now.
6. **The tooltip** becomes a small framed panel with the lane name in the pixel font as its title, then the same
   lines.
7. **Footer**: "Read-only · arbab <version> · <n> older lanes not shown", muted.

### Behaviour kept or fixed

- Everything the page does now keeps working: the token from the hash, the EventSource, the sound toggle, the live
  region, `textContent` only, and the scale rule.
- **The crew's focus** (the review's LOW, `main.ts`): a crew change must not move an element that is already in place.
  Insert or move only the items out of order (`insertBefore` the right sibling), so a focused card keeps its focus.
  Test it with the fakes.
- **A closed stream** (the review's LOW): when the EventSource is CLOSED, fetch `UI_ROUTES.snapshot` with the token to
  tell the causes apart:
  - 200: "This page is one too many: arbab ui serves 16 at once. Close another of its tabs and reload.";
  - 401: the current "ended or restarted" message;
  - a failed fetch: "arbab ui is not running.".

  Add `fetch` to the browser surface, and test all three.
- **The icon**:
  - draw `ICON_SVG` (`assets.ts`) as a 16×16 pixel pyramid made of `<rect>`s (sandstone faces, a gold capstone,
    `shape-rendering="crispEdges"`);
  - link it with `<link rel="icon" href="/icon.svg" type="image/svg+xml">`;
  - serve it in `src/ui/server/http.ts` at `UI_ROUTES.icon` as `image/svg+xml; charset=utf-8`, with the usual
    headers and no token (it is public, like the page);
  - test the route.
- **Accessibility** stays at the current level or better:
  - landmarks, and headings for each panel (h2, even when the visible title is a canvas);
  - a focus outline in gold;
  - body text contrast at least 4.5:1 on its panel;
  - the reduced-motion rules.

## Scope

- `src/ui/client/app/page.ts`, `page.test.ts`, `hud.ts`, `hud.test.ts`, `main.ts`, `main.test.ts`, `browser.ts`,
  `assets.ts`, `assets.test.ts`
- `src/ui/client/app/hud/**` (new components and their tests)
- `src/ui/server/http.ts`, `src/ui/server/http.test.ts` (the icon route only)
- `test/build.test.ts` (only if a marker string it checks changes)

Read anything else; change nothing else. `src/ui/client/app/render.ts`, `sprites.ts` and `palette.ts` belong to the
sibling lane `ui2-art`: use their exports, never edit them.

## Facts

- The pixel font is upstream (`src/ui/client/app/font.ts`: `ASCENT` 7, `DESCENT` 2, `LINE_HEIGHT` 11,
  `measureText`, `drawText`). Its report is inlined below.
- `createSpriteSet().frames(cast, pose, ration, ghost)` returns `Sprite[]`. A `Sprite` has `w`, `h`, `top`, and
  `runs` of `{x, y, w, color}` (`src/ui/client/app/sprites.ts`). The sibling lane keeps these as they are.
- `castOf` and `fillFor` are exported by `src/ui/client/scene/scene.ts`. `formatElapsed` (`src/registry/status.ts`)
  and `isLive` are page-safe imports.
- `UI_ROUTES.icon` and `UiAssets.icon` are on this lane's base (`src/ui/protocol.ts`). The CSP stays:
  `img-src 'self'` allows `/icon.svg`.
- The page today (`page.ts`, `main.ts`, `hud.ts`): a text header, the canvas, a crew list of buttons and a table in a
  `<details>`.
- An orchestrator screenshot (1440×900, a busy session) showed: the canvas at 960×540 on the left; a 240 px crew column
  holding a column of plain buttons; the rest of the right column empty; a one-line text header; and nothing below the
  canvas but a folded "All lanes" and the footer.

## Acceptance

- [ ] The layout and every component above exist. Tests cover:
      - the pixel-text helper (sizes, dpr, the hidden text);
      - KPI counting and its reduced-motion jump;
      - gauge levels and the tick;
      - crew ordering and the focus fix;
      - avatar pose choice;
      - the monument stepper's states;
      - the chronicle's seeding and diffs;
      - ledger sorting;
      - the closed-stream messages;
      - the icon route.
- [ ] No non-test file under `src/ui/client/app/` uses `innerHTML` and the like (the existing test still passes).
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` exits 0, except `src/ui/client/pipeline.test.ts` if its live goldens go stale. Those belong to
      `ui2-wire`: do not touch `docs/ui/live-*.png`.
- [ ] `git diff` touches only the Scope's paths.

## Notes

- **Do not run `pnpm build`** (this overrides the project rule for this lane). It rewrites the tracked `plugin/`; the
  orchestrator rebuilds it after integration.
- Keep `PAGE_IDS` the single list of ids that `main.ts` uses. Keep `main.ts` glue: components live in `hud/` and take
  the document and their data as parameters.
- The orchestrator's preview: `PAGE_HTML`'s body nodes go into a page whose head it builds itself, with `PAGE_CSS` in
  a `<style>`. So keep every style in `PAGE_CSS`, and every element the page needs in `PAGE_HTML`'s body.
