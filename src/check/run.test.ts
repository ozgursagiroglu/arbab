import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseFailureLine } from "./command";
import { register, registryDir, type CheckState } from "./registry";
import {
  nodeCheckFs,
  nodeCheckSpawn,
  runCheck,
  shortFailureLine,
  signalExitCode,
  STDOUT_MAX,
  summarize,
  type CheckFs,
  type CheckHandlers,
  type CheckRunDeps,
} from "./run";

const PID = 4000;
const T0 = Date.parse("2026-11-10T10:00:00.000Z");

let tmp: string;
let cwd: string;
let tdir: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "arbab-"));
  cwd = join(tmp, "work");
  tdir = join(tmp, "t");
  mkdirSync(join(cwd, ".arbab-tmp"), { recursive: true });
  mkdirSync(tdir);
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

interface Spawned {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
}

type Script = (handlers: CheckHandlers, advance: (ms: number) => void) => void;

interface Harness {
  deps: CheckRunDeps;
  spawned: Spawned[];
  kills: NodeJS.Signals[];
  sleeps: number[];
  out: () => string;
  err: () => string;
  signal: (s: NodeJS.Signals) => void;
  disposed: () => boolean;
}

function harness(
  options: {
    checks?: Record<string, string[]>;
    policy?: { cpus: number; concurrent: number; waitSec: number };
    script?: Script;
    alive?: (pid: number, call: number) => boolean;
    fs?: Partial<CheckFs>;
    env?: Record<string, string | undefined>;
    onSleep?: (h: Harness) => void;
  } = {},
): Harness {
  let t = T0;
  let out = "";
  let err = "";
  let signalHandler: ((s: NodeJS.Signals) => void) | null = null;
  let disposed = false;
  let probes = 0;
  const spawned: Spawned[] = [];
  const kills: NodeJS.Signals[] = [];
  const sleeps: number[] = [];
  const checks = options.checks ?? { test: ["vitest", "run"], typecheck: ["tsc", "--noEmit"] };
  const policy = options.policy ?? { cpus: 8, concurrent: 2, waitSec: 120 };
  const script: Script = options.script ?? ((h) => h.exit(0, null));
  const h: Harness = {
    deps: {
      env: options.env ?? { PATH: "/usr/bin", HOME: "/home/someone", ARBAB_CHECKS: JSON.stringify(checks), ARBAB_CHECK_POLICY: JSON.stringify(policy) },
      cwd,
      tmpdir: tdir,
      pid: PID,
      spawn: (command, args, opts, handlers) => {
        spawned.push({ command, args, cwd: opts.cwd, env: opts.env });
        setImmediate(() => script(handlers, (ms) => (t += ms)));
        return {
          kill: (s) => {
            kills.push(s);
            setImmediate(() => handlers.exit(null, s));
          },
        };
      },
      now: () => t,
      sleep: async (ms) => {
        sleeps.push(ms);
        t += ms;
        options.onSleep?.(h);
      },
      fs: { ...nodeCheckFs, ...options.fs },
      probe: (pid) => ((options.alive ?? (() => true))(pid, probes++) ? "alive" : "gone"),
      out: (text) => (out += text),
      err: (text) => (err += text),
      onSignal: (handler) => {
        signalHandler = handler;
        return () => {
          disposed = true;
        };
      },
    },
    spawned,
    kills,
    sleeps,
    out: () => out,
    err: () => err,
    signal: (s) => signalHandler?.(s),
    disposed: () => disposed,
  };
  return h;
}

