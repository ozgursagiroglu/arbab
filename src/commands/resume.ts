// arbab resume <lane> [--prompt <file> | --digest] [--json]
//
// A new attempt that resumes the latest attempt's session, for a lane that is finished or orphaned. With --digest, a
// fresh session (new session id, the lane's brief) whose brief carries a `## Head start` digest of the latest attempt.
// Text: `resumed <lane>  session <id>  shepherd <pid>`; with --digest
// `resumed <lane>  fresh session with the digest of attempt <n>  shepherd <pid>`.
// --json: {"lane": string, "sessionId": string | null, "shepherdPid": number, "prompt": "default" | "file" | "digest",
//          "digestFrom"?: number} (sessionId is null with --digest: the shepherd creates the session)
// Exit 1 when the lane is active, when an orphaned lane's worker still runs, while a launch of it holds the lock, when
// an integration generated the lane or the lane borrows such a lane's worktree (generated.json; only its verify or
// review runs there), for --prompt with --digest, and for --digest on a lane without an attempt or whose latest attempt has no stream.
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { listAttempts, readAttempt, runPaths } from "../registry";
import { digestHeadStart } from "../shepherd";
import { ArbabError } from "../util/errors";
import { confine, createExclusive, readJson, readText } from "../util/fs";
import { assertValidName } from "../util/names";
import type { CommandContext } from "./context";
import { assertNotGenerated } from "./generated";
import { assertInactive, assertNoLiveWorker, assertNotGeneratedWorktree, awaitFirstState, takeLaunchLock } from "./launch";
import { onePositional, openProject, parse, printJson, type Project } from "./project";
import { maybeStartSweep } from "./sweep";

// A resume prompt steers the session; anything longer belongs in a file the worker reads.
export const MAX_PROMPT_BYTES = 64 * 1024;

/** The prompt file's text. Confined by its real path, so a symlink cannot pull in a file outside the project. */
export function readPrompt(project: Project, file: string): string {
  let path: string;
  try {
    path = realpathSync(confine(project.root, file));
  } catch (err) {
    if (err instanceof ArbabError) throw err;
    throw new ArbabError("usage", `cannot read prompt ${file}: ${(err as Error).message}`, { cause: err });
  }
  confine(realpathSync(project.root), path);
  const text = readText(path);
  if (text === null) throw new ArbabError("usage", `cannot read prompt ${file}: no such file`);
  if (text.trim() === "") throw new ArbabError("usage", `prompt ${file} is empty`);
  if (Buffer.byteLength(text) > MAX_PROMPT_BYTES) {
    throw new ArbabError("usage", `prompt ${file} is over ${MAX_PROMPT_BYTES} bytes; point the worker at a file instead`);
  }
  return text;
}

/**
 * Writes the prompt to `<runs>/<lane>/resume-prompt-<n>.md`, never overwriting one, and returns its absolute path.
 * The shepherd reads it from there, so the text stays out of its argv, where any local process could read it.
 */
export function writeResumePrompt(project: Project, lane: string, text: string): string {
  const laneDir = runPaths(project.runsRoot, lane).laneDir;
  for (let n = (listAttempts(project.runsRoot, lane).at(-1) ?? 0) + 1; ; n++) {
    const path = join(laneDir, `resume-prompt-${n}.md`);
    if (createExclusive(path, text)) return path;
  }
}

/** The session id of the lane's latest attempt, from started.json or summary.json. */
export function latestSession(project: Project, lane: string): string {
  const attempt = listAttempts(project.runsRoot, lane).at(-1);
  if (attempt === undefined) throw new ArbabError("usage", `lane ${lane} has no attempt to resume`);
  const record = readAttempt(runPaths(project.runsRoot, lane).attemptDir(attempt));
  const id = record.started?.sessionId ?? record.summary?.sessionId ?? null;
  if (typeof id !== "string" || id === "") {
    throw new ArbabError("usage", `lane ${lane} attempt ${attempt} has no session id; launch it again instead`);
  }
  return id;
}

/**
 * The checks every resume makes under the launch lock: not a generated lane and not borrowing one's worktree (only
 * its integration's verify or review works there), not active, no orphaned worker still running.
 */
