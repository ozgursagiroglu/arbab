// The M1 runner end to end: the real bundle, a detached shepherd, a worktree and the fake claude as the worker.
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { BRIEF, buildBundle, exists, fakeFixture, makeE2eProject, psWorks, streamFixture, until, type E2eProject } from "./harness";

let bundle: { bundle: string; dispose(): void };
let p: E2eProject | undefined;

beforeAll(async () => {
  bundle = await buildBundle();
}, 60_000);
afterAll(() => bundle?.dispose());
afterEach(() => {
  p?.dispose();
  p = undefined;
});

interface Launched {
  lane: string;
  runDir: string;
  shepherdPid: number;
  mode: string;
}
interface Finished {
  lane: string;
  attempt: number | null;
  state: string;
  endState: string;
  reason: string | null;
  report: string | null;
}

const ATTEMPT_FILES = ["args.json", "brief.md", "exit.json", "settings.json", "started.json", "stderr.log", "stream.jsonl", "summary.json"];

/** The value that follows `flag` in argv. */
const after = (argv: string[], flag: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
};

async function launch(project: E2eProject, lanePath: string): Promise<Launched> {
  const r = await project.cli("launch", "--json", lanePath);
  expect(r.code, r.stderr).toBe(0);
  return JSON.parse(r.stdout) as Launched;
}

async function waitAny(project: E2eProject): Promise<Finished[]> {
  const r = await project.cli("wait", "--any", "--timeout-min", "2", "--json");
  expect(r.code, r.stderr).toBe(0);
  const out = JSON.parse(r.stdout) as { timedOut: boolean; finished: Finished[] };
  expect(out.timedOut).toBe(false);
  return out.finished;
}

/** A stream that starts a session and never finishes it: the worker then hangs until it is killed. */
function hangingScenario(project: E2eProject): void {
  const init = readFileSync(fakeFixture("success-report"), "utf8").split("\n")[0] ?? "";
  const fixture = join(project.dir, "hang.jsonl");
  writeFileSync(fixture, `${init}\n`);
  project.scenario({ fixture, hangMs: -1 });
}

