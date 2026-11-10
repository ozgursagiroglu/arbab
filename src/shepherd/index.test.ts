import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultDeps, execQuietly, readQuietly } from "./index";

describe("defaultDeps", () => {
  it("builds the real effects with the documented intervals", () => {
    const deps = defaultDeps();
    expect(deps.home).toBe(join(homedir(), ".arbab"));
    expect(deps.claudeHome).toBe(join(homedir(), ".claude"));
    expect(deps.nodeDir).toBe(dirname(process.execPath));
    expect(deps.pnpmDir === undefined || isAbsolute(deps.pnpmDir)).toBe(true);
    expect(deps).toMatchObject({ tickMs: 10_000, holdPollMs: 60_000, slotPollMs: 15_000, reapGraceMs: 10_000 });
    // The machine readings the admission and arbab-check use (DESIGN.md §22).
    expect(deps.cpus()).toBeGreaterThanOrEqual(1);
    expect(deps.loadAvg()).toBeGreaterThanOrEqual(0);
    // A real reading where the platform gives one; null (never holds) where the sandbox or the platform refuses it.
    expect([null, "normal", "warn", "critical"]).toContain(deps.memoryPressure());
    expect(deps.alive(process.pid)).toBe(true);
    expect(deps.clock.now()).toBeGreaterThan(0);
    const r = deps.random();
    expect(r >= 0 && r < 1).toBe(true);
  });

  it("copies the host environment instead of sharing it", () => {
    const deps = defaultDeps();
    expect(deps.hostEnv).not.toBe(process.env);
    expect(deps.pathEnv).toBe(process.env["PATH"] ?? "");
  });
});

describe("execQuietly", () => {
  it("returns a command's stdout, run by argv", () => {
    expect(execQuietly(process.execPath, ["-e", "process.stdout.write('2\\n')"])).toBe("2\n");
  });

  it("is null for a failing, missing or slow command", () => {
    expect(execQuietly(process.execPath, ["-e", "process.exit(3)"])).toBeNull();
    expect(execQuietly(join(tmpdir(), "arbab-no-such-binary"), [])).toBeNull();
    // Past the 2 s timeout.
    expect(execQuietly(process.execPath, ["-e", "setTimeout(() => {}, 10000)"])).toBeNull();
  }, 10_000);
});

describe("readQuietly", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbab-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns a file's text, and null when it cannot be read", () => {
    const file = join(dir, "memory");
    writeFileSync(file, "some avg10=1.00\n");
    expect(readQuietly(file)).toBe("some avg10=1.00\n");
    expect(readQuietly(join(dir, "missing"))).toBeNull();
    expect(readQuietly(dir)).toBeNull();
  });
});
