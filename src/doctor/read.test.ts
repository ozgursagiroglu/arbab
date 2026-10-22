import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listNames, packageScripts, readOptional, readPackageJson } from "./read";

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "arbab-")));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("readOptional", () => {
  it("returns a file's text, and null for a missing file or a directory", () => {
    writeFileSync(join(dir, "a.txt"), "hello");
    expect(readOptional(join(dir, "a.txt"))).toBe("hello");
    expect(readOptional(join(dir, "missing"))).toBeNull();
    expect(readOptional(dir)).toBeNull();
  });
});

describe("listNames", () => {
  it("lists a directory sorted, and nothing for a missing one or a file", () => {
    writeFileSync(join(dir, "b"), "");
    mkdirSync(join(dir, "a"));
    expect(listNames(dir)).toEqual(["a", "b"]);
    expect(listNames(join(dir, "missing"))).toEqual([]);
    expect(listNames(join(dir, "b"))).toEqual([]);
  });
});

describe("readPackageJson", () => {
  it("parses an object and refuses anything else", () => {
    expect(readPackageJson(dir)).toBeNull();
    writeFileSync(join(dir, "package.json"), '{"name": "x"}');
    expect(readPackageJson(dir)).toEqual({ name: "x" });
    writeFileSync(join(dir, "package.json"), "{");
    expect(readPackageJson(dir)).toBeNull();
    writeFileSync(join(dir, "package.json"), "[1]");
    expect(readPackageJson(dir)).toBeNull();
    writeFileSync(join(dir, "package.json"), "null");
    expect(readPackageJson(dir)).toBeNull();
  });
});

describe("packageScripts", () => {
  it("keeps string scripts only", () => {
    expect(packageScripts(null)).toEqual({});
    expect(packageScripts({ scripts: ["test"] })).toEqual({});
    expect(packageScripts({ scripts: "test" })).toEqual({});
    expect(packageScripts({ scripts: { test: "vitest", odd: 1 } })).toEqual({ test: "vitest" });
  });
});
