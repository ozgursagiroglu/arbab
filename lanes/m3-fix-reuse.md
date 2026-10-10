# M3 fixes, round 6 · a worktree no worker has run in is rebuilt, not reused

## Task

The sixth `arbab review m3` confirmed these defects in the install-point rules of round 5. Fix each one; each fix gets
a test that fails without it.

1. **Rebuild instead of reuse (correctness-1 / contracts-1, MEDIUM, confirmed; security-2).** `prepare()` reuses a
   worktree no worker has run in (a setup that failed before any attempt) as it is. If the lane's base became trusted
   meanwhile, the plan skips the base merge, and the lane runs on the old merge-base without its base's code. A merge
   interrupted after it updated the files but before the ref moved also leaves worker files under a trusted ref, and
   the install then runs them. Such a worktree holds nothing of the lane's own, so the shepherd rebuilds it: remove the
   worktree (`--force`, through `untrustedTree()`), delete `arbab/<lane>` when it holds no commit of its own, and
   create it again through the normal plan (install point, install, merges). A worktree a worker has run in
   (`worktree-used`, or the owner's attempts) is never removed. Update `test/e2e/plan.test.ts` where it expected the
   reused worktree, and say in `decisions` what a relaunch after a failed merge now does.
2. **A confirmed ancestor is an install point (correctness-2, MEDIUM, confirmed; contracts-2).** A lane based on an
   integration head that moved past its confirmed commit by merges that changed no manifest is refused today:
   `installPlan` trusts only a base that *equals* a `depsConfirmedAt`, so it installs at the merge-base with
   `baseBranch` and the base merge then carries the confirmed manifest changes. Like `generatedBase`, use the newest
   confirmed head that is an ancestor of the base as the install point and merge the base on top; `mergeBranches`
   still refuses a manifest change between them.
3. **`--deps-installed` names the head it confirms (security-1).** A concurrent `integrate` can move the record
   between the human's review and the confirmation, and `confirmDeps` then confirms the newer head. Make the flag take
   the sha: `arbab integrate <name> --deps-installed <sha>`, refused unless it equals the recorded head and the
   branch. The advice that `integrate` and the refusals print gives the exact command with the sha.

## Scope

You own `src/shepherd/**`, `src/run/**`, `src/integrate/**`, `src/commands/integrate.ts`,
`src/commands/integration.ts` (the advice text), the help line in `src/commands/index.ts`, and
`test/e2e/plan.test.ts`, with their tests. Change nothing else; say in `open_questions` which docs mention the old
`--deps-installed` form.

## Facts

- The review's evidence: `src/shepherd/lifecycle.ts:335-337` (the pristine reuse and its trust check by ref),
  `src/shepherd/trust.ts:52` and `:78` (`installPlan`, exact `depsConfirmedAt` match),
  `src/integrate/integrate.ts:508` (`confirmDeps`).
- `generatedBase` (`src/commands/integration.ts`) shows the confirmed-head rule for generated lanes.

## Acceptance

- [ ] Each fix, with a test that fails without it.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
