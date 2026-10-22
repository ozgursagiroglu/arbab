# arbab — design

Date: 2026-10-09 · Status: decided for M1; M2–M4 sketched · Inputs: [REQUIREMENTS.md](REQUIREMENTS.md), the analysis
wave w0 ([research/native-claude-code.md](research/native-claude-code.md) §"Measured in w0", [research/w0/](research/w0/))

arbab is a Claude Code plugin: a **skill** that carries the method, and a **runner** CLI that does the mechanics. The
interactive session stays the brain (plans, writes briefs, reads reports, lands); the runner launches and supervises
headless `claude -p` workers and records everything on disk.

## 1. Decisions

| Question | Decision | Why |
| --- | --- | --- |
| Q-form | Plugin = skill + bundled runner | REQUIREMENTS §10 |
| Q-runtime | TypeScript, Node ≥ 20, **zero runtime dependencies**, bundled into one ESM file `dist/arbab.mjs` | The plugin cache installs `node_modules` only for npm/bun lockfiles, skips install scripts and may drop the executable bit (w0 research). `node "${CLAUDE_PLUGIN_ROOT}/dist/arbab.mjs"` needs none of that. `dist/` is ignored during development (every lane builds it, so a committed bundle would conflict on every merge); release commits add it with `git add -f`. |
| CLI vs Agent SDK | Spawn the user's own `claude` binary | The SDK ships its own binary; the terms reserve subscription login for the unmodified Claude Code binary (w0 research). |
| Q-sandbox | Claude Code's sandbox + `--restricted` by default; `srt` whole-process mode is an M4 option | Measured in w0: the built-in sandbox blocks writes outside the worktree, credential reads and the network; `--restricted` confines the file tools. srt adds MCP/hooks coverage, which workers do not use (no MCP, no settings sources). |
| Q-supervisor | **No daemon.** One detached *shepherd* process per lane supervises its attempts; machine-wide state (quota, slots, leases, locks) lives in `~/.arbab/` | A daemon is one more thing to keep alive. A shepherd survives the orchestrator (own process group), tracks only its own pids, and the registry is rebuilt from disk. |
| Q-auth | Defaults target a Pro/Max subscription; API keys work unchanged | Owner decision (2026-10-09). arbab never reads, stores or proxies credentials. |
| Q-settings-cut | Answered in w0: with `--setting-sources ""` neither the project's nor the user's CLAUDE.md loads; auto-memory and messaging stay **on** unless `--restricted` is passed | Transcript evidence (no CLAUDE.md content; `memory_paths` and `messaging_socket_path` only without `--restricted`). So the brief inlines project rules, and `--restricted` is mandatory. |
| Background Bash | Denied for every worker with the parameter rule `Bash(run_in_background:true)` | Measured in w0 (denied, `decision_reason_type: rule`). Removes the last-turn-only result and the hung-child problems at the source. Long commands use the Bash `timeout` parameter (up to `BASH_MAX_TIMEOUT_MS`). |

## 2. Process model

```
interactive session (orchestrator)
  │ arbab launch lanes/x.json   ── validates, lints, writes attempt dir, spawns ──┐  (returns at once)
  │ arbab wait --any            (run_in_background → task notification)          │
  │ arbab status / resume / stop                                                  ▼
  │                                                             shepherd (detached, own process group)
  │                                                               acquire slot → quota check → worktree →
  │                                                               dependencies → leases → writer lock →
  │                                                               spawn worker ──────────────┐
  │                                                               watch: stream, descendants, │
  │                                                               wall / idle / hang timers   ▼
  │                                                                              claude -p (own process group,
  │                                                                              scrubbed env, fenced)
  │                                                               on exit: reap tree, release, checkpoint,
  │                                                               summarize, classify → done | auto-resume
  ▼
reads <run dir>/summary.json and the report, never the stream
```

**Lane states** (`state.json`, written atomically by the shepherd): `queued` → `held` (no slot, or quota above the
hold threshold) → `preparing` (worktree, dependencies, leases) → `running` → `waiting-reset` (usage limit, sleeping
until `resetsAt`) → `running` (resumed attempt) … → `finished`. `finished` carries the lane run's end state and, when it ended before or between attempts, the reason (a setup failure, a stop, a refused lint).
A shepherd that dies is detected by `status` (pid gone, state not `finished`) and shown as `orphaned`.

**Kill rules** (shepherd): wall clock (`wallMin`), idle (no stream growth for `idleMin`), hang after a result
(15 min without new events after a `result`), hang after an error result (2 min), `arbab stop`. Killing sends
SIGTERM to the worker's process group and to every recorded descendant, then SIGKILL after 10 s.

