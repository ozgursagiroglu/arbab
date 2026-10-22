// Contracts shared by arbab's modules (DESIGN.md §2–§10). A change here is a cross-module change: lanes do not edit
// this file; they report the change they need in their report's open_questions.

export type Role = "implementer" | "verifier" | "reviewer" | "researcher" | "probe";
export const ROLES: readonly Role[] = ["implementer", "verifier", "reviewer", "researcher", "probe"];

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

/** strict: allowlist + sandbox (default). sandbox-auto: sandboxed Bash is auto-allowed; the sandbox is the only wall. */
export type FenceLevel = "strict" | "sandbox-auto";

// ---------------------------------------------------------------------------------------------------------------
// Inputs written by people (or the orchestrating session)

/** A lane file, e.g. lanes/<name>.json. Paths are relative to the project root. */
export interface LaneSpec {
  name: string;
  role: Role;
  /** The brief source (Markdown with ## Task, ## Scope, ## Acceptance, …). */
  brief: string;
  /** Branch or commit the worktree starts from; defaults to config.baseBranch. */
  base?: string;
  /** Work in another lane's worktree (a verifier after its builder) instead of a new one. */
  worktree?: string;
  /**
   * Narrows the role's tools to these; never widens them. A lane that must not write keeps only the tools it needs
   * (the generated verify lane: Read and Bash), and a tool left out does not exist for the worker (`--tools`).
   */
  tools?: string[];
  model?: string;
  effort?: Effort;
  budgetUsd?: number;
  wallMin?: number;
  idleMin?: number;
  fence?: FenceLevel;
  /** Extra permission allow rules for this lane (linted). */
  allow?: string[];
  /** Report schema (JSON Schema subset); defaults to the role's schema. */
  schema?: string;
  /** Resource leases, by type: {"port": 2}. */
  resources?: Record<string, number>;
  semaphores?: string[];
  checkpoint?: boolean;
  autoResume?: boolean;
  maxAttempts?: number;
  /** Sibling lanes and their scopes (M2 generates this from the plan). */
  coordination?: string;
  /** Lanes whose reports are inlined into this brief (M2). */
  upstream?: string[];
  /**
   * Branches merged into a newly created worktree before the worker starts (a plan phase's dependencies). A conflict
   * is a setup failure the orchestrator resolves (DESIGN.md §16).
   */
  mergeBranches?: string[];
  /**
   * Files or directories outside the worktree the worker must read (a design folder beside the repository, a hand-off
   * note). Absolute, `~/`-relative or project-relative paths. The shepherd copies each, before the run's first attempt,
   * into `<worktree>/.arbab-tmp/inputs/<basename>` (DESIGN.md §21).
   */
  inputs?: string[];
}

// ---------------------------------------------------------------------------------------------------------------
// Plans (src/plan, DESIGN.md §16)

/** The lane fields a phase may set, besides its name and brief; all optional (role defaults to implementer). */
export type PhaseLaneFields = Partial<Pick<
  LaneSpec,
  | "role"
  | "model"
  | "effort"
  | "budgetUsd"
  | "wallMin"
  | "idleMin"
  | "fence"
  | "allow"
  | "schema"
  | "resources"
  | "semaphores"
  | "worktree"
  | "checkpoint"
  | "autoResume"
  | "maxAttempts"
  | "inputs"
  >
>;

export interface PlanPhase extends PhaseLaneFields {
  /** The lane name. */
  name: string;
  brief: string;
  /** Write globs, relative to the project root; required, and disjoint from every phase not ordered with this one. */
  scope: string[];
  dependsOn?: string[];
}

/** plans/<name>.json. */
export interface PlanSpec {
  name: string;
  /** Branch or commit the first wave starts from; defaults to config.baseBranch. */
  base?: string;
  defaults?: PhaseLaneFields;
  phases: PlanPhase[];
}

