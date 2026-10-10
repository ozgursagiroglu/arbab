# M3 · the landing commands (integrate, verify, review, readiness, land)

## Task

`src/integrate`, `src/verify`, `src/review` and `src/readiness` are merged on this branch. Add the commands of
DESIGN.md §17, one file each in `src/commands/`, registered in the dispatcher and in `--help`, each with `--json`.

1. **`arbab integrate <name> (--lanes a,b,… | --plan <plan.json>) [--deps-installed]`**:
   - lanes come from `--lanes` in the order given, or from the plan's phases in wave order;
   - call `integrate` with the context's git, `runArgv`-style runner and clock, then print the merged lanes, the
     head, and the manifest changes with what the human must do;
   - `--deps-installed` (alone, without lanes) calls `confirmDeps`.
2. **`arbab verify <name> [--timeout-min N]`**:
   - refuse while `depsConfirmed` is false and a lane changed a manifest;
   - write the brief (`verifyBrief`) and the lane file (`verifyLaneSpec`) under the integration dir;
   - launch through the same path as `arbab launch`, then wait for that lane;
   - parse its latest attempt's stream and compute `gateResults`;
   - write `verify.json` (`verifyRecord`, with the integration head) and print each command with its exit code.

   Exit 0 when passed, 1 otherwise, 3 on a wait timeout. Gates that are not configured: usage error.
3. **`arbab review <name> [--lenses a,b] [--timeout-min N]`**:
   - lenses default to `lensNames(config.review.lenses)`; the diff base is the integration record's `baseSha`;
   - launch one reviewer lane per lens (`reviewLane`), wait for all, and `collectFindings` from their `report.json`;
   - for each lens with MEDIUM+ findings, launch its skeptic lane (`skepticLane`; its schema goes to a file next to
     the brief and the lane's `schema` field points at it), wait, and `applyVerdicts`;
   - write `review.json` and print the findings by verdict.
4. **`arbab readiness <name> [--tier low|medium|high] [--waive id,…]`**:
   - read the records;
   - read each merged lane's latest `report.json`;
   - `computeReadiness` (tier default `config.landing.tier`; lenses = `lensNames`; smoke configured =
     `config.verify.smoke !== null`);
   - write `readiness.json` and `readiness.md` (`renderReadiness`), and print the Markdown.

   Exit 0 when ready, 1 otherwise.
5. **`arbab land <name>`**:
   - refuse (exit 1) unless `readiness.json` exists, is `ready`, and its head equals the integration head;
   - refuse unless the main checkout (the project root) is on `config.baseBranch` with a clean
     `git status --porcelain`;
   - merge `integrate/<name>` into it with `--no-ff` and the message `Land <name>`;
   - write `landing.json` (`pushed: false`), and print the merge sha plus "Not pushed. To publish: git push <remote>
     <baseBranch>" (remote from `git remote`, or "no remote configured").

   It never pushes.
6. **End-to-end test** (`test/e2e/landing.test.ts`, through the bundle with the fake claude):
   - two implementer lanes run and succeed;
   - `integrate` merges both;
   - `verify` with fake gates. The fake claude replays a fixture whose Bash calls match the gate command lines, so
     you will need a fixture that contains those exact commands; build it in the test;
   - `readiness --tier low` is ready;
   - `land` merges into `main`, and `landing.json` says not pushed.

   Also cover a `land` refusal when readiness is missing, and a `verify` refusal on unconfirmed manifest changes.
7. **Skill.** In `skills/arbab/SKILL.md`, the Review and Land sections use these commands. Readiness and its tiers
   are the FR-21 report. The rule that verification runs inside the fence, never on the host, is stated with its
   reason (it runs worker-written tests). Keep SKILL.md under 400 lines; update `src/skill.test.ts` if needed.

8. **Account switches.** The usage limit is per account, and an owner may switch accounts when one is full (machine
   2 did). A snapshot in `~/.arbab/quota.json` from the old account would then hold every lane until that account's
   reset.
   - `arbab quota --reset` deletes the snapshot and prints that it did. The next worker's rate-limit events write a
     fresh one.
   - In the shepherd, a lane in `waiting-reset` re-reads the quota every `holdPollMs`. It resumes as soon as the
     snapshot is gone, or a newer one no longer holds, instead of sleeping until the old `resetsAt`. Held lanes
     already re-check; keep that.
   - Test both, including an early resume after a reset.

## Scope

You own `src/commands/**`, `src/cli.ts`, `test/e2e/**`, `test/fake-claude/**`, `skills/**` and `src/skill.test.ts`,
plus the waiting-reset loop in `src/shepherd/lifecycle.ts` (item 8 only). Change nothing else; report gaps in the
four new modules.

## Facts

- The four modules' exports are in their `index.ts`. `IntegrationRecord`, `VerifyRecord`, `ReviewRecord`,
  `ReadinessReport` and `LandingRecord` are in `src/types.ts`. The config has `verify.smoke`, `review.lenses` and
  `landing.tier`.
- `launchLane` in `src/commands/launch.ts` takes the launch lock and waits for the shepherd's first state. Reuse it
  and the registry's wait helpers; do not start shepherds another way.
- Worker environments are scrubbed: e2e tests pass `FAKE_CLAUDE_*` through the test config's `passEnv`.

## Acceptance

- [ ] Every command, with unit tests (injected context) and the e2e test above.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
