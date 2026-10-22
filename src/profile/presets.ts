// The fixed parts of the fence (DESIGN.md §4). Rule paths use Claude Code's Read/Edit syntax: `~/` is home, `**/`
// matches anywhere.

export const BUILTIN_CREDENTIAL_PATHS: readonly string[] = [
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
];

/** The blanket env-file deny that `fence.readableEnvFiles` lifts (DESIGN.md §21). */
export const ENV_FILES_BLANKET = "**/.env*";

/**
 * What replaces the blanket deny when templates are readable; other env files are denied by absolute path. The last
 * two deny `.env` and `.env.<x>` directories (a virtualenv, a dotenv folder) whole; a template is a file, so unaffected.
 */
export const ENV_SECRET_PATTERNS: readonly string[] = [
  "**/.env",
  "**/.env.local",
  "**/.env.*.local",
  "**/.env.development*",
  "**/.env.production*",
  "**/.env.staging*",
  "**/.env.test*",
  "**/.envrc",
  "**/.env/**",
  "**/.env.*/**",
];

export const GIT_WRITE_VERBS: readonly string[] = [
  "commit",
  "push",
  "reset",
  "checkout",
  "switch",
  "restore",
  "rebase",
  "merge",
  "cherry-pick",
  "stash",
  "clean",
  "branch",
  "worktree",
  "tag",
  "config",
  "update-ref",
  "remote",
];

// No `grep`: its -O/--open-files-in-pager runs a program the caller names, and workers have the Grep tool.
export const GIT_READ_VERBS: readonly string[] = ["status", "diff", "log", "show", "ls-files", "blame"];

export const READ_UTILITIES: readonly string[] = ["ls", "cat", "head", "tail", "wc"];

// File utilities for roles that write. The sandbox confines their writes to the worktree; without them a worker
// cannot delete or rename a file (wave 1 of arbab's own build lost a turn to `rm` and left a misnamed file).
export const FILE_UTILITIES: readonly string[] = ["mkdir", "cp", "mv", "rm", "touch"];

/** Prefixes that run arbitrary code when followed by a wildcard ("node *" allows `node -e …`). */
export const ANY_CODE_PREFIXES: readonly string[] = [
  "node",
  "npx",
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "bunx",
  "deno",
  "python",
  "python3",
  "ruby",
  "perl",
  "php",
  "sh",
  "bash",
  "zsh",
  "fish",
  "env",
  "eval",
  "exec",
  "xargs",
  "find",
  "awk",
  "sed",
  "make",
  "sudo",
  "osascript",
  "open",
  "docker",
  "kubectl",
  "ssh",
  "curl",
  "wget",
  "git",
  "pnpm exec",
  "pnpm dlx",
  "pnpm run",
  "npm exec",
  "npm run",
  "yarn run",
  "yarn dlx",
  "bun run",
  "bun x",
  "git -C",
  "git config",
];

/** Bash tool input parameters: `Bash(<param>:…)` is read as a parameter rule, not a command rule. */
export const BASH_INPUT_PARAMS: readonly string[] = [
  "timeout",
  "description",
  "run_in_background",
  "dangerouslyDisableSandbox",
];

export const FIXED_ENV: Readonly<Record<string, string>> = {
  BASH_DEFAULT_TIMEOUT_MS: "300000",
  BASH_MAX_TIMEOUT_MS: "900000",
};

/** Settings env names arbab points into the worktree's .arbab-tmp/ (src/run/workertmp.ts); config values lose. */
export const WORKER_TMP_ENV: readonly string[] = [
  "XDG_CONFIG_HOME",
  "YARN_CACHE_FOLDER",
  "NPM_CONFIG_USERCONFIG",
];

// zsh refuses unquoted `app/[slug]` globs ("no matches found"); Claude Code falls back to its own detection when this
// path is not a valid shell.
export const WORKER_SHELL = "/bin/bash";

/** The tool belt's figure when a profile carries no `bashOutputMaxChars` (config.fence's default). */
export const DEFAULT_BASH_OUTPUT_MAX_CHARS = 100000;

/** The one parameter rule arbab writes itself. */
export const BACKGROUND_DENY = "Bash(run_in_background:true)";
