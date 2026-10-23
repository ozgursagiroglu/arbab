import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { baseMergeInstruction } from "../readiness";
import { registerShepherd, registerWaiter } from "../registry";
import type { HostCheckRecord, IntegrationRecord, ReadinessReport, ReviewRecord } from "../types";
import { writeJsonAtomic } from "../util/fs";
import { runIntegrate } from "./integrate";
import { integrationChanges, laneReports, parseTier, reviewRounds, runReadiness } from "./readiness";
import { DEFAULT_CONFIG, branchWith, makeProject, passedVerify, writeLaneRun, type TestProject } from "./testkit";

let p: TestProject;
afterEach(() => p?.dispose());

const dir = (t: TestProject): string => join(t.root, ".arbab", "integrations", "rel");
const readRecord = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const worktree = (t: TestProject): string => readRecord<IntegrationRecord>(join(dir(t), "integration.json")).worktree;
const SESSION = "aaaaaaaa-1111-2222-3333-444444444444";
const OTHER_SESSION = "bbbbbbbb-1111-2222-3333-444444444444";
const AT = "2026-10-09T12:00:00.000Z";

async function integrated(config: Record<string, unknown> = {}): Promise<{ t: TestProject; head: string }> {
  const t = makeProject({ config: { ...DEFAULT_CONFIG, ...config } });
  branchWith(t, "arbab/a", "a.txt", "a\n");
  expect(await runIntegrate(["rel", "--lanes", "a"], t.ctx)).toBe(0);
  t.out.length = 0;
  return { t, head: readRecord<IntegrationRecord>(join(dir(t), "integration.json")).headSha };
}

/** A review.json of "rel" at `head` whose one lens counts. */
function reviewOf(head: string): ReviewRecord {
  return {
    name: "rel",
    headSha: head,
    lenses: [{ lens: "correctness", lane: "rel-review-correctness", endState: "success", coverage: "every file", pathsChecked: 2 }],
    skeptics: [],
    findings: [],
    finishedAt: "2026-10-09T12:00:00.000Z",
  };
}

/** Merges `ref` into the integration worktree with a merge commit and records the new head, as integrate would. */
function mergeIntoIntegration(t: TestProject, ref: string): string {
  const path = join(dir(t), "integration.json");
  const record = readRecord<IntegrationRecord>(path);
  t.ok(["merge", "-q", "--no-ff", "--no-edit", ref], record.worktree);
  const head = t.ok(["rev-parse", "HEAD"], record.worktree).trim();
  writeJsonAtomic(path, { ...record, headSha: head });
  return head;
}

describe("parseTier", () => {
  it("takes a tier, falls back when none is given and refuses anything else", () => {
    expect(parseTier("high", "medium")).toBe("high");
    expect(parseTier(undefined, "low")).toBe("low");
    expect(() => parseTier("extreme", "low")).toThrow(/must be one of low, medium, high/);
  });
});

describe("integrationChanges", () => {
  it("lists the paths the integration changes from its merge base with the base, and none when git cannot tell", async () => {
    let head: string;
    ({ t: p, head } = await integrated());
    // A commit the base gains after the integration is not the integration's change.
    p.ok(["checkout", "-q", "main"]);
    p.write("later.txt", "x\n");
    p.ok(["add", "later.txt"]);
    p.ok(["commit", "-q", "-m", "later"]);
    expect(integrationChanges(p.ctx, p.root, "main", head)).toEqual(["a.txt"]);
    expect(integrationChanges(p.ctx, p.root, "no-such-branch", head)).toEqual([]);
  });
});

describe("laneReports", () => {
  it("each merged lane's latest report, then each borrower of one with the worktree it borrowed", async () => {
    ({ t: p } = await integrated());
    const lane = (name: string, worktree: unknown) => ({ name, role: "implementer", brief: "lanes/demo.md", worktree });
    writeLaneRun(p.runsRoot, "a", { state: "finished", attempt: 1, report: { open_questions: ["old"], not_verified: [] } });
    writeLaneRun(p.runsRoot, "a", { state: "finished", attempt: 2, report: { open_questions: ["new"], not_verified: [] } });
    writeLaneRun(p.runsRoot, "a-fix", { state: "running", lane: lane("a-fix", "a") });
    writeLaneRun(p.runsRoot, "other", { state: "finished", lane: lane("other", 3) });
    expect(laneReports(p.runsRoot, ["a", "missing"])).toEqual([
      { lane: "a", report: { open_questions: ["new"], not_verified: [] } },
      { lane: "missing", report: null },
      { lane: "a-fix", report: null, worktree: "a" },
    ]);
  });
});

