# M4 · denial telemetry (src/telemetry, `arbab denials`)

## Task

Implement REQUIREMENTS FR-13 as specified in DESIGN.md §18: aggregate refused tool calls across attempts and suggest
what to change. It never edits the config.

1. `src/telemetry/` (export from `index.ts`):
   - `refusalsFromStream(events: unknown[]): Array<{ tool: string; cause: FailureCause; command: string | null }>`:
     - every tool result with `is_error`, classified with `failureCause` and the matching `permission_denied`
       event, exactly as `digestStream` does (reuse `src/stream`; do not copy its rules);
     - `command` is the Bash `input.command` (trimmed), or null for other tools;
     - results classified `real` or `input` are not refusals and are left out.
   - `aggregate(items: Array<{ lane: string; role: Role; refusals: ReturnType<typeof refusalsFromStream> }>): {
     total: number; byCause: Record<string, number>; byPrefix: Array<{ cause: FailureCause; prefix: string;
     count: number; lanes: string[]; roles: Role[] }> }`. `prefix` is the first two words of the command, after the
     same normalisation brief lint uses (env assignments, `env` and paths dropped; reuse it from `src/brief`), or the
     tool name for non-Bash tools. Sorted by count, descending.
   - `suggest(row, anyCodePrefixes: readonly string[]): string`:
     - `dontAsk` with a prefix that is not "any code" → `add "<prefix>" to commands.<role> in arbab.config.json`;
     - `dontAsk` with an any-code prefix → `a runner (<prefix>) cannot be allowed safely; name the exact script or
       command instead`;
     - `analyzer` or `needs-approval` → `the brief should ask for single commands: no compounds, $(…) or echo $?`;
     - `sleep-guard` → `the brief should use the Bash timeout parameter instead of sleep`;
     - `deny-rule` or `subcommand` → `refused on purpose; if frequent, a brief asks for something the fence forbids`;
     - `scope` → `the worker reached outside its worktree`;
     - `sandbox` → `outside the sandbox (network or paths)`;
     - anything else → an empty string.
2. `src/commands/denials.ts`, exporting `runDenials(argv, ctx)` for `arbab denials [lane…] [--role r] [--json]`:
   - every lane in the runs root (or the named ones), every attempt's stream, each lane's role from its `lane.json`;
   - print a table: cause, prefix, count, lanes, suggestion; then the total and the share of all tool calls (from
     the summaries' `toolCallTotal`).

   Do **not** edit `src/commands/index.ts`: the orchestrator registers the command.

## Scope

You own `src/telemetry/**` and `src/commands/denials.ts` (with tests). Add small exports to `src/stream` or
`src/brief` only to reuse existing logic (no behaviour change), and say so in `decisions`.

## Facts

- arbab's own build so far: 2.2% of 1,293 tool calls were refused by the fence in the first 32 runs, mostly
  probes. Implementation waves ran 0.5–1.7%. Earlier, hand-made fences cost 5.8–15%. The causes vocabulary is
  `FailureCause` in `src/types.ts`. `ANY_CODE_PREFIXES` is in `src/profile`.
- The stream fixtures in `test/fixtures/stream/` (`refusals.jsonl`, `probe-strict.jsonl`, `probe-walls.jsonl`) cover
  every cause.

## Acceptance

- [ ] The exports and the command, with tests on the fixtures and on a temporary runs root with two lanes.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
