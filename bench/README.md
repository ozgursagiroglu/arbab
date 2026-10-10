# arbab's own build — benchmark notes

arbab was built with its own method on 2026-10-09: an interactive Claude Code session as the orchestrator, headless
`claude -p` workers in fenced worktrees. Waves 0–2 ran through a hand-written bootstrap launcher
([bootstrap/](bootstrap/)); from wave 3 on, arbab launched, held, supervised and measured its own workers. Every run
is in [RUNS.md](RUNS.md) and [runs.jsonl](runs.jsonl) (regenerate with `node bench/ledger.mjs`).

## What was built

M1 of [DESIGN.md](../DESIGN.md): requirements, design, nine runner modules, the CLI, the shepherd, the skill, the
plugin manifests, three review lenses and three fix lanes. The result has 879 tests in 60 files, typecheck and build
green, end-to-end tests through the real bundle, and real-claude preflights and probes run by arbab itself.

## Numbers (measured)

| Wave | What | Attempts | Longest lane | Tool calls | Refused by the fence | Notional cost |
| --- | --- | --- | --- | --- | --- | --- |
| w0 | analysis: 6 probes, 2 web researchers | 9 | 3.4 min | 100 | 11.0% (the probes tried refused commands on purpose) | $3.30 |
| w1 | six core modules in parallel | 7 | 8.4 min | 276 | 1.4% | $9.86 |
| w2 | shepherd, CLI, skill | 3 | 19.6 min | 262 | 0.8% | $11.40 |
| w3+ | e2e, three reviews, three fix lanes, probes, preflight (launched by arbab) | 12 | 20.8 min | 650 | 1.7% | $23.77 |
| **all** | | **32** | | **1,293** | **2.2%** | **$48.33** |

- Wall clock: the analysis wave started at 09:30Z and the fixes were integrated at 13:30Z. That includes a deliberate
  85-minute quota hold (11:05–12:30Z) and the orchestrator's integration work between waves.
- Every wave-1 lane finished in 4.9–8.4 min. Medium-effort lanes (5.3–5.9 min, $1.42–1.57) and high-effort lanes
  (4.9–8.4 min, $1.37–2.22) were not clearly different on tasks of this size. The tasks differ, so this is not a
  controlled comparison.
- No lane hit the usage limit. One five-hour window went from 60% to 97%, shared with the owner's other sessions;
  arbab's own quota hold then held its first preflight until the reset.
- Fence refusals in implementation waves were 0.8–1.7% of calls. Two other machines measured 5.8–15% for hand-made
  fences.

## What the method caught

- **Reviews with a depth floor** (every file in scope read in full, evidence per finding, a coverage section)
  produced 30 findings from three lenses. Machine 1's six shallow lenses had found one. Five defects were found
  independently by two lenses.
- **Deterministic probes beat argument.** Two security findings were settled by measurement instead of a skeptic
  pass. The measurement found that a worktree worker's sandbox can write the shared `.git` (new loose refs
  included), that `.git/config`, `.git/hooks` and the worktree's `.git` pointer are protected, and that
  `sandbox.filesystem.denyWrite` closes the gap without breaking git reads. The fix was then re-measured through
  arbab itself.
- **arbab's lint caught the orchestrator's own brief mistakes.**
  - It caught a reviewer asked to run a command its fence denies, compound commands in inline code, and
    coordination text placed in the wrong section.
  - It also gave false positives on descriptive code spans, e.g. a parameter name in backticks. That is an open
    item for M2.
- **Integration caught what lanes could not.** A test written by one lane met a warning added by another. One
  timing-dependent test failed only under full-suite load; the cause was a race in the test's own pid lookup.
  Lane-level green was not repo-level green, as on machine 2.

## Confounds and limits

- One orchestrator (this session), one machine (macOS, CLI 2.1.295), one project, one day.
- No Workflow-tool baseline was run for this build. The controlled comparison (REQUIREMENTS Q-bench) is still open.
- Costs are Claude Code's client-side, API-equivalent estimates; the account is on a subscription.
- The orchestrator's own token use is not in these numbers.
