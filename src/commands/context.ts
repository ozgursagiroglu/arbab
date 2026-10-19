import { execFileSync, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config";
import { runPaths } from "../registry";
import { nodeGit, runArgv, type ArgvRunner, type GitRunner } from "../run";
import { defaultDeps, runShepherd, type ShepherdDeps, type ShepherdMode } from "../shepherd";
import type { EndState } from "../types";
import { ArbabError } from "../util/errors";
import { confine, ensureDir } from "../util/fs";
import { isAlive, sendSignal, sleep, systemClock, type Clock } from "../util/proc";

export type Write = (text: string) => void;

/** Everything a command touches, so tests can inject temporary directories, fake processes and a fast clock. */
export interface CommandContext {
  cwd: string;
  /** This CLI process; it holds the launch lock. */
  pid: number;
  stdout: Write;
  stderr: Write;
  hostEnv: Record<string, string | undefined>;
  /** ~/.arbab */
  home: string;
  /** ~/.claude */
  claudeHome: string;
  clock: Clock;
  sleep: (ms: number) => Promise<void>;
  alive: (pid: number) => boolean;
  signal: (target: number, sig: NodeJS.Signals) => boolean;
  /** Starts a detached shepherd for the lane and returns its pid. */
  spawnShepherd: (projectRoot: string, lane: string, mode: ShepherdMode) => number;
  shepherdDeps: () => ShepherdDeps;
  runShepherd: (root: string, lane: string, mode: ShepherdMode, deps: ShepherdDeps, stop: AbortSignal) => Promise<EndState>;
  /** Calls `handler` on SIGTERM or SIGINT; returns the function that removes it. */
  trapSignals: (handler: () => void) => () => void;
  git: GitRunner;
  /** Runs an argv on the host (the integration worktree's dependency command). */
  runCommand: ArgvRunner;
  /** `ps -p <pid> -o command=`, or null when there is no such process. */
  processCommand: (pid: number) => string | null;
  platform: NodeJS.Platform;
  nodeVersion: string;
  version: string;
  /**
   * Whether a person's terminal is attached (stdin and stdout are TTYs). An agent's shell tool has none, so a step
   * reserved for the human, such as confirming a dependency install, requires one.
   */
  interactive: boolean;
  /**
   * Opens a URL in the browser; resolves whether it did. False when this platform has no opener arbab knows, or the
   * opener could not start or failed.
   */
  openUrl: (url: string) => Promise<boolean>;
}

/** How long an opener may run before it counts as opened: some `xdg-open`s wait for the browser they start. */
export const OPENER_WAIT_MS = 5000;

/**
 * `open <url>` on macOS, `xdg-open <url>` on Linux, detached and ignored. Resolves false on a spawn error or a non-zero
 * exit, true on exit 0 or when the opener still runs after OPENER_WAIT_MS; false on any other platform.
 */
export function makeOpenUrl(platform: NodeJS.Platform, spawnFn: typeof spawn = spawn): CommandContext["openUrl"] {
  const opener = platform === "darwin" ? "open" : platform === "linux" ? "xdg-open" : null;
  return (url) => {
    if (opener === null) return Promise.resolve(false);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(true), OPENER_WAIT_MS);
      // Neither the timer nor the opener keeps arbab alive.
      timer.unref();
      const settle = (opened: boolean): void => {
        clearTimeout(timer);
        resolve(opened);
      };
      let child: ReturnType<typeof spawn>;
      try {
        child = spawnFn(opener, [url], { detached: true, stdio: "ignore" });
      } catch {
        settle(false);
        return;
      }
      child.on("error", () => settle(false));
      child.on("exit", (code) => settle(code === 0));
      child.unref();
    });
  };
}

/** The `__shepherd` argv for a lane; `launch` and the recycled-pid guard of `stop` agree on it. */
export function shepherdArgv(scriptPath: string, root: string, lane: string, mode: ShepherdMode): string[] {
  return [scriptPath, "__shepherd", root, lane, JSON.stringify(mode)];
}

/**
 * Starts `node <script> __shepherd …` in its own process group, output appended to `<runs>/<lane>/shepherd.log`, and
 * lets this process exit without waiting for it.
 */
export function makeSpawnShepherd(execPath: string, scriptPath: string, env: NodeJS.ProcessEnv): CommandContext["spawnShepherd"] {
  return (root, lane, mode) => {
    const laneDir = runPaths(confine(root, loadConfig(root).runsRoot), lane).laneDir;
    ensureDir(laneDir);
    const log = openSync(join(laneDir, "shepherd.log"), "a");
    try {
      const child = spawn(execPath, shepherdArgv(scriptPath, root, lane, mode), {
        cwd: root,
        env,
        detached: true,
        stdio: ["ignore", log, log],
      });
      child.once("error", () => undefined);
      if (child.pid === undefined) throw new ArbabError("runtime", `cannot start the shepherd for ${lane}`);
      child.unref();
      return child.pid;
    } finally {
      closeSync(log);
    }
  };
}

function processCommand(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    const out = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.trim() === "" ? null : out.trim();
  } catch {
    return null;
  }
}

function trapSignals(handler: () => void): () => void {
  process.on("SIGTERM", handler);
  process.on("SIGINT", handler);
  return () => {
    process.off("SIGTERM", handler);
    process.off("SIGINT", handler);
  };
}

/** The real effects. The only place the CLI reads the process environment, the home directory and the clock. */
export function defaultContext(opts: { scriptPath: string; version: string }): CommandContext {
  const home = homedir();
  return {
    cwd: process.cwd(),
    pid: process.pid,
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    hostEnv: { ...process.env },
    home: join(home, ".arbab"),
    claudeHome: join(home, ".claude"),
    clock: systemClock,
    sleep,
    alive: isAlive,
    signal: sendSignal,
    spawnShepherd: makeSpawnShepherd(process.execPath, opts.scriptPath, process.env),
    shepherdDeps: defaultDeps,
    runShepherd,
    trapSignals,
    git: nodeGit,
    runCommand: runArgv,
    processCommand,
    platform: process.platform,
    nodeVersion: process.versions.node,
    version: opts.version,
    interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
    openUrl: makeOpenUrl(process.platform),
  };
}
