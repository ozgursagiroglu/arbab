import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SpawnImpl } from "../run";
import type { RateLimitSnapshot } from "../types";
import { lastQuotaReset, readQuota } from "./quota";
import { REFRESH_PROMPT, makeRefreshSpawn, refreshArgs, refreshQuota, stderrTail, type RefreshRun, type RefreshSpawn } from "./refresh";

const NOW_MS = Date.parse("2026-10-09T12:00:00.000Z");
const clock = { now: () => NOW_MS };
const nowSec = Math.floor(NOW_MS / 1000);

const EVENT = {
  type: "rate_limit_event",
  rate_limit_info: {
    status: "allowed",
    rateLimitType: "five_hour",
    unifiedWindows: {
      five_hour: { utilization: 0.12, resetsAt: nowSec + 3600 },
      seven_day: { utilization: 0.3, resetsAt: nowSec + 86_400 },
    },
  },
};

const stream = (...events: unknown[]): string => events.map((e) => JSON.stringify(e)).join("\n") + "\n";
const INIT = { type: "system", subtype: "init", session_id: "s", tools: [] };
const RESULT = { type: "result", subtype: "success", is_error: false, result: "ok" };

const OLD: RateLimitSnapshot = {
  // Newer than the clock: the previous account's last reading, which updateQuota would keep.
  observedAt: "2026-10-09T13:00:00.000Z",
  status: "allowed",
  type: null,
  fiveHour: { utilization: 0.99, resetsAt: nowSec + 1800 },
  sevenDay: null,
};

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "arbab-refresh-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

function writeOld(): string {
  const text = JSON.stringify(OLD);
  writeFileSync(join(home, "quota.json"), text);
  return text;
}

interface Call {
  binary: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  input: string;
  timeoutMs: number;
  cwdExisted: boolean;
}

function fake(result: Partial<RefreshRun>): { spawn: RefreshSpawn; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    spawn: async (binary, args, opts) => {
      calls.push({ binary, args, ...opts, cwdExisted: existsSync(opts.cwd) });
      return { code: 0, signal: null, timedOut: false, stdout: "", stderr: "", ...result };
    },
  };
}

const ENV = { HOME: "/home/test", PATH: "/usr/bin" };

describe("refreshArgs", () => {
  it("is one haiku turn with no tools, no setting sources and no MCP servers", () => {
    expect(refreshArgs()).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--model",
      "haiku",
      "--max-turns",
      "1",
      "--tools",
      "",
      "--setting-sources",
      "",
      "--strict-mcp-config",
    ]);
  });
});

describe("stderrTail", () => {
  it("keeps the last five non-empty lines", () => {
    expect(stderrTail("a\n\nb\nc\n  \nd\ne\nf\ng\n")).toEqual(["c", "d", "e", "f", "g"]);
    expect(stderrTail("")).toEqual([]);
  });

  it("cuts a very long line", () => {
    const [line] = stderrTail("x".repeat(2000));
    expect(line).toBe(`${"x".repeat(500)}…`);
  });
});

