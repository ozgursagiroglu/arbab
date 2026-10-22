import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { credentialMatcher, credentialReason, homeSpellings } from "./credentials";

const HOME = "/home/u";
const match = credentialMatcher([], [HOME]);

describe("credentialMatcher", () => {
  it("hits what is under a home credential directory, and the directory itself", () => {
    expect(match("/home/u/.ssh/id_ed25519.txt")).toEqual({ kind: "dir", label: "~/.ssh" });
    expect(match("/home/u/.aws")).toEqual({ kind: "dir", label: "~/.aws" });
    expect(match("/home/u/Library/Keychains/login.db")).toEqual({ kind: "dir", label: "~/Library/Keychains" });
    expect(match("/home/u/Library/Mail/x")).toBeNull();
    expect(match("/home/u/.sshd/x")).toBeNull();
  });

  it("hits a home credential file, and nothing named like it elsewhere", () => {
    expect(match("/home/u/.netrc")).toEqual({ kind: "file", label: "~/.netrc" });
    expect(match("/home/u/.claude.json")).toEqual({ kind: "file", label: "~/.claude.json" });
    expect(match("/home/u/.claude.json.md")).toBeNull();
    expect(match("/srv/.netrc")).toBeNull();
  });

  it("hits a path with a component named like a credential file, naming the component", () => {
    for (const name of [".env", ".env.local", "server.pem", "tls.key", "c.p12", "c.pfx", "id_rsa", "id_rsa.pub", "id_ed25519", "prod.tfstate"]) {
      expect(match(`/srv/app/${name}`), name).toEqual({ kind: "name", label: name });
    }
    expect(match("/srv/.env.d/notes.md")).toEqual({ kind: "name", label: ".env.d" });
    for (const name of ["env.ts", "keys.json", "pem.txt", "rsa.txt", "my.npmrc.bak"]) expect(match(`/srv/app/${name}`), name).toBeNull();
  });

  it("ignores case, in home rules, names and the home itself", () => {
    expect(match("/home/u/.AWS/credentials")).toEqual({ kind: "dir", label: "~/.aws" });
    expect(match("/HOME/U/.ssh/config")).toEqual({ kind: "dir", label: "~/.ssh" });
    expect(match("/home/u/.NETRC")).toEqual({ kind: "file", label: "~/.netrc" });
    expect(match("/srv/KEY.PEM")).toEqual({ kind: "name", label: "KEY.PEM" });
    expect(match("/srv/.ENV")).toEqual({ kind: "name", label: ".ENV" });
    expect(match("/srv/.Env.local")).toEqual({ kind: "name", label: ".Env.local" });
    expect(match("/srv/ID_RSA")).toEqual({ kind: "name", label: "ID_RSA" });
    expect(match("/srv/deploy.KEY")).toEqual({ kind: "name", label: "deploy.KEY" });
  });

  it("folds as APFS does: ſ, the Kelvin sign and NFC against NFD", () => {
    // ſ (U+017F) is s and U+212A is K to APFS; toLowerCase keeps both.
    expect(match("/home/u/.awſ/credentials")).toEqual({ kind: "dir", label: "~/.aws" });
    expect(match("/srv/tls.KEY")).toEqual({ kind: "name", label: "tls.KEY" });
    const m = credentialMatcher(["//srv/café/**", "**/*.résumé", "~/café/*.txt"], [HOME]);
    expect(m("/srv/café/menu.txt")).toEqual({ kind: "pattern", label: "//srv/café/**" });
    expect(m("/srv/a/me.RÉSUMÉ")).toEqual({ kind: "name", label: "me.RÉSUMÉ" });
    expect(m("/home/u/CAFÉ/a.txt")).toEqual({ kind: "pattern", label: "~/café/*.txt" });
    // A root spelled otherwise is still the root.
    expect(match("/work/x.key/app/notes.txt", "/WORK/X.KEY/APP")).toBeNull();
  });

  it("keeps `?` one character: ß is not folded to ss in a pattern or a path", () => {
    const m = credentialMatcher(["**/stra?e.txt", "//srv/?/**", "~/gr?/*.txt", "notes/ma?.md"], [HOME]);
    expect(m("/srv/app/straße.txt")).toEqual({ kind: "name", label: "straße.txt" });
    expect(m("/srv/app/STRAßE.TXT")).toEqual({ kind: "name", label: "STRAßE.TXT" });
    expect(m("/srv/ß/x")).toEqual({ kind: "pattern", label: "//srv/?/**" });
    expect(m("/home/u/grß/a.txt")).toEqual({ kind: "pattern", label: "~/gr?/*.txt" });
    expect(m("/a/notes/maß.md")).toEqual({ kind: "pattern", label: "notes/ma?.md" });
    // Two characters are not one.
    expect(m("/srv/app/strasse.txt")).toBeNull();
    // A pattern's own ß is itself, case ignored.
    expect(credentialMatcher(["**/maß.token"], [HOME])("/srv/MAß.TOKEN")).toEqual({ kind: "name", label: "MAß.TOKEN" });
  });

  it("adds `extra` rules of every shape, case ignored", () => {
    const m = credentialMatcher(["~/.vault/**", "**/*.secret", "//srv/secrets/**", "vault/*.md", "~/notes/*.txt"], [HOME]);
    expect(m("/home/u/.Vault/token")).toEqual({ kind: "dir", label: "~/.vault" });
    expect(m("/srv/app/DB.Secret")).toEqual({ kind: "name", label: "DB.Secret" });
    expect(m("/srv/Secrets/prod.json")).toEqual({ kind: "pattern", label: "//srv/secrets/**" });
    expect(m("/srv/secrets")).toEqual({ kind: "pattern", label: "//srv/secrets/**" });
    expect(m("/a/b/VAULT/readme.md")).toEqual({ kind: "pattern", label: "vault/*.md" });
    expect(m("/a/b/vault/deep/readme.md")).toBeNull();
    expect(m("/home/u/notes/a.TXT")).toEqual({ kind: "pattern", label: "~/notes/*.txt" });
    expect(m("/home/u/notes/deep/a.txt")).toBeNull();
    expect(match("/srv/app/db.secret")).toBeNull();
  });

  it("checks every home spelling given", () => {
    const m = credentialMatcher([], ["/home/u", "/data/homes/u/"]);
    expect(m("/data/homes/u/.ssh/config")).toEqual({ kind: "dir", label: "~/.ssh" });
    expect(m("/home/u/.ssh/config")).toEqual({ kind: "dir", label: "~/.ssh" });
  });

  it("given a root, tests the name rules and relative patterns only below it, and every other rule as before", () => {
    const m = credentialMatcher(["//work/.envs/**", "app/*.md"], [HOME]);
    // Any spelling of the root, case and a trailing separator aside.
    for (const root of ["/work/x.key/app", "/work/x.KEY/app/", "/WORK/X.KEY/APP"]) {
      expect(m("/work/x.key/app/lanes/brief.txt", root), root).toBeNull();
    }
    expect(m("/work/.envs/app/lanes/brief.txt", "/work/.envs/app")).toEqual({ kind: "pattern", label: "//work/.envs/**" });
    expect(credentialMatcher([], [])("/work/.envs/app/lanes/brief.txt", "/work/.envs/app")).toBeNull();
    expect(m("/work/x.key/app/.env", "/work/x.key/app")).toEqual({ kind: "name", label: ".env" });
    expect(m("/work/x.key/app/sub/tls.pem/notes.txt", "/work/x.key/app")).toEqual({ kind: "name", label: "tls.pem" });
    // The root itself has no component below it.
    expect(m("/work/x.key/app", "/work/x.key/app")).toBeNull();
    // Without a root, or outside it, every component counts.
    expect(m("/work/x.key/app/lanes/brief.txt")).toEqual({ kind: "name", label: "x.key" });
    expect(m("/work/x.key/other/brief.txt", "/work/x.key/app")).toEqual({ kind: "name", label: "x.key" });
    expect(m("/work/x.key/app-old/brief.txt", "/work/x.key/app")).toEqual({ kind: "name", label: "x.key" });
    // A relative pattern looks below the root, as the pattern is written there.
    expect(m("/srv/app/readme.md", "/srv/app")).toBeNull();
    expect(m("/srv/app/app/readme.md", "/srv/app")).toEqual({ kind: "pattern", label: "app/*.md" });
    expect(m("/srv/app/sub/APP/readme.md", "/SRV/App/")).toEqual({ kind: "pattern", label: "app/*.md" });
    expect(m("/srv/app/readme.md")).toEqual({ kind: "pattern", label: "app/*.md" });
    expect(m("/srv/app/readme.md", "/srv/other")).toEqual({ kind: "pattern", label: "app/*.md" });
    // `~/` and absolute patterns still see the whole path.
    expect(m("/work/.envs/app/brief.txt", "/work/.envs/app")).toEqual({ kind: "pattern", label: "//work/.envs/**" });
    expect(m("/home/u/.ssh/x/brief.txt", "/home/u/.ssh/x")).toEqual({ kind: "dir", label: "~/.ssh" });
    expect(credentialMatcher(["~/notes/*.txt"], [HOME])("/home/u/notes/a.txt", "/home/u/notes")).toEqual({ kind: "pattern", label: "~/notes/*.txt" });
  });

  it("matches nothing of a ~/ rule without homes, and the name rules still", () => {
    const m = credentialMatcher(["~/.vault/**", "~/notes/*.txt"], []);
    expect(m("/home/u/.ssh/config")).toBeNull();
    expect(m("/home/u/.netrc")).toBeNull();
    expect(m("/home/u/.vault/token")).toBeNull();
    expect(m("/home/u/notes/a.txt")).toBeNull();
    expect(m("/home/u/.env")).toEqual({ kind: "name", label: ".env" });
  });
});

describe("credentialReason", () => {
  it("says which rule refused the path", () => {
    expect(credentialReason({ kind: "dir", label: "~/.ssh" })).toBe("is under ~/.ssh, where credentials live");
    expect(credentialReason({ kind: "file", label: "~/.netrc" })).toBe("is the credential file ~/.netrc");
    expect(credentialReason({ kind: "name", label: ".ENV" })).toBe("is named like a credential file (.ENV)");
    expect(credentialReason({ kind: "pattern", label: "vault/*.md" })).toBe("matches the credential path vault/*.md");
  });
});

describe("homeSpellings", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir !== null) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("gives the home as written and as on disk, once when they agree", () => {
    dir = realpathSync.native(mkdtempSync(join(tmpdir(), "arbab-")));
    const home = join(dir, "home");
    mkdirSync(home);
    symlinkSync(home, join(dir, "link"));
    expect(homeSpellings(home)).toEqual([home]);
    expect(homeSpellings(join(dir, "link"))).toEqual([join(dir, "link"), home]);
    expect(homeSpellings(join(dir, "none"))).toEqual([join(dir, "none")]);
  });
});
