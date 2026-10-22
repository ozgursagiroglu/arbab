import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { HoldDecision, QuotaWindow, RateLimitSnapshot } from "../types";
import { ArbabError } from "../util/errors";
import { readJson, writeJsonAtomic } from "../util/fs";
import { isoAt, type Clock } from "../util/proc";

export interface HoldAbove {
  fiveHour: number;
  sevenDay: number;
}

/** ~/.arbab/quota.json, the account snapshot (DESIGN.md §3). */
export const quotaPath = (home: string): string => join(home, "quota.json");
const resetFile = (home: string): string => join(home, "quota-reset.json");

function isWindow(value: unknown): value is QuotaWindow {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return Number.isFinite(v["utilization"]) && Number.isFinite(v["resetsAt"]);
}

function isSnapshot(value: unknown): value is RateLimitSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const nullableString = (x: unknown): boolean => x === null || typeof x === "string";
  return (
    typeof v["observedAt"] === "string" &&
    !Number.isNaN(Date.parse(v["observedAt"])) &&
    nullableString(v["status"]) &&
    nullableString(v["type"]) &&
    (v["fiveHour"] === null || isWindow(v["fiveHour"])) &&
    (v["sevenDay"] === null || isWindow(v["sevenDay"]))
  );
}

/**
 * The stored account snapshot. A missing or unreadable file means "unknown", never an error: the next
 * rate_limit_event rewrites it.
 */
export function readQuota(home: string): RateLimitSnapshot | null {
  let value: unknown;
  try {
    value = readJson<unknown>(quotaPath(home));
  } catch (err) {
    if (err instanceof ArbabError) return null;
    throw err;
  }
  return isSnapshot(value) ? value : null;
}

/** Stores the snapshot when it is newer than the stored one (several workers report out of order). */
export function updateQuota(home: string, snapshot: RateLimitSnapshot): boolean {
  if (!isSnapshot(snapshot)) throw new ArbabError("usage", "invalid rate-limit snapshot");
  const stored = readQuota(home);
  if (stored && Date.parse(snapshot.observedAt) <= Date.parse(stored.observedAt)) return false;
  writeJsonAtomic(quotaPath(home), snapshot);
  return true;
}

/**
 * `arbab quota --reset`, after an account switch: deletes the snapshot and records when, so a lane waiting out the old
 * account's usage limit resumes early. The snapshot alone cannot say so: it carries only the five-hour and seven-day
 * windows, and another lane's events look fine while this lane's limit (seven_day_opus, say) still holds. Recorded
 * even without a snapshot. Returns whether a snapshot was removed.
 */
export function resetQuota(home: string, clock: Clock): boolean {
  const path = quotaPath(home);
  const existed = existsSync(path);
  try {
    rmSync(path, { force: true });
  } catch (err) {
    throw new ArbabError("io", `cannot remove ${path}: ${(err as Error).message}`, { cause: err });
  }
  writeJsonAtomic(resetFile(home), { resetAt: isoAt(clock) });
  return existed;
}

/**
 * `arbab quota --refresh`: stores a snapshot read on the current account even when it is older than the stored one,
 * which may describe the previous account, and records the switch as `resetQuota` does.
 */
export function replaceQuota(home: string, snapshot: RateLimitSnapshot, clock: Clock): void {
  if (!isSnapshot(snapshot)) throw new ArbabError("usage", "invalid rate-limit snapshot");
  writeJsonAtomic(quotaPath(home), snapshot);
  writeJsonAtomic(resetFile(home), { resetAt: isoAt(clock) });
}

