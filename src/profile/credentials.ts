import { realpathSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { sameOrInside } from "../util/pathcase";
import { BUILTIN_CREDENTIAL_PATHS } from "./presets";

// The fence's credential list as a check on paths, for files arbab itself copies into a worktree, inlines into a
// prompt or puts in a commit: the fence only stops the worker. macOS and Windows file systems ignore case by default
// (`~/.AWS/credentials` is `~/.aws/credentials`), and where one does not, refusing a little more is the safe side, so
// containment compares through foldPath and the glob regexes match NFD text with Unicode case folding.

export interface CredentialHit {
  kind: "dir" | "file" | "name" | "pattern";
  label: string;
}

/** `root`: when given and `path` lies inside it, name rules and relative patterns look only at what is below it. */
type CredentialRule = (path: string, root?: string) => CredentialHit | null;

const GLOB_CHARS = /[*?[\]{}]/;

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Text as the credential regexes see it: NFD, as APFS compares names; case is the regexes' flags' business. */
const nfd = (text: string): string => text.normalize("NFD");

/**
 * A credential regex over NFD text. `iu` folds case the Unicode way (`ſ` is `s`, U+212A is `k`) without changing a
 * character's length: foldPath turns `ß` into `ss`, which a `?` would no longer match.
 */
const credentialRe = (source: string): RegExp => new RegExp(source, "iu");

/**
 * The components of `path` below `root` when it lies inside it, else all of them: a project kept under a directory
 * named like a credential (`~/.envs/app`) is not itself a credential file, but what is inside it still may be.
 */
function componentsBelow(path: string, root: string | undefined): string[] {
  if (root === undefined || !sameOrInside(root, path)) return path.split(sep);
  const depth = resolve(root).split(sep).filter((c) => c !== "").length;
  return resolve(path).split(sep).filter((c) => c !== "").slice(depth);
}

/** A Read/Edit rule glob as a regex source: `*` and `?` stay within a component, `**` crosses them. */
function globSource(glob: string): string {
  const whole = glob.endsWith("/**");
  const body = whole ? glob.slice(0, -3) : glob;
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i] as string;
    if (c === "*" && body[i + 1] === "*") {
      i++;
      if (body[i + 1] === "/") {
        i++;
        out += "(?:.*/)?";
      } else out += ".*";
    } else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else out += escapeRe(c);
  }
  // `dir/**` covers the directory itself too: copying it would copy what is under it.
  return whole ? `${out}(?:/.*)?` : out;
}

/** Regexes over NFD paths (nfd): the text they are built from is NFD too. */
function patternRegexes(pattern: string, homes: readonly string[]): RegExp[] {
  const anchored = (prefix: string, glob: string): RegExp => credentialRe(`^${escapeRe(nfd(prefix))}${globSource(nfd(glob))}$`);
  if (pattern.startsWith("~/")) return homes.map((h) => anchored(h.endsWith("/") ? h : `${h}/`, pattern.slice(2)));
  // `//x` is absolute; a single `/` is relative to the settings file, which lint flags, so taken as absolute here.
  if (pattern.startsWith("/")) return [anchored("/", pattern.replace(/^\/+/, ""))];
  // Relative to wherever the worker runs: matched anywhere.
  return [credentialRe(`(?:^|/)${globSource(nfd(pattern))}$`)];
}

/** One check per pattern. */
function credentialRules(patterns: readonly string[], homes: readonly string[]): CredentialRule[] {
  return patterns.map((pattern): CredentialRule => {
    if (pattern.startsWith("~/")) {
      const rest = pattern.slice(2);
      const dir = rest.endsWith("/**") ? rest.slice(0, -3) : null;
      const plain = dir ?? rest;
      if (plain !== "" && !GLOB_CHARS.test(plain)) {
        const hit: CredentialHit = { kind: dir !== null ? "dir" : "file", label: `~/${plain}` };
        return (path) => (homes.some((h) => sameOrInside(join(h, plain), path)) ? hit : null);
      }
    }
    if (pattern.startsWith("**/")) {
      const name = pattern.slice(3);
      if (name !== "" && !name.includes("/") && !name.includes("**")) {
        const re = credentialRe(`^${globSource(nfd(name))}$`);
        return (path, root) => {
          const component = componentsBelow(path, root).find((c) => re.test(nfd(c)));
          return component === undefined ? null : { kind: "name", label: component };
        };
      }
    }
    const res = patternRegexes(pattern, homes);
    const hit: CredentialHit = { kind: "pattern", label: pattern };
    // A relative pattern, like a name rule, looks only below `root`: the directories holding the project are not its.
    if (!pattern.startsWith("~/") && !pattern.startsWith("/")) {
      return (path, root) => {
        const subject = nfd(root === undefined || !sameOrInside(root, path) ? path : componentsBelow(path, root).join("/"));
        return res.some((re) => re.test(subject)) ? hit : null;
      };
    }
    return (path) => {
      const subject = nfd(path);
      return res.some((re) => re.test(subject)) ? hit : null;
    };
  });
}

/** A home directory's spellings for `credentialMatcher`: as given and as on disk, so a home reached through a link is the same home. */
export function homeSpellings(home: string): string[] {
  const lexical = resolve(home);
  try {
    return [...new Set([lexical, realpathSync.native(lexical)])];
  } catch {
    return [lexical];
  }
}

/** Why a path the matcher hit is refused, to follow the path in a message: "is under ~/.ssh, where credentials live". */
export function credentialReason(hit: CredentialHit): string {
  if (hit.kind === "dir") return `is under ${hit.label}, where credentials live`;
  if (hit.kind === "file") return `is the credential file ${hit.label}`;
  if (hit.kind === "name") return `is named like a credential file (${hit.label})`;
  return `matches the credential path ${hit.label}`;
}

/**
 * Checks absolute paths against the fence's credential list (BUILTIN_CREDENTIAL_PATHS) plus `extra`
 * (config.credentialPaths and the like). `homes`: the user's home directory spellings (lexical and real);
 * with none, `~/` patterns match nothing. Given `root` (a project root, in the spelling `path` has), the `**\/<name>`
 * rules and the relative patterns (neither `~/` nor `/`) test only the part of `path` below it, `/`-joined; `~/` and
 * absolute patterns, and a path outside `root`, are unchanged.
 */
export function credentialMatcher(
  extra: readonly string[],
  homes: readonly string[],
): (path: string, root?: string) => CredentialHit | null {
  const rules = credentialRules([...BUILTIN_CREDENTIAL_PATHS, ...extra], homes);
  return (path, root) => {
    for (const rule of rules) {
      const hit = rule(path, root);
      if (hit !== null) return hit;
    }
    return null;
  };
}
