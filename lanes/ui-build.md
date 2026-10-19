# UI · rebuild the tracked plugin/ on the integration

## Task

`plugin/` is what a marketplace install copies: the runner bundle, the plugin manifest and the skills. It is tracked,
so it must be the build of the commit it sits in. The integration `ui` changed the runner's sources and the skill.
Rebuild it:

1. Run `pnpm build`. It bundles the runner, with the page script, into `dist/arbab.mjs`, and rewrites `plugin/` from
   it.
2. Run `pnpm test`. Its "the committed plugin/" test compares `plugin/skills/` with `skills/`.
3. Run `git status --porcelain` and report what changed.

Change no file by hand: `plugin/` must be exactly what `pnpm build` writes.

## Scope

`plugin/**`, written only by `pnpm build`.

## Acceptance

- [ ] `pnpm build` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `git status --porcelain` lists changes under `plugin/` only.

## Notes

- This lane runs `pnpm build`, which the other lanes of this plan did not: parallel lanes' bundles would have
  conflicted at integration.
- If a step fails, report its output and stop. Do not try to fix sources: they belong to the integration.
