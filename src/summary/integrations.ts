// The Integrations section of `arbab summary`: each integration's furthest stage and what it waits for.
import { existsSync } from "node:fs";
import { readReadinessReport, readReviewRecord, readVerifyRecord } from "../commands/records";
import { confirmCommand, integrationPaths, listIntegrations, readIntegration } from "../integrate";
import type { ProjectConfig } from "../types";

export const STAGES = ["integrated", "verified", "reviewed", "ready", "landed"] as const;
export type Stage = (typeof STAGES)[number];

export interface IntegrationLine {
  name: string;
  stage: Stage;
  /** The integration head. */
  head: string;
  /** What stands between it and the next stage, in order; empty once landed. */
  waitsFor: string[];
}

export const SHORT_SHA = 7;
const short = (sha: string): string => sha.slice(0, SHORT_SHA);

/** One integration's line, or null when its directory holds no integration.json. */
export function integrationLine(projectRoot: string, config: Pick<ProjectConfig, "worktreeRoot">, name: string): IntegrationLine | null {
  const paths = integrationPaths(projectRoot, config, name);
  const record = readIntegration(paths);
  if (record === null) return null;
  const head = record.headSha;
  const verify = readVerifyRecord(paths.verify, name);
  const review = readReviewRecord(paths.review, name);
  const readiness = readReadinessReport(paths.readiness, name);
  const readinessOnHead = readiness !== null && readiness.headSha === head ? readiness : null;

  const verified = verify !== null && verify.headSha === head && verify.passed;
  // A review made before a clean merge of the base still counts when readiness on the head carried it over.
  const reviewed = review !== null && (review.headSha === head || readinessOnHead?.reviewCarriedOverFrom === review.headSha);
  const ready = readinessOnHead?.ready === true;
  const landed = existsSync(paths.landing);
  const stage: Stage = landed ? "landed" : ready ? "ready" : reviewed ? "reviewed" : verified ? "verified" : "integrated";

  const waitsFor: string[] = [];
  if (!landed) {
    if (!record.depsConfirmed) waitsFor.push(`dependencies to confirm: ${confirmCommand(name, head)}`);
    if (verify === null) waitsFor.push("verify has not run");
    else if (verify.headSha !== head) waitsFor.push(`verify is stale (ran on ${short(verify.headSha)})`);
    else if (!verify.passed) waitsFor.push(`verify failed${verify.reason === undefined ? "" : `: ${verify.reason}`}`);
    if (review === null) waitsFor.push("review missing");
    else if (!reviewed) waitsFor.push(`review is stale (ran on ${short(review.headSha)})`);
    if (readinessOnHead === null) waitsFor.push(readiness === null ? "readiness has not run" : "readiness is stale");
    else {
      const open = readinessOnHead.skipped.filter((s) => !s.waived).map((s) => s.id);
      if (open.length > 0) waitsFor.push(`readiness skipped, not waived: ${open.join(", ")}`);
    }
    if (ready) waitsFor.push("ready: ask the human to land");
  }
  return { name, stage, head, waitsFor };
}

/** Every integration with an integration.json, by name; unreadable records go to `errors`. */
export function integrationOverview(
  projectRoot: string,
  config: Pick<ProjectConfig, "worktreeRoot">,
): { integrations: IntegrationLine[]; errors: string[] } {
  const integrations: IntegrationLine[] = [];
  const errors: string[] = [];
  for (const name of listIntegrations(projectRoot)) {
    try {
      const line = integrationLine(projectRoot, config, name);
      if (line !== null) integrations.push(line);
    } catch (err) {
      errors.push(`integration ${name}: ${(err as Error).message}`);
    }
  }
  return { integrations, errors };
}
