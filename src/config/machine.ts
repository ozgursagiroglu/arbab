import { join } from "node:path";
import { MACHINE_CONFIG_FILE, MEMORY_PRESSURE_HOLDS } from "../types";
import type { MachineConfig, MemoryPressureHold } from "../types";
import { ArbabError } from "../util/errors";
import { fail, integerIn, knownKeys, readJsonFile, record } from "./check";

/** Every machine limit unset: each field's default applies (DESIGN.md §21, §22). */
export function defaultMachineConfig(): MachineConfig {
  return {
    maxParallel: null,
    checks: { concurrent: null, waitSec: null },
    admission: { loadPerCpu: null, memoryPressure: null, maxHoldMin: null },
  };
}

const MACHINE_KEYS = ["maxParallel", "checks", "admission"] as const;
const field = (key: string): string => `${MACHINE_CONFIG_FILE} ${key}`;
const set = (v: unknown): boolean => v !== undefined && v !== null;

// One parser per top-level field, so the lenient loader can keep the valid ones when another is wrong.
const parsers: { [K in (typeof MACHINE_KEYS)[number]]: (v: unknown, config: MachineConfig) => void } = {
  maxParallel(v, config) {
    config.maxParallel = integerIn(v, 1, 32, field("maxParallel"));
  },
  checks(v, config) {
    const c = record(v, field("checks"));
    knownKeys(c, ["concurrent", "waitSec"], field("checks"));
    const checks: MachineConfig["checks"] = { concurrent: null, waitSec: null };
    if (set(c.concurrent)) checks.concurrent = integerIn(c.concurrent, 1, 64, field("checks.concurrent"));
    if (set(c.waitSec)) checks.waitSec = integerIn(c.waitSec, 0, 900, field("checks.waitSec"));
    config.checks = checks;
  },
  admission(v, config) {
    const a = record(v, field("admission"));
    knownKeys(a, ["loadPerCpu", "memoryPressure", "maxHoldMin"], field("admission"));
    const admission: MachineConfig["admission"] = { loadPerCpu: null, memoryPressure: null, maxHoldMin: null };
    if (set(a.maxHoldMin)) admission.maxHoldMin = integerIn(a.maxHoldMin, 0, 1440, field("admission.maxHoldMin"));
    if (set(a.loadPerCpu)) {
      const n = a.loadPerCpu;
      if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 64) fail(field("admission.loadPerCpu"), "must be a number from 0 (never hold) to 64");
      admission.loadPerCpu = n;
    }
    if (set(a.memoryPressure)) {
      const s = a.memoryPressure;
      if (typeof s !== "string" || !(MEMORY_PRESSURE_HOLDS as readonly string[]).includes(s)) {
        fail(field("admission.memoryPressure"), `must be one of ${MEMORY_PRESSURE_HOLDS.join(", ")}`);
      }
      admission.memoryPressure = s as MemoryPressureHold;
    }
    config.admission = admission;
  },
};

/** Reads <home>/machine.json (home is ~/.arbab). Missing file, or a field null or absent → that field's default. */
export function loadMachineConfig(home: string): MachineConfig {
  const raw = readJsonFile(join(home, MACHINE_CONFIG_FILE));
  const config = defaultMachineConfig();
  if (raw === null) return config;
  const obj = record(raw, MACHINE_CONFIG_FILE);
  knownKeys(obj, MACHINE_KEYS, MACHINE_CONFIG_FILE);
  for (const key of MACHINE_KEYS) if (set(obj[key])) parsers[key](obj[key], config);
  return config;
}

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * machine.json for the shepherd's polls (DESIGN.md §22): each of maxParallel, checks and admission is read on its own,
 * so a typo in one keeps the others, the machine's slot cap above all. An invalid field keeps its default and adds an
 * error naming it; a missing file is every default and no error; an unreadable, unparsable or non-object file is every
 * default and one error. doctor and summary use loadMachineConfig, which refuses the whole file.
 */
export function loadMachineConfigLenient(home: string): { config: MachineConfig; errors: string[] } {
  const config = defaultMachineConfig();
  let raw: unknown;
  try {
    raw = readJsonFile(join(home, MACHINE_CONFIG_FILE));
    if (raw === null) return { config, errors: [] };
    record(raw, MACHINE_CONFIG_FILE);
  } catch (err) {
    return { config, errors: [reason(err)] };
  }
  const obj = raw as Record<string, unknown>;
  const errors: string[] = [];
  for (const key of Object.keys(obj)) {
    if (!(MACHINE_KEYS as readonly string[]).includes(key)) errors.push(`${MACHINE_CONFIG_FILE}.${key}: unknown key`);
  }
  for (const key of MACHINE_KEYS) {
    if (!set(obj[key])) continue;
    try {
      parsers[key](obj[key], config);
    } catch (err) {
      if (!(err instanceof ArbabError)) throw err;
      errors.push(err.message);
    }
  }
  return { config, errors };
}
