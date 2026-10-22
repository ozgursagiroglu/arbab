import { describe, expect, it } from "vitest";
import { ArbabError } from "../util/errors";
import { BUILTIN_CREDENTIAL_PATHS } from "./presets";
import { commandRules, credentialDenies, dedupe } from "./rules";

function codeOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err instanceof ArbabError ? err.code : err;
  }
  return "no error";
}

describe("commandRules", () => {
  it("compiles a prefix to the exact command and the command with arguments", () => {
    expect(commandRules("pnpm test")).toEqual(["Bash(pnpm test)", "Bash(pnpm test *)"]);
    expect(commandRules("ls")).toEqual(["Bash(ls)", "Bash(ls *)"]);
    expect(commandRules("pnpm test:unit")).toEqual(["Bash(pnpm test:unit)", "Bash(pnpm test:unit *)"]);
  });

  it.each([
    ["empty", ""],
    ["leading space", " pnpm test"],
    ["trailing space", "pnpm test "],
    ["double space", "pnpm  test"],
    ["tab", "pnpm\ttest"],
    ["newline", "pnpm test\nrm -rf x"],
    ["carriage return", "pnpm test\r"],
    ["semicolon", "pnpm test; rm x"],
    ["ampersand", "pnpm test && rm x"],
    ["pipe", "pnpm test | sh"],
    ["backtick", "pnpm `x`"],
    ["dollar", "pnpm $X"],
    ["less than", "pnpm < x"],
    ["greater than", "pnpm > x"],
    ["open paren", "pnpm (x"],
    ["close paren", "pnpm x)"],
    ["backslash", "pnpm \\x"],
    ["wildcard", "pnpm *"],
  ])("rejects a prefix with %s", (_label, prefix) => {
    expect(codeOf(() => commandRules(prefix))).toBe("lint");
  });
});

