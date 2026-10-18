# UI · the `arbab ui` server (src/ui/server, src/commands/ui.ts)

## Task

Implement DESIGN.md §19 "Command" and "Server": a read-only local server that streams snapshots of the registry to the
pyramid page. The page and the scene belong to sibling lanes; you serve whatever `uiAssets()` returns. The design is
decided; build it as written.

1. **`src/stream/digest.ts`**: export the tool-use counting so a live stream is counted exactly as `digestStream`
   counts it:

   ```ts
   /** The report mechanism of --json-schema runs: neither work nor a failure worth counting. */
   export const REPORT_TOOL = "StructuredOutput";
   /** The tool_use blocks of an assistant event, in order; none for any other event. */
   export function toolUses(event: unknown): Array<{ id: string | null; name: string }>;
   ```

   `digestStream` uses `toolUses`; its behaviour and its existing tests stay as they are. Export both from
   `src/stream/index.ts`, with tests for `toolUses`.

2. **`src/ui/server/tail.ts`**: an incremental tool-call counter.

   ```ts
   export interface LiveCount { toolCalls: number; lastTool: string | null }
   export interface ToolCallCounter {
     /** The attempt's tool calls so far; reads only the bytes appended since the last call for this attempt. */
     count(lane: string, attempt: number, streamPath: string): LiveCount;
     /** Forgets every lane not in `lanes` (lanes that left the window). */
     retain(lanes: ReadonlySet<string>): void;
   }
   export function createToolCallCounter(options?: { maxBytesPerCall?: number }): ToolCallCounter;
   ```

   - State per lane: the attempt, a byte offset, the unfinished last line (as bytes), the tool_use ids seen, the count
     and the last tool. Another attempt number starts the lane over; a file shorter than the offset starts over.
   - Read with `openSync`/`readSync` from the offset, at most `maxBytesPerCall` bytes per call (default 8 MiB); the
     rest waits for the next call. A missing file counts 0.
   - Split on newline bytes and decode each complete line on its own, so a multi-byte character cut by a read
     boundary survives. A line that does not parse is skipped; a trailing line without a newline waits.
   - Count with `toolUses`: one per id (a block without an id counts each time), `REPORT_TOOL` excluded; `lastTool`
     is the last counted name.

3. **`src/ui/server/snapshot.ts`**:

   ```ts
   export interface SnapshotSource {
     /** The project root. */
     root: string;
     /** Absolute. */
     runsRoot: string;
     config: ProjectConfig;
     /** ~/.arbab, for the quota snapshot. */
     home: string;
     version: string;
     alive: (pid: number) => boolean;
     windowHours: number;
     counter: ToolCallCounter;
   }
   /** Builds snapshots; caches what cannot have changed (below). */
   export interface SnapshotBuilder { build(nowMs: number): UiSnapshot }
   export function createSnapshotBuilder(source: SnapshotSource): SnapshotBuilder;
   ```

   The comments in `src/ui/protocol.ts` are the field rules; read them first. Per lane (`listLanes`):
   - `readState`; a lane with no state yet is skipped and not counted. The state is `effectiveState`.
   - `role` from the run dir's `lane.json` (one of `ROLES`); `worktreeOf` from its `worktree` when `isValidName`.
   - `kind`: when `readGenerated` (`src/commands/generated.ts`) names `integration:<name>`, the lane `<name>-verify`
     is "verify", `<name>-review-…` "review", `<name>-skeptic-…` "skeptic". A probe whose name ends in `-pf-tools` or
     `-pf-model` is "preflight". Anything else is "lane".
   - `integration`: the generating integration, else the integration with the newest `updatedAt` whose `merged`
     names the lane.
   - `hold`: for a held lane, "slot" when `reason === NO_FREE_SLOT_REASON` (`src/types.ts`), else "quota".
   - `firstSeen`: `started.json` `startedAt` of the lowest attempt `listAttempts` returns, else `shepherd.json`
     `startedAt`, else `since` (only values `Date.parse` accepts).
   - Counts from `statusRow` (`src/registry/status.ts`) given the current attempt's `summary.json`, except: a running
     attempt without a summary takes `toolCalls` and `lastTool` from the counter (its `stream.jsonl`); `elapsedMs` is
     null while the state is live; `costUsd`, `costDeltaUsd` and `model` come from the newest attempt that has a
     summary.
   - `reportStatus` (roles implementer and verifier) and `findings` (role reviewer: the length of `findings` when it
     is an array) come from the newest attempt's `report.json`.
   - Any lane whose records throw (`ArbabError` from a file that does not parse) is counted in `hiddenLanes`; the
     build never throws for one lane.
   - **Cache**: a finished or orphaned lane's `UiLane` is reused while its state record (`state`, `attempt`, `since`,
     `shepherdPid`, `endState`, `reason`) is unchanged; only live lanes are read again on every build.
   - The **window** and the 300-lane cap as DESIGN.md §19 says; the output is sorted by `firstSeen`, then name.
     After each build, `counter.retain(<names in the snapshot>)`.

   Integrations: every directory under `.arbab/integrations/` (`INTEGRATIONS_DIR`) whose name `isValidName`.
   - `readIntegration(integrationPaths(root, config, name))` (`src/integrate`).
   - `verify`, `review` and `ready` from `readVerifyRecord`, `readReviewRecord` and `readReadinessReport`
     (`src/commands/records.ts`), counted only when their `headSha` equals the integration's.
   - `review` counts the lenses and the findings by verdict.
   - `landedAt` from `landing.json`, when its `name` matches and `landedAt` parses.
   - An integration whose records throw is left out.
   - Re-read an integration only when the size or mtime of one of its record files changed.
   - Keep every one not landed and the five landed most recently, sorted by `updatedAt`.

   Quota: `readQuota(home)`, `holdDecision(snapshot, config.quota.holdAbove, nowSec)`, `config.quota.holdAbove`.
   `project` is `basename(root)`, `now` the ISO time of `nowMs`, `maxParallel` from config.

