# README · the hero (plan readme)

## Task

Write `docs/readme/01-hero.md`, the top of arbab's new README, as [plans/readme.md](../plans/readme.md) decides
(read its "The outside review" table and "The new README" section 1). In this order:

1. `# arbab`, then the tagline as a bold line: **Turn one Claude Code session into a controlled engineering team.**
2. A lead of at most three sentences, saying:
   - give arbab a large engineering task;
   - your interactive Claude Code session splits it into independent lanes and runs each as a headless Claude Code
     worker, in parallel, in its own git worktree behind a sandbox;
   - arbab then verifies the result inside the fence, has it adversarially reviewed, and prepares a merge that lands
     only when you say yes.
3. The one-line summary in bold: **Parallel lanes · isolated worktrees · sandboxed workers · human-controlled
   merges**.
4. The four badges, copied as they are from the current `README.md` (lines 10–13).
5. The hero picture: `![…](docs/ui/page.png)`. The alt text says what it shows: the `arbab ui` dashboard, with workers
   building a pyramid, the crew, the chronicle and the ledger.
6. A small flow diagram in a `text` code block, at most 6 lines and 100 columns wide: you, then your Claude Code
   session with arbab, fanning out to three workers, joining into verify, review, "you approve", merge.
7. The name, as a blockquote of two lines: "*arbab*: master, the one who gives the orders." and "You give the order.
   arbab runs the team. Claude writes the code."
8. One closing paragraph of at most two sentences. arbab does not replace Claude Code: it gives your session a
   controlled way to delegate real engineering work, and every worker is the unmodified `claude` binary under your
   own login.

## Scope

`docs/readme/01-hero.md` (new). Change nothing else.

## Facts

- The current `README.md`: lines 1–15 are today's hero (title, tagline, badges, the name's quote).
- `docs/ui/page.png` exists: a browser screenshot of the dashboard.
- Workers are `claude -p` processes of the user's own binary and login (DESIGN.md §1, "CLI vs Agent SDK"; the FAQ
  answer "Does it work with a Claude subscription or the API?").
- "Verified inside the fence", "adversarially reviewed" and "lands only when you say yes" are `arbab verify`,
  `arbab review` (lenses, then skeptics) and `arbab land`, which never pushes (DESIGN.md §17).

## Acceptance

- [ ] The file docs/readme/01-hero.md holds items 1–8, in that order.
- [ ] It makes no claim beyond the facts above and plans/readme.md.
- [ ] Prose lines are wrapped at 120 characters at most.

## Notes

- Style:
  - plain, concrete English; short sentences; active voice;
  - no hype words (revolutionary, seamless, powerful, blazing, cutting-edge) and no emoji.
- This lane writes one Markdown file and runs no checks: the integration's verify runs the gates on the result. This
  overrides the project rule's checks for this lane. Never run `pnpm build`.
