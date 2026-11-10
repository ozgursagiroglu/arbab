import { describe, expect, it } from "vitest";
import { admissionDecision, readMemoryPressure } from "./pressure";

const noExec = (): string | null => {
  throw new Error("exec must not be called");
};
const noRead = (): string | null => {
  throw new Error("readFile must not be called");
};

describe("readMemoryPressure on macOS", () => {
  const calls: Array<[string, string[]]> = [];
  const sysctl =
    (out: string | null) =>
    (file: string, args: string[]): string | null => {
      calls.push([file, args]);
      return out;
    };

  it("maps 1, 2 and 4 to normal, warn and critical, asking sysctl by argv", () => {
    calls.length = 0;
    expect(readMemoryPressure("darwin", sysctl("1\n"), noRead)).toBe("normal");
    expect(readMemoryPressure("darwin", sysctl("2\n"), noRead)).toBe("warn");
    expect(readMemoryPressure("darwin", sysctl("4"), noRead)).toBe("critical");
    expect(calls[0]).toEqual(["sysctl", ["-n", "kern.memorystatus_vm_pressure_level"]]);
  });

  it("is null for an unknown value, empty output or a failed command", () => {
    for (const out of ["0", "3", "8", "", "warn", "2 4", "constructor"]) {
      expect(readMemoryPressure("darwin", sysctl(out), noRead)).toBeNull();
    }
    expect(readMemoryPressure("darwin", sysctl(null), noRead)).toBeNull();
  });
});

describe("readMemoryPressure on Linux", () => {
  const psi = (avg10: string): string =>
    `some avg10=${avg10} avg60=1.00 avg300=0.50 total=123456\nfull avg10=99.00 avg60=0.00 avg300=0.00 total=0\n`;
  const file =
    (text: string | null) =>
    (path: string): string | null => {
      expect(path).toBe("/proc/pressure/memory");
      return text;
    };

  it("reads the some line's avg10 against 10 and 30", () => {
    expect(readMemoryPressure("linux", noExec, file(psi("0.00")))).toBe("normal");
    expect(readMemoryPressure("linux", noExec, file(psi("9.99")))).toBe("normal");
    expect(readMemoryPressure("linux", noExec, file(psi("10.00")))).toBe("warn");
    expect(readMemoryPressure("linux", noExec, file(psi("29.99")))).toBe("warn");
    expect(readMemoryPressure("linux", noExec, file(psi("30.00")))).toBe("critical");
    expect(readMemoryPressure("linux", noExec, file(psi("87.5")))).toBe("critical");
  });

  it("ignores the full line, whatever it says", () => {
    expect(readMemoryPressure("linux", noExec, file("full avg10=50.00 avg60=0 avg300=0 total=0\nsome avg10=1.00 avg60=0 avg300=0 total=0\n"))).toBe(
      "normal",
    );
  });

  it("is null for a malformed file or a failed read", () => {
    for (const text of ["", "garbage\n", "some avg60=1.00 total=0\n", "some avg10=abc avg60=0\n", "some avg10=-5 avg60=0\n", "full avg10=50.00\n", "some xavg10=40.00\n"]) {
      expect(readMemoryPressure("linux", noExec, file(text))).toBeNull();
    }
    expect(readMemoryPressure("linux", noExec, file(null))).toBeNull();
  });
});

describe("readMemoryPressure elsewhere", () => {
  it("is null on a platform it cannot read, touching nothing", () => {
    expect(readMemoryPressure("win32", noExec, noRead)).toBeNull();
    expect(readMemoryPressure("freebsd", noExec, noRead)).toBeNull();
  });
});

describe("admissionDecision", () => {
  const base = { cpus: 8, loadAvg: 0, pressure: "normal" as const, loadPerCpu: 3, memoryPressure: "critical" as const };
  const go = { hold: false, reason: null };

  it("holds at the load threshold and above, not below, naming the load with one decimal", () => {
    expect(admissionDecision({ ...base, loadAvg: 23.99 })).toEqual(go);
    expect(admissionDecision({ ...base, loadAvg: 24 })).toEqual({ hold: true, reason: "machine load 24.0 on 8 CPUs" });
    expect(admissionDecision({ ...base, loadAvg: 34.24 })).toEqual({ hold: true, reason: "machine load 34.2 on 8 CPUs" });
    expect(admissionDecision({ ...base, loadAvg: 4, cpus: 2, loadPerCpu: 1.5 })).toEqual({ hold: true, reason: "machine load 4.0 on 2 CPUs" });
  });

  it("never holds for load when loadPerCpu is 0", () => {
    expect(admissionDecision({ ...base, loadAvg: 500, loadPerCpu: 0 })).toEqual(go);
  });

  it("holds at critical only for the critical setting", () => {
    expect(admissionDecision({ ...base, pressure: "warn" })).toEqual(go);
    expect(admissionDecision({ ...base, pressure: "critical" })).toEqual({ hold: true, reason: "memory pressure critical" });
  });

  it("holds at warn and critical for the warn setting, not at normal", () => {
    const warn = { ...base, memoryPressure: "warn" as const };
    expect(admissionDecision(warn)).toEqual(go);
    expect(admissionDecision({ ...warn, pressure: "warn" })).toEqual({ hold: true, reason: "memory pressure warn" });
    expect(admissionDecision({ ...warn, pressure: "critical" })).toEqual({ hold: true, reason: "memory pressure critical" });
  });

  it("never holds for pressure when it is off or the reading is null", () => {
    expect(admissionDecision({ ...base, pressure: "critical", memoryPressure: "off" })).toEqual(go);
    expect(admissionDecision({ ...base, pressure: null, memoryPressure: "warn" })).toEqual(go);
  });

  it("names the load when both hold", () => {
    expect(admissionDecision({ ...base, loadAvg: 40, pressure: "critical" })).toEqual({ hold: true, reason: "machine load 40.0 on 8 CPUs" });
  });

  it("counts an unusable CPU count as one and never holds on an unusable load", () => {
    expect(admissionDecision({ ...base, cpus: 0, loadAvg: 3 })).toEqual({ hold: true, reason: "machine load 3.0 on 1 CPUs" });
    expect(admissionDecision({ ...base, loadAvg: Number.NaN })).toEqual(go);
  });
});
