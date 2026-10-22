// arbab preflight <lane.json> [--timeout-min N] [--json]
//
// Writes two probe lanes under .arbab/preflight/<lane>/ (<lane>-pf-tools: the project's preflight steps on
// haiku/low; <lane>-pf-model: `git rev-parse --short HEAD` on the lane's model), launches both, waits for both, and
// checks the fence from what they recorded (DESIGN.md §11). The probes run in the lane's worktree when it exists;
// otherwise each gets its own, removed with its arbab/<probe> branch before the probes launch (a stale one, refused
// when git will not remove it unforced) and after the checks are printed (what git keeps is named on stderr). The
// tools probe runs the project's preflight steps by exact allow rules, whatever the lane's role.
// While it waits, ~/.arbab/waiters/<pid>.json says so (the Stop hook reads it).
// Text: one line per check, `ok|fail  <check>  <detail>`.
// --json: {"ok": boolean, "timedOut": boolean, "lanes": [string, string],
//          "checks": [{"status": "ok" | "fail", "check": string, "detail": string}]}
// Exit 0 when every check passes, 1 on any failure, 3 when the probes did not finish in time.
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { effectiveRole } from "../config";
import {
  ack,
  attemptFiles,
  effectiveState,
  listAttempts,
  readAttempt,
  readState,
  registerWaiter,
  runPaths,
  sessionOf,
  unregisterWaiter,
} from "../registry";
import { arbabIgnoreEntries, ensureArbabMarkers, ensureIgnored, untrustedTree, verifyWorktreeGit, type GitRunner } from "../run";
import type { AttemptSummary, JsonSchema, LaneSpec } from "../types";
import { ArbabError } from "../util/errors";
import { readJson, readText, writeJsonAtomic, writeTextAtomic } from "../util/fs";
import { assertValidName, isValidName } from "../util/names";
import { isoAt } from "../util/proc";
import type { CommandContext } from "./context";
import { formatChecks } from "./doctor";
import { formatIssue, hasErrors, issueSummary, lintLane, resolveGitCommonDir } from "./lint";
import { assertInactive, assertNoLiveWorker, launchLane } from "./launch";
import { isActive, onePositional, openProject, parse, printJson, type Project } from "./project";
import { WAIT_TIMEOUT_EXIT, parseTimeoutMin } from "./wait";

export const PROBE_MODEL = "claude-haiku-5-5";
export const SHA_COMMAND = "git rev-parse --short HEAD";
const DEFAULT_TIMEOUT_MIN = 45;
const POLL_MS = 5000;
// Without configured steps the tools probe still has to make one real call through the fence.
const FALLBACK_STEP = ["git", "status"];

const TOOLS_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: { n: { type: "integer" }, command: { type: "string" }, exit_code: { type: "integer" }, output: { type: "string" } },
        required: ["n", "command", "exit_code"],
      },
    },
  },
  required: ["steps"],
};

const MODEL_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: { answer: { type: "string" } },
  required: ["answer"],
};

export interface PreflightCheck {
  status: "ok" | "fail";
  check: string;
  detail: string;
}

/** What one probe left on disk. */
export interface ProbeResult {
  lane: string;
  /** The end state from state.json or summary.json, or null when the probe never finished an attempt. */
  endState: string | null;
  summary: AttemptSummary | null;
  stderr: string;
  report: unknown;
  /** The worktree the attempt ran in (started.json). */
  cwd: string | null;
}

export interface PreflightInput {
  expectedTools: string[];
  steps: string[];
  tools: ProbeResult;
  model: ProbeResult;
  /** `git rev-parse --short HEAD` in the model probe's worktree. */
  headSha: string | null;
}

export function stepCommands(steps: string[][]): string[] {
  return (steps.length > 0 ? steps : [FALLBACK_STEP]).map((argv) => argv.join(" "));
}

export function toolsBrief(lane: string, steps: string[]): string {
  return [
    `# Preflight of ${lane}: tools and steps`,
    "",
    "## Task",
    "",
    "This is a preflight probe: it checks that the fence lets the project's checks run. Run each command below " +
      "exactly once, in order, as its own Bash call in the foreground, with the Bash timeout parameter set to 900000. " +
      "Do not edit any file and do not try to fix a failing command.",
    "",
    // "Run" makes each step a command span, so lint refuses a step the fence denies before anything launches.
    ...steps.map((cmd, i) => `${i + 1}. Run \`${cmd}\``),
    "",
    "## Scope",
    "",
    "No files: this probe changes nothing.",
    "",
    "## Acceptance",
    "",
    "- Each command above ran once.",
    "- The report lists every command with its number n, the command, and the exit code it returned.",
    "",
  ].join("\n");
}

