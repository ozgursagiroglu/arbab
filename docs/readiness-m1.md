# Readiness report — M1 (`integrate/m1` → `main`)

Date: 2026-10-09 · Branch: `integrate/m1` · Format: FR-21 (verified, skipped, risks). Landing means merging into the
local `main`; there is no remote and nothing is pushed.

## Verified

| Check | Result |
| --- | --- |
| `pnpm typecheck` on the integration branch | exit 0 |
| `pnpm test` | exit 0, 879 tests in 60 files; also two full suites run in parallel under load, both 879/879 |
| `pnpm build` | exit 0; `node dist/arbab.mjs --help` lists every command |
| End-to-end through the real bundle with a fake claude (`test/e2e`, 7 cases) | launch → shepherd → worktree → the exact argv of DESIGN.md §4 → scrubbed environment → checkpoint → wait/status; usage-limit auto-resume; stop; second launch refused; concurrent launches (one wins); lint refusal; a lane that fails before its first attempt is reported |
| Real claude, CLI 2.1.295, launched by arbab | preflight: 22/22 checks, after arbab held both probes until the quota reset; seven lanes (reviews, e2e, fixes) launched, supervised, waited on and summarised by arbab |
| `arbab doctor` on this machine | node, git, config, claude 2.1.295, sandbox, ignored roots, `~/.arbab`: all ok |
| Shared-`.git` write fix (review S4), measured through arbab | every write to the shared `.git` is EPERM: new files, loose refs, config, hooks, the worktree's git dir; worktree writes and git status/log/diff still work |
| Review findings | 30 from three lenses. All HIGH and MEDIUM findings are fixed with tests (the list below), except S5, which the OS-level `.git` deny covers |

Fixed (review id → fix):
- **Lifecycle:**
  - L1/C1: lost finish → per-run acks;
  - L2/S6: recycled pids → snapshot-checked signals;
  - L3: a live orphan worker → refused;
  - L4: limit then hang → classified by result;
  - L5/C4: stale quota → live updates;
  - L6/C3: launch and resume races → locks;
  - L7/C10: per-run attempt cap;
  - L8/C2: pin only for resumes;
  - L9: lane end state in `wait`;
  - L10: cost delta walks back.
- **Security:**
  - S1: hardened checkpoint git;
  - S2: dependencies only on new worktrees;
  - S3: `git grep` dropped;
  - S4: shared-`.git` deny;
  - S7: lint on every attempt;
  - S8: realpath for instruction and prompt files;
  - S9: three-way pool race;
  - S10: resume prompt via file.
- **Contracts:**
  - C5: preflight files under `.arbab/`;
  - C6: docs match the CLI;
  - C7: probe schema;
  - C8: brief tests use real profiles;
  - C9: one env policy, one git verb list, one pool, `readText`.

## Skipped (each needs your waiver, or a later step)

- **Skeptic lanes.** Two-lens agreement and deterministic probes replaced them. Five findings were found by two
  lenses; S4 and S1 were measured.
- **A review of the fix wave itself.** The fixes were checked through their reports, the gates and the probes, not
  by a second review round. Recommended before an open-source release, not before this local landing.
- **Real-claude runs not done yet:**
  - an auto-resume after a real usage limit (covered by the fake e2e and by bootstrap-era evidence);
  - `stop` and `cleanup` with real `ps` (workers' sandboxes refuse `ps`, so those paths ran with fakes);
  - Linux.
- **The plugin as installed by Claude Code** (`claude plugin install` from the marketplace manifest), and a fresh
  session following the skill.
- **The controlled Workflow-vs-headless comparison** (Q-bench). It needs an explicit opt-in to run Workflow.

## Risks

- **The per-user temp dir.** `/tmp/claude-<uid>` (every session's scratchpad) is writable from every worker's
  sandbox. arbab keeps nothing there, and the skill tells orchestrators not to either. The design still lists it as
  open.
- **Instruction files** are realpath-checked when the config loads, but read lexically when the brief is built
  (low: a symlink swapped in between).
- **`passEnv: ["PATH"]`** is accepted and replaces the scrubbed PATH (an explicit user choice; no warning yet).
- **Brief lint false positives** on descriptive inline code (a parameter name or a command named only to describe
  it) push brief authors to plain text. M2 should limit the denied-command check to commands the brief asks the
  worker to run.
- **Before an open-source release,** REQUIREMENTS.md and `research/` name client projects and session names; scrub
  them.
