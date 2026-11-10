import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { killProbe, nodeRegistryFs, register, registryDir, running, unregister, type CheckEntry, type RegistryFs } from "./registry";

let tmp: string;
let dir: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "arbab-"));
  dir = registryDir(tmp);
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const entry = (pid: number, name = "test"): CheckEntry => ({ pid, name, cwd: "/work/app", startedAt: "2026-11-10T10:00:00.000Z", cpus: 8 });
const alive = (pids: number[]) => (pid: number): "alive" | "gone" => (pids.includes(pid) ? "alive" : "gone");
const errno = (code: string): Error => Object.assign(new Error(code), { code });

describe("registryDir", () => {
  it("is arbab-checks under the temporary directory", () => {
    expect(registryDir("/tmp/claude-1")).toBe(join("/tmp/claude-1", "arbab-checks"));
  });
});

describe("register and unregister", () => {
  it("writes <pid>.json, creating the directory, and removes it", () => {
    register(dir, entry(101), nodeRegistryFs);
    expect(JSON.parse(readFileSync(join(dir, "101.json"), "utf8"))).toEqual(entry(101));
    unregister(dir, 101, nodeRegistryFs);
    expect(readdirSync(dir)).toEqual([]);
    // A second unregister finds nothing and does not fail.
    unregister(dir, 101, nodeRegistryFs);
  });

  it("replaces a stale file of the same pid", () => {
    register(dir, entry(101, "old"), nodeRegistryFs);
    register(dir, entry(101, "new"), nodeRegistryFs);
    expect(JSON.parse(readFileSync(join(dir, "101.json"), "utf8"))).toMatchObject({ name: "new" });
  });

  it("refuses an invalid pid and fails when the file keeps existing", () => {
    expect(() => register(dir, entry(0), nodeRegistryFs)).toThrow(/invalid pid/);
    expect(() => unregister(dir, -1, nodeRegistryFs)).toThrow(/invalid pid/);
    const stuck: RegistryFs = { ...nodeRegistryFs, writeExclusive: () => false, remove: () => undefined };
    expect(() => register(dir, entry(5), stuck)).toThrow(/keeps existing/);
  });

  it("passes on fs errors", () => {
    const broken: RegistryFs = {
      ...nodeRegistryFs,
      mkdirp: () => {
        throw errno("EACCES");
      },
    };
    expect(() => register(dir, entry(5), broken)).toThrow(/EACCES/);
  });
});

describe("running", () => {
  it("lists the other live entries, not this run's", () => {
    for (const pid of [101, 102, 103]) register(dir, entry(pid), nodeRegistryFs);
    expect(running(dir, 101, nodeRegistryFs, alive([101, 102, 103])).map((e) => e.pid)).toEqual([102, 103]);
  });

  it("removes the stale entries and keeps the live ones", () => {
    for (const pid of [101, 102, 103]) register(dir, entry(pid), nodeRegistryFs);
    expect(running(dir, 1, nodeRegistryFs, alive([102])).map((e) => e.pid)).toEqual([102]);
    expect(readdirSync(dir).sort()).toEqual(["102.json"]);
  });

  it("ignores, and never removes, files that are not entries", () => {
    register(dir, entry(102), nodeRegistryFs);
    writeFileSync(join(dir, "103.json"), "not json");
    writeFileSync(join(dir, "104.json"), JSON.stringify({ ...entry(104), cpus: "8" }));
    writeFileSync(join(dir, "105.json"), JSON.stringify(entry(999)));
    writeFileSync(join(dir, "notes.txt"), "x");
    writeFileSync(join(dir, "0.json"), JSON.stringify(entry(0)));
    expect(running(dir, 1, nodeRegistryFs, alive([])).map((e) => e.pid)).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(["0.json", "103.json", "104.json", "105.json", "notes.txt"]);
  });

  it("skips a file removed between the listing and the read, and survives a failed removal", () => {
    const fs: RegistryFs = {
      ...nodeRegistryFs,
      readDir: () => ["7.json", "8.json"],
      readFile: (path) => {
        if (path.endsWith("7.json")) throw errno("ENOENT");
        return JSON.stringify(entry(8));
      },
      remove: () => {
        throw errno("EPERM");
      },
    };
    expect(running(dir, 1, fs, alive([]))).toEqual([]);
  });

  it("throws when the directory cannot be read", () => {
    expect(() => running(join(tmp, "missing"), 1, nodeRegistryFs, alive([]))).toThrow(/ENOENT/);
  });
});

describe("killProbe", () => {
  it("is gone on ESRCH and alive on success, EPERM or anything else", () => {
    const signals: Array<[number, number]> = [];
    const probe = killProbe((pid, signal) => {
      signals.push([pid, signal]);
      if (pid === 1) throw errno("ESRCH");
      if (pid === 2) throw errno("EPERM");
      if (pid === 3) throw errno("EINVAL");
    });
    expect([probe(1), probe(2), probe(3), probe(4)]).toEqual(["gone", "alive", "alive", "alive"]);
    expect(signals).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ]);
  });

  it("works with the real process.kill", () => {
    const probe = killProbe((pid, signal) => process.kill(pid, signal));
    expect(probe(process.pid)).toBe("alive");
    // Far above any pid a system hands out.
    expect(probe(2 ** 30)).toBe("gone");
  });
});

describe("nodeRegistryFs", () => {
  it("creates exclusively and removes missing files quietly", () => {
    const path = join(tmp, "a", "b.json");
    nodeRegistryFs.mkdirp(join(tmp, "a"));
    expect(nodeRegistryFs.writeExclusive(path, "1")).toBe(true);
    expect(nodeRegistryFs.writeExclusive(path, "2")).toBe(false);
    expect(nodeRegistryFs.readFile(path)).toBe("1");
    expect(nodeRegistryFs.readDir(join(tmp, "a"))).toEqual(["b.json"]);
    nodeRegistryFs.remove(path);
    nodeRegistryFs.remove(path);
    expect(existsSync(path)).toBe(false);
  });
});
