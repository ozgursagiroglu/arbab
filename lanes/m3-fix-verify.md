# M3 fixes, round 3 · a verify lane that cannot change what it verifies

## Task

The third `arbab review m3` found these defects. Fix each one; each fix gets a test that fails without it.

1. **The verify lane cannot write (security-2, confirmed).** The generated verify lane is a probe, and the probe role
   has the Write tool. A test's output can steer the low-effort model into editing a file and running the gate again;
   `gateResults` keeps the last call, nothing is committed (`checkpoint: false`), and verify records `passed` for a
   tree that differs from the head. Fix all three parts:
   - **`LaneSpec.tools`** (added to `src/types.ts` by the orchestrator) narrows the role's tools and never widens
     them. Validate it in `src/config/lane.ts` (a non-empty array of tool names, each once) and apply it in
     `effectiveRole` (`src/shepherd/lifecycle.ts`): the effective tools are the role's tools that the lane lists, in
     the role's order. The profile then leaves the others out of `--tools`, so they do not exist for the worker.
   - `verifyLaneSpec` sets `tools: ["Read", "Bash"]`.
   - **The first call decides:** in `gateResults`, the first Bash call with an expected command line gives that
     command's result; later calls with the same line are ignored.
   - **A clean tree after the run:** after the lane finishes, `arbab verify` checks the verify worktree with
     `isDirty` through the verified git dir (`verifyWorktreeGit` on `arbab/<lane>`, then `isDirty(path, git, gitDir)`).
     Changes, or a worktree that fails verification, make the record `passed: false` with a reason naming them.
2. **Verify always records (contracts-6).** When the lane ran on a commit other than the integration head, write
   `verify.json` with `passed: false` and the reason, and exit 1, as the command's header documents, instead of
   throwing (exit 2) with no record. Add an optional `reason?: string` to the record only through `src/verify` types
   if `VerifyRecord` needs it; if it must change `src/types.ts`, say so in `open_questions` and use the results list
   instead.
3. **A borrowed generated worktree is never reset (security-3).** `resetGeneratedWorktree`
   (`src/commands/integration.ts`) refuses, removing nothing, while an active lane's run `lane.json` names the
   generated lane as its `worktree`. `arbab launch` refuses a lane whose `worktree` names a lane that carries a
   generated marker, with the same message shape as for a generated name.
4. **The installed runner knows its version (contracts-3).** `plugin/` has no `package.json`, so the bundle's
   `--version` prints 0.0.0. `scripts/build.mjs` defines the version at bundle time (esbuild `define`, from
   `package.json`), and `src/cli.ts` uses it when defined, falling back to reading `package.json` when run from source
   (tests).

## Scope

You own `src/verify/**`, `src/commands/verify.ts`, `src/commands/integration.ts`, `src/commands/launch.ts`,
`src/config/lane.ts`, `effectiveRole` in `src/shepherd/lifecycle.ts`, `src/cli.ts` and `scripts/build.mjs`, with
their tests. Change nothing else.

## Facts

- The review's evidence: `src/verify/index.ts:76` (role probe), `:100-119` (`gateResults`), `:82` (`checkpoint:
  false`); `src/commands/verify.ts:76-79` (`ran !== head` throws); `src/config/roles.ts:61` (probe tools: Read, Write,
  Bash); `src/commands/integration.ts:181` (reset); `src/cli.ts:8` (`readVersion`).
- `--tools` restricts which tools exist; allow rules only approve (DESIGN.md §4).
- The verify lane's Bash may run only the exact gate commands (its `allow` rules), so without Write it cannot change
  tracked files except through what a gate itself writes; build outputs are ignored files.

## Acceptance

- [ ] Each numbered fix, with a test that fails without it: a lane with `tools` compiled without Write; an invalid
      `tools` refused; a rerun gate that does not override the first result; a dirty verify worktree failing verify; a
      lane on another commit recorded as failed with exit 1; a borrowed generated worktree not reset; launch refusing
      a borrow of a generated lane; the bundle's version.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
