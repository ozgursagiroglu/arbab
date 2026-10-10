# M2 · command-span lint, and the skill's lessons from M1

## Task

1. **Brief lint checks command spans only** (DESIGN.md §16 "Brief lint: command spans only"). In
   `src/brief/lint.ts`, `denied-command` and `forbidden-shape` apply only to:
   - inline code in the `Acceptance` section;
   - every line of a shell fence (the existing `SHELL_FENCES`);
   - inline code that its line introduces as something to run: the text before the span, on the same line, ends
     with "run", "runs", "execute", "call", "with the command" or "Bash:" (case-insensitive, trailing spaces and a
     colon ignored).

   Descriptive inline code elsewhere is no longer checked. Keep all other lint codes. Update the tests: one case for
   each kind of command span, and cases proving that descriptive spans pass. The descriptive cases are a parameter
   name in prose, a command mentioned in Facts, and a compound command described in Task as something a test should
   reject.
2. **The skill learns M1's lessons** (`skills/arbab/SKILL.md` and its references):
   - **Review**: when a finding can be tested, settle it with a deterministic probe lane (a small script the worker
     runs, reporting outcomes) before, or instead of, a skeptic pass. M1 settled its two security findings that way.
     Two lenses that find the same defect independently count as confirmation.
   - **Fence**: arbab denies writes to the repository's shared git directory. Measured: without that, code a
     worktree's worker runs can write loose refs there.
   - **Plans**: a short section on `plans/<name>.json`, plus `arbab plan check`, `arbab plan next` (after each
     `wait` notification) and `arbab plan status`, from DESIGN.md §16. Converting a design document into a plan
     means:
     - one phase per lane;
     - disjoint scopes;
     - dependencies only where a phase needs another's code;
     - shared contracts written by the orchestrator before the first wave.
   - **Digest**: when to use `arbab resume <lane> --digest` instead of a plain resume (a long attempt stopped long
     ago, or a session that went wrong).
   - **Integrate**: lane-level green is not repo-level green; run the gates after every merge, including on `main`
     after landing (M1's own landing found a test that only failed there).
   - Keep SKILL.md under 400 lines; update `src/skill.test.ts` if a test depends on changed text.

## Scope

You own `src/brief/lint.ts`, `src/brief/lint.test.ts`, `skills/**` and `src/skill.test.ts`. Change nothing else.

## Facts

- M1's briefs hit command-span false positives six times. Cases: a parameter name in backticks; a command in Facts
  describing a measurement; a compound command a test should reject; a plugin command shown as an example; git
  commands the runner (not the worker) runs; and a coordination heading.
- `matchesBashRule` and `isAllowedCommand` in `src/brief/rules.ts` stay as they are.

## Acceptance

- [ ] Lint and skill changes as above, with tests.
- [ ] Every `lanes/*.md` of this repository still lints without errors under its lane's profile. The parse test
      already covers parsing.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
