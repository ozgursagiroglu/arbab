# M3 · a plugin directory that holds only the plugin

## Task

The marketplace (`.claude-plugin/marketplace.json`) lists the plugin with `"source": "./"`, the repository root.
Measured on CLI 2.1.295 with an isolated `CLAUDE_CONFIG_DIR`: installing a plugin from a local marketplace copies its
whole source directory into `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`, ignored files included
(`dist/`, `node_modules/`). For arbab that would copy `node_modules`, `.arbab/` (gigabytes of worktrees and run data),
and the private `evidence/` and `research/feedback-*.md`. Make the installable plugin a directory that holds only the
plugin:

1. **`pnpm build` assembles `plugin/`** after bundling `dist/arbab.mjs`:
   - `plugin/.claude-plugin/plugin.json` (from `.claude-plugin/plugin.json`), `plugin/skills/**` (from `skills/`),
     `plugin/dist/arbab.mjs` (the bundle), and nothing else;
   - the directory is removed and rebuilt each time, so a file deleted from `skills/` never ships;
   - the assembly is a function in `scripts/` that takes the repository root, the bundle path and the output
     directory, so a test can run it on a temporary directory. Keep `pnpm typecheck` strict (no `allowJs`): a
     `.d.mts` declaration next to an `.mjs` module is fine.
2. **The marketplace points at it:** `"source": "./plugin"`. Update the manifest tests in `src/skill.test.ts`.
3. **`plugin/` is a build output:** add it to `.gitignore`.
4. **README.md:** replace the stale status ("There is no code yet") with what arbab is today (M1 and M2 landed, M3
   landing: integrate, verify, review, readiness, land) and add a short "Use it" section before the research table,
   with these commands as a shell block (the commands are for the README's reader, not for you):
   ```text
   pnpm install
   pnpm build
   claude plugin marketplace add <path to this repository>
   claude plugin install arbab@arbab
   ```
   then, in a project: an `arbab.config.json` (point to `arbab.config.json` in this repository as an example and to
   the skill's "Before the first launch" section for the fields), `node "${CLAUDE_PLUGIN_ROOT}/dist/arbab.mjs"
   doctor`, and the skill (`/arbab`).
   After a new build, `claude plugin marketplace update arbab` refreshes it. Leave the rest of the README as it is.

## Scope

You own `scripts/**`, `.claude-plugin/**`, `.gitignore`, `README.md`, the plugin-manifest tests in
`src/skill.test.ts`, and a new test file under `test/` for the assembly. Change nothing else.

## Facts

- `scripts/build.mjs` bundles `src/cli.ts` into `dist/arbab.mjs` with esbuild; the e2e tests run that bundle, so it
  stays where it is.
- The skill runs the runner as `node "${CLAUDE_PLUGIN_ROOT}/dist/arbab.mjs"`, so inside `plugin/` the bundle must be at
  `dist/arbab.mjs`.
- vitest runs `src/**/*.test.ts` and `test/**/*.test.ts`; tsconfig includes the same trees.
- Tests never write to the repository tree: assemble into `fs.mkdtempSync(path.join(os.tmpdir(), "arbab-"))`.

## Acceptance

- [ ] A test that assembles into a temporary directory and checks the exact file list, the manifest, the skill files
      and the bundle; and that a stale file in the output directory is gone after a rebuild.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0, and after `pnpm build` the repository's `plugin/` holds
      exactly the files above.
