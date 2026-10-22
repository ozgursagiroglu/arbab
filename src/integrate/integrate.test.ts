import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeProject, mustGit, type TestProject } from "../../test/fake-claude/harness";
import { defaultConfig } from "../config";
import { untrustedTree, type ArgvRunner, type GitRunner } from "../run";
import { plantNestedRepo } from "../run/testkit";
import type { IntegrationRecord, ProjectConfig } from "../types";
import type { Clock } from "../util/proc";
import { confirmDeps, integrate, integrationPaths, listIntegrations, readIntegration, type IntegrateResult } from "./index";

let project: TestProject;
beforeEach(() => {
  project = makeProject();
});
afterEach(() => {
  project.cleanup();
});

const clock: Clock = { now: () => Date.parse("2026-10-09T12:00:00.000Z") };
const git = (args: string[], cwd = project.root): string => mustGit(project.git, args, cwd);
const config = (over: Partial<ProjectConfig> = {}): ProjectConfig => ({ ...defaultConfig(), ...over });

/** A lane branch arbab/<lane> off `base` with one commit writing each file (executable ones with mode 755). */
function lane(name: string, files: Record<string, string>, executable = false, base = "main"): string {
  const branch = `arbab/${name}`;
  git(["branch", branch, base]);
  const wt = join(project.dir, `wt-${name}`);
  git(["worktree", "add", wt, branch]);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(wt, file, ".."), { recursive: true });
    writeFileSync(join(wt, file), text);
    if (executable) chmodSync(join(wt, file), 0o755);
  }
  git(["add", "-A"], wt);
  git(["commit", "-q", "-m", `${name} work`], wt);
  return git(["rev-parse", "HEAD"], wt).trim();
}

interface Run {
  calls: string[][];
  deps: Array<{ argv: string[]; cwd: string; head: string }>;
}

function run(
  lanes: string[],
  opts: { cfg?: ProjectConfig; deps?: ArgvRunner; name?: string } = {},
): Run & { result: () => IntegrateResult; record: () => IntegrationRecord } {
  const calls: string[][] = [];
  const deps: Run["deps"] = [];
  const runner: GitRunner = (args, cwd) => {
    calls.push(args);
    return project.git(args, cwd);
  };
  const runCommand: ArgvRunner =
    opts.deps ??
    ((argv, cwd) => {
      deps.push({ argv, cwd, head: git(["rev-parse", "HEAD"], cwd).trim() });
      return { code: 0, output: "" };
    });
  const cfg = opts.cfg ?? config({ dependencies: { strategy: "command", command: ["pnpm", "install"] } });
  const result = (): IntegrateResult =>
    integrate({ projectRoot: project.root, config: cfg, name: opts.name ?? "m3", lanes, git: runner, runCommand, clock });
  return { calls, deps, result, record: () => result().record };
}

/** A commit made by hand in `cwd` writing each file. */
function commit(cwd: string, files: Record<string, string>, message = "by hand"): string {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(cwd, file, ".."), { recursive: true });
    writeFileSync(join(cwd, file), text);
  }
  git(["add", "-A"], cwd);
  git(["commit", "-q", "-m", message], cwd);
  return git(["rev-parse", "HEAD"], cwd).trim();
}

function caught(fn: () => unknown): Error & { code?: string } {
  try {
    fn();
  } catch (err) {
    return err as Error & { code?: string };
  }
  throw new Error("expected a throw");
}

const merges = (calls: string[][]): string[][] => calls.filter((args) => args.includes("merge") && args.includes("--no-ff"));

describe("integrationPaths", () => {
  it("places the records under .arbab/integrations/<name> and the worktree under the worktree root", () => {
    const p = integrationPaths(project.root, config({ worktreeRoot: "wts" }), "m3");
    const dir = join(project.root, ".arbab", "integrations", "m3");
    expect(p).toEqual({
      name: "m3",
      projectRoot: project.root,
      dir,
      integration: join(dir, "integration.json"),
      verify: join(dir, "verify.json"),
      review: join(dir, "review.json"),
      readiness: join(dir, "readiness.json"),
      readinessMd: join(dir, "readiness.md"),
      landing: join(dir, "landing.json"),
      lanesDir: join(dir, "lanes"),
      worktree: join(project.root, "wts", "integrate-m3"),
      branch: "integrate/m3",
    });
  });

  it("refuses an invalid name and a worktree root outside the project", () => {
    // integrate would generate integrate-verify, a lane name the integration worktrees reserve.
    for (const name of ["", "M3", "a/b", "../x", "-x", "integrate-m3", "integrate"]) {
      expect(caught(() => integrationPaths(project.root, config(), name)).code, name).toBe("usage");
    }
    expect(caught(() => integrationPaths(project.root, config({ worktreeRoot: "../elsewhere" }), "m3")).code).toBe("usage");
  });
});

