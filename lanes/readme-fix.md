# README · fix the accuracy review's findings (integration readme)

## Task

`arbab review readme --lenses accuracy` found five places where the new `README.md` says more than the code does.
Apply the eight replacements below to `README.md`, exactly as written. Each "Old" block is the current text, character
for character; replace it with its "New" block. Change nothing else.

1. accuracy-1 (MEDIUM), "Safe by construction". An allowed command such as `pnpm test` still runs code the worker
   wrote, and a `sandbox-auto` lane has no Bash allowlist (`src/profile/compile.ts:24-25`, DESIGN.md §4).

   Old:

   ```md
   - **An allowlist of project commands.** The lint refuses "any code" prefixes such as bare `node` or `pnpm`, so an allow
     rule cannot run whatever the worker writes.
   ```

   New:

   ```md
   - **An allowlist of project commands.** The lint refuses "any code" prefixes such as bare `node` or `pnpm`. An allowed
     command can still run code the worker wrote (`pnpm test` runs its tests), so the sandbox is what contains that code.
     A lane can opt into the `sandbox-auto` fence, which drops the allowlist and leaves the sandbox as the only wall.
   ```

2. accuracy-2 (LOW), "Reviews that try to prove you wrong". The CLI does not check who passes `--waive`; the skill
   waives only when the human names the item.

   Old:

   ```md
   - **Only you can waive a skipped check.** `land` refuses while one is left.
   ```

   New:

   ```md
   - **A skipped check blocks the landing.** `land` refuses while one is left, unless it is waived by its id. The skill
     waives one only when you name it.
   ```

3. accuracy-2, "What arbab is not". The approval is the skill's, not a CLI check.

   Old:

   ```md
   - **Not an autonomous deploy bot.** Workers cannot push or deploy. Landing needs your yes, and `land` never pushes.
   ```

   New:

   ```md
   - **Not an autonomous deploy bot.** Workers cannot push or deploy. The skill lands only on your yes, and `land` never
     pushes.
   ```

4. accuracy-2, the FAQ answer "How is it different from orchestrators that review before merging?". Same point, and
   no claim about what other tools lack.

   Old:

   ```md
   each batch of worktree agents before merging. arbab adds two things: every worker runs behind Claude Code's sandbox,
   and nothing lands until you say yes.
   ```

   New:

   ```md
   each batch of worktree agents before merging. In arbab, every worker also runs behind Claude Code's sandbox, and the
   skill lands nothing until you say yes.
   ```

5. accuracy-2, the FAQ answer "Is it safe to let workers run unattended?".

   Old:

   ```md
   outside that fence, and nothing lands without your approval. See [Safe by construction](#safe-by-construction).
   ```

   New:

   ```md
   outside that fence, and the skill lands nothing without your approval. See
   [Safe by construction](#safe-by-construction).
   ```

6. accuracy-3 (LOW), "Get started". `claude plugin marketplace update` refreshes the catalog only; the installed plugin
   updates with `claude plugin update <plugin>@<marketplace>`.

   Old:

   ```md
   with zero runtime dependencies. To update: `claude plugin marketplace update arbab`.
   ```

   New:

   ```md
   with zero runtime dependencies. To update, refresh the marketplace with `claude plugin marketplace update arbab`, then
   run `claude plugin update arbab@arbab`.
   ```

7. accuracy-4 (LOW), "Get started", step 1. The skill's section covers the fields that matter first, not every field.

   Old:

   ```md
      The skill's "Before the first launch" section explains every field. [arbab.config.json](arbab.config.json) is
      this repository's own.
   ```

   New:

   ```md
      The skill's "Before the first launch" section explains the fields that matter first.
      [arbab.config.json](arbab.config.json) is this repository's own.
   ```

8. accuracy-5 (LOW), the Commands table row for `cleanup`. HELP says `--worktrees` also deletes landed integrations'
   branches.

   Old:

   ```md
   | `cleanup [--worktrees]` | Reaps orphans and releases stale pool entries. `--worktrees` also removes finished lanes' merged, clean worktrees and landed integrations' worktrees. |
   ```

   New:

   ```md
   | `cleanup [--worktrees]` | Reaps orphans and releases stale pool entries. `--worktrees` also removes finished lanes' merged, clean worktrees (lane branches stay) and landed integrations' worktrees and branches. |
   ```

## Scope

`README.md` only. Change nothing else.

## Acceptance

- [ ] Each of the eight Old blocks is gone from README.md and its New block is in its place, with the same
      indentation.
- [ ] No other line of README.md changed.
- [ ] Prose lines stay at 120 characters at most (table rows and code blocks excepted).

## Facts

- The findings, with their evidence, are in `.arbab/integrations/readme/review.json` on the orchestrator's side; the
  task above already decides every change.
- HELP in `src/commands/index.ts` describes `cleanup --worktrees` as removing "finished lanes' merged clean worktrees
  (lane branches stay), and landed integrations' worktrees and branches".
- `research/w0/docs-plugins-sdk.json` quotes the Claude Code docs: "run `claude plugin update <plugin>@<marketplace>`
  in your shell".

## Notes

- This lane changes Markdown only and runs no checks: the integration's verify runs the gates on the result. This
  overrides the project rule's checks for this lane. Never run `pnpm build`.
