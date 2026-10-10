// arbab land <name> [--keep-worktrees] [--json]
//
// Merges integrate/<name> into the integration's recorded base branch (`--no-ff`, message `Land <name>`, hooks
// disabled) once readiness says it is ready for the integration's current head and verify passed there (DESIGN.md
// §17). It never pushes: push and deploy are human actions. The skill asks the human before running it.
// Refuses (exit 1) without a ready readiness.json for the integration head, when that report is older than the
// verify.json or review.json of the same head or was checked below config.landing.tier, without a passed verify.json
// for the head, when the head is already in the base, when the branch moved since, unless the main checkout (the
// project root) is on the recorded base with a clean `git status --porcelain`, and unless the base's HEAD is in the
// verified head (otherwise the merge would hold a tree nobody verified).
// Writes .arbab/integrations/<name>/landing.json (LandingRecord, pushed: false). Then, unless --keep-worktrees, it
// removes the worktrees of the finished merged lanes, of the lanes generated for the integration and of the
// integration itself, by `cleanup --worktrees`' rules, and deletes the generated lanes' branches and integrate/<name>.
// Merged lanes keep arbab/<lane>: a later plan phase merges it by name. What cannot go is kept and reported, never a
// failure.
// Text: `landed <name>: <head> into <base> as <merge sha>`, then `Not pushed. To publish: git push <remote> <base>`,
// then cleanup's lines (`removed worktree <path>`, `deleted branch <branch>`, `kept worktree <path>: <reason>`, …).
// --json: {"landing": LandingRecord, "remote": string | null, "push": string[] | null,
//          "cleanup": WorktreeCleanup | null (null with --keep-worktrees)}
// Exit 0; 1 on a refusal; 2 when the merge fails (it is aborted).
import { untrustedTree, type GitRunner } from "../run";
import { TIERS } from "../types";
import type { LandingRecord, ReadinessReport, ReviewRecord, Tier, VerifyRecord } from "../types";
import { ArbabError } from "../util/errors";
import { writeJsonAtomic } from "../util/fs";
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

/** Refuses unless the main checkout is on the base branch with nothing to commit. */
export function assertCleanBase(git: GitRunner, root: string, base: string): void {
  const r = git(["symbolic-ref", "--quiet", "--short", "HEAD"], root);
  const branch = r.code === 0 ? r.stdout.trim() : null;
  if (branch !== base) throw refuse(`the main checkout ${root} is on ${branch ?? "a detached HEAD"}, not ${base}`);
  const status = gitOut(git, ["status", "--porcelain"], root).split("\n").filter((l) => l.trim() !== "");
  if (status.length > 0) {
    const shown = status.slice(0, 5).join("; ") + (status.length > 5 ? `; and ${status.length - 5} more` : "");
    throw refuse(`the main checkout ${root} has uncommitted changes (${shown})`);
  }
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
      `merge --no-verify --no-edit ${base}; then run arbab integrate, verify, review and readiness for ${name} again`,
  );
}

/** False when `later` is not a time at or after `earlier`, an unreadable time included. */
const notBefore = (later: string, earlier: string): boolean => Date.parse(later) >= Date.parse(earlier);

/**
 * Refuses a readiness report written before the verify or review record of the same head it would have read: it
 * decided on older evidence than what is on disk now.
 */
export function assertReadinessCurrent(
  readiness: ReadinessReport,
  verify: VerifyRecord | null,
  review: ReviewRecord | null,
  name: string,
): void {
  for (const [what, record, at] of [
    ["verify", verify, verify?.finishedAt],
    ["review", review, review?.finishedAt],
  ] as const) {
    if (record === null || at === undefined || record.headSha !== readiness.headSha) continue;
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
    options: { "keep-worktrees": { type: "boolean" }, json: { type: "boolean" } },
    allowPositionals: true,
  });
  const name = assertValidName(onePositional("land", positionals, "name"), "integration");
  const project = openProject(ctx);
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
  assertCleanBase(ctx.git, project.root, base);
  // Before the branch check: a landing deletes integrate/<name>, and landing again should say why it is refused.
  if (ctx.git(["merge-base", "--is-ancestor", head, "HEAD"], project.root).code === 0) throw refuse(`${head} is already in ${base}`);
  const branchAt = branchHead(ctx.git, project.root, paths.branch);
  if (branchAt !== head) throw refuse(`${paths.branch} is at ${branchAt ?? "no commit"}, not the verified head ${head}`);
  assertBaseInHead(ctx.git, project.root, base, head, name, paths.worktree);

  // By sha, so exactly the verified commit lands even if the branch moves meanwhile. Without hooks: the merge brings
  // in worker code, and a hook would run it on the host.
  const merge = ctx.git([...untrustedTree(), "merge", "--no-ff", "--no-edit", "-m", `Land ${name}`, head], project.root);
  if (merge.code !== 0) {
    ctx.git([...untrustedTree(), "merge", "--abort"], project.root);
    throw new ArbabError("git", `merging ${paths.branch} into ${base} failed (${merge.code}): ${(merge.stderr || merge.stdout).trim()}; the merge was aborted`);
  }
  const mergeSha = gitOut(ctx.git, ["rev-parse", "HEAD"], project.root).trim();
  const landing: LandingRecord = { name, into: base, integrationHead: head, mergeSha, landedAt: isoAt(ctx.clock), pushed: false };
  writeJsonAtomic(paths.landing, landing);
  const cleanup = values["keep-worktrees"] === true ? null : cleanUpLanded(ctx, project, { paths, record });

  const remote = firstRemote(ctx.git, project.root);
  if (values.json === true) {
    printJson(ctx, { landing, remote, push: remote === null ? null : ["git", "push", remote, base], cleanup });
  } else {
    ctx.stdout(`landed ${name}: ${head} into ${base} as ${mergeSha}\n`);
    ctx.stdout(`Not pushed. To publish: git push ${remote ?? "<remote>"} ${base}${remote === null ? " (no remote configured)" : ""}\n`);
    for (const line of cleanup === null ? [] : formatWorktreeCleanup(cleanup)) ctx.stdout(line + "\n");
  }
  return 0;
}

/**
 * After a landing: the worktrees of the merged lanes and of the lanes generated for the integration (with the
 * generated lanes' branches), then the integration's worktree and branch, by cleanup's rules. Never throws: the
 * landing already happened, so a problem is only reported. Run dirs, the merged lanes' branches and the
 * integration's records stay.
 */
export function cleanUpLanded(ctx: CommandContext, project: Project, integration: Integration): WorktreeCleanup {
  const { paths, record } = integration;
  const out = emptyWorktreeCleanup();
  try {
    const lanes = [...record.merged.map((m) => m.lane), ...lanesGeneratedBy(project.runsRoot, paths.name)];
    removeLaneWorktrees(ctx, project, lanes, record.base, out);
    removeIntegrationWorktree(ctx, project, paths, record.base, out);
  } catch (err) {
    out.warnings.push((err as Error).message);
  }
  return out;
}
