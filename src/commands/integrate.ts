// arbab integrate <name> (--lanes a,b,… | --plan <plan.json>) [--json]
// arbab integrate <name> --deps-installed <sha> [--json]
// arbab integrate <name> --adopt <ref> [--base <branch>] [--json]
// arbab integrate <name> --refresh [--json]
//
// Merges the lanes' branches into integrate/<name>, in the worktree .arbab/worktrees/integrate-<name> (DESIGN.md
// §17), in the order given or the plan's wave order (phases that borrow another lane's worktree have no branch to
// merge: the owner is merged instead, at the borrowing phase's place when it is not a phase). Lanes already in the
// branch are recorded without a merge. Refused: a landed integration (choose a new name), a running lane, a lane whose
// worker outlived its shepherd, a running lane that borrows a listed lane's worktree, and a lane whose worktree has
// uncommitted changes. A branch integrate creates starts a new record; an older one is moved aside.
// --deps-installed <sha> records that a human reviewed and installed the changed dependencies at <sha>, the head
// integrate printed; it refuses unless the record and the branch are both still at <sha>.
// --adopt <ref> makes a new integration whose branch is <ref>'s commit, with nothing merged, based on --base or
// config.baseBranch (DESIGN.md §21); refused for an existing or landed name, a ref that names no commit, a --base
// that is not a branch (land merges into it) or that config.baseBranch does not contain (the install runs at the fork
// point), and with --lanes or --plan. Text: `adopted
// <ref> as <branch> (base <base> at <sha>)`, then the lines above.
// --refresh records an existing, unlanded integration's head again after a hand commit or a base merge in its
// worktree: it merges nothing and runs no dependencies; refused without a record or worktree, for a landed
// integration, with tracked changes in the worktree, and with any other mode. Text: `refreshed <name>: recorded
// <branch> at <sha>`, then the lines above.
// Text: `<lane>: already in <branch>` per such lane, `merged <lane> <sha>[  manifests: <paths>]` per recorded lane,
// `head <sha>`, then what the human must do about unconfirmed manifest changes. --deps-installed: `deps confirmed for
// <name> at <sha>`, or `nothing to confirm for <name>: …` when no manifest changed.
// --json: IntegrationRecord (src/types.ts).
// Exit 0; 1 on usage errors; 2 on a conflict (the merge is aborted, earlier lanes stay merged) or a git failure.
import { adoptIntegration, confirmDeps, integrate, integrationPaths, readIntegration, refreshIntegration } from "../integrate";
import { integrationLanes as planOrder, loadPlan } from "../plan";
import { effectiveState, listLanes, readState, runPaths } from "../registry";
import type { IntegrationRecord, PlanSpec } from "../types";
import { ArbabError } from "../util/errors";
import { readJson } from "../util/fs";
import { assertValidName } from "../util/names";
import type { CommandContext } from "./context";
import { manifestAdvice } from "./integration";
import { assertInactive, assertNoLiveWorker } from "./launch";
import { isActive, onePositional, openProject, parse, printJson, type Project } from "./project";

const RESERVED_PREFIX = "ref-";

