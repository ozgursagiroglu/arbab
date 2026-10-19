import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createToolCallCounter, FIRST_READ_CHUNKS } from "./tail";

let dir: string;
let stream: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arbab-"));
  stream = join(dir, "stream.jsonl");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const use = (id: string | null, name: string): string =>
  JSON.stringify({ type: "assistant", message: { id: `m-${id ?? name}`, content: [{ type: "tool_use", ...(id === null ? {} : { id }), name, input: {} }] } }) + "\n";

describe("createToolCallCounter", () => {
  it("counts what is appended across calls, reading on from the last offset", () => {
    const counter = createToolCallCounter();
    writeFileSync(stream, JSON.stringify({ type: "system", subtype: "init" }) + "\n" + use("a", "Bash"));
    expect(counter.count("demo", 1, stream)).toEqual({ toolCalls: 1, lastTool: "Bash" });
    expect(counter.count("demo", 1, stream)).toEqual({ toolCalls: 1, lastTool: "Bash" });
    appendFileSync(stream, use("b", "Read") + use("c", "Edit"));
    expect(counter.count("demo", 1, stream)).toEqual({ toolCalls: 3, lastTool: "Edit" });
  });

  it("waits for a trailing line without a newline and skips lines that do not parse", () => {
    const counter = createToolCallCounter();
    const line = use("a", "Bash");
    writeFileSync(stream, "not json\n\n" + line.slice(0, 20));
    expect(counter.count("demo", 1, stream)).toEqual({ toolCalls: 0, lastTool: null });
    appendFileSync(stream, line.slice(20));
    expect(counter.count("demo", 1, stream)).toEqual({ toolCalls: 1, lastTool: "Bash" });
  });

  it("decodes a multi-byte character cut by a tiny read limit", () => {
    const counter = createToolCallCounter({ maxBytesPerCall: 3 });
    // The first read may take several chunks; an empty file makes every read here a later one, one chunk each.
    writeFileSync(stream, "");
    expect(counter.count("demo", 1, stream).toolCalls).toBe(0);
    const text = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "€ğü" }, { type: "tool_use", id: "x", name: "Ünlü" }] } }) + "\n";
    appendFileSync(stream, text);
    const calls = Math.ceil(Buffer.byteLength(text) / 3);
    for (let i = 1; i < calls; i++) expect(counter.count("demo", 1, stream).toolCalls).toBe(0);
    expect(counter.count("demo", 1, stream)).toEqual({ toolCalls: 1, lastTool: "Ünlü" });
  });

  it("reads at most maxBytesPerCall per call after the first; the rest waits for the next call", () => {
    const counter = createToolCallCounter({ maxBytesPerCall: use("a", "Bash").length });
    writeFileSync(stream, use("a", "Bash"));
    expect(counter.count("demo", 1, stream)).toEqual({ toolCalls: 1, lastTool: "Bash" });
    appendFileSync(stream, use("b", "Grep") + use("c", "Read"));
    expect(counter.count("demo", 1, stream)).toEqual({ toolCalls: 2, lastTool: "Grep" });
    expect(counter.count("demo", 1, stream)).toEqual({ toolCalls: 3, lastTool: "Read" });
  });

  it("counts a stream under the first-read cap on the first call of an attempt, in several chunks", () => {
    const max = 256;
    const counter = createToolCallCounter({ maxBytesPerCall: max });
    const names = ["Bash", "Read", "Edit", "Grep", "Glob", "Write", "Ünlü"];
    const head = names.map((n, i) => use(`id-${i}`, n)).join("") + use("tail", "Bash").slice(0, 10);
    const rest = use("tail", "Bash").slice(10);
    // More than one chunk, and under the cap even with the rest appended.
    expect(Buffer.byteLength(head)).toBeGreaterThan(2 * max);
    expect(Buffer.byteLength(head + rest)).toBeLessThan(FIRST_READ_CHUNKS * max);
    writeFileSync(stream, head);
    expect(counter.count("demo", 1, stream)).toEqual({ toolCalls: 7, lastTool: "Ünlü" });
    appendFileSync(stream, rest);
    expect(counter.count("demo", 1, stream)).toEqual({ toolCalls: 8, lastTool: "Bash" });
    // Another attempt is a first read again; so is a file that comes back after it went missing.
    expect(counter.count("demo", 2, stream)).toEqual({ toolCalls: 8, lastTool: "Bash" });
    rmSync(stream);
    expect(counter.count("demo", 2, stream)).toEqual({ toolCalls: 0, lastTool: null });
    writeFileSync(stream, use("a", "Bash") + use("b", "Read") + use("c", "Edit"));
    expect(counter.count("demo", 2, stream)).toEqual({ toolCalls: 3, lastTool: "Edit" });
  });

  it("takes several calls to count a stream over the first-read cap: the cap on the first, one chunk on each later", () => {
    // Lines of one length, so each chunk is one line.
    const line = (i: number): string => use(`id-${String(i).padStart(2, "0")}`, "Bash");
    const max = Buffer.byteLength(line(0));
    const total = FIRST_READ_CHUNKS + 5;
    writeFileSync(stream, Array.from({ length: total }, (_, i) => line(i)).join(""));
    const counter = createToolCallCounter({ maxBytesPerCall: max });
    expect(counter.count("demo", 1, stream).toolCalls).toBe(FIRST_READ_CHUNKS);
    for (let n = FIRST_READ_CHUNKS + 1; n <= total; n++) expect(counter.count("demo", 1, stream).toolCalls).toBe(n);
    expect(counter.count("demo", 1, stream).toolCalls).toBe(total);
    // Another attempt starts with the cap again.
    expect(counter.count("demo", 2, stream).toolCalls).toBe(FIRST_READ_CHUNKS);
  });

  it("reads a file that started over with the first-read budget, even after the first call", () => {
    const max = Buffer.byteLength(use("a", "Bash"));
    const counter = createToolCallCounter({ maxBytesPerCall: max });
    writeFileSync(stream, use("a", "Bash") + use("b", "Bash") + use("c", "Bash") + use("d", "Bash"));
    expect(counter.count("demo", 1, stream).toolCalls).toBe(4);
    writeFileSync(stream, use("x", "Grep") + use("y", "Read"));
    expect(counter.count("demo", 1, stream)).toEqual({ toolCalls: 2, lastTool: "Read" });
  });

  it("counts a replayed id once, a block without an id each time, and never StructuredOutput", () => {
    const counter = createToolCallCounter();
    writeFileSync(stream, use("a", "Bash") + use("a", "Bash") + use(null, "Read") + use(null, "Read") + use("s", "StructuredOutput"));
    expect(counter.count("demo", 1, stream)).toEqual({ toolCalls: 3, lastTool: "Read" });
    appendFileSync(stream, use("a", "Bash"));
    expect(counter.count("demo", 1, stream).toolCalls).toBe(3);
  });

  it("starts over for another attempt", () => {
    const counter = createToolCallCounter();
    writeFileSync(stream, use("a", "Bash") + use("b", "Bash"));
    expect(counter.count("demo", 1, stream).toolCalls).toBe(2);
    const second = join(dir, "stream-2.jsonl");
    writeFileSync(second, use("a", "Read"));
    expect(counter.count("demo", 2, second)).toEqual({ toolCalls: 1, lastTool: "Read" });
    // The same file under another attempt number is counted again from the start.
    expect(counter.count("demo", 3, second)).toEqual({ toolCalls: 1, lastTool: "Read" });
  });

  it("starts over when the file is shorter than the offset", () => {
    const counter = createToolCallCounter();
    writeFileSync(stream, use("a", "Bash") + use("b", "Bash") + use("c", "Bash"));
    expect(counter.count("demo", 1, stream).toolCalls).toBe(3);
    writeFileSync(stream, use("a", "Grep"));
    expect(counter.count("demo", 1, stream)).toEqual({ toolCalls: 1, lastTool: "Grep" });
  });

  it("counts a missing file as 0, and counts it once it appears", () => {
    const counter = createToolCallCounter();
    expect(counter.count("demo", 1, stream)).toEqual({ toolCalls: 0, lastTool: null });
    writeFileSync(stream, use("a", "Bash"));
    expect(counter.count("demo", 1, stream)).toEqual({ toolCalls: 1, lastTool: "Bash" });
    rmSync(stream);
    expect(counter.count("demo", 1, stream)).toEqual({ toolCalls: 0, lastTool: null });
  });

  it("keeps lanes apart and forgets those retain leaves out", () => {
    const counter = createToolCallCounter();
    const other = join(dir, "other.jsonl");
    writeFileSync(stream, use("a", "Bash"));
    writeFileSync(other, use("a", "Read") + use("b", "Read"));
    expect(counter.count("one", 1, stream).toolCalls).toBe(1);
    expect(counter.count("two", 1, other).toolCalls).toBe(2);
    counter.retain(new Set(["two"]));
    // "two" keeps its ids, so a replayed one stays counted once.
    appendFileSync(other, use("a", "Read"));
    expect(counter.count("two", 1, other).toolCalls).toBe(2);
    // "one" is read again from the start: a rewrite of the same length shows (a kept offset would see no new bytes).
    writeFileSync(stream, use("a", "Bish"));
    expect(counter.count("one", 1, stream)).toEqual({ toolCalls: 1, lastTool: "Bish" });
  });

  it("refuses a read limit that is not a positive integer", () => {
    for (const maxBytesPerCall of [0, -1, 1.5, Number.NaN]) expect(() => createToolCallCounter({ maxBytesPerCall })).toThrow(/positive integer/);
  });
});
