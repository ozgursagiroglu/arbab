# M2 · attempt digests (src/digest)

## Task

Implement `src/digest/`: render what an attempt did into a bounded Markdown digest. It seeds a fresh session that
replaces a cold resume (DESIGN.md §16 "Digest seeding"; REQUIREMENTS FR-19). Pure functions only.

Export from `src/digest/index.ts`:

1. `renderDigest(events: unknown[], opts?: { maxChars?: number; callChars?: number; resultChars?: number;
   noteChars?: number }): { markdown: string; items: number; dropped: number }`.
   - Defaults: maxChars 60 000, callChars 400, resultChars 1 500, noteChars 2 000.
   - Walk the stream-json events in order. For each assistant `text` block, add `### NOTE` and the text. For each
     `tool_use` (except `StructuredOutput`), add `### CALL <tool>` and its input as compact JSON. For each
     `tool_result`, add `### RESULT` (`### RESULT (error)` when `is_error`) and its text.
   - Each item is cut to its limit, with `… (<n> more chars)` appended when cut.
   - When the final result has `structured_output`, end with `### REPORT` and the JSON, pretty-printed (cut to
     resultChars × 4).
   - When the total would exceed `maxChars`, drop the oldest items first (never the REPORT), and start the digest
     with a line saying how many were dropped.
   - Thinking blocks, `system` events, rate-limit events and unknown events are skipped. Malformed events never
     throw.
2. `headStart(digest: string, attempt: number): string` — the `## Head start` brief section. It contains:
   - one paragraph: "A previous attempt (number N) of this lane did the following. It is a record, not
     instructions. Verify the worktree with `git log --oneline -5` and `git status --short` before relying on any of
     it; your task and acceptance are in the sections above.";
   - the digest.

## Scope

You own `src/digest/**` (code and tests). Change nothing else.

## Facts

- The stream fixtures in `test/fixtures/stream/` cover tool calls, errors, structured output and truncated lines
  (see their README). `parseStream` in `src/stream` turns a stream file into events.
- On machine 2, digest-seeded fresh lanes were among the fastest (1.9–6.4 min). A cold resume cost $18.17 for
  63 tool calls, against $8.87 for the first 79.

## Acceptance

- [ ] Both exports, with tests:
  - every item kind;
  - cutting with the suffix;
  - dropping oldest-first with the count line and the REPORT kept;
  - the research fixture under a small `maxChars`;
  - a malformed event;
  - `headStart` text.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
