## Why arbab

One long session plans, implements, waits on tools and tests, and fills its own context until every step slows down.
Subagents inside that session share its limits.

arbab splits the roles four ways:

- **You** decide.
- **Your Claude Code session** plans, writes narrow briefs and reacts as lanes finish.
- **Headless workers** each take one brief in their own worktree and fence, with a budget and a clock.
- **The arbab runner** does the mechanics: worktrees, sandbox profiles, quota holds, auto-resume, integration, fenced
  verification, review and landing.

### Does running in parallel help?

|                | Workflow agents in one session | Headless arbab workers |
| -------------- | ------------------------------ | ---------------------- |
| Lanes finished | 0 of 7                         | 7 of 7                 |
| Time           | stopped after 73 min           | 1.9–6.4 min each       |

This was not a controlled benchmark:

- the Workflow run was stopped at 73 minutes;
- 5 of the 7 headless lanes started from digests of the stopped work, and the two that did not were still among the
  fastest;
- approval waits took 62–70% of the Workflow's wall time.

[REQUIREMENTS.md §1](REQUIREMENTS.md#1-problem-measured) has every measurement and confound.

The point is not a speed-up number, but that independent work stops competing for one session's context and turn loop.

## How a task flows

```text
                               a task
                                 │
                                 ▼
                   your Claude Code session
                       (plan and briefs)
                                 │
            ┌────────────────────┼────────────────────┐
            ▼                    ▼                    ▼
         [ lane A ]           [ lane B ]           [ lane C ]
     worktree + sandbox   worktree + sandbox   worktree + sandbox
            │                    │                    │
            └────────────────────┼────────────────────┘
                                 ▼
                            integration
                                 │
                                 ▼
                 verification (inside the fence)
                                 │
                                 ▼
                         adversarial review
                                 │
                                 ▼
                          readiness report
                                 │
                                 ▼
                           your approval
                                 │
                                 ▼
                      merge (never pushed)
```

- **lane**: one brief, one worker, one worktree.
- **plan**: lanes in dependency waves.
- **fence**: the worker's sandbox and exact permissions.
- **integration**: the lanes' branches merged for verification and review.
- **readiness**: the report you decide on.
