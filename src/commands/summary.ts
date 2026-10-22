// arbab summary [--all] [--json]
//
// One screen for the project (DESIGN.md §21): Lanes (counts by state, one line per lane not finished), Plans (the
// phases each .arbab/plans/<plan>/ launched), Integrations (stage and what each waits for), Needs attention (lanes
// whose latest run needs the orchestrator, with what to do), Quota and slots. Sections with nothing to say are left
// out; records that cannot be read are listed last instead of failing the command.
// --all: every project in ~/.arbab/projects/ whose root still exists, each under a `== <root> ==` heading, its config
// loaded from its root. A project whose config does not load is named on stderr and skipped.
// --json: ProjectSummary (src/summary/project.ts), or an array of them with --all.
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

function summarize(ctx: CommandContext, project: Project, machine: MachineConfig, machineErrors: string[], nowMs: number): ProjectSummary {
  const summary = projectSummary({ project, home: ctx.home, machine, alive: ctx.alive, nowMs });
  return { ...summary, errors: [...machineErrors, ...summary.errors] };
}

function openRoot(root: string): Project {
  const config = loadConfig(root);
  return { root, config, runsRoot: confine(root, config.runsRoot), worktreeRoot: confine(root, config.worktreeRoot) };
}

export async function runSummary(argv: string[], ctx: CommandContext): Promise<number> {
  const { values } = parse("summary", {
    args: argv,
    options: { all: { type: "boolean" }, json: { type: "boolean" } },
    allowPositionals: false,
  });
  const nowMs = ctx.clock.now();
  const nowSec = Math.floor(nowMs / 1000);
  const machineErrors: string[] = [];
  const machine = machineConfig(ctx, machineErrors);

  if (values.all !== true) {
    const summary = summarize(ctx, openProject(ctx), machine, machineErrors, nowMs);
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
    summaries.push(summarize(ctx, project, machine, machineErrors, nowMs));
  }
  if (values.json === true) printJson(ctx, summaries);
  else if (summaries.length === 0) ctx.stdout("no projects recorded on this machine\n");
  else ctx.stdout(summaries.map((s) => `== ${s.root} ==\n${formatSummary(s, nowSec)}`).join("\n\n") + "\n");
  return 0;
}
