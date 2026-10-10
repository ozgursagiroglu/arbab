// arbab readiness <name> [--tier low|medium|high] [--waive id,…] [--json]
//
// The FR-21 readiness report of an integration (DESIGN.md §12, §17): verified, skipped (each needing a waiver by its
// id) and risks, from integration.json, verify.json, review.json and the latest report.json of each merged lane and of
// each lane that worked in a merged lane's worktree. The tier defaults to config landing.tier.
// Writes .arbab/integrations/<name>/readiness.json (ReadinessReport) and readiness.md.
// Text: readiness.md. --json: ReadinessReport (src/types.ts).
// Exit 0 when ready to land, 1 otherwise.
import { computeReadiness, renderReadiness, type ReadinessInput } from "../readiness";
import { listLanes, runPaths } from "../registry";
import { lensNames } from "../review";
import { TIERS, type Tier } from "../types";
import { ArbabError } from "../util/errors";
import { readJson, writeJsonAtomic, writeTextAtomic } from "../util/fs";
import { assertValidName } from "../util/names";
import { isoAt } from "../util/proc";
import type { CommandContext } from "./context";
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

export async function runReadiness(argv: string[], ctx: CommandContext): Promise<number> {
  const { values, positionals } = parse("readiness", {
    args: argv,
    options: { tier: { type: "string" }, waive: { type: "string" }, json: { type: "boolean" } },
    allowPositionals: true,
  });
  const name = assertValidName(onePositional("readiness", positionals, "name"), "integration");
  const project = openProject(ctx);
  const tier = parseTier(values.tier, project.config.landing.tier);
  const { paths, record } = openIntegration(project, name);

  const report = computeReadiness({
    name,
    tier,
    integration: record,
    verify: readVerifyRecord(paths.verify, name),
    review: readReviewRecord(paths.review, name),
    laneReports: laneReports(project.runsRoot, [...new Set(record.merged.map((m) => m.lane))]),
    configLenses: lensNames(project.config.review.lenses),
    smokeConfigured: project.config.verify.smoke !== null,
    waivers: values.waive === undefined ? [] : splitList(values.waive),
    now: isoAt(ctx.clock),
  });
  const markdown = renderReadiness(report);
  writeJsonAtomic(paths.readiness, report);
  writeTextAtomic(paths.readinessMd, markdown);

  if (values.json === true) printJson(ctx, report);
  else ctx.stdout(markdown);
  return report.ready ? 0 : 1;
}