describe("refreshQuota", () => {
  it("replaces an even newer snapshot with the current account's and records the switch", async () => {
    writeOld();
    const f = fake({ stdout: stream(INIT, EVENT, RESULT) });
    const snapshot = await refreshQuota({ home, binary: "/opt/claude/bin/claude", env: ENV, clock, spawn: f.spawn });

    const expected: RateLimitSnapshot = {
      observedAt: "2026-10-09T12:00:00.000Z",
      status: "allowed",
      type: "five_hour",
      fiveHour: { utilization: 0.12, resetsAt: nowSec + 3600 },
      sevenDay: { utilization: 0.3, resetsAt: nowSec + 86_400 },
    };
    expect(snapshot).toEqual(expected);
    expect(readQuota(home)).toEqual(expected);
    expect(lastQuotaReset(home)).toBe(NOW_MS);

    expect(f.calls).toHaveLength(1);
    const call = f.calls[0] as Call;
    expect(call).toMatchObject({ binary: "/opt/claude/bin/claude", args: refreshArgs(), env: ENV, input: REFRESH_PROMPT, timeoutMs: 60_000 });
    expect(REFRESH_PROMPT).toBe("Reply with the single word: ok");
    // A fresh directory under <home>/tmp, there during the call and gone after.
    expect(call.cwd.startsWith(join(home, "tmp") + "/")).toBe(true);
    expect(call.cwdExisted).toBe(true);
    expect(existsSync(call.cwd)).toBe(false);
    expect(readdirSync(join(home, "tmp"))).toEqual([]);
  });

  it("takes the last rate_limit_event of the stream and ignores unknown events and broken lines", async () => {
    const later = { ...EVENT, rate_limit_info: { ...EVENT.rate_limit_info, status: "allowed_warning" } };
    const f = fake({ stdout: `${stream({ type: "brand_new" }, EVENT)}{"cut\n${stream(later)}` });
    const snapshot = await refreshQuota({ home, binary: "/b", env: ENV, clock, spawn: f.spawn });
    expect(snapshot.status).toBe("allowed_warning");
  });

  it("without a rate_limit_event, fails with the stderr tail and changes neither file", async () => {
    const before = writeOld();
    const f = fake({ stdout: stream(INIT, RESULT), stderr: "warming up\n" });
    const err = await refreshQuota({ home, binary: "/b", env: ENV, clock, spawn: f.spawn }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "runtime" });
    expect((err as Error).message).toBe(
      `refresh failed: claude's stream had no rate_limit_event; ${join(home, "quota.json")} is unchanged\nstderr:\n  warming up`,
    );
    expect(readFileSync(join(home, "quota.json"), "utf8")).toBe(before);
    expect(lastQuotaReset(home)).toBeNull();
    expect(readdirSync(join(home, "tmp"))).toEqual([]);
  });

  it("on a non-zero exit, fails with at most five stderr lines even when the stream has an event", async () => {
    const f = fake({ code: 1, stdout: stream(EVENT), stderr: "l1\nl2\nl3\nl4\nl5\nl6\nl7\n" });
    const err = await refreshQuota({ home, binary: "/b", env: ENV, clock, spawn: f.spawn }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "runtime" });
    const lines = (err as Error).message.split("\n");
    expect(lines[0]).toMatch(/^refresh failed: claude exited with code 1; /);
    expect(lines.slice(1)).toEqual(["stderr:", "  l3", "  l4", "  l5", "  l6", "  l7"]);
    expect(existsSync(join(home, "quota.json"))).toBe(false);
    expect(lastQuotaReset(home)).toBeNull();
  });

  it("names the signal of a killed claude and says when stderr was empty", async () => {
    const f = fake({ code: null, signal: "SIGKILL" });
    await expect(refreshQuota({ home, binary: "/b", env: ENV, clock, spawn: f.spawn })).rejects.toThrow(
      /claude exited with signal SIGKILL; .*\nstderr:\n {2}\(stderr empty\)$/,
    );
  });

  it("on a timeout, fails and changes neither file", async () => {
    const before = writeOld();
    const f = fake({ timedOut: true, code: null, signal: "SIGTERM", stdout: stream(EVENT), stderr: "slow\n" });
    const err = await refreshQuota({ home, binary: "/b", env: ENV, clock, spawn: f.spawn }).catch((e: unknown) => e);
    expect((err as Error).message).toMatch(/^refresh failed: claude did not finish within 60 s; .*\nstderr:\n {2}slow$/);
    expect(readFileSync(join(home, "quota.json"), "utf8")).toBe(before);
    expect(lastQuotaReset(home)).toBeNull();
  });

  it("passes its timeout on and removes the working directory when the spawn rejects", async () => {
    let seen = 0;
    let cwd = "";
    const spawnFn: RefreshSpawn = async (_b, _a, opts) => {
      seen = opts.timeoutMs;
      cwd = opts.cwd;
      throw new Error("boom");
    };
    await expect(refreshQuota({ home, binary: "/b", env: ENV, clock, spawn: spawnFn, timeoutMs: 5000 })).rejects.toThrow("boom");
    expect(seen).toBe(5000);
    expect(existsSync(cwd)).toBe(false);
  });

  it("refuses with an io error when <home>/tmp cannot hold a directory", async () => {
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "tmp"), "a file, not a directory");
    const f = fake({ stdout: stream(EVENT) });
    await expect(refreshQuota({ home, binary: "/b", env: ENV, clock, spawn: f.spawn })).rejects.toMatchObject({ code: "io" });
    expect(f.calls).toHaveLength(0);
  });
});

