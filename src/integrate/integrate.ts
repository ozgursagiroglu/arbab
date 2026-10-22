// Integration (DESIGN.md §17): finished lanes are merged into integrate/<name>, a worktree no worker ever runs in.
import { existsSync, readdirSync, realpathSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { INTEGRATION_WORKTREE_PREFIX } from "../config/lane";
import {
  arbabIgnoreEntries,
  ensureArbabMarkers,
  ensureIgnored,
  explicitGit,
  prepareDependencies,
  untrustedTree,
  verifyWorktreeGit,
  worktreeStatus,
} from "../run";
import type { ArgvRunner, GitRunner } from "../run";
import { installRelevantPaths } from "../run/deps";
import { confirmedHeads, isTrustedInstallPoint } from "../shepherd/trust";
import { INTEGRATIONS_DIR, type IntegrationRecord, type ProjectConfig } from "../types";
import { ArbabError } from "../util/errors";
import { confine, ensureDir, readJson, writeJsonAtomic } from "../util/fs";
import { assertValidName, isValidName } from "../util/names";
import { isoAt, type Clock } from "../util/proc";

/** Where an integration's records, worktree and branch live. */
export interface IntegrationPaths {
  name: string;
  projectRoot: string;
  /** <projectRoot>/.arbab/integrations/<name> */
  dir: string;
  integration: string;
  verify: string;
  review: string;
  readiness: string;
  readinessMd: string;
  landing: string;
  /** <dir>/lanes: the lanes the landing commands generate, with their briefs and schemas. */
  lanesDir: string;
  /** <projectRoot>/<worktreeRoot>/integrate-<name> */
  worktree: string;
  /** integrate/<name> */
  branch: string;
}


/** The integrations that have a records directory, by name, sorted; directories that are not valid names are skipped. */
export function listIntegrations(projectRoot: string): string[] {
  try {
    return readdirSync(join(resolve(projectRoot), INTEGRATIONS_DIR), { withFileTypes: true })
      .filter((e) => e.isDirectory() && isValidName(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    // No integration yet.
    return [];
  }
}

export function integrationPaths(projectRoot: string, config: Pick<ProjectConfig, "worktreeRoot">, name: string): IntegrationPaths {
  const valid = assertValidName(name, "integration");
  // Its generated lanes (<name>-verify, …) would be integrate-…, which lane names may not be (the integration
  // worktree's namespace).
  if (valid === "integrate" || valid.startsWith("integrate-")) {
    throw new ArbabError("usage", `integration name ${valid} may not be integrate or start with integrate-`);
  }
  const root = resolve(projectRoot);
  const dir = join(root, INTEGRATIONS_DIR, valid);
  return {
    name: valid,
    projectRoot: root,
    dir,
    integration: join(dir, "integration.json"),
    verify: join(dir, "verify.json"),
    review: join(dir, "review.json"),
    readiness: join(dir, "readiness.json"),
    readinessMd: join(dir, "readiness.md"),
    landing: join(dir, "landing.json"),
    lanesDir: join(dir, "lanes"),
    worktree: join(confine(root, config.worktreeRoot), `${INTEGRATION_WORKTREE_PREFIX}${valid}`),
    branch: `integrate/${valid}`,
  };
}

export interface IntegrateInput {
  projectRoot: string;
  config: ProjectConfig;
  name: string;
  /** In merge order. */
  lanes: string[];
  git: GitRunner;
  runCommand: ArgvRunner;
  clock: Clock;
}

const SHA = /^[0-9a-f]{40,64}$/;
const output = (r: { stdout: string; stderr: string }): string => (r.stderr || r.stdout).trim();

function must(git: GitRunner, args: string[], cwd: string): string {
  const r = git(args, cwd);
  if (r.code !== 0) throw new ArbabError("git", `git ${args.join(" ")} failed (${r.code}): ${output(r)}`);
  return r.stdout;
}

function canonical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** A commit, or null when the revision does not name one. */
function commitOf(git: GitRunner, rev: string, cwd: string): string | null {
  const r = git(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], cwd);
  const sha = r.stdout.trim();
  return r.code === 0 && SHA.test(sha) ? sha : null;
}

/** `git merge-base --is-ancestor`: exit 1 means no; anything else but 0 is a failure. */
function isAncestor(git: GitRunner, ancestor: string, of: string, cwd: string): boolean {
  const r = git(["merge-base", "--is-ancestor", ancestor, of], cwd);
  if (r.code === 0) return true;
  if (r.code === 1) return false;
  throw new ArbabError("git", `git merge-base --is-ancestor ${ancestor} ${of} failed (${r.code}): ${output(r)}`);
}

/** The branch each registered worktree is on (null when detached), by canonical path. */
function worktreeBranches(projectRoot: string, git: GitRunner): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const block of must(git, ["worktree", "list", "--porcelain"], projectRoot).split("\n\n")) {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice("worktree ".length);
    if (path === undefined) continue;
    const ref = lines.find((l) => l.startsWith("branch "))?.slice("branch ".length) ?? null;
    out.set(canonical(path), ref);
  }
  return out;
}