describe("integrate", () => {
  it("creates the worktree from the base, runs the dependencies there before any merge, and merges lanes in order", () => {
    const main = git(["rev-parse", "main"]).trim();
    const a = lane("a", { "a.txt": "a\n" });
    const c = lane("c", { "c.txt": "c\n" });
    const r = run(["a", "c"]);
    const rec = r.record();
    const p = integrationPaths(project.root, config(), "m3");

    expect(r.calls).toContainEqual(["worktree", "add", "-b", "integrate/m3", p.worktree, "main"]);
    // The dependency command ran once, on the base: before the first merge.
    expect(r.deps).toEqual([{ argv: ["pnpm", "install"], cwd: p.worktree, head: main }]);

    expect(git(["log", "--format=%s", "-2"], p.worktree).trim().split("\n")).toEqual([
      "arbab: integrate c into integrate/m3",
      "arbab: integrate a into integrate/m3",
    ]);
    // --no-ff: a merge commit even where a fast-forward was possible, merging the resolved sha.
    expect(git(["rev-list", "--parents", "-1", "HEAD~1"], p.worktree).trim().split(" ")).toHaveLength(3);
    expect(merges(r.calls)).toHaveLength(2);
    expect(merges(r.calls)[0]?.slice(-7)).toEqual(["merge", "--no-ff", "--no-edit", "--no-verify", "-m", "arbab: integrate a into integrate/m3", a]);
    expect(existsSync(join(p.worktree, "a.txt")) && existsSync(join(p.worktree, "c.txt"))).toBe(true);

    const head = git(["rev-parse", "HEAD"], p.worktree).trim();
    expect(rec).toEqual({
      name: "m3",
      branch: "integrate/m3",
      worktree: p.worktree,
      base: "main",
      baseSha: main,
      merged: [
        { lane: "a", branch: "arbab/a", sha: a, manifests: [] },
        { lane: "c", branch: "arbab/c", sha: c, manifests: [] },
      ],
      manifests: [],
      depsConfirmedAt: null,
      depsConfirmed: true,
      headSha: head,
      updatedAt: "2026-10-09T12:00:00.000Z",
    });
    expect(readIntegration(p)).toEqual(rec);
    expect(JSON.parse(readFileSync(p.integration, "utf8"))).toEqual(rec);
    // The worktree and the records stay out of the main checkout's status.
    expect(readFileSync(join(project.root, ".git", "info", "exclude"), "utf8")).toMatch(/^\.arbab\/$/m);
    expect(JSON.parse(readFileSync(join(project.root, ".arbab", ".eslintrc.json"), "utf8"))).toEqual({ root: true });
    expect(git(["status", "--porcelain"])).toBe("");
    expect(git(["status", "--porcelain"], p.worktree)).toBe("");
  });

  it("does not merge lanes again on a second call, keeps their entries and appends the new one, without running dependencies again", () => {
    lane("a", { "a.txt": "a\n" });
    lane("c", { "c.txt": "c\n" });
    const first = run(["a", "c"]).result();
    expect(first.alreadyIn).toEqual([]);
    const d = lane("d", { "d.txt": "d\n" });

    const r = run(["a", "c", "d"]);
    const { record: rec, alreadyIn } = r.result();
    expect(alreadyIn).toEqual(["a", "c"]);
    expect(r.deps).toEqual([]);
    expect(r.calls.some((args) => args[0] === "worktree" && args[1] === "add")).toBe(false);
    expect(merges(r.calls)).toHaveLength(1);
    expect(rec.merged).toEqual([...first.record.merged, { lane: "d", branch: "arbab/d", sha: d, manifests: [] }]);
    expect(rec.baseSha).toBe(first.record.baseSha);
    expect(rec.headSha).toBe(git(["rev-parse", "integrate/m3"]).trim());

    // Nothing new: nothing merged, the record is unchanged but for its time.
    const again = run(["a", "c", "d"]);
    expect(again.record()).toEqual(rec);
    expect(merges(again.calls)).toEqual([]);
  });

  it("merges a lane again when its branch moved on, updating its one entry and joining its manifests", () => {
    lane("a", { "a.txt": "a\n", "package.json": "{}\n" });
    run(["a"]).record();
    const a2 = commit(join(project.dir, "wt-a"), { "a2.txt": "more\n", ".npmrc": "x\n" });
    const rec = run(["a"]).record();
    expect(rec.merged).toEqual([{ lane: "a", branch: "arbab/a", sha: a2, manifests: [".npmrc", "package.json"] }]);
    expect(readIntegration(integrationPaths(project.root, config(), "m3"))?.merged).toEqual(rec.merged);
  });

  it("collapses the duplicate entries an older record holds into one per lane", () => {
    const a1 = lane("a", { "a.txt": "a\n" });
    const c = lane("c", { "c.txt": "c\n" });
    const first = run(["a", "c"]).record();
    const a2 = commit(join(project.dir, "wt-a"), { "package.json": "{}\n" });
    run(["a"]).record();
    const p = integrationPaths(project.root, config(), "m3");
    const stored = readIntegration(p);
    // What the append-only code wrote: a second entry for a.
    writeFileSync(p.integration, JSON.stringify({
      ...stored,
      merged: [{ ...first.merged[0], sha: a1 }, first.merged[1], { lane: "a", branch: "arbab/a", sha: a2, manifests: ["package.json"] }],
    }));
    expect(run(["a", "c"]).record().merged).toEqual([
      { lane: "a", branch: "arbab/a", sha: a2, manifests: ["package.json"] },
      { lane: "c", branch: "arbab/c", sha: c, manifests: [] },
    ]);
  });

  it("records a lane its branch already holds, with what its own commits changed, and says so", () => {
    // b is built on a: merging b brings a in.
    const a = lane("a", { "a.txt": "a\n", "package.json": "{}\n" });
    const b = lane("b", { "b.txt": "b\n" }, false, "arbab/a");
    run(["b"]).record();
    const r = run(["a", "b"]);
    const { record: rec, alreadyIn } = r.result();
    expect(merges(r.calls)).toEqual([]);
    expect(alreadyIn).toEqual(["a", "b"]);
    expect(rec.merged).toEqual([
      { lane: "b", branch: "arbab/b", sha: b, manifests: ["package.json"] },
      { lane: "a", branch: "arbab/a", sha: a, manifests: ["package.json"] },
    ]);

    // In one call too: a lane listed after the lane that contains it.
    const c = lane("c", { "c.txt": "c\n" });
    const d = lane("d", { "d.txt": "d\n" }, false, "arbab/c");
    const both = run(["d", "c"]).result();
    expect(both.alreadyIn).toEqual(["c"]);
    expect(both.record.merged.slice(-2)).toEqual([
      { lane: "d", branch: "arbab/d", sha: d, manifests: [] },
      { lane: "c", branch: "arbab/c", sha: c, manifests: [] },
    ]);
  });

  it("aborts a conflicting merge, keeps and records the lanes before it, and names the lane and the paths", () => {
    const a = lane("a", { "shared.txt": "from a\n", "a.txt": "a\n" });
    lane("c", { "shared.txt": "from c\n" });
    lane("e", { "e.txt": "e\n" });
    const r = run(["a", "c", "e"]);
    const err = caught(r.record);
    expect(err.code).toBe("git");
    expect(err.message).toBe("integrating c into integrate/m3 conflicts in shared.txt; the merge was aborted; a stay merged");

    const p = integrationPaths(project.root, config(), "m3");
    expect(git(["log", "--format=%s", "-1"], p.worktree).trim()).toBe("arbab: integrate a into integrate/m3");
    expect(git(["status", "--porcelain"], p.worktree)).toBe("");
    expect(project.git(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"], p.worktree).code).not.toBe(0);
    expect(r.calls).toContainEqual(expect.arrayContaining(["merge", "--abort"]));
    const rec = readIntegration(p);
    expect(rec?.merged).toEqual([{ lane: "a", branch: "arbab/a", sha: a, manifests: [] }]);
    expect(rec?.headSha).toBe(git(["rev-parse", "HEAD"], p.worktree).trim());
    // e came after the conflict and was not merged.
    expect(existsSync(join(p.worktree, "e.txt"))).toBe(false);
  });

  it("reports a merge that fails without conflicts with git's output", () => {
    lane("a", { "a.txt": "a\n" });
    run([]).record();
    const p = integrationPaths(project.root, config(), "m3");
    // An untracked file the merge would overwrite: git refuses before merging anything.
    writeFileSync(join(p.worktree, "a.txt"), "local\n");
    expect(caught(run(["a"]).record).message).toMatch(/^integrating a into integrate\/m3 failed \(\d+\): .*a\.txt.*the merge was aborted$/s);
  });

  it("merges and flags a lane that changes dependency manifests; confirmDeps confirms them at the current head", () => {
    lane("a", { "a.txt": "a\n" });
    lane("m", { "package.json": "{}\n", "pkgs/x/.npmrc": "registry=x\n", "pkgs/x/notes.txt": "fine\n" });
    lane("b", { "b.txt": "b\n" });
    const r = run(["a", "m", "b"]);
    const rec = r.record();
    expect(r.deps).toHaveLength(1);
    expect(rec.merged.map((m) => [m.lane, m.manifests])).toEqual([
      ["a", []],
      ["m", ["package.json", "pkgs/x/.npmrc"]],
      // b is based on main without m's manifests, but it changes none itself.
      ["b", []],
    ]);
    expect(rec.manifests).toEqual(["package.json", "pkgs/x/.npmrc"]);
    expect(rec.depsConfirmedAt).toBeNull();
    expect(rec.depsConfirmed).toBe(false);
    const p = integrationPaths(project.root, config(), "m3");
    expect(existsSync(join(p.worktree, "package.json"))).toBe(true);

    const later: Clock = { now: () => Date.parse("2026-10-10T08:00:00.000Z") };
    const confirmed = confirmDeps(p, rec.headSha, project.git, later);
    expect(confirmed).toEqual({ ...rec, depsConfirmedAt: rec.headSha, depsConfirmed: true, updatedAt: "2026-10-10T08:00:00.000Z" });
    expect(readIntegration(p)).toEqual(confirmed);

    // Still confirmed, at the same head, for the same manifest changes: a call that merges nothing or merges no
    // manifest keeps it.
    expect(run(["a", "m", "b"]).record()).toMatchObject({ depsConfirmedAt: rec.headSha, depsConfirmed: true });
    lane("n", { "n.txt": "n\n" });
    expect(run(["n"]).record()).toMatchObject({ depsConfirmedAt: rec.headSha, depsConfirmed: true });
    // A new manifest change needs a new confirmation.
    lane("y", { "web/pnpm-lock.yaml": "x\n" });
    const flagged = run(["y"]).record();
    expect(flagged.merged.at(-1)?.manifests).toEqual(["web/pnpm-lock.yaml"]);
    expect(flagged.manifests).toEqual(["package.json", "pkgs/x/.npmrc", "web/pnpm-lock.yaml"]);
    expect(flagged).toMatchObject({ depsConfirmedAt: null, depsConfirmed: false });
  });

  it("flags a manifest a hand commit in the integration worktree changed, and drops a confirmation it outdates", () => {
    lane("m", { "package.json": "{}\n" });
    const listed = run(["m"]).record();
    const p = integrationPaths(project.root, config(), "m3");
    const confirmed = confirmDeps(p, listed.headSha, project.git, clock);
    expect(confirmed.depsConfirmed).toBe(true);

    // A commit that changes no manifest keeps the confirmation.
    commit(p.worktree, { "fix.txt": "by hand\n" });
    expect(run([]).record()).toMatchObject({ manifests: ["package.json"], depsConfirmedAt: confirmed.headSha, depsConfirmed: true });

    // One that does (a conflict resolved by hand, say) needs a new one, though no lane's entry names the file.
    const hand = commit(p.worktree, { "web/package.json": "{}\n" });
    const rec = run([]).record();
    expect(rec).toMatchObject({ headSha: hand, manifests: ["package.json", "web/package.json"], depsConfirmedAt: null, depsConfirmed: false });
    expect(rec.merged.flatMap((m) => m.manifests)).toEqual(["package.json"]);
  });

  it("flags a manifest from a hand commit on a branch with no lane-merged manifest", () => {
    lane("a", { "a.txt": "a\n" });
    run(["a"]).record();
    const p = integrationPaths(project.root, config(), "m3");
    commit(p.worktree, { "package.json": "{}\n" });
    expect(run(["a"]).record()).toMatchObject({ manifests: ["package.json"], depsConfirmedAt: null, depsConfirmed: false });
  });

  it("still flags the manifests of a merge whose record was lost", () => {
    lane("m", { "package.json": "{}\n" });
    const listed = run(["m"]).record();
    const p = integrationPaths(project.root, config(), "m3");
    confirmDeps(p, listed.headSha, project.git, clock);
    // The records directory deleted (or the process died between the merge and the record).
    rmSync(p.dir, { recursive: true });
    lane("n", { "n.txt": "n\n" });
    const rec = run(["n"]).record();
    expect(rec.merged.map((m) => m.lane)).toEqual(["n"]);
    expect(rec).toMatchObject({ manifests: ["package.json"], depsConfirmedAt: null, depsConfirmed: false });
  });

  it("refuses a lane whose worktree has uncommitted changes before merging anything, naming up to five paths", () => {
    lane("a", { "a.txt": "a\n" });
    lane("c", { "c.txt": "c\n" });
    const root = join(project.root, ".arbab", "worktrees");
    mkdirSync(root, { recursive: true });
    const wc = join(root, "c");
    git(["worktree", "move", join(project.dir, "wt-c"), wc]);
    writeFileSync(join(wc, "c.txt"), "changed\n");
    for (const n of [1, 2, 3, 4, 5]) writeFileSync(join(wc, `new${n}.txt`), "x\n");

    const r = run(["a", "c"]);
    const err = caught(r.record);
    expect(err.code).toBe("usage");
    expect(err.message).toBe(
      `lane c has uncommitted changes in ${wc} (c.txt, new1.txt, new2.txt, new3.txt, new4.txt and 1 more): its checkpoint did ` +
        "not commit them, and integrating its branch would leave them behind. Commit or discard them, then integrate again",
    );
    expect(merges(r.calls)).toEqual([]);
    expect(r.deps).toEqual([]);
    const p = integrationPaths(project.root, config(), "m3");
    expect(existsSync(p.worktree)).toBe(false);
    // git was pointed at the verified git dir, without hooks.
    const status = r.calls.find((args) => args.includes("status"));
    expect(status).toEqual(expect.arrayContaining([`--work-tree=${wc}`, ...untrustedTree(), "--porcelain", "--ignore-submodules=all"]));
    expect(status?.some((a) => a.startsWith("--git-dir="))).toBe(true);

    // Committed: integrated.
    git(["add", "-A"], wc);
    git(["commit", "-q", "-m", "checkpoint"], wc);
    expect(run(["a", "c"]).record().merged.map((m) => m.lane)).toEqual(["a", "c"]);
  });

  it("refuses a lane worktree holding a staged nested repository without descending into it", () => {
    lane("c", { "c.txt": "c\n" });
    const root = join(project.root, ".arbab", "worktrees");
    mkdirSync(root, { recursive: true });
    const wc = join(root, "c");
    git(["worktree", "move", join(project.dir, "wt-c"), wc]);
    const nested = plantNestedRepo(project.git, wc, "sub", project.dir);
    git(["add", "-A"], wc);
    nested.reset();

    const r = run(["c"]);
    expect(caught(r.record).message).toMatch(new RegExp(`^lane c has uncommitted changes in ${wc} \\(sub/\\)`));
    expect(merges(r.calls)).toEqual([]);
    expect(r.calls.find((args) => args.includes("status"))).toEqual(
      expect.arrayContaining([...untrustedTree(), "--porcelain", "--ignore-submodules=all"]),
    );
    expect(nested.ran()).toBe("");
    // The status the check used to run executes the worker's commands.
    git(["status", "--porcelain"], wc);
    expect(nested.ran()).toMatch(/clean/);
  });

  it("refuses a lane worktree it cannot verify is on the lane's branch", () => {
    lane("a", { "a.txt": "a\n" });
    const wa = join(project.root, ".arbab", "worktrees", "a");
    git(["worktree", "add", "-b", "elsewhere", wa, "main"]);
    const r = run(["a"]);
    expect(caught(r.record).message).toMatch(/^cannot check lane a's worktree .* for uncommitted changes: HEAD of .* is "ref: refs\/heads\/elsewhere"/);
    expect(merges(r.calls)).toEqual([]);
  });

  it("runs no hook a lane brings under a relative core.hooksPath, while a plain merge would", () => {
    const marker = join(project.dir, "hook-ran");
    const hook = (name: string): string => `#!/bin/sh\necho ${name} >> '${marker}'\n`;
    lane("a", {
      ".husky/pre-merge-commit": hook("pre-merge-commit"),
      ".husky/prepare-commit-msg": hook("prepare-commit-msg"),
      ".husky/commit-msg": hook("commit-msg"),
      ".husky/post-merge": hook("post-merge"),
    }, true);
    lane("c", { "c.txt": "c\n" });
    lane("control", { "control.txt": "control\n" });
    git(["config", "core.hooksPath", ".husky"]);

    const r = run(["a", "c"]);
    expect(r.record().merged.map((m) => m.lane)).toEqual(["a", "c"]);
    const p = integrationPaths(project.root, config(), "m3");
    expect(existsSync(join(p.worktree, ".husky", "post-merge"))).toBe(true);
    expect(existsSync(marker)).toBe(false);
    expect(merges(r.calls)[0]).toEqual(expect.arrayContaining([...untrustedTree(), "--no-verify"]));

    git(["merge", "--no-ff", "--no-edit", "arbab/control"], p.worktree);
    expect(existsSync(marker)).toBe(true);
  });

  it("refuses an integration whose worktree path is a lane's worktree, before creating or merging anything", () => {
    lane("a", { "a.txt": "a\n" });
    const p = integrationPaths(project.root, config(), "m3");
    // A lane named integrate-m3 (from before the name was reserved) has its worktree where the integration's goes.
    git(["worktree", "add", "-b", "arbab/integrate-m3", p.worktree, "main"]);
    const r = run(["a"]);
    const err = caught(r.record);
    expect(err.code).toBe("usage");
    expect(err.message).toContain(`${p.worktree} is the worktree of lane integrate-m3, where a worker runs`);
    expect(err.message).toContain("Lane names starting with integrate- are reserved");
    expect(r.calls.some((args) => args.includes("add") || args.includes("merge"))).toBe(false);
    expect(r.deps).toEqual([]);
    expect(readIntegration(p)).toBeNull();
  });

  it("refuses a worktree path that is not a worktree of this repository on the integration branch", () => {
    lane("a", { "a.txt": "a\n" });
    const p = integrationPaths(project.root, config(), "m3");
    mkdirSync(p.worktree, { recursive: true });
    const r = run(["a"]);
    const err = caught(r.record);
    expect(err.code).toBe("git");
    expect(err.message).toContain(`${p.worktree} exists but is not a worktree of this repository on integrate/m3`);
    expect(r.calls.some((args) => args.includes("add") || args.includes("merge"))).toBe(false);
    expect(r.deps).toEqual([]);
  });

  it("refuses a worktree at the path that is on another branch", () => {
    const p = integrationPaths(project.root, config(), "m3");
    git(["worktree", "add", "-b", "other", p.worktree, "main"]);
    expect(caught(run([]).record).message).toMatch(/is not a worktree of this repository on integrate\/m3: it is on refs\/heads\/other/);
  });

  it("refuses an invalid integration or lane name before running anything", () => {
    for (const [name, lanes] of [["Bad", ["a"]], ["m3", ["-x"]], ["m3", ["a/b"]]] as const) {
      const r = run([...lanes], { name });
      expect(caught(r.record).code).toBe("usage");
      expect(r.calls).toEqual([]);
    }
  });

  it("fails on a lane without a branch, naming it", () => {
    const err = caught(run(["nope"]).record);
    expect(err).toMatchObject({ code: "git", message: "cannot integrate nope: branch arbab/nope does not exist" });
  });

  it("throws the tail of a failed dependency command and removes the worktree so the next call prepares it again", () => {
    lane("a", { "a.txt": "a\n" });
    const lines = Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join("\n");
    const failing = run(["a"], { deps: () => ({ code: 3, output: `${lines}\n` }) });
    const err = caught(failing.record);
    expect(err.code).toBe("runtime");
    expect(err.message).toMatch(/dependencies failed in .* \(3\): line 4\nline 5\nline 6\nline 7\nline 8$/);
    expect(merges(failing.calls)).toEqual([]);
    const p = integrationPaths(project.root, config(), "m3");
    expect(existsSync(p.worktree)).toBe(false);

    // The branch is still at the base, so it is attached and prepared again.
    const r = run(["a"]);
    expect(r.record().merged.map((m) => m.lane)).toEqual(["a"]);
    expect(r.calls).toContainEqual(["worktree", "add", p.worktree, "integrate/m3"]);
    expect(r.deps).toHaveLength(1);
  });

  it("refuses to recreate the worktree on a branch that already holds merges", () => {
    lane("a", { "a.txt": "a\n" });
    run(["a"]).record();
    const p = integrationPaths(project.root, config(), "m3");
    git(["worktree", "remove", "--force", p.worktree]);
    const r = run(["a"]);
    expect(caught(r.record).message).toMatch(/integrate\/m3 exists without its worktree and holds commits that are not on main/);
    expect(r.deps).toEqual([]);
  });

  it("runs no dependency command for strategy none", () => {
    lane("a", { "a.txt": "a\n" });
    const r = run(["a"], { cfg: config() });
    expect(r.record().merged).toHaveLength(1);
    expect(r.deps).toEqual([]);
  });

  it("drops recorded lanes the branch no longer holds", () => {
    lane("a", { "a.txt": "a\n" });
    run(["a"]).record();
    const p = integrationPaths(project.root, config(), "m3");
    git(["worktree", "remove", "--force", p.worktree]);
    git(["branch", "-D", "integrate/m3"]);
    lane("c", { "c.txt": "c\n" });
    expect(run(["c"]).record().merged.map((m) => m.lane)).toEqual(["c"]);
  });

  it("starts a new record on a branch it creates, moving the old one aside, never over an earlier one", () => {
    const p = integrationPaths(project.root, config(), "m3");
    lane("a", { "package.json": "{}\n" });
    const listed = run(["a"]).record();
    const old = confirmDeps(p, listed.headSha, project.git, clock);
    git(["worktree", "remove", "--force", p.worktree]);
    git(["branch", "-D", "integrate/m3"]);
    // main moves on: the old base is an ancestor of the new branch, but no longer its base.
    writeFileSync(join(project.root, "main.txt"), "moved\n");
    git(["add", "--", "main.txt"]);
    git(["commit", "-q", "-m", "main moves on"]);
    const main = git(["rev-parse", "main"]).trim();

    const r = run([]);
    const rec = r.record();
    expect(rec).toMatchObject({ baseSha: main, merged: [], manifests: [], depsConfirmedAt: null, depsConfirmed: true, headSha: main });
    const aside = join(p.dir, "integration.superseded-2026-10-09T12-00-00.000Z.json");
    expect(JSON.parse(readFileSync(aside, "utf8"))).toEqual(old);
    // The dependencies ran on the new branch, before any merge.
    expect(r.deps).toHaveLength(1);

    // Each new branch moves its predecessor aside under a name of its own.
    git(["worktree", "remove", "--force", p.worktree]);
    git(["branch", "-D", "integrate/m3"]);
    lane("c", { "c.txt": "c\n" });
    expect(run(["c"]).record().merged.map((m) => m.lane)).toEqual(["c"]);
    expect(JSON.parse(readFileSync(aside, "utf8"))).toEqual(old);
    expect(JSON.parse(readFileSync(join(p.dir, "integration.superseded-2026-10-09T12-00-00.000Z-2.json"), "utf8"))).toEqual(rec);
  });

  it("moves aside a record it cannot read when it creates the branch", () => {
    const p = integrationPaths(project.root, config(), "m3");
    mkdirSync(p.dir, { recursive: true });
    writeFileSync(p.integration, "not json");
    expect(run([]).record().merged).toEqual([]);
    expect(readFileSync(join(p.dir, "integration.superseded-unknown.json"), "utf8")).toBe("not json");
  });

  it("keeps the record when the branch exists and only its worktree is made again", () => {
    const p = integrationPaths(project.root, config(), "m3");
    const first = run([]).record();
    git(["worktree", "remove", "--force", p.worktree]);
    expect(run([]).record()).toEqual(first);
    expect(existsSync(join(p.dir, "integration.superseded-unknown.json"))).toBe(false);
    expect(existsSync(join(p.dir, "integration.superseded-2026-10-09T12-00-00.000Z.json"))).toBe(false);
  });

  it("refuses a landed integration, naming the landing time, before touching git", () => {
    lane("a", { "a.txt": "a\n" });
    run(["a"]).record();
    const p = integrationPaths(project.root, config(), "m3");
    writeFileSync(p.landing, JSON.stringify({ name: "m3", into: "main", integrationHead: "x", mergeSha: "y", landedAt: "2026-10-09T13:00:00.000Z", pushed: false }));
    git(["worktree", "remove", "--force", p.worktree]);
    git(["branch", "-D", "integrate/m3"]);
    const before = readFileSync(p.integration, "utf8");

    const r = run(["a"]);
    expect(caught(r.record)).toMatchObject({
      code: "usage",
      message: expect.stringMatching(/^integration m3 landed at 2026-10-09T13:00:00\.000Z; .*Choose a new name/),
    });
    expect(r.calls).toEqual([]);
    expect(readFileSync(p.integration, "utf8")).toBe(before);
    expect(git(["branch", "--list", "integrate/m3"])).toBe("");

    // A landing.json that does not say when still refuses.
    writeFileSync(p.landing, "{");
    expect(caught(run(["a"]).record).message).toMatch(/^integration m3 landed \(.*landing\.json does not say when\)/);
  });

  it("refuses --deps-installed on a landed integration with the landing, not a missing branch", () => {
    lane("m", { "package.json": "{}\n" });
    const listed = run(["m"]).record();
    const p = integrationPaths(project.root, config(), "m3");
    writeFileSync(p.landing, JSON.stringify({ name: "m3", into: "main", integrationHead: "x", mergeSha: "y", landedAt: "2026-10-09T13:00:00.000Z", pushed: false }));
    git(["worktree", "remove", "--force", p.worktree]);
    git(["branch", "-D", "integrate/m3"]);
    expect(caught(() => confirmDeps(p, listed.headSha, project.git, clock))).toMatchObject({
      code: "usage",
      message: expect.stringMatching(/^integration m3 landed at 2026-10-09T13:00:00\.000Z; /),
    });
  });
});

describe("integrate's base", () => {
  it("keeps the base branch the integration was built against when config.baseBranch changes", () => {
    lane("a", { "a.txt": "a\n" });
    const first = run(["a"]).record();
    expect(first.base).toBe("main");
    git(["branch", "release", "main"]);
    lane("b", { "b.txt": "b\n" });
    const second = run(["b"], { cfg: config({ baseBranch: "release" }) }).record();
    expect(second).toMatchObject({ base: "main", baseSha: first.baseSha });
  });

  it("moves baseSha with the base once it is merged in, so the base's own manifest changes are not flagged", () => {
    lane("a", { "a.txt": "a\n" });
    const first = run(["a"]).record();
    // The base moves on with a dependency change of its own.
    writeFileSync(join(project.root, "package.json"), "{}\n");
    git(["add", "--", "package.json"]);
    git(["commit", "-q", "-m", "main changes its dependencies"]);
    const main = git(["rev-parse", "main"]).trim();
    expect(main).not.toBe(first.baseSha);

    // Before the base is merged in, nothing changes.
    expect(run(["a"]).record()).toMatchObject({ baseSha: first.baseSha, manifests: [] });

    // As land advises: the human merges the moved base (here through a lane built on it) and integrates again.
    const c = lane("c", { "c.txt": "c\n" });
    const p = integrationPaths(project.root, config(), "m3");
    git(["merge", "--no-ff", "--no-edit", "arbab/c"], p.worktree);
    const { record: rec, alreadyIn } = run(["a", "c"]).result();
    expect(alreadyIn).toEqual(["a", "c"]);
    expect(rec).toMatchObject({ base: "main", baseSha: main, manifests: [], depsConfirmed: true });
    expect(rec.merged.find((m) => m.lane === "c")).toEqual({ lane: "c", branch: "arbab/c", sha: c, manifests: [] });
  });
});

describe("integrate's merged entries", () => {
  it("drops an entry whose commit git no longer has instead of failing", () => {
    lane("a", { "a.txt": "a\n" });
    run(["a"]).record();
    const p = integrationPaths(project.root, config(), "m3");
    const rec = JSON.parse(readFileSync(p.integration, "utf8")) as IntegrationRecord;
    writeFileSync(p.integration, JSON.stringify({ ...rec, merged: [...rec.merged, { lane: "gone", branch: "arbab/gone", sha: "f".repeat(40), manifests: [] }] }));
    lane("b", { "b.txt": "b\n" });
    expect(run(["b"]).record().merged.map((m) => m.lane)).toEqual(["a", "b"]);
  });
});

describe("integrate's baseSha", () => {
  it("follows the base when a lane in the same run brings newer base commits", () => {
    lane("a", { "a.txt": "a\n" });
    const first = run(["a"]).record();
    // main moves on, and lane b starts from the new main.
    writeFileSync(join(project.root, "main.txt"), "newer\n");
    git(["add", "--", "main.txt"]);
    git(["commit", "-q", "-m", "main moves on"]);
    const newer = git(["rev-parse", "main"]).trim();
    expect(first.baseSha).not.toBe(newer);
    lane("b", { "b.txt": "b\n" });
    expect(run(["b"]).record().baseSha).toBe(newer);
  });
});

describe("listIntegrations", () => {
  it("lists the integrations with a records directory, sorted, skipping invalid names and files", () => {
    expect(listIntegrations(project.root)).toEqual([]);
    for (const name of ["m3", "a1"]) mkdirSync(integrationPaths(project.root, config(), name).dir, { recursive: true });
    const dir = join(project.root, ".arbab", "integrations");
    mkdirSync(join(dir, "Not-Valid"));
    writeFileSync(join(dir, "m9"), "a file, not an integration\n");
    expect(listIntegrations(project.root)).toEqual(["a1", "m3"]);
  });
});

describe("readIntegration", () => {
  it("returns null before the first integration and refuses a file of another shape", () => {
    const p = integrationPaths(project.root, config(), "m3");
    expect(readIntegration(p)).toBeNull();
    mkdirSync(p.dir, { recursive: true });
    writeFileSync(p.integration, JSON.stringify({ name: "m3", merged: "no" }));
    expect(caught(() => readIntegration(p))).toMatchObject({ code: "io" });
    writeFileSync(p.integration, "{");
    expect(caught(() => readIntegration(p))).toMatchObject({ code: "io" });
  });

  const stored = {
    name: "m3",
    branch: "integrate/m3",
    worktree: "/w/integrate-m3",
    base: "main",
    baseSha: "b".repeat(40),
    merged: [
      { lane: "a", branch: "arbab/a", sha: "a".repeat(40), manifests: ["package.json"] },
      { lane: "c", branch: "arbab/c", sha: "c".repeat(40), manifests: [".npmrc", "package.json"] },
    ],
    headSha: "d".repeat(40),
    updatedAt: "2026-10-09T12:00:00.000Z",
  };

  it("reads a record from before manifests and depsConfirmedAt as its lanes' manifests, with no confirmation on file", () => {
    const p = integrationPaths(project.root, config(), "m3");
    mkdirSync(p.dir, { recursive: true });
    writeFileSync(p.integration, JSON.stringify({ ...stored, depsConfirmed: true }));
    expect(readIntegration(p)).toEqual({ ...stored, manifests: [".npmrc", "package.json"], depsConfirmedAt: null, depsConfirmed: false });
    writeFileSync(p.integration, JSON.stringify({ ...stored, merged: [], depsConfirmed: false }));
    expect(readIntegration(p)).toMatchObject({ manifests: [], depsConfirmedAt: null, depsConfirmed: true });
  });

  it("derives depsConfirmed from manifests and depsConfirmedAt, and refuses a depsConfirmedAt that is not a sha", () => {
    const p = integrationPaths(project.root, config(), "m3");
    mkdirSync(p.dir, { recursive: true });
    const at = "d".repeat(40);
    writeFileSync(p.integration, JSON.stringify({ ...stored, manifests: ["package.json"], depsConfirmedAt: at, depsConfirmed: false }));
    expect(readIntegration(p)).toMatchObject({ manifests: ["package.json"], depsConfirmedAt: at, depsConfirmed: true });
    for (const bad of ["main", 1, ["x"]]) {
      writeFileSync(p.integration, JSON.stringify({ ...stored, manifests: [], depsConfirmedAt: bad, depsConfirmed: true }));
      expect(caught(() => readIntegration(p)), JSON.stringify(bad)).toMatchObject({ code: "io" });
    }
    writeFileSync(p.integration, JSON.stringify({ ...stored, manifests: "package.json", depsConfirmedAt: null, depsConfirmed: true }));
    expect(caught(() => readIntegration(p))).toMatchObject({ code: "io" });
  });
});

describe("confirmDeps", () => {
  const later: Clock = { now: () => Date.parse("2026-10-10T08:00:00.000Z") };

  it("refuses an integration that does not exist", () => {
    const p = integrationPaths(project.root, config(), "m3");
    expect(caught(() => confirmDeps(p, "a".repeat(40), project.git, clock))).toMatchObject({ code: "usage" });
  });

  it("refuses when the branch moved past the head whose manifests were listed, and confirms nothing", () => {
    lane("m", { "package.json": "{}\n" });
    const rec = run(["m"]).record();
    const p = integrationPaths(project.root, config(), "m3");
    const moved = commit(p.worktree, { "fix.txt": "by hand\n" });
    const err = caught(() => confirmDeps(p, rec.headSha, project.git, later));
    expect(err.code).toBe("usage");
    expect(err.message).toBe(
      `integrate/m3 is at ${moved}, not ${rec.headSha}, the head whose manifests arbab integrate listed; run arbab ` +
        "integrate m3 with its lanes again, review the manifests it lists, then run the arbab integrate m3 " +
        "--deps-installed <sha> it prints",
    );
    expect(readIntegration(p)).toEqual(rec);

    // Integrated again, the new head is the one confirmed.
    run(["m"]).record();
    expect(confirmDeps(p, moved, project.git, later)).toMatchObject({ headSha: moved, depsConfirmedAt: moved, depsConfirmed: true });
  });

  it("refuses a head other than the recorded one, as after a concurrent integrate, and confirms nothing", () => {
    lane("m", { "package.json": "{}\n" });
    const reviewed = run(["m"]).record();
    const p = integrationPaths(project.root, config(), "m3");
    // Another integrate merges a lane between the human's review and the confirmation.
    lane("n", { ".npmrc": "x\n" });
    const now = run(["n"]).record();
    expect(now.headSha).not.toBe(reviewed.headSha);
    const err = caught(() => confirmDeps(p, reviewed.headSha, project.git, later));
    expect(err.code).toBe("usage");
    expect(err.message).toBe(
      `integration m3 records head ${now.headSha}, not ${reviewed.headSha}: it moved since you reviewed it. Review the ` +
        `manifests arbab integrate m3 lists for ${now.headSha} (run it again with its lanes), then run arbab integrate ` +
        `m3 --deps-installed ${now.headSha}`,
    );
    expect(readIntegration(p)).toEqual(now);
    expect(confirmDeps(p, now.headSha, project.git, later)).toMatchObject({ depsConfirmedAt: now.headSha, depsConfirmed: true });
  });

  it("refuses a sha that is not a full commit id, naming the recorded head", () => {
    lane("m", { "package.json": "{}\n" });
    const rec = run(["m"]).record();
    const p = integrationPaths(project.root, config(), "m3");
    for (const bad of [rec.headSha.slice(0, 12), "HEAD", "", rec.headSha.toUpperCase()]) {
      const err = caught(() => confirmDeps(p, bad, project.git, later));
      expect(err.code, bad).toBe("usage");
      expect(err.message).toContain(`then run arbab integrate m3 --deps-installed ${rec.headSha}`);
    }
    expect(readIntegration(p)).toEqual(rec);
  });

  it("changes nothing when no manifest changed", () => {
    lane("a", { "a.txt": "a\n" });
    const rec = run(["a"]).record();
    const p = integrationPaths(project.root, config(), "m3");
    expect(confirmDeps(p, rec.headSha, project.git, later)).toEqual(rec);
    expect(readIntegration(p)).toEqual(rec);
  });
});
