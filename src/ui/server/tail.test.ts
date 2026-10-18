import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createToolCallCounter } from "./tail";

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
    const text = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "€ğü" }, { type: "tool_use", id: "x", name: "Ünlü" }] } }) + "\n";
    writeFileSync(stream, text);
    const calls = Math.ceil(Buffer.byteLength(text) / 3);
    for (let i = 1; i < calls; i++) expect(counter.count("demo", 1, stream).toolCalls).toBe(0);
    expect(counter.count("demo", 1, stream)).toEqual({ toolCalls: 1, lastTool: "Ünlü" });
  });

  it("reads at most maxBytesPerCall per call; the rest waits for the next call", () => {
    const counter = createToolCallCounter({ maxBytesPerCall: use("a", "Bash").length });
    writeFileSync(stream, use("a", "Bash") + use("b", "Grep"));
    expect(counter.count("demo", 1, stream)).toEqual({ toolCalls: 1, lastTool: "Bash" });
    expect(counter.count("demo", 1, stream)).toEqual({ toolCalls: 2, lastTool: "Grep" });
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
