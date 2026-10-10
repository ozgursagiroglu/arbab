import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isAlive } from "../util/proc";
import { defaultContext, makeSpawnShepherd, shepherdArgv } from "./context";
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

describe("defaultContext", () => {
  it("builds the real effects without side effects", () => {
    const ctx = defaultContext({ scriptPath: "/x/arbab.mjs", version: "1.2.3" });
    expect(ctx.home.endsWith(".arbab")).toBe(true);
    expect(ctx.claudeHome.endsWith(".claude")).toBe(true);
    expect(ctx.version).toBe("1.2.3");
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
