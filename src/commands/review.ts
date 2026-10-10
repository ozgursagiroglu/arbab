// arbab review <name> [--lenses a,b] [--timeout-min N] [--json]
//
// One reviewer lane per lens, <name>-review-<lens>, each in its own worktree on the recorded integration head (installed
// on a trusted commit first, as verify's), diffing against the integration's base commit (DESIGN.md §17). Lenses
// default to the built-ins plus config review.lenses. Then one skeptic lane per lens with MEDIUM or HIGH findings,
// <name>-skeptic-<lens>, tries to refute them; its verdicts apply to its own lens's findings only. Refuses, like verify,
// while a dependency manifest changed and no human confirmed the install.
// Writes .arbab/integrations/<name>/review.json (ReviewRecord).
// Text: one line per lane, `<lens>  review|skeptic  <lane>  <end state>[  <n> paths]`, then the findings by verdict:
// a `confirmed (n)` / `refuted (n)` / `unverified (n)` heading and `  <id>  <SEVERITY>  <file>[:<line>]  <title>` lines.
// --json: {"timedOut": boolean, "review": ReviewRecord | null}
// Exit 0 when every lane succeeded, 1 when one did not (review.json is written either way), 3 when the reviewers did
// not finish in time (nothing written) or the skeptics did not (review.json keeps their findings unverified).
import { applyVerdicts, assertReviewLaneNames, collectFindings, lensNames, lensText, reviewerCoverage, reviewLane, reviewRecord, skepticFindings, skepticLane } from "../review";
import type { FindingVerdict, ReviewFinding, ReviewRecord } from "../types";
import { ArbabError } from "../util/errors";
import { writeJsonAtomic } from "../util/fs";
import { assertValidName } from "../util/names";
import type { CommandContext } from "./context";
import { splitList } from "./integrate";
import {
  assertRecordedHead,
  generatedBase,
  generationOwner,
  lintGeneratedLanes,
  openIntegration,
  runGeneratedLanes,
  writeGeneratedLane,
  type LaneOutcome,
} from "./integration";
import { onePositional, openProject, parse, printJson } from "./project";
import { WAIT_TIMEOUT_EXIT, parseTimeoutMin } from "./wait";

const DEFAULT_TIMEOUT_MIN = 120;

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

export async function runReview(argv: string[], ctx: CommandContext): Promise<number> {
  const { values, positionals } = parse("review", {
    args: argv,
    options: { lenses: { type: "string" }, "timeout-min": { type: "string" }, json: { type: "boolean" } },
    allowPositionals: true,
  });
  const name = assertValidName(onePositional("review", positionals, "name"), "integration");
  const timeoutMs = parseTimeoutMin(values["timeout-min"] ?? String(DEFAULT_TIMEOUT_MIN));
  const project = openProject(ctx);
  const configLenses = project.config.review.lenses;
  const lenses = reviewLenses(values.lenses, configLenses);

  const integration = openIntegration(project, name);
  const owner = generationOwner(integration);
  const { record: rec, paths } = integration;
  assertReviewLaneNames(paths.name, lenses);
  // Each reviewer and skeptic gets a new worktree, where the shepherd installs on the host: on a trusted commit, with
  // the integration head merged on top.
  const start = generatedBase(rec);
  assertRecordedHead(ctx.git, project, integration);

  const reviewers = lenses.map((lens) => {
    const lane = reviewLane({ paths, lens, text: lensText(lens, configLenses) ?? "", diffBase: rec.baseSha, ...start });
    return { lens, lane: lane.spec.name, file: writeGeneratedLane(project, paths, lane) };
  });
  lintGeneratedLanes(ctx, project, reviewers.map((r) => r.file));
  const reviewed = await runGeneratedLanes(ctx, project, reviewers, timeoutMs, owner);
  if (reviewed.timedOut) {
    if (values.json === true) printJson(ctx, { timedOut: true, review: null });
    else ctx.stderr(`arbab review: the reviewer lanes did not finish in time; they keep running\n`);
    return WAIT_TIMEOUT_EXIT;
  }
  const outcomeOf = (outcomes: LaneOutcome[], lane: string): LaneOutcome | undefined => outcomes.find((o) => o.lane === lane);

  let findings = collectFindings(reviewers.map((r) => ({ lens: r.lens, report: outcomeOf(reviewed.outcomes, r.lane)?.report ?? null })));
  const lensEntries: ReviewRecord["lenses"] = reviewers.map((r) => {
    const outcome = outcomeOf(reviewed.outcomes, r.lane);
    return { lens: r.lens, lane: r.lane, endState: outcome?.endState ?? null, ...reviewerCoverage(outcome?.report ?? null) };
  });

  const skeptics = lenses
    .filter((lens) => skepticFindings(lens, findings).length > 0)
    .map((lens) => {
      const lane = skepticLane({ paths, lens, findings, diffBase: rec.baseSha, ...start });
      return { lens, lane: lane.spec.name, file: writeGeneratedLane(project, paths, lane) };
    });
  let skepticEntries: ReviewRecord["skeptics"] = [];
  let skepticsTimedOut = false;
  if (skeptics.length > 0) {
    lintGeneratedLanes(ctx, project, skeptics.map((s) => s.file));
    const checked = await runGeneratedLanes(ctx, project, skeptics, timeoutMs, owner);
    skepticsTimedOut = checked.timedOut;
    skepticEntries = skeptics.map((s) => ({ lens: s.lens, lane: s.lane, endState: outcomeOf(checked.outcomes, s.lane)?.endState ?? null }));
    for (const s of skeptics) {
      const report = outcomeOf(checked.outcomes, s.lane)?.report;
      if (report !== undefined && report !== null) findings = applyLensVerdicts(findings, s.lens, report);
    }
  }

  const record = reviewRecord({ name, headSha: rec.headSha, lenses: lensEntries, skeptics: skepticEntries, findings, now: ctx.clock.now() });
  writeJsonAtomic(paths.review, record);
  if (values.json === true) printJson(ctx, { timedOut: skepticsTimedOut, review: record });
  else ctx.stdout(formatReview(record));
  if (skepticsTimedOut) {
    if (values.json !== true) ctx.stderr("arbab review: the skeptic lanes did not finish in time; their findings stay unverified\n");
    return WAIT_TIMEOUT_EXIT;
  }
  const allSucceeded = [...lensEntries, ...skepticEntries].every((entry) => entry.endState === "success");
  return allSucceeded ? 0 : 1;
}
