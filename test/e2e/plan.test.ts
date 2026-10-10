// M2 end to end: plans (plan next, merged dependency branches, upstream reports) and resume --digest, through the
// real bundle, detached shepherds and the fake claude.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { BRIEF, buildBundle, exists, fakeFixture, makeE2eProject, until, type E2eProject } from "./harness";

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

interface Finished {
  lane: string;
  attempt: number | null;
  endState: string;
  reason: string | null;
}
interface Next {
  plan: string;
  launched: Array<{ phase: string; laneFile: string; runDir: string; shepherdPid: number }>;
  blocked: Array<{ phase: string; waitingFor: string[] }>;
  failed: Array<{ phase: string; dependency: string; endState: string | null; reason: string | null }>;
  errors: Array<{ phase: string; message: string }>;
}

/** Writes plans/<name>.json and a brief per phase, and commits them. */
function writePlan(project: E2eProject, phases: Array<{ name: string; scope: string[]; dependsOn?: string[] }>): string {
  mkdirSync(join(project.root, "plans"), { recursive: true });
  mkdirSync(join(project.root, "lanes"), { recursive: true });
  for (const phase of phases) writeFileSync(join(project.root, "lanes", `${phase.name}.md`), BRIEF);
  const plan = { name: "p", phases: phases.map((ph) => ({ brief: `lanes/${ph.name}.md`, ...ph })) };
  writeFileSync(join(project.root, "plans", "p.json"), JSON.stringify(plan, null, 2));
  project.git(["add", "-A"]);
  project.git(["commit", "-q", "-m", "plan p"]);
  return "plans/p.json";
}

async function next(project: E2eProject, plan: string): Promise<Next> {
  const r = await project.cli("plan", "next", "--json", plan);
  expect(r.code, r.stderr).toBe(0);
  return JSON.parse(r.stdout) as Next;
}

async function wait(project: E2eProject, ...lanes: string[]): Promise<Finished[]> {
  const mode = lanes.length > 1 ? "--all" : "--any";
  const r = await project.cli("wait", mode, "--timeout-min", "2", "--json", ...lanes);
  expect(r.code, r.stderr).toBe(0);
  return (JSON.parse(r.stdout) as { finished: Finished[] }).finished;
}

/** A stream that starts a session and never finishes it: the worker hangs until it is killed. */
function hangingScenario(project: E2eProject): void {
  const init = readFileSync(fakeFixture("success-report"), "utf8").split("\n")[0] ?? "";
  const fixture = join(project.dir, "hang.jsonl");
  writeFileSync(fixture, `${init}\n`);
  project.scenario({ fixture, hangMs: -1 });
}

