import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { watermarkPath } from "../hook/catchup";
import { readState } from "../registry";
import { acquireWriterLock, untrustedTree, writerLockKey } from "../run";
import { plantNestedRepo } from "../run/testkit";
import type { LandingRecord } from "../types";
import {
  emptyWorktreeCleanup,
  formatCleanup,
  formatWorktreeCleanup,
  releaseStalePoolFiles,
  removeEmptyLockDirs,
  removeLaneWorktrees,
  runCleanup,
  sweepIdleWorktrees,
  UNPARSED_GRACE_MS,
  WRITER_LOCK_HELD,
  type CleanupReport,
} from "./cleanup";
import { markGenerated } from "./generated";
import { runIntegrate } from "./integrate";
import { launchLockPath } from "./launch";
import { openProject } from "./project";
import { NOW_MS, branchWith, makeProject, writeLaneRun, type TestProject } from "./testkit";

let p: TestProject;
afterEach(() => p?.dispose());

const T = "2026-10-09T12:00:00.000Z";
/** 40 and 2 days before NOW_MS. */
const OLD = "2026-08-30T12:00:00.000Z";
const RECENT = "2026-10-07T12:00:00.000Z";

const empty = (): CleanupReport => ({
  orphaned: [],
  reaped: [],
  released: [],
  ...emptyWorktreeCleanup(),
  worktreeRemovals: [],
  lockDirsRemoved: 0,
  sessionWatermarksRemoved: 0,
});

const hasBranch = (t: TestProject, branch: string): boolean => t.git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], t.root).code === 0;

/** A worktree on a new arbab/<lane> from main. */
function addWorktree(t: TestProject, lane: string): string {
  const path = join(t.worktreeRoot, lane);
  t.ok(["worktree", "add", "-q", "-b", `arbab/${lane}`, path, "main"]);
  return path;
}

/** Commits a file in the worktree and returns the new head. */
function commitIn(t: TestProject, worktree: string, file: string): string {
  writeFileSync(join(worktree, file), `${file}\n`);
  t.ok(["add", "--", file], worktree);
  t.ok(["commit", "-q", "-m", `writes ${file}`], worktree);
  return t.ok(["rev-parse", "HEAD"], worktree).trim();
}

/** shepherd.json as a run launched by `owner` (absent: before §21) would have it. */
function ownRun(t: TestProject, lane: string, owner?: string | null): void {
  writeFileSync(join(t.runsRoot, lane, "shepherd.json"), JSON.stringify({ pid: 4242, startedAt: "2026-10-09T11:00:00.000Z", ...(owner !== undefined && { owner }) }));
}

const LIVE = 101;
const DEAD = 202;

function entry(path: string, pid: number | null, ageMs = 0): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, pid === null ? "" : JSON.stringify({ pid, lane: "x", project: "/p", createdAt: "2026-10-09T10:00:00.000Z" }));
  const t = (NOW_MS - ageMs) / 1000;
  utimesSync(path, t, t);
  return path;
}

describe("releaseStalePoolFiles", () => {
  it("removes entries of dead holders and keeps live ones", () => {
    p = makeProject();
    const alive = (pid: number): boolean => pid === LIVE;
    const stale = [
      entry(join(p.home, "slots", "0.json"), DEAD),
      entry(join(p.home, "semaphores", "db", "1.json"), DEAD),
      entry(join(p.home, "leases", "port", "4001.json"), DEAD),
      entry(join(p.home, "locks", "b".repeat(40), "0.json"), DEAD),
    ];
    const kept = [entry(join(p.home, "slots", "1.json"), LIVE), entry(join(p.home, "leases", "port", "4000.json"), LIVE)];
    expect(releaseStalePoolFiles(p.home, alive, NOW_MS).sort()).toEqual(stale.sort());
    for (const path of stale) expect(existsSync(path)).toBe(false);
    for (const path of kept) expect(existsSync(path)).toBe(true);
  });

  it("gives an unparsable entry time for its creator, then removes it; old tomb files go too", () => {
    p = makeProject();
    const fresh = entry(join(p.home, "slots", "0.json"), null, 1000);
    const old = entry(join(p.home, "slots", "1.json"), null, UNPARSED_GRACE_MS + 1000);
    const tomb = entry(join(p.home, "slots", "2.json.abc.stale"), DEAD, UNPARSED_GRACE_MS + 1000);
    const other = entry(join(p.home, "slots", "notes.txt"), DEAD, UNPARSED_GRACE_MS + 1000);
    expect(releaseStalePoolFiles(p.home, () => false, NOW_MS).sort()).toEqual([old, tomb].sort());
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(other)).toBe(true);
  });

  it("does nothing without a home directory", () => {
    p = makeProject();
    expect(releaseStalePoolFiles(join(p.dir, "none"), () => false, NOW_MS)).toEqual([]);
  });
});

describe("removeEmptyLockDirs", () => {
  it("removes empty lock directories and keeps non-empty ones and files", () => {
    p = makeProject();
    const locks = join(p.home, "locks");
    mkdirSync(join(locks, "a".repeat(40)), { recursive: true });
    mkdirSync(join(locks, "c".repeat(40)));
    const held = entry(join(locks, "b".repeat(40), "0.json"), LIVE);
    writeFileSync(join(locks, "notes.txt"), "x");
    expect(removeEmptyLockDirs(p.home)).toBe(2);
    expect(existsSync(join(locks, "a".repeat(40))) || existsSync(join(locks, "c".repeat(40)))).toBe(false);
    expect(existsSync(held)).toBe(true);
    expect(existsSync(join(locks, "notes.txt"))).toBe(true);
  });

  it("does nothing without a locks directory", () => {
    p = makeProject();
    expect(removeEmptyLockDirs(p.home)).toBe(0);
  });
});

