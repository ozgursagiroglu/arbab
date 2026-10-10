import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { ArbabError } from "../util/errors";

export type SpawnImpl = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface SpawnWorkerInput {
  binary: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  promptFile: string;
  streamFile: string;
  stderrFile: string;
  spawnImpl?: SpawnImpl;
}

export interface SpawnedWorker {
  pid: number;
  exited: Promise<{ code: number | null; signal: string | null }>;
}

function open(path: string, flags: string, opened: number[]): number {
  try {
    const fd = openSync(path, flags);
    opened.push(fd);
    return fd;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const why = code === "EEXIST" ? "already exists (attempt files are never overwritten)" : (err as Error).message;
    throw new ArbabError("io", `cannot open ${path}: ${why}`, { cause: err });
  }
}

/**
 * Starts the worker in its own process group (detached → setsid), stdin from the prompt file and stdout/stderr into
 * files created exclusively. The parent keeps no copy of the descriptors.
 */
export function spawnWorker(input: SpawnWorkerInput): SpawnedWorker {
  const opened: number[] = [];
  let child: ChildProcess;
  try {
    const stdin = open(input.promptFile, "r", opened);
    const stdout = open(input.streamFile, "wx", opened);
    const stderr = open(input.stderrFile, "wx", opened);
    child = (input.spawnImpl ?? spawn)(input.binary, input.args, {
      cwd: input.cwd,
      env: input.env,
      detached: true,
      stdio: [stdin, stdout, stderr],
    });
  } finally {
    for (const fd of opened) closeSync(fd);
  }

  const exited = new Promise<{ code: number | null; signal: string | null }>((done) => {
    // A spawn failure emits error and no exit; the listener also keeps that error from crashing the process.
    child.once("error", () => {
      if (child.pid === undefined) done({ code: null, signal: null });
    });
    child.once("exit", (code, signal) => done({ code, signal }));
  });
  if (child.pid === undefined) throw new ArbabError("runtime", `cannot start ${input.binary}`);
  return { pid: child.pid, exited };
}
