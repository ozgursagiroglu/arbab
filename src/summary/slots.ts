// The Quota and slots section of `arbab summary`. Reads <home>/slots/ without reclaiming anything: a summary only reads.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { holdDecision, readQuota } from "../quota";
import type { HoldDecision, MachineConfig, ProjectConfig, RateLimitSnapshot } from "../types";

export interface SlotHolder {
  slot: number;
  pid: number;
  lane: string;
  project: string;
}

export interface QuotaOverview {
  snapshot: RateLimitSnapshot | null;
  hold: HoldDecision;
  slots: {
    /** Machine-wide entries whose pid is alive, by slot. */
    inUse: SlotHolder[];
    /** The project's maxParallel, capped by machine.json's. */
    cap: number;
    projectMaxParallel: number;
    machineMaxParallel: number | null;
  };
}

const SLOT_FILE = /^(0|[1-9][0-9]*)\.json$/;

function holder(path: string): Omit<SlotHolder, "slot"> | null {
  let v: unknown;
  try {
    v = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    // Gone, or its creator is between open and write.
    return null;
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (!Number.isSafeInteger(o.pid) || (o.pid as number) < 1 || typeof o.lane !== "string" || typeof o.project !== "string") return null;
  return { pid: o.pid as number, lane: o.lane, project: o.project };
}

/** The slots held by live processes on this machine, by slot number. */
export function slotsInUse(home: string, alive: (pid: number) => boolean): SlotHolder[] {
  let files: string[];
  try {
    files = readdirSync(join(home, "slots"));
  } catch {
    return [];
  }
  const out: SlotHolder[] = [];
  for (const file of files) {
    const match = SLOT_FILE.exec(file);
    if (match === null) continue;
    const h = holder(join(home, "slots", file));
    if (h !== null && alive(h.pid)) out.push({ slot: Number(match[1]), ...h });
  }
  return out.sort((a, b) => a.slot - b.slot);
}

export function effectiveCap(projectMaxParallel: number, machine: MachineConfig): number {
  return machine.maxParallel === null ? projectMaxParallel : Math.min(projectMaxParallel, machine.maxParallel);
}

export function quotaOverview(input: {
  home: string;
  config: Pick<ProjectConfig, "maxParallel" | "quota">;
  machine: MachineConfig;
  alive: (pid: number) => boolean;
  nowSec: number;
}): QuotaOverview {
  const snapshot = readQuota(input.home);
  return {
    snapshot,
    hold: holdDecision(snapshot, input.config.quota.holdAbove, input.nowSec),
    slots: {
      inUse: slotsInUse(input.home, input.alive),
      cap: effectiveCap(input.config.maxParallel, input.machine),
      projectMaxParallel: input.config.maxParallel,
      machineMaxParallel: input.machine.maxParallel,
    },
  };
}
