import { describe, expect, it } from "vitest";
import type { ClaudeSettings, CompiledProfile, ProfileInput, Role } from "../types";
import { compileProfile } from "./compile";
import { lintProfile } from "./lint";

function input(over: Partial<ProfileInput> = {}): ProfileInput {
  return {
    role: "implementer",
    fence: "strict",
    tools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash"],
    loopback: true,
    commands: ["pnpm test"],
    laneAllow: [],
    credentialPaths: [],
    env: {},
    worktree: "/work/lane",
    gitCommonDir: "/work/repo/.git",
    ...over,
  };
}

/** Lints a compiled profile after editing it, so each case can break exactly one thing. */
function lint(
  over: Partial<ProfileInput> = {},
  edit: (p: CompiledProfile) => void = () => {},
): Array<{ code: string; severity: string; where?: string }> {
  const inp = input(over);
  const profile = compileProfile(inp);
  edit(profile);
  return lintProfile(profile, inp).map(({ code, severity, where }) => ({ code, severity, where }));
}

function codes(issues: Array<{ code: string }>): string[] {
  return issues.map((i) => i.code);
}

function sandbox(p: CompiledProfile): ClaudeSettings["sandbox"] {
  return p.settings.sandbox;
}

describe("lintProfile", () => {
  it.each<Role>(["implementer", "verifier", "reviewer", "researcher", "probe"])(
    "finds nothing in a compiled %s profile, at both fence levels",
    (role) => {
      expect(lint({ role })).toEqual([]);
      expect(lint({ role, fence: "sandbox-auto" })).toEqual([]);
    },
  );

  describe("bare-bash-allow", () => {
    it("flags Bash, Bash(*) and wildcards with no fixed part", () => {
      expect(lint({ laneAllow: ["Bash", "Bash(*)", "Bash( * )", "Bash(* --version)"] })).toEqual([
        { code: "bare-bash-allow", severity: "error", where: "Bash" },
        { code: "bare-bash-allow", severity: "error", where: "Bash(*)" },
        { code: "bare-bash-allow", severity: "error", where: "Bash( * )" },
        { code: "bare-bash-allow", severity: "error", where: "Bash(* --version)" },
      ]);
    });
    it("leaves anchored rules alone", () => {
      expect(codes(lint({ laneAllow: ["Bash(make check *)"] }))).toEqual([]);
    });
  });

  describe("any-code-allow", () => {
    it.each(["Bash(node *)", "Bash(npx:*)", "Bash(pnpm exec *)", "Bash(git -C *)", "Bash(sh*)", "Bash(npm  run *)"])(
      "flags %s",
      (rule) => {
        expect(codes(lint({ laneAllow: [rule] }))).toContain("any-code-allow");
      },
    );
    it.each(["Bash(node --version)", "Bash(pnpm test *)", "Bash(npm run build *)", "Bash(git status *)"])(
      "accepts %s",
      (rule) => {
        expect(codes(lint({ laneAllow: [rule] }))).not.toContain("any-code-allow");
      },
    );
  });

  describe("param-rule", () => {
    it("flags parameter rules in allow and deny", () => {
      const issues = lint({ laneAllow: ["Bash(run_in_background:true)"] }, (p) => {
        p.settings.permissions.deny.push("Bash(timeout:*)", "Bash(dangerouslyDisableSandbox:true)");
      });
      expect(issues.filter((i) => i.code === "param-rule")).toEqual([
        { code: "param-rule", severity: "error", where: "Bash(run_in_background:true)" },
        { code: "param-rule", severity: "error", where: "Bash(timeout:*)" },
        { code: "param-rule", severity: "error", where: "Bash(dangerouslyDisableSandbox:true)" },
      ]);
    });
    it("accepts arbab's own background deny and colon commands that are not parameters", () => {
      const issues = lint({ laneAllow: ["Bash(pnpm test:unit)"] });
      expect(codes(issues)).not.toContain("param-rule");
    });
  });

  describe("relative-path-rule", () => {
    it("flags Read and Edit rules with a single leading slash", () => {
      const issues = lint({ credentialPaths: ["/secrets/**"], laneAllow: ["Read(/docs/**)"] });
      expect(issues.filter((i) => i.code === "relative-path-rule").map((i) => i.where)).toEqual([
        "Read(/docs/**)",
        "Read(/secrets/**)",
        "Edit(/secrets/**)",
      ]);
    });
    it("accepts //absolute, ~/home and relative globs", () => {
      const issues = lint({ credentialPaths: ["//etc/secrets/**", "~/.vault/**", "**/*.secret"] });
      expect(codes(issues)).toEqual([]);
    });
  });

  describe("sandbox settings", () => {
    it("flags a disabled sandbox", () => {
      const issues = lint({}, (p) => {
        (sandbox(p) as { enabled: boolean }).enabled = false;
      });
      expect(codes(issues)).toEqual(["sandbox-disabled"]);
    });
    it("flags a sandbox that fails open", () => {
      expect(codes(lint({}, (p) => void (sandbox(p).failIfUnavailable = false)))).toEqual(["sandbox-fail-open"]);
    });
    it("flags unsandboxed retries", () => {
      expect(codes(lint({}, (p) => void (sandbox(p).allowUnsandboxedCommands = true)))).toEqual(["unsandboxed-retry"]);
    });
    it("flags auto-allow in fence strict", () => {
      expect(codes(lint({}, (p) => void (sandbox(p).autoAllowBashIfSandboxed = true)))).toEqual(["auto-allow-strict"]);
    });
    it("accepts auto-allow in fence sandbox-auto", () => {
      expect(codes(lint({ fence: "sandbox-auto" }))).not.toContain("auto-allow-strict");
    });
  });

  describe("agent-tool", () => {
    it.each(["Task", "Agent"])("flags %s in the tool set", (tool) => {
      expect(lint({ tools: ["Read", tool] })).toEqual([{ code: "agent-tool", severity: "error", where: tool }]);
    });
    it("accepts a tool set without agents", () => {
      expect(codes(lint({ tools: ["Read", "TaskList"] }))).toEqual([]);
    });
  });

  describe("colon-star-form", () => {
    it("warns about :* allow rules", () => {
      expect(lint({ laneAllow: ["Bash(make check:*)"] })).toEqual([
        { code: "colon-star-form", severity: "warning", where: "Bash(make check:*)" },
      ]);
    });
    it("accepts the space form", () => {
      expect(lint({ laneAllow: ["Bash(make check *)"] })).toEqual([]);
    });
  });

  describe("shadowed-allow", () => {
    it("warns about an allow rule that is also denied", () => {
      expect(lint({ laneAllow: ["Bash(git push)"] })).toEqual([
        { code: "shadowed-allow", severity: "warning", where: "Bash(git push)" },
      ]);
    });
    it("warns about the reviewer's file write tools", () => {
      expect(lint({ role: "reviewer", laneAllow: ["Edit"] })).toEqual([
        { code: "shadowed-allow", severity: "warning", where: "Edit" },
      ]);
    });
    it("accepts allow rules that no deny repeats", () => {
      expect(lint({ laneAllow: ["Bash(git push --dry-run)"] })).toEqual([]);
    });
  });

  describe("shared-git-writable", () => {
    const WARNING = { code: "shared-git-writable", severity: "warning", where: "sandbox.filesystem.denyWrite" };
    it.each<Role>(["implementer", "verifier", "reviewer", "probe"])("warns when the %s runs Bash without a git dir", (role) => {
      expect(lint({ role, gitCommonDir: undefined })).toEqual([WARNING]);
    });
    it("does not warn for a role without Bash", () => {
      expect(lint({ role: "researcher", tools: ["WebSearch", "WebFetch"], gitCommonDir: undefined })).toEqual([]);
    });
    it("warns when the compiled profile lost the denyWrite", () => {
      expect(lint({}, (p) => void delete sandbox(p).filesystem)).toEqual([WARNING]);
      expect(lint({}, (p) => void (sandbox(p).filesystem = { denyWrite: ["/elsewhere/.git"] }))).toEqual([WARNING]);
    });
    it("accepts a git dir given with a trailing slash", () => {
      expect(lint({ gitCommonDir: "/work/repo/.git/" })).toEqual([]);
    });
  });

  describe("reserved-env", () => {
    it("warns when config env sets a key arbab owns", () => {
      expect(lint({ env: { BASH_DEFAULT_TIMEOUT_MS: "1", XDG_CONFIG_HOME: "/x", FOO: "1" } })).toEqual([
        { code: "reserved-env", severity: "warning", where: "BASH_DEFAULT_TIMEOUT_MS" },
        { code: "reserved-env", severity: "warning", where: "XDG_CONFIG_HOME" },
      ]);
    });
    it("warns for every temp-path key the settings env sets", () => {
      const env = { XDG_CONFIG_HOME: "/x", YARN_CACHE_FOLDER: "/x", NPM_CONFIG_USERCONFIG: "/x" };
      expect(lint({ env }).map((issue) => issue.where)).toEqual(Object.keys(env));
    });
    it("does not reserve XDG_DATA_HOME or XDG_CACHE_HOME, which arbab leaves alone", () => {
      expect(lint({ env: { XDG_DATA_HOME: "/x", XDG_CACHE_HOME: "/x" } })).toEqual([]);
    });
    it("accepts the absolute env-file rules the compiler writes", () => {
      expect(lint({ readableEnvFiles: [".env.example"], envFileDenies: ["/work/repo/.env"] })).toEqual([]);
    });
    it("accepts ordinary keys, including ones named like Object methods", () => {
      expect(lint({ env: { FOO: "1", toString: "x" } })).toEqual([]);
    });
  });
});