describe("credentialDenies", () => {
  const HOME_ANCHORED = BUILTIN_CREDENTIAL_PATHS.filter((p) => p.startsWith("~/"));
  const RELATIVE = BUILTIN_CREDENTIAL_PATHS.filter((p) => p.startsWith("**/"));

  it("denies Read and Edit for every built-in path, in order", () => {
    const rules = credentialDenies([]);
    expect(rules).toHaveLength(HOME_ANCHORED.length * 2 + RELATIVE.length * 4);
    expect(rules.slice(0, 4)).toEqual(["Read(~/.ssh/**)", "Edit(~/.ssh/**)", "Read(~/.aws/**)", "Edit(~/.aws/**)"]);
    expect(rules.slice(-4)).toEqual(["Read(**/*.tfstate)", "Edit(**/*.tfstate)", "Read(~/**/*.tfstate)", "Edit(~/**/*.tfstate)"]);
  });

  it("anchors every relative pattern at home and at the project root, and leaves home paths alone", () => {
    const rules = credentialDenies([], "/work/repo");
    expect(rules).toHaveLength(HOME_ANCHORED.length * 2 + RELATIVE.length * 6);
    for (const path of RELATIVE) {
      const at = rules.indexOf(`Read(${path})`);
      expect(rules.slice(at, at + 6)).toEqual([
        `Read(${path})`,
        `Edit(${path})`,
        `Read(~/${path})`,
        `Edit(~/${path})`,
        `Read(//work/repo/${path})`,
        `Edit(//work/repo/${path})`,
      ]);
    }
    for (const path of HOME_ANCHORED) {
      expect(rules).toContain(`Read(${path})`);
      // An anchored copy would read `~/~/…` or `//work/repo/~/…`.
      expect(rules.filter((r) => r.includes(`/${path}`))).toEqual([]);
    }
  });

  it("anchors a project root with a glob character in a directory name at its nearest ancestor without one", () => {
    const rules = credentialDenies([], "/work/a[1]/b/repo");
    expect(rules).toContain("Read(//work/**/.env*)");
    expect(rules).toContain("Edit(//work/**/.env*)");
    expect(rules.filter((r) => r.includes("["))).toEqual([]);
    for (const special of ["*", "?", "]", "{", "}", "(", ")", "!", "\\"]) {
      expect(credentialDenies([], `/work/x${special}y/repo`)).toContain("Read(//work/**/*.pem)");
    }
  });

  it("anchors at the filesystem root when no ancestor below it is free of glob characters", () => {
    const rules = credentialDenies(["**/*.secret"], "/w[ork]/repo");
    expect(rules).toContain("Read(//**/.env*)");
    expect(rules).toContain("Edit(//**/.env*)");
    expect(rules.slice(-2)).toEqual(["Read(//**/*.secret)", "Edit(//**/*.secret)"]);
    expect(rules.filter((r) => r.includes("///") || r.includes("["))).toEqual([]);
  });

  it("keeps a project root without glob characters as it is", () => {
    const rules = credentialDenies([], "/work/my-repo.v2_x@y");
    expect(rules).toContain("Read(//work/my-repo.v2_x@y/**/.env*)");
    expect(rules.filter((r) => r.startsWith("Read(//"))).toHaveLength(RELATIVE.length);
  });

  it("adds only the home pair without a project root", () => {
    const rules = credentialDenies([]);
    expect(rules).toContain("Read(~/**/.env*)");
    expect(rules).toContain("Edit(~/**/.env*)");
    expect(rules.filter((r) => r.includes("//"))).toEqual([]);
  });

  it("anchors a relative extra path too, but not an absolute or home one", () => {
    const rules = credentialDenies(["**/*.secret", "~/.vault/**", "/srv/keys/**"], "/work/repo");
    expect(rules.slice(-10)).toEqual([
      "Read(**/*.secret)",
      "Edit(**/*.secret)",
      "Read(~/**/*.secret)",
      "Edit(~/**/*.secret)",
      "Read(//work/repo/**/*.secret)",
      "Edit(//work/repo/**/*.secret)",
      "Read(~/.vault/**)",
      "Edit(~/.vault/**)",
      "Read(/srv/keys/**)",
      "Edit(/srv/keys/**)",
    ]);
  });

  it("adds extra paths after the built-ins and drops duplicates", () => {
    const rules = credentialDenies(["~/.secrets/**", "~/.ssh/**", "~/.secrets/**", "**/.env*"]);
    expect(rules).toHaveLength(HOME_ANCHORED.length * 2 + RELATIVE.length * 4 + 2);
    expect(rules.slice(-2)).toEqual(["Read(~/.secrets/**)", "Edit(~/.secrets/**)"]);
  });

  it("always keeps the blanket env deny, for Read and Edit", () => {
    expect(credentialDenies([])).toContain("Read(**/.env*)");
    expect(credentialDenies([])).toContain("Edit(**/.env*)");
    expect(credentialDenies(["~/.vault/**"])).toContain("Read(**/.env*)");
  });
});

describe("dedupe", () => {
  it("keeps the first occurrence and the order", () => {
    expect(dedupe(["b", "a", "b", "c", "a"])).toEqual(["b", "a", "c"]);
    expect(dedupe([])).toEqual([]);
  });
});

describe("presets", () => {
  it("lists exactly the built-in credential paths", () => {
    expect(BUILTIN_CREDENTIAL_PATHS).toEqual([
      "~/.ssh/**",
      "~/.aws/**",
      "~/.azure/**",
      "~/.config/**",
      "~/.docker/**",
      "~/.kube/**",
      "~/.gnupg/**",
      "~/.claude/**",
      "~/.claude.json",
      "~/.netrc",
      "~/.npmrc",
      "~/.pypirc",
      "~/.git-credentials",
      "~/Library/Keychains/**",
      "~/Library/Cookies/**",
      "**/.env*",
      "**/*.pem",
      "**/*.key",
      "**/*.p12",
      "**/*.pfx",
      "**/id_rsa*",
      "**/id_ed25519*",
      "**/*.tfstate",
    ]);
  });
});
