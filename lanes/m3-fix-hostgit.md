# M3 fixes, round 4 · host-side git never enters a worker's nested repository

## Task

The fourth `arbab review m3` confirmed a HIGH fence escape, and the orchestrator measured it on git 2.54 (below).
Fix it and the MEDIUM finding next to it; each fix gets a test that fails without it.

1. **Nested repositories (security-2, HIGH, confirmed).** A worker can create `sub/` holding its own git repository
   inside its worktree. The checkpoint's `git add -A` stages it as a gitlink (mode 160000). From then on, every
   host-side git command that refreshes or diffs the work tree spawns a child git *inside* `sub/`, which reads
   `sub/.git/config`, a worker-written file, and runs its `core.fsmonitor` command or a clean filter
   (`.gitattributes` + `filter.<x>.clean`) on the host, outside the fence. Fix:
   - **One helper for every git command arbab runs on the host in a tree that holds worker code** (checkpoint,
     dependency merges, integration merges, dirty checks, the verify clean check, cleanup, the landing merge):
     `noHooks()` in `src/run/git.ts` becomes that helper (rename it to say what it does, e.g. `untrustedTree()`, and
     update every caller): `-c core.hooksPath=/dev/null -c core.fsmonitor=false -c diff.ignoreSubmodules=all
     -c submodule.recurse=false`.
   - **Status never descends:** `isDirty` and every other `git status` in such a tree pass
     `--ignore-submodules=all`. Give `src/run/git.ts` one function that returns a worktree's porcelain status through
     a verified git dir with these flags (`worktreeStatus`), and make `isDirty`, `refuseDirtyLanes`
     (`src/integrate/integrate.ts`), verify's clean check (`src/commands/verify.ts`) and cleanup
     (`src/commands/cleanup.ts`) use it.
   - **The checkpoint never stages a nested repository.** Before `git add`, list tracked gitlinks
     (`git ls-files -s`, mode 160000: reads the index only) and untracked nested repositories (`git ls-files --others
     --exclude-standard --directory -z`, then a `.git` file or directory inside an entry). Stage everything else with
     `git add -A -- . ':(exclude,literal)<path>'…`. When it left something out, it still commits the rest and returns
     an error text naming the paths (`nested repositories were not committed: …; arbab never commits or inspects
     them`), so `exit.json` carries it and a plan treats the phase as needing attention.
2. **A missing worktree is not re-created on worker commits (security-1, confirmed).** `createWorktree` prunes a
   stale worktree entry and, when `arbab/<lane>` already exists, checks that branch out and reports `created: true`;
   the shepherd then installs dependencies on the host in a tree full of worker commits. When the branch exists and
   is not contained in the base, refuse, as `src/integrate` does for its own branch: say that the worktree is missing,
   that its branch holds worker commits, and that arbab installs only on a trusted base (restore the worktree or delete
   the branch). A branch contained in the base may be re-created as today.

## Scope

You own `src/run/**`, `src/integrate/integrate.ts` (only `refuseDirtyLanes` and the helper's call sites),
`src/commands/verify.ts`, `src/commands/cleanup.ts`, `src/commands/land.ts`, `src/shepherd/merge.ts` and
`src/shepherd/lifecycle.ts` (only where `createWorktree`'s refusal surfaces), with their tests. Change nothing else.

## Facts

- The review's evidence: `src/run/git.ts:178-185` (`noHooks`, `isDirty`), `:105-127` (`createWorktree`: prune, then
  `worktree add <path> <branch>`), `src/run/checkpoint.ts:43` (`add -A`), `src/integrate/integrate.ts:274`,
  `src/commands/verify.ts:130-134`, `src/commands/cleanup.ts:161,199`.
- Tests build real repositories in temporary directories: plant a nested repository whose `core.fsmonitor` and clean
  filter append to a marker file, and show the marker stays empty through each fixed call site; show that the
  unprotected command writes it (so the test proves the hazard is real on the machine running it).

- Measured by the orchestrator on git 2.54:


| Host command in a worktree whose `sub/` is a worker repository | fsmonitor / clean filter in `sub/` ran |
| --- | --- |
| `status --porcelain` (explicit git dir) | yes, both |
| `-c core.fsmonitor=false status --porcelain` | filter yes |
| `status --porcelain --ignore-submodules=all` (+ the `-c` options above) | no |
| `add -A` (even with `-c core.fsmonitor=false -c diff.ignoreSubmodules=all`) | filter yes |
| `add -A -- . ':(exclude)sub'` | no |
| `ls-files -s`, `ls-files --others --exclude-standard --directory`, `diff --cached --raw` | no |
| `commit`, `diff <commit> <commit>`, `merge` (no populated nested repo), `worktree remove` (refuses submodules) | no |

An *untracked* nested repository is harmless to status and `ls-files`; it becomes dangerous once it is staged.

## Acceptance

- [ ] Each part, with a test that fails without it.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
