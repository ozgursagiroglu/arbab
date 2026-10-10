import type { ChildProcess, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, fstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArbabError } from "../util/errors";
import { sendSignal } from "../util/proc";
import { spawnWorker, type SpawnImpl } from "./spawn";
import { parsePs, readPs } from "./tree";

// ps is setuid on macOS and refused inside an OS sandbox; the ps cross-check runs only where it can.
const psRuns = (() => {
  try {
    readPs();
    return true;
  } catch {
    return false;
  }
})();

let dir: string;
let prompt: string;
let stream: string;
let stderr: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arbab-spawn-"));
  prompt = join(dir, "brief.md");
  stream = join(dir, "stream.jsonl");
  stderr = join(dir, "stderr.log");
  writeFileSync(prompt, "hello worker");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// Echoes stdin to stdout, writes to stderr, then stays alive briefly so its process group can be observed.
const CHILD = `
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  process.stdout.write(JSON.stringify({ type: "echo", input, cwd: process.cwd(), env: process.env.ARBAB_TEST }) + "\\n");
  process.stderr.write("to stderr\\n");
  setTimeout(() => process.exit(3), 1500);
});
`;

describe("spawnWorker", () => {
  it("runs a detached child that leads its own group, fed by the prompt and writing to the files", async () => {
    const worker = spawnWorker({
      binary: process.execPath,
      args: ["-e", CHILD],
      cwd: dir,
      env: { PATH: process.env.PATH ?? "", ARBAB_TEST: "yes" },
      promptFile: prompt,
      streamFile: stream,
      stderrFile: stderr,
    });
    try {
      // A process group whose id is the child's fresh pid exists only if the child leads it (pgid === pid).
      expect(() => process.kill(-worker.pid, 0)).not.toThrow();
      if (psRuns) {
        const table = parsePs(readPs());
        expect(table.find((r) => r.pid === worker.pid)?.pgid).toBe(worker.pid);
        expect(table.find((r) => r.pid === process.pid)?.pgid).not.toBe(worker.pid);
      }
      expect(await worker.exited).toEqual({ code: 3, signal: null });
    } finally {
      sendSignal(-worker.pid, "SIGKILL");
    }
    const echoed = JSON.parse(readFileSync(stream, "utf8")) as { input: string; cwd: string; env: string };
    expect(echoed.input).toBe("hello worker");
    expect(echoed.cwd).toMatch(/arbab-spawn-/);
    expect(echoed.env).toBe("yes");
    expect(readFileSync(stderr, "utf8")).toBe("to stderr\n");
  });

  it("reports a signal exit", async () => {
    writeFileSync(prompt, "");
    const worker = spawnWorker({
      binary: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: dir,
      env: {},
      promptFile: prompt,
      streamFile: stream,
      stderrFile: stderr,
    });
    sendSignal(-worker.pid, "SIGTERM");
    expect(await worker.exited).toEqual({ code: null, signal: "SIGTERM" });
  });

  it("never overwrites an existing stream or stderr file", () => {
    let spawned = false;
    const spawnImpl: SpawnImpl = () => {
      spawned = true;
      throw new Error("must not spawn");
    };
    writeFileSync(stream, "earlier attempt");
    const input = { binary: "x", args: [], cwd: dir, env: {}, promptFile: prompt, streamFile: stream, stderrFile: stderr, spawnImpl };
    expect(() => spawnWorker(input)).toThrow(/already exists/);
    expect(readFileSync(stream, "utf8")).toBe("earlier attempt");
    expect(existsSync(stderr)).toBe(false);

    rmSync(stream);
    writeFileSync(stderr, "earlier");
    expect(() => spawnWorker(input)).toThrow(ArbabError);
    expect(spawned).toBe(false);
  });

  it("fails on a missing prompt file", () => {
    rmSync(prompt);
    const input = { binary: "x", args: [], cwd: dir, env: {}, promptFile: prompt, streamFile: stream, stderrFile: stderr };
    expect(() => spawnWorker(input)).toThrow(ArbabError);
    expect(existsSync(stream)).toBe(false);
  });

  it("passes detached stdio descriptors and closes the parent's copies", async () => {
    let seen: SpawnOptions | null = null;
    const child = Object.assign(new EventEmitter(), { pid: 4242 });
    const spawnImpl: SpawnImpl = (_cmd, _args, options) => {
      seen = options;
      return child as unknown as ChildProcess;
    };
    const worker = spawnWorker({ binary: "claude", args: ["-p"], cwd: dir, env: {}, promptFile: prompt, streamFile: stream, stderrFile: stderr, spawnImpl });
    expect(worker.pid).toBe(4242);
    const options = seen as SpawnOptions | null;
    expect(options?.detached).toBe(true);
    expect(options?.cwd).toBe(dir);
    const fds = options?.stdio as number[];
    expect(fds).toHaveLength(3);
    for (const fd of fds) expect(() => fstatSync(fd)).toThrow();
    child.emit("exit", 0, null);
    expect(await worker.exited).toEqual({ code: 0, signal: null });
  });

  it("throws a runtime error when the binary cannot start", async () => {
    const input = {
      binary: join(dir, "no-such-binary"),
      args: [],
      cwd: dir,
      env: {},
      promptFile: prompt,
      streamFile: stream,
      stderrFile: stderr,
    };
    expect(() => spawnWorker(input)).toThrow(/cannot start/);
    // Let the child's error event fire; it must not surface as an unhandled error.
    await new Promise((done) => setTimeout(done, 50));
  });
});
