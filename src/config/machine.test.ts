import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArbabError } from "../util/errors";
import { defaultMachineConfig, loadMachineConfig } from "./index";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "arbab-machine-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function write(text: string): void {
  writeFileSync(join(home, "machine.json"), text);
}

function errorOf(fn: () => unknown): ArbabError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ArbabError);
    return err as ArbabError;
  }
  throw new Error("expected an ArbabError");
}

describe("loadMachineConfig", () => {
  it("has no cap when the file is missing", () => {
    expect(loadMachineConfig(home)).toEqual(defaultMachineConfig());
  });

  it("has no cap for an empty object or a null maxParallel", () => {
    write("{}");
    expect(loadMachineConfig(home)).toEqual(defaultMachineConfig());
    write('{"maxParallel": null}');
    expect(loadMachineConfig(home)).toEqual(defaultMachineConfig());
  });

  it("reads maxParallel from 1 to 32", () => {
    for (const n of [1, 8, 32]) {
      write(JSON.stringify({ maxParallel: n }));
      expect(loadMachineConfig(home)).toEqual({ ...defaultMachineConfig(), maxParallel: n });
    }
  });

  it("refuses an out-of-range or non-integer maxParallel", () => {
    for (const bad of [0, 33, 2.5, "4", true]) {
      write(JSON.stringify({ maxParallel: bad }));
      const err = errorOf(() => loadMachineConfig(home));
      expect(err.code).toBe("config");
      expect(err.message).toContain("maxParallel");
    }
  });

  it("refuses unknown keys, a non-object and invalid JSON as config errors", () => {
    write('{"maxParallel": 2, "maxparallel": 3}');
    expect(errorOf(() => loadMachineConfig(home))).toMatchObject({ code: "config", message: expect.stringContaining("maxparallel") as unknown });
    write("[]");
    expect(errorOf(() => loadMachineConfig(home)).code).toBe("config");
    write("{");
    expect(errorOf(() => loadMachineConfig(home)).code).toBe("config");
  });
});

describe("loadMachineConfig: checks and admission (DESIGN.md §22)", () => {
  it("defaults every new field to null", () => {
    expect(defaultMachineConfig()).toEqual({
      maxParallel: null,
      checks: { concurrent: null, waitSec: null },
      admission: { loadPerCpu: null, memoryPressure: null },
    });
  });

  it("reads checks and admission", () => {
    write(JSON.stringify({ checks: { concurrent: 3, waitSec: 0 }, admission: { loadPerCpu: 2.5, memoryPressure: "warn" } }));
    expect(loadMachineConfig(home)).toEqual({
      maxParallel: null,
      checks: { concurrent: 3, waitSec: 0 },
      admission: { loadPerCpu: 2.5, memoryPressure: "warn" },
    });
  });

  it("keeps a default for a field left out or null", () => {
    write(JSON.stringify({ checks: { waitSec: 30 }, admission: { loadPerCpu: null } }));
    const config = loadMachineConfig(home);
    expect(config.checks).toEqual({ concurrent: null, waitSec: 30 });
    expect(config.admission).toEqual({ loadPerCpu: null, memoryPressure: null });
  });

  it("accepts loadPerCpu 0 (never hold) and memoryPressure off", () => {
    write(JSON.stringify({ admission: { loadPerCpu: 0, memoryPressure: "off" } }));
    expect(loadMachineConfig(home).admission).toEqual({ loadPerCpu: 0, memoryPressure: "off" });
  });

  it("refuses out-of-range values, unknown keys and unknown levels", () => {
    const cases: Array<[unknown, string]> = [
      [{ checks: { concurrent: 0 } }, "checks.concurrent"],
      [{ checks: { concurrent: 65 } }, "checks.concurrent"],
      [{ checks: { waitSec: 901 } }, "checks.waitSec"],
      [{ checks: { waitSec: 1.5 } }, "checks.waitSec"],
      [{ checks: { slots: 2 } }, "checks.slots"],
      [{ checks: [] }, "checks"],
      [{ admission: { loadPerCpu: -1 } }, "admission.loadPerCpu"],
      [{ admission: { loadPerCpu: "3" } }, "admission.loadPerCpu"],
      [{ admission: { memoryPressure: "high" } }, "admission.memoryPressure"],
      [{ admission: { swap: 1 } }, "admission.swap"],
    ];
    for (const [config, field] of cases) {
      write(JSON.stringify(config));
      const err = errorOf(() => loadMachineConfig(home));
      expect(err.code).toBe("config");
      expect(err.message).toContain(field);
    }
  });
});
