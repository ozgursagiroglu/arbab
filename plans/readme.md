# The README and positioning pass (plan `readme`)

Status: launched on 2026-10-19 from the branch `readme-base`. To run it as the demo: open Claude Code in this
repository and say "/arbab implement plans/readme.md, with the UI". The plan is [plans/readme.json](readme.json), the
briefs are `lanes/readme-*.md`, and the real outputs the README quotes are in [plans/readme-facts.md](readme-facts.md).

## Goal

The technical side is stronger than the README that presents it. A first-time visitor should understand in ten
seconds what arbab does for them, see in thirty seconds how to run it, and find the proof further down:
- real output;
- the safety model;
- the review story;
- the numbers.

The same run doubles as the demo video: arbab rewrites its own README while `arbab ui` shows the workers building.

## The outside review, and what we do with it

| Suggestion | Decision |
| --- | --- |
| Lead with value: "Turn one Claude Code session into a controlled engineering team." | Take it, as the tagline. |
| "Parallel execution. Isolated worktrees. Sandboxed workers. Human-controlled merges." | Take it, as the one-line summary under the lead. |
| "You give the order. arbab runs the team. Claude writes the code." | Take it, next to the name's meaning. It replaces "Claude Code is the engineer, arbab is the engineering manager": in arbab your session manages and arbab is the method plus the machinery, so the slogan says it more truly. |
| A benchmark table, with the caveat kept | Take it. The caveat stays directly under the table, and there is no speed-up multiplier: we never measured one. |
| Isolation as a headline feature: "Workers can write code, but they cannot touch your working tree." | Take it, as "Safe by construction", near the top. |
| A lane diagram (task → lanes → integration → verify → review → readiness → approval → merge) | Take it, replacing today's runner-centric diagram. |
| Show the CLI early, with real output | Take it, as "A real run": arbab's own `ui2` milestone, real outputs only. |
| The demo GIF's mock output ("Merge 4 lanes? [y/N]", a progress bar) | Reject. arbab prints neither. The demo is a real recording of this plan running. |
| "What arbab is not" | Take it: not a coding agent, not a replacement for Claude Code, not a deploy bot, not a generic agent framework. |
| Cost and usage as a feature ("Know what your agents are doing") | Take it, with the real `status` table and `arbab ui`. |
| The review story ("Don't ask one agent whether its own work is correct.") | Take it, with real review numbers. |
| De-emphasize "multi-agent" in the GitHub topics | An owner action after landing (below); workers have no GitHub access. `package.json` keywords stay: a manifest change stops `verify` until a human confirms in a terminal, which would break the demo. |
| A public roadmap (v0.2 developer experience, v0.3 other CLIs) | Not in this pass: a public roadmap is a promise. Listed under "Later" for the owner to decide. |
| Other coding CLIs (Codex, Gemini) | Later, if ever. The fence is Claude Code's sandbox and permission system; another CLI needs its own. |
| The FAQ | Keep. It already compares arbab with subagents, Workflows, agent teams, agent view and worktree managers. A researcher lane checks the landscape for anything that changes. |

## The new README, in order

1. **Hero**:
   - the title, the tagline and a three-sentence lead, then the one-line summary and the badges;
   - the hero picture (`docs/ui/page.png` until the demo recording replaces it) and a small flow diagram;
   - the name ("*arbab*: master, the one who gives the orders") with the slogan;
   - "arbab does not replace Claude Code: it gives your session a controlled way to delegate real engineering work."
2. **Why arbab**:
   - the problem, and the roles split four ways (you, your session, the workers, the runner);
   - "Does running in parallel help?", with the measured table and its caveat.
3. **How a task flows**: the vertical lane diagram and a five-term glossary (lane, plan, fence, integration,
   readiness).
4. **Get started**: requirements, install, the config, `/arbab`, "Plan this and run it with arbab.", and the two
   steps that are always yours. This is today's Install and Quick start, tightened.
5. **A real run**: the `ui2` milestone from `plan check` to `land`, real outputs, trimmed.
6. **Safe by construction**: what every worker gets and cannot do, and the host-side rules ending in "land never
   pushes".
7. **Reviews that try to prove you wrong**: lenses with a depth floor, skeptics, verdicts, readiness, waivers, and
   real numbers.
8. **Know what your workers are doing**: `arbab status` (the real table), costs and the quota, and `arbab ui` with
   the scene's pictures.
9. **Commands**: today's table, checked against `arbab --help`.
10. **What arbab is not**.
11. **Built with itself**: M1–M3 as today, plus `arbab ui`.
12. **FAQ**, then **Documentation**, **Contributing** and **License**: today's, with the FAQ updated if the
    researcher finds something.

## The lanes: small tasks, so the run is short enough to film

