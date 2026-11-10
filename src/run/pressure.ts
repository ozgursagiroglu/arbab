// Launch admission by machine load (DESIGN.md §22): the memory pressure reading and the decision whether a launch
// waits. Pure: the platform, the command runner and the file reader come in as parameters.
import type { MemoryPressureHold, MemoryPressureLevel } from "../types";

const MACOS_LEVELS: Readonly<Record<string, MemoryPressureLevel>> = { "1": "normal", "2": "warn", "4": "critical" };
const PSI_WARN = 10;
const PSI_CRITICAL = 30;

/** macOS: `sysctl -n kern.memorystatus_vm_pressure_level` → 1 normal, 2 warn, 4 critical. Linux: /proc/pressure/memory,
 *  the `some` line's avg10 → ≥ 30 critical, ≥ 10 warn, else normal. Anything unreadable or unexpected → null. */
export function readMemoryPressure(
  platform: NodeJS.Platform,
  exec: (file: string, args: string[]) => string | null,
  readFile: (path: string) => string | null,
): MemoryPressureLevel | null {
  if (platform === "darwin") {
    const out = exec("sysctl", ["-n", "kern.memorystatus_vm_pressure_level"]);
    if (out === null) return null;
    const value = out.trim();
    return Object.hasOwn(MACOS_LEVELS, value) ? (MACOS_LEVELS[value] as MemoryPressureLevel) : null;
  }
  if (platform === "linux") {
    const text = readFile("/proc/pressure/memory");
    if (text === null) return null;
    const some = text.split("\n").find((line) => line.startsWith("some "));
    const match = some === undefined ? null : /(?:^|\s)avg10=(\d+(?:\.\d+)?)(?:\s|$)/.exec(some);
    if (match === null) return null;
    const avg10 = Number(match[1]);
    if (!Number.isFinite(avg10)) return null;
    if (avg10 >= PSI_CRITICAL) return "critical";
    return avg10 >= PSI_WARN ? "warn" : "normal";
  }
  return null;
}

const HOLDS_AT: Readonly<Record<MemoryPressureHold, readonly MemoryPressureLevel[]>> = {
  warn: ["warn", "critical"],
  critical: ["critical"],
  off: [],
};

/** Whether a launch waits now. loadPerCpu 0 never holds; memoryPressure "off" never holds; a null reading never holds.
 *  "warn" holds at warn and critical, "critical" only at critical. Reasons: `machine load 34.2 on 8 CPUs` (one decimal)
 *  or `memory pressure critical`; the load reason wins when both hold. */
export function admissionDecision(input: {
  cpus: number;
  loadAvg: number;
  pressure: MemoryPressureLevel | null;
  loadPerCpu: number;
  memoryPressure: MemoryPressureHold;
}): { hold: boolean; reason: string | null } {
  const { cpus, loadAvg, pressure, loadPerCpu, memoryPressure } = input;
  // A machine that reports no CPUs is counted as one, so the threshold still means something.
  const n = Number.isFinite(cpus) && cpus >= 1 ? cpus : 1;
  if (loadPerCpu > 0 && Number.isFinite(loadAvg) && loadAvg >= loadPerCpu * n) {
    return { hold: true, reason: `machine load ${loadAvg.toFixed(1)} on ${n} CPUs` };
  }
  if (pressure !== null && HOLDS_AT[memoryPressure].includes(pressure)) {
    return { hold: true, reason: `memory pressure ${pressure}` };
  }
  return { hold: false, reason: null };
}
