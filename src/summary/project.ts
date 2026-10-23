// One project's summary: every section's data, read from its records (DESIGN.md §21).
import type { MachineConfig, ProjectConfig } from "../types";
import { integrationOverview, type IntegrationLine } from "./integrations";
import { landingsSince, type LandingSince } from "./landings";
import { laneOverview, type AttentionItem, type LaneCounts, type LaneLine } from "./lanes";
import { planOverview, type PlanOverview } from "./plans";
import { quotaOverview, type QuotaOverview } from "./slots";

export interface ProjectSummary {
  root: string;
  lanes: { total: number; counts: LaneCounts; active: LaneLine[] };
  plans: PlanOverview[];
  integrations: IntegrationLine[];
  attention: AttentionItem[];
  quota: QuotaOverview;
  /** `summary --since`: the moment asked for, as an ISO time. Absent without it. */
  since?: string;
  /** `summary --since`: the landings after `since`, oldest first. Absent without it. */
  landedSince?: LandingSince[];
  /** Records that could not be read; the rest of the summary stands. */
  errors: string[];
}

export interface SummaryInput {
  project: { root: string; config: ProjectConfig; runsRoot: string };
  home: string;
  machine: MachineConfig;
  alive: (pid: number) => boolean;
  nowMs: number;
  /** `summary --since`: list the landings after this moment. */
  sinceMs?: number;
}

export function projectSummary(input: SummaryInput): ProjectSummary {
  const { project, alive, nowMs, sinceMs } = input;
  const lanes = laneOverview(project.runsRoot, alive, nowMs);
  const plans = planOverview(project.root, project.runsRoot, alive);
  const integrations = integrationOverview(project.root, project.config);
  return {
    root: project.root,
    lanes: { total: lanes.total, counts: lanes.counts, active: lanes.active },
    plans: plans.plans,
    integrations: integrations.integrations,
    attention: lanes.attention,
    quota: quotaOverview({ home: input.home, config: project.config, machine: input.machine, alive, nowSec: Math.floor(nowMs / 1000) }),
    ...(sinceMs !== undefined && { since: new Date(sinceMs).toISOString(), landedSince: landingsSince(project.root, sinceMs) }),
    errors: [...lanes.errors, ...plans.errors, ...integrations.errors],
  };
}
