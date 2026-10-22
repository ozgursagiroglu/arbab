import { describe, expect, it } from "vitest";
import { ArbabError } from "../util/errors";
import { BUILTIN_CREDENTIAL_PATHS, ENV_SECRET_PATTERNS } from "./presets";
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

  it("keeps the blanket env deny without env files, and with null", () => {
    expect(credentialDenies([])).toEqual(credentialDenies([], null));
    expect(credentialDenies([])).toContain("Read(**/.env*)");
  });

  it("swaps the blanket env deny for the secret patterns and absolute rules, in its place", () => {
    const rules = credentialDenies(["~/.vault/**"], ["/repo/.env.example.local", "/repo/a/../.env"]);
    expect(rules).not.toContain("Read(**/.env*)");
    const at = rules.indexOf("Read(**/.env)");
    expect(rules[at - 1]).toBe("Edit(~/Library/Cookies/**)");
    expect(rules.slice(at, at + 20)).toEqual(
      [...ENV_SECRET_PATTERNS, "//repo/.env.example.local", "//repo/.env"].flatMap((p) => [`Read(${p})`, `Edit(${p})`]),
    );
    expect(rules[at + 20]).toBe("Read(**/*.pem)");
    expect(rules.slice(-2)).toEqual(["Read(~/.vault/**)", "Edit(~/.vault/**)"]);
  });

  it("lifts the blanket deny for an empty list of env files", () => {
    const rules = credentialDenies([], []);
    expect(rules).not.toContain("Read(**/.env*)");
    expect(rules).toContain("Read(**/.envrc)");
  });

  it.each(["/repo/.env[1]", "/repo/.env*", "/repo/.env (copy)", "/repo/.env{a,b}", "/repo/.env?", "/repo/!.env", "/repo/.env\\x", "/repo/.env\nx"])(
    "keeps the blanket deny when %j cannot be an exact rule",
    (file) => {
      const rules = credentialDenies([], ["/repo/.env", file]);
      expect(rules).toContain("Read(**/.env*)");
      expect(rules).not.toContain("Read(//repo/.env)");
    },
  );

  it("refuses a relative env file", () => {
    expect(codeOf(() => credentialDenies([], ["repo/.env"]))).toBe("usage");
  });
});

describe("env presets", () => {
  it("lists the secret env patterns", () => {
    expect(ENV_SECRET_PATTERNS).toEqual([
      "**/.env",
      "**/.env.local",
      "**/.env.*.local",
      "**/.env.development*",
      "**/.env.production*",
      "**/.env.staging*",
      "**/.env.test*",
      "**/.envrc",
    ]);
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