describe("arbab end to end", () => {
  it("launches, waits and reports a successful lane with its checkpoint, through the fenced argv and a scrubbed env", async () => {
    p = makeE2eProject(bundle.bundle);
    const project = p;
    project.scenario({ fixture: fakeFixture("success-report"), touch: "src/a.ts" });
    const launched = await launch(project, project.lane("demo"));
    expect(launched).toMatchObject({ lane: "demo", runDir: project.laneDir("demo"), mode: "start" });
    // launch returns once the shepherd has written state.json, and leaves no lock behind.
    expect(project.json(join(project.laneDir("demo"), "state.json")).shepherdPid).toBe(launched.shepherdPid);
    expect(existsSync(join(project.laneDir("demo"), "launch.lock"))).toBe(false);

    const finished = await waitAny(project);
    expect(finished).toEqual([expect.objectContaining({ lane: "demo", attempt: 1, state: "finished", endState: "success" })]);
    expect(finished[0]?.report).toBe(join(project.attemptDir("demo", 1), "report.json"));

    const status = await project.cli("status", "--json");
    expect(status.code, status.stderr).toBe(0);
    const rows = (JSON.parse(status.stdout) as { lanes: Array<Record<string, unknown>> }).lanes;
    expect(rows).toEqual([expect.objectContaining({ lane: "demo", state: "finished", attempt: 1, endState: "success" })]);

    // Every attempt file, plus the report and wait's ack.
    const dir = project.attemptDir("demo", 1);
    expect(readdirSync(dir).sort()).toEqual([...ATTEMPT_FILES, "acked", "report.json"].sort());
    expect(readdirSync(project.laneDir("demo")).filter((n) => n.startsWith("attempt-"))).toEqual(["attempt-1"]);

    // The contracts stop, cleanup and preflight rely on.
    const worktree = realpathSync(join(project.worktreeRoot, "demo"));
    expect(project.json(join(project.laneDir("demo"), "shepherd.json"))).toMatchObject({ pid: launched.shepherdPid });
    expect(project.json(join(project.laneDir("demo"), "state.json"))).toMatchObject({
      state: "finished",
      endState: "success",
      shepherdPid: launched.shepherdPid,
    });
    const started = project.json<{ pid: number; sessionId: string; cwd: string; binary: { path: string; version: string } }>(
      join(dir, "started.json"),
    );
    const calls = project.calls();
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(started.pid).toBe(call.pid);
    expect(started.cwd).toBe(worktree);
    expect(started.binary).toEqual({ path: realpathSync(project.env["ARBAB_CLAUDE"]!), version: "2.1.295" });
    expect(realpathSync(call.cwd)).toBe(worktree);

    // The checkpoint commit holds the worker's edit, on the lane's branch.
    const exit = project.json<{ checkpoint: string | null; checkpointError: string | null; killedBy: string | null }>(join(dir, "exit.json"));
    expect(exit).toMatchObject({ checkpointError: null, killedBy: null });
    expect(exit.checkpoint).toMatch(/^[0-9a-f]{40}$/);
    expect(project.git(["log", "-1", "--format=%s", exit.checkpoint!]).trim()).toBe("arbab(demo): checkpoint attempt 1 (success)");
    expect(project.git(["rev-parse", "refs/heads/arbab/demo"]).trim()).toBe(exit.checkpoint);
    expect(project.git(["show", "--name-only", "--format=", exit.checkpoint!]).trim()).toBe("src/a.ts");

    // DESIGN.md §4: the compiled flags.
    const argv = call.argv;
    expect(argv).toContain("-p");
    expect(argv).toContain("--restricted");
    expect(argv).toContain("--strict-mcp-config");
    expect(after(argv, "--setting-sources")).toBe("");
    expect(after(argv, "--permission-mode")).toBe("dontAsk");
    expect(after(argv, "--permission-prompts")).toBe("none");
    expect(after(argv, "--output-format")).toBe("stream-json");
    expect(after(argv, "--tools")).toBe("Read,Edit,Write,Glob,Grep,Bash");
    expect(after(argv, "--settings")).toBe(join(dir, "settings.json"));
    expect(after(argv, "--session-id")).toBe(started.sessionId);
    expect(after(argv, "-n")).toBe("demo");
    expect(argv).not.toContain("--resume");
    expect(call.stdinBytes).toBe(readFileSync(join(dir, "brief.md")).length);

    // The scrubbed environment: the host's CLAUDE_* and VSCODE_* never reach the worker; passEnv names do.
    expect(project.env["CLAUDE_CODE_ENTRYPOINT"]).toBe("claude-vscode");
    expect(call.envKeys.filter((k) => /^(CLAUDE|VSCODE)/.test(k))).toEqual([]);
    expect(call.envKeys).toEqual(expect.arrayContaining(["FAKE_CLAUDE_LOG", "FAKE_CLAUDE_SCENARIO", "HOME", "PATH"]));

    // The shepherd exits once the lane is finished.
    await until(() => (exists(launched.shepherdPid) ? undefined : true), 15_000, "shepherd exit");
  }, 120_000);

  it("auto-resumes a usage-limited lane whose reset is already past, in the same session", async () => {
    p = makeE2eProject(bundle.bundle);
    const project = p;
    const pastSec = Math.floor(Date.now() / 1000) - 3600;
    const fixture = join(project.dir, "usage-limit-past.jsonl");
    writeFileSync(fixture, readFileSync(streamFixture("usage-limit"), "utf8").replaceAll("1791531000", String(pastSec)));
    project.scenario({ fixture, resumeFixture: fakeFixture("resume-success") });
    await launch(project, project.lane("limited"));

    const finished = await waitAny(project);
    expect(finished).toEqual([expect.objectContaining({ lane: "limited", attempt: 2, endState: "success" })]);
    expect(readdirSync(project.laneDir("limited")).filter((n) => n.startsWith("attempt-")).sort()).toEqual(["attempt-1", "attempt-2"]);
    expect(project.json(join(project.attemptDir("limited", 1), "summary.json"))).toMatchObject({ state: "usage-limit" });
    expect(project.json(join(project.attemptDir("limited", 2), "summary.json"))).toMatchObject({ state: "success" });
    expect(project.json(join(project.laneDir("limited"), "state.json"))).toMatchObject({ state: "finished", endState: "success", attempt: 2 });

    const [first, second] = project.calls();
    const session = after(first!.argv, "--session-id");
    expect(session).toMatch(/^[0-9a-f-]{36}$/);
    expect(after(second!.argv, "--resume")).toBe(session);
    expect(second!.argv).not.toContain("--session-id");
    const started2 = project.json<{ sessionId: string; resume: boolean }>(join(project.attemptDir("limited", 2), "started.json"));
    expect(started2).toMatchObject({ sessionId: session, resume: true });
  }, 120_000);

  it("stops a hanging lane: killed:stopped, no auto-resume, the worker's process group gone", async () => {
    p = makeE2eProject(bundle.bundle);
    const project = p;
    hangingScenario(project);
    const launched = await launch(project, project.lane("hang"));
    const call = await until(() => project.calls()[0], 30_000, "the worker to start");
    await until(() => (existsSync(join(project.attemptDir("hang", 1), "started.json")) ? true : undefined), 15_000, "started.json");
    expect(exists(-call.pid)).toBe(true);

    const stop = await project.cli("stop", "hang");
    if (psWorks()) {
      expect(stop.code, stop.stderr).toBe(0);
      expect(stop.stdout).toBe(`stopping hang (shepherd ${launched.shepherdPid})\n`);
    } else {
      // Inside a sandbox ps is refused, so stop cannot prove the pid is still the shepherd and signals nothing (the
      // safe direction). Send what stop would have sent.
      expect(stop.code).toBe(1);
      expect(stop.stderr).toContain("nothing signalled");
      process.kill(launched.shepherdPid, "SIGTERM");
    }

    const finished = await waitAny(project);
    expect(finished).toEqual([expect.objectContaining({ lane: "hang", attempt: 1, endState: "killed:stopped" })]);
    expect(project.json(join(project.laneDir("hang"), "state.json"))).toMatchObject({ state: "finished", endState: "killed:stopped" });
    expect(project.json(join(project.attemptDir("hang", 1), "exit.json"))).toMatchObject({ killedBy: "stopped" });
    expect(readdirSync(project.laneDir("hang")).filter((n) => n.startsWith("attempt-"))).toEqual(["attempt-1"]);
    expect(project.calls()).toHaveLength(1);
    await until(() => (exists(-call.pid) ? undefined : true), 15_000, "the worker's process group to go");
    await until(() => (exists(launched.shepherdPid) ? undefined : true), 15_000, "shepherd exit");
  }, 120_000);

  it("reports a lane whose setup fails (a bad base ref) through wait --any, once", async () => {
    p = makeE2eProject(bundle.bundle);
    const project = p;
    project.scenario({ fixture: fakeFixture("success-report") });
    const launched = await launch(project, project.lane("badbase", BRIEF, { base: "no-such-branch" }));

    const finished = await waitAny(project);
    expect(finished).toEqual([
      expect.objectContaining({ lane: "badbase", attempt: null, state: "finished", endState: "failed", report: null }),
    ]);
    expect(finished[0]?.reason).toMatch(/git worktree add/);
    expect(project.json(join(project.laneDir("badbase"), "state.json"))).toMatchObject({ attempt: 0, endState: "failed" });
    expect(readdirSync(project.laneDir("badbase")).filter((n) => n.startsWith("attempt-"))).toEqual([]);
    expect(project.calls()).toEqual([]);

    // Acked: the next wait has nothing to report, and the text form names the lane without an attempt.
    const again = await project.cli("wait", "--any", "--timeout-min", "0");
    expect(again.code).toBe(3);
    expect(again.stdout).toBe("");
    await until(() => (exists(launched.shepherdPid) ? undefined : true), 15_000, "shepherd exit");
  }, 120_000);

  it("refuses a second launch of a running lane", async () => {
    p = makeE2eProject(bundle.bundle);
    const project = p;
    hangingScenario(project);
    const lane = project.lane("busy");
    const launched = await launch(project, lane);

    const again = await project.cli("launch", lane);
    expect(again.code).toBe(1);
    expect(again.stderr).toMatch(/lane busy is (queued|held|preparing|running)/);
    expect(project.json(join(project.laneDir("busy"), "state.json")).shepherdPid).toBe(launched.shepherdPid);

    process.kill(launched.shepherdPid, "SIGTERM");
    expect((await waitAny(project))[0]).toMatchObject({ lane: "busy", endState: "killed:stopped" });
    expect(project.calls().length).toBeLessThanOrEqual(1);
  }, 120_000);

  it("lets only one of two concurrent launches start a shepherd", async () => {
    p = makeE2eProject(bundle.bundle);
    const project = p;
    hangingScenario(project);
    const lane = project.lane("race");
    const results = await Promise.all([project.cli("launch", "--json", lane), project.cli("launch", "--json", lane)]);
    expect(results.map((r) => r.code).sort()).toEqual([0, 1]);
    const winner = JSON.parse(results.find((r) => r.code === 0)!.stdout) as Launched;
    expect(results.find((r) => r.code === 1)!.stderr).toMatch(/being launched by another arbab|lane race is/);
    expect(existsSync(join(project.laneDir("race"), "launch.lock"))).toBe(false);

    await until(() => project.calls()[0], 30_000, "the worker to start");
    process.kill(winner.shepherdPid, "SIGTERM");
    expect((await waitAny(project))[0]).toMatchObject({ lane: "race", endState: "killed:stopped" });
    expect(project.calls()).toHaveLength(1);
  }, 120_000);

  it("refuses a lane whose brief asks for a compound command, and starts nothing", async () => {
    p = makeE2eProject(bundle.bundle);
    const project = p;
    hangingScenario(project);
    const brief = "# Bad\n\n## Task\n\nRun `cd src && pnpm test`.\n\n## Scope\n\n`src/`\n\n## Acceptance\n\n- Tests pass.\n";
    const r = await project.cli("launch", project.lane("bad", brief));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("forbidden-shape");
    expect(r.stderr).toContain("not launched");
    expect(r.stdout).toBe("");
    expect(existsSync(project.laneDir("bad"))).toBe(false);
    expect(existsSync(join(project.worktreeRoot, "bad"))).toBe(false);
    expect(project.calls()).toEqual([]);
  }, 60_000);
});
