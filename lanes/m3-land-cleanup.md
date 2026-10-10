# M3 · land cleans up after itself

## Task

Lane worktrees are kept after a lane finishes, on purpose: `resume` continues in the same worktree, verifier lanes
borrow a builder's worktree, and work that is not integrated must stay inspectable. They are removed only by
`arbab cleanup --worktrees`, which nobody remembers to run: arbab's own build left 51 worktrees (4 GB) and 48 merged
`arbab/*` branches behind. The owner decided that `land` cleans up what it landed. Implement it as below; each part
gets tests.

1. **One removal helper, shared by `land` and `cleanup --worktrees`** (`src/commands/cleanup.ts`). For each lane
   given:
   - kept, with the reason, when the lane is active (`isActive`), when an active lane borrows its worktree, when the
     worktree has uncommitted changes (`isDirty`), or when `arbab/<lane>` is not merged into the base;
   - otherwise `git worktree remove <path>` (never `--force`), then `git branch -d arbab/<lane>` (the safe delete,
     which refuses an unmerged branch). A lane with no worktree left but a merged branch only loses the branch.
   - Removals report `removed worktree <path>` and `deleted branch <branch>`; anything git refuses is kept with git's
     message. Run these git commands with `noHooks()` from `src/run`, like every git call in a tree that holds worker
     code.
2. **`land` cleans up after a successful landing** (`src/commands/land.ts`), after `landing.json` is written:
   - the integration's merged lanes (`record.merged`), the lanes generated for it (run dirs whose `generated.json`
     names this integration: `readGenerated`, `ownerTag` in `src/commands/generated.ts`), and then the integration
     worktree with `integrate/<name>`, through the same rules;
   - `--keep-worktrees` skips all of it;
   - cleanup problems never fail the landing: they are printed (text) or listed under `cleanup` (`--json`), and the
     command still exits 0;
   - run directories and `.arbab/integrations/<name>/` are never removed: they are the measurements and the record.
3. **`cleanup --worktrees` uses the helper** for every finished lane, as today, and also:
   - deletes each removed lane's merged branch;
   - removes the worktree and branch of every landed integration (`landing.json` present and `integrate/<name>` merged
     into the base);
   - reports a lane whose run dir has no `state.json` as kept (`no run state`) instead of skipping it silently.
4. **Help text** (`src/commands/index.ts`): `land <name> [--keep-worktrees] [--json]`, and the cleanup line mentions
   branches.

## Scope

You own `src/commands/cleanup.ts`, `src/commands/land.ts`, `src/commands/generated.ts`, the help text in
`src/commands/index.ts`, and `test/e2e/**`, with their tests. Change nothing else.

## Facts

- `removeMergedWorktrees` (`src/commands/cleanup.ts:111-162`) holds today's rules; reuse them, do not copy them.
- `land` refuses unless the main checkout is on the integration's base and clean, so after the landing merge `HEAD` is
  the base and `git branch -d` checks against it.
- A branch checked out in a worktree cannot be deleted: remove the worktree first.
- The integration worktree holds ignored files only (`node_modules`, `dist`); `git worktree remove` deletes those
  without `--force`.

## Acceptance

- [ ] Tests for: a landing that removes its lanes' and generated lanes' worktrees and branches and the integration
      worktree and branch; a dirty lane worktree kept with its reason; an active borrower keeping its owner's worktree;
      `--keep-worktrees`; a git refusal that leaves the landing at exit 0; `cleanup --worktrees` deleting branches,
      removing a landed integration, and reporting a lane without run state.
- [ ] The e2e landing test covers the cleanup after `land`.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
