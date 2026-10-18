// What `arbab ui` streams to its page (DESIGN.md §19): the registry, the integrations and the quota, folded into a
// UiSnapshot. It is built every second while the page is open, so whatever cannot have changed is cached: finished
// lanes until their state record changes, integrations until one of their record files does.
import { statSync } from "node:fs";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { generatingIntegration, readGenerated } from "../../commands/generated";
import { latestReport } from "../../commands/integration";
import { PREFLIGHT_DIR } from "../../commands/preflight";
import { readReadinessReport, readReviewRecord, readVerifyRecord } from "../../commands/records";
import { integrationPaths, listIntegrations, readIntegration } from "../../integrate";
import { holdDecision, readQuota } from "../../quota";
import { attemptFiles, effectiveState, listAttempts, listLanes, readState, runPaths, statusRow } from "../../registry";
import { isLive } from "../../registry/status";
import { NO_FREE_SLOT_REASON, ROLES } from "../../types";
import type { AttemptSummary, LaneState, LaneStateRecord, ProjectConfig, Role } from "../../types";
import { ArbabError } from "../../util/errors";
import { readJson } from "../../util/fs";
import { isValidName } from "../../util/names";
import { UI_PROTOCOL } from "../protocol";
import type { UiIntegration, UiLane, UiLaneKind, UiSnapshot } from "../protocol";
import type { ToolCallCounter } from "./tail";

export interface SnapshotSource {
  /** The project root. */
  root: string;
  /** Absolute. */
  runsRoot: string;
  config: ProjectConfig;
  /** ~/.arbab, for the quota snapshot. */
  home: string;
  version: string;
  alive: (pid: number) => boolean;
  windowHours: number;
  counter: ToolCallCounter;
}

/** Builds snapshots; caches what cannot have changed (below). */
export interface SnapshotBuilder {
  build(nowMs: number): UiSnapshot;
}

export const MAX_LANES = 300;
const LANDED_KEPT = 5;
const REASON_MAX = 200;
const TOOL_NAME = /^[A-Za-z0-9_.:-]{1,64}$/;
const REPORT_STATUSES = ["done", "partial", "blocked"] as const;

type Fields = Record<string, unknown>;
const isObject = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);
const finiteOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const countOrZero = (v: unknown): number => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0);
const tokenOrNull = (v: unknown): string | null => (typeof v === "string" && TOOL_NAME.test(v) ? v : null);
const parsedMs = (v: unknown): number | null => {
  if (typeof v !== "string") return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
};

/** A UiLane without `integration`: that one depends on the integrations, which change after a lane finishes. */
type LaneFacts = Omit<UiLane, "integration"> & { generatedBy: string | null };

interface CachedLane {
  key: string;
  facts: LaneFacts;
}

interface CachedIntegration {
  signature: string;
  value: UiIntegration | null;
}

/** The fields of a state record that, unchanged, mean a finished lane's records are unchanged too. */
const stateKey = (r: LaneStateRecord): string =>
  JSON.stringify([r.state, r.attempt, r.since, r.shepherdPid, r.endState ?? null, r.reason ?? null]);

/** Whether a lane file's `brief` lies under the project's preflight directory, where only `arbab preflight` writes. */
function briefUnderPreflight(root: string, brief: unknown): boolean {
  if (typeof brief !== "string" || brief === "") return false;
  const rel = relative(join(root, PREFLIGHT_DIR), isAbsolute(brief) ? brief : join(root, brief));
  return rel !== "" && !isAbsolute(rel) && rel.split(sep)[0] !== "..";
}

// A probe carries the probed lane's role, so its kind comes from its name and where its brief lives.
function laneKind(name: string, generatedBy: string | null, preflightBrief: boolean): UiLaneKind {
  if (generatedBy !== null) {
    if (name === `${generatedBy}-verify`) return "verify";
    if (name.startsWith(`${generatedBy}-review-`)) return "review";
    if (name.startsWith(`${generatedBy}-skeptic-`)) return "skeptic";
  }
  if (preflightBrief && (name.endsWith("-pf-tools") || name.endsWith("-pf-model"))) return "preflight";
  return "lane";
}

