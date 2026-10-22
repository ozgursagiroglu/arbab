import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ShepherdEntry, WaiterEntry } from "../types";
import {
  listProjects,
  listShepherds,
  listWaiters,
  projectFile,
  registerProject,
  registerShepherd,
  registerWaiter,
  unregisterShepherd,
  unregisterWaiter,
} from "./index";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "arbab-machine-reg-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const shepherd = (pid: number, startedAt: string, over: Partial<ShepherdEntry> = {}): ShepherdEntry => ({
  pid,
  lane: "demo",
  project: "/work/repo",
  owner: "session-a",
  startedAt,
  ...over,
});

const waiter = (pid: number, startedAt: string): WaiterEntry => ({ pid, project: "/work/repo", owner: null, startedAt });

const everyoneAlive = (): boolean => true;

describe("shepherd registry", () => {
  it("writes <home>/shepherds/<pid>.json and lists live entries by startedAt", () => {
    registerShepherd(home, shepherd(30, "2026-10-21T10:00:02.000Z"));
    registerShepherd(home, shepherd(20, "2026-10-21T10:00:01.000Z", { owner: null, lane: "other" }));
    registerShepherd(home, shepherd(10, "2026-10-21T10:00:03.000Z"));
    expect(JSON.parse(readFileSync(join(home, "shepherds", "30.json"), "utf8"))).toEqual(shepherd(30, "2026-10-21T10:00:02.000Z"));
    expect(listShepherds(home, everyoneAlive).map((e) => e.pid)).toEqual([20, 30, 10]);
    expect(listShepherds(home, everyoneAlive)[0]).toEqual(shepherd(20, "2026-10-21T10:00:01.000Z", { owner: null, lane: "other" }));
  });

  it("orders equal startedAt by pid", () => {
    registerShepherd(home, shepherd(9, "2026-10-21T10:00:00.000Z"));
    registerShepherd(home, shepherd(8, "2026-10-21T10:00:00.000Z"));
    expect(listShepherds(home, everyoneAlive).map((e) => e.pid)).toEqual([8, 9]);
  });

  it("overwrites the entry of a pid registered again", () => {
    registerShepherd(home, shepherd(5, "2026-10-21T10:00:00.000Z"));
    registerShepherd(home, shepherd(5, "2026-10-21T11:00:00.000Z", { lane: "next" }));
    expect(listShepherds(home, everyoneAlive)).toEqual([shepherd(5, "2026-10-21T11:00:00.000Z", { lane: "next" })]);
  });

  it("removes and skips the entries of dead pids", () => {
    registerShepherd(home, shepherd(1, "2026-10-21T10:00:00.000Z"));
    registerShepherd(home, shepherd(2, "2026-10-21T10:00:00.000Z"));
    expect(listShepherds(home, (pid) => pid === 2).map((e) => e.pid)).toEqual([2]);
    expect(existsSync(join(home, "shepherds", "1.json"))).toBe(false);
    expect(existsSync(join(home, "shepherds", "2.json"))).toBe(true);
  });

  it("skips files that do not parse, have the wrong shape, name another pid or are not entries", () => {
    const dir = join(home, "shepherds");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "11.json"), "{");
    writeFileSync(join(dir, "12.json"), JSON.stringify({ pid: 12, lane: "x" }));
    writeFileSync(join(dir, "13.json"), JSON.stringify(shepherd(99, "2026-10-21T10:00:00.000Z")));
    writeFileSync(join(dir, "14.json"), JSON.stringify(shepherd(14, "2026-10-21T10:00:00.000Z", { owner: 5 as unknown as string })));
    writeFileSync(join(dir, "notes.txt"), "x");
    writeFileSync(join(dir, ".a1b2.tmp"), "{}");
    registerShepherd(home, shepherd(15, "2026-10-21T10:00:00.000Z"));
    // The dead-pid check never sees the unparsable files, so they are left for a person to look at.
    expect(listShepherds(home, () => false)).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual([".a1b2.tmp", "11.json", "12.json", "13.json", "14.json", "notes.txt"]);
  });

  it("lists none when the directory is missing", () => {
    expect(listShepherds(home, everyoneAlive)).toEqual([]);
    expect(listShepherds(join(home, "nope"), everyoneAlive)).toEqual([]);
  });

  it("unregisters, ignoring a missing file", () => {
    registerShepherd(home, shepherd(7, "2026-10-21T10:00:00.000Z"));
    unregisterShepherd(home, 7);
    expect(existsSync(join(home, "shepherds", "7.json"))).toBe(false);
    expect(() => unregisterShepherd(home, 7)).not.toThrow();
    expect(() => unregisterShepherd(join(home, "nope"), 7)).not.toThrow();
  });

  it("refuses a pid that cannot be a file name", () => {
    for (const pid of [0, -1, 1.5, Number.NaN]) {
      expect(() => registerShepherd(home, shepherd(pid, "2026-10-21T10:00:00.000Z"))).toThrow(/must be a positive integer/);
    }
  });
});

