# M1 · the fence (src/profile)

## Task

Implement `src/profile/`: compile a role's fence into Claude Code flags, a settings file and a worker environment,
and lint it. DESIGN.md §4 is the specification; this brief fixes the API and the details. Pure functions only (no
file system, no process access); callers pass everything in.

Export from `src/profile/index.ts`:

1. Constants (`presets.ts`):
   - `BUILTIN_CREDENTIAL_PATHS: readonly string[]` — exactly: `~/.ssh/**`, `~/.aws/**`, `~/.azure/**`, `~/.config/**`,
     `~/.docker/**`, `~/.kube/**`, `~/.gnupg/**`, `~/.claude/**`, `~/.claude.json`, `~/.netrc`, `~/.npmrc`,
     `~/.pypirc`, `~/.git-credentials`, `~/Library/Keychains/**`, `~/Library/Cookies/**`, `**/.env*`, `**/*.pem`,
     `**/*.key`, `**/*.p12`, `**/*.pfx`, `**/id_rsa*`, `**/id_ed25519*`, `**/*.tfstate`.
   - `GIT_WRITE_VERBS`: commit push reset checkout switch restore rebase merge cherry-pick stash clean branch worktree
     tag config update-ref remote.
   - `GIT_READ_VERBS`: status diff log show grep ls-files blame. `READ_UTILITIES`: ls cat head tail wc.
   - `ANY_CODE_PREFIXES`: single words `node npx npm pnpm yarn bun bunx deno python python3 ruby perl php sh bash zsh
     fish env eval exec xargs find awk sed make sudo osascript open docker kubectl ssh curl wget git`, and two-word
     prefixes `pnpm exec`, `pnpm dlx`, `pnpm run`, `npm exec`, `npm run`, `yarn run`, `yarn dlx`, `bun run`, `bun x`,
     `git -C`, `git config`.
   - `BASH_INPUT_PARAMS`: timeout description run_in_background dangerouslyDisableSandbox.
   - `FIXED_ENV`: `BASH_DEFAULT_TIMEOUT_MS = "300000"`, `BASH_MAX_TIMEOUT_MS = "900000"`.
