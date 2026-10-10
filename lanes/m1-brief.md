# M1 · briefs (src/brief)

## Task

Implement `src/brief/`: parse the orchestrator's brief source, assemble the worker's full prompt, and lint the
brief. DESIGN.md §5 is the specification. Pure functions only.

Export from `src/brief/index.ts`:

1. `parseBriefSource(markdown: string): BriefSource` — `title` from the first `# ` heading (empty string if none);
   sections from `## <Name>` headings where Name is a `BriefSectionName` (exact, case-sensitive). Text under an unknown
   `## X` heading is appended to `Notes` as `### X` followed by its text. Section text is trimmed; headings inside
   fenced code blocks are not headings.
2. `unknownSections(markdown: string): string[]` — the unknown `##` heading names, for lint.
3. `matchesBashRule(command: string, rule: string): boolean` — Claude Code's matching for one rule: `Bash(p)`
   matches exactly `p`; `Bash(p *)` and `Bash(p:*)` match `p` followed by a space and anything; `Bash` and `Bash(*)`
   match everything. Leading and trailing whitespace of the command is ignored. Non-Bash rules never match.
4. `isAllowedCommand(command: string, allow: string[], deny: string[]): boolean` — denied if any deny rule matches;
   otherwise allowed if any allow rule matches. Compound commands (`&&`, `||`, `;`, `|`, `&`, newline) are allowed
   only if every part is allowed (split naively on those separators; quotes are not interpreted — a brief should not
   need compound commands anyway).
5. `describeSchema(schema: JsonSchema | null): string` — a Markdown bullet list of the fields the final JSON must
   contain: name, type (`string[]`, `integer`, `"done" | "partial" | "blocked"`), `(optional)` for non-required
   fields, nested object fields indented under arrays of objects. For null: "Your final answer is a short summary of
   what you did and what you could not do."
6. `toolBelt(profile: CompiledProfile, leases: Lease[], bashMaxTimeoutMin: number): string` — Markdown:
   - the allowed shell commands, derived from `profile.settings.permissions.allow`: `Bash(p)` → `` `p` `` and
     `Bash(p *)` → `` `p …` ``, merged per prefix;
   - the file tools in `profile.tools`;
   - for fence `sandbox-auto` (`autoAllowBashIfSandboxed`), a line saying shell commands run inside the sandbox
     without an allowlist;
   - "one command per call, in the foreground";
   - the refused shapes, each with the alternative to use:
     - `cd X && …`: commands already run in the worktree;
     - `&&`, `;` and pipes into `tail`/`head`: run single commands and read the full output;
     - `$(…)` and `echo $?`: the tool reports the exit code;
     - `sleep N`: set the Bash `timeout` parameter, up to `<bashMaxTimeoutMin>` minutes;
     - background processes: refused;
   - leases as `ARBAB_<TYPE>_<i>` with their values (use `envSuffix` from `src/util/names`);
   - a "do not try" list built from the denies: git writes (the runner commits), network and web tools, files outside
     the worktree, credential files.
7. `assembleBrief(source: BriefSource, ctx: BriefContext): string` — the full prompt, in this order:
   - `# <title>`;
   - `## Role and isolation` (generated; below);
   - `## Project rules` (each `ctx.instructions` item as `### <path>` + content);
   - the source's `Task`, `Scope`, `Facts`, `Unverified`, `Acceptance` and `Notes`, each only when non-empty;
   - `## Tool belt` (`toolBelt`);
   - `## Coordination` (when `ctx.coordination`);
   - `## Upstream reports` (when `ctx.upstream` is non-empty, `### <lane>` + summary);
   - `## Report` (`describeSchema(ctx.schema)` + "End with that JSON object as your final answer.").

   The generated `Role and isolation` text says:
   - the role;
   - "you run headless; nobody will answer questions — decide, and report what you could not decide";
   - the worktree path and branch;
   - work only inside the worktree;
   - shell commands run in an OS sandbox: no network, no writes outside the worktree and the temp directory,
     credential files unreadable (mention loopback only when `profile.settings.sandbox.network.allowLocalBinding`);
   - "you cannot commit, push or switch branches; the runner commits your work when you finish";
   - "a refused command costs you one turn; do not retry it, use the tool belt";
   - role specifics: reviewer — "you cannot edit files; report findings with evidence"; researcher — "you have only
     web tools; cite a source for every claim"; probe — "run each step exactly as written".
8. `lintBrief(markdown: string, source: BriefSource, profile: CompiledProfile): LintIssue[]`:
   - errors:
     - `missing-section`: Task, Scope or Acceptance is missing or empty;
     - `forbidden-shape`: inline code or a fenced code line containing `cd `, `&&`, `||`, `;`, `$(`, `` ` ``
       (nested), `sleep `, `echo $?`, `| tail`, `| head` or `run_in_background`;
     - `denied-command`: an inline code span that starts with a command word (`git`, `pnpm`, `npm`, `npx`, `node`,
       `yarn`, `bun`, `curl`, `wget`, `ls`, `cat`, `rm`, `mv`, `cp`, `mkdir`, `make`, `python`, `python3`, `docker`,
       `gh`) and that `isAllowedCommand` rejects for the profile;
   - warnings:
     - `unknown-section`;
     - `long-brief`: over 40 000 characters.

## Scope

You own `src/brief/**` (code and tests). Change nothing else.

## Facts

- Workers do not load CLAUDE.md (w0: transcript evidence), so `Project rules` is how project conventions reach them.
- Measured refusal costs: machine 1 lost 10 of 64 calls to a strict fence, machine 2 lost 5.8–7.1%. Most were
  shapes a brief can prevent: `cmd; echo EXIT=$?`, `cd … && …`, `sleep N; …`, compound loops.
- Claude Code splits compound commands on `&&`, `||`, `;`, `|`, `|&`, `&` and newlines; an allow rule must match
  every part; a deny matches if any part matches (w0 docs research).
- `lanes/*.md` in this repository are real brief sources (this one included); `parseBriefSource` must parse them.

## Acceptance

- [ ] Every export above, using `src/types.ts` and `src/util/*` unchanged.
- [ ] Tests:
  - parsing (headings, unknown sections, headings inside code fences, and every `lanes/m1-*.md` file of this
    repository);
  - rule matching (exact, wildcard, `:*`, bare);
  - compound commands, and deny over allow;
  - `describeSchema` for a nested schema;
  - `toolBelt` for strict and sandbox-auto profiles with leases;
  - `assembleBrief` section order and the role specifics;
  - every lint code, positive and negative.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.

## Notes

- Build test profiles as literal `CompiledProfile` objects; `src/profile` is written in parallel by another lane
  and is not available to you.