function readSummary(runsRoot: string, lane: string, attempt: number): AttemptSummary | null {
  const value = readJson<unknown>(attemptFiles(runPaths(runsRoot, lane).attemptDir(attempt)).summary);
  if (value === null) return null;
  if (!isObject(value)) throw new ArbabError("io", `the summary of ${lane} attempt ${attempt} is not a JSON object`);
  return value as unknown as AttemptSummary;
}

/** Reads every record of one lane; throws when one does not parse. */
function readLane(source: SnapshotSource, name: string, record: LaneStateRecord, state: LaneState, nowMs: number): LaneFacts {
  const { runsRoot } = source;
  const paths = runPaths(runsRoot, name);
  const spec = readJson<unknown>(paths.laneFile);
  const role = isObject(spec) ? spec["role"] : undefined;
  if (!ROLES.includes(role as Role)) throw new ArbabError("io", `the lane file of ${name} has no valid role`);
  const worktree = isObject(spec) ? spec["worktree"] : undefined;
  const preflightBrief = briefUnderPreflight(source.root, isObject(spec) ? spec["brief"] : undefined);

  const generatedBy = generatingIntegration(readGenerated(runsRoot, name)?.by ?? null);

  const attempts = listAttempts(runsRoot, name);
  const files = (n: number) => attemptFiles(paths.attemptDir(n));
  let firstMs: number | null = null;
  if (attempts[0] !== undefined) {
    const started = readJson<unknown>(files(attempts[0]).started);
    firstMs = isObject(started) ? parsedMs(started["startedAt"]) : null;
  }
  if (firstMs === null) {
    const shepherd = readJson<unknown>(paths.shepherdFile);
    firstMs = isObject(shepherd) ? parsedMs(shepherd["startedAt"]) : null;
  }
  firstMs ??= parsedMs(record.since);

  const current = record.attempt >= 1 && attempts.includes(record.attempt) ? record.attempt : null;
  const summary = current === null ? null : readSummary(runsRoot, name, current);
  const row = statusRow({ ...record, state }, summary, nowMs);
  let toolCalls = countOrZero(row.toolCalls);
  let lastTool = row.lastTool;
  if (state === "running" && summary === null && current !== null) {
    const live = source.counter.count(name, current, files(current).stream);
    toolCalls = live.toolCalls;
    lastTool = live.lastTool;
  }

  // Costs and the model: the newest attempt that has a summary (a running attempt has none yet).
  let costed: AttemptSummary | null = null;
  for (const n of [...attempts].reverse()) {
    costed = n === current ? summary : readSummary(runsRoot, name, n);
    if (costed !== null) break;
  }

  // The latest attempt's report only: an older attempt's never stands in, and one that does not parse is none. A run
  // that never reached an attempt (setup failed at attempt 0) has none either, not its predecessor's.
  let reportStatus: UiLane["reportStatus"] = null;
  let findings: number | null = null;
  const reported = current !== null && current === attempts.at(-1);
  if (reported && (role === "implementer" || role === "verifier" || role === "reviewer")) {
    const report = latestReport(runsRoot, name);
    if (role === "reviewer") {
      findings = isObject(report) && Array.isArray(report["findings"]) ? report["findings"].length : null;
    } else {
      const status = isObject(report) ? report["status"] : undefined;
      reportStatus = REPORT_STATUSES.find((s) => s === status) ?? null;
    }
  }

  const reason = typeof record.reason === "string" && record.reason !== "" ? record.reason.slice(0, REASON_MAX) : null;
  const until = state === "held" || state === "waiting-reset" ? finiteOrNull(record.until) : null;
  return {
    name,
    role: role as Role,
    kind: laneKind(name, generatedBy, preflightBrief),
    generatedBy,
    // A lane in its own worktree (a verifier's `worktree` may name itself) builds its own block.
    worktreeOf: isValidName(worktree) && worktree !== name ? worktree : null,
    state,
    endState: row.endState,
    hold: state === "held" ? (record.reason === NO_FREE_SLOT_REASON ? "slot" : "quota") : null,
    reason,
    until,
    attempt: record.attempt,
    firstSeen: firstMs === null ? record.since : new Date(firstMs).toISOString(),
    since: record.since,
    elapsedMs: isLive(state) ? null : finiteOrNull(row.elapsedMs),
    toolCalls,
    lastTool: tokenOrNull(lastTool),
    turns: countOrZero(row.turns),
    failedTotal: countOrZero(row.failedTotal),
    costUsd: finiteOrNull(costed?.costUsd),
    costDeltaUsd: finiteOrNull(costed?.costDeltaUsd),
    model: typeof costed?.model === "string" ? costed.model.slice(0, 64) : null,
    effort: tokenOrNull(row.effort),
    reportStatus,
    findings,
  };
}