/** arbab.config.json after defaults are applied (src/config fills every field). */
export interface ProjectConfig {
  baseBranch: string;
  worktreeRoot: string;
  runsRoot: string;
  /** Files inlined into every brief as project rules (workers do not load CLAUDE.md). */
  instructions: string[];
  dependencies: DependencyStrategy;
  /** Command prefixes each role may run, e.g. "pnpm test" → Bash(pnpm test) and Bash(pnpm test *). */
  commands: Partial<Record<Role, string[]>>;
  /** Extra environment for workers (values are not secrets). */
  env: Record<string, string>;
  /** Names of host environment variables passed through to workers. */
  passEnv: string[];
  /** Extra credential paths denied on top of the built-in list (Read/Edit rule syntax). */
  credentialPaths: string[];
  resources: Record<string, { range: [number, number] }>;
  semaphores: Record<string, number>;
  /** Repository gates for verify and landing, as argv arrays. */
  gates: string[][];
  preflight: { steps: string[][] };
  maxParallel: number;
  quota: { holdAbove: { fiveHour: number; sevenDay: number } };
  /** Per-role overrides of the built-in presets. */
  roles: Partial<Record<Role, Partial<RoleDefaults>>>;
  /** Oldest claude CLI version arbab accepts, e.g. "2.1.290". */
  minClaudeVersion: string;
  /** `arbab verify` runs this smoke argv after the gates (DESIGN.md §17); null = none. */
  verify: { smoke: string[] | null };
  /** Review lenses besides the built-in correctness, security and contracts: name → what to look for. */
  review: { lenses: Record<string, string> };
  /**
   * `tier`: the risk tier readiness checks against when a command names none. `squash`: `land` makes one commit on the
   * base instead of a merge (`land --squash` does it once; DESIGN.md §21).
   */
  landing: { tier: Tier; squash: boolean };
  /** Fence options (DESIGN.md §21). */
  fence: {
    /**
     * Tracked template env files workers may read, project-relative (".env.example"). Empty keeps every `**\/.env*`
     * path denied; non-empty replaces that pattern with explicit secret patterns and the untracked env files found.
     */
    readableEnvFiles: string[];
    /** Claude Code's `bashOutputMaxChars` for workers (4000–128000): longer output goes where a worker cannot read it. */
    bashOutputMaxChars: number;
  };
  /**
   * Checks that cannot run inside the fence (Docker, a browser, a database), as argv arrays. A human runs them on the
   * host with `arbab host-check <name>`; readiness lists them until they passed on the head (DESIGN.md §21).
   */
  hostGates: string[][];
}

/**
 * `~/.arbab/machine.json`: limits for every project on this machine (DESIGN.md §21). Missing file = no limits.
 * `maxParallel` caps each project's own maxParallel; slots are machine-wide.
 */
export interface MachineConfig {
  maxParallel: number | null;
}
export const MACHINE_CONFIG_FILE = "machine.json";

/** Where every integration's records live, relative to the project root (DESIGN.md §17). */
export const INTEGRATIONS_DIR = ".arbab/integrations";

export type Tier = "low" | "medium" | "high";
export const TIERS: readonly Tier[] = ["low", "medium", "high"];

export type DependencyStrategy = { strategy: "none" } | { strategy: "command"; command: string[] };

export interface RoleDefaults {
  tools: string[];
  model: string;
  effort: Effort;
  budgetUsd: number;
  wallMin: number;
  idleMin: number;
  /** Allow listening on and connecting to loopback (sandbox network.allowLocalBinding). */
  loopback: boolean;
  checkpoint: boolean;
  autoResume: boolean;
  maxAttempts: number;
}

// ---------------------------------------------------------------------------------------------------------------
// The fence (src/profile)

/** The file passed with --settings. */
export interface ClaudeSettings {
  sandbox: {
    enabled: true;
    failIfUnavailable: boolean;
    autoAllowBashIfSandboxed: boolean;
    allowUnsandboxedCommands: boolean;
    network: { allowLocalBinding: boolean };
    /**
     * `denyWrite`: absolute paths no sandboxed command may write: the repository's shared git directory (measured, M1
     * review). `allowRead`: absolute paths sandboxed commands may read although a Read deny covers them: the tracked
     * env templates of fence.readableEnvFiles (DESIGN.md §21).
     */
    filesystem?: { denyWrite: string[]; allowRead?: string[] };
  };
  env: Record<string, string>;
  permissions: { allow: string[]; deny: string[] };
  /** Inline output limit of the worker's Bash tool (Claude Code settings key; DESIGN.md §21). */
  bashOutputMaxChars?: number;
}

