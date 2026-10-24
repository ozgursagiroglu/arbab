import { lstatSync, rmSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import type { DependencyStrategy } from "../types";
import { ArbabError } from "../util/errors";
import { ensureDir } from "../util/fs";
import { assertValidName } from "../util/names";
import { installRelevantPaths, prepareDependencies, type ArgvRunner } from "./deps";
import { commonDir, explicitGit, untrustedTree, verifyWorktreeGit, type GitRunner } from "./git";

export interface RebuildInput {
  projectRoot: string;
  /** The missing worktree's absolute path. */
  path: string;
  /** The existing branch it is rebuilt on: arbab/<lane> or integrate/<name>. */
  branch: string;
  /** Where the install runs: a trusted install point that is the branch head or an ancestor of it (installPlan's start). */
  start: string;
  dependencies: DependencyStrategy;
  runCommand: ArgvRunner;
  /**
   * "refuse": a worker will run in the tree with the install made at `start`, so an install-relevant manifest change
   * between `start` and the head refuses the rebuild. "flag": an integration records manifests itself
   * (depsConfirmed), so the change is only returned.
   */
  manifests: "refuse" | "flag";
  git: GitRunner;
}

export interface Rebuilt {
  path: string;
  branch: string;
  /** The branch head the worktree is on; the branch never moves. */
  head: string;
  gitCommonDir: string;
  /** The worktree's verified private git dir. */
  gitDir: string;
  /** Install-relevant manifests that differ between `start` and `head` (always empty in "refuse" mode). */
  manifests: string[];
}

const SHA = /^[0-9a-f]{40,64}$/;
const output = (r: { stdout: string; stderr: string }): string => (r.stderr || r.stdout).trim();

function must(git: GitRunner, args: string[], cwd: string, options: string[] = []): string {
  const r = git([...options, ...args], cwd);
  if (r.code !== 0) throw new ArbabError("git", `git ${args.join(" ")} failed (${r.code}): ${output(r)}`);
  return r.stdout;
}

function commitOf(git: GitRunner, rev: string, cwd: string): string | null {
  const r = git(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], cwd);
  const sha = r.stdout.trim();
  return r.code === 0 && SHA.test(sha) ? sha : null;
}

/** Whether anything, a dangling link included, is at `path`. */
function present(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function assertBranch(branch: string): void {
  const slash = branch.indexOf("/");
  const prefix = branch.slice(0, slash);
  if (slash < 0 || (prefix !== "arbab" && prefix !== "integrate")) {
    throw new ArbabError("usage", `branch ${JSON.stringify(branch)} is neither arbab/<lane> nor integrate/<name>`);
  }
  assertValidName(branch.slice(slash + 1), prefix === "arbab" ? "lane" : "integration");
}

/**
 * Rebuilds a missing worktree on its existing branch (DESIGN.md §9, install points): added detached at `start`, a
 * trusted commit, where the dependency command runs; only then checked out on the branch, through the verified git dir
 * and with hooks off, so the install never sees a worker's tree. The branch is never moved, reset or deleted; any
 * failure after the add removes the worktree again, so the next call starts over.
 */
export function rebuildWorktree(input: RebuildInput): Rebuilt {
  const { projectRoot, path, branch, git } = input;
  if (!isAbsolute(path)) throw new ArbabError("usage", `worktree path ${JSON.stringify(path)} is not absolute`);
  assertBranch(branch);
  if (input.start === "" || input.start.startsWith("-")) throw new ArbabError("usage", `start ${JSON.stringify(input.start)} is not a valid revision`);
  if (present(path)) throw new ArbabError("usage", `${path} exists; arbab rebuilds only a missing worktree`);
  const head = commitOf(git, `refs/heads/${branch}`, projectRoot);
  if (head === null) throw new ArbabError("git", `cannot rebuild ${path}: branch ${branch} does not exist`);
  const start = commitOf(git, input.start, projectRoot);
  if (start === null) throw new ArbabError("git", `cannot rebuild ${path}: start ${input.start} does not name a commit`);
  const ancestor = git(["merge-base", "--is-ancestor", start, head], projectRoot);
  if (ancestor.code === 1) throw new ArbabError("git", `cannot rebuild ${path}: ${start} is not ${branch}'s head ${head} or an ancestor of it`);
  if (ancestor.code !== 0) throw new ArbabError("git", `git merge-base --is-ancestor ${start} ${head} failed (${ancestor.code}): ${output(ancestor)}`);
  const gitCommonDir = commonDir(projectRoot, git);

  // A worktree directory deleted by hand stays registered and makes `worktree add` fail; forget such entries first.
  must(git, ["worktree", "prune"], projectRoot);
  ensureDir(dirname(path));
  must(git, ["worktree", "add", "--detach", path, start], projectRoot, untrustedTree());
  try {
    const at = verifyWorktreeGit({ worktree: path, branch, gitCommonDir, detachedAt: start });
    if (at.gitDir === null) throw new ArbabError("git", `cannot verify the rebuilt worktree ${path}: ${at.error}`);
    const gitDir = at.gitDir;
    const wt = (args: string[]): ReturnType<GitRunner> => git([...explicitGit(gitDir, path), ...untrustedTree(), ...args], path);

    // The tree is at `start` here, and nowhere else does the dependency command run.
    const deps = prepareDependencies(input.dependencies, path, input.runCommand);
    if (!deps.ok) {
      const tail = deps.output.trim().split("\n").slice(-5).join("\n");
      throw new ArbabError("runtime", `dependencies failed in ${path} (${deps.code}): ${tail}`);
    }

    const diff = wt(["diff", "--name-only", "-z", "--no-renames", "--no-ext-diff", start, head, "--"]);
    if (diff.code !== 0) throw new ArbabError("git", `cannot list the files ${branch} changed since ${start} (${diff.code}): ${output(diff)}`);
    const manifests = installRelevantPaths(wt, start, head, diff.stdout.split("\0").filter((p) => p !== ""));
    if (input.manifests === "refuse" && manifests.length > 0) {
      throw new ArbabError(
        "git",
        `${branch} changes dependency manifests since ${start} (${manifests.join(", ")}), so arbab did not rebuild ${path}: ` +
          `the install it can make is the one at ${start}, which those changes would not match. Land that dependency ` +
          `change on the base, or relaunch under a new name with "base": "${branch}"`,
      );
    }

    // From `start` to the head the branch names; the branch itself does not move.
    must(wt, ["checkout", "-q", branch, "--"], path);
    const on = verifyWorktreeGit({ worktree: path, branch, gitCommonDir });
    if (on.gitDir === null) throw new ArbabError("git", `cannot verify the rebuilt worktree ${path}: ${on.error}`);
    if (on.gitDir !== gitDir) throw new ArbabError("git", `the rebuilt worktree ${path} moved from ${gitDir} to ${on.gitDir}`);
    const now = commitOf(wt, "HEAD", path);
    if (now !== head) throw new ArbabError("git", `the rebuilt worktree ${path} is at ${now ?? "no commit"}, not at ${branch}'s head ${head}`);
    return { path, branch, head, gitCommonDir, gitDir, manifests: input.manifests === "refuse" ? [] : manifests };
  } catch (err) {
    // The tree may hold worker files after the checkout, so no hook runs while it goes.
    const removed = git([...untrustedTree(), "worktree", "remove", "--force", path], projectRoot);
    if (removed.code !== 0) rmSync(path, { recursive: true, force: true });
    git(["worktree", "prune"], projectRoot);
    throw err;
  }
}
