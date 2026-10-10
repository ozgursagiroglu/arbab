# M1 · stream accounting (src/stream)

## Task

Implement `src/stream/`: the pure functions that turn one attempt's `stream.jsonl` (the output of
`claude -p --output-format stream-json --verbose`) and its transcript into the facts arbab reports. No file system
access except where a function's signature takes a path; no process or clock access (callers pass `observedAt`).

Export from `src/stream/index.ts`:

1. `parseStream(text: string): { events: unknown[]; unparsedLines: number }` — one JSON value per non-empty line.
   A line that does not parse is counted, never thrown (the last line of a live stream is often cut).
2. `digestStream(events: unknown[], observedAt: string): StreamDigest` — every field of `StreamDigest` in
   `src/types.ts`, computed from **all** events (a run can emit several `result` events; `final` is the last one,
   `results` keeps all of them in order). Rules:
   - `sessionId`: from the init event, else the first event that has `session_id`.
   - `init` (`InitFacts`): from `{type:"system", subtype:"init"}`: tools, permissionMode, claude_code_version →
     version, model, apiKeySource, mcp_servers, plugin names, `skills.length`, `memoryPaths` = the key
     `memory_paths` is present, `messagingSocket` = the key `messaging_socket_path` is present, `entrypoint` =
     `startup_timing.entrypoint` or null.
   - `toolCalls`: count of `tool_use` blocks in `assistant` events by tool name, **excluding `StructuredOutput`**
     (that is the report mechanism, not work). `lastTool`: the name of the last counted tool_use.
   - `turns`: number of distinct `message.id` values among `assistant` events.
   - `failedByCause`: for every `tool_result` block with `is_error: true` in `user` events, key
     `"<tool name>:<cause>"` (tool name from the matching tool_use id; `"?"` if unknown; skip StructuredOutput),
     cause from `failureCause()` with the `decision_reason_type` of a `system/permission_denied` event that has the
     same `tool_use_id`.
   - `permissionDenied`: number of `system/permission_denied` events.
   - `rateLimit`: from the **last** `rate_limit_event`, via `rateLimitFromEvent()`.
   - `results`/`final` (`ResultFacts`): subtype, `is_error` → isError, terminal_reason, api_error_status, num_turns,
     duration_ms, total_cost_usd, `result` (string or null), `structured_output` (undefined → null).
3. `failureCause(text: string, deniedType?: string): FailureCause`, deciding in this order:
   - deniedType: `mode` → `dontAsk`, `rule` → `deny-rule`, `other` → `scope`, `subcommandResults` → `subcommand`,
     any other non-empty value → `denied-other`;
   - text `/can't be checked before it runs|expansion obfuscation|multiple targets|cannot be statically analy/i` →
     `analyzer`;
   - `/requires? approval|contains multiple operations/i` → `needs-approval`;
   - `/^Blocked: sleep/i` → `sleep-guard`;
   - `/InputValidationError/` → `input`;
   - `/denied by your permission settings/i` → `deny-rule`;
   - `/Operation not permitted|network-outbound|sandbox/i` → `sandbox`;
   - `/has been denied/i` → `denied-other`;
   - otherwise `real`.

   Tool-result text is `content` when it is a string, or the joined `text` of its array items.
4. `rateLimitFromEvent(event: unknown, observedAt: string): RateLimitSnapshot | null` — from
   `rate_limit_info`: status, rateLimitType → type, `unifiedWindows.five_hour` / `seven_day` →
   `{utilization, resetsAt}` (null when absent or malformed).
5. `classifyAttempt(input: { digest: StreamDigest; exit: AttemptExit | null; alive: boolean; schemaRequired: boolean;
   reportValid: boolean | null }): EndState`, in this order:
   1. `exit?.killedBy` → `killed:<reason>`;
   2. no final result → `running` when `alive`, else `no-result`;
   3. the final result's `apiErrorStatus` 429 → `usage-limit`;
   4. 400 with text matching `/does not support this model|or newer is required/i` → `unsupported-cli`;
   5. subtype `error_max_budget_usd` → `budget`; `error_max_turns` → `max-turns`;
      `error_max_structured_output_retries` → `invalid-report`;
   6. `isError`, or any other subtype that is not `success` → `failed`;
   7. `schemaRequired` and (`structuredOutput` is null, or `reportValid === false`) → `invalid-report`;
   8. otherwise `success`.

   Never decide from `subtype` alone or from the exit code.
6. `findTranscript(projectsDir: string, sessionId: string): string | null` — the path of `<sessionId>.jsonl` in any
   direct subdirectory of `projectsDir` (e.g. `~/.claude/projects`). `sessionId` must be a UUID (else return null,
   never build a path from it). A missing `projectsDir` returns null.
7. `measuredEffort(transcriptText: string): Record<string, number>` — counts the `effort` value of every transcript
   line with `type: "assistant"`; tolerant of unparsable lines.
8. `buildAttemptSummary(input): AttemptSummary` — a pure assembler. Input: lane, attempt, role, state (EndState),
   started (`AttemptStarted | null`), exit (`AttemptExit | null`), digest, requestedEffort, measuredEffort
   (or null), previousCostUsd (number | null), registration (or null), reportValid, reportErrors, nowMs. `wallMs`
   comes from `exit.wallMs`, else `nowMs - startedAt`; `costUsd` from the final result; `costDeltaUsd` =
   costUsd − previousCostUsd (or costUsd when there was no previous attempt; null when costUsd is null);
   `toolCallTotal` and `failedTotal` are sums.

Every input is untrusted and evolving: ignore unknown event types and fields, and never throw on a malformed event.

## Scope

You own `src/stream/**` (code and `*.test.ts`). Read anything else; change nothing outside `src/stream/`.

## Facts

- Fixtures: `test/fixtures/stream/*.jsonl` (see its README for the source and purpose of each). Measured with a
  prototype of this module (`bench/bootstrap/summarize.mjs`, a quick sketch, not a spec):
  - `probe-strict`: success, structured output present, tool calls `{Bash: 8, Read: 2, Write: 1}` (plus one
    StructuredOutput, not counted), 2 `permission_denied` events with `decision_reason_type: "subcommandResults"`,
    a curl blocked by the sandbox, and a Read of `.env` refused with "File is in a directory that is denied by your
    permission settings." (→ deny-rule);
  - `research`: tool calls `{WebFetch: 34, WebSearch: 4}` (plus StructuredOutput), structured output present;
  - `usage-limit`: classifies as usage-limit; the last rate_limit_event has five_hour utilization 1;
  - `refusals`: one failure of each cause (analyzer, needs-approval, sleep-guard, input, dontAsk, scope, sandbox,
    deny-rule, real);
  - `background-multi-result`: two result events, final cost 0.9;
  - `truncated`: no result, one unparsable last line;
  - `probe-unrestricted`: `memory_paths` and `messaging_socket_path` present; `probe-tools`: tools include `Task`
    and `Monitor`.
- Effort is not in stream events. Transcripts (`~/.claude/projects/<slug>/<session>.jsonl`) have `effort` on each
  assistant entry.
- `total_cost_usd` is cumulative per session across `--resume`.

## Acceptance

- [ ] Every export above exists, with JSDoc on non-obvious behaviour, and uses the types in `src/types.ts` unchanged.
- [ ] Tests in `src/stream/*.test.ts` cover every export and every fixture: the classification of each fixture,
      the failure-cause table row by row, a malformed/unknown event, a truncated stream, a transcript lookup with a
      non-UUID session id, and the summary arithmetic (delta with and without a previous attempt).
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.

## Notes

- `src/cli.ts` is a stub; do not wire anything into it.
