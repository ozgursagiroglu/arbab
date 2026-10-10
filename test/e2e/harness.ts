// End-to-end scaffolding: the real bundle, built into a temporary directory, run with node against a temporary
// project, a temporary HOME (so ~/.arbab and ~/.claude are temporary) and the fake claude as the binary.
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { bundleOptions, packageVersion } from "../../scripts/build.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const FAKE_CLAUDE = join(REPO, "test", "fake-claude", "fake-claude.mjs");
export const fakeFixture = (name: string): string => join(REPO, "test", "fake-claude", "fixtures", `${name}.jsonl`);
export const streamFixture = (name: string): string => join(REPO, "test", "fixtures", "stream", `${name}.jsonl`);

/** Builds dist/arbab.mjs into a temporary directory with scripts/build.mjs's options (the version compiled in). */
export async function buildBundle(): Promise<{ bundle: string; dispose(): void }> {
  const dir = mkdtempSync(join(tmpdir(), "arbab-e2e-bundle-"));
  const bundle = join(dir, "dist", "arbab.mjs");
  await build({ ...bundleOptions({ version: packageVersion(REPO), outfile: bundle }), absWorkingDir: REPO });
  return { bundle, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

export interface Scenario {
  fixture: string;
  resumeFixture?: string;
  lineDelayMs?: number;
  touch?: string;
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
  childDetached: boolean | null;
  stdinBytes: number;
}

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export const BRIEF = "# Demo\n\n## Task\n\nAdd a greeting to `src/a.ts`.\n\n## Scope\n\n`src/a.ts`\n\n## Acceptance\n\n- The greeting is there.\n";

export interface E2eProject {
  dir: string;
  root: string;
  home: string;
  runsRoot: string;
  worktreeRoot: string;
  scenarioFile: string;
  logFile: string;
  env: NodeJS.ProcessEnv;
  scenario(s: Scenario): void;
  /** Writes lanes/<name>.json (with `fields` added) and lanes/<name>.md, and commits them. */
  lane(name: string, brief?: string, fields?: Record<string, unknown>): string;
  /** Runs `node <bundle> …args` in the project root, without a shell. */
  cli(...args: string[]): Promise<CliResult>;
  calls(): FakeCall[];
  laneDir(lane: string): string;
  attemptDir(lane: string, n: number): string;
  json<T = Record<string, unknown>>(path: string): T;
  git(args: string[], cwd?: string): string;
  dispose(): void;
}

const GIT_IDENTITY = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

export function makeE2eProject(bundle: string): E2eProject {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "arbab-e2e-")));
  const root = join(dir, "repo");
  const home = join(dir, "home");
  const scenarioFile = join(dir, "scenario.json");
  const logFile = join(dir, "fake-claude.log");
  mkdirSync(root);
  mkdirSync(home);

  // Built from scratch: the host's own Claude Code and editor markers are set on purpose, to prove the worker never
  // sees them.
  const env: NodeJS.ProcessEnv = {
    PATH: process.env["PATH"] ?? "",
    HOME: home,
    USER: "test",
    LANG: "C",
    ...(process.env["TMPDIR"] === undefined ? {} : { TMPDIR: process.env["TMPDIR"] }),
    ...GIT_IDENTITY,
    ARBAB_CLAUDE: FAKE_CLAUDE,
    FAKE_CLAUDE_SCENARIO: scenarioFile,
    FAKE_CLAUDE_LOG: logFile,
    CLAUDE_CODE_ENTRYPOINT: "claude-vscode",
    VSCODE_PID: "1",
  };

  const git = (args: string[], cwd = root): string => execFileSync("git", args, { cwd, env, encoding: "utf8" });
  git(["init", "-q", "-b", "main", root], dir);
  writeFileSync(
    join(root, "arbab.config.json"),
    JSON.stringify(
      {
        baseBranch: "main",
        commands: { implementer: ["pnpm test"] },
        passEnv: ["FAKE_CLAUDE_SCENARIO", "FAKE_CLAUDE_LOG"],
      },
      null,
      2,
    ),
  );
  writeFileSync(join(root, "README.md"), "# e2e\n");
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "init"]);

  const runsRoot = join(root, ".arbab", "runs");
  const laneDir = (lane: string): string => join(runsRoot, lane);
  const calls = (): FakeCall[] =>
    existsSync(logFile)
      ? readFileSync(logFile, "utf8")
          .split("\n")
          .filter((l) => l !== "")
          .map((l) => JSON.parse(l) as FakeCall)
      : [];

  const cli = (...args: string[]): Promise<CliResult> =>
    new Promise((done) => {
      execFile(process.execPath, [bundle, ...args], { cwd: root, env, encoding: "utf8", timeout: 180_000 }, (err, stdout, stderr) => {
        const code = err === null ? 0 : typeof err.code === "number" ? err.code : -1;
        done({ code, stdout, stderr });
      });
    });

  const kill = (target: number): void => {
    try {
      process.kill(target, "SIGKILL");
    } catch {
      // Already gone.
    }
  };

  return {
    dir,
    root,
    home,
    runsRoot,
    worktreeRoot: join(root, ".arbab", "worktrees"),
    scenarioFile,
    logFile,
    env,
    scenario: (s) => writeFileSync(scenarioFile, JSON.stringify(s)),
    lane: (name, brief = BRIEF, fields = {}) => {
      mkdirSync(join(root, "lanes"), { recursive: true });
      writeFileSync(join(root, "lanes", `${name}.md`), brief);
      writeFileSync(
        join(root, "lanes", `${name}.json`),
        JSON.stringify({ name, role: "implementer", brief: `lanes/${name}.md`, ...fields }),
      );
      git(["add", "-A"]);
      git(["commit", "-q", "-m", `lane ${name}`]);
      return `lanes/${name}.json`;
    },
    cli,
    calls,
    laneDir,
    attemptDir: (lane, n) => join(laneDir(lane), `attempt-${n}`),
    json: <T>(path: string) => JSON.parse(readFileSync(path, "utf8")) as T,
    git,
    dispose: () => {
      // Never leave a shepherd, a fake worker or its child behind, whatever the test did.
      for (const lane of existsSync(runsRoot) ? readdirSync(runsRoot) : []) {
        try {
          kill((JSON.parse(readFileSync(join(laneDir(lane), "shepherd.json"), "utf8")) as { pid: number }).pid);
        } catch {
          // No shepherd recorded.
        }
      }
      for (const call of calls()) {
        kill(-call.pid);
        kill(call.pid);
        if (call.childPid !== null) kill(call.childPid);
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Polls `check` until it returns a value other than undefined, or fails after `timeoutMs`. */
export async function until<T>(check: () => T | undefined, timeoutMs = 15_000, what = "condition"): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let value: T | undefined;
    try {
      value = check();
    } catch {
      value = undefined;
    }
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`${what} not met within ${timeoutMs} ms`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

/** True when a process or (negative target) a process group exists. */
export function exists(target: number): boolean {
  try {
    process.kill(target, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Whether `ps` works here; a sandbox refuses it, and then `arbab stop` refuses to signal. */
export function psWorks(): boolean {
  try {
    return execFileSync("ps", ["-p", String(process.pid), "-o", "command="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() !== "";
  } catch {
    return false;
  }
}