**Auto-resume**: only for end state `usage-limit`, at most `maxAttempts` attempts per lane, after `resetsAt` + 60–120 s
jitter and a fresh quota check, with the same session id, the same binary and the standard continuation prompt.
Every other end state stops the lane and is the orchestrator's decision. The wait ends early only after `arbab quota
--reset` (or `--refresh`, §21) run after the limited attempt began (an account switch, recorded with its time in `~/.arbab/quota-reset.json`;
a reset while the attempt was still finishing counts). A newer snapshot alone does not
end it: snapshots carry only the five-hour and seven-day windows, so another lane's events can look fine while this
lane's own limit (a model's weekly limit, say) still holds (M3 review, round 2).

## 3. On disk

Project (git-ignored; arbab adds `.arbab/` and `.arbab-tmp/` to the repository's `info/exclude`, plus `worktreeRoot`
and `runsRoot` when config moves them outside `.arbab/`, and verifies each with `git check-ignore`):

```
.arbab/
  config.json                     the config when the repository has no arbab.config.json (§21)
  .eslintrc.json                  {"root": true}: stops ESLint 8's config cascade at .arbab/ (§21)
  runs/<lane>/
    lane.json                     the lane as launched
    shepherd.json                 {pid, startedAt, owner}; state.json (live)
    events.jsonl                  one line per change of state or reason: {at, shepherdPid, state, attempt, reason?,
                                  until?, endState?}
    attempt-<n>/                  never overwritten (created with mkdir, files with O_EXCL)
      brief.md                    the assembled prompt that was sent
      settings.json  args.json    the compiled fence and the exact argv (schema elided)
      started.json                session id, pid, binary {path, version}, leases, env keys (never values)
      stream.jsonl  stderr.log    raw worker output
      registration.json           kind/entrypoint from ~/.claude/sessions/<pid>.json, if present
      exit.json                   exit code, signal, killedBy, wall ms, reaped pids, checkpoint sha
      summary.json                classification and metrics (§7)
      report.json                 the validated structured output, when present
    acked.json                    the lane run (shepherd pid + finish time) `arbab wait` last reported, so a run
                                  that failed before its first attempt is still reported exactly once
    launch.lock                   held from `launch`/`resume` until the new shepherd writes its first state
    resume-prompt-<n>.md          a `resume --prompt` text, passed to the shepherd by path
    generated.json                on lanes `verify`/`review` generate: the integration and head that own the name
                                  (launch and resume refuse such a lane)
    worktree-used                 written before the first attempt runs: the worktree is no longer arbab's own
  preflight/<lane>/               the generated probe lanes of `arbab preflight` (never in the project's lanes/)
  plans/<plan>/<phase>.json       the compiled lane file of each phase `plan next` launched
  integrations/<name>/            integration.json, verify.json, review.json, readiness.json + .md, landing.json,
                                  lanes/ (generated lane files); superseded records keep their own file (§17)
    reviews/<round>.json          every review, numbered from 1 (review.json is the latest)
    host-checks.json              the last `arbab host-check` (HostCheckRecord)
  refs/ref-<slug>-<hash>/         `verify --ref <branch>`: verify.json (named ref:<branch>) and lanes/ (§17)
  worktrees/<lane>/               one git worktree per lane, branch arbab/<lane>
  worktrees/integrate-<name>/     the integration worktree, branch integrate/<name> (no worker runs there)
<worktree>/.arbab-tmp/            per-worker homes, ignored: xdg-config/ (XDG_CONFIG_HOME),
                                  yarn-cache/ (YARN_CACHE_FOLDER), npmrc (an empty NPM_CONFIG_USERCONFIG, never
                                  overwritten), inputs/ (the lane's inputs, rebuilt every run, §21)
```

A worker writes its worktree, `.arbab-tmp/` included, so the shepherd never writes through a link it finds there:
it builds `.arbab-tmp/` and each directory under it one component at a time, replacing a link or a non-directory (the
link itself, never its target) with a fresh directory, and creates `npmrc` and every input copy with exclusive,
no-follow opens. A lane worktree is never a project, wherever `worktreeRoot` puts it: before it loads any config,
arbab refuses a project root that lies in a `.arbab/worktrees` directory, or at or under the `worktreeRoot` that an
ancestor's `arbab.config.json` or `.arbab/config.json` sets inside that ancestor (only that field is read). That
`worktreeRoot` counts as written and, when it exists, by its real path when that lies inside the ancestor's real
path, so with `wt` a link to `.arbab/pool` a lane is refused as `<project>/wt/<lane>` and as
`<project>/.arbab/pool/<lane>`. Both the path as written and its spelling on disk are checked, and every comparison
ignores case, so `.Arbab/Worktrees` on a case-insensitive file system is caught too. The hook's `-C` check uses the
same test (§21).

Repository build output (git-ignored): `dist/arbab.mjs` (the bundle) and `plugin/` (what a marketplace installs, §17).

Machine (`~/.arbab/`, never writable from a worker's sandbox):

```
quota.json                        newest account-wide rate-limit snapshot (newer observation wins; `--refresh` replaces it)
quota-reset.json                  {resetAt}: the last `arbab quota --reset` or `--refresh` (an account switch, §2)
machine.json                      {"maxParallel": n}: caps every project's maxParallel (§21); missing = no cap
slots/<i>.json                    maxParallel workers across all projects
semaphores/<name>/<i>.json        shared external resources (config semaphores)
leases/<type>/<value>.json        port, redis-db, database, custom
locks/<sha1(worktree)>/0.json     one writer per worktree; the directory goes with its entry
shepherds/<pid>.json              {pid, lane, project, owner, startedAt} while that shepherd lives
waiters/<pid>.json                {pid, project, owner, startedAt} while that `arbab wait` runs, or a `verify`,
                                  `review` or `preflight` waits for its lanes
projects/<sha1(root)>.json        {root, lastLaunchAt}: a project that launched a lane (`summary --all`, the hook's
                                  `-C` check, §21)
tmp/                              `quota --refresh`'s working directory, removed after the call
```

Every pool entry (`slots/`, `semaphores/`, `leases/`, `locks/`) is an O_EXCL file holding `{pid, lane, project,
createdAt}`, one generic pool for all four kinds. An entry whose holder pid is dead is reclaimed by renaming it to a
tomb file first, so two reclaimers cannot both win; an entry that does not parse is treated as held (its creator may
be between open and write) and left to `cleanup`.

The registries (`shepherds/`, `waiters/`, `projects/`) are not pools and are read by trusting nothing: an entry that
does not parse, or whose body names another pid than its file, is skipped, and a `shepherds/` or `waiters/` entry of
a dead pid is removed.

Writes are atomic (temp file + rename) or exclusive (O_EXCL). Names that become paths (lane names, resource types)
must match `^[a-z0-9][a-z0-9-]{0,47}$`; every path is resolved and checked to stay under its root.

## 4. The fence

### What w0 measured (CLI 2.1.295, macOS)

| Check | Result |
| --- | --- |
| Write outside the worktree (`~`, `/private/tmp`) | EPERM (sandbox) |
| `cat .env` with `Read(**/.env*)` denied | refused by the permission layer (`subcommandResults`) and EPERM in the sandbox |
| Read tool on `.env` | refused ("denied by your permission settings") |
| `curl https://example.com`, Node `fetch` | refused (sandbox proxy, no allowed domains) |
| Listen on 127.0.0.1 with `allowLocalBinding` | allowed |
| `run_in_background: true` with `Bash(run_in_background:true)` denied | refused (`rule`) |
| Bash `timeout` parameter | allowed |
| `--restricted` | `memory_paths` and `messaging_socket_path` absent; without it both present |
| Scrubbed env | worker entrypoint `sdk-cli` (Bash children see `CLAUDE_CODE_ENTRYPOINT=sdk-cli`), not `claude-vscode` |
| `--tools "Read,Bash,Monitor,ToolSearch,Agent,TodoWrite"` | init tools: Task, Bash, Monitor, Read, ToolSearch (Agent is `Task`; TodoWrite is not a tool in this version) |
| Sandboxed `$TMPDIR` | `/tmp/claude-<uid>`, set by Claude Code; shared by every session of the user and writable from every sandbox |
| Code a worktree's worker runs, writing the repository's shared `.git` (M1 review probe) | new files and **loose refs** writable, as are the worktree's own git dir (`HEAD`, `commondir`); `.git/config`, `.git/hooks` and the worktree's `.git` pointer EPERM |
| The same with `sandbox.filesystem.denyWrite: [<repo>/.git]` | every write EPERM; `git status`, `log` and `diff` still work |
| Allowlisted `touch`/`cp`/`ls` on paths outside the working directory, in dontAsk | refused by the permission layer before the sandbox is reached |

### Compiled flags (every role)

```
claude -p --output-format stream-json --verbose
  --model <m> --effort <e>
  --permission-mode dontAsk --permission-prompts none
  --strict-mcp-config --setting-sources "" --restricted
  --tools <role tools>
  --settings <attempt>/settings.json
  --max-budget-usd <per-attempt budget>
  -n <lane> (--session-id <uuid> | --resume <uuid>)
  [--json-schema <report schema>]
```

Environment: built from scratch, never inherited — `HOME USER LOGNAME LANG LC_ALL SHELL`, a computed `PATH` (node,
pnpm, system dirs), `TERM=dumb`, `DISABLE_AUTOUPDATER=1`, `CLAUDE_CODE_SHELL=/bin/bash` (§21), the names listed in
config `passEnv`, and the leases.

### Settings template

```json
{
  "sandbox": {
    "enabled": true, "failIfUnavailable": true,
    "autoAllowBashIfSandboxed": false, "allowUnsandboxedCommands": false,
    "network": { "allowLocalBinding": <role.loopback> },
    "filesystem": { "denyWrite": [<the repository's shared git dir>], "allowRead": [<tracked env templates>] }
  },
  "env": { <config.env>, <leases>, "BASH_DEFAULT_TIMEOUT_MS": "300000", "BASH_MAX_TIMEOUT_MS": "900000",
           "XDG_CONFIG_HOME": "<worktree>/.arbab-tmp/xdg-config", "YARN_CACHE_FOLDER": "<…>/yarn-cache",
           "NPM_CONFIG_USERCONFIG": "<…>/npmrc" },
  "permissions": { "allow": [<role base>, <config commands>, <lane allow>], "deny": [<credential denies>, <role denies>] },
  "bashOutputMaxChars": <config fence.bashOutputMaxChars>
}
```

The `.arbab-tmp/` values win over `config.env`: they keep package managers and git off the denied `~/.config` and
`~/.npmrc`. `bashOutputMaxChars` (4000–128000, default 100,000) bounds a Bash result inline; Claude Code saves longer
output under `~/.claude/projects/…/tool-results/`, which the `~/.claude/**` deny keeps the worker from reading, so
the tool belt tells the worker to print less.

`autoAllowBashIfSandboxed` defaults to **true** and must be set; `allowUnsandboxedCommands: false` stops an allow rule
from silently approving an unsandboxed retry; `failIfUnavailable` makes a missing sandbox fatal instead of silent.
`filesystem.allowRead` appears only with readable env templates (below). `filesystem.denyWrite` closes the shared
git directory, which Claude Code's sandbox otherwise opens to a worktree's worker: without it, code the worker runs
could rewrite another branch's ref or point its worktree's `commondir` at hooks the runner would later execute.
Workers never need to write there; the runner commits.

The runner's own git calls on a worker's worktree (the checkpoint) pass `--git-dir` and `--work-tree` explicitly and
first check that the worktree's `HEAD` and `commondir` are the ones arbab created; the dependency command runs only
when the shepherd has just created the worktree, never on one a worker has already changed.

### Role presets

| Role | Tools | Model / effort | Budget / wall / idle | Loopback | Writes |
| --- | --- | --- | --- | --- | --- |
| implementer | Read Edit Write Glob Grep Bash | opus / high | $10 / 60 / 20 min | yes | worktree |
| verifier | Read Edit Write Glob Grep Bash | opus / high | $10 / 60 / 20 min | yes | worktree (after the builder, same writer lock) |
| reviewer | Read Glob Grep Bash | opus / high | $5 / 30 / 15 min | yes (§21: tests listen on 127.0.0.1) | none (`Edit`, `Write` denied) |
| researcher | WebSearch WebFetch | opus / medium | $5 / 40 / 15 min | n/a | none (no local tools at all) |
| probe | Read Write Bash | haiku / low | $0.5 / 10 / 5 min | yes | worktree |

Base allow rules: implementer, verifier and reviewer get the read-only git verbs (`status diff log show ls-files
blame`; not `grep`, whose `-O` option runs a program — workers have the Grep tool), `ls cat head tail wc` and `pwd`; implementer and verifier also get `mkdir cp mv rm touch`, whose writes the
sandbox confines to the worktree (wave 1 of arbab's own build lost a turn to a refused `rm` and left a misnamed file);
researchers get `WebSearch WebFetch`; the probe gets `Write`, `git rev-parse`, `git status` and `ls`. Project commands come
from config `commands.<role>` as prefixes, compiled to `Bash(<cmd>)` and `Bash(<cmd> *)`.

Role denies: `Bash(run_in_background:true)`; git writes (`commit push reset checkout switch restore rebase merge
cherry-pick stash clean branch worktree tag config update-ref remote`) and `git -C`; `WebFetch WebSearch` (all but researcher);
`Edit Write NotebookEdit` (reviewer). Credential denies, as `Read(…)` and `Edit(…)` rules: `~/.ssh ~/.aws ~/.azure
~/.config ~/.docker ~/.kube ~/.gnupg ~/.claude ~/.claude.json ~/.netrc ~/.npmrc ~/.pypirc ~/.git-credentials
~/Library/Keychains ~/Library/Cookies`, `**/.env* **/*.pem **/*.key **/*.p12 **/*.pfx **/id_rsa* **/id_ed25519*
**/*.tfstate`, plus config `credentialPaths`. (`XDG_CONFIG_HOME` keeps git and other tools off the denied `~/.config`,
which otherwise prints an EPERM warning on every git command.) A relative `**/` pattern covers only the worker's
working directory, its worktree (measured, §21), so each one, built-in or from config, also gets copies anchored at
the home directory (`~/**/x`) and at the project's main checkout (`//<projectRoot>/**/x`). A rule path is a glob, so
a project root whose path holds glob characters (`* ? [ ] { } ( ) ! \`) is anchored at its nearest ancestor without
any instead (`//**/x` when that is `/`): a deny anchored higher covers more, never less. A file outside the home
directory and the project that matches only a relative pattern is still readable by worker code.

Readable env templates (§21): the `**/.env*` Read and Edit deny stays whatever config `fence.readableEnvFiles` says.
When the list is non-empty, each listed template that git tracks in the worktree and that is a regular file reached
without a link goes, by absolute path, into `sandbox.filesystem.allowRead`, which re-opens it for shell commands only;
the Read tool still refuses it. The shepherd asks git which listed files it tracks in one `ls-files` call through
the worktree's verified git dir (`--git-dir`/`--work-tree` as for the checkpoint above, hooks and `core.fsmonitor`
off), never through the worktree's own `.git` file, which the worker writes and which could point git at a config
whose `core.fsmonitor` runs on the host; when that git dir cannot be verified, nothing is re-opened. A
listed file left out (untracked, missing, a link or a directory) stays unreadable; `arbab doctor`'s env check warns
about a listed file git does not track at the project root (§21). A listed entry must be project-relative, without
`..`, naming a file that starts with `.env`.

Fence levels: `strict` (above, the default) and `sandbox-auto` (opt-in per lane: `autoAllowBashIfSandboxed: true`,
no Bash allowlist — the sandbox is the only wall; lower denial tax, broader command surface).

### Profile lint (deterministic; launch refuses on errors)

- **Error**: a bare `Bash` or `Bash(*)` allow; an "any code" allow prefix (`node`, `npx`, `pnpm`, `pnpm exec`,
  `pnpm dlx`, `npm`, `yarn`, `bun`, `deno`, `python`, `python3`, `ruby`, `perl`, `sh`, `bash`, `zsh`, `env`, `eval`,
  `xargs`, `find`, `awk`, `sed`, `make` without a further anchoring word); a deny or allow rule of the form
  `Bash(<p>:…)` where `<p>` is a Bash input parameter (`timeout`, `description`, `run_in_background`,
  `dangerouslyDisableSandbox`) other than arbab's own `run_in_background:true`; a Read/Edit rule with a single
  leading `/` (relative to the settings file — use `//`); sandbox disabled, `failIfUnavailable` false,
  `allowUnsandboxedCommands` true, or `autoAllowBashIfSandboxed` true outside `sandbox-auto`; a tool set containing
  `Task`/`Agent` without a nested-agent budget.
- **Warning**: `:*` form (generated rules use the space form); allow rules shadowed by a deny.

## 5. Brief contract

The orchestrator writes a **brief source** (Markdown); arbab assembles the prompt.

Brief source sections (`##` headings, in any order): `Task` (required), `Scope` (required: the paths this lane owns),
`Acceptance` (required), `Facts` (measured, with sources), `Unverified`, `Notes`.

Assembled prompt, in this order:

1. **Role and isolation** — generated from the profile: headless, nobody answers; the worktree and branch; what the
   fence blocks; no commits (the runner commits); no background processes; long commands use the `timeout`
   parameter.
2. **Project rules** — the files listed in config `instructions` (for example `CLAUDE.md`), inlined, because workers
   do not load CLAUDE.md.
3. Task, Scope, Facts, Unverified, Acceptance, Notes — from the source; then **Inputs** when the lane has `inputs`
   (§21) and the **Head start** of a `resume --digest` (§16).
4. **Tool belt** — generated: the allowed commands; "one command per call, foreground"; the refused shapes (`cd`,
   `&&`, `;`, `$(…)`, `| tail`, `sleep N`, `echo $?`); leased resources and their env names; the do-not-try list.
5. **Coordination** — sibling lanes and their scopes (lane field `coordination`; generated from the plan in M2).
6. **Upstream reports** — summaries of the lanes named in `upstream` (M2).
7. **Report** — generated from the schema: what the final JSON must contain.

Brief lint: required sections present; inline code that looks like a command must match the allowlist; forbidden
shapes in commands are errors; `Scope` paths must not overlap another running lane's scope (warning in M1, error in
M2 with the plan).

## 6. Reports

Each role has a default JSON schema; a lane may name its own. Validation uses a small built-in validator (type,
properties, required, items, enum, additionalProperties, minItems) — the same subset Claude Code's `--json-schema`
enforces. A `success` result without `structured_output`, or one that fails validation, ends as `invalid-report`.

Implementer and verifier: `status` (done | partial | blocked), `summary`, `files_changed[]`, `checks[]` ({command,
exit_code, result}), `decisions[]`, `open_questions[]`, `not_verified[]`, `notes_for_reviewer`. Reviewer:
`findings[]` ({title, severity HIGH|MEDIUM|LOW, file, line, failure_scenario, evidence}), `coverage` (required),
`paths_checked[]`. Researcher: `facts[]` ({question, claim, source, quote, confidence}), `not_found[]`,
`recommendations[]`. Probe: `steps[]`.

## 7. Stream accounting

The summary is computed from **every** event of `stream.jsonl` (never from the last `result` alone), the attempt
files and the transcript (`~/.claude/projects/*/<session>.jsonl`, located by session id):

- **End state**: `killed:<reason>` (exit.json) › no `result` → `no-result` (or `running` while alive) ›
  `is_error` with `api_error_status` 429 → `usage-limit` › 400 with "does not support this model" / "or newer is
  required" → `unsupported-cli` › subtype `error_max_budget_usd` → `budget` › `error_max_turns` → `max-turns` ›
  `error_max_structured_output_retries`, or schema required and `structured_output` missing/invalid →
  `invalid-report` › other errors → `failed` › `success`. Never from `subtype` alone, never from the exit code.
- **Failed tool results by cause**: `permission_denied` events by `decision_reason_type` (`mode` → dontAsk, `rule` →
  deny-rule, `other` → scope, `subcommandResults` → subcommand), then by text: analyzer, needs-approval,
  sleep-guard, input, sandbox (EPERM, "Operation not permitted", network-outbound), real.
- **Metrics**: tool calls by tool; turns (distinct assistant message ids); wall clock (exit.json); cost =
  last `total_cost_usd` (session-cumulative) and the delta against the previous attempt; measured effort (transcript
  `effort` per assistant entry); model; binary; last rate-limit snapshot; init facts (tools, permission mode,
  memory/messaging flags, MCP servers).
- **Quota**: every `rate_limit_event` updates `~/.arbab/quota.json` when newer.

## 8. Quota and parallelism

Hold a launch (state `held`) while any is true: the newest snapshot says `rejected` and its `resetsAt` is in the
future; five-hour utilisation ≥ `quota.holdAbove.fiveHour` (default 0.85) before its reset; seven-day utilisation ≥
`quota.holdAbove.sevenDay` (default 0.95) before its reset. The margin below 1.0 is the orchestrator's headroom.
Snapshots are lower bounds (other sessions keep spending), so a held lane re-checks every minute and after each
reset. `maxParallel` (default 4) bounds concurrent workers machine-wide through `~/.arbab/slots/`, capped by
`~/.arbab/machine.json`. The quota is checked before a slot is taken and again after (§21), so a lane held for the
quota holds no slot.

## 9. Worktrees and resources

- Worktree: `git worktree add -b arbab/<lane> .arbab/worktrees/<lane> <base>`; reused when it exists (resume,
  verifier). The root must be ignored (checked); arbab never removes a worktree with uncommitted changes.
- **Install points** (M3 review, round 5): the dependency command runs on the host, so it runs only on a trusted
  commit: one contained in `baseBranch`, or an integration head a human confirmed (`depsConfirmedAt`). A lane whose
  `base` is worker-written (a fix round on `integrate/<name>`, a lane continuing `arbab/<other>`) gets its worktree
  at the trusted ancestor of its base closest to it (a confirmed head, else `git merge-base <base> <baseBranch>`),
  installs there, and has its base merged first, by sha, through `mergeBranches` (fast-forward; a manifest change
  is refused). A worktree no worker has run in (a setup that failed before any attempt) is never reused: the next
  launch of its owner rebuilds it from the plan (round 6), but only when it holds nothing arbab could not rebuild, a
  clean tree on a branch whose every commit comes from a source; otherwise (uncommitted files, a hand-made commit or
  merge) the launch is refused and nothing is removed (round 9). A lane that borrows such a worktree is refused until
  the owner has run there (round 8). Worktrees are created, checked and prepared under their writer lock (round 7).
- **arbab's state never travels in a branch** (round 9): the checkpoint never stages `.arbab/` or `.arbab-tmp/`, even
  when a worker un-ignores them, and an integration record that git tracks vouches for nothing: arbab writes its
  records untracked, so a tracked one came in through a merge. Both match without case (round 10): on a
  case-insensitive disk `.ARBAB/` is the same directory.
- A relaunch after a setup that already made a merge commit is refused (that commit is not a source), and the setup
  error says so: remove the worktree and its branch first.
  `prepare()` also refuses to install in a worktree whose head is not a trusted install point.
- Dependencies (config `dependencies.strategy`): `none`; `command` (an argv run in the worktree before the worker
  starts, outside the sandbox, e.g. `pnpm install --offline --frozen-lockfile`); `clone` (M4: APFS clone). Never a
  symlink to the main checkout's `node_modules`.
- Leases: config `resources.<type>` = `{ "range": [lo, hi] }`; a lane asks `resources: {"port": 2}`; the shepherd
  takes the lowest free values (ports are also probed with a listen), exports `ARBAB_<TYPE>_<i>` and lists them in
  the tool belt; released on exit. Semaphores (config `semaphores.<name>` = capacity) serialise shared external
  resources.
- Writer lock: one per worktree path, held for the attempt; a verifier on a builder's worktree waits for it.

## 10. CLI

```
arbab [-C <dir>] <command> …         -C: find the project from <dir> instead of the working directory (§21); a
                                     lane worktree is never a project (§3)
arbab doctor                         binary, version, node, git, sandbox availability, config, ignored roots, ~/.arbab,
                                     and (§21) the plugin hook, lint and test configs scanning .arbab/, gates against
                                     package.json scripts and CI, env templates, disk, machine cap, both config files
arbab lint <lane.json>               profile + brief + config lint; exit 1 on errors
arbab launch <lane.json>             lint, take the lane's launch lock, start the shepherd, print the lane, its run dir
                                     and the shepherd pid (the shepherd creates the attempt and the session later)
arbab status [--active] [--mine] [lane…]
                                     one row per lane: state, attempt, elapsed, turns, calls, last tool, effort,
                                     failed, cost Δ (the tokens when there is no cost), quota, why (the state's
                                     reason, at most 40 characters); failures by cause are in summary.json
arbab summary [--all]                lanes by state, plans, integrations by stage, what needs attention, quota and
                                     slots; --all: every project in ~/.arbab/projects/ (§21)
arbab report <lane> [--attempt <n>]  one attempt's summary and report, the latest by default (§21)
arbab wait [--any|--all] [--all-sessions] [--timeout-min N] [--notify] [lane…]
                                     level-triggered: prints the finished lane runs not yet acked (end state, reason,
                                     attempt and report when there is one), acks each run; blocks until one (--any) or
                                     every (--all) run finishes; without lanes only this session's and ownerless runs
                                     unless --all-sessions (§21); exit 0, or 3 on timeout
arbab resume <lane> [--prompt f | --digest]
                                     a new attempt resuming the same session (manual); the prompt goes to a file in
                                     the run dir, never into the shepherd's argv; --digest: a fresh session (§16)
arbab stop <lane>                    kill the worker (no auto-resume)
arbab preflight <lane.json>          a probe attempt with the lane's binary, flags and profile; asserts §11 checks
arbab quota [--reset | --refresh]    the account snapshot and hold decision; --reset or --refresh after an account
                                     switch (§21)
arbab cleanup [--worktrees [--older-than <days>]] [--mine]
                                     reap orphans, release stale slots/leases/locks, remove empty lock directories;
                                     remove finished lanes' clean worktrees merged or landed, and landed integrations'
                                     worktrees and branches (§17, §21)
arbab plan check|next|status <plan>  M2 (§16); next takes --retry <phase> (§21)
arbab integrate <name> (--lanes a,b | --plan p | --deps-installed <sha> | --adopt <ref> [--base <branch>] | --refresh)
arbab verify (<name> | --ref <branch>)
arbab review <name> [--lenses a,b] [--lens-file <lens>=<file>]… [--since <sha>]
arbab readiness <name> [--tier t] [--waive ids]
arbab host-check <name>
arbab land <name> [--squash] [--message <file>] [--keep-worktrees]
                                     M3 (§17), with §21's additions
arbab ui [--port N] [--hours N] [--no-open]
                                     the pyramid scene on 127.0.0.1 (§19)
arbab hook pre-tool-use|stop         the plugin's hooks (§21); not listed in the help
arbab __shepherd <root> <lane> <mode-json>
                                     internal
```

Every command but `hook` and `host-check` takes `--json`; `verify`, `review` and `preflight` take `--timeout-min N`.
`arbab <command> --help`, `-h` and `arbab help <command>` print the command's options (`src/commands/usage.ts`).

Exit codes: 0 ok, 1 usage or lint error, 2 runtime error, 3 wait timeout. `--json` output is stable and documented.

## 11. Preflight

Two probe lanes, written under `.arbab/preflight/<lane>/`, use the lane's tools and fence: one on `haiku` runs the
project's `preflight.steps` (e.g. `pnpm typecheck`) as single foreground commands, in the lane's worktree when it
already exists; one on the lane's own model runs `git rev-parse --short HEAD` and answers `OK <sha>`. Lanes and probes
are held like any other lane while the quota is above its threshold (measured: arbab held its own first preflight
until the five-hour reset, then both probes passed every check). It passes only if: the init event shows the expected tools, `dontAsk`, no MCP
servers, no `memory_paths`, no `messaging_socket_path`, the pinned version; stderr has no "has not been trusted" or
"Ignoring" warning; the registration (when present) is not `claude-vscode`; at least one real tool call ran and the
sha matches; every step exited 0.

## 12. Landing and the readiness gate (M3, method in M1)

A fast run tends to skip checks silently (owner's example, 2026-10-09: no independent review, an eval not re-run, a
page never opened in a browser, a narrow sample). Landing therefore produces a **readiness report** with three
lists, and a human decision:

- **verified** — each gate with its command and exit code, review verdicts, smoke tests, evals;
- **skipped** — every check the risk tier requires that did not run, each needing an explicit human waiver;
- **risks** — open questions, `not_verified` items from worker reports, and facts found in live data (read-only
  production queries are written by workers and run by the orchestrator, never by workers).

Push and deploy stay human actions. In M1 the skill teaches this as a manual checklist; M3 automates the report.

## 13. Module ownership (M1 lanes)

| Module | Owns | Depends on |
| --- | --- | --- |
| `src/types.ts`, `src/util/*` | the contracts and shared helpers — written by the orchestrator before wave 1 | — |
| `src/stream/` | parse, classify, failure causes, metrics, transcript lookup, rate-limit snapshot | types, util |
| `src/profile/` | role presets, compile (flags, settings), the scrubbed worker environment, profile lint | types, util |
| `src/config/`, `src/binary/`, `src/report/` | config load/defaults/validation; binary resolve/pin/version; JSON-schema subset validator and default schemas | types, util |
| `src/brief/` | brief source parse, assembly, brief lint | types, util (profile via its exported types only) |
| `src/run/` | worktree, dependencies, leases, locks, slots, spawn, descendant tracking, kill/reap, checkpoint | types, util |
| `src/registry/`, `src/quota/` | run-dir layout, attempt records, state, status rows, wait/ack; account snapshot and hold decision | types, util |
| `src/shepherd/`, `src/cli.ts`, `src/commands/`, `scripts/build.mjs`, `test/fake-claude/` | wave 2: lifecycle wiring, auto-resume, commands, bundle, end-to-end tests | all |
| `skills/arbab/`, `.claude-plugin/` | wave 2: the method and the plugin manifests | the CLI surface (§10) |

## 14. Testing

- Unit tests next to the code (`src/**/*.test.ts`, vitest), for every exported function, including failure paths.
- Fixtures in `test/fixtures/stream/`: sanitized real w0 streams (paths replaced, skill and plugin lists trimmed) and
  synthetic ones for usage-limit, unsupported-cli, budget, structured-output retries, background-task multi-result
  and truncated streams.
- `test/fake-claude/`: an executable that replays a fixture with timing, honours `--session-id`/`--resume`, can hang
  or spawn a child, so the shepherd's lifecycle (timeouts, reaping, auto-resume, quota hold) is tested without
  spending quota.
- A real end-to-end test behind `ARBAB_E2E_REAL=1` (haiku, cents).
- Gates: `pnpm typecheck`, `pnpm test`, `pnpm build`; the preflight against this repository before each wave.

## 15. Security notes

- No shell strings: every subprocess is `execFile`/`spawn` with an argv array.
- Paths from lane files and config are resolved and confined to their roots; names are validated (§3).
- Env values are never written to disk; only their names.
- Locks and leases are O_EXCL files whose holder pid is checked; stale entries are reclaimed only when the holder
  is dead.
- Nothing arbab trusts lives in the per-user temp dir that every sandbox can write (`/tmp/claude-<uid>`); helpers
  and fences live in `.arbab/` and `~/.arbab/`, outside every worker's writable set. The skill tells orchestrators
  not to keep executable helpers in their scratchpad while workers run.
- Fixtures contain no private paths, prompts or customer data.

## 16. M2 — plans, digests, sharper lint

### Plan format (`plans/<name>.json`, FR-9)

```json
{
  "name": "m2",
  "base": "main",
  "defaults": { "role": "implementer", "effort": "high", "budgetUsd": 10 },
  "phases": [
    { "name": "m2-plan", "brief": "lanes/m2-plan.md", "scope": ["src/plan/**"] },
    { "name": "m2-wire", "brief": "lanes/m2-wire.md", "scope": ["src/commands/plan*.ts", "src/shepherd/**"],
      "dependsOn": ["m2-plan"], "effort": "high" }
  ]
}
```

- A phase is a lane: `name`, `brief`, optional `role`, `model`, `effort`, `budgetUsd`, `wallMin`, `idleMin`, `fence`,
  `allow`, `schema`, `resources`, `semaphores`, `worktree`; plus `scope` (write globs, required) and `dependsOn`.
- `checkPlan` refuses: duplicate or invalid names, unknown dependencies, cycles, a phase without scope, and
  **overlapping write scopes between phases that are not ordered by a dependency**. Two globs overlap when some path
  could match both, compared segment by segment (`**` spans segments; `*`, `?` and classes stay within one; literals
  compare without case); a bare path, an entry with no glob characters, covers itself and everything under it
  (`src/plan` overlaps `src/plan/graph.ts`), and brace sets are expanded first, so each alternative follows that
  rule by itself (`src/{plan,run}` overlaps `src/plan/graph.ts`); a glob that comparison cannot read falls back to comparing the fixed
  paths before the first wildcard. Both err toward overlap (§21; before it, only fixed prefixes were compared).
- Waves are the topological levels. `compilePhase` turns a phase into a `LaneSpec` with:
  - `upstream` = its dependencies (their reports are inlined, DESIGN.md §5);
  - `mergeBranches` = their branches (`arbab/<dep>`);
  - `coordination` = the other phases of the same wave and their scopes.
- The shepherd prepares a worktree no worker has run in yet (created now, or no attempt has ever started there, as
  recorded by `<runs>/<owner>/worktree-used`, checked under the writer lock) in this order:
  1. the dependency command on the **trusted base**;
  2. each `mergeBranches` entry, resolved once to a sha and merged as that sha (`git merge --ff`: a fast-forward
     when the worktree has nothing of its own yet, a merge commit otherwise).
- A merged branch that changes a dependency manifest (`package.json`, lockfiles including `npm-shrinkwrap.json`,
  `.npmrc`, `.yarnrc*`, `.pnpmfile.*`, `pnpm-workspace.yaml`, `bunfig.toml`, `.pnp.cjs`, `.pnp.loader.mjs`, `*.patch`,
  files under `.yarn/releases|plugins|patches/`) in a way that can change an install (§21) is refused before merging. Installing after such a
  merge would run an upstream worker's code on the host (M2 review R1). The orchestrator reviews and lands the
  dependency change first.
- A conflict or a missing branch aborts the merge and fails setup, naming the paths. Nothing is left to resolve in
  the worktree: fix the branches and relaunch the phase. No worker has run there, so the shepherd rebuilds the
  worktree from its install point and merges again (§9).
- Commands:
  - `arbab plan check <plan>`: validate the plan, lint every phase's lane, print the waves.
  - `arbab plan next <plan>`: launch every phase whose dependencies all finished `success` with their work on
    their branch (a checkpoint commit, or nothing to commit) and that has not run. It is idempotent: phases already
    launched are left alone; blocked dependencies are listed, and a dependency that failed, was orphaned or whose
    checkpoint failed is reported as failed upstream. A phase others depend on must checkpoint (`checkPlan`).
    `--retry <phase>` (§21) first relaunches a phase that ended in anything but `success`, or was orphaned.
  - `arbab plan status <plan>`: one row per phase, with its wave, its dependencies and the lane's state.

  The orchestrator calls `plan next` after each `wait` notification; there is no plan daemon.
- The skill converts a design document (for example `/sc:design` output) into a plan and briefs.

### Digest seeding (FR-19)

- `renderDigest(events, opts)` turns an attempt's stream into a bounded Markdown digest. Every item body sits in a
  `text` fence one backtick longer than any run inside it, so stream content can never open a heading or a brief
  section (M2 review R4):
  - `### CALL <tool>`, with input ≤ 400 chars;
  - `### RESULT`, ≤ 1,500 chars, errors kept;
  - `### NOTE` for assistant text, ≤ 2,000 chars;
  - the final report, when there is one;
  - a total cap (default 60,000 chars) that drops the oldest items first and says how many were dropped.
- `arbab resume <lane> --digest` starts a **fresh** session in the lane's worktree. Its brief has a `## Head start`
  section, inserted after `Notes`: the digest of the latest attempt, introduced by "this is what a previous attempt
  did; verify the worktree with `git log` and `git status` before relying on it".
- Use it for a long attempt stopped long ago (cold cache: a cold resume re-pays the whole context), or when a
  session went wrong.

### Brief lint: command spans only

Inline code is checked for denied commands and forbidden shapes only when it is a **command span**:
- inline code in the `Acceptance` section;
- any line of a shell fence;
- inline code that a line introduces as something to run: the text before it ends with "run", "runs", "execute",
  "call", "with the command" or "Bash:", case-insensitive.

A paragraph introduces its spans (lines are joined), and spans following a command span in the same sentence ("and",
"then", a comma) are command spans too. Shell fences are recognised case-insensitively and every line is checked for
denied commands and forbidden shapes. Before matching, leading `NAME=value` assignments and `env` are dropped and a
path in the first word becomes its basename; `bash -c`/`sh -c`/`zsh -c` is a forbidden shape.

Descriptive code elsewhere (a parameter name, a command named as an example) is not a command. M1's briefs hit
these false positives six times.

## 17. M3 — integrate, verify, review, readiness, land

M1 and M2 were integrated by hand: merge lane branches into an integration worktree, run the gates, run reviewer
lanes, write a readiness report, ask the owner, merge into `main`. M3 makes those steps commands. One rule changes on
the way. **Verification runs worker-written code (tests), so it runs inside the fence**, not on the host as the
orchestrator did by hand in M1–M2.

All of an integration's records live in `.arbab/integrations/<name>/`: `integration.json`, `verify.json`,
`review.json` and `reviews/<round>.json`, `host-checks.json`, `readiness.json` + `readiness.md`, `landing.json`.

Rules the M3 review added (`arbab review m3`, 10 confirmed findings):
- **No worker-written hooks on the host.**
  - A repository's relative `core.hooksPath` (husky's `.husky`) resolves inside a work tree that workers write.
  - So every git command arbab runs on the host in such a tree goes through one helper (`untrustedTree()`): the
    checkpoint, the shepherd's dependency merges, the integration merges, dirty checks, verify's clean check,
    cleanup and the landing merge. It sets `-c core.hooksPath=/dev/null -c core.fsmonitor=false
    -c diff.ignoreSubmodules=all -c submodule.recurse=false`.
  - The project's checks run inside the fence through `verify` instead. This replaces FR-8's "run the commit
    hooks".
- **No nested repository is entered (fourth review, HIGH, measured on git 2.54).** A worker can create a git
  repository inside its worktree. Once staged as a gitlink, any host `git status` or `git add -A` there spawns a git
  inside it that reads its worker-written config and runs its `core.fsmonitor` or a clean filter on the host;
  `-c core.fsmonitor=false` alone does not stop the filter. So status always runs with `--ignore-submodules=all`
  through the verified git dir (`worktreeStatus`, which also lists checked-out gitlinks as changes), and the
  checkpoint never stages a nested repository: it excludes them by literal pathspec, commits the rest and reports
  what it left out. A missing lane worktree is never re-created on a branch holding commits its base lacks (the
  shepherd would install there on the host).
- **Reserved names.**
  - Lane and phase names may not start with `integrate-`, which is the integration worktree's namespace; nor may an
    integration be named `integrate`.
  - Lanes that `verify` and `review` generate (`<name>-verify`, `<name>-review-<lens>`, `<name>-skeptic-<lens>`)
    carry an ownership marker (`generated.json`: the integration and the head they started from).
  - A reset touches only a lane its own integration generated: a foreign lane of the same name is refused with
    nothing removed, and a branch that moved past its recorded head is never deleted.
  - `launch` and `resume` refuse a generated lane's name. (Before this rule, `verify m3` reset a lane of arbab's own
    build that happened to be named `m3-verify`.)
