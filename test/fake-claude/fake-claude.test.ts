import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAlive } from "../../src/util/proc";
import { FAKE_CLAUDE, fixture, type FakeCall, type Scenario } from "./harness";

const SESSION = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

let dir: string;
let scenarioFile: string;
let logFile: string;
const leftovers: number[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arbab-fake-"));
  scenarioFile = join(dir, "scenario.json");
  logFile = join(dir, "log.jsonl");
});
afterEach(() => {
  for (const pid of leftovers.splice(0)) {
    if (isAlive(pid)) process.kill(pid, "SIGKILL");
  }
  rmSync(dir, { recursive: true, force: true });
});

function run(scenario: Scenario | null, args: string[], input = "the prompt") {
  if (scenario !== null) writeFileSync(scenarioFile, JSON.stringify(scenario));
  const env: NodeJS.ProcessEnv = { PATH: process.env["PATH"] ?? "", FAKE_CLAUDE_LOG: logFile, EXTRA_KEY: "x" };
  if (scenario !== null) env["FAKE_CLAUDE_SCENARIO"] = scenarioFile;
  return spawnSync(process.execPath, [FAKE_CLAUDE, ...args], { cwd: dir, env, input, encoding: "utf8" });
}

const calls = (): FakeCall[] =>
  readFileSync(logFile, "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as FakeCall);

const events = (stdout: string): Array<Record<string, unknown>> =>
  stdout
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>);

describe("fake claude", () => {
  it("prints the version", () => {
    const r = run(null, ["--version"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("2.1.295 (Claude Code)\n");
  });

  it("replays a named fixture under the requested session id and logs the call", () => {
    const r = run({ fixture: "budget" }, ["-p", "--session-id", SESSION]);
    expect(r.status).toBe(0);
    const out = events(r.stdout);
    expect(out.map((e) => e["type"])).toEqual(["system", "assistant", "user", "result"]);
    expect(new Set(out.map((e) => e["session_id"]))).toEqual(new Set([SESSION]));
    const [call] = calls();
    expect(call?.argv).toEqual(["-p", "--session-id", SESSION]);
    expect(call?.envKeys).toEqual(expect.arrayContaining(["EXTRA_KEY", "FAKE_CLAUDE_LOG", "FAKE_CLAUDE_SCENARIO"]));
    expect(call?.stdinBytes).toBe("the prompt".length);
    expect(call?.childPid).toBeNull();
    expect(call?.childDetached).toBeNull();
  });

  it("uses the resume fixture with --resume, touches a file and exits with the scenario's code", () => {
    const r = run(
      { fixture: "budget", resumeFixture: fixture("resume-success"), touch: "src/edited.txt", exitCode: 3 },
      ["-p", "--resume", SESSION],
    );
    expect(r.status).toBe(3);
    const out = events(r.stdout);
    expect(out.at(-1)?.["total_cost_usd"]).toBe(6.32);
    expect(out.every((e) => e["session_id"] === SESSION)).toBe(true);
    expect(readFileSync(join(dir, "src", "edited.txt"), "utf8")).toContain(SESSION);
  });

  it("replays a truncated line as it is", () => {
    const r = run({ fixture: "truncated" }, ["--session-id", SESSION]);
    expect(r.status).toBe(0);
    const lines = r.stdout.split("\n").filter((l) => l !== "");
    expect(() => JSON.parse(lines.at(-1) ?? "")).toThrow();
    expect(lines[0]).toContain(SESSION);
  });

  it("starts a detached child it does not wait for", () => {
    const r = run({ fixture: "budget", spawnChild: true }, ["--session-id", SESSION]);
    expect(r.status).toBe(0);
    const child = calls()[0]?.childPid;
    expect(typeof child).toBe("number");
    leftovers.push(child as number);
    expect(isAlive(child as number)).toBe(true);
    expect(calls()[0]?.childDetached).toBe(true);
  });

  it("starts a child in the fake's process group with spawnChild \"group\"", () => {
    const r = run({ fixture: "budget", spawnChild: "group" }, ["--session-id", SESSION]);
    expect(r.status).toBe(0);
    const [call] = calls();
    leftovers.push(call?.childPid as number);
    expect(isAlive(call?.childPid as number)).toBe(true);
    expect(call?.childDetached).toBe(false);
  });

  it("hangs after the last line when hangMs is -1", async () => {
    writeFileSync(scenarioFile, JSON.stringify({ fixture: "budget", hangMs: -1 }));
    const env = { PATH: process.env["PATH"] ?? "", FAKE_CLAUDE_SCENARIO: scenarioFile, FAKE_CLAUDE_LOG: logFile };
    const child = spawn(process.execPath, [FAKE_CLAUDE, "--session-id", SESSION], { cwd: dir, env, stdio: ["ignore", "pipe", "ignore"] });
    let text = "";
    child.stdout.on("data", (chunk: Buffer) => (text += chunk.toString("utf8")));
    const exited = new Promise<string | null>((done) => child.once("exit", (_code, signal) => done(signal)));
    const deadline = Date.now() + 5_000;
    while (!text.includes('"type":"result"') && Date.now() < deadline) await new Promise((d) => setTimeout(d, 10));
    expect(text).toContain('"type":"result"');
    await new Promise((d) => setTimeout(d, 100));
    expect(child.exitCode).toBeNull();
    child.kill("SIGTERM");
    expect(await exited).toBe("SIGTERM");
  });

  it("fails without a scenario", () => {
    const r = run(null, ["--session-id", SESSION]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/FAKE_CLAUDE_SCENARIO/);
    expect(existsSync(logFile)).toBe(false);
  });
});
