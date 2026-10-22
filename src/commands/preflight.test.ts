import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadLane } from "../config";
import { compileProfile } from "../profile";
import { runPaths } from "../registry";
import type { AttemptSummary, InitFacts } from "../types";
import { LAUNCH_POLL_MS } from "./launch";
import { openProject } from "./project";
import {
  MAX_PREFLIGHT_NAME,
  PREFLIGHT_DIR,
  PROBE_MODEL,
  SHA_COMMAND,
  evaluatePreflight,
  modelBrief,
  preflightDir,
  runPreflight,
  stepCommands,
  toolsBrief,
  writeProbeLanes,
  type PreflightInput,
  type ProbeResult,
} from "./preflight";
import { makeProject, writeLaneRun, type LaneRun, type TestProject } from "./testkit";

// The real compiler, spied on so tests can see the ProfileInput each lint compiled.
vi.mock("../profile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../profile")>();
  return { ...actual, compileProfile: vi.fn(actual.compileProfile) };
});

let p: TestProject;
afterEach(() => {
  p?.dispose();
  vi.mocked(compileProfile).mockClear();
});

const TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "Bash"];

const init = (over: Partial<InitFacts> = {}): InitFacts => ({
  tools: ["Bash", "Edit", "Glob", "Grep", "Read", "StructuredOutput", "Write"],
  permissionMode: "dontAsk",
  version: "2.1.295",
  model: "claude-haiku-5-5",
  apiKeySource: "none",
  mcpServers: [],
  plugins: [],
  skills: 0,
  memoryPaths: false,
  messagingSocket: false,
  entrypoint: "sdk-cli",
  ...over,
});

const summary = (over: Partial<AttemptSummary> = {}): AttemptSummary =>
  ({
    state: "success",
    binary: { path: "/opt/claude/bin/claude", version: "2.1.295" },
    toolCallTotal: 2,
    init: init(),
    registration: { kind: "sdk-cli", entrypoint: "sdk-cli", name: "x" },
    final: { resultText: "done" },
    ...over,
  }) as AttemptSummary;

const probe = (over: Partial<ProbeResult> = {}): ProbeResult => ({
  lane: "demo-pf-tools",
  endState: "success",
  summary: summary(),
  stderr: "",
  report: { steps: [{ n: 1, command: "pnpm typecheck", exit_code: 0 }] },
  cwd: "/w",
  ...over,
});

const input = (over: Partial<PreflightInput> = {}): PreflightInput => ({
  expectedTools: TOOLS,
  steps: ["pnpm typecheck"],
  tools: probe(),
  model: probe({ lane: "demo-pf-model", report: { answer: "OK abc1234" } }),
  headSha: "abc1234",
  ...over,
});

const failed = (checks: ReturnType<typeof evaluatePreflight>): string[] => checks.filter((c) => c.status === "fail").map((c) => c.check);