- **No unreviewed install.**
  - Generated lanes start from the integration head, and their new worktrees install dependencies on the host.
  - So `verify` and `review` both refuse while a merged lane changed a dependency manifest that the human has not
    confirmed (`integrate --deps-installed <sha>`).

The second review (`arbab review m3` after those fixes: 8 confirmed, 1 HIGH) showed that a manifest check cannot make
an install on worker code safe, and tightened the records:
- **Generated lanes install only on a trusted commit.** An install runs files no manifest list covers (a
  `postinstall` that runs `scripts/setup.js`, `pip install -e .` running `setup.py`, a `Makefile`). A generated lane's
  worktree therefore starts at the integration's `baseSha`, or at `depsConfirmedAt` when manifests changed and a human
  installed them at that head, installs there, and only then fast-forwards to the integration head (the shepherd's
  `mergeBranches`, the same order plan phases use). Every commit is a sha from the record, so a later `integrate`
  cannot change what a queued lane installs on.
- **Manifests from every commit.** `integration.json` `manifests` is every dependency manifest that differs between
  `baseSha` and the head, whoever committed it (a conflict resolved by hand, a merge whose record was lost).
  `depsConfirmedAt` is the head a human confirmed; it is dropped when a later change touches a manifest, and
  `--deps-installed <sha>` confirms only the head it names, which must be the recorded head (round 6). Confirming
  vouches for the whole install at that head, not only the manifest lines: the human reviews what an install there
  runs (package.json scripts and the files they run, `.npmrc`, `.pnpmfile.*`), because verify and review then
  install at that head on the host (round 8). It is the human's step: the CLI refuses it without a terminal (an
  agent's shell has none), so an orchestrator cannot confirm on the human's behalf.
