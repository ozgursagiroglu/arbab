import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWatcher, fileRange, fileSize, type WatcherInput } from "./watch";

const MIN = 60_000;

/** An in-memory stream file and a settable clock. */
function harness(overrides: Partial<WatcherInput> = {}) {
  let content = Buffer.alloc(0);
  let now = 0;
  const reads: Array<[number, number]> = [];
  const watcher = createWatcher({
    streamPath: "stream.jsonl",
    startedAtMs: 0,
    wallMs: 120 * MIN,
    idleMs: 30 * MIN,
    clock: { now: () => now },
    readSize: () => content.length,
    readRange: (_path, start, end) => {
      reads.push([start, end]);
      return content.subarray(start, end);
    },
    ...overrides,
  });
  return {
    watcher,
    reads,
    append(text: string) {
      content = Buffer.concat([content, Buffer.from(text)]);
    },
    at(ms: number) {
      now = ms;
      return watcher.tick().kill;
    },
    tickAt(ms: number) {
      now = ms;
      return watcher.tick();
    },
  };
}

const line = (event: object) => JSON.stringify(event) + "\n";

describe("createWatcher", () => {
  it("kills on the wall clock even while the stream grows", () => {
    const h = harness();
    h.append(line({ type: "assistant" }));
    expect(h.at(120 * MIN)).toBeNull();
    h.append(line({ type: "assistant" }));
    expect(h.at(120 * MIN + 1)).toBe("wall");
  });

  it("kills on idle when the stream stops growing, measured from the last growth", () => {
    const h = harness();
    expect(h.at(30 * MIN)).toBeNull();
    expect(h.at(30 * MIN + 1)).toBe("idle");

    const g = harness();
    g.append(line({ type: "system", subtype: "init" }));
    expect(g.at(10 * MIN)).toBeNull();
    expect(g.at(40 * MIN)).toBeNull();
    expect(g.at(40 * MIN + 1)).toBe("idle");
  });

  it("kills a hang after a successful result before idle would", () => {
    const h = harness({ idleMs: 60 * MIN });
    h.append(line({ type: "result", subtype: "success", is_error: false }));
    expect(h.at(1000)).toBeNull();
    expect(h.at(1000 + 15 * MIN)).toBeNull();
    expect(h.at(1001 + 15 * MIN)).toBe("hang-after-result");
  });

  it("checks hang-after-result before idle when both apply", () => {
    const h = harness({ idleMs: 5 * MIN });
    h.append(line({ type: "result", is_error: false }));
    expect(h.at(0)).toBeNull();
    expect(h.at(5 * MIN + 1)).toBe("idle");
    expect(h.at(15 * MIN + 1)).toBe("hang-after-result");
  });

  it("kills two minutes after an error result", () => {
    const h = harness();
    h.append(line({ type: "result", subtype: "error_during_execution", is_error: true }));
    expect(h.at(1000)).toBeNull();
    expect(h.at(1000 + 2 * MIN)).toBeNull();
    expect(h.at(1001 + 2 * MIN)).toBe("hang-after-error");
  });

  it("remembers only the last result", () => {
    const h = harness();
    h.append(line({ type: "result", is_error: true }) + line({ type: "assistant" }) + line({ type: "result", is_error: false }));
    expect(h.at(0)).toBeNull();
    expect(h.at(3 * MIN)).toBeNull();
    expect(h.watcher.state()).toMatchObject({ resultSeen: true, lastResultIsError: false });
  });

  it("new events after a result restart the quiet period", () => {
    const h = harness();
    h.append(line({ type: "result", is_error: true }));
    expect(h.at(0)).toBeNull();
    h.append(line({ type: "assistant" }));
    expect(h.at(2 * MIN)).toBeNull();
    expect(h.at(4 * MIN)).toBeNull();
    expect(h.at(4 * MIN + 1)).toBe("hang-after-error");
  });

  it("uses custom hang thresholds", () => {
    const h = harness({ hangAfterResultMs: 1000, hangAfterErrorMs: 100 });
    h.append(line({ type: "result" }));
    expect(h.at(0)).toBeNull();
    expect(h.at(1001)).toBe("hang-after-result");
  });

  it("reads only appended bytes and carries partial lines over", () => {
    const h = harness();
    const result = line({ type: "result", is_error: true });
    h.append(line({ type: "assistant" }) + result.slice(0, 10));
    h.at(1);
    expect(h.watcher.state().resultSeen).toBe(false);
    h.append(result.slice(10));
    h.at(2);
    expect(h.watcher.state()).toMatchObject({ resultSeen: true, lastResultIsError: true, lastGrowthMs: 2 });
    h.at(3);
    const first = h.reads[0]!;
    expect(h.reads).toEqual([first, [first[1], first[1] + result.length - 10]]);
  });

  it("carries a multi-byte character split across ticks", () => {
    const bytes = Buffer.from(line({ type: "result", is_error: true, result: "ğüş" }));
    const cut = bytes.indexOf(Buffer.from("ğ")) + 1;
    let size = cut;
    const h = harness({ readSize: () => size, readRange: (_p, s, e) => bytes.subarray(s, e) });
    h.at(1);
    size = bytes.length;
    h.at(2);
    expect(h.watcher.state()).toMatchObject({ resultSeen: true, lastResultIsError: true });
  });

  it("ignores lines that are not JSON objects and unknown event types", () => {
    const h = harness();
    h.append("not json\n42\nnull\n" + line({ type: "something-new", is_error: true }) + "\n");
    expect(h.at(1)).toBeNull();
    expect(h.watcher.state().resultSeen).toBe(false);
  });

  it("returns the last rate_limit_event of the bytes read this tick, and nothing on later ticks", () => {
    const h = harness();
    const first = { type: "rate_limit_event", rate_limit_info: { status: "allowed", n: 1 } };
    const second = { type: "rate_limit_event", rate_limit_info: { status: "allowed_warning", n: 2 } };
    expect(h.tickAt(1).rateLimitEvent).toBeNull();
    h.append(line(first) + line({ type: "assistant" }) + line(second) + line({ type: "assistant" }));
    expect(h.tickAt(2)).toEqual({ kill: null, rateLimitEvent: second });
    expect(h.tickAt(3).rateLimitEvent).toBeNull();
    // Half a line is not read yet; the event counts on the tick that completes it.
    const third = line({ ...first, rate_limit_info: { n: 3 } });
    h.append(third.slice(0, 12));
    expect(h.tickAt(4).rateLimitEvent).toBeNull();
    h.append(third.slice(12));
    expect(h.tickAt(5).rateLimitEvent).toEqual({ ...first, rate_limit_info: { n: 3 } });
  });

  it("ignores a rate_limit_event that is not an object", () => {
    const h = harness();
    h.append('["rate_limit_event"]\n');
    expect(h.tickAt(1).rateLimitEvent).toBeNull();
  });

  it("starts over when the file shrinks", () => {
    let size = 50;
    const w = createWatcher({
      streamPath: "s",
      startedAtMs: 0,
      wallMs: MIN,
      idleMs: MIN,
      clock: { now: () => 0 },
      readSize: () => size,
      readRange: (_p, s, e) => Buffer.alloc(e - s, 0x20),
    });
    w.tick();
    size = 10;
    w.tick();
    expect(w.state().offset).toBe(10);
  });
});

describe("file readers", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "arbab-watch-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("report 0 for a missing file and read byte ranges", () => {
    const p = join(dir, "stream.jsonl");
    expect(fileSize(p)).toBe(0);
    writeFileSync(p, "abc");
    appendFileSync(p, "def");
    expect(fileSize(p)).toBe(6);
    expect(fileRange(p, 2, 5).toString()).toBe("cde");
    expect(fileRange(p, 4, 4).length).toBe(0);
    expect(fileRange(p, 4, 100).toString()).toBe("ef");
  });

  it("drive the watcher on a real file by default", () => {
    const p = join(dir, "stream.jsonl");
    let now = 0;
    const w = createWatcher({ streamPath: p, startedAtMs: 0, wallMs: 10 * MIN, idleMs: MIN, clock: { now: () => now } });
    expect(w.tick().kill).toBeNull();
    writeFileSync(p, line({ type: "result", is_error: true }));
    now = 30_000;
    expect(w.tick().kill).toBeNull();
    now = 30_000 + 2 * MIN + 1;
    expect(w.tick().kill).toBe("hang-after-error");
  });
});
