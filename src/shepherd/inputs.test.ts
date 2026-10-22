import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArbabError } from "../util/errors";
import { copyInputs, isCredentialName, MAX_INPUTS_BYTES } from "./inputs";

let dir: string;
let home: string;
let projectRoot: string;
let worktree: string;
let elsewhere: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "arbab-inputs-"));
  home = join(dir, "home");
  projectRoot = join(dir, "repo");
  worktree = join(projectRoot, ".arbab", "worktrees", "m1-a");
  elsewhere = join(dir, "elsewhere");
  for (const d of [home, worktree, elsewhere]) mkdirSync(d, { recursive: true });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const write = (path: string, text = "x"): string => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
};
const copy = (inputs: string[]): string[] => copyInputs({ projectRoot, worktree, inputs, userHome: home });
const copied = (...parts: string[]): string => join(worktree, ".arbab-tmp", "inputs", ...parts);
const refusal = (inputs: string[]): string => {
  try {
    copy(inputs);
  } catch (err) {
    expect(err).toBeInstanceOf(ArbabError);
    expect((err as ArbabError).code).toBe("usage");
    return (err as Error).message;
  }
  throw new Error(`copyInputs accepted ${inputs.join(", ")}`);
};

describe("copyInputs", () => {
  it("copies absolute, ~/ and project-relative files and directories, by name", () => {
    write(join(elsewhere, "spec.md"), "spec\n");
    write(join(home, "notes", "a.txt"), "a\n");
    write(join(home, "notes", "deep", "b.txt"), "b\n");
    write(join(projectRoot, "docs", "plan.md"), "plan\n");

    expect(copy([join(elsewhere, "spec.md"), "~/notes", "docs/plan.md"])).toEqual(["spec.md", "notes", "plan.md"]);
    expect(readFileSync(copied("spec.md"), "utf8")).toBe("spec\n");
    expect(readFileSync(copied("notes", "a.txt"), "utf8")).toBe("a\n");
    expect(readFileSync(copied("notes", "deep", "b.txt"), "utf8")).toBe("b\n");
    expect(readFileSync(copied("plan.md"), "utf8")).toBe("plan\n");
  });

  it("returns nothing for no inputs", () => {
    expect(copy([])).toEqual([]);
  });

  it("replaces an earlier copy, leaving nothing of it behind", () => {
    write(join(elsewhere, "notes", "old.txt"));
    copy([join(elsewhere, "notes")]);
    rmSync(join(elsewhere, "notes", "old.txt"));
    write(join(elsewhere, "notes", "new.txt"), "new\n");
    copy([join(elsewhere, "notes")]);
    expect(readdirSync(copied("notes"))).toEqual(["new.txt"]);
  });

  it("keeps a file's permission bits", () => {
    const script = write(join(elsewhere, "run.sh"), "#!/bin/sh\n");
    chmodSync(script, 0o755);
    copy([script]);
    expect(statSync(copied("run.sh")).mode & 0o777).toBe(0o755);
  });

  it("refuses a missing input, naming it", () => {
    expect(refusal(["docs/none.md"])).toMatch(/^input docs\/none\.md does not exist/);
  });

  it("refuses two inputs with the same name, copying neither", () => {
    write(join(elsewhere, "a", "spec.md"));
    write(join(elsewhere, "b", "spec.md"));
    expect(refusal([join(elsewhere, "a", "spec.md"), join(elsewhere, "b", "spec.md")])).toMatch(/same name \(spec\.md\)/);
    expect(existsSync(copied("spec.md"))).toBe(false);
  });

  it("refuses an input that is a symbolic link, and skips links inside a directory", () => {
    const target = write(join(elsewhere, "target.txt"), "target\n");
    symlinkSync(target, join(elsewhere, "link.txt"));
    expect(refusal([join(elsewhere, "link.txt")])).toMatch(/is a symbolic link/);

    write(join(elsewhere, "notes", "real.txt"));
    symlinkSync(target, join(elsewhere, "notes", "file-link"));
    symlinkSync(join(home), join(elsewhere, "notes", "dir-link"));
    copy([join(elsewhere, "notes")]);
    expect(readdirSync(copied("notes"))).toEqual(["real.txt"]);
  });

  it("refuses ~user and inputs without a name", () => {
    expect(refusal(["~root/x"])).toMatch(/another user's home/);
    expect(refusal(["/"])).toMatch(/no name/);
  });

  it("refuses more than 50 MB in one input or across inputs, copying nothing", () => {
    const big = write(join(elsewhere, "big.bin"), "");
    truncateSync(big, MAX_INPUTS_BYTES + 1);
    expect(refusal([big])).toMatch(/big\.bin brings the inputs over 50 MB/);

    const half = MAX_INPUTS_BYTES / 2 + 1;
    const a = write(join(elsewhere, "a.bin"), "");
    truncateSync(a, half);
    const b = write(join(elsewhere, "parts", "b.bin"), "");
    truncateSync(b, half);
    expect(refusal([a, join(elsewhere, "parts")])).toMatch(/^input .*parts brings the inputs over 50 MB/);
    expect(existsSync(copied("a.bin"))).toBe(false);
  });

  it("accepts exactly 50 MB", () => {
    const file = write(join(elsewhere, "edge.bin"), "");
    truncateSync(file, MAX_INPUTS_BYTES);
    expect(copy([file])).toEqual(["edge.bin"]);
    expect(statSync(copied("edge.bin")).size).toBe(MAX_INPUTS_BYTES);
  });

  it.each([".ssh", ".aws", ".azure", ".config", ".docker", ".kube", ".gnupg", ".claude", "Library"])(
    "refuses anything under ~/%s",
    (cred) => {
      write(join(home, cred, "sub", "file.txt"));
      expect(refusal([`~/${cred}/sub/file.txt`])).toMatch(new RegExp(`is under ~/${cred.replace(".", "\\.")}, where credentials live`));
      expect(refusal([join(home, cred)])).toMatch(/where credentials live/);
      // A directory holding one is refused too.
      expect(refusal([`~/${cred}/sub`])).toMatch(/where credentials live/);
    },
  );

  it("refuses a credential location reached through a link in the path", () => {
    write(join(home, ".ssh", "config"));
    symlinkSync(join(home, ".ssh"), join(elsewhere, "keys"));
    expect(refusal([join(elsewhere, "keys", "config")])).toMatch(/under ~\/\.ssh/);
  });

  it("refuses a directory that holds the home directory or the worktree", () => {
    write(join(home, "notes.txt"));
    expect(refusal([dir])).toMatch(/holds the home directory/);
    expect(refusal(["."])).toMatch(/holds the worktree/);
  });

  it.each([".env", ".env.local", "server.pem", "tls.key", "cert.p12", "cert.pfx", "id_rsa", "id_rsa.pub", "id_ed25519", "prod.tfstate", ".npmrc", ".netrc", ".git-credentials"])(
    "refuses a file named like a credential (%s), alone or inside a directory",
    (name) => {
      const file = write(join(elsewhere, "bundle", "nested", name));
      expect(refusal([file])).toMatch(/named like a credential file/);
      expect(refusal([join(elsewhere, "bundle")])).toMatch(new RegExp(`holds nested/${name.replace(/\./g, "\\.")}, named like a credential file`));
      expect(existsSync(copied("bundle"))).toBe(false);
    },
  );

  it("tells credential names from ordinary ones", () => {
    for (const name of ["README.md", "env.ts", "keys.json", "pem.txt", "my.npmrc.bak", "rsa.txt"]) expect(isCredentialName(name), name).toBe(false);
  });
});
