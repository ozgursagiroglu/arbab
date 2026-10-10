#!/usr/bin/env node
// Prepares one wave of lanes for launch.mjs, until arbab's own profile, brief and run modules drive launches: a
// worktree per lane (branch arbab/<lane>), offline dependencies, the compiled fence (DESIGN.md §4), and the assembled
// prompt (role and isolation, project rules, the brief source, the tool belt, the report).
//
//   [ARBAB_BASE=<ref>] node bench/bootstrap/wave.mjs <wave> <lane>:<effort>:<budget>[:<role>] ...
//
// Roles: implementer (default), reviewer (read-only findings), skeptic (read-only verdicts on findings).
// Writes .arbab/lanes/<wave>/<lane>.{json,prompt.md}; prints the launch commands.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const config = JSON.parse(readFileSync(join(ROOT, "arbab.config.json"), "utf8"));
const git = (args, cwd = ROOT) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

const CREDENTIALS = [
  "~/.ssh/**", "~/.aws/**", "~/.azure/**", "~/.config/**", "~/.docker/**", "~/.kube/**", "~/.gnupg/**", "~/.claude/**",
  "~/.claude.json", "~/.netrc", "~/.npmrc", "~/.pypirc", "~/.git-credentials", "~/Library/Keychains/**",
  "~/Library/Cookies/**", "**/.env*", "**/*.pem", "**/*.key", "**/*.p12", "**/*.pfx", "**/id_rsa*", "**/id_ed25519*",
  "**/*.tfstate",
];
const GIT_READS = ["status", "diff", "log", "show", "ls-files", "blame"];
const GIT_WRITES = ["commit", "push", "reset", "checkout", "switch", "restore", "rebase", "merge", "cherry-pick", "stash",
  "clean", "branch", "worktree", "tag", "config", "update-ref", "remote"];
const READ_UTILS = ["ls", "cat", "head", "tail", "wc"];
const FILE_UTILS = ["mkdir", "cp", "mv", "rm", "touch"];
const rules = (prefix) => [`Bash(${prefix})`, `Bash(${prefix} *)`];

const ROLES = {
  implementer: {
    tools: ["Read", "Edit", "Write", "Glob", "Grep", "Bash"], writes: true, commands: config.commands.implementer ?? [],
    schema: "implementer.json", checkpoint: true,
  },
  reviewer: {
    tools: ["Read", "Glob", "Grep", "Bash"], writes: false, commands: config.commands.reviewer ?? [],
    schema: "reviewer.json", checkpoint: false,
  },
  skeptic: {
    tools: ["Read", "Glob", "Grep", "Bash"], writes: false, commands: config.commands.reviewer ?? [],
    schema: "verdicts.json", checkpoint: false,
  },
};

function settings(role, worktree) {
  const r = ROLES[role];
  const allow = [...(r.writes ? ["Read", "Edit", "Write", "Glob", "Grep"] : ["Read", "Glob", "Grep"]), "Bash(pwd)",
    ...GIT_READS.flatMap((v) => rules(`git ${v}`)), ...READ_UTILS.flatMap(rules),
    ...(r.writes ? FILE_UTILS.flatMap(rules) : []), ...r.commands.flatMap(rules)];
  const deny = [...CREDENTIALS.flatMap((p) => [`Read(${p})`, `Edit(${p})`]), "Bash(run_in_background:true)",
    ...GIT_WRITES.flatMap((v) => rules(`git ${v}`)), ...rules("git -C"), "NotebookEdit", "WebFetch", "WebSearch",
    ...(r.writes ? [] : ["Edit", "Write"])];
  return {
    sandbox: { enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: false, allowUnsandboxedCommands: false,
      network: { allowLocalBinding: r.writes } },
    env: { ...config.env, BASH_DEFAULT_TIMEOUT_MS: "300000", BASH_MAX_TIMEOUT_MS: "900000",
      XDG_CONFIG_HOME: join(worktree, ".arbab-tmp", "xdg-config") },
    permissions: { allow, deny },
  };
}

const REPORTS = {
  "implementer.json": `- \`status\`: \`done\`, \`partial\` or \`blocked\`;
- \`summary\`;
- \`files_changed\`;
- \`checks\`: every check you ran at the end, each with its command, the exit code the tool reported, and the result;
- \`decisions\`: choices you made that the brief did not fix;
- \`open_questions\`: what you need from the orchestrator, including any change you need outside your Scope;
- \`not_verified\`: what you could not check;
- \`notes_for_reviewer\`.`,
  "reviewer.json": `- \`findings\`: each with \`title\`, \`severity\` (\`HIGH\`, \`MEDIUM\` or \`LOW\`), \`file\`, \`line\`, a concrete
  \`failure_scenario\` (inputs or state → wrong outcome), the \`evidence\` (what you read or ran that shows it), and a
  \`suggested_fix\`. Strongest first; none rather than speculative;
- \`coverage\`: what you checked and how, and what you could not check;
- \`paths_checked\`: every file you read in full.`,
  "verdicts.json": `- \`verdicts\`: one per finding, with its \`id\`, \`refuted\` (true when the finding does not hold, or you
  could not confirm it after checking the code), \`corrected_severity\` (\`HIGH\`, \`MEDIUM\`, \`LOW\` or \`NONE\`) and
  your \`reasoning\` with the evidence.`,
};