describe("evaluatePreflight", () => {
  it("passes when every condition of DESIGN.md §11 holds", () => {
    const checks = evaluatePreflight(input());
    expect(failed(checks)).toEqual([]);
    expect(checks.map((c) => c.check)).toContain("sha");
    expect(checks.map((c) => c.check)).toContain("steps");
  });

  it("fails on the init facts of either probe", () => {
    const cases: Array<[Partial<InitFacts>, string]> = [
      [{ tools: ["Bash", "Read"] }, "tools"],
      [{ permissionMode: "default" }, "permission mode"],
      [{ mcpServers: [{ name: "x" }] }, "mcp servers"],
      [{ memoryPaths: true }, "memory paths"],
      [{ messagingSocket: true }, "messaging socket"],
      [{ version: "2.1.300" }, "version"],
    ];
    for (const [over, check] of cases) {
      expect(failed(evaluatePreflight(input({ tools: probe({ summary: summary({ init: init(over) }) }) })))).toEqual([`tools ${check}`]);
      expect(failed(evaluatePreflight(input({ model: probe({ report: { answer: "OK abc1234" }, summary: summary({ init: init(over) }) }) })))).toEqual([
        `model ${check}`,
      ]);
    }
  });

  it("maps Agent to Task when comparing tools", () => {
    const checks = evaluatePreflight(
      input({ expectedTools: ["Read", "Agent", "Bash"], tools: probe({ summary: summary({ init: init({ tools: ["Task", "Bash", "Read"] }) }) }) }),
    );
    expect(failed(checks)).not.toContain("tools tools");
  });

  it("fails on stderr warnings, a vscode registration, no tool calls, a missing init or summary, or a bad end state", () => {
    expect(failed(evaluatePreflight(input({ tools: probe({ stderr: "Workspace has not been trusted" }) })))).toEqual(["tools stderr"]);
    expect(failed(evaluatePreflight(input({ tools: probe({ stderr: "Ignoring settings" }) })))).toEqual(["tools stderr"]);
    const vscode = summary({ registration: { kind: "claude-vscode", entrypoint: null, name: null } });
    expect(failed(evaluatePreflight(input({ tools: probe({ summary: vscode }) })))).toEqual(["tools registration"]);
    expect(failed(evaluatePreflight(input({ tools: probe({ summary: summary({ registration: null }) }) })))).toEqual([]);
    expect(failed(evaluatePreflight(input({ tools: probe({ summary: summary({ toolCallTotal: 0 }) }) })))).toEqual(["tools tool calls"]);
    expect(failed(evaluatePreflight(input({ tools: probe({ summary: summary({ init: null }) }) })))).toEqual(["tools init"]);
    expect(failed(evaluatePreflight(input({ tools: probe({ endState: "killed:idle" }) })))).toEqual(["tools end state"]);
    expect(failed(evaluatePreflight(input({ model: probe({ summary: null, endState: null, report: null }) })))).toEqual([
      "model end state",
      "model summary",
      "sha",
    ]);
  });

  it("fails when a step exited non-zero, a step is missing, or there is no report", () => {
    const bad = { steps: [{ n: 1, command: "pnpm typecheck", exit_code: 2 }] };
    const checks = evaluatePreflight(input({ tools: probe({ report: bad }) }));
    expect(failed(checks)).toEqual(["steps"]);
    expect(checks.find((c) => c.check === "steps")?.detail).toBe("pnpm typecheck → 2");
    expect(failed(evaluatePreflight(input({ steps: ["a", "b"] })))).toEqual(["steps"]);
    expect(failed(evaluatePreflight(input({ tools: probe({ report: null }) })))).toEqual(["steps"]);
  });

  it("compares the answered sha with HEAD, from the report or the result text", () => {
    expect(failed(evaluatePreflight(input({ headSha: "abc12345" })))).toEqual([]);
    expect(failed(evaluatePreflight(input({ headSha: "fff0000" })))).toEqual(["sha"]);
    expect(failed(evaluatePreflight(input({ headSha: null })))).toEqual(["sha"]);
    const text = probe({ report: null, summary: summary({ final: { resultText: "OK abc1234" } as AttemptSummary["final"] }) });
    expect(failed(evaluatePreflight(input({ model: text })))).toEqual([]);
    expect(failed(evaluatePreflight(input({ model: probe({ report: { answer: "the sha is abc1234" } }) })))).toEqual(["sha"]);
  });
});

