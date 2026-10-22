// arbab land <name> [--squash] [--message <file>] [--keep-worktrees] [--json]
//
// Merges integrate/<name> into the integration's recorded base branch (`--no-ff`, message `Land <name>`, hooks
// disabled) once readiness says it is ready for the integration's current head and verify passed there (DESIGN.md
// §17). --squash (or config landing.squash) makes one commit holding the head's tree instead (`merge --squash`, then a
// commit, hooks disabled; DESIGN.md §21). --message <file> (absolute or project-relative, inside the project, no
// credential file by the fence's list and config.credentialPaths, not empty) is the commit message of either. It never pushes: push and deploy are human actions. The skill asks the human before running it.
// Refuses (exit 1) without a ready readiness.json for the integration head, when that report is older than the
// verify.json or review.json of the same head or was checked below config.landing.tier, without a passed verify.json
// for the head, when the head is already in the base or landing.json exists, when the branch moved since, unless the main checkout (the
// project root) is on the recorded base with no tracked change and no untracked file where the merge writes, and
// unless the base's HEAD is in the verified head (otherwise the merge would hold a tree nobody verified).
// Writes .arbab/integrations/<name>/landing.json (LandingRecord, pushed: false, with squash and the lanes it carried).
// Then, unless --keep-worktrees, it removes the worktrees of the finished merged lanes, of the lanes generated for the
// integration and of the integration itself, by `cleanup --worktrees`' rules (after a squash, against the landed head),
// and deletes the generated lanes' branches and integrate/<name>. Merged lanes keep arbab/<lane>: a later plan phase
// merges it by name. What cannot go is kept and reported, never a failure.
// Text: `landed <name>: <head> into <base> as <merge sha>`, then `Not pushed. To publish: git push <remote> <base>`,
// then `left alone: <paths>` when untracked files stayed in the main checkout (the first five), then cleanup's lines
// (`removed worktree <path>`, `deleted branch <branch>`, `kept worktree <path>: <reason>`, …).
// Before it merges, a `warning:` line on stderr for each other session the landing affects (otherSessions: its lanes
// and waiters in this project, or the runner files of this project it runs elsewhere); it never blocks on them.
// --json: {"landing": LandingRecord, "remote": string | null, "push": string[] | null,
//          "cleanup": WorktreeCleanup | null (null with --keep-worktrees), "leftAlone": string[],
//          "otherSessions": SessionActivity[]}
// Exit 0; 1 on a refusal; 2 when the merge fails (it is aborted).
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { credentialMatcher, credentialReason, homeSpellings, type CredentialHit } from "../profile";
import { otherSessions, sessionOf, sessionText } from "../registry";
import { untrustedTree, type GitRunner } from "../run";
import { TIERS } from "../types";
import type { LandingRecord, ReadinessReport, ReviewRecord, SessionActivity, Tier, VerifyRecord } from "../types";
import { ArbabError } from "../util/errors";
import { confine, writeJsonAtomic } from "../util/fs";
import { assertValidName } from "../util/names";
import { isoAt } from "../util/proc";
import { emptyWorktreeCleanup, formatWorktreeCleanup, removeIntegrationWorktree, removeLaneWorktrees, type WorktreeCleanup } from "./cleanup";
import type { CommandContext } from "./context";
import { lanesGeneratedBy } from "./generated";
import { branchHead, openIntegration, type Integration } from "./integration";
import { onePositional, openProject, parse, printJson, type Project } from "./project";
import { readReadinessReport, readReviewRecord, readVerifyRecord } from "./records";

const refuse = (message: string): ArbabError => new ArbabError("usage", `not landed: ${message}`);

