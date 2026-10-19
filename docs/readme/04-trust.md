## Safe by construction

**Workers can write code. They cannot touch your working tree, your git history or your remote.**

Every worker gets:

- **Its own git worktree and branch.** Your checkout is never its working directory.
- **Claude Code's sandbox.** Writes stay in its worktree, and there is no network unless the lane is a researcher. A
  sandbox that cannot start is fatal, never a silent fallback.
- **`dontAsk` permissions with its role's exact tools.** A tool left out of the role does not exist for the worker.
- **An allowlist of project commands.** The lint refuses "any code" prefixes such as bare `node` or `pnpm`, so an allow
  rule cannot run whatever the worker writes.
- **No background shells.**
- **No writes to the repository's shared `.git`.** Git writes are denied, and the runner commits.
- **A scrubbed environment, with credential paths denied.** The environment is built from scratch, and paths such as
  `~/.ssh`, `~/.aws` and `**/.env*` cannot be read or edited.
- **A budget and a clock.** Every attempt has a dollar cap, a wall-clock limit and an idle limit.

On your machine:

- **Tests run in the fence.** `verify` runs the gates in a sandboxed lane without file-editing tools, and the tree must
  be clean after the run.
- **Installs happen only on trusted commits.** The dependency command runs on the host, so it only runs on a commit
  from your base branch or one you confirmed. Worker code is merged after the install.
- **Host git never runs worker code.** No hooks, no `core.fsmonitor`, no submodule recursion. Checkpoints never commit
  nested repositories.
- **Refusals are counted, never retried in secret.** A call the fence refuses shows up in `status`, not as a hidden
  retry.
- **`land` lands only the verified tree, and never pushes.** It prints the push command and leaves it to you.

The workers can work aggressively. Your repository stays under your control. The full threat model and the review
history are in [DESIGN.md](DESIGN.md). Found a hole? See [SECURITY.md](SECURITY.md).

## Reviews that try to prove you wrong

**Don't ask one agent whether its own work is correct.**

- **One reviewer lane per lens:** `correctness`, `security`, `contracts`, or your own from `review.lenses` in the
  config.
- **A depth floor.** Every changed file is read in full, and every finding names a file, a line, a failure scenario
  and evidence.
- **A skeptic lane per lens** tries to refute each MEDIUM or HIGH finding.
- **Verdicts:** each finding ends `confirmed`, `refuted` or `unverified`.
- **A readiness report** lists what was verified, what was skipped, and every risk.
- **Only you can waive a skipped check.** `land` refuses while one is left.

On arbab's own `arbab ui`, the first review round confirmed six findings. The two MEDIUM ones were the same problem,
found by two lenses independently. All six were fixed before landing. Milestone M3 went through 14 review rounds,
and its review lanes found two paths by which worker code could have run on the host.