function gitCommonDir(projectRoot: string, git: GitRunner): string {
  const out = must(git, ["rev-parse", "--git-common-dir"], projectRoot).trim();
  if (out === "") throw new ArbabError("git", "git rev-parse --git-common-dir printed nothing");
  return canonical(resolve(projectRoot, out));
}

/**
 * Refuses an integration whose worktree path is a lane's worktree (on arbab/<lane>): a worker runs there, and the
 * integration merges and installs dependencies there on the host.
 */
function refuseLaneWorktree(paths: IntegrationPaths, git: GitRunner): void {
  const ref = worktreeBranches(paths.projectRoot, git).get(canonical(paths.worktree));
  const lanePrefix = "refs/heads/arbab/";
  if (typeof ref !== "string" || !ref.startsWith(lanePrefix)) return;
  throw new ArbabError(
    "usage",
    `${paths.worktree} is the worktree of lane ${ref.slice(lanePrefix.length)}, where a worker runs, so integration ` +
      `${paths.name} cannot use it. Lane names starting with ${INTEGRATION_WORKTREE_PREFIX} are reserved: rename that ` +
      "lane and remove its worktree, or choose another integration name",
  );
}

/** The worktree's git dir once it is shown to be this repository's worktree on the integration branch. */
function ownedGitDir(paths: IntegrationPaths, git: GitRunner): string {
  const refused = (why: string): ArbabError =>
    new ArbabError("git", `${paths.worktree} exists but is not a worktree of this repository on ${paths.branch}: ${why}`);
  const ref = worktreeBranches(paths.projectRoot, git).get(canonical(paths.worktree));
  if (ref === undefined) throw refused("git does not list it as a worktree");
  if (ref !== `refs/heads/${paths.branch}`) throw refused(`it is on ${ref ?? "a detached HEAD"}`);
  const verified = verifyWorktreeGit({
    worktree: paths.worktree,
    branch: paths.branch,
    gitCommonDir: gitCommonDir(paths.projectRoot, git),
  });
  if (verified.gitDir === null) throw refused(verified.error);
  return verified.gitDir;
}

/**
 * Refuses an integration that landed: `land` deleted its branch but kept its records, the measurement of that landing,
 * which a new branch under the same name would mix with its own.
 */
function refuseLanded(paths: IntegrationPaths): void {
  if (!existsSync(paths.landing)) return;
  let landedAt: unknown;
  try {
    const landing = readJson<unknown>(paths.landing);
    landedAt = isRecord(landing) ? landing["landedAt"] : undefined;
  } catch {
    // Unreadable, but present: the integration still landed.
  }
  const when = typeof landedAt === "string" && landedAt !== "" ? `at ${landedAt}` : `(${paths.landing} does not say when)`;
  throw new ArbabError(
    "usage",
    `integration ${paths.name} landed ${when}; its records stay as that landing's measurement. Choose a new name for ` +
      "a new integration",
  );
}

/**
 * Moves integration.json aside as integration.superseded-<updatedAt>.json, never over an earlier one: it describes a
 * branch that no longer exists, and the new branch starts its own record.
 */