- **No lane is dropped.** One entry per lane, also for a lane already contained in the head; a lane whose worktree
  holds uncommitted changes (its checkpoint did not commit them) is refused; a lane that works in another lane's
  worktree blocks that lane's integration while it is active.
- **`land` lands only the verified tree.** The base's HEAD must be an ancestor of the verified head, so the landing
  merge holds exactly the tree that was verified. When the base moved, merge it into the integration (with hooks
  off: `land` prints the exact command, since a plain merge there would run worker-written hooks on the host), record
  the new head with `integrate <name> --refresh`, and run verify, review and readiness again.
- **Readiness** lists every confirmed finding as a risk, whatever severity the skeptic gave it, and counts a lens only
  when it reported coverage.

The third review (8 confirmed, 1 MEDIUM, after `land` learned to clean up) added:
- **A verify lane cannot change what it verifies.** It runs with `tools: ["Read", "Bash"]` (`LaneSpec.tools` narrows a
  role's tools, never widens them, and a tool left out does not exist for the worker); the first call of each gate
  command decides its result; and after the run its worktree must be clean through the verified git dir. Otherwise
  `verify.json` records `passed: false` with the `reason`, as it does for a lane that ran on another commit.
- **Records follow branches.** A landed integration's name is closed: `integrate` and `--deps-installed` refuse it,
  naming the landing. When `integrate/<name>` is created anew, an older `integration.json` is moved aside as
  `integration.superseded-<updatedAt>.json` and a fresh record starts from the new base. The name `integrate` is
  reserved too (its generated lanes would start with `integrate-`).
- **Integrate only what has stopped.** A lane whose worker is still alive (orphaned: its shepherd died) is refused. A
  plan phase that works in the worktree of a lane outside the plan brings that lane into the integration, once, at
  the phase's place.
- **Cleanup is conservative** (see `land` below): finished lanes only, status only through the verified git dir, lane
  branches kept, a borrowed generated worktree never reset, and `launch`/`resume` refuse to borrow one.

- **`arbab integrate <name> (--lanes a,b,… | --plan <plan>)`**:
  1. create or reuse the worktree `.arbab/worktrees/integrate-<name>` on branch `integrate/<name>` from `baseBranch`;
  2. run the dependency command there on the trusted base;
  3. merge each lane branch by sha (`--no-ff`), in the given order or the plan's waves.

  A conflict aborts and stops, naming the paths. A lane whose manifest change can change an install (§21) is merged
  but flagged: the dependencies are **not** reinstalled automatically (that would run worker code on the host).
  `verify` refuses until the human has reviewed and installed them, and confirmed with `arbab integrate <name>
  --deps-installed <sha>` (the head `integrate` printed).
- **`arbab integrate <name> --adopt <ref> [--base <branch>]`** (§21) makes a new integration whose branch
  `integrate/<name>` starts at `<ref>`'s commit, with nothing merged, based on `--base` or `baseBranch`, so work done
  outside lanes gets verify, review, readiness and land. Its worktree is created and installed at the fork point of
  `<ref>` and the base, then fast-forwarded to `<ref>` with hooks off. So, before creating anything, it refuses a
  base that is not a branch (`land` merges into the recorded base, so a commit or `main~0` would make an integration
  that never lands), a base that `baseBranch` does not contain (a lane or integration branch as `--base` would install worker code) and a
  fork point that is not a trusted install point (§9); it also refuses an existing or landed name, a ref that names
  no commit, and `--lanes` or `--plan`. Lanes can be integrated into it afterwards. Integration names starting with
  `ref-` are refused: `verify --ref` uses that prefix.
- **`arbab integrate <name> --refresh`** records an existing, unlanded integration's head again after a hand commit
  or a merge of the base in its worktree: the merged entries the head still holds stay, and the manifests, `baseSha`,
  `headSha` and `updatedAt` are recomputed as `integrate` does. It merges nothing and runs no dependency command. It
  refuses without a record or a worktree (recreating one would install), for a landed integration, with tracked
  changes in the worktree, and with any other mode. `land`'s refusal for a moved base names it as the step after the
  merge.
- **`arbab verify <name>`**:
  - launches a probe lane `<name>-verify` (haiku, tools Read and Bash, exact allow rules for the gates) in its **own
    worktree**, installed on a trusted commit and then fast-forwarded to the integration head (see above);
  - it runs every `config.gates` argv, then `config.verify.smoke` when set, as single foreground commands;
  - the exit codes are read from the stream's tool results for those exact commands (`exit 0` when not an error,
    `Exit code N` otherwise; the first call of a command decides), never from the model's report. A gate whose call
    cannot be found counts as `missing` (a failure).
  - a re-run on the same head waits for a `<name>-verify` still running, or takes the result of one that finished
    after an earlier verify stopped waiting (§21).
  - while it waits for its lane, the command is registered in `~/.arbab/waiters/`, as `arbab wait` is, so the Stop
    hook does not block the turn it waits in; `review` and `preflight` do the same.
  - **`arbab verify --ref <branch>`** (§21) runs the same lane, `<id>-verify`, on the branch head with nothing merged
    on top: the check after landing. `<id>` is `ref-<slug>-<hash>`: the slug is the branch lowercased, every other
    character `-`, at most 22; the hash is the first 6 hex digits of the branch name's sha1, so branches whose slugs
    collide (`Release/Next` and `release-next`) never share a lane. Its record goes to `.arbab/refs/<id>/verify.json`,
    named `ref:<branch>`.
