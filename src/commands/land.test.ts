import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { untrustedTree } from "../run";
import type { IntegrationRecord, LandingRecord, ReadinessReport, ReviewRecord } from "../types";
import { writeJsonAtomic } from "../util/fs";
import type { WorktreeCleanup } from "./cleanup";
import { markGenerated } from "./generated";
import { runIntegrate } from "./integrate";
import { assertBaseInHead, assertCleanBase, assertReadinessCurrent, assertTier, firstRemote, runLand } from "./land";
import { runReadiness } from "./readiness";
import { DEFAULT_CONFIG, branchWith, makeProject, passedVerify, writeLaneRun, type TestProject } from "./testkit";

let p: TestProject;
afterEach(() => p?.dispose());

const dir = (t: TestProject): string => join(t.root, ".arbab", "integrations", "rel");
const readRecord = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const hasBranch = (t: TestProject, branch: string): boolean => t.git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], t.root).code === 0;
const T = "2026-10-09T12:00:00.000Z";
const LIVE = 101;

/** A finished lane's worktree on arbab/<lane>: the existing branch, or a new one at `from`. */
function laneWorktree(t: TestProject, lane: string, from?: string): string {
  const path = join(t.worktreeRoot, lane);
  t.ok(["worktree", "add", "-q", ...(from === undefined ? [path, `arbab/${lane}`] : ["-b", `arbab/${lane}`, path, from])]);
  writeLaneRun(t.runsRoot, lane, { state: "finished", endState: "success" });
  return path;
}

/** An integration of lane a that verified and is ready at tier low. */
async function ready(): Promise<{ t: TestProject; head: string }> {
  const t = makeProject({ config: { ...DEFAULT_CONFIG, landing: { tier: "low" } } });
  // A real shepherd ignores the run dirs the tests write; the main checkout must stay clean to land.
  appendFileSync(join(t.root, ".git", "info", "exclude"), ".arbab/runs/\n");
  branchWith(t, "arbab/a", "a.txt", "a\n");
  expect(await runIntegrate(["rel", "--lanes", "a"], t.ctx)).toBe(0);
  const head = readRecord<IntegrationRecord>(join(dir(t), "integration.json")).headSha;
  writeJsonAtomic(join(dir(t), "verify.json"), passedVerify(head));
  expect(await runReadiness(["rel"], t.ctx)).toBe(0);
  t.out.length = 0;
  return { t, head };
}

/** What the refusal asks for after the base moved: main merged into the integration, the new head verified and ready. */
async function mergeMainAndVerify(t: TestProject): Promise<string> {
  const record = readRecord<IntegrationRecord>(join(dir(t), "integration.json"));
  t.ok(["merge", "-q", "--no-edit", "main"], record.worktree);
  const head = t.ok(["rev-parse", "HEAD"], record.worktree).trim();
  writeJsonAtomic(join(dir(t), "integration.json"), { ...record, headSha: head });
  writeJsonAtomic(join(dir(t), "verify.json"), passedVerify(head));
  expect(await runReadiness(["rel"], t.ctx)).toBe(0);
  t.out.length = 0;
  return head;
}

describe("firstRemote", () => {
  it("names the first remote, or null", () => {
    p = makeProject();
    expect(firstRemote(p.git, p.root)).toBeNull();
    p.ok(["remote", "add", "upstream", "/nonexistent/u.git"]);
    p.ok(["remote", "add", "origin", "/nonexistent/o.git"]);
    expect(firstRemote(p.git, p.root)).toBe("origin");
  });
});

describe("assertCleanBase", () => {
  it("passes on a clean base branch and refuses another branch or changes", () => {
    p = makeProject();
    expect(() => assertCleanBase(p.git, p.root, "main")).not.toThrow();
    expect(() => assertCleanBase(p.git, p.root, "trunk")).toThrow(/is on main, not trunk/);
    p.write("stray.txt", "x");
    expect(() => assertCleanBase(p.git, p.root, "main")).toThrow(/uncommitted changes \(\?\? stray\.txt\)/);
  });
});

