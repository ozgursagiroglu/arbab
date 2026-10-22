import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArbabError } from "../util/errors";
import { CONFIG_FILE, loadConfig } from "./load";

let dir: string;
let project: string;
let outside: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arbab-load-"));
  project = join(dir, "project");
  outside = join(dir, "outside");
  mkdirSync(project);
  mkdirSync(outside);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeConfig(root: string, config: unknown): void {
  writeFileSync(join(root, CONFIG_FILE), JSON.stringify(config));
}

function configError(root: string, field: string): ArbabError {
  try {
    loadConfig(root);
  } catch (err) {
    expect(err).toBeInstanceOf(ArbabError);
    const e = err as ArbabError;
    expect(e.code).toBe("config");
    expect(e.message).toContain(field);
    return e;
  }
  throw new Error("expected an ArbabError");
}

describe("loadConfig worktreeRoot and runsRoot through symbolic links", () => {
  for (const field of ["worktreeRoot", "runsRoot"] as const) {
    it(`refuses ${field} as a link inside the project to a directory outside it`, () => {
      symlinkSync(outside, join(project, "out"));
      writeConfig(project, { [field]: "out" });
      expect(configError(project, field).message).toContain("out leads outside the project through a symbolic link");
    });

    it(`refuses a not-yet-existing ${field} under a link that leads outside`, () => {
      symlinkSync(outside, join(project, "out"));
      writeConfig(project, { [field]: "out/lanes" });
      expect(configError(project, field).message).toContain("leads outside the project through a symbolic link");
    });

    it(`refuses ${field} as a dangling link`, () => {
      symlinkSync(join(outside, "gone"), join(project, "dangling"));
      writeConfig(project, { [field]: "dangling" });
      configError(project, field);
    });

    it(`accepts ${field} as a link to a directory inside the project`, () => {
      mkdirSync(join(project, "real"));
      symlinkSync(join(project, "real"), join(project, "link"));
      writeConfig(project, { [field]: "link" });
      expect(loadConfig(project)[field]).toBe("link");
    });
  }

  it("accepts a plain worktreeRoot in a project reached through a symbolic link", () => {
    symlinkSync(project, join(dir, "via"));
    const via = join(dir, "via");
    mkdirSync(join(project, "wt"));
    writeConfig(via, { worktreeRoot: "wt", runsRoot: "runs" });
    const config = loadConfig(via);
    expect(config.worktreeRoot).toBe("wt");
    expect(config.runsRoot).toBe("runs");
  });

  it("accepts a worktreeRoot that does not exist yet", () => {
    writeConfig(project, { worktreeRoot: "tmp/deep/wt" });
    expect(loadConfig(project).worktreeRoot).toBe("tmp/deep/wt");
  });
});
