# Readiness report — M2 (`integrate/m2` → `main`)

Date: 2026-10-09 · Branch: `integrate/m2` · Format: FR-21 (verified, skipped, risks). Landing means merging into the
local `main`; there is no remote and nothing is pushed.

M2 adds plans with a dependency graph (FR-9), digest-seeded fresh sessions (FR-19), and brief lint that checks only
command spans. It was built by arbab itself: 11 runs, 416 tool calls, 0.5% refused by the fence, $15.16 notional,
longest lane 12.2 min.

## Verified

| Check | Result |
| --- | --- |
| `pnpm typecheck` / `pnpm test` / `pnpm build` on `integrate/m2` | 0 / 0 (1,114 tests in 69 files) / 0 |
| End-to-end plans through the bundle with the fake claude (`test/e2e/plan.test.ts`) | `plan next` launches A only; nothing while A runs; B after A succeeds, with A's commit merged and A's report in B's brief; a conflicting merge fails B's setup with the path; `resume --digest` starts a new session with a `## Head start`; an upstream that changed `package.json` makes B fail setup, naming the file, with no worker run |
| A real two-phase plan with real claude, twice (before and after the fixes) | `plan check` ok; `plan next` launched A, then nothing while A ran, then B; B's worktree had A's checkpoint merged (by sha); B read A's file; `plan status` shows both finished `success` |
| M2 review (one lens, depth floor, 28 files read) | 10 findings, 1 HIGH; all fixed with tests |
| The HIGH fix (R1) has a test that fails without it | checked by disabling the manifest check: the e2e test fails (B ran), and passes again with it |

Fixed (M2 review id → fix):
- **R1** (HIGH): the dependency install runs on the trusted base before any merge, and a merge that changes a
  dependency manifest is refused. Before this, an upstream worker's `package.json` scripts would have run on the
  host.
- **R2:** a worktree counts as pristine only until any attempt (owner or borrower) has started in it, checked under
  the writer lock.
- **R3:** `plan next` requires the dependency's work to be on its branch, and `checkPlan` refuses a depended-on
  phase without checkpoints.
- **R4:** digest items are fenced, so stream content cannot open brief sections.
- **R5, R6:** shell fences (any case), `env`/`NAME=value`/path prefixes, `bash -c`, and spans introduced across
  lines or lists are all linted.
- **R7:** brace and extglob scopes count as overlapping, and scopes are compared case-insensitively.
- **R8:** merges use the sha resolved once.
- **R9:** an orphaned dependency is a failed upstream.
- **R10:** the merge-failure message gives the right recovery.

## Skipped (each needs your waiver, or a later step)

- **A second review round** over the M2 fix wave itself (the fixes were checked by their tests, the gates, the R1
  revert check and the real plan rerun).
- **Real package managers** in the merge/install path. Tests use node scripts as the dependency command; the real
  `pnpm install --offline` ran only as arbab's own dependency step.
- **Criss-cross merge histories** (more than one merge base), and case-sensitive file systems (tested on macOS
  only).

## Risks

- `checkPlan` cannot see `config.roles` overrides of `checkpoint`. A project that turns implementer checkpoints off
  in config would pass the check, and a dependency would count as "no changes".
- Lint does not strip `env` options (`env -i git push`) or a `$ ` prompt in console fences.
- Refusing manifest-changing merges is strict on purpose. A plan whose early phase adds a dependency stops at the
  next phase until the orchestrator lands that change. The skill should say so (M3 skill pass).
- The weekly quota window is at 82% (hold at 85%), so M3 will likely wait for the weekly reset on Oct 15.
