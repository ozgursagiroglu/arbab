// arbab quota [--reset] [--json]
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
import { defaultConfig, loadConfig } from "../config";
import { formatQuota, holdDecision, quotaPath, readQuota, resetQuota } from "../quota";
import type { HoldDecision } from "../types";
import type { CommandContext } from "./context";
import { findProjectRoot, parse, printJson } from "./project";

export function formatHold(hold: HoldDecision): string {
  if (!hold.hold) return "hold: no";
  const until = hold.until === null ? "" : ` (until ${new Date(hold.until * 1000).toISOString()})`;
  return `hold: yes — ${hold.reason ?? "unknown"}${until}`;
}

export async function runQuota(argv: string[], ctx: CommandContext): Promise<number> {
  const { values } = parse("quota", {
    args: argv,
    options: { reset: { type: "boolean" }, json: { type: "boolean" } },
    allowPositionals: false,
  });
  if (values.reset === true) {
    const path = quotaPath(ctx.home);
    const removed = resetQuota(ctx.home, ctx.clock);
    if (values.json === true) printJson(ctx, { reset: true, removed, path });
    else ctx.stdout(removed ? `quota: snapshot ${path} removed; the next worker's rate-limit events write a fresh one\n` : `quota: no snapshot at ${path}\n`);
    return 0;
  }
  const root = findProjectRoot(ctx.cwd, ctx.git);
  const config = root === null ? defaultConfig() : loadConfig(root);
  const snapshot = readQuota(ctx.home);
  const nowSec = Math.floor(ctx.clock.now() / 1000);
  const hold = holdDecision(snapshot, config.quota.holdAbove, nowSec);
  if (values.json === true) {
    printJson(ctx, { snapshot, hold });
  } else {
    ctx.stdout(`quota: ${formatQuota(snapshot, nowSec)}\n${formatHold(hold)}\n`);
  }
  return 0;
}