/** A spawnImpl that runs `script` under this node instead of the binary it is given. */
function nodeScript(script: string): SpawnImpl {
  return (_command, _args, options) => spawn(process.execPath, ["-e", script], options);
}

describe("makeRefreshSpawn", () => {
  it("feeds the input on stdin and collects stdout, stderr, cwd and env", async () => {
    const cwd = mkdtempSync(join(home, "cwd-"));
    const script =
      'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{' +
      "process.stdout.write(JSON.stringify({s,cwd:process.cwd(),v:process.env.ARBAB_T}));process.stderr.write(\"note\\n\")})";
    const run = await makeRefreshSpawn(nodeScript(script))("/b", [], { cwd, env: { ARBAB_T: "1" }, input: "hello", timeoutMs: 10_000 });
    expect(run).toMatchObject({ code: 0, signal: null, timedOut: false, stderr: "note\n" });
    const out = JSON.parse(run.stdout) as { s: string; cwd: string; v: string };
    expect(out.s).toBe("hello");
    expect(out.v).toBe("1");
    expect(out.cwd.endsWith(cwd.slice(cwd.lastIndexOf("/")))).toBe(true);
  });

  it("reports a non-zero exit", async () => {
    const run = await makeRefreshSpawn(nodeScript('process.stderr.write("bad\\n");process.exit(3)'))("/b", [], {
      cwd: home,
      env: {},
      input: "",
      timeoutMs: 10_000,
    });
    expect(run).toMatchObject({ code: 3, timedOut: false, stderr: "bad\n" });
  });

  it("kills a claude that runs past the timeout", async () => {
    const run = await makeRefreshSpawn(nodeScript("setInterval(()=>{},1000)"), 100)("/b", [], { cwd: home, env: {}, input: "", timeoutMs: 200 });
    expect(run).toMatchObject({ timedOut: true, code: null, signal: "SIGTERM" });
  });

  it("sends SIGKILL when SIGTERM is ignored", async () => {
    const script = 'process.on("SIGTERM",()=>{});process.stdout.write("ready");setInterval(()=>{},1000)';
    // Long enough for node to start and install its handler before the SIGTERM.
    const run = await makeRefreshSpawn(nodeScript(script), 200)("/b", [], { cwd: home, env: {}, input: "", timeoutMs: 2000 });
    expect(run).toMatchObject({ timedOut: true, code: null, signal: "SIGKILL", stdout: "ready" });
  });

  it("resolves instead of rejecting when the binary cannot start", async () => {
    const missing = await makeRefreshSpawn(spawn)(join(home, "no-such-claude"), [], { cwd: home, env: {}, input: "x", timeoutMs: 10_000 });
    expect(missing).toMatchObject({ code: null, timedOut: false });
    expect(missing.stderr).toMatch(/ENOENT/);

    const throwing: SpawnImpl = () => {
      throw new Error("no spawn here");
    };
    const thrown = await makeRefreshSpawn(throwing)("/b", [], { cwd: home, env: {}, input: "", timeoutMs: 10_000 });
    expect(thrown).toEqual({ code: null, signal: null, timedOut: false, stdout: "", stderr: "cannot start /b: no spawn here" });
  });
});
