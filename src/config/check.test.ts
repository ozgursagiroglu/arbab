import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existingFile } from "./check";

let dir: string;
let root: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arbab-check-"));
  root = join(dir, "repo");
  mkdirSync(root);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const write = (rel: string, text = "x\n"): void => {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
const configError = (message: RegExp) => expect.objectContaining({ code: "config", message: expect.stringMatching(message) });

describe("existingFile", () => {
  it("returns an ordinary file inside the project as written", () => {
    write("lanes/a.md");
    expect(existingFile(root, "lanes/a.md", "brief")).toBe("lanes/a.md");
    expect(existingFile(root, join(root, "lanes", "a.md"), "brief")).toBe(join(root, "lanes", "a.md"));
  });

  it("refuses a missing file, a directory, and one outside the project", () => {
    write("lanes/a.md");
    writeFileSync(join(dir, "outside.md"), "x\n");
    symlinkSync(join(dir, "outside.md"), join(root, "out.md"));
    expect(() => existingFile(root, "lanes/none.md", "brief")).toThrow(configError(/^brief: lanes\/none\.md does not exist$/));
    expect(() => existingFile(root, "lanes", "brief")).toThrow(configError(/^brief: lanes is not a file$/));
    expect(() => existingFile(root, "../outside.md", "brief")).toThrow(configError(/^brief: \.\.\/outside\.md is outside the project$/));
    expect(() => existingFile(root, "out.md", "brief")).toThrow(configError(/^brief: out\.md resolves outside the project$/));
    expect(() => existingFile(root, "", "brief")).toThrow(configError(/^brief: must be a non-empty string$/));
  });

  it("refuses a file named like a credential, in any case, naming the field", () => {
    write(".env.local");
    write("keys/deploy.KEY");
    expect(() => existingFile(root, ".env.local", "brief")).toThrow(
      configError(/^brief: \.env\.local is named like a credential file \(\.env\.local\); its text would go into a worker's prompt$/),
    );
    expect(() => existingFile(root, "keys/deploy.KEY", "phases[0].brief")).toThrow(configError(/^phases\[0\]\.brief: keys\/deploy\.KEY is named like a credential file \(deploy\.KEY\)/));
    // Refused before it is looked for.
    expect(() => existingFile(root, "none.pem", "schema")).toThrow(configError(/^schema: none\.pem is named like a credential file/));
  });

  it("refuses a file a credentialPaths entry hits, by either spelling, and passes one it does not", () => {
    write("vault/brief.md");
    write("notes/db.secret");
    write("lanes/a.md");
    symlinkSync(join(root, "vault", "brief.md"), join(root, "lanes", "link.md"));
    const extra = ["vault/*.md", "**/*.secret"];
    expect(() => existingFile(root, "vault/brief.md", "brief", extra)).toThrow(
      configError(/^brief: vault\/brief\.md matches the credential path vault\/\*\.md; its text would go into a worker's prompt$/),
    );
    expect(() => existingFile(root, "notes/db.secret", "schema", extra)).toThrow(configError(/^schema: notes\/db\.secret is named like a credential file \(db\.secret\)/));
    expect(() => existingFile(root, "lanes/link.md", "instructions[0]", extra)).toThrow(configError(/^instructions\[0\]: lanes\/link\.md resolves to .*vault\/brief\.md, which matches the credential path vault\/\*\.md/));
    expect(existingFile(root, "lanes/a.md", "brief", extra)).toBe("lanes/a.md");
    // Without them, only the built-in list applies.
    expect(existingFile(root, "vault/brief.md", "brief")).toBe("vault/brief.md");
  });

  it("passes a file in a project under a directory named like a credential, and still refuses one inside it", () => {
    for (const parent of [".envs", "x.key"]) {
      const project = join(dir, parent, "app");
      mkdirSync(join(project, "lanes"), { recursive: true });
      writeFileSync(join(project, "lanes", "a.md"), "x\n");
      writeFileSync(join(project, ".env"), "x\n");
      expect(existingFile(project, "lanes/a.md", "brief"), parent).toBe("lanes/a.md");
      expect(existingFile(project, join(project, "lanes", "a.md"), "brief"), parent).toBe(join(project, "lanes", "a.md"));
      expect(() => existingFile(project, ".env", "brief"), parent).toThrow(configError(/^brief: \.env is named like a credential file \(\.env\)/));
      // The project reached through a link: its real path is the root of the real path.
      symlinkSync(project, join(dir, `${parent}-link`));
      expect(existingFile(join(dir, `${parent}-link`), "lanes/a.md", "brief"), parent).toBe("lanes/a.md");
    }
  });

  it("refuses a link inside the project to a credential file", () => {
    write(".env");
    symlinkSync(join(root, ".env"), join(root, "brief.md"));
    expect(() => existingFile(root, "brief.md", "instructions")).toThrow(
      configError(/^instructions: brief\.md resolves to .*\.env, which is named like a credential file \(\.env\); its text would go into a worker's prompt$/),
    );
  });
});