describe("runCleanup", () => {
  it("marks a dead shepherd's lane orphaned and reaps its worker group", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "running", shepherdPid: DEAD, started: { pid: 7000 } });
    writeLaneRun(p.runsRoot, "done", { state: "finished", shepherdPid: DEAD, started: { pid: 7001 }, exit: { exitCode: 0 } });
    p.alive.add(7000);
    p.alive.add(7001);
    p.commands.set(7000, "/opt/claude/bin/claude -p --output-format stream-json");
    entry(join(p.home, "slots", "0.json"), DEAD);
    expect(await runCleanup([], p.ctx)).toBe(0);
    const state = readState(p.runsRoot, "demo");
    expect(state).toMatchObject({ state: "orphaned", reason: `shepherd ${DEAD} died while running` });
    expect(p.signals).toContainEqual({ target: -7000, sig: "SIGTERM" });
    expect(p.signals).toContainEqual({ target: -7000, sig: "SIGKILL" });
    expect(p.signals.some((s) => Math.abs(s.target) === 7001)).toBe(false);
    expect(p.stdout()).toBe(`orphaned demo\nreaped demo pgid 7000\nreleased ${join(p.home, "slots", "0.json")}\n`);
  });

  it("does not reap a recycled worker pid", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "orphaned", shepherdPid: DEAD, started: { pid: 7000 } });
    p.alive.add(7000);
    p.commands.set(7000, "/usr/sbin/somedaemon");
    expect(await runCleanup([], p.ctx)).toBe(0);
    expect(p.signals).toEqual([]);
    expect(p.stdout()).toBe("nothing to clean\n");
  });

  it("--worktrees removes only finished, clean, merged worktrees not borrowed by an active lane", async () => {
    p = makeProject();
    const add = (lane: string): string => {
      const path = join(p.worktreeRoot, lane);
      p.ok(["worktree", "add", "-q", "-b", `arbab/${lane}`, path, "main"]);
      return path;
    };
    const merged = add("merged");
    const dirty = add("dirty");
    writeFileSync(join(dirty, "new.txt"), "x");
    const ahead = add("ahead");
    writeFileSync(join(ahead, "a.txt"), "a");
    p.ok(["add", "-A"], ahead);
    p.ok(["commit", "-q", "-m", "work"], ahead);
    const lent = add("lent");
    const running = add("running");
    for (const lane of ["merged", "dirty", "ahead", "lent"]) writeLaneRun(p.runsRoot, lane, { state: "finished", endState: "success" });
    p.alive.add(LIVE);
    writeLaneRun(p.runsRoot, "running", { state: "running", shepherdPid: LIVE });
    writeLaneRun(p.runsRoot, "check", {
      state: "running",
      shepherdPid: LIVE,
      lane: { name: "check", role: "verifier", brief: "lanes/demo.md", worktree: "lent" },
    });

    expect(await runCleanup(["--worktrees", "--json"], p.ctx)).toBe(0);
    const out = JSON.parse(p.stdout()) as Record<string, unknown>;
    expect(Object.keys(out)).toEqual([
      "orphaned",
      "reaped",
      "released",
      "worktreesRemoved",
      "branchesDeleted",
      "worktreesKept",
      "branchesKept",
      "warnings",
      "worktreeRemovals",
      "lockDirsRemoved",
      "sessionWatermarksRemoved",
    ]);
    expect(out.worktreesRemoved).toEqual([merged]);
    expect(out.worktreeRemovals).toEqual([{ path: merged, reason: "merged into main" }]);
    expect(out.lockDirsRemoved).toBe(0);
    // A later plan phase merges arbab/<lane> by name; only the worktree goes.
    expect(out.branchesDeleted).toEqual([]);
    expect(out.worktreesKept).toEqual([
      { path: ahead, reason: "branch arbab/ahead is not merged into main" },
      { path: dirty, reason: "uncommitted changes" },
      { path: lent, reason: "in use by lane check" },
    ]);
    expect(out.branchesKept).toEqual([]);
    expect(existsSync(merged)).toBe(false);
    for (const path of [dirty, ahead, lent, running]) expect(existsSync(path)).toBe(true);
    for (const lane of ["merged", "dirty", "ahead", "lent", "running"]) expect(hasBranch(p, `arbab/${lane}`)).toBe(true);
    // The run dirs are the measurements.
    expect(existsSync(join(p.runsRoot, "merged"))).toBe(true);
  });

  it("--worktrees deletes a generated lane's merged branch whose worktree is gone, keeps an unmerged one and one git refuses", async () => {
    p = makeProject();
    p.ok(["branch", "arbab/gone", "main"]);
    branchWith(p, "arbab/ahead", "a.txt", "a\n");
    p.ok(["branch", "arbab/side", "main"]);
    for (const lane of ["gone", "ahead", "side"]) {
      writeLaneRun(p.runsRoot, lane, { state: "finished", endState: "success" });
      markGenerated(p.runsRoot, lane, { integration: "rel", branch: "integrate/rel", head: "main" }, T);
    }
    // A lane nobody generated keeps its merged branch, and says nothing about it.
    p.ok(["branch", "arbab/plain", "main"]);
    writeLaneRun(p.runsRoot, "plain", { state: "finished", endState: "success" });
    // A finished lane with neither worktree nor branch has nothing to report.
    writeLaneRun(p.runsRoot, "bare", { state: "finished", endState: "success" });
    markGenerated(p.runsRoot, "bare", { integration: "rel", branch: "integrate/rel", head: "main" }, T);
    const real = p.ctx.git;
    p.ctx.git = (args, cwd) =>
      args.includes("-d") && args.includes("arbab/side") ? { code: 1, stdout: "", stderr: "error: branch 'arbab/side' is locked\n" } : real(args, cwd);

    expect(await runCleanup(["--worktrees"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe(
      "deleted branch arbab/gone\n" +
        "kept branch arbab/ahead: branch arbab/ahead is not merged into main\n" +
        "kept branch arbab/side: git branch -d failed: error: branch 'arbab/side' is locked\n",
    );
    expect(hasBranch(p, "arbab/gone")).toBe(false);
    expect(hasBranch(p, "arbab/ahead")).toBe(true);
    expect(hasBranch(p, "arbab/side")).toBe(true);
    expect(hasBranch(p, "arbab/plain")).toBe(true);
  });

  it("--worktrees runs git without hooks, never forces and checks status through the verified git dir", async () => {
    p = makeProject();
    const path = join(p.worktreeRoot, "merged");
    p.ok(["worktree", "add", "-q", "-b", "arbab/merged", path, "main"]);
    writeLaneRun(p.runsRoot, "merged", { state: "finished", endState: "success" });
    markGenerated(p.runsRoot, "merged", { integration: "rel", branch: "integrate/rel", head: "main" }, T);
    const calls: string[][] = [];
    const real = p.ctx.git;
    p.ctx.git = (args, cwd) => {
      calls.push(args);
      return real(args, cwd);
    };
    expect(await runCleanup(["--worktrees"], p.ctx)).toBe(0);
    const gitDir = join(p.root, ".git", "worktrees", "merged");
    expect(calls).toContainEqual([...untrustedTree(), `--git-dir=${gitDir}`, `--work-tree=${path}`, "status", "--porcelain", "--ignore-submodules=all"]);
    expect(calls).toContainEqual([...untrustedTree(), "worktree", "remove", path]);
    expect(calls).toContainEqual([...untrustedTree(), "branch", "-d", "arbab/merged"]);
    expect(calls.some((args) => args.includes("--force") || args.includes("-D"))).toBe(false);
  });

  it("--worktrees keeps a worktree holding a staged nested repository, and runs nothing of it", async () => {
    p = makeProject();
    const path = join(p.worktreeRoot, "nested");
    p.ok(["worktree", "add", "-q", "-b", "arbab/nested", path, "main"]);
    const nested = plantNestedRepo(p.git, path, "sub", p.dir);
    p.ok(["add", "sub"], path);
    nested.reset();
    writeLaneRun(p.runsRoot, "nested", { state: "finished", endState: "success" });
    markGenerated(p.runsRoot, "nested", { integration: "rel", branch: "integrate/rel", head: "main" }, T);

    expect(await runCleanup(["--worktrees"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe(`kept worktree ${path}: uncommitted changes\n`);
    expect(existsSync(path)).toBe(true);
    expect(nested.ran()).toBe("");
    // The status cleanup ran before runs the worker's commands.
    p.ok(["--git-dir", join(p.root, ".git", "worktrees", "nested"), `--work-tree=${path}`, "status", "--porcelain"], path);
    expect(nested.ran()).toMatch(/clean/);
  });

  it("--worktrees keeps a worktree whose .git file points elsewhere, and runs no git in it", async () => {
    p = makeProject();
    // A git dir of the worker's making, whose config would run a command on any status in it.
    const evil = join(p.dir, "evil");
    p.ok(["init", "-q", evil], p.dir);
    const ran = join(p.dir, "fsmonitor-ran");
    writeFileSync(join(p.dir, "monitor.sh"), `#!/bin/sh\ntouch "${ran}"\n`, { mode: 0o755 });
    p.ok(["config", "core.fsmonitor", join(p.dir, "monitor.sh")], evil);
    const lane = join(p.worktreeRoot, "planted");
    p.ok(["worktree", "add", "-q", "-b", "arbab/planted", lane, "main"]);
    writeFileSync(join(lane, ".git"), `gitdir: ${join(evil, ".git")}\n`);
    writeLaneRun(p.runsRoot, "planted", { state: "finished", endState: "success" });
    // The integration worktree is checked on integrate/<name> the same way.
    branchWith(p, "arbab/a", "a.txt", "a\n");
    expect(await runIntegrate(["rel", "--lanes", "a"], p.ctx)).toBe(0);
    p.ok(["merge", "-q", "--no-ff", "--no-edit", "integrate/rel"]);
    writeFileSync(join(p.root, ".arbab", "integrations", "rel", "landing.json"), "{}");
    const integration = join(p.worktreeRoot, "integrate-rel");
    writeFileSync(join(integration, ".git"), `gitdir: ${join(evil, ".git")}\n`);
    p.out.length = 0;
    const cwds: string[] = [];
    const real = p.ctx.git;
    p.ctx.git = (args, cwd) => {
      cwds.push(cwd);
      return real(args, cwd);
    };

    expect(await runCleanup(["--worktrees", "--json"], p.ctx)).toBe(0);
    const out = JSON.parse(p.stdout()) as { worktreesKept: Array<{ path: string; reason: string }>; worktreesRemoved: string[] };
    expect(out.worktreesRemoved).toEqual([]);
    expect(out.worktreesKept).toEqual([
      { path: lane, reason: expect.stringMatching(/^cannot verify its git dir: git dir .*evil.* is not under /) },
      { path: integration, reason: expect.stringMatching(/^cannot verify its git dir: git dir .*evil.* is not under /) },
    ]);
    expect(cwds.filter((cwd) => cwd === lane || cwd === integration)).toEqual([]);
    expect(existsSync(ran)).toBe(false);
    expect(existsSync(lane) && existsSync(integration)).toBe(true);
    expect(hasBranch(p, "integrate/rel")).toBe(true);
  });

  it("--worktrees cleans a lane whose worktree names itself, and keeps what another lane's run borrows", async () => {
    p = makeProject();
    const add = (lane: string): string => {
      const path = join(p.worktreeRoot, lane);
      p.ok(["worktree", "add", "-q", "-b", `arbab/${lane}`, path, "main"]);
      return path;
    };
    const self = add("self");
    writeLaneRun(p.runsRoot, "self", { state: "finished", endState: "success", lane: { name: "self", role: "implementer", brief: "lanes/demo.md", worktree: "self" } });
    markGenerated(p.runsRoot, "self", { integration: "rel", branch: "integrate/rel", head: "main" }, T);
    // A borrower that has a worktree under its own name is kept, with why.
    const owner = add("owner");
    writeLaneRun(p.runsRoot, "owner", { state: "finished", endState: "success" });
    const borrower = add("borrower");
    writeLaneRun(p.runsRoot, "borrower", { state: "finished", endState: "success", lane: { name: "borrower", role: "verifier", brief: "lanes/demo.md", worktree: "owner" } });
    // An orphaned borrower's worker may still run in the owner's worktree.
    const lent = add("lent");
    writeLaneRun(p.runsRoot, "lent", { state: "finished", endState: "success" });
    writeLaneRun(p.runsRoot, "ghost", { state: "orphaned", lane: { name: "ghost", role: "verifier", brief: "lanes/demo.md", worktree: "lent" } });

    expect(await runCleanup(["--worktrees", "--json"], p.ctx)).toBe(0);
    const out = JSON.parse(p.stdout()) as Record<string, unknown>;
    expect(out.worktreesRemoved).toEqual([owner, self]);
    expect(out.branchesDeleted).toEqual(["arbab/self"]);
    expect(out.worktreesKept).toEqual([
      { path: borrower, reason: "lane borrower works in lane owner's worktree" },
      { path: lent, reason: "in use by lane ghost" },
    ]);
    expect(existsSync(self) || existsSync(owner)).toBe(false);
    expect(existsSync(borrower) && existsSync(lent)).toBe(true);
  });

  it("--worktrees reports a lane whose run dir has no state as kept", async () => {
    p = makeProject();
    const path = join(p.worktreeRoot, "early");
    p.ok(["worktree", "add", "-q", "-b", "arbab/early", path, "main"]);
    mkdirSync(join(p.runsRoot, "early"), { recursive: true });
    writeFileSync(join(p.runsRoot, "early", "lane.json"), JSON.stringify({ name: "early", role: "implementer", brief: "lanes/demo.md" }));
    p.ok(["branch", "arbab/stateless", "main"]);
    mkdirSync(join(p.runsRoot, "stateless"), { recursive: true });
    markGenerated(p.runsRoot, "stateless", { integration: "rel", branch: "integrate/rel", head: "main" }, T);

    expect(await runCleanup(["--worktrees"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe(`kept worktree ${path}: no run state\nkept branch arbab/stateless: no run state\n`);
    expect(existsSync(path)).toBe(true);
    expect(hasBranch(p, "arbab/stateless")).toBe(true);
  });

  it("--worktrees removes a landed integration's worktree and branch, and leaves one not landed and the records", async () => {
    p = makeProject();
    branchWith(p, "arbab/a", "a.txt", "a\n");
    branchWith(p, "arbab/b", "b.txt", "b\n");
    expect(await runIntegrate(["rel", "--lanes", "a"], p.ctx)).toBe(0);
    expect(await runIntegrate(["wip", "--lanes", "b"], p.ctx)).toBe(0);
    p.ok(["merge", "-q", "--no-ff", "--no-edit", "integrate/rel"]);
    const records = join(p.root, ".arbab", "integrations");
    writeFileSync(join(records, "rel", "landing.json"), "{}");
    // Landed but not merged into the base (a landing record by hand): its branch stays.
    writeFileSync(join(records, "wip", "landing.json"), "{}");
    // A directory without integration.json is only a warning.
    mkdirSync(join(records, "torn"));
    writeFileSync(join(records, "torn", "landing.json"), "{}");
    p.out.length = 0;

    expect(await runCleanup(["--worktrees", "--json"], p.ctx)).toBe(0);
    const out = JSON.parse(p.stdout()) as Record<string, unknown>;
    const rel = join(p.worktreeRoot, "integrate-rel");
    const wip = join(p.worktreeRoot, "integrate-wip");
    expect(out.worktreesRemoved).toEqual([rel]);
    expect(out.branchesDeleted).toEqual(["integrate/rel"]);
    expect(out.worktreesKept).toEqual([{ path: wip, reason: "branch integrate/wip is not merged into main" }]);
    expect(out.warnings).toEqual(["integration torn landed but has no integration.json"]);
    expect(existsSync(rel)).toBe(false);
    expect(hasBranch(p, "integrate/rel")).toBe(false);
    expect(existsSync(wip)).toBe(true);
    expect(existsSync(join(records, "rel", "integration.json"))).toBe(true);
  });

  it("--worktrees removes the worktrees a squash landing's record lists, keeping the branches, and keeps a branch that moved on", async () => {
    p = makeProject();
    const squashed = addWorktree(p, "squashed");
    const squashedHead = commitIn(p, squashed, "s.txt");
    const gen = addWorktree(p, "gen");
    commitIn(p, gen, "g.txt");
    const moved = addWorktree(p, "moved");
    const movedRecorded = commitIn(p, moved, "m1.txt");
    commitIn(p, moved, "m2.txt");
    for (const lane of ["squashed", "gen", "moved"]) writeLaneRun(p.runsRoot, lane, { state: "finished", endState: "success" });
    markGenerated(p.runsRoot, "gen", { integration: "rel", branch: "integrate/rel", head: "main" }, T);
    expect(await runIntegrate(["rel", "--lanes", "squashed,gen"], p.ctx)).toBe(0);
    const integrationHead = p.ok(["rev-parse", "integrate/rel"]).trim();
    p.ok(["merge", "-q", "--squash", "integrate/rel"]);
    p.ok(["commit", "-q", "-m", "Land rel"]);
    const landing: LandingRecord = {
      name: "rel",
      into: "main",
      integrationHead,
      mergeSha: p.ok(["rev-parse", "HEAD"]).trim(),
      landedAt: T,
      pushed: false,
      squash: true,
      // gen's head is an ancestor of the recorded sha; moved's branch went on after the recorded one.
      lanes: [
        { lane: "squashed", sha: squashedHead },
        { lane: "gen", sha: integrationHead },
        { lane: "moved", sha: movedRecorded },
      ],
    };
    writeFileSync(join(p.root, ".arbab", "integrations", "rel", "landing.json"), JSON.stringify(landing));
    for (const branch of ["arbab/squashed", "arbab/gen"]) expect(p.git(["merge-base", "--is-ancestor", branch, "main"], p.root).code).toBe(1);
    p.out.length = 0;

    expect(await runCleanup(["--worktrees", "--json"], p.ctx)).toBe(0);
    const out = JSON.parse(p.stdout()) as CleanupReport;
    const integration = join(p.worktreeRoot, "integrate-rel");
    expect(out.worktreeRemovals).toEqual([
      { path: gen, reason: "landed by integration rel" },
      { path: squashed, reason: "landed by integration rel" },
      { path: integration, reason: "landed by integration rel" },
    ]);
    expect(out.worktreesRemoved).toEqual([gen, squashed, integration]);
    expect(out.worktreesKept).toEqual([{ path: moved, reason: "branch arbab/moved is not merged into main" }]);
    // branch -d would refuse a squash-landed branch; even a generated lane's stays.
    expect(out.branchesDeleted).toEqual([]);
    expect(out.branchesKept).toEqual([]);
    expect(out.warnings).toEqual([]);
    for (const branch of ["arbab/squashed", "arbab/gen", "arbab/moved", "integrate/rel"]) expect(hasBranch(p, branch)).toBe(true);
    expect(existsSync(moved)).toBe(true);
  });

  it("--worktrees ignores landing records without lanes or with malformed entries", async () => {
    p = makeProject();
    const lane = addWorktree(p, "ahead");
    const head = commitIn(p, lane, "a.txt");
    writeLaneRun(p.runsRoot, "ahead", { state: "finished", endState: "success" });
    const records = join(p.root, ".arbab", "integrations");
    for (const [name, text] of [
      ["old", JSON.stringify({ name: "old", into: "main", integrationHead: "x", mergeSha: "y", landedAt: T, pushed: false })],
      ["bad", JSON.stringify({ lanes: [null, { lane: "ahead", sha: "HEAD" }, { lane: "../x", sha: head }, { lane: "ahead", sha: head.toUpperCase() }] })],
      ["torn", "{"],
    ] as const) {
      mkdirSync(join(records, name), { recursive: true });
      writeFileSync(join(records, name, "landing.json"), text);
    }
    p.out.length = 0;

    expect(await runCleanup(["--worktrees", "--json"], p.ctx)).toBe(0);
    const out = JSON.parse(p.stdout()) as CleanupReport;
    expect(out.worktreesRemoved).toEqual([]);
    expect(out.worktreesKept).toEqual([{ path: lane, reason: "branch arbab/ahead is not merged into main" }]);
  });

  it("--worktrees --older-than removes old, clean, unborrowed worktrees of finished lanes and keeps their branches", async () => {
    p = makeProject();
    // .arbab-tmp/ is excluded as arbab's own runs exclude it; the worker's temp files never block a removal.
    writeFileSync(join(p.root, ".git", "info", "exclude"), ".arbab-tmp/\n");
    const old = addWorktree(p, "old");
    commitIn(p, old, "o.txt");
    mkdirSync(join(old, ".arbab-tmp", "inputs"), { recursive: true });
    writeFileSync(join(old, ".arbab-tmp", "inputs", "notes.md"), "x");
    const gen = addWorktree(p, "old-verify");
    commitIn(p, gen, "v.txt");
    const dirty = addWorktree(p, "dirty");
    writeFileSync(join(dirty, "new.txt"), "x");
    const young = addWorktree(p, "young");
    commitIn(p, young, "y.txt");
    const lent = addWorktree(p, "lent");
    commitIn(p, lent, "l.txt");
    for (const lane of ["old", "old-verify", "dirty", "lent"]) writeLaneRun(p.runsRoot, lane, { state: "finished", endState: "success", since: OLD });
    markGenerated(p.runsRoot, "old-verify", { integration: "rel", branch: "integrate/rel", head: "main" }, T);
    writeLaneRun(p.runsRoot, "young", { state: "finished", endState: "success", since: RECENT });
    p.alive.add(LIVE);
    writeLaneRun(p.runsRoot, "check", {
      state: "running",
      shepherdPid: LIVE,
      since: OLD,
      lane: { name: "check", role: "verifier", brief: "lanes/demo.md", worktree: "lent" },
    });
    // An integration that has not landed and was used recently keeps its worktree.
    branchWith(p, "arbab/b", "b.txt", "b\n");
    expect(await runIntegrate(["wip", "--lanes", "b"], p.ctx)).toBe(0);
    const wip = join(p.worktreeRoot, "integrate-wip");
    p.out.length = 0;

    expect(await runCleanup(["--worktrees", "--older-than", "30"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe(
      `removed worktree ${old}: unchanged for 40 days; branch arbab/old kept\n` +
        `removed worktree ${gen}: unchanged for 40 days; branch arbab/old-verify kept\n` +
        `kept worktree ${dirty}: uncommitted changes\n` +
        `kept worktree ${lent}: in use by lane check\n` +
        `kept worktree ${young}: branch arbab/young is not merged into main\n` +
        `kept worktree ${wip}: integration wip used within 30 days\n`,
    );
    expect(existsSync(old) || existsSync(gen)).toBe(false);
    for (const path of [dirty, young, lent, wip]) expect(existsSync(path)).toBe(true);
    for (const lane of ["old", "old-verify", "dirty", "young", "lent"]) expect(hasBranch(p, `arbab/${lane}`)).toBe(true);
    expect(hasBranch(p, "integrate/wip")).toBe(true);
  });

  it("--older-than counts from the last state change, not the worktree's age", async () => {
    p = makeProject();
    const path = addWorktree(p, "ahead");
    commitIn(p, path, "a.txt");
    writeLaneRun(p.runsRoot, "ahead", { state: "finished", endState: "success", since: RECENT });
    expect(await runCleanup(["--worktrees", "--older-than", "3"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe(`kept worktree ${path}: branch arbab/ahead is not merged into main\n`);
    p.out.length = 0;
    expect(await runCleanup(["--worktrees", "--older-than", "1", "--json"], p.ctx)).toBe(0);
    expect((JSON.parse(p.stdout()) as CleanupReport).worktreeRemovals).toEqual([{ path, reason: "unchanged for 2 days; branch arbab/ahead kept" }]);
  });

  it("--mine touches only the runs this session owns, not other sessions' or ownerless ones", async () => {
    p = makeProject();
    p.ctx.hostEnv = { CLAUDE_CODE_SESSION_ID: "session-mine" };
    const paths = Object.fromEntries(["own", "other", "ownerless", "legacy"].map((lane) => [lane, addWorktree(p, lane)]));
    for (const lane of ["own", "other", "ownerless", "legacy"]) writeLaneRun(p.runsRoot, lane, { state: "finished", endState: "success" });
    ownRun(p, "own", "session-mine");
    ownRun(p, "other", "session-other");
    ownRun(p, "ownerless", null);
    // Dead shepherds: only this session's lane is marked orphaned.
    writeLaneRun(p.runsRoot, "own-dead", { state: "running", shepherdPid: DEAD });
    ownRun(p, "own-dead", "session-mine");
    writeLaneRun(p.runsRoot, "other-dead", { state: "running", shepherdPid: DEAD });
    ownRun(p, "other-dead", "session-other");
    // A landed integration has no owner, so --mine leaves it.
    branchWith(p, "arbab/a", "a.txt", "a\n");
    expect(await runIntegrate(["rel", "--lanes", "a"], p.ctx)).toBe(0);
    p.ok(["merge", "-q", "--no-ff", "--no-edit", "integrate/rel"]);
    writeFileSync(join(p.root, ".arbab", "integrations", "rel", "landing.json"), "{}");
    p.out.length = 0;

    expect(await runCleanup(["--worktrees", "--mine", "--json"], p.ctx)).toBe(0);
    const out = JSON.parse(p.stdout()) as CleanupReport;
    expect(out.orphaned).toEqual(["own-dead"]);
    expect(out.worktreesRemoved).toEqual([paths["own"]]);
    expect(out.worktreesKept).toEqual([]);
    for (const lane of ["other", "ownerless", "legacy"]) expect(existsSync(paths[lane] ?? "")).toBe(true);
    expect(readState(p.runsRoot, "other-dead")?.state).toBe("running");
    expect(existsSync(join(p.worktreeRoot, "integrate-rel"))).toBe(true);

    // Outside Claude Code there is no session, and every run is the caller's.
    p.ctx.hostEnv = {};
    p.out.length = 0;
    expect(await runCleanup(["--worktrees", "--mine", "--json"], p.ctx)).toBe(0);
    expect((JSON.parse(p.stdout()) as CleanupReport).worktreesRemoved).toEqual([
      paths["legacy"],
      paths["other"],
      paths["ownerless"],
      join(p.worktreeRoot, "integrate-rel"),
    ]);
  });

  it("removes empty lock directories on every run and reports how many", async () => {
    p = makeProject();
    const locks = join(p.home, "locks");
    mkdirSync(join(locks, "a".repeat(40)), { recursive: true });
    const dead = entry(join(locks, "c".repeat(40), "0.json"), DEAD);
    const held = entry(join(locks, "b".repeat(40), "0.json"), LIVE);
    p.alive.add(LIVE);
    expect(await runCleanup([], p.ctx)).toBe(0);
    // The dead holder's entry goes first, then its directory with the empty one.
    expect(p.stdout()).toBe(`released ${dead}\nremoved 2 empty lock directories\n`);
    expect(existsSync(held)).toBe(true);
    p.out.length = 0;
    expect(await runCleanup(["--json"], p.ctx)).toBe(0);
    expect((JSON.parse(p.stdout()) as CleanupReport).lockDirsRemoved).toBe(0);
  });

  it("removes session watermarks not modified for 30 days on every run and reports how many", async () => {
    p = makeProject();
    const DAY = 86_400_000;
    const old = [watermarkPath(p.home, "session-1"), watermarkPath(p.home, "session-2")];
    const fresh = watermarkPath(p.home, "session-3");
    for (const path of old) entry(path, null, 31 * DAY);
    entry(fresh, null, 29 * DAY);
    // Not a watermark's name: left alone whatever its age.
    const other = entry(join(p.home, "sessions", "notes.json"), null, 40 * DAY);
    expect(await runCleanup([], p.ctx)).toBe(0);
    expect(p.stdout()).toBe("removed 2 session watermarks unused for 30 days\n");
    for (const path of old) expect(existsSync(path)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(other)).toBe(true);
    p.out.length = 0;
    expect(await runCleanup(["--json"], p.ctx)).toBe(0);
    expect((JSON.parse(p.stdout()) as CleanupReport).sessionWatermarksRemoved).toBe(0);
  });

  it("warns about an unreadable state file instead of failing", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "finished" });
    writeFileSync(join(p.runsRoot, "demo", "state.json"), "{");
    expect(await runCleanup([], p.ctx)).toBe(0);
    expect(p.stdout()).toMatch(/^warning demo: /);
    expect(readFileSync(join(p.runsRoot, "demo", "state.json"), "utf8")).toBe("{");
  });

  it("rejects usage errors", async () => {
    p = makeProject();
    await expect(runCleanup(["demo"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runCleanup(["--all"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runCleanup(["--older-than", "30"], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/needs --worktrees/) });
    for (const days of ["0", "1.5", "x", "", "07", "1e3", "99999999999999999"]) {
      await expect(runCleanup(["--worktrees", `--older-than=${days}`], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/positive whole number/) });
    }
  });
});

describe("formatCleanup", () => {
  it("lists every action", () => {
    expect(
      formatCleanup({
        orphaned: ["a"],
        reaped: [{ lane: "a", pgid: 5 }],
        released: ["/h/slots/0.json"],
        worktreesRemoved: ["/w/b", "/w/e"],
        branchesDeleted: ["arbab/b"],
        worktreesKept: [{ path: "/w/c", reason: "uncommitted changes" }],
        branchesKept: [{ branch: "arbab/d", reason: "branch arbab/d is not merged into main" }],
        warnings: ["w"],
        worktreeRemovals: [{ path: "/w/b", reason: "merged into main" }],
        lockDirsRemoved: 3,
        sessionWatermarksRemoved: 2,
      }),
    ).toBe(
      "orphaned a\nreaped a pgid 5\nreleased /h/slots/0.json\nremoved 3 empty lock directories\n" +
        "removed 2 session watermarks unused for 30 days\n" +
        "removed worktree /w/b: merged into main\nremoved worktree /w/e\ndeleted branch arbab/b\n" +
        "kept worktree /w/c: uncommitted changes\nkept branch arbab/d: branch arbab/d is not merged into main\nwarning w",
    );
  });

  it("says one lock directory in the singular", () => {
    expect(formatCleanup({ ...empty(), lockDirsRemoved: 1 })).toBe("removed 1 empty lock directory");
  });

  it("says one session watermark in the singular", () => {
    expect(formatCleanup({ ...empty(), sessionWatermarksRemoved: 1 })).toBe("removed 1 session watermark unused for 30 days");
  });

  it("says when there is nothing to clean", () => {
    expect(formatCleanup(empty())).toBe("nothing to clean");
    expect(formatWorktreeCleanup(emptyWorktreeCleanup())).toEqual([]);
  });

  it("gives land's removals without reasons", () => {
    expect(formatWorktreeCleanup({ ...emptyWorktreeCleanup(), worktreesRemoved: ["/w/a"] })).toEqual(["removed worktree /w/a"]);
  });
});

/** Sets the mtime of every file directly in the integration's records directory to `iso`. */
function ageRecords(t: TestProject, name: string, iso: string): void {
  const dir = join(t.root, ".arbab", "integrations", name);
  const sec = Date.parse(iso) / 1000;
  for (const file of readdirSync(dir, { withFileTypes: true })) if (file.isFile()) utimesSync(join(dir, file.name), sec, sec);
}

/** An integration `wip` of arbab/b, its records last written 40 days ago; returns its worktree. */
async function idleIntegration(t: TestProject): Promise<string> {
  branchWith(t, "arbab/b", "b.txt", "b\n");
  expect(await runIntegrate(["wip", "--lanes", "b"], t.ctx)).toBe(0);
  ageRecords(t, "wip", OLD);
  t.out.length = 0;
  return join(t.worktreeRoot, "integrate-wip");
}

const lockOf = (t: TestProject, name: string): string => join(t.home, "locks", writerLockKey(join(realpathSync(t.worktreeRoot), name)), "0.json");

describe("cleanup --worktrees --older-than and unlanded integrations", () => {
  it("removes an idle integration's clean worktree and keeps its branch and records", async () => {
    p = makeProject();
    const wip = await idleIntegration(p);
    expect(await runCleanup(["--worktrees", "--older-than", "30"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe(`removed worktree ${wip}: integration wip unused for 40 days; branch integrate/wip kept\n`);
    expect(existsSync(wip)).toBe(false);
    expect(hasBranch(p, "integrate/wip")).toBe(true);
    expect(existsSync(join(p.root, ".arbab", "integrations", "wip", "integration.json"))).toBe(true);
    // The writer lock was released after.
    expect(existsSync(lockOf(p, "integrate-wip"))).toBe(false);
  });

  it("leaves unlanded integrations alone without --older-than", async () => {
    p = makeProject();
    const wip = await idleIntegration(p);
    expect(await runCleanup(["--worktrees"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe("nothing to clean\n");
    expect(existsSync(wip)).toBe(true);
  });

  it("keeps an idle integration's worktree when it has changes", async () => {
    p = makeProject();
    const wip = await idleIntegration(p);
    writeFileSync(join(wip, "notes.txt"), "x");
    expect(await runCleanup(["--worktrees", "--older-than", "30"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe(`kept worktree ${wip}: uncommitted changes\n`);
    expect(existsSync(wip)).toBe(true);
  });

  it("keeps an idle integration's worktree while a lane it generated is active", async () => {
    p = makeProject();
    const wip = await idleIntegration(p);
    p.alive.add(LIVE);
    writeLaneRun(p.runsRoot, "wip-verify", { state: "running", shepherdPid: LIVE });
    markGenerated(p.runsRoot, "wip-verify", { integration: "wip", branch: "integrate/wip", head: "main" }, T);
    expect(await runCleanup(["--worktrees", "--older-than", "30"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe(`kept worktree ${wip}: lane wip-verify of integration wip is active\n`);
    expect(existsSync(wip)).toBe(true);
  });

  it("keeps an integration whose records changed within the days asked", async () => {
    p = makeProject();
    const wip = await idleIntegration(p);
    ageRecords(p, "wip", RECENT);
    expect(await runCleanup(["--worktrees", "--older-than", "3"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe(`kept worktree ${wip}: integration wip used within 3 days\n`);
    expect(existsSync(wip)).toBe(true);
  });

  it("keeps an integration worktree whose git dir does not verify", async () => {
    p = makeProject();
    const wip = await idleIntegration(p);
    writeFileSync(join(wip, ".git"), "gitdir: /nonexistent\n");
    expect(await runCleanup(["--worktrees", "--older-than", "30", "--json"], p.ctx)).toBe(0);
    const out = JSON.parse(p.stdout()) as CleanupReport;
    expect(out.worktreesRemoved).toEqual([]);
    expect(out.worktreesKept).toEqual([{ path: wip, reason: expect.stringMatching(/^cannot verify its git dir: /) as unknown }]);
  });
});

describe("worktree removal under the writer lock", () => {
  const DAY = 86_400_000;

  /** A finished lane `old`, 40 days unchanged, with a committed worktree; returns the worktree. */
  function oldLane(t: TestProject): string {
    const old = addWorktree(t, "old");
    commitIn(t, old, "o.txt");
    writeLaneRun(t.runsRoot, "old", { state: "finished", endState: "success", since: OLD });
    return old;
  }

  it("keeps a worktree whose writer lock a live process holds, and leaves that lock alone", async () => {
    p = makeProject();
    const old = oldLane(p);
    p.alive.add(LIVE);
    const holder = { pid: LIVE, lane: "other", project: p.root, createdAt: T };
    expect(acquireWriterLock(p.home, writerLockKey(join(realpathSync(p.worktreeRoot), "old")), holder, p.ctx.alive)).toBe(true);
    expect(await runCleanup(["--worktrees", "--older-than", "30"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe(`kept worktree ${old}: ${WRITER_LOCK_HELD}\n`);
    expect(existsSync(old)).toBe(true);
    expect(JSON.parse(readFileSync(lockOf(p, "old"), "utf8"))).toEqual(holder);
  });

  it("takes over a lock its dead holder left, and releases it after the removal", () => {
    p = makeProject();
    const old = oldLane(p);
    entry(lockOf(p, "old"), DEAD);
    const out = emptyWorktreeCleanup();
    removeLaneWorktrees(p.ctx, openProject(p.ctx), ["old"], "main", out, { olderThanMs: 30 * DAY });
    expect(out.worktreesRemoved).toEqual([old]);
    expect(existsSync(lockOf(p, "old"))).toBe(false);
  });

  it("keeps a lane's worktree while its launch.lock exists", async () => {
    p = makeProject();
    const old = oldLane(p);
    writeFileSync(launchLockPath(openProject(p.ctx), "old"), JSON.stringify({ pid: LIVE, lane: "old", project: p.root, createdAt: T }));
    expect(await runCleanup(["--worktrees", "--older-than", "30"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe(`kept worktree ${old}: being launched\n`);
    expect(existsSync(old)).toBe(true);
    expect(existsSync(lockOf(p, "old"))).toBe(false);
  });

  it("keeps a lane whose state changed between the first read and the lock", () => {
    p = makeProject();
    const old = oldLane(p);
    // A dead holder's lock: taking it over asks whether DEAD lives, which is when a relaunch that finished at once
    // rewrites the state.
    entry(lockOf(p, "old"), DEAD);
    p.ctx.alive = (pid) => {
      if (pid === DEAD) writeLaneRun(p.runsRoot, "old", { state: "finished", endState: "success", since: T });
      return p.alive.has(pid);
    };
    const out = emptyWorktreeCleanup();
    removeLaneWorktrees(p.ctx, openProject(p.ctx), ["old"], "main", out, { olderThanMs: 30 * DAY });
    expect(out.worktreesRemoved).toEqual([]);
    expect(out.worktreesKept).toEqual([{ path: old, reason: "its state changed since cleanup read it" }]);
    expect(existsSync(old)).toBe(true);
    expect(existsSync(lockOf(p, "old"))).toBe(false);
  });

  it("keeps a lane that is running again by the time the lock is taken", () => {
    p = makeProject();
    const old = oldLane(p);
    entry(lockOf(p, "old"), DEAD);
    p.alive.add(LIVE);
    p.ctx.alive = (pid) => {
      if (pid === DEAD) writeLaneRun(p.runsRoot, "old", { state: "running", shepherdPid: LIVE, since: OLD });
      return p.alive.has(pid);
    };
    const out = emptyWorktreeCleanup();
    removeLaneWorktrees(p.ctx, openProject(p.ctx), ["old"], "main", out, { olderThanMs: 30 * DAY });
    expect(out.worktreesKept).toEqual([{ path: old, reason: "its state changed since cleanup read it" }]);
  });
});

describe("sweepIdleWorktrees", () => {
  it("removes idle finished lanes and integrations, branches kept, and reaps, releases and marks nothing", async () => {
    p = makeProject();
    const old = addWorktree(p, "old");
    commitIn(p, old, "o.txt");
    writeLaneRun(p.runsRoot, "old", { state: "finished", endState: "success", since: OLD });
    const young = addWorktree(p, "young");
    commitIn(p, young, "y.txt");
    writeLaneRun(p.runsRoot, "young", { state: "finished", endState: "success", since: RECENT });
    const wip = await idleIntegration(p);
    // What cleanup alone does: an orphan to mark, a dead slot to release.
    writeLaneRun(p.runsRoot, "gone", { state: "running", shepherdPid: DEAD });
    const slot = entry(join(p.home, "slots", "0.json"), DEAD);

    const result = sweepIdleWorktrees(p.ctx, openProject(p.ctx), 3);
    expect(result.worktreeRemovals).toEqual([
      { path: old, reason: "unchanged for 40 days; branch arbab/old kept" },
      { path: wip, reason: "integration wip unused for 40 days; branch integrate/wip kept" },
    ]);
    expect(result.worktreesKept).toEqual([{ path: young, reason: "branch arbab/young is not merged into main" }]);
    expect(result.warnings).toEqual([]);
    for (const branch of ["arbab/old", "arbab/young", "integrate/wip"]) expect(hasBranch(p, branch)).toBe(true);
    expect(readState(p.runsRoot, "gone")?.state).toBe("running");
    expect(existsSync(slot)).toBe(true);
  });

  it("refuses a day count below 1", () => {
    p = makeProject();
    expect(() => sweepIdleWorktrees(p.ctx, openProject(p.ctx), 0)).toThrow(/positive whole number of days/);
  });
});
