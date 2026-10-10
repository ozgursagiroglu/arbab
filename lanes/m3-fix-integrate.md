# M3 fixes, round 2 · what integrate records, what land merges

## Task

The second `arbab review m3` confirmed these defects in `integrate` and `land`. Fix each one; each fix gets a test that
fails without it.

1. **Manifests from every commit, not only arbab's merges (security-3, MEDIUM, confirmed).** `integrate` adopts the
   worktree's current HEAD, which can hold commits it did not merge: a conflict resolved by hand in the integration
   worktree, or a merge whose record was lost (the process died between the merge and the record, or the records
   directory was deleted). Their manifest changes never reach the record. Fix:
   - `record.manifests` (already in the contract, `src/types.ts`) is every path that differs between `baseSha` and the
     head and that `isDependencyManifest` matches: `git diff --name-only -z --no-renames --no-ext-diff <baseSha>
     <head> --`, sorted. It replaces today's union of the merged entries.
   - `depsConfirmedAt` stays only while it is an ancestor of the head and no manifest differs between it and the head
     (the same diff); otherwise it becomes null.
   - `depsConfirmed` stays derived: `manifests` is empty or `depsConfirmedAt` is set.
   - Per-lane `manifests` stay as today (what that lane's merge changed): they say which lane to look at.
2. **No lane is dropped silently (correctness-2, MEDIUM, confirmed).** A lane whose commit is already in the head is
   skipped with `continue` today: it gets no entry, no output, and readiness never lists its reports.
   - Before merging anything, refuse a lane whose worktree (`<worktreeRoot>/<lane>`, when it exists) has uncommitted
     changes: its checkpoint did not commit them, and integrating would leave that work behind. Name the lane and up
     to five paths. Run `git status --porcelain` with the worktree's verified git dir and work tree named explicitly
     (`verifyWorktreeGit`, `explicitGit`), as `src/shepherd/merge.ts` does.
   - A lane already in the head gets an entry like a merged one (its `manifests` are the files its own commits
     changed: `git diff --name-only <baseSha>...<sha>`), and the command prints `<lane>: already in <branch>`.
3. **One entry per lane (correctness-4).** Re-integrating a lane that moved on updates its entry (`sha`, and its
   manifests joined with the new merge's) instead of appending a second one.
4. **`--deps-installed` confirms the head that was listed (security-4).** `confirmDeps` refuses unless
   `integrate/<name>` is still at the recorded `headSha` (the head whose manifests the human was shown); it then sets
   `depsConfirmedAt` to that head. When `manifests` is empty there is nothing to confirm: say so and change nothing.
5. **A borrowing lane blocks its owner's integration (contracts-2, MEDIUM, confirmed).** A lane with
   `worktree: <owner>` commits onto `arbab/<owner>`. `arbab integrate` (with `--lanes` or `--plan`) refuses while any
   lane whose `lane.json` in the runs root names a lane being integrated as its `worktree` is still active (the same
   test `assertInactive` uses). The message names both lanes.
6. **`land` lands only the verified tree (correctness-1, confirmed).** Refuse unless the base checkout's HEAD is an
   ancestor of the verified head (`git merge-base --is-ancestor HEAD <head>`): only then does the merge commit hold
   exactly the tree that was verified. The message says the base moved, and to merge `<base>` into the integration,
   then integrate, verify, review and readiness again. The land merge uses `noHooks()` from `src/run` instead of its
   inline `-c core.hooksPath=/dev/null`.

## Scope

You own `src/integrate/**`, `src/commands/integrate.ts` and `src/commands/land.ts`, with their tests. Change nothing
else. If the e2e landing test (`test/e2e/landing.test.ts`, owned by another lane) needs a change because of your work,
say so in `open_questions`.

## Facts

- The review's evidence: `src/integrate/integrate.ts:232` (`let headSha = head();`), `:249` (`depsConfirmed`), `:262`
  (`if (isAncestor(...)) continue;`), `:286` (`merged.push`), `:335` (`confirmDeps`); `src/commands/integrate.ts:99-101`
  (`integrationLanes`, `assertInactive`); `src/commands/land.ts:107-112`.
- `IntegrationRecord.manifests`, `depsConfirmedAt` and `IntegrationPaths.lanesDir` were added by the orchestrator in
  the commit your branch starts from; `readIntegration` already reads older records.
- `isDependencyManifest` comes from `src/shepherd` (`src/integrate/integrate.ts` imports it today).
- Every git command arbab runs in a tree that holds worker code runs with hooks disabled (`noHooks()`).

## Acceptance

- [ ] Each numbered fix, with a test that fails without it: a hand commit that changes `package.json` in the
      integration worktree, a lost record, an already-contained lane, a dirty lane worktree, a re-integrated lane, a
      moved branch at `--deps-installed`, an active borrowing lane, a moved base at `land`.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