export function modelBrief(lane: string): string {
  return [
    `# Preflight of ${lane}: model`,
    "",
    "## Task",
    "",
    `This is a preflight probe. Run \`${SHA_COMMAND}\` once, as a single Bash call. Then answer with exactly OK, ` +
      "a space and the hash it printed, and put that same answer in the report's answer field.",
    "",
    "## Scope",
    "",
    "No files: this probe changes nothing.",
    "",
    "## Acceptance",
    "",
    "- The answer is OK and the short hash of HEAD, nothing else.",
    "",
  ].join("\n");
}

export interface ProbeFiles {
  tools: { name: string; laneFile: string };
  model: { name: string; laneFile: string };
  /** The lane worktree both probes run in, or null when each gets a worktree of its own (removed after the run). */
  borrowed: string | null;
}

const PROBE_SUFFIXES = ["pf-tools", "pf-model"] as const;

/** The longest lane name whose probe names are still valid names. */
export const MAX_PREFLIGHT_NAME = (() => {
  let n = 1;
  while (PROBE_SUFFIXES.every((s) => isValidName(`${"a".repeat(n + 1)}-${s}`))) n++;
  return n;
})();

/** The probes' directory, relative to the project root. */
export const PREFLIGHT_DIR = ".arbab/preflight";

/** Where a lane's probe files live: arbab's own directory, never the project's lanes/. */
export const preflightDir = (project: Project, lane: string): string => join(project.root, PREFLIGHT_DIR, assertValidName(lane, "lane"));

/**
 * Writes the two probe lanes, their briefs and schemas under preflightDir. The probes borrow the lane's worktree
 * when it already exists, so they check the tree the lane will run in. The tools probe may run each preflight step
 * by an exact allow rule, whatever the role's commands. Returns project-relative lane paths.
 */
export function writeProbeLanes(project: Project, lane: LaneSpec): ProbeFiles {
  if (lane.name.length > MAX_PREFLIGHT_NAME) {
    throw new ArbabError(
      "usage",
      `lane name ${lane.name} is ${lane.name.length} characters; preflight needs at most ${MAX_PREFLIGHT_NAME} to add -pf-tools and -pf-model`,
    );
  }
  const dir = preflightDir(project, lane.name);
  const rel = (path: string): string => relative(project.root, path);
  const owner = lane.worktree ?? lane.name;
  const worktree = lane.worktree !== undefined || existsSync(join(project.worktreeRoot, owner)) ? owner : undefined;
  const shared: Partial<LaneSpec> = {
    role: lane.role,
    ...(lane.fence !== undefined && { fence: lane.fence }),
    // The probes check the tools the lane will have, so they get the same narrowing.
    ...(lane.tools !== undefined && { tools: lane.tools }),
    ...(lane.base !== undefined && { base: lane.base }),
    ...(worktree !== undefined && { worktree }),
    ...(lane.resources !== undefined && { resources: lane.resources }),
    ...(lane.semaphores !== undefined && { semaphores: lane.semaphores }),
    budgetUsd: 1,
    checkpoint: false,
    autoResume: false,
    maxAttempts: 1,
  };

  const write = (suffix: string, brief: string, schema: JsonSchema, fields: Partial<LaneSpec>): { name: string; laneFile: string } => {
    const name = assertValidName(`${lane.name}-${suffix}`, "probe lane");
    const briefFile = join(dir, `${name}.md`);
    const schemaFile = join(dir, `${name}.schema.json`);
    const laneFile = join(dir, `${name}.json`);
    writeTextAtomic(briefFile, brief);
    writeJsonAtomic(schemaFile, schema);
    writeJsonAtomic(laneFile, { name, ...shared, brief: rel(briefFile), schema: rel(schemaFile), ...fields });
    return { name, laneFile: rel(laneFile) };
  };

  const steps = stepCommands(project.config.preflight.steps);
  return {
    tools: write("pf-tools", toolsBrief(lane.name, steps), TOOLS_SCHEMA, {
      model: PROBE_MODEL,
      effort: "low",
      wallMin: 30,
      idleMin: 20,
      // The steps are the project's checks, not the role's work: a reviewer's commands need not list them.
      allow: [...new Set([...(lane.allow ?? []), ...steps.map((cmd) => `Bash(${cmd})`)])],
    }),
    model: write("pf-model", modelBrief(lane.name), MODEL_SCHEMA, {
      ...(lane.model !== undefined && { model: lane.model }),
      ...(lane.effort !== undefined && { effort: lane.effort }),
      wallMin: 10,
      idleMin: 5,
      allow: [...(lane.allow ?? []), `Bash(${SHA_COMMAND})`],
    }),
    borrowed: worktree ?? null,
  };
}