4. **`src/ui/server/http.ts`**:

   ```ts
   export interface UiServerOptions {
     /** 0: the system picks a free port. */
     port: number;
     token: string;
     assets: UiAssets;
     /** Called at most once per tick, and only while a client listens. */
     snapshot: () => UiSnapshot;
     /** Default 1000. */
     tickMs?: number;
     /** A snapshot is sent at least this often, changed or not. Default 30000. */
     heartbeatMs?: number;
     /** Default 16. */
     maxClients?: number;
   }
   export interface UiServer {
     /** http://127.0.0.1:<port>/#token=<token> */
     url: string;
     port: number;
     /** Ends every event stream, closes every connection and stops listening. */
     close(): Promise<void>;
   }
   export function startUiServer(options: UiServerOptions): Promise<UiServer>;
   ```

   Every rule of DESIGN.md §19 "Server", checked in this order for each request:
   1. `Host` is `127.0.0.1:<port>` or `localhost:<port>` (case-insensitive), else 403.
   2. The method is GET or HEAD, else 405 with `Allow: GET, HEAD`.
   3. The URL is at most 2,048 characters, else 414.
   4. `Sec-Fetch-Site: cross-site`, or an `Origin` other than `http://127.0.0.1:<port>` and
      `http://localhost:<port>`, gives 403.

   Then route:
   - `UI_ROUTES.page` serves `assets.html` as `text/html; charset=utf-8`.
   - `script` serves `assets.js` as `text/javascript; charset=utf-8`; `style` serves `assets.css` as
     `text/css; charset=utf-8`.
   - `/favicon.ico` answers 204.
   - `snapshot` builds one now and sends it as `application/json; charset=utf-8`, or 500 with the message when the
     build throws.
   - `events` is the SSE stream.
   - Anything else is 404.

   The data routes need `?token=` equal to the token: `timingSafeEqual` on equal-length buffers; missing or wrong
   gives 401.

   The DESIGN.md security headers (copy the values exactly) go on every response, errors included. HEAD gets the
   headers and no body.

   SSE:
   - Respond with `Content-Type: text/event-stream; charset=utf-8` and `Connection: keep-alive`, write
     `retry: 2000`, then `event: snapshot` with the current snapshot as one line of JSON.
   - One shared interval runs while at least one client is connected. Each tick builds once, compares the JSON with
     `now` removed to the last sent one, and sends to every client when it changed or `heartbeatMs` has passed.
   - A client that closes is dropped; the interval stops with the last client. One client more than `maxClients`
     gets 503.
   - A build that throws skips its tick. Three in a row send `event: problem` with `{"message": <its message, cut to
     200 characters>}`, once, until a build succeeds again.

5. **`src/commands/ui.ts`**: `runUi(argv, ctx)` for
   `arbab ui [--port N] [--hours N] [--no-open] [--json]`.
   - `--port`: an integer 0–65535, default 0. `--hours`: an integer 1–720, default 24. Anything else is a usage
     error (exit 1).
   - `openProject(ctx)`; the token is `randomBytes(16).toString("hex")`; `startUiServer` with `uiAssets()` (from
     `src/ui/client/app/assets.ts`) and a snapshot builder.
   - Text output: `arbab ui: <project> at <url>` and `read-only; Ctrl-C stops it`. With `--json`, print
     `{"url": …, "port": …}` with `printJson`.
   - Unless `--no-open`, call `ctx.openUrl(url)`. When it returns false, print `open <url> in a browser` on stderr.
   - Wait for `ctx.trapSignals`' handler, then `await server.close()` and return 0.
   - Add `openUrl: (url: string) => boolean` to `CommandContext` (`src/commands/context.ts`). In `defaultContext` it
     spawns `open <url>` on darwin and `xdg-open <url>` on linux (argv, `detached: true`, `stdio: "ignore"`, an
     `error` listener, `unref()`) and returns true; on any other platform it returns false. `makeProject` in
     `src/commands/testkit.ts` records the URLs in a new `opened: string[]` and returns true.
   - Register `ui` in `COMMANDS` and add to `HELP`, after `land`:

     ```text
       ui [--port N] [--hours N] [--no-open] [--json]
                                               serve the pyramid scene on 127.0.0.1 until stopped (read-only)
     ```

