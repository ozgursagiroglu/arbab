// arbab readiness <name> [--tier low|medium|high] [--waive id,…] [--json]
//
// The FR-21 readiness report of an integration (DESIGN.md §12, §17): verified, skipped (each needing a waiver by its
// id) and risks, from integration.json, verify.json, review.json and the latest report.json of each merged lane and of
// each lane that worked in a merged lane's worktree. The tier defaults to config landing.tier.
// A review made before a clean merge of the base still counts (DESIGN.md §21); config hostGates count once
// host-checks.json passed on the head. --waive needs a terminal: waivers are the human's.
// Writes .arbab/integrations/<name>/readiness.json (ReadinessReport) and readiness.md.
// Text: readiness.md. --json: ReadinessReport (src/types.ts).
// Exit 0 when ready to land, 1 otherwise.
import { join } from "node:path";
import { computeReadiness, renderReadiness, reviewCarriesOver, type ReadinessInput, type ReviewRound } from "../readiness";
import { listLanes, runPaths } from "../registry";
import { lensNames, reviewRoundPath, reviewRounds as roundsOnDisk } from "../review";
import { HOST_CHECKS_FILE, TIERS, type Tier } from "../types";
import { ArbabError } from "../util/errors";
import { readJson, writeJsonAtomic, writeTextAtomic } from "../util/fs";
import { assertValidName } from "../util/names";
import { isoAt } from "../util/proc";
import type { CommandContext } from "./context";
import { readHostCheckRecord } from "./host-check";
import { splitList } from "./integrate";
import { latestReport, openIntegration } from "./integration";
import { onePositional, openProject, parse, printJson } from "./project";
import { readReviewRecord, readVerifyRecord } from "./records";

export function parseTier(text: string | undefined, fallback: Tier): Tier {
  if (text === undefined) return fallback;
  if (!(TIERS as readonly string[]).includes(text)) throw new ArbabError("usage", `--tier ${JSON.stringify(text)} must be one of ${TIERS.join(", ")}`);
  return text as Tier;
}

/**
 * The latest report of each merged lane, then of each other lane whose run lane.json names a merged lane as its
 * worktree (a verifier or fix phase commits onto the owner's branch, so it is never merged under its own name). A
 * lane.json that cannot be read names no worktree.
 */
export function laneReports(runsRoot: string, merged: readonly string[]): ReadinessInput["laneReports"] {
  const owners = new Set(merged);
  const out: ReadinessInput["laneReports"] = merged.map((lane) => ({ lane, report: latestReport(runsRoot, lane) }));
  for (const lane of listLanes(runsRoot)) {
    if (owners.has(lane)) continue;
    let spec: unknown;
    try {
      spec = readJson<unknown>(runPaths(runsRoot, lane).laneFile);
    } catch {
      continue;
    }
    const worktree = typeof spec === "object" && spec !== null ? Reflect.get(spec, "worktree") : undefined;
    if (typeof worktree !== "string" || !owners.has(worktree)) continue;
    out.push({ lane, report: latestReport(runsRoot, lane), worktree });
  }
  return out;
}

/**
 * Each readable <integrationDir>/reviews/<round>.json, by round. The history only informs the report, so a file that
 * does not parse or is not a review of this integration is left out rather than failing it, which is why this does
 * not use readReviewHistory: it refuses the whole history for one damaged round.
 */
export function reviewRounds(integrationDir: string, name: string): ReviewRound[] {
  let rounds: number[];
  try {
    rounds = roundsOnDisk(integrationDir);
  } catch {
    return [];
  }
  return rounds.flatMap((round) => {
    try {
      const record = readReviewRecord(reviewRoundPath(integrationDir, round), name);
      return record === null ? [] : [{ round, findings: record.findings }];
    } catch {
      return [];
    }
  });
}

export async function runReadiness(argv: string[], ctx: CommandContext): Promise<number> {
  const { values, positionals } = parse("readiness", {
    args: argv,
    options: { tier: { type: "string" }, waive: { type: "string" }, json: { type: "boolean" } },
    allowPositionals: true,
  });
  const name = assertValidName(onePositional("readiness", positionals, "name"), "integration");
  // Waivers are the human's: an orchestrator once waived review six times on its own. Its shell has no terminal.
  if (values.waive !== undefined && !ctx.interactive) {
    throw new ArbabError(
      "usage",
      "--waive is the human's decision: run it yourself in a terminal, after reading what each skipped item leaves unchecked",
    );
  }
  const project = openProject(ctx);
  const tier = parseTier(values.tier, project.config.landing.tier);
  const { paths, record } = openIntegration(project, name);
  const review = readReviewRecord(paths.review, name);
  const base = project.config.baseBranch;
  const carried =
    review !== null && review.headSha !== record.headSha && reviewCarriesOver(ctx.git, project.root, review.headSha, record.headSha, base);

  const report = computeReadiness({
    name,
    tier,
    integration: record,
    verify: readVerifyRecord(paths.verify, name),
    review,
    laneReports: laneReports(project.runsRoot, [...new Set(record.merged.map((m) => m.lane))]),
    configLenses: lensNames(project.config.review.lenses),
    smokeConfigured: project.config.verify.smoke !== null,
    waivers: values.waive === undefined ? [] : splitList(values.waive),
    now: isoAt(ctx.clock),
    reviewCarryOver: carried && review !== null ? { from: review.headSha, base } : null,
    hostGates: project.config.hostGates,
    hostChecks: readHostCheckRecord(join(paths.dir, HOST_CHECKS_FILE), name),
    reviewRounds: reviewRounds(paths.dir, name),
  });
  const markdown = renderReadiness(report);
  writeJsonAtomic(paths.readiness, report);
  writeTextAtomic(paths.readinessMd, markdown);

  if (values.json === true) printJson(ctx, report);
  else ctx.stdout(markdown);
  return report.ready ? 0 : 1;
}
