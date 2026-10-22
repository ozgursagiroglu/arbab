import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkHook, HOOK_MISSING, hookFile } from "./hook";

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "arbab-")));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("hookFile", () => {
  it("is beside dist/ for a bundled runner, and null otherwise", () => {
    expect(hookFile("/p/plugin/dist/arbab.mjs")).toBe("/p/plugin/hooks/hooks.json");
    expect(hookFile("/p/src/cli.ts")).toBeNull();
    expect(hookFile("/p/dist-old/arbab.mjs")).toBeNull();
  });
});

describe("checkHook", () => {
  const script = (): string => join(dir, "plugin", "dist", "arbab.mjs");
  const writeHooks = (text: string): void => {
    mkdirSync(join(dir, "plugin", "hooks"), { recursive: true });
    writeFileSync(join(dir, "plugin", "hooks", "hooks.json"), text);
  };

  it("is ok when hooks.json calls hook pre-tool-use", () => {
    writeHooks(JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "node arbab.mjs hook pre-tool-use" }] }] } }));
    expect(checkHook(script())).toEqual({ status: "ok", check: "hook", detail: join(dir, "plugin", "hooks", "hooks.json") });
  });

  it("warns when hooks.json is missing or has no pre-tool-use hook", () => {
    expect(checkHook(script())).toEqual({ status: "warn", check: "hook", detail: HOOK_MISSING });
    writeHooks(JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "node arbab.mjs hook stop" }] }] } }));
    expect(checkHook(script())?.status).toBe("warn");
  });

  it("skips a runner outside a dist directory", () => {
    expect(checkHook(join(dir, "src", "cli.ts"))).toBeNull();
  });
});