- **`arbab review <name> [--lenses a,b] [--lens-file <lens>=<file>]… [--since <sha>]`** (the tier lives in
  `readiness`):
  - one reviewer lane per lens, `<name>-review-<lens>`, each in its own worktree at the integration head (prepared
    as for verify);
  - built-in lens templates `correctness`, `security`, `contracts`, plus config `review.lenses`
    (`{name: "what to look for"}`);
  - every brief carries the depth floor: read in full the files changed by `git diff <base>..integrate/<name>`,
    every finding with evidence, a coverage section;
  - after the lenses, one skeptic lane per lens with MEDIUM+ findings (verdicts schema) tries to refute them;
  - `review.json` keeps every finding with its verdict (`confirmed`, `refuted`, `unverified`), and each run also
    writes it as `reviews/<round>.json`, numbered from 1 (§21);
  - `--lenses` re-runs some lenses and keeps the other lenses' entries, skeptics and findings from the previous
    `review.json` of the same head;
  - `--lens-file <lens>=<file>` adds a lens, or replaces a built-in or config lens's text, for this run only; nothing
    is written to the config. The file must lie inside the project by its path and by its real path, and neither
    may be a credential file by the fence's whole list plus config `credentialPaths` (`.env*`, `*.pem`, `*.key`,
    `id_rsa*`, …), matched without case (`.ENV` is refused too; §21), so a lens cannot carry a credential file into
    a reviewer's brief; the name rules and relative patterns look only below the project root (§21, Fence);
  - `--since <sha>` diffs from that commit, an ancestor of the head other than the head, instead of the base (a fix
    round), and records it as `since`;
  - a re-run on the same head waits for, or adopts, reviewer and skeptic lanes still running or finished after an
    earlier review stopped waiting.
- **`arbab readiness <name> [--tier …] [--waive item,…]`** writes the FR-21 report:
  - **verified**: verify gates and smoke with exit codes, review lenses run, and confirmed and refuted findings;
  - **skipped**: what the tier requires that did not run or did not pass;
    - `low`: verify;
    - `medium` (the default, config `landing.tier`): verify and at least one lens;
    - `high`: verify, every configured lens, the skeptic pass and smoke.

    At every tier: `deps` (manifests changed, install not confirmed) and, with config `hostGates`, `host` (§21).
    Each skipped item stays until it runs or is waived by name; `--waive` needs a terminal (§21).
  - **risks**, by weight (§21): every confirmed finding, unverified MEDIUM+ findings and one line for the unverified
    LOW ones, manifest changes, host gates, stale or unmatched items, then the merged lanes' `open_questions` and
    `not_verified` (and those of lanes that worked in a merged lane's worktree), repeated notes grouped.
  - verify counts only on the head itself. The review counts on the head, or on an earlier head when the head is
    a clean merge of the integration's own recorded base (the branch `land` merges into, not the current
    `baseBranch`) into it (§21): `reviewCarriedOverFrom` names it.
- **`arbab host-check <name>`** (§21) runs config `hostGates` in the integration worktree, on the host, in order and
  all of them, and writes `host-checks.json`. It refuses without a terminal, without `hostGates`, and unless the
  worktree is at the recorded head with no tracked change.
- **`arbab land <name> [--squash] [--message <file>]`**:
  - refuses unless verify passed and readiness has no unwaived skipped item;
  - refuses unless the main checkout is on the integration's base and contained in the verified head, with no
    tracked change and no untracked file where the merge writes (§21: other untracked files are left alone and
    listed as `left alone:`);
  - merges `integrate/<name>` into it (`--no-ff`) and records `landing.json`; with `--squash` (or config
    `landing.squash`) it makes one commit instead (`merge --squash`, then a commit, hooks off). `--message <file>`
    replaces the `Land <name>` message of either; the file must lie inside the project, also after resolving links,
    and neither its path nor its real path may be a credential file by the same list and matcher as `--lens-file`
    (ignoring case), so a landing cannot commit credentials. `landing.json` records `squash` and the
    `lanes` it carried;
  - prints the push command and "not pushed". It never pushes;
  - then cleans up what it landed, unless `--keep-worktrees`: the worktrees of the merged lanes, of the lanes
    generated for the integration and of the integration itself. A worktree is removed only when its lane is
    `finished` (not orphaned), no active lane borrows it, it passes `verifyWorktreeGit` and is clean through that
    verified git dir, and its branch is merged, or after a squash landing held by the landed head (`git worktree
    remove`, never `--force`; only a generated lane's own reset, of arbab's scratch, forces). Branches are deleted
    (`git branch -d`) only for generated lanes and the integration: a lane's `arbab/<lane>` stays, because a plan
    phase launched later merges its dependencies by that name (M3 review, round 3). Anything else is kept and
    reported with the reason; a cleanup problem never fails the landing. Run directories and the integration's
    records stay: they are the measurements, and a landed integration's name is not reused.

  The skill asks the human before running it, and the plugin's hook never approves it (§21): it goes through
  Claude Code's normal permission flow. Lane worktrees are not removed when a lane finishes: `resume`
  continues in the same worktree, verifiers borrow a builder's worktree, and work that is not integrated stays
  inspectable. Lanes that are never landed are removed with `arbab cleanup --worktrees` once merged, or landed by a
  `landing.json` that lists them (§21).

