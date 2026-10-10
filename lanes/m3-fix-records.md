# M3 fixes, round 3 · an integration's record starts where its branch starts

## Task

The third `arbab review m3` found these defects in `integrate`. Fix each one; each fix gets a test that fails
without it.

1. **A landed integration is closed (contracts-1, confirmed).** After `land`, `.arbab/integrations/<name>/` keeps its
   records (they are the measurement), but `land` deletes `integrate/<name>`. Running `arbab integrate <name>` again
   creates a new branch from today's base while the old record brings back the landed lanes, the old `baseSha` and
   the old manifests, and `cleanup --worktrees` treats the new integration as landed. `integrate` refuses a name whose
   `landing.json` exists: the message names the landing time and asks for a new name.
2. **A new branch starts a new record (correctness-1, confirmed).** When `integrate` creates `integrate/<name>` because
   it does not exist (it was deleted after a refusal, say), an existing `integration.json` describes another branch.
   Move it aside as `integration.superseded-<updatedAt>.json` (characters a file name cannot hold replaced) and start a
   fresh record: `baseSha` from the new branch, no merged lanes, no confirmation.
3. **No lane with a live worker (correctness-2, confirmed).** `integrate` refuses a lane whose worker is still alive
   (an orphaned lane: its shepherd died, its worker may still write), using `assertNoLiveWorker` from
   `src/commands/launch.ts` next to the existing `assertInactive`.
4. **A borrowed owner outside the plan is integrated (correctness-3, confirmed).** A plan phase may work in the
   worktree of a lane that is not a phase of the plan (`worktree: "<earlier lane>"`). `integrationLanes`
   (`src/plan/graph.ts`) drops the phase and never adds the owner, so its commits are lost silently. Include such an
   owner once, at the borrowing phase's place in the wave order.
5. **No integration name whose generated lanes are reserved (contracts-4).** An integration named `integrate`
   generates `integrate-verify`, which lane rules reserve. `integrationPaths` refuses `integrate` as well as names
   starting with `integrate-`.

## Scope

You own `src/integrate/**`, `src/commands/integrate.ts` and `src/plan/**`, with their tests. Change nothing else.

## Facts

- The review's evidence: `src/integrate/integrate.ts:303-306` (the previous record's merged entries and `keptBase`),
  `:54` (`integrationPaths`), `:190-192` (the refusal that tells the user to delete the branch);
  `src/plan/graph.ts:135` (`integrationLanes`).
- `land` writes `.arbab/integrations/<name>/landing.json`; `IntegrationPaths.landing` names it.
- `assertInactive` treats `orphaned` as inactive; `assertNoLiveWorker` checks the recorded worker pid.

## Acceptance

- [ ] Each numbered fix, with a test that fails without it.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