describe("probe lanes", () => {
  it("stepCommands joins argv and falls back to git status", () => {
    expect(stepCommands([["pnpm", "test"], ["pnpm", "typecheck"]])).toEqual(["pnpm test", "pnpm typecheck"]);
    expect(stepCommands([])).toEqual(["git status"]);
  });

  it("briefs list the commands and the sha command", () => {
    expect(toolsBrief("demo", ["pnpm test"])).toContain("1. Run `pnpm test`");
    expect(modelBrief("demo")).toContain(`\`${SHA_COMMAND}\``);
  });

  it("writes two valid lanes under .arbab/preflight/<lane>/, nothing into lanes/", () => {
    p = makeProject();
    const project = openProject(p.ctx);
    const lane = { ...loadLane(p.root, "lanes/demo.json"), model: "claude-opus-5-5", allow: ["Bash(make check)"] };
    const files = writeProbeLanes(project, lane);
    expect(preflightDir(project, "demo")).toBe(join(p.root, ".arbab", "preflight", "demo"));
    expect(preflightDir(project, "demo")).toBe(join(p.root, PREFLIGHT_DIR, "demo"));
    expect(PREFLIGHT_DIR).toBe(".arbab/preflight");
    expect(files).toEqual({
      tools: { name: "demo-pf-tools", laneFile: ".arbab/preflight/demo/demo-pf-tools.json" },
      model: { name: "demo-pf-model", laneFile: ".arbab/preflight/demo/demo-pf-model.json" },
    });
    const tools = loadLane(p.root, files.tools.laneFile);
    expect(tools).toMatchObject({ role: "implementer", model: PROBE_MODEL, effort: "low", allow: ["Bash(make check)"], autoResume: false, maxAttempts: 1 });
    expect(tools.brief).toBe(".arbab/preflight/demo/demo-pf-tools.md");
    expect(tools.worktree).toBeUndefined();
    const model = loadLane(p.root, files.model.laneFile);
    expect(model).toMatchObject({ model: "claude-opus-5-5", allow: ["Bash(make check)", `Bash(${SHA_COMMAND})`], checkpoint: false });
    expect(JSON.parse(readFileSync(join(p.root, ".arbab", "preflight", "demo", "demo-pf-model.schema.json"), "utf8"))).toMatchObject({
      required: ["answer"],
    });
    expect(readdirSync(join(p.root, "lanes")).sort()).toEqual(["demo.json", "demo.md"]);
  });

  it("gives the probes the lane's narrowed tools, so the tools check expects what the lane will have", () => {
    p = makeProject();
    const project = openProject(p.ctx);
    const lane = { ...loadLane(p.root, "lanes/demo.json"), tools: ["Read", "Bash"] };
    const files = writeProbeLanes(project, lane);
    expect(loadLane(p.root, files.tools.laneFile).tools).toEqual(["Read", "Bash"]);
    expect(loadLane(p.root, files.model.laneFile).tools).toEqual(["Read", "Bash"]);
    expect(loadLane(p.root, writeProbeLanes(project, loadLane(p.root, "lanes/demo.json")).tools.laneFile).tools).toBeUndefined();
  });

  it("runs the probes in the lane's worktree when it already exists, or in the one it borrows", () => {
    p = makeProject();
    const project = openProject(p.ctx);
    const lane = loadLane(p.root, "lanes/demo.json");
    mkdirSync(join(p.worktreeRoot, "demo"), { recursive: true });
    const files = writeProbeLanes(project, lane);
    expect(loadLane(p.root, files.tools.laneFile).worktree).toBe("demo");
    expect(loadLane(p.root, files.model.laneFile).worktree).toBe("demo");
    const borrower = writeProbeLanes(project, { ...lane, name: "check", worktree: "other" });
    expect(loadLane(p.root, borrower.tools.laneFile).worktree).toBe("other");
  });

  it("refuses a lane name too long for the probe suffix, naming the limit", () => {
    p = makeProject();
    const project = openProject(p.ctx);
    const lane = loadLane(p.root, "lanes/demo.json");
    expect(MAX_PREFLIGHT_NAME).toBe(39);
    expect(() => writeProbeLanes(project, { ...lane, name: "a".repeat(MAX_PREFLIGHT_NAME + 1) })).toThrow(
      expect.objectContaining({ code: "usage", message: expect.stringMatching(/at most 39 to add -pf-tools/) }),
    );
    expect(existsSync(join(p.root, ".arbab", "preflight"))).toBe(false);
    expect(writeProbeLanes(project, { ...lane, name: "a".repeat(MAX_PREFLIGHT_NAME) }).tools.name).toHaveLength(48);
  });
});

