import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ArgvRunner } from "../run";
import type { DependencyStrategy } from "../types";
import { checkClone } from "./deps";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "arbab-doctor-deps-"));
  mkdirSync(join(root, "node_modules"));
  mkdirSync(join(root, "web", "node_modules"), { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const clone = (paths: string[]): DependencyStrategy => ({ strategy: "clone", paths, fallback: null });

function runner(calls: Array<[string[], string]>, code: number): ArgvRunner {
  return (argv, cwd) => {
    calls.push([argv, cwd]);
    return { code, output: "" };
  };
}

describe("checkClone", () => {
  it("says nothing for the other strategies, and runs nothing", () => {
    const calls: Array<[string[], string]> = [];
    expect(checkClone(root, { strategy: "none" }, "darwin", runner(calls, 1))).toBeNull();
    expect(checkClone(root, { strategy: "command", command: ["npm", "ci"] }, "darwin", runner(calls, 1))).toBeNull();
    expect(calls).toEqual([]);
  });

  it("is ok when python3 has ctypes on macOS and every path is a directory", () => {
    const calls: Array<[string[], string]> = [];
    expect(checkClone(root, clone(["node_modules", "web/node_modules"]), "darwin", runner(calls, 0))).toEqual([
      { status: "ok", check: "dependencies", detail: "clone node_modules, web/node_modules with clonefile(2)" },
    ]);
    expect(calls).toEqual([[["python3", "-I", "-c", "import ctypes"], root]]);
  });

  it("warns on macOS without python3", () => {
    expect(checkClone(root, clone(["node_modules"]), "darwin", runner([], 127))).toEqual([
      { status: "warn", check: "dependencies", detail: "clone falls back to cp -cR, much slower, without python3" },
    ]);
  });

  it("does not ask for python3 on Linux", () => {
    const calls: Array<[string[], string]> = [];
    expect(checkClone(root, clone(["node_modules"]), "linux", runner(calls, 1))).toEqual([
      { status: "ok", check: "dependencies", detail: "clone node_modules with cp -a --reflink=auto" },
    ]);
    expect(calls).toEqual([]);
  });

  it("warns for each listed path that is not a directory in the main checkout", () => {
    writeFileSync(join(root, "vendor"), "a file\n");
    expect(checkClone(root, clone(["node_modules", "gone", "vendor"]), "darwin", runner([], 1))).toEqual([
      { status: "warn", check: "dependencies", detail: "clone falls back to cp -cR, much slower, without python3" },
      { status: "warn", check: "dependencies", detail: "every launch will fall back: gone is missing" },
      { status: "warn", check: "dependencies", detail: "every launch will fall back: vendor is missing" },
    ]);
  });
});