describe("arbab plan end to end", () => {
  it("launches A, then B once A succeeded: B's worktree has A's checkpoint merged and B's brief A's report", async () => {
    p = makeE2eProject(bundle.bundle);
    const project = p;
    const plan = writePlan(project, [
      { name: "a", scope: ["a/**"] },
      { name: "b", scope: ["b/**"], dependsOn: ["a"] },
    ]);

    const check = await project.cli("plan", "check", plan);
    expect(check.code, check.stderr).toBe(0);
    expect(check.stdout).toContain("wave 0: a\nwave 1: b\nplan p: ok\n");

    project.scenario({ fixture: fakeFixture("success-report"), touch: "a/out.txt" });
    const first = await next(project, plan);
    expect(first.launched.map((l) => l.phase)).toEqual(["a"]);
    expect(first.blocked).toEqual([{ phase: "b", waitingFor: ["a"] }]);
    expect(first.launched[0]?.laneFile).toBe(join(project.root, ".arbab", "plans", "p", "a.json"));
    expect(await wait(project)).toEqual([expect.objectContaining({ lane: "a", attempt: 1, endState: "success" })]);
    const checkpointA = project.json<{ checkpoint: string }>(join(project.attemptDir("a", 1), "exit.json")).checkpoint;
    expect(checkpointA).toMatch(/^[0-9a-f]{40}$/);

    project.scenario({ fixture: fakeFixture("success-report"), touch: "b/out.txt" });
    const second = await next(project, plan);
    expect(second.launched.map((l) => l.phase)).toEqual(["b"]);
    expect(second.blocked).toEqual([]);
    expect(await wait(project)).toEqual([expect.objectContaining({ lane: "b", attempt: 1, endState: "success" })]);

    const worktreeB = realpathSync(join(project.worktreeRoot, "b"));
    expect(readFileSync(join(worktreeB, "a", "out.txt"), "utf8")).toMatch(/^written by fake-claude/);
    // merge-base --is-ancestor exits non-zero (and git() throws) when A's checkpoint is not in B's history.
    project.git(["merge-base", "--is-ancestor", checkpointA, "refs/heads/arbab/b"]);
    // A descends from B's base, so its checkpoint was fast-forwarded: no merge commit.
    expect(project.git(["log", "--merges", "--format=%s", "refs/heads/arbab/b"]).trim()).toBe("");
    const started = project.json<{ merged?: unknown }>(join(project.attemptDir("b", 1), "started.json"));
    expect(started.merged).toEqual([{ branch: "arbab/a", sha: checkpointA }]);

    const brief = readFileSync(join(project.attemptDir("b", 1), "brief.md"), "utf8");
    expect(brief).toContain("## Upstream reports\n\n### a\n\nedited src/a.ts");

    // Everything ran: nothing more to launch, and status shows both waves.
    const third = await next(project, plan);
    expect(third).toMatchObject({ launched: [], blocked: [], failed: [], errors: [] });
    const status = await project.cli("plan", "status", plan);
    expect(status.code, status.stderr).toBe(0);
    expect(status.stdout).toMatch(/^a +0 +finished +success +-$/m);
    expect(status.stdout).toMatch(/^b +1 +finished +success +a$/m);
  }, 180_000);

  it("launches nothing while A runs", async () => {
    p = makeE2eProject(bundle.bundle);
    const project = p;
    const plan = writePlan(project, [
      { name: "a", scope: ["a/**"] },
      { name: "b", scope: ["b/**"], dependsOn: ["a"] },
    ]);
    hangingScenario(project);
    const first = await next(project, plan);
    expect(first.launched.map((l) => l.phase)).toEqual(["a"]);

    const again = await project.cli("plan", "next", plan);
    expect(again.code, again.stderr).toBe(0);
    expect(again.stdout).toBe("nothing launched\nblocked b  waiting for a\n");
    expect(existsSync(project.laneDir("b"))).toBe(false);

    process.kill(first.launched[0]!.shepherdPid, "SIGTERM");
    expect(await wait(project)).toEqual([expect.objectContaining({ lane: "a", endState: "killed:stopped" })]);
    // A did not succeed: B is listed as failed upstream, never launched.
    const after = await next(project, plan);
    expect(after).toMatchObject({ launched: [], failed: [{ phase: "b", dependency: "a", endState: "killed:stopped" }] });
    await until(() => (exists(first.launched[0]!.shepherdPid) ? undefined : true), 15_000, "shepherd exit");
  }, 180_000);

  it("fails B's setup on a conflicting merge of A and C, and the relaunch builds B's worktree again and merges both", async () => {
    p = makeE2eProject(bundle.bundle);
    const project = p;
    const plan = writePlan(project, [
      { name: "a", scope: ["a/**"] },
      { name: "c", scope: ["c/**"] },
      { name: "b", scope: ["b/**"], dependsOn: ["a", "c"] },
    ]);
    // Every worker writes shared.txt, each with its own session id: A's and C's versions conflict.
    project.scenario({ fixture: fakeFixture("success-report"), touch: "shared.txt" });
    const first = await next(project, plan);
    expect(first.launched.map((l) => l.phase).sort()).toEqual(["a", "c"]);
    const done = await wait(project, "a", "c");
    expect(done.map((f) => [f.lane, f.endState]).sort()).toEqual([
      ["a", "success"],
      ["c", "success"],
    ]);

    const second = await next(project, plan);
    expect(second.launched.map((l) => l.phase)).toEqual(["b"]);
    const [b] = await wait(project, "b");
    expect(b).toMatchObject({ lane: "b", attempt: null, endState: "failed" });
    expect(b?.reason).toMatch(/merging arbab\/c into arbab\/b conflicts in shared\.txt; the merge was aborted/);
    expect(b?.reason).toContain("launch b again: as long as no worker has run in its worktree, arbab builds it again");
    // No worker ran for B, and its worktree is left clean, with A merged.
    expect(project.calls()).toHaveLength(2);
    const worktreeB = join(project.worktreeRoot, "b");
    expect(project.git(["status", "--porcelain"], worktreeB)).toBe("");
    // A was fast-forwarded: B's worktree is at A's checkpoint.
    const checkpointA = project.git(["rev-parse", "refs/heads/arbab/a"]).trim();
    expect(project.git(["rev-parse", "HEAD"], worktreeB).trim()).toBe(checkpointA);

    // The orchestrator resolves the conflict in C's branch (C's tree on top of A) and relaunches B.
    const fixedC = project.git(["commit-tree", "refs/heads/arbab/c^{tree}", "-p", checkpointA, "-m", "c on top of a"]).trim();
    project.git(["reset", "-q", "--hard", fixedC], join(project.worktreeRoot, "c"));
    const relaunch = await project.cli("launch", "--json", second.launched[0]!.laneFile);
    expect(relaunch.code, relaunch.stderr).toBe(0);
    expect(await wait(project, "b")).toEqual([expect.objectContaining({ lane: "b", attempt: 1, endState: "success" })]);
    // B's worktree was built again (clean, every commit from a source): the new merges are recorded.
    const started = project.json<{ merged?: unknown }>(join(project.attemptDir("b", 1), "started.json"));
    expect(started.merged).toEqual([
      { branch: "arbab/a", sha: checkpointA },
      { branch: "arbab/c", sha: fixedC },
    ]);
    project.git(["merge-base", "--is-ancestor", fixedC, "refs/heads/arbab/b"]);
    expect(project.calls()).toHaveLength(3);
  }, 180_000);

  it("fails B's setup when A changed package.json, naming the file, and never runs a worker for B", async () => {
    p = makeE2eProject(bundle.bundle);
    const project = p;
    const plan = writePlan(project, [
      { name: "a", scope: ["package.json"] },
      { name: "b", scope: ["b/**"], dependsOn: ["a"] },
    ]);
    project.scenario({ fixture: fakeFixture("success-report"), touch: "package.json" });
    const first = await next(project, plan);
    expect(first.launched.map((l) => l.phase)).toEqual(["a"]);
    expect(await wait(project)).toEqual([expect.objectContaining({ lane: "a", attempt: 1, endState: "success" })]);
    const checkpointA = project.json<{ checkpoint: string }>(join(project.attemptDir("a", 1), "exit.json")).checkpoint;
    expect(project.git(["show", "--name-only", "--format=", checkpointA]).trim()).toBe("package.json");

    const second = await next(project, plan);
    expect(second.launched.map((l) => l.phase)).toEqual(["b"]);
    const [b] = await wait(project, "b");
    expect(b).toMatchObject({ lane: "b", attempt: null, endState: "failed" });
    expect(b?.reason).toMatch(/^arbab\/a changes dependency manifests \(package\.json\), so it was not merged into arbab\/b/);
    expect(b?.reason).toContain("must review and land that dependency change on the base before dependent phases run");
    // Only A's worker ran; B's worktree has the base's tree, without A's package.json.
    expect(project.calls().map((c) => c.argv[c.argv.indexOf("-n") + 1])).toEqual(["a"]);
    expect(existsSync(project.attemptDir("b", 1))).toBe(false);
    const worktreeB = join(project.worktreeRoot, "b");
    expect(existsSync(join(worktreeB, "package.json"))).toBe(false);
    expect(project.git(["status", "--porcelain"], worktreeB)).toBe("");
  }, 180_000);
});

