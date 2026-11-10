import { join } from "node:path";
import { MACHINE_CONFIG_FILE, MEMORY_PRESSURE_HOLDS } from "../types";
import type { MachineConfig, MemoryPressureHold } from "../types";
import { fail, integerIn, knownKeys, readJsonFile, record } from "./check";

/** Every machine limit unset: each field's default applies (DESIGN.md §21, §22). */
export function defaultMachineConfig(): MachineConfig {
  return { maxParallel: null, checks: { concurrent: null, waitSec: null }, admission: { loadPerCpu: null, memoryPressure: null } };
}

/** Reads <home>/machine.json (home is ~/.arbab). Missing file, or a field null or absent → that field's default. */
export function loadMachineConfig(home: string): MachineConfig {
  const raw = readJsonFile(join(home, MACHINE_CONFIG_FILE));
  const config = defaultMachineConfig();
  if (raw === null) return config;
  const obj = record(raw, MACHINE_CONFIG_FILE);
  knownKeys(obj, ["maxParallel", "checks", "admission"], MACHINE_CONFIG_FILE);
  const field = (key: string): string => `${MACHINE_CONFIG_FILE} ${key}`;
  const set = (v: unknown): boolean => v !== undefined && v !== null;
  if (set(obj.maxParallel)) config.maxParallel = integerIn(obj.maxParallel, 1, 32, field("maxParallel"));
  if (set(obj.checks)) {
    const c = record(obj.checks, field("checks"));
    knownKeys(c, ["concurrent", "waitSec"], field("checks"));
    if (set(c.concurrent)) config.checks.concurrent = integerIn(c.concurrent, 1, 64, field("checks.concurrent"));
    if (set(c.waitSec)) config.checks.waitSec = integerIn(c.waitSec, 0, 900, field("checks.waitSec"));
  }
  if (set(obj.admission)) {
    const a = record(obj.admission, field("admission"));
    knownKeys(a, ["loadPerCpu", "memoryPressure"], field("admission"));
    if (set(a.loadPerCpu)) {
      const v = a.loadPerCpu;
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 64) fail(field("admission.loadPerCpu"), "must be a number from 0 (never hold) to 64");
      config.admission.loadPerCpu = v;
    }
    if (set(a.memoryPressure)) {
      const v = a.memoryPressure;
      if (typeof v !== "string" || !(MEMORY_PRESSURE_HOLDS as readonly string[]).includes(v)) {
        fail(field("admission.memoryPressure"), `must be one of ${MEMORY_PRESSURE_HOLDS.join(", ")}`);
      }
      config.admission.memoryPressure = v as MemoryPressureHold;
    }
  }
  return config;
}