function supersedeRecord(paths: IntegrationPaths): void {
  if (!existsSync(paths.integration)) return;
  let updatedAt: unknown;
  try {
    const old = readJson<unknown>(paths.integration);
    updatedAt = isRecord(old) ? old["updatedAt"] : undefined;
  } catch {
    // A record that does not parse is moved aside all the same.
  }
  const stamp = typeof updatedAt === "string" && updatedAt !== "" ? updatedAt.slice(0, 64).replace(/[^A-Za-z0-9._-]/g, "-") : "unknown";
  let target = join(paths.dir, `integration.superseded-${stamp}.json`);
  for (let n = 2; existsSync(target); n++) target = join(paths.dir, `integration.superseded-${stamp}-${n}.json`);
  renameSync(paths.integration, target);
}

/**
 * Creates the worktree from the base, or on the existing branch when that is still part of the base, and prepares
 * its dependencies there before anything is merged. A branch that already holds merges is refused: installing on it
 * would run worker code on the host.
 */
function createIntegrationWorktree(input: IntegrateInput, paths: IntegrationPaths): void {
  const { git, projectRoot } = input;
  const base = input.config.baseBranch;
  if (base === "" || base.startsWith("-")) {
    throw new ArbabError("config", `baseBranch ${JSON.stringify(base)} is not a valid revision`);
  }
  const baseSha = commitOf(git, base, projectRoot);
  if (baseSha === null) throw new ArbabError("git", `base ${base} does not name a commit`);
  // A worktree directory deleted by hand stays registered and makes `worktree add` fail; forget such entries first.
  must(git, ["worktree", "prune"], projectRoot);
  ensureDir(dirname(paths.worktree));
  const existing = commitOf(git, `refs/heads/${paths.branch}`, projectRoot);
  if (existing === null) {
    must(git, ["worktree", "add", "-b", paths.branch, paths.worktree, base], projectRoot);
    // Before the dependencies: if they fail, the next call finds the branch and must not take the old record for its own.
    supersedeRecord(paths);
  } else {
    if (!isAncestor(git, existing, baseSha, projectRoot)) {
      throw new ArbabError(
        "git",
        `${paths.branch} exists without its worktree and holds commits that are not on ${base}; arbab prepares ` +
          `dependencies only on the trusted base. Restore the worktree at ${paths.worktree}, or delete the branch and ` +
          "integrate again",
      );
    }
    must(git, ["worktree", "add", paths.worktree, paths.branch], projectRoot);
  }

  let deps: ReturnType<typeof prepareDependencies>;
  try {
    deps = prepareDependencies(input.config.dependencies, paths.worktree, input.runCommand);
  } catch (err) {
    removeWorktree(git, paths);
    throw err;
  }
  if (!deps.ok) {
    // Without the worktree the next call starts over and runs the dependencies again.
    removeWorktree(git, paths);
    const tail = deps.output.trim().split("\n").slice(-5).join("\n");
    throw new ArbabError("runtime", `dependencies failed in ${paths.worktree} (${deps.code}): ${tail}`);
  }
}

/**
 * Refuses lanes whose worktree (<worktreeRoot>/<lane>) holds uncommitted changes: their checkpoint did not commit
 * them, and integrating the branch would leave that work behind. git gets the worktree's verified git dir: the worker
 * could have rewritten the worktree's .git file.
 */
function refuseDirtyLanes(input: IntegrateInput, lanes: string[]): void {
  const { git, projectRoot } = input;
  const root = confine(projectRoot, input.config.worktreeRoot);
  let common: string | null = null;
  for (const lane of lanes) {
    const worktree = join(root, lane);
    if (!existsSync(worktree)) continue;
    common ??= gitCommonDir(projectRoot, git);
    const verified = verifyWorktreeGit({ worktree, branch: `arbab/${lane}`, gitCommonDir: common });
    if (verified.gitDir === null) {
      throw new ArbabError("git", `cannot check lane ${lane}'s worktree ${worktree} for uncommitted changes: ${verified.error}`);
    }
    const status = worktreeStatus(worktree, verified.gitDir, git).map((l) => l.slice(3));
    if (status.length === 0) continue;
    const shown = status.slice(0, 5).join(", ") + (status.length > 5 ? ` and ${status.length - 5} more` : "");
    throw new ArbabError(
      "usage",
      `lane ${lane} has uncommitted changes in ${worktree} (${shown}): its checkpoint did not commit them, and ` +
        "integrating its branch would leave them behind. Commit or discard them, then integrate again",
    );
  }
}

