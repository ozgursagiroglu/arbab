// 0.3.0 end to end (DESIGN.md §22): the built arbab-check bundle run by itself, its wiring into an attempt by a real
// shepherd, and launch admission by machine load, through the real bundles and the fake claude.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { checkCommandLine, checkScriptPath } from "../../src/check/command";
import type { LaneStateRecord } from "../../src/types";
import { commandLine } from "../../src/util/shell";
import { buildBundle, fakeFixture, MACHINE_ADMISSION_OFF, makeE2eProject, until, type CliResult, type E2eProject } from "./harness";

let bundle: { bundle: string; checkBundle: string; dispose(): void };
let p: E2eProject | undefined;

beforeAll(async () => {
  bundle = await buildBundle();
}, 60_000);
afterAll(() => bundle?.dispose());
afterEach(() => {
  p?.dispose();
  p = undefined;
});

/** A temporary working directory with `.arbab-tmp/`, a registry directory (the check's TMPDIR) and the check scripts. */
interface CheckDir {
  work: string;
  registry: string;
  scripts: string;
  dispose(): void;
}

function checkDir(): CheckDir {
  const dir = mkdtempSync(join(tmpdir(), "arbab-e2e-check-"));
  const work = join(dir, "work");
  const registry = join(dir, "registry");
  const scripts = join(dir, "scripts");
  for (const d of [join(work, ".arbab-tmp"), registry, scripts]) mkdirSync(d, { recursive: true });
  return { work, registry, scripts, dispose: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Runs `node <check bundle> …args` in `cwd` with only the env arbab-check reads, without a shell. */
function runCheckBundle(cwd: string, env: Record<string, string>, ...args: string[]): Promise<CliResult> {
  return new Promise((done) => {
    execFile(process.execPath, [bundle.checkBundle, ...args], { cwd, env, encoding: "utf8", timeout: 60_000 }, (err, stdout, stderr) => {
      done({ code: err === null ? 0 : typeof err.code === "number" ? err.code : -1, stdout, stderr });
    });
  });
}

const checkEnv = (d: CheckDir, checks: Record<string, string[]>, policy: { cpus: number; concurrent: number; waitSec: number }): Record<string, string> => ({
  PATH: process.env["PATH"] ?? "",
  ARBAB_CHECKS: JSON.stringify(checks),
  ARBAB_CHECK_POLICY: JSON.stringify(policy),
  TMPDIR: d.registry,
});

// What a failing vitest run prints, then an error line on stderr; one write, so the order is fixed.
const FAILING_OUTPUT = [
  " RUN  v5.0.3 /work",
  "",
  " FAIL  src/a.test.ts > greets > says hello",
  "AssertionError: expected 'hi' to be 'hello'",
  " FAIL  src/b.test.ts > counts",
  "Error: expected 2 to be 3",
  " Test Files  2 failed (2)",
  "      Tests  2 failed (2)",
];
const FAILING = `process.stdout.write(${JSON.stringify(FAILING_OUTPUT.join("\n") + "\n")});\nprocess.stderr.write("Error: 2 tests failed\\n");\nprocess.exitCode = 1;\n`;
const PASSING =
  'process.stdout.write(`VITEST_MAX_WORKERS=${process.env.VITEST_MAX_WORKERS}\\nARBAB_CHECK_CPUS=${process.env.ARBAB_CHECK_CPUS}\\nargv=${process.argv.slice(2).join(" ")}\\n`);\n';
// Writes the file its first argument names once it runs, then takes a second and a half.
const SLOW = 'require("node:fs").writeFileSync(process.argv[2], "");\nsetTimeout(() => process.stdout.write("slow done\\n"), 1500);\n';
// 50 vitest failures with long names and messages, then 100 lines of 5000 characters; one write, exit 1.
const HUGE =
  'const f = Array.from({ length: 50 }, (_, i) => ` FAIL  src/${"d".repeat(300)}${i}.test.ts > ${"s".repeat(300)}\\nError: ${"m".repeat(3000)}\\n`).join("");\n' +
  'process.stdout.write(f + `${"x".repeat(5000)}\\n`.repeat(100));\nprocess.exitCode = 1;\n';

describe("arbab-check by itself", () => {
  it("summarises a failing check: the failures, the tail and the full log, exit 1", async () => {
    const d = checkDir();
    try {
      writeFileSync(join(d.scripts, "fail.cjs"), FAILING);
      const env = checkEnv(d, { unit: [process.execPath, join(d.scripts, "fail.cjs")] }, { cpus: 5, concurrent: 2, waitSec: 120 });
      const r = await runCheckBundle(d.work, env, "unit");
      expect(r.code, r.stderr).toBe(1);
      const lines = r.stdout.split("\n");
      expect(lines[0]).toMatch(/^arbab-check unit: exit 1 after \d+\.\ds on 4 CPUs; log \.arbab-tmp\/checks\/unit-1\.log$/);
      expect(lines.slice(1, 3)).toEqual([
        "arbab-check failure: src/a.test.ts > greets > says hello :: AssertionError: expected 'hi' to be 'hello'",
        "arbab-check failure: src/b.test.ts > counts :: Error: expected 2 to be 3",
      ]);
      // The child's 8 stdout lines and its stderr line, all of them under the 60 a failure shows and well within the
      // 3800 characters of stdout. The two pipes may arrive in either order.
      expect(lines[3]).toBe("--- last 9 lines ---");
      expect(lines.slice(4, 13).sort()).toEqual([...FAILING_OUTPUT, "Error: 2 tests failed"].sort());
      expect(lines.slice(13)).toEqual([""]);
      expect(r.stdout).not.toContain("more failures");
      expect(r.stdout.length).toBeLessThanOrEqual(3800);
      const log = readFileSync(join(d.work, ".arbab-tmp", "checks", "unit-1.log"), "utf8");
      for (const line of [...FAILING_OUTPUT, "Error: 2 tests failed"]) expect(log).toContain(`${line}\n`);
      expect(log.length).toBe(FAILING_OUTPUT.join("\n").length + 1 + "Error: 2 tests failed\n".length);
      expect(readdirSync(join(d.registry, "arbab-checks"))).toEqual([]);
    } finally {
      d.dispose();
    }
  }, 60_000);

  it("keeps a huge failing run's stdout within 3800 characters, counting the failures left out, and logs it all", async () => {
    const d = checkDir();
    try {
      writeFileSync(join(d.scripts, "huge.cjs"), HUGE);
      const env = checkEnv(d, { unit: [process.execPath, join(d.scripts, "huge.cjs")] }, { cpus: 5, concurrent: 2, waitSec: 120 });
      const r = await runCheckBundle(d.work, env, "unit");
      expect(r.code, r.stderr).toBe(1);
      expect(r.stdout.length).toBeLessThanOrEqual(3800);
      const lines = r.stdout.split("\n");
      expect(lines[0]).toMatch(/^arbab-check unit: exit 1 after \d+\.\ds on 4 CPUs; log \.arbab-tmp\/checks\/unit-1\.log$/);
      const failures = lines.filter((l) => l.startsWith("arbab-check failure: "));
      expect(failures.length).toBeGreaterThan(0);
      expect(lines.slice(1, 1 + failures.length)).toEqual(failures);
      for (const line of failures) {
        expect(line.length).toBeLessThanOrEqual(200);
        expect(line).toMatch(/^arbab-check failure: src\/d+ > s+ :: Error: m+$/);
      }
      expect(failures.reduce((n, l) => n + l.length + 1, 0)).toBeLessThanOrEqual(2000);
      expect(lines[1 + failures.length]).toBe(`arbab-check: ${50 - failures.length} more failures in the log`);
      // The marker counts the tail lines actually printed: the newest, each cut to 240 characters.
      const marker = lines[2 + failures.length] ?? "";
      const tail = lines.slice(3 + failures.length, -1);
      expect(marker).toBe(`--- last ${tail.length} lines ---`);
      expect(tail.length).toBeGreaterThan(0);
      expect(tail.length).toBeLessThan(60);
      for (const line of tail) expect(line).toBe("x".repeat(240));
      expect(lines.at(-1)).toBe("");
      const log = readFileSync(join(d.work, ".arbab-tmp", "checks", "unit-1.log"), "utf8");
      expect(log.split("\n").filter((l) => l.startsWith(" FAIL  "))).toHaveLength(50);
      expect(log.endsWith(`${"x".repeat(5000)}\n`.repeat(100))).toBe(true);
      expect(readdirSync(join(d.registry, "arbab-checks"))).toEqual([]);
    } finally {
      d.dispose();
    }
  }, 60_000);

  it("passes its share to a passing check through the env and {cpus}, exit 0", async () => {
    const d = checkDir();
    try {
      writeFileSync(join(d.scripts, "pass.cjs"), PASSING);
      // Alone on 9 CPUs: share = max(1, floor((9 − 1) / (0 + 1))) = 8.
      const env = checkEnv(d, { unit: [process.execPath, join(d.scripts, "pass.cjs"), "--maxWorkers={cpus}"] }, { cpus: 9, concurrent: 2, waitSec: 120 });
      const r = await runCheckBundle(d.work, env, "unit", "--extra");
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toMatch(/^arbab-check unit: exit 0 after \d+\.\ds on 8 CPUs; log \.arbab-tmp\/checks\/unit-1\.log\n/);
      expect(r.stdout.split("\n").slice(1)).toEqual(["--- last 3 lines ---", "VITEST_MAX_WORKERS=8", "ARBAB_CHECK_CPUS=8", "argv=--maxWorkers=8 --extra", ""]);
      expect(r.stdout).not.toContain("arbab-check failure:");

      // A second run takes the next log number.
      const again = await runCheckBundle(d.work, env, "unit");
      expect(again.code, again.stderr).toBe(0);
      expect(again.stdout).toContain("log .arbab-tmp/checks/unit-2.log");
      expect(readdirSync(join(d.work, ".arbab-tmp", "checks")).sort()).toEqual(["unit-1.log", "unit-2.log"]);
    } finally {
      d.dispose();
    }
  }, 60_000);

  it("makes a second run wait for the only place, and leaves the registry empty", async () => {
    const d = checkDir();
    try {
      writeFileSync(join(d.scripts, "slow.cjs"), SLOW);
      const started = join(d.scripts, "first-started");
      const env = checkEnv(d, { slow: [process.execPath, join(d.scripts, "slow.cjs")] }, { cpus: 4, concurrent: 1, waitSec: 2 });
      const first = runCheckBundle(d.work, env, "slow", started);
      // Once the first one's child runs, the first has registered and counted: the second sees it.
      await until(() => (existsSync(started) ? true : undefined), 30_000, "the first check to start");
      expect(readdirSync(join(d.registry, "arbab-checks"))).toHaveLength(1);
      const second = runCheckBundle(d.work, env, "slow", join(d.scripts, "second-started"));
      const [a, b] = await Promise.all([first, second]);

      expect(a.code, a.stderr).toBe(0);
      expect(b.code, b.stderr).toBe(0);
      expect(a.stdout).not.toContain("waiting");
      expect(b.stdout.split("\n")[0]).toBe("arbab-check: waiting for one of 1 places (1 checks running)");
      for (const r of [a, b]) expect(r.stdout).toMatch(/arbab-check slow: exit 0 after .*\n--- last 1 lines ---\nslow done\n$/);
      expect(readdirSync(join(d.registry, "arbab-checks"))).toEqual([]);
    } finally {
      d.dispose();
    }
  }, 60_000);

  it("refuses an unknown name with exit 2, listing the names", async () => {
    const d = checkDir();
    try {
      const env = checkEnv(d, { unit: [process.execPath, "-v"], lint: [process.execPath, "-v"] }, { cpus: 4, concurrent: 1, waitSec: 2 });
      const r = await runCheckBundle(d.work, env, "nope");
      expect(r.code).toBe(2);
      expect(r.stdout).toBe("");
      expect(r.stderr).toBe('arbab-check: unknown check "nope"; configured checks: unit, lint\n');
      expect(existsSync(join(d.work, ".arbab-tmp", "checks"))).toBe(false);
    } finally {
      d.dispose();
    }
  }, 60_000);
});

const CHECKS = { test: ["pnpm", "test"], typecheck: ["pnpm", "typecheck"] };

/** Adds `fields` to the project's config and commits it. */
function configure(project: E2eProject, fields: Record<string, unknown>): void {
  const path = join(project.root, "arbab.config.json");
  const config = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  writeFileSync(path, JSON.stringify({ ...config, ...fields }, null, 2));
  project.git(["add", "--", "arbab.config.json"]);
  project.git(["commit", "-q", "-m", "config"]);
}

async function launchAndWait(project: E2eProject, lanePath: string, lane: string): Promise<void> {
  const launch = await project.cli("launch", lanePath);
  expect(launch.code, launch.stderr).toBe(0);
  const wait = await project.cli("wait", "--any", "--timeout-min", "2", "--json", lane);
  expect(wait.code, wait.stderr).toBe(0);
  expect((JSON.parse(wait.stdout) as { finished: unknown[] }).finished).toEqual([expect.objectContaining({ lane, attempt: 1 })]);
}

interface Settings {
  env?: Record<string, string>;
  permissions: { allow: string[] };
}

describe("arbab-check's wiring end to end", () => {
  it("gives an implementer lane the env, the rules, the tool-belt line and the script's copy, and a reviewer none", async () => {
    p = makeE2eProject(bundle.bundle);
    const project = p;
    configure(project, { checks: CHECKS });
    project.machine({ ...MACHINE_ADMISSION_OFF, checks: { concurrent: 3, waitSec: 30 } });
    project.scenario({ fixture: fakeFixture("success-report") });

    await launchAndWait(project, project.lane("impl"), "impl");
    const script = checkScriptPath(project.runsRoot, "impl");
    expect(script).toBe(join(project.laneDir("impl"), "bin", "arbab-check.mjs"));
    expect(readFileSync(script, "utf8")).toBe(readFileSync(bundle.checkBundle, "utf8"));
    const settings = project.json<Settings>(join(project.attemptDir("impl", 1), "settings.json"));
    expect(JSON.parse(settings.env?.["ARBAB_CHECKS"] ?? "null")).toEqual(CHECKS);
    expect(JSON.parse(settings.env?.["ARBAB_CHECK_POLICY"] ?? "null")).toEqual({ cpus: availableParallelism(), concurrent: 3, waitSec: 30 });
    for (const name of Object.keys(CHECKS)) {
      const line = checkCommandLine(script, name);
      expect(line).toBe(`node ${script} ${name}`);
      expect(settings.permissions.allow).toEqual(expect.arrayContaining([`Bash(${line})`, `Bash(${line} *)`]));
    }
    const brief = readFileSync(join(project.attemptDir("impl", 1), "brief.md"), "utf8");
    expect(brief).toContain(`- Heavy checks: run each one once, before you report, with \`${commandLine(["node", script])} <name>\` (names: \`test\`, \`typecheck\`).`);

    await launchAndWait(project, project.lane("rev", undefined, { role: "reviewer" }), "rev");
    const reviewer = project.json<Settings>(join(project.attemptDir("rev", 1), "settings.json"));
    expect(Object.keys(reviewer.env ?? {})).not.toContain("ARBAB_CHECKS");
    expect(Object.keys(reviewer.env ?? {})).not.toContain("ARBAB_CHECK_POLICY");
    expect(reviewer.permissions.allow.filter((rule) => rule.includes("arbab-check"))).toEqual([]);
    const reviewerBrief = readFileSync(join(project.attemptDir("rev", 1), "brief.md"), "utf8");
    expect(reviewerBrief).not.toContain("Heavy checks");
    expect(reviewerBrief).not.toContain("arbab-check");
    expect(existsSync(join(project.laneDir("rev"), "bin"))).toBe(false);
  }, 240_000);
});

describe("launch admission by machine load end to end", () => {
  it("holds a lane while the load per CPU is over machine.json's threshold, and releases it once admission is off", async () => {
    p = makeE2eProject(bundle.bundle);
    const project = p;
    // Any machine running these tests has a one-minute load above 0.001 per CPU.
    project.machine({ admission: { loadPerCpu: 0.001, memoryPressure: "off" } });
    project.scenario({ fixture: fakeFixture("success-report") });
    const launch = await project.cli("launch", project.lane("busy"));
    expect(launch.code, launch.stderr).toBe(0);

    const stateFile = join(project.laneDir("busy"), "state.json");
    const held = await until(
      () => {
        const s = project.json<LaneStateRecord>(stateFile);
        return s.state === "held" ? s : undefined;
      },
      30_000,
      "the lane to be held",
    );
    expect(held.reason).toMatch(new RegExp(`^machine load \\d+\\.\\d on ${availableParallelism()} CPUs$`));
    const status = await project.cli("status", "--json");
    expect(status.code, status.stderr).toBe(0);
    expect((JSON.parse(status.stdout) as { lanes: unknown[] }).lanes).toEqual([expect.objectContaining({ lane: "busy", state: "held" })]);
    expect(project.calls()).toEqual([]);

    // The held shepherd reads machine.json again at its next poll.
    project.machine(MACHINE_ADMISSION_OFF);
    const wait = await project.cli("wait", "--any", "--timeout-min", "2", "--json", "busy");
    expect(wait.code, wait.stderr).toBe(0);
    expect((JSON.parse(wait.stdout) as { finished: unknown[] }).finished).toEqual([expect.objectContaining({ lane: "busy", attempt: 1, endState: "success" })]);
    expect(project.calls()).toHaveLength(1);
  }, 240_000);
});
