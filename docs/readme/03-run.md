## A real run

This is how arbab built part of itself: the `ui2` milestone, the game-studio pass of `arbab ui`, from the first check
to the landing. The outputs are real, trimmed, and their paths shortened. The commands are what the orchestrator ran,
shown as `arbab <command>`; the skill's own form of each is `node "${CLAUDE_PLUGIN_ROOT}/dist/arbab.mjs" <command>`.

**1. Ask for it.** In Claude Code, type `/arbab`, then "Plan this and run it with arbab." The session writes a plan and
one brief per lane.

**2. Check the plan.** `arbab plan check plans/ui2.json` lints every phase and prints the waves.

```text
ui2-font: ok
ui2-scene: ok
ui2-art: ok
ui2-hud: ok
ui2-wire: ok
wave 0: ui2-font, ui2-scene
wave 1: ui2-art, ui2-hud
wave 2: ui2-wire
plan ui2: ok
```

**3. Launch the first wave.** `arbab plan next plans/ui2.json` launches every phase whose dependencies have all
succeeded. The orchestrator runs it again after each finish, so the next wave starts as soon as it can.

```text
launched ui2-font  run ~/arbab/.arbab/runs/ui2-font  shepherd 20399
launched ui2-scene  run ~/arbab/.arbab/runs/ui2-scene  shepherd 20436
blocked ui2-art  waiting for ui2-font
blocked ui2-hud  waiting for ui2-font
blocked ui2-wire  waiting for ui2-font, ui2-scene, ui2-art, ui2-hud
```

**4. Wait for a finish.** The orchestrator runs `arbab wait --any` in the background. It prints a line when a lane
finishes.

```text
ui2-art#1 success 45m37s turns=115 calls=248 failed=12 cost=$15.46 report=~/arbab/.arbab/runs/ui2-art/attempt-1/report.json
```

**5. Look at every lane.** `arbab status`, given the milestone's lanes, prints one row per lane, then the quota.

```text
lane                 state               attempt  elapsed  turns  calls  last tool  effort  failed  cost    quota
ui2-font             finished (success)  1        7m40s    18     28     Bash       high    1       $1.27   5h 34% · 7d 62%
ui2-scene            finished (success)  1        11m02s   31     51     Bash       high    2       $2.58   5h 35% · 7d 62%
ui2-art              finished (success)  1        45m37s   115    248    Bash       high    12      $15.46  5h 65% · 7d 67%
ui2-hud              finished (success)  1        24m02s   64     107    Bash       high    3       $7.38   5h 50% · 7d 65%
ui2-wire             finished (success)  1        24m59s   124    262    Bash       high    11      $10.30  5h 82% · 7d 70%
…
ui2-verify           finished (success)  2        1m34s    4      3      Bash       low     0       $0.00   5h 92% · 7d 72%
quota: 5h 93% (resets 11:20Z) · 7d 73% (resets Oct 21 10:00Z)
```

**6. Integrate.** `arbab integrate ui2 --plan plans/ui2.json` merges the lane branches into `integrate/ui2`, wave by
wave.

```text
merged ui2-font 5b75f913e3e6ee406f3b63080b596d360d3906a3
merged ui2-scene 849e12a888014de8d7aed8a33518589dc5cf38d7
merged ui2-art a75312440e7a7a5269ac1f427a3a5b60189a7570
merged ui2-hud c1394dfed9827a88b802365187699ab5c1e2ab98
merged ui2-wire 973e88ef59097e2f018c2336611443e4312d85c2
head 2016972fe34166fb7addfb9aa44078218ca9f310  (integrate/ui2 in ~/arbab/.arbab/worktrees/integrate-ui2)
```

**7. Verify.** `arbab verify ui2` runs the gates inside the fence, in a lane that has no file-editing tools.

```text
launched ui2-verify; waiting
exit 0    gate   pnpm typecheck
exit 0    gate   pnpm test
exit 0    gate   pnpm build
verify ui2: passed at 2eee5ebfb9021b5214ad39f0be0e18bc9bb6e96d (lane ui2-verify success)
```

**8. Review.** This is `arbab review ui` on the first `arbab ui` integration. One reviewer lane runs per lens, then
skeptics check the findings.

```text
launched ui-review-correctness, ui-review-security, ui-review-contracts; waiting
launched ui-skeptic-correctness, ui-skeptic-security, ui-skeptic-contracts; waiting
correctness  review   ui-review-correctness  success  22 paths
security  review   ui-review-security  success  32 paths
contracts  review   ui-review-contracts  success  20 paths
correctness  skeptic  ui-skeptic-correctness  success
security  skeptic  ui-skeptic-security  success
contracts  skeptic  ui-skeptic-contracts  success
confirmed (6)
  correctness-1  MEDIUM  test/assemble-plugin.test.ts:125  Committed plugin/ was not rebuilt: the marketplace bundle has no `arbab ui` …
  correctness-2  LOW  src/ui/server/snapshot.ts:139  reportStatus and findings come from an older attempt when the latest attempt …
  security-1  LOW  skills/arbab/SKILL.md:178  The skill's background `arbab ui` call writes the session token to disk, …
  contracts-1  MEDIUM  plugin/skills/arbab/SKILL.md:178  Committed plugin/ was not rebuilt: the marketplace install …
  contracts-2  LOW  src/ui/client/scene/scene.ts:57  Preflight probes keep the probed lane's role, so the scene draws them …
  contracts-3  LOW  src/ui/server/snapshot.ts:139  reportStatus and findings come from an older attempt when the newest …
…
```

Every confirmed finding was fixed by a fix lane before landing.

**9. Readiness.** `arbab readiness ui2` writes `readiness.md`. Its head:

```text
# Readiness report — ui2

Tier: medium · Head: `2eee5ebfb9021b5214ad39f0be0e18bc9bb6e96d` · Date: 2026-10-19

## Verified

| Check | Result |
| --- | --- |
| `verify:pnpm typecheck` | gate: exit 0 |
| `verify:pnpm test` | gate: exit 0 |
| `verify:pnpm build` | gate: exit 0 |
| `review:correctness` | lens ran, 27 paths checked |
| `review:security` | lens ran, 27 paths checked |
| `findings` | 0 confirmed, 0 refuted, 3 unverified |
```

**10. Land.** The human said yes, and the orchestrator ran `arbab land ui2`. It merges into `main` and removes the
worktrees. It never pushes.

```text
landed ui2: 2eee5ebfb9021b5214ad39f0be0e18bc9bb6e96d into main as be2be12beb53e8f59cfca733ac579a6e1e42124a
Not pushed. To publish: git push origin main
removed worktree ~/arbab/.arbab/worktrees/ui2-font
…
```

What the fence refuses is in [Safe by construction](#safe-by-construction); how to watch the lanes as they run is in
[Know what your workers are doing](#know-what-your-workers-are-doing).
