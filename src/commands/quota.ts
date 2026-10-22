// arbab quota [--reset | --refresh] [--json]
//
// Text: `quota: <formatQuota>` then `hold: no` or `hold: yes — <reason> (until <ISO time>)`.
// --json: {"snapshot": RateLimitSnapshot | null, "hold": HoldDecision} (types of src/types.ts)
// Thresholds come from the project's config when run inside a project, else from the defaults.
//
// --reset deletes ~/.arbab/quota.json and records the reset in ~/.arbab/quota-reset.json, for an account switch: the
// usage limit is per account, and the old account's snapshot would hold every lane until its reset. The next worker's
// rate-limit events write a fresh one; held lanes and lanes waiting out a usage limit notice within a poll.
// Text: `quota: snapshot <path> removed` or `quota: no snapshot at <path>`. --json: {"reset": true, "removed": boolean,
// "path": string}
//
// --refresh, for the same switch when held lanes leave no worker to report the new account: one call on haiku with
// no tools (src/quota/refresh.ts) whose rate_limit_event replaces quota.json, even when older than the stored one, and
// is recorded in quota-reset.json. Then prints as plain `quota` does, --json included. Without an event, on a
// non-zero exit or a timeout, exits 2 with the stderr tail and changes neither file.
import { resolveBinary } from "../binary";
import { defaultConfig, loadConfig } from "../config";
import { workerEnv } from "../profile";
import { formatQuota, holdDecision, makeRefreshSpawn, quotaPath, readQuota, refreshQuota, resetQuota, type RefreshSpawn } from "../quota";
import type { HoldDecision, ProjectConfig, RateLimitSnapshot } from "../types";
import { ArbabError } from "../util/errors";
import type { CommandContext } from "./context";
import { findProjectRoot, parse, printJson } from "./project";

export function formatHold(hold: HoldDecision): string {
  if (!hold.hold) return "hold: no";
  const until = hold.until === null ? "" : ` (until ${new Date(hold.until * 1000).toISOString()})`;
  return `hold: yes — ${hold.reason ?? "unknown"}${until}`;
}

/** One call on the current account, through `spawn` (default: the shepherd deps' spawn). */
async function refresh(ctx: CommandContext, config: ProjectConfig, spawn: RefreshSpawn | undefined): Promise<RateLimitSnapshot> {
  const deps = ctx.shepherdDeps();
  const binary = resolveBinary({
    pinned: null,
    explicitPath: deps.explicitClaude,
    pathEnv: deps.pathEnv,
    minVersion: config.minClaudeVersion,
    run: deps.run,
    exists: deps.exists,
    realpath: deps.realpath,
  });
  // A worker's scrubbed environment without the project's passEnv: this call needs only the account.
  const env = workerEnv(deps.hostEnv, {
    passEnv: [],
    extra: {},
    nodeDir: deps.nodeDir,
    ...(deps.pnpmDir === undefined ? {} : { pnpmDir: deps.pnpmDir }),
  });
  return refreshQuota({ home: ctx.home, binary: binary.path, env, clock: ctx.clock, spawn: spawn ?? makeRefreshSpawn(deps.spawnImpl) });
}

/** `spawn` replaces the real claude call of --refresh, for tests. */
export async function runQuota(argv: string[], ctx: CommandContext, spawn?: RefreshSpawn): Promise<number> {
  const { values } = parse("quota", {
    args: argv,
    options: { reset: { type: "boolean" }, refresh: { type: "boolean" }, json: { type: "boolean" } },
    allowPositionals: false,
  });
  if (values.reset === true && values.refresh === true) {
    throw new ArbabError("usage", "quota takes --reset or --refresh, not both: --refresh already replaces the snapshot");
  }
  if (values.reset === true) {
    const path = quotaPath(ctx.home);
    const removed = resetQuota(ctx.home, ctx.clock);
    if (values.json === true) printJson(ctx, { reset: true, removed, path });
    else ctx.stdout(removed ? `quota: snapshot ${path} removed; the next worker's rate-limit events write a fresh one\n` : `quota: no snapshot at ${path}\n`);
    return 0;
  }
  const root = findProjectRoot(ctx.cwd, ctx.git);
  const config = root === null ? defaultConfig() : loadConfig(root);
  const snapshot = values.refresh === true ? await refresh(ctx, config, spawn) : readQuota(ctx.home);
  const nowSec = Math.floor(ctx.clock.now() / 1000);
  const hold = holdDecision(snapshot, config.quota.holdAbove, nowSec);
  if (values.json === true) {
    printJson(ctx, { snapshot, hold });
  } else {
    ctx.stdout(`quota: ${formatQuota(snapshot, nowSec)}\n${formatHold(hold)}\n`);
  }
  return 0;
}
