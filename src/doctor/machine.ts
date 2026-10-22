import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, loadMachineConfig } from "../config";
import { listProjects } from "../registry";
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

/** Worktrees of finished lanes and dead writer locks pile up until `arbab cleanup` removes them. */
export function checkDisk(worktreeDir: string, worktreeLabel: string, home: string): DoctorCheck[] {
  const worktrees = countDirs(worktreeDir);
  const locks = countEmptyDirs(join(home, "locks"));
  const out: DoctorCheck[] = [];
  if (worktrees > MAX_WORKTREE_DIRS) {
    out.push({
      status: "warn",
      check: "disk",
      detail: `${worktrees} directories in ${worktreeLabel} (more than ${MAX_WORKTREE_DIRS}): arbab cleanup --worktrees removes finished lanes' worktrees`,
    });
  }
  if (locks > MAX_EMPTY_LOCK_DIRS) {
    out.push({ status: "warn", check: "disk", detail: `${locks} empty lock directories (more than ${MAX_EMPTY_LOCK_DIRS}): arbab cleanup removes them` });
  }
  if (out.length === 0) out.push({ status: "ok", check: "disk", detail: `${worktrees} worktree directories, ${locks} empty lock directories` });
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