function prompt(role, lane, worktree, briefSource) {
  const r = ROLES[role];
  const [titleLine, ...rest] = briefSource.split("\n");
  const commands = r.commands.map((c) => `\`${c} …\``).join(", ");
  const roleText = r.writes
    ? `- You cannot commit, push or switch branches. The runner commits your work when you finish.`
    : `- You cannot edit files: you are reviewing. Report what you find, with evidence; the orchestrator decides.`;
  return `${titleLine}

## Role and isolation

You are an arbab worker in the ${role} role. You run headless: nobody will answer questions. Decide, and report
what you could not decide.

- Your working directory is a git worktree at \`${worktree}\` on branch \`arbab/${lane}\`. Work only inside it.
- Shell commands run in an OS sandbox: no network, no writes outside the worktree and the temp directory, and
  credential files are unreadable.${r.writes ? " Listening on 127.0.0.1 is allowed." : ""}
${roleText}
- A refused command costs you one turn. Do not retry it; use the tool belt.

## Project rules

### CLAUDE.md

${readFileSync(join(ROOT, "CLAUDE.md"), "utf8").replace(/^# .*\n/, "").replace(/^## /gm, "#### ").trim()}
${rest.join("\n")}

## Tool belt

- Shell commands you may run: ${commands}, \`git status\`, \`git diff …\`, \`git log …\`, \`git show …\`,
  \`git ls-files …\`, \`git blame …\`, \`ls …\`, \`cat …\`, \`head …\`, \`tail …\`, \`wc …\`, \`pwd\`${r.writes ? `, and inside the
  worktree \`mkdir …\`, \`cp …\`, \`mv …\`, \`rm …\`, \`touch …\`` : ""}.
- File tools: ${r.tools.filter((t) => t !== "Bash").join(", ")}.${r.writes ? " Use Write to create directories and files;" : ""} Use Read
  and Grep instead of shell pipelines.
- One command per call, in the foreground. These are refused:
  - \`cd X && …\`: commands already run in the worktree;
  - \`&&\`, \`;\` and pipes into \`tail\`/\`head\`: run single commands and read the full output;
  - \`$(…)\` and \`echo $?\`: the tool reports the exit code;
  - \`sleep N\` and background processes: set the Bash \`timeout\` parameter instead, up to 15 minutes.
- Do not try: git writes, network access, package installs, files outside the worktree, credential files.

## Report

End with the JSON object the schema requires:

${REPORTS[r.schema]}
`;
}

const [wave, ...specs] = process.argv.slice(2);
if (!wave || specs.length === 0) {
  console.error("usage: wave.mjs <wave> <lane>:<effort>:<budget>[:<role>] ...");
  process.exit(1);
}
const outDir = join(ROOT, ".arbab/lanes", wave);
mkdirSync(outDir, { recursive: true });
// ARBAB_BASE names the branch or commit the wave starts from (e.g. the integration branch of the previous wave).
const base = git(["rev-parse", process.env.ARBAB_BASE ?? "HEAD"]);
for (const spec of specs) {
  const [lane, effort = "high", budget = "10", role = "implementer"] = spec.split(":");
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(lane)) throw new Error(`bad lane name ${lane}`);
  if (!ROLES[role]) throw new Error(`unknown role ${role}`);
  const worktree = join(ROOT, ".arbab/worktrees", lane);
  if (!existsSync(worktree)) git(["worktree", "add", "-q", "-b", `arbab/${lane}`, worktree, base]);
  execFileSync(config.dependencies.command[0], config.dependencies.command.slice(1), { cwd: worktree, stdio: "ignore" });
  mkdirSync(join(worktree, ".arbab-tmp", "xdg-config"), { recursive: true });
  const promptFile = join(outDir, `${lane}.prompt.md`);
  writeFileSync(promptFile, prompt(role, lane, worktree, readFileSync(join(ROOT, "lanes", `${lane}.md`), "utf8")));
  const laneFile = join(outDir, `${lane}.json`);
  writeFileSync(laneFile, JSON.stringify({
    name: lane, role, cwd: worktree, model: "claude-opus-5-5", effort, tools: ROLES[role].tools,
    settings: settings(role, worktree), budgetUsd: Number(budget), promptFile, restricted: true, wallMin: 75, idleMin: 20,
    checkpoint: ROLES[role].checkpoint, jsonSchemaFile: join(ROOT, "bench/schemas", ROLES[role].schema),
  }, null, 2) + "\n");
  console.log(`node bench/bootstrap/launch.mjs ${laneFile.replace(ROOT + "/", "")}`);
}
