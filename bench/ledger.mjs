#!/usr/bin/env node
// Collects every attempt of arbab's own build into the benchmark ledger: bench/runs.jsonl (one sanitized row per
// attempt: no paths, prompts or output) and bench/RUNS.md (per-wave tables and totals).
//
//   node bench/ledger.mjs
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNS = join(ROOT, ".arbab/runs");
const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
const dominant = (counts) => (counts ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null : null);
// Bootstrap lanes live in .arbab/lanes/<wave>/; lanes arbab launched itself have a state.json in their run dir and
// are grouped by their milestone prefix (m1-…, m2-…); the rest are standalone probes and preflights.
const waveOf = (lane) => {
  if (lane.startsWith("w0-")) return "w0";
  for (const w of ["w1", "w2"]) if (existsSync(join(ROOT, ".arbab/lanes", w, `${lane}.json`))) return w;
  if (!existsSync(join(RUNS, lane, "state.json"))) return "other";
  return /^m\d+-/.test(lane) ? lane.slice(0, lane.indexOf("-")) : "probes";
};
const round = (x, d = 2) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

const rows = [];
for (const lane of existsSync(RUNS) ? readdirSync(RUNS).sort() : []) {
  const attempts = readdirSync(join(RUNS, lane)).filter((d) => /^attempt-\d+$/.test(d))
    .sort((a, b) => Number(a.slice(8)) - Number(b.slice(8)));
  for (const a of attempts) {
    const dir = join(RUNS, lane, a);
    const s = readJson(join(dir, "summary.json"));
    const started = readJson(join(dir, "started.json"));
    if (!s || !started) continue;
    const failedByCause = {};
    for (const [k, v] of Object.entries(s.failedByCause ?? s.failed ?? {})) {
      const cause = k.split(":").slice(1).join(":");
      failedByCause[cause] = (failedByCause[cause] ?? 0) + v;
    }
    rows.push({
      lane, wave: waveOf(lane), launcher: existsSync(join(RUNS, lane, "state.json")) ? "arbab" : "bootstrap",
      attempt: s.attempt, role: s.role, resume: started.resume, model: s.model,
      effortRequested: s.requestedEffort, effortMeasured: dominant(s.measuredEffort), state: s.state,
      wallMin: round(s.wallMs / 60_000, 1), turns: s.turns, toolCalls: s.toolCallTotal, failed: s.failedTotal,
      failedByCause, permissionDenied: s.permissionDenied, costUsd: round(s.costUsd),
      fiveHourEnd: s.rateLimit?.fiveHour?.utilization ?? null, sevenDayEnd: s.rateLimit?.sevenDay?.utilization ?? null,
      cliVersion: started.binary?.version ?? null, startedAt: started.startedAt,
    });
  }
}

writeFileSync(join(ROOT, "bench/runs.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

const table = (rs) => [
  "| Lane | Att. | Role | Model | Effort (req→got) | End | Wall min | Turns | Calls | Failed (cause) | Cost $ |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ...rs.map((r) => `| ${r.lane} | ${r.attempt}${r.resume ? " (resume)" : ""} | ${r.role ?? "?"} | ${(r.model ?? "?").replace("claude-", "")} | ` +
    `${r.effortRequested}→${r.effortMeasured ?? "?"} | ${r.state} | ${r.wallMin} | ${r.turns} | ${r.toolCalls} | ` +
    `${r.failed}${r.failed ? ` (${Object.entries(r.failedByCause).map(([k, v]) => `${k} ${v}`).join(", ")})` : ""} | ${r.costUsd ?? "?"} |`),
];
const ORDER = ["w0", "w1", "w2", "m1", "m2", "m3", "m4", "probes", "other"];
const waves = [...new Set(rows.map((r) => r.wave))].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
const sum = (rs, k) => rs.reduce((acc, r) => acc + (r[k] ?? 0), 0);
const lines = [
  "# arbab build — run ledger",
  "",
  "Every headless run of arbab's own build, measured from its stream, transcript and attempt files by",
  "`bench/bootstrap/summarize.mjs` (later by arbab itself). Regenerate with `node bench/ledger.mjs`.",
  "Costs are Claude Code's client-side, notional API-equivalent estimates (the account is on a subscription);",
  "a resumed attempt's cost is the session total. \"Failed\" counts tool results with `is_error`, by cause.",
  "Groups: w0–w2 are M1's bootstrap waves; m1–m4 are the lanes arbab launched itself, by milestone (generated",
  "verify, review and skeptic lanes included); probes and other are standalone probes and measurements.",
  "",
];
for (const w of waves) {
  const rs = rows.filter((r) => r.wave === w);
  const calls = sum(rs, "toolCalls");
  const fenced = rs.reduce((acc, r) => acc + Object.entries(r.failedByCause)
    .filter(([k]) => !["real", "input"].includes(k)).reduce((x, [, v]) => x + v, 0), 0);
  lines.push(`## ${w}`, "", ...table(rs), "",
    `Totals: ${rs.length} attempts, ${calls} tool calls, ${sum(rs, "failed")} failed results, ` +
    `${fenced} refused by the fence (${calls ? ((100 * fenced) / calls).toFixed(1) : 0}% of calls).`, "");
}
writeFileSync(join(ROOT, "bench/RUNS.md"), lines.join("\n"));
console.log(`${rows.length} attempts → bench/runs.jsonl, bench/RUNS.md`);