function removeWorktree(git: GitRunner, paths: IntegrationPaths): void {
  git(["worktree", "remove", "--force", paths.worktree], paths.projectRoot);
}

export interface IntegrateResult {
  record: IntegrationRecord;
  /** The listed lanes whose commit the branch already held: recorded, not merged. */
  alreadyIn: string[];
}

type MergedEntry = IntegrationRecord["merged"][number];

/** One entry per lane, where it first appears: the last entry's sha, every entry's manifests. */
function oneEntryPerLane(entries: MergedEntry[]): MergedEntry[] {
  const out: MergedEntry[] = [];
  for (const e of entries) {
    const i = out.findIndex((o) => o.lane === e.lane);
    const prior = i < 0 ? undefined : out[i];
    if (prior === undefined) out.push({ ...e, manifests: [...e.manifests] });
    else out[i] = { ...e, manifests: [...new Set([...prior.manifests, ...e.manifests])].sort() };
  }
  return out;
}

/**
 * Merges each lane's branch, by the commit it resolved to, into integrate/<name> (`--no-ff`). A lane already in the
 * branch is recorded without a merge. A lane whose worktree has uncommitted changes is refused before anything is
 * merged. Dependency manifests are flagged by what differs between the base and the head, whoever committed it:
 * nothing is installed after a merge, and `depsConfirmed` stays false until a human confirms. A conflict aborts the
 * merge and throws; the lanes merged before it stay merged and recorded.
 */