**Packaging.** `pnpm build` bundles the runner and assembles `plugin/`: `.claude-plugin/plugin.json`, `skills/**`,
`hooks/hooks.json` (§21) and `dist/arbab.mjs`, nothing else. The marketplace points at `./plugin`, because a local marketplace install copies
the plugin's whole source directory, ignored files included (measured on CLI 2.1.295): from the repository root it
would copy `node_modules`, `.arbab/` and the private research.

## 18. M4 — denial telemetry, raw HTTP for researchers

- **`arbab denials [lane…] [--role r] [--json]`** (FR-13) aggregates refused tool calls across attempts. It reads
  causes from each `summary.json` and the refused commands from the streams (the `tool_use` input of every refused
  result), grouped by cause and by command prefix (first two words), with counts. Suggestions:
  - a dontAsk refusal of a prefix that is not "any code" → add it to `config.commands.<role>`;
  - analyzer, needs-approval and sleep-guard refusals → the brief shape to fix (single commands, the `timeout`
    parameter);
  - deny-rule refusals → denied on purpose; if frequent, the brief asks for something the fence forbids;
  - sandbox refusals → outside the fence.

  It never edits the config.
- **`arbab http <url> [--head] [--header k:v]… [--user-agent s] [--max-bytes n] [--max-redirects n]`** (FR-14) is a
  raw HTTP tool for researcher workers. WebFetch summarises, cannot show a status or raw XML, and gets 403s from
  bot-blocking sites.
  - It prints the status line, the headers and up to `--max-bytes` (default 200,000) of the body, for http/https
    only.
  - It follows at most `--max-redirects` (default 3), printing each hop.
  - Inside a sandbox it needs Node's `--use-env-proxy` (measured): it re-executes itself with that flag when a proxy
    is set and the flag is missing.
- **Researcher lanes with `domains`.** A researcher lane may list `domains` (lane field, e.g.
  `["example.com", "*.gov.ae"]`). The profile then:
  - adds `Bash` to the tools, with the single allow rule `Bash(<node> --use-env-proxy <arbab> http *)`;
  - sets `sandbox.network.allowedDomains` to the list.

  A researcher without `domains` keeps WebSearch and WebFetch only. It has no local file tools either way, so prompt
  injection finds nothing local to send.

## 19. `arbab ui` — the pyramid scene

The fleet at a glance, for the human next to the orchestrator: a local page where every lane is a worker building a
pyramid and arbab is the foreman. The owner's idea (2026-10-11) and decisions (2026-10-18): arbab stands at the front
of the scene and *talks* to each worker (speech bubbles of meaningless glyphs) when it hands out a brief and when it
takes a report; a pyramid is an integration; sound is off until the viewer turns it on.

### Command

`arbab ui [--port N] [--hours N] [--no-open] [--json]` serves the project's scene until SIGINT or SIGTERM.

- It opens the page, `http://127.0.0.1:<port>/#token=<token>`, in the browser, then prints only
  `http://127.0.0.1:<port>/`. The page counts as opened when the opener (`open` on macOS, `xdg-open` on Linux) exits
  0, or is still running after 5 s (some `xdg-open`s wait for the browser they start).
- With `--no-open`, or when no browser could be opened (no opener, a spawn error, a non-zero exit), it prints the URL
  with its token instead.
- `--json` prints `{"url", "port"}`, the URL with its token, because it is asked for.

Claude Code keeps a background command's output on disk and in the session transcript. So the token goes to the
browser, and onto stdout only when a person has to open the page by hand.

`--port` is 0 (the default: the system picks) or 1024–65535; a browser leaves port 80 out of `Host` and `Origin`,
which the server's checks would refuse. `--hours` (default 24, 1–720) is the window. It is read-only: it writes
nothing under `.arbab/` or `~/.arbab/` and signals no process. The skill starts it as a background Bash call before a
session's first launch.

### Server (`src/ui/server`)

- It listens on `127.0.0.1` only. Every request must carry `Host: 127.0.0.1:<port>` or `localhost:<port>` (a DNS
  rebinding page carries its own host), use GET or HEAD (405 otherwise), and have a URL of at most 2,048 characters. A
  `Sec-Fetch-Site: cross-site` request or one whose `Origin` is not the server's own is refused (403).
- The session token is 128 random bits in hex.
  - arbab never writes it to disk. It is printed only as the Command section says.
  - It is required, as `?token=`, by the data routes `/events` and `/snapshot.json` (compared in constant time; 401
    otherwise).
  - The opener carries the URL in its argv, where other local users can read it with `ps`: briefly on macOS
    (`open` exits at once), and for the browser's life on Linux (`xdg-open`, and a browser it starts). On a shared
    machine, use `--no-open`.
- The page, `/app.js`, `/app.css` and `/icon.svg` are public code; they are served from memory, never from a path.
- Every response carries `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self';
  img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`,
  `X-Frame-Options: DENY`, `Cross-Origin-Resource-Policy: same-origin` and `Cross-Origin-Opener-Policy: same-origin`,
  and no CORS header.
- `/events` is server-sent events: `retry: 2000`, a snapshot at once, then one whenever a tick (1 s) finds it changed
  (ignoring `now`), and at least every 30 s. At most 16 clients (503); a client more than 4 MiB behind is dropped.
  Snapshots are built only while a client listens, once per tick for all of them; a build that throws is skipped,
  and three in a row send a `problem` event.
- The **window**: a lane is in the snapshot when it is not finished, its state changed within `--hours`, or it was
  merged into an integration that is not landed or landed within `--hours`. At most 300 lanes, the newest by
  `firstSeen`; the rest, and lanes whose records do not parse, are counted in `hiddenLanes`.
- A running attempt's tool calls are counted from its stream incrementally, the way `digestStream` counts them: one
  per `tool_use` id, `StructuredOutput` excluded. The counter keeps a byte offset per attempt. Its first read of an
  attempt takes at most 64 MiB, and each later read one chunk of 8 MiB, so no tick blocks on a long run's stream.
- A snapshot carries states, counts, costs, names and enums (`src/ui/protocol.ts`): never a brief, report text,
  stream content, an environment value or a path. The exceptions are a state's `reason` (cut to 200 characters) and the
  project directory's name. A tool name outside `^[A-Za-z0-9_.:-]{1,64}$` becomes null.

### Scene (`src/ui/client/scene`, model in `src/ui/client/model.ts`)

The cast:

| Lane | Worker | Builds a block | Works |
| --- | --- | --- | --- |
| implementer | laborer | yes | at its block |
| verifier, own worktree | mason | yes | at its block |
| verifier in another lane's worktree | mason | no | at that lane's block |
| reviewer generated by `review` | scribe | no | walks the pyramid's foot and lower courses, writing |
| skeptic generated by `review` | skeptic | no | like a scribe, talking now and then |
| other reviewer | scribe | no | like a scribe |
| probe generated by `verify` | surveyor | no | measures at the pyramid's right foot |
| probe generated by `preflight` (whatever its role), other probe | water carrier | no | walks between the well and the site |
| researcher | scout | no | walks off past the dunes and back |

A worker's day:

1. It comes in from the village path at the left edge. `queued` and `held` sit in the camp (an hourglass above a lane
   held for the quota, dots above one held for a slot).
2. `preparing` or `running`: it walks to arbab and they talk (alternating bubbles of glyph gibberish), then a builder
   carries a stone to its block, climbs to it and works; the others go to their place. One worker talks at a time;
   at most six wait in line behind it, and the rest wait where they are until a place frees up.
3. `running`: one stroke per new tool call (at most six queued), a stone placed per stroke, with dust. A building
   block's fill is `min(0.95, 1 − e^(−calls/40))`.
