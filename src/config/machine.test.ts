import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArbabError } from "../util/errors";
import { loadMachineConfig } from "./index";

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
    expect(loadMachineConfig(home)).toEqual({ maxParallel: null });
  });

  it("has no cap for an empty object or a null maxParallel", () => {
    write("{}");
    expect(loadMachineConfig(home)).toEqual({ maxParallel: null });
    write('{"maxParallel": null}');
    expect(loadMachineConfig(home)).toEqual({ maxParallel: null });
  });

  it("reads maxParallel from 1 to 32", () => {
    for (const n of [1, 8, 32]) {
      write(JSON.stringify({ maxParallel: n }));
      expect(loadMachineConfig(home)).toEqual({ maxParallel: n });
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