export interface ProfileInput {
  role: Role;
  fence: FenceLevel;
  tools: string[];
  loopback: boolean;
  /** Project command prefixes for this role (config.commands[role]). */
  commands: string[];
  laneAllow: string[];
  /** config.credentialPaths, added to the built-in list. */
  credentialPaths: string[];
  /** config.env plus lease variables; merged into settings.env. */
  env: Record<string, string>;
  /** Absolute worktree path (XDG_CONFIG_HOME lives under it). */
  worktree: string;
  /**
   * Absolute path of the repository's shared git directory (`git rev-parse --git-common-dir`). Claude Code's sandbox
   * lets a worktree's worker write there, refs and objects included, so the fence denies it (M1 review, measured).
   */
  gitCommonDir?: string;
  /** config.fence.readableEnvFiles (DESIGN.md §21). */
  readableEnvFiles?: string[];
  /**
   * Absolute paths, in the worktree, of the readableEnvFiles that git tracks there: compiled into
   * `sandbox.filesystem.allowRead`. The `**\/.env*` deny stays in place for every other path (DESIGN.md §21).
   */
  envFileAllowReads?: string[];
  /** config.fence.bashOutputMaxChars, written to the settings as `bashOutputMaxChars`. */
  bashOutputMaxChars?: number;
}

export interface CompiledProfile {
  tools: string[];
  settings: ClaudeSettings;
}

export type SessionMode = { kind: "new"; id: string } | { kind: "resume"; id: string };

export interface ClaudeArgsInput {
  model: string;
  effort: Effort;
  tools: string[];
  settingsPath: string;
  budgetUsd: number;
  name: string;
  session: SessionMode;
  schema: JsonSchema | null;
}

export type LintSeverity = "error" | "warning";

