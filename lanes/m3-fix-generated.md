# M3 fixes, round 2 · generated lanes install only on a trusted tree

## Task

The second `arbab review m3` confirmed that the lanes `verify` and `review` generate run the dependency command on the
host over worker code. Fix it as below; each fix gets a test that fails without it.

1. **Install on a trusted commit, then move to the head (security-1, HIGH, confirmed).** A generated lane's new
   worktree starts at `integrate/<name>`, and the shepherd runs the dependency command there, unsandboxed. That tree
   is worker code: a lifecycle script can run a file no manifest check looks at (`"postinstall": "node
   scripts/setup.js"` with a changed `scripts/setup.js`, `pip install -e .` with a changed `setup.py`, a `Makefile`).
   The shepherd already has the safe order for plan phases: install on the base, then merge the worker branches,
   refusing a merge that changes a manifest. Generated lanes use it:
   - `generatedBase(record): { base: string; mergeBranches?: string[] }` in `src/commands/integration.ts`, used by
     `verify` and `review` (reviewers and skeptics) for every lane they generate:
     - `base` is the integration's `baseSha` when `record.manifests` is empty, else `record.depsConfirmedAt` (a head
       at which a human installed the changed dependencies); with neither, it refuses with today's
       `assertDepsConfirmed` message, which it replaces;
     - `mergeBranches` is `[record.headSha]`, left out when `base` is already the head.
   - `verifyLaneSpec` (`src/verify`) and the reviewer and skeptic specs (`src/review/lanes.ts`) take `base` and
     `mergeBranches` as input instead of building `integrate/${name}`.
   - `mergeBranches` in `src/shepherd/merge.ts` fast-forwards when it can (`--ff` instead of `--no-ff`; keep
     `--no-edit`, `--no-verify` and the `-m` message for a real merge). A generated lane's branch then ends exactly at
     the integration head, so `verify`'s check that the lane ran on the head and the reset rule for generated lanes
     (branch tip equals the marker's head) keep working. A plan phase that merges a branch descending from its base is
     fast-forwarded as well; update the tests that expected a merge commit there.
2. **The sha, not the branch name (security-2, MEDIUM, confirmed).** With `base` and `mergeBranches` as commits from
   the record, a later `integrate` that moves `integrate/<name>` while a generated lane waits for a slot or the quota
   no longer changes what the lane installs on or checks.
3. **Advice from the whole record.** `manifestAdvice` and the refusal list `record.manifests` and name the merged lanes
   that changed each one; a manifest no merged lane changed is listed as changed by a commit arbab did not merge.
4. **One lanes directory (contracts-6).** `src/review/lanes.ts` and `writeGeneratedLane` build every generated lane's
   files from `IntegrationPaths.lanesDir` (added by the orchestrator); the separate
   `.arbab/integrations/<name>/lanes` literal goes. Lane files keep paths relative to the project root, as today.

## Scope

You own `src/shepherd/merge.ts`, `src/commands/integration.ts`, `src/commands/generated.ts`, `src/commands/verify.ts`,
`src/commands/review.ts`, `src/verify/**`, `src/review/**` and `test/e2e/**`, with their tests. Change nothing else.

## Facts

- The review's evidence: `src/verify/index.ts:67` and `src/review/lanes.ts:97,194` (`base: \`integrate/${name}\``),
  `src/shepherd/lifecycle.ts:338-347` (install when the worktree is new, then `mergeBranches`),
  `src/commands/verify.ts:57-76`, `src/commands/integration.ts:56-84`.
- `IntegrationRecord.manifests` and `depsConfirmedAt` (`src/types.ts`) were added by the orchestrator in the commit your
  branch starts from. Another lane (`m3-fix-integrate`) makes `integrate` compute `manifests` from every commit between
  `baseSha` and the head and keep `depsConfirmedAt` only while no manifest changed after it; code against the fields.
- `config/check.ts` `ref()` accepts a sha for `base` and `mergeBranches`.
- The shepherd records each merge in `started.json` (`merged`), which stays as it is.

## Acceptance

- [ ] Each numbered fix, with a test that fails without it. For fix 1, at least: an e2e or shepherd-level test where
      the dependency command records the commit it ran on, showing it ran on the base (or on `depsConfirmedAt`) and
      that the lane then worked on the integration head; and a test that a changed non-manifest file the install would
      run is never run on the host.
- [ ] The e2e landing test still passes.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
