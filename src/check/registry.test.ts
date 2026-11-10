import { execFileSync } from "node:child_process";
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ENTRY_MAX_AGE_MS,
  ENTRY_MAX_AHEAD_MS,
  ENTRY_MAX_BYTES,
  entryTime,
  isEntryPid,
  killProbe,
  PID_MAX,
  liveEntries,
  nodeRegistryFs,
  readEntryFile,
  register,
  registeredBefore,
  registryDir,
  unregister,
  update,
  type CheckEntry,
  type RegistryFs,
} from "./registry";

let tmp: string;
let dir: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "arbab-"));
  dir = registryDir(tmp);
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const STARTED = "2026-11-10T10:00:00.000Z";
const NOW = Date.parse(STARTED) + 60_000;
const entry = (pid: number, name = "test", fields: Partial<CheckEntry> = {}): CheckEntry => ({
  pid,
  name,
  cwd: "/work/app",
  startedAt: STARTED,
  cpus: 8,
  state: "running",
  ...fields,
});
const at = (ms: number): string => new Date(ms).toISOString();
const alive = (pids: number[]) => (pid: number): "alive" | "gone" => (pids.includes(pid) ? "alive" : "gone");
const errno = (code: string): Error => Object.assign(new Error(code), { code });
const live = (self: number, probe: (pid: number) => "alive" | "gone", now = NOW, fs: RegistryFs = nodeRegistryFs): number[] =>
  liveEntries(dir, self, fs, probe, now).map((e) => e.pid);

describe("registryDir", () => {
  it("is arbab-checks under the temporary directory", () => {
    expect(registryDir("/tmp/claude-1")).toBe(join("/tmp/claude-1", "arbab-checks"));
  });
});

describe("register, update and unregister", () => {
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
    expect(() => update(dir, entry(1.5), nodeRegistryFs)).toThrow(/invalid pid/);
    const stuck: RegistryFs = { ...nodeRegistryFs, writeExclusive: () => false, remove: () => undefined };
    expect(() => register(dir, entry(5), stuck)).toThrow(/keeps existing/);
  });

  it("passes on fs errors", () => {
    const broken: RegistryFs = {
      ...nodeRegistryFs,
      mkdirp: () => {
        throw errno("EACCES");
      },
      replace: () => {
        throw errno("ENOSPC");
      },
    };
    expect(() => register(dir, entry(5), broken)).toThrow(/EACCES/);
    expect(() => update(dir, entry(5), broken)).toThrow(/ENOSPC/);
  });

  it("rewrites the entry atomically: a new file renamed over the old one, nothing left beside it", () => {
    register(dir, entry(101, "test", { state: "waiting" }), nodeRegistryFs);
    // A second name for the old file: a rewrite in place would change it too, a rename leaves it as it was.
    linkSync(join(dir, "101.json"), join(tmp, "old.json"));
    update(dir, entry(101, "test", { state: "running", share: 3 }), nodeRegistryFs);
    expect(JSON.parse(readFileSync(join(dir, "101.json"), "utf8"))).toEqual(entry(101, "test", { state: "running", share: 3 }));
    expect(JSON.parse(readFileSync(join(tmp, "old.json"), "utf8"))).toMatchObject({ state: "waiting" });
    expect(readdirSync(dir)).toEqual(["101.json"]);
  });

  it("rewrites through replace alone, never a remove and a create", () => {
    const calls: string[] = [];
    const fs: RegistryFs = {
      ...nodeRegistryFs,
      replace: (path, data) => calls.push(`replace ${path} ${data}`),
      remove: (path) => calls.push(`remove ${path}`),
      writeExclusive: (path) => (calls.push(`create ${path}`), true),
    };
    update(dir, entry(7), fs);
    expect(calls).toEqual([`replace ${join(dir, "7.json")} ${JSON.stringify(entry(7))}\n`]);
  });
});

describe("entryTime and registeredBefore", () => {
  it("reads the ISO time a check writes and nothing else", () => {
    expect(entryTime(entry(1))).toBe(Date.parse(STARTED));
    for (const startedAt of ["yesterday", "2026-11-10", "2026-11-10T10:00:00+01:00", "", "2026-13-45T99:00:00.000Z"]) {
      expect(entryTime(entry(1, "test", { startedAt }))).toBeNaN();
    }
  });

  it("orders by startedAt, then by pid", () => {
    const early = entry(900, "test", { startedAt: at(NOW - 1000) });
    const late = entry(5, "test", { startedAt: at(NOW) });
    expect(registeredBefore(early, late)).toBe(true);
    expect(registeredBefore(late, early)).toBe(false);
    expect(registeredBefore(entry(4), entry(5))).toBe(true);
    expect(registeredBefore(entry(5), entry(4))).toBe(false);
    expect(registeredBefore(entry(5), entry(5))).toBe(false);
  });
});