export function integrate(input: IntegrateInput): IntegrateResult {
  const paths = integrationPaths(input.projectRoot, input.config, input.name);
  const lanes = input.lanes.map((lane) => assertValidName(lane, "lane"));
  const { git, config } = input;

  refuseLanded(paths);
  refuseLaneWorktree(paths, git);
  refuseDirtyLanes(input, lanes);
  if (!existsSync(paths.worktree)) createIntegrationWorktree(input, paths);
  // The merged branches are worker-written, so hooks their trees hold would be worker code on the host.
  const prefix = [...explicitGit(ownedGitDir(paths, git), paths.worktree), ...untrustedTree()];
  // .arbab/ as a whole covers the integration records and worktrees.
  ensureIgnored(paths.projectRoot, arbabIgnoreEntries(paths.projectRoot, config), git);
  ensureArbabMarkers(paths.projectRoot);

  // A GitRunner that ignores its cwd: every call names the worktree's git dir and work tree.
  const wt = (args: string[]): ReturnType<GitRunner> => git([...prefix, ...args], paths.worktree);
  const head = (): string => {
    const sha = commitOf(wt, "HEAD", paths.worktree);
    if (sha === null) throw new ArbabError("git", `cannot read HEAD of ${paths.worktree}`);
    return sha;
  };

  const previous = readIntegration(paths);
  let headSha = head();
  // Entries whose commit left the branch (it was reset by hand, say) describe nothing that is merged; nor do commits
  // git no longer has (a branch deleted and collected), which `merge-base --is-ancestor` would fail on.
  const present = (sha: string): boolean => SHA.test(sha) && commitOf(wt, sha, paths.worktree) !== null;
  let merged = oneEntryPerLane(
    (previous?.merged ?? []).filter((m) => present(m.sha) && isAncestor(wt, m.sha, headSha, paths.worktree)),
  );
  const keptBase = previous !== null && present(previous.baseSha) && isAncestor(wt, previous.baseSha, headSha, paths.worktree);
  // The branch the integration was built against: a changed config.baseBranch does not move it, so land merges into
  // the branch the review diffed against.
  const base = keptBase ? previous.base : config.baseBranch;
  if (base === "" || base.startsWith("-")) {
    const from = keptBase ? `${paths.integration} records base` : "baseBranch";
    throw new ArbabError(keptBase ? "io" : "config", `${from} ${JSON.stringify(base)} is not a valid revision`);
  }
  // Its sha moves with it: once the human merges a moved base into the integration, or a lane brings newer base commits,
  // the base's own commits (and their manifests) are no longer the integration's changes. Read again at every record.
  const mergeBase = (): string => must(wt, ["merge-base", headSha, base], paths.worktree).trim();
  let baseSha = mergeBase();
  let confirmedAt = previous?.depsConfirmedAt ?? null;

  /**
   * The dependency manifests that differ between two commits in a way an install sees (installRelevantChange), once
   * each, sorted.
   */
  const manifestsBetween = (from: string, to: string, what: string): string[] => {
    const diff = wt(["diff", "--name-only", "-z", "--no-renames", "--no-ext-diff", from, to, "--"]);
    if (diff.code !== 0) throw new ArbabError("git", `cannot list the files ${what} (${diff.code}): ${output(diff)}`);
    return installRelevantPaths(wt, from, to, diff.stdout.split("\0").filter((p) => p !== ""));
  };
  // A confirmation covers the head it was given at and later commits that change no manifest.
  const stillConfirmed = (at: string): boolean =>
    commitOf(wt, at, paths.worktree) !== null &&
    isAncestor(wt, at, headSha, paths.worktree) &&
    manifestsBetween(at, headSha, `${paths.branch} changed since ${at}`).length === 0;

  const record = (): IntegrationRecord => {
    baseSha = mergeBase();
    // Every commit on the branch counts, not only arbab's merges: a hand-resolved conflict or a merge whose record
    // was lost changes manifests too.
    const manifests = manifestsBetween(baseSha, headSha, `${paths.branch} changed since ${baseSha}`);
    if (confirmedAt !== null && !stillConfirmed(confirmedAt)) confirmedAt = null;
    const depsConfirmedAt = confirmedAt;
    const rec: IntegrationRecord = {
      name: paths.name,
      branch: paths.branch,
      worktree: paths.worktree,
      base,
      baseSha,
      merged: [...merged],
      manifests,
      depsConfirmedAt,
      depsConfirmed: manifests.length === 0 || depsConfirmedAt !== null,
      headSha,
      updatedAt: isoAt(input.clock),
    };
    writeJsonAtomic(paths.integration, rec);
    return rec;
  };
  record();

  const alreadyIn: string[] = [];
  for (const lane of lanes) {
    const branch = `arbab/${lane}`;
    const sha = commitOf(wt, `refs/heads/${branch}`, paths.worktree);
    if (sha === null) throw new ArbabError("git", `cannot integrate ${lane}: branch ${branch} does not exist`);
    if (isAncestor(wt, sha, headSha, paths.worktree)) {
      // Recorded all the same, or readiness would never list the lane's reports. Its manifests are what its own
      // commits changed.
      alreadyIn.push(lane);
      if (merged.some((m) => m.lane === lane && m.sha === sha)) continue;
      // What `git diff <base>...<sha>` compares: the lane's fork point with the base, and the lane.
      const fork = must(wt, ["merge-base", baseSha, sha], paths.worktree).trim();
      const manifests = manifestsBetween(fork, sha, `${lane} changed since ${baseSha}`);
      merged = oneEntryPerLane([...merged, { lane, branch, sha, manifests }]);
      record();
      continue;
    }

    const r = wt(["merge", "--no-ff", "--no-edit", "--no-verify", "-m", `arbab: integrate ${lane} into ${paths.branch}`, sha]);
    if (r.code !== 0) {
      const unmerged = wt(["diff", "--name-only", "-z", "--diff-filter=U"]);
      const conflicts = unmerged.code === 0 ? unmerged.stdout.split("\0").filter((p) => p !== "") : [];
      // Nothing to abort when the merge refused to start; the error below says why.
      wt(["merge", "--abort"]);
      const kept = merged.length > 0 ? `; ${merged.map((m) => m.lane).join(", ")} stay merged` : "";
      if (conflicts.length > 0) {
        throw new ArbabError("git", `integrating ${lane} into ${paths.branch} conflicts in ${conflicts.join(", ")}; the merge was aborted${kept}`);
      }
      throw new ArbabError("git", `integrating ${lane} into ${paths.branch} failed (${r.code}): ${output(r)}; the merge was aborted${kept}`);
    }

    // What the merge changed on the integration branch: the lane's own changes, not every difference between them.
    const before = headSha;
    headSha = head();
    const manifests = manifestsBetween(before, headSha, `${lane} changed in ${paths.branch}`);
    // A lane merged again (its branch moved on) keeps one entry.
    merged = oneEntryPerLane([...merged, { lane, branch, sha, manifests }]);
    record();
  }
  return { record: record(), alreadyIn };
}

