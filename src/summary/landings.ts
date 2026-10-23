// What landed in a project since a moment, from its landing records (.arbab/integrations/<name>/landing.json): how a
// returning session learns what other sessions landed meanwhile (DESIGN.md §21).
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { listIntegrations } from "../integrate";
import { INTEGRATIONS_DIR } from "../types";

export interface LandingSince {
  name: string;
  into: string;
  landedAt: string;
  /** null outside Claude Code; undefined for a record written before 0.2.2. */
  owner?: string | null;
  mergeSha: string;
  squash: boolean;
  lanes: number;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** One landing record and its time, or null when it is missing, does not parse, or is not a landing of `name`. */
function readLanding(projectRoot: string, name: string): { landing: LandingSince; ms: number } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(resolve(projectRoot), INTEGRATIONS_DIR, name, "landing.json"), "utf8")) as unknown;
  } catch {
    return null;
  }
  if (!isObject(raw) || raw["name"] !== name) return null;
  const { into, landedAt, mergeSha, owner, squash, lanes } = raw;
  if (typeof into !== "string" || into === "" || typeof mergeSha !== "string" || typeof landedAt !== "string") return null;
  const ms = Date.parse(landedAt);
  if (!Number.isFinite(ms)) return null;
  const landing: LandingSince = {
    name,
    into,
    landedAt,
    mergeSha,
    squash: squash === true,
    lanes: Array.isArray(lanes) ? lanes.length : 0,
  };
  // An owner of the wrong type is unknown, as a record from before 0.2.2 is: nobody's own landing.
  if (owner === null || typeof owner === "string") landing.owner = owner;
  return { landing, ms };
}

/** How many characters of a session id name it. */
export const SESSION_CHARS = 8;

/** `session <first 8 characters>`, `outside Claude Code`, or `session unknown` for a record from before 0.2.2. */
export function landingOwner(owner: string | null | undefined): string {
  if (owner === null) return "outside Claude Code";
  return owner === undefined ? "session unknown" : `session ${owner.slice(0, SESSION_CHARS)}`;
}

/** `<name> at <landedAt> (<owner>)`. */
export function landingText(landing: LandingSince): string {
  return `${landing.name} at ${landing.landedAt} (${landingOwner(landing.owner)})`;
}

/** Landing records of `projectRoot` with landedAt after `sinceMs`, oldest first; unreadable records are skipped. */
export function landingsSince(projectRoot: string, sinceMs: number): LandingSince[] {
  return listIntegrations(projectRoot)
    .map((name) => readLanding(projectRoot, name))
    .filter((l): l is { landing: LandingSince; ms: number } => l !== null && l.ms > sinceMs)
    .sort((a, b) => a.ms - b.ms || (a.landing.name < b.landing.name ? -1 : a.landing.name > b.landing.name ? 1 : 0))
    .map((l) => l.landing);
}