describe("liveEntries", () => {
  it("lists the other live entries, not this run's, with their state", () => {
    register(dir, entry(101), nodeRegistryFs);
    register(dir, entry(102, "test", { state: "waiting" }), nodeRegistryFs);
    register(dir, entry(103, "test", { share: 2 }), nodeRegistryFs);
    expect(liveEntries(dir, 101, nodeRegistryFs, alive([101, 102, 103]), NOW)).toEqual([entry(102, "test", { state: "waiting" }), entry(103, "test", { share: 2 })]);
  });

  it("counts an entry without state, from an older script, as running", () => {
    const old = { pid: 102, name: "test", cwd: "/work/app", startedAt: STARTED, cpus: 8 };
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "102.json"), JSON.stringify(old));
    expect(liveEntries(dir, 1, nodeRegistryFs, alive([102]), NOW)).toEqual([entry(102, "test", { state: "running" })]);
  });

  it("ignores an unknown state and an invalid share", () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "102.json"), JSON.stringify({ ...entry(102), state: "paused" }));
    writeFileSync(join(dir, "103.json"), JSON.stringify({ ...entry(103), share: -1 }));
    expect(liveEntries(dir, 1, nodeRegistryFs, alive([102, 103]), NOW)).toEqual([entry(103)]);
    expect(readdirSync(dir).sort()).toEqual(["102.json", "103.json"]);
  });

  it("removes the entries whose pid is gone and keeps the live ones", () => {
    for (const pid of [101, 102, 103]) register(dir, entry(pid), nodeRegistryFs);
    expect(live(1, alive([102]))).toEqual([102]);
    expect(readdirSync(dir).sort()).toEqual(["102.json"]);
  });

  it("removes and ignores old, future and unparsable entries even when their pid is alive", () => {
    register(dir, entry(101, "test", { startedAt: at(NOW - ENTRY_MAX_AGE_MS - 1) }), nodeRegistryFs);
    register(dir, entry(102, "test", { startedAt: at(NOW + ENTRY_MAX_AHEAD_MS + 1) }), nodeRegistryFs);
    register(dir, entry(103, "test", { startedAt: "not a time" }), nodeRegistryFs);
    register(dir, entry(104, "test", { startedAt: at(NOW - ENTRY_MAX_AGE_MS) }), nodeRegistryFs);
    register(dir, entry(105, "test", { startedAt: at(NOW + ENTRY_MAX_AHEAD_MS) }), nodeRegistryFs);
    const probed: number[] = [];
    expect(live(1, (pid) => (probed.push(pid), "alive"))).toEqual([104, 105]);
    // The stale ones are not even probed.
    expect(probed).toEqual([104, 105]);
    expect(readdirSync(dir).sort()).toEqual(["104.json", "105.json"]);
  });

  it("names the age limit after the Bash tool's 15-minute timeout, with room to spare", () => {
    expect(ENTRY_MAX_AGE_MS).toBeGreaterThan(15 * 60_000);
    expect(ENTRY_MAX_AGE_MS).toBe(20 * 60_000);
    expect(ENTRY_MAX_AHEAD_MS).toBe(60_000);
  });

  it("ignores, and never removes, files that are not entries", () => {
    register(dir, entry(102), nodeRegistryFs);
    writeFileSync(join(dir, "103.json"), "not json");
    writeFileSync(join(dir, "104.json"), JSON.stringify({ ...entry(104), cpus: "8" }));
    writeFileSync(join(dir, "105.json"), JSON.stringify(entry(999)));
    writeFileSync(join(dir, "notes.txt"), "x");
    writeFileSync(join(dir, "0.json"), JSON.stringify(entry(0)));
    writeFileSync(join(dir, "106.json"), JSON.stringify(entry(106)) + " ".repeat(ENTRY_MAX_BYTES));
    mkdirSync(join(dir, "107.json"));
    expect(live(1, alive([]))).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(["0.json", "103.json", "104.json", "105.json", "106.json", "107.json", "notes.txt"]);
  });

  it("ignores, never probes and never removes entries whose pid is 0, 1, 2^31, above PID_MAX or a fraction", () => {
    mkdirSync(dir, { recursive: true });
    for (const pid of [0, 1, 2 ** 31, PID_MAX + 1, 1.5]) {
      // Each file holds an entry of its own pid, otherwise valid, so only the pid can make it not one.
      writeFileSync(join(dir, `${pid}.json`), JSON.stringify(entry(pid)));
    }
    register(dir, entry(PID_MAX), nodeRegistryFs);
    const probed: number[] = [];
    expect(live(2, (pid) => (probed.push(pid), "alive"))).toEqual([PID_MAX]);
    expect(probed).toEqual([PID_MAX]);
    // A probe that calls every pid gone removes only the real entry.
    expect(live(2, () => "gone")).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(["0.json", "1.5.json", "1.json", "2147483648.json", `${PID_MAX + 1}.json`]);
  });

  it.skipIf(process.platform === "win32")("skips a FIFO entry without blocking and leaves it", () => {
    mkdirSync(dir, { recursive: true });
    const fifo = join(dir, "7.json");
    execFileSync("mkfifo", [fifo]);
    register(dir, entry(8), nodeRegistryFs);
    // A blocking open would hang here: nobody ever opens the FIFO for writing.
    expect(readEntryFile(fifo)).toBeNull();
    expect(live(1, alive([7, 8]))).toEqual([8]);
    expect(live(1, alive([]))).toEqual([]);
    expect(lstatSync(fifo).isFIFO()).toBe(true);
  });

  it.skipIf(process.platform === "win32")("skips a link entry, whatever it points to, and removes neither the link nor its target", () => {
    mkdirSync(dir, { recursive: true });
    const target = join(tmp, "target.json");
    writeFileSync(target, JSON.stringify(entry(7)));
    symlinkSync(target, join(dir, "7.json"));
    const stale = join(tmp, "stale.json");
    writeFileSync(stale, JSON.stringify(entry(8, "test", { startedAt: "never" })));
    symlinkSync(stale, join(dir, "8.json"));
    symlinkSync(join(tmp, "missing.json"), join(dir, "9.json"));
    expect(() => readEntryFile(join(dir, "7.json"))).toThrow();
    expect(live(1, alive([7, 8, 9]))).toEqual([]);
    expect(live(1, alive([]))).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(["7.json", "8.json", "9.json"]);
    expect(existsSync(target)).toBe(true);
    expect(existsSync(stale)).toBe(true);
  });

  it("skips a file removed between the listing and the read, and survives a failed removal", () => {
    const fs: RegistryFs = {
      ...nodeRegistryFs,
      readDir: () => ["7.json", "8.json", "9.json"],
      readEntry: (path) => {
        if (path.endsWith("7.json")) throw errno("ENOENT");
        if (path.endsWith("9.json")) return null;
        return JSON.stringify(entry(8));
      },
      remove: () => {
        throw errno("EPERM");
      },
    };
    expect(live(1, alive([]), NOW, fs)).toEqual([]);
  });

  it("throws when the directory cannot be read", () => {
    expect(() => liveEntries(join(tmp, "missing"), 1, nodeRegistryFs, alive([]), NOW)).toThrow(/ENOENT/);
  });
});