export interface AdoptInput extends Omit<IntegrateInput, "lanes"> {
  /** The branch or commit the integration takes as its head. */
  ref: string;
  /** The branch it lands into; config.baseBranch when absent. */
  base?: string;
}

function assertRevision(rev: string, what: string): void {
  if (rev === "" || rev.startsWith("-") || /\s/.test(rev)) throw new ArbabError("usage", `${what} ${JSON.stringify(rev)} is not a valid revision`);
}

/**
 * Makes a new integration of an existing branch (`integrate <name> --adopt <ref>`): integrate/<name> ends at the
 * commit `ref` names, with no lane merged, so work done outside lanes gets verify, review and land. The worktree is
 * created and its dependencies prepared at the fork point of `ref` and the base, a commit of the base and so trusted,
 * and then fast-forwarded to `ref` with hooks off: `ref` may hold anyone's code. Its manifests are recorded as for any
 * integration. Refused before anything is created: a name that has an integration record, branch or worktree, a landed
 * name, a ref or base that names no commit or that share no history, a base that is not a branch (land merges into
 * it), a base config.baseBranch does not contain, and a fork point isTrustedInstallPoint does not trust.
 */
export function adoptIntegration(input: AdoptInput): IntegrateResult {
  const paths = integrationPaths(input.projectRoot, input.config, input.name);
  const { git, projectRoot } = input;
  const base = input.base ?? input.config.baseBranch;
  assertRevision(input.ref, "--adopt");
  assertRevision(base, input.base === undefined ? "baseBranch" : "--base");

  refuseLanded(paths);
  refuseLaneWorktree(paths, git);
  const existing = [
    existsSync(paths.integration) ? paths.integration : null,
    commitOf(git, `refs/heads/${paths.branch}`, projectRoot) !== null ? `branch ${paths.branch}` : null,
    existsSync(paths.worktree) ? paths.worktree : null,
  ].filter((e) => e !== null);
  if (existing.length > 0) {
    throw new ArbabError("usage", `integration ${paths.name} already exists (${existing.join(", ")}); choose a new name to adopt ${input.ref}`);
  }
  const sha = commitOf(git, input.ref, projectRoot);
  if (sha === null) throw new ArbabError("usage", `--adopt ${input.ref} does not name a commit`);
  const baseSha = commitOf(git, base, projectRoot);
  if (baseSha === null) throw new ArbabError("usage", `base ${base} does not name a commit`);
  // The record keeps the base as the branch land merges into; a commit there would make an integration that never lands.
  // show-ref, not rev-parse: rev-parse would accept an expression such as `main~0`, which is no branch land can be on.
  if (git(["show-ref", "--verify", "--quiet", `refs/heads/${base}`], projectRoot).code !== 0) {
    throw new ArbabError(
      "usage",
      `${input.base === undefined ? "baseBranch" : "--base"} ${base} is not a branch: land merges the integration into its base, so the base must be a branch`,
    );
  }
  // The install runs on the host at the fork point, which only a base inside the trusted base branch keeps trusted
  // (DESIGN.md §9, §17); a lane or integration branch as --base would install worker code.
  const trusted = input.config.baseBranch;
  assertRevision(trusted, "baseBranch");
  if (!isAncestor(git, baseSha, trusted, projectRoot)) {
    throw new ArbabError(
      "usage",
      `${input.base === undefined ? "baseBranch" : "--base"} ${base} is not contained in ${trusted}: arbab installs dependencies only on a commit of ${trusted}, and ` +
        `${base} may hold worker code. Adopt against ${trusted}, or a branch it contains`,
    );
  }
  const fork = git(["merge-base", sha, baseSha], projectRoot);
  if (fork.code !== 0 || !SHA.test(fork.stdout.trim())) {
    if (fork.code === 1) throw new ArbabError("usage", `${input.ref} shares no history with ${base}: there is nothing to land it into`);
    throw new ArbabError("git", `git merge-base ${sha} ${baseSha} failed (${fork.code}): ${output(fork)}`);
  }
  const start = fork.stdout.trim();
  const trust = { projectRoot, baseBranch: trusted, confirmed: confirmedHeads(projectRoot, input.config, git), git };
  if (!isTrustedInstallPoint(start, trust)) {
    throw new ArbabError(
      "usage",
      `the fork point ${start} of ${input.ref} and ${base} is not a trusted install point (a commit of ${trusted} or an ` +
        "integration head a human confirmed), so arbab will not install dependencies there",
    );
  }

  must(git, ["worktree", "prune"], projectRoot);
  ensureDir(dirname(paths.worktree));
  must(git, ["worktree", "add", "-b", paths.branch, paths.worktree, start], projectRoot);
  try {
    const deps = prepareDependencies(input.config.dependencies, paths.worktree, input.runCommand);
    if (!deps.ok) {
      const tail = deps.output.trim().split("\n").slice(-5).join("\n");
      throw new ArbabError("runtime", `dependencies failed in ${paths.worktree} (${deps.code}): ${tail}`);
    }
    if (sha !== start) {
      const prefix = [...explicitGit(ownedGitDir(paths, git), paths.worktree), ...untrustedTree()];
      must(git, [...prefix, "merge", "--ff-only", "--no-verify", sha], paths.worktree);
    }
  } catch (err) {
    // Without the worktree and the branch, adopting again starts over.
    removeWorktree(git, paths);
    git([...untrustedTree(), "branch", "-D", paths.branch], projectRoot);
    throw err;
  }
  return integrate({ ...input, config: { ...input.config, baseBranch: base }, lanes: [] });
}

