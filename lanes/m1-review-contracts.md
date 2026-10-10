# M1 review · contracts and integration lens

## Task

Review the M1 runner on this branch for defects at the seams. Nine modules and the CLI were written by separate
workers in parallel and merged. Find where they disagree with each other, with `src/types.ts`, or with DESIGN.md.

Look for:

1. **Files on disk.** A file one module writes and another reads under a different name, path or shape:
   `state.json`, `summary.json`, `report.json`, `started.json`, `exit.json`, `acked`, `shepherd.json`, `lane.json`,
   the pool files.
2. **The worker's command line.** The compiled argv and settings against DESIGN.md §4 (every flag, the empty
   `--setting-sources` value, `--restricted`, the schema), the scrubbed environment, and the assembled brief's
   section order against §5.
3. **The CLI.** Commands, flags, outputs, `--json` shapes and exit codes against DESIGN.md §10. `launch`, `resume`
   and `stop` against the shepherd's contract and modes.
4. **Duplication.** Logic implemented twice in different modules (CLAUDE.md requires reuse): JSON reading, pools,
   name checks, time formatting, rule matching.
5. **Untested exports.** Exported functions with no tests, and tests that only assert a mock.
6. **Bundle.** Anything that works in tests but breaks in `dist/arbab.mjs`: `import.meta.url`, `__dirname`, paths
   to `package.json` or fixtures, dynamic imports. Run `pnpm build` and read how `src/cli.ts` locates itself.

## Scope

Read-only. All of `src/`, `scripts/build.mjs`, `test/fake-claude/**`, DESIGN.md and `src/types.ts`. You may run
`pnpm test`, `pnpm typecheck` and `pnpm build`.

## Facts

- The modules were merged in this order: profile, stream, config/binary/report, registry/quota, brief, run, then
  shepherd, CLI and skill.
- The orchestrator made small integration changes:
  - `AttemptSummary.lastTool`;
  - the probe may `Write`;
  - implementers may run mkdir, cp, mv, rm and touch.

## Acceptance

- [ ] `paths_checked` lists every file you read in full, and `coverage` says what you verified and how.
- [ ] Each finding names the file and line, gives a concrete failure scenario, and cites its evidence. No style
      remarks.
- [ ] At most 10 findings, strongest first.
