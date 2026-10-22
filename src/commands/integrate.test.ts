import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as plans from "../plan";
import type { IntegrationRecord, PlanSpec } from "../types";
import { formatIntegration, integrationLanes, runIntegrate, splitList } from "./integrate";
import { openProject } from "./project";
import { DEFAULT_CONFIG, branchWith, makeProject, writeLaneRun, type TestProject } from "./testkit";

let p: TestProject;
afterEach(() => p?.dispose());

const recordOf = (t: TestProject, name: string): IntegrationRecord =>
  JSON.parse(readFileSync(join(t.root, ".arbab", "integrations", name, "integration.json"), "utf8")) as IntegrationRecord;

const PLAN = {
  name: "p",
  phases: [
    { name: "b", brief: "lanes/demo.md", scope: ["b/**"], dependsOn: ["a"] },
    { name: "a", brief: "lanes/demo.md", scope: ["a/**"] },
    { name: "c", brief: "lanes/demo.md", scope: ["c/**"] },
  ],
};

describe("splitList", () => {
  it("splits on commas, trims and drops empty entries", () => {
    expect(splitList("a, b,,c ,")).toEqual(["a", "b", "c"]);
    expect(splitList(" , ")).toEqual([]);
  });
});

describe("integrationLanes", () => {
  it("keeps --lanes in the order given", () => {
    p = makeProject();
    expect(integrationLanes(openProject(p.ctx), { lanes: "b,a" })).toEqual(["b", "a"]);
  });

  it("takes a plan's lanes from src/plan's integrationLanes, not from its waves", () => {
    p = makeProject({ files: { "plans/p.json": JSON.stringify(PLAN) } });
    const seen: PlanSpec[] = [];
    // Stands in for src/plan's integrationLanes, which leaves out a phase that borrows another lane's worktree.
    const planLanes = (plan: PlanSpec): string[] => {
      seen.push(plan);
      return ["a", "b"];
    };
    expect(integrationLanes(openProject(p.ctx), { plan: "plans/p.json" }, planLanes)).toEqual(["a", "b"]);
    expect(seen.map((plan) => plan.name)).toEqual(["p"]);
    expect(() => integrationLanes(openProject(p.ctx), { plan: "plans/p.json" }, () => ["a", "a"])).toThrow(/listed twice/);
  });

  it("orders a plan through src/plan when it has integrationLanes, and refuses --plan otherwise", () => {
    p = makeProject({ files: { "plans/p.json": JSON.stringify(PLAN) } });
    const fromPlan: unknown = Reflect.get(plans, "integrationLanes");
    if (typeof fromPlan === "function") {
      expect(integrationLanes(openProject(p.ctx), { plan: "plans/p.json" })).toEqual(["a", "c", "b"]);
    } else {
      expect(() => integrationLanes(openProject(p.ctx), { plan: "plans/p.json" })).toThrow(/use --lanes/);
    }
  });

  it("refuses a plan whose phase brief a config credentialPaths entry hits", () => {
    p = makeProject({ config: { ...DEFAULT_CONFIG, credentialPaths: ["lanes/demo.md"] }, files: { "plans/p.json": JSON.stringify(PLAN) } });
    expect(() => integrationLanes(openProject(p.ctx), { plan: "plans/p.json" }, () => ["a"])).toThrow(/^phases\[0\]\.brief: lanes\/demo\.md matches the credential path/);
  });

  it("refuses both or neither source, an empty list, a duplicate and an invalid name", () => {
    p = makeProject();
    const project = openProject(p.ctx);
    expect(() => integrationLanes(project, { lanes: "a", plan: "plans/p.json" })).toThrow(/exclude each other/);
    expect(() => integrationLanes(project, {})).toThrow(/usage: arbab integrate/);
    expect(() => integrationLanes(project, { lanes: " , " })).toThrow(/no lanes/);
    expect(() => integrationLanes(project, { lanes: "a,a" })).toThrow(/listed twice/);
    expect(() => integrationLanes(project, { lanes: "../x" })).toThrow(/lane/);
  });
});