Each writing lane writes one fragment under `docs/readme/` (disjoint files, so the lanes run in parallel). One last
lane assembles `README.md` from them and deletes the fragments. The writing lanes run opus at medium effort and run no
checks themselves; the integration's `verify` runs the gates on the result.

| Lane | Role, sprite in `arbab ui` | Writes | Expected | Depends on |
| --- | --- | --- | --- | --- |
| `readme-hero` | implementer, laborer | `docs/readme/01-hero.md` | 3–5 min | — |
| `readme-why` | implementer, laborer | `docs/readme/02-why.md` | 3–5 min | — |
| `readme-run` | implementer, laborer | `docs/readme/03-run.md` | 4–6 min | — |
| `readme-trust` | implementer, laborer | `docs/readme/04-trust.md` | 4–6 min | — |
| `readme-watch` | implementer, laborer | `docs/readme/05-watch.md` | 3–5 min | — |
| `readme-not` | implementer, laborer | `docs/readme/06-not.md` | 3–4 min | — |
| `readme-scout` | researcher, scout (walks off past the dunes) | nothing: its report | 4–8 min | — |
| `readme-assemble` | implementer, laborer | `README.md` (and deletes `docs/readme/`) | 5–8 min | all seven |

Then the integration `readme`:
1. `verify`: the surveyor at the sledge, about 2 min.
2. `review --lenses accuracy`: a scribe, and a skeptic for MEDIUM+ findings. `accuracy` is a custom lens; its text
   goes into `arbab.config.json` `review.lenses` when the plan is launched: "Every claim, command, flag, number and
   output in the changed docs is true of the code, DESIGN.md and plans/readme-facts.md. Nothing is promised that arbab
   does not do. Every link and anchor resolves."
3. `readiness`.
4. Your yes.
5. `land`: the capstone is hoisted.

Expected wall time is about 25–35 minutes, most of it parallel. The machine-wide `maxParallel` (6) may hold one
writer in the camp for a minute when other projects' lanes are running, which films well.

## Running it as the demo

Before:
- `main` is clean, and the quota is not near the hold threshold (5h under about 80%).
- Open the browser and a terminal side by side.

The run:
1. **"/arbab implement plans/readme.md, with the UI"**:
   - The orchestrator commits the plan files and the `accuracy` lens to a base branch, then starts `arbab ui`, which
     opens the browser.
   - On screen: the `ui2` monument stands in the foreground; `ui` and `m3` stand on the horizon.
2. **`plan check`, then `plan next`**: seven workers walk in from the village. Each talks to arbab (glyph bubbles,
   the horn) and climbs to its block. The scout walks off past the dunes. The monument leaves for the horizon and a
   new outline appears.
3. **Work**: a stone per tool call, with the drum. Turn the sound on with the button.
4. **Finishes**: a set block shines, and the worker walks back, reports, takes bread and beer while coins clink from
   the treasury, and leaves. The chronicle fills.
5. **`plan next` again**: the assembler arrives and builds the second course.
6. **`integrate`, then `verify`**: the surveyor measures at the sledge, and the capstone waits with a green pennant.
7. **`review`**: a scribe walks the lower courses. A skeptic in a red sash appears if there is a MEDIUM finding.
8. **`readiness`**: the orchestrator shows you the report and asks. You say yes.
9. **`land`**: the capstone is hoisted in a beam of light, arbab cheers, and the fanfare plays. That is the last
   shot.

Editing: speed up the building stretches 8–16×; keep the talks, a finish with the coins, and the capstone in real
time. Aim for 60–90 seconds for the README GIF and 3–4 minutes for a longer cut.

## After the landing: yours

- Push `main` when you are ready. It also carries `arbab ui` (`765b792`) and its game-studio pass (`be2be12`).
- Put the demo at the top of the README, replacing `docs/ui/page.png` in the hero. Prefer a short MP4 uploaded to a
  GitHub issue or release and linked; a GIF in the repository should stay under about 10 MB.
- GitHub "About":
  - description: "Turn one Claude Code session into a controlled engineering team: parallel headless workers in
    sandboxed worktrees, verified, reviewed, and landed only on your yes."
  - topics: `claude-code`, `claude-code-plugin`, `developer-tools`, `git-worktree`, `sandbox`, `code-review`,
    `parallel-execution`, `ai-coding`. Keep `claude` and `anthropic`; drop `multi-agent` and `agent-orchestration`.
- The social preview image: `docs/ui/day.png`, or a frame from the demo.
- The version: `arbab ui` is a big feature; 0.2.0 and release notes are your call.

## Later, not in this pass

- **Developer experience**:
  - `arbab init` (writes a starter `arbab.config.json` from the repository's scripts);
  - clearer failure recovery in `status`;
  - Linux tested end to end.
- **M4**, already briefed in `lanes/m4-*.md`: denial telemetry (`arbab denials`) and raw HTTP for researcher lanes.
- A public roadmap section, if you want one.
