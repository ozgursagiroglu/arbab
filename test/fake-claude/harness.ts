// Test scaffolding for lifecycle tests: a temporary project (git repository, config, brief, lane), a temporary
// ~/.arbab and ~/.claude, the fake claude as the binary, and a clock that tests can run fast.
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pathExists, realpath, runVersion } from "../../src/binary";
import { makeGitRunner, runArgv, type GitRunner } from "../../src/run";
import type { ShepherdDeps } from "../../src/shepherd";
import type { LaneSpec } from "../../src/types";
import { isAlive, sendSignal, type Clock } from "../../src/util/proc";

export const FAKE_CLAUDE = fileURLToPath(new URL("./fake-claude.mjs", import.meta.url));
export const fixture = (name: string): string => fileURLToPath(new URL(`./fixtures/${name}.jsonl`, import.meta.url));

/** Epoch seconds at which the stream fixtures' five-hour window resets. */
export const FIXTURE_RESET_SEC = 1791531000;

export interface Scenario {
  fixture: string;
  resumeFixture?: string;
  lineDelayMs?: number;
  touch?: string;
  /** true: a child in a process group of its own; "group": a child in the fake's group. */
  spawnChild?: boolean | "group";
  hangMs?: number;
  exitCode?: number;
}

export interface FakeCall {
  pid: number;
  ppid: number;
  cwd: string;
  argv: string[];
  envKeys: string[];
  childPid: number | null;
  /** Whether the child left the fake's process group; null without a child. */
  childDetached: boolean | null;
  stdinBytes: number;
}

export interface TestProject {
  dir: string;
  root: string;
  home: string;
  claudeHome: string;
  /** An executable wrapper around the fake claude (the repository copy may lack the executable bit). */
  bin: string;
  scenarioFile: string;
  logFile: string;
  git: GitRunner;
  scenario(s: Scenario): void;
  lane(spec: Partial<LaneSpec> & { name: string }): void;
  calls(): FakeCall[];
  cleanup(): void;
}

function isolatedGit(dir: string): GitRunner {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"]) delete env[key];
  return makeGitRunner({
    ...env,
    HOME: dir,
    XDG_CONFIG_HOME: dir,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(dir, "gitconfig"),
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  });
}

