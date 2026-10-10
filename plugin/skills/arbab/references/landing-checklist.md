# Landing checklist

Landing is where fast runs skip checks silently. Work through every step; anything that does not run shows up in
the readiness report as skipped, and only the human may waive it. `arbab <cmd>` is the runner, typed in full as in
the skill. Every record lives in `.arbab/integrations/<name>/`.

## 1. Collect

- [ ] Every lane of the wave is `finished`, and its end state is `success` (or you decided otherwise and wrote
      down why).
- [ ] Each `report.json` read: `status`, every `checks[]` exit code, `decisions`, `open_questions`,
      `not_verified`. A `done` whose own checks show a non-zero exit code is not done.
- [ ] Each lane's diff stays inside its `## Scope`: `git diff --stat <base>...arbab/<lane>`.

## 2. Integrate

- [ ] `arbab integrate <name> --lanes a,b,…` (or `--plan plans/<p>.json`): each lane branch is merged by its
      commit (`--no-ff`) into `integrate/<name>`, in `.arbab/worktrees/integrate-<name>`, never in the main
      checkout. Dependencies are installed there once, on the trusted base, before any merge.
- [ ] A conflict aborts the merge and names the paths; the lanes before it stay merged. A conflict between lanes
      means the plan's scopes overlapped: note it, fix the branches, integrate again.
- [ ] A lane that changed a dependency manifest (`package.json`, lockfiles, `.npmrc`, …) is merged but not
      installed: installing would run worker code on the host. The **human** reviews the change and what an install
      runs, installs it in the integration worktree, then runs `arbab integrate <name> --deps-installed <sha>` (the
      head it printed); the orchestrator never does either. `verify` refuses until then.

## 3. Verify

- [ ] `arbab verify <name>` after every `integrate`. It runs every config `gates` argv, then `verify.smoke`, in a
      probe lane `<name>-verify` on the integration head, inside the fence. Never run the gates on the host: they
      run worker-written tests.
- [ ] Every command shows `exit 0` in `verify.json`. A command whose call is missing from the stream counts as a
      failure. Lane-level green is not repo-level green: every lane's tests have passed while the integration
      branch failed the repository's boot-smoke gate.
- [ ] What mocks cannot cover for the risk tier (a real database, an eval on the changed path, the changed page
      opened in a browser) goes under risks unless it ran.

## 4. Review

- [ ] `arbab review <name>`: one reviewer lane per lens with a depth floor, evidence per finding and a `coverage`
      section, then a skeptic lane per lens with MEDIUM+ findings. A lens without coverage counts as failed.
- [ ] Every testable finding was settled by a deterministic probe lane (steps with command, exit code and
      output). Each confirmed finding is fixed (a new lane, then integrate and verify again) or stays a risk.

## 5. Readiness report

- [ ] `arbab readiness <name> --tier <low|medium|high>` (default config `landing.tier`) writes `readiness.json`
      and `readiness.md`:
      - **verified**: each gate and smoke command with its exit code, the lenses that ran, the verdicts;
      - **skipped**: what the tier requires that did not run or pass. `low`: verify; `medium`: verify and one
        lens; `high`: verify, every lens, the skeptic pass and smoke. Each has an id for `--waive`, except
        `verify`, which must pass;
      - **risks**: confirmed and unverified findings, every open question and `not_verified` item of the merged
        lanes, manifest changes, a stale verify or review.
- [ ] Add what arbab cannot see when you present it: facts found in live data (read-only queries written by
      workers and run by you, never by workers), evals not re-run, pages not opened.

## 6. Ask the human

- [ ] Present `readiness.md` and ask whether to land. Waive a skipped item only when the human names it:
      `arbab readiness <name> --waive <id>,…`.
- [ ] On a yes, `arbab land <name>`. It refuses unless readiness is ready for the integration head and verify
      passed there, and unless the main checkout is on the base branch, clean, and contained in the verified head
      (a base that moved is merged into the integration first, with hooks off as `land` prints, then checked again).
      It merges `--no-ff` and records
      `landing.json` with `pushed: false`.
- [ ] Push and deploy are human actions: `land` never pushes. Say so, with the push command it printed.
- [ ] After landing, verify the base branch once more, inside the fence (a probe lane based on it that runs the
      gates), and record the exit codes. M1's landing found a test that failed only on `main`.
- [ ] `land` removes the worktrees of what it landed (unless `--keep-worktrees`) and the generated lanes' and the
      integration's branches; lane branches stay, because later plan phases merge them by name. Lanes that were
      never landed: `node "${CLAUDE_PLUGIN_ROOT}/dist/arbab.mjs" cleanup --worktrees` removes those that are
      finished, clean and merged. arbab never removes a worktree with uncommitted changes or an unmerged branch.
