# README · a real run (plan readme)

## Task

Write `docs/readme/03-run.md`: `## A real run`, section 5 of arbab's new README ([plans/readme.md](../plans/readme.md)).
It shows arbab's own `ui2` milestone (the game-studio pass of `arbab ui`) from the first check to the landing,
in real outputs only.

1. One opening paragraph:
   - this is how arbab built part of itself;
   - the outputs are real, trimmed, and their paths shortened;
   - the commands are what the orchestrator ran, shown as `arbab <command>`; the skill's own form of each is
     `node "${CLAUDE_PLUGIN_ROOT}/dist/arbab.mjs" <command>`.
2. Steps, each one or two sentences of prose and then its output in a `text` code block, copied from
   `plans/readme-facts.md` (you may drop rows or cut lists with `…`, never edit a value):
   1. In Claude Code: `/arbab`, then "Plan this and run it with arbab." The session writes a plan and briefs (prose
      only, no output).
   2. `arbab plan check plans/ui2.json` (facts §1).
   3. `arbab plan next plans/ui2.json` (facts §2), and that `plan next` runs again after each finish.
   4. `arbab wait --any` in the background, and a finish (facts §3).
   5. `arbab status` (facts §4): keep the header, at most six rows, and the quota line.
   6. `arbab integrate ui2 --plan plans/ui2.json` (facts §5).
   7. `arbab verify ui2` (facts §6): the gates run inside the fence, in a lane without file-editing tools.
   8. `arbab review ui`: say it is the first `arbab ui` integration, and show facts §7 cut to the six confirmed
      findings. Then one sentence: every confirmed finding was fixed by a fix lane before landing.
   9. `arbab readiness ui2` (facts §8).
   10. `arbab land ui2` after the human's yes (facts §9), cut after the first three lines with `…`; it never pushes.
3. One closing sentence pointing to [Safe by construction](#safe-by-construction) and
   [Know what your workers are doing](#know-what-your-workers-are-doing). Those are sibling sections, so link their
   anchors as written here.

## Scope

`docs/readme/03-run.md` (new). Change nothing else.

## Facts

- `plans/readme-facts.md` holds every output, with the paths already shortened.
- The commands and their flags are in `src/commands/index.ts` (`HELP`). Use no flag that is not there.

## Acceptance

- [ ] The file docs/readme/03-run.md holds the steps above, each output copied from plans/readme-facts.md.
- [ ] No output line was invented or edited; cuts use an ellipsis.
- [ ] Prose lines are wrapped at 120 characters at most.

## Notes

- Style:
  - plain, concrete English; short sentences; active voice;
  - no hype words (revolutionary, seamless, powerful, blazing, cutting-edge) and no emoji.
- Output blocks use the `text` language tag.
- This lane writes one Markdown file and runs no checks: the integration's verify runs the gates on the result. This
  overrides the project rule's checks for this lane. Never run `pnpm build`.
