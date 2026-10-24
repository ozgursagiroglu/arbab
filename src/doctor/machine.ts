import { existsSync, readdirSync, statfsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { loadConfig, loadMachineConfig } from "../config";
import { listProjects } from "../registry";
import { unusedText } from "../summary";
import type { MachineConfig, ProjectEntry } from "../types";
import type { DoctorCheck } from "./types";

export const MAX_WORKTREE_DIRS = 30;
export const MAX_EMPTY_LOCK_DIRS = 100;

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function entries(dir: string): Array<{ name: string; isDirectory: () => boolean }> {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** The directories directly in `dir`; 0 when it is missing. */
export function countDirs(dir: string): number {
  return entries(dir).filter((e) => e.isDirectory()).length;
}

/** The empty directories directly in `dir`; 0 when it is missing. */
export function countEmptyDirs(dir: string): number {
  return entries(dir).filter((e) => e.isDirectory() && entries(join(dir, e.name)).length === 0).length;
}

/** Below this many bytes free on the worktrees' volume, doctor warns: a worktree with dependencies takes gigabytes. */
export const MIN_FREE_BYTES = 20e9;

/**
 * The bytes free to an unprivileged user (`bavail * bsize`) on the volume holding `path`, asked of its nearest existing
 * ancestor; null when even that cannot be read.
 */
export function volumeFreeBytes(path: string, statfs: (path: string) => { bavail: number; bsize: number } = statfsSync): number | null {
  for (let p = resolve(path); ; p = dirname(p)) {
    if (existsSync(p)) {
      try {
        const s = statfs(p);
        const free = s.bavail * s.bsize;
        return Number.isFinite(free) && free >= 0 ? free : null;
      } catch {
        return null;
      }
    }
    if (dirname(p) === p) return null;
  }
}

export const formatGb = (bytes: number): string => `${(bytes / 1e9).toFixed(1)} GB`;

function sweepAdvice(idleDays: number): string {
  const now = "arbab cleanup --worktrees --older-than <days> removes unused ones now";
  return idleDays === 0
    ? `the automatic sweep is off (worktrees.idleDays 0); ${now}`
    : `the automatic sweep (worktrees.idleDays ${idleDays}) removes them after a launch; ${now}`;
}

export interface DiskInput {
  worktreeDir: string;
  worktreeLabel: string;
  home: string;
  /** Worktrees of finished lanes and unlanded integrations unused for more than idleDays (worktreeOverview). */
  idle: number;
  /** config worktrees.idleDays; 0 = the automatic sweep is off. */
  idleDays: number;
  /** Free space on the worktrees' volume; null when unknown. */
  freeBytes: number | null;
}

/**
 * Worktrees of finished lanes and dead writer locks pile up until the automatic sweep or `arbab cleanup` removes them;
 * warns on too many worktrees, too little free space for them, or too many empty lock directories.
 */
export function checkDisk(input: DiskInput): DoctorCheck[] {
  const { worktreeLabel, idle, idleDays, freeBytes } = input;
  const worktrees = countDirs(input.worktreeDir);
  const locks = countEmptyDirs(join(input.home, "locks"));
  const unused = unusedText(idle, idleDays);
  const out: DoctorCheck[] = [];
  if (worktrees > MAX_WORKTREE_DIRS) {
    out.push({
      status: "warn",
      check: "disk",
      detail: `${worktrees} directories in ${worktreeLabel} (more than ${MAX_WORKTREE_DIRS}; ${unused}): ${sweepAdvice(idleDays)}`,
    });
  }
  if (freeBytes !== null && freeBytes < MIN_FREE_BYTES) {
    out.push({
      status: "warn",
      check: "disk",
      detail: `${formatGb(freeBytes)} free on the volume of ${worktreeLabel} (less than ${formatGb(MIN_FREE_BYTES)}; ${unused}): ${sweepAdvice(idleDays)}`,
    });
  }
  if (locks > MAX_EMPTY_LOCK_DIRS) {
    out.push({ status: "warn", check: "disk", detail: `${locks} empty lock directories (more than ${MAX_EMPTY_LOCK_DIRS}): arbab cleanup removes them` });
  }
  if (out.length === 0) {
    const free = freeBytes === null ? "free space unknown" : `${formatGb(freeBytes)} free`;
    out.push({ status: "ok", check: "disk", detail: `${worktrees} worktree directories (${unused}), ${free}, ${locks} empty lock directories` });
  }
  return out;
}

/**
 * Slots live in ~/.arbab and are shared by every project, so each project's maxParallel only says how many of them it
 * may take. machine.json caps them all; without it, projects that disagree race for the same slots. Null when there
 * is no machine cap and nothing disagrees.
 */
export function checkMachineCap(home: string, root: string, maxParallel: number): DoctorCheck | null {
  let machine: MachineConfig;
  try {
    machine = loadMachineConfig(home);
  } catch (err) {
    return { status: "fail", check: "machine", detail: message(err) };
  }
  if (machine.maxParallel !== null) {
    const cap = Math.min(maxParallel, machine.maxParallel);
    return { status: "ok", check: "machine", detail: `maxParallel min(${maxParallel}, ${machine.maxParallel}) = ${cap}` };
  }

  // This project counts even before its first launch registers it.
  const caps = new Map<string, number>([[root, maxParallel]]);
  let projects: ProjectEntry[] = [];
  try {
    projects = listProjects(home);
  } catch {
    // An unreadable registry leaves only this project to compare.
  }
  for (const p of projects) {
    if (caps.has(p.root) || !existsSync(p.root)) continue;
    try {
      caps.set(p.root, loadConfig(p.root).maxParallel);
    } catch {
      // A project whose config does not load cannot launch, so it takes no slot.
    }
  }
  const distinct = [...new Set(caps.values())].sort((a, b) => a - b);
  if (distinct.length < 2) return null;
  return {
    status: "warn",
    check: "machine",
    detail: `slots are shared machine-wide: set maxParallel in ~/.arbab/machine.json (projects set ${distinct.join(", ")})`,
  };
}
