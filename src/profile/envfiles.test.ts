import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeGitRunner, type GitRunner } from "../run";
import { envFileAllowReads } from "./envfiles";

let dir: string;
let root: string;
let worktree: string;
let git: GitRunner;
let emptyBlob: string;

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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arbab-envfiles-"));
  root = join(dir, "repo");
  worktree = join(root, ".arbab", "worktrees", "lane");
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
  ok(["worktree", "add", "-q", "-b", "arbab/lane", worktree], root);
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

    const readable = [".env.example", ".env.sample", ".env.template"];
    expect(envFileAllowReads({ worktree, readable, git })).toEqual([join(worktree, ".env.example")]);
  });

  it("leaves out a listed template tracked only in the main checkout", () => {
    touch(root, ".env.example");
    track(root, ".env.example");
    touch(worktree, ".env.example");
    expect(envFileAllowReads({ worktree, readable: [".env.example"], git })).toEqual([]);
  });

  it("matches listed paths after normalising them, and lists each once", () => {
    touch(worktree, "apps/web/.env.sample");
    track(worktree, "apps/web/.env.sample");
    const readable = ["./apps\\web/.env.sample", "apps/web/.env.sample"];
    expect(envFileAllowReads({ worktree, readable, git })).toEqual([join(worktree, "apps/web/.env.sample")]);
  });

  it("leaves out missing files, directories and files reached through a linked directory", () => {
    touch(worktree, ".env.d/x");
    const outside = join(dir, "outside");
    touch(outside, ".env.example");
    symlinkSync(outside, join(worktree, "linked"));
    const calls: string[][] = [];
    const spy: GitRunner = (args) => {
      calls.push(args);
      return { code: 0, stdout: "", stderr: "" };
    };
    expect(envFileAllowReads({ worktree, readable: [".env.missing", ".env.d", "linked/.env.example"], git: spy })).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("leaves out a listed path that escapes the worktree", () => {
    touch(root, ".env.example");
    const spy: GitRunner = () => ({ code: 0, stdout: "", stderr: "" });
    expect(envFileAllowReads({ worktree, readable: ["../../../.env.example"], git: spy })).toEqual([]);
  });

  it("asks git about the listed path literally, in the worktree", () => {
    touch(worktree, ".env.example");
    const calls: Array<{ args: string[]; cwd: string }> = [];
    const spy: GitRunner = (args, cwd) => {
      calls.push({ args, cwd });
      return { code: 0, stdout: "", stderr: "" };
    };
    expect(envFileAllowReads({ worktree, readable: [".env.example"], git: spy })).toEqual([join(worktree, ".env.example")]);
    expect(calls).toEqual([{ args: ["ls-files", "--error-unmatch", "--", ":(literal).env.example"], cwd: worktree }]);
  });

  it("leaves out a listed file when git fails", () => {
    touch(worktree, ".env.example");
    const failing: GitRunner = () => ({ code: 128, stdout: "", stderr: "fatal" });
    expect(envFileAllowReads({ worktree, readable: [".env.example"], git: failing })).toEqual([]);
  });

  it("returns nothing for a worktree that does not exist or an empty list", () => {
    expect(envFileAllowReads({ worktree: join(dir, "gone"), readable: [".env.example"], git })).toEqual([]);
    expect(envFileAllowReads({ worktree, readable: [], git })).toEqual([]);
  });
});