export function mustGit(git: GitRunner, args: string[], cwd: string): string {
  const r = git(args, cwd);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

export function makeProject(config: Record<string, unknown> = {}): TestProject {
  const dir = mkdtempSync(join(tmpdir(), "arbab-shepherd-"));
  const root = join(dir, "repo");
  const home = join(dir, "arbab-home");
  const claudeHome = join(dir, "claude-home");
  const git = isolatedGit(dir);
  mustGit(git, ["init", "-q", "-b", "main", root], dir);
  writeFileSync(join(root, "CLAUDE.md"), "# Rules\n\n## Code\n\n- Keep it small.\n");
  mkdirSync(join(root, "lanes"));
  writeFileSync(
    join(root, "lanes", "brief.md"),
    "# Test lane\n\n## Task\n\nEdit `src/a.ts`.\n\n## Scope\n\n`src/`\n\n## Acceptance\n\n- [ ] done\n",
  );
  writeFileSync(
    join(root, "arbab.config.json"),
    JSON.stringify({
      baseBranch: "main",
      instructions: ["CLAUDE.md"],
      passEnv: ["FAKE_CLAUDE_SCENARIO", "FAKE_CLAUDE_LOG"],
      maxParallel: 2,
      ...config,
    }),
  );
  mustGit(git, ["add", "-A"], root);
  mustGit(git, ["commit", "-q", "-m", "init"], root);

  const bin = join(dir, "bin", "claude.mjs");
  mkdirSync(dirname(bin));
  writeFileSync(bin, `#!/usr/bin/env node\nimport ${JSON.stringify(pathToFileURL(FAKE_CLAUDE).href)};\n`);
  chmodSync(bin, 0o755);
  const scenarioFile = join(dir, "scenario.json");
  const logFile = join(dir, "fake-claude.log");

  const calls = (): FakeCall[] =>
    existsSync(logFile)
      ? readFileSync(logFile, "utf8")
          .split("\n")
          .filter((l) => l !== "")
          .map((l) => JSON.parse(l) as FakeCall)
      : [];

  return {
    dir,
    root,
    home,
    claudeHome,
    bin,
    scenarioFile,
    logFile,
    git,
    scenario: (s) => writeFileSync(scenarioFile, JSON.stringify(s)),
    lane: (spec) => {
      const laneDir = join(root, ".arbab", "runs", spec.name);
      mkdirSync(laneDir, { recursive: true });
      writeFileSync(join(laneDir, "lane.json"), JSON.stringify({ role: "implementer", brief: "lanes/brief.md", ...spec }));
    },
    calls,
    cleanup: () => {
      // Never leave a fake worker or its child behind, whatever the test did.
      for (const call of calls()) {
        for (const pid of [call.pid, call.childPid]) {
          if (pid !== null && isAlive(pid)) {
            try {
              process.kill(pid, "SIGKILL");
            } catch {
              // already gone
            }
          }
        }
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * A clock that runs at real speed plus an offset. A sleep of a second or more (holds, waiting for a reset) moves the
 * offset instead of waiting; shorter sleeps (ticks) wait for real and then add `boostMs`, so a test can make the
 * watcher's minutes pass in milliseconds.
 */
export function virtualTime(startMs: number, boostMs = 0): { clock: Clock; sleep: (ms: number) => Promise<void> } {
  const realStart = Date.now();
  let offset = 0;
  return {
    clock: { now: () => startMs + (Date.now() - realStart) + offset },
    sleep: async (ms) => {
      if (ms >= 1_000) {
        offset += ms;
        await new Promise((done) => setImmediate(done));
        return;
      }
      await new Promise((done) => setTimeout(done, ms));
      offset += boostMs;
    },
  };
}

/**
 * A ps stand-in (ps is refused inside a worker's sandbox): the fake workers and their children from the log, as ps
 * would show them. Only living processes are listed, and a child whose fake has exited is under init.
 */
export function fakePs(project: TestProject): () => string {
  return () =>
    project
      .calls()
      .flatMap((c) => {
        const rows = isAlive(c.pid) ? [`${c.pid} ${c.ppid} ${c.pid}`] : [];
        if (c.childPid !== null && isAlive(c.childPid)) {
          const parent = isAlive(c.pid) ? c.pid : 1;
          rows.push(`${c.childPid} ${parent} ${c.childDetached === false ? c.pid : c.childPid}`);
        }
        return rows;
      })
      .join("\n");
}

export function testDeps(project: TestProject, overrides: Partial<ShepherdDeps> = {}, boostMs = 0): ShepherdDeps {
  const time = virtualTime((FIXTURE_RESET_SEC - 3600) * 1000, boostMs);
  return {
    home: project.home,
    claudeHome: project.claudeHome,
    clock: time.clock,
    sleep: time.sleep,
    random: () => 0.5,
    hostEnv: {
      HOME: project.dir,
      USER: "test",
      FAKE_CLAUDE_SCENARIO: project.scenarioFile,
      FAKE_CLAUDE_LOG: project.logFile,
      HOST_ONLY_SECRET: "must-not-reach-the-worker",
    },
    nodeDir: dirname(process.execPath),
    pnpmDir: undefined,
    git: project.git,
    runCommand: runArgv,
    spawnImpl: spawn,
    readPs: fakePs(project),
    signal: sendSignal,
    alive: isAlive,
    probePort: () => true,
    explicitClaude: project.bin,
    pathEnv: "",
    run: runVersion,
    exists: pathExists,
    realpath,
    tickMs: 20,
    holdPollMs: 60_000,
    slotPollMs: 15_000,
    reapGraceMs: 200,
    ...overrides,
  };
}

/** Polls `check` until it returns a value other than undefined, or fails after `timeoutMs`. */
export async function until<T>(check: () => T | undefined, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((done) => setTimeout(done, 10));
  }
}
