# README · assemble the new README (plan readme)

## Task

Six lanes wrote the new README's sections as fragments in `docs/readme/`, and a scout checked the landscape; their
reports are inlined below. Assemble `README.md` from them, as [plans/readme.md](../plans/readme.md) ("The new README,
in order") decides, then delete the fragments.

1. Replace `README.md` with, in this order:
   1. `docs/readme/01-hero.md` (the hero);
   2. `docs/readme/02-why.md` (Why arbab; How a task flows);
   3. `## Get started`: today's "Install" and "Quick start" (`README.md` lines 102–158), merged and tightened. Keep:
      - the requirements and the install commands;
      - the config example and its three notes;
      - the `/arbab` steps;
      - the "two steps are always yours".
   4. `docs/readme/03-run.md` (A real run);
   5. `docs/readme/04-trust.md` (Safe by construction; Reviews that try to prove you wrong). It replaces today's
      "Safety model";
   6. `docs/readme/05-watch.md` (Know what your workers are doing). It replaces today's "Watch it build" text and
      today's M3 status table;
   7. `## Commands`: today's table, checked against `HELP` in `src/commands/index.ts` (every command and flag there,
      and nothing that is not), followed by today's paragraph on how the skill runs them;
   8. `docs/readme/06-not.md` (What arbab is not; Built with itself);
   9. `## FAQ`: today's, with at most three changes taken from the scout's recommendations, each only when its
      source supports it. Update "As of Claude Code 2.1.295" only if the scout found a newer documented fact, and
      say what changed in `decisions`;
   10. `## Documentation`, `## Contributing` and `## License`: today's, unchanged.
2. Make it read as one document:
   - one H1;
   - sections at H2, subsections at H3;
   - no section twice;
   - no fragment-local wording such as "this section";
   - prose wrapped at 120 characters.
3. Check every relative link and image path resolves to a file in the repository, and every `#anchor` link matches a
   heading. Fix what does not.
4. Delete `docs/readme/` (`rm` its files).

## Scope

- `README.md`
- `docs/readme/**` (to read, then delete)

Change nothing else.

## Facts

- The fragments and the scout's report come from the upstream lanes (inlined below).
- `plans/readme-facts.md` holds the real outputs and numbers the fragments quote; keep them exactly as the fragments
  have them.
- `src/commands/index.ts` `HELP` lists every command with its flags.

## Acceptance

- [ ] README.md follows the order above, and the docs/readme directory is gone.
- [ ] Every relative link, image path and anchor resolves.
- [ ] The Commands table matches HELP.
- [ ] Prose lines are wrapped at 120 characters at most.

## Notes

- Style:
  - plain, concrete English; short sentences; active voice;
  - no hype words (revolutionary, seamless, powerful, blazing, cutting-edge) and no emoji.
- This lane changes Markdown only and runs no checks: the integration's verify runs the gates on the result. This
  overrides the project rule's checks for this lane. Never run `pnpm build`.
