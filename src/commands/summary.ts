// arbab summary [--all] [--since <when>] [--json]
//
// One screen for the project (DESIGN.md §21): Lanes (counts by state, one line per lane not finished), Plans (the
// phases each .arbab/plans/<plan>/ launched), Integrations (stage and what each waits for), Needs attention (lanes
// whose latest run needs the orchestrator, with what to do), Quota and slots. Sections with nothing to say are left
// out; records that cannot be read are listed last instead of failing the command.
// --since <when>: an ISO time, or <n>m, <n>h, <n>d back from the clock. Adds a `Landed since <time>` section after
// Integrations: each landing after it (name, into, time, owner session's first 8 characters or `outside Claude Code`,
// lanes), or `nothing landed`. Anything else is a usage error.
// --all: every project in ~/.arbab/projects/ whose root still exists, each under a `== <root> ==` heading, its config
// loaded from its root. A project whose config does not load is named on stderr and skipped.
// --json: ProjectSummary (src/summary/project.ts), or an array of them with --all; --since adds `since` and
// `landedSince` (LandingSince[], oldest first) to each.
// Read-only: it writes nothing and reclaims no stale entry.
import { existsSync } from "node:fs";
import { loadConfig, loadMachineConfig } from "../config";
import { listProjects } from "../registry";
import { formatSummary, projectSummary, type ProjectSummary } from "../summary";
import type { MachineConfig } from "../types";
import { ArbabError } from "../util/errors";
import { confine } from "../util/fs";
import type { CommandContext } from "./context";
import { openProject, parse, printJson, type Project } from "./project";

function machineConfig(ctx: CommandContext, errors: string[]): MachineConfig {
  try {
    return loadMachineConfig(ctx.home);
  } catch (err) {
    if (!(err instanceof ArbabError)) throw err;
    errors.push(`machine config: ${err.message}`);
    return { maxParallel: null };
  }
}

function summarize(
  ctx: CommandContext,
  project: Project,
  machine: MachineConfig,
  machineErrors: string[],
  nowMs: number,
  sinceMs: number | undefined,
): ProjectSummary {
  const summary = projectSummary({ project, home: ctx.home, machine, alive: ctx.alive, nowMs, ...(sinceMs !== undefined && { sinceMs }) });
  return { ...summary, errors: [...machineErrors, ...summary.errors] };
}

const UNIT_MS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };
const ISO_TIME = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

/** `--since`: an ISO time, or `<n>m`, `<n>h`, `<n>d` back from `nowMs`, as epoch milliseconds. */
export function parseSince(text: string, nowMs: number): number {
  const relative = /^(\d{1,9})([mhd])$/.exec(text);
  if (relative !== null) return nowMs - Number(relative[1]) * (UNIT_MS[relative[2] ?? ""] ?? 0);
  const ms = ISO_TIME.test(text) ? Date.parse(text) : NaN;
  if (Number.isFinite(ms)) return ms;
  throw new ArbabError(
    "usage",
    `--since takes an ISO time (2026-10-09T12:00:00Z) or <n>m, <n>h, <n>d back from now, not ${JSON.stringify(text)} (see arbab summary --help)`,
  );
}

function openRoot(root: string): Project {
  const config = loadConfig(root);
  return { root, config, runsRoot: confine(root, config.runsRoot), worktreeRoot: confine(root, config.worktreeRoot) };
}

export async function runSummary(argv: string[], ctx: CommandContext): Promise<number> {
  const { values } = parse("summary", {
    args: argv,
    options: { all: { type: "boolean" }, since: { type: "string" }, json: { type: "boolean" } },
    allowPositionals: false,
  });
  const nowMs = ctx.clock.now();
  const sinceMs = values.since === undefined ? undefined : parseSince(values.since, nowMs);
  const nowSec = Math.floor(nowMs / 1000);
  const machineErrors: string[] = [];
  const machine = machineConfig(ctx, machineErrors);

  if (values.all !== true) {
    const summary = summarize(ctx, openProject(ctx), machine, machineErrors, nowMs, sinceMs);
    if (values.json === true) printJson(ctx, summary);
    else ctx.stdout(formatSummary(summary, nowSec) + "\n");
    return 0;
  }

  const summaries: ProjectSummary[] = [];
  for (const entry of listProjects(ctx.home)) {
    // A project moved or deleted since it last launched is left out.
    if (!existsSync(entry.root)) continue;
    let project: Project;
    try {
      project = openRoot(entry.root);
    } catch (err) {
      if (!(err instanceof ArbabError)) throw err;
      ctx.stderr(`${entry.root}: skipped: ${err.message}\n`);
      continue;
    }
    summaries.push(summarize(ctx, project, machine, machineErrors, nowMs, sinceMs));
  }
  if (values.json === true) printJson(ctx, summaries);
  else if (summaries.length === 0) ctx.stdout("no projects recorded on this machine\n");
  else ctx.stdout(summaries.map((s) => `== ${s.root} ==\n${formatSummary(s, nowSec)}`).join("\n\n") + "\n");
  return 0;
}
