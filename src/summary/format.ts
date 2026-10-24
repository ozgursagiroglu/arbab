// The text rendering of `arbab summary`: one screen per project, each section omitted when it has nothing to say.
import { formatQuota } from "../quota";
import { formatElapsed } from "../registry";
import type { PhaseLine } from "./plans";
import type { ProjectSummary } from "./project";
import { SHORT_SHA } from "./integrations";
import { landingOwner } from "./landings";
import { formatWorktrees } from "./worktrees";

const NONE = "-";
const INDENT = "  ";

/** Columns padded to their widest cell, two spaces apart; the last column is not padded. */
export function table(rows: string[][]): string[] {
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length))) ?? [];
  return rows.map((r) => r.map((cell, i) => (i === r.length - 1 ? cell : cell.padEnd(widths[i] ?? 0))).join("  ").trimEnd());
}

/** `2 running · 1 held · 3 finished (2 success, 1 failed) · 1 orphaned`; states with no lane are left out. */
export function formatCounts(counts: ProjectSummary["lanes"]["counts"]): string {
  const parts: string[] = [];
  const s = counts.byState;
  for (const state of ["running", "held", "preparing", "waiting-reset", "queued"] as const) {
    if (s[state] > 0) parts.push(`${s[state]} ${state}`);
  }
  const finished = Object.entries(counts.finished).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const total = finished.reduce((n, [, c]) => n + c, 0);
  if (total > 0) parts.push(`${total} finished (${finished.map(([end, c]) => `${c} ${end}`).join(", ")})`);
  if (s.orphaned > 0) parts.push(`${s.orphaned} orphaned`);
  return parts.join(" · ");
}

function phaseText(p: PhaseLine): string {
  return p.status === "failed" && p.endState !== null ? `failed (${p.endState})` : p.status;
}

const isoAt = (sec: number): string => new Date(sec * 1000).toISOString().replace(/\.000Z$/, "Z");

export function formatSummary(s: ProjectSummary, nowSec: number): string {
  const out: string[] = [];
  const section = (title: string, lines: string[]): void => {
    if (out.length > 0) out.push("");
    out.push(title, ...lines.map((l) => INDENT + l));
  };

  if (s.lanes.total > 0) {
    const lines = [formatCounts(s.lanes.counts)];
    if (s.lanes.active.length > 0) {
      lines.push(
        ...table([
          ["LANE", "STATE", "ELAPSED", "ATTEMPT", "OWNER", "REASON"],
          ...s.lanes.active.map((l) => [
            l.lane,
            l.state,
            l.elapsedMs === null ? NONE : formatElapsed(l.elapsedMs),
            String(l.attempt),
            l.owner ?? NONE,
            l.reason ?? NONE,
          ]),
        ]),
      );
    }
    section(`Lanes (${s.lanes.total})`, lines);
  }

  if (s.plans.length > 0) {
    const lines: string[] = [];
    for (const plan of s.plans) {
      lines.push(`${plan.plan}:`);
      lines.push(...table(plan.phases.map((p) => [phaseText(p), p.phase])).map((l) => INDENT + l));
    }
    lines.push("run `arbab plan status <plan file>` for the phases not launched yet");
    section("Plans", lines);
  }

  if (s.integrations.length > 0) {
    section(
      "Integrations",
      table(
        s.integrations.map((i) => [
          i.name,
          i.stage,
          i.head.slice(0, SHORT_SHA),
          i.waitsFor.length > 0 ? `waits for: ${i.waitsFor.join("; ")}` : NONE,
        ]),
      ),
    );
  }

  // Asked for with --since, so said even when nothing landed.
  if (s.landedSince !== undefined && s.since !== undefined) {
    section(
      `Landed since ${s.since}`,
      s.landedSince.length === 0
        ? ["nothing landed"]
        : table(
            s.landedSince.map((l) => [
              l.name,
              `into ${l.into}`,
              l.landedAt,
              landingOwner(l.owner),
              `${l.lanes} ${l.lanes === 1 ? "lane" : "lanes"}${l.squash ? ", squashed" : ""}`,
            ]),
          ),
    );
  }

  if (s.attention.length > 0) {
    const lines: string[] = [];
    for (const a of s.attention) {
      lines.push(`${a.lane}: ${a.state} (attempt ${a.attempt})${a.reason === null ? "" : `: ${a.reason}`}`);
      lines.push(`${INDENT}${a.todo}`);
    }
    section("Needs attention", lines);
  }

  const q = s.quota;
  const machine = q.slots.machineMaxParallel === null ? "" : `, machine cap ${q.slots.machineMaxParallel}`;
  section("Quota, slots and worktrees", [
    `quota: ${formatQuota(q.snapshot, nowSec)}`,
    q.hold.hold ? `hold: yes, ${q.hold.reason ?? "quota"}${q.hold.until === null ? "" : ` (until ${isoAt(q.hold.until)})`}` : "hold: no",
    `slots: ${q.slots.inUse.length} in use machine-wide of ${q.slots.cap} (maxParallel ${q.slots.projectMaxParallel}${machine})`,
    formatWorktrees(s.worktrees),
  ]);

  if (s.errors.length > 0) section("Unreadable records", s.errors);
  return out.join("\n");
}
