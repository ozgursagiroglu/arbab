# M3 · the readiness report (src/readiness)

## Task

Implement `src/readiness/` (DESIGN.md §17, `arbab readiness`; REQUIREMENTS FR-21). It produces the verified /
skipped / risks report that a human reads before landing. Pure functions.

Export from `src/readiness/index.ts`:

1. `computeReadiness(input: { name: string; tier: Tier; integration: IntegrationRecord; verify: VerifyRecord | null;
   review: ReviewRecord | null; laneReports: Array<{ lane: string; report: unknown }>; configLenses: string[];
   smokeConfigured: boolean; waivers: string[]; now: string }): ReadinessReport`.

   "Current" means `headSha === integration.headSha`; anything else is stale.

   **verified:**
   - `verify:<command>` for each result of a current verify, with its exit code;
   - `review:<lens>` for each lens of a current review that ended `success`, with the number of paths checked;
   - `findings`: the confirmed / refuted / unverified counts.

   **skipped** (stable ids; each `waived` when its id is in `waivers`):
   - `verify`: no current verify, or it did not pass. Every tier.
   - `deps`: a merged lane changed a dependency manifest and `depsConfirmed` is false. Every tier.
   - `review`: medium, and no lens of a current review succeeded.
   - `review:<lens>`: high, for each built-in or config lens without a current success.
   - `skeptic`: high, when a lens had MEDIUM+ findings and they are still `unverified`.
   - `smoke`: high, when smoke is not configured or did not pass in a current verify.

   **risks:**
   - each confirmed HIGH or MEDIUM finding (`<id>: <title> (<file>:<line>)`);
   - each unverified HIGH or MEDIUM finding;
   - each merged lane's `open_questions` and `not_verified` entries from its report (prefixed by the lane name; a
     malformed report is itself a risk);
   - each manifest change;
   - a stale verify or review (named, with its head);
   - each waiver id that matches no skipped item.

   **ready:** a current verify passed, and every skipped item is waived.
2. `renderReadiness(report: ReadinessReport): string`: Markdown in the shape of `docs/readiness-m1.md`:
   - a title with the integration name;
   - a line with tier, head and date;
   - `## Verified` (a table), `## Skipped (each needs a waiver)` (a list with waived ones marked) and `## Risks`
     (a list);
   - a final line: "Ready to land: yes|no".

## Scope

You own `src/readiness/**` (code and tests). Change nothing else.

## Facts

- `ReadinessReport`, `ReadinessItem`, `Tier`, `IntegrationRecord`, `VerifyRecord` and `ReviewRecord` are in
  `src/types.ts`. Built-in lens names are correctness, security and contracts; the command lane passes the full
  lens list in `configLenses`.
- The owner's example that motivated FR-21: a fast run skipped an independent review, an eval and a browser check
  silently. Every check the tier requires must show up as verified or skipped, never be absent.

## Acceptance

- [ ] Both exports, with tests:
  - each tier;
  - each skipped id appearing and disappearing;
  - waivers;
  - an unknown waiver turned into a risk;
  - stale verify and review;
  - risks from lane reports, including a malformed one;
  - the rendered Markdown for a fixed input (exact string).
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
