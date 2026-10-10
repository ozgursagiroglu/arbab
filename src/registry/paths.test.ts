import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AttemptExit } from "../types";
import { ArbabError } from "../util/errors";
import { attemptFiles, createAttempt, listAttempts, listLanes, readAttempt, runPaths } from "./index";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "arbab-registry-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("runPaths / attemptFiles", () => {
  it("lays out a lane as in DESIGN.md §3", () => {
    const p = runPaths(root, "m1-stream");
    expect(p.laneDir).toBe(join(root, "m1-stream"));
    expect(p.laneFile).toBe(join(root, "m1-stream", "lane.json"));
    expect(p.stateFile).toBe(join(root, "m1-stream", "state.json"));
    expect(p.shepherdFile).toBe(join(root, "m1-stream", "shepherd.json"));
    expect(p.attemptDir(3)).toBe(join(root, "m1-stream", "attempt-3"));
  });

  it("refuses invalid lane names and attempt numbers", () => {
    for (const bad of ["", "..", "../x", "A", "a/b", "-x"]) {
      expect(() => runPaths(root, bad)).toThrow(ArbabError);
    }
    const p = runPaths(root, "x");
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => p.attemptDir(bad)).toThrow(ArbabError);
  });

  it("names every attempt file", () => {
    const f = attemptFiles("/r/x/attempt-1");
    expect(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.slice("/r/x/attempt-1/".length)]))).toEqual({
      brief: "brief.md",
      settings: "settings.json",
      args: "args.json",
      started: "started.json",
      stream: "stream.jsonl",
      stderr: "stderr.log",
      registration: "registration.json",
      exit: "exit.json",
      summary: "summary.json",
      report: "report.json",
      acked: "acked",
    });
  });
});

describe("createAttempt / listAttempts / listLanes", () => {
  it("numbers attempts from 1 and never reuses a number", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 12; i++) seen.add(createAttempt(root, "lane").n);
    expect([...seen]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(listAttempts(root, "lane")).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("continues after the highest existing attempt", () => {
    mkdirSync(join(root, "lane", "attempt-7"), { recursive: true });
    expect(createAttempt(root, "lane")).toEqual({ n: 8, dir: join(root, "lane", "attempt-8") });
  });

  it("ignores files and odd names when listing", () => {
    mkdirSync(join(root, "lane", "attempt-2"), { recursive: true });
    mkdirSync(join(root, "lane", "attempt-01"));
    mkdirSync(join(root, "lane", "attempt-x"));
    writeFileSync(join(root, "lane", "attempt-9"), "");
    expect(listAttempts(root, "lane")).toEqual([2]);
  });

  it("lists nothing for a lane or a root that does not exist", () => {
    expect(listAttempts(root, "nope")).toEqual([]);
    expect(listLanes(join(root, "missing"))).toEqual([]);
  });

  it("lists valid lane directories, sorted", () => {
    for (const name of ["zeta", "alpha", "Bad", ".hidden"]) mkdirSync(join(root, name));
    writeFileSync(join(root, "file"), "");
    expect(listLanes(root)).toEqual(["alpha", "zeta"]);
  });
});

describe("readAttempt", () => {
  it("reads missing files as null and not acked", () => {
    const { dir } = createAttempt(root, "lane");
    expect(readAttempt(dir)).toEqual({ started: null, exit: null, summary: null, acked: false });
  });

  it("reads the recorded files", () => {
    const { dir } = createAttempt(root, "lane");
    const exit: AttemptExit = {
      exitCode: 0,
      signal: null,
      killedBy: null,
      finishedAt: "2026-10-09T10:00:00.000Z",
      wallMs: 1000,
      reaped: [],
      checkpoint: null,
      checkpointError: null,
    };
    writeFileSync(join(dir, "exit.json"), JSON.stringify(exit));
    writeFileSync(join(dir, "acked"), "1\n");
    expect(readAttempt(dir)).toEqual({ started: null, exit, summary: null, acked: true });
  });

  it("throws on a file that is not a JSON object", () => {
    const { dir } = createAttempt(root, "lane");
    writeFileSync(join(dir, "summary.json"), "[]");
    expect(() => readAttempt(dir)).toThrow(ArbabError);
  });
});
