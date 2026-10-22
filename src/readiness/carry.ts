// Whether a review of an earlier integration head still holds for the current one (DESIGN.md §21): merging the base
// into the integration should not make a finished review stale when the merge brought nothing anyone resolved by hand.
import { untrustedTree, type GitRunner } from "../run";

const SHA = /^[0-9a-f]{40,64}$/;

function line(git: GitRunner, args: string[], cwd: string): string | null {
  const r = git([...untrustedTree(), ...args], cwd);
  return r.code === 0 ? r.stdout.trim() : null;
}

/**
 * True when `head` is a merge commit whose first parent is `reviewed`, whose second parent is an ancestor of
 * `baseBranch`, and whose tree is exactly what git merges those two parents into: nobody resolved anything by hand,
 * so the head adds only the base's own commits to what was reviewed. Any git failure (an older git without
 * `merge-tree --write-tree`, an unknown commit) counts as false.
 */
export function reviewCarriesOver(git: GitRunner, cwd: string, reviewed: string, head: string, baseBranch: string): boolean {
  if (!SHA.test(reviewed) || !SHA.test(head) || reviewed === head || baseBranch.startsWith("-")) return false;
  const parents = line(git, ["rev-list", "--parents", "-n", "1", head], cwd)?.split(/\s+/);
  if (parents === undefined || parents.length !== 3 || parents[0] !== head) return false;
  const [, first, second] = parents as [string, string, string];
  if (first !== reviewed) return false;
  if (git(["merge-base", "--is-ancestor", second, baseBranch], cwd).code !== 0) return false;
  // Exit 0 only for a clean merge; its first line is the merged tree.
  const merged = line(git, ["merge-tree", "--write-tree", first, second], cwd)?.split("\n")[0]?.trim();
  const tree = line(git, ["rev-parse", "--verify", "--quiet", `${head}^{tree}`], cwd);
  return merged !== undefined && tree !== null && SHA.test(tree) && merged === tree;
}
