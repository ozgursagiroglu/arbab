import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeGitRunner, type GitRunner } from "../run";
import { envFileDenies } from "./envfiles";

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

describe("envFileDenies", () => {
  it("lifts a listed tracked template and denies untracked, unlisted and skipped-tree files", () => {
    touch(worktree, ".env.example");
    track(worktree, ".env.example");
    touch(worktree, "apps/web/.env.sample");
    touch(worktree, ".env.local");
    touch(worktree, ".env.tracked");
    track(worktree, ".env.tracked");
    touch(worktree, "node_modules/pkg/.env");
    touch(worktree, ".arbab-tmp/inputs/.env");
    touch(worktree, "src/env.ts");
    touch(root, ".env");
    touch(root, ".env.example");
    track(root, ".env.example");

    const denied = envFileDenies({ projectRoot: root, worktree, readable: [".env.example", "apps/web/.env.sample"], git });
    expect(denied).toEqual([
      join(worktree, ".env.local"),
      join(worktree, ".env.tracked"),
      join(worktree, "apps/web/.env.sample"),
      join(root, ".env"),
    ].sort());
  });

  it("denies a listed template that is tracked only in the other tree", () => {
    touch(root, ".env.example");
    track(root, ".env.example");
    touch(worktree, ".env.example");
    expect(envFileDenies({ projectRoot: root, worktree, readable: [".env.example"], git })).toEqual([join(worktree, ".env.example")]);
  });

  it("matches listed paths after normalising them", () => {
    touch(worktree, "apps/web/.env.sample");
    track(worktree, "apps/web/.env.sample");
    expect(envFileDenies({ projectRoot: root, worktree, readable: ["./apps\\web/.env.sample"], git })).toEqual([]);
  });

  it("walks six directories down and no further", () => {
    touch(worktree, "a/b/c/d/e/f/.env");
    touch(worktree, "a/b/c/d/e/f/g/.env");
    expect(envFileDenies({ projectRoot: root, worktree, readable: [".env.example"], git })).toEqual([join(worktree, "a/b/c/d/e/f/.env")]);
  });

  it("denies a link named .env* even when listed and tracked, and never follows a linked directory", () => {
    const outside = join(dir, "outside");
    touch(outside, ".env");
    symlinkSync(join(outside, ".env"), join(worktree, ".env.example"));
    track(worktree, ".env.example");
    symlinkSync(outside, join(worktree, "linked"));
    symlinkSync(outside, join(worktree, ".env.dir"));
    expect(envFileDenies({ projectRoot: root, worktree, readable: [".env.example"], git })).toEqual([
      join(worktree, ".env.dir"),
      `${join(worktree, ".env.dir")}/**`,
      join(worktree, ".env.example"),
      `${join(worktree, ".env.example")}/**`,
    ]);
  });

  it("denies a .env or .env.<x> directory whole, without walking into it", () => {
    touch(worktree, ".env/bin/activate");
    touch(worktree, ".env/.env.example");
    touch(worktree, "services/api/.env.d/secrets.json");
    touch(root, ".env.prod/.env");
    const calls: string[][] = [];
    const spy: GitRunner = (args, cwd) => {
      calls.push(args);
      return git(args, cwd);
    };
    expect(envFileDenies({ projectRoot: root, worktree, readable: [".env/.env.example", ".env.example"], git: spy })).toEqual([
      `${join(root, ".env.prod")}/**`,
      `${join(worktree, ".env")}/**`,
      `${join(worktree, "services/api/.env.d")}/**`,
    ].sort());
    expect(calls).toEqual([]);
  });

  it("finds a .env directory at the walk's depth limit", () => {
    touch(worktree, "a/b/c/d/e/f/.env/x");
    touch(worktree, "a/b/c/d/e/f/g/.env/x");
    expect(envFileDenies({ projectRoot: root, worktree, readable: [".env.example"], git })).toEqual([`${join(worktree, "a/b/c/d/e/f/.env")}/**`]);
  });

  it("asks git about the listed path literally, in the tree it was found in", () => {
    touch(worktree, ".env.example");
    const calls: Array<{ args: string[]; cwd: string }> = [];
    const spy: GitRunner = (args, cwd) => {
      calls.push({ args, cwd });
      return { code: 0, stdout: "", stderr: "" };
    };
    expect(envFileDenies({ projectRoot: root, worktree, readable: [".env.example"], git: spy })).toEqual([]);
    expect(calls).toEqual([{ args: ["ls-files", "--error-unmatch", "--", ":(literal).env.example"], cwd: worktree }]);
  });

  it("denies a listed file when git fails", () => {
    touch(worktree, ".env.example");
    const failing: GitRunner = () => ({ code: 128, stdout: "", stderr: "fatal" });
    expect(envFileDenies({ projectRoot: root, worktree, readable: [".env.example"], git: failing })).toEqual([join(worktree, ".env.example")]);
  });

  it("returns nothing for trees that do not exist", () => {
    expect(envFileDenies({ projectRoot: join(dir, "none"), worktree: join(dir, "gone"), readable: [".env.example"], git })).toEqual([]);
  });
});