const gitMessage = (r: { stdout: string; stderr: string }): string => (r.stderr || r.stdout).trim();

/**
 * Removes the worktree and the arbab/<probe> branch the shepherd created for a probe that borrows no worktree (each
 * holds a dependency install). Nothing is forced and no hook runs, since a worker ran there. Returns why something
 * was kept, or null when nothing of the probe's is left.
 */
export function removeProbeWorktree(git: GitRunner, project: Project, probe: string, gitCommonDir: string | undefined): string | null {
  const path = join(project.worktreeRoot, assertValidName(probe, "probe lane"));
  const branch = `arbab/${probe}`;
  if (existsSync(path)) {
    if (gitCommonDir === undefined) return `kept ${path}: the repository's git directory is unknown`;
    // A worker could rewrite the worktree's .git file; git must not follow it to a config of the worker's.
    const verified = verifyWorktreeGit({ worktree: path, branch, gitCommonDir });
    if (verified.gitDir === null) return `kept ${path}: ${verified.error}`;
    const removed = git([...untrustedTree(), "worktree", "remove", path], project.root);
    if (removed.code !== 0) return `kept ${path}: git worktree remove failed: ${gitMessage(removed)}`;
  }
  // A worktree directory deleted by hand stays registered and keeps its branch checked out.
  git(["worktree", "prune"], project.root);
  if (git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], project.root).code !== 0) return null;
  // -d, not -D: git itself refuses a branch with commits that are not merged.
  const deleted = git([...untrustedTree(), "branch", "-d", branch], project.root);
  return deleted.code === 0 ? null : `kept ${branch}: git branch -d failed: ${gitMessage(deleted)}`;
}

const normalizeTool = (tool: string): string => (tool === "Agent" ? "Task" : tool);

function sameTools(init: string[], expected: string[]): boolean {
  // --json-schema adds StructuredOutput; Agent is reported as Task (measured in w0).
  const a = [...new Set(init.filter((t) => t !== "StructuredOutput").map(normalizeTool))].sort();
  const b = [...new Set(expected.map(normalizeTool))].sort();
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

function answerOf(probe: ProbeResult): string | null {
  const report = probe.report;
  if (typeof report === "object" && report !== null && typeof (report as { answer?: unknown }).answer === "string") {
    return (report as { answer: string }).answer;
  }
  return probe.summary?.final?.resultText ?? null;
}

function sameSha(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x));
}

function probeChecks(label: string, probe: ProbeResult, expectedTools: string[]): PreflightCheck[] {
  const checks: PreflightCheck[] = [];
  const add = (ok: boolean, check: string, detail: string): void => {
    checks.push({ status: ok ? "ok" : "fail", check: `${label} ${check}`, detail });
  };
  const s = probe.summary;
  add(probe.endState === "success", "end state", `${probe.lane}: ${probe.endState ?? "no attempt finished"}`);
  if (s === null) {
    add(false, "summary", `${probe.lane} has no summary.json`);
    return checks;
  }
  const init = s.init;
  if (init === null) {
    add(false, "init", "the stream has no init event");
  } else {
    add(sameTools(init.tools, expectedTools), "tools", `init ${JSON.stringify(init.tools)}, expected ${JSON.stringify(expectedTools)}`);
    add(init.permissionMode === "dontAsk", "permission mode", String(init.permissionMode));
    add(init.mcpServers.length === 0, "mcp servers", `${init.mcpServers.length}`);
    add(!init.memoryPaths, "memory paths", init.memoryPaths ? "present (--restricted missing?)" : "absent");
    add(!init.messagingSocket, "messaging socket", init.messagingSocket ? "present (--restricted missing?)" : "absent");
    const pinned = s.binary?.version ?? null;
    add(pinned !== null && init.version === pinned, "version", `init ${String(init.version)}, pinned ${String(pinned)}`);
  }
  const warnings = ["has not been trusted", "Ignoring"].filter((w) => probe.stderr.includes(w));
  add(warnings.length === 0, "stderr", warnings.length === 0 ? "no trust or ignore warnings" : `contains ${warnings.map((w) => JSON.stringify(w)).join(", ")}`);
  const reg = s.registration;
  const vscode = reg !== null && (reg.kind === "claude-vscode" || reg.entrypoint === "claude-vscode");
  add(!vscode, "registration", reg === null ? "none" : `kind ${String(reg.kind)}, entrypoint ${String(reg.entrypoint)}`);
  add(s.toolCallTotal >= 1, "tool calls", `${s.toolCallTotal}`);
  return checks;
}