/** Size and mtime of each record file: an unchanged signature means an unchanged integration. */
function integrationSignature(files: string[]): string {
  return files
    .map((file) => {
      const st = statSync(file, { throwIfNoEntry: false });
      return st === undefined ? "-" : `${st.size}:${st.mtimeMs}`;
    })
    .join("|");
}

function readUiIntegration(source: SnapshotSource, name: string): UiIntegration | null {
  const paths = integrationPaths(source.root, source.config, name);
  const record = readIntegration(paths);
  if (record === null) return null;
  const head = record.headSha;
  const verify = readVerifyRecord(paths.verify, name);
  const review = readReviewRecord(paths.review, name);
  const readiness = readReadinessReport(paths.readiness, name);
  const landing = readJson<unknown>(paths.landing);
  let reviewCounts: UiIntegration["review"] = null;
  if (review !== null && review.headSha === head) {
    reviewCounts = { lenses: review.lenses.length, confirmed: 0, refuted: 0, unverified: 0 };
    for (const finding of review.findings) reviewCounts[finding.verdict]++;
  }
  const landedAt =
    isObject(landing) && landing["name"] === name && parsedMs(landing["landedAt"]) !== null ? (landing["landedAt"] as string) : null;
  return {
    name,
    lanes: record.merged.map((m) => m.lane),
    headSha: head,
    updatedAt: record.updatedAt,
    verify: verify !== null && verify.headSha === head ? (verify.passed ? "passed" : "failed") : null,
    review: reviewCounts,
    ready: readiness !== null && readiness.headSha === head ? readiness.ready : null,
    landedAt,
  };
}

