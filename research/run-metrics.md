# Headless run metrics, machine 1, 2026-10-09

## How these were measured

- Each row comes from the run's final `result` event: the `--output-format json` file, or the last `result` line
  of a `stream-json` log.
- Tool calls and failed tool results were counted from the stream, where there was one.
- Logs were parsed with `python3`. Do not use `echo "$line" | jq`: zsh's `echo` expands backslashes and corrupts
  the JSON.
- Snapshot taken at about 11:37 local time (Asia/Dubai). Runs still going at that point have no result.
- All times in the tables are UTC.

## project-a-bb (orchestrator 4b61acfe)

Launcher: `run.sh` — Opus 5.5, `--effort high`, `acceptEdits`, a bare `Bash` allow plus a denylist, no OS
sandbox. Workers commit locally.

| Worker | Role | Wall clock | API time | Turns | Tool calls (Bash) | Cost | End | Failed tool results |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| purge-B3 | implement (continued a stopped workflow agent's WIP) | 13.6 min | 8.1 min | 68 | 67 (52) | $4.42 | ok | 4: a file too large to read; test DB missing; zsh glob no-match; `sleep 200; cat …` blocked |
| wa-B | implement | 15.2 min | 10.6 min | 91 | 90 (56) | $6.23 | ok | 0 |
| wa-D | implement | 16.1 min | 8.8 min | 98 | 97 (63) | $4.82 | **usage limit** (`subtype` success, `is_error` true) | — |
| wa-D resume1 | `--resume` of the same session | 3.1 min | — | 15 | 14 (12) | $7.27* | ok | 0 |
| purge-B4, purge-B5, wa-C | implement | running | | | | | | |

\* The figure looks cumulative for the whole session (see [native-claude-code.md](native-claude-code.md)).

Earlier, at 05:42, the Workflow wave was stopped and the same jobs were restarted as headless runs. That wave
had run 4 workflow agents for 32 min, with 103–181 tool calls each (3–5 per minute), as bb reported.

## project-a-7e (orchestrator 0bc0d144)

Launchers: `launch.sh` and `launch-review.sh`.

- **Fence:** `--restricted`, dontAsk with `--permission-prompts none`, OS sandbox with loopback-only network,
  allowlisted wrapper scripts.
- **Budget:** `--max-budget-usd`.
- **Commits:** the worker does not commit.

| Run | Role | Model | Wall clock | Turns | Cost | End | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| baseline | preflight | haiku | 0.4 min | 8 | $0.01 | ok | found tsx IPC EPERM under the sandbox |
| baseline2 | preflight | haiku | 0.1 min | 2 | $0.01 | ok | found that serve.sh exited (the server did not stay up) |
| serveprobe | preflight | haiku | 0.1 min | 4 | <$0.01 | ok | confirmed the bug baseline (ERROR_SHELL=yes) |
| fix | implement | opus | running | — | — | — | after the first 64 tool calls, 10 had failed (see below); 105 calls by the time 7e replied |

The 10 failed calls in the `fix` run:

- 6 dontAsk denials: `serve.sh start; echo EXIT=$?`, `lsof`, `cat`, `ps | grep`, `ls && node -e …`, and a
  `cd … && for …` loop;
- 2 refusals by `--restricted` to Read the wrapper scripts, which were outside the worktree;
- 1 `pgrep` that failed inside the sandbox (no sysmond);
- 1 wrong path (`node_modules/next/...` at the monorepo root).

## project-b (orchestrator 550c5086)

Launchers: `launch-code.sh`, `launch-review.sh`, `launch-research.sh`, `launch-code-resume.sh`.

- **Fence:** acceptEdits, an allowlist plus a denylist, no OS sandbox.
- **Effort:** no `--effort`, so the workers presumably ran at the user default (xhigh).

| Run | Role | Start→finish (UTC) | Wall clock | Turns | Cost | Denials | End |
| --- | --- | --- | --- | --- | --- | --- | --- |
| p05-general_tech | research | 05:09→05:12 | 2.7 min | 46 | $0.68 | 0 | ok |
| p05-trade_press | research | 05:09→05:12 | 2.7 min | 48 | $0.60 | 0 | ok |
| p05-gaps | research | 05:19→05:22 | 2.8 min | 40 | $0.53 | 0 | ok |
| p07-construction_engineering | research | 05:09→05:15 | 6.2 min | 94 | $2.01 | 0 | ok |
| p07-hospitality_fnb | research | 05:09→05:15 | 5.7 min | 70 | $1.62 | 0 | ok |
| p07-logistics | research | 05:09→05:15 | 6.4 min | 71 | $1.65 | 0 | ok |
| p07-professional_services | research | 05:09→05:18 | 8.9 min | 54 | $1.05 | 0 | ok |
| p07-real_estate | research | 05:09→05:17 | 7.8 min | 77 | $1.82 | 0 | ok |
| p07-technology | research | 05:09→05:22 | 12.5 min | 99 | $2.36 | 0 | ok |
| p13 | implement | 05:16→05:22 | 6.1 min | 49 | $1.58 | 6 | ok |
| p14 | implement | 05:16→05:21 | 4.6 min | 38 | $1.74 | 4 | ok |
| review-p13-correctness | review | 05:24→05:25 | 0.3 min | 3 | $0.38 | 0 | ok |
| review-p13-regressions | review | 05:24→05:25 | 0.3 min | 4 | $0.39 | 0 | ok |
| review-p13-security | review | 05:24→05:25 | 0.3 min | 2 | $0.33 | 0 | ok |
| review-p14-correctness | review | 05:24→05:25 | 0.3 min | 4 | $0.47 | 0 | ok |
| review-p14-regressions | review | 05:24→05:25 | 0.4 min | 6 | $0.52 | 0 | ok |
| review-p14-security | review | 05:24→05:25 | 0.3 min | 4 | $0.43 | 0 | ok |
| vt | implement | 05:56→? | 3.3 min | 43 | $1.18 | 3 | **error** |
| vt2 | implement (resume) | 07:33→07:34 | 1.8 min | 8 | $2.01* | 1 | ok |
| **Total** | | | | | **$21.35** | | |

\* Probably cumulative over the resumed session.

## Workflow-era baselines (for comparison)

| Work | Tool | Agents | Wall clock | Notes | Source |
| --- | --- | --- | --- | --- | --- |
| project-a purge B1–B3 (2026-09-29/30) | Workflow | 38 for 3 of 7 phases | ~1.5 days | 390 + 177 min stalls on single commands; 3 session-limit kills | memory `project-a-workflow-stalls` |
| project-a translation (2026-10-07) | Workflow | 113 | 9.5 min after the fix | before the fix, each shell call waited ~20 min on a prompt | same |
| project-b P0.1 | Workflow | 33 | ~9.6 h | hit session limits | project-b's reply |
| project-a WA/purge wave 1 (2026-10-09) | Workflow | 4 | 32 min, then stopped | 3–5 tool calls/min at max effort | bb's reply |