const lines = (n: number, prefix = "line"): string => Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}\n`).join("");
const registry = (): string[] => (existsSync(registryDir(tdir)) ? readdirSync(registryDir(tdir)) : []);
const other = (pid: number, state: CheckState = "running", startedAt = new Date(T0 - 60_000).toISOString()): void =>
  register(registryDir(tdir), { pid, name: "test", cwd: "/elsewhere", startedAt, cpus: 8, state }, nodeCheckFs);
const others = (...pids: number[]): void => {
  for (const pid of pids) other(pid);
};
const entryOf = (pid: number): unknown => JSON.parse(readFileSync(join(registryDir(tdir), `${pid}.json`), "utf8"));

describe("runCheck: the env and the name", () => {
  it("exits 2 on an unknown name and lists the configured names, without registering", async () => {
    const h = harness();
    expect(await runCheck(["lint"], h.deps)).toBe(2);
    expect(h.err()).toBe('arbab-check: unknown check "lint"; configured checks: test, typecheck\n');
    expect(h.out()).toBe("");
    expect(h.spawned).toEqual([]);
    expect(registry()).toEqual([]);
  });

  it("exits 2 on a missing name or a name that is not a check name", async () => {
    const h = harness();
    expect(await runCheck([], h.deps)).toBe(2);
    expect(h.err()).toContain("usage: node arbab-check.mjs <name> [args…]; configured checks: test, typecheck");
    expect(await runCheck(["../test"], h.deps)).toBe(2);
    expect(await runCheck(["constructor"], h.deps)).toBe(2);
    expect(h.spawned).toEqual([]);
  });

  it("exits 2 when the env is missing or malformed, listing what names it can", async () => {
    const missing = harness({ env: {} });
    expect(await runCheck(["test"], missing.deps)).toBe(2);
    expect(missing.err()).toBe("arbab-check: ARBAB_CHECKS is not set: this lane has no checks; configured checks: none\n");
    const badPolicy = harness({ env: { ARBAB_CHECKS: JSON.stringify({ test: ["vitest"] }), ARBAB_CHECK_POLICY: "{}" } });
    expect(await runCheck(["test"], badPolicy.deps)).toBe(2);
    expect(badPolicy.err()).toMatch(/ARBAB_CHECK_POLICY must be .*; configured checks: test\n$/);
  });
});

describe("runCheck: a run", () => {
  it("runs a passing check: summary, the last 15 lines, exit 0, the log", async () => {
    const h = harness({
      script: (handlers, advance) => {
        handlers.output(lines(10));
        handlers.output(lines(10, "more"));
        advance(1530);
        handlers.exit(0, null);
      },
    });
    expect(await runCheck(["test"], h.deps)).toBe(0);
    const out = h.out().split("\n");
    expect(out[0]).toBe("arbab-check test: exit 0 after 1.5s on 7 CPUs; log .arbab-tmp/checks/test-1.log");
    expect(out[1]).toBe("--- last 15 lines ---");
    expect(out.slice(2, -1)).toEqual([...lines(10).split("\n").slice(5, 10), ...lines(10, "more").split("\n").slice(0, 10)]);
    expect(out).toHaveLength(2 + 15 + 1);
    expect(h.err()).toBe("");
    expect(readFileSync(join(cwd, ".arbab-tmp", "checks", "test-1.log"), "utf8")).toBe(lines(10) + lines(10, "more"));
    expect(h.spawned).toEqual([{ command: "vitest", args: ["run"], cwd, env: expect.objectContaining({ PATH: "/usr/bin" }) as unknown }]);
  });

  it("runs a failing check: failure lines from the whole output, the last 60 lines, the child's exit code", async () => {
    const failing = " FAIL  src/a.test.ts > sum > adds\nAssertionError: expected 3 to be 4\n";
    const h = harness({
      script: (handlers) => {
        // The failure is far above the tail: it is read from the log.
        handlers.output("\u001b[31m" + failing + "\u001b[39m");
        handlers.output(lines(300));
        handlers.output("src/b.ts(1,2): error TS1005: ';' expected.\nlast line without newline");
        handlers.exit(3, null);
      },
    });
    expect(await runCheck(["test"], h.deps)).toBe(3);
    const out = h.out().split("\n");
    expect(out[0]).toMatch(/^arbab-check test: exit 3 after 0\.0s on 7 CPUs; log \.arbab-tmp\/checks\/test-1\.log$/);
    expect(out[1]).toBe("arbab-check failure: src/a.test.ts > sum > adds :: AssertionError: expected 3 to be 4");
    expect(out[2]).toBe("arbab-check failure: src/b.ts :: TS1005: ';' expected.");
    expect(out[3]).toBe("--- last 60 lines ---");
    expect(out.slice(4, -1)).toHaveLength(60);
    expect(out.at(-2)).toBe("last line without newline");
    expect(out.at(-3)).toBe("src/b.ts(1,2): error TS1005: ';' expected.");
  });

  it("prints at most 30 failure lines and counts the others", async () => {
    const many = Array.from({ length: 40 }, (_, i) => `src/f${i}.ts(1,1): error TS1005: ';' expected.\n`).join("");
    const h = harness({ script: (handlers) => (handlers.output(many), handlers.exit(2, null)) });
    expect(await runCheck(["typecheck"], h.deps)).toBe(2);
    const out = h.out().split("\n");
    expect(out.filter((l) => l.startsWith("arbab-check failure: "))).toHaveLength(30);
    expect(out[31]).toBe("arbab-check: 10 more failures in the log");
    expect(out[32]).toBe("--- last 40 lines ---");
  });

  it("keeps stdout within 3800 characters with huge failures, huge lines and a waiting line", async () => {
    other(101);
    const huge = Array.from({ length: 50 }, (_, i) => ` FAIL  src/${"d".repeat(400)}${i}.test.ts > ${"s".repeat(400)}\nError: ${"m".repeat(2000)}\n`).join("");
    const h = harness({
      policy: { cpus: 8, concurrent: 1, waitSec: 2 },
      script: (handlers) => (handlers.output(huge), handlers.output(`${"x".repeat(5000)}\n`.repeat(100)), handlers.exit(1, null)),
    });
    expect(await runCheck(["test"], h.deps)).toBe(1);
    const out = h.out();
    expect(out.length).toBeLessThanOrEqual(STDOUT_MAX);
    const lines = out.split("\n");
    expect(lines[0]).toMatch(/^arbab-check: waiting for one of 1 places/);
    expect(lines[1]).toMatch(/^arbab-check test: exit 1 /);
    const failures = lines.filter((l) => l.startsWith("arbab-check failure: "));
    expect(failures.length).toBeGreaterThan(0);
    for (const line of failures) {
      expect(line.length).toBeLessThanOrEqual(200);
      expect(parseFailureLine(line)).not.toBeNull();
    }
    expect(failures.reduce((n, l) => n + l.length + 1, 0)).toBeLessThanOrEqual(2000);
    expect(lines).toContain(`arbab-check: ${50 - failures.length} more failures in the log`);
    const marker = lines.findIndex((l) => l.startsWith("--- last "));
    const tail = lines.slice(marker + 1, -1);
    expect(lines[marker]).toBe(`--- last ${tail.length} lines ---`);
    expect(tail.length).toBeGreaterThan(0);
    for (const line of tail) expect(line).toBe("x".repeat(240));
    // The log keeps everything.
    expect(readFileSync(join(cwd, ".arbab-tmp", "checks", "test-1.log"), "utf8")).toBe(huge + `${"x".repeat(5000)}\n`.repeat(100));
  });

  it("gives 128 + the signal number when a signal killed the child", async () => {
    const h = harness({ script: (handlers) => handlers.exit(null, "SIGTERM") });
    expect(await runCheck(["test"], h.deps)).toBe(signalExitCode("SIGTERM"));
    expect(signalExitCode("SIGTERM")).toBe(143);
    expect(h.out()).toMatch(/^arbab-check test: exit 143 /);
  });

  it("forwards SIGINT and SIGTERM to the child", async () => {
    const h = harness({ script: () => h.signal("SIGINT") });
    expect(await runCheck(["test"], h.deps)).toBe(130);
    expect(h.kills).toEqual(["SIGINT"]);
    expect(h.disposed()).toBe(true);
    expect(registry()).toEqual([]);
  });

  it("substitutes {cpus}, appends the extra args and sets the share in the env", async () => {
    others(101, 102);
    const h = harness({
      checks: { test: ["vitest", "run", "--maxWorkers={cpus}", "--pool={cpus}x{cpus}"] },
      policy: { cpus: 8, concurrent: 4, waitSec: 120 },
    });
    expect(await runCheck(["test", "src/a.test.ts", "{cpus}"], h.deps)).toBe(0);
    // Two others running: floor((8 − 1) / 3) = 2.
    expect(h.spawned[0]?.command).toBe("vitest");
    expect(h.spawned[0]?.args).toEqual(["run", "--maxWorkers=2", "--pool=2x2", "src/a.test.ts", "{cpus}"]);
    expect(h.spawned[0]?.env).toMatchObject({ PATH: "/usr/bin", HOME: "/home/someone", ARBAB_CHECK_CPUS: "2", VITEST_MAX_WORKERS: "2" });
    expect(h.out()).toContain(" on 2 CPUs; ");
    expect(h.sleeps).toEqual([]);
  });

  it("never gives less than one CPU", async () => {
    others(101, 102, 103);
    const h = harness({ policy: { cpus: 2, concurrent: 8, waitSec: 0 } });
    await runCheck(["test"], h.deps);
    expect(h.spawned[0]?.env.ARBAB_CHECK_CPUS).toBe("1");
  });

  it("exits 127 when the child cannot start, with one stderr line and no log left", async () => {
    const h = harness({ script: (handlers) => handlers.error(Object.assign(new Error("spawn vitest ENOENT"), { code: "ENOENT" })) });
    expect(await runCheck(["test"], h.deps)).toBe(127);
    expect(h.err()).toBe("arbab-check: cannot run vitest: spawn vitest ENOENT\n");
    expect(h.out()).toBe("");
    expect(readdirSync(join(cwd, ".arbab-tmp", "checks"))).toEqual([]);
    expect(registry()).toEqual([]);
  });

  it("exits 127 when spawn itself throws", async () => {
    const h = harness();
    h.deps.spawn = () => {
      throw new Error("bad argv");
    };
    expect(await runCheck(["test"], h.deps)).toBe(127);
    expect(h.err()).toBe("arbab-check: cannot run vitest: bad argv\n");
    expect(registry()).toEqual([]);
  });
});

describe("runCheck: the registry and the wait", () => {
  it("registers while it runs and unregisters after", async () => {
    let during: string[] = [];
    const h = harness({ script: (handlers) => ((during = registry()), handlers.exit(0, null)) });
    await runCheck(["test"], h.deps);
    expect(during).toEqual([`${PID}.json`]);
    expect(registry()).toEqual([]);
    expect(h.disposed()).toBe(true);
  });

  it("registers as waiting, then rewrites its entry as running with its share", async () => {
    other(101);
    const states: unknown[] = [];
    const h = harness({
      policy: { cpus: 8, concurrent: 1, waitSec: 2 },
      onSleep: () => states.push(entryOf(PID)),
      script: (handlers) => {
        states.push(entryOf(PID));
        handlers.exit(0, null);
      },
    });
    await runCheck(["test"], h.deps);
    const base = { pid: PID, name: "test", cwd, startedAt: new Date(T0).toISOString(), cpus: 8 };
    expect(states).toEqual([{ ...base, state: "waiting" }, { ...base, state: "running", share: 3 }]);
  });

  it("still runs, and says so, when it cannot mark itself running", async () => {
    const h = harness({
      fs: {
        replace: () => {
          throw new Error("ENOSPC");
        },
      },
    });
    expect(await runCheck(["test"], h.deps)).toBe(0);
    expect(h.err()).toBe(`arbab-check: cannot mark test running in ${registryDir(tdir)} (ENOSPC)\n`);
    expect(h.spawned).toHaveLength(1);
    expect(registry()).toEqual([]);
  });

  it("counts an entry without state, from an older script, as running", async () => {
    const dir = registryDir(tdir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "101.json"), JSON.stringify({ pid: 101, name: "test", cwd: "/elsewhere", startedAt: new Date(T0 - 1000).toISOString(), cpus: 8 }));
    const h = harness({ policy: { cpus: 8, concurrent: 1, waitSec: 4 } });
    expect(await runCheck(["test"], h.deps)).toBe(0);
    expect(h.out().split("\n")[0]).toBe("arbab-check: waiting for one of 1 places (1 checks running)");
    expect(h.sleeps).toEqual([2000, 2000]);
    expect(h.spawned[0]?.env.ARBAB_CHECK_CPUS).toBe("3");
  });

  it("counts the waiters registered before it, not those after, and gives them no CPUs", async () => {
    other(101, "waiting", new Date(T0 - 1000).toISOString());
    other(102, "waiting", new Date(T0 + 1000).toISOString());
    // Registered at the same time: the lower pid is first.
    other(PID - 1, "waiting", new Date(T0).toISOString());
    other(PID + 1, "waiting", new Date(T0).toISOString());
    const h = harness({ policy: { cpus: 8, concurrent: 2, waitSec: 2 } });
    expect(await runCheck(["test"], h.deps)).toBe(0);
    expect(h.out().split("\n")[0]).toBe("arbab-check: waiting for one of 2 places (0 checks running, 2 waiting before this one)");
    expect(h.spawned[0]?.env.ARBAB_CHECK_CPUS).toBe("7");

    rmSync(join(registryDir(tdir), "101.json"));
    const next = harness({ policy: { cpus: 8, concurrent: 2, waitSec: 2 } });
    expect(await runCheck(["test"], next.deps)).toBe(0);
    expect(next.out()).not.toContain("waiting");
    expect(next.sleeps).toEqual([]);
  });

  it("starts three waiters with one place one after another, in registration order, long before waitSec", async () => {
    let t = T0;
    let active = 0;
    let most = 0;
    const order: number[] = [];
    const runs: Harness[] = [];
    // Registered in this order, so not in pid order.
    for (const pid of [300, 100, 200]) {
      const h = harness({
        policy: { cpus: 8, concurrent: 1, waitSec: 120 },
        script: (handlers) => {
          order.push(pid);
          active += 1;
          most = Math.max(most, active);
          setTimeout(() => {
            active -= 1;
            handlers.exit(0, null);
          }, 30);
        },
      });
      h.deps.pid = pid;
      h.deps.now = () => t;
      // Real time passes so the children end; the clock barely moves, so waitSec never runs out.
      h.deps.sleep = (ms) =>
        new Promise((resolve) => {
          h.sleeps.push(ms);
          setTimeout(() => ((t += 1), resolve()), 2);
        });
      runs.push(h);
    }
    const results: Array<Promise<number>> = [];
    for (const h of runs) {
      results.push(runCheck(["test"], h.deps));
      t += 10;
    }
    expect(await Promise.all(results)).toEqual([0, 0, 0]);
    expect(order).toEqual([300, 100, 200]);
    expect(most).toBe(1);
    expect(t - T0).toBeLessThan(120_000);
    expect(runs[0]?.out()).not.toContain("waiting");
    expect(runs[1]?.out().split("\n")[0]).toBe("arbab-check: waiting for one of 1 places (1 checks running)");
    expect(runs[2]?.out().split("\n")[0]).toBe("arbab-check: waiting for one of 1 places (1 checks running, 1 waiting before this one)");
    for (const h of runs) expect(h.sleeps.every((ms) => ms === 2000)).toBe(true);
    expect(registry()).toEqual([]);
  });

  it("waits while the machine is full, then runs anyway after waitSec", async () => {
    others(101);
    const h = harness({ policy: { cpus: 8, concurrent: 1, waitSec: 5 } });
    expect(await runCheck(["test"], h.deps)).toBe(0);
    expect(h.out().split("\n")[0]).toBe("arbab-check: waiting for one of 1 places (1 checks running)");
    expect(h.out().match(/waiting/g)).toHaveLength(1);
    expect(h.sleeps).toEqual([2000, 2000, 1000]);
    // Still one other running: floor(7 / 2) = 3.
    expect(h.spawned[0]?.env.VITEST_MAX_WORKERS).toBe("3");
  });

  it("stops waiting when a place frees", async () => {
    others(101, 102);
    // 101 ends after the first poll.
    const h = harness({ policy: { cpus: 8, concurrent: 2, waitSec: 120 }, alive: (pid, call) => pid !== 101 || call < 2 });
    expect(await runCheck(["test"], h.deps)).toBe(0);
    expect(h.sleeps).toEqual([2000]);
    expect(h.spawned[0]?.env.ARBAB_CHECK_CPUS).toBe("3");
    expect(registry()).toEqual(["102.json"]);
  });

  it("removes stale entries and does not count them", async () => {
    others(101, 102);
    const h = harness({ policy: { cpus: 8, concurrent: 1, waitSec: 120 }, alive: () => false });
    expect(await runCheck(["test"], h.deps)).toBe(0);
    expect(h.sleeps).toEqual([]);
    expect(h.spawned[0]?.env.ARBAB_CHECK_CPUS).toBe("7");
    expect(registry()).toEqual([]);
  });

  it("stops at a signal during the wait, without running, and unregisters", async () => {
    others(101);
    const h = harness({ policy: { cpus: 8, concurrent: 1, waitSec: 120 }, onSleep: (self) => self.signal("SIGTERM") });
    expect(await runCheck(["test"], h.deps)).toBe(143);
    expect(h.sleeps).toEqual([2000]);
    expect(h.spawned).toEqual([]);
    expect(h.err()).toBe("arbab-check: SIGTERM before test started\n");
    expect(registry()).toEqual(["101.json"]);
    expect(h.disposed()).toBe(true);
  });

  it("goes on with no wait when the registry cannot be created", async () => {
    const h = harness({
      policy: { cpus: 8, concurrent: 1, waitSec: 120 },
      fs: {
        mkdirp: (dir) => {
          if (dir === registryDir(tdir)) throw new Error("EACCES: permission denied");
          nodeCheckFs.mkdirp(dir);
        },
      },
    });
    expect(await runCheck(["test"], h.deps)).toBe(0);
    expect(h.err()).toBe(`arbab-check: the registry ${registryDir(tdir)} is unusable (EACCES: permission denied); running without waiting\n`);
    expect(h.sleeps).toEqual([]);
    expect(h.spawned[0]?.env.ARBAB_CHECK_CPUS).toBe("7");
  });

  it("goes on with running = 0 when the registry cannot be read, and still unregisters", async () => {
    others(101);
    const h = harness({
      policy: { cpus: 8, concurrent: 1, waitSec: 120 },
      fs: {
        readDir: (dir) => {
          if (dir === registryDir(tdir)) throw new Error("EIO");
          return nodeCheckFs.readDir(dir);
        },
      },
    });
    expect(await runCheck(["test"], h.deps)).toBe(0);
    expect(h.err()).toContain("is unusable (EIO); running without waiting");
    expect(h.sleeps).toEqual([]);
    expect(h.spawned[0]?.env.ARBAB_CHECK_CPUS).toBe("7");
    expect(registry()).toEqual(["101.json"]);
  });

  it("unregisters on a failing run too, and survives a failed unregister", async () => {
    const failing = harness({ script: (handlers) => handlers.exit(1, null) });
    expect(await runCheck(["test"], failing.deps)).toBe(1);
    expect(registry()).toEqual([]);
    const h = harness({
      fs: {
        remove: (path) => {
          if (path.endsWith(`${PID}.json`)) throw new Error("EPERM");
          nodeCheckFs.remove(path);
        },
      },
    });
    expect(await runCheck(["test"], h.deps)).toBe(0);
  });
});

describe("runCheck: the log", () => {
  it("counts the log number up from the highest existing one", async () => {
    const checks = join(cwd, ".arbab-tmp", "checks");
    mkdirSync(checks);
    writeFileSync(join(checks, "test-3.log"), "");
    writeFileSync(join(checks, "test-1.log"), "");
    writeFileSync(join(checks, "typecheck-9.log"), "");
    writeFileSync(join(checks, "test-x.log"), "");
    const h = harness({ script: (handlers) => (handlers.output("one\n"), handlers.exit(0, null)) });
    await runCheck(["test"], h.deps);
    await runCheck(["test"], h.deps);
    expect(h.out()).toContain("log .arbab-tmp/checks/test-4.log\n");
    expect(h.out()).toContain("log .arbab-tmp/checks/test-5.log\n");
    expect(readFileSync(join(checks, "test-5.log"), "utf8")).toBe("one\n");
  });

  it("writes to the temporary directory when .arbab-tmp does not exist, by its absolute path", async () => {
    rmSync(join(cwd, ".arbab-tmp"), { recursive: true });
    const h = harness({ script: (handlers) => (handlers.output("x\n"), handlers.exit(0, null)) });
    await runCheck(["test"], h.deps);
    const log = join(tdir, `arbab-check-test-${PID}.log`);
    expect(h.out()).toContain(`; log ${log}\n`);
    expect(readFileSync(log, "utf8")).toBe("x\n");
    // A second run of the same pid replaces it.
    await runCheck(["test"], h.deps);
    expect(readFileSync(log, "utf8")).toBe("x\n");
  });

  it("still runs and summarises from the tail when the log cannot be written", async () => {
    const h = harness({
      fs: {
        append: () => {
          throw new Error("ENOSPC");
        },
      },
      script: (handlers) => (handlers.output("src/a.ts(1,1): error TS1005: ';' expected.\n"), handlers.exit(2, null)),
    });
    expect(await runCheck(["typecheck"], h.deps)).toBe(2);
    expect(h.err()).toContain("cannot write");
    expect(h.out()).toContain("arbab-check failure: src/a.ts :: TS1005: ';' expected.");
  });

  it("says so when no log can be created", async () => {
    const h = harness({ fs: { writeExclusive: (path, data) => (path.endsWith(".log") ? false : nodeCheckFs.writeExclusive(path, data)) } });
    expect(await runCheck(["test"], h.deps)).toBe(0);
    expect(h.err()).toContain("cannot create a log");
    expect(h.out()).toMatch(/; log none\n/);
  });
});

describe("shortFailureLine", () => {
  it("leaves a short line as formatFailureLine writes it", () => {
    expect(shortFailureLine({ file: "src/a.ts", test: "t", message: "boom" })).toBe("arbab-check failure: src/a.ts > t :: boom");
  });

  it("cuts a long line to 200 characters that still read back, the message keeping what is left", () => {
    for (const failure of [
      { file: "f".repeat(300), test: "t".repeat(300), message: "m".repeat(300) },
      { file: "f".repeat(300), test: null, message: "m".repeat(300) },
      { file: null, test: null, message: "m".repeat(300) },
      { file: "src/a.ts", test: "t".repeat(300), message: "short" },
    ]) {
      const line = shortFailureLine(failure);
      expect(line.length).toBeLessThanOrEqual(200);
      const back = parseFailureLine(line);
      expect(back).not.toBeNull();
      expect(back?.file).toBe(failure.file === null ? null : failure.file.slice(0, 70));
      expect(back?.test).toBe(failure.test === null ? null : failure.test.slice(0, 50));
    }
    expect(shortFailureLine({ file: null, test: null, message: "m".repeat(300) })).toBe(`arbab-check failure: - :: ${"m".repeat(174)}`);
  });
});

describe("summarize", () => {
  const header = "arbab-check test: exit 1 after 1.0s on 7 CPUs; log .arbab-tmp/checks/test-1.log";
  const failure = (i: number) => ({ file: `src/${"d".repeat(300)}${i}.ts`, test: "t".repeat(300), message: "m".repeat(300) });

  it("is the header, the failures, the marker and the tail when all fit", () => {
    const text = summarize(header, [{ file: "src/a.ts", test: null, message: "boom" }], ["one", "two"], STDOUT_MAX);
    expect(text).toBe(`${header}\narbab-check failure: src/a.ts :: boom\n--- last 2 lines ---\none\ntwo\n`);
    expect(summarize(header, [], [], STDOUT_MAX)).toBe(`${header}\n--- last 0 lines ---\n`);
  });

  it("never exceeds the budget, with huge failures and huge lines", () => {
    const failures = Array.from({ length: 1000 }, (_, i) => failure(i));
    const tail = Array.from({ length: 60 }, (_, i) => `${i} ${"x".repeat(10_000)}`);
    for (const budget of [STDOUT_MAX, STDOUT_MAX - 500]) {
      const text = summarize(header, failures, tail, budget);
      expect(text.length).toBeLessThanOrEqual(budget);
      const lines = text.split("\n");
      const shown = lines.filter((l) => l.startsWith("arbab-check failure: "));
      expect(shown.reduce((n, l) => n + l.length + 1, 0)).toBeLessThanOrEqual(2000);
      expect(lines).toContain(`arbab-check: ${1000 - shown.length} more failures in the log`);
      const marker = lines.findIndex((l) => l.startsWith("--- last "));
      const kept = lines.slice(marker + 1, -1);
      expect(lines[marker]).toBe(`--- last ${kept.length} lines ---`);
      // The newest lines, each cut to 240.
      expect(kept.at(-1)).toBe(`59 ${"x".repeat(237)}`);
      for (const line of kept) expect(line.length).toBe(240);
      // Nothing more would have fitted.
      expect(budget - text.length).toBeLessThan(241 + 2);
    }
  });

  it("caps the failure lines at 30 and says how many more the log holds", () => {
    const short = Array.from({ length: 31 }, (_, i) => ({ file: `src/${i}.ts`, test: null, message: "x" }));
    const lines = summarize(header, short, [], STDOUT_MAX).split("\n");
    expect(lines.filter((l) => l.startsWith("arbab-check failure: "))).toHaveLength(30);
    expect(lines[31]).toBe("arbab-check: 1 more failures in the log");
    expect(summarize(header, short.slice(0, 30), [], STDOUT_MAX)).not.toContain("more failures");
  });

  it("keeps the header even when it is long, cut so the rest still fits", () => {
    const long = `arbab-check test: exit 1 after 1.0s on 7 CPUs; log /${"p".repeat(5000)}`;
    const text = summarize(long, Array.from({ length: 100 }, (_, i) => failure(i)), ["a".repeat(300)], STDOUT_MAX);
    expect(text.length).toBeLessThanOrEqual(STDOUT_MAX);
    expect(text.split("\n")[0]).toBe(long.slice(0, 1000));
    expect(text).toContain("--- last 1 lines ---");
  });
});

describe("nodeCheckSpawn", () => {
  const run = (command: string, args: string[], env: Record<string, string | undefined> = {}) =>
    new Promise<{ output: string; result: string }>((resolve) => {
      let output = "";
      nodeCheckSpawn()(command, args, { cwd: tmp, env: { PATH: process.env.PATH, ...env } }, {
        output: (text) => (output += text),
        error: (err) => resolve({ output, result: `error ${(err as NodeJS.ErrnoException).code ?? ""}` }),
        exit: (code, signal) => resolve({ output, result: `exit ${code} ${signal}` }),
      });
    });

  it("pipes stdout and stderr as text and reports the exit code, in the given cwd and env", async () => {
    const script = "process.stdout.write('out ' + process.env.MARK + '\\n'); process.stderr.write(process.cwd() + '\\n'); process.exit(4)";
    const { output, result } = await run(process.execPath, ["-e", script], { MARK: "é" });
    expect(result).toBe("exit 4 null");
    expect(output).toContain("out é\n");
    expect(output).toContain(`${realpathSync(tmp)}\n`);
  });

  it("reports a signal and a command that cannot start", async () => {
    expect((await run(process.execPath, ["-e", "process.kill(process.pid, 'SIGTERM')"])).result).toBe("exit null SIGTERM");
    expect((await run(join(tmp, "no-such-binary"), [])).result).toBe("error ENOENT");
  });

  it("kills the child with the given signal", async () => {
    const result = await new Promise<string>((resolve) => {
      const child = nodeCheckSpawn()(process.execPath, ["-e", "process.stdout.write('ready\\n'); setInterval(() => {}, 1000)"], { cwd: tmp, env: {} }, {
        output: () => child.kill("SIGINT"),
        error: () => resolve("error"),
        exit: (code, signal) => resolve(`${code} ${signal}`),
      });
    });
    expect(result).toBe("null SIGINT");
  });
});

describe("nodeCheckFs", () => {
  it("tells directories and appends", () => {
    expect(nodeCheckFs.isDir(cwd)).toBe(true);
    expect(nodeCheckFs.isDir(join(cwd, "missing"))).toBe(false);
    const file = join(tmp, "f.log");
    nodeCheckFs.append(file, "a");
    nodeCheckFs.append(file, "b");
    expect(nodeCheckFs.isDir(file)).toBe(false);
    expect(readFileSync(file, "utf8")).toBe("ab");
  });
});
