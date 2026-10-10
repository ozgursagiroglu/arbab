# M3 · integration worktrees (src/integrate)

## Task

Implement `src/integrate/` (DESIGN.md §17, `arbab integrate`): merge finished lanes into an integration branch that
no worker ever runs in. Commands come in a later lane; this module is the logic. It is called with injected `git`,
`runCommand` and `clock`.

Export from `src/integrate/index.ts`:

1. `integrationPaths(projectRoot, config, name)`. `name` passes `assertValidName`. Returns:
   - `dir`: `<projectRoot>/.arbab/integrations/<name>`;
   - the files `integration.json`, `verify.json`, `review.json`, `readiness.json`, `readiness.md`, `landing.json`;
   - `worktree`: `<projectRoot>/<config.worktreeRoot>/integrate-<name>`;
   - `branch`: `integrate/<name>`.
2. `integrate(input: { projectRoot, config, name, lanes: string[], git: GitRunner, runCommand: ArgvRunner, clock:
   Clock }): IntegrationRecord`:
   1. **Worktree.** Reuse the integration worktree when it exists as a worktree of this repository on `branch`. A
      path that exists but is something else is an `ArbabError("git")`. Otherwise:
      - create it with `git worktree add -b <branch> <worktree> <config.baseBranch>` (argv, no shell), or attach the
        branch when it already exists;
      - run `config.dependencies` there through `prepareDependencies`, on the trusted base, before any merge; a
        failure throws with the tail of the output;
      - add the integrations dir to the ignore list with `ensureIgnored`.
   2. **Merges.** For each lane in order:
      - branch `arbab/<lane>` (lane names pass `assertValidName`);
      - resolve its sha once;
      - skip it when that sha is already an ancestor of HEAD (`git merge-base --is-ancestor`);
      - otherwise list the files it changes against HEAD (NUL-separated, as `src/shepherd/merge.ts` does) and note
        the dependency manifests among them (`isDependencyManifest` from `src/shepherd`);
      - merge the sha with this argv:

        ```text
        git merge --no-ff --no-edit -m "arbab: integrate <lane> into integrate/<name>" <sha>
        ```
      - on a conflict, abort (`git merge --abort`) and throw `ArbabError("git")` naming the lane and the
        conflicting paths. Lanes merged before it stay merged and recorded.
   3. **Record.** Write `integration.json` atomically and return it. `merged` keeps earlier entries and appends new
      ones. `depsConfirmed` is false as soon as any merged lane changed a manifest, unless it was already confirmed
      for that same set of lanes. `headSha` is the new HEAD.
3. `readIntegration(paths): IntegrationRecord | null`.
4. `confirmDeps(paths): IntegrationRecord`: sets `depsConfirmed: true` and re-reads `headSha`. The human runs it
   after reviewing and installing changed dependencies by hand; arbab never installs after a merge, because that
   would run worker code on the host.

## Scope

You own `src/integrate/**` (code and tests). Change nothing else.

## Facts

- `src/run/git.ts` has `ensureIgnored`, `makeGitRunner` and `nodeGit`. `src/run/deps.ts` has
  `prepareDependencies` and `runArgv`. `src/shepherd` exports `isDependencyManifest` and `DEPENDENCY_MANIFESTS`.
- `IntegrationRecord` is in `src/types.ts`.
- No worker runs in the integration worktree. Verify and review lanes get their own worktrees based on the
  integration branch.

## Acceptance

- [ ] Every export, with tests on temporary git repositories: first integration (worktree created, deps run before
      merges, two lanes merged in order), a second call that skips merged lanes and adds a new one, a conflict
      (aborted, earlier lanes kept, error names the path), a manifest change (flagged, `depsConfirmed` false;
      `confirmDeps` sets it), a non-worktree path refused, an invalid name refused.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
