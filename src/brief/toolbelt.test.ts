import { describe, expect, it } from "vitest";
import { checkCommandLine } from "../check/command";
import { compileProfile } from "../profile/compile";
import { GIT_WRITE_VERBS } from "../profile/presets";
import { ArbabError } from "../util/errors";
import type { CompiledProfile, Lease, ProfileInput } from "../types";
import { REVIEWER, RESEARCHER, SANDBOX_AUTO, STRICT, STRICT_INPUT } from "./test-profiles";
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
  it("names the env templates re-opened for shell commands, only when there are some", () => {
    const allowRead = ["/work/lane/.env.example", "/work/lane/apps/web/.env.sample"];
    const withTemplates = (base: typeof STRICT) => ({
      ...base,
      settings: { ...base.settings, sandbox: { ...base.settings.sandbox, filesystem: { denyWrite: [], allowRead } } },
    });
    const line = "- Tracked env templates `/work/lane/.env.example`, `/work/lane/apps/web/.env.sample` are readable by " +
      "shell commands only.";
    expect(toolBelt(withTemplates(STRICT), [], 15)).toContain(line);
    expect(toolBelt(withTemplates(SANDBOX_AUTO), [], 15)).toContain(line);
    expect(toolBelt(STRICT, [], 15)).not.toContain("env templates");
    const empty = { ...STRICT, settings: { ...STRICT.settings, sandbox: { ...STRICT.settings.sandbox, filesystem: { denyWrite: [], allowRead: [] } } } };
    expect(toolBelt(empty, [], 15)).not.toContain("env templates");
    expect(toolBelt(withTemplates(RESEARCHER), [], 15)).not.toContain("env templates");
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

describe("toolBelt, heavy checks and gates", () => {
  const SCRIPT = "/work/repo/.arbab/runs/lane/bin/arbab-check.mjs";
  const GATES = [["pnpm", "typecheck"], ["pnpm", "test"]];
  // Compiled with the lane's checks, as a launch compiles them: implementer and verifier get the check rules.
  const withChecks = (input: Partial<ProfileInput>, names: string[], script = SCRIPT): CompiledProfile =>
    compileProfile({ ...STRICT_INPUT, ...input, checkScript: script, checkNames: names });
  const CHECKS_LINE =
    `- Heavy checks: run each one once, before you report, with \`node ${SCRIPT} <name>\` (names: \`typecheck\`, ` +
    "`lint`). Run it with the Bash timeout parameter set to 15 minutes: the wait for a place counts against it. It " +
    "waits for a machine-wide place, runs on a fair share of the CPUs and prints a short summary: the failures and " +
    "the path of the full log, which you can read with Read. Do not run these commands any other way, and do not " +
    "re-run a check to see more of its output: read the log.";
  const GATES_LINE =
    "- The integration's verify runs the repository gates for every lane together: `pnpm typecheck`, `pnpm test`. " +
    "Do not run a whole-repository suite yourself: run the tests of the files you change, one file per call when the " +
    "output is long.";

  it("names the lane's check command and its names, and the gates, before the leases", () => {
    const profile = withChecks({}, ["typecheck", "lint"]);
    const belt = toolBelt(profile, LEASES, 15, { role: "implementer", gates: GATES, checks: { script: SCRIPT, names: ["typecheck", "lint"] } });
    expect(belt).toContain(`run everything in the foreground.\n${CHECKS_LINE}\n${GATES_LINE}\n- Leased resources`);
  });

  it("sets the Bash timeout to the maximum, in minutes", () => {
    const profile = withChecks({ role: "verifier" }, ["lint"]);
    const work = { role: "verifier" as const, gates: [], checks: { script: SCRIPT, names: ["lint"] } };
    expect(toolBelt(profile, [], 10, work)).toContain(
      "(names: `lint`). Run it with the Bash timeout parameter set to 10 minutes: the wait for a place counts against it. It waits",
    );
    expect(toolBelt(profile, [], 1, work)).toContain("Bash timeout parameter set to 1 minute: the wait");
  });

  it("quotes a script path that needs it, as the command line does", () => {
    const script = "/work/my repo/bin/arbab-check.mjs";
    const profile = withChecks({ role: "verifier", fence: "sandbox-auto" }, ["lint"], script);
    const belt = toolBelt(profile, [], 15, { role: "verifier", gates: [], checks: { script, names: ["lint"] } });
    expect(belt).toContain(`with \`node '${script}' <name>\` (names: \`lint\`).`);
    expect(belt).not.toContain("The integration's verify");
  });

  it("quotes a gate argument that needs it", () => {
    const belt = toolBelt(STRICT, [], 15, { role: "verifier", gates: [["pnpm", "test", "--filter", "a b"]] });
    expect(belt).toContain("together: `pnpm test --filter 'a b'`. Do not run");
  });

  it("has no check line without checks, and no gates line without gates", () => {
    const belt = toolBelt(STRICT, [], 15, { role: "implementer", gates: [] });
    expect(belt).not.toContain("Heavy checks");
    expect(belt).not.toContain("The integration's verify");
    expect(toolBelt(STRICT, [], 15, { role: "implementer", gates: [], checks: { script: SCRIPT, names: [] } })).not.toContain("Heavy checks");
    expect(toolBelt(STRICT, [], 15)).not.toContain("Heavy checks");
  });

  it("names only the checks the profile's allow rules hold", () => {
    // Compiled without the checks: the env and the script may be there, the rules are not.
    expect(toolBelt(STRICT, [], 15, { role: "implementer", gates: [], checks: { script: SCRIPT, names: ["lint"] } })).not.toContain("Heavy checks");
    const profile = withChecks({}, ["lint"]);
    const belt = toolBelt(profile, [], 15, { role: "implementer", gates: [], checks: { script: SCRIPT, names: ["lint", "typecheck"] } });
    expect(belt).toContain("(names: `lint`). Run it");
  });

  it("gives a reviewer with lane checks neither a checks line nor a gates line", () => {
    const profile = withChecks({ role: "reviewer", tools: ["Read", "Glob", "Grep", "Bash"], loopback: false }, ["gate-1"]);
    expect(profile.settings.permissions.allow.some((rule) => rule.includes(SCRIPT))).toBe(false);
    const belt = toolBelt(profile, [], 15, { role: "reviewer", gates: GATES, checks: { script: SCRIPT, names: ["gate-1"] } });
    expect(belt).not.toContain("Heavy checks");
    expect(belt).not.toContain("The integration's verify");
  });

  it("gives a sandbox-auto lane its checks line without rules: its sandboxed Bash runs without an allowlist", () => {
    const profile = withChecks({ role: "reviewer", fence: "sandbox-auto", tools: ["Read", "Glob", "Grep", "Bash"], loopback: false }, ["gate-1"]);
    expect(profile.settings.permissions.allow.some((rule) => rule.startsWith("Bash("))).toBe(false);
    const belt = toolBelt(profile, [], 15, { role: "reviewer", gates: [], checks: { script: SCRIPT, names: ["gate-1"] } });
    expect(belt).toContain("(names: `gate-1`)");
  });

  it("gives a researcher with lane checks no checks line: it has no shell", () => {
    const belt = toolBelt(RESEARCHER, [], 15, { role: "researcher", gates: GATES, checks: { script: SCRIPT, names: ["gate-1"] } });
    expect(belt).not.toContain("Heavy checks");
  });

  it("gives a probe its checks line when its own allow holds the exact rule (verify), and no gates line", () => {
    const work = { role: "probe" as const, gates: GATES, checks: { script: SCRIPT, names: ["gate-1"] } };
    const bare = withChecks({ role: "probe", tools: ["Read", "Glob", "Grep", "Bash"], loopback: false }, ["gate-1"]);
    expect(toolBelt(bare, [], 15, work)).not.toContain("Heavy checks");
    const verify = withChecks(
      { role: "probe", tools: ["Read", "Glob", "Grep", "Bash"], loopback: false, laneAllow: [`Bash(${checkCommandLine(SCRIPT, "gate-1")})`] },
      ["gate-1"],
    );
    const belt = toolBelt(verify, [], 15, work);
    expect(belt).toContain("(names: `gate-1`)");
    expect(belt).not.toContain("The integration's verify");
  });
});
