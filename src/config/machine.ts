import { join } from "node:path";
import { MACHINE_CONFIG_FILE } from "../types";
import type { MachineConfig } from "../types";
import { integerIn, knownKeys, readJsonFile, record } from "./check";

/** Reads <home>/machine.json (home is ~/.arbab). Missing file → { maxParallel: null }. */
export function loadMachineConfig(home: string): MachineConfig {
  const raw = readJsonFile(join(home, MACHINE_CONFIG_FILE));
  const config: MachineConfig = { maxParallel: null };
  if (raw === null) return config;
  const obj = record(raw, MACHINE_CONFIG_FILE);
  knownKeys(obj, ["maxParallel"], MACHINE_CONFIG_FILE);
  if (obj.maxParallel !== undefined && obj.maxParallel !== null) {
    config.maxParallel = integerIn(obj.maxParallel, 1, 32, `${MACHINE_CONFIG_FILE} maxParallel`);
  }
  return config;
}
