// arbab review <name> [--lenses a,b] [--lens-file <name>=<file>]... [--since <sha>] [--timeout-min N] [--json]
//
// One reviewer lane per lens, <name>-review-<lens>, each in its own worktree on the recorded integration head (installed
// on a trusted commit first, as verify's), diffing against the integration's base commit (DESIGN.md §17), or against
// --since, a commit between the base and the head, to review what changed since a fix round (§21). Lenses default to
// the built-ins plus config review.lenses plus the --lens-file lenses; a --lens-file lens is for this run only, and one
// named like a built-in or config lens replaces that lens's text. Then one skeptic lane per lens with MEDIUM or HIGH
// findings, <name>-skeptic-<lens>, tries to refute them; its verdicts apply to its own lens's findings only. Refuses,
// like verify, while a dependency manifest changed and no human confirmed the install. A re-run waits for, or adopts,
// lanes still running or finished on the same head after an earlier review stopped waiting. While it waits,
// ~/.arbab/waiters/<pid>.json says so (the Stop hook reads it).
// Writes .arbab/integrations/<name>/review.json (ReviewRecord) and the same record as reviews/<round>.json. With
// --lenses, the previous review.json's other lenses (entries, skeptics, findings) are kept when it is of the same head.
// Then the lanes' worktrees and branches are removed, their run dirs and run records kept; not when a wait timed out.
// Text: one line per lane, `<lens>  review|skeptic  <lane>  <end state>[  <n> paths]`, then the findings by verdict:
// a `confirmed (n)` / `refuted (n)` / `unverified (n)` heading and `  <id>  <SEVERITY>  <file>[:<line>]  <title>` lines.
// --json: {"timedOut": boolean, "review": ReviewRecord | null}
// Exit 0 when every lane of this run succeeded, 1 when one did not (review.json is written either way), 3 when the
// reviewers did not finish in time (nothing written) or the skeptics did not (review.json keeps their findings
// unverified).
import { realpathSync } from "node:fs";
import { dirname } from "node:path";
import { credentialMatcher, credentialReason, homeSpellings, type CredentialHit } from "../profile";
import {
  applyVerdicts,
  assertReviewLaneNames,
  collectFindings,
  keepOtherLenses,
  lensFileText,
  lensNames,
  lensText,
  parseLensFileOption,
  reviewerCoverage,
  reviewLane,
  reviewRecord,
  skepticFindings,
  skepticLane,
  writeReviewRound,
} from "../review";
import type { FindingVerdict, ReviewFinding, ReviewRecord } from "../types";
import { ArbabError } from "../util/errors";
import { confine, readText, writeJsonAtomic } from "../util/fs";
import { assertValidName } from "../util/names";
import type { CommandContext } from "./context";
import { splitList } from "./integrate";
import {
  assertRecordedHead,
  dropGeneratedWorktrees,
  generatedBase,
  generationOwner,
  openIntegration,
  runGeneratedLanes,
  settleGeneratedRuns,
  type Integration,
  type LaneOutcome,
} from "./integration";
import { onePositional, openProject, parse, printJson } from "./project";
import { readReviewRecord } from "./records";
import { WAIT_TIMEOUT_EXIT, parseTimeoutMin } from "./wait";

const DEFAULT_TIMEOUT_MIN = 120;
const SHA = /^[0-9a-f]{40,64}$/;

/** What `credentialMatcher` returns. */
type CredentialCheck = (path: string, root?: string) => CredentialHit | null;

/** The lenses to run: --lenses as given (each must be known), or every configured lens. */
export function reviewLenses(option: string | undefined, configLenses: Record<string, string>): string[] {
  const known = lensNames(configLenses);
  if (option === undefined) return known;
  const lenses = [...new Set(splitList(option))];
  if (lenses.length === 0) throw new ArbabError("usage", "--lenses names no lens");
  for (const lens of lenses) {
    if (lensText(lens, configLenses) === null) throw new ArbabError("usage", `unknown lens ${lens} (known: ${known.join(", ")})`);
  }
  return lenses;
}

/**
 * Where a lens file is: inside the project root by its path and by its real path, so neither an absolute path nor a
 * symlink pulls a file from elsewhere into a reviewer's brief; never a path `credential` hits, by either spelling.
 */