function gitOut(git: GitRunner, args: string[], cwd: string): string {
  const r = git(args, cwd);
  if (r.code !== 0) throw new ArbabError("git", `git ${args.join(" ")} failed (${r.code}): ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}

/** The first remote `git remote` lists, or null when there is none. */
export function firstRemote(git: GitRunner, root: string): string | null {
  const r = git(["remote"], root);
  if (r.code !== 0) return null;
  return r.stdout.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? null;
}

/** `git status --porcelain -z` entries (`XY path`), without the source path a rename or copy adds after its entry. */
function porcelainEntries(out: string): string[] {
  const tokens = out.split("\0");
  const entries: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i] ?? "";
    if (entry.length < 4) continue;
    entries.push(entry);
    if (/[RC]/.test(entry.slice(0, 2))) i++;
  }
  return entries;
}

/** The project-relative paths `git diff <revs>` touches, both sides of a rename included. */
export function changedPaths(git: GitRunner, root: string, revs: readonly string[]): string[] {
  return gitOut(git, ["diff", "--name-only", "-z", "--no-renames", "--no-ext-diff", ...revs, "--"], root)
    .split("\0")
    .filter((p) => p !== "");
}

/** The other sessions a landing that changes `changed` affects, seen from this CLI's session. */
export function sessionsAffected(ctx: CommandContext, root: string, changed: readonly string[]): SessionActivity[] {
  return otherSessions({ home: ctx.home, projectRoot: root, session: sessionOf(ctx.hostEnv), alive: ctx.alive, changed });
}

const firstFive = (items: string[], sep: string): string =>
  items.slice(0, 5).join(sep) + (items.length > 5 ? `${sep}and ${items.length - 5} more` : "");

/**
 * Refuses unless the main checkout is on the base branch with no tracked change, and with no untracked path the merge
 * of `head` writes: one it adds, or one under a directory it creates (git lists a directory without tracked files as
 * `dir/`). Returns the other untracked paths, which the landing leaves alone.
 */
export function assertCleanBase(git: GitRunner, root: string, base: string, head: string): string[] {
  const r = git(["symbolic-ref", "--quiet", "--short", "HEAD"], root);
  const branch = r.code === 0 ? r.stdout.trim() : null;
  if (branch !== base) throw refuse(`the main checkout ${root} is on ${branch ?? "a detached HEAD"}, not ${base}`);
  // Explicit, so a status.showUntrackedFiles in the owner's config does not change what is listed.
  const status = porcelainEntries(gitOut(git, ["status", "--porcelain", "-z", "--untracked-files=normal"], root));
  const tracked = status.filter((e) => !e.startsWith("?? "));
  if (tracked.length > 0) throw refuse(`the main checkout ${root} has uncommitted changes (${firstFive(tracked, "; ")})`);
  const untracked = status.map((e) => e.slice(3));
  if (untracked.length === 0) return [];
  const written = changedPaths(git, root, ["HEAD", head]);
  const collides = (u: string): boolean => written.some((p) => (u.endsWith("/") ? p.startsWith(u) : p === u || p.startsWith(`${u}/`)));
  const blocking = untracked.filter(collides);
  if (blocking.length > 0) {
    throw refuse(`the main checkout ${root} has untracked files where the merge writes (${firstFive(blocking, "; ")}); move them away and land again`);
  }
  return untracked;
}

/**
 * The commit message `--message <file>` names (absolute or project-relative): it must exist, not be blank, lie inside
 * the project (after resolving symlinks too) and be no path `credential` hits by either spelling, so a landing cannot
 * carry credentials into a commit.
 */
export function readMessage(root: string, file: string, credential: (path: string, root?: string) => CredentialHit | null): string {
  let path: string;
  try {
    path = confine(root, file);
  } catch {
    throw refuse(`the --message file ${file} is outside the project ${resolve(root)}`);
  }
  // Name rules look below the project root: a project kept under `~/.envs/` is no credential file.
  const hit = credential(path, root);
  if (hit !== null) throw refuse(`the --message file ${path} ${credentialReason(hit)}`);
  let text: string;
  try {
    const real = realpathSync(path);
    const realRoot = realpathSync(root);
    try {
      confine(realRoot, real);
    } catch {
      throw refuse(`the --message file ${path} resolves outside the project`);
    }
    const realHit = credential(real, realRoot);
    if (realHit !== null) throw refuse(`the --message file ${path} resolves to ${real}, which ${credentialReason(realHit)}`);
    text = readFileSync(real, "utf8");
  } catch (err) {
    if (err instanceof ArbabError) throw err;
    throw refuse(`cannot read the --message file ${path}: ${(err as Error).message}`);
  }
  if (text.trim() === "") throw refuse(`the --message file ${path} is empty`);
  return text;
}

/**
 * Refuses unless the base checkout's HEAD is in the verified head: only then does the merge commit hold exactly the
 * tree that was verified. A base that moved on would land a tree nobody verified.
 */
export function assertBaseInHead(git: GitRunner, root: string, base: string, head: string, name: string, worktree: string): void {
  const r = git(["merge-base", "--is-ancestor", "HEAD", head], root);
  if (r.code === 0) return;
  if (r.code !== 1) throw new ArbabError("git", `git merge-base --is-ancestor HEAD ${head} failed (${r.code}): ${(r.stderr || r.stdout).trim()}`);
  // The integration worktree holds worker code: the merge the human runs there gets the same git options as arbab's
  // own, or a worker-written hook (a relative core.hooksPath) would run on the host.
  throw refuse(
    `${base} moved since the integration was verified: its HEAD is not in ${head}, so the merge would hold a tree ` +
      `nobody verified. Merge ${base} into integrate/${name} with hooks off: git -C ${worktree} ${untrustedTree().join(" ")} ` +
      `merge --no-verify --no-edit ${base}; then arbab integrate ${name} --refresh to record the new head, and verify, ` +
      `review and readiness for ${name} again`,
  );
}

/** False when `later` is not a time at or after `earlier`, an unreadable time included. */
const notBefore = (later: string, earlier: string): boolean => Date.parse(later) >= Date.parse(earlier);

/**
 * Refuses a readiness report written before the verify or review record of the same head it would have read: it
 * decided on older evidence than what is on disk now. A review carried over from an earlier head counts as the review
 * of its head.
 */
export function assertReadinessCurrent(
  readiness: ReadinessReport,
  verify: VerifyRecord | null,
  review: ReviewRecord | null,
  name: string,
): void {
  for (const [what, record, at, heads] of [
    ["verify", verify, verify?.finishedAt, [readiness.headSha]],
    ["review", review, review?.finishedAt, [readiness.headSha, readiness.reviewCarriedOverFrom]],
  ] as const) {
    if (record === null || at === undefined || !heads.includes(record.headSha)) continue;
    if (!notBefore(readiness.createdAt, at)) {
      throw refuse(`the readiness report (${readiness.createdAt}) is older than ${what}.json (${at}); run arbab readiness ${name} again`);
    }
  }
}

/** Refuses a readiness report checked against a lower tier than the project lands at. */
export function assertTier(readiness: ReadinessReport, required: Tier, name: string): void {
  if (TIERS.indexOf(readiness.tier) < TIERS.indexOf(required)) {
    throw refuse(`readiness was checked at tier ${readiness.tier}, below the landing tier ${required}; run arbab readiness ${name} --tier ${required}`);
  }
}

export async function runLand(argv: string[], ctx: CommandContext): Promise<number> {
  const { values, positionals } = parse("land", {
    args: argv,
    options: { "keep-worktrees": { type: "boolean" }, squash: { type: "boolean" }, message: { type: "string" }, json: { type: "boolean" } },
    allowPositionals: true,
  });
  const name = assertValidName(onePositional("land", positionals, "name"), "integration");
  const project = openProject(ctx);
  // ctx.home is ~/.arbab.
  const credential = credentialMatcher(project.config.credentialPaths, homeSpellings(dirname(ctx.home)));
  const message = values.message === undefined ? `Land ${name}` : readMessage(project.root, values.message, credential);
  const squash = values.squash ?? project.config.landing.squash;
  const { paths, record } = openIntegration(project, name);
  // The branch the integration was built against and readiness judged, even if config.baseBranch changed since.
  const base = record.base;
  const head = record.headSha;

  const readiness = readReadinessReport(paths.readiness, name);
  if (readiness === null) throw refuse(`no readiness report; run arbab readiness ${name}`);
  if (readiness.headSha !== head) throw refuse(`the readiness report is for ${readiness.headSha}, the integration head is ${head}; run arbab readiness ${name} again`);
  if (!readiness.ready) {
    const open = readiness.skipped.filter((s) => !s.waived).map((s) => s.id);
    throw refuse(`readiness is not ready${open.length > 0 ? ` (unwaived: ${open.join(", ")})` : ""}`);
  }
  assertTier(readiness, project.config.landing.tier, name);
  const verify = readVerifyRecord(paths.verify, name);
  if (verify === null || verify.headSha !== head || !verify.passed) throw refuse(`verify has not passed on ${head}; run arbab verify ${name}`);
  assertReadinessCurrent(readiness, verify, readReviewRecord(paths.review, name), name);
  const leftAlone = assertCleanBase(ctx.git, project.root, base, head);
  // Before the branch check: a landing deletes integrate/<name>, and landing again should say why it is refused.
  if (ctx.git(["merge-base", "--is-ancestor", head, "HEAD"], project.root).code === 0) throw refuse(`${head} is already in ${base}`);
  // A squash landing leaves the head out of the base: the record is what says it landed.
  if (existsSync(paths.landing)) throw refuse(`${name} already landed (${paths.landing})`);
  const branchAt = branchHead(ctx.git, project.root, paths.branch);
  if (branchAt !== head) throw refuse(`${paths.branch} is at ${branchAt ?? "no commit"}, not the verified head ${head}`);
  assertBaseInHead(ctx.git, project.root, base, head, name, paths.worktree);

  // Said, never enforced: the human decided to land, and the other sessions only need to hear it first.
  let sessions: SessionActivity[] = [];
  try {
    sessions = sessionsAffected(ctx, project.root, changedPaths(ctx.git, project.root, ["HEAD", head]));
    for (const activity of sessions) ctx.stderr(`warning: ${sessionText(activity)}\n`);
  } catch (err) {
    ctx.stderr(`warning: cannot tell which other sessions this landing affects: ${(err as Error).message}\n`);
  }

  // By sha, so exactly the verified commit lands even if the branch moves meanwhile. Without hooks: the merge brings
  // in worker code, and a hook would run it on the host.
  if (squash) squashLand(ctx, project.root, head, message, `squashing ${paths.branch} into ${base}`);
  else {
    const merge = ctx.git([...untrustedTree(), "merge", "--no-ff", "--no-edit", "-m", message, head], project.root);
    if (merge.code !== 0) {
      ctx.git([...untrustedTree(), "merge", "--abort"], project.root);
      throw new ArbabError("git", `merging ${paths.branch} into ${base} failed (${merge.code}): ${(merge.stderr || merge.stdout).trim()}; the merge was aborted`);
    }
  }
  const mergeSha = gitOut(ctx.git, ["rev-parse", "HEAD"], project.root).trim();
  const landing: LandingRecord = {
    name,
    into: base,
    integrationHead: head,
    mergeSha,
    landedAt: isoAt(ctx.clock),
    pushed: false,
    squash,
    lanes: record.merged.map((m) => ({ lane: m.lane, sha: m.sha })),
  };
  writeJsonAtomic(paths.landing, landing);
  const cleanup = values["keep-worktrees"] === true ? null : cleanUpLanded(ctx, project, { paths, record }, landing);

  const remote = firstRemote(ctx.git, project.root);
  if (values.json === true) {
    printJson(ctx, {
      landing,
      remote,
      push: remote === null ? null : ["git", "push", remote, base],
      cleanup,
      leftAlone,
      otherSessions: sessions,
    });
  } else {
    ctx.stdout(`landed ${name}: ${head} into ${base} as ${mergeSha}\n`);
    ctx.stdout(`Not pushed. To publish: git push ${remote ?? "<remote>"} ${base}${remote === null ? " (no remote configured)" : ""}\n`);
    if (leftAlone.length > 0) ctx.stdout(`left alone: ${firstFive(leftAlone, ", ")}\n`);
    for (const line of cleanup === null ? [] : formatWorktreeCleanup(cleanup)) ctx.stdout(line + "\n");
  }
  return 0;
}

/**
 * One commit on the base holding the tree of `head`: `merge --squash`, then a commit, both with hooks off. A failure
 * resets what the squash staged and throws.
 */
function squashLand(ctx: CommandContext, root: string, head: string, message: string, what: string): void {
  const fail = (r: { code: number; stdout: string; stderr: string }): ArbabError => {
    ctx.git([...untrustedTree(), "reset", "--merge"], root);
    return new ArbabError("git", `${what} failed (${r.code}): ${(r.stderr || r.stdout).trim()}; the squash was reset`);
  };
  const staged = ctx.git([...untrustedTree(), "merge", "--squash", head], root);
  if (staged.code !== 0) throw fail(staged);
  // --allow-empty: a head whose tree equals the base's still lands as one commit, as a merge would.
  const commit = ctx.git([...untrustedTree(), "commit", "--no-verify", "--allow-empty", "-m", message], root);
  if (commit.code !== 0) throw fail(commit);
}

/**
 * After a landing: the worktrees of the merged lanes and of the lanes generated for the integration (with the
 * generated lanes' branches), then the integration's worktree and branch, by cleanup's rules. Never throws: the
 * landing already happened, so a problem is only reported. Run dirs, the merged lanes' branches and the
 * integration's records stay.
 * After a squash landing nothing of the integration is an ancestor of the base, so what landed is read from the
 * record: a branch counts as landed when the landed integration head holds it, and the integration's and generated
 * lanes' branches that `git branch -d` keeps for not being in the base are deleted where they still point.
 */
export function cleanUpLanded(
  ctx: CommandContext,
  project: Project,
  integration: Integration,
  landing?: Pick<LandingRecord, "squash" | "integrationHead">,
): WorktreeCleanup {
  const { paths, record } = integration;
  const out = emptyWorktreeCleanup();
  try {
    const generated = lanesGeneratedBy(project.runsRoot, paths.name);
    const lanes = [...record.merged.map((m) => m.lane), ...generated];
    const landed = landing?.squash === true ? landing.integrationHead : record.base;
    removeLaneWorktrees(ctx, project, lanes, landed, out);
    removeIntegrationWorktree(ctx, project, paths, landed, out);
    if (landing?.squash === true) deleteSquashedBranches(ctx, project.root, [...generated.map((g) => `arbab/${g}`), paths.branch], landing.integrationHead, out);
  } catch (err) {
    out.warnings.push((err as Error).message);
  }
  return out;
}

/**
 * The branches among `branches` that cleanup kept because `git branch -d` refused them, deleted when the landed head
 * holds their commit and no worktree has them checked out; `update-ref -d` with that commit, so a branch that moves
 * meanwhile stays.
 */
function deleteSquashedBranches(ctx: CommandContext, root: string, branches: string[], landedHead: string, out: WorktreeCleanup): void {
  const listed = ctx.git(["worktree", "list", "--porcelain"], root);
  if (listed.code !== 0) return;
  const checkedOut = new Set(listed.stdout.split("\n").filter((l) => l.startsWith("branch ")).map((l) => l.slice("branch ".length)));
  for (const kept of [...out.branchesKept]) {
    if (!branches.includes(kept.branch) || !kept.reason.startsWith("git branch -d failed")) continue;
    const ref = `refs/heads/${kept.branch}`;
    const sha = branchHead(ctx.git, root, kept.branch);
    if (sha === null || checkedOut.has(ref)) continue;
    if (ctx.git(["merge-base", "--is-ancestor", sha, landedHead], root).code !== 0) continue;
    if (ctx.git([...untrustedTree(), "update-ref", "-d", ref, sha], root).code !== 0) continue;
    out.branchesKept.splice(out.branchesKept.indexOf(kept), 1);
    out.branchesDeleted.push(kept.branch);
  }
}
