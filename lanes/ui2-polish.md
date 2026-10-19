# UI2 · polish after the browser check (integration ui2)

## Task

The orchestrator rendered integration `ui2` in a real browser: headless Brave at 1440×900, 1920×1080, 500 px wide
and at dpr 2, with fixture snapshots. Everything reads well except the three items below. Fix them on the
integration as it stands.

1. **The CREW panel collapses in the two-column layout** (≥ 1280 px). The browser's measurements at 1440×900, read
   from `getBoundingClientRect` and `getComputedStyle`:
   - `aside`: 360 × 638, `display: grid`, `contain: size`, 2 children;
   - `#crew-scroll`: 328 × **0**, `display: block`, `flex: 1 1 0px`, `overflow-y: auto`, 3 children;
   - `#crew` (inside it): 328 × 935, 8 children (the cards are there);
   - `#monument`: 328 × 190, at the bottom of the column.

   So the scroll box gets no height: its `flex: 1 1 0` has no flex container sizing it, and the grid rows of the
   `aside` size the crew panel to its title. Make the crew panel take the column's remaining height, and its list
   scroll inside, while the side column still never makes the row taller than the scene card:
   - `aside` as a column with the crew panel taking the remaining space and the monument at its own height (for
     example `grid-template-rows: minmax(0, 1fr) auto`);
   - the crew panel a flex column with `min-height: 0`;
   - `#crew-scroll` as `flex: 1 1 0; min-height: 0; overflow-y: auto`.

   Keep the bottom fade (`data-more`), the stacked layout under 1280 px, and the empty state (arbab's tile and the
   text, which the browser also showed collapsed). Add a test that `PAGE_CSS` carries these rules. The orchestrator
   checks the result in the browser after you.
2. **A landed pyramid is complete.** When a capstone is set, every slot without a lane is drawn as a set block
   (`lane: null`, fill 1), so the capstone stands on a finished pyramid instead of floating over dotted slots. That
   applies to a live landing (`live-capstone`, `live-capstone-glow`) and to a monument, as the monument already
   does. Change it in the scene (`src/ui/client/scene/scene.ts`), with a test.
3. **The verify pennant belongs to the waiting capstone**: draw it only while `capstone.state` is `waiting`. Once the
   capstone is hoisting or set, or a monument stands, the sledge is empty and has no pennant. Change it in the
   renderer, with a test.
4. Regenerate every golden these change (delete it and run the tests), and look at each with the Read tool.

## Scope

- `src/ui/client/scene/**`
- `src/ui/client/app/**`
- `src/ui/client/pipeline.test.ts`
- `docs/ui/**`

Read anything else; change nothing else. `src/ui/client/model.ts` and `src/ui/protocol.ts` are contracts.

## Facts

- The measurements above come from a diagnostic script the orchestrator ran in the page (1440×900, dpr 1, reduced
  motion, the busy fixture).
- At 500 px wide the page has no horizontal overflow: the document is 500 px, and only the ledger's table is wider,
  inside its own scrolling panel.
- `ui2-wire`'s report (inlined below) raised items 2 and 3 as open questions; the orchestrator decided them here.

## Acceptance

- [ ] Items 1–4 are done, with tests.
- [ ] Every changed golden was regenerated, and you looked at it.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` exits 0, except `test/assemble-plugin.test.ts > the committed plugin/` if `plugin/` is stale (the
      orchestrator rebuilds it). Report its message as it is.
- [ ] `git diff` touches only the Scope's paths.

## Notes

- **Do not run `pnpm build`** (this overrides the project rule for this lane). It rewrites the tracked `plugin/`; a
  build lane rebuilds it after this one.