function lensFilePath(root: string, name: string, file: string, credential: CredentialCheck): string {
  const refuse = (why: string): ArbabError => new ArbabError("usage", `--lens-file ${name}=${file}: ${why}`);
  let path: string;
  try {
    path = confine(root, file);
  } catch {
    throw refuse("the file must be inside the project root");
  }
  // Name rules look below the project root: a project kept under `~/.envs/` is no credential file.
  const hit = credential(path, root);
  if (hit !== null) throw refuse(`the file ${credentialReason(hit)}; a credential file is not a lens`);
  let real: string;
  let realRoot: string;
  try {
    real = realpathSync(path);
    realRoot = realpathSync(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new ArbabError("usage", `the file of lens ${name}, ${file}, does not exist`);
    throw new ArbabError("usage", `cannot read the file of lens ${name}, ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    confine(realRoot, real);
  } catch {
    throw refuse("the file must be inside the project root, and a symlink in it may not lead out");
  }
  const realHit = credential(real, realRoot);
  if (realHit !== null) throw refuse(`the file resolves to ${real}, which ${credentialReason(realHit)}; a credential file is not a lens`);
  return real;
}

/**
 * The --lens-file lenses by name, each text read from its file, a path inside the project root that is no credential
 * file (lensFilePath). Nothing is written to the config.
 */
export function readLensFiles(root: string, options: readonly string[], credential: CredentialCheck): Record<string, string> {
  const lenses: Record<string, string> = {};
  for (const option of options) {
    const { name, file } = parseLensFileOption(option);
    if (Object.hasOwn(lenses, name)) throw new ArbabError("usage", `--lens-file names lens ${name} twice`);
    const path = lensFilePath(root, name, file, credential);
    let text: string | null;
    try {
      text = readText(path);
    } catch (err) {
      throw new ArbabError("usage", `cannot read the file of lens ${name}, ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (text === null) throw new ArbabError("usage", `the file of lens ${name}, ${file}, does not exist`);
    lenses[name] = lensFileText(name, text);
  }
  return lenses;
}

/** `--since <rev>`: the commit it names, which must be an ancestor of the head and not the head itself. */
export function sinceCommit(git: CommandContext["git"], root: string, since: string, head: string): string {
  if (since === "" || since.startsWith("-")) throw new ArbabError("usage", `--since ${JSON.stringify(since)} is not a commit`);
  const r = git(["rev-parse", "--verify", "--quiet", `${since}^{commit}`], root);
  const sha = r.stdout.trim();
  if (r.code !== 0 || !SHA.test(sha)) throw new ArbabError("usage", `--since ${since} does not name a commit`);
  if (sha === head) throw new ArbabError("usage", `--since ${since} is the integration head itself: nothing changed since`);
  const ancestor = git(["merge-base", "--is-ancestor", sha, head], root);
  if (ancestor.code === 1) throw new ArbabError("usage", `--since ${since} (${sha}) is not an ancestor of the integration head ${head}`);
  if (ancestor.code !== 0) {
    throw new ArbabError("git", `git merge-base --is-ancestor ${sha} ${head} failed (${ancestor.code}): ${(ancestor.stderr || ancestor.stdout).trim()}`);
  }
  return sha;
}

const VERDICT_ORDER: readonly FindingVerdict[] = ["confirmed", "refuted", "unverified"];

export function formatFindings(findings: ReviewFinding[]): string {
  const lines: string[] = [];
  for (const verdict of VERDICT_ORDER) {
    const group = findings.filter((f) => f.verdict === verdict);
    lines.push(`${verdict} (${group.length})`);
    for (const f of group) {
      const where = f.line === undefined ? f.file : `${f.file}:${f.line}`;
      lines.push(`  ${f.id}  ${f.severity}  ${where}  ${f.title.replace(/\s+/g, " ")}`);
    }
  }
  return lines.join("\n") + "\n";
}

/**
 * Applies one skeptic's report to the findings of its own lens only: a skeptic was shown only those, so a verdict
 * naming another lens's id is not its to give.
 */
export function applyLensVerdicts(findings: ReviewFinding[], lens: string, report: unknown): ReviewFinding[] {
  const judged = new Map(applyVerdicts(findings.filter((f) => f.lens === lens), report).map((f) => [f.id, f]));
  return findings.map((f) => (f.lens === lens ? (judged.get(f.id) ?? f) : f));
}

export function formatReview(record: ReviewRecord): string {
  const lanes = [
    ...record.lenses.map((l) => `${l.lens}  review   ${l.lane}  ${l.endState ?? "unfinished"}  ${l.pathsChecked} paths`),
    ...record.skeptics.map((s) => `${s.lens}  skeptic  ${s.lane}  ${s.endState ?? "unfinished"}`),
  ];
  return `${lanes.join("\n")}\n${formatFindings(record.findings)}`;
}

/** The previous review.json, for a subset run to keep the other lenses of; a damaged one is replaced, with a warning. */
function previousReview(ctx: CommandContext, integration: Integration): ReviewRecord | null {
  try {
    return readReviewRecord(integration.paths.review, integration.paths.name);
  } catch (err) {
    ctx.stderr(`arbab review: ${err instanceof Error ? err.message : String(err)}; no lens of it is kept\n`);
    return null;
  }
}

export async function runReview(argv: string[], ctx: CommandContext): Promise<number> {
  const { values, positionals } = parse("review", {
    args: argv,
    options: {
      lenses: { type: "string" },
      "lens-file": { type: "string", multiple: true },
      since: { type: "string" },
      "timeout-min": { type: "string" },
      json: { type: "boolean" },
    },
    allowPositionals: true,
  });
  const name = assertValidName(onePositional("review", positionals, "name"), "integration");
  const timeoutMs = parseTimeoutMin(values["timeout-min"] ?? String(DEFAULT_TIMEOUT_MIN));
  const project = openProject(ctx);
  // ctx.home is ~/.arbab.
  const credential = credentialMatcher(project.config.credentialPaths, homeSpellings(dirname(ctx.home)));
  const fileLenses = readLensFiles(project.root, values["lens-file"] ?? [], credential);
  const runLenses = { ...project.config.review.lenses, ...fileLenses };
  const lenses = reviewLenses(values.lenses, runLenses);
  const unrun = Object.keys(fileLenses).filter((lens) => !lenses.includes(lens));
  if (unrun.length > 0) throw new ArbabError("usage", `--lens-file gives ${unrun.join(", ")}, which --lenses does not run`);

  const integration = openIntegration(project, name);
  const owner = generationOwner(integration);
  const { record: rec, paths } = integration;
  assertReviewLaneNames(paths.name, lenses);
  // Each reviewer and skeptic gets a new worktree, where the shepherd installs on the host: on a trusted commit, with
  // the integration head merged on top.
  const start = generatedBase(rec);
  assertRecordedHead(ctx.git, project, integration);
  const since = values.since === undefined ? null : sinceCommit(ctx.git, project.root, values.since, rec.headSha);
  const diffBase = since ?? rec.baseSha;
  const previous = values.lenses === undefined ? null : previousReview(ctx, integration);

  const reviewers = lenses.map((lens) => ({
    lens,
    lane: reviewLane({ paths, lens, text: lensText(lens, runLenses) ?? "", diffBase, since: since !== null, ...start }),
  }));
  const reviewed = await runGeneratedLanes(ctx, project, paths, reviewers.map((r) => r.lane), timeoutMs, owner);
  if (reviewed.timedOut) {
    if (values.json === true) printJson(ctx, { timedOut: true, review: null });
    else ctx.stderr(`arbab review: the reviewer lanes did not finish in time; they keep running\n`);
    return WAIT_TIMEOUT_EXIT;
  }
  const outcomeOf = (outcomes: LaneOutcome[], lane: string): LaneOutcome | undefined => outcomes.find((o) => o.lane === lane);

  let findings = collectFindings(reviewers.map((r) => ({ lens: r.lens, report: outcomeOf(reviewed.outcomes, r.lane.spec.name)?.report ?? null })));
  const lensEntries: ReviewRecord["lenses"] = reviewers.map((r) => {
    const outcome = outcomeOf(reviewed.outcomes, r.lane.spec.name);
    return { lens: r.lens, lane: r.lane.spec.name, endState: outcome?.endState ?? null, ...reviewerCoverage(outcome?.report ?? null) };
  });

  const skeptics = lenses
    .filter((lens) => skepticFindings(lens, findings).length > 0)
    .map((lens) => ({ lens, lane: skepticLane({ paths, lens, findings, diffBase, ...start }) }));
  let skepticEntries: ReviewRecord["skeptics"] = [];
  let skepticsTimedOut = false;
  if (skeptics.length > 0) {
    const checked = await runGeneratedLanes(ctx, project, paths, skeptics.map((s) => s.lane), timeoutMs, owner);
    skepticsTimedOut = checked.timedOut;
    skepticEntries = skeptics.map((s) => ({ lens: s.lens, lane: s.lane.spec.name, endState: outcomeOf(checked.outcomes, s.lane.spec.name)?.endState ?? null }));
    for (const s of skeptics) {
      const report = outcomeOf(checked.outcomes, s.lane.spec.name)?.report;
      if (report !== undefined && report !== null) findings = applyLensVerdicts(findings, s.lens, report);
    }
  }

  const current = reviewRecord({ name, headSha: rec.headSha, lenses: lensEntries, skeptics: skepticEntries, findings, now: ctx.clock.now(), since });
  const record = writeReviewRound(paths.dir, keepOtherLenses(previous, current, lenses));
  writeJsonAtomic(paths.review, record);
  // Skeptics still running: the next review waits for them, or adopts them and the reviewers their findings came from.
  if (!skepticsTimedOut) {
    const lanes = [...reviewers, ...skeptics].map((x) => x.lane.spec.name);
    settleGeneratedRuns(paths.lanesDir, lanes);
    // The results are recorded; each worktree holds a dependency install the next review builds again anyway.
    for (const warning of dropGeneratedWorktrees(ctx, project, lanes, owner)) ctx.stderr(`arbab review: ${warning}\n`);
  }
  if (values.json === true) printJson(ctx, { timedOut: skepticsTimedOut, review: record });
  else ctx.stdout(formatReview(record));
  if (skepticsTimedOut) {
    if (values.json !== true) ctx.stderr("arbab review: the skeptic lanes did not finish in time; their findings stay unverified\n");
    return WAIT_TIMEOUT_EXIT;
  }
  const allSucceeded = [...lensEntries, ...skepticEntries].every((entry) => entry.endState === "success");
  return allSucceeded ? 0 : 1;
}
