// arbab summary [--all] [--since <when>] [--json]
//
// One screen for the project (DESIGN.md §21): Lanes (counts by state, one line per lane not finished), Plans (the
// phases each .arbab/plans/<plan>/ launched), Integrations (stage and what each waits for), Needs attention (lanes
// whose latest run needs the orchestrator, with what to do), Quota, slots and worktrees (`worktrees: <total> (<idle>
// unused for <idleDays>+ days)[; last sweep <time>: removed <n>]`, or `(automatic sweep off)`). Sections with nothing
// to say are left out; records that cannot be read are listed last instead of failing the command.
// --since <when>: <n>m, <n>h, <n>d back from the clock (at most 3650 days), a date (YYYY-MM-DD, midnight UTC), or an
// ISO date-time with Z or an offset (without one it would depend on the machine's time zone). Adds a `Landed since <time>` section after
// Integrations: each landing after it (name, into, time, owner session's first 8 characters or `outside Claude Code`,
// lanes), or `nothing landed`. Anything else, a longer span or a date that does not exist is a usage error.
// --all: every project in ~/.arbab/projects/ whose root still exists, each under a `== <root> ==` heading, its config
// loaded from its root. A project whose config does not load is named on stderr and skipped.
// --json: ProjectSummary (src/summary/project.ts), or an array of them with --all; --since adds `since` and
// `landedSince` (LandingSince[], oldest first) to each. Its `worktrees` is WorktreeOverview (src/summary/worktrees.ts).
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

const DAY_MS = 86_400_000;
const UNIT_MS: Record<string, number> = { m: 60_000, h: 3_600_000, d: DAY_MS };
/** How far back a relative `--since` reaches; further would be no catch-up, and far enough overflows a Date. */
export const SINCE_MAX_DAYS = 3650;
/** A date, or a date-time with `Z` or an offset: one without would be read in the machine's time zone. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:(Z)|([+-])(\d{2}):(\d{2}))$/;

/** Epoch ms of a UTC calendar time, or NaN when a field is out of range (2026-02-30, 24:00, …). */
function utcMs(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0): number {
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return NaN;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms));
  // Date.UTC maps years 0–99 to 1900–1999; setUTCFullYear does not.
  date.setUTCFullYear(year);
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date.getTime() : NaN;
}

/** The epoch ms an ISO `--since` names, or NaN when it is none of the accepted forms or names no real time. */
function isoSince(text: string): number {
  const date = ISO_DATE.exec(text);
  if (date !== null) return utcMs(Number(date[1]), Number(date[2]), Number(date[3]));
  const time = ISO_DATE_TIME.exec(text);
  if (time === null) return NaN;
  const [, y, mo, d, h, mi, s, frac, zulu, sign, oh, om] = time;
  const ms = utcMs(Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s ?? 0), Number((frac ?? "0").padEnd(3, "0").slice(0, 3)));
  if (zulu !== undefined) return ms;
  if (Number(oh) > 23 || Number(om) > 59) return NaN;
  return ms - (sign === "-" ? -1 : 1) * (Number(oh) * 60 + Number(om)) * 60_000;
}

/**
 * `--since`: `<n>m`, `<n>h`, `<n>d` back from `nowMs`, up to SINCE_MAX_DAYS; a date (`YYYY-MM-DD`, midnight UTC); or
 * an ISO date-time with `Z` or an offset. As epoch milliseconds.
 */
export function parseSince(text: string, nowMs: number): number {
  const relative = /^(\d{1,9})([mhd])$/.exec(text);
  let ms: number;
  if (relative === null) ms = isoSince(text);
  else {
    const back = Number(relative[1]) * (UNIT_MS[relative[2] ?? ""] ?? NaN);
    ms = back <= SINCE_MAX_DAYS * DAY_MS ? nowMs - back : NaN;
  }
  // A time a Date cannot hold would fail later, when the section prints it.
  if (Number.isFinite(ms) && Number.isFinite(new Date(ms).getTime())) return ms;
  throw new ArbabError(
    "usage",
    `--since takes <n>m, <n>h or <n>d back from now (at most ${SINCE_MAX_DAYS} days), a date (2026-10-09, midnight UTC) ` +
      `or an ISO time with Z or an offset (2026-10-09T12:00:00Z), not ${JSON.stringify(text)} (see arbab summary --help)`,
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
