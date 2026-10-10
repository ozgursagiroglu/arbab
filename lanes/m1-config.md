# M1 · config, lanes, binary and reports (src/config, src/binary, src/report)

## Task

Implement three small modules. DESIGN.md §1, §3, §6 and §10 are the specification.

### `src/config/` (export from `index.ts`)

1. `ROLE_DEFAULTS: Readonly<Record<Role, RoleDefaults>>` (`roles.ts`):

   | role | tools | model | effort | budgetUsd | wallMin | idleMin | loopback | checkpoint | autoResume | maxAttempts |
   | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
   | implementer | Read Edit Write Glob Grep Bash | claude-opus-5-5 | high | 10 | 60 | 20 | true | true | true | 4 |
   | verifier | Read Edit Write Glob Grep Bash | claude-opus-5-5 | high | 10 | 60 | 20 | true | true | true | 4 |
   | reviewer | Read Glob Grep Bash | claude-opus-5-5 | high | 5 | 30 | 15 | false | false | true | 3 |
   | researcher | WebSearch WebFetch | claude-opus-5-5 | medium | 5 | 40 | 15 | false | false | true | 3 |
   | probe | Read Write Bash | claude-haiku-5-5 | low | 0.5 | 10 | 5 | true | false | false | 1 |

2. `resolveRole(config: ProjectConfig, role: Role): RoleDefaults` — the preset overlaid with `config.roles[role]`.
3. `loadConfig(projectRoot: string): ProjectConfig` — reads `<projectRoot>/arbab.config.json` (missing file = all
   defaults) and returns every field filled. Defaults:
   - baseBranch `main`, worktreeRoot `.arbab/worktrees`, runsRoot `.arbab/runs`;
   - instructions `[]`, dependencies `{strategy: "none"}`, commands `{}`, env `{}`, passEnv `[]`, credentialPaths `[]`;
   - resources `{}`, semaphores `{}`, gates `[]`, preflight `{steps: []}`;
   - maxParallel `4`, quota `{holdAbove: {fiveHour: 0.85, sevenDay: 0.95}}`, roles `{}`, minClaudeVersion `"2.1.290"`.

   Throw `ArbabError("config")` with a message naming the field for:
   - an unknown top-level key, and wrong types;
   - root/instruction paths outside the project (use `confine`);
   - command prefixes containing any of `` ; & | ` $ < > ( ) \ `` or a newline;
   - env keys not matching `^[A-Za-z_][A-Za-z0-9_]*$`, or matching `^(CLAUDE|ANTHROPIC|VSCODE|CURSOR)`, or equal to
     `HOME`, `PATH` or `CLAUDECODE`;
   - passEnv names matching `^(CLAUDE|VSCODE|CURSOR|TERM_PROGRAM)` or equal to `CLAUDECODE` (`ANTHROPIC_API_KEY`
     is allowed, for API-key users);
   - resource and semaphore names that fail `isValidName`;
   - ranges that are not integers with lo ≤ hi (type `port`: 1024–65535);
   - semaphore capacity < 1;
   - gates/preflight steps that are not non-empty string arrays;
   - maxParallel outside 1–32, and thresholds outside (0, 1];
   - unknown role keys or role fields of the wrong type;
   - minClaudeVersion that is not `x.y.z`.
4. `loadLane(projectRoot: string, lanePath: string): LaneSpec` — reads and validates a lane file. Rules:
   - name: `assertValidName`; role: a valid Role;
   - brief: confined and must exist; schema: confined and must exist when given;
   - effort: in `EFFORTS`; budgetUsd, wallMin, idleMin: positive finite numbers;
   - allow: strings; resources: valid names, counts integers 1–8; semaphores, upstream and worktree: valid names;
   - fence: `strict` or `sandbox-auto`; maxAttempts: an integer from 1 to 10;
   - unknown keys: error.

### `src/binary/` (export from `index.ts`)

1. `parseVersion(text: string): [number, number, number] | null` — the first `x.y.z` in text
   (`"2.1.295 (Claude Code)"`).
2. `compareVersions(a: string, b: string): -1 | 0 | 1` — numeric per part (`2.1.295` > `2.1.29`; lexical order is the
   machine-2 bug).
3. `findOnPath(cmd: string, pathEnv: string, exists: (p: string) => boolean): string | null`.
4. `resolveBinary(opts: { pinned: BinaryInfo | null; explicitPath: string | null; pathEnv: string; minVersion: string;
   run: (path: string, args: string[]) => string; exists: (p: string) => boolean; realpath: (p: string) => string }):
   BinaryInfo`:
   - pinned → re-run `--version` on `pinned.path`; it must still exist and report `pinned.version`, else throw
     `ArbabError("binary")` ("binary changed since the lane's first attempt").
   - otherwise `explicitPath` (from `ARBAB_CLAUDE`, passed in by the caller) or `findOnPath("claude", …)`, then
     `realpath`, then `--version`; throw `binary` errors for not found, unparsable output, or a version below
     `minVersion`.

   Default implementations of `run`, `exists` and `realpath` live in a separate small `node.ts` (execFileSync with
   a 30 s timeout, existsSync, realpathSync) so the logic stays testable.

### `src/report/` (export from `index.ts`)

1. `validate(schema: JsonSchema, value: unknown): ValidationError[]` — the subset in `JsonSchema` (type with
   `integer` ≠ non-integer number; properties; required; additionalProperties false; items; minItems; enum).
   Paths are JSON-pointer-like (`/checks/0/exit_code`, root `""`). Collect all errors; never throw.
2. `DEFAULT_SCHEMAS: Readonly<Record<Role, JsonSchema>>` per DESIGN.md §6. All fields are required unless noted:
   - **implementer and verifier**:
     - `status` (enum done, partial, blocked);
     - `summary`;
     - `files_changed` (string[]);
     - `checks` (array of {command: string, exit_code: integer, result: string});
     - `decisions`, `open_questions` and `not_verified` (string[]);
     - `notes_for_reviewer` (string, optional).
   - **reviewer**:
     - `findings` (array of {title, severity (enum HIGH, MEDIUM, LOW), file, line (integer, optional),
       failure_scenario, evidence});
     - `coverage` (string);
     - `paths_checked` (string[]).
   - **researcher**:
     - `facts` (array of {question, claim, source, quote (optional), confidence (enum high, medium, low)});
     - `not_found` and `recommendations` (string[]).
   - **probe**: `steps` (array of {n: integer, command, outcome}).

   Object schemas set `additionalProperties: false` only at the top level of each schema.

## Scope

You own `src/config/**`, `src/binary/**` and `src/report/**` (code and tests). Change nothing else.

## Facts

- `claude --version` prints `2.1.295 (Claude Code)` on this machine. Opus 5.5 needs CLI ≥ 2.1.280; a 2.1.217 binary
  failed every Opus run with an API 400 in 3 s (machine 2).
- Machine 2 picked editor-bundled binaries by lexical sort and three resumed sessions switched version mid-session.
- `arbab.config.json` at the repository root is this project's own config and must load without errors.

## Acceptance

- [ ] Every export above, using `src/types.ts` and `src/util/*` unchanged.
- [ ] Tests:
  - every config default, and each config and lane rejection rule (one case per rule);
  - loading this repository's own `arbab.config.json` (read it via a path relative to the test file);
  - `resolveRole` overlays;
  - version parsing and comparison edge cases (`2.1.29` vs `2.1.295`, `10.0.0` vs `9.9.9`);
  - every `resolveBinary` branch with injected fakes;
  - the validator on valid and invalid values for every default schema, including nested paths.
- [ ] `pnpm typecheck`, `pnpm test` and `pnpm build` exit 0.