function stepsCheck(steps: string[], report: unknown): PreflightCheck {
  const list = typeof report === "object" && report !== null ? (report as { steps?: unknown }).steps : undefined;
  if (!Array.isArray(list)) return { status: "fail", check: "steps", detail: "the tools probe has no report with steps" };
  const failed: string[] = [];
  for (const item of list) {
    const code = typeof item === "object" && item !== null ? (item as { exit_code?: unknown }).exit_code : undefined;
    const command = typeof item === "object" && item !== null ? (item as { command?: unknown }).command : undefined;
    if (code !== 0) failed.push(`${String(command)} → ${String(code)}`);
  }
  if (list.length < steps.length) failed.push(`${list.length} of ${steps.length} steps reported`);
  return failed.length === 0
    ? { status: "ok", check: "steps", detail: `${list.length} step(s) exited 0` }
    : { status: "fail", check: "steps", detail: failed.join("; ") };
}

function shaCheck(model: ProbeResult, headSha: string | null): PreflightCheck {
  const answer = answerOf(model);
  const sha = answer === null ? null : (/\bOK\s+([0-9a-fA-F]{4,40})\b/.exec(answer)?.[1] ?? null);
  if (headSha === null) return { status: "fail", check: "sha", detail: "the model probe's worktree HEAD is unknown" };
  if (sha === null) return { status: "fail", check: "sha", detail: `no "OK <sha>" in the answer ${JSON.stringify(answer)}` };
  return sameSha(sha, headSha)
    ? { status: "ok", check: "sha", detail: `${sha} = HEAD` }
    : { status: "fail", check: "sha", detail: `answered ${sha}, HEAD is ${headSha}` };
}

/** DESIGN.md §11: pure, so tests feed it summaries and reports. */
export function evaluatePreflight(input: PreflightInput): PreflightCheck[] {
  return [
    ...probeChecks("tools", input.tools, input.expectedTools),
    stepsCheck(input.steps, input.tools.report),
    ...probeChecks("model", input.model, input.expectedTools),
    shaCheck(input.model, input.headSha),
  ];
}

/** The probe's newest attempt after `after`, with its end state; acked so `arbab wait` does not report it again. */
export function collectProbe(runsRoot: string, lane: string, after: number): ProbeResult {
  const state = readState(runsRoot, lane);
  const attempt = listAttempts(runsRoot, lane).at(-1);
  if (attempt === undefined || attempt <= after) {
    return { lane, endState: state?.endState ?? null, summary: null, stderr: "", report: null, cwd: null };
  }
  const dir = runPaths(runsRoot, lane).attemptDir(attempt);
  const record = readAttempt(dir);
  const files = attemptFiles(dir);
  ack(runsRoot, lane, attempt);
  return {
    lane,
    endState: state?.endState ?? record.summary?.state ?? null,
    summary: record.summary,
    stderr: readText(files.stderr) ?? "",
    report: readJson<unknown>(files.report),
    cwd: record.started?.cwd ?? null,
  };
}

/**
 * Waits until each probe's own shepherd (by pid) has finished it. Comparing pids keeps a previous run's `finished`
 * state from passing for this one; a shepherd that died before writing any state also ends the wait.
 */
export async function waitForProbes(
  ctx: CommandContext,
  runsRoot: string,
  probes: Array<{ lane: string; pid: number }>,
  timeoutMs: number,
): Promise<boolean> {
  const start = ctx.clock.now();
  const done = (p: { lane: string; pid: number }): boolean => {
    const record = readState(runsRoot, p.lane);
    if (record !== null && record.shepherdPid === p.pid) return !isActive(effectiveState(record, ctx.alive));
    return !ctx.alive(p.pid);
  };
  for (;;) {
    if (probes.every(done)) return true;
    const remaining = timeoutMs - (ctx.clock.now() - start);
    if (remaining <= 0) return false;
    await ctx.sleep(Math.min(POLL_MS, remaining));
  }
}

/**
 * Runs `wait` registered as a waiter of this session on `root`, as `arbab wait` is (DESIGN.md §21): the lanes a command
 * launched are this session's, and without a waiter the Stop hook would block the turn the command is waiting in.
 */
export async function whileWaiting<T>(ctx: CommandContext, root: string, wait: () => Promise<T>): Promise<T> {
  registerWaiter(ctx.home, { pid: ctx.pid, project: root, owner: sessionOf(ctx.hostEnv), startedAt: isoAt(ctx.clock) });
  try {
    return await wait();
  } finally {
    unregisterWaiter(ctx.home, ctx.pid);
  }
}

