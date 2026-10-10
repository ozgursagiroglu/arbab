import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DependencyStrategy } from "../types";
import { ArbabError } from "../util/errors";
import { DEPENDENCY_MANIFESTS, isDependencyManifest, prepareDependencies, runArgv, type ArgvRunner } from "./deps";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arbab-deps-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("prepareDependencies", () => {
  it("does nothing for strategy none", () => {
    const run: ArgvRunner = () => {
      throw new Error("must not run");
    };
    expect(prepareDependencies({ strategy: "none" }, dir, run)).toEqual({ ok: true, code: 0, output: "" });
  });
  it("runs the command argv in the worktree", () => {
    const calls: Array<[string[], string]> = [];
    const run: ArgvRunner = (argv, cwd) => {
      calls.push([argv, cwd]);
      return { code: 0, output: "installed" };
    };
    const r = prepareDependencies({ strategy: "command", command: ["pnpm", "install", "--offline"] }, dir, run);
    expect(r).toEqual({ ok: true, code: 0, output: "installed" });
    expect(calls).toEqual([[["pnpm", "install", "--offline"], dir]]);
  });
  it("reports a failing command", () => {
    const r = prepareDependencies({ strategy: "command", command: ["x"] }, dir, () => ({ code: 3, output: "boom" }));
    expect(r).toEqual({ ok: false, code: 3, output: "boom" });
  });
  it("rejects an empty or malformed command and unknown strategies", () => {
    const run: ArgvRunner = () => ({ code: 0, output: "" });
    expect(() => prepareDependencies({ strategy: "command", command: [] }, dir, run)).toThrow(ArbabError);
    expect(() => prepareDependencies({ strategy: "command", command: [""] }, dir, run)).toThrow(ArbabError);
    const bad = { strategy: "clone" } as unknown as DependencyStrategy;
    expect(() => prepareDependencies(bad, dir, run)).toThrow(/unknown dependencies strategy/);
  });
});

describe("isDependencyManifest", () => {
  it("matches every manifest by its last segment, at any depth and in any case", () => {
    for (const name of DEPENDENCY_MANIFESTS) {
      expect(isDependencyManifest(name), name).toBe(true);
      expect(isDependencyManifest(`a/b/${name}`), name).toBe(true);
      expect(isDependencyManifest(name.toUpperCase()), name).toBe(true);
    }
  });

  it("matches npm's own lockfile, npm-shrinkwrap.json", () => {
    expect(isDependencyManifest("npm-shrinkwrap.json")).toBe(true);
    expect(isDependencyManifest("pkgs/web/npm-shrinkwrap.json")).toBe(true);
  });

  it("does not match other names", () => {
    for (const path of ["package.json.bak", "mypackage.json", "package.json/x.ts", "src/npmrc", "pnpmfile.cjs", "shrinkwrap.json", ""]) {
      expect(isDependencyManifest(path), path).toBe(false);
    }
  });
});

describe("runArgv", () => {
  it("runs without a shell in the given directory and joins stdout and stderr", () => {
    const r = runArgv(
      [process.execPath, "-e", "process.stdout.write(process.cwd()); process.stderr.write('|err'); process.exit(4)"],
      dir,
    );
    expect(r.code).toBe(4);
    expect(r.output).toMatch(/arbab-deps-.*\|err$/);
  });
  it("passes shell metacharacters through as plain arguments", () => {
    const r = runArgv([process.execPath, "-e", "process.stdout.write(process.argv[1])", "$(echo hi); ls"], dir);
    expect(r).toEqual({ code: 0, output: "$(echo hi); ls" });
  });
  it("reports an empty argv and a missing binary as 127", () => {
    expect(runArgv([], dir).code).toBe(127);
    expect(runArgv([join(dir, "missing")], dir).code).toBe(127);
  });
});
