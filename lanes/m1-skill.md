# M1 · the skill and the plugin manifests (skills/arbab, .claude-plugin)

## Task

Write the method as a Claude Code plugin skill, and the plugin and marketplace manifests. The reader of the skill
is an interactive Claude Code session acting as the orchestrator. REQUIREMENTS.md (why), DESIGN.md (how) and
`research/` (the evidence) are your sources; the skill turns them into instructions a session can follow.

Files:

1. `.claude-plugin/plugin.json`: `name: "arbab"`, a one-sentence description, `keywords`. No `version` while
   iterating; no other fields.
2. `.claude-plugin/marketplace.json`: `name: "arbab"`, `owner: {name: "Diojen"}`, one plugin `{name: "arbab", source:
   "./", description}`.
3. `skills/arbab/SKILL.md`:
   - Frontmatter:
     - `name: arbab`;
     - `description`: what it does and when to use it, under 600 characters;
     - `allowed-tools`: `Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/arbab.mjs *)`.
   - Body, in this order, each section short and imperative:
     - **When to fan out** — long or multi-phase work with independent parts. Stay in-session for small jobs (for
       example `/ship`) and short fan-outs (Workflow).
     - **Before the first launch** — `doctor`; a project `arbab.config.json` (commands per role, gates, preflight
       steps, `instructions`, resources).
     - **Plan** — split the work into lanes with disjoint write scopes; make the design decisions now, because
       workers do not.
     - **Write each brief** — the source format (`## Task`, `## Scope`, `## Acceptance`, `## Facts`,
       `## Unverified`, `## Notes`). Narrow and decided. Measured facts kept apart from guesses. Exact function
       signatures when lanes must fit together. No compound commands. Name the checks.
     - **Lane file** — the fields, and the role defaults table.
     - **Launch** — `lint`, `preflight` before the first wave of a project, then `launch`.
     - **Wait** — `wait --any` from a background Bash call, so you are notified. React to each finish while the
       others run. Never poll streams into your context; read `summary.json` and `report.json`.
     - **End states** — what each means and what to do. `usage-limit` resumes by itself. For `failed`, read the
       report, stderr and the last events, then choose `resume` with a correction prompt or a fresh relaunch.
       `invalid-report`; `unsupported-cli` → `doctor`; `killed:*`.
     - **Quota** — the status line; holds; parallel workers spend quota proportionally; keep headroom for yourself.
     - **Review** — reviewer lanes with a depth floor, evidence per path and a coverage section; a skeptic pass
       for MEDIUM+ findings.
     - **Land** — integrate in an integration worktree; run the repository's gates there (lane-level green is not
       repo-level green); write the readiness report (verified / skipped / risks, FR-21); ask the human. Push and
       deploy are human actions; report every skipped push.
     - **Do not** — keep executable helpers in your scratchpad while workers run (every sandbox can write there);
       pass `CLAUDE_*` or editor environment to workers; message workers; give workers production access (they
       write read-only queries; you run them).
4. `skills/arbab/references/` (linked from SKILL.md):
   - `brief-template.md`: a complete, realistic brief source;
   - `lane-example.json`: a lane file for that brief;
   - `end-states.md`: the classification table of DESIGN.md §7 with what to do for each;
   - `landing-checklist.md`: integration, gates, review, the readiness report and the human question.
5. `src/skill.test.ts`. The tests check:
   - both manifests parse, and the plugin name is `arbab`;
   - the SKILL.md frontmatter has `name`, a `description` under 600 characters, and the `allowed-tools` line;
   - every relative link in SKILL.md resolves;
   - `lane-example.json` passes `loadLane` (from `src/config`) with its brief;
   - `brief-template.md` parses with `parseBriefSource` and has no lint errors under an implementer profile
     compiled with `compileProfile` (from `src/profile`, with `commands: ["pnpm test", "pnpm typecheck"]`).

## Scope

You own `skills/**`, `.claude-plugin/**` and `src/skill.test.ts`. Read everything else; change nothing else.

## Facts

- Plugin facts (w0 research):
  - `name` is the only required manifest field;
  - plugin skills are invoked as `/arbab:arbab`;
  - `${CLAUDE_PLUGIN_ROOT}` is substituted in the SKILL.md body and in `allowed-tools`;
  - `bin/` is only on the Bash tool's PATH and blocks claude.ai installs, so arbab uses
    `node ${CLAUDE_PLUGIN_ROOT}/dist/arbab.mjs`;
  - third-party marketplaces do not auto-update.
- The measured evidence the skill's advice rests on:
  - Workflow lanes finished 0 of 7 in 73 min; the same lanes as headless workers finished 7 of 7 in 1.9–6.4 min;
  - approval waits took 62–70% of Workflow wall time;
  - one account limit stopped two fleets and both orchestrators;
  - six shallow review lenses found one bug;
  - lane tests passed while the repo's boot-smoke gate failed on the integration branch.
- The CLI surface is DESIGN.md §10; the commands are being implemented in parallel, so describe them from the design.

## Acceptance

- [ ] The files above. SKILL.md is under 400 lines and every claim in it matches DESIGN.md.
- [ ] The tests in `src/skill.test.ts` pass.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
