# M3 fixes · the landing commands

## Task

`arbab review m3` (three lenses plus skeptics) confirmed these defects in the commands, and listed several
unverified ones that are cheap to fix. Fix each one; each fix gets a test that fails without it.

1. **Review installs unreviewed dependencies on the host (security-1 / contracts-1, HIGH, confirmed by two
   lenses).** Generated reviewer and skeptic lanes start from `integrate/<name>`, and their new worktrees run the
   dependency command on the host. `verify` refuses while a merged lane changed a dependency manifest and
   `depsConfirmed` is false; `review` does not. Make `review` refuse in the same case with the same message, through
   one shared helper used by both commands.
2. **`integrate --plan` uses `integrationLanes(plan)` (correctness-1).** Lane `m3-fix-git` adds that export to
   `src/plan` (phases in wave order, without worktree borrowers). Until it is merged, code against that name and
   signature (`(plan: PlanSpec) => string[]`) and test with an injected function if you need to.
3. **Gate command lines keep their meaning (correctness-2 / contracts-2).** `commandLine` in `src/verify` quotes an
   argument only for whitespace and quotes. Quote any argument containing a character outside
   `[A-Za-z0-9_./:@%+=,-]`, so `;`, `&`, `|`, `$`, `*`, `(` and the like stay literal.
4. **Generated-lane markers.**
   - **contracts-3:** `markGenerated` records the integration head the lane started from (`baseSha`). A reset is
     allowed when the branch tip equals that sha (the lane never commits), even if the integration branch was
     recreated since. A marker without `baseSha` keeps today's rule (no commits that are not on the integration
     branch).
   - **contracts-5:** `arbab launch` and `arbab resume` refuse a lane whose run dir carries a generated marker.
     The message names the integration that owns the name. A hand-launched lane can then never be mistaken for a
     generated one.
5. **Skeptic verdicts stay with their lens (contracts-6).** In `src/commands/review.ts`, each skeptic's verdicts
   apply only to the findings of its own lens.
6. **`land` checks what it lands (correctness-3, security-4, contracts-9).** In `src/commands/land.ts`:
   - refuse when `readiness.json` is older than `verify.json` or `review.json` for the same head;
   - refuse when the readiness tier is below `config.landing.tier`;
   - merge into the integration's recorded `base`, not the current `config.baseBranch`;
   - run the merge with hooks disabled (`-c core.hooksPath=/dev/null`; the branch holds worker code).
7. **Readiness lists unverified LOW findings (contracts-7).** One risk line with their count, ids and titles
   (`src/readiness`).
8. **Untested exports (contracts-10).** Tests for `contentBlocks` and `toolResultText` (`src/stream`) and
   `formatReview` (`src/commands`).

## Scope

You own `src/commands/**`, `src/verify/**`, `src/readiness/**`, the tests for `src/stream/digest.ts` exports, and
`test/e2e/**`. Change nothing else.

## Facts

- The review's evidence names `src/commands/integration.ts:221` (generated lanes and the install), `:149` and `:154`
  (markers), `src/commands/review.ts:128` (verdicts), `src/commands/land.ts:55–62`, `src/verify/index.ts:13` and
  `src/readiness/index.ts:152`.
- `verify` already has the manifest refusal (`unconfirmedManifests`). Reuse it; do not copy it.

## Acceptance

- [ ] Each numbered fix, with a test that fails without it. The e2e landing test still passes.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