6. **`test/e2e/ui.test.ts`**: build the bundle with `buildBundle()` (`test/e2e/harness.ts`). Spawn
   `node <bundle> ui --no-open --json` in a temporary project with a temporary HOME. Read the first stdout line,
   GET `/` and `/snapshot.json?token=…` from it, send SIGTERM and expect exit 0.

## Scope

- `src/ui/server/**` (new), `src/commands/ui.ts` and `src/commands/ui.test.ts` (new), `test/e2e/ui.test.ts` (new)
- `src/commands/index.ts` (register and HELP), `src/commands/context.ts` (`openUrl`), `src/commands/testkit.ts`
  (fake `openUrl`, `opened`)
- `src/stream/digest.ts`, `src/stream/index.ts`, `src/stream/digest.test.ts` (`toolUses`, `REPORT_TOOL`)

Read anything else; change nothing else. `src/ui/protocol.ts`, `src/types.ts` and `src/util/**` are contracts:
report a change you need in `open_questions`.

## Facts

- `src/ui/protocol.ts` is on this lane's base: the snapshot types, routes, token parameter and event names.
- `src/ui/client/app/assets.ts` is a stub returning a placeholder page. Lane ui-art replaces it, keeping
  `uiAssets(): UiAssets`.
- An assistant event's `message.content[]` holds `{"type": "tool_use", "id", "name", "input"}` blocks
  (`digestStream` in `src/stream/digest.ts`; fixtures in `test/fixtures/stream/*.jsonl`).
- `ls -la .arbab/runs/m3-wire/attempt-1/stream.jsonl` (2026-10-18): 2,192,452 bytes for an 18-minute attempt with
  128 tool calls. Streams of long lanes grow to many MB, hence the incremental counter.
- Generated lane names: `<name>-verify` (`src/verify/index.ts:73`); `<name>-review-<lens>` and
  `<name>-skeptic-<lens>` (`src/review/lanes.ts:45`). Preflight probes: `<lane>-pf-tools` and `<lane>-pf-model`
  (`src/commands/preflight.ts:137`).
- The shepherd writes `reason: NO_FREE_SLOT_REASON` for a lane held for a slot and the hold decision's text for a
  quota hold (`src/shepherd/lifecycle.ts`).
- Implementers run in a sandbox with loopback allowed: listening on and connecting to 127.0.0.1 works (DESIGN.md §4,
  measured in w0).
- `server.closeAllConnections()` exists since Node 18.2; the project needs Node ≥ 20 (package.json `engines`).
- `index.test.ts` checks that every command in `COMMANDS` appears in `HELP` as `  <name> `.

## Unverified

- Whether `parseArgs` (`node:util`) on Node 20 accepts a boolean option named `no-open` as it is. Check it, and say
  what you used in `decisions`.
- The first attempt of a lane is normally `attempt-1`. Do not rely on it; take the lowest of `listAttempts`.

## Acceptance

- [ ] The signatures above exist; `arbab ui` is in `COMMANDS` and `HELP`.
- [ ] Each rule of DESIGN.md §19 "Command" and "Server" has a test: every status code; the headers on a 200, a 401
      and a 404; Host, Origin and Sec-Fetch-Site variants; tokens missing, wrong and of the wrong length; HEAD without
      a body; SSE first event, change, no change, heartbeat, `problem` after three failures, 503 above `maxClients`;
      no build without a client; `close()`. List the tests in `notes_for_reviewer`.
- [ ] Snapshot tests build run dirs with `writeLaneRun` (`src/commands/testkit.ts`). They cover:
      - each window rule and the cap;
      - `hold`, the kinds, `integration`, `firstSeen` fallbacks, `reportStatus` and `findings`;
      - a corrupt record counted as hidden;
      - the cache: unchanged state reused, changed state re-read;
      - head-matched verify, review and readiness;
      - the five-landed cap;
      - a snapshot's JSON holds neither the temporary directory's path nor an env value.
- [ ] Tail tests cover appends across calls, a partial last line, a multi-byte character split by a tiny
      `maxBytesPerCall`, a replayed id, `StructuredOutput`, a new attempt, a truncated file and a missing file.
- [ ] `pnpm typecheck` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `git diff` touches only the Scope's paths.

## Notes

- **Do not run `pnpm build`** (this overrides the project rule for this lane). It rewrites the tracked `plugin/`,
  and three lanes' bundles would conflict at integration. The bundle is built in tests (`test/build.test.ts`,
  `test/e2e`); the orchestrator rebuilds `plugin/` after integration.
- The token goes to stdout only: never to a file, a log or an error message.
- A snapshot is built every second while the page is open. Keep builds cheap: the cache and the counter, no git
  calls, no whole-stream reads.
- Tests call `runUi` with a context whose `trapSignals` captures the handler, so a test can stop the server.