describe("assertReadinessCurrent and assertTier", () => {
  const HEAD = "c".repeat(40);
  const T = "2026-10-09T12:00:00.000Z";
  const report: ReadinessReport = { name: "rel", tier: "medium", headSha: HEAD, verified: [], skipped: [], risks: [], ready: true, createdAt: T };
  const review = (finishedAt: string, headSha = HEAD): ReviewRecord => ({ name: "rel", headSha, lenses: [], skeptics: [], findings: [], finishedAt });

  it("passes a report written at or after the records of its head, and ignores other heads and missing records", () => {
    expect(() => assertReadinessCurrent(report, { ...passedVerify(HEAD), finishedAt: T }, review("2026-10-09T11:00:00.000Z"), "rel")).not.toThrow();
    expect(() => assertReadinessCurrent(report, { ...passedVerify("0".repeat(40)), finishedAt: "2026-10-10T00:00:00.000Z" }, null, "rel")).not.toThrow();
    expect(() => assertReadinessCurrent(report, null, review("2026-10-10T00:00:00.000Z", "0".repeat(40)), "rel")).not.toThrow();
  });

  it("refuses a report older than either record, or one whose time does not parse", () => {
    expect(() => assertReadinessCurrent(report, { ...passedVerify(HEAD), finishedAt: "2026-10-09T12:00:00.001Z" }, null, "rel")).toThrow(/older than verify\.json/);
    expect(() => assertReadinessCurrent(report, null, review("2026-10-09T13:00:00.000Z"), "rel")).toThrow(/older than review\.json/);
    expect(() => assertReadinessCurrent({ ...report, createdAt: "yesterday" }, passedVerify(HEAD), null, "rel")).toThrow(/older than verify\.json/);
  });

  it("refuses a tier below the required one and passes an equal or higher one", () => {
    expect(() => assertTier(report, "high", "rel")).toThrow(expect.objectContaining({ code: "usage", message: expect.stringMatching(/tier medium, below the landing tier high/) }));
    expect(() => assertTier(report, "medium", "rel")).not.toThrow();
    expect(() => assertTier(report, "low", "rel")).not.toThrow();
  });
});

