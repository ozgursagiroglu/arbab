// arbab lint <lane.json> [--json]
//
// Text: one line per issue, `error|warning  <code>  <message>  (<where>)`, then `<lane>: ok` or
// `<lane>: N error(s), M warning(s)`.
// --json: {"lane": string, "ok": boolean, "issues": [{"severity", "code", "message", "where"?}]}
// Exit 1 when any issue is an error.
import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseBriefSource, lintBrief } from "../brief";
import { effectiveRole, loadLane } from "../config";
import { compileProfile, lintProfile } from "../profile";
import { leaseEnv, type GitRunner } from "../run";
import type { CompiledProfile, LaneSpec, Lease, LintIssue, ProfileInput } from "../types";
import { ArbabError } from "../util/errors";
import { confine, readText } from "../util/fs";
import type { CommandContext } from "./context";
import { onePositional, openProject, parse, printJson, type Project } from "./project";

export interface LaneLint {
  lane: LaneSpec;
  profile: CompiledProfile;
  issues: LintIssue[];
}

/**
 * The repository's shared git directory as an absolute, real path, or undefined outside a git repository. Older git
 * prints it relative to `root`, so it is resolved here instead of relying on --path-format.
 */
export function resolveGitCommonDir(git: GitRunner, root: string): string | undefined {
  const r = git(["rev-parse", "--git-common-dir"], root);
  const out = r.stdout.trim();
  if (r.code !== 0 || out === "") return undefined;
  const path = resolve(root, out);
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** The ProfileInput the shepherd will compile for this lane, with placeholder leases (value 0). */
export function profileInputFor(project: Project, lane: LaneSpec, gitCommonDir?: string): ProfileInput {
  const defaults = effectiveRole(project.config, lane);
  const leases: Lease[] = Object.entries(lane.resources ?? {}).flatMap(([type, count]) =>
    Array.from({ length: count }, () => ({ type, value: 0, lane: lane.name, project: project.root, pid: 0, createdAt: "" })),
  );
  return {
    role: lane.role,
    fence: lane.fence ?? "strict",
    tools: defaults.tools,
    loopback: defaults.loopback,
    commands: project.config.commands[lane.role] ?? [],
    laneAllow: lane.allow ?? [],
    credentialPaths: project.config.credentialPaths,
    env: { ...project.config.env, ...leaseEnv(leases) },
    worktree: join(project.worktreeRoot, lane.worktree ?? lane.name),
    ...(gitCommonDir !== undefined && { gitCommonDir }),
  };
}

function readRequired(path: string, what: string): string {
  const text = readText(path);
  if (text === null) throw new ArbabError("io", `cannot read ${what} ${path}: no such file`);
  return text;
}

/**
 * Profile, brief and schema lint for one lane file (DESIGN.md §4, §5). Invalid lane or config files throw.
 * `gitCommonDir` (resolveGitCommonDir) lets the lint see the fence the shepherd will compile.
 */
export function lintLane(project: Project, lanePath: string, gitCommonDir?: string): LaneLint {
  return lintLaneSpec(project, loadLane(project.root, lanePath, project.config.credentialPaths), gitCommonDir);
}

/** lintLane for a lane spec already validated (a compiled plan phase). */
export function lintLaneSpec(project: Project, lane: LaneSpec, gitCommonDir?: string): LaneLint {
  const input = profileInputFor(project, lane, gitCommonDir);
  const profile = compileProfile(input);
  const issues = lintProfile(profile, input);

  const markdown = readRequired(confine(project.root, lane.brief), "brief");
  issues.push(...lintBrief(markdown, parseBriefSource(markdown), profile));

  if (lane.schema !== undefined) {
    let schema: unknown;
    try {
      schema = JSON.parse(readRequired(confine(project.root, lane.schema), "schema"));
    } catch (err) {
      if (err instanceof ArbabError) throw err;
      issues.push({ severity: "error", code: "schema-json", message: `not valid JSON: ${(err as Error).message}`, where: lane.schema });
    }
    if (schema !== undefined && (typeof schema !== "object" || schema === null || Array.isArray(schema))) {
      issues.push({ severity: "error", code: "schema-json", message: "the schema must be a JSON object", where: lane.schema });
    }
  }
  return { lane, profile, issues };
}

export function formatIssue(issue: LintIssue): string {
  const where = issue.where === undefined ? "" : `  (${issue.where})`;
  return `${issue.severity}  ${issue.code}  ${issue.message}${where}`;
}

export const hasErrors = (issues: LintIssue[]): boolean => issues.some((i) => i.severity === "error");

export function issueSummary(lane: string, issues: LintIssue[]): string {
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;
  return issues.length === 0 ? `${lane}: ok` : `${lane}: ${errors} error(s), ${warnings} warning(s)`;
}

export async function runLint(argv: string[], ctx: CommandContext): Promise<number> {
  const { values, positionals } = parse("lint", {
    args: argv,
    options: { json: { type: "boolean" } },
    allowPositionals: true,
  });
  const lanePath = onePositional("lint", positionals, "lane.json");
  const project = openProject(ctx);
  const { lane, issues } = lintLane(project, lanePath, resolveGitCommonDir(ctx.git, project.root));
  if (values.json === true) {
    printJson(ctx, { lane: lane.name, ok: !hasErrors(issues), issues });
  } else {
    for (const issue of issues) ctx.stdout(formatIssue(issue) + "\n");
    ctx.stdout(issueSummary(lane.name, issues) + "\n");
  }
  return hasErrors(issues) ? 1 : 0;
}