4. `waiting-reset`: it sleeps where it works (zzz).
5. `finished`: at once, a builder's block is **set** (fill 1, a shine) on success with a `done` report (or none), is
   **stalled** on a `partial` or `blocked` report, and **falls** otherwise (its stones tumble to the foot as rubble;
   the slot stays an empty gap until the lane runs again). The worker walks back to arbab and they talk. With success it
   takes its ration from the table, by its cost (`costDeltaUsd`, else `costUsd`): under $1 a loaf, under $5 a loaf and
   a jug, else a basket and a jug; a `partial` report gets a loaf. As it takes its ration, coins jump from the treasury
   with a clink (the `pay` event, owner's request). A `blocked` report or any other end state leaves empty-handed,
   slumped. Then it walks off the left edge.
6. `orphaned`: a pale ghost where it stood, with a question mark, until the lane changes.

The first snapshot sets the scene as it stands, without walks: workers stand where their state puts them, finished
lanes have no worker, and blocks show their outcome. A lane that leaves the window fades out.

Pyramids:

- The **foreground pyramid** holds the building lanes not in a landed integration, plus those of every integration
  landed within the last 10 minutes (so its capstone can be seen; the newest landing holds the capstone, and one that
  lands during another's hoist waits for it to set). Blocks fill the bottom course first, left to right, in
  `firstSeen` order: the oldest work is the foundation. The base is `max(4, the least b with b(b+1)/2 ≥ lanes)`; slots
  no lane has taken are drawn as a faint outline.
- The **capstone** belongs to the newest integration that is not landed and merged a foreground lane: it waits on a
  sledge at the right foot with a green or red flag once `verify` ran on its head, and gleams when readiness is ready.
  When the integration lands, it is hoisted to the apex.
- Landed integrations stand as up to three small finished pyramids on the left horizon, the newest nearest the site.

The sky is day, dusk while launches are held, and night while the account is rejected; the sun crosses its arc over
the five-hour window. The treasury's coin pile is `min(48, round(6·√(total cost of the lanes in view)))`.

### Page (`src/ui/client/app`)

- One canvas of 480×270 logical pixels, scaled by an integer and drawn pixelated. All text lives in the DOM: a header
  (project, lanes by state, total cost, quota, connection, sound toggle), a tooltip with the lane's facts on hover, a
  crew list (each lane focusable; focus or hover highlights its worker and block), a table of the lanes (the
  accessible equivalent of the canvas) and a polite live region that announces finishes and landings.
- Text goes in with `textContent` only; nothing from a snapshot is ever parsed as HTML. `prefers-reduced-motion` moves
  actors at once and drops particles.
- Sound: a drum, a horn and coins synthesized with WebAudio (no files), off by default; the toggle is remembered in
  `localStorage`. A brief and a report sound the horn, a stone the drum (at most 3 a second), a set block a fanfare, a
  fall a thud, a capstone a fanfare and a drum roll, and a ration coins clinking into the chest (at most 2 a second).
- The renderer draws with solid `fillRect`s and `globalAlpha` only, so the same code rasterizes the scene into PNG
  frames in tests. `docs/ui/*.png` are those frames: the README's pictures and the renderer's goldens (compared by
  pixel, so another zlib cannot fail them).

### Build

`scripts/build.mjs` bundles `src/ui/client/app/main.ts` for the browser (IIFE, minified) and, inside the runner
bundle, replaces `src/ui/client/app/bundle.ts` with it. Run from source (tests), that file's `null` makes the server
send a placeholder script.

Not in this version: actions from the page (stop, resume), several projects in one page, history beyond the window.

### The game-studio pass (2026-10-19)

The owner's verdict on the first version: too empty and too plain. It should look as if it came out of a game studio.
The owner chose a dashboard around the scene, not a full-screen game HUD.

**Page.** A dark night-desert game interface with gold accents:
- **Top bar**: the logo (a pixel pyramid) and the wordmark, the project and version, two stone-tablet quota gauges (5h
  and 7d, each with a tick at its hold threshold), a pulsing LIVE pill, and the sound button.
- **KPI cards**: at work (running and preparing), waiting (queued and held), asleep (waiting-reset), finished (✓ and
  ✗), and the treasury (the spend in view). Each has a pixel icon, a big pixel-font number that counts up when it
  changes, and a label.
- **The scene card**, "The site": the canvas in a carved frame, a caption under it (the integration, its blocks, the
  capstone, verify), and a full-screen button. A title card, the logo and "the site awakens…", fades out at the first
  snapshot.
- **The side panel**:
  - **Crew**: one card per lane. A card holds an avatar (the lane's sprite, drawn at 3×), the name and role, a state
    badge, elapsed time, a progress bar (the block's fill) and calls, last tool and cost. Active lanes come first, and
    recently finished lanes sit in a folded group.
  - **Monument**: the current integration as a stepper (integrated → verify → review → ready → landed) with its
    findings.
- **Below**:
  - **Chronicle**: a feed of what happened (started, finished with its end state and cost, landed, verify), built from
    the snapshot and its changes, newest first.
  - **Ledger**: every lane in a sortable table with state badges.
- **Empty states** say what is going on and what to run: "The site is quiet. No lane is at work…".
- **Panels and buttons** have pixel frames: stepped corners and edges drawn with `box-shadow`, with no images, so the
  CSP stays as it is. Titles, numbers and badges use the pixel font; dense text uses the system font.
- **Accessibility**: the semantic structure, the table, focus styles and the live region stay. Every canvas-drawn word
  also exists as text.

**The pixel font** (`src/ui/client/app/font.ts`) is glyph grids drawn with `fillRect`, like the sprites. It is used
by the scene (the nameplate above a highlighted worker, the monument's plaque) and by the page (into small canvases,
with the text beside them for screen readers). It has no font file.

**Scene.**
- **The idle monument**: while no lane builds, the newest landed integration stands in the foreground as a finished
  pyramid (`Pyramid.monument`), every block set and its capstone on the apex. It leaves for the horizon when work
  starts.
- **Life that carries no data**, a pure function of `World.time`:
  - drifting clouds in two or three parallax layers, and birds crossing now and then;
  - the Nile at the horizon with moving glints, reeds and a felucca sailing by;
  - a camel caravan crossing the far dunes, and palms swaying;
  - a camp fire with smoke, and torches and braziers that light pools around them at night;
  - stars that twinkle, and a shooting star now and then.
- **Scenery**:
  - distant cliffs, and the silhouettes of a temple pylon and obelisks;
  - a stone quarry by the site, and worn paths from the camp to arbab and the site;
  - arbab's dais under a striped canopy with banners, and the scribe's table.
- **Light**:
  - the sun's color follows its height, with a halo, and every actor and prop casts a shadow from where the sun
    stands;
  - dusk tints warm and night tints dark;
  - a dithered vignette frames the scene.
- **Juice**:
  - the camera shakes (`World.shake`) when a block falls and when a capstone is set;
  - a beam of light falls on a capstone as it is set (`Capstone.glow`);
  - a shine sweeps across a block as it is set;
  - walking workers raise dust.

All of it stays deterministic: the goldens fix `World.time`.

Decided while building it (plan `ui2`):
- The scene's scale is whole device pixels: `floor(min(stageW / 480, stageH / 270) · dpr) / dpr`, where the stage's
  height is what is left of the first screen. That allows half steps on a dpr-2 screen and 3× at 1920×1080. Below 1×
  the canvas takes the stage's width.
- From 1280 px the side column (360 px) is as tall as the scene card: the crew list scrolls inside it, with a fade
  while there is more. KPI cards turn into single rows. Narrower layouts stack.
- A landed pyramid is complete: while a capstone is set, every slot without a lane is a set block. The verify
  pennant stands by the sledge only while the capstone waits there.
- The monument's plaque stands on the ground in front of the pyramid. The site's torches follow the pyramid's size,
  so the work stays lit at night.
- An asleep worker's avatar carries the scene's zzz. Failed badges use their own darker red (`#b23a3a`) under light
  ink.
- The title card leaves at the first snapshot, after 0.6 s (at once with reduced motion), by a timer as well as its
  transition.
- When the event stream closes, the page asks `/snapshot.json` why: 200 means too many tabs, 401 means the session
  ended or restarted, and no answer means arbab ui is not running.

## 20. Open items

- Can `sandbox.filesystem.denyWrite` take globs, so other sessions' scratchpads under `/tmp/claude-<uid>` become
  unwritable from a worker? (M4 hardening; probe.)
- Linux: `allowLocalBinding` has no effect (localhost is private to the command); loopback services need a
  different design there.
- `--bare` becoming the default for `-p`: doctor detects it from `apiKeySource` and an auth failure, and fails
  clearly.
- `arbab quota --reset` and `--refresh` replace the old account's snapshot, but a lane still running on the old
  account can write a newer one, which holds the other lanes again until a newer reading replaces it. Reset or
  refresh after the old account's lanes stop.
- `integrate` does not check that a lane's run ended in success; the orchestrator decides from `status`.
- Worktrees outside the project tree (§21: not done). `worktreeRoot` and `runsRoot` stay inside the project, also by
  their real paths: config refuses one that leads out through a symbolic link, because a lane worktree outside the
  project has no ancestor holding the project's config, so nothing would recognise it as a lane worktree (§3). Neither
  may be the project root nor overlap `.arbab/integrations`, checked as written and again by real path (the real
  project root, and the real path of `.arbab/integrations`, or where it would be), so a link to the root or into the
  records is refused with the same message. Real paths are taken in the spelling on disk and every comparison ignores
  case, so `.ARBAB/Integrations` on a case-insensitive file system is refused too. The failures seen (ESLint's cascade, tools that scan `.arbab/`) are
  covered by the root marker and by doctor.
- `land --squash` has no opposite: with config `landing.squash` set, a single landing cannot ask for a merge commit.
- Readiness drops a damaged `reviews/<round>.json` from its round counts without saying so, while
  `readReviewHistory` refuses the whole history for it.

## 21. Field fixes (2026-10-21)

Measured in real use: two machines, a dozen repositories, about 2,200 attempts between October 9 and 21. Workers
almost always ended `success`; the time and the risk went elsewhere, at the orchestrator and at the fence's edges.
The decisions below answer what that use showed.

### Orchestrator approvals

- A skill's `allowed-tools` grant lasts only for the turn that invoked the skill (Claude Code docs), and orchestrators
  wrapped runner calls (`cd <repo> && … 2>&1 | tail`), which no allow rule matches. About nine runner calls in ten
  waited for a person's click; overnight runs stalled on them.
- The plugin ships `hooks/hooks.json`: a PreToolUse hook on Bash (`"if": "Bash(node *)"`, exec form) runs
  `arbab hook pre-tool-use`. It approves a call only when the command is a bare invocation of this runner,
  `node "<plugin>/dist/arbab.mjs" [-C <dir>] <command> [args]`, where the runner path is absolute and the same file
  by real path, `<command>` is a runner command other than `hook`, `__shepherd` and `land`, and every word is plain
  (letters, digits and `_@%+=:,./~-`), wholly single-quoted, or wholly double-quoted without `$`, backticks,
  backslashes or `!`; a newline or other control character anywhere refuses the command. So `;`, `&`, `|`, `<`, `>`,
  parentheses, braces and `$` outside single quotes never pass. `help` and `version` are not runner commands, so
  they are not approved either. `land` merges into the base branch and removes worktrees, which the human confirms
  first. Anything else, these included, gets no answer and goes through the normal permission flow. Deny and ask
  rules still apply: Claude Code evaluates them whatever a hook answers.
- Global option `-C <dir>`: the project is found from `<dir>` instead of the working directory, so an orchestrator
  started in a parent folder of several repositories calls the runner bare. The runner loads `<dir>`'s config, which
  names commands it runs, so the hook approves `-C <dir>` only when `<dir>` is absolute and its real path is the root
  of a project registered in `~/.arbab/projects/` (one that launched a lane), not in a lane worktree (a
  `.arbab/worktrees` directory or the `worktreeRoot` an ancestor's config sets, as written or by its real path,
  ignoring case, by the path as written and its spelling on disk, §3), and not in or under `/tmp`, `/private/tmp` or the hook's `TMPDIR`, whether named
  directly or through a link. The runner itself refuses a project root inside a lane worktree, by the same test, from
  `-C` or the working directory, before loading any config there (§3).
- `status --active` (lanes not finished) and per-command help (`arbab <command> --help`) remove the other reasons to
  wrap a call.

### Ownership

- The CLI and the shepherd read `CLAUDE_CODE_SESSION_ID` (Claude Code sets it in Bash tool and hook processes) at
  their edge. A run's `shepherd.json` records it as `owner`.
- Without lane names, `wait --any` and `wait --all` take the runs owned by this session or by none (runs started
  before §21); `--all` still means "until every such run finished". `--all-sessions` drops the owner filter, so
  `wait --any --all-sessions` and `wait --all --all-sessions` behave as `--any` and `--all` did before. Named lanes
  are waited for whoever owns them. `status --mine` filters as `wait` does; `cleanup --mine` takes only the runs this
  session owns (ownerless runs are nobody's to remove) and no integration. Outside Claude Code (no session id) every
  run counts as the caller's.
- Machine registries under `~/.arbab/`: `shepherds/<pid>.json` while a shepherd lives, `waiters/<pid>.json` while
  `arbab wait` runs or `verify`, `review` or `preflight` waits for the lanes it launched (unregistered in a `finally`),
  `projects/<sha1(root)>.json` for each project that launched a lane. Shepherd and waiter entries of dead pids are
  ignored and removed.
- A Stop hook (`arbab hook stop`) keeps the orchestrator from ending its turn when it owns live shepherds and no live
  waiter, once: `stop_hook_active` lets the next stop through.

### Fence

- Reviewers (skeptics included) get loopback: they run tests to check findings, and tests listen on 127.0.0.1.
- Settings carry `bashOutputMaxChars` (config `fence.bashOutputMaxChars`, 4000–128000, default 100,000). Claude Code saves longer
  output under `~/.claude/projects/…/tool-results/`, which the credential deny on `~/.claude/**` keeps the worker from
  reading. The tool belt says so.
- Worker environment: `CLAUDE_CODE_SHELL=/bin/bash`, because the host's zsh fails on unquoted `[slug]` globs.
  `NPM_CONFIG_USERCONFIG` points at an empty file and `YARN_CACHE_FOLDER` at `.arbab-tmp/`, so package managers stop
  reading the denied `~/.npmrc`. `XDG_DATA_HOME` and `XDG_CACHE_HOME` are not redirected: corepack keeps its pnpm
  under `$XDG_CACHE_HOME/node/corepack` and pnpm keeps its store and itself under `$XDG_DATA_HOME/pnpm` on Linux, so
  an empty stand-in sends them to the registry, which the fence cannot reach (a probe's `pnpm test` failed before
  vitest started). Config `env` may still set them. The tool belt asks for quoted paths with `[ ] ( )`.
- `fence.readableEnvFiles` lists tracked templates such as `.env.example`. The `**/.env*` Read and Edit deny stays
  in place whether or not it is set; each listed template that git tracks in the worktree and that is a regular file
  reached without a link is re-opened by absolute path in `sandbox.filesystem.allowRead`, for shell commands only
  (`cat .env.example` works, the Read tool still refuses it). The tool belt says so. The shepherd asks git which
  listed files are tracked through the worktree's verified git dir, with hooks and `core.fsmonitor` off, never
  through the worktree's own `.git` file (§4). A listed file left out stays unreadable; `arbab doctor`'s env check
  warns about each listed file git does not track at the project root, as it warns about tracked templates the list
  misses (the profile lint's `env-template-untracked` warning is gone). A tracked template's content is in git
  already. (The first version replaced the blanket deny with secret patterns plus every other `.env*` file found on disk; the
  review's fix round put the blanket deny back and opens only the templates.)
- Relative credential patterns (`**/.env*`, `**/*.pem` and the rest) cover only the worker's working directory:
  code run by an allowed command read the main checkout's untracked `.env.local` with or without allowRead (measured,
  Claude Code 2.1.296). arbab therefore adds copies of each one anchored at the home directory and at the project
  root, or at the root's nearest ancestor whose path holds no glob characters (§4); allowRead still re-opens the
  listed templates, since it wins over a deny on the same path (measured). A file outside the home directory and the project that matches only a relative pattern stays readable by worker code.
- The fence stops only the worker; files arbab itself copies into a worktree, inlines into a prompt or puts in a
  commit pass one credential matcher (`credentialMatcher`, src/profile/credentials.ts), which reads the fence's list
  as checks on paths and ignores case on every platform (`~/.AWS/credentials` is `~/.aws/credentials` on macOS). It
  guards lane `inputs` (with config `credentialPaths` and `~/Library`), `review --lens-file` and `land --message`
  (with config `credentialPaths`), each by the path as given and by its real path; and the files whose text goes into
  prompts (a lane's `brief` and `schema`, a plan phase's `brief` and `schema`, a plan's `defaults.schema`, config
  `instructions`), by the list plus config `credentialPaths` with no home directory, so `~/` entries match nothing
  there, again by both spellings. `credentialPaths` is read before `instructions`, so the config's own instructions
  are checked against it. The name rules (`**/.env*`, `**/*.pem`, `**/*.key`, …) and the relative patterns (an entry
  starting with neither `~/` nor `/`, such as `vault/*.md`) test the whole path of a file outside the project, but for
  a file inside it (an input, a lens file, `--message`, a brief, a schema, instructions) only what lies below the
  project root, `/`-joined: the path as given below the root as given, the real path below the root's real path. A
  project kept under `~/.envs/app` or `~/keys.key/app` therefore still works, and `.env` inside it is still refused;
  `~/` and absolute (`//`) entries see the whole path. A file a folder input holds follows the input's rule. A
  refusal names the rule that matched.

### Shepherd

- The quota is checked before a slot is taken and again after: a lane held for quota holds no slot, so `no free slot`
  means what it says.
- `~/.arbab/machine.json` (`{ "maxParallel": n }`) caps every project's `maxParallel`; held shepherds re-read it on
  every poll.
- `runs/<lane>/events.jsonl` logs every state change; a run's first `started.json` carries `heldMs` (queued and
  held: the quota and a slot) and `prepareMs` (from `preparing` to the first attempt: leases, semaphores, the writer
  lock, the worktree, dependencies, merges and inputs).
- A lane's `inputs` (absolute, `~/` or project-relative; at most 20, 50 MB together) are copied into
  `.arbab-tmp/inputs/<basename>` and listed in its brief, in an `Inputs` section. Nothing is copied unless every input
  passes: symbolic links, paths the fence denies as credentials (its built-in list and config `credentialPaths`, and
  `~/Library`) by the path as given or its real path, credential-like file names, a folder holding the home directory
  or the worktree, and two inputs with one name are refused; links inside a folder are skipped. The check is the
  shared credential matcher (Fence, above), so it ignores case; for an input inside the project, by either spelling,
  the name rules and relative patterns look only below the project root, so a project under `~/.envs/` can take an
  input from itself.
- Inputs are rebuilt on every run, under the writer lock, whether the lane has inputs or not: `.arbab-tmp/inputs` is
  removed whole (unlinked when it is a link) and created again, so an input the lane dropped disappears and the files
  outside the repository are copied as they are now. The copies are never written through a link a worker left (§3);
  on the source side, each file's directory must still have the real path the walk saw, and the opened file must
  have the device and inode the walk saw.
- The writer lock's directory goes with its entry, and `cleanup` removes empty lock directories.
- Summaries carry `tokens` and `maxGapMs`, killed attempts included. `status` shows the tokens (input, cache
  creation and output) in its cost column when there is no cost, and a last column, `why`, with the state's reason
  (§10).

### Integration and landing

- A manifest change counts only when it can change an install (`installRelevantChange`): any change to a manifest
  other than `package.json` (lockfiles, `pnpm-workspace.yaml`, `.npmrc`, `.yarnrc*`, `.pnpmfile.*`, `bunfig.toml`,
  yarn PnP's `.pnp.cjs` and `.pnp.loader.mjs`, any `*.patch` file, any file under `.yarn/releases/`,
  `.yarn/plugins/` or `.yarn/patches/`; names and directories at any depth, ignoring case), and in `package.json`
  the dependency fields (`dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies`,
  `bundledDependencies`, `bundleDependencies`), `overrides`, `resolutions`, `pnpm`, `workspaces`, `packageManager`,
  `dependenciesMeta`, `peerDependenciesMeta`, `bin` (linked into `node_modules/.bin`, where scripts run it),
  `engines`, `os`, `cpu`, `libc`, `trustedDependencies`, `devEngines` (it can make the package manager fetch another
  runtime) and the install-time scripts (`preinstall`, `install`, `postinstall`, `preprepare`, `prepare`,
  `postprepare`, `prepublish`, `dependencies`, which npm 7 and later run after an install changes `node_modules`, and
  `pnpm:devPreinstall`). Key order and formatting do not count; a `package.json` added, removed or that does not
  parse does. An `exports` or `version` edit no longer needs `--deps-installed`.
- `integrate <name> --adopt <ref> [--base <branch>]` makes an integration of an existing branch, so work done outside
  lanes gets verify and review (§17). It installs at the fork point of `<ref>` and the base, so it requires a base
  that `baseBranch` contains and a fork point that is a trusted install point. The base, `--base` or `baseBranch`,
  must name a branch (`refs/heads/<base>`), not a commit or an expression such as `main~0`: `land` merges into it.
  Integration names starting with `ref-` are refused (`verify --ref`'s prefix).
- `integrate <name> --refresh` records an integration's head again after a hand commit or a merge of the base in its
  worktree, merging nothing and installing nothing (§17).
- `land --squash` (config `landing.squash`) makes one commit; `--message <file>` sets the commit message, from a file
  inside the project that the credential matcher does not hit (Fence, above), by its path or its real path, in any
  case. `landing.json` lists the lanes it carried, so `cleanup` recognises
  them after a squash or a reshaped base.
- `land` refuses tracked changes and untracked files the merge would write; other untracked files no longer block it.
- arbab excludes `.arbab/` as a whole (and `.arbab-tmp/`), and writes `.arbab/.eslintrc.json` with `"root": true`,
  which stops ESLint 8's config cascade at `.arbab/`: a worktree's own config otherwise loads the main checkout's too.
- `verify --ref <branch>` runs the gates on a branch head with no integration: the check after landing. Lane
  `ref-<slug>-<hash>-verify`, record `.arbab/refs/ref-<slug>-<hash>/verify.json` (§17); the hash keeps branches whose
  slugs collide apart.

### Review and readiness

- Every review writes `reviews/<round>.json` beside `review.json`, and a `--lenses` subset keeps the other lenses'
  entries, skeptics and findings from the same head.
- `review --lens-file <name>=<file>` adds a lens, or replaces a lens's text, from a file for one run, with no config
  edit; `--since <sha>` diffs from an ancestor of the head instead of the base, for a fix round. The lens file must
  lie inside the project, by its path and its real path, and neither may be a credential file by the fence's list
  and config `credentialPaths`, ignoring case, the name rules and relative patterns looking only below the project
  root (the credential matcher, Fence above).
- A re-run of `verify` or `review` on the same head adopts its generated lanes' results when they finished after a
  timeout, and waits for them when they still run. `verify`, `review` and `preflight` register as waiters while they
  wait, so the Stop hook does not hold the turn they wait in.
- A review stays current when the head is a merge commit whose first parent is the reviewed head, whose second
  parent is in the integration's own recorded base (the branch `land` merges into, which `baseBranch` may no longer
  name), and whose tree is what git merges them into (no hand resolution); readiness says it carried the review
  over. Verify never carries over.
- `--waive` requires a terminal, as `--deps-installed` does: waivers are the human's.
- `hostGates` and `arbab host-check <name>` (terminal only) record the checks the fence cannot run; readiness lists
  them, as skipped item `host` at every tier and as a risk, until they pass on the head (§17).
- Readiness shows a `review-rounds` line: per round, the findings left standing by severity (refuted ones not
  counted).
- Readiness groups repeated lane notes (one sandbox limit named in twenty reports is one risk) and orders risks by
  weight.

### Plans, preflight, doctor and the status commands

- `plan next --retry <phase>` first relaunches a phase that ended in anything but `success`, or was orphaned, as a
  fresh session in its own worktree on its checkpoint commits, then launches what `plan next` would; its dependents
  wait for it instead of being reported as failed upstream. It refuses a phase not in the plan, never run, active or
  that succeeded. Scope overlap compares glob segments, not only fixed prefixes, and a bare path covers what is
  under it; in a brace set each alternative follows that rule by itself, so `src/{plan,run}` covers
  `src/plan/graph.ts` (§16).
- Preflight probes run the project's `preflight.steps` as exact allow rules whatever the lane's role, and remove the
  probe worktrees and branches they created: stale ones before launching, the run's own after printing the results.
- `doctor` also checks: the plugin hook is present; `.arbab/` is excluded; lint and test configs that would scan
  `.arbab/`; gates against the repository's check scripts and CI; worktree and lock-directory counts; env templates
  (tracked ones missing from `fence.readableEnvFiles`, and listed ones git does not track at the project root, which
  stay unreadable); the machine cap; both config files present. Warnings never change its exit status.
- New commands: `summary [--all] [--json]` (lanes by state, plans, integrations by stage, what needs attention,
  quota and slots; read-only); `report <lane> [--attempt <n>]`; `quota --refresh` (one haiku call with no tools, in
  a temporary directory under `~/.arbab/tmp/` and with 60 s, reads the current account's windows after an account
  switch: its `rate_limit_event` replaces `quota.json` and counts as a reset; without one it exits 2 and changes
  nothing); `wait --notify` (a desktop notification per finished lane).
- Config may live at `.arbab/config.json` when the repository has no `arbab.config.json`, so a client repository
  carries no arbab file.

Not done: worktrees outside the project tree (§20).