describe("runReadiness", () => {
  it("is ready at tier low once verify passed on the head; writes both files and prints the Markdown", async () => {
    let head: string;
    ({ t: p, head } = await integrated());
    writeJsonAtomic(join(dir(p), "verify.json"), passedVerify(head));
    writeLaneRun(p.runsRoot, "a", {
      state: "finished",
      endState: "success",
      report: { status: "done", open_questions: ["is the cache needed?"], not_verified: [] },
    });
    expect(await runReadiness(["rel", "--tier", "low"], p.ctx)).toBe(0);

    const report = readRecord<ReadinessReport>(join(dir(p), "readiness.json"));
    expect(report).toMatchObject({ name: "rel", tier: "low", headSha: head, ready: true, skipped: [] });
    expect(report.risks.map((r) => r.text)).toEqual(["a (open question): is the cache needed?"]);
    const markdown = readFileSync(join(dir(p), "readiness.md"), "utf8");
    expect(p.stdout()).toBe(markdown);
    expect(markdown).toContain("Ready to land: yes");
  });

  it("lists other sessions the landing affects under Risks, and stays ready", async () => {
    let head: string;
    ({ t: p, head } = await integrated());
    writeJsonAtomic(join(dir(p), "verify.json"), passedVerify(head));
    p.ctx.hostEnv = { CLAUDE_CODE_SESSION_ID: SESSION };
    registerShepherd(p.home, { pid: 7001, lane: "mine", project: p.root, owner: SESSION, startedAt: AT });
    registerShepherd(p.home, { pid: 7002, lane: "theirs", project: p.root, owner: OTHER_SESSION, startedAt: AT });
    // Other projects' waiters: one runs a file the integration changes, one a file it leaves alone.
    registerWaiter(p.home, { pid: 7003, project: "/work/elsewhere", owner: null, startedAt: AT, runner: join(p.root, "a.txt") });
    registerWaiter(p.home, { pid: 7004, project: "/work/elsewhere", owner: null, startedAt: AT, runner: join(p.root, "lanes", "demo.md") });
    for (const pid of [7001, 7002, 7003, 7004]) p.alive.add(pid);
    expect(await runReadiness(["rel", "--tier", "low"], p.ctx)).toBe(0);

    const report = readRecord<ReadinessReport>(join(dir(p), "readiness.json"));
    expect(report.ready).toBe(true);
    expect(report.skipped).toEqual([]);
    expect(report.otherSessions).toEqual([
      { owner: OTHER_SESSION, lanes: ["theirs"], waiters: 0, runnerProjects: [], runnersChanged: [] },
      { owner: null, lanes: [], waiters: 0, runnerProjects: ["/work/elsewhere"], runnersChanged: ["a.txt"] },
    ]);
    // Lane a wrote no report here, which is a risk of its own after the sessions.
    expect(report.risks.map((r) => r.id)).toEqual(["session:bbbbbbbb", "session:outside", "report:a"]);
    const markdown = readFileSync(join(dir(p), "readiness.md"), "utf8");
    const risks = markdown.slice(markdown.indexOf("## Risks"));
    expect(risks).toContain(
      "- Session bbbbbbbb runs lane theirs in this project, whose base this landing moves. " +
        "Tell them before landing: Claude Code's ListAgents lists sessions by name and SendMessage reaches them.",
    );
    expect(risks).toContain("- Processes started outside Claude Code run this project's a.txt in /work/elsewhere, which this landing replaces.");
  });

  it("writes one risk, and stays ready, when the machine registry cannot be listed", async () => {
    let head: string;
    ({ t: p, head } = await integrated());
    writeJsonAtomic(join(dir(p), "verify.json"), passedVerify(head));
    writeLaneRun(p.runsRoot, "a", { state: "finished", endState: "success", report: { status: "done", open_questions: [], not_verified: [] } });
    // A file where the shepherds' directory belongs.
    mkdirSync(p.home, { recursive: true });
    writeFileSync(join(p.home, "shepherds"), "");
    expect(await runReadiness(["rel", "--tier", "low"], p.ctx)).toBe(0);

    const report = readRecord<ReadinessReport>(join(dir(p), "readiness.json"));
    expect(report).toMatchObject({ ready: true, skipped: [] });
    expect(report.risks).toEqual([
      { id: "session:unknown", text: expect.stringMatching(/^cannot tell which other sessions are working here: cannot list .*shepherds: /) },
    ]);
    expect(report).not.toHaveProperty("otherSessions");
    expect(readFileSync(join(dir(p), "readiness.md"), "utf8")).toContain("- cannot tell which other sessions are working here: ");
  });

  it("finds a changed runner when the project is a subdirectory of its repository", async () => {
    p = makeProject();
    // The project moves into app/ of a new repository, which the integration then changes.
    const top = join(p.dir, "mono");
    const app = join(top, "app");
    mkdirSync(top);
    p.ok(["init", "-q", "-b", "main", top], p.dir);
    renameSync(p.root, app);
    rmSync(join(app, ".git"), { recursive: true, force: true });
    p.ok(["add", "-A"], top);
    p.ok(["commit", "-q", "-m", "init"], top);
    p.ok(["checkout", "-q", "-b", "arbab/a"], top);
    writeFileSync(join(app, "a.txt"), "a\n");
    p.ok(["add", "-A"], top);
    p.ok(["commit", "-q", "-m", "a"], top);
    p.ok(["checkout", "-q", "main"], top);
    p.ctx.cwd = app;
    expect(await runIntegrate(["rel", "--lanes", "a"], p.ctx)).toBe(0);
    const integration = join(app, ".arbab", "integrations", "rel");
    writeJsonAtomic(join(integration, "verify.json"), passedVerify(readRecord<IntegrationRecord>(join(integration, "integration.json")).headSha));
    registerWaiter(p.home, { pid: 7003, project: "/work/elsewhere", owner: null, startedAt: AT, runner: join(app, "a.txt") });
    p.alive.add(7003);
    expect(await runReadiness(["rel", "--tier", "low"], p.ctx)).toBe(0);
    expect(readRecord<ReadinessReport>(join(integration, "readiness.json")).otherSessions).toEqual([
      { owner: null, lanes: [], waiters: 0, runnerProjects: ["/work/elsewhere"], runnersChanged: ["a.txt"] },
    ]);
  });

  it("risks a base that moved since the integration started, counting its new commits when no landing explains them", async () => {
    let head: string;
    ({ t: p, head } = await integrated());
    writeJsonAtomic(join(dir(p), "verify.json"), passedVerify(head));
    expect(await runReadiness(["rel", "--tier", "low"], p.ctx)).toBe(0);
    expect(readRecord<ReadinessReport>(join(dir(p), "readiness.json")).risks.map((r) => r.id)).not.toContain("base-moved");

    for (const file of ["b.txt", "c.txt"]) {
      p.write(file, "main moves\n");
      p.ok(["add", "--", file]);
      p.ok(["commit", "-q", "-m", `main writes ${file}`]);
    }
    p.out.length = 0;
    expect(await runReadiness(["rel", "--tier", "low"], p.ctx)).toBe(0);
    const report = readRecord<ReadinessReport>(join(dir(p), "readiness.json"));
    expect(report.risks[0]).toEqual({
      id: "base-moved",
      text: `main moved since this integration started: 2 new commits, so land would refuse. ${baseMergeInstruction("main", "rel", worktree(p))}.`,
    });
    // A risk, not a skipped item: nothing to waive.
    expect(report.skipped).toEqual([]);
    expect(report.ready).toBe(true);
    expect(p.stdout()).toContain("- main moved since this integration started: 2 new commits, so land would refuse. Merge main into");
  });

  it("names the landings that moved the base, with their time and session, and not those the head holds", async () => {
    let head: string;
    ({ t: p, head } = await integrated());
    writeJsonAtomic(join(dir(p), "verify.json"), passedVerify(head));
    const landing = (name: string, mergeSha: string, landedAt: string, owner?: string | null): void =>
      writeJsonAtomic(join(p.root, ".arbab", "integrations", name, "landing.json"), {
        name,
        into: "main",
        integrationHead: mergeSha,
        mergeSha,
        landedAt,
        ...(owner !== undefined && { owner }),
        pushed: false,
      });
    // Landed before the integration started: the head holds it.
    landing("before", p.ok(["rev-parse", "main"]).trim(), "2026-10-09T10:00:00.000Z", OTHER_SESSION);
    p.write("b.txt", "hot\n");
    p.ok(["add", "--", "b.txt"]);
    p.ok(["commit", "-q", "-m", "Land hot"]);
    landing("hot", p.ok(["rev-parse", "main"]).trim(), "2026-10-09T12:30:00.000Z", OTHER_SESSION);
    p.write("c.txt", "cold\n");
    p.ok(["add", "--", "c.txt"]);
    p.ok(["commit", "-q", "-m", "Land cold"]);
    landing("cold", p.ok(["rev-parse", "main"]).trim(), "2026-10-09T12:40:00.000Z");
    // Into another branch: not what moved main.
    landing("elsewhere", p.ok(["rev-parse", "main"]).trim(), "2026-10-09T12:50:00.000Z", OTHER_SESSION);
    writeJsonAtomic(join(p.root, ".arbab", "integrations", "elsewhere", "landing.json"), {
      ...readRecord<Record<string, unknown>>(join(p.root, ".arbab", "integrations", "elsewhere", "landing.json")),
      into: "dev",
    });

    expect(await runReadiness(["rel", "--tier", "low"], p.ctx)).toBe(0);
    expect(readRecord<ReadinessReport>(join(dir(p), "readiness.json")).risks[0]).toEqual({
      id: "base-moved",
      text:
        "main moved since this integration started: hot at 2026-10-09T12:30:00.000Z (session bbbbbbbb), " +
        "cold at 2026-10-09T12:40:00.000Z (session unknown) landed, so land would refuse. " +
        `${baseMergeInstruction("main", "rel", worktree(p))}.`,
    });

    // Merged in, the base no longer moved.
    mergeIntoIntegration(p, "main");
    p.out.length = 0;
    await runReadiness(["rel", "--tier", "low"], p.ctx);
    expect(readRecord<ReadinessReport>(join(dir(p), "readiness.json")).risks.map((r) => r.id)).not.toContain("base-moved");
  });

  it("records no other sessions when none is live", async () => {
    let head: string;
    ({ t: p, head } = await integrated());
    writeJsonAtomic(join(dir(p), "verify.json"), passedVerify(head));
    registerShepherd(p.home, { pid: 7002, lane: "theirs", project: p.root, owner: OTHER_SESSION, startedAt: AT });
    expect(await runReadiness(["rel", "--tier", "low"], p.ctx)).toBe(0);
    expect(readRecord<ReadinessReport>(join(dir(p), "readiness.json")).otherSessions).toEqual([]);
  });

  it("takes the tier from config, lists what it needs as skipped, and accepts waivers by id", async () => {
    let head: string;
    ({ t: p, head } = await integrated({ landing: { tier: "medium" } }));
    writeJsonAtomic(join(dir(p), "verify.json"), passedVerify(head));
    expect(await runReadiness(["rel", "--json"], p.ctx)).toBe(1);
    const report = JSON.parse(p.stdout()) as ReadinessReport;
    expect(report.tier).toBe("medium");
    expect(report.skipped).toEqual([{ id: "review", text: "no review of the head", waived: false }]);

    p.out.length = 0;
    expect(await runReadiness(["rel", "--waive", "review, nothing"], p.ctx)).toBe(0);
    const waived = readRecord<ReadinessReport>(join(dir(p), "readiness.json"));
    expect(waived.skipped).toEqual([{ id: "review", text: "no review of the head", waived: true }]);
    expect(waived.risks.map((r) => r.id)).toContain("waiver:nothing");
  });

  it("is not ready without a verify, or with a failed or stale one", async () => {
    let head: string;
    ({ t: p, head } = await integrated());
    expect(await runReadiness(["rel", "--tier", "low"], p.ctx)).toBe(1);
    expect(readRecord<ReadinessReport>(join(dir(p), "readiness.json")).skipped.map((s) => s.text)).toEqual(["verify has not run"]);
    writeJsonAtomic(join(dir(p), "verify.json"), passedVerify(head, false));
    expect(await runReadiness(["rel", "--tier", "low"], p.ctx)).toBe(1);
    writeJsonAtomic(join(dir(p), "verify.json"), passedVerify("0".repeat(40)));
    expect(await runReadiness(["rel", "--tier", "low"], p.ctx)).toBe(1);
    expect(readRecord<ReadinessReport>(join(dir(p), "readiness.json")).risks.map((r) => r.id)).toContain("stale:verify");
  });

  it("lists the risks of a lane that worked in a merged lane's worktree, after the owner's", async () => {
    let head: string;
    ({ t: p, head } = await integrated());
    writeJsonAtomic(join(dir(p), "verify.json"), passedVerify(head));
    writeLaneRun(p.runsRoot, "a", { state: "finished", endState: "success", report: { open_questions: ["QA"], not_verified: [] } });
    const borrower = (name: string, worktree: string) => ({ name, role: "verifier", brief: "lanes/demo.md", worktree });
    writeLaneRun(p.runsRoot, "a-verify", {
      state: "finished",
      endState: "success",
      lane: borrower("a-verify", "a"),
      report: { open_questions: [], not_verified: ["Windows"] },
    });
    writeLaneRun(p.runsRoot, "z-verify", {
      state: "finished",
      endState: "success",
      lane: borrower("z-verify", "z"),
      report: { open_questions: ["not this integration"], not_verified: [] },
    });
    writeLaneRun(p.runsRoot, "b-broken", { state: "finished" });
    writeFileSync(join(p.runsRoot, "b-broken", "lane.json"), "{not json");
    expect(await runReadiness(["rel", "--tier", "low"], p.ctx)).toBe(0);
    expect(readRecord<ReadinessReport>(join(dir(p), "readiness.json")).risks.map((r) => r.text)).toEqual([
      "a (open question): QA",
      "a-verify (not verified): Windows",
    ]);
  });

  it("says why verify did not pass", async () => {
    let head: string;
    ({ t: p, head } = await integrated());
    writeJsonAtomic(join(dir(p), "verify.json"), { ...passedVerify(head, false), reason: "the lane left changes behind" });
    expect(await runReadiness(["rel", "--tier", "low"], p.ctx)).toBe(1);
    expect(readRecord<ReadinessReport>(join(dir(p), "readiness.json")).skipped).toEqual([
      { id: "verify", text: "verify did not pass on the head: the lane left changes behind", waived: false },
    ]);
  });

  it("refuses --waive without a terminal: waivers are the human's", async () => {
    let head: string;
    ({ t: p, head } = await integrated({ landing: { tier: "medium" } }));
    writeJsonAtomic(join(dir(p), "verify.json"), passedVerify(head));
    p.ctx.interactive = false;
    await expect(runReadiness(["rel", "--waive", "review"], p.ctx)).rejects.toMatchObject({
      code: "usage",
      message: expect.stringMatching(/run it yourself in a terminal/),
    });
    expect(existsSync(join(dir(p), "readiness.json"))).toBe(false);
    // Without --waive an agent still reads the report.
    expect(await runReadiness(["rel"], p.ctx)).toBe(1);
    p.ctx.interactive = true;
    expect(await runReadiness(["rel", "--waive", "review"], p.ctx)).toBe(0);
  });

  it("carries a review over a clean merge of the base, and not verify", async () => {
    let reviewed: string;
    ({ t: p, head: reviewed } = await integrated({ landing: { tier: "medium" } }));
    writeJsonAtomic(join(dir(p), "review.json"), reviewOf(reviewed));
    writeJsonAtomic(join(dir(p), "verify.json"), passedVerify(reviewed));
    p.write("base.txt", "base\n");
    p.ok(["add", "--", "base.txt"]);
    p.ok(["commit", "-q", "-m", "base moves"]);
    const head = mergeIntoIntegration(p, "main");

    expect(await runReadiness(["rel", "--json"], p.ctx)).toBe(1);
    const stale = JSON.parse(p.stdout()) as ReadinessReport;
    expect(stale.reviewCarriedOverFrom).toBe(reviewed);
    expect(stale.skipped.map((s) => s.id)).toEqual(["verify"]);
    expect(stale.verified).toContainEqual({
      id: "review-carried-over",
      text: `review carried over from ${reviewed.slice(0, 7)}: the head adds only a clean merge of main`,
    });

    writeJsonAtomic(join(dir(p), "verify.json"), passedVerify(head));
    expect(await runReadiness(["rel"], p.ctx)).toBe(0);
    expect(readRecord<ReadinessReport>(join(dir(p), "readiness.json"))).toMatchObject({ ready: true, reviewCarriedOverFrom: reviewed });
  });

  it("does not carry a review over a merge of another branch", async () => {
    let reviewed: string;
    ({ t: p, head: reviewed } = await integrated({ landing: { tier: "medium" } }));
    writeJsonAtomic(join(dir(p), "review.json"), reviewOf(reviewed));
    branchWith(p, "feature", "f.txt", "f\n");
    const head = mergeIntoIntegration(p, "feature");
    writeJsonAtomic(join(dir(p), "verify.json"), passedVerify(head));
    expect(await runReadiness(["rel"], p.ctx)).toBe(1);
    const report = readRecord<ReadinessReport>(join(dir(p), "readiness.json"));
    expect(report).not.toHaveProperty("reviewCarriedOverFrom");
    expect(report.skipped.map((s) => s.id)).toEqual(["review"]);
    expect(report.risks.map((r) => r.id)).toContain("stale:review");
  });

  it("carries a review over a clean merge of the integration's base when config now names another branch", async () => {
    let reviewed: string;
    ({ t: p, head: reviewed } = await integrated({ landing: { tier: "medium" } }));
    writeJsonAtomic(join(dir(p), "review.json"), reviewOf(reviewed));
    // Before main moves, so main's new commit is not on develop.
    branchWith(p, "develop", "d.txt", "d\n");
    p.write("base.txt", "base\n");
    p.ok(["add", "--", "base.txt"]);
    p.ok(["commit", "-q", "-m", "base moves"]);
    const head = mergeIntoIntegration(p, "main");
    writeJsonAtomic(join(dir(p), "verify.json"), passedVerify(head));
    p.write("arbab.config.json", JSON.stringify({ ...DEFAULT_CONFIG, baseBranch: "develop", landing: { tier: "medium" } }));

    expect(await runReadiness(["rel"], p.ctx)).toBe(0);
    expect(readRecord<ReadinessReport>(join(dir(p), "readiness.json"))).toMatchObject({ ready: true, reviewCarriedOverFrom: reviewed });
  });

  it("does not carry a review over a merge of config's base branch when the integration's base is another", async () => {
    let reviewed: string;
    ({ t: p, head: reviewed } = await integrated({ landing: { tier: "medium" } }));
    writeJsonAtomic(join(dir(p), "review.json"), reviewOf(reviewed));
    branchWith(p, "develop", "d.txt", "d\n");
    p.write("arbab.config.json", JSON.stringify({ ...DEFAULT_CONFIG, baseBranch: "develop", landing: { tier: "medium" } }));
    const head = mergeIntoIntegration(p, "develop");
    writeJsonAtomic(join(dir(p), "verify.json"), passedVerify(head));

    expect(await runReadiness(["rel"], p.ctx)).toBe(1);
    const report = readRecord<ReadinessReport>(join(dir(p), "readiness.json"));
    expect(report).not.toHaveProperty("reviewCarriedOverFrom");
    expect(report.skipped.map((s) => s.id)).toEqual(["review"]);
  });

  it("lists the host gates until host-checks.json passed on the head; host may be waived", async () => {
    let head: string;
    ({ t: p, head } = await integrated({ hostGates: [["docker", "build", "."]] }));
    writeJsonAtomic(join(dir(p), "verify.json"), passedVerify(head));
    expect(await runReadiness(["rel", "--tier", "low"], p.ctx)).toBe(1);
    expect(readRecord<ReadinessReport>(join(dir(p), "readiness.json")).skipped.map((s) => s.id)).toEqual(["host"]);
    expect(await runReadiness(["rel", "--tier", "low", "--waive", "host"], p.ctx)).toBe(0);

    const record: HostCheckRecord = {
      name: "rel",
      headSha: head,
      results: [{ kind: "gate", argv: ["docker", "build", "."], command: "docker build .", exitCode: 0 }],
      passed: true,
      interactive: true,
      finishedAt: "2026-10-09T12:00:00.000Z",
    };
    writeJsonAtomic(join(dir(p), "host-checks.json"), record);
    expect(await runReadiness(["rel", "--tier", "low"], p.ctx)).toBe(0);
    expect(readRecord<ReadinessReport>(join(dir(p), "readiness.json")).verified).toContainEqual({
      id: "host:docker build .",
      text: "host gate: exit 0",
    });
    writeFileSync(join(dir(p), "host-checks.json"), JSON.stringify({ ...record, interactive: false }));
    await expect(runReadiness(["rel", "--tier", "low"], p.ctx)).rejects.toMatchObject({ code: "io" });
  });

  it("shows the review rounds from reviews/<round>.json", async () => {
    let head: string;
    ({ t: p, head } = await integrated());
    writeJsonAtomic(join(dir(p), "verify.json"), passedVerify(head));
    const finding = (id: string, severity: string, verdict = "confirmed") => ({
      id,
      lens: "correctness",
      title: "t",
      severity,
      file: "a.txt",
      failureScenario: "s",
      evidence: "e",
      verdict,
    });
    writeJsonAtomic(join(dir(p), "reviews", "1.json"), {
      ...reviewOf("0".repeat(40)),
      round: 1,
      findings: [finding("c-1", "MEDIUM"), finding("c-2", "MEDIUM"), finding("c-3", "LOW", "unverified"), finding("c-4", "HIGH", "refuted")],
    });
    writeJsonAtomic(join(dir(p), "reviews", "2.json"), { ...reviewOf("0".repeat(40)), round: 2, findings: [finding("c-1", "LOW")] });
    writeJsonAtomic(join(dir(p), "reviews", "10.json"), { ...reviewOf(head), round: 10 });
    // Not a round, or not a review of this integration: left out.
    writeFileSync(join(dir(p), "reviews", "3.json"), "{not json");
    writeJsonAtomic(join(dir(p), "reviews", "4.json"), { ...reviewOf(head), name: "other" });
    writeJsonAtomic(join(dir(p), "reviews", "notes.json"), reviewOf(head));
    expect(reviewRounds(dir(p), "rel").map((r) => r.round)).toEqual([1, 2, 10]);
    expect(reviewRounds(join(dir(p), "missing"), "rel")).toEqual([]);

    expect(await runReadiness(["rel", "--tier", "low"], p.ctx)).toBe(0);
    expect(readRecord<ReadinessReport>(join(dir(p), "readiness.json")).verified).toContainEqual({
      id: "review-rounds",
      text: "review rounds: 1: 2 MEDIUM, 1 LOW · 2: 1 LOW · 10: none",
    });
  });

  it("refuses a damaged verify.json, an unknown tier and a missing integration", async () => {
    ({ t: p } = await integrated());
    writeFileSync(join(dir(p), "verify.json"), JSON.stringify({ name: "rel", passed: "yes" }));
    await expect(runReadiness(["rel"], p.ctx)).rejects.toMatchObject({ code: "io" });
    await expect(runReadiness(["rel", "--tier", "max"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runReadiness(["other"], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/does not exist/) });
  });
});
