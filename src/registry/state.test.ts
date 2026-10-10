import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LaneState, LaneStateRecord } from "../types";
import { ArbabError } from "../util/errors";
import { LANE_STATES, effectiveState, readState, writeState } from "./index";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "arbab-state-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const record = (state: LaneState, over: Partial<LaneStateRecord> = {}): LaneStateRecord => ({
  lane: "m1-run",
  state,
  attempt: 1,
  since: "2026-10-09T10:00:00.000Z",
  shepherdPid: 4242,
  ...over,
});

describe("writeState / readState", () => {
  it("round-trips a record, optional fields included", () => {
    const r = record("finished", { endState: "usage-limit", reason: "429", until: 1791549000 });
    writeState(root, r);
    expect(readState(root, "m1-run")).toEqual(r);
    expect(readdirSync(join(root, "m1-run"))).toEqual(["state.json"]);
  });

  it("replaces the previous record", () => {
    writeState(root, record("running"));
    writeState(root, record("waiting-reset", { attempt: 2 }));
    expect(readState(root, "m1-run")).toMatchObject({ state: "waiting-reset", attempt: 2 });
  });

  it("reads null before the shepherd wrote anything", () => {
    expect(readState(root, "m1-run")).toBeNull();
  });

  it("refuses to write an invalid record", () => {
    expect(() => writeState(root, record("running", { lane: "../x" }))).toThrow(ArbabError);
    expect(() => writeState(root, { ...record("running"), state: "bogus" as LaneState })).toThrow(ArbabError);
  });

  it("throws on a malformed or misplaced record", () => {
    mkdirSync(join(root, "m1-run"));
    writeFileSync(join(root, "m1-run", "state.json"), JSON.stringify({ lane: "m1-run", state: "running" }));
    expect(() => readState(root, "m1-run")).toThrow(ArbabError);
    writeFileSync(join(root, "m1-run", "state.json"), JSON.stringify(record("running", { lane: "other" })));
    expect(() => readState(root, "m1-run")).toThrow(ArbabError);
  });
});

describe("effectiveState", () => {
  const dead = (): boolean => false;
  const alive = (): boolean => true;

  it("keeps every state while the shepherd lives", () => {
    for (const s of LANE_STATES) expect(effectiveState(record(s), alive)).toBe(s);
  });

  it("turns any unfinished state into orphaned when the shepherd is dead", () => {
    for (const s of LANE_STATES.filter((s) => s !== "finished")) {
      expect(effectiveState(record(s), dead)).toBe("orphaned");
    }
  });

  it("keeps finished whatever the shepherd", () => {
    expect(effectiveState(record("finished"), dead)).toBe("finished");
  });

  it("asks about the shepherd's pid", () => {
    const asked: number[] = [];
    effectiveState(record("running"), (pid) => {
      asked.push(pid);
      return true;
    });
    expect(asked).toEqual([4242]);
  });
});