export function assertResumable(ctx: CommandContext, project: Project, lane: string): void {
  assertNotGenerated(project.runsRoot, lane);
  const spec = readJson<unknown>(runPaths(project.runsRoot, lane).laneFile);
  const worktree = typeof spec === "object" && spec !== null ? (spec as { worktree?: unknown }).worktree : undefined;
  if (typeof worktree === "string" && worktree !== lane) assertNotGeneratedWorktree(project.runsRoot, lane, worktree);
  assertInactive(ctx, project, lane);
  assertNoLiveWorker(ctx, project, lane);
}

/**
 * `resume --digest`: a fresh session seeded with the digest of the lane's latest attempt (DESIGN.md §16), under the
 * same lock and checks as a resume. The digest is rendered once here, so a missing or empty stream refuses at once.
 */
export async function resumeWithDigest(ctx: CommandContext, project: Project, lane: string): Promise<{ attempt: number; shepherdPid: number }> {
  const release = takeLaunchLock(ctx, project, lane, ctx.pid);
  try {
    assertResumable(ctx, project, lane);
    const attempt = listAttempts(project.runsRoot, lane).at(-1);
    if (attempt === undefined) throw new ArbabError("usage", `lane ${lane} has no attempt to seed a digest from; launch it instead`);
    digestHeadStart(project.runsRoot, lane, attempt);
    const shepherdPid = ctx.spawnShepherd(project.root, lane, { kind: "fresh", digestFrom: attempt });
    await awaitFirstState(ctx, project, lane, shepherdPid);
    // After the first state, so the sweep sees this lane active and leaves its worktree.
    maybeStartSweep(ctx, project);
    return { attempt, shepherdPid };
  } finally {
    release();
  }
}

export async function runResume(argv: string[], ctx: CommandContext): Promise<number> {
  const { values, positionals } = parse("resume", {
    args: argv,
    options: { prompt: { type: "string" }, digest: { type: "boolean" }, json: { type: "boolean" } },
    allowPositionals: true,
  });
  const lane = assertValidName(onePositional("resume", positionals, "lane"), "lane");
  if (values.digest === true && values.prompt !== undefined) {
    throw new ArbabError("usage", "resume takes --prompt or --digest, not both: a digest starts a fresh session with the lane's brief");
  }
  const project = openProject(ctx);
  const paths = runPaths(project.runsRoot, lane);
  if (!existsSync(paths.laneFile)) throw new ArbabError("usage", `no runs for lane ${lane}`);
  if (values.digest === true) {
    const seeded = await resumeWithDigest(ctx, project, lane);
    if (values.json === true) {
      printJson(ctx, { lane, sessionId: null, shepherdPid: seeded.shepherdPid, prompt: "digest", digestFrom: seeded.attempt });
    } else {
      ctx.stdout(`resumed ${lane}  fresh session with the digest of attempt ${seeded.attempt}  shepherd ${seeded.shepherdPid}\n`);
    }
    return 0;
  }
  const prompt = values.prompt === undefined ? undefined : readPrompt(project, values.prompt);

  // The same lock as launch: two resumes, or a launch and a resume, cannot both pass the active-lane check.
  const release = takeLaunchLock(ctx, project, lane, ctx.pid);
  let sessionId: string;
  let shepherdPid: number;
  try {
    assertResumable(ctx, project, lane);
    sessionId = latestSession(project, lane);
    const mode = prompt === undefined ? { kind: "resume" as const } : { kind: "resume" as const, promptFile: writeResumePrompt(project, lane, prompt) };
    shepherdPid = ctx.spawnShepherd(project.root, lane, mode);
    await awaitFirstState(ctx, project, lane, shepherdPid);
    maybeStartSweep(ctx, project);
  } finally {
    release();
  }
  if (values.json === true) {
    printJson(ctx, { lane, sessionId, shepherdPid, prompt: prompt === undefined ? "default" : "file" });
  } else {
    ctx.stdout(`resumed ${lane}  session ${sessionId}  shepherd ${shepherdPid}\n`);
  }
  return 0;
}
