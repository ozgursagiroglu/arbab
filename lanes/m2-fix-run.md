# M2 fixes · merges, digests and plan progress

## Task

The M2 review found these defects. Fix each one; each fix gets a test that fails without it.

1. **Upstream code runs on the host through the dependency install (R1, HIGH).** `prepare()` merges a dependency
   phase's branch, which a worker wrote, and then runs `dependencies.command` unsandboxed. A worker-written
   `package.json` script, `.npmrc` or `.pnpmfile.cjs` therefore runs on the host. Fix:
   - run the dependency command **before** merging, on the trusted base;
   - before merging each branch, list the files it changes relative to the worktree's HEAD (the shared git dir and
     the work tree passed explicitly, as merge.ts already does). If any is a dependency manifest, fail setup:
     `package.json`, `package-lock.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `yarn.lock`, `bun.lock`,
     `bun.lockb`, `.npmrc`, `.yarnrc`, `.yarnrc.yml`, `.pnpmfile.cjs` or `.pnpmfile.mjs`, at any depth;
   - the setup-failure reason names the branch and the files, and says the orchestrator must review and land that
     dependency change before dependent phases run.
2. **The pristine check (R2).**
   - When any attempt starts in a worktree, whether the owner's or a borrower's, create a marker file
     `<runsRoot>/<owner>/worktree-used` (exclusive create; exists = used).
   - `prepare()` decides pristine after the writer lock is held: the worktree was created now, or the marker does
     not exist.
3. **Merge the resolved sha (R8).** Resolve each branch to its sha once, merge that sha, and record the same sha.
   The merge message keeps the branch name.
4. **The merge-failure message (R10).** After an abort, say the merge was aborted and nothing is left to resolve.
   Then give the recovery: fix the branches (or land the dependency) and relaunch the phase, which merges again
   while no worker has run in the worktree.
5. **Digest bodies are records (R4).** In `renderDigest`, put every item body inside a fenced block whose backtick
   fence is one longer than the longest backtick run in the body (at least three), with info string `text`. Then
   no stream content can open a heading, close a fence or start a brief section. `headStart` keeps its framing
   paragraph, and the digest stays inside the cap.
6. **Plan progress.**
   - **R3:** a dependency counts as succeeded only when its lane finished `success` and its latest attempt has a
     checkpoint commit (`exit.json` `checkpoint` not null) or recorded no changes (`checkpoint` null and
     `checkpointError` null). A `checkpointError` makes it `failed` upstream, with the error in the output.
     `checkPlan` errors (`dependency-without-checkpoint`) when a phase that others depend on sets
     `checkpoint: false`, or uses a role whose default is no checkpoint and does not set it.
   - **R9:** an `orphaned` dependency is `failed` upstream (end state `orphaned`), not blocked.
   - `src/commands/plan.ts` reads what `nextPhases` now needs from the latest attempt's `exit.json`.
7. **Overlap check (R7).** In `checkPlan`, a segment containing `{`, `}` or an extglob opener (`@(`, `!(`, `+(`,
   `*(`, `?(`) ends the fixed path. Compare fixed paths case-insensitively.

## Scope

You own `src/shepherd/**`, `src/digest/**`, `src/plan/**`, `src/commands/plan.ts` with its test, and
`test/e2e/**`. Change nothing else.

## Facts

- The M2 review read every file in scope; its findings name lines in `lifecycle.ts` (prepare), `merge.ts`,
  `digest/index.ts`, `plan/progress.ts` and `plan/graph.ts`.
- `pnpm install --offline` still runs the root package's lifecycle scripts and loads `.pnpmfile.cjs` unless told
  otherwise. arbab cannot assume a project's dependency command ignores scripts.
- The shepherd's own git calls use `explicitGit` after `verifyWorktreeGit` (`src/run/git.ts`); reuse them.

## Acceptance

- [ ] Each numbered fix, with a test that fails without it.
- [ ] The e2e plan test still passes, plus a new e2e case: phase A changes `package.json` and B depends on A, so B
      fails setup naming `package.json`, and the fake claude never runs for B.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