describe("killProbe", () => {
  it("is alive on success or EPERM, and gone on ESRCH, EINVAL or any other error", () => {
    const signals: Array<[number, number]> = [];
    const probe = killProbe((pid, signal) => {
      signals.push([pid, signal]);
      if (pid === 11) throw errno("ESRCH");
      if (pid === 12) throw errno("EPERM");
      if (pid === 13) throw errno("EINVAL");
      if (pid === 14) throw new Error("no code");
    });
    expect([probe(11), probe(12), probe(13), probe(14), probe(15)]).toEqual(["gone", "alive", "gone", "gone", "alive"]);
    expect(signals).toEqual([
      [11, 0],
      [12, 0],
      [13, 0],
      [14, 0],
      [15, 0],
    ]);
  });

  it("is gone, without a signal, for a pid no other check can have", () => {
    const signals: number[] = [];
    const probe = killProbe((pid) => signals.push(pid));
    for (const pid of [0, 1, -1, 1.5, 2 ** 31, PID_MAX + 1, Number.NaN, Number.POSITIVE_INFINITY]) expect(probe(pid)).toBe("gone");
    expect(signals).toEqual([]);
    expect([probe(2), probe(PID_MAX)]).toEqual(["alive", "alive"]);
    expect(signals).toEqual([2, PID_MAX]);
  });

  it("works with the real process.kill", () => {
    const probe = killProbe((pid, signal) => process.kill(pid, signal));
    expect(probe(process.pid)).toBe("alive");
    // Far above any pid a system hands out.
    expect(probe(2 ** 30)).toBe("gone");
  });
});

describe("isEntryPid", () => {
  it("takes the integers from 2 to PID_MAX and nothing else", () => {
    expect(PID_MAX).toBe(4_194_304);
    for (const pid of [2, 101, PID_MAX]) expect(isEntryPid(pid)).toBe(true);
    for (const pid of [0, 1, -5, 1.5, 2 ** 31, PID_MAX + 1, Number.NaN, "101", null]) expect(isEntryPid(pid)).toBe(false);
  });
});

describe("nodeRegistryFs", () => {
  it("creates exclusively, replaces, reads regular files and removes missing files quietly", () => {
    const path = join(tmp, "a", "b.json");
    nodeRegistryFs.mkdirp(join(tmp, "a"));
    expect(nodeRegistryFs.writeExclusive(path, "1")).toBe(true);
    expect(nodeRegistryFs.writeExclusive(path, "2")).toBe(false);
    expect(nodeRegistryFs.readFile(path)).toBe("1");
    expect(nodeRegistryFs.readEntry(path)).toBe("1");
    nodeRegistryFs.replace(path, "3");
    expect(nodeRegistryFs.readEntry(path)).toBe("3");
    expect(nodeRegistryFs.readDir(join(tmp, "a"))).toEqual(["b.json"]);
    expect(nodeRegistryFs.readEntry(join(tmp, "a"))).toBeNull();
    expect(() => nodeRegistryFs.readEntry(join(tmp, "a", "missing.json"))).toThrow(/ENOENT/);
    nodeRegistryFs.remove(path);
    nodeRegistryFs.remove(path);
    expect(existsSync(path)).toBe(false);
  });
});
