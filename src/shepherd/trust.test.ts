import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeProject, mustGit, type TestProject } from "../../test/fake-claude/harness";
import type { GitRunner } from "../run";
import { confirmedHeads, installPlan, isTrustedInstallPoint, resolveCommit, type TrustInput } from "./trust";

let project: TestProject;
beforeEach(() => {
  project = makeProject();
});
afterEach(() => {
  project.cleanup();
});

const git = (args: string[], cwd = project.root): string => mustGit(project.git, args, cwd);
const config = { worktreeRoot: ".arbab/worktrees" };

/** A branch off `from` with one commit writing `file`; the root stays on main. */
function branch(name: string, file: string, from = "main"): string {
  git(["checkout", "-q", "-b", name, from]);
  writeFileSync(join(project.root, file), `${name}\n`);
  git(["add", "--", file]);
  git(["commit", "-q", "-m", `${name} writes ${file}`]);
  const sha = git(["rev-parse", "HEAD"]).trim();
  git(["checkout", "-q", "main"]);
  return sha;
}

function writeRecord(name: string, record: Record<string, unknown>): void {
  const dir = join(project.root, ".arbab", "integrations", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "integration.json"), JSON.stringify(record));
}

function record(name: string, depsConfirmedAt: string | null): Record<string, unknown> {
  const main = git(["rev-parse", "main"]).trim();
  return {
    name,
    branch: `integrate/${name}`,
    worktree: join(project.root, ".arbab", "worktrees", `integrate-${name}`),
    base: "main",
    baseSha: main,
    merged: [],
    manifests: ["package.json"],
    depsConfirmedAt,
    depsConfirmed: depsConfirmedAt !== null,
    headSha: depsConfirmedAt ?? main,
    updatedAt: "2026-10-09T12:00:00.000Z",
  };
}

const input = (confirmed: string[] = [], runner: GitRunner = project.git): TrustInput => ({
  projectRoot: project.root,
  baseBranch: "main",
  confirmed: new Set(confirmed),
  git: runner,
});

describe("confirmedHeads", () => {
  it("collects the depsConfirmedAt of every integration, skipping unconfirmed, unreadable and reserved ones", () => {
    const a = branch("integrate/a", "a.txt");
    const b = branch("integrate/b", "b.txt");
    expect(confirmedHeads(project.root, config, project.git)).toEqual(new Set());
    writeRecord("a", record("a", a));
    writeRecord("b", record("b", b));
    writeRecord("c", record("c", null));
    writeRecord("d", { name: "d", depsConfirmedAt: a });
    writeRecord("integrate-x", record("integrate-x", a));
    // A record under another integration's name vouches for nothing.
    writeRecord("e", record("f", b));
    expect(confirmedHeads(project.root, config, project.git)).toEqual(new Set([a, b]));
  });

  it("trusts no record git tracks: one that came in through a merge from a branch a worker could write", () => {
    const a = branch("integrate/a", "a.txt");
    const b = branch("integrate/b", "b.txt");
    writeRecord("a", record("a", a));
    writeRecord("b", record("b", b));
    git(["add", "-f", "--", ".arbab/integrations/b/integration.json"]);
    git(["commit", "-q", "-m", "a planted record"]);
    expect(confirmedHeads(project.root, config, project.git)).toEqual(new Set([a]));
    // When git cannot list what it tracks, nothing is trusted.
    const failing: GitRunner = (args, cwd) => (args[0] === "ls-files" ? { code: 128, stdout: "", stderr: "fatal" } : project.git(args, cwd));
    expect(confirmedHeads(project.root, config, failing)).toEqual(new Set());
  });

  // Only where `.ARBAB/` and `.arbab/` are one directory, as on macOS's default disks.
  const caseInsensitive = ((): boolean => {
    const probe = mkdtempSync(join(tmpdir(), "arbab-Case-"));
    try {
      return existsSync(probe.toLowerCase()) && existsSync(probe.toUpperCase());
    } finally {
      rmSync(probe, { recursive: true, force: true });
    }
  })();
  it.skipIf(!caseInsensitive)("trusts no record git tracks under another case, which is the same file on this disk", () => {
    const a = branch("integrate/a", "a.txt");
    const b = branch("integrate/b", "b.txt");
    writeRecord("a", record("a", a));
    writeRecord("b", record("b", b));
    git(["add", "-f", "--", ".ARBAB/integrations/b/integration.json"]);
    git(["commit", "-q", "-m", "a planted record, by its other case"]);
    expect(confirmedHeads(project.root, config, project.git)).toEqual(new Set([a]));
  });
});

describe("resolveCommit", () => {
  it("resolves a revision to its commit, null when it names none, and refuses an option", () => {
    expect(resolveCommit(project.root, "main", project.git)).toBe(git(["rev-parse", "main"]).trim());
    expect(resolveCommit(project.root, "nope", project.git)).toBeNull();
    expect(() => resolveCommit(project.root, "--all", project.git)).toThrow(/not a valid revision/);
  });
});

