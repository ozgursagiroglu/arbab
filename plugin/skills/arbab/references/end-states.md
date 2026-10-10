# End states

The shepherd writes one end state per attempt into `.arbab/runs/<lane>/attempt-<n>/summary.json`. It is computed
from every event of `stream.jsonl` plus `exit.json`, checked in the order below; the first match wins. It never
comes from the result's `subtype` alone, and never from the exit code (a usage-limit stop reports
`subtype: "success"` with `is_error: true` and exit code 1).

| Order | End state | Classified when | What it means | What to do |
| --- | --- | --- | --- | --- |
| 1 | `killed:wall` | `exit.json` `killedBy: wall` | ran past `wallMin` | Read the last events. Too big a task: split it; a stuck command: name the `timeout` in the brief. Relaunch fresh from the checkpoint or resume with a narrowing prompt. |
| 1 | `killed:idle` | `killedBy: idle` | no stream growth for `idleMin` | Usually a foreground command that never returns (a server, a watcher). Fix the brief, then resume or relaunch. |
| 1 | `killed:hang-after-result` | `killedBy: hang-after-result` | 15 min without events after a `result` | The work ended; something kept the process alive. Read `report.json` as for `success`; check the reaped pids in `exit.json`. |
| 1 | `killed:hang-after-error` | `killedBy: hang-after-error` | 2 min without events after an error result | Treat as the error it followed: read `stderr.log` and the last result. |
| 1 | `killed:stopped` | `killedBy: stopped` | your own `arbab stop` | Nothing new; it does not auto-resume. Resume or relaunch when you have the correction. |
| 2 | `no-result` | no `result` event, worker gone | crashed or exited before a result | Read `stderr.log` and `exit.json`. Treat as `failed`. |
| 2 | `running` | no `result` yet, worker alive | still working | Wait. |
| 3 | `usage-limit` | `is_error` with `api_error_status` 429 | the account hit its limit | Nothing. The shepherd waits for `resetsAt` plus jitter, re-checks quota and resumes the same session, up to `maxAttempts`. Check `arbab quota` before launching more. |
| 4 | `unsupported-cli` | 400 with "does not support this model" or "or newer is required" | the claude binary is too old for the model | Run `arbab doctor`. Upgrade or pin the binary, or change the model; relaunch. Do not resume. |
| 5 | `budget` | subtype `error_max_budget_usd` | spent `budgetUsd` for this attempt | The brief was too open or the task too big. Check the report and checkpoint, decide more, split, then resume or relaunch. Raise the budget only with a reason. |
| 6 | `max-turns` | subtype `error_max_turns` | hit the CLI's turn cap | As for `budget`. |
| 7 | `invalid-report` | `error_max_structured_output_retries`, or a schema was required and `structured_output` is missing or fails validation | the work may be done; the report is not usable | Check the diff and `reportErrors` in `summary.json`. Resume with a prompt asking only for the report. |
| 8 | `failed` | any other error result | the worker gave up or errored | Read the report (if any), `stderr.log` and the last events of the stream (only those). Then `arbab resume <lane> --prompt <file>` with a correction for a short, recent stop; `arbab resume <lane> --digest` (a fresh session seeded with a digest of the latest attempt) for a long attempt stopped long ago or a session that went wrong; or a fresh relaunch with a corrected brief for a long or wrongly briefed one: launching the same lane file again starts a fresh session in the same worktree, from its checkpoint commits. Use a new lane name (`base: "arbab/<lane>"`) only when the scope changes. |
| 9 | `success` | a result without error | the worker finished | Read `report.json`: `status`, `checks` (each exit code), `open_questions`, `not_verified`. `partial` or `blocked` is still your decision. |

Lane states that are not end states:

| State | Meaning | What to do |
| --- | --- | --- |
| `queued`, `preparing` | waiting to start; creating worktree, dependencies, leases | Wait. |
| `held` | no free slot, or quota above the hold threshold; re-checks every minute and after a reset | Wait; see `arbab quota`. Do not raise the thresholds to push it through. |
| `waiting-reset` | usage limit; sleeping until `resetsAt` | Wait. |
| `orphaned` | the shepherd died before `finished` | `arbab cleanup`, then decide as for `failed`. |

Where to look, cheapest first: `summary.json` (state, metrics, failures by cause, cost Δ), `report.json`,
`exit.json`, `stderr.log`, then the tail of `stream.jsonl`. Never read whole streams into your context.

A resume keeps the session's context but re-pays it when the cache is cold. For long or old stops, or a session
that went wrong, prefer `arbab resume <lane> --digest`: a fresh session in the same worktree whose brief gains a
`## Head start` digest of the latest attempt. Relaunch with a corrected brief instead when the brief was wrong.
