# M3 fixes · hooks off for arbab's own git, reserved integration names

## Task

`arbab review m3` (three lenses plus skeptics) confirmed these defects. Fix each one; each fix gets a test that
fails without it.

1. **Worker-written git hooks run on the host (security-2, MEDIUM, confirmed).** Repositories often set a relative
   `core.hooksPath` (husky: `.husky`). It resolves inside the work tree, which a worker can write. Every git command
   arbab runs on the host in a tree that holds worker code would then run worker-written hooks outside the fence:
   - the shepherd's checkpoint commit (`src/run/checkpoint.ts`);
   - the shepherd's dependency merges (`src/shepherd/merge.ts`);
   - the integration merges (`src/integrate/integrate.ts`).

   Fix: these commands run with hooks disabled, using git's own config override
   `-c core.hooksPath=/dev/null` before the subcommand (plus `--no-verify` where git offers it). Put the
   override in one helper in `src/run/git.ts`, next to `explicitGit`, and use it everywhere. Read-only git calls do
   not need it. The project's checks run inside the fence instead, through `arbab verify`.
2. **The integration worktree's name is reserved (security-3 / contracts-4, MEDIUM, confirmed).** A lane named
   `integrate-<x>` (or a lane borrowing that worktree) runs a worker inside `<worktreeRoot>/integrate-<x>`, the
   integration worktree, which arbab merges into on the host. Reject lane names and plan phase names that start with
   `integrate-`, and a lane `worktree` field that names one: `src/config/lane.ts` and `src/plan/load.ts`, with a
   clear error. `src/integrate` refuses an integration whose worktree path is already a lane's worktree.
3. **Integrating a plan with borrowing phases (correctness-1, MEDIUM, confirmed).** A phase with `worktree: <other>`
   has no branch of its own: its work is on the owner's branch. Export
   `integrationLanes(plan): string[]` from `src/plan`: the plan's phases in wave order, without phases that borrow a
   worktree, each lane once. The command lane uses it.

## Scope

You own `src/run/git.ts`, `src/run/checkpoint.ts`, `src/shepherd/merge.ts`, `src/integrate/**`,
`src/config/lane.ts`, `src/plan/**`, and their tests. Change nothing else.

## Facts

- The review evidence names `src/integrate/integrate.ts:241` (the merge), `src/run/git.ts:100` (`createWorktree`)
  and `src/integrate/integrate.ts:47` (`integrationPaths`).
- `git -c core.hooksPath=/dev/null …` makes git look for hooks in a path that holds none, so no hook runs, whatever
  the repository's config says. Test it with a repository whose relative `core.hooksPath` holds a hook that writes a
  marker file: the marker must not appear.
- FR-8 asked the checkpoint to run the repository's commit hooks. That predates this finding: hooks from a
  worker-written tree are worker code. DESIGN.md is updated by the orchestrator.

## Acceptance

- [ ] Each numbered fix, with a test that fails without it (for 1, the marker-hook test on each of the three call
      sites).
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
