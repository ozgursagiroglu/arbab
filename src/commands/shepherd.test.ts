import { afterEach, describe, expect, it } from "vitest";
import type { ShepherdMode } from "../shepherd";
import { parseMode, runShepherdProcess } from "./shepherd";
import { makeProject, type TestProject } from "./testkit";

let p: TestProject;
afterEach(() => p?.dispose());

describe("parseMode", () => {
  it("accepts the three modes", () => {
    expect(parseMode('{"kind":"start"}')).toEqual({ kind: "start" });
    expect(parseMode('{"kind":"fresh","extra":1}')).toEqual({ kind: "fresh" });
    expect(parseMode('{"kind":"fresh","digestFrom":3}')).toEqual({ kind: "fresh", digestFrom: 3 });
    expect(parseMode('{"kind":"resume"}')).toEqual({ kind: "resume" });
    expect(parseMode('{"kind":"resume","prompt":"go on"}')).toEqual({ kind: "resume", prompt: "go on" });
    expect(parseMode('{"kind":"resume","promptFile":"/r/.arbab/runs/demo/resume-prompt-2.md"}')).toEqual({
      kind: "resume",
      promptFile: "/r/.arbab/runs/demo/resume-prompt-2.md",
    });
  });
  it("rejects anything else", () => {
    for (const bad of [
      "",
      "nope",
      "[]",
      "null",
      '{"kind":"stop"}',
      '{"kind":"resume","prompt":""}',
      '{"kind":"resume","prompt":3}',
      '{"kind":"resume","promptFile":"relative.md"}',
      '{"kind":"resume","promptFile":""}',
      '{"kind":"resume","promptFile":7}',
      '{"kind":"resume","prompt":"go on","promptFile":"/p.md"}',
      '{"kind":"fresh","digestFrom":0}',
      '{"kind":"fresh","digestFrom":1.5}',
      '{"kind":"fresh","digestFrom":"2"}',
      '{"kind":"fresh","digestFrom":null}',
    ]) {
      expect(() => parseMode(bad)).toThrow(/mode/);
    }
  });
});

describe("runShepherdProcess", () => {
  it("runs the shepherd with an abort signal wired to the trapped signals, and exits 0", async () => {
    p = makeProject();
    let trapped: (() => void) | null = null;
    let untrapped = false;
    p.ctx.trapSignals = (handler) => {
      trapped = handler;
      return () => {
        untrapped = true;
      };
    };
    const calls: Array<{ root: string; lane: string; mode: ShepherdMode; aborted: boolean }> = [];
    p.ctx.runShepherd = async (root, lane, mode, _deps, stop) => {
      (trapped as (() => void) | null)?.();
      calls.push({ root, lane, mode, aborted: stop.aborted });
      return "killed:stopped";
    };
    expect(await runShepherdProcess([p.root, "demo", '{"kind":"start"}'], p.ctx)).toBe(0);
    expect(calls).toEqual([{ root: p.root, lane: "demo", mode: { kind: "start" }, aborted: true }]);
    expect(untrapped).toBe(true);
    expect(p.stdout()).toBe("demo: killed:stopped\n");
  });

  it("lets a shepherd failure through (exit 2 in the dispatcher) and still removes the trap", async () => {
    p = makeProject();
    let untrapped = false;
    p.ctx.trapSignals = () => () => {
      untrapped = true;
    };
    p.ctx.runShepherd = async () => {
      throw new Error("boom");
    };
    await expect(runShepherdProcess([p.root, "demo", '{"kind":"fresh"}'], p.ctx)).rejects.toThrow("boom");
    expect(untrapped).toBe(true);
  });

  it("rejects bad arguments", async () => {
    p = makeProject();
    await expect(runShepherdProcess([], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runShepherdProcess(["relative", "demo", '{"kind":"start"}'], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runShepherdProcess([p.root, "../x", '{"kind":"start"}'], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runShepherdProcess([p.root, "demo", "{}"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runShepherdProcess([p.root, "demo", '{"kind":"start"}', "x"], p.ctx)).rejects.toMatchObject({ code: "usage" });
  });
});