describe("isTrustedInstallPoint", () => {
  it("trusts the base branch's commits and confirmed heads, nothing else", () => {
    const main = git(["rev-parse", "main"]).trim();
    const worker = branch("arbab/a", "a.txt");
    expect(isTrustedInstallPoint(main, input())).toBe(true);
    expect(isTrustedInstallPoint(worker, input())).toBe(false);
    expect(isTrustedInstallPoint(worker, input([worker]))).toBe(true);
    // A commit the base branch merged later is trusted.
    git(["merge", "-q", "--no-ff", "--no-edit", "arbab/a"]);
    expect(isTrustedInstallPoint(worker, input())).toBe(true);
  });

  it("reports a base branch git cannot compare with", () => {
    const main = git(["rev-parse", "main"]).trim();
    expect(() => isTrustedInstallPoint(main, { ...input(), baseBranch: "nope" })).toThrow(/merge-base --is-ancestor/);
    expect(() => isTrustedInstallPoint(main, { ...input(), baseBranch: "-x" })).toThrow(/not a valid revision/);
  });
});

describe("installPlan", () => {
  it("starts on a trusted base with nothing to merge", () => {
    const main = git(["rev-parse", "main"]).trim();
    expect(installPlan("main", input())).toEqual({ start: main, merge: null });
    const confirmed = branch("integrate/m3", "m3.txt");
    expect(installPlan("integrate/m3", input([confirmed]))).toEqual({ start: confirmed, merge: null });
  });

  it("starts a worker's base at its merge base with the base branch and merges it on top", () => {
    const fork = git(["rev-parse", "main"]).trim();
    const up = branch("arbab/up", "up.txt");
    const on = branch("arbab/on", "on.txt", "arbab/up");
    // The base branch moves on: the start is where the base left it.
    branch("later", "later.txt");
    git(["merge", "-q", "--ff-only", "later"]);
    expect(installPlan("arbab/up", input())).toEqual({ start: fork, merge: up });
    expect(installPlan("arbab/on", input())).toEqual({ start: fork, merge: on });
    expect(installPlan(up, input())).toEqual({ start: fork, merge: up });
  });

  it("starts on the newest confirmed head the base moved past, and merges the base on top", () => {
    const fork = git(["rev-parse", "main"]).trim();
    const older = branch("integrate/m3", "m3.txt");
    const newer = branch("integrate/m3-next", "next.txt", "integrate/m3");
    // Merges that changed no manifest, after the confirmation.
    const head = branch("integrate/m3-head", "fix.txt", "integrate/m3-next");
    // A confirmed head on another line of history is no ancestor of the base, and one git does not know vouches for nothing.
    const elsewhere = branch("integrate/other", "other.txt");
    const unknown = "e".repeat(40);
    expect(installPlan("integrate/m3-head", input([older]))).toEqual({ start: older, merge: head });
    expect(installPlan("integrate/m3-head", input([newer, older, elsewhere, unknown]))).toEqual({ start: newer, merge: head });
    expect(installPlan("integrate/m3-head", input([elsewhere, unknown]))).toEqual({ start: fork, merge: head });
  });

  it("prefers the base branch's merge base when it is newer than every confirmed ancestor", () => {
    const confirmed = branch("integrate/m3", "m3.txt");
    // The integration landed, and the base branch moved on.
    git(["merge", "-q", "--ff-only", "integrate/m3"]);
    branch("later", "later.txt");
    git(["merge", "-q", "--ff-only", "later"]);
    const fork = git(["rev-parse", "main"]).trim();
    const worker = branch("arbab/w", "w.txt");
    expect(installPlan("arbab/w", input([confirmed]))).toEqual({ start: fork, merge: worker });
  });

  it("starts on a confirmed ancestor of a base that shares no history with the base branch", () => {
    git(["checkout", "-q", "--orphan", "alien"]);
    git(["commit", "-q", "-m", "alien"]);
    const confirmed = git(["rev-parse", "HEAD"]).trim();
    git(["checkout", "-q", "-f", "main"]);
    const on = branch("arbab/on", "on.txt", "alien");
    expect(installPlan("arbab/on", input([confirmed]))).toEqual({ start: confirmed, merge: on });
  });

  it("leaves a base that names no commit to git worktree add", () => {
    expect(installPlan("nope", input())).toEqual({ start: "nope", merge: null });
  });

  it("refuses an option and a base with no history in common", () => {
    expect(() => installPlan("-x", input())).toThrow(/not a valid revision/);
    git(["checkout", "-q", "--orphan", "alien"]);
    git(["commit", "-q", "-m", "alien"]);
    git(["checkout", "-q", "-f", "main"]);
    expect(() => installPlan("alien", input())).toThrow(/^base alien shares no history with main/);
  });
});
