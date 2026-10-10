# M3 fixes, round 4 · readiness hears from the lanes that borrowed a worktree

## Task

The fourth `arbab review m3` confirmed (two lenses) that readiness drops the reports of lanes that work in another
lane's worktree, and noted that it drops verify's failure reason. Fix both; each fix gets a test that fails without
it.

1. **Borrowers' reports are risks too (correctness-1, contracts-1, MEDIUM, confirmed).** A verifier or fix phase with
   `worktree: <builder>` commits onto the builder's branch, so it never has a `merged` entry, and
   `src/commands/readiness.ts` builds the lane reports from `record.merged` only. Its `open_questions` and
   `not_verified` never become risks, although the skill recommends exactly that pattern. Readiness also reads the
   latest report of every lane whose run `lane.json` names a merged lane as its `worktree`, and lists its risks under
   its own name, after the owner's.
2. **Verify's reason reaches readiness (contracts-3).** `verify.json` may carry `reason` (now in `VerifyRecord`,
   `src/types.ts`): the lane ran on other code, or left changes behind. When verify did not pass, the readiness item
   says why: the reason when there is one, else the failing gates.

## Scope

You own `src/commands/readiness.ts` and `src/readiness/**`, with their tests. Change nothing else.

## Facts

- The review's evidence: `src/commands/readiness.ts:45` (lane reports from `record.merged`),
  `src/commands/integration.ts:296` (`latestReport`), `src/readiness/index.ts:130` and `:201-203`.
- Run directories hold each lane's `lane.json` as launched; `src/registry` lists lanes and reads run files.

## Acceptance

- [ ] Each fix, with a test that fails without it.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
