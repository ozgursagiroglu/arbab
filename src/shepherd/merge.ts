import { explicitGit, isDependencyManifest, untrustedTree, type GitRunner, verifyWorktreeGit } from "../run";
import { ArbabError } from "../util/errors";

/** A branch merged into a new worktree, at the commit it pointed to (recorded in started.json). */
export interface MergedBranch {
  branch: string;
  sha: string;
}

export interface MergeInput {
  worktree: string;
  /** The worktree's branch, arbab/<lane>. */
  branch: string;
  gitCommonDir: string;
  lane: string;
  /**
   * In order; each is merged on top of the previous ones. A `{ branch, sha }` entry is merged at that commit and named
   * by its branch.
   */
  branches: Array<string | MergedBranch>;
  git: GitRunner;
}

const output = (r: { stdout: string; stderr: string }): string => (r.stderr || r.stdout).trim();

/**
 * Merges each branch into a worktree no worker has run in yet (DESIGN.md §16), with the worktree's git dir and work
 * tree named explicitly as the checkpoint does. Each branch is resolved to a commit once, and that commit is the one
 * checked, merged (fast-forwarded when it descends from HEAD) and recorded. A branch that changes a dependency manifest, a missing branch or a failed merge
 * throws, after aborting the merge: the orchestrator resolves conflicts and lands dependency changes, never the worker.
 */
export function mergeBranches(input: MergeInput): MergedBranch[] {
  const verified = verifyWorktreeGit({ worktree: input.worktree, branch: input.branch, gitCommonDir: input.gitCommonDir });
  if (verified.gitDir === null) throw new ArbabError("git", `cannot merge into ${input.worktree}: ${verified.error}`);
  // The merged branches are worker-written, so hooks their trees hold would be worker code on the host.
  const prefix = [...explicitGit(verified.gitDir, input.worktree), ...untrustedTree()];
  const git = (args: string[]): ReturnType<GitRunner> => input.git([...prefix, ...args], input.worktree);
  const merged: MergedBranch[] = [];
  // The relaunch builds the worktree again from a trusted commit when everything here came from a source; a merge
  // commit made before the failure is not one, and discardWorktree keeps what it cannot rebuild.
  const recovery = (): string =>
    `fix the branches (or land the dependency change) and launch ${input.lane} again: as long as no worker has run in ` +
    "its worktree, arbab builds it again, installs and merges again; if a merge commit was made there before this " +
    `failure, remove the worktree and the branch ${input.branch} first`;

  for (const entry of input.branches) {
    const branch = typeof entry === "string" ? entry : entry.branch;
    const rev = typeof entry === "string" ? entry : entry.sha;
    // The lane file is validated, but a git argument that starts with "-" is an option whatever its source.
    if (rev === "" || rev.startsWith("-") || /\s/.test(rev) || (typeof entry !== "string" && !/^[0-9a-f]{40,64}$/.test(rev))) {
      throw new ArbabError("usage", `merge branch ${JSON.stringify(rev)} is not a valid branch name`);
    }
    const head = git(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]);
    const sha = head.stdout.trim();
    if (head.code !== 0 || !/^[0-9a-f]{40,64}$/.test(sha)) {
      throw new ArbabError("git", `cannot merge ${branch} into ${input.branch}: branch ${branch} does not exist`);
    }

    // Every path that differs between HEAD and the commit: a superset of what the merge can change.
    const diff = git(["diff", "--name-only", "-z", "--no-renames", "--no-ext-diff", "HEAD", sha, "--"]);
    if (diff.code !== 0) {
      throw new ArbabError("git", `cannot list the files ${branch} changes in ${input.branch} (${diff.code}): ${output(diff)}`);
    }
    const manifests = diff.stdout.split("\0").filter((path) => path !== "" && isDependencyManifest(path));
    if (manifests.length > 0) {
      throw new ArbabError(
        "git",
        `${branch} changes dependency manifests (${manifests.join(", ")}), so it was not merged into ${input.branch}: ` +
          "an install would run that code on the host. The orchestrator must review and land that dependency change " +
          `on the base before dependent phases run; then ${recovery()}`,
      );
    }

    // The resolved commit, not the branch name: the branch can move between the check above and the merge. A
    // fast-forward when possible, so a generated lane's branch ends exactly at the integration head it merges.
    const r = git(["merge", "--ff", "--no-edit", "--no-verify", "-m", `arbab: merge ${branch} for ${input.lane}`, sha]);
    if (r.code !== 0) {
      const unmerged = git(["diff", "--name-only", "--diff-filter=U"]);
      const conflicts = unmerged.code === 0 ? unmerged.stdout.split("\n").filter((l) => l !== "") : [];
      // Nothing to abort when the merge refused to start; the error below says why.
      git(["merge", "--abort"]);
      const after = `the merge was aborted and nothing is left to resolve in the worktree; ${recovery()}`;
      if (conflicts.length > 0) {
        throw new ArbabError("git", `merging ${branch} into ${input.branch} conflicts in ${conflicts.join(", ")}; ${after}`);
      }
      throw new ArbabError("git", `merging ${branch} into ${input.branch} failed (${r.code}): ${output(r)}; ${after}`);
    }
    merged.push({ branch, sha });
  }
  return merged;
}
