# M2 fixes · command-span lint gaps

## Task

The M2 review found gaps in `src/brief/lint.ts`. Fix each one; each fix gets a test that fails without it.

1. **Shell-fence lines are checked for denied commands (R5).** DESIGN.md §16 makes every shell-fence line a
   command span. Apply the denied-command check to them, not only the forbidden-shape check.
2. **Fence tags are case-insensitive (R5).** `Bash`, `SH` and `Shell` are shell fences too.
3. **Command normalisation (R5).** Before checking a command span against the profile:
   - strip leading `NAME=value` environment assignments and a leading `env`;
   - reduce an absolute or relative path in the first word to its basename (`/usr/bin/git` → `git`).

   A command that starts a shell with `-c` (`bash -c`, `sh -c`, `zsh -c`) is a `forbidden-shape` error.
4. **"Run" spans across lines and lists (R6).** A command span is introduced by its paragraph, not only by its own
   line:
   - join the paragraph's lines before testing the text before a span;
   - once a span is a command span, the following spans in the same sentence that are joined by "and", "then" or a
     comma are command spans too (`Run \`pnpm test\` and \`git push\`.` checks both).

   Update the test that pinned the old behaviour.

## Scope

You own `src/brief/lint.ts` and `src/brief/lint.test.ts`. Change nothing else.

## Facts

- The M2 review's evidence names `lint.ts` lines 10–14 (`COMMAND_WORDS`, `SHELL_FENCES`), 37 (`RUN_INTRO`), 40–57
  (`spansWithPrefix`), 71–74 and 108.
- Every `lanes/*.md` with a lane file in this repository must still lint without errors. M1's oldest briefs
  (`m1-cli`, `m1-run`, `m1-shepherd`) have no lane files and are historical.

## Acceptance

- [ ] Each numbered fix, with a test that fails without it.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