2. `commandRules(prefix: string): string[]` — `"pnpm test"` → `["Bash(pnpm test)", "Bash(pnpm test *)"]`. Throws
   `ArbabError("lint")` for an empty prefix, extra spaces, or any of `` ; & | ` $ < > ( ) \ `` and newlines.
3. `credentialDenies(extra: string[]): string[]` — `Read(p)` and `Edit(p)` for every built-in path and every extra
   path, de-duplicated, built-ins first.
4. `compileProfile(input: ProfileInput): CompiledProfile`:
   - `tools`: `input.tools` as given.
   - allow: the file tools present in `input.tools` (Read, Glob, Grep, and Edit and Write only for implementer and
     verifier); for implementer, verifier and reviewer the `commandRules` of `git <verb>` for each read verb and of
     each read utility, plus `Bash(pwd)`; for researcher `WebSearch` and `WebFetch`; for probe `Bash(git rev-parse *)`,
     `Bash(git status)`, `Bash(ls)` and `Bash(ls *)`; then `commandRules` of each `input.commands` prefix; then
     `input.laneAllow` verbatim. In fence `sandbox-auto`, leave out every `Bash(…)` allow rule (sandboxed Bash is
     auto-allowed). De-duplicate, keep order.
   - deny: `credentialDenies(input.credentialPaths)`; `Bash(run_in_background:true)`; for each git write verb
     `commandRules("git <verb>")`; `Bash(git -C)` and `Bash(git -C *)`; `NotebookEdit`; `WebFetch` and `WebSearch`
     for every role except researcher; `Edit` and `Write` for reviewer.
   - settings: `sandbox` = `{enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: fence ===
     "sandbox-auto", allowUnsandboxedCommands: false, network: {allowLocalBinding: input.loopback}}`; `env` =
     `input.env`, then `FIXED_ENV`, then `XDG_CONFIG_HOME = <worktree>/.arbab-tmp/xdg-config` (the fixed keys win).
5. `buildClaudeArgs(input: ClaudeArgsInput): string[]` — exactly, in this order: `-p --output-format stream-json
   --verbose --model <m> --effort <e> --permission-mode dontAsk --permission-prompts none --strict-mcp-config
   --setting-sources "" --restricted --tools <comma-joined> --settings <path> --max-budget-usd <n> -n <name>`, then
   `--session-id <id>` (new) or `--resume <id>` (resume), then `--json-schema <JSON.stringify(schema)>` when a schema is
   given. The empty string after `--setting-sources` is a real argv element. Validate: effort in `EFFORTS`, budget a
   positive finite number, name valid (`assertValidName`), session id a UUID, tools non-empty without commas.
6. `workerEnv(host: Record<string, string | undefined>, opts: { passEnv: string[]; extra: Record<string, string>;
   nodeDir: string; pnpmDir?: string }): Record<string, string>` — built from scratch, never by copying `host`:
   `HOME USER LOGNAME LANG LC_ALL SHELL` when set in host; `PATH` = de-duplicated `[nodeDir, pnpmDir,
   /opt/homebrew/bin, /usr/local/bin, /usr/bin, /bin, /usr/sbin, /sbin]`; `TERM=dumb`; `DISABLE_AUTOUPDATER=1`; each
   `passEnv` name present in host; then `extra`. Throws `ArbabError("config")` when a passEnv name or an extra key
   matches `/^(CLAUDE|VSCODE|CURSOR|TERM_PROGRAM)/` or is `CLAUDECODE` — those make a worker register as an
   interactive editor session, accept cross-session messages or inherit the host's effort.
7. `lintProfile(profile: CompiledProfile, input: ProfileInput): LintIssue[]`, with these codes:
   - errors:
     - `bare-bash-allow`: an allow rule `Bash` or `Bash(*)`;
     - `any-code-allow`: an allow rule `Bash(<p> *)` or `Bash(<p>:*)` whose fixed part `<p>` is one of
       `ANY_CODE_PREFIXES` (exact rules without a wildcard, like `Bash(node --version)`, are fine);
     - `param-rule`: any rule `Bash(<name>:…)` where `<name>` is in `BASH_INPUT_PARAMS`, except the exact
       `Bash(run_in_background:true)` deny;
     - `relative-path-rule`: a `Read(…)` or `Edit(…)` rule whose path starts with a single `/` (relative to the
       settings file; absolute paths need `//`);
     - `sandbox-disabled`, `sandbox-fail-open` (failIfUnavailable false), `unsandboxed-retry`
       (allowUnsandboxedCommands true);
     - `auto-allow-strict`: autoAllowBashIfSandboxed true in fence `strict`;
     - `agent-tool`: `Task` or `Agent` in the tool set.
   - warnings:
     - `colon-star-form`: an allow rule using `:*` (generated rules use the space form);
     - `shadowed-allow`: an allow rule that equals a deny rule;
     - `reserved-env`: `input.env` sets a `FIXED_ENV` key or `XDG_CONFIG_HOME`.

## Scope

You own `src/profile/**` (code and tests). Change nothing outside it.

## Facts

Measured in the w0 wave (CLI 2.1.295; see `research/native-claude-code.md`, "Measured in w0"):

- With Read deny rules for credential paths, the sandbox refuses those paths at the OS level, and the permission
  layer refuses Bash commands that name them (`decision_reason_type: subcommandResults`).
- `Bash(run_in_background:true)` as a deny rule refuses background Bash calls; the `timeout` parameter keeps
  working. A rule like `Bash(timeout:*)` is read as a parameter rule (machine 2 lost 5 of 5 timeout calls to it).
- `autoAllowBashIfSandboxed` defaults to true; an allow rule can approve an unsandboxed retry unless
  `allowUnsandboxedCommands` is false.
- In Read/Edit rules, `//path` is absolute, `~/` is home, and `/path` is relative to the settings file.
- `--tools` naming `Agent` yields the tool `Task`.

## Acceptance

- [ ] Every export above, using `src/types.ts` and `src/util/*` unchanged.
- [ ] Tests cover each role's compiled allow/deny/settings, both fence levels, `buildClaudeArgs` for a new and a
      resumed session with and without a schema (assert the exact argv), every lint code (one positive and one
      negative case each), `commandRules` rejections, and `workerEnv` (scrubbing, PATH order, forbidden names).
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
