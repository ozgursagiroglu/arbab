import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { isAlive } from "../util/proc";
import {
  NOTIFY_TIMEOUT_MS,
  appleScriptString,
  defaultContext,
  makeNotify,
  makeReadStdin,
  makeSpawnShepherd,
  shepherdArgv,
  type NotifyExec,
} from "./context";
import { makeProject, type TestProject } from "./testkit";

let p: TestProject;
afterEach(() => p?.dispose());

async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await new Promise((done) => setTimeout(done, 20));
  }
}

describe("shepherdArgv", () => {
  it("passes root, lane and the mode as JSON after __shepherd", () => {
    expect(shepherdArgv("/s.mjs", "/r", "demo", { kind: "resume", promptFile: "/r/p.md" })).toEqual([
      "/s.mjs",
      "__shepherd",
      "/r",
      "demo",
      '{"kind":"resume","promptFile":"/r/p.md"}',
    ]);
  });
});

describe("makeSpawnShepherd", () => {
  it("starts the script detached with the shepherd argv and appends its output to shepherd.log", async () => {
    p = makeProject();
    const script = join(p.dir, "fake-arbab.mjs");
    const record = join(p.dir, "argv.json");
    writeFileSync(
      script,
      [
        'import { writeFileSync } from "node:fs";',
        `writeFileSync(${JSON.stringify(record)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));`,
        'console.log("shepherd says hi");',
      ].join("\n"),
    );
    const spawn = makeSpawnShepherd(process.execPath, script, process.env);
    const pid = spawn(p.root, "demo", { kind: "start" });
    expect(pid).toBeGreaterThan(1);
    const log = join(p.runsRoot, "demo", "shepherd.log");
    await until(() => existsSync(record) && existsSync(log) && readFileSync(log, "utf8").includes("hi") && !isAlive(pid));
    expect(JSON.parse(readFileSync(record, "utf8"))).toEqual({ argv: ["__shepherd", p.root, "demo", '{"kind":"start"}'], cwd: p.root });
    expect(readFileSync(log, "utf8")).toBe("shepherd says hi\n");
  });
});

describe("appleScriptString", () => {
  it("quotes and escapes backslashes and double quotes", () => {
    expect(appleScriptString("plain")).toBe('"plain"');
    expect(appleScriptString('say "hi"')).toBe('"say \\"hi\\""');
    expect(appleScriptString("a\\b")).toBe('"a\\\\b"');
    expect(appleScriptString('\\"')).toBe('"\\\\\\""');
  });
});

describe("makeNotify", () => {
  type Call = { file: string; args: string[]; timeout: number };
  function fakeExec(result: Error | null | "throw"): { calls: Call[]; exec: NotifyExec } {
    const calls: Call[] = [];
    const exec: NotifyExec = (file, args, opts, done) => {
      calls.push({ file, args, timeout: opts.timeout });
      if (result === "throw") throw new Error("spawn EACCES");
      done(result);
    };
    return { calls, exec };
  }

  it("runs osascript on macOS with an escaped display notification script", async () => {
    const { calls, exec } = fakeExec(null);
    expect(await makeNotify("darwin", exec)('lane "a" done', "ended success\\ok")).toBe(true);
    expect(calls).toEqual([
      {
        file: "osascript",
        args: ["-e", 'display notification "ended success\\\\ok" with title "lane \\"a\\" done"'],
        timeout: NOTIFY_TIMEOUT_MS,
      },
    ]);
    expect(NOTIFY_TIMEOUT_MS).toBe(5000);
  });

  it("runs notify-send on Linux with title and body as arguments", async () => {
    const { calls, exec } = fakeExec(null);
    expect(await makeNotify("linux", exec)("-t", "body; rm -rf x")).toBe(true);
    expect(calls).toEqual([{ file: "notify-send", args: ["--", "-t", "body; rm -rf x"], timeout: 5000 }]);
  });

  it("resolves false on other platforms without running anything", async () => {
    const { calls, exec } = fakeExec(null);
    expect(await makeNotify("win32", exec)("t", "b")).toBe(false);
    expect(calls).toEqual([]);
  });

  it("resolves false when the notifier fails or cannot start, and never throws", async () => {
    expect(await makeNotify("darwin", fakeExec(new Error("exit 1")).exec)("t", "b")).toBe(false);
    expect(await makeNotify("linux", fakeExec("throw").exec)("t", "b")).toBe(false);
  });
});

describe("makeReadStdin", () => {
  it("reads all of a piped stdin as UTF-8", async () => {
    const stream = Readable.from([Buffer.from('{"a":'), Buffer.from('"ü"}')]);
    expect(await makeReadStdin(stream)()).toBe('{"a":"ü"}');
  });

  it("returns an empty string for an empty stdin", async () => {
    expect(await makeReadStdin(Readable.from([]))()).toBe("");
  });

  it("returns an empty string without reading when stdin is a TTY", async () => {
    const stream = Object.assign(new PassThrough(), { isTTY: true });
    expect(await makeReadStdin(stream)()).toBe("");
  });

  it("rejects with an io error when the stream fails", async () => {
    const stream = new PassThrough();
    const read = makeReadStdin(stream)();
    stream.destroy(new Error("boom"));
    await expect(read).rejects.toMatchObject({ code: "io", message: "cannot read stdin: boom" });
  });
});

describe("defaultContext", () => {
  it("builds the real effects without side effects", () => {
    const ctx = defaultContext({ scriptPath: "/x/arbab.mjs", version: "1.2.3" });
    expect(ctx.home.endsWith(".arbab")).toBe(true);
    expect(ctx.claudeHome.endsWith(".claude")).toBe(true);
    expect(ctx.version).toBe("1.2.3");
    expect(ctx.scriptPath).toBe("/x/arbab.mjs");
    expect(typeof ctx.readStdin).toBe("function");
    expect(typeof ctx.notify).toBe("function");
    expect(ctx.pid).toBe(process.pid);
    expect(ctx.alive(process.pid)).toBe(true);
    expect(ctx.runCommand([process.execPath, "-e", "process.stdout.write('ran')"], process.cwd())).toEqual({ code: 0, output: "ran" });
    // ps is setuid on macOS and fails inside a sandbox; then the answer is "no such process", never a throw.
    const command = ctx.processCommand(process.pid);
    if (command !== null) expect(command).toContain("node");
    expect(ctx.processCommand(-1)).toBeNull();
    // Counting listeners instead of emitting, so the test runner's own signal handlers never fire.
    const before = [process.listenerCount("SIGTERM"), process.listenerCount("SIGINT")];
    const untrap = ctx.trapSignals(() => undefined);
    expect([process.listenerCount("SIGTERM"), process.listenerCount("SIGINT")]).toEqual(before.map((n) => n + 1));
    untrap();
    expect([process.listenerCount("SIGTERM"), process.listenerCount("SIGINT")]).toEqual(before);
  });
});
