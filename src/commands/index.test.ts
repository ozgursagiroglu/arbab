import { afterEach, describe, expect, it } from "vitest";
import { ArbabError } from "../util/errors";
import { COMMANDS, HELP, dispatch } from "./index";
import { makeProject, type TestProject } from "./testkit";

let p: TestProject;
afterEach(() => p?.dispose());

describe("dispatch", () => {
  it("prints help for no command, help and --help, listing every command", async () => {
    p = makeProject();
    for (const argv of [[], ["help"], ["--help"], ["-h"], ["status", "--help"]]) {
      p.out.length = 0;
      expect(await dispatch(argv, p.ctx)).toBe(0);
      expect(p.stdout()).toBe(HELP);
    }
    for (const name of Object.keys(COMMANDS).filter((n) => !n.startsWith("__"))) expect(HELP).toContain(`  ${name} `);
  });

  it("prints the version", async () => {
    p = makeProject();
    expect(await dispatch(["--version"], p.ctx)).toBe(0);
    expect(await dispatch(["version"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe("9.9.9\n9.9.9\n");
  });

  it("refuses an unknown command with exit 1", async () => {
    p = makeProject();
    expect(await dispatch(["launhc"], p.ctx)).toBe(1);
    expect(p.stderr()).toMatch(/^arbab: unknown command "launhc"/);
    expect(await dispatch(["toString"], p.ctx)).toBe(1);
  });

  it("maps usage errors (an unknown flag) to exit 1 with a message", async () => {
    p = makeProject();
    expect(await dispatch(["status", "--bogus"], p.ctx)).toBe(1);
    expect(p.stderr()).toMatch(/^arbab status: Unknown option '--bogus'/);
  });

  it("maps runtime errors to exit 2 and lint refusals to 1", async () => {
    p = makeProject();
    p.ctx.runShepherd = async () => {
      throw new ArbabError("runtime", "the shepherd is not implemented yet");
    };
    expect(await dispatch(["__shepherd", p.root, "demo", '{"kind":"start"}'], p.ctx)).toBe(2);
    expect(p.stderr()).toContain("arbab __shepherd: the shepherd is not implemented yet");
    p.write("lanes/bad.json", JSON.stringify({ name: "bad", role: "implementer", brief: "lanes/demo.md", allow: ["Bash"] }));
    expect(await dispatch(["launch", "lanes/bad.json"], p.ctx)).toBe(1);
  });

  it("maps unexpected errors to exit 2", async () => {
    p = makeProject();
    p.ctx.runShepherd = async () => {
      throw new TypeError("oops");
    };
    expect(await dispatch(["__shepherd", p.root, "demo", '{"kind":"start"}'], p.ctx)).toBe(2);
    expect(p.stderr()).toContain("TypeError: oops");
  });

  it("runs a command and returns its status", async () => {
    p = makeProject();
    expect(await dispatch(["lint", "lanes/demo.json"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe("demo: ok\n");
  });
});
