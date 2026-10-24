// Test helpers for src/commands: a temporary project (git repository, config, lane, brief) and an injected context.
// Not part of the bundle; only *.test.ts files import it.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAttempt, runPaths, writeState } from "../registry";
import { makeGitRunner, runArgv, type GitRunner } from "../run";
import type { ShepherdDeps, ShepherdMode } from "../shepherd";
import type { AttemptExit, AttemptStarted, AttemptSummary, EndState, LaneState, VerifyRecord } from "../types";
import type { CommandContext } from "./context";

export const NOW_MS = Date.parse("2026-10-09T12:00:00.000Z");

export const DEFAULT_CONFIG = {
  baseBranch: "main",
  commands: { implementer: ["pnpm test", "pnpm typecheck"] },
  preflight: { steps: [["pnpm", "typecheck"]] },
};

export const DEFAULT_BRIEF = `# Demo

## Task

Add a greeting to \`src/hello.ts\`.

## Scope

\`src/hello.ts\`

## Acceptance

- \`pnpm test\` exits 0.
`;

// Isolated from the user's global and system git config (hooks paths, signing, identity).
export function isolatedGit(home: string): GitRunner {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"]) delete env[key];
  return makeGitRunner({
    ...env,
    HOME: home,
    XDG_CONFIG_HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(home, "gitconfig"),
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  });
}

export interface TestProject {
  dir: string;
  root: string;
  runsRoot: string;
  worktreeRoot: string;
  home: string;
  claudeHome: string;
  git: GitRunner;
  ctx: CommandContext;
  out: string[];
  err: string[];
  spawned: Array<{ root: string; lane: string; mode: ShepherdMode }>;
  /** The project roots ctx.spawnSweep was asked to sweep; nothing is started. */
  sweeps: string[];
  /** What ctx.freeSpace returns: 500 GB unless a test changes it. */
  free: { bytes: number | null };
  signals: Array<{ target: number; sig: NodeJS.Signals }>;
  /** The URLs ctx.openUrl was asked to open. */
  opened: string[];
  /** The notifications ctx.notify was asked to show; each resolves `notifyResult.shown`. */
  notified: Array<{ title: string; body: string }>;
  notifyResult: { shown: boolean };
  /** What ctx.readStdin returns; each read is counted in `reads`. */
  stdin: { text: string; reads: number };
  alive: Set<number>;
  commands: Map<number, string>;
  now: { ms: number };
  stdout(): string;
  stderr(): string;
  /** Runs git in the repository and throws on failure. */
  ok(args: string[], cwd?: string): string;
  write(rel: string, text: string): void;
  dispose(): void;
}

export interface ProjectOptions {
  config?: unknown;
  /** Lane files to write, by project-relative path; values are JSON. */
  lanes?: Record<string, unknown>;
  files?: Record<string, string>;
}

export const SHEPHERD_PID = 4242;
/** The pid of the injected CLI process; not in `alive` unless a test adds it. */
export const CLI_PID = 3131;

