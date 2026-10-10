# arbab — project rules

arbab is a Claude Code plugin: a skill (the method) plus a runner CLI (the mechanics) that launches and supervises
headless `claude -p` workers. [DESIGN.md](DESIGN.md) is the source of truth for behaviour; [REQUIREMENTS.md](REQUIREMENTS.md)
says why. These rules bind every contributor, human or worker. Workers do not load this file by themselves, so arbab
inlines it into their briefs.

## Stack

- TypeScript (strict), ESM, Node ≥ 20, pnpm. Tests with vitest. The runner is bundled with esbuild into
  `dist/arbab.mjs`.
- **Zero runtime dependencies.** Use only `node:` built-ins in `src/`. Dev dependencies are typescript, vitest,
  esbuild and @types/node; do not add others.
- Imports without file extensions (bundler resolution). Use `import type` for types (`verbatimModuleSyntax`).

## Code

- Contracts live in `src/types.ts`; shared helpers in `src/util/`. Reuse them instead of re-implementing (atomic
  writes, exclusive creates, path confinement, name validation, process signals, errors). Do not edit either from a
  lane that does not own them: report the change you need in `open_questions`.
- No shell strings. Every subprocess goes through `execFile`/`spawn` with an argv array.
- Validate every external input (lane files, config, stream events, CLI arguments) and treat stream-json as
  untrusted and evolving: unknown event types and fields are ignored, never fatal.
- Paths that come from input are confined with `confine()`; names that become paths pass `assertValidName()`.
- Never write environment values or credentials to disk or logs; names only.
- Keep side effects at the edges. Functions take what they touch (paths, home directory, clock, spawn function) as
  parameters, so tests can inject them; never read `process.env`, `os.homedir()` or `Date.now()` deep inside logic.
- No `any`. Use `unknown` and narrow.
- Errors: throw `ArbabError` with a code; the CLI maps codes to exit statuses.
- Comments explain why, not what. Keep them short and in English.

## Tests

- Every exported function has tests next to it (`src/<module>/<file>.test.ts`), including failure paths and edge
  cases. Tests are part of done.
- Tests never touch the real `~/.arbab`, `~/.claude` or the network. Use temporary directories
  (`fs.mkdtempSync(path.join(os.tmpdir(), "arbab-"))`) and remove them.
- Fixtures under `test/fixtures/` hold no private data: no real home paths, prompts or customer content.

## Checks

- `pnpm typecheck`, `pnpm test` and `pnpm build` must all exit 0 before work is reported done.
- Run them as single commands and report each exit code as the tool returned it; never pipe a check through
  `tail` or `head`.
