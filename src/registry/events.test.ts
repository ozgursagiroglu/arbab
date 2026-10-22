import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LaneEvent } from "../types";
import { EVENTS_FILE, appendLaneEvent, readLaneEvents } from "./index";

let runs: string;
beforeEach(() => {
  runs = mkdtempSync(join(tmpdir(), "arbab-events-"));
});
afterEach(() => {
  rmSync(runs, { recursive: true, force: true });
});

const held: LaneEvent = { at: "2026-10-21T10:00:00.000Z", shepherdPid: 42, state: "held", attempt: 0, reason: "no free slot", until: 1760000000000 };
const running: LaneEvent = { at: "2026-10-21T10:01:00.000Z", shepherdPid: 42, state: "running", attempt: 1 };
const finished: LaneEvent = { at: "2026-10-21T10:30:00.000Z", shepherdPid: 42, state: "finished", attempt: 1, endState: "killed:idle" };

describe("appendLaneEvent and readLaneEvents", () => {
  it("appends one JSON line per event, creating the lane directory, and reads them back in order", () => {
    appendLaneEvent(runs, "demo", held);
    appendLaneEvent(runs, "demo", running);
    appendLaneEvent(runs, "demo", finished);
    const text = readFileSync(join(runs, "demo", EVENTS_FILE), "utf8");
    expect(text.split("\n")).toHaveLength(4);
    expect(JSON.parse(text.split("\n")[0] ?? "")).toEqual(held);
    expect(readLaneEvents(runs, "demo")).toEqual([held, running, finished]);
  });

  it("reads [] when the file is missing", () => {
    expect(readLaneEvents(runs, "demo")).toEqual([]);
  });

  it("skips lines that do not parse or are not events, and ignores unknown fields", () => {
    mkdirSync(join(runs, "demo"));
    const file = join(runs, "demo", EVENTS_FILE);
    writeFileSync(
      file,
      [
        JSON.stringify(held),
        "",
        "not json",
        JSON.stringify({ ...running, state: "dancing" }),
        JSON.stringify({ at: "x", shepherdPid: "42", state: "held", attempt: 0 }),
        JSON.stringify([1]),
        JSON.stringify({ ...running, future: { x: 1 }, reason: 5, until: "soon", endState: 3 }),
      ].join("\n") + "\n",
    );
    appendFileSync(file, '{"at":"2026-10-21T10:3');
    expect(readLaneEvents(runs, "demo")).toEqual([held, running]);
  });

  it("never throws when the event cannot be written", () => {
    // A file where the lane directory should be: mkdir and append both fail.
    writeFileSync(join(runs, "demo"), "x");
    expect(() => appendLaneEvent(runs, "demo", held)).not.toThrow();
    expect(() => appendLaneEvent(runs, "../escape", held)).not.toThrow();
    expect(() => appendLaneEvent(join(runs, "missing", "\0bad"), "demo", held)).not.toThrow();
  });

  it("refuses an invalid lane name on read", () => {
    expect(() => readLaneEvents(runs, "../x")).toThrow(/lane/);
  });
});