export function makeProject(opts: ProjectOptions = {}): TestProject {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "arbab-cmd-")));
  const root = join(dir, "repo");
  const home = join(dir, "arbab-home");
  const claudeHome = join(dir, "claude-home");
  mkdirSync(root);
  const git = isolatedGit(dir);
  const ok = (args: string[], cwd = root): string => {
    const r = git(args, cwd);
    if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout;
  };
  const write = (rel: string, text: string): void => {
    const path = join(root, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  };

  ok(["init", "-q", "-b", "main", root], dir);
  write("arbab.config.json", JSON.stringify(opts.config ?? DEFAULT_CONFIG, null, 2));
  write("lanes/demo.md", DEFAULT_BRIEF);
  write("lanes/demo.json", JSON.stringify({ name: "demo", role: "implementer", brief: "lanes/demo.md" }));
  for (const [rel, lane] of Object.entries(opts.lanes ?? {})) write(rel, JSON.stringify(lane));
  for (const [rel, text] of Object.entries(opts.files ?? {})) write(rel, text);
  ok(["add", "-A"]);
  ok(["commit", "-q", "-m", "init"]);

  const out: string[] = [];
  const err: string[] = [];
  const spawned: TestProject["spawned"] = [];
  const sweeps: string[] = [];
  const free: TestProject["free"] = { bytes: 500e9 };
  const signals: TestProject["signals"] = [];
  const opened: string[] = [];
  const notified: TestProject["notified"] = [];
  const notifyResult = { shown: true };
  const stdin = { text: "", reads: 0 };
  const alive = new Set<number>();
  const commands = new Map<number, string>();
  const now = { ms: NOW_MS };
  let nextPid = SHEPHERD_PID;

  const ctx: CommandContext = {
    cwd: root,
    pid: CLI_PID,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    hostEnv: {},
    home,
    claudeHome,
    clock: { now: () => now.ms },
    sleep: async (ms) => {
      now.ms += ms;
    },
    alive: (pid) => alive.has(pid),
    signal: (target, sig) => {
      signals.push({ target, sig });
      return true;
    },
    spawnShepherd: (r, lane, mode) => {
      spawned.push({ root: r, lane, mode });
      const pid = nextPid++;
      alive.add(pid);
      return pid;
    },
    spawnSweep: (r) => {
      sweeps.push(r);
      return 0;
    },
    freeSpace: () => free.bytes,
    shepherdDeps: () => fakeDeps(home, claudeHome),
    runShepherd: async () => "success",
    trapSignals: () => () => undefined,
    git,
    runCommand: runArgv,
    processCommand: (pid) => commands.get(pid) ?? null,
    platform: "darwin",
    nodeVersion: "20.11.0",
    interactive: true,
    version: "9.9.9",
    openUrl: async (url) => {
      opened.push(url);
      return true;
    },
    // Not created: a test that needs the runner file on disk writes it.
    scriptPath: join(dir, "plugin", "dist", "arbab.mjs"),
    readStdin: async () => {
      stdin.reads++;
      return stdin.text;
    },
    notify: async (title, body) => {
      notified.push({ title, body });
      return notifyResult.shown;
    },
  };

  return {
    dir,
    root,
    runsRoot: join(root, ".arbab", "runs"),
    worktreeRoot: join(root, ".arbab", "worktrees"),
    home,
    claudeHome,
    git,
    ctx,
    out,
    err,
    spawned,
    sweeps,
    free,
    signals,
    opened,
    notified,
    notifyResult,
    stdin,
    alive,
    commands,
    now,
    stdout: () => out.join(""),
    stderr: () => err.join(""),
    ok,
    write,
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** Deps whose binary lookup finds a fake claude 2.1.295 at /opt/claude/bin/claude and a sandbox-exec. */
export function fakeDeps(home: string, claudeHome: string, over: Partial<ShepherdDeps> = {}): ShepherdDeps {
  const files = new Set(["/opt/claude/bin/claude", "/usr/bin/sandbox-exec", "/usr/bin/bwrap", "/usr/bin/socat"]);
  const deps: Partial<ShepherdDeps> = {
    home,
    claudeHome,
    explicitClaude: null,
    pathEnv: "/opt/claude/bin:/usr/bin",
    run: () => "2.1.295 (Claude Code)\n",
    exists: (p) => files.has(p),
    realpath: (p) => p,
    ...over,
  };
  return deps as ShepherdDeps;
}

export interface LaneRun {
  state: LaneState;
  attempt?: number;
  shepherdPid?: number;
  endState?: EndState;
  started?: Partial<AttemptStarted>;
  exit?: Partial<AttemptExit>;
  summary?: Partial<AttemptSummary>;
  report?: unknown;
  stream?: string;
  stderr?: string;
  lane?: Record<string, unknown>;
  since?: string;
}

/** A verify.json of integration "rel" at `head`, with one gate. */
export function passedVerify(head: string, passed = true): VerifyRecord {
  return {
    name: "rel",
    lane: "rel-verify",
    attempt: 1,
    headSha: head,
    results: [{ kind: "gate", argv: ["pnpm", "test"], command: "pnpm test", exitCode: passed ? 0 : 1 }],
    passed,
    finishedAt: "2026-10-09T12:00:00.000Z",
  };
}

/** A branch off main with one commit writing `file`; returns its sha. The root stays on main. */
export function branchWith(t: TestProject, branch: string, file: string, text: string): string {
  t.ok(["checkout", "-q", "-b", branch, "main"]);
  t.write(file, text);
  // Only the file: run dirs a test wrote are not ignored unless a real shepherd ran.
  t.ok(["add", "--", file]);
  t.ok(["commit", "-q", "-m", `${branch} writes ${file}`]);
  const sha = t.ok(["rev-parse", "HEAD"]).trim();
  t.ok(["checkout", "-q", "main"]);
  return sha;
}

/**
 * A spawnShepherd that leaves, synchronously, what a shepherd would: the lane's branch (from its base, as the
 * worktree would create it), state.json and one attempt's files from `runs[lane]`. A lane without an entry, or whose
 * entry returns null, is left as if its shepherd never wrote anything.
 */
export function simulateShepherds(t: TestProject, runs: Record<string, (pid: number) => LaneRun | null>): void {
  let next = 9000;
  t.ctx.spawnShepherd = (root, lane, mode) => {
    t.spawned.push({ root, lane, mode });
    const pid = next++;
    t.alive.add(pid);
    const spec = JSON.parse(readFileSync(runPaths(t.runsRoot, lane).laneFile, "utf8")) as Record<string, unknown>;
    const branch = `arbab/${lane}`;
    if (t.git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], t.root).code !== 0) {
      t.ok(["branch", branch, typeof spec["base"] === "string" ? spec["base"] : "main"]);
    }
    const run = runs[lane]?.(pid) ?? null;
    if (run !== null) writeLaneRun(t.runsRoot, lane, { ...run, shepherdPid: pid, lane: spec });
    return pid;
  };
}

