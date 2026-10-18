# UI · the scene: from snapshots to a living world (src/ui/client/scene)

## Task

Implement `createScene(options): Scene` (types in `src/ui/client/model.ts`) as DESIGN.md §19 "Scene" describes:
the logic that turns the server's snapshots into workers, blocks, a capstone, a sky and coins, and animates them. It
is pure TypeScript for the browser: no DOM, no timers, no `Date.now()`, no `node:` imports. Time comes only from
`snapshot.now` and `step(dtMs)`; randomness only from `options.random`. A sibling lane draws the World; you never
draw. The design is decided; build it as written.

1. **`layout.ts`**: geometry, all integer pixels.

   ```ts
   export interface Slot { x: number; y: number; w: number; h: number; course: number }
   export interface PyramidLayout { base: number; blockW: number; blockH: number; slots: Slot[]; apex: { x: number; y: number } }
   export function pyramidLayout(lanes: number): PyramidLayout;
   export function campSeat(i: number): { x: number; y: number };
   /** i = 0 is the newest landed integration. */
   export function farPyramidPlace(i: number, lanes: number): { x: number; y: number; height: number };
   /** Where a worker stands to work on a slot: its feet on the slot's bottom edge, at its center. */
   export function workSpot(slot: Slot): { x: number; y: number };
   ```

   - `base` = max(4, the least b with b(b+1)/2 ≥ lanes).
   - Block size:
     - `blockW` = min(32, floor(maxWidth / base)), rounded down to even;
     - `blockH` = min(blockW / 2, floor(maxHeight / base));
     - then `blockW` = min(blockW, 2·blockH).
   - Course k (0 is the bottom) has base − k slots. Slot j's x = centerX − (base − k)·blockW/2 + j·blockW, and its
     y = baseY − (k + 1)·blockH. Slots are ordered course 0 left to right, then course 1, and so on.
   - `apex` = (centerX, baseY − base·blockH).
   - `campSeat(i)`, with i taken modulo columns·rows:
     - row = floor(i / columns), col = i % columns;
     - x = camp.x + col·step + row·step/2, y = camp.y + row·rowStep.
   - `farPyramidPlace`: x from [452, 418, 386] by i, y = `HORIZON_Y`, height = clamp(round(8 + 0.6·lanes), 8, 22).

