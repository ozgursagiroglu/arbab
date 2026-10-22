import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

    it(`refuses ${field} as a link to the project root, even reached through a link`, () => {
      symlinkSync(project, join(project, "self"));
      writeConfig(project, { [field]: "self" });
      expect(configError(project, field).message).toContain(`${field}: must not be the project root`);
      writeConfig(project, { [field]: "self/" });
      expect(configError(project, field).message).toContain(`${field}: must not be the project root`);
      symlinkSync(project, join(dir, "via"));
      writeConfig(join(dir, "via"), { [field]: "self" });
      expect(configError(join(dir, "via"), field).message).toContain(`${field}: must not be the project root`);
    });

    it(`refuses ${field} as a link into or over the integration records`, () => {
      mkdirSync(join(project, ".arbab", "integrations", "m1"), { recursive: true });
      symlinkSync(join(project, ".arbab", "integrations"), join(project, "recs"));
      symlinkSync(join(project, ".arbab", "integrations", "m1"), join(project, "m1"));
      symlinkSync(join(project, ".arbab"), join(project, "state"));
      for (const value of ["recs", "recs/lanes", "m1", "state"]) {
        writeConfig(project, { [field]: value });
        expect(configError(project, field).message, value).toContain(`${field}: must not overlap .arbab/integrations, where integration records live`);
      }
      // A link to elsewhere under .arbab is fine.
      mkdirSync(join(project, ".arbab", "pool"));
      symlinkSync(join(project, ".arbab", "pool"), join(project, "pool"));
      writeConfig(project, { [field]: "pool" });
      expect(loadConfig(project)[field]).toBe("pool");
    });

    it(`refuses ${field} under a link to .arbab when the records do not exist yet`, () => {
      mkdirSync(join(project, ".arbab"));
      symlinkSync(join(project, ".arbab"), join(project, "state"));
      writeConfig(project, { [field]: "state/integrations/x" });
      expect(configError(project, field).message).toContain("must not overlap .arbab/integrations");
      writeConfig(project, { [field]: "state/pool" });
      expect(loadConfig(project)[field]).toBe("state/pool");
    });

    it(`refuses ${field} spelling the project root or the integration records in another case`, () => {
      for (const value of [".ARBAB/Integrations/x", ".Arbab/INTEGRATIONS", ".ARBAB"]) {
        writeConfig(project, { [field]: value });
        expect(configError(project, field).message, value).toContain(`${field}: must not overlap .arbab/integrations, where integration records live`);
      }
      mkdirSync(join(project, ".arbab", "integrations"), { recursive: true });
      writeConfig(project, { [field]: ".ARBAB/Integrations/x" });
      expect(configError(project, field).message).toContain("must not overlap .arbab/integrations");
    });

    it(`refuses ${field} spelling the integration records as APFS folds them`, () => {
      // ſ (U+017F) is s to APFS, but toLowerCase keeps it.
      for (const value of [".arbab/integrationſ", ".arbab/integrationſ/x", ".ARBAB/INTEGRATIONſ"]) {
        writeConfig(project, { [field]: value });
        expect(configError(project, field).message, value).toContain(`${field}: must not overlap .arbab/integrations`);
      }
      mkdirSync(join(project, ".arbab", "integrations"), { recursive: true });
      writeConfig(project, { [field]: ".arbab/integrationſ" });
      expect(configError(project, field).message).toContain("must not overlap .arbab/integrations");
    });

    it(`refuses ${field} as a link whose target spells the records or the root in another case`, () => {
      mkdirSync(join(project, ".arbab", "integrations"), { recursive: true });
      // Only a case-insensitive file system resolves another spelling; elsewhere the link dangles and is refused anyway.
      const caseInsensitive = existsSync(join(project, ".ARBAB", "INTEGRATIONS"));
      symlinkSync(join(project, ".ARBAB", "INTEGRATIONS"), join(project, "recs"));
      for (const value of ["recs", "recs/lanes"]) {
        writeConfig(project, { [field]: value });
        const message = configError(project, field).message;
        if (caseInsensitive) expect(message, value).toContain("must not overlap .arbab/integrations");
      }
      symlinkSync(join(dir, "PROJECT"), join(project, "self"));
      writeConfig(project, { [field]: "self" });
      const message = configError(project, field).message;
      if (caseInsensitive) expect(message).toContain(`${field}: must not be the project root`);
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

describe("loadConfig instructions and credentialPaths", () => {
  it("refuses an instructions file a credentialPaths entry hits, wherever the key sits", () => {
    mkdirSync(join(project, "vault"));
    writeFileSync(join(project, "vault", "rules.md"), "# Rules\n");
    writeFileSync(join(project, "RULES.md"), "# Rules\n");
    writeConfig(project, { instructions: ["RULES.md", "vault/rules.md"], credentialPaths: ["vault/**"] });
    expect(configError(project, "instructions[1]").message).toContain("vault/rules.md matches the credential path vault/**");
    writeConfig(project, { credentialPaths: ["vault/**"], instructions: ["RULES.md"] });
    expect(loadConfig(project).instructions).toEqual(["RULES.md"]);
    writeConfig(project, { instructions: ["vault/rules.md"] });
    expect(loadConfig(project).instructions).toEqual(["vault/rules.md"]);
  });
});
