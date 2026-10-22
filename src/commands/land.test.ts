import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { credentialMatcher } from "../profile";
import { untrustedTree } from "../run";
import type { IntegrationRecord, LandingRecord, ReadinessReport, ReviewRecord } from "../types";
import { writeJsonAtomic } from "../util/fs";
import type { WorktreeCleanup } from "./cleanup";
import { markGenerated } from "./generated";
import { runIntegrate } from "./integrate";
import { assertBaseInHead, assertCleanBase, assertReadinessCurrent, assertTier, firstRemote, readMessage, runLand } from "./land";
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
async function ready(landing: Record<string, unknown> = { tier: "low" }, config: Record<string, unknown> = {}): Promise<{ t: TestProject; head: string }> {
  const t = makeProject({ config: { ...DEFAULT_CONFIG, ...config, landing } });
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

/**
 * What the refusal asks for after the base moved: main merged into the integration, the new head recorded with
 * --refresh, verified and ready.
 */
async function mergeMainAndVerify(t: TestProject): Promise<string> {
  const record = readRecord<IntegrationRecord>(join(dir(t), "integration.json"));
  t.ok(["merge", "-q", "--no-edit", "main"], record.worktree);
  const head = t.ok(["rev-parse", "HEAD"], record.worktree).trim();
  expect(await runIntegrate(["rel", "--refresh"], t.ctx)).toBe(0);
  expect(readRecord<IntegrationRecord>(join(dir(t), "integration.json")).headSha).toBe(head);
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
  it("passes on a clean base branch and refuses another branch or tracked changes", () => {
    p = makeProject();
    const head = branchWith(p, "arbab/a", "a.txt", "a\n");
    expect(assertCleanBase(p.git, p.root, "main", head)).toEqual([]);
    expect(() => assertCleanBase(p.git, p.root, "trunk", head)).toThrow(/is on main, not trunk/);
    p.write("lanes/demo.md", "changed\n");
    expect(() => assertCleanBase(p.git, p.root, "main", head)).toThrow(/uncommitted changes \( M lanes\/demo\.md\)/);
    p.ok(["checkout", "--", "lanes/demo.md"]);
    // A staged rename is one entry, named by its new path.
    p.ok(["mv", "lanes/demo.md", "lanes/moved.md"]);
    expect(() => assertCleanBase(p.git, p.root, "main", head)).toThrow(/uncommitted changes \(R  lanes\/moved\.md\)$/);
  });

  it("returns untracked files the merge does not write, and refuses those it does", () => {
    p = makeProject();
    const head = branchWith(p, "arbab/a", "pkg/new/x.txt", "x\n");
    p.write("scratch.txt", "mine\n");
    p.write("notes/todo.md", "mine\n");
    // lanes/ holds tracked files, so an untracked file there is listed by itself.
    p.write("lanes/draft.md", "mine\n");
    expect(assertCleanBase(p.git, p.root, "main", head)).toEqual(["lanes/draft.md", "notes/", "scratch.txt"]);

    // The very path the merge writes.
    p.write("pkg/new/x.txt", "mine\n");
    const refusal = /^not landed: the main checkout .* has untracked files where the merge writes \(pkg\/\); move them away and land again$/;
    expect(() => assertCleanBase(p.git, p.root, "main", head)).toThrow(refusal);
    rmSync(join(p.root, "pkg"), { recursive: true });
    // Under a directory the merge creates.
    p.write("pkg/new/other.txt", "mine\n");
    expect(() => assertCleanBase(p.git, p.root, "main", head)).toThrow(refusal);
    rmSync(join(p.root, "pkg"), { recursive: true });
    // A file where the merge needs a directory.
    p.write("pkg", "mine\n");
    expect(() => assertCleanBase(p.git, p.root, "main", head)).toThrow(/untracked files where the merge writes \(pkg\)/);
    rmSync(join(p.root, "pkg"));
    expect(assertCleanBase(p.git, p.root, "main", head)).toHaveLength(3);
  });

  it("refuses an untracked file that lies under a directory the merge creates inside a tracked one", () => {
    p = makeProject();
    const head = branchWith(p, "arbab/a", "lanes/new/x.md", "x\n");
    p.write("lanes/new/mine.md", "mine\n");
    expect(() => assertCleanBase(p.git, p.root, "main", head)).toThrow(/where the merge writes \(lanes\/new\/\)/);
  });
});