/** What a shepherd would have left on disk: lane.json, shepherd.json, state.json and one attempt's files. */
export function writeLaneRun(runsRoot: string, name: string, run: LaneRun): number {
  const paths = runPaths(runsRoot, name);
  mkdirSync(paths.laneDir, { recursive: true });
  writeFileSync(paths.laneFile, JSON.stringify(run.lane ?? { name, role: "implementer", brief: "lanes/demo.md" }));
  const pid = run.shepherdPid ?? SHEPHERD_PID;
  writeFileSync(paths.shepherdFile, JSON.stringify({ pid, startedAt: "2026-10-09T11:00:00.000Z" }));
  let attempt = run.attempt ?? 0;
  if (run.attempt === undefined && (run.started || run.exit || run.summary || run.stream !== undefined || run.report !== undefined)) {
    attempt = createAttempt(runsRoot, name).n;
  } else if (attempt > 0) {
    mkdirSync(paths.attemptDir(attempt), { recursive: true });
  }
  if (attempt > 0) {
    const dir = paths.attemptDir(attempt);
    if (run.started) {
      const started: AttemptStarted = {
        lane: name,
        attempt,
        resume: false,
        sessionId: "11111111-2222-3333-4444-555555555555",
        pid: 7000,
        binary: { path: "/opt/claude/bin/claude", version: "2.1.295" },
        cwd: "/nonexistent",
        startedAt: "2026-10-09T11:50:00.000Z",
        args: [],
        envKeys: [],
        leases: [],
        ...run.started,
      };
      writeFileSync(join(dir, "started.json"), JSON.stringify(started));
    }
    if (run.exit) writeFileSync(join(dir, "exit.json"), JSON.stringify(run.exit));
    if (run.summary) writeFileSync(join(dir, "summary.json"), JSON.stringify({ lane: name, attempt, ...run.summary }));
    if (run.report !== undefined) writeFileSync(join(dir, "report.json"), JSON.stringify(run.report));
    if (run.stream !== undefined) writeFileSync(join(dir, "stream.jsonl"), run.stream);
    if (run.stderr !== undefined) writeFileSync(join(dir, "stderr.log"), run.stderr);
  }
  writeState(runsRoot, {
    lane: name,
    state: run.state,
    attempt,
    since: run.since ?? "2026-10-09T11:50:00.000Z",
    shepherdPid: pid,
    ...(run.endState !== undefined && { endState: run.endState }),
  });
  return attempt;
}
