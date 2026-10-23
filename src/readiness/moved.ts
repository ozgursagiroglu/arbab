// Whether the integration's base moved past what the integration holds, which land refuses (assertBaseInHead), and
// which landings moved it, so readiness says so before the human tries to land (DESIGN.md §21).
import type { GitRunner } from "../run";
import { landingsSince } from "../summary";
import type { BaseMoved } from "./index";

const SHA = /^[0-9a-f]{40,64}$/;

/**
 * What `base` gained that `head` does not hold, or null when the head holds the base's head, or git cannot tell (the
 * risk is advisory: land checks again). The landings are those into `base` whose commit is among the new ones:
 * integration.json keeps no start time, and the commits say exactly which landings the integration lacks, whenever
 * they happened.
 */
export function baseMoved(git: GitRunner, projectRoot: string, base: string, head: string): BaseMoved | null {
  if (base === "" || base.startsWith("-") || !SHA.test(head)) return null;
  if (git(["merge-base", "--is-ancestor", base, head], projectRoot).code !== 1) return null;
  const listed = git(["rev-list", `${head}..${base}`, "--"], projectRoot);
  if (listed.code !== 0) return { base, landings: [], commits: null };
  const commits = new Set(listed.stdout.split("\n").map((l) => l.trim()).filter((l) => l !== ""));
  const landings = landingsSince(projectRoot, -Infinity).filter((l) => l.into === base && commits.has(l.mergeSha));
  return { base, landings, commits: commits.size };
}
