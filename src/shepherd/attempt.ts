import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { resolveBinary } from "../binary";
import { buildClaudeArgs, compileProfile, envFileAllowReads, lintProfile, workerEnv } from "../profile";
import { updateQuota } from "../quota";
import { attemptFiles, createAttempt, listAttempts, readAttempt, runPaths } from "../registry";
import { DEFAULT_SCHEMAS, validate } from "../report";
import {
  checkpoint,
  createWatcher,
  leaseEnv,
  parsePs,
  reap,
  signalTargets,
  spawnWorker,
  trackDescendants,
  type PsRow,
} from "../run";
import {
  buildAttemptSummary,
  classifyAttempt,
  digestStream,
  findTranscript,
  measuredEffort,
  parseStream,
  rateLimitFromEvent,
} from "../stream";
import type {
  AttemptExit,
  AttemptStarted,
  AttemptSummary,
  BinaryInfo,
  CompiledProfile,
  EndState,
  FenceLevel,
  JsonSchema,
  KillReason,
  LaneSpec,
  Lease,
  ProfileInput,
  ProjectConfig,
  RateLimitSnapshot,
  RoleDefaults,
  ValidationError,
} from "../types";
import { ArbabError } from "../util/errors";
import { confine, createExclusive, readJson, readText } from "../util/fs";
import { isoAt } from "../util/proc";
import type { ShepherdDeps } from "./index";
import type { MergedBranch } from "./merge";
import { buildBrief, CONTINUATION_PROMPT, type BriefInput } from "./prompt";

/** Everything one attempt needs from the lane's supervision. */
export interface AttemptContext {
  projectRoot: string;
  runsRoot: string;
  config: ProjectConfig;
  lane: LaneSpec;
  /** The role preset with config and lane overrides applied. */
  role: RoleDefaults;
  fence: FenceLevel;
  /** Real path of the worktree the worker runs in. */
  worktree: string;
  branch: string;
  /** The repository's shared git directory: the fence denies writes there, and checkpoints are checked against it. */
  gitCommonDir: string;
  leases: Lease[];
  deps: ShepherdDeps;
  stop: AbortSignal;
  /** Sleeps, but wakes early when `stop` aborts. */
  pause: (ms: number) => Promise<void>;
  /** Called once the attempt directory exists, with its number. */
  onStarted: (n: number) => void;
}

export interface AttemptRequest {
  kind: "start" | "fresh" | "resume";
  /** The prompt of a resume attempt; the standard continuation prompt when absent. */
  prompt?: string;
  /** A `## Head start` section for the brief of a fresh attempt. */
  headStart?: string;
  /** The branches merged into the worktree before this attempt, recorded in its started.json. */
  merged?: MergedBranch[];
  /** On a run's first attempt: how long the run was held and how long it prepared, in ms (started.json). */
  timing?: { heldMs: number; prepareMs: number };
  /** The lane inputs copied into `.arbab-tmp/inputs/`, by name: recorded in started.json and listed in the brief. */
  inputs?: string[];
}

/** started.json: the contract's fields, plus the merged branches of an attempt whose worktree was set up by merges. */
export type StartedRecord = AttemptStarted & { merged?: MergedBranch[] };

/** What a request adds to started.json; each field only when the request carries it, so older readers see nothing new. */
export function startedFields(request: AttemptRequest): Pick<StartedRecord, "merged" | "heldMs" | "prepareMs" | "inputs"> {
  return {
    ...(request.merged === undefined ? {} : { merged: request.merged }),
    ...(request.timing === undefined ? {} : { heldMs: request.timing.heldMs, prepareMs: request.timing.prepareMs }),
    ...(request.inputs === undefined ? {} : { inputs: request.inputs }),
  };
}

export interface AttemptOutcome {
  n: number;
  state: EndState;
  rateLimit: RateLimitSnapshot | null;
}

type Registration = AttemptSummary["registration"];

