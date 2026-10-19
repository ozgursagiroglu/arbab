# README · what arbab is not, and built with itself (plan readme)

## Task

Write `docs/readme/06-not.md`, sections 10 and 11 of arbab's new README ([plans/readme.md](../plans/readme.md)).

1. `## What arbab is not`, four bold lead-ins, each with one or two sentences:
   - **Not another coding agent.** The workers are the unmodified Claude Code binary (`claude -p`), under your own
     login; arbab decides how they run, fences them and checks their work.
   - **Not a replacement for Claude Code.** It is a plugin for the session you already use: a skill plus a runner.
   - **Not an autonomous deploy bot.** Workers cannot push or deploy, landing needs your yes, and `land` never pushes.
   - **Not a generic agent framework.** It is opinionated about software work: worktrees, sandboxes, verification,
     review and controlled integration. For a short fan-out inside your session, Claude Code's Workflows are the
     simpler tool; the FAQ compares them.
2. `## Built with itself`:
   - Today's two paragraphs (`README.md` lines 204–211), kept as they are: M1–M3, 146 attempts, 5,091 calls, 1.3%
     refused against 5.8–15% elsewhere, about $225, 14 review rounds, and the two host paths closed.
   - Then one new paragraph, from `plans/readme-facts.md` §11:
     - `arbab ui` was built the same way, in two plans: 46 worker attempts, 2,177 tool calls, about $105
       API-equivalent on a subscription;
     - including the game-studio pass, in which an orchestrator checked every page in a real browser and sent the
       fixes back as lanes.
   - Keep the links to [bench/RUNS.md](bench/RUNS.md) and [bench/README.md](bench/README.md).

## Scope

`docs/readme/06-not.md` (new). Change nothing else.

## Facts

- Today's `README.md`: "Built with itself" (lines 204–211), and the FAQ (lines 213–265), which compares arbab with
  subagents, Workflows, agent teams, agent view and worktree managers.
- `plans/readme-facts.md` §11.

## Acceptance

- [ ] The file docs/readme/06-not.md holds both sections as above.
- [ ] Every number matches today's README or plans/readme-facts.md.
- [ ] Prose lines are wrapped at 120 characters at most.

## Notes

- Style:
  - plain, concrete English; short sentences; active voice;
  - no hype words (revolutionary, seamless, powerful, blazing, cutting-edge) and no emoji.
- This lane writes one Markdown file and runs no checks: the integration's verify runs the gates on the result. This
  overrides the project rule's checks for this lane. Never run `pnpm build`.