/** When `arbab quota --reset` last ran (epoch ms); null when it never did or the record is unreadable. */
export function lastQuotaReset(home: string): number | null {
  let value: unknown;
  try {
    value = readJson<unknown>(resetFile(home));
  } catch (err) {
    if (err instanceof ArbabError) return null;
    throw err;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const resetAt = (value as Record<string, unknown>)["resetAt"];
  if (typeof resetAt !== "string") return null;
  const ms = Date.parse(resetAt);
  return Number.isNaN(ms) ? null : ms;
}

const pct = (utilization: number): string => `${Math.round(utilization * 100)}%`;

type WindowKey = "fiveHour" | "sevenDay";
const WINDOWS: ReadonlyArray<{ key: WindowKey; name: string; label: string }> = [
  { key: "fiveHour", name: "five-hour", label: "5h" },
  { key: "sevenDay", name: "seven-day", label: "7d" },
];

/** The window a rejection names (rateLimitType "five_hour", "seven_day", "seven_day_opus", …), if any. */
function rejectedWindow(type: string | null): WindowKey | null {
  if (type?.startsWith("five_hour")) return "fiveHour";
  if (type?.startsWith("seven_day")) return "sevenDay";
  return null;
}

/** DESIGN.md §8. Windows whose reset has passed never hold: the snapshot predates the reset. */
export function holdDecision(snapshot: RateLimitSnapshot | null, holdAbove: HoldAbove, nowSec: number): HoldDecision {
  if (!snapshot) return { hold: false, reason: null, until: null };
  const reasons: string[] = [];
  let until: number | null = null;
  const named = snapshot.status === "rejected" ? rejectedWindow(snapshot.type) : null;
  for (const { key, name } of WINDOWS) {
    const window = snapshot[key];
    if (!window || window.resetsAt <= nowSec) continue;
    let reason: string | null = null;
    // A rejection that names its window holds only that one; otherwise every live window may be the cause.
    if (snapshot.status === "rejected" && (named === null || named === key)) {
      reason = `rate limit rejected (${name} window at ${pct(window.utilization)})`;
    } else if (window.utilization >= holdAbove[key]) {
      reason = `${name} window at ${pct(window.utilization)} (hold above ${pct(holdAbove[key])})`;
    }
    if (reason) {
      reasons.push(reason);
      until = Math.max(until ?? 0, window.resetsAt);
    }
  }
  return reasons.length > 0 ? { hold: true, reason: reasons.join("; "), until } : { hold: false, reason: null, until: null };
}

/** When a usage-limited lane resumes: a minute after the reset plus the caller's 0–60 s jitter. */
export function resumeAt(resetsAt: number, jitterSec: number): number {
  if (!Number.isFinite(jitterSec) || jitterSec < 0 || jitterSec > 60) {
    throw new ArbabError("usage", `jitter ${jitterSec} must be between 0 and 60 seconds`);
  }
  return resetsAt + 60 + jitterSec;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `12:30Z` on the current UTC day, `Oct 15 08:00Z` on any other. */
function formatReset(resetsAt: number, nowSec: number): string {
  const at = new Date(resetsAt * 1000);
  const now = new Date(nowSec * 1000);
  const two = (n: number): string => String(n).padStart(2, "0");
  const time = `${two(at.getUTCHours())}:${two(at.getUTCMinutes())}Z`;
  const sameDay =
    at.getUTCFullYear() === now.getUTCFullYear() &&
    at.getUTCMonth() === now.getUTCMonth() &&
    at.getUTCDate() === now.getUTCDate();
  return sameDay ? time : `${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()} ${time}`;
}

/** e.g. `5h 62% (resets 12:30Z) · 7d 60% (resets Oct 15 08:00Z)`, or `quota unknown`. */
export function formatQuota(snapshot: RateLimitSnapshot | null, nowSec: number): string {
  if (!snapshot) return "quota unknown";
  const parts: string[] = [];
  for (const { key, label } of WINDOWS) {
    const window = snapshot[key];
    if (!window) continue;
    parts.push(
      window.resetsAt > nowSec
        ? `${label} ${pct(window.utilization)} (resets ${formatReset(window.resetsAt, nowSec)})`
        : `${label} — (reset ${formatReset(window.resetsAt, nowSec)})`,
    );
  }
  if (parts.length === 0) return "quota unknown";
  if (snapshot.status === "rejected") parts.push("rejected");
  return parts.join(" · ");
}
