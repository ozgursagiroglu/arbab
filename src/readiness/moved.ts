// Whether the integration's base moved past what the integration holds, which land refuses (assertBaseInHead), and
// which landings moved it, so readiness says so before the human tries to land (DESIGN.md §21).
import { existsSync } from "node:fs";
import { shellWord } from "../hook/command";
import { untrustedTree, type GitRunner } from "../run";
import { landingsSince } from "../summary";
import type { BaseMoved } from "./index";

const SHA = /^[0-9a-f]{40,64}$/;

/**
 * How to answer a moved base, as readiness and land both say it: the merge the human runs in the integration worktree
 * gets the same git options as arbab's own, or a worker-written hook (a relative core.hooksPath) would run on the host.
 * The worktree and the base are quoted: the human pastes the command into a shell. A worktree removed while idle
 * (`worktreeExists` false, as the caller found it) is rebuilt first by `--refresh`, so the merge has a tree to run in.
 */
export function baseMergeInstruction(base: string, name: string, worktree: string, worktreeExists: boolean): string {
  const merge =
    `${base} into integrate/${name} with hooks off: git -C ${shellWord(worktree)} ${untrustedTree().join(" ")} ` +
    `merge --no-verify --no-edit ${shellWord(base)}; then arbab integrate ${name} --refresh to record the new head, and ` +
    `verify, review and readiness for ${name} again`;
  return worktreeExists ? `Merge ${merge}` : `Run arbab integrate ${name} --refresh to rebuild the integration worktree; then merge ${merge}`;
}

/** The integration being judged: its own landing is no move of the base. */
export interface OwnLanding {
  name: string;
  /** Its landing.json path. */
  landing: string;
}

/**
 * What `base` gained that `head` does not hold, or null when the head holds the base's head, the integration already
 * landed (its own merge commit is what the base gained), or git cannot tell (the risk is advisory: land checks again).
 * The landings are those into `base` whose commit is among the new ones: integration.json keeps no start time, and
 * the commits say exactly which landings the integration lacks, whenever they happened.
 */
export function baseMoved(git: GitRunner, projectRoot: string, base: string, head: string, own: OwnLanding): BaseMoved | null {
  if (base === "" || base.startsWith("-") || !SHA.test(head)) return null;
  if (existsSync(own.landing)) return null;
  if (git(["merge-base", "--is-ancestor", base, head], projectRoot).code !== 1) return null;
  const listed = git(["rev-list", `${head}..${base}`, "--"], projectRoot);
  if (listed.code !== 0) return { base, landings: [], commits: null };
  const commits = new Set(listed.stdout.split("\n").map((l) => l.trim()).filter((l) => l !== ""));
  const landings = landingsSince(projectRoot, -Infinity).filter((l) => l.into === base && l.name !== own.name && commits.has(l.mergeSha));
  return { base, landings, commits: commits.size };
}
