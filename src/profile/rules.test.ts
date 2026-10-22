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
  it("denies Read and Edit for every built-in path, in order", () => {
    const rules = credentialDenies([]);
    expect(rules).toHaveLength(BUILTIN_CREDENTIAL_PATHS.length * 2);
    expect(rules.slice(0, 4)).toEqual(["Read(~/.ssh/**)", "Edit(~/.ssh/**)", "Read(~/.aws/**)", "Edit(~/.aws/**)"]);
    expect(rules.slice(-2)).toEqual(["Read(**/*.tfstate)", "Edit(**/*.tfstate)"]);
  });

  it("adds extra paths after the built-ins and drops duplicates", () => {
    const rules = credentialDenies(["~/.secrets/**", "~/.ssh/**", "~/.secrets/**"]);
    expect(rules).toHaveLength(BUILTIN_CREDENTIAL_PATHS.length * 2 + 2);
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
