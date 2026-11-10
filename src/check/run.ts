// One arbab-check run, DESIGN.md §22 steps 1–8: read the env, register, wait while the machine is full, take a share
// of the CPUs, run the check, log it, and print a summary short enough that a worker never re-runs a suite to read it.
import { spawn as nodeSpawn } from "node:child_process";
import { appendFileSync, statSync } from "node:fs";
import { constants } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { CHECKS_ENV } from "../types";
import { formatFailureLine, isCheckName, readChecksEnv } from "./command";
import { parseFailures, stripAnsi } from "./digest";
import { nodeRegistryFs, register, registryDir, running, unregister, type CheckEntry, type RegistryFs } from "./registry";

export const POLL_MS = 2000;
const TAIL_KEEP = 200;
const TAIL_PASS = 15;
const TAIL_FAIL = 60;
const MAX_FAILURES = 30;

export interface CheckFs extends RegistryFs {
  isDir(path: string): boolean;
  append(path: string, data: string): void;
}

/** What runCheck needs of a child: a way to signal it. Output and the end come through the handlers. */
export interface CheckChild {
  kill(signal: NodeJS.Signals): void;
}

export interface CheckHandlers {
  output(text: string): void;
  /** The child could not be started. */
  error(err: Error): void;
  exit(code: number | null, signal: NodeJS.Signals | null): void;
}

export type CheckSpawn = (
  command: string,
  args: string[],
  options: { cwd: string; env: Record<string, string | undefined> },
  handlers: CheckHandlers,
) => CheckChild;

export interface CheckRunDeps {
  env: Record<string, string | undefined>;
  cwd: string;
  tmpdir: string;
  pid: number;
  spawn: CheckSpawn;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  fs: CheckFs;
  probe: (pid: number) => "alive" | "gone";
  out: (text: string) => void;
  err: (text: string) => void;
  /** Calls the handler on SIGINT and SIGTERM until the returned function is called. */
  onSignal: (handler: (signal: NodeJS.Signals) => void) => () => void;
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The configured names, for the usage line; best effort, since the env may be what is wrong. */
function configuredNames(env: Record<string, string | undefined>): string {
  try {
    const raw: unknown = JSON.parse(env[CHECKS_ENV] ?? "");
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      const names = Object.keys(raw).filter(isCheckName);
      if (names.length > 0) return names.join(", ");
    }
  } catch {
    // Not JSON: no names to list.
  }
  return "none";
}

export function signalExitCode(signal: NodeJS.Signals): number {
  const n = (constants.signals as Record<string, number | undefined>)[signal];
  return 128 + (n ?? 0);
}

/** `<cwd>/.arbab-tmp/checks/<name>-<n>.log`, n one more than the highest there, or `<tmpdir>/arbab-check-<name>-<pid>.log`. */
function createLog(name: string, deps: CheckRunDeps): string {
  const scratch = join(deps.cwd, ".arbab-tmp");
  if (!deps.fs.isDir(scratch)) {
    const path = join(deps.tmpdir, `arbab-check-${name}-${deps.pid}.log`);
    deps.fs.remove(path);
    if (!deps.fs.writeExclusive(path, "")) throw new Error(`${path} exists`);
    return path;
  }
  const dir = join(scratch, "checks");
  deps.fs.mkdirp(dir);
  const pattern = new RegExp(`^${name}-(\\d+)\\.log$`);
  let n = 0;
  for (const file of deps.fs.readDir(dir)) {
    const match = pattern.exec(file);
    if (match !== null) n = Math.max(n, Number(match[1]));
  }
  // Another run of the same check may take the number first.
  for (let tries = 0; tries < 100; tries++) {
    n += 1;
    const path = join(dir, `${name}-${n}.log`);
    if (deps.fs.writeExclusive(path, "")) return path;
  }
  throw new Error(`no free log number in ${dir}`);
}

/** The last TAIL_KEEP lines of a stream of chunks. */
class Tail {
  private lines: string[] = [];
  private partial = "";

  push(text: string): void {
    const parts = (this.partial + text).split("\n");
    this.partial = parts.pop() ?? "";
    for (const line of parts) this.lines.push(line.replace(/\r$/, ""));
    if (this.lines.length > TAIL_KEEP) this.lines.splice(0, this.lines.length - TAIL_KEEP);
  }

  last(n: number): string[] {
    const all = this.partial === "" ? this.lines : [...this.lines, this.partial.replace(/\r$/, "")];
    return all.slice(Math.max(0, all.length - n));
  }
}

