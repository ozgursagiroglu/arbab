import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ownedBy, readShepherdRecord, sessionOf } from "./index";

let runs: string;
beforeEach(() => {
  runs = mkdtempSync(join(tmpdir(), "arbab-owner-"));
});
afterEach(() => {
  rmSync(runs, { recursive: true, force: true });
});

function writeRecord(lane: string, text: string): void {
  mkdirSync(join(runs, lane), { recursive: true });
  writeFileSync(join(runs, lane, "shepherd.json"), text);
}

describe("sessionOf", () => {
  it("returns CLAUDE_CODE_SESSION_ID when set and non-empty", () => {
    expect(sessionOf({ CLAUDE_CODE_SESSION_ID: "abc-123" })).toBe("abc-123");
  });

  it("returns null when it is unset, empty or blank", () => {
    expect(sessionOf({})).toBeNull();
    expect(sessionOf({ CLAUDE_CODE_SESSION_ID: undefined })).toBeNull();
    expect(sessionOf({ CLAUDE_CODE_SESSION_ID: "" })).toBeNull();
    expect(sessionOf({ CLAUDE_CODE_SESSION_ID: "  " })).toBeNull();
  });
});

describe("readShepherdRecord", () => {
  it("reads a record with an owner, a null owner and none (before §21)", () => {
    writeRecord("a", JSON.stringify({ pid: 10, startedAt: "2026-10-21T10:00:00.000Z", owner: "s1" }));
    writeRecord("b", JSON.stringify({ pid: 11, startedAt: "2026-10-21T10:00:00.000Z", owner: null }));
    writeRecord("c", JSON.stringify({ pid: 12, startedAt: "2026-10-21T10:00:00.000Z", extra: true }));
    expect(readShepherdRecord(runs, "a")).toEqual({ pid: 10, startedAt: "2026-10-21T10:00:00.000Z", owner: "s1" });
    expect(readShepherdRecord(runs, "b")).toEqual({ pid: 11, startedAt: "2026-10-21T10:00:00.000Z", owner: null });
    expect(readShepherdRecord(runs, "c")).toEqual({ pid: 12, startedAt: "2026-10-21T10:00:00.000Z" });
  });

  it("drops an owner of the wrong type", () => {
    writeRecord("a", JSON.stringify({ pid: 10, startedAt: "2026-10-21T10:00:00.000Z", owner: 7 }));
    expect(readShepherdRecord(runs, "a")).toEqual({ pid: 10, startedAt: "2026-10-21T10:00:00.000Z" });
  });

  it("returns null when the file is missing, does not parse or is invalid", () => {
    expect(readShepherdRecord(runs, "none")).toBeNull();
    writeRecord("a", "{");
    expect(readShepherdRecord(runs, "a")).toBeNull();
    writeRecord("b", "[]");
    expect(readShepherdRecord(runs, "b")).toBeNull();
    writeRecord("c", JSON.stringify({ pid: "10", startedAt: "x" }));
    expect(readShepherdRecord(runs, "c")).toBeNull();
    writeRecord("d", JSON.stringify({ pid: 10 }));
    expect(readShepherdRecord(runs, "d")).toBeNull();
    writeRecord("e", JSON.stringify({ pid: 0, startedAt: "x" }));
    expect(readShepherdRecord(runs, "e")).toBeNull();
  });

  it("returns null for a lane name that is not valid", () => {
    expect(readShepherdRecord(runs, "../x")).toBeNull();
  });
});

describe("ownedBy", () => {
  const record = (owner?: string | null): { pid: number; startedAt: string; owner?: string | null } =>
    owner === undefined ? { pid: 1, startedAt: "x" } : { pid: 1, startedAt: "x", owner };

  it("gives everything to a null session", () => {
    expect(ownedBy(record("s1"), null)).toBe(true);
    expect(ownedBy(null, null, { ownerless: false })).toBe(true);
    expect(ownedBy(record(null), null, { ownerless: false })).toBe(true);
  });

  it("matches an owned run to its session only", () => {
    expect(ownedBy(record("s1"), "s1")).toBe(true);
    expect(ownedBy(record("s1"), "s2")).toBe(false);
    expect(ownedBy(record("s1"), "s1", { ownerless: false })).toBe(true);
  });

  it("gives ownerless runs to every session by default and to none with ownerless false", () => {
    for (const r of [null, record(), record(null)]) {
      expect(ownedBy(r, "s1")).toBe(true);
      expect(ownedBy(r, "s1", {})).toBe(true);
      expect(ownedBy(r, "s1", { ownerless: true })).toBe(true);
      expect(ownedBy(r, "s1", { ownerless: false })).toBe(false);
    }
  });
});
