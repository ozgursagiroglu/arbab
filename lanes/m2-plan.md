# M2 · plans and their dependency graph (src/plan)

## Task

Implement `src/plan/`, the pure logic behind DESIGN.md §16 "Plan format": load and check a plan, compute its waves,
compile phases into lane specs, and decide which phases can start. No process or launch code; the commands come in
a later lane.

Export from `src/plan/index.ts`:

1. `loadPlan(projectRoot: string, planPath: string): PlanSpec` — read and validate `plans/<name>.json` with
   `ArbabError("config")` messages naming the field:
   - `name` passes `assertValidName`;
   - `base` is a non-empty string not starting with `-`;
   - `defaults` and every phase use only the `PhaseLaneFields` keys, with the same value rules as lane files (reuse
     the validators in `src/config/lane.ts`; export what you need from there only if it is a small, additive change
     you can test, else report it);
   - phase `brief` is confined and exists;
   - `scope` is a non-empty array of relative globs (no `..`, not absolute);
   - `dependsOn` holds names;
   - unknown keys are refused.
2. `checkPlan(plan: PlanSpec): LintIssue[]` — errors:
   - `duplicate-phase`;
   - `unknown-dependency`;
   - `dependency-cycle` (name the cycle);
   - `empty-scope`;
   - `overlapping-scope`: two phases whose scopes overlap and neither of which depends on the other, directly or
     transitively. Two globs overlap when the fixed path of one (the segments before the first segment with `*`,
     `?` or `[`) is a segment-wise prefix of the other's fixed path, or equal.

   A warning `long-wave` when a wave has more than 8 phases.
3. `planWaves(plan: PlanSpec): string[][]` — the topological levels (wave 0 has no dependencies), each sorted by
   name. Throws `ArbabError("config")` on a cycle.
4. `compilePhase(plan: PlanSpec, phaseName: string): LaneSpec`:
   - the phase merged over `plan.defaults` (role defaults to `implementer`);
   - `base` = `plan.base` for phases without dependencies (absent if the plan has none). For dependent phases,
     `base` is the plan base too: their dependencies come in through `mergeBranches`;
   - `upstream` = `dependsOn`, and `mergeBranches` = `dependsOn.map(d => "arbab/" + d)`;
   - `coordination` = a short Markdown list of the other phases in the same wave, with their scopes, preceded by
     "Other lanes run at the same time; do not edit their scopes:". Absent when the phase is alone in its wave.
5. `nextPhases(plan: PlanSpec, states: Record<string, { state: LaneState; endState: EndState | null } | undefined>):
   { launch: string[]; blocked: Array<{ phase: string; waitingFor: string[] }>; failed: Array<{ phase: string;
   dependency: string; endState: EndState | null }> }`:
   - a phase with no state (never launched) whose dependencies all have state `finished` with end state `success`
     is in `launch`;
   - a phase whose dependency finished with anything else is in `failed` (with the first such dependency);
   - the rest of the never-launched phases are in `blocked`, with the dependencies they still wait for;
   - phases that already have a state appear in none of the lists.
6. `planStatus(plan, states)` → one row per phase: `{ phase, wave, dependsOn, state, endState }`.

## Scope

You own `src/plan/**` (code and tests) and a small additive export in `src/config/lane.ts` if you need its
validators. Change nothing else.

## Facts

- `PlanSpec`, `PlanPhase` and `PhaseLaneFields` are in `src/types.ts`, as is `LaneSpec.mergeBranches`.
- Lane names become branch names `arbab/<name>`, and must pass `assertValidName`.

## Acceptance

- [ ] Every export above, with tests:
  - each validation rule;
  - each `checkPlan` code, positive and negative;
  - overlap examples: `src/plan/**` vs `src/plan/x.ts` overlap; `src/plan/**` vs `src/planner/**` do not; a
    dependency chain makes an overlap allowed;
  - waves for a diamond graph;
  - `compilePhase` for a root phase and a dependent phase;
  - `nextPhases` for every combination of dependency states.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
