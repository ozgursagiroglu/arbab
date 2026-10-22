import { isAbsolute, relative, resolve } from "node:path";
import { workerTmpPaths } from "../run/workertmp";
import type { ClaudeSettings, CompiledProfile, ProfileInput, Role } from "../types";
import { ArbabError } from "../util/errors";
import { BACKGROUND_DENY, FILE_UTILITIES, FIXED_ENV, GIT_READ_VERBS, GIT_WRITE_VERBS, READ_UTILITIES } from "./presets";
import { commandRules, credentialDenies, dedupe } from "./rules";

const FILE_TOOLS = new Set(["Read", "Glob", "Grep", "Edit", "Write"]);
const WRITE_TOOLS = new Set(["Edit", "Write"]);
// The probe writes too: its steps may create files in the worktree (DESIGN.md §4, role presets).
const WRITERS: readonly Role[] = ["implementer", "verifier", "probe"];

/** Compiles a role's fence into the tool list and the --settings file (DESIGN.md §4). */
export function compileProfile(input: ProfileInput): CompiledProfile {
  if (!isAbsolute(input.worktree)) {
    throw new ArbabError("usage", `worktree ${JSON.stringify(input.worktree)} must be an absolute path`);
  }
  const gitDir = input.gitCommonDir === undefined ? undefined : sharedGitDir(input.gitCommonDir);
  const tmp = workerTmpPaths(input.worktree);
  let allow = dedupe([
    ...input.tools.filter((t) => FILE_TOOLS.has(t) && (!WRITE_TOOLS.has(t) || WRITERS.includes(input.role))),
    ...roleAllow(input.role),
    ...input.commands.flatMap(commandRules),
    ...input.laneAllow,
  ]);
  // Sandboxed Bash is auto-allowed in sandbox-auto; a Bash allow rule there could only approve an unsandboxed retry.
  if (input.fence === "sandbox-auto") allow = allow.filter((rule) => !rule.startsWith("Bash("));

  const allowRead = envAllowReads(input.worktree, input.envFileAllowReads ?? []);
  const filesystem = gitDir === undefined && allowRead.length === 0
    ? undefined
    : { denyWrite: gitDir === undefined ? [] : [gitDir], ...(allowRead.length === 0 ? {} : { allowRead }) };
  const deny = dedupe([
    // The `**/.env*` deny stays whatever readableEnvFiles says; allowRead re-opens the tracked templates only.
    ...credentialDenies(input.credentialPaths),
    // `//` makes the path absolute; a single `/` would be relative to the settings file.
    ...(gitDir === undefined ? [] : [`Edit(/${gitDir}/**)`, `Write(/${gitDir}/**)`]),
    BACKGROUND_DENY,
    ...GIT_WRITE_VERBS.flatMap((verb) => commandRules(`git ${verb}`)),
    "Bash(git -C)",
    "Bash(git -C *)",
    "NotebookEdit",
    ...(input.role === "researcher" ? [] : ["WebFetch", "WebSearch"]),
    ...(input.role === "reviewer" ? ["Edit", "Write"] : []),
  ]);

  const settings: ClaudeSettings = {
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: input.fence === "sandbox-auto",
      allowUnsandboxedCommands: false,
      network: { allowLocalBinding: input.loopback },
      // denyWrite: otherwise a sandboxed command can write refs and objects of the shared repository (measured, M1
      // review). allowRead: the tracked env templates, readable by shell commands only (DESIGN.md §21).
      ...(filesystem === undefined ? {} : { filesystem }),
    },
    env: {
      ...input.env,
      ...FIXED_ENV,
      // Keeps git and package managers off the denied ~/.config and ~/.npmrc, which otherwise fail with EPERM.
      // XDG_DATA_HOME and XDG_CACHE_HOME stay unset: corepack's cache and pnpm's Linux store live under them.
      XDG_CONFIG_HOME: tmp.xdgConfig,
      YARN_CACHE_FOLDER: tmp.yarnCache,
      NPM_CONFIG_USERCONFIG: tmp.npmrc,
    },
    permissions: { allow, deny },
    ...(input.bashOutputMaxChars === undefined ? {} : { bashOutputMaxChars: input.bashOutputMaxChars }),
  };
  return { tools: input.tools, settings };
}

/** The shared git directory, normalised (no trailing slash, no `..`); it must be absolute. */
function sharedGitDir(dir: string): string {
  if (!isAbsolute(dir)) {
    throw new ArbabError("usage", `gitCommonDir ${JSON.stringify(dir)} must be an absolute path`);
  }
  const normal = resolve(dir);
  if (normal === "/") throw new ArbabError("usage", "gitCommonDir must not be the filesystem root");
  return normal;
}

/** The env templates to re-open, normalised; each must be an absolute path inside the worktree. */
function envAllowReads(worktree: string, paths: string[]): string[] {
  return dedupe(paths.map((path) => {
    if (!isAbsolute(path)) throw new ArbabError("usage", `env template ${JSON.stringify(path)} must be an absolute path`);
    const normal = resolve(path);
    const rel = relative(resolve(worktree), normal);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
      throw new ArbabError("usage", `env template ${path} is outside the worktree ${worktree}`);
    }
    return normal;
  }));
}

function readAllow(): string[] {
  return [...GIT_READ_VERBS.flatMap((verb) => commandRules(`git ${verb}`)), ...READ_UTILITIES.flatMap(commandRules), "Bash(pwd)"];
}

function roleAllow(role: Role): string[] {
  switch (role) {
    case "implementer":
    case "verifier":
      return [...readAllow(), ...FILE_UTILITIES.flatMap(commandRules)];
    case "reviewer":
      return readAllow();
    case "researcher":
      return ["WebSearch", "WebFetch"];
    case "probe":
      return ["Bash(git rev-parse *)", "Bash(git status)", "Bash(ls)", "Bash(ls *)"];
  }
}