describe("arbab resume --digest end to end", () => {
  it("starts a fresh session whose brief has a head start from the latest attempt", async () => {
    p = makeE2eProject(bundle.bundle);
    const project = p;
    project.scenario({ fixture: fakeFixture("success-report"), touch: "src/a.ts" });
    const launch = await project.cli("launch", "--json", project.lane("demo"));
    expect(launch.code, launch.stderr).toBe(0);
    expect(await wait(project)).toEqual([expect.objectContaining({ lane: "demo", attempt: 1, endState: "success" })]);

    const both = await project.cli("resume", "demo", "--digest", "--prompt", "lanes/demo.md");
    expect(both.code).toBe(1);
    expect(both.stderr).toContain("--prompt or --digest, not both");

    const r = await project.cli("resume", "demo", "--digest", "--json");
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ lane: "demo", sessionId: null, prompt: "digest", digestFrom: 1 });
    expect(await wait(project)).toEqual([expect.objectContaining({ lane: "demo", attempt: 2, endState: "success" })]);

    const [call1, call2] = project.calls();
    const session = (argv: string[]): string | undefined => argv[argv.indexOf("--session-id") + 1];
    expect(call2?.argv).toContain("--session-id");
    expect(call2?.argv).not.toContain("--resume");
    expect(session(call2!.argv)).toMatch(/^[0-9a-f-]{36}$/);
    expect(session(call2!.argv)).not.toBe(session(call1!.argv));

    const brief = readFileSync(join(project.attemptDir("demo", 2), "brief.md"), "utf8");
    expect(brief).toContain("## Head start\n\nA previous attempt (number 1)");
    expect(brief).toContain("### CALL Edit");
    expect(brief.indexOf("## Head start")).toBeLessThan(brief.indexOf("## Tool belt"));
    expect(call2?.stdinBytes).toBe(Buffer.byteLength(brief));
  }, 180_000);
});
