import { ArbabError } from "../util/errors";
import { BUILTIN_CREDENTIAL_PATHS } from "./presets";

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

/** Read and Edit denies for the built-in credential paths, then the project's extra ones. */
export function credentialDenies(extra: string[]): string[] {
  const rules: string[] = [];
  for (const path of [...BUILTIN_CREDENTIAL_PATHS, ...extra]) rules.push(`Read(${path})`, `Edit(${path})`);
  return dedupe(rules);
}

/** First occurrence wins, order kept. */
export function dedupe(items: readonly string[]): string[] {
  return [...new Set(items)];
}
