import { afterEach, describe, expect, it } from "vitest";
import { shepherdArgv } from "./context";
import { isShepherdOf, runStop } from "./stop";
import { makeProject, writeLaneRun, type TestProject } from "./testkit";

let p: TestProject;
afterEach(() => p?.dispose());

const PID = 6100;

describe("isShepherdOf", () => {
  it("matches the shepherd argv of the lane", () => {
    const argv = shepherdArgv("/x/dist/arbab.mjs", "/work/repo", "demo", { kind: "start" });
    expect(isShepherdOf(["/usr/bin/node", ...argv].join(" "), "demo")).toBe(true);
  });
  it("rejects another lane, another program and no process", () => {
    const argv = ["/usr/bin/node", ...shepherdArgv("/x/arbab.mjs", "/r", "demo-2", { kind: "start" })].join(" ");
    expect(isShepherdOf(argv, "demo")).toBe(false);
    expect(isShepherdOf("/usr/bin/vim demo", "demo")).toBe(false);
    expect(isShepherdOf(null, "demo")).toBe(false);
  });
});

describe("runStop", () => {
  it("SIGTERMs a live shepherd of the lane", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "running", shepherdPid: PID });
    p.alive.add(PID);
    p.commands.set(PID, `node /x/arbab.mjs __shepherd ${p.root} demo {"kind":"start"}`);
    expect(await runStop(["demo"], p.ctx)).toBe(0);
    expect(p.signals).toEqual([{ target: PID, sig: "SIGTERM" }]);
    expect(p.stdout()).toBe(`stopping demo (shepherd ${PID})\n`);
  });

  it("prints --json", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "held", shepherdPid: PID });
    p.alive.add(PID);
    p.commands.set(PID, `node arbab.mjs __shepherd /r demo {}`);
    expect(await runStop(["--json", "demo"], p.ctx)).toBe(0);
    expect(JSON.parse(p.stdout())).toEqual({ lane: "demo", shepherdPid: PID });
  });

  it("never signals a recycled pid", async () => {
    p = makeProject();
    writeLaneRun(p.runsRoot, "demo", { state: "running", shepherdPid: PID });
    p.alive.add(PID);
    p.commands.set(PID, "/Applications/Some.app/Contents/MacOS/Some --flag");
    await expect(runStop(["demo"], p.ctx)).rejects.toThrow(/no longer its shepherd/);
    expect(p.signals).toEqual([]);
  });

  it("exits 1 when the lane is not running", async () => {
    p = makeProject();
    await expect(runStop(["demo"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    writeLaneRun(p.runsRoot, "demo", { state: "running", shepherdPid: PID });
    await expect(runStop(["demo"], p.ctx)).rejects.toThrow(/not running/);
    writeLaneRun(p.runsRoot, "demo", { state: "finished", shepherdPid: PID });
    p.alive.add(PID);
    await expect(runStop(["demo"], p.ctx)).rejects.toThrow(/finished/);
    expect(p.signals).toEqual([]);
  });

  it("rejects usage errors", async () => {
    p = makeProject();
    await expect(runStop([], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runStop(["a", "b"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runStop(["../demo"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runStop(["demo", "--force"], p.ctx)).rejects.toMatchObject({ code: "usage" });
  });
});
