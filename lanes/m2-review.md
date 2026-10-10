# M2 review · correctness and security of plans, digests and command-span lint

## Task

Review M2 on this branch for real defects. Read the diff with git diff main..HEAD, plus the files themselves. M2
covers:
- plans and their dependency graph: `src/plan`, and `src/commands/plan.ts` for `plan check`, `plan next` and
  `plan status`;
- the shepherd merging a phase's dependency branches into its new worktree: `src/shepherd/merge.ts` and
  `prepare()` in `src/shepherd/lifecycle.ts`;
- attempt digests seeding a fresh session: `src/digest`, `resume --digest`, and the head start in
  `src/shepherd/prompt.ts`;
- brief lint checking only command spans: `src/brief/lint.ts`.

DESIGN.md §16 is the specification.

Look for:
1. **Plans:**
   - a cycle or an overlap `checkPlan` misses;
   - `plan next` launching a phase twice, launching one whose dependency did not succeed, or skipping one that
     should start;
   - a phase name or brief path that escapes its root.
2. **Merges.** The shepherd runs git unsandboxed in the new worktree:
   - can a branch name, a lane file or a plan inject git options or reach another repository?
   - is a failed or conflicting merge always aborted and reported?
   - can a merge run in a worktree a worker has already used?
3. **Digests:**
   - can a crafted stream (huge items, odd unicode, instructions in tool results) make the head start unbounded,
     or present stream content as the orchestrator's instructions rather than a record?
   - is the size cap respected?
4. **Lint.** Command spans a brief could use to slip a denied or compound command past lint; descriptive spans
   still refused.

## Scope

Read-only. Read in full at least: `src/plan/**`, `src/digest/**`, `src/shepherd/merge.ts`,
`src/shepherd/lifecycle.ts`, `src/shepherd/prompt.ts`, `src/commands/plan.ts`, `src/commands/resume.ts`,
`src/brief/lint.ts`, `src/config/lane.ts`. You may run `pnpm test`, `pnpm typecheck` and `pnpm build`.

## Facts

- A real two-phase plan ran end to end with real claude: `plan next` launched A only. A second `plan next` while A
  ran launched nothing. After A succeeded, `plan next` launched B. B's worktree had A's checkpoint merged and B's
  brief had A's report.
- M1's review found 30 defects with this depth floor; every claim needs evidence.

## Acceptance

- [ ] Every file in Scope is in `paths_checked`, and `coverage` says what you verified and how.
- [ ] Each finding has the file and line, a concrete failure scenario and its evidence. At most 10 findings,
      strongest first. No style remarks.
