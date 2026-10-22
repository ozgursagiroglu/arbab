import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DependencyStrategy } from "../types";
import { ArbabError } from "../util/errors";
import {
  DEPENDENCY_MANIFESTS,
  installRelevantChange,
  installRelevantPaths,
  isDependencyManifest,
  prepareDependencies,
  runArgv,
  type ArgvRunner,
} from "./deps";

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

describe("installRelevantChange", () => {
  const pkg = (fields: Record<string, unknown>): string => JSON.stringify({ name: "x", version: "1.0.0", ...fields }, null, 2) + "\n";
  const FIELDS: Array<[string, unknown, unknown]> = [
    ["dependencies", { a: "1" }, { a: "2" }],
    ["devDependencies", { a: "1" }, { a: "1", b: "1" }],
    ["optionalDependencies", undefined, { a: "1" }],
    ["peerDependencies", { a: "1" }, undefined],
    ["bundledDependencies", ["a"], ["a", "b"]],
    ["bundleDependencies", true, false],
    ["overrides", { a: "1" }, { a: "2" }],
    ["resolutions", { a: "1" }, { a: "2" }],
    ["pnpm", { overrides: {} }, { overrides: { a: "1" } }],
    ["workspaces", ["pkgs/*"], ["pkgs/*", "apps/*"]],
    ["packageManager", "pnpm@9.0.0", "pnpm@9.1.0"],
  ];

  it("counts a change to every field an install reads", () => {
    for (const [field, before, after] of FIELDS) {
      expect(installRelevantChange("package.json", pkg({ [field]: before }), pkg({ [field]: after })), field).toBe(true);
    }
  });

  it("counts a change to every install-time script, and not to other scripts", () => {
    for (const script of ["preinstall", "install", "postinstall", "preprepare", "prepare", "postprepare", "prepublish"]) {
      expect(installRelevantChange("package.json", pkg({ scripts: { test: "x" } }), pkg({ scripts: { test: "x", [script]: "node s.js" } })), script).toBe(true);
      expect(installRelevantChange("package.json", pkg({ scripts: { [script]: "a" } }), pkg({ scripts: { [script]: "b" } })), script).toBe(true);
    }
    expect(installRelevantChange("package.json", pkg({ scripts: { test: "x" } }), pkg({ scripts: { test: "y", build: "z" } }))).toBe(false);
    expect(installRelevantChange("package.json", pkg({}), pkg({ scripts: { test: "y" } }))).toBe(false);
    // A scripts value npm cannot read as scripts counts whole.
    expect(installRelevantChange("package.json", pkg({ scripts: "a" }), pkg({ scripts: "b" }))).toBe(true);
  });

  it("does not count an exports-only edit, a version bump or other fields, at any depth", () => {
    const before = pkg({ dependencies: { a: "1" }, exports: { ".": "./a.js" } });
    expect(installRelevantChange("package.json", before, pkg({ dependencies: { a: "1" }, exports: { ".": "./b.js", "./x": "./x.js" } }))).toBe(false);
    expect(installRelevantChange("pkgs/web/package.json", pkg({ version: "1.0.0" }), pkg({ version: "1.1.0" }))).toBe(false);
    for (const field of ["main", "types", "files", "description", "license", "type", "bin"]) {
      expect(installRelevantChange("package.json", pkg({}), pkg({ [field]: "x" })), field).toBe(false);
    }
  });

  it("ignores formatting and key order", () => {
    const a = JSON.stringify({ dependencies: { a: "1", b: "2" }, name: "x" });
    const b = JSON.stringify({ name: "x", dependencies: { b: "2", a: "1" } }, null, 4);
    expect(installRelevantChange("package.json", a, b)).toBe(false);
  });

  it("counts a package.json that appears, disappears or does not parse", () => {
    expect(installRelevantChange("package.json", null, pkg({}))).toBe(true);
    expect(installRelevantChange("package.json", pkg({}), null)).toBe(true);
    expect(installRelevantChange("package.json", pkg({}), "{ not json")).toBe(true);
    expect(installRelevantChange("package.json", "{ not json", pkg({}))).toBe(true);
    expect(installRelevantChange("package.json", "[]", "[1]")).toBe(true);
    expect(installRelevantChange("Package.JSON", pkg({}), pkg({ dependencies: { a: "1" } }))).toBe(true);
  });

  it("counts any change to the other manifests, lockfiles included, and nothing that did not change", () => {
    for (const name of DEPENDENCY_MANIFESTS.filter((n) => n !== "package.json")) {
      expect(installRelevantChange(`a/${name}`, "x", "y"), name).toBe(true);
      expect(installRelevantChange(name, null, "y"), name).toBe(true);
      expect(installRelevantChange(name, "x", "x"), name).toBe(false);
    }
    expect(installRelevantChange("pnpm-lock.yaml", "lockfileVersion: '9.0'\n", "lockfileVersion: '9.0'\npackages: {}\n")).toBe(true);
    expect(installRelevantChange("src/a.ts", "x", "y")).toBe(false);
    expect(installRelevantChange("package.json", null, null)).toBe(false);
  });
});

describe("installRelevantPaths", () => {
  /** A git that knows the files of two commits, A and B. */
  const fakeGit = (files: Record<string, Record<string, string>>, calls: string[][] = []) => (args: string[]) => {
    calls.push(args);
    const spec = args.at(-1) ?? "";
    const [rev = "", path = ""] = spec.split(/:(.*)/s);
    const text = files[rev]?.[path];
    return text === undefined ? { code: 128, stdout: "", stderr: `fatal: path '${path}' does not exist in '${rev}'` } : { code: 0, stdout: text, stderr: "" };
  };

  it("keeps the manifests whose change an install sees, once each and sorted, reading only package.json", () => {
    const calls: string[][] = [];
    const git = fakeGit(
      {
        A: { "package.json": '{"version":"1"}', "web/package.json": '{"dependencies":{}}' },
        B: { "package.json": '{"version":"2"}', "web/package.json": '{"dependencies":{"a":"1"}}', "api/package.json": "{}" },
      },
      calls,
    );
    const paths = ["yarn.lock", "src/x.ts", "package.json", "web/package.json", "api/package.json", "yarn.lock"];
    expect(installRelevantPaths(git, "A", "B", paths)).toEqual(["api/package.json", "web/package.json", "yarn.lock"]);
    expect(calls.every((args) => args[0] === "show" && !(args.at(-1) ?? "").endsWith("yarn.lock"))).toBe(true);
    expect(calls).toContainEqual(["show", "--no-textconv", "A:web/package.json"]);
  });

  it("counts a package.json git shows at neither commit", () => {
    expect(installRelevantPaths(fakeGit({}), "A", "B", ["package.json"])).toEqual(["package.json"]);
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