/** Runs `node arbab-check.mjs <name> [args…]`'s logic; resolves to the exit code the script exits with. */
export async function runCheck(args: string[], deps: CheckRunDeps): Promise<number> {
  // 1. Read the env.
  let checks: Record<string, string[]>;
  let policy: { cpus: number; concurrent: number; waitSec: number };
  try {
    ({ checks, policy } = readChecksEnv(deps.env));
  } catch (err) {
    deps.err(`arbab-check: ${message(err)}; configured checks: ${configuredNames(deps.env)}\n`);
    return 2;
  }
  const [name, ...extra] = args;
  const names = Object.keys(checks).join(", ") || "none";
  if (name === undefined || name === "") {
    deps.err(`arbab-check: usage: node arbab-check.mjs <name> [args…]; configured checks: ${names}\n`);
    return 2;
  }
  const argv = isCheckName(name) && Object.hasOwn(checks, name) ? checks[name] : undefined;
  if (argv === undefined) {
    deps.err(`arbab-check: unknown check ${JSON.stringify(name)}; configured checks: ${names}\n`);
    return 2;
  }

  let pendingSignal: NodeJS.Signals | null = null;
  let child: CheckChild | null = null;
  const stopSignals = deps.onSignal((signal) => {
    if (child !== null) child.kill(signal);
    else pendingSignal = signal;
  });

  // 2. Register.
  const dir = registryDir(deps.tmpdir);
  let registered = false;
  try {
    const entry: CheckEntry = { pid: deps.pid, name, cwd: deps.cwd, startedAt: new Date(deps.now()).toISOString(), cpus: policy.cpus };
    register(dir, entry, deps.fs);
    registered = true;
  } catch (err) {
    deps.err(`arbab-check: the registry ${dir} is unusable (${message(err)}); running without waiting\n`);
  }

  try {
    // 3. Count the others; 4. wait while the machine is full.
    let usable = registered;
    const count = (): number => {
      if (!usable) return 0;
      try {
        return running(dir, deps.pid, deps.fs, deps.probe).length;
      } catch (err) {
        usable = false;
        deps.err(`arbab-check: the registry ${dir} is unusable (${message(err)}); running without waiting\n`);
        return 0;
      }
    };
    let others = count();
    if (others >= policy.concurrent) {
      deps.out(`arbab-check: waiting for one of ${policy.concurrent} places (${others} checks running)\n`);
      const deadline = deps.now() + policy.waitSec * 1000;
      while (others >= policy.concurrent && pendingSignal === null) {
        const left = deadline - deps.now();
        if (left <= 0) break;
        await deps.sleep(Math.min(POLL_MS, left));
        others = count();
      }
    }
    if (pendingSignal !== null) {
      deps.err(`arbab-check: ${pendingSignal} before ${name} started\n`);
      return signalExitCode(pendingSignal);
    }

    // 5. Take a share.
    const share = Math.max(1, Math.floor((policy.cpus - 1) / (others + 1)));
    const command = [...argv.map((a) => a.split("{cpus}").join(String(share))), ...extra];

    // 7. The log, created first so the summary can always name it.
    let log: string | null = null;
    try {
      log = createLog(name, deps);
    } catch (err) {
      deps.err(`arbab-check: cannot create a log (${message(err)}); the output is not kept\n`);
    }
    let logBroken = false;
    const tail = new Tail();

    // 6. Run.
    const started = deps.now();
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null } | { error: Error }>((resolve) => {
      try {
        child = deps.spawn(
          command[0] ?? "",
          command.slice(1),
          { cwd: deps.cwd, env: { ...deps.env, ARBAB_CHECK_CPUS: String(share), VITEST_MAX_WORKERS: String(share) } },
          {
            output: (text) => {
              tail.push(text);
              if (log === null || logBroken) return;
              try {
                deps.fs.append(log, text);
              } catch (err) {
                logBroken = true;
                deps.err(`arbab-check: cannot write ${log} (${message(err)})\n`);
              }
            },
            error: (error) => resolve({ error }),
            exit: (code, signal) => resolve({ code, signal }),
          },
        );
      } catch (err) {
        resolve({ error: err instanceof Error ? err : new Error(String(err)) });
      }
    });
    child = null;

    if ("error" in result) {
      deps.err(`arbab-check: cannot run ${command[0] ?? ""}: ${result.error.message}\n`);
      if (log !== null) {
        try {
          deps.fs.remove(log);
        } catch {
          // An empty log left behind is harmless.
        }
      }
      return 127;
    }

    const code = result.signal !== null ? signalExitCode(result.signal) : (result.code ?? 1);

    // 8. Print a summary.
    const seconds = ((deps.now() - started) / 1000).toFixed(1);
    let where = "none";
    if (log !== null) {
      const rel = relative(deps.cwd, log);
      where = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel) ? rel : log;
    }
    const lines = [`arbab-check ${name}: exit ${code} after ${seconds}s on ${share} CPUs; log ${where}`];
    if (code !== 0) {
      let full: string | null = null;
      if (log !== null && !logBroken) {
        try {
          full = deps.fs.readFile(log);
        } catch {
          // Parse what the tail holds.
        }
      }
      for (const failure of parseFailures(full ?? tail.last(TAIL_KEEP).join("\n"), MAX_FAILURES)) {
        lines.push(formatFailureLine(failure));
      }
    }
    const last = tail.last(code === 0 ? TAIL_PASS : TAIL_FAIL).map(stripAnsi);
    lines.push(`--- last ${last.length} lines ---`, ...last);
    deps.out(lines.join("\n") + "\n");
    return code;
  } finally {
    stopSignals();
    if (registered) {
      try {
        unregister(dir, deps.pid, deps.fs);
      } catch {
        // A stale entry is removed by the next check that sees its pid gone.
      }
    }
  }
}

/** The check's file effects on the real file system. */
export const nodeCheckFs: CheckFs = {
  ...nodeRegistryFs,
  isDir: (path) => {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
  append: (path, data) => {
    appendFileSync(path, data);
  },
};

/** CheckSpawn on node's spawn: no shell, stdin closed, stdout and stderr piped as UTF-8 text. */
export function nodeCheckSpawn(spawn: typeof nodeSpawn = nodeSpawn): CheckSpawn {
  return (command, args, options, handlers) => {
    const proc = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"], shell: false });
    let settled = false;
    proc.stdout?.setEncoding("utf8");
    proc.stderr?.setEncoding("utf8");
    proc.stdout?.on("data", (text: string) => handlers.output(text));
    proc.stderr?.on("data", (text: string) => handlers.output(text));
    proc.on("error", (err) => {
      // After a successful start, an error is a failed kill; the close event still ends the run.
      if (settled || proc.pid !== undefined) return;
      settled = true;
      handlers.error(err);
    });
    proc.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      handlers.exit(code, signal);
    });
    return {
      kill: (signal) => {
        proc.kill(signal);
      },
    };
  };
}
