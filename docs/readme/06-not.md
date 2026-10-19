## What arbab is not

- **Not another coding agent.** The workers are the unmodified Claude Code binary (`claude -p`), under your own
  login. arbab decides how they run, fences them and checks their work.
- **Not a replacement for Claude Code.** It is a plugin for the session you already use: a skill plus a runner.
- **Not an autonomous deploy bot.** Workers cannot push or deploy. Landing needs your yes, and `land` never pushes.
- **Not a generic agent framework.** It is opinionated about software work: worktrees, sandboxes, verification,
  review and controlled integration. For a short fan-out inside your session, Claude Code's Workflows are the simpler
  tool; the FAQ compares them.

## Built with itself

arbab was built by its own method, as an interactive orchestrator with headless workers. Milestones M1–M3 took 146
worker attempts and 5,091 tool calls. Only 1.3% of those calls were refused by the fence; hand-made fences on other
machines measured 5.8–15%. The notional API-equivalent cost was about $225, run on a subscription.

M3 alone went through 14 review rounds, 10 of them with all three lenses. Among what the review lanes found and the
fix lanes closed were two paths by which worker code could have run on the host. Every run is in
[bench/RUNS.md](bench/RUNS.md), with notes in [bench/README.md](bench/README.md).

`arbab ui` was built the same way, in two plans: 46 worker attempts and 2,177 tool calls, at about $105
API-equivalent on a subscription. The second plan was the game-studio pass. In it, an orchestrator checked every page
in a real browser and sent the fixes back as lanes.
