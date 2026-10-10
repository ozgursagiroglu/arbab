# M3 fixes, round 5 · every lane installs on a trusted commit; the integration's base moves with the base

## Task

The fifth `arbab review m3` confirmed these defects. Fix each one; each fix gets a test that fails without it.

1. **A worker branch as `base` (security-1, confirmed).** A lane may start from a worker-written branch: a fix
   round on `integrate/<name>`, a lane continuing `arbab/<other>` (SKILL.md recommends it), a plan's `base`. The
   shepherd creates the worktree there and runs the dependency command on the host, on worker code. Generated lanes
   already avoid this (they start on a trusted commit and fast-forward to the head). Make it the rule for every lane,
   in the shepherd's `prepare()` (`src/shepherd/lifecycle.ts`), when it creates a worktree:
   - resolve the lane's base (`lane.base ?? config.baseBranch`) to a commit `B`;
   - **trusted install points** are commits contained in `config.baseBranch`, and integration heads a human confirmed
     (`depsConfirmedAt` in `.arbab/integrations/*/integration.json`, read with `listIntegrations` and
     `readIntegration` from `src/integrate`);
   - when `B` is trusted, nothing changes;
   - otherwise create the worktree at `git merge-base B <baseBranch>` (refuse when there is none), install there, and
     merge `B` first, before the lane's own `mergeBranches`, through the existing `mergeBranches` (resolved by sha,
     fast-forward, manifest refusal). A manifest that differs between the install point and `B` is refused with
     `mergeBranches`'s message: the orchestrator lands or confirms that dependency change first.
   - `createWorktree`'s check for an existing branch (`refuseWorkerBranch`) compares with the trusted base
     (`config.baseBranch`), not with the lane's `base`, which may itself be worker-written.
   - To let `src/shepherd` read integration records without an import cycle, move `DEPENDENCY_MANIFESTS` and
     `isDependencyManifest` from `src/shepherd/merge.ts` to `src/run/deps.ts` (export them from `src/run`), and point
     every importer there. Add `npm-shrinkwrap.json` to the list (contracts-2: it is npm's lockfile).
2. **The integration's base moves with the base (correctness-1, confirmed).** `land` tells the human to merge a
   moved base into the integration and integrate again, but `integrate` keeps the first `baseSha` while it is an
   ancestor of the head. The review then diffs the base's own commits, and `manifests` flags the base's own
   dependency changes as unconfirmed. `baseSha` is `git merge-base <head> <record.base>` on every `integrate` (the
   recorded `base`, kept as today); per-lane manifests of an already-contained lane use that `baseSha`.

## Scope

You own `src/shepherd/**`, `src/run/**`, `src/integrate/**`, and the import lines of any file that imported
`isDependencyManifest` or `DEPENDENCY_MANIFESTS` from `src/shepherd`, with their tests. Change nothing else.

## Facts

- The review's evidence: `src/run/git.ts:143-148` (`worktree add -b <branch> <path> <base>`),
  `src/shepherd/lifecycle.ts:279` (`base: lane.base ?? config.baseBranch`) and `:316-318` (install when created),
  `src/integrate/integrate.ts:348-349` (`keptBase`), `:370` (`manifestsIn([baseSha, headSha])`).
- `mergeBranches` (`src/shepherd/merge.ts`) already fast-forwards and refuses manifest changes; generated lanes
  (`generatedBase` in `src/commands/integration.ts`) start on `baseSha` or `depsConfirmedAt`, both trusted under the
  rule above, so they keep working unchanged.
- Tests build real repositories: a lane based on a worker branch whose `scripts/setup.js` (run by the dependency
  command) differs from the base must have the install run the base's script; a branch that changes `package.json`
  is refused; a base a human confirmed installs there.

## Acceptance

- [ ] Each fix, with a test that fails without it.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
