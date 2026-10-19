# README · scout the landscape (plan readme)

## Task

arbab is a Claude Code plugin. Your interactive session plans and decides, and arbab runs headless `claude -p`
workers in parallel, each in its own git worktree behind Claude Code's sandbox. It then verifies, reviews and lands
their work on a human's yes. Its README is being rewritten, and its FAQ compares it with Claude Code's subagents,
Workflows, agent teams and agent view, and with worktree managers such as claude-squad and Conductor.

Check the landscape that FAQ answers to, with at most 12 searches and 12 fetches:

1. Find up to eight open-source projects that run several coding agents (Claude Code or others) in parallel: worktree
   managers, orchestrators, autonomous builders. For each, report:
   - its name, URL and one-line positioning, quoted from its README;
   - whether workers are isolated (worktrees, containers, sandboxes);
   - whether results pass gates (tests, reviews) before merging;
   - whether a human approves the merge.
2. Check whether Claude Code's own documentation now offers anything newer than what the FAQ names (Workflows, agent
   teams, agent view, background sessions) for running parallel headless work. Report the page and the claim.
3. Recommend at most five changes to arbab's FAQ or its "What arbab is not" section, each with its source:
   - a comparison to add or update;
   - a claim to avoid because every project makes it;
   - a difference worth stating.

## Scope

Nothing is written: this lane reports only. Its report is inlined into the brief of the lane that assembles the
README.

## Acceptance

- [ ] Every fact has a source URL and a quote.
- [ ] At most eight projects are reported.
- [ ] Recommendations name the README section they change.

## Notes

- Quote, do not paraphrase. Mark a positioning as unclear rather than guess it.
- Stop when you have enough; this lane should take a few minutes.