describe("readMessage", () => {
  const plain = credentialMatcher([], []);

  it("reads an absolute or project-relative file and refuses a missing or blank one", () => {
    p = makeProject();
    p.write("msg.txt", "Ship it\n\nBody.\n");
    p.write("notes/msg.txt", "Relative\n");
    expect(readMessage(p.root, join(p.root, "msg.txt"), plain)).toBe("Ship it\n\nBody.\n");
    expect(readMessage(p.root, "notes/msg.txt", plain)).toBe("Relative\n");
    expect(() => readMessage(p.root, "missing.txt", plain)).toThrow(expect.objectContaining({ code: "usage", message: expect.stringMatching(/cannot read the --message file .*missing\.txt/) }));
    expect(() => readMessage(p.root, "notes", plain)).toThrow(/cannot read the --message file/);
    p.write("blank.txt", " \n\n");
    expect(() => readMessage(p.root, "blank.txt", plain)).toThrow(/--message file .*blank\.txt is empty/);
  });

  it("refuses a file outside the project, absolute, relative or through a symlink", () => {
    p = makeProject();
    writeFileSync(join(p.dir, "outside.txt"), "secret\n");
    const outside = expect.objectContaining({ code: "usage", message: expect.stringMatching(/^not landed: the --message file .*outside\.txt is outside the project/) });
    expect(() => readMessage(p.root, join(p.dir, "outside.txt"), plain)).toThrow(outside);
    expect(() => readMessage(p.root, "../outside.txt", plain)).toThrow(outside);
    symlinkSync(join(p.dir, "outside.txt"), join(p.root, "link.txt"));
    expect(() => readMessage(p.root, "link.txt", plain)).toThrow(/--message file .*link\.txt resolves outside the project/);
  });

  it("refuses a credential file in any case, by name or through a symlink, naming the rule", () => {
    p = makeProject();
    const credential = credentialMatcher(["**/*.secret"], []);
    for (const [name, rule] of [
      [".ENV", /is named like a credential file \(\.ENV\)$/],
      [".Env.local", /is named like a credential file \(\.Env\.local\)$/],
      ["x.pem", /is named like a credential file \(x\.pem\)$/],
      ["db.secret", /is named like a credential file \(db\.secret\)$/],
    ] as const) {
      p.write(name, "TOKEN=x\n");
      expect(() => readMessage(p.root, name, credential), name).toThrow(expect.objectContaining({ code: "usage", message: expect.stringMatching(rule) }));
      expect(() => readMessage(p.root, join(p.root, name), credential), name).toThrow(rule);
      symlinkSync(join(p.root, name), join(p.root, "link.txt"));
      expect(() => readMessage(p.root, "link.txt", credential), name).toThrow(new RegExp(`--message file .*link\\.txt resolves to .*, which ${rule.source}`));
      rmSync(join(p.root, "link.txt"));
    }
    p.write("msg.txt", "Ship it\n");
    expect(readMessage(p.root, "msg.txt", credential)).toBe("Ship it\n");
  });

  it("refuses what a config credentialPaths rule anchored at the home covers", () => {
    p = makeProject();
    p.write("vault/msg.txt", "Ship it\n");
    const home = dirname(p.root);
    expect(() => readMessage(p.root, "vault/msg.txt", credentialMatcher(["~/repo/vault/**"], [home]))).toThrow(/msg\.txt is under ~\/repo\/vault, where credentials live$/);
    expect(() => readMessage(p.root, "vault/msg.txt", credentialMatcher(["~/repo/*/msg.txt"], [home]))).toThrow(/msg\.txt matches the credential path ~\/repo\/\*\/msg\.txt$/);
    expect(readMessage(p.root, "vault/msg.txt", credentialMatcher(["~/repo/vault/**"], []))).toBe("Ship it\n");
  });

  it("reads a file in a project under a directory named like a credential, and still refuses one inside it", () => {
    const tmp = mkdtempSync(join(tmpdir(), "arbab-"));
    try {
      for (const parent of [".envs", "x.key"]) {
        const root = join(tmp, parent, "app");
        mkdirSync(root, { recursive: true });
        writeFileSync(join(root, "msg.txt"), "Ship it\n");
        writeFileSync(join(root, ".env"), "TOKEN=x\n");
        expect(readMessage(root, "msg.txt", plain), parent).toBe("Ship it\n");
        expect(readMessage(root, join(root, "msg.txt"), plain), parent).toBe("Ship it\n");
        expect(() => readMessage(root, ".env", plain), parent).toThrow(/is named like a credential file \(\.env\)$/);
        // Reached through a link, the real path is checked below the project's real path.
        symlinkSync(root, join(tmp, `${parent}-link`));
        expect(readMessage(join(tmp, `${parent}-link`), "msg.txt", plain), parent).toBe("Ship it\n");
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
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

  it("checks a review carried over from an earlier head like a review of the head", () => {
    const OLD = "b".repeat(40);
    const carried: ReadinessReport = { ...report, reviewCarriedOverFrom: OLD };
    expect(() => assertReadinessCurrent(carried, null, review("2026-10-09T11:00:00.000Z", OLD), "rel")).not.toThrow();
    expect(() => assertReadinessCurrent(carried, null, review("2026-10-09T13:00:00.000Z", OLD), "rel")).toThrow(/older than review\.json/);
    // Without the carry-over the earlier head's review is not this report's evidence.
    expect(() => assertReadinessCurrent(report, null, review("2026-10-09T13:00:00.000Z", OLD), "rel")).not.toThrow();
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
    const a = p.ok(["rev-parse", "arbab/a"]).trim();
    expect(landing).toEqual({
      name: "rel",
      into: "main",
      integrationHead: head,
      mergeSha,
      landedAt: "2026-10-09T12:00:00.000Z",
      pushed: false,
      squash: false,
      lanes: [{ lane: "a", sha: a }],
    });
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
    p.write("lanes/demo.md", "changed\n");
    await expect(runLand(["rel"], p.ctx)).rejects.toThrow(/uncommitted changes/);
    p.ok(["checkout", "-q", "-b", "side"]);
    await expect(runLand(["rel"], p.ctx)).rejects.toThrow(/is on side, not main/);
    p.ok(["checkout", "-q", "main"]);
    p.ok(["checkout", "--", "lanes/demo.md"]);
    expect(await runLand(["rel"], p.ctx)).toBe(0);
    await expect(runLand(["rel"], p.ctx)).rejects.toThrow(/already in main/);
  });

  it("leaves untracked files the merge does not write alone and names the first five", async () => {
    ({ t: p } = await ready());
    for (const n of [1, 2, 3, 4, 5, 6, 7]) p.write(`scratch${n}.txt`, "mine\n");
    expect(await runLand(["rel"], p.ctx)).toBe(0);
    expect(p.stdout().split("\n")[2]).toBe("left alone: scratch1.txt, scratch2.txt, scratch3.txt, scratch4.txt, scratch5.txt, and 2 more");
    expect(readFileSync(join(p.root, "scratch7.txt"), "utf8")).toBe("mine\n");
    expect(p.ok(["status", "--porcelain"]).trim().split("\n")).toHaveLength(7);
  });

  it("lists the untracked files left alone in --json", async () => {
    ({ t: p } = await ready());
    p.write("notes/todo.md", "mine\n");
    expect(await runLand(["rel", "--json"], p.ctx)).toBe(0);
    expect((JSON.parse(p.stdout()) as { leftAlone: string[] }).leftAlone).toEqual(["notes/"]);
  });

  it("refuses an untracked file the merge would write, and lands nothing", async () => {
    ({ t: p } = await ready());
    const main = p.ok(["rev-parse", "main"]).trim();
    p.write("a.txt", "mine\n");
    p.write("scratch.txt", "mine\n");
    await expect(runLand(["rel"], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/untracked files where the merge writes \(a\.txt\)/) });
    expect(p.ok(["rev-parse", "main"]).trim()).toBe(main);
    expect(readFileSync(join(p.root, "a.txt"), "utf8")).toBe("mine\n");
    expect(existsSync(join(dir(p), "landing.json"))).toBe(false);
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
        "merge --no-verify --no-edit main; then arbab integrate rel --refresh to record the new head, and verify, " +
        "review and readiness for rel again",
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

describe("runLand --squash and --message", () => {
  const tree = (t: TestProject, rev: string): string => t.ok(["rev-parse", `${rev}^{tree}`]).trim();

  it("--squash lands one commit on the old base holding the head's tree, and records it", async () => {
    let head: string;
    ({ t: p, head } = await ready());
    const before = p.ok(["rev-parse", "main"]).trim();
    const a = p.ok(["rev-parse", "arbab/a"]).trim();
    expect(await runLand(["rel", "--squash"], p.ctx)).toBe(0);

    const mergeSha = p.ok(["rev-parse", "main"]).trim();
    expect(p.ok(["rev-list", "--parents", "-1", mergeSha]).trim().split(" ")).toEqual([mergeSha, before]);
    expect(tree(p, mergeSha)).toBe(tree(p, head));
    expect(p.ok(["log", "-1", "--format=%s", "main"]).trim()).toBe("Land rel");
    expect(p.ok(["rev-list", "--count", `${before}..main`]).trim()).toBe("1");
    expect(readRecord<LandingRecord>(join(dir(p), "landing.json"))).toEqual({
      name: "rel",
      into: "main",
      integrationHead: head,
      mergeSha,
      landedAt: T,
      pushed: false,
      squash: true,
      lanes: [{ lane: "a", sha: a }],
    });
    expect(p.stdout()).toBe(
      `landed rel: ${head} into main as ${mergeSha}\nNot pushed. To publish: git push <remote> main (no remote configured)\n` +
        `removed worktree ${join(p.worktreeRoot, "integrate-rel")}\ndeleted branch integrate/rel\n`,
    );
    expect(p.ok(["status", "--porcelain"])).toBe("");
    // Landed: the head is not in main, but the record says what landed.
    await expect(runLand(["rel", "--squash"], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/^not landed: rel already landed \(.*landing\.json\)$/) });
  });

  it("removes the landed lanes' worktrees and the generated lanes' and the integration's branches after a squash", async () => {
    let head: string;
    ({ t: p, head } = await ready());
    const a = laneWorktree(p, "a");
    const verify = laneWorktree(p, "rel-verify", head);
    markGenerated(p.runsRoot, "rel-verify", { integration: "rel", branch: "integrate/rel", head }, T);
    const unrelated = laneWorktree(p, "unrelated", "main");
    const integration = join(p.worktreeRoot, "integrate-rel");
    const real = p.ctx.git;
    const calls: string[][] = [];
    p.ctx.git = (args, cwd) => {
      calls.push(args);
      return real(args, cwd);
    };

    expect(await runLand(["rel", "--squash", "--json"], p.ctx)).toBe(0);
    // `git branch -d` refuses them, as they are not in main; they go where the landed head holds them.
    expect(calls).toContainEqual([...untrustedTree(), "update-ref", "-d", "refs/heads/integrate/rel", head]);
    expect(calls).toContainEqual([...untrustedTree(), "update-ref", "-d", "refs/heads/arbab/rel-verify", head]);
    const out = JSON.parse(p.stdout()) as { cleanup: WorktreeCleanup; landing: LandingRecord };
    expect(out.landing.squash).toBe(true);
    expect(out.cleanup).toEqual({
      worktreesRemoved: [a, verify, integration],
      branchesDeleted: ["arbab/rel-verify", "integrate/rel"],
      worktreesKept: [],
      branchesKept: [],
      warnings: [],
    });
    for (const path of [a, verify, integration]) expect(existsSync(path)).toBe(false);
    for (const branch of ["arbab/rel-verify", "integrate/rel"]) expect(hasBranch(p, branch)).toBe(false);
    expect(hasBranch(p, "arbab/a")).toBe(true);
    expect(existsSync(unrelated)).toBe(true);
  });

  it("keeps after a squash a lane whose branch moved past what landed, and a generated branch that did", async () => {
    let head: string;
    ({ t: p, head } = await ready());
    const a = laneWorktree(p, "a");
    writeFileSync(join(a, "later.txt"), "later\n");
    p.ok(["add", "--", "later.txt"], a);
    p.ok(["commit", "-q", "-m", "after the integration"], a);
    const verify = laneWorktree(p, "rel-verify", head);
    markGenerated(p.runsRoot, "rel-verify", { integration: "rel", branch: "integrate/rel", head }, T);
    p.ok(["worktree", "remove", verify]);
    p.ok(["branch", "-f", "arbab/rel-verify", "arbab/a"]);

    expect(await runLand(["rel", "--squash", "--json"], p.ctx)).toBe(0);
    const out = JSON.parse(p.stdout()) as { cleanup: WorktreeCleanup };
    expect(out.cleanup.worktreesKept).toEqual([{ path: a, reason: `branch arbab/a is not merged into ${head}` }]);
    expect(out.cleanup.branchesKept).toEqual([{ branch: "arbab/rel-verify", reason: `branch arbab/rel-verify is not merged into ${head}` }]);
    expect(out.cleanup.branchesDeleted).toEqual(["integrate/rel"]);
    expect(hasBranch(p, "arbab/rel-verify")).toBe(true);
  });

  it("follows config landing.squash, and --squash squashes when the config does not", async () => {
    ({ t: p } = await ready({ tier: "low", squash: true }));
    const before = p.ok(["rev-parse", "main"]).trim();
    expect(await runLand(["rel"], p.ctx)).toBe(0);
    expect(p.ok(["rev-list", "--parents", "-1", "main"]).trim().split(" ")).toHaveLength(2);
    expect(p.ok(["rev-parse", "main~1"]).trim()).toBe(before);
    expect(readRecord<LandingRecord>(join(dir(p), "landing.json")).squash).toBe(true);
    p.dispose();

    ({ t: p } = await ready({ tier: "low", squash: false }));
    expect(await runLand(["rel", "--squash"], p.ctx)).toBe(0);
    expect(p.ok(["rev-list", "--parents", "-1", "main"]).trim().split(" ")).toHaveLength(2);
    expect(readRecord<LandingRecord>(join(dir(p), "landing.json")).squash).toBe(true);
  });

  it("--message sets the commit message of a merge and of a squash", async () => {
    ({ t: p } = await ready());
    p.write("notes/msg.txt", "Release 1.2\n\nWith a body.\n");
    expect(await runLand(["rel", "--message", join(p.root, "notes", "msg.txt")], p.ctx)).toBe(0);
    expect(p.ok(["log", "-1", "--format=%B", "main"]).trim()).toBe("Release 1.2\n\nWith a body.");
    expect(p.ok(["rev-list", "--parents", "-1", "main"]).trim().split(" ")).toHaveLength(3);
    p.dispose();

    ({ t: p } = await ready());
    // Project-relative; an untracked file the merge does not write.
    p.write("msg.txt", "Squashed rel\n");
    expect(await runLand(["rel", "--squash", "--message", "msg.txt"], p.ctx)).toBe(0);
    expect(p.ok(["log", "-1", "--format=%B", "main"]).trim()).toBe("Squashed rel");
    expect(p.stdout()).toContain("left alone: msg.txt\n");
  });

  it("refuses a missing or empty --message file before anything lands", async () => {
    ({ t: p } = await ready());
    const main = p.ok(["rev-parse", "main"]).trim();
    await expect(runLand(["rel", "--message", "nope.txt"], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/cannot read the --message file/) });
    p.write("empty.txt", "");
    await expect(runLand(["rel", "--squash", "--message", join(p.root, "empty.txt")], p.ctx)).rejects.toThrow(/is empty/);
    expect(p.ok(["rev-parse", "main"]).trim()).toBe(main);
    expect(existsSync(join(dir(p), "landing.json"))).toBe(false);
  });

  it("refuses a --message file outside the project or a credential file before anything lands", async () => {
    // The user's home is the parent of ctx.home (~/.arbab): the project's parent here.
    ({ t: p } = await ready({ tier: "low" }, { credentialPaths: ["**/*.secret", "~/repo/vault/**"] }));
    const main = p.ok(["rev-parse", "main"]).trim();
    writeFileSync(join(p.dir, "msg.txt"), "Outside\n");
    await expect(runLand(["rel", "--message", join(p.dir, "msg.txt")], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/is outside the project/) });
    await expect(runLand(["rel", "--message", "../msg.txt"], p.ctx)).rejects.toThrow(/is outside the project/);
    p.write(".ENV", "TOKEN=x\n");
    await expect(runLand(["rel", "--message", ".ENV"], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/is named like a credential file \(\.ENV\)$/) });
    p.write("x.pem", "KEY\n");
    await expect(runLand(["rel", "--message", "x.pem"], p.ctx)).rejects.toThrow(/is named like a credential file \(x\.pem\)$/);
    p.write("db.secret", "TOKEN=x\n");
    await expect(runLand(["rel", "--message", "db.secret"], p.ctx)).rejects.toThrow(/is named like a credential file \(db\.secret\)$/);
    symlinkSync(join(p.root, "db.secret"), join(p.root, "msg-link.txt"));
    await expect(runLand(["rel", "--message", "msg-link.txt"], p.ctx)).rejects.toThrow(/msg-link\.txt resolves to .*db\.secret, which is named like a credential file/);
    p.write("vault/msg.txt", "Ship it\n");
    await expect(runLand(["rel", "--message", "vault/msg.txt"], p.ctx)).rejects.toThrow(/msg\.txt is under ~\/repo\/vault, where credentials live$/);
    expect(p.ok(["rev-parse", "main"]).trim()).toBe(main);
    expect(existsSync(join(dir(p), "landing.json"))).toBe(false);
  });

  it("squashes without the repository's hooks", async () => {
    ({ t: p } = await ready());
    const hooks = join(p.root, ".git", "hooks");
    mkdirSync(hooks, { recursive: true });
    for (const hook of ["pre-commit", "prepare-commit-msg", "commit-msg", "post-commit", "post-merge"]) {
      writeFileSync(join(hooks, hook), `#!/bin/sh\necho ${hook} >> "${join(p.dir, "hooks-ran")}"\nexit 1\n`, { mode: 0o755 });
    }
    expect(await runLand(["rel", "--squash"], p.ctx)).toBe(0);
    expect(existsSync(join(p.dir, "hooks-ran"))).toBe(false);
  });

  it("resets the squash and fails with a git error when the commit fails", async () => {
    ({ t: p } = await ready());
    const main = p.ok(["rev-parse", "main"]).trim();
    const real = p.ctx.git;
    const calls: string[][] = [];
    p.ctx.git = (args, cwd) => {
      calls.push(args);
      if (args.includes("commit")) return { code: 1, stdout: "", stderr: "fatal: cannot commit" };
      return real(args, cwd);
    };
    await expect(runLand(["rel", "--squash"], p.ctx)).rejects.toMatchObject({
      code: "git",
      message: "squashing integrate/rel into main failed (1): fatal: cannot commit; the squash was reset",
    });
    expect(calls).toContainEqual([...untrustedTree(), "merge", "--squash", expect.any(String)]);
    expect(calls).toContainEqual([...untrustedTree(), "reset", "--merge"]);
    p.ctx.git = real;
    expect(p.ok(["rev-parse", "main"]).trim()).toBe(main);
    expect(p.ok(["status", "--porcelain"])).toBe("");
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