/**
 * Records an existing integration's head again (`integrate <name> --refresh`) after a hand commit or a base merge in
 * its worktree, adopted or not: merged entries the head still holds stay, manifests, baseSha, headSha and updatedAt are
 * recomputed as integrate does. Nothing is merged and no dependency runs. Refused: no record, a landed integration, a
 * missing worktree (recreating it would install), and tracked changes in the worktree (they are not the head).
 */
export function refreshIntegration(input: Omit<IntegrateInput, "lanes">): IntegrateResult {
  const paths = integrationPaths(input.projectRoot, input.config, input.name);
  refuseLanded(paths);
  if (readIntegration(paths) === null) {
    throw new ArbabError("usage", `integration ${paths.name} does not exist; run arbab integrate ${paths.name} with its lanes, or --adopt <ref>`);
  }
  if (!existsSync(paths.worktree)) {
    throw new ArbabError("usage", `integration ${paths.name} has no worktree at ${paths.worktree}; restore it on ${paths.branch} to refresh`);
  }
  const tracked = worktreeStatus(paths.worktree, ownedGitDir(paths, input.git), input.git)
    .filter((l) => !l.startsWith("?? "))
    .map((l) => l.slice(3));
  if (tracked.length > 0) {
    const shown = tracked.slice(0, 5).join(", ") + (tracked.length > 5 ? ` and ${tracked.length - 5} more` : "");
    throw new ArbabError(
      "usage",
      `integration ${paths.name} has uncommitted changes in ${paths.worktree} (${shown}); commit or discard them, then refresh`,
    );
  }
  return integrate({ ...input, lanes: [] });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

function isMergedEntry(v: unknown): v is IntegrationRecord["merged"][number] {
  return (
    isRecord(v) &&
    typeof v["lane"] === "string" &&
    typeof v["branch"] === "string" &&
    typeof v["sha"] === "string" &&
    isStringArray(v["manifests"])
  );
}

/** Every manifest the merged lanes changed, once each, sorted: what a record from before `manifests` reads as. */
function mergedManifests(merged: IntegrationRecord["merged"]): string[] {
  return [...new Set(merged.flatMap((m) => m.manifests))].sort();
}

const isOptional = (v: unknown, check: (v: unknown) => boolean): boolean => v === undefined || check(v);

/**
 * integration.json, or null before the first `integrate`. A file of another shape is an error. A record written before
 * `manifests` and `depsConfirmedAt` existed reads as its merged lanes' manifests with no confirmation on file, so a
 * human confirms again; `depsConfirmed` is always derived from the two.
 */
export function readIntegration(paths: IntegrationPaths): IntegrationRecord | null {
  const raw = readJson<unknown>(paths.integration);
  if (raw === null) return null;
  const ok =
    isRecord(raw) &&
    raw["name"] === paths.name &&
    typeof raw["branch"] === "string" &&
    typeof raw["worktree"] === "string" &&
    typeof raw["base"] === "string" &&
    typeof raw["baseSha"] === "string" &&
    Array.isArray(raw["merged"]) &&
    raw["merged"].every(isMergedEntry) &&
    isOptional(raw["manifests"], isStringArray) &&
    isOptional(raw["depsConfirmedAt"], (v) => v === null || (typeof v === "string" && SHA.test(v))) &&
    typeof raw["depsConfirmed"] === "boolean" &&
    typeof raw["headSha"] === "string" &&
    typeof raw["updatedAt"] === "string";
  if (!ok) throw new ArbabError("io", `${paths.integration} is not an integration record for ${paths.name}`);
  const stored = raw as unknown as Omit<IntegrationRecord, "manifests" | "depsConfirmedAt"> &
    Partial<Pick<IntegrationRecord, "manifests" | "depsConfirmedAt">>;
  const manifests = stored.manifests ?? mergedManifests(stored.merged);
  const depsConfirmedAt = stored.depsConfirmedAt ?? null;
  return { ...stored, manifests, depsConfirmedAt, depsConfirmed: manifests.length === 0 || depsConfirmedAt !== null };
}

/** The command that confirms the dependencies of `name` at `sha`, as the advice and the refusals print it. */
export function confirmCommand(name: string, sha: string): string {
  return `arbab integrate ${name} --deps-installed ${sha}`;
}

/**
 * Records that a human reviewed and installed the changed dependencies (`integrate --deps-installed <sha>`) at `sha`,
 * the head whose manifests `integrate` listed to them. Refused unless both the record and the branch are still at that
 * head: a concurrent `integrate` can move them between the review and the confirmation, and the human was not shown
 * what the new commits changed. With no manifest changed there is nothing to confirm, and the record is returned
 * unchanged. arbab never installs after a merge: that would run worker code on the host.
 */
export function confirmDeps(paths: IntegrationPaths, sha: string, git: GitRunner, clock: Clock): IntegrationRecord {
  refuseLanded(paths);
  const previous = readIntegration(paths);
  if (previous === null) throw new ArbabError("usage", `integration ${paths.name} does not exist; run arbab integrate first`);
  if (!SHA.test(sha)) {
    throw new ArbabError(
      "usage",
      `--deps-installed takes the full head sha arbab integrate printed, not ${JSON.stringify(sha)}; the recorded head ` +
        `is ${previous.headSha}: review its manifests, then run ${confirmCommand(paths.name, previous.headSha)}`,
    );
  }
  if (sha !== previous.headSha) {
    throw new ArbabError(
      "usage",
      `integration ${paths.name} records head ${previous.headSha}, not ${sha}: it moved since you reviewed it. Review the ` +
        `manifests arbab integrate ${paths.name} lists for ${previous.headSha} (run it again with its lanes), then run ` +
        confirmCommand(paths.name, previous.headSha),
    );
  }
  const headSha = commitOf(git, `refs/heads/${paths.branch}`, paths.projectRoot);
  if (headSha === null) throw new ArbabError("git", `branch ${paths.branch} does not exist`);
  if (headSha !== previous.headSha) {
    throw new ArbabError(
      "usage",
      `${paths.branch} is at ${headSha}, not ${previous.headSha}, the head whose manifests arbab integrate listed; run ` +
        `arbab integrate ${paths.name} --refresh (or with its lanes) again, review the manifests it lists, then run the ` +
        `arbab integrate ${paths.name} --deps-installed <sha> it prints`,
    );
  }
  if (previous.manifests.length === 0) return previous;
  const rec: IntegrationRecord = { ...previous, depsConfirmedAt: headSha, depsConfirmed: true, updatedAt: isoAt(clock) };
  writeJsonAtomic(paths.integration, rec);
  return rec;
}
