import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArbabError, exitCodeFor } from "./errors";
import { confine, createExclusive, readJson, readText, writeJsonAtomic, writeTextAtomic } from "./fs";
import { assertValidName, envSuffix, isValidName } from "./names";
import { isAlive, isoAt, sendSignal } from "./proc";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arbab-util-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("errors", () => {
  it("maps codes to exit statuses and unknown errors to 2", () => {
    expect(exitCodeFor(new ArbabError("lint", "x"))).toBe(1);
    expect(exitCodeFor(new ArbabError("io", "x"))).toBe(2);
    expect(exitCodeFor(new Error("x"))).toBe(2);
  });
});

describe("readJson", () => {
  it("returns null for a missing file", () => {
    expect(readJson(join(dir, "missing.json"))).toBeNull();
  });
  it("parses an existing file", () => {
    writeFileSync(join(dir, "a.json"), '{"a":1}');
    expect(readJson<{ a: number }>(join(dir, "a.json"))).toEqual({ a: 1 });
  });
  it("throws an io error for invalid JSON", () => {
    writeFileSync(join(dir, "bad.json"), "{");
    expect(() => readJson(join(dir, "bad.json"))).toThrow(ArbabError);
  });
});

describe("readText", () => {
  it("returns a file's text, or null when it does not exist", () => {
    writeFileSync(join(dir, "t.txt"), "hello");
    expect(readText(join(dir, "t.txt"))).toBe("hello");
    expect(readText(join(dir, "missing.txt"))).toBeNull();
  });
  it("throws an io error when the path cannot be read as a file", () => {
    expect(() => readText(dir)).toThrow(ArbabError);
  });
});

describe("atomic writes", () => {
  it("writes JSON with a trailing newline and leaves no temp file", () => {
    const p = join(dir, "sub", "x.json");
    writeJsonAtomic(p, { b: [1, 2] });
    expect(readFileSync(p, "utf8")).toBe('{\n  "b": [\n    1,\n    2\n  ]\n}\n');
    expect(readdirSync(join(dir, "sub"))).toEqual(["x.json"]);
  });
  it("replaces an existing file", () => {
    const p = join(dir, "t.txt");
    writeTextAtomic(p, "one");
    writeTextAtomic(p, "two");
    expect(readFileSync(p, "utf8")).toBe("two");
  });
});

describe("createExclusive", () => {
  it("creates once and refuses to overwrite", () => {
    const p = join(dir, "lock");
    expect(createExclusive(p, "1")).toBe(true);
    expect(createExclusive(p, "2")).toBe(false);
    expect(readFileSync(p, "utf8")).toBe("1");
  });
});

describe("confine", () => {
  it("resolves paths under the root", () => {
    expect(confine(dir, "a/b.md")).toBe(join(dir, "a/b.md"));
    expect(confine(dir, ".")).toBe(dir);
  });
  it("refuses escapes", () => {
    expect(() => confine(dir, "../x")).toThrow(ArbabError);
    expect(() => confine(dir, "/etc/passwd")).toThrow(ArbabError);
    expect(() => confine(dir, "a/../../x")).toThrow(ArbabError);
  });
});

describe("names", () => {
  it("accepts kebab-case and rejects everything else", () => {
    expect(isValidName("m1-stream")).toBe(true);
    for (const bad of ["", "-a", "A", "a_b", "a/b", "../x", "a".repeat(49), 3, null]) {
      expect(isValidName(bad)).toBe(false);
    }
    expect(() => assertValidName("../x", "lane")).toThrow(/lane/);
  });
  it("builds env suffixes", () => {
    expect(envSuffix("redis-db")).toBe("REDIS_DB");
  });
});

describe("proc", () => {
  it("knows its own process is alive and a nonsense pid is not", () => {
    expect(isAlive(process.pid)).toBe(true);
    expect(isAlive(0)).toBe(false);
    expect(isAlive(-5)).toBe(false);
    expect(isAlive(2 ** 22 + 12345)).toBe(false);
  });
  it("refuses to signal 0 and -1, and reports a gone target as false", () => {
    expect(() => sendSignal(0, "SIGTERM")).toThrow(RangeError);
    expect(() => sendSignal(-1, "SIGTERM")).toThrow(RangeError);
    expect(sendSignal(2 ** 22 + 12345, "SIGTERM")).toBe(false);
  });
  it("formats a clock reading as ISO", () => {
    expect(isoAt({ now: () => 0 })).toBe("1970-01-01T00:00:00.000Z");
  });
});
