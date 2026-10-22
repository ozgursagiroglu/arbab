import { isAbsolute, resolve } from "node:path";
import { ArbabError } from "../util/errors";
import { BUILTIN_CREDENTIAL_PATHS, ENV_FILES_BLANKET, ENV_SECRET_PATTERNS } from "./presets";

// Shell metacharacters would let a prefix rule match more than the command it names; `*` would make it a wildcard.
const FORBIDDEN = /[;&|`$<>()\\*\n\r]/;
// Words separated by single spaces: no leading, trailing, doubled or non-space whitespace.
const WORDS = /^\S+( \S+)*$/;

/** "pnpm test" → ["Bash(pnpm test)", "Bash(pnpm test *)"]: the exact command and the command with arguments. */
export function commandRules(prefix: string): string[] {
  if (prefix === "") throw new ArbabError("lint", "command prefix is empty");
  if (FORBIDDEN.test(prefix)) {
    throw new ArbabError("lint", `command prefix ${JSON.stringify(prefix)} contains a shell metacharacter`);
  }
  if (!WORDS.test(prefix)) {
    throw new ArbabError("lint", `command prefix ${JSON.stringify(prefix)} must be words separated by single spaces`);
  }
  return [`Bash(${prefix})`, `Bash(${prefix} *)`];
}

// A path rule is a glob: a file name with these could fail to match itself, so it cannot be denied one by one.
const GLOB_SPECIAL = /[*?[\]{}()!\\]/;

// A directory is denied whole as `<abs>/**`; the suffix is the only glob an env-file path may carry.
const WHOLE_DIR = "/**";

/**
 * Read and Edit denies for the built-in credential paths, then the project's extra ones. With `envFiles` (absolute
 * paths, directories as `<abs>/**`), the blanket `**\/.env*` gives way to the secret patterns plus one absolute rule
 * per entry (DESIGN.md §21); the blanket stays when a path could not be written as an exact rule.
 */
export function credentialDenies(extra: string[], envFiles: string[] | null = null): string[] {
  const entries = (envFiles ?? []).map((file) => {
    const whole = file.endsWith(WHOLE_DIR);
    const base = whole ? file.slice(0, -WHOLE_DIR.length) : file;
    if (!isAbsolute(base)) throw new ArbabError("usage", `env file ${JSON.stringify(file)} must be an absolute path`);
    return { base, suffix: whole ? WHOLE_DIR : "" };
  });
  // `//` makes a rule path absolute; a single `/` would be relative to the settings file.
  const exact = envFiles === null || entries.some(({ base }) => GLOB_SPECIAL.test(base) || /[\n\r]/.test(base))
    ? null
    : entries.map(({ base, suffix }) => `/${resolve(base)}${suffix}`);
  const paths = BUILTIN_CREDENTIAL_PATHS.flatMap((path) =>
    exact !== null && path === ENV_FILES_BLANKET ? [...ENV_SECRET_PATTERNS, ...exact] : [path],
  );
  const rules: string[] = [];
  for (const path of [...paths, ...extra]) rules.push(`Read(${path})`, `Edit(${path})`);
  return dedupe(rules);
}

/** First occurrence wins, order kept. */
export function dedupe(items: readonly string[]): string[] {
  return [...new Set(items)];
}