export async function runPreflight(argv: string[], ctx: CommandContext): Promise<number> {
  const { values, positionals } = parse("preflight", {
    args: argv,
    options: { "timeout-min": { type: "string" }, json: { type: "boolean" } },
    allowPositionals: true,
  });
  const lanePath = onePositional("preflight", positionals, "lane.json");
  const timeoutMs = parseTimeoutMin(values["timeout-min"] ?? String(DEFAULT_TIMEOUT_MIN));
  const project = openProject(ctx);

  const gitCommonDir = resolveGitCommonDir(ctx.git, project.root);
  const { lane, issues } = lintLane(project, lanePath, gitCommonDir);
  if (hasErrors(issues)) {
    for (const issue of issues) ctx.stderr(formatIssue(issue) + "\n");
    throw new ArbabError("lint", `${issueSummary(lane.name, issues)}; fix the lane before its preflight`);
  }
  const expectedTools = effectiveRole(project.config, lane).tools;
  if (!expectedTools.includes("Bash")) throw new ArbabError("usage", `role ${lane.role} has no Bash tool; preflight needs one`);

  // The probe lanes are generated files under .arbab/preflight/: keep them out of the project's git status with
  // arbab's own entries, as the shepherd does.
  ensureIgnored(project.root, arbabIgnoreEntries(project.root, project.config), ctx.git);
  ensureArbabMarkers(project.root);
  const files = writeProbeLanes(project, lane);
  // Both probes are linted before either starts, so a refused second probe never leaves the first one running.
  for (const probe of [files.tools, files.model]) {
    const probeLint = lintLane(project, probe.laneFile, gitCommonDir).issues;
    if (hasErrors(probeLint)) {
      for (const issue of probeLint) ctx.stderr(formatIssue(issue) + "\n");
      throw new ArbabError("lint", `${issueSummary(probe.name, probeLint)}; preflight not started`);
    }
  }
  // Each run starts from fresh probe worktrees: a previous run's may be stale (a timeout, an interrupted preflight).
  const own = files.borrowed === null ? [files.tools.name, files.model.name] : [];
  for (const name of own) {
    assertInactive(ctx, project, name);
    assertNoLiveWorker(ctx, project, name);
  }
  for (const name of own) {
    const kept = removeProbeWorktree(ctx.git, project, name, gitCommonDir);
    if (kept !== null) throw new ArbabError("git", `a previous preflight's probe is in the way: ${kept}; remove it, then run preflight again`);
  }
  const probes: Array<{ lane: string; pid: number; before: number }> = [];
  for (const probe of [files.tools, files.model]) {
    const before = listAttempts(project.runsRoot, probe.name).at(-1) ?? 0;
    const launched = await launchLane(ctx, project, probe.laneFile);
    probes.push({ lane: probe.name, pid: launched.shepherdPid, before });
  }
  ctx.stderr(`preflight: launched ${probes.map((p) => p.lane).join(" and ")}; waiting\n`);

  const finished = await whileWaiting(ctx, project.root, () => waitForProbes(ctx, project.runsRoot, probes, timeoutMs));
  const lanes = probes.map((p) => p.lane);
  if (!finished) {
    if (values.json === true) printJson(ctx, { ok: false, timedOut: true, lanes, checks: [] });
    else ctx.stderr(`arbab preflight: ${lanes.join(" and ")} did not finish in time\n`);
    return WAIT_TIMEOUT_EXIT;
  }

  const [toolsProbe, modelProbe] = probes.map((p) => collectProbe(project.runsRoot, p.lane, p.before)) as [ProbeResult, ProbeResult];
  let headSha: string | null = null;
  if (modelProbe.cwd !== null) {
    const r = ctx.git(["rev-parse", "--short", "HEAD"], modelProbe.cwd);
    if (r.code === 0 && r.stdout.trim() !== "") headSha = r.stdout.trim();
  }
  const checks = evaluatePreflight({
    expectedTools,
    steps: stepCommands(project.config.preflight.steps),
    tools: toolsProbe,
    model: modelProbe,
    headSha,
  });
  const ok = checks.every((c) => c.status === "ok");
  if (values.json === true) printJson(ctx, { ok, timedOut: false, lanes, checks });
  else ctx.stdout(formatChecks(checks) + "\n");
  // The results are recorded; each probe worktree holds a dependency install that nothing will use again.
  for (const name of own) {
    const kept = removeProbeWorktree(ctx.git, project, name, gitCommonDir);
    if (kept !== null) ctx.stderr(`preflight: ${kept}\n`);
  }
  return ok ? 0 : 1;
}