/** A spawnShepherd that leaves what a shepherd would: state, summary, report and stderr per probe lane. */
function simulateShepherds(t: TestProject, runs: Record<string, (pid: number) => LaneRun | null>): void {
  let next = 9000;
  t.ctx.spawnShepherd = (root, lane, mode) => {
    t.spawned.push({ root, lane, mode });
    const pid = next++;
    t.alive.add(pid);
    const run = runs[lane]?.(pid) ?? null;
    if (run !== null) {
      const spec = JSON.parse(readFileSync(runPaths(t.runsRoot, lane).laneFile, "utf8")) as Record<string, unknown>;
      writeLaneRun(t.runsRoot, lane, { ...run, shepherdPid: pid, lane: spec });
    }
    return pid;
  };
}

function head(t: TestProject): string {
  return t.ok(["rev-parse", "--short", "HEAD"]).trim();
}

function goodRuns(t: TestProject, sha = head(t)): Record<string, (pid: number) => LaneRun> {
  return {
    "demo-pf-tools": () => ({
      state: "finished",
      endState: "success",
      started: { cwd: t.root },
      summary: summary(),
      report: { steps: [{ n: 1, command: "pnpm typecheck", exit_code: 0 }] },
      stderr: "",
    }),
    "demo-pf-model": () => ({
      state: "finished",
      endState: "success",
      started: { cwd: t.root },
      summary: summary(),
      report: { answer: `OK ${sha}` },
      stderr: "",
    }),
  };
}

