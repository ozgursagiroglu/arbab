import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BinaryInfo } from "../types";
import { ArbabError } from "../util/errors";
import type { ResolveBinaryOptions } from "./index";
import { compareVersions, findOnPath, parseVersion, pathExists, realpath, resolveBinary, runVersion } from "./index";

describe("parseVersion", () => {
  it("finds the first x.y.z", () => {
    expect(parseVersion("2.1.295 (Claude Code)")).toEqual([2, 1, 295]);
    expect(parseVersion("claude v10.0.3-beta, built 1.2.3")).toEqual([10, 0, 3]);
  });
  it("returns null without a version", () => {
    expect(parseVersion("")).toBeNull();
    expect(parseVersion("2.1")).toBeNull();
    expect(parseVersion("command not found")).toBeNull();
  });
});

describe("compareVersions", () => {
  it("compares numerically per part", () => {
    expect(compareVersions("2.1.295", "2.1.29")).toBe(1);
    expect(compareVersions("2.1.29", "2.1.295")).toBe(-1);
    expect(compareVersions("10.0.0", "9.9.9")).toBe(1);
    expect(compareVersions("9.9.9", "10.0.0")).toBe(-1);
    expect(compareVersions("2.1.295", "2.1.295 (Claude Code)")).toBe(0);
    expect(compareVersions("2.2.0", "2.1.999")).toBe(1);
  });
  it("throws a binary error for unparsable input", () => {
    expect(() => compareVersions("x", "1.2.3")).toThrow(ArbabError);
  });
});

describe("findOnPath", () => {
  const files = new Set(["/usr/local/bin/claude", "/opt/bin/claude"]);
  const exists = (p: string): boolean => files.has(p);
  it("returns the first match in PATH order", () => {
    expect(findOnPath("claude", "/usr/bin:/opt/bin:/usr/local/bin", exists)).toBe("/opt/bin/claude");
  });
  it("skips empty and relative entries", () => {
    const rel = new Set(["bin/claude", "claude"]);
    expect(findOnPath("claude", ":bin:.", (p) => rel.has(p))).toBeNull();
  });
  it("returns null when absent or when cmd has a slash", () => {
    expect(findOnPath("claude", "/usr/bin", exists)).toBeNull();
    expect(findOnPath("bin/claude", "/usr/local", exists)).toBeNull();
    expect(findOnPath("", "/usr/local/bin", exists)).toBeNull();
  });
});

function opts(over: Partial<ResolveBinaryOptions> & { versions?: Record<string, string> }): ResolveBinaryOptions {
  const versions = over.versions ?? { "/real/claude": "2.1.295 (Claude Code)" };
  return {
    pinned: null,
    explicitPath: null,
    pathEnv: "/usr/bin:/home/u/.local/bin",
    minVersion: "2.1.290",
    run: (p, args) => {
      const v = versions[p];
      if (v === undefined || args.join(" ") !== "--version") throw new Error("ENOENT");
      return v;
    },
    exists: (p) => p === "/home/u/.local/bin/claude" || p in versions || p === "/explicit/claude",
    realpath: (p) => (p === "/home/u/.local/bin/claude" || p === "/explicit/claude" ? "/real/claude" : p),
    ...over,
  };
}

function binaryError(fn: () => unknown, pattern: RegExp): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ArbabError);
    expect((err as ArbabError).code).toBe("binary");
    expect((err as Error).message).toMatch(pattern);
    return;
  }
  throw new Error("expected a binary error");
}

describe("resolveBinary", () => {
  it("finds claude on PATH, resolves symlinks and reads the version", () => {
    expect(resolveBinary(opts({}))).toEqual({ path: "/real/claude", version: "2.1.295" });
  });

  it("prefers the explicit path", () => {
    const o = opts({ explicitPath: "/explicit/claude", pathEnv: "" });
    expect(resolveBinary(o)).toEqual({ path: "/real/claude", version: "2.1.295" });
  });

  it("treats an empty explicit path as unset", () => {
    expect(resolveBinary(opts({ explicitPath: "" })).path).toBe("/real/claude");
  });

  it("fails when the explicit path does not exist", () => {
    binaryError(() => resolveBinary(opts({ explicitPath: "/nope/claude" })), /ARBAB_CLAUDE/);
  });

  it("fails when claude is not on PATH", () => {
    binaryError(() => resolveBinary(opts({ pathEnv: "/usr/bin" })), /not found on PATH/);
  });

  it("fails when realpath fails", () => {
    const o = opts({
      realpath: () => {
        throw new Error("ELOOP");
      },
    });
    binaryError(() => resolveBinary(o), /cannot resolve/);
  });

  it("fails when --version fails or prints no version", () => {
    binaryError(() => resolveBinary(opts({ versions: {} })), /--version failed/);
    binaryError(() => resolveBinary(opts({ versions: { "/real/claude": "oops" } })), /no version/);
  });

  it("fails below the minimum version, comparing numerically", () => {
    binaryError(() => resolveBinary(opts({ versions: { "/real/claude": "2.1.217" } })), /older than the required/);
    expect(resolveBinary(opts({ minVersion: "2.1.29" })).version).toBe("2.1.295");
    expect(resolveBinary(opts({ minVersion: "2.1.295" })).version).toBe("2.1.295");
  });

  describe("pinned", () => {
    const pinned: BinaryInfo = { path: "/pinned/claude", version: "2.1.295" };

    it("returns the pinned binary when it still reports its version", () => {
      const o = opts({ pinned, versions: { "/pinned/claude": "2.1.295 (Claude Code)" }, pathEnv: "" });
      expect(resolveBinary(o)).toEqual(pinned);
    });

    it("ignores the minimum version and PATH for a pinned binary", () => {
      const old = { path: "/pinned/claude", version: "2.1.217" };
      const o = opts({ pinned: old, versions: { "/pinned/claude": "2.1.217" }, minVersion: "2.1.290" });
      expect(resolveBinary(o)).toEqual(old);
    });

    it("fails when the pinned binary is gone", () => {
      const o = opts({ pinned, exists: () => false });
      binaryError(() => resolveBinary(o), /binary changed since the attempt this one resumes/);
    });

    it("fails when the pinned binary reports another version", () => {
      const o = opts({ pinned, versions: { "/pinned/claude": "2.1.300" } });
      binaryError(() => resolveBinary(o), /binary changed since the attempt this one resumes.*2\.1\.300/);
    });

    it("fails when the pinned binary cannot report a version", () => {
      const o = opts({ pinned, versions: { "/pinned/claude": "garbage" }, exists: () => true });
      binaryError(() => resolveBinary(o), /binary changed since the attempt this one resumes/);
    });
  });
});

describe("node defaults", () => {
  it("check existence, resolve real paths and run a binary with argv", () => {
    const dir = mkdtempSync(join(tmpdir(), "arbab-binary-"));
    try {
      const file = join(dir, "f");
      writeFileSync(file, "");
      expect(pathExists(file)).toBe(true);
      expect(pathExists(join(dir, "missing"))).toBe(false);
      expect(realpath(file)).toBe(realpath(dir) + "/f");
      expect(runVersion(process.execPath, ["--version"])).toMatch(/^v\d+\.\d+\.\d+/);
      expect(parseVersion(runVersion(process.execPath, ["--version"]))).not.toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
