import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArbabError } from "../util/errors";
import { copyInputs, MAX_INPUTS_BYTES } from "./inputs";

// Swapping a source between the walk and the copy needs a step just before copyInputs opens it.
const hooks = vi.hoisted(() => ({ beforeOpen: null as ((path: string) => void) | null }));

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return {
    ...real,
    openSync: (...args: Parameters<typeof real.openSync>): number => {
      hooks.beforeOpen?.(String(args[0]));
      return real.openSync(...args);
    },
  };
});

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
  hooks.beforeOpen = null;
  rmSync(dir, { recursive: true, force: true });
});

const write = (path: string, text = "x"): string => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
};
const copy = (inputs: string[], credentialPaths: string[] = []): string[] =>
  copyInputs({ projectRoot, worktree, inputs, userHome: home, credentialPaths });
const copied = (...parts: string[]): string => join(worktree, ".arbab-tmp", "inputs", ...parts);
const refusal = (inputs: string[], credentialPaths: string[] = []): string => {
  try {
    copy(inputs, credentialPaths);
  } catch (err) {
    expect(err).toBeInstanceOf(ArbabError);
    expect((err as ArbabError).code).toBe("usage");
    return (err as Error).message;
  }
  throw new Error(`copyInputs accepted ${inputs.join(", ")}`);
};
/** Runs `swap` once, just before copyInputs opens the source file `file`. */
const beforeOpening = (file: string, swap: () => void): void => {
  const at = realpathSync(file);
  hooks.beforeOpen = (path) => {
    if (path !== at) return;
    hooks.beforeOpen = null;
    swap();
  };
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

  it("returns nothing for no inputs, and leaves an empty inputs directory", () => {
    expect(copy([])).toEqual([]);
    expect(readdirSync(copied())).toEqual([]);
  });

  it("replaces an earlier copy, leaving nothing of it behind", () => {
    write(join(elsewhere, "notes", "old.txt"));
    copy([join(elsewhere, "notes")]);
    rmSync(join(elsewhere, "notes", "old.txt"));
    write(join(elsewhere, "notes", "new.txt"), "new\n");
    copy([join(elsewhere, "notes")]);
    expect(readdirSync(copied("notes"))).toEqual(["new.txt"]);
  });

  it("drops an input the lane no longer names, and anything else left in the directory", () => {
    const a = write(join(elsewhere, "a.md"));
    const b = write(join(elsewhere, "b.md"));
    copy([a, b]);
    write(copied("stray.txt"));
    expect(copy([a])).toEqual(["a.md"]);
    expect(readdirSync(copied())).toEqual(["a.md"]);
    expect(copy([])).toEqual([]);
    expect(readdirSync(copied())).toEqual([]);
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

  describe("links a worker planted under .arbab-tmp", () => {
    // What a link pointed at: it must survive the copy untouched.
    const victim = (): string => {
      write(join(dir, "victim", "keep.txt"), "keep\n");
      write(join(dir, "victim", "inputs", "spec.md"), "victim's\n");
      return join(dir, "victim");
    };
    const untouched = (target: string): void => {
      expect(readFileSync(join(target, "keep.txt"), "utf8")).toBe("keep\n");
      expect(readFileSync(join(target, "inputs", "spec.md"), "utf8")).toBe("victim's\n");
      expect(readdirSync(target).sort()).toEqual(["inputs", "keep.txt"]);
    };
    const landed = (): void => {
      expect(lstatSync(join(worktree, ".arbab-tmp")).isDirectory()).toBe(true);
      expect(lstatSync(copied()).isDirectory()).toBe(true);
      expect(readFileSync(copied("spec.md"), "utf8")).toBe("spec\n");
    };

    it("replaces a link at .arbab-tmp", () => {
      const target = victim();
      symlinkSync(target, join(worktree, ".arbab-tmp"));
      copy([write(join(elsewhere, "spec.md"), "spec\n")]);
      landed();
      untouched(target);
    });

    it("replaces a link at .arbab-tmp/inputs", () => {
      const target = victim();
      mkdirSync(join(worktree, ".arbab-tmp"));
      symlinkSync(join(target, "inputs"), copied());
      copy([write(join(elsewhere, "spec.md"), "spec\n")]);
      landed();
      untouched(target);
    });

    it("removes links inside inputs without following them", () => {
      const target = victim();
      mkdirSync(copied(), { recursive: true });
      symlinkSync(join(target, "inputs", "spec.md"), copied("spec.md"));
      symlinkSync(target, copied("notes"));
      write(join(elsewhere, "notes", "keep.txt"), "mine\n");
      copy([write(join(elsewhere, "spec.md"), "spec\n"), join(elsewhere, "notes")]);
      landed();
      expect(readFileSync(copied("notes", "keep.txt"), "utf8")).toBe("mine\n");
      untouched(target);
    });
  });

  describe("a source that changes between the walk and the copy", () => {
    it("is refused when the file is another inode", () => {
      const spec = write(join(elsewhere, "spec.md"), "spec\n");
      beforeOpening(spec, () => {
        // Written beside it first, so the new file cannot reuse the old inode.
        write(`${spec}.new`, "swapped\n");
        renameSync(`${spec}.new`, spec);
      });
      expect(refusal([spec])).toMatch(/^input .*spec\.md changed while it was copied \(spec\.md is another file\)/);
      expect(existsSync(copied("spec.md"))).toBe(false);
    });

    it("is refused when the file became a link", () => {
      const spec = write(join(elsewhere, "spec.md"), "spec\n");
      const secret = write(join(dir, "secret.txt"), "secret\n");
      beforeOpening(spec, () => {
        rmSync(spec);
        symlinkSync(secret, spec);
      });
      expect(refusal([spec])).toMatch(/changed while it was copied \(spec\.md is now a link\)/);
    });

    it("is refused when a directory of the input became a link", () => {
      const first = write(join(elsewhere, "bundle", "a.txt"));
      write(join(elsewhere, "bundle", "sub", "b.txt"));
      write(join(dir, "other", "b.txt"), "other\n");
      beforeOpening(first, () => {
        renameSync(join(elsewhere, "bundle", "sub"), join(elsewhere, "bundle", "sub-old"));
        symlinkSync(join(dir, "other"), join(elsewhere, "bundle", "sub"));
      });
      expect(refusal([join(elsewhere, "bundle")])).toMatch(/changed while it was copied \(sub\/b\.txt moved\)/);
      expect(existsSync(copied("bundle", "sub", "b.txt"))).toBe(false);
    });
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

  it.each([".pypirc", ".claude.json", ".npmrc", ".netrc", ".git-credentials"])("refuses the credential file ~/%s", (name) => {
    write(join(home, name));
    expect(refusal([`~/${name}`])).toMatch(new RegExp(`is the credential file ~/${name.replace(/\./g, "\\.")}$`));
  });

  it("refuses a home credential directory spelled in another case", () => {
    // Spelled so on disk too, so the test means the same on a file system that does not ignore case.
    write(join(home, ".AWS", "credentials"));
    write(join(home, "LIBRARY", "Prefs", "app.plist"));
    expect(refusal(["~/.AWS/credentials"])).toMatch(/is under ~\/\.aws, where credentials live$/);
    expect(refusal([join(home, ".AWS")])).toMatch(/is under ~\/\.aws, where credentials live$/);
    expect(refusal(["~/LIBRARY/Prefs"])).toMatch(/is under ~\/Library, where credentials live$/);
    symlinkSync(join(home, ".AWS"), join(elsewhere, "cloud"));
    expect(refusal([join(elsewhere, "cloud", "credentials")])).toMatch(/is under ~\/\.aws/);
  });

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

  it.each([".env", ".env.local", "server.pem", "tls.key", "cert.p12", "cert.pfx", "id_rsa", "id_rsa.pub", "id_ed25519", "prod.tfstate"])(
    "refuses a file named like a credential (%s), alone or inside a directory",
    (name) => {
      const file = write(join(elsewhere, "bundle", "nested", name));
      expect(refusal([file])).toMatch(/named like a credential file/);
      expect(refusal([join(elsewhere, "bundle")])).toMatch(new RegExp(`holds nested/${name.replace(/\./g, "\\.")}, named like a credential file`));
      expect(existsSync(copied("bundle"))).toBe(false);
    },
  );

  it("refuses a path with a directory named like a credential", () => {
    write(join(elsewhere, "app", ".env.d", "notes.md"));
    expect(refusal([join(elsewhere, "app", ".env.d", "notes.md")])).toMatch(/named like a credential file \(\.env\.d\)/);
    expect(refusal([join(elsewhere, "app")])).toMatch(/holds \.env\.d, named like a credential file/);
  });

  it("tests an input inside the project only below its root, one outside on its whole path", () => {
    const app = join(dir, ".envs", "app");
    const inApp = (inputs: string[], credentialPaths: string[] = []): string[] =>
      copyInputs({ projectRoot: app, worktree: join(app, ".arbab", "worktrees", "m1-a"), inputs, userHome: home, credentialPaths });
    const refused = (inputs: string[], credentialPaths: string[] = []): string => {
      try {
        inApp(inputs, credentialPaths);
      } catch (err) {
        expect(err).toBeInstanceOf(ArbabError);
        return (err as Error).message;
      }
      throw new Error(`copyInputs accepted ${inputs.join(", ")}`);
    };
    write(join(app, "docs", "a.md"), "a\n");
    write(join(app, "notes", "b.md"), "b\n");
    write(join(app, ".env"));
    write(join(elsewhere, ".envs", "c.md"));
    mkdirSync(join(app, ".arbab", "worktrees", "m1-a"), { recursive: true });

    expect(inApp(["docs/a.md", join(app, "notes")])).toEqual(["a.md", "notes"]);
    expect(readFileSync(join(app, ".arbab", "worktrees", "m1-a", ".arbab-tmp", "inputs", "a.md"), "utf8")).toBe("a\n");
    // Through the project's real path too.
    expect(inApp([join(realpathSync(app), "docs", "a.md")])).toEqual(["a.md"]);
    // Relative patterns look below the root as well.
    expect(inApp(["docs/a.md"], ["app/**"])).toEqual(["a.md"]);
    expect(refused(["docs/a.md"], ["docs/*.md"])).toMatch(/matches the credential path docs\/\*\.md/);
    expect(refused([".env"])).toMatch(/named like a credential file \(\.env\)/);
    expect(refused([join(elsewhere, ".envs", "c.md")])).toMatch(/named like a credential file \(\.envs\)/);
    expect(refused([join(elsewhere, ".envs")])).toMatch(/named like a credential file \(\.envs\)/);
  });

  it("knows an input inside the project in any spelling the file system takes", () => {
    const app = join(dir, ".envs", "app");
    const lane = join(app, ".arbab", "worktrees", "m1-a");
    const inApp = (inputs: string[]): string[] => copyInputs({ projectRoot: app, worktree: lane, inputs, userHome: home, credentialPaths: [] });
    const refused = (inputs: string[]): string => {
      try {
        inApp(inputs);
      } catch (err) {
        expect(err).toBeInstanceOf(ArbabError);
        return (err as Error).message;
      }
      throw new Error(`copyInputs accepted ${inputs.join(", ")}`);
    };
    write(join(app, "docs", "a.md"), "a\n");
    write(join(app, ".env"));
    write(join(dir, ".envs", "c.md"));
    write(join(dir, ".envs", "app-old", "d.md"));
    mkdirSync(lane, { recursive: true });

    // Only a case-insensitive file system finds another spelling; elsewhere the input is missing and refused anyway.
    if (existsSync(join(app, "DOCS"))) {
      expect(inApp(["DOCS/a.md"])).toEqual(["a.md"]);
      expect(readFileSync(join(lane, ".arbab-tmp", "inputs", "a.md"), "utf8")).toBe("a\n");
      // The project's own part spelled otherwise: still inside it, so `.ENVS` above it does not count.
      expect(inApp(["../APP/DOCS/a.md"])).toEqual(["a.md"]);
      expect(inApp([join(dir, ".ENVS", "App", "docs", "a.md")])).toEqual(["a.md"]);
      expect(refused([".ENV"])).toMatch(/named like a credential file \(\.ENV\)/i);
      expect(refused(["../../.ENVS/c.md"])).toMatch(/named like a credential file \(\.envs\)/i);
    }
    expect(refused([".env"])).toMatch(/named like a credential file \(\.env\)/);
    expect(refused(["../c.md"])).toMatch(/named like a credential file \(\.envs\)/);
    expect(refused([join(dir, ".envs", "c.md")])).toMatch(/named like a credential file \(\.envs\)/);
    // A sibling whose name starts like the project's is outside it.
    expect(refused(["../app-old/d.md"])).toMatch(/named like a credential file \(\.envs\)/);
  });

  describe("config.credentialPaths", () => {
    it("refuses what a ~/dir/** path covers", () => {
      write(join(home, ".vault", "token"));
      expect(refusal(["~/.vault/token"], ["~/.vault/**"])).toMatch(/is under ~\/\.vault, where credentials live/);
      expect(copy(["~/.vault/token"])).toEqual(["token"]);
    });

    it("refuses a file a **/<name> path names, alone or inside a directory", () => {
      write(join(elsewhere, "notes", "db.secret"));
      expect(refusal([join(elsewhere, "notes", "db.secret")], ["**/*.secret"])).toMatch(/named like a credential file \(db\.secret\)/);
      expect(refusal([join(elsewhere, "notes")], ["**/*.secret"])).toMatch(/holds db\.secret, named like a credential file/);
    });

    it("refuses what any other shape matches, by the real path", () => {
      const secrets = join(realpathSync(elsewhere), "vault", "secrets");
      write(join(secrets, "prod.json"));
      write(join(elsewhere, "vault", "readme.md"));
      const rule = `/${secrets}/**`;
      expect(refusal([join(elsewhere, "vault", "secrets", "prod.json")], [rule])).toMatch(`matches the credential path ${rule}`);
      expect(refusal([join(elsewhere, "vault", "secrets")], [rule])).toMatch(`matches the credential path ${rule}`);
      expect(refusal([join(elsewhere, "vault")], [rule])).toMatch(`holds secrets, which matches the credential path ${rule}`);
      expect(refusal([join(elsewhere, "vault", "readme.md")], ["vault/*.md"])).toMatch(/matches the credential path vault\/\*\.md/);
      expect(copy([join(elsewhere, "vault", "readme.md")], [rule])).toEqual(["readme.md"]);
    });
  });

  it("accepts plain documents, in the home directory or elsewhere", () => {
    const names = ["README.md", "env.ts", "keys.json", "pem.txt", "my.npmrc.bak", "rsa.txt", "claude.json.md"];
    for (const name of names) write(join(elsewhere, "docs", name));
    write(join(home, "notes", "spec.md"));
    write(join(home, ".claude-notes.md"));
    expect(copy([join(elsewhere, "docs"), "~/notes", "~/.claude-notes.md"], ["~/.vault/**", "**/*.secret"])).toEqual(["docs", "notes", ".claude-notes.md"]);
    expect(readdirSync(copied("docs")).sort()).toEqual([...names].sort());
  });
});