describe("runPreflight", () => {
  it("launches both probes, waits, prints every check and exits 0 when all pass", async () => {
    p = makeProject();
    simulateShepherds(p, goodRuns(p));
    expect(await runPreflight(["lanes/demo.json"], p.ctx)).toBe(0);
    expect(p.spawned.map((s) => [s.lane, s.mode.kind])).toEqual([
      ["demo-pf-tools", "start"],
      ["demo-pf-model", "start"],
    ]);
    const lines = p.stdout().trimEnd().split("\n");
    expect(lines.every((l) => l.startsWith("ok  "))).toBe(true);
    expect(lines.some((l) => /^ok\s+sha\s+/.test(l))).toBe(true);
    expect(existsSync(join(p.runsRoot, "demo-pf-tools", "attempt-1", "acked"))).toBe(true);
    // The generated probe lanes stay out of the project's git status.
    expect(p.git(["check-ignore", "-q", ".arbab/preflight/demo/x"], p.root).code).toBe(0);
    expect(readFileSync(join(p.root, ".git", "info", "exclude"), "utf8")).toMatch(/^\.arbab\/$/m);
    expect(JSON.parse(readFileSync(join(p.root, ".arbab", ".eslintrc.json"), "utf8"))).toEqual({ root: true });
  });

  it("lints the lane and both probes with the repository's shared git directory", async () => {
    p = makeProject();
    simulateShepherds(p, goodRuns(p));
    expect(await runPreflight(["lanes/demo.json"], p.ctx)).toBe(0);
    const inputs = vi.mocked(compileProfile).mock.calls.map(([input]) => input);
    expect(inputs.map((i) => i.worktree)).toEqual(
      expect.arrayContaining([join(p.worktreeRoot, "demo"), join(p.worktreeRoot, "demo-pf-tools"), join(p.worktreeRoot, "demo-pf-model")]),
    );
    expect(inputs.every((i) => i.gitCommonDir === join(p.root, ".git"))).toBe(true);
  });

  it("exits 1 when a check fails, with --json", async () => {
    p = makeProject();
    simulateShepherds(p, goodRuns(p, "0000000"));
    expect(await runPreflight(["--json", "lanes/demo.json"], p.ctx)).toBe(1);
    const out = JSON.parse(p.stdout()) as { ok: boolean; timedOut: boolean; lanes: string[]; checks: Array<{ status: string; check: string }> };
    expect(Object.keys(out)).toEqual(["ok", "timedOut", "lanes", "checks"]);
    expect(out).toMatchObject({ ok: false, timedOut: false, lanes: ["demo-pf-tools", "demo-pf-model"] });
    expect(out.checks.filter((c) => c.status === "fail").map((c) => c.check)).toEqual(["sha"]);
  });

  it("does not take a previous run's finished state for this one", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo-pf-tools", { state: "finished", endState: "failed", shepherdPid: 1, summary: summary({ state: "failed" }) });
    writeLaneRun(p.runsRoot, "demo-pf-model", { state: "finished", endState: "failed", shepherdPid: 1, summary: summary({ state: "failed" }) });
    const runs = goodRuns(p);
    const pending: Array<() => void> = [];
    simulateShepherds(p, {
      "demo-pf-tools": (pid) => {
        pending.push(() => writeLaneRun(p.runsRoot, "demo-pf-tools", { ...runs["demo-pf-tools"]!(pid), shepherdPid: pid }));
        return null;
      },
      "demo-pf-model": (pid) => {
        pending.push(() => writeLaneRun(p.runsRoot, "demo-pf-model", { ...runs["demo-pf-model"]!(pid), shepherdPid: pid }));
        return null;
      },
    });
    const sleep = p.ctx.sleep;
    let ticks = 0;
    p.ctx.sleep = async (ms) => {
      await sleep(ms);
      // launch's own polls for the shepherd's first state.json are not preflight ticks.
      if (ms !== LAUNCH_POLL_MS && ++ticks === 2) for (const write of pending) write();
    };
    expect(await runPreflight(["lanes/demo.json"], p.ctx)).toBe(0);
    expect(ticks).toBe(2);
    expect(p.spawned.map((s) => s.mode.kind)).toEqual(["fresh", "fresh"]);
  });

  it("exits 3 when the probes do not finish in time", async () => {
    p = makeProject();
    simulateShepherds(p, {});
    expect(await runPreflight(["--timeout-min", "1", "lanes/demo.json"], p.ctx)).toBe(3);
    expect(p.stderr()).toContain("did not finish in time");
  });

  it("fails when a shepherd died before writing any state", async () => {
    p = makeProject();
    p.ctx.spawnShepherd = (root, lane, mode) => {
      p.spawned.push({ root, lane, mode });
      return 31337;
    };
    expect(await runPreflight(["lanes/demo.json"], p.ctx)).toBe(1);
    expect(p.stdout()).toMatch(/^fail\s+tools end state\s+demo-pf-tools: no attempt finished/);
  });

  it("refuses before launching when a probe would fail lint", async () => {
    p = makeProject({ config: { commands: { implementer: ["pnpm test"] }, preflight: { steps: [["make", "check"]] } } });
    await expect(runPreflight(["lanes/demo.json"], p.ctx)).rejects.toMatchObject({ code: "lint" });
    expect(p.spawned).toEqual([]);
    expect(p.stderr()).toContain("denied-command");
  });

  it("refuses a role without Bash and usage errors", async () => {
    p = makeProject({
      lanes: { "lanes/r.json": { name: "r", role: "researcher", brief: "lanes/r.md" } },
      files: { "lanes/r.md": "# R\n\n## Task\n\nFind it.\n\n## Scope\n\nNone.\n\n## Acceptance\n\n- Found.\n" },
    });
    await expect(runPreflight(["lanes/r.json"], p.ctx)).rejects.toThrow(/no Bash/);
    await expect(runPreflight([], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runPreflight(["lanes/demo.json", "--timeout-min", "x"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runPreflight(["lanes/demo.json", "--dry-run"], p.ctx)).rejects.toMatchObject({ code: "usage" });
  });
});
