import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lastQuotaReset, readQuota, refreshArgs, type RefreshRun, type RefreshSpawn } from "../quota";
import type { ShepherdDeps } from "../shepherd";
import { exitCodeFor } from "../util/errors";
import { formatHold, runQuota } from "./quota";
import { DEFAULT_CONFIG, NOW_MS, fakeDeps, makeProject, type TestProject } from "./testkit";

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

describe("runQuota --refresh", () => {
  const EVENT = {
    type: "rate_limit_event",
    rate_limit_info: {
      status: "allowed",
      rateLimitType: "five_hour",
      unifiedWindows: {
        five_hour: { utilization: 0.1, resetsAt: nowSec + 1800 },
        seven_day: { utilization: 0.2, resetsAt: nowSec + 86_400 },
      },
    },
  };
  const STREAM = [{ type: "system", subtype: "init", session_id: "s", tools: [] }, EVENT, { type: "result", subtype: "success", result: "ok" }]
    .map((e) => JSON.stringify(e))
    .join("\n");
  const NEW_SNAPSHOT = {
    observedAt: new Date(NOW_MS).toISOString(),
    status: "allowed",
    type: "five_hour",
    fiveHour: { utilization: 0.1, resetsAt: nowSec + 1800 },
    sevenDay: { utilization: 0.2, resetsAt: nowSec + 86_400 },
  };

  interface Call {
    binary: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    input: string;
    timeoutMs: number;
  }

  /** A project whose deps find the fake claude, with a host environment the refresh must scrub. */
  function refreshProject(over: Partial<ShepherdDeps> = {}): void {
    p = makeProject();
    p.ctx.shepherdDeps = () =>
      fakeDeps(p.home, p.claudeHome, {
        nodeDir: "/opt/node/bin",
        pnpmDir: undefined,
        hostEnv: { HOME: "/home/test", PATH: "/somewhere/else", ARBAB_TEST_SECRET: "s3cret" },
        ...over,
      });
  }

  function fake(result: Partial<RefreshRun>): { spawn: RefreshSpawn; calls: Call[] } {
    const calls: Call[] = [];
    return {
      calls,
      spawn: async (binary, args, opts) => {
        calls.push({ binary, args, ...opts });
        return { code: 0, signal: null, timedOut: false, stdout: "", stderr: "", ...result };
      },
    };
  }

  function oldQuota(): string {
    // The previous account at 99%, observed after the refresh's clock: updateQuota would keep it.
    mkdirSync(p.home, { recursive: true });
    const text = JSON.stringify({
      observedAt: "2026-10-09T12:30:00.000Z",
      status: "rejected",
      type: "five_hour",
      fiveHour: { utilization: 0.99, resetsAt: nowSec + 3600 },
      sevenDay: null,
    });
    writeFileSync(join(p.home, "quota.json"), text);
    return text;
  }

  it("calls claude once on haiku with a worker's scrubbed env, replaces the snapshot and prints quota and hold", async () => {
    refreshProject();
    oldQuota();
    const f = fake({ stdout: STREAM });
    expect(await runQuota(["--refresh"], p.ctx, f.spawn)).toBe(0);

    expect(p.stdout()).toBe("quota: 5h 10% (resets 12:30Z) · 7d 20% (resets Oct 10 12:00Z)\nhold: no\n");
    expect(JSON.parse(readFileSync(join(p.home, "quota.json"), "utf8"))).toEqual(NEW_SNAPSHOT);
    expect(lastQuotaReset(p.home)).toBe(NOW_MS);

    expect(f.calls).toHaveLength(1);
    const call = f.calls[0] as Call;
    expect(call.binary).toBe("/opt/claude/bin/claude");
    expect(call.args).toEqual(refreshArgs());
    expect(call.input).toBe("Reply with the single word: ok");
    expect(call.timeoutMs).toBe(60_000);
    expect(call.cwd.startsWith(join(p.home, "tmp") + "/")).toBe(true);
    expect(existsSync(call.cwd)).toBe(false);
    expect(call.env).toMatchObject({ HOME: "/home/test", TERM: "dumb", DISABLE_AUTOUPDATER: "1" });
    expect(call.env["PATH"]?.split(":")[0]).toBe("/opt/node/bin");
    expect(call.env["PATH"]).not.toContain("/somewhere/else");
    expect(call.env).not.toHaveProperty("ARBAB_TEST_SECRET");
  });

  it("ignores the project's passEnv", async () => {
    refreshProject();
    p.write("arbab.config.json", JSON.stringify({ ...DEFAULT_CONFIG, passEnv: ["ARBAB_TEST_SECRET"] }));
    const f = fake({ stdout: STREAM });
    expect(await runQuota(["--refresh"], p.ctx, f.spawn)).toBe(0);
    expect(f.calls[0]?.env).not.toHaveProperty("ARBAB_TEST_SECRET");
  });

  it("--json prints the new snapshot and its hold", async () => {
    refreshProject();
    const f = fake({ stdout: STREAM });
    expect(await runQuota(["--refresh", "--json"], p.ctx, f.spawn)).toBe(0);
    expect(JSON.parse(p.stdout())).toEqual({ snapshot: NEW_SNAPSHOT, hold: { hold: false, reason: null, until: null } });
  });

  it("works outside any project", async () => {
    refreshProject();
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "arbab-noproj-")));
    try {
      p.ctx.cwd = outside;
      expect(await runQuota(["--refresh"], p.ctx, fake({ stdout: STREAM }).spawn)).toBe(0);
      expect(p.stdout()).toMatch(/^quota: 5h 10%/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("without a rate_limit_event exits 2 with the stderr tail and changes neither file", async () => {
    refreshProject();
    const before = oldQuota();
    const f = fake({ stdout: '{"type":"result","subtype":"success"}\n', stderr: "a note\n" });
    const err = await runQuota(["--refresh"], p.ctx, f.spawn).catch((e: unknown) => e);
    expect(exitCodeFor(err)).toBe(2);
    expect((err as Error).message).toMatch(/no rate_limit_event; .*quota\.json is unchanged\nstderr:\n {2}a note$/);
    expect(readFileSync(join(p.home, "quota.json"), "utf8")).toBe(before);
    expect(lastQuotaReset(p.home)).toBeNull();
    expect(p.stdout()).toBe("");
  });

  it("on a non-zero exit exits 2 with at most five stderr lines and changes neither file", async () => {
    refreshProject();
    const before = oldQuota();
    const f = fake({ code: 1, stdout: STREAM, stderr: ["1", "2", "3", "4", "5", "6"].map((n) => `line ${n}`).join("\n") });
    const err = await runQuota(["--refresh"], p.ctx, f.spawn).catch((e: unknown) => e);
    expect(exitCodeFor(err)).toBe(2);
    const message = (err as Error).message;
    expect(message).toMatch(/^refresh failed: claude exited with code 1;/);
    expect(message.split("\n").slice(1)).toEqual(["stderr:", "  line 2", "  line 3", "  line 4", "  line 5", "  line 6"]);
    expect(readFileSync(join(p.home, "quota.json"), "utf8")).toBe(before);
    expect(lastQuotaReset(p.home)).toBeNull();
  });

  it("on a timeout exits 2 and changes neither file", async () => {
    refreshProject();
    const before = oldQuota();
    const f = fake({ timedOut: true, code: null, signal: "SIGTERM", stdout: STREAM });
    const err = await runQuota(["--refresh"], p.ctx, f.spawn).catch((e: unknown) => e);
    expect(exitCodeFor(err)).toBe(2);
    expect((err as Error).message).toMatch(/^refresh failed: claude did not finish within 60 s;/);
    expect(readFileSync(join(p.home, "quota.json"), "utf8")).toBe(before);
    expect(lastQuotaReset(p.home)).toBeNull();
    expect(readdirSync(join(p.home, "tmp"))).toEqual([]);
  });

  it("fails with a binary error, calling nothing, when claude cannot be found", async () => {
    refreshProject({ pathEnv: "/nowhere" });
    const f = fake({ stdout: STREAM });
    await expect(runQuota(["--refresh"], p.ctx, f.spawn)).rejects.toMatchObject({ code: "binary" });
    expect(f.calls).toHaveLength(0);
  });

  it("refuses --refresh with --reset as a usage error, touching nothing", async () => {
    refreshProject();
    const before = oldQuota();
    const f = fake({ stdout: STREAM });
    await expect(runQuota(["--refresh", "--reset"], p.ctx, f.spawn)).rejects.toMatchObject({ code: "usage" });
    expect(f.calls).toHaveLength(0);
    expect(readFileSync(join(p.home, "quota.json"), "utf8")).toBe(before);
  });

  it("without an injected spawn, runs the binary through the deps' spawnImpl and reads its stdout", async () => {
    const seen: Array<{ command: string; args: readonly string[] }> = [];
    // A stand-in for claude: drains the prompt from stdin, then prints the stream.
    const script = `process.stdin.resume();process.stdin.on("end",()=>process.stdout.write(${JSON.stringify(STREAM + "\n")}))`;
    refreshProject({
      spawnImpl: (command, args, options) => {
        seen.push({ command, args });
        return spawn(process.execPath, ["-e", script], options);
      },
    });
    expect(await runQuota(["--refresh"], p.ctx)).toBe(0);
    expect(seen).toEqual([{ command: "/opt/claude/bin/claude", args: refreshArgs() }]);
    expect(readQuota(p.home)).toEqual(NEW_SNAPSHOT);
  });
});
