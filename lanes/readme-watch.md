# README · know what your workers are doing (plan readme)

## Task

Write `docs/readme/05-watch.md`: `## Know what your workers are doing`, section 8 of arbab's new README
([plans/readme.md](../plans/readme.md)).

1. `arbab status`:
   - one sentence on what it shows;
   - the real table from `plans/readme-facts.md` §4 (the header, at most six rows, the quota line) in a `text` block;
   - then a short bullet list of what the columns mean:
     - turns;
     - calls and the last tool;
     - effort, measured from the transcripts, not just requested;
     - failed calls, split by cause in `summary.json`;
     - cost and its share per attempt;
     - the quota windows.
2. `### Costs and the quota`, three bullets:
   - costs are Claude Code's API-equivalent estimates (notional on a subscription), and each attempt has a budget;
   - launches wait while the five-hour or seven-day window is above its threshold;
   - a worker that hits a usage limit waits for the reset and resumes its own session.

   Keep the existing FAQ's point that N parallel workers spend quota about N times as fast.
3. `### Watch it build`:
   - `arbab ui` serves a live, read-only page on 127.0.0.1. Rewrite today's "Watch it build" bullets (`README.md`
     lines 71–81) tighter, in at most five bullets: the scene, the stones, landings, the quota and the spend, the
     dashboard around the scene;
   - add the sound: off until you turn it on, then a horn, a drum and coins;
   - show two pictures: `docs/ui/day.png` (the scene by day) and `docs/ui/night.png` (workers asleep while the account
     waits for its reset), each with alt text that says what it shows;
   - the dashboard picture (`docs/ui/page.png`) is the hero, so do not repeat it here.

## Scope

`docs/readme/05-watch.md` (new). Change nothing else.

## Facts

- `plans/readme-facts.md` §4 (status) and §10 (`arbab ui`).
- DESIGN.md §8 (quota and parallelism) and §19 (the scene, the page, the sound).
- The pictures exist: `docs/ui/day.png`, `docs/ui/night.png`.

## Acceptance

- [ ] The file docs/readme/05-watch.md holds the three parts above.
- [ ] The table is copied, never edited.
- [ ] Every claim is true of DESIGN.md §8 and §19.
- [ ] Prose lines are wrapped at 120 characters at most.

## Notes

- Style:
  - plain, concrete English; short sentences; active voice;
  - no hype words (revolutionary, seamless, powerful, blazing, cutting-edge) and no emoji.
- This lane writes one Markdown file and runs no checks: the integration's verify runs the gates on the result. This
  overrides the project rule's checks for this lane. Never run `pnpm build`.
