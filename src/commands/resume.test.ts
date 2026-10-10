import { existsSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { markGenerated } from "./generated";
import { takeLaunchLock } from "./launch";
import { openProject } from "./project";
import { MAX_PROMPT_BYTES, latestSession, readPrompt, runResume, writeResumePrompt } from "./resume";
import { SHEPHERD_PID, makeProject, writeLaneRun, type TestProject } from "./testkit";

let p: TestProject;
afterEach(() => p?.dispose());

const SESSION = "11111111-2222-3333-4444-555555555555";

describe("latestSession", () => {
  it("reads the latest attempt's session id, from started.json or summary.json", () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "finished", started: { sessionId: "old" } });
    writeLaneRun(p.runsRoot, "demo", { state: "finished", summary: { sessionId: "from-summary" } });
    expect(latestSession(openProject(p.ctx), "demo")).toBe("from-summary");
  });
  it("refuses a lane without attempts or without a session id", () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "finished", endState: "failed" });
    expect(() => latestSession(openProject(p.ctx), "demo")).toThrow(/no attempt/);
    writeLaneRun(p.runsRoot, "demo", { state: "finished", summary: { sessionId: null } });
    expect(() => latestSession(openProject(p.ctx), "demo")).toThrow(/no session id/);
  });
});

describe("readPrompt", () => {
  it("reads a prompt file inside the project", () => {
    p = makeProject({ files: { "notes/next.md": "Continue with step 3." } });
    expect(readPrompt(openProject(p.ctx), "notes/next.md")).toBe("Continue with step 3.");
  });
  it("refuses paths outside the project, missing, empty and oversized files", () => {
    p = makeProject({ files: { "empty.md": "  \n", "big.md": "x".repeat(MAX_PROMPT_BYTES + 1) } });
    const project = openProject(p.ctx);
    expect(() => readPrompt(project, "../outside.md")).toThrow(/outside/);
    expect(() => readPrompt(project, "missing.md")).toThrow(/cannot read/);
    expect(() => readPrompt(project, "empty.md")).toThrow(/empty/);
    expect(() => readPrompt(project, "big.md")).toThrow(/over/);
  });

  it("refuses a symlink inside the project that points outside it, and follows one that stays inside", () => {
    p = makeProject({ files: { "notes/next.md": "Inside." } });
    writeFileSync(join(p.dir, "secret.md"), "Outside the project.");
    symlinkSync(join(p.dir, "secret.md"), join(p.root, "leak.md"));
    symlinkSync(join(p.root, "notes", "next.md"), join(p.root, "alias.md"));
    const project = openProject(p.ctx);
    expect(() => readPrompt(project, "leak.md")).toThrow(expect.objectContaining({ code: "usage", message: expect.stringMatching(/outside/) }));
    expect(readPrompt(project, "alias.md")).toBe("Inside.");
  });
});

describe("writeResumePrompt", () => {
  it("writes resume-prompt-<next attempt>.md in the lane's run dir and never overwrites one", () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "finished", started: { sessionId: SESSION } });
    const project = openProject(p.ctx);
    const first = writeResumePrompt(project, "demo", "one");
    expect(first).toBe(join(p.runsRoot, "demo", "resume-prompt-2.md"));
    const second = writeResumePrompt(project, "demo", "two");
    expect(second).toBe(join(p.runsRoot, "demo", "resume-prompt-3.md"));
    expect([readFileSync(first, "utf8"), readFileSync(second, "utf8")]).toEqual(["one", "two"]);
  });
});

