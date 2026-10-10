import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArbabError } from "../util/errors";
import { checkpoint, type CheckpointInput } from "./checkpoint";
import { createWorktree, makeGitRunner, untrustedTree, type GitRunner } from "./git";
import { plantNestedRepo } from "./testkit";

let dir: string;
let repo: string;
let wt: string;
let gitCommonDir: string;
let git: GitRunner;

function ok(args: string[], cwd = wt): string {
  const r = git(args, cwd);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arbab-ckpt-"));
  repo = join(dir, "repo");
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
  const init = git(["init", "-q", "-b", "main", repo], dir);
  if (init.code !== 0) throw new Error(init.stderr);
  writeFileSync(join(repo, "a.txt"), "a\n");
  ok(["add", "-A"], repo);
  ok(["commit", "-q", "-m", "init"], repo);
  const created = createWorktree({ projectRoot: repo, root: "wt", lane: "m1-x", base: "main", trustedBase: "main", git });
  wt = created.path;
  gitCommonDir = created.gitCommonDir;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const input = (over: Partial<CheckpointInput> = {}): CheckpointInput => ({
  worktree: wt,
  lane: "m1-x",
  attempt: 1,
  endState: "success",
  branch: "arbab/m1-x",
  gitCommonDir,
  git,
  ...over,
});
const privateGitDir = (): string => join(gitCommonDir, "worktrees", "m1-x");

describe("checkpoint", () => {
  it("does nothing on a clean worktree", () => {
    const head = ok(["rev-parse", "HEAD"]).trim();
    expect(checkpoint(input())).toEqual({ sha: null, error: null });
    expect(ok(["rev-parse", "HEAD"]).trim()).toBe(head);
  });

  it("commits every change, untracked included, on the lane's branch and returns the new HEAD", () => {
    writeFileSync(join(wt, "a.txt"), "changed\n");
    writeFileSync(join(wt, "new.txt"), "new\n");
    const r = checkpoint(input({ attempt: 2, endState: "killed:idle" }));
    expect(r.error).toBeNull();
    expect(r.sha).toBe(ok(["rev-parse", "HEAD"]).trim());
    expect(ok(["rev-parse", "refs/heads/arbab/m1-x"], repo).trim()).toBe(r.sha);
    expect(ok(["log", "-1", "--format=%B"]).trim()).toBe(
      "arbab(m1-x): checkpoint attempt 2 (killed:idle)\n\nCo-Authored-By: Claude <noreply@anthropic.com>",
    );
    expect(ok(["status", "--porcelain"])).toBe("");
  });

  it("never stages arbab's own state, even when the worker un-ignores it", () => {
    // The repository does not ignore .arbab/ here, as a worker that edited .gitignore would arrange.
    mkdirSync(join(wt, ".arbab", "integrations", "x"), { recursive: true });
    writeFileSync(join(wt, ".arbab", "integrations", "x", "integration.json"), "{}\n");
    mkdirSync(join(wt, ".arbab-tmp"), { recursive: true });
    writeFileSync(join(wt, ".arbab-tmp", "state"), "x\n");
    writeFileSync(join(wt, "new.txt"), "new\n");
    const r = checkpoint(input());
    expect(r.error).toBeNull();
    expect(ok(["ls-tree", "-r", "--name-only", "HEAD"]).trim().split("\n")).toEqual(["a.txt", "new.txt"]);
  });

  it("never stages arbab's state under another case either: on a case-insensitive disk it is the same directory", () => {
    mkdirSync(join(wt, ".ARBAB", "integrations", "x"), { recursive: true });
    writeFileSync(join(wt, ".ARBAB", "integrations", "x", "integration.json"), "{}\n");
    writeFileSync(join(wt, "new.txt"), "new\n");
    const r = checkpoint(input());
    expect(r.error).toBeNull();
    expect(ok(["ls-tree", "-r", "--name-only", "HEAD"]).trim().split("\n")).toEqual(["a.txt", "new.txt"]);
  });

  it("commits as usual while git ignores arbab's per-worker directory, as the shepherd arranges", () => {
    writeFileSync(join(gitCommonDir, "info", "exclude"), ".arbab-tmp/\n");
    mkdirSync(join(wt, ".arbab-tmp", "xdg-config"), { recursive: true });
    writeFileSync(join(wt, ".arbab-tmp", "xdg-config", "state"), "x\n");
    writeFileSync(join(wt, "new.txt"), "new\n");
    const r = checkpoint(input());
    expect(r.error).toBeNull();
    expect(ok(["ls-tree", "-r", "--name-only", "HEAD"]).trim().split("\n")).toEqual(["a.txt", "new.txt"]);
  });

  it("names the git dir and the work tree, with the untrusted-tree options, on every git call", () => {
    writeFileSync(join(wt, "new.txt"), "new\n");
    const seen: string[][] = [];
    const spy: GitRunner = (args, cwd) => {
      seen.push(args);
      return git(args, cwd);
    };
    expect(checkpoint(input({ git: spy })).sha).toMatch(/^[0-9a-f]{40}$/);
    expect(seen.length).toBeGreaterThan(0);
    for (const args of seen) {
      expect(args).toEqual(expect.arrayContaining([`--git-dir=${privateGitDir()}`, `--work-tree=${wt}`, ...untrustedTree()]));
    }
    expect(seen.find((args) => args.includes("status"))).toContain("--ignore-submodules=all");
  });

  it("skips the commit when the worktree's HEAD was moved to another branch", () => {
    const main = ok(["rev-parse", "main"], repo).trim();
    writeFileSync(join(privateGitDir(), "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(wt, "new.txt"), "new\n");
    const r = checkpoint(input());
    expect(r.sha).toBeNull();
    expect(r.error).toMatch(/^checkpoint skipped: HEAD of .* is "ref: refs\/heads\/main", not ref: refs\/heads\/arbab\/m1-x$/);
    expect(ok(["rev-parse", "main"], repo).trim()).toBe(main);
  });

  it("skips the commit when commondir points at another repository", () => {
    const other = join(dir, "other");
    expect(git(["init", "-q", "-b", "main", other], dir).code).toBe(0);
    writeFileSync(join(privateGitDir(), "commondir"), `${join(other, ".git")}\n`);
    writeFileSync(join(wt, "new.txt"), "new\n");
    const r = checkpoint(input());
    expect(r).toEqual({ sha: null, error: expect.stringMatching(/^checkpoint skipped: commondir of .* does not lead to /) });
  });

  it("skips the commit when the worktree's .git points outside the shared worktrees dir", () => {
    const fake = join(dir, "fake-gitdir");
    mkdirSync(fake);
    writeFileSync(join(fake, "HEAD"), "ref: refs/heads/arbab/m1-x\n");
    writeFileSync(join(fake, "commondir"), `${gitCommonDir}\n`);
    writeFileSync(join(wt, ".git"), `gitdir: ${fake}\n`);
    expect(checkpoint(input()).error).toMatch(/^checkpoint skipped: git dir .* is not under /);
    writeFileSync(join(wt, ".git"), "not a pointer\n");
    expect(checkpoint(input()).error).toMatch(/is not a worktree's gitdir pointer/);
  });

  it("runs no hook a worker wrote under a relative core.hooksPath, while a plain commit would", () => {
    const marker = join(dir, "hook-ran");
    mkdirSync(join(wt, ".husky"));
    for (const name of ["pre-commit", "prepare-commit-msg", "commit-msg", "post-commit"]) {
      writeFileSync(join(wt, ".husky", name), `#!/bin/sh\necho ${name} >> '${marker}'\nexit 1\n`);
      chmodSync(join(wt, ".husky", name), 0o755);
    }
    ok(["config", "core.hooksPath", ".husky"], repo);
    writeFileSync(join(wt, "new.txt"), "new\n");
    const r = checkpoint(input());
    expect(r.error).toBeNull();
    expect(r.sha).toBe(ok(["rev-parse", "HEAD"]).trim());
    expect(existsSync(marker)).toBe(false);

    writeFileSync(join(wt, "more.txt"), "more\n");
    ok(["add", "-A"]);
    expect(git(["commit", "-q", "-m", "hooks on"], wt).code).not.toBe(0);
    expect(readFileSync(marker, "utf8")).toMatch(/pre-commit/);
  });

  it("runs no hook from the repository's hooks dir either", () => {
    const hook = join(repo, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\necho 'lint says no' >&2\nexit 1\n");
    chmodSync(hook, 0o755);
    writeFileSync(join(wt, "new.txt"), "new\n");
    const r = checkpoint(input({ endState: "failed" }));
    expect(r.error).toBeNull();
    expect(r.sha).toBe(ok(["rev-parse", "HEAD"]).trim());
  });

  it("returns the error when git add fails", () => {
    writeFileSync(join(wt, "new.txt"), "new\n");
    const failingAdd: GitRunner = (args, cwd) =>
      args.includes("add") ? { code: 128, stdout: "", stderr: "index.lock exists" } : git(args, cwd);
    expect(checkpoint(input({ endState: "failed", git: failingAdd }))).toEqual({
      sha: null,
      error: "git add -A failed (128): index.lock exists",
    });
  });

  it("commits everything but an untracked nested repository, names it, and runs nothing of it", () => {
    const nested = plantNestedRepo(git, wt, "sub", dir);
    const deep = plantNestedRepo(git, wt, "outer/inner", dir);
    writeFileSync(join(wt, "outer", "kept.txt"), "kept\n");
    writeFileSync(join(wt, "new.txt"), "new\n");
    const r = checkpoint(input());
    expect(r.sha).toBe(ok(["rev-parse", "HEAD"]).trim());
    expect(r.error).toBe("nested repositories were not committed: outer/inner, sub; arbab never commits or inspects them");
    expect(ok(["ls-tree", "-r", "--name-only", "HEAD"]).trim().split("\n")).toEqual(["a.txt", "new.txt", "outer/kept.txt"]);
    expect(ok(["ls-files", "-s"])).not.toMatch(/^160000 /m);
    expect(nested.ran()).toBe("");
    expect(deep.ran()).toBe("");

    // The next checkpoint still finds the tree dirty, commits nothing, and says why.
    const head = r.sha;
    expect(checkpoint(input({ attempt: 2 }))).toEqual({ sha: null, error: r.error });
    expect(ok(["rev-parse", "HEAD"]).trim()).toBe(head);
    expect(nested.ran()).toBe("");

    // What it prevents, on this machine: once staged, a plain status runs the worker's commands.
    ok(["add", "-A"]);
    nested.reset();
    ok(["status", "--porcelain"]);
    expect(nested.ran()).toMatch(/clean/);
  });

  it("leaves a tracked gitlink alone and runs nothing of it", () => {
    const nested = plantNestedRepo(git, wt, "sub", dir);
    ok(["add", "-A"]);
    ok(["commit", "-q", "-m", "a worker's own commit"]);
    const gitlink = ok(["ls-files", "-s", "sub"]);
    writeFileSync(join(wt, "new.txt"), "new\n");
    nested.reset();
    const seen: string[][] = [];
    const spy: GitRunner = (args, cwd) => {
      seen.push(args);
      return git(args, cwd);
    };
    const r = checkpoint(input({ git: spy }));
    expect(r.sha).toBe(ok(["rev-parse", "HEAD"]).trim());
    expect(r.error).toBe("nested repositories were not committed: sub; arbab never commits or inspects them");
    expect(ok(["ls-files", "-s", "sub"])).toBe(gitlink);
    expect(seen.find((args) => args.includes("add"))?.slice(-6)).toEqual(["-A", "--", ".", ":(exclude,literal)sub", ":(exclude,icase,literal).arbab", ":(exclude,icase,literal).arbab-tmp"]);
    expect(nested.ran()).toBe("");
  });

  it("does not report a tracked gitlink with nothing checked out under it", () => {
    ok(["update-index", "--add", "--cacheinfo", `160000,${ok(["rev-parse", "HEAD"]).trim()},vendor/lib`]);
    ok(["commit", "-q", "-m", "a submodule"]);
    writeFileSync(join(wt, "new.txt"), "new\n");
    expect(checkpoint(input())).toEqual({ sha: expect.stringMatching(/^[0-9a-f]{40}$/), error: null });
  });

  it("commits nothing when the worker staged a nested repository itself", () => {
    const nested = plantNestedRepo(git, wt, "sub", dir);
    // Inside the fence, where it runs nothing on the host.
    ok(["add", "sub"]);
    writeFileSync(join(wt, "new.txt"), "new\n");
    nested.reset();
    const head = ok(["rev-parse", "HEAD"]).trim();
    expect(checkpoint(input())).toEqual({
      sha: null,
      error:
        "nested repositories are staged in the index: sub; arbab never commits or inspects them, so nothing was " +
        "committed. Unstage them to let the checkpoint commit the rest",
    });
    expect(ok(["rev-parse", "HEAD"]).trim()).toBe(head);
    expect(nested.ran()).toBe("");

    ok(["rm", "-q", "-f", "--cached", "sub"]);
    nested.reset();
    const r = checkpoint(input({ attempt: 2 }));
    expect(r).toEqual({ sha: ok(["rev-parse", "HEAD"]).trim(), error: "nested repositories were not committed: sub; arbab never commits or inspects them" });
    expect(ok(["ls-tree", "-r", "--name-only", "HEAD"]).trim().split("\n")).toEqual(["a.txt", "new.txt"]);
    expect(nested.ran()).toBe("");
  });

  it("returns the error when reading the index fails", () => {
    writeFileSync(join(wt, "new.txt"), "new\n");
    const failing: GitRunner = (args, cwd) => (args.includes("ls-files") ? { code: 128, stdout: "", stderr: "bad index" } : git(args, cwd));
    expect(checkpoint(input({ git: failing }))).toEqual({ sha: null, error: expect.stringMatching(/ls-files -s -z failed \(128\): bad index$/) });
  });

  it("returns the error when listing the untracked files fails", () => {
    writeFileSync(join(wt, "new.txt"), "new\n");
    const failing: GitRunner = (args, cwd) => (args.includes("--others") ? { code: 128, stdout: "", stderr: "bad dir" } : git(args, cwd));
    expect(checkpoint(input({ git: failing }))).toEqual({ sha: null, error: "git ls-files --others failed (128): bad dir" });
  });

  it("returns the error when comparing the index with HEAD fails", () => {
    writeFileSync(join(wt, "new.txt"), "new\n");
    const failing: GitRunner = (args, cwd) => (args.includes("--cached") ? { code: 128, stdout: "", stderr: "no HEAD" } : git(args, cwd));
    expect(checkpoint(input({ git: failing }))).toEqual({ sha: null, error: "git diff --cached failed (128): no HEAD" });
  });

  it("validates the lane and the attempt", () => {
    expect(() => checkpoint(input({ lane: "Bad" }))).toThrow(ArbabError);
    expect(() => checkpoint(input({ attempt: 0 }))).toThrow(ArbabError);
  });

  it("leaves the shared git dir untouched by a refused checkpoint", () => {
    writeFileSync(join(privateGitDir(), "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(wt, "new.txt"), "new\n");
    const before = readFileSync(join(gitCommonDir, "HEAD"), "utf8");
    checkpoint(input());
    expect(readFileSync(join(gitCommonDir, "HEAD"), "utf8")).toBe(before);
    expect(ok(["log", "--format=%s", "main"], repo).trim()).toBe("init");
  });
});
