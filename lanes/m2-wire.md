# M2 · wiring plans and digests into the shepherd and the CLI

## Task

`src/plan` and `src/digest` are merged on this branch. Wire them in (DESIGN.md §16).

1. **Shepherd: merge upstream branches.** When the lane spec has `mergeBranches` and the shepherd has just created
   the worktree (never on a reused one), merge each branch in order before dependencies are installed. Use the
   explicit git dir and work tree (as checkpoint does), with this argv:

   ```text
   git merge --no-ff --no-edit -m "arbab: merge <branch> for <lane>" <branch>
   ```

   - A missing branch or a conflict is a setup failure: abort the merge (`git merge --abort`); the reason names the
     branch and, for a conflict, the conflicting paths.
   - Record the merged branches and their head SHAs in the attempt's `started.json` as `merged: [{branch, sha}]`.
2. **Shepherd: digest head start.** For mode `{kind: "fresh", digestFrom: n}`:
   - read attempt n's stream with `parseStream`;
   - `renderDigest` it;
   - insert `headStart(digest, n)` into the assembled prompt after the brief's sections, before the tool belt.

   A missing or empty stream is a setup failure with a clear reason.
3. **CLI, in `src/commands/plan.ts`** (one file, sub-commands):
   - `arbab plan check <plan.json> [--json]`:
     - `loadPlan`, `checkPlan`, `planWaves`;
     - compile each phase and lint it as `lint` does (with `gitCommonDir`);
     - print the issues and the waves. Exit 1 on any error.
   - `arbab plan next <plan.json> [--json]`:
     - check the plan (refuse on errors);
     - read each phase lane's state (`readState` / `effectiveState`);
     - `nextPhases`; write each launchable phase's compiled lane spec to `.arbab/plans/<plan>/<phase>.json` and
       launch it through the same path as `arbab launch` (lint, launch lock, shepherd);
     - print what was launched, what is blocked and on what, and what failed upstream.

     Running it twice in a row launches nothing the second time.
   - `arbab plan status <plan.json> [--json]`: `planStatus` as a table, with the wave column.
   - Add `plan` to the dispatcher and to `--help`.
4. **CLI: `arbab resume <lane> --digest`.** A fresh session seeded with the latest attempt's digest:
   `spawnShepherd(root, lane, {kind: "fresh", digestFrom: <latest attempt>})`. It refuses `--prompt` together with
   `--digest`, and refuses a lane with no attempt. The same orphan and lock checks apply as for resume.
5. **End-to-end tests** in `test/e2e/`, through the bundle with the fake claude:
   - a two-phase plan where B depends on A. `plan next` launches A only; after A succeeds, `plan next` launches B;
     B's worktree contains A's checkpoint commit (merged) and B's brief contains A's report summary;
   - `plan next` while A runs launches nothing;
   - a conflicting merge (A and B both write the same file through the fake's `touch`, with B also depending on a
     phase C that touched it differently) fails B's setup with the conflicting path in `wait`'s reason;
   - `resume --digest`: the fake's log shows a new session id, and the brief (attempt dir `brief.md`) has a
     `## Head start` section.

## Scope

You own `src/shepherd/**`, `src/commands/**`, `src/cli.ts` and `test/e2e/**`, and `src/run/git.ts` if you need a
merge helper there. Change nothing else; report gaps in `src/plan` or `src/digest`.

## Facts

- Merged on this branch:
  - `src/plan`: `loadPlan`, `checkPlan`, `planWaves`, `compilePhase`, `nextPhases`, `planStatus`;
  - `src/digest`: `renderDigest`, `headStart`;
  - `ShepherdMode` `{kind: "fresh", digestFrom?: number}`.
- The checkpoint already runs git with `--git-dir`/`--work-tree` from `src/run/git.ts` (`explicitGit`) after
  `verifyWorktreeGit`. Reuse them for the merge.
- Worker environments are scrubbed: e2e tests pass `FAKE_CLAUDE_*` through the test config's `passEnv`.

## Acceptance

- [ ] Each numbered item, with tests: unit tests for the shepherd and command changes, and the e2e cases above.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