describe("runResume", () => {
  it("starts a resume shepherd for a finished lane", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "finished", endState: "max-turns", started: { sessionId: SESSION } });
    expect(await runResume(["demo"], p.ctx)).toBe(0);
    expect(p.spawned).toEqual([{ root: p.root, lane: "demo", mode: { kind: "resume" } }]);
    expect(p.stdout()).toBe(`resumed demo  session ${SESSION}  shepherd ${SHEPHERD_PID}\n`);
  });

  it("passes the prompt as a file in the run dir, never its text, and prints --json", async () => {
    p = makeProject({ files: { "next.md": "Fix the failing test." } });
    writeLaneRun(p.runsRoot, "demo", { state: "running", shepherdPid: 999, started: { sessionId: SESSION } });
    expect(await runResume(["demo", "--prompt", "next.md", "--json"], p.ctx)).toBe(0);
    const promptFile = join(p.runsRoot, "demo", "resume-prompt-2.md");
    expect(p.spawned[0]?.mode).toEqual({ kind: "resume", promptFile });
    expect(JSON.stringify(p.spawned[0]?.mode)).not.toContain("Fix the failing test.");
    expect(readFileSync(promptFile, "utf8")).toBe("Fix the failing test.");
    expect(JSON.parse(p.stdout())).toEqual({ lane: "demo", sessionId: SESSION, shepherdPid: SHEPHERD_PID, prompt: "file" });
  });

  it("refuses an active lane", async () => {
    p = makeProject();
    p.alive.add(88);
    writeLaneRun(p.runsRoot, "demo", { state: "waiting-reset", shepherdPid: 88, started: { sessionId: SESSION } });
    await expect(runResume(["demo"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    expect(p.spawned).toEqual([]);
  });

  it("refuses an orphan whose worker still runs, and writes no prompt file", async () => {
    p = makeProject({ files: { "next.md": "Go on." } });
    writeLaneRun(p.runsRoot, "demo", { state: "running", shepherdPid: 999, started: { sessionId: SESSION, pid: 7000 } });
    p.alive.add(7000);
    p.commands.set(7000, "/opt/claude/bin/claude -p --resume x");
    await expect(runResume(["demo", "--prompt", "next.md"], p.ctx)).rejects.toThrow(/arbab cleanup/);
    expect(p.spawned).toEqual([]);
    expect(existsSync(join(p.runsRoot, "demo", "resume-prompt-2.md"))).toBe(false);
    expect(existsSync(join(p.runsRoot, "demo", "launch.lock"))).toBe(false);
  });

  it("lets only one of two concurrent resumes start a shepherd", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "finished", endState: "max-turns", started: { sessionId: SESSION } });
    // Both resumes run in this CLI process, which holds the lock.
    p.alive.add(p.ctx.pid);
    const results = await Promise.allSettled([runResume(["demo"], p.ctx), runResume(["demo"], p.ctx)]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { message: expect.stringMatching(/being launched/) } });
    expect(p.spawned).toHaveLength(1);
    expect(existsSync(join(p.runsRoot, "demo", "launch.lock"))).toBe(false);
  });

  it("refuses while a launch of the lane holds the lock", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "finished", endState: "max-turns", started: { sessionId: SESSION } });
    p.alive.add(5150);
    const release = takeLaunchLock(p.ctx, openProject(p.ctx), "demo", 5150);
    await expect(runResume(["demo"], p.ctx)).rejects.toThrow(/being launched/);
    expect(p.spawned).toEqual([]);
    release();
  });

  const STREAM = `${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Working on it." }] } })}\n`;

  it("--digest starts a fresh shepherd seeded with the latest attempt", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "finished", endState: "killed:wall", started: { sessionId: SESSION }, stream: STREAM });
    writeLaneRun(p.runsRoot, "demo", { state: "finished", endState: "killed:wall", started: { sessionId: SESSION }, stream: STREAM });
    expect(await runResume(["demo", "--digest"], p.ctx)).toBe(0);
    expect(p.spawned).toEqual([{ root: p.root, lane: "demo", mode: { kind: "fresh", digestFrom: 2 } }]);
    expect(p.stdout()).toBe(`resumed demo  fresh session with the digest of attempt 2  shepherd ${SHEPHERD_PID}\n`);
    expect(existsSync(join(p.runsRoot, "demo", "launch.lock"))).toBe(false);
  });

  it("--digest --json names the attempt and no session", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "orphaned", started: { sessionId: SESSION }, stream: STREAM });
    expect(await runResume(["demo", "--digest", "--json"], p.ctx)).toBe(0);
    expect(JSON.parse(p.stdout())).toEqual({ lane: "demo", sessionId: null, shepherdPid: SHEPHERD_PID, prompt: "digest", digestFrom: 1 });
  });

  it("--digest refuses --prompt, a lane without an attempt, an attempt without a stream, and an active lane", async () => {
    p = makeProject({ files: { "next.md": "Go on." } });
    await expect(runResume(["demo", "--digest", "--prompt", "next.md"], p.ctx)).rejects.toMatchObject({
      code: "usage",
      message: expect.stringMatching(/--prompt or --digest, not both/),
    });
    writeLaneRun(p.runsRoot, "demo", { state: "finished", endState: "failed" });
    await expect(runResume(["demo", "--digest"], p.ctx)).rejects.toThrow(/no attempt to seed a digest from/);
    writeLaneRun(p.runsRoot, "demo", { state: "finished", started: { sessionId: SESSION } });
    await expect(runResume(["demo", "--digest"], p.ctx)).rejects.toThrow(/stream\.jsonl does not exist/);
    p.alive.add(88);
    writeLaneRun(p.runsRoot, "demo", { state: "running", shepherdPid: 88, started: { sessionId: SESSION }, stream: STREAM });
    await expect(runResume(["demo", "--digest"], p.ctx)).rejects.toThrow(/lane demo is running/);
    expect(p.spawned).toEqual([]);
    expect(existsSync(join(p.runsRoot, "demo", "launch.lock"))).toBe(false);
  });

  it("--digest refuses an orphan whose worker still runs", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "running", shepherdPid: 999, started: { sessionId: SESSION, pid: 7000 }, stream: STREAM });
    p.alive.add(7000);
    p.commands.set(7000, "/opt/claude/bin/claude -p");
    await expect(runResume(["demo", "--digest"], p.ctx)).rejects.toThrow(/arbab cleanup/);
    expect(p.spawned).toEqual([]);
  });

  it("refuses a lane an integration generated, with or without --digest, naming the integration", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "rel-verify", { state: "finished", endState: "usage-limit", started: { sessionId: SESSION }, stream: STREAM });
    markGenerated(p.runsRoot, "rel-verify", { integration: "rel", branch: "integrate/rel", head: "a".repeat(40) }, "2026-10-09T11:00:00.000Z");
    await expect(runResume(["rel-verify"], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/generated by integration rel/) });
    await expect(runResume(["rel-verify", "--digest"], p.ctx)).rejects.toThrow(/generated by integration rel/);
    expect(p.spawned).toEqual([]);
    expect(existsSync(join(p.runsRoot, "rel-verify", "launch.lock"))).toBe(false);
  });

  it("refuses a lane that borrows a generated lane's worktree, with or without --digest", async () => {
    p = makeProject();
    markGenerated(p.runsRoot, "rel-verify", { integration: "rel", branch: "integrate/rel", head: "a".repeat(40) }, "2026-10-09T11:00:00.000Z");
    writeLaneRun(p.runsRoot, "fixer", { state: "finished", endState: "usage-limit", started: { sessionId: SESSION }, stream: STREAM, lane: { name: "fixer", role: "implementer", brief: "lanes/demo.md", worktree: "rel-verify" } });
    await expect(runResume(["fixer"], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/borrows the worktree of lane rel-verify/) });
    await expect(runResume(["fixer", "--digest"], p.ctx)).rejects.toThrow(/borrows the worktree of lane rel-verify/);
    expect(p.spawned).toEqual([]);
  });

  it("refuses a lane that never ran and usage errors", async () => {
    p = makeProject();
    await expect(runResume(["demo"], p.ctx)).rejects.toThrow(/no runs/);
    await expect(runResume([], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runResume(["demo", "--prompt"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runResume(["demo", "--model", "x"], p.ctx)).rejects.toMatchObject({ code: "usage" });
  });
});
