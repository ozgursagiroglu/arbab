import { statSync } from "node:fs";
import { resolve } from "node:path";
import { ArbabError, exitCodeFor } from "../util/errors";
import { runCleanup } from "./cleanup";
import type { CommandContext } from "./context";
import { runDoctor } from "./doctor";
import { runHook } from "./hook";
import { runHostCheck } from "./host-check";
import { runIntegrate } from "./integrate";
import { runLand } from "./land";
import { runLaunch } from "./launch";
import { runLint } from "./lint";
import { runPlan } from "./plan";
import { runPreflight } from "./preflight";
import { runQuota } from "./quota";
import { runReadiness } from "./readiness";
import { runReport } from "./report";
import { runResume } from "./resume";
import { runReview } from "./review";
import { runShepherdProcess } from "./shepherd";
import { runStatus } from "./status";
import { runStop } from "./stop";
import { runSummary } from "./summary";
import { runUi } from "./ui";
import { USAGE } from "./usage";
import { runVerify } from "./verify";
import { runWait } from "./wait";

export type { CommandContext } from "./context";
export { defaultContext } from "./context";

type Command = (argv: string[], ctx: CommandContext) => Promise<number>;

export const COMMANDS: Readonly<Record<string, Command>> = {
  doctor: runDoctor,
  lint: runLint,
  launch: runLaunch,
  plan: runPlan,
  status: runStatus,
  wait: runWait,
  resume: runResume,
  stop: runStop,
  preflight: runPreflight,
  quota: runQuota,
  cleanup: runCleanup,
  integrate: runIntegrate,
  verify: runVerify,
  review: runReview,
  readiness: runReadiness,
  land: runLand,
  ui: runUi,
  summary: runSummary,
  report: runReport,
  hook: runHook,
  "host-check": runHostCheck,
  __shepherd: runShepherdProcess,
};

export const HELP = `usage: arbab [-C <dir>] <command> [options]

  -C <dir>                                find the project from <dir> instead of the working directory (never a
                                          lane worktree)

  doctor [--json]                         node, git, claude binary, sandbox, config, ignored roots, ~/.arbab, the
                                          plugin hook, gates, env templates, scanners, disk, machine cap
  lint <lane.json> [--json]               profile, brief and schema lint; exit 1 on errors
  launch <lane.json> [--json]             lint, then start the lane's shepherd
  plan check <plan.json> [--json]         validate a plan, lint every phase, print the waves; exit 1 on errors
  plan next <plan.json> [--retry <phase>] [--json]
                                          launch every phase whose dependencies all succeeded and that never ran;
                                          --retry first relaunches a phase that failed or was orphaned
  plan status <plan.json> [--json]        one row per phase: wave, state, end state, dependencies
  status [<lane>…] [--active] [--mine] [--json]
                                          one row per lane, then the quota
  wait [<lane>… | --any | --all] [--all-sessions] [--timeout-min N] [--notify] [--json]
                                          report finished lanes not yet acked (without lanes: this session's runs and
                                          ownerless ones, every session's with --all-sessions); exit 3 on timeout
  resume <lane> [--prompt <file> | --digest] [--json]
                                          a new attempt resuming the latest session; --digest starts a fresh
                                          session seeded with the latest attempt's digest
  stop <lane> [--json]                    stop the lane's shepherd and worker
  preflight <lane.json> [--timeout-min N] [--json]
                                          probe the lane's fence and model; exit 1 on any failed check
  quota [--reset | --refresh] [--json]    the account snapshot and the hold decision; --reset deletes the snapshot
                                          (after switching accounts), --refresh reads the current account's windows
  cleanup [--worktrees [--older-than <days>]] [--mine] [--json]
                                          reap orphans, release stale pool entries, remove empty lock directories;
                                          --worktrees removes finished lanes' clean worktrees merged or landed (lane
                                          branches stay), and landed integrations' worktrees and branches
  integrate <name> (--lanes a,b,… | --plan <plan.json>) [--json]
                                          merge lane branches into integrate/<name>, in order or by plan waves
  integrate <name> --adopt <ref> [--base <ref>] [--json]
                                          make an integration of an existing branch; the base must be contained in
                                          config baseBranch
  integrate <name> --refresh [--json]     record the integration's head again after a hand commit or a base merge;
                                          merges and installs nothing
  integrate <name> --deps-installed <sha> [--json]
                                          record that you reviewed and installed changed dependencies at the head
                                          <sha> that integrate printed
  verify (<name> | --ref <branch>) [--timeout-min N] [--json]
                                          run the gates and smoke inside the fence on the integration head (or a
                                          branch head); exit 1 unless all exit 0, 3 on timeout
  review <name> [--lenses a,b] [--lens-file <name>=<file>]… [--since <sha>] [--timeout-min N] [--json]
                                          one reviewer lane per lens, then skeptics for MEDIUM+ findings
  readiness <name> [--tier low|medium|high] [--waive id,…] [--json]
                                          the readiness report (verified, skipped, risks); exit 1 unless ready
  land <name> [--squash] [--message <file>] [--keep-worktrees] [--json]
                                          merge a ready integration into the base branch (--squash: one commit);
                                          never pushes; then remove the worktrees it landed (lane branches stay)
                                          unless --keep-worktrees
  ui [--port N] [--hours N] [--no-open] [--json]
                                          serve the pyramid scene on 127.0.0.1 until stopped (read-only)
  summary [--all] [--json]                plans, lanes by state, integrations by stage and what needs you
  report <lane> [--attempt <n>] [--json]  an attempt's summary and report, the latest unless --attempt
  host-check <name>                       run hostGates on the integration head from a terminal
  help [<command>], --help                this text, or a command's options
  version, --version                      the arbab version

arbab <command> --help shows a command's options.

Exit codes: 0 ok, 1 usage or lint error, 2 runtime error, 3 wait timeout.
`;

