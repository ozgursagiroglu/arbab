// The shepherd supervises one lane from launch to finish (DESIGN.md §2): slot, quota, worktree, dependencies,
// leases, the worker's attempts, auto-resume after a usage limit, and the release of everything it held.
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { findOnPath, pathExists, realpath, runVersion } from "../binary";
import { runnerPath } from "../registry";
import { isPortFree, nodeGit, readPs, runArgv } from "../run";
import type { ArgvRunner, GitRunner, PortProbe, SpawnImpl } from "../run";
import { isAlive, sendSignal, sleep, systemClock } from "../util/proc";
import type { Clock } from "../util/proc";

export { runShepherd } from "./lifecycle";
export { CONTINUATION_PROMPT, digestHeadStart } from "./prompt";
export { mergeBranches } from "./merge";
export type { MergedBranch } from "./merge";
export type { StartedRecord } from "./attempt";

/**
 * `promptFile` (an absolute path under the lane's run dir) keeps the resume prompt out of the shepherd's argv.
 * `digestFrom` (an attempt number) starts the fresh session with a digest of that attempt as its head start (M2).
 */
export type ShepherdMode =
  | { kind: "start" }
  | { kind: "resume"; prompt?: string; promptFile?: string }
  | { kind: "fresh"; digestFrom?: number };

/** Everything the shepherd touches, so tests can inject temporary directories, a fake claude and a fast clock. */
export interface ShepherdDeps {
  /** The ~/.arbab directory (quota, slots, leases, locks). */
  home: string;
  /** The ~/.claude directory: projects/ holds transcripts, sessions/ holds registrations. */
  claudeHome: string;
  clock: Clock;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  hostEnv: Record<string, string | undefined>;
  nodeDir: string;
  pnpmDir: string | undefined;
  git: GitRunner;
  runCommand: ArgvRunner;
  spawnImpl: SpawnImpl;
  readPs: () => string;
  signal: (target: number, sig: NodeJS.Signals) => boolean;
  alive: (pid: number) => boolean;
  probePort: PortProbe;
  /** ARBAB_CLAUDE from the environment, or null. */
  explicitClaude: string | null;
  pathEnv: string;
  run: (path: string, args: string[]) => string;
  exists: (p: string) => boolean;
  realpath: (p: string) => string;
  /**
   * The absolute real path of the runner file this shepherd runs, recorded in its machine-wide entry. Optional only
   * because test/fake-claude/harness.ts builds deps without it; defaultDeps always sets it.
   */
  runner?: string;
  tickMs: number;
  holdPollMs: number;
  slotPollMs: number;
  reapGraceMs: number;
}

/** The real effects. This is the only place the shepherd reads the process environment and the home directory. */
export function defaultDeps(): ShepherdDeps {
  const home = homedir();
  const pathEnv = process.env["PATH"] ?? "";
  const pnpm = findOnPath("pnpm", pathEnv, pathExists);
  const explicit = process.env["ARBAB_CLAUDE"];
  return {
    home: join(home, ".arbab"),
    claudeHome: join(home, ".claude"),
    clock: systemClock,
    sleep,
    random: Math.random,
    hostEnv: { ...process.env },
    nodeDir: dirname(process.execPath),
    pnpmDir: pnpm === null ? undefined : dirname(pnpm),
    git: nodeGit,
    runCommand: runArgv,
    spawnImpl: spawn,
    readPs: () => readPs(),
    signal: sendSignal,
    alive: isAlive,
    probePort: isPortFree,
    explicitClaude: explicit === undefined || explicit === "" ? null : explicit,
    pathEnv,
    run: runVersion,
    exists: pathExists,
    realpath,
    runner: runnerPath(process.argv[1] ?? ""),
    tickMs: 10_000,
    holdPollMs: 60_000,
    slotPollMs: 15_000,
    reapGraceMs: 10_000,
  };
}