/** `a,b , c` → ["a", "b", "c"]; empty entries are dropped. */
export function splitList(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** A plan's lanes to merge, in wave order: src/plan's integrationLanes. */
export type PlanLanes = (plan: PlanSpec) => string[];

/** src/plan's integrationLanes: the phases in wave order, each borrowing phase replaced by its worktree's owner. */
export const planIntegrationLanes: PlanLanes = planOrder;

/** The lanes to merge, in order: --lanes as given, or the plan's lanes (`planLanes`) wave by wave. */
export function integrationLanes(
  project: Project,
  opts: { lanes?: string; plan?: string },
  planLanes: PlanLanes = planIntegrationLanes,
): string[] {
  if (opts.lanes !== undefined && opts.plan !== undefined) throw new ArbabError("usage", "--lanes and --plan exclude each other");
  let lanes: string[];
  if (opts.lanes !== undefined) {
    lanes = splitList(opts.lanes);
  } else if (opts.plan !== undefined) {
    lanes = planLanes(loadPlan(project.root, opts.plan, project.config.credentialPaths));
  } else {
    throw new ArbabError("usage", "usage: arbab integrate <name> (--lanes a,b,… | --plan <plan.json> | --deps-installed <sha> | --adopt <ref> | --refresh)");
  }
  if (lanes.length === 0) throw new ArbabError("usage", "no lanes to integrate");
  const seen = new Set<string>();
  for (const lane of lanes) {
    assertValidName(lane, "lane");
    if (seen.has(lane)) throw new ArbabError("usage", `lane ${lane} is listed twice`);
    seen.add(lane);
  }
  return lanes;
}

/**
 * Refuses while an active lane works in the worktree of a lane being integrated (`worktree: <owner>` in its run's
 * lane.json): it commits onto arbab/<owner>, so that branch still moves. Lanes whose lane.json cannot be read are
 * passed over, as cleanup does.
 */
export function assertNoActiveBorrower(ctx: CommandContext, project: Project, lanes: string[]): void {
  const owners = new Set(lanes);
  for (const lane of listLanes(project.runsRoot)) {
    let spec: unknown;
    try {
      spec = readJson<unknown>(runPaths(project.runsRoot, lane).laneFile);
    } catch {
      continue;
    }
    const owner = typeof spec === "object" && spec !== null ? Reflect.get(spec, "worktree") : undefined;
    if (typeof owner !== "string" || owner === lane || !owners.has(owner)) continue;
    const record = readState(project.runsRoot, lane);
    if (record === null) continue;
    const state = effectiveState(record, ctx.alive);
    if (!isActive(state)) continue;
    throw new ArbabError(
      "usage",
      `lane ${lane} works in lane ${owner}'s worktree and commits onto arbab/${owner}, and it is ${state} (shepherd ` +
        `${record.shepherdPid}); stop it or wait for it before integrating ${owner}`,
    );
  }
}

export function formatIntegration(record: IntegrationRecord, alreadyIn: string[] = []): string {
  const lines = alreadyIn.map((lane) => `${lane}: already in ${record.branch}`);
  for (const m of record.merged) {
    const manifests = m.manifests.length > 0 ? `  manifests: ${m.manifests.join(", ")}` : "";
    lines.push(`merged ${m.lane} ${m.sha}${manifests}`);
  }
  if (record.merged.length === 0) lines.push(`nothing merged into ${record.branch} yet`);
  lines.push(`head ${record.headSha}  (${record.branch} in ${record.worktree})`);
  lines.push(...manifestAdvice(record));
  return lines.join("\n") + "\n";
}

export async function runIntegrate(argv: string[], ctx: CommandContext): Promise<number> {
  const { values, positionals } = parse("integrate", {
    args: argv,
    options: {
      lanes: { type: "string" },
      plan: { type: "string" },
      "deps-installed": { type: "string" },
      adopt: { type: "string" },
      base: { type: "string" },
      refresh: { type: "boolean" },
      json: { type: "boolean" },
    },
    allowPositionals: true,
  });
  const name = assertValidName(onePositional("integrate", positionals, "name"), "integration");
  // verify --ref names its lane ref-<slug>-verify, which an integration ref-<slug> would share.
  if (name.startsWith(RESERVED_PREFIX)) {
    throw new ArbabError("usage", `integration name ${name}: the prefix ${RESERVED_PREFIX} is reserved for verify --ref; choose another name`);
  }
  const project = openProject(ctx);

  let record: IntegrationRecord;
  const confirmed = values["deps-installed"];
  const adopt = values.adopt;
  if (values.base !== undefined && adopt === undefined) throw new ArbabError("usage", "--base goes with --adopt <ref>");
  if (values.refresh === true) {
    const others = [
      values.lanes !== undefined && "--lanes",
      values.plan !== undefined && "--plan",
      confirmed !== undefined && "--deps-installed",
      adopt !== undefined && "--adopt",
    ].filter((o) => o !== false);
    if (others.length > 0) throw new ArbabError("usage", `--refresh takes no ${others.join(" or ")}: it records the existing head again and merges nothing`);
    const { record: refreshed } = refreshIntegration({
      projectRoot: project.root,
      config: project.config,
      name,
      git: ctx.git,
      runCommand: ctx.runCommand,
      clock: ctx.clock,
    });
    if (values.json === true) printJson(ctx, refreshed);
    else ctx.stdout(`refreshed ${name}: recorded ${refreshed.branch} at ${refreshed.headSha}\n` + formatIntegration(refreshed));
    return 0;
  }
  if (confirmed !== undefined) {
    if (values.lanes !== undefined || values.plan !== undefined) {
      throw new ArbabError("usage", "--deps-installed takes no lanes: merge first, then confirm the install");
    }
    if (adopt !== undefined) throw new ArbabError("usage", "--deps-installed and --adopt exclude each other: adopt first, then confirm the install");
    // The human's step: it lets verify and review install worker-changed dependencies on the host. An agent's shell
    // has no terminal, so an orchestrator cannot confirm on the human's behalf.
    if (!ctx.interactive) {
      throw new ArbabError(
        "usage",
        "--deps-installed is the human's confirmation: run it yourself in a terminal, after reviewing the change and " +
          "installing the dependencies in the integration worktree",
      );
    }
    const paths = integrationPaths(project.root, project.config, name);
    if (readIntegration(paths) === null) throw new ArbabError("usage", `integration ${name} does not exist; run arbab integrate ${name} first`);
    record = confirmDeps(paths, confirmed, ctx.git, ctx.clock);
    if (values.json === true) printJson(ctx, record);
    else if (record.manifests.length === 0) ctx.stdout(`nothing to confirm for ${name}: no dependency manifest differs between ${record.base} and ${record.headSha}\n`);
    else ctx.stdout(`deps confirmed for ${name} at ${record.headSha}\n`);
    return 0;
  }

  if (adopt !== undefined) {
    if (values.lanes !== undefined || values.plan !== undefined) {
      throw new ArbabError("usage", "--adopt takes no --lanes or --plan: it makes an integration of an existing branch; merge lanes into it afterwards");
    }
    const { record: adopted } = adoptIntegration({
      projectRoot: project.root,
      config: project.config,
      name,
      ref: adopt,
      ...(values.base !== undefined && { base: values.base }),
      git: ctx.git,
      runCommand: ctx.runCommand,
      clock: ctx.clock,
    });
    if (values.json === true) printJson(ctx, adopted);
    else ctx.stdout(`adopted ${adopt} as ${adopted.branch} (base ${adopted.base} at ${adopted.baseSha})\n` + formatIntegration(adopted));
    return 0;
  }

  const lanes = integrationLanes(project, { ...(values.lanes !== undefined && { lanes: values.lanes }), ...(values.plan !== undefined && { plan: values.plan }) });
  // A running lane's branch still moves: what is merged now would not be what it finishes with. So does the branch
  // of an orphaned lane whose worker outlived its shepherd, and of a lane whose worktree another running lane borrows.
  for (const lane of lanes) {
    assertInactive(ctx, project, lane);
    assertNoLiveWorker(ctx, project, lane);
  }
  assertNoActiveBorrower(ctx, project, lanes);
  const { record: integrated, alreadyIn } = integrate({
    projectRoot: project.root,
    config: project.config,
    name,
    lanes,
    git: ctx.git,
    runCommand: ctx.runCommand,
    clock: ctx.clock,
  });
  record = integrated;
  if (values.json === true) printJson(ctx, record);
  else ctx.stdout(formatIntegration(record, alreadyIn));
  return 0;
}
