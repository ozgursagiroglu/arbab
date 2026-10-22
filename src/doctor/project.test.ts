import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeProject, type TestProject } from "../commands/testkit";
import { defaultConfig } from "../config";
import { checkConfigFiles, checkIgnored } from "./project";

let p: TestProject;
afterEach(() => p?.dispose());

describe("checkIgnored", () => {
  it("warns until .arbab/ as a whole is ignored", () => {
    p = makeProject();
    expect(checkIgnored(p.git, p.root, defaultConfig())).toEqual({
      status: "warn",
      check: "ignored",
      detail: ".arbab/ not ignored yet (the shepherd adds it to info/exclude on the next launch)",
    });
    // The old entries cover the default roots but not .arbab/ itself.
    writeFileSync(join(p.root, ".git", "info", "exclude"), ".arbab/worktrees/\n.arbab/runs/\n");
    expect(checkIgnored(p.git, p.root, defaultConfig()).status).toBe("warn");
    writeFileSync(join(p.root, ".git", "info", "exclude"), ".arbab/\n");
    expect(checkIgnored(p.git, p.root, defaultConfig())).toEqual({ status: "ok", check: "ignored", detail: ".arbab/ ignored" });
  });

  it("also probes a worktreeRoot moved outside .arbab/", () => {
    p = makeProject();
    const config = { ...defaultConfig(), worktreeRoot: "wt" };
    writeFileSync(join(p.root, ".git", "info", "exclude"), ".arbab/\n");
    expect(checkIgnored(p.git, p.root, config)).toMatchObject({ status: "warn", detail: expect.stringMatching(/^wt\/ not ignored yet/) });
    writeFileSync(join(p.root, ".git", "info", "exclude"), ".arbab/\nwt/\n");
    expect(checkIgnored(p.git, p.root, config)).toMatchObject({ status: "ok", detail: ".arbab/, wt/ ignored" });
  });

  it("names every entry that is not ignored", () => {
    p = makeProject();
    const detail = checkIgnored(p.git, p.root, { ...defaultConfig(), worktreeRoot: "wt" }).detail;
    expect(detail).toBe(".arbab/, wt/ not ignored yet (the shepherd adds them to info/exclude on the next launch)");
  });
});

describe("checkConfigFiles", () => {
  it("warns when both config files exist, and is silent otherwise", () => {
    p = makeProject();
    expect(checkConfigFiles(p.root)).toBeNull();
    p.write(".arbab/config.json", "{}");
    expect(checkConfigFiles(p.root)).toEqual({
      status: "warn",
      check: "configs",
      detail: "both arbab.config.json and .arbab/config.json exist: arbab.config.json wins",
    });
  });
});