// Leading `-C <dir>`: an orchestrator in a parent folder calls the runner bare instead of `cd <repo> && …`, which no
// permission rule matches (DESIGN.md §21).
function globalDir(argv: string[], cwd: string): { cwd: string; argv: string[] } {
  if (argv[0] !== "-C") return { cwd, argv };
  const dir = argv[1];
  if (dir === undefined || dir === "") throw new ArbabError("usage", "-C needs a directory");
  if (dir === "-C" || argv[2] === "-C") throw new ArbabError("usage", "-C given twice");
  const abs = resolve(cwd, dir);
  const stat = statSync(abs, { throwIfNoEntry: false });
  if (stat === undefined) throw new ArbabError("usage", `-C ${JSON.stringify(dir)}: no such directory ${abs}`);
  if (!stat.isDirectory()) throw new ArbabError("usage", `-C ${JSON.stringify(dir)}: not a directory: ${abs}`);
  return { cwd: abs, argv: argv.slice(2) };
}

const helpFor = (name: string): string => (Object.hasOwn(USAGE, name) ? USAGE[name] : undefined) ?? HELP;

/** Runs one command; every ArbabError becomes a message on stderr and its exit code. */
export async function dispatch(argv: string[], ctx: CommandContext): Promise<number> {
  let global: { cwd: string; argv: string[] };
  try {
    global = globalDir(argv, ctx.cwd);
  } catch (err) {
    ctx.stderr(`arbab: ${err instanceof Error ? err.message : String(err)}\n`);
    return exitCodeFor(err);
  }
  if (global.cwd !== ctx.cwd) ctx = { ...ctx, cwd: global.cwd };
  const [name, ...rest] = global.argv;
  if (name === undefined || name === "--help" || name === "help" || name === "-h") {
    ctx.stdout(name === "help" && rest[0] !== undefined ? helpFor(rest[0]) : HELP);
    return 0;
  }
  if (name === "--version" || name === "version") {
    ctx.stdout(`${ctx.version}\n`);
    return 0;
  }
  const command = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
  if (command === undefined) {
    ctx.stderr(`arbab: unknown command ${JSON.stringify(name)}\n${HELP}`);
    return 1;
  }
  if ((rest.includes("--help") || rest.includes("-h")) && name !== "__shepherd") {
    ctx.stdout(helpFor(name));
    return 0;
  }
  try {
    return await command(rest, ctx);
  } catch (err) {
    const text = err instanceof ArbabError ? err.message : err instanceof Error ? (err.stack ?? err.message) : String(err);
    ctx.stderr(`arbab ${name}: ${text}\n`);
    return exitCodeFor(err);
  }
}
