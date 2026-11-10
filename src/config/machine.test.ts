import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArbabError } from "../util/errors";
import { defaultMachineConfig, loadMachineConfig, loadMachineConfigLenient } from "./index";

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

describe("loadMachineConfigLenient", () => {
  const full = { maxParallel: 3, checks: { concurrent: 2, waitSec: 30 }, admission: { loadPerCpu: 1.5, memoryPressure: "warn" } };

  it("gives every default and no error when the file is missing", () => {
    expect(loadMachineConfigLenient(home)).toEqual({ config: defaultMachineConfig(), errors: [] });
  });

  it("reads a valid file as loadMachineConfig does, with no error", () => {
    write(JSON.stringify(full));
    expect(loadMachineConfigLenient(home)).toEqual({ config: loadMachineConfig(home), errors: [] });
  });

  it("gives every default and one error for invalid JSON or a non-object", () => {
    for (const text of ["{", "[]", "3", '"x"']) {
      write(text);
      const r = loadMachineConfigLenient(home);
      expect(r.config).toEqual(defaultMachineConfig());
      expect(r.errors).toHaveLength(1);
    }
  });

  it("keeps an invalid maxParallel's default and the other fields", () => {
    write(JSON.stringify({ ...full, maxParallel: 0 }));
    const r = loadMachineConfigLenient(home);
    expect(r.config).toEqual({ ...full, maxParallel: null });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain("maxParallel");
  });

  it("keeps an invalid checks' default and the other fields", () => {
    write(JSON.stringify({ ...full, checks: { concurrent: 2, waitSec: 901 } }));
    const r = loadMachineConfigLenient(home);
    expect(r.config).toEqual({ ...full, checks: { concurrent: null, waitSec: null } });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain("checks.waitSec");
  });

  it("keeps an invalid admission's default and maxParallel with it", () => {
    write(JSON.stringify({ ...full, admission: { loadPerCpu: 1, memoryPresure: "warn" } }));
    const r = loadMachineConfigLenient(home);
    expect(r.config).toEqual({ ...full, admission: { loadPerCpu: null, memoryPressure: null } });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain("admission.memoryPresure");
  });

  it("names an unknown top-level key and still reads the known ones", () => {
    write(JSON.stringify({ maxParallel: 2, maxparallel: 3 }));
    const r = loadMachineConfigLenient(home);
    expect(r.config.maxParallel).toBe(2);
    expect(r.errors).toEqual(["machine.json.maxparallel: unknown key"]);
  });

  it("collects one error per invalid field", () => {
    write(JSON.stringify({ maxParallel: "4", checks: [], admission: { loadPerCpu: -1 } }));
    const r = loadMachineConfigLenient(home);
    expect(r.config).toEqual(defaultMachineConfig());
    expect(r.errors).toHaveLength(3);
  });
});