describe("waiter registry", () => {
  it("writes <home>/waiters/<pid>.json, lists live ones by startedAt and unregisters", () => {
    registerWaiter(home, waiter(41, "2026-10-21T10:00:05.000Z"));
    registerWaiter(home, waiter(40, "2026-10-21T10:00:06.000Z"));
    registerWaiter(home, waiter(42, "2026-10-21T10:00:04.000Z"));
    expect(existsSync(join(home, "waiters", "41.json"))).toBe(true);
    expect(listWaiters(home, (pid) => pid !== 42)).toEqual([waiter(41, "2026-10-21T10:00:05.000Z"), waiter(40, "2026-10-21T10:00:06.000Z")]);
    expect(existsSync(join(home, "waiters", "42.json"))).toBe(false);
    unregisterWaiter(home, 41);
    unregisterWaiter(home, 41);
    expect(listWaiters(home, everyoneAlive).map((w) => w.pid)).toEqual([40]);
  });

  it("skips waiter files that do not parse or lack fields", () => {
    mkdirSync(join(home, "waiters"), { recursive: true });
    writeFileSync(join(home, "waiters", "1.json"), "not json");
    writeFileSync(join(home, "waiters", "2.json"), JSON.stringify({ pid: 2, project: "/p", startedAt: "x" }));
    writeFileSync(join(home, "waiters", "3.json"), "[]");
    expect(listWaiters(home, everyoneAlive)).toEqual([]);
  });
});

describe("project registry", () => {
  it("writes <home>/projects/<sha1(root)>.json and lists projects by root", () => {
    registerProject(home, "/work/zeta", "2026-10-21T10:00:00.000Z");
    registerProject(home, "/work/alpha", "2026-10-21T09:00:00.000Z");
    const sha = createHash("sha1").update("/work/zeta").digest("hex");
    expect(projectFile(home, "/work/zeta")).toBe(join(home, "projects", `${sha}.json`));
    expect(JSON.parse(readFileSync(join(home, "projects", `${sha}.json`), "utf8"))).toEqual({
      root: "/work/zeta",
      lastLaunchAt: "2026-10-21T10:00:00.000Z",
    });
    expect(listProjects(home)).toEqual([
      { root: "/work/alpha", lastLaunchAt: "2026-10-21T09:00:00.000Z" },
      { root: "/work/zeta", lastLaunchAt: "2026-10-21T10:00:00.000Z" },
    ]);
  });

  it("refreshes lastLaunchAt on a second launch", () => {
    registerProject(home, "/work/a", "2026-10-21T09:00:00.000Z");
    registerProject(home, "/work/a", "2026-10-22T09:00:00.000Z");
    expect(listProjects(home)).toEqual([{ root: "/work/a", lastLaunchAt: "2026-10-22T09:00:00.000Z" }]);
  });

  it("skips files that do not parse and lists none without a directory", () => {
    expect(listProjects(home)).toEqual([]);
    mkdirSync(join(home, "projects"));
    writeFileSync(join(home, "projects", `${"a".repeat(40)}.json`), "{");
    writeFileSync(join(home, "projects", `${"b".repeat(40)}.json`), JSON.stringify({ root: 1, lastLaunchAt: "x" }));
    writeFileSync(join(home, "projects", "other.json"), JSON.stringify({ root: "/x", lastLaunchAt: "x" }));
    expect(listProjects(home)).toEqual([]);
  });
});
