import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseFailureLine } from "./command";
import { parseFailures } from "./digest";
import { register, registryDir, type CheckState } from "./registry";
import {
  createLogFile,
  KEPT_BYTES,
  KeptOutput,
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

// The real parser, which a test can make throw once.
vi.mock("./digest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./digest")>();
  return { ...actual, parseFailures: vi.fn(actual.parseFailures) };
});

const PID = 4000;
const SCRIPT = "/runs/lane/bin/arbab-check.mjs";
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
    policy?: { cpus: number; concurrent: number; waitSec: number; suites?: "targeted" | "whole" };
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
  let randoms = 0;
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
      script: SCRIPT,
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
      randomHex: (bytes) => (0xa00000 + randoms++).toString(16).padStart(bytes * 2, "0"),
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

describe("runCheck: whole suites", () => {
  const targeted = { cpus: 8, concurrent: 2, waitSec: 120, suites: "targeted" as const };
  const refusal = (name: string, script = SCRIPT): string =>
    `arbab-check: ${name} runs the whole suite, which verify runs for the batch; pass the test files you changed: node ${script} ${name} <files>\n`;

  it("refuses a suite without targets in a lane: one stderr line, exit 2, nothing registered, nothing spawned", async () => {
    const h = harness({ policy: targeted });
    expect(await runCheck(["test"], h.deps)).toBe(2);
    expect(h.err()).toBe(refusal("test"));
    expect(h.out()).toBe("");
    expect(h.spawned).toEqual([]);
    expect(registry()).toEqual([]);
    expect(existsSync(join(cwd, ".arbab-tmp", "checks"))).toBe(false);
  });

  it("refuses options alone, whose words are their values: --project unit, -t name, --reporter=dot", async () => {
    for (const extra of [["--project", "unit"], ["-t", "adds"], ["--reporter=dot"], ["--run"]]) {
      const h = harness({ policy: targeted });
      expect(await runCheck(["test", ...extra], h.deps)).toBe(2);
      expect(h.err()).toBe(refusal("test"));
      expect(h.spawned).toEqual([]);
    }
    expect(registry()).toEqual([]);
  });

  it("refuses every kind of suite, and quotes a script path the shell would split", async () => {
    const checks = { unit: ["pnpm", "test:unit"], node: ["node", "--test"], jest: ["npx", "jest"] };
    for (const name of Object.keys(checks)) {
      const h = harness({ checks, policy: targeted });
      h.deps.script = "/runs/my lane/arbab-check.mjs";
      expect(await runCheck([name], h.deps)).toBe(2);
      expect(h.err()).toBe(refusal(name, "'/runs/my lane/arbab-check.mjs'"));
    }
  });

  it("runs a suite with targets: a path, a bare filter word, a path after a boolean flag", async () => {
    for (const extra of [["src/a.test.ts"], ["adds"], ["--run", "src/a.test.ts"], ["--project", "unit", "src/b.test.ts"]]) {
      const h = harness({ policy: targeted });
      expect(await runCheck(["test", ...extra], h.deps)).toBe(0);
      expect(h.err()).toBe("");
      expect(h.spawned.map((s) => [s.command, ...s.args])).toEqual([["vitest", "run", ...extra]]);
    }
  });

  it("runs a check that is no suite without arguments", async () => {
    const h = harness({ policy: targeted });
    expect(await runCheck(["typecheck"], h.deps)).toBe(0);
    expect(h.spawned).toHaveLength(1);
  });

  it("runs the whole suite with suites whole, and with a policy from before 0.3.1", async () => {
    const whole = harness({ policy: { cpus: 8, concurrent: 2, waitSec: 120, suites: "whole" } });
    expect(await runCheck(["test"], whole.deps)).toBe(0);
    expect(whole.spawned.map((s) => s.args)).toEqual([["run"]]);
    const old = harness({ policy: { cpus: 8, concurrent: 2, waitSec: 120 } });
    expect(await runCheck(["test"], old.deps)).toBe(0);
    expect(old.spawned).toHaveLength(1);
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
      expect(line.length).toBeLessThanOrEqual(400);
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

  it("writes to the temporary directory when .arbab-tmp does not exist: a new random name, mode 0600, by its absolute path", async () => {
    rmSync(join(cwd, ".arbab-tmp"), { recursive: true });
    const h = harness({ script: (handlers) => (handlers.output("x\n"), handlers.exit(0, null)) });
    await runCheck(["test"], h.deps);
    const log = join(tdir, `arbab-check-test-${PID}-a00000.log`);
    expect(h.out()).toContain(`; log ${log}\n`);
    expect(readFileSync(log, "utf8")).toBe("x\n");
    if (process.platform !== "win32") expect(statSync(log).mode & 0o777).toBe(0o600);
    // A second run of the same pid takes a name of its own.
    await runCheck(["test"], h.deps);
    expect(h.out()).toContain(`; log ${join(tdir, `arbab-check-test-${PID}-a00001.log`)}\n`);
  });

  it.skipIf(process.platform === "win32")("never follows a link planted at the fallback name: it takes another, then goes on without a log", async () => {
    rmSync(join(cwd, ".arbab-tmp"), { recursive: true });
    const victim = join(cwd, "src.ts");
    writeFileSync(victim, "original\n");
    // Links at the first two names, one to the victim and one dangling.
    symlinkSync(victim, join(tdir, `arbab-check-test-${PID}-a00000.log`));
    symlinkSync(join(cwd, "created.ts"), join(tdir, `arbab-check-test-${PID}-a00001.log`));
    const h = harness({ script: (handlers) => (handlers.output("x\n"), handlers.exit(0, null)) });
    await runCheck(["test"], h.deps);
    const log = join(tdir, `arbab-check-test-${PID}-a00002.log`);
    expect(h.out()).toContain(`; log ${log}\n`);
    expect(readFileSync(log, "utf8")).toBe("x\n");
    expect(readFileSync(victim, "utf8")).toBe("original\n");
    expect(existsSync(join(cwd, "created.ts"))).toBe(false);
    expect(lstatSync(join(tdir, `arbab-check-test-${PID}-a00000.log`)).isSymbolicLink()).toBe(true);

    // All five names a run tries taken, by links and by the first run's log: no log, and the run goes on.
    const taken = harness({ script: (handlers) => (handlers.output("y\n"), handlers.exit(0, null)) });
    for (const name of ["a00003", "a00004"]) symlinkSync(victim, join(tdir, `arbab-check-test-${PID}-${name}.log`));
    expect(await runCheck(["test"], taken.deps)).toBe(0);
    expect(taken.err()).toBe(`arbab-check: cannot create a log (no free log name in ${tdir}); the output is not kept\n`);
    expect(taken.out()).toMatch(/; log none\n/);
    expect(readFileSync(victim, "utf8")).toBe("original\n");
  });

  it.skipIf(process.platform === "win32")("never follows a link planted at the next log number: it writes to the number after", async () => {
    const victim = join(cwd, "src.ts");
    writeFileSync(victim, "original\n");
    const checks = join(cwd, ".arbab-tmp", "checks");
    let planted = false;
    const h = harness({
      fs: {
        // Planted between the listing and the create, where counting cannot see it.
        createLog: (path, mode) => {
          if (!planted) {
            planted = true;
            symlinkSync(victim, path);
          }
          return nodeCheckFs.createLog(path, mode);
        },
      },
      script: (handlers) => (handlers.output("out\n"), handlers.exit(0, null)),
    });
    expect(await runCheck(["test"], h.deps)).toBe(0);
    expect(h.out()).toContain("log .arbab-tmp/checks/test-2.log\n");
    expect(readFileSync(join(checks, "test-2.log"), "utf8")).toBe("out\n");
    expect(readFileSync(victim, "utf8")).toBe("original\n");
    expect(lstatSync(join(checks, "test-1.log")).isSymbolicLink()).toBe(true);
  });

  it("gives up after 20 taken numbers and goes on without a log", async () => {
    const tried: string[] = [];
    const h = harness({ fs: { createLog: (path) => (tried.push(path), null) } });
    expect(await runCheck(["test"], h.deps)).toBe(0);
    expect(tried).toHaveLength(20);
    expect(tried.at(-1)).toBe(join(cwd, ".arbab-tmp", "checks", "test-20.log"));
    expect(h.err()).toContain("cannot create a log (no free log number in");
    expect(h.out()).toMatch(/; log none\n/);
  });

  it("writes the log only through the one descriptor it opened, closes it once, and parses what it wrote", async () => {
    const calls: string[] = [];
    const checks = join(cwd, ".arbab-tmp", "checks");
    const victim = join(cwd, "src.ts");
    writeFileSync(victim, "original\n");
    const h = harness({
      fs: {
        createLog: (path, mode) => {
          calls.push(`create ${path}`);
          const file = nodeCheckFs.createLog(path, mode);
          if (file === null) return null;
          return {
            write: (data) => (calls.push(`write ${JSON.stringify(data)}`), file.write(data)),
            close: () => (calls.push("close"), file.close()),
          };
        },
        readFile: (path) => (calls.push(`read ${path}`), nodeCheckFs.readFile(path)),
        readEntry: (path) => (path.endsWith(".log") && calls.push(`read ${path}`), nodeCheckFs.readEntry(path)),
      },
      script: (handlers) => {
        handlers.output(" FAIL  src/a.test.ts > adds\nError: one\n");
        // Moved away and replaced by a link: the next chunk still goes to the file first opened.
        renameSync(join(checks, "test-1.log"), join(checks, "moved.log"));
        symlinkSync(victim, join(checks, "test-1.log"));
        handlers.output(" FAIL  src/b.test.ts > subtracts\nError: two\n");
        handlers.exit(1, null);
      },
    });
    expect(await runCheck(["test"], h.deps)).toBe(1);
    expect(calls).toEqual([
      `create ${join(checks, "test-1.log")}`,
      `write ${JSON.stringify(" FAIL  src/a.test.ts > adds\nError: one\n")}`,
      `write ${JSON.stringify(" FAIL  src/b.test.ts > subtracts\nError: two\n")}`,
      "close",
    ]);
    expect(readFileSync(join(checks, "moved.log"), "utf8")).toBe(" FAIL  src/a.test.ts > adds\nError: one\n FAIL  src/b.test.ts > subtracts\nError: two\n");
    expect(readFileSync(victim, "utf8")).toBe("original\n");
    expect(h.out()).toContain("arbab-check failure: src/a.test.ts > adds :: Error: one\narbab-check failure: src/b.test.ts > subtracts :: Error: two\n");
  });

  it("parses the failures from what it wrote, not from a file later put at the log's path", async () => {
    const checks = join(cwd, ".arbab-tmp", "checks");
    const h = harness({
      script: (handlers) => {
        handlers.output(" FAIL  src/real.test.ts > works\nError: real\n");
        rmSync(join(checks, "test-1.log"));
        writeFileSync(join(checks, "test-1.log"), " FAIL  src/planted.test.ts > lies\nError: planted\n");
        handlers.exit(1, null);
      },
    });
    expect(await runCheck(["test"], h.deps)).toBe(1);
    expect(h.out()).toContain("arbab-check failure: src/real.test.ts > works :: Error: real\n");
    expect(h.out()).not.toContain("planted");
  });

  it("still runs and summarises from the tail when the log cannot be written", async () => {
    let closed = 0;
    const h = harness({
      fs: {
        createLog: () => ({
          write: () => {
            throw new Error("ENOSPC");
          },
          close: () => {
            closed += 1;
          },
        }),
      },
      script: (handlers) => (handlers.output("src/a.ts(1,1): error TS1005: ';' expected.\n"), handlers.output("more\n"), handlers.exit(2, null)),
    });
    expect(await runCheck(["typecheck"], h.deps)).toBe(2);
    expect(h.err()).toBe(`arbab-check: cannot write ${join(cwd, ".arbab-tmp", "checks", "typecheck-1.log")} (ENOSPC)\n`);
    expect(h.out()).toContain("arbab-check failure: src/a.ts :: TS1005: ';' expected.");
    expect(closed).toBe(1);
  });

  it("survives a failed close", async () => {
    const h = harness({
      fs: {
        createLog: (path, mode) => {
          const file = nodeCheckFs.createLog(path, mode);
          if (file === null) return null;
          return {
            write: file.write,
            close: () => {
              file.close();
              throw new Error("EIO");
            },
          };
        },
      },
      script: (handlers) => (handlers.output("x\n"), handlers.exit(0, null)),
    });
    expect(await runCheck(["test"], h.deps)).toBe(0);
    expect(h.err()).toBe("");
  });

  it("says so when no log can be created", async () => {
    const h = harness({
      fs: {
        createLog: () => {
          throw new Error("EACCES");
        },
      },
    });
    expect(await runCheck(["test"], h.deps)).toBe(0);
    expect(h.err()).toBe("arbab-check: cannot create a log (EACCES); the output is not kept\n");
    expect(h.out()).toMatch(/; log none\n/);
  });
});

describe("runCheck: huge output", () => {
  const MIB = 1024 * 1024;
  /** One chunk of exactly 1 MiB: the failure line given, then padding. */
  const chunk = (head: string): string => `${head}${"p".repeat(MIB - head.length - 1)}\n`;
  const early = " FAIL  src/early.test.ts > first\nError: early\n";
  const late = " FAIL  src/late.test.ts > last\nError: late\n";

  it("parses only the last 8 MiB of what it wrote, dropping whole chunks from the front", async () => {
    expect(KEPT_BYTES).toBe(8 * MIB);
    for (const [count, keepsEarly] of [
      [8, true],
      [9, false],
    ] as const) {
      const h = harness({
        script: (handlers) => {
          handlers.output(chunk(early));
          for (let i = 1; i < count - 1; i++) handlers.output(chunk(""));
          handlers.output(chunk(late));
          handlers.exit(1, null);
        },
      });
      expect(await runCheck(["test"], h.deps)).toBe(1);
      expect(h.out()).toContain("arbab-check failure: src/late.test.ts > last :: Error: late\n");
      // The tail still shows the early lines, each cut to 240: only a failure line tells what was parsed.
      expect(h.out().includes("arbab-check failure: src/early.test.ts")).toBe(keepsEarly);
      expect(h.out().length).toBeLessThanOrEqual(STDOUT_MAX);
      expect(h.err()).toBe("");
    }
  });

  it("summarises from the 200-line tail, with the child's exit code, when parsing the output throws", async () => {
    const parse = vi.mocked(parseFailures);
    parse.mockImplementationOnce(() => {
      throw new RangeError("Invalid string length");
    });
    const h = harness({
      script: (handlers) => {
        // The early failure is above the tail and is lost; the late one is in it.
        handlers.output(early);
        handlers.output(lines(300));
        handlers.output(late);
        handlers.exit(3, null);
      },
    });
    expect(await runCheck(["test"], h.deps)).toBe(3);
    expect(h.err()).toBe("arbab-check: cannot parse the output (Invalid string length); failures from the last 200 lines only\n");
    const out = h.out().split("\n");
    expect(out[0]).toMatch(/^arbab-check test: exit 3 after /);
    expect(out[1]).toBe("arbab-check failure: src/late.test.ts > last :: Error: late");
    expect(out[2]).toBe("--- last 60 lines ---");
    expect(h.out()).not.toContain("early");
    // The second parse had the tail only.
    expect(parse.mock.lastCall?.[0].split("\n")).toHaveLength(200);
  });

  it("still prints the summary, without failures, when parsing the tail throws too", async () => {
    vi.mocked(parseFailures)
      .mockImplementationOnce(() => {
        throw new RangeError("Invalid string length");
      })
      .mockImplementationOnce(() => {
        throw new Error("again");
      });
    const h = harness({ script: (handlers) => (handlers.output(late), handlers.exit(1, null)) });
    expect(await runCheck(["test"], h.deps)).toBe(1);
    expect(h.out()).toMatch(/^arbab-check test: exit 1 after .*\n--- last 2 lines ---\n FAIL {2}src\/late\.test\.ts > last\nError: late\n$/);
    expect(registry()).toEqual([]);
  });
});

describe("KeptOutput", () => {
  it("keeps the newest whole chunks within the cap, an exact fit included", () => {
    const kept = new KeptOutput(10);
    kept.push("abcd");
    kept.push("efgh");
    expect(kept.text()).toBe("abcdefgh");
    kept.push("ij");
    expect([kept.text(), kept.bytes()]).toEqual(["abcdefghij", 10]);
    kept.push("k");
    expect([kept.text(), kept.bytes()]).toEqual(["efghijk", 7]);
    kept.push("");
    expect(kept.text()).toBe("efghijk");
  });

  it("counts UTF-8 bytes, and keeps a chunk over the cap as its last bytes without splitting a character", () => {
    const kept = new KeptOutput(4);
    kept.push("éé");
    expect(kept.bytes()).toBe(4);
    kept.push("x".repeat(9));
    expect([kept.text(), kept.bytes()]).toEqual(["xxxx", 4]);
    // 1 + 2 + 3 bytes: the last 4 start inside é, so the cut moves to €.
    kept.push("aé€");
    expect([kept.text(), kept.bytes()]).toEqual(["€", 3]);
  });

  it("stays right over many chunks, and empties on clear", () => {
    const kept = new KeptOutput(10);
    for (let i = 0; i < 5000; i++) kept.push(String(i % 10));
    expect([kept.text(), kept.bytes()]).toEqual(["0123456789", 10]);
    kept.clear();
    expect([kept.text(), kept.bytes()]).toEqual(["", 0]);
    kept.push("z");
    expect(kept.text()).toBe("z");
  });

  it("defaults to KEPT_BYTES", () => {
    const kept = new KeptOutput();
    kept.push("a".repeat(KEPT_BYTES));
    kept.push("b");
    expect(kept.bytes()).toBe(1);
    expect(kept.text()).toBe("b");
  });
});

describe("shortFailureLine", () => {
  it("leaves a short line as formatFailureLine writes it", () => {
    expect(shortFailureLine({ file: "src/a.ts", test: "t", message: "boom" })).toBe("arbab-check failure: src/a.ts > t :: boom");
  });

  it("keeps a 180-character file whole, and it reads back equal", () => {
    const file = `src/${"d".repeat(173)}.ts`;
    expect(file).toHaveLength(180);
    for (const failure of [
      { file, test: "t".repeat(300), message: "m".repeat(300) },
      { file, test: null, message: "m".repeat(300) },
      { file, test: "adds", message: "boom" },
    ]) {
      const line = shortFailureLine(failure);
      expect(line.length).toBeLessThanOrEqual(400);
      expect(line.startsWith(`arbab-check failure: ${file} `)).toBe(true);
      expect(parseFailureLine(line)?.file).toBe(file);
    }
  });

  it("keeps a file of exactly 200 characters, the field cap, whole", () => {
    const file = `src/${"d".repeat(193)}.ts`;
    expect(file).toHaveLength(200);
    expect(parseFailureLine(shortFailureLine({ file, test: "t".repeat(300), message: "m".repeat(300) }))?.file).toBe(file);
  });

  it("prints a 300-character file as - with the path at the start of the message, cut with it", () => {
    const file = `src/${"d".repeat(293)}.ts`;
    expect(file).toHaveLength(300);
    const line = shortFailureLine({ file, test: "adds", message: "boom" });
    expect(line.length).toBeLessThanOrEqual(400);
    const back = parseFailureLine(line);
    expect(back?.file).toBeNull();
    expect(back?.test).toBe("adds");
    // The message is cut to 300, all of it path.
    expect(back?.message).toBe(file);
    expect(line).toBe(`arbab-check failure: - > adds :: ${file}`);

    const shorter = `src/${"d".repeat(243)}.ts`;
    const whole = parseFailureLine(shortFailureLine({ file: shorter, test: null, message: "boom" }));
    expect(whole).toEqual({ file: null, test: null, message: `${shorter}: boom` });

    // With a long test too, the message keeps the start of the path.
    const cut = parseFailureLine(shortFailureLine({ file, test: "t".repeat(300), message: "boom" }));
    expect(cut?.file).toBeNull();
    expect(file.startsWith(cut?.message ?? "x")).toBe(true);
    expect(cut?.message.length).toBeGreaterThanOrEqual(40);
  });

  it("cuts the test first, then the message, never below 40 characters of message", () => {
    const file = `src/${"d".repeat(193)}.ts`;
    const line = shortFailureLine({ file, test: "t".repeat(300), message: "m".repeat(300) });
    expect(line).toHaveLength(400);
    const back = parseFailureLine(line);
    expect(back?.file).toBe(file);
    expect(back?.message).toBe("m".repeat(40));
    expect(back?.test).toBe("t".repeat(400 - "arbab-check failure: ".length - 200 - " > ".length - " :: ".length - 40));

    // A short file leaves the test whole and the message what is left.
    const roomy = parseFailureLine(shortFailureLine({ file: "src/a.ts", test: "t".repeat(200), message: "m".repeat(300) }));
    expect(roomy?.test).toBe("t".repeat(200));
    expect(roomy?.message).toBe("m".repeat(400 - "arbab-check failure: src/a.ts > ".length - 200 - " :: ".length));

    // A message shorter than 40 is kept whole, and the test gets the rest.
    const short = shortFailureLine({ file, test: "t".repeat(300), message: "boom" });
    expect(short).toHaveLength(400);
    expect(parseFailureLine(short)?.message).toBe("boom");

    expect(shortFailureLine({ file: null, test: null, message: "m".repeat(500) })).toBe(`arbab-check failure: - :: ${"m".repeat(300)}`);
  });

  it("always gives a line of at most 400 characters that reads back", () => {
    for (const file of [null, "", "f", "f".repeat(199), "f".repeat(200), "f".repeat(201), "f".repeat(1000)]) {
      for (const test of [null, "t", "t".repeat(200), "t".repeat(1000)]) {
        for (const message of ["", "m", "m".repeat(39), "m".repeat(1000)]) {
          const line = shortFailureLine({ file, test, message });
          expect(line.length).toBeLessThanOrEqual(400);
          const back = parseFailureLine(line);
          expect(back).not.toBeNull();
          if (file !== null && file !== "" && file.length <= 200) expect(back?.file).toBe(file);
          else expect(back?.file).toBeNull();
        }
      }
    }
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
  it("tells directories, and creates a log it writes through one descriptor", () => {
    expect(nodeCheckFs.isDir(cwd)).toBe(true);
    expect(nodeCheckFs.isDir(join(cwd, "missing"))).toBe(false);
    const path = join(tmp, "f.log");
    const file = nodeCheckFs.createLog(path, 0o600);
    expect(file).not.toBeNull();
    file?.write("a");
    // Renamed while open: writes still reach it, and nothing appears at the old name.
    renameSync(path, join(tmp, "g.log"));
    file?.write("é".repeat(10_000));
    file?.close();
    expect(nodeCheckFs.isDir(join(tmp, "g.log"))).toBe(false);
    expect(readFileSync(join(tmp, "g.log"), "utf8")).toBe("a" + "é".repeat(10_000));
    expect(existsSync(path)).toBe(false);
    if (process.platform !== "win32") expect(statSync(join(tmp, "g.log")).mode & 0o777).toBe(0o600);
  });

  it("returns null for a name that exists, and passes on other errors", () => {
    const path = join(tmp, "f.log");
    writeFileSync(path, "kept");
    expect(createLogFile(path, 0o600)).toBeNull();
    expect(readFileSync(path, "utf8")).toBe("kept");
    expect(() => createLogFile(join(tmp, "missing", "f.log"), 0o600)).toThrow(/ENOENT/);
  });

  it.skipIf(process.platform === "win32")("never opens through a link, to a file or dangling, and leaves both alone", () => {
    const target = join(tmp, "target.ts");
    writeFileSync(target, "original\n");
    symlinkSync(target, join(tmp, "a.log"));
    symlinkSync(join(tmp, "nowhere.ts"), join(tmp, "b.log"));
    expect(createLogFile(join(tmp, "a.log"), 0o600)).toBeNull();
    expect(createLogFile(join(tmp, "b.log"), 0o600)).toBeNull();
    expect(readFileSync(target, "utf8")).toBe("original\n");
    expect(existsSync(join(tmp, "nowhere.ts"))).toBe(false);
  });
});
