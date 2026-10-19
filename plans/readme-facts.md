# Facts for the README pass (plan `readme`)

Real outputs and numbers, captured by the orchestrator from arbab's own runs on 2026-10-18/19. The `arbab ui` pass
(plans `ui` and `ui2`) is the example run. The README may trim these outputs (drop rows, cut a long list with `…`),
but never edits a value or invents a line. Paths are shortened to `~/arbab`: the repository is public.

## 1. A plan, checked

`arbab plan check plans/ui2.json`:

```
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

## 2. The first wave, launched

`arbab plan next plans/ui2.json`:

```
launched ui2-font  run ~/arbab/.arbab/runs/ui2-font  shepherd 20399
launched ui2-scene  run ~/arbab/.arbab/runs/ui2-scene  shepherd 20436
blocked ui2-art  waiting for ui2-font
blocked ui2-hud  waiting for ui2-font
blocked ui2-wire  waiting for ui2-font, ui2-scene, ui2-art, ui2-hud
```

## 3. A lane finishes

`arbab wait --any` (run in the background by the orchestrator; it prints when a lane finishes):

```
ui2-art#1 success 45m37s turns=115 calls=248 failed=12 cost=$15.46 report=~/arbab/.arbab/runs/ui2-art/attempt-1/report.json
```

## 4. Status

`arbab status ui2-font ui2-scene ui2-art ui2-hud ui2-wire ui2-polish ui2-pay ui2-fix ui2-review-security ui2-verify`:

```
lane                 state               attempt  elapsed  turns  calls  last tool  effort  failed  cost    quota
ui2-font             finished (success)  1        7m40s    18     28     Bash       high    1       $1.27   5h 34% · 7d 62%
ui2-scene            finished (success)  1        11m02s   31     51     Bash       high    2       $2.58   5h 35% · 7d 62%
ui2-art              finished (success)  1        45m37s   115    248    Bash       high    12      $15.46  5h 65% · 7d 67%
ui2-hud              finished (success)  1        24m02s   64     107    Bash       high    3       $7.38   5h 50% · 7d 65%
ui2-wire             finished (success)  1        24m59s   124    262    Bash       high    11      $10.30  5h 82% · 7d 70%
ui2-polish           finished (success)  1        8m54s    29     45     Bash       high    2       $1.64   5h 87% · 7d 72%
ui2-pay              finished (success)  1        7m55s    29     54     Bash       high    3       $1.35   5h 90% · 7d 72%
ui2-fix              finished (success)  1        8m21s    45     88     Bash       high    3       $2.94   5h 91% · 7d 72%
ui2-review-security  finished (success)  2        2m33s    23     39     Grep       high    1       $1.77   5h 92% · 7d 73%
ui2-verify           finished (success)  2        1m34s    4      3      Bash       low     0       $0.00   5h 92% · 7d 72%
quota: 5h 93% (resets 11:20Z) · 7d 73% (resets Oct 21 10:00Z)
```

Costs are Claude Code's API-equivalent estimates; the runs were on a subscription. "failed" counts tool calls that
failed, refusals by the fence included; `summary.json` splits them by cause.

## 5. Integration

`arbab integrate ui2 --plan plans/ui2.json`:

```
merged ui2-font 5b75f913e3e6ee406f3b63080b596d360d3906a3
merged ui2-scene 849e12a888014de8d7aed8a33518589dc5cf38d7
merged ui2-art a75312440e7a7a5269ac1f427a3a5b60189a7570
merged ui2-hud c1394dfed9827a88b802365187699ab5c1e2ab98
merged ui2-wire 973e88ef59097e2f018c2336611443e4312d85c2
head 2016972fe34166fb7addfb9aa44078218ca9f310  (integrate/ui2 in ~/arbab/.arbab/worktrees/integrate-ui2)
```

## 6. Verification, inside the fence

`arbab verify ui2`:

```
launched ui2-verify; waiting
exit 0    gate   pnpm typecheck
exit 0    gate   pnpm test
exit 0    gate   pnpm build
verify ui2: passed at 2eee5ebfb9021b5214ad39f0be0e18bc9bb6e96d (lane ui2-verify success)
```

## 7. Review: lenses, then skeptics

`arbab review ui`, the first review round of the first `arbab ui` integration, with the findings' titles cut:

```
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
refuted (0)
unverified (6)
  …
```

Two lenses found the stale `plugin/` independently. Every confirmed finding was fixed by a fix lane before landing.
The second round on the fixed head confirmed one more MEDIUM (a browser opener that failed was reported as opened, so
the session token was never shown), also fixed before landing.

## 8. Readiness

`arbab readiness ui2` writes `readiness.md`; its head:

```
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

It ends with `Ready to land: yes`. Between them it lists the skipped checks (none here) and every risk: unverified
findings, and the workers' own open questions and "not verified" notes.

## 9. Landing: the human's yes

`arbab land ui2`, after the owner said yes:

```
landed ui2: 2eee5ebfb9021b5214ad39f0be0e18bc9bb6e96d into main as be2be12beb53e8f59cfca733ac579a6e1e42124a
Not pushed. To publish: git push origin main
removed worktree ~/arbab/.arbab/worktrees/ui2-font
removed worktree ~/arbab/.arbab/worktrees/ui2-scene
…
removed worktree ~/arbab/.arbab/worktrees/integrate-ui2
deleted branch arbab/ui2-review-contracts
…
deleted branch integrate/ui2
```

## 10. Watching it

`arbab ui` (the skill starts it in the background before the first launch):

```
arbab ui: arbab at http://127.0.0.1:4370/ (opened in your browser)
read-only; Ctrl-C stops it
```

Pictures in the repository: `docs/ui/page.png` (the whole dashboard), `docs/ui/day.png`, `docs/ui/night.png` and
`docs/ui/capstone.png` (the scene).

## 11. Numbers

- The method's first measurement (REQUIREMENTS.md §1, and the skill): the same 7 lanes finished 0 of 7 in 73 minutes
  as Workflow agents inside one session, and 7 of 7 in 1.9–6.4 minutes each as headless workers. This was not a
  controlled benchmark:
  - the Workflow run was stopped at 73 minutes;
  - 5 of the 7 headless lanes started from digests of the stopped work;
  - the two that did not were still among the fastest.

  Approval waits took 62–70% of the Workflow's wall time.
- arbab's own build, milestones M1–M3: 146 worker attempts, 5,091 tool calls. 1.3% of those calls were refused by the
  fence (hand-made fences on other machines measured 5.8–15%), at about $225 API-equivalent on a subscription. M3 went
  through 14 review rounds, 10 with all three lenses. Its review lanes found, and its fix lanes closed, two paths by
  which worker code could have run on the host.
- `arbab ui` itself was built the same way, in two plans (`ui`, then `ui2`, the game-studio pass): 46 worker attempts,
  2,177 tool calls, about $105 API-equivalent on a subscription.
