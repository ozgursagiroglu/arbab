# README · safe by construction, and reviews that try to prove you wrong (plan readme)

## Task

Write `docs/readme/04-trust.md`, sections 6 and 7 of arbab's new README, as [plans/readme.md](../plans/readme.md)
decides.

1. `## Safe by construction`:
   - Open with: **Workers can write code. They cannot touch your working tree, your git history or your remote.**
   - "Every worker gets", as bullets:
     - its own git worktree and branch;
     - Claude Code's sandbox, so writes stay in its worktree, there is no network unless the lane is a researcher,
       and a sandbox that cannot start is fatal;
     - `dontAsk` permissions with its role's exact tools;
     - an allowlist of project commands, where lint refuses "any code" prefixes such as bare `node` or `pnpm`;
     - no background shells;
     - no writes to the repository's shared `.git`;
     - a scrubbed environment, with credential paths denied;
     - a budget and a clock.
   - "On your machine", as bullets, from today's "Safety model":
     - tests run in the fence;
     - installs happen only on trusted commits;
     - host git never runs worker code;
     - refusals are counted, never retried in secret;
     - `land` lands only the verified tree and never pushes.
   - End with: "The workers can work aggressively. Your repository stays under your control." Then link
     [DESIGN.md](DESIGN.md) and [SECURITY.md](SECURITY.md).
2. `## Reviews that try to prove you wrong`:
   - Open with: **Don't ask one agent whether its own work is correct.**
   - Bullets:
     - one reviewer lane per lens (correctness, security, contracts, or your own from the config);
     - a depth floor: every changed file read in full, and every finding with a file, a line, a failure scenario and
       evidence;
     - a skeptic lane per lens that tries to refute each MEDIUM or HIGH finding;
     - the verdicts: confirmed, refuted or unverified;
     - the readiness report: verified, skipped and risks;
     - only you can waive a skipped check.
   - Proof, from `plans/readme-facts.md` §7 and §11, in one short paragraph:
     - on arbab's own `arbab ui`, the first round confirmed six findings, two of them MEDIUM and found by two lenses
       independently;
     - all were fixed before landing;
     - M3 went through 14 review rounds, and its review lanes found two paths by which worker code could have run on
       the host.

## Scope

`docs/readme/04-trust.md` (new). Change nothing else.

## Facts

- DESIGN.md §4 (the fence, the role presets, the denies), §15 (security notes) and §17 (verify, review, readiness,
  land) are the ground truth; today's `README.md` "Safety model" (lines 185–202) has the current wording.
- `plans/readme-facts.md` §7 and §11 hold the review numbers.

## Acceptance

- [ ] The file docs/readme/04-trust.md holds both sections as above.
- [ ] Every bullet is true of DESIGN.md, and every number matches plans/readme-facts.md.
- [ ] Prose lines are wrapped at 120 characters at most.

## Notes

- Style:
  - plain, concrete English; short sentences; active voice;
  - no hype words (revolutionary, seamless, powerful, blazing, cutting-edge) and no emoji.
- This lane writes one Markdown file and runs no checks: the integration's verify runs the gates on the result. This
  overrides the project rule's checks for this lane. Never run `pnpm build`.