2. **`scene.ts`** (`index.ts` re-exports `createScene`; replace the stub there). Export these pure helpers for tests:

   ```ts
   export function castOf(lane: UiLane): Cast;
   export function isBuilder(lane: UiLane): boolean;
   export interface Foreground { lanes: UiLane[]; capstone: UiIntegration | null; capstoneLanded: boolean; far: UiIntegration[] }
   export function foreground(snapshot: UiSnapshot): Foreground;
   /** min(0.95, 1 − e^(−calls/40)) */
   export function fillFor(toolCalls: number): number;
   /** 1 under $1, 2 under $5, else 3: of costDeltaUsd, else costUsd, else 0 → 1. */
   export function rationFor(lane: UiLane): 1 | 2 | 3;
   ```

   - `castOf` and `isBuilder` follow DESIGN.md's cast table. A builder is an implementer, or a verifier with
     `worktreeOf === null`, of kind "lane". The mason of a verifier with `worktreeOf` set works at that lane's block,
     5 px to its right, or at the pyramid's foot when that lane has no block.
   - `foreground`, using `snapshot.now`:
     - `recent` is the newest integration with `landedAt` less than 10 minutes ago.
     - The foreground lanes are the builders whose `integration` is null, not landed, or `recent`, in snapshot order.
     - The capstone is `recent` (`capstoneLanded` true); else the newest by `updatedAt` not landed whose `lanes`
       holds a foreground lane; else null.
     - `far` holds the other landed integrations, newest `landedAt` first, at most 3.
   - **Where workers go** (feet positions):
     - The site's ground line is y = baseY + 2. A target on the pyramid (y < baseY) is reached by walking to its x on
       the ground line, then climbing (pose `climb`) straight up; leaving climbs down first.
     - Walk 28 px/s (carry poses too), slump 18 px/s, climb 16 px/s. Workers face their direction of travel, face −1
       (toward arbab) at the audience spot, and face the pyramid's center while working.
   - **Places by cast**:
     - Builders work at their block's `workSpot`.
     - Scribe and skeptic pick a random slot of the two lowest courses and write there (pose `work`) for 3–6 s, then
       pick another. A skeptic also opens a bubble for 1.2 s every 4–8 s while writing.
     - The surveyor stands at (sledge.x − 14, ground line), measuring (pose `work`).
     - The water carrier walks between the well and a random x along the pyramid's foot, idling 1 s at each end.
     - The scout walks to `PLACES.horizon`, stays hidden (alpha 0) for 6–10 s, comes back to the right half of the
       foot, idles 2 s, and goes again.
   - **Talks with arbab** (the owner's decision: arbab stands at the front and talks to every worker that comes):
     - The worker stands at `PLACES.audience`, facing −1. arbab, worker, arbab each speak for 0.8 s: pose `talk`, a
       bubble with a new seed from `random()`, `open` going 0 → 1 over 0.15 s. Then both bubbles close and arbab is
       idle again.
     - The talk ends with the event `brief` (handing out) or `report` (taking a report).
     - One worker talks at a time. The others wait in line at (audience.x + 12·k, audience.y), k = 1, 2, …, and step
       up in order.
   - **A worker's day**: the numbered list in DESIGN.md §19, exactly.
     - On a state change, the actor's queued steps are replaced by the new state's script from where it stands.
     - A relaunched lane (live again after `finished`) reuses its actor if it is still on screen, and its block
       becomes `planned` with fill 0; the rubble stays.
     - Builders carry a stone (`carry-stone`) from the talk to their block.
     - At the ration table a worker pauses 0.6 s, then carries `rationFor(lane)` (pose `carry-ration`; 1 on a
       `partial` report), or walks with pose `slump` and ration 0.
     - An actor is removed once it reaches `PLACES.exit`.
     - A lane that leaves the snapshot fades out (alpha to 0 over 1 s) and is removed, and the layout is computed
       again without it.
   - **Strokes**: when a running actor's `toolCalls` grew by d since the last snapshot, it gets min(6, pending + d)
     pending strokes.
     - Each stroke takes 0.4 s: `stroke` goes 0 → 1, and at 0.5 a builder places a stone. The block's fill grows by
       max(0.02, (target − fill) / pending), never past `fillFor(toolCalls)`.
     - Each placed stone makes 3–5 dust particles at the block, sets the block's `flash` to 1 and fires the event
       `stone`.
     - Non-builders' strokes place nothing and fire nothing.
     - When no stroke is pending and the fill is below its target, the fill eases up at 0.2 per second.
   - **Blocks**:
     - The looks are those of `BlockLook`'s comment, by the lane's state and report.
     - `flash` fades by 2 per second.
     - A live fall turns the block's fill into round(fill·8) `stone` particles. They fall with gravity 300 px/s²,
       spread by a random vx in ±40, and add 1 to `rubble` each on reaching baseY (at most 60). The block's fill
       becomes 0 at once and the event `fall` fires.
     - A live set makes fill 1 and flash 1 and fires the event `set`.
     - At the baseline, each fallen block adds 4 rubble.
     - Slots no lane holds are `empty` with `lane: null`.
   - **Capstone**:
     - `waiting` at `PLACES.sledge` with `flag` from `verify` ("passed", "failed", else "none") and `ready` from
       `ready === true`.
     - A live landing goes `hoisting`, moves from the sledge to the apex over 3 s (eased), then `set`. Setting makes
       20 sparkles at the apex, fires the event `capstone`, and has arbab `cheer` for 2 s.
     - A capstone already landed at the baseline is `set` at once. With no integration it is `none`.
   - **Sky**:
     - `night` when `quota.status === "rejected"` and a window's `resetsAt` is in the future; `dusk` when
       `quota.hold.hold`; else `day`.
     - `sun` = clamp(1 − (fiveHour.resetsAt − nowSec)/18000, 0, 1) while the five-hour window is live, else 0.5.
   - **Coins**: min(48, round(6·√(Σ costUsd of the snapshot's lanes))). A live increase makes 1–3 `coin` particles
     above the treasury.
   - **arbab** is always `actors[0]`, id "arbab", lane null, at `PLACES.arbab`, facing 1.
   - **Particles**, at most 300 (the oldest go first):
     - dust: 0.5 s life, vy −10…−30;
     - stone: falls until baseY;
     - sparkle: 0.8 s life, a slow random drift;
     - coin: vy −40, then gravity, 0.6 s life.
   - **Reduced motion**:
     - Moves reach their next waypoint at once and particles are never made.
     - Talks still happen, with bubbles open at once.
     - Fills jump to their targets, and a hoisting capstone is set at once.
   - `pick(x, y)` tries the actors front to back (larger y first). It skips arbab and actors with alpha < 0.1, and
     hits inside `ACTOR_BOX` above the feet. Then it tries the blocks that have a lane. Else null.
   - `highlight(lane)` sets `highlight` on that lane's actor and block and clears it everywhere else.
   - `step(dtMs)` cuts dtMs to 100.

3. Tests: `layout.test.ts`, `scene.test.ts`, and a test-only `testkit.ts` with `UiLane`/`UiSnapshot` builders (sane
   defaults, overrides).

## Scope

`src/ui/client/scene/**`. Read anything else; change nothing else. `src/ui/client/model.ts` and `src/ui/protocol.ts`
are contracts: report a change you need in `open_questions`.

## Facts

- `src/ui/client/model.ts` (on this lane's base) defines World, Actor, Block, Pyramid, Capstone, Sky, Particle,
  SceneEvent, Scene, SceneOptions, `PLACES`, `CAMP`, `PYRAMID_AREA`, `HORIZON_Y`, `ACTOR_BOX` and `ARBAB_BOX`. Their
  comments are part of the spec.
- `src/ui/protocol.ts` defines `UiSnapshot` and friends. The server sorts `lanes` by `firstSeen`, then name.
- The renderer (lane ui-art) draws exactly what the World says. It draws a ladder under a `climb` actor down to the
  ground line, and a plank under a `work` actor standing above the ground line. Its sprites fit the boxes.
- Measured tool-call rates from `summary.json` (2026-10-18):

  | Lane | Tool calls | Minutes |
  | --- | --- | --- |
  | m3-wire | 128 | 17.9 |
  | m3-fix-integrate | 69 | 8.5 |
  | m3-package | 30 | 2.1 |
  | m3-review-security | 44 | 5.0 |

  That is roughly one call every 4–8 s, while snapshots come about once a second.
- The same runs cost $7.61, $2.52, $0.45 and $1.88, so the three ration tiers all occur.
- The project's tsconfig has no DOM lib, and vitest runs in node; the scene needs neither.

## Acceptance

- [ ] `createScene` and the helpers above exist and follow DESIGN.md §19 "Scene" and this brief.
- [ ] Tests cover:
      - `pyramidLayout` for 0, 1, 10, 11, 15, 16, 78, 79 and 300 lanes: no overlaps, inside `PYRAMID_AREA`,
        base − k slots per course, integer coordinates, the apex above the top course;
      - `foreground`: builders, verifiers in other worktrees, generated and preflight lanes, landed integrations going
        far, a recent landing kept with its capstone, at most three far pyramids, the capstone's integration;
      - `castOf` for every role and kind;
      - the baseline per state (no walks; no actor for finished lanes; block looks; rubble);
      - a builder's whole live day (queued → running with five calls → finished success with a $2 cost), checking
        the poses and places in order, the events `brief`, `stone`×5, `set` and `report`, a fill that never
        decreases, ration 2, and removal at the exit;
      - a failure (`fall`, rubble from stone particles, slump, ration 0);
      - partial and blocked reports;
      - waiting-reset (zzz); held for the quota (hourglass) and for a slot (dots); orphaned (ghost, question);
      - the stroke cap with +20 calls;
      - the talk queue with two arrivals;
      - a relaunch after a failure; a lane leaving the snapshot;
      - the capstone (waiting flags, hoisting, set within about 3 s of steps, the event, arbab cheering);
      - the sky phases and the sun; the coins;
      - reduced motion; `pick` and `highlight`;
      - determinism: the same inputs and seeded random give deep-equal worlds.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `git diff` touches only `src/ui/client/scene/**`.

## Notes

- **Do not run `pnpm build`** (this overrides the project rule for this lane). It rewrites the tracked `plugin/`,
  and three lanes' bundles would conflict at integration. The orchestrator rebuilds `plugin/` after integration.
- Keep the scene's private state (step queues, timers, last snapshot) in closures or maps. The World is the only
  output, and the renderer reads it every frame.
- The numbers (speeds, durations, caps) are decided. If a test shows one is wrong, change it, and say so in
  `decisions`.
