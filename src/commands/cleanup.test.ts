import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readState } from "../registry";
import { untrustedTree } from "../run";
import { plantNestedRepo } from "../run/testkit";
import { emptyWorktreeCleanup, formatCleanup, formatWorktreeCleanup, releaseStalePoolFiles, runCleanup, UNPARSED_GRACE_MS } from "./cleanup";
import { markGenerated } from "./generated";
import { runIntegrate } from "./integrate";
import { NOW_MS, branchWith, makeProject, writeLaneRun, type TestProject } from "./testkit";

let p: TestProject;
afterEach(() => p?.dispose());

const T = "2026-10-09T12:00:00.000Z";

const hasBranch = (t: TestProject, branch: string): boolean => t.git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], t.root).code === 0;

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
    ]);
    expect(out.worktreesRemoved).toEqual([merged]);
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
  });
});

describe("formatCleanup", () => {
  it("lists every action", () => {
    expect(
      formatCleanup({
        orphaned: ["a"],
        reaped: [{ lane: "a", pgid: 5 }],
        released: ["/h/slots/0.json"],
        worktreesRemoved: ["/w/b"],
        branchesDeleted: ["arbab/b"],
        worktreesKept: [{ path: "/w/c", reason: "uncommitted changes" }],
        branchesKept: [{ branch: "arbab/d", reason: "branch arbab/d is not merged into main" }],
        warnings: ["w"],
      }),
    ).toBe(
      "orphaned a\nreaped a pgid 5\nreleased /h/slots/0.json\nremoved worktree /w/b\ndeleted branch arbab/b\n" +
        "kept worktree /w/c: uncommitted changes\nkept branch arbab/d: branch arbab/d is not merged into main\nwarning w",
    );
  });

  it("says when there is nothing to clean", () => {
    expect(formatCleanup({ orphaned: [], reaped: [], released: [], ...emptyWorktreeCleanup() })).toBe("nothing to clean");
    expect(formatWorktreeCleanup(emptyWorktreeCleanup())).toEqual([]);
  });
});