const byTime = (a: number | null, b: number | null): number => (a ?? 0) - (b ?? 0);
const byName = (a: { name: string }, b: { name: string }): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export function createSnapshotBuilder(source: SnapshotSource): SnapshotBuilder {
  const lanes = new Map<string, CachedLane>();
  const integrations = new Map<string, CachedIntegration>();

  function readIntegrations(): UiIntegration[] {
    const names = listIntegrations(source.root);
    for (const name of integrations.keys()) if (!names.includes(name)) integrations.delete(name);
    const out: UiIntegration[] = [];
    for (const name of names) {
      let value: UiIntegration | null = null;
      try {
        const paths = integrationPaths(source.root, source.config, name);
        const signature = integrationSignature([paths.integration, paths.verify, paths.review, paths.readiness, paths.landing]);
        const cached = integrations.get(name);
        if (cached?.signature === signature) {
          value = cached.value;
        } else {
          try {
            value = readUiIntegration(source, name);
          } catch {
            // Records that do not parse leave the integration out until one of them changes.
            value = null;
          }
          integrations.set(name, { signature, value });
        }
      } catch {
        value = null;
      }
      if (value !== null) out.push(value);
    }
    return out;
  }

  return {
    build(nowMs) {
      const cutoffMs = nowMs - source.windowHours * 3_600_000;
      const all = readIntegrations().sort((a, b) => byTime(parsedMs(a.updatedAt), parsedMs(b.updatedAt)) || byName(a, b));

      // The newest integration (by updatedAt) that merged a lane, and whether a merge keeps the lane in the window.
      const mergedBy = new Map<string, string>();
      const mergedRecently = new Set<string>();
      for (const integration of all) {
        const landedMs = parsedMs(integration.landedAt);
        const recent = integration.landedAt === null || (landedMs !== null && landedMs >= cutoffMs);
        for (const lane of integration.lanes) {
          mergedBy.set(lane, integration.name);
          if (recent) mergedRecently.add(lane);
        }
      }

      let hidden = 0;
      const names = listLanes(source.runsRoot);
      const present = new Set(names);
      for (const name of lanes.keys()) if (!present.has(name)) lanes.delete(name);
      const inWindow: Array<{ lane: UiLane; firstMs: number }> = [];
      for (const name of names) {
        let facts: LaneFacts;
        let record: LaneStateRecord | null;
        try {
          record = readState(source.runsRoot, name);
          if (record === null) continue;
          const state = effectiveState(record, source.alive);
          const key = stateKey(record);
          const cached = lanes.get(name);
          if (cached !== undefined && cached.key === key && cached.facts.state === state && !isLive(state)) {
            facts = cached.facts;
          } else {
            facts = readLane(source, name, record, state, nowMs);
            if (isLive(state)) lanes.delete(name);
            else lanes.set(name, { key, facts });
          }
        } catch {
          lanes.delete(name);
          hidden++;
          continue;
        }
        const sinceMs = parsedMs(record.since);
        const visible = facts.state !== "finished" || (sinceMs !== null && sinceMs >= cutoffMs) || mergedRecently.has(name);
        if (!visible) {
          hidden++;
          continue;
        }
        const { generatedBy, ...rest } = facts;
        const lane: UiLane = { ...rest, integration: generatedBy ?? mergedBy.get(name) ?? null };
        inWindow.push({ lane, firstMs: parsedMs(lane.firstSeen) ?? 0 });
      }

      // The newest by firstSeen survive the cap; the output runs oldest first.
      inWindow.sort((a, b) => b.firstMs - a.firstMs || byName(a.lane, b.lane));
      hidden += Math.max(0, inWindow.length - MAX_LANES);
      const kept = inWindow.slice(0, MAX_LANES).sort((a, b) => a.firstMs - b.firstMs || byName(a.lane, b.lane));
      source.counter.retain(new Set(kept.map((k) => k.lane.name)));

      const landed = all
        .filter((i) => i.landedAt !== null)
        .sort((a, b) => byTime(parsedMs(b.landedAt), parsedMs(a.landedAt)) || byName(a, b))
        .slice(0, LANDED_KEPT);
      const shown = all.filter((i) => i.landedAt === null || landed.includes(i));

      const quota = readQuota(source.home);
      const holdAbove = source.config.quota.holdAbove;
      return {
        protocol: UI_PROTOCOL,
        version: source.version,
        project: basename(source.root),
        now: new Date(nowMs).toISOString(),
        lanes: kept.map((k) => k.lane),
        hiddenLanes: hidden,
        integrations: shown,
        quota: {
          status: quota?.status ?? null,
          fiveHour: quota?.fiveHour ?? null,
          sevenDay: quota?.sevenDay ?? null,
          observedAt: quota?.observedAt ?? null,
          hold: holdDecision(quota, holdAbove, Math.floor(nowMs / 1000)),
          holdAbove: { fiveHour: holdAbove.fiveHour, sevenDay: holdAbove.sevenDay },
        },
        maxParallel: source.config.maxParallel,
      };
    },
  };
}
