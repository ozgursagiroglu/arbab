import { realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { BUILTIN_CREDENTIAL_PATHS } from "./presets";

// The fence's credential list as a check on paths, for files arbab itself copies into a worktree, inlines into a
// prompt or puts in a commit: the fence only stops the worker. Case is ignored everywhere: macOS and Windows file
// systems ignore it by default (`~/.AWS/credentials` is `~/.aws/credentials`), and where one does not, refusing a
// little more is the safe side.

export interface CredentialHit {
  kind: "dir" | "file" | "name" | "pattern";
  label: string;
}

type CredentialRule = (path: string) => CredentialHit | null;

const GLOB_CHARS = /[*?[\]{}]/;

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** `child` is `parent` or inside it, whatever the case of either. */
function within(parent: string, child: string): boolean {
  const rel = relative(parent.toLowerCase(), child.toLowerCase());
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
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

function patternRegexes(pattern: string, homes: readonly string[]): RegExp[] {
  const anchored = (prefix: string, glob: string): RegExp => new RegExp(`^${escapeRe(prefix)}${globSource(glob)}$`, "i");
  if (pattern.startsWith("~/")) return homes.map((h) => anchored(h.endsWith("/") ? h : `${h}/`, pattern.slice(2)));
  // `//x` is absolute; a single `/` is relative to the settings file, which lint flags, so taken as absolute here.
  if (pattern.startsWith("/")) return [anchored("/", pattern.replace(/^\/+/, ""))];
  // Relative to wherever the worker runs: matched anywhere.
  return [new RegExp(`(?:^|/)${globSource(pattern)}$`, "i")];
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
        return (path) => (homes.some((h) => within(join(h, plain), path)) ? hit : null);
      }
    }
    if (pattern.startsWith("**/")) {
      const name = pattern.slice(3);
      if (name !== "" && !name.includes("/") && !name.includes("**")) {
        const re = new RegExp(`^${globSource(name)}$`, "i");
        return (path) => {
          const component = path.split(sep).find((c) => re.test(c));
          return component === undefined ? null : { kind: "name", label: component };
        };
      }
    }
    const res = patternRegexes(pattern, homes);
    return (path) => (res.some((re) => re.test(path)) ? { kind: "pattern", label: pattern } : null);
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
 * with none, `~/` patterns match nothing.
 */
export function credentialMatcher(extra: readonly string[], homes: readonly string[]): (path: string) => CredentialHit | null {
  const rules = credentialRules([...BUILTIN_CREDENTIAL_PATHS, ...extra], homes);
  return (path) => {
    for (const rule of rules) {
      const hit = rule(path);
      if (hit !== null) return hit;
    }
    return null;
  };
}