describe("runIntegrate", () => {
  it("merges the lanes in order and prints them with the head", async () => {
    p = makeProject();
    const a = branchWith(p, "arbab/a", "a.txt", "a\n");
    const b = branchWith(p, "arbab/b", "b.txt", "b\n");
    expect(await runIntegrate(["rel", "--lanes", "a,b"], p.ctx)).toBe(0);
    const record = recordOf(p, "rel");
    expect(record.merged.map((m) => [m.lane, m.sha, m.manifests])).toEqual([
      ["a", a, []],
      ["b", b, []],
    ]);
    expect(record.depsConfirmed).toBe(true);
    expect(p.stdout()).toBe(
      `merged a ${a}\nmerged b ${b}\nhead ${record.headSha}  (integrate/rel in ${record.worktree})\n`,
    );
    expect(existsSync(join(record.worktree, "a.txt")) && existsSync(join(record.worktree, "b.txt"))).toBe(true);
  });

  it("flags a manifest change with what to do, and --deps-installed confirms it", async () => {
    p = makeProject();
    branchWith(p, "arbab/a", "package.json", '{"name":"x"}\n');
    expect(await runIntegrate(["rel", "--lanes", "a", "--json"], p.ctx)).toBe(0);
    const json = JSON.parse(p.stdout()) as IntegrationRecord;
    expect(json.depsConfirmed).toBe(false);
    expect(json.merged[0]?.manifests).toEqual(["package.json"]);
    expect(formatIntegration(json)).toContain(`then run: arbab integrate rel --deps-installed ${json.headSha}`);
    expect(formatIntegration(json)).toContain("  a: package.json");

    p.out.length = 0;
    // The flag takes the head the human reviewed.
    await expect(runIntegrate(["rel", "--deps-installed"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    expect(recordOf(p, "rel").depsConfirmed).toBe(false);
    expect(await runIntegrate(["rel", "--deps-installed", json.headSha], p.ctx)).toBe(0);
    expect(p.stdout()).toBe(`deps confirmed for rel at ${json.headSha}\n`);
    expect(recordOf(p, "rel").depsConfirmed).toBe(true);
  });

  it("says when --deps-installed has nothing to confirm, and refuses it once the branch moved", async () => {
    p = makeProject();
    branchWith(p, "arbab/a", "a.txt", "a\n");
    expect(await runIntegrate(["rel", "--lanes", "a"], p.ctx)).toBe(0);
    const before = recordOf(p, "rel");
    p.out.length = 0;
    expect(await runIntegrate(["rel", "--deps-installed", before.headSha], p.ctx)).toBe(0);
    expect(p.stdout()).toBe(`nothing to confirm for rel: no dependency manifest differs between main and ${before.headSha}\n`);
    expect(recordOf(p, "rel")).toEqual(before);

    p.ok(["commit", "-q", "--allow-empty", "-m", "by hand"], before.worktree);
    await expect(runIntegrate(["rel", "--deps-installed", before.headSha], p.ctx)).rejects.toMatchObject({
      code: "usage",
      message: expect.stringMatching(/^integrate\/rel is at [0-9a-f]{40}, not [0-9a-f]{40}, the head whose manifests/),
    });
  });

  it("prints the lanes the branch already held, and advice for manifests no lane changed", async () => {
    p = makeProject();
    const a = branchWith(p, "arbab/a", "a.txt", "a\n");
    expect(await runIntegrate(["rel", "--lanes", "a"], p.ctx)).toBe(0);
    const worktree = recordOf(p, "rel").worktree;
    // A conflict resolved by hand in the integration worktree, changing package.json.
    writeFileSync(join(worktree, "package.json"), "{}\n");
    p.ok(["add", "--", "package.json"], worktree);
    p.ok(["commit", "-q", "-m", "resolved by hand"], worktree);
    p.out.length = 0;
    expect(await runIntegrate(["rel", "--lanes", "a"], p.ctx)).toBe(0);
    const record = recordOf(p, "rel");
    expect(record).toMatchObject({ manifests: ["package.json"], depsConfirmed: false });
    expect(p.stdout()).toBe(
      [
        "a: already in integrate/rel",
        `merged a ${a}`,
        `head ${record.headSha}  (integrate/rel in ${worktree})`,
        "dependency manifests changed and were not installed (installing would run worker code on the host); a human, not the orchestrator:",
        "  a commit arbab did not merge: package.json",
        `review the change and what an install at ${record.headSha} runs (package.json scripts and the files they run, .npmrc, .pnpmfile.*), install the dependencies in ${worktree} yourself, then run: arbab integrate rel --deps-installed ${record.headSha}`,
        "confirming lets arbab install at that head on this machine for verify and review",
      ].join("\n") + "\n",
    );
  });

  it("refuses while an active lane borrows the worktree of a lane being integrated, naming both", async () => {
    p = makeProject();
    branchWith(p, "arbab/a", "a.txt", "a\n");
    branchWith(p, "arbab/c", "c.txt", "c\n");
    writeLaneRun(p.runsRoot, "a-fix", { state: "running", shepherdPid: 5555, lane: { name: "a-fix", role: "implementer", brief: "lanes/demo.md", worktree: "a" } });
    p.alive.add(5555);
    // Borrowing a lane that is not integrated, or finished, does not matter.
    writeLaneRun(p.runsRoot, "x-fix", { state: "running", shepherdPid: 5556, lane: { name: "x-fix", role: "implementer", brief: "lanes/demo.md", worktree: "x" } });
    p.alive.add(5556);
    writeLaneRun(p.runsRoot, "c-fix", { state: "finished", shepherdPid: 5557, lane: { name: "c-fix", role: "implementer", brief: "lanes/demo.md", worktree: "c" } });

    await expect(runIntegrate(["rel", "--lanes", "c,a"], p.ctx)).rejects.toMatchObject({
      code: "usage",
      message: "lane a-fix works in lane a's worktree and commits onto arbab/a, and it is running (shepherd 5555); stop it or wait for it before integrating a",
    });
    expect(existsSync(join(p.root, ".arbab", "integrations", "rel"))).toBe(false);
    expect(await runIntegrate(["rel", "--lanes", "c"], p.ctx)).toBe(0);

    // Its shepherd gone, the lane is no longer active.
    p.alive.delete(5555);
    expect(await runIntegrate(["rel", "--lanes", "c,a"], p.ctx)).toBe(0);
    expect(recordOf(p, "rel").merged.map((m) => m.lane)).toEqual(["c", "a"]);
  });

  it("refuses --deps-installed without a person's terminal, confirming nothing: it is the human's step", async () => {
    p = makeProject();
    branchWith(p, "arbab/m", "package.json", "{}\n");
    expect(await runIntegrate(["rel", "--lanes", "m"], p.ctx)).toBe(0);
    const before = recordOf(p, "rel");
    await expect(runIntegrate(["rel", "--deps-installed", before.headSha], { ...p.ctx, interactive: false })).rejects.toMatchObject({
      code: "usage",
      message: expect.stringMatching(/^--deps-installed is the human's confirmation: run it yourself in a terminal/),
    });
    expect(recordOf(p, "rel")).toMatchObject({ depsConfirmedAt: null, depsConfirmed: false });
  });

  it("refuses --deps-installed with lanes or before the first integrate", async () => {
    p = makeProject();
    const sha = "a".repeat(40);
    await expect(runIntegrate(["rel", "--deps-installed", sha, "--lanes", "a"], p.ctx)).rejects.toThrow(/takes no lanes/);
    await expect(runIntegrate(["rel", "--deps-installed", sha], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/does not exist/) });
    await expect(runIntegrate(["rel", "--deps-installed"], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/argument missing/) });
  });

  it("refuses a lane that is still running, before merging anything", async () => {
    p = makeProject();
    branchWith(p, "arbab/a", "a.txt", "a\n");
    writeLaneRun(p.runsRoot, "a", { state: "running", shepherdPid: 5555 });
    p.alive.add(5555);
    await expect(runIntegrate(["rel", "--lanes", "a"], p.ctx)).rejects.toThrow(/lane a is running/);
    expect(existsSync(join(p.root, ".arbab", "integrations", "rel"))).toBe(false);
  });

  it("refuses an orphaned lane whose worker is still alive, before merging anything", async () => {
    p = makeProject();
    branchWith(p, "arbab/a", "a.txt", "a\n");
    // Its shepherd (9999) is dead, so the lane reads as orphaned, not active; its worker (7000) still writes.
    writeLaneRun(p.runsRoot, "a", { state: "running", shepherdPid: 9999, started: { pid: 7000 } });
    p.alive.add(7000);
    p.commands.set(7000, "/opt/claude/bin/claude -p --output-format stream-json");
    await expect(runIntegrate(["rel", "--lanes", "a"], p.ctx)).rejects.toMatchObject({
      code: "usage",
      message: expect.stringMatching(/lane a's worker from attempt 1 \(pid 7000\) is still running without its shepherd/),
    });
    expect(existsSync(join(p.root, ".arbab", "integrations", "rel"))).toBe(false);

    p.alive.delete(7000);
    expect(await runIntegrate(["rel", "--lanes", "a"], p.ctx)).toBe(0);
  });

  it("fails on a conflict with exit-2 git error, keeping the lanes merged before it", async () => {
    p = makeProject();
    branchWith(p, "arbab/a", "same.txt", "a\n");
    branchWith(p, "arbab/b", "same.txt", "b\n");
    await expect(runIntegrate(["rel", "--lanes", "a,b"], p.ctx)).rejects.toMatchObject({
      code: "git",
      message: expect.stringMatching(/conflicts in same\.txt/),
    });
    expect(recordOf(p, "rel").merged.map((m) => m.lane)).toEqual(["a"]);
  });

  it("rejects a missing or invalid name", async () => {
    p = makeProject();
    await expect(runIntegrate(["--lanes", "a"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runIntegrate(["Bad Name", "--lanes", "a"], p.ctx)).rejects.toMatchObject({ code: "usage" });
  });

  it("refuses a name with the ref- prefix, which verify --ref reserves, and allows one that only contains it", async () => {
    p = makeProject();
    branchWith(p, "arbab/a", "a.txt", "a\n");
    const reserved = { code: "usage", message: expect.stringMatching(/prefix ref- is reserved for verify --ref/) };
    await expect(runIntegrate(["ref-main", "--lanes", "a"], p.ctx)).rejects.toMatchObject(reserved);
    await expect(runIntegrate(["ref-main", "--adopt", "arbab/a"], p.ctx)).rejects.toMatchObject(reserved);
    expect(existsSync(join(p.root, ".arbab", "integrations", "ref-main"))).toBe(false);
    expect(await runIntegrate(["pref-main", "--lanes", "a"], p.ctx)).toBe(0);
  });
});

describe("runIntegrate --adopt", () => {
  it("makes an integration of an existing branch and prints it", async () => {
    p = makeProject();
    const main = p.ok(["rev-parse", "main"]).trim();
    const sha = branchWith(p, "feature", "f.txt", "f\n");
    expect(await runIntegrate(["rel", "--adopt", "feature"], p.ctx)).toBe(0);
    const record = recordOf(p, "rel");
    expect(record).toMatchObject({ branch: "integrate/rel", base: "main", baseSha: main, headSha: sha, merged: [], manifests: [], depsConfirmed: true });
    expect(p.stdout()).toBe(`adopted feature as integrate/rel (base main at ${main})\n` + formatIntegration(record));
    expect(p.ok(["rev-parse", "integrate/rel"]).trim()).toBe(sha);

    // An adopted integration takes lanes like any other.
    branchWith(p, "arbab/a", "a.txt", "a\n");
    expect(await runIntegrate(["rel", "--lanes", "a"], p.ctx)).toBe(0);
    expect(recordOf(p, "rel").merged.map((m) => m.lane)).toEqual(["a"]);
  });

  it("takes --base and prints the record with --json", async () => {
    p = makeProject();
    p.ok(["branch", "release", "main"]);
    const sha = branchWith(p, "feature", "f.txt", "f\n");
    expect(await runIntegrate(["rel", "--adopt", sha, "--base", "release", "--json"], p.ctx)).toBe(0);
    expect(JSON.parse(p.stdout())).toEqual(recordOf(p, "rel"));
    expect(recordOf(p, "rel")).toMatchObject({ base: "release", headSha: sha });
  });

  it("refuses --lanes, --plan or --deps-installed with --adopt, --base without it, an existing name and an unknown ref", async () => {
    p = makeProject();
    branchWith(p, "feature", "f.txt", "f\n");
    await expect(runIntegrate(["rel", "--adopt", "feature", "--lanes", "a"], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/^--adopt takes no --lanes or --plan/) });
    await expect(runIntegrate(["rel", "--adopt", "feature", "--plan", "plans/p.json"], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/^--adopt takes no --lanes or --plan/) });
    await expect(runIntegrate(["rel", "--adopt", "feature", "--deps-installed", "a".repeat(40)], p.ctx)).rejects.toThrow(/--deps-installed and --adopt exclude each other/);
    await expect(runIntegrate(["rel", "--lanes", "a", "--base", "main"], p.ctx)).rejects.toThrow(/^--base goes with --adopt/);
    await expect(runIntegrate(["rel", "--adopt", "nowhere"], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/^--adopt nowhere does not name a commit/) });
    expect(existsSync(join(p.root, ".arbab", "integrations", "rel"))).toBe(false);

    expect(await runIntegrate(["rel", "--adopt", "feature"], p.ctx)).toBe(0);
    await expect(runIntegrate(["rel", "--adopt", "feature"], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/^integration rel already exists/) });
  });

  it("refuses a --base the base branch does not contain, before creating anything", async () => {
    p = makeProject();
    // A lane's branch as --base would install its worker-written tree on the host.
    branchWith(p, "arbab/x", "x.txt", "x\n");
    await expect(runIntegrate(["rel", "--adopt", "arbab/x", "--base", "arbab/x"], p.ctx)).rejects.toMatchObject({
      code: "usage",
      message: expect.stringMatching(/^--base arbab\/x is not contained in main/),
    });
    expect(existsSync(join(p.root, ".arbab", "integrations", "rel"))).toBe(false);
    expect(existsSync(join(p.worktreeRoot, "integrate-rel"))).toBe(false);
    expect(p.git(["rev-parse", "--verify", "--quiet", "refs/heads/integrate/rel"], p.root).code).not.toBe(0);
  });

  it("refuses a --base that is not a branch: land merges into it", async () => {
    p = makeProject();
    const main = p.ok(["rev-parse", "main"]).trim();
    branchWith(p, "feature", "f.txt", "f\n");
    await expect(runIntegrate(["rel", "--adopt", "feature", "--base", main], p.ctx)).rejects.toMatchObject({
      code: "usage",
      message: expect.stringMatching(new RegExp(`^--base ${main} is not a branch: land merges the integration into its base`)),
    });
    expect(existsSync(join(p.root, ".arbab", "integrations", "rel"))).toBe(false);
    expect(existsSync(join(p.worktreeRoot, "integrate-rel"))).toBe(false);
    expect(p.git(["rev-parse", "--verify", "--quiet", "refs/heads/integrate/rel"], p.root).code).not.toBe(0);
  });
});

describe("runIntegrate --refresh", () => {
  it("records a hand commit on an adopted integration and prints it", async () => {
    p = makeProject();
    branchWith(p, "feature", "f.txt", "f\n");
    expect(await runIntegrate(["rel", "--adopt", "feature"], p.ctx)).toBe(0);
    const worktree = join(p.worktreeRoot, "integrate-rel");
    p.ok(["commit", "-q", "--allow-empty", "-m", "by hand"], worktree);
    const head = p.ok(["rev-parse", "HEAD"], worktree).trim();
    p.out.length = 0;
    expect(await runIntegrate(["rel", "--refresh"], p.ctx)).toBe(0);
    const record = recordOf(p, "rel");
    expect(record).toMatchObject({ headSha: head, merged: [] });
    expect(p.stdout()).toBe(`refreshed rel: recorded integrate/rel at ${head}\n` + formatIntegration(record));
    p.out.length = 0;
    expect(await runIntegrate(["rel", "--refresh", "--json"], p.ctx)).toBe(0);
    expect(JSON.parse(p.stdout())).toEqual(recordOf(p, "rel"));
  });

  it("refuses another mode with it, and an integration that does not exist", async () => {
    p = makeProject();
    for (const [args, flag] of [
      [["--lanes", "a"], "--lanes"],
      [["--plan", "plans/p.json"], "--plan"],
      [["--deps-installed", "a".repeat(40)], "--deps-installed"],
      [["--adopt", "main"], "--adopt"],
    ] as const) {
      await expect(runIntegrate(["rel", "--refresh", ...args], p.ctx)).rejects.toMatchObject({ code: "usage", message: `--refresh takes no ${flag}: it records the existing head again and merges nothing` });
    }
    await expect(runIntegrate(["rel", "--refresh"], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/^integration rel does not exist/) });
    expect(existsSync(join(p.worktreeRoot, "integrate-rel"))).toBe(false);
  });
});
