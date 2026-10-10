# M3 · verification inside the fence (src/verify)

## Task

Implement `src/verify/` (DESIGN.md §17, `arbab verify`). The project's gates and smoke command run worker-written
code, so they run in a fenced probe lane. The exit codes come from the stream, not from the model. Pure functions;
the command lane launches the lane and calls these.

Export from `src/verify/index.ts`:

1. `commandLine(argv: string[]): string`: the argv joined with single spaces. An argument containing whitespace or
   a quote is wrapped in single quotes; a single quote inside it is escaped as `'\''`. The same function is used to
   write the brief and to find the call in the stream.
2. `verifyLaneSpec(input: { name: string; brief: string; gates: string[][]; smoke: string[] | null }): LaneSpec`.
   The lane:
   - name `<name>-verify`; role `probe`; base `integrate/<name>`;
   - `allow` holds the exact rule `Bash(<commandLine(argv)>)` for each gate and the smoke command (exact, no
     wildcard);
   - `checkpoint: false`, `autoResume: true`, `maxAttempts: 2`, `wallMin: 60`, `idleMin: 20` (gates can be slow);
   - `name` passes `assertValidName` (the combined name too).
3. `verifyBrief(gates: string[][], smoke: string[] | null): string`, a brief source with Task, Scope and
   Acceptance:
   - Task says to run each command once, in order, as its own Bash call in the foreground, with the Bash `timeout`
     parameter set to 900000, without editing files or trying to fix a failure;
   - then a numbered list `N. Run \`<commandLine>\`` (command spans);
   - Scope says nothing is written;
   - Acceptance says every command ran once.
4. `gateResults(events: unknown[], gates: string[][], smoke: string[] | null): GateResult[]`. For each expected
   command, in order (`kind` `gate` or `smoke`):
   - find the **last** Bash `tool_use` whose `input.command`, trimmed, equals `commandLine(argv)`, and its
     `tool_result`;
   - `is_error` false → `exitCode` 0;
   - `is_error` true and the text matches `/Exit code (\d+)/` → that number;
   - `is_error` true otherwise (a refusal or a sandbox block, so the command never ran) → `null`;
   - no such call → `null`.

   Never throws on malformed events.
5. `verifyRecord(input: { name; lane; attempt; headSha; results; now: string }): VerifyRecord`: `passed` is true
   only when there is at least one result and every `exitCode` is 0.

## Scope

You own `src/verify/**` (code and tests). Change nothing else.

## Facts

- In stream-json, a failed Bash result has `is_error: true` and text that begins `Exit code N` (see
  `test/fixtures/stream/refusals.jsonl`: "Exit code 1\nFAIL src/a.test.ts"). A refused command has a denial text
  and no exit code.
- `GateResult` and `VerifyRecord` are in `src/types.ts`. `parseStream` in `src/stream` turns a stream file into
  events.

## Acceptance

- [ ] Every export, with tests:
  - quoting round-trips;
  - the lane spec;
  - the brief, which lints clean under a probe profile (compile with `compileProfile`, then `lintBrief`);
  - `gateResults` for pass, fail with a code, refusal, missing, a repeated call where the last one wins, and
    malformed events;
  - `verifyRecord` with no results.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
