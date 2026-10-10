import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lastQuotaReset } from "../quota";
import { formatHold, runQuota } from "./quota";
import { NOW_MS, makeProject, type TestProject } from "./testkit";

let p: TestProject;
afterEach(() => p?.dispose());

const nowSec = Math.floor(NOW_MS / 1000);

function writeQuota(home: string, fiveHour: number): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, "quota.json"),
    JSON.stringify({
      observedAt: "2026-10-09T11:00:00.000Z",
      status: "allowed",
      type: null,
      fiveHour: { utilization: fiveHour, resetsAt: nowSec + 1800 },
      sevenDay: { utilization: 0.5, resetsAt: nowSec + 86_400 },
    }),
  );
}

describe("formatHold", () => {
  it("says no, or yes with reason and time", () => {
    expect(formatHold({ hold: false, reason: null, until: null })).toBe("hold: no");
    expect(formatHold({ hold: true, reason: "r", until: 0 })).toBe("hold: yes — r (until 1970-01-01T00:00:00.000Z)");
    expect(formatHold({ hold: true, reason: null, until: null })).toBe("hold: yes — unknown");
  });
});

describe("runQuota", () => {
  it("prints the snapshot and a hold under the project's thresholds", async () => {
    p = makeProject({ config: { quota: { holdAbove: { fiveHour: 0.5 } } } });
    writeQuota(p.home, 0.6);
    expect(await runQuota([], p.ctx)).toBe(0);
    const [quota, hold] = p.stdout().trimEnd().split("\n");
    expect(quota).toBe("quota: 5h 60% (resets 12:30Z) · 7d 50% (resets Oct 10 12:00Z)");
    expect(hold).toMatch(/^hold: yes — five-hour window at 60% \(hold above 50%\)/);
  });

  it("prints --json with snapshot and hold", async () => {
    p = makeProject();
    writeQuota(p.home, 0.6);
    expect(await runQuota(["--json"], p.ctx)).toBe(0);
    const out = JSON.parse(p.stdout()) as { snapshot: { fiveHour: unknown }; hold: unknown };
    expect(Object.keys(out)).toEqual(["snapshot", "hold"]);
    expect(out.hold).toEqual({ hold: false, reason: null, until: null });
  });

  it("works outside any project with the default thresholds and no snapshot", async () => {
    p = makeProject();
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "arbab-noproj-")));
    try {
      p.ctx.cwd = outside;
      expect(await runQuota([], p.ctx)).toBe(0);
      expect(p.stdout()).toBe("quota: quota unknown\nhold: no\n");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("--reset deletes the snapshot and says so; then the quota is unknown", async () => {
    p = makeProject();
    writeQuota(p.home, 0.99);
    expect(await runQuota(["--reset"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe(`quota: snapshot ${join(p.home, "quota.json")} removed; the next worker's rate-limit events write a fresh one\n`);
    expect(existsSync(join(p.home, "quota.json"))).toBe(false);
    p.out.length = 0;
    expect(await runQuota([], p.ctx)).toBe(0);
    expect(p.stdout()).toBe("quota: quota unknown\nhold: no\n");
  });

  it("--reset without a snapshot reports that, and --json says whether it removed one", async () => {
    p = makeProject();
    expect(await runQuota(["--reset"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe(`quota: no snapshot at ${join(p.home, "quota.json")}\n`);
    writeQuota(p.home, 0.5);
    p.out.length = 0;
    expect(await runQuota(["--reset", "--json"], p.ctx)).toBe(0);
    expect(JSON.parse(p.stdout())).toEqual({ reset: true, removed: true, path: join(p.home, "quota.json") });
  });

  it("--reset records when it ran, so a lane waiting out a usage limit resumes early", async () => {
    p = makeProject();
    expect(lastQuotaReset(p.home)).toBeNull();
    writeQuota(p.home, 0.99);
    expect(await runQuota(["--reset"], p.ctx)).toBe(0);
    expect(lastQuotaReset(p.home)).toBe(p.ctx.clock.now());
  });

  it("rejects positionals and unknown flags", async () => {
    p = makeProject();
    await expect(runQuota(["now"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runQuota(["--raw"], p.ctx)).rejects.toMatchObject({ code: "usage" });
  });
});
