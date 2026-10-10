# M3 fixes, round 3 · what land's cleanup removes

## Task

The third `arbab review m3` found these defects in the cleanup that `land` and `cleanup --worktrees` run. Fix each
one; each fix gets a test that fails without it.

1. **Lane branches stay (correctness-4, MEDIUM, confirmed).** A plan phase merges its dependencies by branch name
   (`mergeBranches: ["arbab/<dep>"]`, compiled when `plan next` launches it). Landing an early wave deletes
   `arbab/<dep>`, and the later phase then fails setup. Branches cost nothing; the worktrees were what filled the disk.
   So `land` and `cleanup --worktrees` remove worktrees as today but delete only two kinds of branch: those of lanes
   generated for an integration (`readGenerated`) and a landed integration's `integrate/<name>`. `arbab/<lane>`
   branches of other lanes are never deleted. Drop `deleted branch` lines for them, and keep the text and JSON shapes
   otherwise.
2. **Status only through the verified git dir (security-1, confirmed).** `isDirty(path, git)` runs a plain
   `git status` in a worker's worktree, so git follows the worktree's own `.git` file, which a worker with a write tool
   may have rewritten (a `core.fsmonitor` in a planted config would then run on the host). Every status check cleanup
   makes in a lane's worktree first verifies it with `verifyWorktreeGit` (worktree, `arbab/<lane>`, the shared git
   dir) and passes the verified git dir to `isDirty` (its third parameter), as `src/integrate` does for its own dirty
   check. A worktree that fails verification is kept, with the reason, and nothing runs in it. The integration
   worktree is verified the same way on `integrate/<name>`.
3. **Only finished lanes (correctness-2, confirmed).** `land`'s cleanup removes a lane's worktree only when its
   effective state is `finished`, as `cleanup --worktrees` already requires. An orphaned lane (its shepherd died, its
   worker may still run) is kept with the reason `orphaned: run arbab cleanup first`.
4. **A lane whose `worktree` names itself owns it (contracts-2, confirmed).** A plan's `defaults.worktree` can give a
   phase `worktree: "<its own name>"`. Treat that lane as the owner of its worktree everywhere in cleanup, and never
   skip a lane without a kept line saying why.

## Scope

You own `src/commands/cleanup.ts`, `src/commands/land.ts` and `src/commands/generated.ts`, with their tests. Change
nothing else. If the e2e landing test (`test/e2e/landing.test.ts`, not yours) expects a lane branch to be deleted, say
so in `open_questions`; the orchestrator updates it.

## Facts

- The review's evidence: `src/commands/cleanup.ts:136` (`isDirty` without a git dir), `:172` (branch deletion), `:205`
  (`worktree !== undefined` skip), `:213` (the blocker that ignores orphaned lanes).
- `verifyWorktreeGit` and `isDirty` are exported from `src/run`; `src/integrate/integrate.ts` (`refuseDirtyLanes`)
  shows the verified pattern.
- Run directories and `.arbab/integrations/<name>/` are never removed.

## Acceptance

- [ ] Each numbered fix, with a test that fails without it: a landed lane whose branch stays while its worktree goes;
      a generated lane and the integration losing both; a worktree whose `.git` file points elsewhere kept without
      running git in it; an orphaned lane kept; a self-named `worktree` lane cleaned.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
