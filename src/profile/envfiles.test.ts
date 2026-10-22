import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { explicitGit, makeGitRunner, untrustedTree, verifyWorktreeGit, type GitRunner } from "../run";
import { envFileAllowReads } from "./envfiles";

let dir: string;
let root: string;
let worktree: string;
let gitCommonDir: string;
let git: GitRunner;
let emptyBlob: string;
const branch = "arbab/lane";

function ok(args: string[], cwd: string): string {
  const r = git(args, cwd);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function touch(base: string, rel: string): void {
  mkdirSync(dirname(join(base, rel)), { recursive: true });
  writeFileSync(join(base, rel), "");
}

// Tracks a path by its index entry alone: git never reads the file, which this sandbox may refuse for .env* names.
function track(base: string, rel: string): void {
  ok(["update-index", "--add", "--cacheinfo", `100644,${emptyBlob},${rel}`], base);
}

function allow(readable: string[], runner: GitRunner = git): string[] {
  return envFileAllowReads({ worktree, branch, gitCommonDir, readable, git: runner });
}

/** A runner that records each call and answers as git would: every requested literal path is tracked. */
function spy(calls: Array<{ args: string[]; cwd: string }>): GitRunner {
  return (args, cwd) => {
    calls.push({ args, cwd });
    const rels = args.filter((a) => a.startsWith(":(literal)")).map((a) => a.slice(":(literal)".length));
    return { code: 0, stdout: rels.map((r) => `${r}\0`).join(""), stderr: "" };
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arbab-envfiles-"));
  root = join(dir, "repo");
  worktree = join(root, ".arbab", "worktrees", "lane");
  gitCommonDir = join(root, ".git");
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"]) delete env[key];
  git = makeGitRunner({
    ...env,
    HOME: dir,
    XDG_CONFIG_HOME: dir,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(dir, "gitconfig"),
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  });
  ok(["init", "-q", "-b", "main", root], dir);
  writeFileSync(join(root, "empty"), "");
  emptyBlob = ok(["hash-object", "-w", "empty"], root).trim();
  ok(["add", "empty"], root);
  ok(["commit", "-q", "-m", "init"], root);
  ok(["worktree", "add", "-q", "-b", branch, worktree], root);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("envFileAllowReads", () => {
  it("holds exactly the listed files git tracks in the worktree that are regular files", () => {
    touch(worktree, ".env.example");
    track(worktree, ".env.example");
    touch(worktree, ".env.sample");
    const outside = join(dir, "outside");
    touch(outside, ".env");
    symlinkSync(join(outside, ".env"), join(worktree, ".env.template"));
    track(worktree, ".env.template");
    touch(worktree, ".env.local");
    track(worktree, ".env.local");

    expect(allow([".env.example", ".env.sample", ".env.template"])).toEqual([join(worktree, ".env.example")]);
  });

  it("asks git once for several listed files", () => {
    touch(worktree, ".env.example");
    track(worktree, ".env.example");
    touch(worktree, "apps/web/.env.sample");
    track(worktree, "apps/web/.env.sample");
    touch(worktree, ".env.dist");
    let count = 0;
    const counting: GitRunner = (args, cwd) => {
      count++;
      return git(args, cwd);
    };
    expect(allow([".env.example", "apps/web/.env.sample", ".env.dist"], counting)).toEqual([
      join(worktree, ".env.example"),
      join(worktree, "apps/web/.env.sample"),
    ]);
    expect(count).toBe(1);
  });

  it("re-opens nothing, and runs no git, when the worktree's .git file points at a git dir of the worker's own", () => {
    touch(worktree, ".env.example");
    track(worktree, ".env.example");
    // A git dir outside <gitCommonDir>/worktrees/ whose config runs a command when git reads the index.
    const evil = join(dir, "evil");
    ok(["init", "-q", "-b", branch, evil], dir);
    const marker = join(dir, "marker");
    const script = join(dir, "fsmonitor.sh");
    writeFileSync(script, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
    ok(["update-index", "--add", "--cacheinfo", `100644,${emptyBlob},.env.example`], evil);
    ok(["config", "core.fsmonitor", script], evil);
    writeFileSync(join(worktree, ".git"), `gitdir: ${join(evil, ".git")}\n`);

    const calls: Array<{ args: string[]; cwd: string }> = [];
    const recording: GitRunner = (args, cwd) => {
      calls.push({ args, cwd });
      return git(args, cwd);
    };
    expect(allow([".env.example"], recording)).toEqual([]);
    expect(calls).toEqual([]);
    expect(existsSync(marker)).toBe(false);
    // The control: a git that finds its repository through the .git file runs the command.
    git(["status", "--porcelain"], worktree);
    expect(existsSync(marker)).toBe(true);
  });

  it("re-opens nothing when the worktree is on another branch than the one given", () => {
    touch(worktree, ".env.example");
    track(worktree, ".env.example");
    const calls: Array<{ args: string[]; cwd: string }> = [];
    expect(envFileAllowReads({ worktree, branch: "arbab/other", gitCommonDir, readable: [".env.example"], git: spy(calls) })).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("leaves out a listed template tracked only in the main checkout", () => {
    touch(root, ".env.example");
    track(root, ".env.example");
    touch(worktree, ".env.example");
    expect(allow([".env.example"])).toEqual([]);
  });

  it("matches listed paths after normalising them, and lists each once", () => {
    touch(worktree, "apps/web/.env.sample");
    track(worktree, "apps/web/.env.sample");
    expect(allow(["./apps\\web/.env.sample", "apps/web/.env.sample"])).toEqual([join(worktree, "apps/web/.env.sample")]);
  });

  it("leaves out missing files, directories and files reached through a linked directory", () => {
    touch(worktree, ".env.d/x");
    const outside = join(dir, "outside");
    touch(outside, ".env.example");
    symlinkSync(outside, join(worktree, "linked"));
    const calls: Array<{ args: string[]; cwd: string }> = [];
    expect(allow([".env.missing", ".env.d", "linked/.env.example"], spy(calls))).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("leaves out a listed path that escapes the worktree", () => {
    touch(root, ".env.example");
    expect(allow(["../../../.env.example"], spy([]))).toEqual([]);
  });

  it("asks git about the listed paths literally, in the worktree, through the verified git dir with no worker config run", () => {
    touch(worktree, ".env.example");
    touch(worktree, ".env.[x]");
    const calls: Array<{ args: string[]; cwd: string }> = [];
    expect(allow([".env.example", ".env.[x]"], spy(calls))).toEqual([join(worktree, ".env.[x]"), join(worktree, ".env.example")]);
    const verified = verifyWorktreeGit({ worktree, branch, gitCommonDir });
    if (verified.gitDir === null) throw new Error(verified.error);
    expect(calls).toEqual([
      {
        args: [...explicitGit(verified.gitDir, worktree), ...untrustedTree(), "ls-files", "-z", "--", ":(literal).env.example", ":(literal).env.[x]"],
        cwd: worktree,
      },
    ]);
  });

  it("names the git dir and turns fsmonitor off in every git call it makes", () => {
    touch(worktree, ".env.example");
    track(worktree, ".env.example");
    const calls: Array<{ args: string[]; cwd: string }> = [];
    const recording: GitRunner = (args, cwd) => {
      calls.push({ args, cwd });
      return git(args, cwd);
    };
    allow([".env.example", ".env.missing"], recording);
    expect(calls.length).toBeGreaterThan(0);
    for (const { args } of calls) {
      expect(args.some((a) => a.startsWith("--git-dir="))).toBe(true);
      expect(args).toContain("core.fsmonitor=false");
    }
  });

  it("leaves out every listed file when git fails", () => {
    touch(worktree, ".env.example");
    const failing: GitRunner = () => ({ code: 128, stdout: "", stderr: "fatal" });
    expect(allow([".env.example"], failing)).toEqual([]);
  });

  it("returns nothing for a worktree that does not exist or an empty list", () => {
    expect(envFileAllowReads({ worktree: join(dir, "gone"), branch, gitCommonDir, readable: [".env.example"], git })).toEqual([]);
    expect(allow([])).toEqual([]);
  });
});
