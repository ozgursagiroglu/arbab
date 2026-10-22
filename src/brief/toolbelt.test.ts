import { describe, expect, it } from "vitest";
import { GIT_WRITE_VERBS } from "../profile/presets";
import { ArbabError } from "../util/errors";
import type { Lease } from "../types";
import { REVIEWER, RESEARCHER, SANDBOX_AUTO, STRICT } from "./test-profiles";
import { allowedCommands, toolBelt } from "./toolbelt";

const lease = (type: string, value: number): Lease => ({ type, value, lane: "l", project: "/p", pid: 1, createdAt: "2026-01-01T00:00:00.000Z" });
const LEASES = [lease("port", 41000), lease("port", 41001), lease("redis-db", 3)];

describe("allowedCommands", () => {
  it("merges exact and wildcard rules per prefix", () => {
    expect(allowedCommands(["Read", "Bash(pwd)", "Bash(git log)", "Bash(git log *)", "Bash(pnpm test:*)"]))
      .toEqual(["`pwd`", "`git log …`", "`pnpm test …`"]);
  });
  it("reports a bare Bash as any command", () => {
    expect(allowedCommands(["Bash(pwd)", "Bash(*)"])).toEqual(["any command"]);
  });
  it("is empty without Bash rules", () => {
    expect(allowedCommands(["Read", "WebFetch"])).toEqual([]);
  });
});

describe("toolBelt", () => {
  it("describes a strict profile with leases", () => {
    const belt = toolBelt(STRICT, LEASES, 15);
    expect(belt).toContain("- Shell commands you may run: `git status …`, `git diff …`, `git log …`, `git show …`, " +
      "`git ls-files …`, `git blame …`, `ls …`, `cat …`, `head …`, `tail …`, `wc …`, `pwd`, `mkdir …`, `cp …`, `mv …`, " +
      "`rm …`, `touch …`, `pnpm test …`, `pnpm typecheck …`.");
    expect(belt).not.toContain("git grep");
    expect(belt).toContain("- File tools: Read, Edit, Write, Glob, Grep. Use Write to create directories and files; use Read and Grep instead of shell pipelines.");
    expect(belt).not.toContain("without an allowlist");
    expect(belt).toContain("`pnpm typecheck …`.\n- Bash output longer than 100000 characters is saved to a file you cannot " +
      "read: run one test file, use a quiet reporter, or print only what you need.\n- Quote paths that contain [ ] ( ), " +
      "such as app/[slug]/page.tsx: unquoted, the shell or the permission check refuses them.\n- File tools:");
    expect(belt).toContain("- One command per call, in the foreground. These are refused:");
    expect(belt).toContain("  - `cd X && …`: commands already run in the worktree;");
    expect(belt).toContain("  - `&&`, `;` and pipes into `tail`/`head`: run single commands and read the full output;");
    expect(belt).toContain("  - `$(…)` and `echo $?`: the tool reports the exit code;");
    expect(belt).toContain("  - `sleep N`: set the Bash `timeout` parameter instead, up to 15 minutes;");
    expect(belt).toContain("  - background processes: refused");
    expect(belt).toContain("`ARBAB_PORT_0=41000`, `ARBAB_PORT_1=41001`, `ARBAB_REDIS_DB_0=3`");
    expect(belt).toContain("- Do not try: git writes (the runner commits), network access and web tools, files outside the worktree, credential files.");
  });
  it("describes a sandbox-auto profile", () => {
    const belt = toolBelt(SANDBOX_AUTO, [lease("port", 42000)], 1);
    expect(belt).toContain("Shell commands run inside the sandbox without an allowlist");
    expect(belt).not.toContain("Shell commands you may run");
    expect(belt).toContain("up to 1 minute;");
    expect(belt).toContain("`ARBAB_PORT_0=42000`");
    expect(belt).toContain("- Quote paths that contain [ ] ( )");
  });
  it("names the profile's Bash output limit, else the default", () => {
    const limited = { ...STRICT, settings: { ...STRICT.settings, bashOutputMaxChars: 4000 } };
    expect(toolBelt(limited, [], 15)).toContain("- Bash output longer than 4000 characters is saved to a file you cannot read");
    expect(STRICT.settings.bashOutputMaxChars).toBeUndefined();
    expect(toolBelt(STRICT, [], 15)).toContain("- Bash output longer than 100000 characters");
  });
  it("omits leases when there are none", () => {
    expect(toolBelt(STRICT, [], 15)).not.toContain("ARBAB_");
  });
  it("says when no shell command is allowed", () => {
    const profile = { ...STRICT, settings: { ...STRICT.settings, permissions: { allow: ["Read"], deny: [] } } };
    expect(toolBelt(profile, [], 15)).toContain("- No shell command is allowed.");
  });
  it.each(GIT_WRITE_VERBS)("names git writes when only git %s is denied", (verb) => {
    const profile = { ...STRICT, settings: { ...STRICT.settings, permissions: { allow: [], deny: [`Bash(git ${verb} *)`] } } };
    expect(toolBelt(profile, [], 15)).toContain("- Do not try: git writes (the runner commits)");
  });
  it("lists editing as do-not-try for a reviewer", () => {
    const belt = toolBelt(REVIEWER, [], 15);
    expect(belt).toContain("- File tools: Read, Glob, Grep. Use Read and Grep instead of shell pipelines.");
    expect(belt).toContain("editing or creating files");
  });
  it("has no shell section for a researcher", () => {
    const belt = toolBelt(RESEARCHER, [], 15);
    expect(belt).toContain("- You have no shell");
    expect(belt).toContain("- Other tools: WebSearch, WebFetch.");
    expect(belt).not.toContain("One command per call");
    expect(belt).not.toContain("Bash output");
    expect(belt).not.toContain("Quote paths");
    expect(belt).not.toContain("web tools");
    expect(belt).not.toContain("File tools");
  });
  it("throws on a lease type that is not a valid name", () => {
    expect(() => toolBelt(STRICT, [lease("Bad Type", 1)], 15)).toThrow(ArbabError);
  });
});
