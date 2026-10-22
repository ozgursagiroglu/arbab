import { realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { assembleBrief, parseBriefSource, toolBelt } from "../brief";
import { headStart, renderDigest } from "../digest";
import { FIXED_ENV } from "../profile";
import { attemptFiles, listAttempts, readAttempt, runPaths } from "../registry";
import { parseStream } from "../stream";
import type { BriefContext, CompiledProfile, JsonSchema, LaneSpec, Lease, ProjectConfig } from "../types";
import { ArbabError } from "../util/errors";
import { confine, readJson, readText } from "../util/fs";

/** The standard prompt of an auto-resumed attempt (DESIGN.md §2). */
export const CONTINUATION_PROMPT =
  "The run stopped because the account hit its usage limit, not because of anything in your work. The limit has " +
  "reset. The runner committed your work so far as a checkpoint: check `git log --oneline -5` and " +
  "`git status --short` to re-orient, then continue exactly where you left off, finish the task, run the checks " +
  "the brief names, and end with the report the brief asks for.";

function readRequired(path: string, what: string): string {
  const text = readText(path);
  if (text === null) throw new ArbabError("io", `cannot read ${what} ${path}: it does not exist`);
  return text;
}

/**
 * The prompt of a resume attempt: the text of `promptFile` when it is set, else `prompt`, else the standard
 * continuation prompt. `promptFile` must be an absolute path that, symlinks resolved, lies inside the lane's run dir
 * (where `arbab resume` writes it), so a shepherd's argv cannot make it read anything else.
 */
export function resumePrompt(laneDir: string, mode: { prompt?: string; promptFile?: string }): string {
  if (mode.promptFile === undefined) return mode.prompt ?? CONTINUATION_PROMPT;
  const file = mode.promptFile;
  if (!isAbsolute(file)) throw new ArbabError("usage", `prompt file ${file} is not an absolute path`);
  let real: string;
  let base: string;
  try {
    real = realpathSync(file);
    base = realpathSync(laneDir);
  } catch (err) {
    throw new ArbabError("io", `cannot resolve prompt file ${file}: ${(err as Error).message}`, { cause: err });
  }
  const rel = relative(base, real);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new ArbabError("usage", `prompt file ${file} is not inside the lane's run dir ${laneDir}`);
  }
  const text = readRequired(real, "prompt file");
  if (text.trim() === "") throw new ArbabError("usage", `prompt file ${file} is empty`);
  return text;
}

/**
 * What an upstream lane reported, from its latest attempt that has a summary: the validated report's `summary`
 * field when there is one (structured and short), else the final result text.
 */
export function upstreamSummary(runsRoot: string, lane: string): string {
  const attempts = listAttempts(runsRoot, lane);
  for (const n of [...attempts].reverse()) {
    const dir = runPaths(runsRoot, lane).attemptDir(n);
    let record: ReturnType<typeof readAttempt>;
    try {
      record = readAttempt(dir);
    } catch {
      continue;
    }
    if (record.summary === null) continue;
    let report: unknown = null;
    try {
      report = readJson<unknown>(attemptFiles(dir).report);
    } catch {
      // A report that does not parse is ignored; the result text still says something.
    }
    if (typeof report === "object" && report !== null && typeof (report as { summary?: unknown }).summary === "string") {
      return (report as { summary: string }).summary;
    }
    const text = record.summary.final?.resultText;
    if (typeof text === "string" && text.trim() !== "") return text;
    return `(attempt ${n} ended ${record.summary.state} without a report)`;
  }
  return "(no finished attempt yet)";
}

/**
 * The `## Head start` section of a fresh session (DESIGN.md §16): the digest of attempt `n`'s stream. A missing or
 * empty stream is an error, since a head start that says nothing would mislead more than none.
 */
export function digestHeadStart(runsRoot: string, lane: string, n: number): string {
  const file = attemptFiles(runPaths(runsRoot, lane).attemptDir(n)).stream;
  const text = readText(file);
  if (text === null) throw new ArbabError("usage", `cannot seed a digest from attempt ${n} of ${lane}: ${file} does not exist`);
  const { events } = parseStream(text);
  if (events.length === 0) throw new ArbabError("usage", `cannot seed a digest from attempt ${n} of ${lane}: ${file} has no events`);
  return headStart(renderDigest(events).markdown, n);
}

/**
 * `section` placed after the brief's own sections, before the tool belt. `toolBeltSection` is the generated one, so
 * a "## Tool belt" line inside a source section or project rule cannot be mistaken for it.
 */
export function insertBeforeToolBelt(prompt: string, toolBeltSection: string, section: string): string {
  const at = prompt.indexOf(`\n\n${toolBeltSection}`);
  if (at === -1) throw new ArbabError("runtime", "the assembled brief has no tool belt to place the head start before");
  return `${prompt.slice(0, at)}\n\n${section.trim()}${prompt.slice(at)}`;
}

export interface BriefInput {
  projectRoot: string;
  runsRoot: string;
  config: ProjectConfig;
  lane: LaneSpec;
  branch: string;
  worktree: string;
  profile: CompiledProfile;
  leases: Lease[];
  schema: JsonSchema;
  /** A `## Head start` section (digestHeadStart) for a fresh session seeded with a digest. */
  headStart?: string;
  /** Names of the lane inputs copied into `.arbab-tmp/inputs/` (DESIGN.md §21). */
  inputs?: string[];
}

/** The assembled prompt of a start or fresh attempt (DESIGN.md §5). */
export function buildBrief(input: BriefInput): string {
  const { projectRoot, config, lane } = input;
  const source = parseBriefSource(readRequired(confine(projectRoot, lane.brief), "brief"));
  const instructions = config.instructions.map((path) => ({
    path,
    content: readRequired(confine(projectRoot, path), "instruction file"),
  }));
  const maxMs = Number(input.profile.settings.env["BASH_MAX_TIMEOUT_MS"] ?? FIXED_ENV["BASH_MAX_TIMEOUT_MS"]);
  const ctx: BriefContext = {
    lane: lane.name,
    role: lane.role,
    branch: input.branch,
    worktree: input.worktree,
    profile: input.profile,
    leases: input.leases,
    instructions,
    coordination: lane.coordination ?? null,
    upstream: (lane.upstream ?? []).map((up) => ({ lane: up, summary: upstreamSummary(input.runsRoot, up) })),
    schema: input.schema,
    bashMaxTimeoutMin: Number.isFinite(maxMs) ? Math.round(maxMs / 60_000) : 15,
    ...(input.inputs === undefined || input.inputs.length === 0 ? {} : { inputs: [...input.inputs] }),
  };
  const prompt = assembleBrief(source, ctx);
  if (input.headStart === undefined) return prompt;
  const belt = `## Tool belt\n\n${toolBelt(ctx.profile, ctx.leases, ctx.bashMaxTimeoutMin)}`;
  return insertBeforeToolBelt(prompt, belt, input.headStart);
}
