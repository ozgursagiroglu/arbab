import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { APPROVAL } from "../hook/approve";
import { registerProject, registerShepherd, registerWaiter } from "../registry";
import { runHook } from "./hook";
import { dispatch } from "./index";
import { makeProject, type TestProject } from "./testkit";

let p: TestProject;
afterEach(() => p?.dispose());

const SESSION = "aaaaaaaa-1111-2222-3333-444444444444";

function project(): TestProject {
  const t = makeProject();
  mkdirSync(dirname(t.ctx.scriptPath), { recursive: true });
  writeFileSync(t.ctx.scriptPath, "// runner\n");
  return t;
}

const bash = (command: string): string =>
  JSON.stringify({ session_id: SESSION, cwd: "/work/repo", hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } });

// The test project lives under the OS temp dir, which may be under /tmp: only the TMPDIR and /tmp tests keep the defaults.
async function preToolUse(t: TestProject, stdin: string, tempDirs: readonly string[] = []): Promise<string> {
  t.stdin.text = stdin;
  t.out.length = 0;
  expect(await runHook(["pre-tool-use"], t.ctx, tempDirs)).toBe(0);
  expect(t.stderr()).toBe("");
  return t.stdout();
}

const AT = "2026-10-21T10:00:00.000Z";

describe("hook pre-tool-use", () => {
  it("approves the bare forms", async () => {
    p = project();
    registerProject(p.home, p.root, AT);
    const runner = p.ctx.scriptPath;
    for (const command of [
      `node "${runner}" status`,
      `node ${runner} status --json`,
      `node '${runner}' -C ${p.root} wait --any`,
      `node "${runner}" -C "${p.root}" launch 'lanes/demo.json'`,
      `node "${runner}" resume demo --prompt "prompts/next step.md"`,
    ]) {
      expect(await preToolUse(p, bash(command)), command).toBe(APPROVAL);
    }
  });

  it("refuses, with no output, everything but a bare runner call", async () => {
    p = project();
    const runner = p.ctx.scriptPath;
    const other = join(p.dir, "other.mjs");
    writeFileSync(other, "// other\n");
    const link = join(p.dir, "link.mjs");
    symlinkSync(other, link);
    const call = (rest: string): string => `node "${runner}" ${rest}`;
    for (const stdin of [
      bash(call("status | tail -20")),
      bash(call("status 2>&1")),
      bash(`cd ${p.root} && ${call("status")}`),
      bash(call("status; echo done")),
      bash(`(${call("status")})`),
      bash(call("launch $(ls lanes/*.json)")),
      bash(call("launch `ls lanes`")),
      bash(`ARBAB_X=1 ${call("status")}`),
      bash(`node "${other}" status`),
      bash(`node "${link}" status`),
      bash(call("frobnicate")),
      bash(call("hook stop")),
      bash(call(`__shepherd ${p.root} demo {}`)),
      bash(call("land rel")),
      JSON.stringify({ tool_name: "Read", tool_input: { command: call("status") } }),
      "not json",
      "",
    ]) {
      expect(await preToolUse(p, stdin), stdin).toBe("");
    }
  });

  it("approves -C only into a registered project", async () => {
    p = project();
    const command = bash(`node "${p.ctx.scriptPath}" -C ${p.root} status`);
    expect(await preToolUse(p, command)).toBe("");
    registerProject(p.home, p.root, AT);
    expect(await preToolUse(p, command)).toBe(APPROVAL);
    mkdirSync(join(p.dir, "elsewhere"));
    expect(await preToolUse(p, bash(`node "${p.ctx.scriptPath}" -C ${join(p.dir, "elsewhere")} status`))).toBe("");
  });

  it("refuses -C into a lane worktree, even a registered one", async () => {
    p = project();
    const lane = join(p.worktreeRoot, "demo");
    mkdirSync(lane, { recursive: true });
    registerProject(p.home, lane, AT);
    expect(await preToolUse(p, bash(`node "${p.ctx.scriptPath}" -C ${lane} status`))).toBe("");
  });

  it("refuses -C into a lane worktree under the worktreeRoot the project's config sets, either file", async () => {
    for (const file of ["arbab.config.json", ".arbab/config.json"]) {
      p = project();
      if (file !== "arbab.config.json") rmSync(join(p.root, "arbab.config.json"));
      p.write(file, JSON.stringify({ baseBranch: "main", worktreeRoot: "wt" }));
      const lane = join(p.root, "wt", "demo");
      mkdirSync(join(lane, "src"), { recursive: true });
      for (const root of [p.root, lane, join(lane, "src")]) registerProject(p.home, root, AT);
      const call = (dir: string): string => bash(`node "${p.ctx.scriptPath}" -C ${dir} status`);
      expect(await preToolUse(p, call(lane)), file).toBe("");
      expect(await preToolUse(p, call(join(lane, "src"))), file).toBe("");
      expect(await preToolUse(p, call(p.root)), file).toBe(APPROVAL);
      p.dispose();
    }
  });

  it("refuses -C into a .ARBAB/WORKTREES spelling", async () => {
    p = project();
    const lane = join(p.root, ".ARBAB", "WORKTREES", "demo");
    mkdirSync(lane, { recursive: true });
    registerProject(p.home, lane, AT);
    expect(await preToolUse(p, bash(`node "${p.ctx.scriptPath}" -C ${lane} status`))).toBe("");
  });

  it("refuses -C under the hook's TMPDIR and under /tmp", async () => {
    p = project();
    registerProject(p.home, p.root, AT);
    p.ctx.hostEnv = { TMPDIR: p.dir };
    expect(await preToolUse(p, bash(`node "${p.ctx.scriptPath}" -C ${p.root} status`))).toBe("");
    p.ctx.hostEnv = {};
    // /tmp itself registered: the default temp dirs still refuse it.
    registerProject(p.home, "/tmp", AT);
    p.stdin.text = bash(`node "${p.ctx.scriptPath}" -C /tmp status`);
    p.out.length = 0;
    expect(await runHook(["pre-tool-use"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe("");
    // Not refused for want of registration: without temp dirs the same call passes.
    expect(await preToolUse(p, bash(`node "${p.ctx.scriptPath}" -C /tmp status`))).toBe(APPROVAL);
  });

  it("refuses land with and without -C", async () => {
    p = project();
    registerProject(p.home, p.root, AT);
    expect(await preToolUse(p, bash(`node "${p.ctx.scriptPath}" land rel`))).toBe("");
    expect(await preToolUse(p, bash(`node "${p.ctx.scriptPath}" -C ${p.root} land rel --squash`))).toBe("");
  });

  it("prints nothing when stdin cannot be read", async () => {
    p = project();
    p.ctx.readStdin = () => Promise.reject(new Error("closed"));
    expect(await runHook(["pre-tool-use"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe("");
  });

  it("approves through dispatch, as the hook process runs it", async () => {
    p = project();
    p.stdin.text = bash(`node "${p.ctx.scriptPath}" status`);
    expect(await dispatch(["hook", "pre-tool-use"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe(APPROVAL);
  });
});

describe("hook stop", () => {
  const stop = (active: boolean): string =>
    JSON.stringify({ session_id: SESSION, cwd: "/elsewhere", hook_event_name: "Stop", stop_hook_active: active });

  function liveShepherd(t: TestProject, pid: number, owner: string | null): void {
    registerShepherd(t.home, { pid, lane: "demo", project: t.root, owner, startedAt: "2026-10-21T10:00:00.000Z" });
    t.alive.add(pid);
  }

  it("blocks once, then lets the second stop through", async () => {
    p = project();
    liveShepherd(p, 5001, SESSION);
    p.stdin.text = stop(false);
    expect(await runHook(["stop"], p.ctx)).toBe(0);
    const out = JSON.parse(p.stdout()) as { decision: string; reason: string };
    expect(out.decision).toBe("block");
    expect(out.reason).toContain(`demo (${p.root})`);
    expect(out.reason).toContain(`node "${p.ctx.scriptPath}" -C ${p.root} wait --any`);

    p.out.length = 0;
    p.stdin.text = stop(true);
    expect(await runHook(["stop"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe("");
  });

  it("stays quiet with a live waiter, other sessions' shepherds or dead pids", async () => {
    p = project();
    p.stdin.text = stop(false);

    registerShepherd(p.home, { pid: 5001, lane: "demo", project: p.root, owner: SESSION, startedAt: "2026-10-21T10:00:00.000Z" });
    expect(await runHook(["stop"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe("");

    liveShepherd(p, 5002, "another-session");
    expect(await runHook(["stop"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe("");

    liveShepherd(p, 5003, SESSION);
    registerWaiter(p.home, { pid: 6001, project: p.root, owner: SESSION, startedAt: "2026-10-21T10:00:00.000Z" });
    p.alive.add(6001);
    expect(await runHook(["stop"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe("");
  });

  it("prints nothing when the registry cannot be read", async () => {
    p = project();
    liveShepherd(p, 5001, SESSION);
    p.stdin.text = stop(false);
    p.ctx.alive = () => {
      throw new Error("boom");
    };
    expect(await runHook(["stop"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe("");
  });
});

describe("hook usage", () => {
  it("rejects a missing or unknown event and extra arguments", async () => {
    p = project();
    await expect(runHook([], p.ctx)).rejects.toThrow(/pre-tool-use, stop/);
    await expect(runHook(["post-tool-use"], p.ctx)).rejects.toThrow(/post-tool-use/);
    await expect(runHook(["stop", "x"], p.ctx)).rejects.toThrow(/no arguments/);
    expect(p.stdin.reads).toBe(0);
  });
});