/** The argv as recorded on disk: the --json-schema value is elided. */
export function elideSchema(args: string[]): string[] {
  return args.map((arg, i) => (args[i - 1] === "--json-schema" ? "<schema>" : arg));
}

/** The lane's report schema: its own file, or the role's default. */
export function laneSchema(projectRoot: string, lane: LaneSpec): JsonSchema {
  if (lane.schema === undefined) return DEFAULT_SCHEMAS[lane.role];
  const value = readJson<unknown>(confine(projectRoot, lane.schema));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ArbabError("config", `schema ${lane.schema} is not a JSON object`);
  }
  return value as JsonSchema;
}

/** A file's text, or null when it is missing or cannot be read: for what only adds detail to a summary. */
function readOptional(path: string): string | null {
  try {
    return readText(path);
  } catch {
    return null;
  }
}

/** kind, entrypoint and name from a ~/.claude/sessions/<pid>.json registration, or null when it is not readable. */
export function readRegistration(path: string): Registration {
  const text = readOptional(path);
  if (text === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const str = (x: unknown): string | null => (typeof x === "string" ? x : null);
  return { kind: str(v["kind"]), entrypoint: str(v["entrypoint"]), name: str(v["name"]) };
}

/**
 * `<runsRoot>/<owner>/worktree-used`: exists once any attempt, the owner's or a borrower's, has started in the owner's
 * worktree. From then on the worktree holds worker-written files, and setup never merges or installs there again.
 */
export function worktreeUsedFile(runsRoot: string, owner: string): string {
  return join(runPaths(runsRoot, owner).laneDir, "worktree-used");
}

function writeOnce(path: string, text: string): void {
  if (!createExclusive(path, text)) throw new ArbabError("io", `${path} already exists (attempt files are never overwritten)`);
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export interface PreviousSession {
  sessionId: string;
  /** The binary the session last ran on; a resume must keep it. */
  binary: BinaryInfo;
  /** The session-cumulative cost it had reached, or null when no attempt of it recorded one. */
  costUsd: number | null;
}

/**
 * What a resume continues: the session of the latest attempt that started, with that attempt's binary. The cost base
 * is the most recent attempt of the same session that recorded a cost: an attempt killed before its result says
 * nothing about the session's total, and total_cost_usd keeps counting across it.
 */
export function previousSession(runsRoot: string, lane: string): PreviousSession {
  const records = [...listAttempts(runsRoot, lane)].reverse().map((n) => readAttempt(runPaths(runsRoot, lane).attemptDir(n)));
  const latest = records.find((r) => r.started !== null)?.started;
  if (latest === undefined || latest === null) throw new ArbabError("usage", `lane ${lane} has no earlier attempt to resume`);
  const withCost = records.find((r) => r.started?.sessionId === latest.sessionId && typeof r.summary?.costUsd === "number");
  return { sessionId: latest.sessionId, binary: latest.binary, costUsd: withCost?.summary?.costUsd ?? null };
}

/** The fence's input for an attempt: the lane's role and config, the worktree, and the env-file options. */
export function profileInput(
  ctx: Pick<AttemptContext, "config" | "lane" | "role" | "fence" | "leases" | "worktree" | "gitCommonDir"> & {
    deps: Pick<AttemptContext["deps"], "git">;
  },
): ProfileInput {
  const { config, lane, role } = ctx;
  const readable = config.fence.readableEnvFiles;
  return {
    role: lane.role,
    fence: ctx.fence,
    tools: role.tools,
    loopback: role.loopback,
    commands: config.commands[lane.role] ?? [],
    laneAllow: lane.allow ?? [],
    credentialPaths: config.credentialPaths,
    env: { ...config.env, ...leaseEnv(ctx.leases) },
    worktree: ctx.worktree,
    gitCommonDir: ctx.gitCommonDir,
    readableEnvFiles: readable,
    bashOutputMaxChars: config.fence.bashOutputMaxChars,
    // Each listed template costs a git call; with none listed there is nothing to re-open.
    envFileAllowReads: readable.length === 0 ? [] : envFileAllowReads({ worktree: ctx.worktree, readable, git: ctx.deps.git }),
  };
}

/** The compiled fence, refused when its lint finds errors: config can change between launch and a later attempt. */
function profileFor(ctx: AttemptContext): CompiledProfile {
  const input = profileInput(ctx);
  const profile = compileProfile(input);
  const errors = lintProfile(profile, input).filter((issue) => issue.severity === "error");
  if (errors.length > 0) throw new ArbabError("config", [...new Set(errors.map((issue) => issue.code))].join(", "));
  return profile;
}

/** The pid set a worker's kills may reach (DESIGN.md §2), kept fresh from ps snapshots. */
interface Tree {
  /** Re-reads the tree; a failed snapshot keeps what was tracked. */
  snapshot(): void;
  /** The pids a fresh snapshot vouches for, or null when ps fails (then only the process group is signalled). */
  targets(): Set<number> | null;
  tracked(): Set<number>;
}

function workerTree(pid: number, readPs: () => string, rootRunning: () => boolean): Tree {
  let tracked = new Set<number>();
  const table = (): PsRow[] | null => {
    try {
      return parsePs(readPs());
    } catch {
      // ps can fail (EPERM inside a sandbox); the process group still covers most of the tree.
      return null;
    }
  };
  return {
    snapshot() {
      const rows = table();
      if (rows !== null) tracked = trackDescendants(pid, rows, tracked, rootRunning());
    },
    targets() {
      const rows = table();
      return rows === null ? null : signalTargets(pid, rows, tracked, rootRunning());
    },
    tracked: () => tracked,
  };
}

/** Launches one attempt, watches it to its end and records exit.json and summary.json (DESIGN.md §2, §3, §7). */
export async function runAttempt(ctx: AttemptContext, request: AttemptRequest): Promise<AttemptOutcome> {
  const { deps, lane, role, runsRoot } = ctx;

  // Everything that can refuse runs before the attempt directory exists, so a refusal leaves no empty attempt.
  const resume = request.kind === "resume";
  const previous = resume ? previousSession(runsRoot, lane.name) : null;
  // Only a resumed session keeps its binary; a new session takes whatever claude resolves to now.
  const binary = resolveBinary({
    pinned: previous?.binary ?? null,
    explicitPath: deps.explicitClaude,
    pathEnv: deps.pathEnv,
    minVersion: ctx.config.minClaudeVersion,
    run: deps.run,
    exists: deps.exists,
    realpath: deps.realpath,
  });
  const profile = profileFor(ctx);
  const schema = laneSchema(ctx.projectRoot, lane);
  const sessionId = previous?.sessionId ?? randomUUID();
  const briefInput: BriefInput = {
    projectRoot: ctx.projectRoot,
    runsRoot,
    config: ctx.config,
    lane,
    branch: ctx.branch,
    worktree: ctx.worktree,
    profile,
    leases: ctx.leases,
    schema,
    ...(request.headStart === undefined ? {} : { headStart: request.headStart }),
    ...(request.inputs === undefined || request.inputs.length === 0 ? {} : { inputs: request.inputs }),
  };
  const prompt = resume ? (request.prompt ?? CONTINUATION_PROMPT) : buildBrief(briefInput);
  const env = workerEnv(deps.hostEnv, {
    passEnv: ctx.config.passEnv,
    extra: {},
    nodeDir: deps.nodeDir,
    ...(deps.pnpmDir === undefined ? {} : { pnpmDir: deps.pnpmDir }),
  });
  if (ctx.stop.aborted) return { n: 0, state: "killed:stopped", rateLimit: null };

  // Before the attempt exists, so no attempt ever runs in a worktree that is not marked used. Already there is fine.
  createExclusive(worktreeUsedFile(runsRoot, lane.worktree ?? lane.name), json({ lane: lane.name, at: isoAt(deps.clock) }));
  const { n, dir } = createAttempt(runsRoot, lane.name);
  ctx.onStarted(n);
  const files = attemptFiles(dir);
  writeOnce(files.settings, json(profile.settings));
  const args = buildClaudeArgs({
    model: role.model,
    effort: role.effort,
    tools: profile.tools,
    settingsPath: files.settings,
    budgetUsd: role.budgetUsd,
    name: lane.name,
    session: resume ? { kind: "resume", id: sessionId } : { kind: "new", id: sessionId },
    schema,
  });
  writeOnce(files.brief, prompt.endsWith("\n") ? prompt : `${prompt}\n`);
  writeOnce(files.args, json(elideSchema(args)));

  const startedAtMs = deps.clock.now();
  const worker = spawnWorker({
    binary: binary.path,
    args,
    cwd: ctx.worktree,
    env,
    promptFile: files.brief,
    streamFile: files.stream,
    stderrFile: files.stderr,
    spawnImpl: deps.spawnImpl,
  });
  const pid = worker.pid;
  let exitedFlag = false;
  void worker.exited.then(() => {
    exitedFlag = true;
  });

  const tree = workerTree(pid, deps.readPs, () => !exitedFlag);
  // Descendants alive when a kill rule fired; exit.json lists them with what the final reap found.
  const killed = new Set<number>();
  let killedBy: KillReason | null = null;
  const sendAll = (sig: NodeJS.Signals, targets: Set<number> | null = tree.targets()): void => {
    for (const target of [-pid, ...(targets ?? [])]) {
      try {
        deps.signal(target, sig);
      } catch {
        // A pid that is gone or no longer ours must not stop the rest.
      }
    }
  };
  const kill = (reason: KillReason): void => {
    if (killedBy !== null) return;
    killedBy = reason;
    const targets = tree.targets();
    for (const p of targets ?? []) if (deps.alive(p)) killed.add(p);
    sendAll("SIGTERM", targets);
    void deps.sleep(deps.reapGraceMs).then(() => {
      if (!exitedFlag) sendAll("SIGKILL");
    });
  };
  // Quota is recorded as the stream reports it, stamped with when it was read, so a reading never outranks a newer one.
  const recordQuota = (event: Record<string, unknown> | null): void => {
    const snapshot = event === null ? null : rateLimitFromEvent(event, isoAt(deps.clock));
    if (snapshot === null) return;
    try {
      updateQuota(deps.home, snapshot);
    } catch {
      // The account snapshot is advisory; the next rate_limit_event rewrites it.
    }
  };

  const started: StartedRecord = {
    lane: lane.name,
    attempt: n,
    resume,
    sessionId,
    pid,
    binary,
    cwd: ctx.worktree,
    startedAt: new Date(startedAtMs).toISOString(),
    args: elideSchema(args),
    envKeys: Object.keys(env).sort(),
    leases: ctx.leases,
    ...startedFields(request),
  };
  let registration: Registration = null;
  const watcher = createWatcher({
    streamPath: files.stream,
    startedAtMs,
    wallMs: role.wallMin * 60_000,
    idleMs: role.idleMin * 60_000,
    clock: deps.clock,
  });
  try {
    writeOnce(files.started, json(started));

    const registrationFile = join(deps.claudeHome, "sessions", `${pid}.json`);
    const ended = worker.exited.then(() => true);

    // Once stopped, pause() returns at once; plain ticks keep the loop from spinning while the worker dies.
    const nextTick = (): Promise<void> => (ctx.stop.aborted ? deps.sleep(deps.tickMs) : ctx.pause(deps.tickMs));
    while (!(await Promise.race([ended, nextTick().then(() => false)]))) {
      // A ps snapshot first, so a kill on this tick reaches the newest descendants.
      tree.snapshot();
      if (registration === null) {
        registration = readRegistration(registrationFile);
        if (registration !== null) writeOnce(files.registration, json(registration));
      }
      let reason: KillReason | null = null;
      try {
        const tick = watcher.tick();
        reason = tick.kill;
        recordQuota(tick.rateLimitEvent);
      } catch {
        // An unreadable stream this tick is retried on the next one.
      }
      if (ctx.stop.aborted) reason = "stopped";
      if (reason !== null) kill(reason);
    }
  } catch (err) {
    // The worker must not outlive a shepherd that can no longer watch it.
    if (!exitedFlag) sendAll("SIGKILL");
    throw err;
  }

  const result = await worker.exited;
  const finishedAtMs = deps.clock.now();
  // What the worker wrote after the last tick, read now.
  try {
    recordQuota(watcher.tick().rateLimitEvent);
  } catch {
    // The digest below still sees the whole stream.
  }
  // One more snapshot: a worker that exits between ticks may leave members of its group behind.
  tree.snapshot();
  const survivors = await reap({
    pgid: pid,
    pids: tree.tracked(),
    signal: deps.signal,
    alive: deps.alive,
    sleep: deps.sleep,
    graceMs: deps.reapGraceMs,
    verify: () => tree.targets(),
  });
  const reaped = [...new Set([...killed, ...survivors])].sort((a, b) => a - b);

  // No stream at all classifies as no-result.
  const parsed = parseStream(readOptional(files.stream) ?? "");
  const digest = digestStream(parsed.events, isoAt(deps.clock), parsed.unparsedLines);

  const output = digest.final?.structuredOutput ?? null;
  let reportErrors: ValidationError[];
  if (output === null) reportErrors = [{ path: "", message: "no structured output" }];
  else reportErrors = validate(schema, output);
  const reportValid = reportErrors.length === 0;
  if (reportValid) writeOnce(files.report, json(output));

  const exit: AttemptExit = {
    exitCode: result.code,
    signal: result.signal,
    killedBy,
    finishedAt: new Date(finishedAtMs).toISOString(),
    wallMs: Math.max(0, finishedAtMs - startedAtMs),
    reaped,
    checkpoint: null,
    checkpointError: null,
  };
  const state = classifyAttempt({ digest, exit, alive: false, schemaRequired: true, reportValid });

  if (role.checkpoint) {
    try {
      const c = checkpoint({
        worktree: ctx.worktree,
        lane: lane.name,
        attempt: n,
        endState: state,
        branch: ctx.branch,
        gitCommonDir: ctx.gitCommonDir,
        git: deps.git,
      });
      exit.checkpoint = c.sha;
      exit.checkpointError = c.error;
    } catch (err) {
      exit.checkpointError = (err as Error).message;
    }
  }

  let effort: Record<string, number> | null = null;
  const transcript = findTranscript(join(deps.claudeHome, "projects"), digest.sessionId ?? sessionId);
  // The transcript only adds measured effort.
  const transcriptText = transcript === null ? null : readOptional(transcript);
  if (transcriptText !== null) {
    try {
      effort = measuredEffort(transcriptText);
    } catch {
      effort = null;
    }
  }
  if (registration === null) {
    registration = readRegistration(join(deps.claudeHome, "sessions", `${pid}.json`));
    if (registration !== null) writeOnce(files.registration, json(registration));
  }

  const summary = buildAttemptSummary({
    lane: lane.name,
    attempt: n,
    role: lane.role,
    state,
    started,
    exit,
    digest,
    requestedEffort: role.effort,
    measuredEffort: effort,
    // total_cost_usd is cumulative only across --resume.
    previousCostUsd: resume ? (previous?.costUsd ?? null) : null,
    registration,
    reportValid,
    reportErrors,
    nowMs: deps.clock.now(),
  });
  writeOnce(files.exit, json(exit));
  writeOnce(files.summary, json(summary));
  return { n, state, rateLimit: digest.rateLimit };
}
