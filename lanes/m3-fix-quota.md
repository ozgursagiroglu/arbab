# M3 fixes, round 2 · early resume only after an account switch, readiness lists every confirmed finding

## Task

The second `arbab review m3` found these defects. Fix each one; each fix gets a test that fails without it.

1. **A usage-limited lane resumes early only after `arbab quota --reset` (correctness-3, confirmed).** While a lane
   waits for a usage-limit reset, `quotaCleared` (`src/shepherd/lifecycle.ts`) lets it resume as soon as any newer
   snapshot does not hold. Snapshots carry only the five-hour and seven-day windows, so another lane's events (a haiku
   probe, a sonnet lane) look fine while this lane's limit (`seven_day_opus`, say) still holds. The lane resumes, hits
   the limit again and burns its attempts. The early resume exists for one case: the human switched accounts and ran
   `arbab quota --reset`. Make that the only trigger:
   - `src/quota` owns the reset: `resetQuota(home, clock)` removes the snapshot and records when the reset happened
     (`quota-reset.json` under the home, written atomically); `lastQuotaReset(home): number | null` reads it (epoch
     ms; null when absent or unreadable); export the snapshot's path for messages.
   - `arbab quota --reset` (`src/commands/quota.ts`) uses them; its own `quotaPath` and `resetQuota` go
     (contracts-5: one definition of where the snapshot lives).
   - The usage-limit wait in the shepherd ends early only when `lastQuotaReset` is later than the moment the wait
     began; it then passes `awaitQuota` as today. A newer snapshot alone no longer ends the wait. Replace
     `quotaCleared` accordingly.
2. **Every confirmed finding is a readiness risk (contracts-1, confirmed).** A skeptic can confirm a finding and lower
   it to LOW; `computeReadiness` (`src/readiness`) then lists it nowhere. Risks are: each confirmed finding, whatever
   its severity; each unverified MEDIUM or HIGH finding; and the existing single line for unverified LOW findings.
   Refuted findings are not risks.
3. **A lens without coverage does not count (contracts-4).** A lens counts as run only when its entry ended `success`
   with a non-null `coverage` and at least one path checked, as SKILL.md says ("A review without coverage counts as
   failed"). Otherwise it is listed as not verified, with the reason.
4. **Dependencies from the whole record.** The readiness item and risks for dependency manifests use
   `integration.manifests` and `integration.depsConfirmed` (added to the record by the orchestrator; another lane
   makes `integrate` fill `manifests` from every commit between the base and the head). Name the merged lanes that
   changed each manifest; a manifest no merged lane changed is listed as changed by a commit arbab did not merge.

## Scope

You own `src/quota/**`, `src/commands/quota.ts`, `src/shepherd/lifecycle.ts`, `src/shepherd/index.ts` (exports only),
`src/readiness/**` and `src/commands/readiness.ts`, with their tests. Change nothing else.

## Facts

- The review's evidence: `src/shepherd/lifecycle.ts:64-73` (`quotaCleared`) and `:244-258` (the wait loop);
  `src/commands/quota.ts:28` (`quotaPath`); `src/quota/quota.ts:11` (`quotaFile`, private);
  `src/readiness/index.ts:91-94` (lenses), `:151-160` (risks), `:113-114` and `:166-170` (manifests).
- `src/review/findings.ts:94` stores the skeptic's corrected severity on a confirmed finding.
- The shepherd reads time through `deps.clock` and the home through `deps.home`; keep it that way.

## Acceptance

- [ ] Each numbered fix, with a test that fails without it: a newer non-holding snapshot that must not end the wait;
      a reset after the wait began that ends it; a reset before the wait that does not; a confirmed LOW finding listed
      as a risk; a lens with empty coverage not counted.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
