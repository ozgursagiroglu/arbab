// One arbab-check run, DESIGN.md §22 steps 1–8: read the env, register, wait while the machine is full, take a share
// of the CPUs, run the check, log it, and print a summary short enough that a worker never re-runs a suite to read it.
import { spawn as nodeSpawn } from "node:child_process";
import { appendFileSync, statSync } from "node:fs";
import { constants } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { CHECKS_ENV, type CheckFailure } from "../types";
import { formatFailureLine, isCheckName, parseFailureLine, readChecksEnv } from "./command";
import { parseFailures, stripAnsi } from "./digest";
import {
  liveEntries,
  nodeRegistryFs,
  register,
  registeredBefore,
  registryDir,
  unregister,
  update,
  type CheckEntry,
  type RegistryFs,
} from "./registry";

export const POLL_MS = 2000;
const TAIL_KEEP = 200;
const TAIL_PASS = 15;
const TAIL_FAIL = 60;
const MAX_FAILURES = 30;
// Parsed beyond what is printed, so the more-failures line can count them.
const COUNT_FAILURES = 1000;

/**
 * All arbab-check prints to stdout, under the smallest fence.bashOutputMaxChars (4000): longer output is saved where
 * the worker cannot read it.
 */
export const STDOUT_MAX = 3800;
/** The header names the log; a path this long is not one anybody can use, and must not crowd out the rest. */
const HEADER_MAX = 1000;
const FAILURES_CHARS = 2000;
const FAILURE_LINE_MAX = 200;
const TAIL_LINE_MAX = 240;

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

/**
 * A failure line of at most FAILURE_LINE_MAX characters that still reads back with parseFailureLine: when it is too
 * long, the file and the test give way first, then the message takes what is left.
 */
export function shortFailureLine(failure: CheckFailure): string {
  const line = formatFailureLine(failure);
  if (line.length <= FAILURE_LINE_MAX) return line;
  const clean = parseFailureLine(line) ?? { file: null, test: null, message: "" };
  const file = clean.file?.slice(0, 70) ?? null;
  const test = clean.test?.slice(0, 50) ?? null;
  const head = formatFailureLine({ file, test, message: "" });
  const message = clean.message.slice(0, Math.max(0, FAILURE_LINE_MAX - head.length));
  return formatFailureLine({ file, test, message }).slice(0, FAILURE_LINE_MAX);
}

/**
 * The summary, at most `budget` characters with its last newline (DESIGN.md §22): the header; failure lines while they
 * fit in FAILURES_CHARS; a count of those left out; then the newest tail lines that fit in what is left.
 */
export function summarize(header: string, failures: CheckFailure[], tail: string[], budget: number): string {
  const lines: string[] = [];
  let used = 0;
  const add = (line: string): void => {
    lines.push(line);
    used += line.length + 1;
  };
  add(header.slice(0, HEADER_MAX));

  let failureChars = 0;
  let shown = 0;
  for (const failure of failures.slice(0, MAX_FAILURES)) {
    const line = shortFailureLine(failure);
    if (failureChars + line.length + 1 > FAILURES_CHARS) break;
    failureChars += line.length + 1;
    add(line);
    shown += 1;
  }
  if (shown < failures.length) add(`arbab-check: ${failures.length - shown} more failures in the log`);

  // The marker's count is known only at the end; leave room for its widest form.
  const markerRoom = `--- last ${tail.length} lines ---`.length + 1;
  let room = budget - used - markerRoom;
  const kept: string[] = [];
  for (let i = tail.length - 1; i >= 0; i--) {
    const line = (tail[i] ?? "").slice(0, TAIL_LINE_MAX);
    if (line.length + 1 > room) break;
    room -= line.length + 1;
    kept.unshift(line);
  }
  add(`--- last ${kept.length} lines ---`);
  for (const line of kept) add(line);
  return lines.join("\n") + "\n";
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

  // Every character on stdout counts against STDOUT_MAX, the waiting line too.
  let printed = 0;
  const out = (text: string): void => {
    printed += text.length;
    deps.out(text);
  };

  // 2. Register, as waiting.
  const dir = registryDir(deps.tmpdir);
  const entry: CheckEntry = { pid: deps.pid, name, cwd: deps.cwd, startedAt: new Date(deps.now()).toISOString(), cpus: policy.cpus, state: "waiting" };
  let registered = false;
  try {
    register(dir, entry, deps.fs);
    registered = true;
  } catch (err) {
    deps.err(`arbab-check: the registry ${dir} is unusable (${message(err)}); running without waiting\n`);
  }

  try {
    // 3. Count the running checks and the waiters registered before this one; 4. wait while they fill the places.
    let usable = registered;
    const count = (): { running: number; ahead: number } => {
      if (!usable) return { running: 0, ahead: 0 };
      try {
        const others = liveEntries(dir, deps.pid, deps.fs, deps.probe, deps.now());
        return {
          running: others.filter((e) => e.state === "running").length,
          ahead: others.filter((e) => e.state === "waiting" && registeredBefore(e, entry)).length,
        };
      } catch (err) {
        usable = false;
        deps.err(`arbab-check: the registry ${dir} is unusable (${message(err)}); running without waiting\n`);
        return { running: 0, ahead: 0 };
      }
    };
    const full = (c: { running: number; ahead: number }): boolean => c.running + c.ahead >= policy.concurrent;
    let seen = count();
    if (full(seen)) {
      const ahead = seen.ahead > 0 ? `, ${seen.ahead} waiting before this one` : "";
      out(`arbab-check: waiting for one of ${policy.concurrent} places (${seen.running} checks running${ahead})\n`);
      const deadline = deps.now() + policy.waitSec * 1000;
      while (full(seen) && pendingSignal === null) {
        const left = deadline - deps.now();
        if (left <= 0) break;
        await deps.sleep(Math.min(POLL_MS, left));
        seen = count();
      }
    }
    if (pendingSignal !== null) {
      deps.err(`arbab-check: ${pendingSignal} before ${name} started\n`);
      return signalExitCode(pendingSignal);
    }

    // 5. Take a share, and say so in the entry.
    const share = Math.max(1, Math.floor((policy.cpus - 1) / (seen.running + 1)));
    if (usable) {
      try {
        update(dir, { ...entry, state: "running", share }, deps.fs);
      } catch (err) {
        // Still counted, as a waiter ahead of the later ones: it takes a place either way.
        deps.err(`arbab-check: cannot mark ${name} running in ${dir} (${message(err)})\n`);
      }
    }
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
    const header = `arbab-check ${name}: exit ${code} after ${seconds}s on ${share} CPUs; log ${where}`;
    let failures: CheckFailure[] = [];
    if (code !== 0) {
      let whole: string | null = null;
      if (log !== null && !logBroken) {
        try {
          whole = deps.fs.readFile(log);
        } catch {
          // Parse what the tail holds.
        }
      }
      failures = parseFailures(whole ?? tail.last(TAIL_KEEP).join("\n"), COUNT_FAILURES);
    }
    const last = tail.last(code === 0 ? TAIL_PASS : TAIL_FAIL).map(stripAnsi);
    out(summarize(header, failures, last, STDOUT_MAX - printed));
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
