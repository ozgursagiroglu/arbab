// One project's summary: every section's data, read from its records (DESIGN.md §21).
import type { MachineConfig, ProjectConfig } from "../types";
import { integrationOverview, type IntegrationLine } from "./integrations";
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
  /** Records that could not be read; the rest of the summary stands. */
  errors: string[];
}

export interface SummaryInput {
  project: { root: string; config: ProjectConfig; runsRoot: string };
  home: string;
  machine: MachineConfig;
  alive: (pid: number) => boolean;
  nowMs: number;
}

export function projectSummary(input: SummaryInput): ProjectSummary {
  const { project, alive, nowMs } = input;
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
    errors: [...lanes.errors, ...plans.errors, ...integrations.errors],
  };
}
