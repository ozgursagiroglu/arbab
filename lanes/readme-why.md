# README · why arbab, and how a task flows (plan readme)

## Task

Write `docs/readme/02-why.md`, sections 2 and 3 of arbab's new README, as [plans/readme.md](../plans/readme.md)
decides.

1. `## Why arbab`:
   - The problem, in at most three sentences, from today's "Why": one long session plans, implements, waits on tools
     and tests, and fills its own context until every step slows down; subagents share its limits.
   - The roles, as four bullets:
     - **you** decide;
     - **your Claude Code session** plans, writes narrow briefs and reacts as lanes finish;
     - **headless workers** each take one brief in their own worktree and fence, with a budget and a clock;
     - **the arbab runner** does the mechanics (worktrees, sandbox profiles, quota holds, auto-resume, integration,
       fenced verification, review, landing).
   - `### Does running in parallel help?`: a table with the columns "", "Workflow agents in one session" and "Headless
     arbab workers", and the rows "Lanes finished" (0 of 7 | 7 of 7) and "Time" (stopped after 73 min | 1.9–6.4 min
     each).
   - Directly under the table, the caveat, every point of it:
     - this was not a controlled benchmark;
     - the Workflow run was stopped at 73 minutes;
     - 5 of the 7 headless lanes started from digests of the stopped work, and the two that did not were still among
       the fastest;
     - approval waits took 62–70% of the Workflow's wall time;
     - link [REQUIREMENTS.md §1](REQUIREMENTS.md#1-problem-measured).
   - One closing sentence: the point is not a speed-up number, but that independent work stops competing for one
     session's context and turn loop.
2. `## How a task flows`:
   - A vertical diagram in a `text` code block, at most 30 lines and 100 columns wide:
     - a task;
     - your Claude Code session (plan and briefs);
     - three lanes side by side, each "worktree + sandbox";
     - then integration, verification (inside the fence), adversarial review, the readiness report, your approval,
       and the merge ("never pushed").
   - Then five glossary bullets, one line each:
     - **lane**: one brief, one worker, one worktree;
     - **plan**: lanes in dependency waves;
     - **fence**: the worker's sandbox and exact permissions;
     - **integration**: the lanes' branches merged for verification and review;
     - **readiness**: the report you decide on.

## Scope

`docs/readme/02-why.md` (new). Change nothing else.

## Facts

- `plans/readme-facts.md` §11, the first bullet, holds every number of the measurement; use them exactly.
- Today's `README.md` "Why" and "How it works" sections (lines 17–69) hold the current wording of the roles and the
  mechanics.
- DESIGN.md §2 (process model), §16 (plans and waves) and §17 (integrate, verify, review, readiness, land) are the
  ground truth for the diagram.

## Acceptance

- [ ] The file docs/readme/02-why.md holds both sections as above.
- [ ] Every number matches plans/readme-facts.md, and the caveat is complete.
- [ ] No speed-up multiplier appears anywhere.
- [ ] Prose lines are wrapped at 120 characters at most.

## Notes

- Style:
  - plain, concrete English; short sentences; active voice;
  - no hype words (revolutionary, seamless, powerful, blazing, cutting-edge) and no emoji.
- This lane writes one Markdown file and runs no checks: the integration's verify runs the gates on the result. This
  overrides the project rule's checks for this lane. Never run `pnpm build`.
