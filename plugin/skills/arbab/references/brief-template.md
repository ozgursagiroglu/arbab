# W2 · per-tenant rate limiting for the public API (src/ratelimit)

## Task

Add a token-bucket rate limiter for the public API and wire it into the request pipeline as middleware. The design
is decided; do not revisit it.

1. `src/ratelimit/bucket.ts`: a pure token bucket. Capacity and refill rate come from the caller; time comes from
   an injected clock, never from `Date.now()` inside the function.

   ```ts
   export interface BucketState { tokens: number; updatedAtMs: number }
   export interface BucketLimits { capacity: number; refillPerSec: number }
   export function take(state: BucketState, limits: BucketLimits, nowMs: number, cost?: number):
     { allowed: boolean; state: BucketState; retryAfterMs: number };
   ```

   `cost` defaults to 1. A refused take leaves `tokens` unchanged and returns the wait until `cost` tokens exist,
   rounded up to whole milliseconds.
2. `src/ratelimit/store.ts`: an in-memory store keyed by tenant id, implementing the existing
   `KeyValueStore<BucketState>` interface from `src/store/types.ts` (read it; do not change it). Entries idle for
   longer than 10 minutes are evicted on access.
3. `src/ratelimit/middleware.ts`: `rateLimit(options)` returning the project's `Middleware` type from
   `src/http/types.ts`. Limits per plan come from `config.rateLimits` (already loaded, see Facts). A refused request
   gets status 429, a `Retry-After` header in whole seconds (rounded up) and the JSON body
   `{"error": "rate_limited"}`. Requests without a tenant id pass through untouched.
4. Register the middleware in `src/http/pipeline.ts` directly after `authenticate` and before `route`. This one
   insertion is the only change allowed outside `src/ratelimit/`.
5. Tests next to each file: `bucket.test.ts`, `store.test.ts`, `middleware.test.ts`. Cover refill across a long
   gap (no overflow above capacity), a cost larger than capacity (always refused, finite `retryAfterMs`), eviction,
   the 429 shape and the pass-through.

## Scope

- `src/ratelimit/**` (new)
- `src/http/pipeline.ts`: the single insertion in step 4

Read anything else; change nothing else.

## Facts

- `config.rateLimits` already exists and is validated: `{ free: {capacity: 60, refillPerSec: 1}, pro: {capacity:
  600, refillPerSec: 10} }` (`src/config/schema.ts`, added in wave 1, commit on main).
- The tenant id is on `req.auth.tenantId` after `authenticate`; its plan is `req.auth.plan` (`src/http/auth.ts`).
- `pnpm test` runs vitest over `src/**/*.test.ts`; on main it passes with 412 tests (run by the orchestrator before
  this wave).
- The test helpers `makeRequest` and `fakeClock` live in `test/helpers.ts`; use them instead of new ones.

## Unverified

- The pipeline may already set `Retry-After` for 503 responses in `src/http/errors.ts`. If it does, reuse that
  helper; if not, set the header in the middleware. Say which in `decisions`.
- Tenants on a plan missing from `config.rateLimits` should probably fall back to `free`. Check whether any such
  plan exists in `src/billing/plans.ts` and report it in `open_questions` rather than inventing a limit.

## Acceptance

- [ ] The three modules and their tests exist, with the signatures above.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` exits 0, including the new tests.
- [ ] `git diff` outside `src/ratelimit/` shows only the pipeline insertion.

## Notes

- A sibling lane (`w2-quota-ui`) owns `src/web/**` and reads the 429 body shape above; do not change it.
- Redis-backed storage is a later wave; keep the store behind the interface so it can be swapped.
