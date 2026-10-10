import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultDeps } from "./index";

describe("defaultDeps", () => {
  it("builds the real effects with the documented intervals", () => {
    const deps = defaultDeps();
    expect(deps.home).toBe(join(homedir(), ".arbab"));
    expect(deps.claudeHome).toBe(join(homedir(), ".claude"));
    expect(deps.nodeDir).toBe(dirname(process.execPath));
    expect(deps.pnpmDir === undefined || isAbsolute(deps.pnpmDir)).toBe(true);
    expect(deps).toMatchObject({ tickMs: 10_000, holdPollMs: 60_000, slotPollMs: 15_000, reapGraceMs: 10_000 });
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
