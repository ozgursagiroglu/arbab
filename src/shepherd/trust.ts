import { integrationPaths, listIntegrations, readIntegration } from "../integrate";
import type { GitRunner } from "../run";
import { INTEGRATIONS_DIR, type ProjectConfig } from "../types";
import { ArbabError } from "../util/errors";

const SHA = /^[0-9a-f]{40,64}$/;
const output = (r: { stdout: string; stderr: string }): string => (r.stderr || r.stdout).trim();

/**
 * The integration heads a human confirmed (`integrate --deps-installed`): the human reviewed and installed their
 * dependencies there. A record that does not read vouches for nothing, and so does one git tracks: arbab writes its
 * records untracked, so a tracked one came in through a merge, from a branch a worker could write.
 */
export function confirmedHeads(projectRoot: string, config: Pick<ProjectConfig, "worktreeRoot">, git: GitRunner): Set<string> {
  const heads = new Set<string>();
  // Without case: on a case-insensitive file system a tracked `.ARBAB/integrations/...` is the record arbab reads.
  const listed = git(["ls-files", "-z", "--", `:(icase)${INTEGRATIONS_DIR}`], projectRoot);
  // When git cannot say, no record is trusted.
  if (listed.code !== 0) return heads;
  const depth = INTEGRATIONS_DIR.split("/").length;
  const trackedNames = new Set(
    listed.stdout
      .split("\0")
      .filter((p) => p !== "")
      .map((p) => (p.split("/")[depth] ?? "").toLowerCase()),
  );
  for (const name of listIntegrations(projectRoot)) {
    if (trackedNames.has(name)) continue;
    try {
      const at = readIntegration(integrationPaths(projectRoot, config, name))?.depsConfirmedAt ?? null;
      if (at !== null) heads.add(at);
    } catch {
      // Fewer trusted commits, never more.
    }
  }
  return heads;
}

export interface TrustInput {
  projectRoot: string;
  /** config.baseBranch: every commit it contains is trusted. */
  baseBranch: string;
  /** Integration heads a human confirmed (confirmedHeads). */
  confirmed: ReadonlySet<string>;
  git: GitRunner;
}

function assertRevision(rev: string, what: string): void {
  if (rev === "" || rev.startsWith("-")) throw new ArbabError("usage", `${what} ${JSON.stringify(rev)} is not a valid revision`);
}

/** The commit a revision names, resolved in the project root. */
export function resolveCommit(projectRoot: string, rev: string, git: GitRunner): string | null {
  assertRevision(rev, "revision");
  const r = git(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], projectRoot);
  const sha = r.stdout.trim();
  return r.code === 0 && SHA.test(sha) ? sha : null;
}

/**
 * Whether the dependency command may run on a tree at `sha`: the base branch contains it, or it is an integration head
 * a human confirmed. Anything else may hold worker code, which an install runs on the host.
 */
export function isTrustedInstallPoint(sha: string, input: TrustInput): boolean {
  if (input.confirmed.has(sha)) return true;
  assertRevision(input.baseBranch, "baseBranch");
  const r = input.git(["merge-base", "--is-ancestor", sha, input.baseBranch], input.projectRoot);
  if (r.code === 0) return true;
  if (r.code === 1) return false;
  throw new ArbabError("git", `git merge-base --is-ancestor ${sha} ${input.baseBranch} failed (${r.code}): ${output(r)}`);
}

/** Where a new worktree starts and installs, and the commit merged on top of it afterwards (null for none). */
export interface InstallPlan {
  start: string;
  merge: string | null;
}

/** How many commits `sha` has that `ancestor` does not. */
function distance(ancestor: string, sha: string, input: TrustInput): number {
  const r = input.git(["rev-list", "--count", `${ancestor}..${sha}`], input.projectRoot);
  const n = Number(r.stdout.trim());
  if (r.code !== 0 || !Number.isInteger(n)) {
    throw new ArbabError("git", `git rev-list --count ${ancestor}..${sha} failed (${r.code}): ${output(r)}`);
  }
  return n;
}

/**
 * Where a lane based on `base` installs its dependencies (DESIGN.md §16): at the base's commit when that is trusted,
 * else at the newest trusted ancestor of it (a confirmed integration head the base moved past, or its merge base with
 * the base branch), with the base's commit merged on top after the install, as the lane's first merge; mergeBranches
 * refuses that merge if it changes a manifest. A base that shares no history with any trusted commit has none to start
 * from. A base that names no commit is left as it is, for `git worktree add` to report; the shepherd checks where the
 * worktree is before it installs, so one that appears in between is still not trusted unchecked.
 */
export function installPlan(base: string, input: TrustInput): InstallPlan {
  assertRevision(base, "base");
  assertRevision(input.baseBranch, "baseBranch");
  const sha = resolveCommit(input.projectRoot, base, input.git);
  if (sha === null) return { start: base, merge: null };
  if (isTrustedInstallPoint(sha, input)) return { start: sha, merge: null };
  // A confirmed head that is no ancestor, or that git no longer knows, vouches for nothing here.
  const candidates = [...input.confirmed]
    .filter((c) => SHA.test(c) && input.git(["merge-base", "--is-ancestor", c, sha], input.projectRoot).code === 0)
    .sort();
  const r = input.git(["merge-base", sha, input.baseBranch], input.projectRoot);
  const fork = r.stdout.trim();
  if (r.code === 0 && SHA.test(fork)) {
    candidates.push(fork);
  } else if (r.code !== 1) {
    throw new ArbabError("git", `git merge-base ${sha} ${input.baseBranch} failed (${r.code}): ${output(r)}`);
  }
  if (candidates.length === 0) {
    throw new ArbabError(
      "git",
      `base ${base} shares no history with ${input.baseBranch}, so the lane has no trusted commit to install its ` +
        `dependencies on; base it on ${input.baseBranch} or on a commit that descends from it`,
    );
  }
  // The newest: every other trusted ancestor of the base that it descends from leaves more commits to merge.
  let start = candidates[0] as string;
  let least = distance(start, sha, input);
  for (const c of candidates.slice(1)) {
    const d = distance(c, sha, input);
    if (d < least) [start, least] = [c, d];
  }
  return { start, merge: sha };
}