describe("runLand", () => {
  it("merges the verified head into main with --no-ff, records it as not pushed and prints the push command", async () => {
    let head: string;
    ({ t: p, head } = await ready());
    expect(await runLand(["rel"], p.ctx)).toBe(0);

    const landing = readRecord<LandingRecord>(join(dir(p), "landing.json"));
    const mergeSha = p.ok(["rev-parse", "main"]).trim();
    expect(landing).toEqual({ name: "rel", into: "main", integrationHead: head, mergeSha, landedAt: "2026-10-09T12:00:00.000Z", pushed: false });
    expect(p.ok(["log", "-1", "--format=%s%n%P", "main"]).trim().split("\n")).toEqual(["Land rel", expect.stringContaining(head)]);
    expect(existsSync(join(p.root, "a.txt"))).toBe(true);
    expect(p.stdout()).toBe(
      `landed rel: ${head} into main as ${mergeSha}\nNot pushed. To publish: git push <remote> main (no remote configured)\n` +
        `removed worktree ${join(p.worktreeRoot, "integrate-rel")}\ndeleted branch integrate/rel\n`,
    );
    // A later plan phase merges arbab/a by name.
    expect(hasBranch(p, "arbab/a")).toBe(true);
  });

  it("prints the push command for the remote, and --json", async () => {
    ({ t: p } = await ready());
    p.ok(["remote", "add", "origin", "/nonexistent/o.git"]);
    expect(await runLand(["rel", "--json"], p.ctx)).toBe(0);
    const out = JSON.parse(p.stdout()) as { landing: LandingRecord; remote: string; push: string[] };
    expect(out.remote).toBe("origin");
    expect(out.push).toEqual(["git", "push", "origin", "main"]);
    expect(out.landing.pushed).toBe(false);
  });

  it("removes the merged and generated lanes' worktrees, the generated lanes' and the integration's branches, and keeps the records", async () => {
    let head: string;
    ({ t: p, head } = await ready());
    const a = laneWorktree(p, "a");
    const verify = laneWorktree(p, "rel-verify", head);
    markGenerated(p.runsRoot, "rel-verify", { integration: "rel", branch: "integrate/rel", head }, T);
    // Another integration's generated lane, and a lane rel never merged, are not this landing's.
    const foreign = laneWorktree(p, "other-verify", head);
    markGenerated(p.runsRoot, "other-verify", { integration: "other", branch: "integrate/other", head }, T);
    const unrelated = laneWorktree(p, "unrelated", "main");
    const integration = join(p.worktreeRoot, "integrate-rel");

    expect(await runLand(["rel", "--json"], p.ctx)).toBe(0);
    const out = JSON.parse(p.stdout()) as { cleanup: WorktreeCleanup };
    expect(out.cleanup).toEqual({
      worktreesRemoved: [a, verify, integration],
      branchesDeleted: ["arbab/rel-verify", "integrate/rel"],
      worktreesKept: [],
      branchesKept: [],
      warnings: [],
    });
    for (const path of [a, verify, integration]) expect(existsSync(path)).toBe(false);
    for (const branch of ["arbab/rel-verify", "integrate/rel"]) expect(hasBranch(p, branch)).toBe(false);
    // The merged lane's worktree went, its branch stays for the phases that merge it by name.
    expect(hasBranch(p, "arbab/a")).toBe(true);
    for (const path of [foreign, unrelated]) expect(existsSync(path)).toBe(true);
    expect(hasBranch(p, "arbab/other-verify") && hasBranch(p, "arbab/unrelated")).toBe(true);
    // The run dirs and the integration's records are the measurements and the record.
    for (const lane of ["a", "rel-verify"]) expect(existsSync(join(p.runsRoot, lane, "state.json"))).toBe(true);
    for (const file of ["integration.json", "verify.json", "readiness.json", "landing.json"]) expect(existsSync(join(dir(p), file))).toBe(true);
    expect(p.ok(["status", "--porcelain"])).toBe("");
  });

  it("keeps a dirty lane worktree and one an active lane borrows, with their reasons, and lands", async () => {
    ({ t: p } = await ready());
    branchWith(p, "arbab/b", "b.txt", "b\n");
    expect(await runIntegrate(["rel", "--lanes", "b"], p.ctx)).toBe(0);
    const record = readRecord<IntegrationRecord>(join(dir(p), "integration.json"));
    writeJsonAtomic(join(dir(p), "verify.json"), passedVerify(record.headSha));
    expect(await runReadiness(["rel"], p.ctx)).toBe(0);
    const a = laneWorktree(p, "a");
    writeFileSync(join(a, "stray.txt"), "x");
    const b = laneWorktree(p, "b");
    p.alive.add(LIVE);
    writeLaneRun(p.runsRoot, "check", {
      state: "running",
      shepherdPid: LIVE,
      lane: { name: "check", role: "verifier", brief: "lanes/demo.md", worktree: "b" },
    });
    p.out.length = 0;

    expect(await runLand(["rel"], p.ctx)).toBe(0);
    expect(existsSync(join(dir(p), "landing.json"))).toBe(true);
    expect(p.stdout().split("\n").slice(2)).toEqual([
      `removed worktree ${join(p.worktreeRoot, "integrate-rel")}`,
      "deleted branch integrate/rel",
      `kept worktree ${a}: uncommitted changes`,
      `kept worktree ${b}: in use by lane check`,
      "",
    ]);
    expect(existsSync(a) && existsSync(b)).toBe(true);
    expect(hasBranch(p, "arbab/a") && hasBranch(p, "arbab/b")).toBe(true);
  });

  it("keeps a merged lane that is active again", async () => {
    ({ t: p } = await ready());
    const a = laneWorktree(p, "a");
    p.alive.add(LIVE);
    writeLaneRun(p.runsRoot, "a", { state: "running", shepherdPid: LIVE });
    expect(await runLand(["rel"], p.ctx)).toBe(0);
    expect(p.stdout()).toContain(`kept worktree ${a}: lane a is running\n`);
    expect(existsSync(a)).toBe(true);
  });

  it("keeps an orphaned lane's worktree: its worker may still run", async () => {
    ({ t: p } = await ready());
    const a = laneWorktree(p, "a");
    // Running by its record, but the shepherd is dead.
    writeLaneRun(p.runsRoot, "a", { state: "running", shepherdPid: 999 });
    expect(await runLand(["rel"], p.ctx)).toBe(0);
    expect(p.stdout()).toContain(`kept worktree ${a}: orphaned: run arbab cleanup first\n`);
    expect(existsSync(a)).toBe(true);
  });

  it("--keep-worktrees removes nothing", async () => {
    ({ t: p } = await ready());
    const a = laneWorktree(p, "a");
    expect(await runLand(["rel", "--keep-worktrees", "--json"], p.ctx)).toBe(0);
    expect((JSON.parse(p.stdout()) as { cleanup: unknown }).cleanup).toBeNull();
    expect(existsSync(a) && existsSync(join(p.worktreeRoot, "integrate-rel"))).toBe(true);
    expect(hasBranch(p, "arbab/a") && hasBranch(p, "integrate/rel")).toBe(true);
  });

  it("reports what git refuses and still exits 0", async () => {
    let head: string;
    ({ t: p, head } = await ready());
    const integration = join(p.worktreeRoot, "integrate-rel");
    p.ok(["worktree", "lock", "--reason", "held", integration]);
    const verify = laneWorktree(p, "rel-verify", head);
    markGenerated(p.runsRoot, "rel-verify", { integration: "rel", branch: "integrate/rel", head }, T);
    const real = p.ctx.git;
    p.ctx.git = (args, cwd) =>
      args.includes("-d") && args.includes("arbab/rel-verify") ? { code: 1, stdout: "", stderr: "error: cannot delete arbab/rel-verify\n" } : real(args, cwd);

    expect(await runLand(["rel", "--json"], p.ctx)).toBe(0);
    const out = JSON.parse(p.stdout()) as { landing: LandingRecord; cleanup: WorktreeCleanup };
    expect(out.landing.name).toBe("rel");
    expect(existsSync(join(dir(p), "landing.json"))).toBe(true);
    expect(out.cleanup.worktreesRemoved).toEqual([verify]);
    expect(out.cleanup.worktreesKept).toEqual([{ path: integration, reason: expect.stringMatching(/^git worktree remove failed: .*locked/) }]);
    expect(out.cleanup.branchesKept).toEqual([{ branch: "arbab/rel-verify", reason: "git branch -d failed: error: cannot delete arbab/rel-verify" }]);
    expect(existsSync(integration)).toBe(true);
    expect(hasBranch(p, "integrate/rel")).toBe(true);
  });

  it("reports an unexpected cleanup failure as a warning and still exits 0", async () => {
    ({ t: p } = await ready());
    const real = p.ctx.git;
    p.ctx.git = (args, cwd) => {
      if (args.includes("worktree") && args.includes("remove")) throw new Error("spawn failed");
      return real(args, cwd);
    };
    expect(await runLand(["rel"], p.ctx)).toBe(0);
    expect(p.stdout()).toContain("warning integration rel: spawn failed\n");
  });

  it("refuses without a readiness report", async () => {
    ({ t: p } = await ready());
    writeFileSync(join(dir(p), "readiness.json"), "null");
    await expect(runLand(["rel"], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/no readiness report/) });
  });

  it("refuses a report that is not ready, or is for another head, or a verify that did not pass", async () => {
    let head: string;
    ({ t: p, head } = await ready());
    const report = readRecord<ReadinessReport>(join(dir(p), "readiness.json"));
    writeJsonAtomic(join(dir(p), "readiness.json"), { ...report, ready: false, skipped: [{ id: "verify", text: "x", waived: false }] });
    await expect(runLand(["rel"], p.ctx)).rejects.toThrow(/not ready \(unwaived: verify\)/);
    writeJsonAtomic(join(dir(p), "readiness.json"), { ...report, headSha: "0".repeat(40) });
    await expect(runLand(["rel"], p.ctx)).rejects.toThrow(/run arbab readiness rel again/);
    writeJsonAtomic(join(dir(p), "readiness.json"), report);
    writeJsonAtomic(join(dir(p), "verify.json"), passedVerify(head, false));
    await expect(runLand(["rel"], p.ctx)).rejects.toThrow(/verify has not passed/);
    expect(existsSync(join(dir(p), "landing.json"))).toBe(false);
  });

  it("refuses when the main checkout is dirty or on another branch, and when the head already landed", async () => {
    ({ t: p } = await ready());
    p.write("stray.txt", "x");
    await expect(runLand(["rel"], p.ctx)).rejects.toThrow(/uncommitted changes/);
    p.ok(["checkout", "-q", "-b", "side"]);
    await expect(runLand(["rel"], p.ctx)).rejects.toThrow(/is on side, not main/);
    p.ok(["checkout", "-q", "main"]);
    rmSync(join(p.root, "stray.txt"));
    expect(await runLand(["rel"], p.ctx)).toBe(0);
    await expect(runLand(["rel"], p.ctx)).rejects.toThrow(/already in main/);
  });

  it("refuses when the base moved past what the integration holds, and lands once it is merged in and verified again", async () => {
    let head: string;
    ({ t: p, head } = await ready());
    p.write("b.txt", "main moved\n");
    p.ok(["add", "--", "b.txt"]);
    p.ok(["commit", "-q", "-m", "main moves"]);
    const main = p.ok(["rev-parse", "main"]).trim();
    await expect(runLand(["rel"], p.ctx)).rejects.toMatchObject({
      code: "usage",
      message:
        `not landed: main moved since the integration was verified: its HEAD is not in ${head}, so the merge would hold a ` +
        `tree nobody verified. Merge main into integrate/rel with hooks off: git -C ${join(p.worktreeRoot, "integrate-rel")} ` +
        "-c core.hooksPath=/dev/null -c core.fsmonitor=false -c diff.ignoreSubmodules=all -c submodule.recurse=false " +
        "merge --no-verify --no-edit main; then run arbab integrate, verify, review and readiness for rel again",
    });
    expect(p.ok(["rev-parse", "main"]).trim()).toBe(main);
    expect(existsSync(join(dir(p), "landing.json"))).toBe(false);

    const newHead = await mergeMainAndVerify(p);
    expect(await runLand(["rel"], p.ctx)).toBe(0);
    // The merge commit holds exactly the verified tree.
    expect(p.ok(["rev-parse", "main^{tree}"]).trim()).toBe(p.ok(["rev-parse", `${newHead}^{tree}`]).trim());
  });

  it("refuses when the integration branch moved past the verified head", async () => {
    ({ t: p } = await ready());
    const worktree = readRecord<IntegrationRecord>(join(dir(p), "integration.json")).worktree;
    p.ok(["commit", "-q", "--allow-empty", "-m", "by hand"], worktree);
    await expect(runLand(["rel"], p.ctx)).rejects.toThrow(/not the verified head/);
  });

  it("refuses a readiness report older than the verify or review of the same head", async () => {
    let head: string;
    ({ t: p, head } = await ready());
    const later = "2026-10-09T12:00:01.000Z";
    writeJsonAtomic(join(dir(p), "verify.json"), { ...passedVerify(head), finishedAt: later });
    await expect(runLand(["rel"], p.ctx)).rejects.toMatchObject({
      code: "usage",
      message: expect.stringMatching(/readiness report \(2026-10-09T12:00:00\.000Z\) is older than verify\.json .*run arbab readiness rel again/),
    });
    writeJsonAtomic(join(dir(p), "verify.json"), passedVerify(head));
    const review: ReviewRecord = { name: "rel", headSha: head, lenses: [], skeptics: [], findings: [], finishedAt: later };
    writeJsonAtomic(join(dir(p), "review.json"), review);
    await expect(runLand(["rel"], p.ctx)).rejects.toThrow(/older than review\.json/);
    // A review of another head is not what this report would have read.
    writeJsonAtomic(join(dir(p), "review.json"), { ...review, headSha: "0".repeat(40) });
    expect(await runLand(["rel"], p.ctx)).toBe(0);
  });

  it("refuses a readiness report checked below the landing tier", async () => {
    p = makeProject({ config: { ...DEFAULT_CONFIG, landing: { tier: "medium" } } });
    branchWith(p, "arbab/a", "a.txt", "a\n");
    expect(await runIntegrate(["rel", "--lanes", "a"], p.ctx)).toBe(0);
    const head = readRecord<IntegrationRecord>(join(dir(p), "integration.json")).headSha;
    writeJsonAtomic(join(dir(p), "verify.json"), passedVerify(head));
    expect(await runReadiness(["rel", "--tier", "low"], p.ctx)).toBe(0);
    await expect(runLand(["rel"], p.ctx)).rejects.toMatchObject({
      code: "usage",
      message: expect.stringMatching(/checked at tier low, below the landing tier medium; run arbab readiness rel --tier medium/),
    });
    expect(existsSync(join(dir(p), "landing.json"))).toBe(false);
  });

  it("lands into the integration's recorded base, even after config.baseBranch changed", async () => {
    ({ t: p } = await ready());
    p.write("arbab.config.json", JSON.stringify({ ...DEFAULT_CONFIG, baseBranch: "trunk", landing: { tier: "low" } }));
    p.ok(["commit", "-q", "-am", "base moves to trunk"]);
    await mergeMainAndVerify(p);
    expect(await runLand(["rel"], p.ctx)).toBe(0);
    expect(readRecord<LandingRecord>(join(dir(p), "landing.json")).into).toBe("main");
    expect(p.ok(["log", "-1", "--format=%s", "main"]).trim()).toBe("Land rel");
  });

  it("runs the merge without the repository's hooks", async () => {
    ({ t: p } = await ready());
    const hooks = join(p.root, ".git", "hooks");
    mkdirSync(hooks, { recursive: true });
    for (const hook of ["pre-merge-commit", "commit-msg", "post-merge"]) {
      writeFileSync(join(hooks, hook), `#!/bin/sh\necho ${hook} >> "${join(p.dir, "hooks-ran")}"\nexit 1\n`, { mode: 0o755 });
    }
    expect(await runLand(["rel"], p.ctx)).toBe(0);
    expect(existsSync(join(p.dir, "hooks-ran"))).toBe(false);
    expect(p.ok(["log", "-1", "--format=%s", "main"]).trim()).toBe("Land rel");
  });

  it("fails with a git error and aborts when the merge fails", async () => {
    ({ t: p } = await ready());
    const real = p.ctx.git;
    const calls: string[][] = [];
    // The base is in the head, so a real merge cannot conflict; git failing it stands in.
    p.ctx.git = (args, cwd) => {
      calls.push(args);
      if (args.includes("merge") && args.includes("--no-ff")) return { code: 1, stdout: "", stderr: "fatal: no space left" };
      return real(args, cwd);
    };
    await expect(runLand(["rel"], p.ctx)).rejects.toMatchObject({
      code: "git",
      message: "merging integrate/rel into main failed (1): fatal: no space left; the merge was aborted",
    });
    expect(calls).toContainEqual([...untrustedTree(), "merge", "--abort"]);
    expect(calls.find((args) => args.includes("--no-ff"))?.slice(0, untrustedTree().length + 1)).toEqual([...untrustedTree(), "merge"]);
    expect(existsSync(join(dir(p), "landing.json"))).toBe(false);
  });
});

describe("assertBaseInHead", () => {
  it("passes a base the head holds, refuses one that moved on, and reports a git failure", () => {
    p = makeProject();
    const head = branchWith(p, "arbab/a", "a.txt", "a\n");
    expect(() => assertBaseInHead(p.git, p.root, "main", head, "rel", "/w/integrate-rel")).not.toThrow();
    p.ok(["commit", "-q", "--allow-empty", "-m", "moves"]);
    expect(() => assertBaseInHead(p.git, p.root, "main", head, "rel", "/w/integrate-rel")).toThrow(
      expect.objectContaining({ code: "usage", message: expect.stringMatching(/^not landed: main moved since the integration was verified/) }),
    );
    expect(() => assertBaseInHead(p.git, p.root, "main", "f".repeat(40), "rel", "/w/integrate-rel")).toThrow(expect.objectContaining({ code: "git" }));
  });
});
