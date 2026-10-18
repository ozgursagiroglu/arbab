import { ArbabError, exitCodeFor } from "../util/errors";
import { runCleanup } from "./cleanup";
import type { CommandContext } from "./context";
import { runDoctor } from "./doctor";
import { runIntegrate } from "./integrate";
import { runLand } from "./land";
import { runLaunch } from "./launch";
import { runLint } from "./lint";
import { runPlan } from "./plan";
import { runPreflight } from "./preflight";
import { runQuota } from "./quota";
import { runReadiness } from "./readiness";
import { runResume } from "./resume";
import { runReview } from "./review";
import { runShepherdProcess } from "./shepherd";
import { runStatus } from "./status";
import { runStop } from "./stop";
import { runUi } from "./ui";
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
  __shepherd: runShepherdProcess,
};

export const HELP = `usage: arbab <command> [options]

  doctor [--json]                         node, git, claude binary, sandbox, config, ignored roots, ~/.arbab
  lint <lane.json> [--json]               profile, brief and schema lint; exit 1 on errors
  launch <lane.json> [--json]             lint, then start the lane's shepherd
  plan check <plan.json> [--json]         validate a plan, lint every phase, print the waves; exit 1 on errors
  plan next <plan.json> [--json]          launch every phase whose dependencies all succeeded and that never ran
  plan status <plan.json> [--json]        one row per phase: wave, state, end state, dependencies
  status [--json] [lane…]                 one row per lane, then the quota
  wait [--any|--all] [--timeout-min N] [--json] [lane…]
                                          report finished lanes not yet acked; exit 3 on timeout
  resume <lane> [--prompt <file> | --digest] [--json]
                                          a new attempt resuming the latest session; --digest starts a fresh
                                          session seeded with the latest attempt's digest
  stop <lane> [--json]                    stop the lane's shepherd and worker
  preflight <lane.json> [--timeout-min N] [--json]
                                          probe the lane's fence and model; exit 1 on any failed check
  quota [--reset] [--json]                the account snapshot and the hold decision; --reset deletes the snapshot
                                          (after switching accounts)
  cleanup [--worktrees] [--json]          reap orphans, release stale pool entries; --worktrees removes finished lanes'
                                          merged clean worktrees (lane branches stay), and landed integrations'
                                          worktrees and branches
  integrate <name> (--lanes a,b,… | --plan <plan.json>) [--json]
                                          merge lane branches into integrate/<name>, in order or by plan waves
  integrate <name> --deps-installed <sha> [--json]
                                          record that you reviewed and installed changed dependencies at the head
                                          <sha> that integrate printed
  verify <name> [--timeout-min N] [--json]
                                          run the gates and smoke inside the fence on the integration head;
                                          exit 1 unless all exit 0, 3 on timeout
  review <name> [--lenses a,b] [--timeout-min N] [--json]
                                          one reviewer lane per lens, then skeptics for MEDIUM+ findings
  readiness <name> [--tier low|medium|high] [--waive id,…] [--json]
                                          the readiness report (verified, skipped, risks); exit 1 unless ready
  land <name> [--keep-worktrees] [--json]
                                          merge a ready integration into the base branch; never pushes; then
                                          remove the worktrees it landed (lane branches stay) unless --keep-worktrees
  ui [--port N] [--hours N] [--no-open] [--json]
                                          serve the pyramid scene on 127.0.0.1 until stopped (read-only)
  help, --help                            this text
  version, --version                      the arbab version

Exit codes: 0 ok, 1 usage or lint error, 2 runtime error, 3 wait timeout.
`;

/** Runs one command; every ArbabError becomes a message on stderr and its exit code. */
export async function dispatch(argv: string[], ctx: CommandContext): Promise<number> {
  const [name, ...rest] = argv;
  if (name === undefined || name === "--help" || name === "help" || name === "-h") {
    ctx.stdout(HELP);
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
  if (rest.includes("--help") && name !== "__shepherd") {
    ctx.stdout(HELP);
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
