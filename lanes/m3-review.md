# M3 · the review pipeline (src/review)

## Task

Implement `src/review/` (DESIGN.md §17, `arbab review`; REQUIREMENTS FR-10): lens reviewer lanes with a depth floor,
then skeptic lanes for MEDIUM+ findings. Pure functions; the command lane launches and waits.

Export from `src/review/index.ts`:

1. `BUILTIN_LENSES: Readonly<Record<string, string>>`, what each lens looks for:
   - **correctness:** wrong behaviour on reachable paths, lost or duplicated work, wrong end states, time and unit
     errors, resource leaks;
   - **security:** fence escapes, code from workers running on the host, path traversal and symlinks, argument
     injection, secrets on disk or in logs, signals to the wrong processes, races;
   - **contracts:** files and fields modules disagree on, behaviour against DESIGN.md, duplicated logic, untested
     exports, bundle-only breakage.
2. `lensNames(configLenses: Record<string, string>): string[]`: the built-ins, then the config lenses. A config
   lens with a built-in's name replaces its text.
3. `reviewLane(input: { name: string; lens: string; text: string; diffBase: string }): { spec: LaneSpec; brief:
   string }`:
   - lane `<name>-review-<lens>`, role `reviewer`, base `integrate/<name>`;
   - the brief source's Task says to review the change `git diff <diffBase>..HEAD` for the lens, and gives the
     lens text;
   - the depth floor: read in full every file the diff changes, and the code they call where a finding depends on
     it;
   - every finding has a file, a line, a concrete failure scenario and evidence; at most 10, strongest first; no
     style remarks; none rather than speculative;
   - Scope: read-only;
   - Acceptance: `paths_checked` lists every file read in full, and `coverage` says what was verified and how.
4. `collectFindings(reports: Array<{ lens: string; report: unknown }>): ReviewFinding[]`:
   - parse each reviewer report (the default reviewer schema: `findings[]` with `title`, `severity`, `file`,
     `line?`, `failure_scenario`, `evidence`, `suggested_fix?`);
   - skip malformed findings;
   - ids `<lens>-<n>` from 1 in report order; verdict `unverified`.
5. `skepticLane(input: { name: string; lens: string; findings: ReviewFinding[] }): { spec: LaneSpec; brief: string;
   schema: JsonSchema }`, for that lens's MEDIUM and HIGH findings only:
   - lane `<name>-skeptic-<lens>`, role `reviewer`, base `integrate/<name>`;
   - the schema is `{verdicts: [{id, refuted: boolean, corrected_severity: "HIGH"|"MEDIUM"|"LOW"|"NONE",
     reasoning}]}`;
   - the brief lists each finding with its id, and asks for three angles: trace (does the code do what the finding
     says), reachability (can it happen with real inputs), and provenance (introduced by this diff or
     pre-existing);
   - "if still uncertain after checking the code, refute it".
6. `applyVerdicts(findings: ReviewFinding[], verdicts: unknown): ReviewFinding[]`:
   - a verdict with `refuted: true`, or `corrected_severity: "NONE"` → `refuted`;
   - otherwise → `confirmed`, with the corrected severity;
   - `verdictReason` is the reasoning;
   - findings without a verdict stay `unverified`; unknown ids are ignored.
7. `reviewRecord(input: { name; headSha; lenses; skeptics; findings; now }): ReviewRecord`.

## Scope

You own `src/review/**` (code and tests). Change nothing else.

## Facts

- In arbab's own build, the depth floor turned six shallow lenses with 1 finding (machine 1) into three lenses with
  30 findings (M1) and one lens with 10 (M2). Five M1 defects were found by two lenses independently.
- `ReviewFinding`, `ReviewRecord`, `FindingVerdict` and `JsonSchema` are in `src/types.ts`.
  `DEFAULT_SCHEMAS.reviewer` is in `src/report`.
- A lane name passes `assertValidName` (at most 48 characters); long integration names plus `-skeptic-<lens>` must
  fail with a clear error.

## Acceptance

- [ ] Every export, with tests:
  - lens merging;
  - each brief lints clean under a reviewer profile (`compileProfile` + `lintBrief`);
  - collection with malformed findings;
  - a skeptic lane only for MEDIUM+ findings;
  - every verdict case;
  - the name-length error.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
