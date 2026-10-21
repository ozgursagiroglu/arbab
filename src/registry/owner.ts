import { readFileSync } from "node:fs";
import type { ShepherdRecord } from "../types";
import { runPaths } from "./paths";

// Which Claude Code session a run belongs to (DESIGN.md §21). Read at the edge and passed in; never from process.env here.

/** CLAUDE_CODE_SESSION_ID when set and non-empty, else null. */
export function sessionOf(env: Record<string, string | undefined>): string | null {
  const id = env["CLAUDE_CODE_SESSION_ID"];
  return id === undefined || id.trim() === "" ? null : id;
}

/** <runs>/<lane>/shepherd.json, or null when missing or invalid. */
export function readShepherdRecord(runsRoot: string, lane: string): ShepherdRecord | null {
  let v: unknown;
  try {
    v = JSON.parse(readFileSync(runPaths(runsRoot, lane).shepherdFile, "utf8")) as unknown;
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const obj = v as Record<string, unknown>;
  if (!Number.isSafeInteger(obj.pid) || (obj.pid as number) < 1 || typeof obj.startedAt !== "string") return null;
  const record: ShepherdRecord = { pid: obj.pid as number, startedAt: obj.startedAt };
  // An owner of the wrong type is unknown, not fatal: the run is treated as ownerless.
  if (obj.owner === null || typeof obj.owner === "string") record.owner = obj.owner;
  return record;
}

/**
 * Whether a run belongs to `session`. A null session (outside Claude Code) owns everything. A run without an owner
 * (null record, owner absent or null) belongs to every session when `ownerless` is true (the default), to none when
 * it is false.
 */
export function ownedBy(record: ShepherdRecord | null, session: string | null, opts: { ownerless?: boolean } = {}): boolean {
  if (session === null) return true;
  const owner = record?.owner ?? null;
  if (owner === null) return opts.ownerless ?? true;
  return owner === session;
}
