## Know what your workers are doing

`arbab status` prints one row per lane: its state, attempt, time, work, effort, failures, cost and the quota it saw.
This is part of the `ui2` build of arbab's own page:

```text
lane                 state               attempt  elapsed  turns  calls  last tool  effort  failed  cost    quota
ui2-font             finished (success)  1        7m40s    18     28     Bash       high    1       $1.27   5h 34% · 7d 62%
ui2-art              finished (success)  1        45m37s   115    248    Bash       high    12      $15.46  5h 65% · 7d 67%
ui2-wire             finished (success)  1        24m59s   124    262    Bash       high    11      $10.30  5h 82% · 7d 70%
ui2-fix              finished (success)  1        8m21s    45     88     Bash       high    3       $2.94   5h 91% · 7d 72%
ui2-review-security  finished (success)  2        2m33s    23     39     Grep       high    1       $1.77   5h 92% · 7d 73%
ui2-verify           finished (success)  2        1m34s    4      3      Bash       low     0       $0.00   5h 92% · 7d 72%
quota: 5h 93% (resets 11:20Z) · 7d 73% (resets Oct 21 10:00Z)
```

- **turns**: the model's turns, counted as distinct assistant messages.
- **calls** and **last tool**: the tool calls the worker made, and the one it made last.
- **effort**: how hard the model thought, measured from the session transcript, not just the level requested.
- **failed**: tool calls that failed, refusals by the fence included. Each attempt's `summary.json` splits them by
  cause: the permission mode, a deny rule, the scope, the sandbox, a real error, and others.
- **cost**: the session's cost so far, and the share of it that each attempt added.
- **quota**: the five-hour (5h) and seven-day (7d) windows as the lane last saw them. The last line is the account's
  newest snapshot, with each window's reset time.

### Costs and the quota

- Costs are Claude Code's API-equivalent estimates; on a subscription they are notional. Each attempt has a budget,
  passed to Claude Code as `--max-budget-usd`. It is a client-side cost estimate and does not cap subscription quota.
- Launches wait in the `held` state while the five-hour window is at or above its threshold (85% by default) or the
  seven-day window is at or above its own (95% by default). A held lane checks again every minute and after each
  reset. Parallel workers spend quota in proportion: N workers use it about N times as fast as one.
- A worker that hits a usage limit waits for the reset and resumes its own session; it does not start over.

### Watch it build

`arbab ui` serves a live, read-only page of your lanes on 127.0.0.1: a pixel-art scene inside a dashboard.

- **The scene**: each lane is a worker building a pyramid, and arbab is the foreman at the front. A worker walks up to
  talk when it takes its brief, and again when it delivers its report.
- **The stones**: each tool call sets a stone. When a lane finishes, its block is set, or its stones fall.
- **Landings**: a landing hoists the capstone in a beam of light. Landed integrations stand on the horizon.
- **The quota and the spend**: held lanes wait in the camp, and the sky turns to dusk while launches are held and to
  night while the account is rejected. Sleeping workers wait for the reset. The coin pile grows with the spend.
- **Around the scene**: quota gauges, KPI cards, the crew, the integration's progress, a chronicle of what happened,
  and a ledger of every lane.

Sound is off until you turn it on. Then a horn sounds for each brief and report, a drum for each stone, and coins
clink as a finished worker takes its pay.

![arbab ui by day: workers build the pyramid while arbab, at the front, talks to one of them](docs/ui/day.png)

![arbab ui at night: the workers sleep at their work while the account waits for its reset](docs/ui/night.png)