export interface LintIssue {
  severity: LintSeverity;
  /** Stable, kebab-case, e.g. "any-code-allow". */
  code: string;
  message: string;
  /** The rule, section or field the issue is about. */
  where?: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Briefs (src/brief) and reports (src/report)

export type BriefSectionName = "Task" | "Scope" | "Acceptance" | "Facts" | "Unverified" | "Notes";

export interface BriefSource {
  title: string;
  sections: Partial<Record<BriefSectionName, string>>;
}

export interface BriefContext {
  lane: string;
  role: Role;
  branch: string;
  worktree: string;
  profile: CompiledProfile;
  leases: Lease[];
  instructions: Array<{ path: string; content: string }>;
  coordination: string | null;
  upstream: Array<{ lane: string; summary: string }>;
  schema: JsonSchema | null;
  /** BASH_MAX_TIMEOUT_MS in minutes, named in the tool belt. */
  bashMaxTimeoutMin: number;
  /** Names of the lane inputs copied into `.arbab-tmp/inputs/` (DESIGN.md §21); absent or empty when none. */
  inputs?: string[];
}

/** The JSON Schema subset arbab validates (and Claude Code's --json-schema enforces). */
export interface JsonSchema {
  type?: "object" | "array" | "string" | "integer" | "number" | "boolean" | "null";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  minItems?: number;
  enum?: ReadonlyArray<string | number | boolean | null>;
}

export interface ValidationError {
  /** JSON-pointer-like path, e.g. "/checks/0/exit_code". */
  path: string;
  message: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Runs on disk (src/run, src/registry) and what the stream says (src/stream)

export interface BinaryInfo {
  path: string;
  version: string;
}

export type KillReason = "wall" | "idle" | "hang-after-result" | "hang-after-error" | "stopped";

export type EndState =
  | "running"
  | "success"
  | "failed"
  | "usage-limit"
  | "unsupported-cli"
  | "budget"
  | "max-turns"
  | "invalid-report"
  | "no-result"
  | `killed:${KillReason}`;

export type FailureCause =
  | "dontAsk"
  | "deny-rule"
  | "scope"
  | "subcommand"
  | "denied-other"
  | "analyzer"
  | "needs-approval"
  | "sleep-guard"
  | "input"
  | "sandbox"
  | "real";

export interface Lease {
  type: string;
  value: number;
  lane: string;
  project: string;
  pid: number;
  createdAt: string;
}

export interface AttemptStarted {
  lane: string;
  attempt: number;
  resume: boolean;
  sessionId: string;
  pid: number;
  binary: BinaryInfo;
  cwd: string;
  startedAt: string;
  /** The exact argv, with the --json-schema value replaced by "<schema>". */
  args: string[];
  /** Names only; values are never recorded. */
  envKeys: string[];
  leases: Lease[];
  /** The branches merged into the worktree before this run's first attempt, with their head SHAs (M2). */
  merged?: Array<{ branch: string; sha: string }>;
  /**
   * On a run's first attempt: how long the run was held (no slot, quota, semaphores, writer lock) and how long it
   * prepared (worktree, dependencies, merges, inputs) before the worker started, in ms (DESIGN.md §21).
   */
  heldMs?: number;
  prepareMs?: number;
  /** The lane inputs copied into `.arbab-tmp/inputs/`, by name. */
  inputs?: string[];
}

/** Token use summed over an attempt's distinct assistant messages (each message's `usage` counted once). */
export interface TokenUsage {
  input: number;
  cacheCreation: number;
  cacheRead: number;
  output: number;
}

export interface AttemptExit {
  exitCode: number | null;
  signal: string | null;
  killedBy: KillReason | null;
  finishedAt: string;
  wallMs: number;
  reaped: number[];
  checkpoint: string | null;
  checkpointError: string | null;
}

/** Epoch seconds for resetsAt, 0–1 for utilization, as rate_limit_event reports them. */
export interface QuotaWindow {
  utilization: number;
  resetsAt: number;
}

export interface RateLimitSnapshot {
  /** When arbab saw the event (ISO). */
  observedAt: string;
  status: string | null;
  type: string | null;
  fiveHour: QuotaWindow | null;
  sevenDay: QuotaWindow | null;
}

export interface InitFacts {
  tools: string[];
  permissionMode: string | null;
  version: string | null;
  model: string | null;
  apiKeySource: string | null;
  mcpServers: unknown[];
  plugins: string[];
  skills: number;
  memoryPaths: boolean;
  messagingSocket: boolean;
  entrypoint: string | null;
}

export interface ResultFacts {
  subtype: string | null;
  isError: boolean;
  terminalReason: string | null;
  apiErrorStatus: number | null;
  numTurns: number | null;
  durationMs: number | null;
  /** Session-cumulative, client-side estimate. */
  totalCostUsd: number | null;
  resultText: string | null;
  structuredOutput: unknown;
}

/** Everything src/stream derives from one attempt's stream.jsonl. */
export interface StreamDigest {
  sessionId: string | null;
  init: InitFacts | null;
  /** Every result event, in order (a run with background work can have several). */
  results: ResultFacts[];
  final: ResultFacts | null;
  toolCalls: Record<string, number>;
  /** Failed tool results, keyed "<tool>:<cause>". */
  failedByCause: Record<string, number>;
  permissionDenied: number;
  /** Distinct assistant message ids. */
  turns: number;
  lastTool: string | null;
  rateLimit: RateLimitSnapshot | null;
  /** Lines that did not parse (a truncated last line of a live stream is normal). */
  unparsedLines: number;
  /** Token use over distinct assistant messages; null when no assistant message carried usage. */
  tokens?: TokenUsage | null;
  /**
   * The longest gap between two consecutive events, in ms, from the events' own timestamps when they carry one; null
   * when fewer than two events are timed (DESIGN.md §21).
   */
  maxGapMs?: number | null;
}

export interface AttemptSummary {
  lane: string;
  attempt: number;
  role: Role;
  state: EndState;
  sessionId: string | null;
  binary: BinaryInfo | null;
  model: string | null;
  requestedEffort: Effort | null;
  /** Effort per assistant entry from the transcript, e.g. {"high": 104}; null when the transcript was not found. */
  measuredEffort: Record<string, number> | null;
  wallMs: number | null;
  turns: number;
  toolCalls: Record<string, number>;
  toolCallTotal: number;
  /** The last tool the worker called (StructuredOutput excluded). */
  lastTool: string | null;
  failedByCause: Record<string, number>;
  failedTotal: number;
  permissionDenied: number;
  /** Session-cumulative cost after this attempt. */
  costUsd: number | null;
  /** This attempt's share: costUsd minus the previous attempt's costUsd. */
  costDeltaUsd: number | null;
  resultEvents: number;
  final: ResultFacts | null;
  rateLimit: RateLimitSnapshot | null;
  init: InitFacts | null;
  /** kind/entrypoint/name from ~/.claude/sessions/<pid>.json, when it was seen. */
  registration: { kind: string | null; entrypoint: string | null; name: string | null } | null;
  /** null when the lane has no schema. */
  reportValid: boolean | null;
  reportErrors: ValidationError[];
  /** Present even when no result event came (a killed attempt has no cost, but its tokens are known). */
  tokens?: TokenUsage | null;
  maxGapMs?: number | null;
}

export type LaneState = "queued" | "held" | "preparing" | "running" | "waiting-reset" | "finished" | "orphaned";

/** The `reason` of a lane held for a free machine-wide slot; every other held lane waits for the quota. */
export const NO_FREE_SLOT_REASON = "no free slot";

/** <runs>/<lane>/state.json, written atomically by the shepherd. */
export interface LaneStateRecord {
  lane: string;
  state: LaneState;
  attempt: number;
  since: string;
  shepherdPid: number;
  reason?: string;
  /** Epoch seconds a held or waiting lane will re-check at. */
  until?: number;
  endState?: EndState;
}

export interface HoldDecision {
  hold: boolean;
  reason: string | null;
  /** Epoch seconds to re-check at (a window's resetsAt), or null. */
  until: number | null;
}

export interface StatusRow {
  lane: string;
  state: LaneState;
  attempt: number;
  endState: EndState | null;
  elapsedMs: number | null;
  turns: number;
  toolCalls: number;
  lastTool: string | null;
  effort: string | null;
  failedTotal: number;
  costUsd: number | null;
  costDeltaUsd: number | null;
  fiveHour: QuotaWindow | null;
  sevenDay: QuotaWindow | null;
  /** The session that launched the run (shepherd.json owner); null for runs launched outside Claude Code or before §21. */
  owner?: string | null;
  /** state.json's reason (why it is held, why it failed), or null. */
  reason?: string | null;
  tokens?: TokenUsage | null;
}

// ---------------------------------------------------------------------------------------------------------------
// Ownership and machine-wide registries (DESIGN.md §21)

/** <runs>/<lane>/shepherd.json, written by the shepherd when a run starts. */
export interface ShepherdRecord {
  pid: number;
  startedAt: string;
  /** CLAUDE_CODE_SESSION_ID of the session that launched the run; null outside Claude Code. Absent before §21. */
  owner?: string | null;
}

/** ~/.arbab/shepherds/<pid>.json, present while that shepherd lives. */
export interface ShepherdEntry {
  pid: number;
  lane: string;
  /** Absolute project root. */
  project: string;
  owner: string | null;
  startedAt: string;
}

/** ~/.arbab/waiters/<pid>.json, present while that `arbab wait` runs. */
export interface WaiterEntry {
  pid: number;
  project: string;
  owner: string | null;
  startedAt: string;
}

/** ~/.arbab/projects/<sha1(root)>.json: a project that launched a lane on this machine (for `summary --all`). */
export interface ProjectEntry {
  root: string;
  lastLaunchAt: string;
}

/** One line of <runs>/<lane>/events.jsonl: a state change of a lane run, appended by the shepherd. */
export interface LaneEvent {
  at: string;
  shepherdPid: number;
  state: LaneState;
  attempt: number;
  reason?: string;
  until?: number;
  endState?: EndState;
}

// ---------------------------------------------------------------------------------------------------------------
// Integration, verification, review, readiness and landing (src/integrate, src/verify, src/review, src/readiness;
// DESIGN.md §17). Every record lives in .arbab/integrations/<name>/.

/** integration.json */
export interface IntegrationRecord {
  name: string;
  /** integrate/<name> */
  branch: string;
  /** Absolute path of .arbab/worktrees/integrate-<name>. */
  worktree: string;
  base: string;
  baseSha: string;
  /**
   * One entry per lane, in the order first integrated. `sha` is the lane commit integrated last; `manifests` lists the
   * dependency manifests the lane changed (DESIGN.md §16).
   */
  merged: Array<{ lane: string; branch: string; sha: string; manifests: string[] }>;
  /**
   * The dependency manifests that differ between baseSha and headSha, whoever committed the change: an arbab merge, a
   * hand commit in the integration worktree, or a merge whose record was lost.
   */
  manifests: string[];
  /**
   * The head at which a human reviewed the changed manifests and installed the dependencies (`integrate
   * --deps-installed`); null when none did, or when a manifest changed after it.
   */
  depsConfirmedAt: string | null;
  /** No manifest changed, or a human confirmed them at depsConfirmedAt. */
  depsConfirmed: boolean;
  headSha: string;
  updatedAt: string;
}

export interface GateResult {
  kind: "gate" | "smoke";
  argv: string[];
  /** The exact command line the verify lane ran. */
  command: string;
  /** From the stream's tool result; null when the call was not found (counts as a failure). */
  exitCode: number | null;
}

/** verify.json */
export interface VerifyRecord {
  name: string;
  lane: string;
  attempt: number | null;
  /** The integration head that was verified. */
  headSha: string;
  results: GateResult[];
  passed: boolean;
  /** Why verify failed although the commands may have exited 0 (the lane ran on other code, or left changes). */
  reason?: string;
  finishedAt: string;
}

export type FindingVerdict = "confirmed" | "refuted" | "unverified";

export interface ReviewFinding {
  /** <lens>-<n>, stable within one review. */
  id: string;
  lens: string;
  title: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  file: string;
  line?: number;
  failureScenario: string;
  evidence: string;
  suggestedFix?: string;
  /** LOW findings get no skeptic pass and stay "unverified". */
  verdict: FindingVerdict;
  verdictReason?: string;
}

/**
 * review.json: the latest review. Every review run also writes `reviews/<round>.json` beside it (REVIEW_HISTORY_DIR),
 * so earlier rounds stay readable (DESIGN.md §21).
 */
export interface ReviewRecord {
  name: string;
  headSha: string;
  lenses: Array<{ lens: string; lane: string; endState: EndState | null; coverage: string | null; pathsChecked: number }>;
  skeptics: Array<{ lens: string; lane: string; endState: EndState | null }>;
  findings: ReviewFinding[];
  finishedAt: string;
  /** 1 for an integration's first review, counting up; absent before §21. */
  round?: number;
  /** `review --since <sha>`: the commit the reviewers diffed from instead of the integration's base. */
  since?: string | null;
}

export const REVIEW_HISTORY_DIR = "reviews";

/** host-checks.json: the `hostGates` a human ran on the host with `arbab host-check <name>` (DESIGN.md §21). */
export interface HostCheckRecord {
  name: string;
  headSha: string;
  results: GateResult[];
  passed: boolean;
  /** Always true: the command refuses without a terminal. Kept so the record says how it was made. */
  interactive: true;
  finishedAt: string;
}

export const HOST_CHECKS_FILE = "host-checks.json";

/**
 * A line of the readiness report. Skipped items carry stable ids a human may waive: "review", "review:<lens>",
 * "skeptic", "smoke", "deps" ("verify" is listed but cannot be waived: land needs it passed). Verified items and risks
 * carry ids too ("verify:<command>", "finding:<id>", "manifest:<path>", "report:<lane>", "stale:verify", …).
 */
export interface ReadinessItem {
  id: string;
  text: string;
}

/** readiness.json (readiness.md is its rendering) */
export interface ReadinessReport {
  name: string;
  tier: Tier;
  headSha: string;
  verified: ReadinessItem[];
  skipped: Array<ReadinessItem & { waived: boolean }>;
  risks: ReadinessItem[];
  /** Verify passed for this head and every skipped item is waived. */
  ready: boolean;
  createdAt: string;
  /**
   * The head the current review was made at, when it differs from headSha only by a clean merge of the base (the
   * review is carried over; DESIGN.md §21). Absent otherwise.
   */
  reviewCarriedOverFrom?: string;
}

/** landing.json */
export interface LandingRecord {
  name: string;
  into: string;
  integrationHead: string;
  /** The merge commit, or the single commit of a squash landing. */
  mergeSha: string;
  landedAt: string;
  pushed: false;
  /** One commit on the base instead of a merge (`land --squash`, config landing.squash). Absent before §21. */
  squash?: boolean;
  /**
   * The lanes this landing carried, with the commit integrated last: how cleanup knows a lane landed when its branch
   * is not an ancestor of the base (a squash landing, a reshaped base). Absent before §21.
   */
  lanes?: Array<{ lane: string; sha: string }>;
}
