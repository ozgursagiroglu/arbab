import type { ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { SpawnImpl } from "../run";
import { digestStream, parseStream } from "../stream";
import type { RateLimitSnapshot } from "../types";
import { ArbabError } from "../util/errors";
import { ensureDir } from "../util/fs";
import { isoAt, type Clock } from "../util/proc";
import { quotaPath, replaceQuota } from "./quota";

export const REFRESH_PROMPT = "Reply with the single word: ok";
export const REFRESH_TIMEOUT_MS = 60_000;
/** How many stderr lines a failed refresh reports. */
export const STDERR_TAIL_LINES = 5;
const STDERR_KEEP_CHARS = 16_384;
const TAIL_LINE_CHARS = 500;

/**
 * The argv after the claude binary: one turn on the cheapest model, no tools, no settings files and no MCP servers.
 * The prompt goes on stdin, as a worker's does: a positional after `--tools ""` could be read as a tool name.
 */
export function refreshArgs(): string[] {
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    "haiku",
    "--max-turns",
    "1",
    "--tools",
    "",
    // The same empty source list as a worker's: no user, project or local settings.
    "--setting-sources",
    "",
    "--strict-mcp-config",
  ];
}

export interface RefreshRun {
  code: number | null;
  signal: string | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

/** Runs claude once with `input` on stdin and resolves when it ended or was killed at `timeoutMs`; never rejects. */
export type RefreshSpawn = (
  binary: string,
  args: string[],
  opts: { cwd: string; env: Record<string, string>; input: string; timeoutMs: number },
) => Promise<RefreshRun>;

/**
 * The real RefreshSpawn over `spawnImpl`. On timeout, SIGTERM then SIGKILL after `graceMs`. A process that exited but
 * left its pipes open to a descendant ends the wait `graceMs` after its exit.
 */
export function makeRefreshSpawn(spawnImpl: SpawnImpl, graceMs = 2000): RefreshSpawn {
  return (binary, args, opts) =>
    new Promise((resolve) => {
      const out: Buffer[] = [];
      let err = "";
      let timedOut = false;
      let exit: { code: number | null; signal: string | null } | null = null;
      const timers: NodeJS.Timeout[] = [];
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        for (const t of timers) clearTimeout(t);
        resolve({ code: exit?.code ?? null, signal: exit?.signal ?? null, timedOut, stdout: Buffer.concat(out).toString("utf8"), stderr: err });
      };

      let child: ChildProcess;
      try {
        child = spawnImpl(binary, args, { cwd: opts.cwd, env: opts.env, stdio: ["pipe", "pipe", "pipe"] });
      } catch (e) {
        err = `cannot start ${binary}: ${(e as Error).message}`;
        finish();
        return;
      }
      const kill = (sig: NodeJS.Signals): void => {
        try {
          child.kill(sig);
        } catch {
          // Already gone.
        }
      };
      child.stdout?.on("data", (chunk: Buffer) => out.push(chunk));
      child.stderr?.on("data", (chunk: Buffer) => {
        err = (err + chunk.toString("utf8")).slice(-STDERR_KEEP_CHARS);
      });
      child.once("error", (e) => {
        err += `${err === "" || err.endsWith("\n") ? "" : "\n"}${e.message}\n`;
        if (child.pid === undefined) finish();
      });
      child.once("exit", (code, signal) => {
        exit = { code, signal };
        if (!timedOut) for (const t of timers.splice(0)) clearTimeout(t);
        timers.push(setTimeout(finish, graceMs));
      });
      child.once("close", finish);
      timers.push(
        setTimeout(() => {
          timedOut = true;
          kill("SIGTERM");
          timers.push(
            setTimeout(() => {
              kill("SIGKILL");
              timers.push(setTimeout(finish, graceMs));
            }, graceMs),
          );
        }, opts.timeoutMs),
      );
      // A child that exits before reading its stdin makes the write fail with EPIPE; the exit tells the story.
      child.stdin?.on("error", () => undefined);
      child.stdin?.end(opts.input);
    });
}

/** The last `STDERR_TAIL_LINES` non-empty lines of `stderr`, each cut to a readable length. */
export function stderrTail(stderr: string): string[] {
  return stderr
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "")
    .slice(-STDERR_TAIL_LINES)
    .map((line) => (line.length > TAIL_LINE_CHARS ? `${line.slice(0, TAIL_LINE_CHARS)}…` : line));
}

export interface RefreshInput {
  /** ~/.arbab: quota.json, quota-reset.json, and tmp/ for the call's working directory. */
  home: string;
  binary: string;
  /** A worker's scrubbed environment (workerEnv). */
  env: Record<string, string>;
  clock: Clock;
  spawn: RefreshSpawn;
  timeoutMs?: number;
}

/**
 * `arbab quota --refresh` (DESIGN.md §21): one call on the current account, whose rate_limit_event replaces the
 * stored snapshot and records the switch. Without an event, on a non-zero exit or a timeout, throws a runtime error
 * with the stderr tail and leaves both files as they were.
 */
export async function refreshQuota(input: RefreshInput): Promise<RateLimitSnapshot> {
  const timeoutMs = input.timeoutMs ?? REFRESH_TIMEOUT_MS;
  const tmpRoot = join(input.home, "tmp");
  let cwd: string;
  try {
    ensureDir(tmpRoot);
    cwd = mkdtempSync(join(tmpRoot, "quota-refresh-"));
  } catch (err) {
    throw new ArbabError("io", `cannot create a working directory under ${tmpRoot}: ${(err as Error).message}`, { cause: err });
  }
  let run: RefreshRun;
  try {
    run = await input.spawn(input.binary, refreshArgs(), { cwd, env: input.env, input: REFRESH_PROMPT, timeoutMs });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }

  const fail = (what: string): ArbabError => {
    const tail = stderrTail(run.stderr);
    const lines = tail.length === 0 ? ["  (stderr empty)"] : tail.map((line) => `  ${line}`);
    return new ArbabError("runtime", [`refresh failed: ${what}; ${quotaPath(input.home)} is unchanged`, "stderr:", ...lines].join("\n"));
  };
  if (run.timedOut) throw fail(`claude did not finish within ${Math.round(timeoutMs / 1000)} s`);
  if (run.code !== 0) throw fail(`claude exited with ${run.code === null ? `signal ${run.signal ?? "unknown"}` : `code ${run.code}`}`);
  const parsed = parseStream(run.stdout);
  const snapshot = digestStream(parsed.events, isoAt(input.clock), parsed.unparsedLines).rateLimit;
  if (snapshot === null) throw fail("claude's stream had no rate_limit_event");
  replaceQuota(input.home, snapshot, input.clock);
  return snapshot;
}
