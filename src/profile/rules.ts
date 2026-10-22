import { posix } from "node:path";
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

/**
 * Read and Edit denies for the built-in credential paths, then the project's extra ones. The `**\/.env*` deny stays
 * even when templates are readable: those are re-opened for sandboxed commands only, by path (DESIGN.md §21).
 *
 * A relative `**\/` pattern covers only the worker's working directory in the sandbox (measured), so each one gets
 * copies anchored at the home directory and, given its normalised absolute path, the project's main checkout (or
 * its nearest ancestor whose path is free of glob characters).
 */
export function credentialDenies(extra: string[], projectRoot?: string): string[] {
  const anchor = projectRoot === undefined ? undefined : globFreeAncestor(projectRoot);
  const rules: string[] = [];
  for (const path of [...BUILTIN_CREDENTIAL_PATHS, ...extra]) {
    const paths = [path];
    if (path.startsWith("**/")) {
      paths.push(`~/${path}`);
      // `//` makes the path absolute; a single `/` would be relative to the settings file.
      if (anchor !== undefined) paths.push(anchor === "/" ? `//${path}` : `/${anchor}/${path}`);
    }
    for (const p of paths) rules.push(`Read(${p})`, `Edit(${p})`);
  }
  return dedupe(rules);
}

// A rule path is a glob: a directory name with these could fail to match itself.
const GLOB_SPECIAL = /[*?[\]{}()!\\]/;

/** `dir`, or its nearest ancestor whose path holds no glob character: a deny anchored higher covers more, never less. */
function globFreeAncestor(dir: string): string {
  let at = dir;
  while (at !== "/" && GLOB_SPECIAL.test(at)) at = posix.dirname(at);
  return at;
}

/** First occurrence wins, order kept. */
export function dedupe(items: readonly string[]): string[] {
  return [...new Set(items)];
}
