import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import type { Stats } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { BUILTIN_CREDENTIAL_PATHS } from "../profile/presets";
import { realDir, WORKER_TMP_DIR } from "../run/workertmp";
import { ArbabError } from "../util/errors";

// A lane's inputs: files outside the repository its brief points at, which the fence keeps the worker from reading
// where they are (DESIGN.md §21). The shepherd copies them into the worktree, refusing anything the fence denies as a
// credential: the copy lands where the worker reads freely.

/** The most a lane's inputs may hold together, in bytes. */
export const MAX_INPUTS_BYTES = 50 * 1024 * 1024;

/** Beyond the fence's Keychains and Cookies: the rest of ~/Library holds app data no lane needs copied. */
const LIBRARY = "~/Library/**";

/** `child` is `parent` or inside it. */
function within(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function realOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

interface Hit {
  kind: "dir" | "file" | "name" | "pattern";
  label: string;
}

type CredentialRule = (path: string) => Hit | null;

const GLOB_CHARS = /[*?[\]{}]/;

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

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
  const anchored = (prefix: string, glob: string): RegExp => new RegExp(`^${escapeRe(prefix)}${globSource(glob)}$`);
  if (pattern.startsWith("~/")) return homes.map((h) => anchored(h.endsWith("/") ? h : `${h}/`, pattern.slice(2)));
  // `//x` is absolute; a single `/` is relative to the settings file, which lint flags, so taken as absolute here.
  if (pattern.startsWith("/")) return [anchored("/", pattern.replace(/^\/+/, ""))];
  // Relative to wherever the worker runs: matched anywhere.
  return [new RegExp(`(?:^|/)${globSource(pattern)}$`)];
}

/** One check per pattern of the fence's credential list (src/profile/presets.ts) and config.credentialPaths. */
function credentialRules(patterns: readonly string[], homes: readonly string[]): CredentialRule[] {
  return patterns.map((pattern): CredentialRule => {
    if (pattern.startsWith("~/")) {
      const rest = pattern.slice(2);
      const dir = rest.endsWith("/**") ? rest.slice(0, -3) : null;
      const plain = dir ?? rest;
      if (plain !== "" && !GLOB_CHARS.test(plain)) {
        const hit: Hit = { kind: dir !== null ? "dir" : "file", label: `~/${plain}` };
        return (path) => (homes.some((h) => within(join(h, plain), path)) ? hit : null);
      }
    }
    if (pattern.startsWith("**/")) {
      const name = pattern.slice(3);
      if (name !== "" && !name.includes("/") && !name.includes("**")) {
        const re = new RegExp(`^${globSource(name)}$`);
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

interface Entry {
  /** Relative to the input; "" for the input itself. */
  rel: string;
  dir: boolean;
  /** For files: the identity the walk saw, checked again once the file is open. */
  dev?: number;
  ino?: number;
}

interface Planned {
  raw: string;
  name: string;
  source: string;
  entries: Entry[];
}

/**
 * Copies each lane input into <worktree>/.arbab-tmp/inputs/<basename>, replacing whatever the directory held
 * (inputs the lane dropped included); returns the names copied. Throws ArbabError("usage") naming the input on any
 * refusal. The caller holds the worktree's writer lock: no worker runs there during the copy.
 */
export function copyInputs(input: {
  projectRoot: string;
  worktree: string;
  inputs: string[];
  userHome: string;
  /** config.credentialPaths, refused on top of the fence's built-in list. */
  credentialPaths: string[];
}): string[] {
  const home = resolve(input.userHome);
  // Lexical and real: a home reached through a link is the same home.
  const homes = [...new Set([home, realOr(home)])];
  const worktree = realOr(resolve(input.worktree));
  const rules = credentialRules([...BUILTIN_CREDENTIAL_PATHS, LIBRARY, ...input.credentialPaths], homes);
  const credential = (path: string): Hit | null => {
    for (const rule of rules) {
      const hit = rule(path);
      if (hit !== null) return hit;
    }
    return null;
  };

  const names = new Map<string, string>();
  const planned: Planned[] = [];
  let total = 0;
  for (const raw of input.inputs) {
    const refuse = (why: string): never => {
      throw new ArbabError("usage", `input ${raw} ${why}`);
    };
    let path: string;
    if (raw === "~" || raw.startsWith("~/")) path = join(home, raw.slice(2));
    else if (raw.startsWith("~")) path = refuse("names another user's home; write the full path");
    else path = resolve(input.projectRoot, raw);

    const name = basename(path);
    if (name === "") refuse("has no name to copy it under");
    const clash = names.get(name);
    if (clash !== undefined) refuse(`has the same name (${name}) as input ${clash}`);
    names.set(name, raw);

    let stat: Stats;
    try {
      stat = lstatSync(path);
    } catch {
      return refuse(`does not exist (${path})`);
    }
    if (stat.isSymbolicLink()) refuse("is a symbolic link; name the file it points to");
    if (!stat.isFile() && !stat.isDirectory()) refuse("is neither a file nor a directory");
    const real = realOr(path);
    for (const p of [path, real]) {
      const hit = credential(p);
      if (hit === null) continue;
      if (hit.kind === "dir") refuse(`is under ${hit.label}, where credentials live`);
      if (hit.kind === "file") refuse(`is the credential file ${hit.label}`);
      if (hit.kind === "name") refuse(`is named like a credential file (${hit.label})`);
      refuse(`matches the credential path ${hit.label}`);
    }
    if (stat.isDirectory() && homes.some((h) => within(real, h))) refuse("holds the home directory, credentials included");
    if (stat.isDirectory() && within(real, worktree)) refuse("holds the worktree it would be copied into");

    const entries: Entry[] = [];
    const add = (bytes: number): void => {
      total += bytes;
      if (total > MAX_INPUTS_BYTES) refuse(`brings the inputs over ${MAX_INPUTS_BYTES / 1024 / 1024} MB`);
    };
    if (stat.isFile()) {
      add(stat.size);
      entries.push({ rel: "", dir: false, dev: stat.dev, ino: stat.ino });
    } else {
      entries.push({ rel: "", dir: true });
      const walk = (rel: string): void => {
        for (const child of readdirSync(join(real, rel)).sort()) {
          const childRel = join(rel, child);
          const full = join(real, childRel);
          const s = lstatSync(full);
          // Links are skipped: one could point anywhere, a credential directory included.
          if (s.isSymbolicLink()) continue;
          if (!s.isDirectory() && !s.isFile()) continue;
          // Both spellings, as for the input itself: a pattern may name the path through a link.
          const hit = credential(full) ?? credential(join(path, childRel));
          if (hit !== null) {
            if (hit.kind === "dir") refuse(`holds ${hit.label}, where credentials live`);
            if (hit.kind === "file") refuse(`holds ${hit.label}, a credential file`);
            if (hit.kind === "name") refuse(`holds ${childRel}, named like a credential file`);
            refuse(`holds ${childRel}, which matches the credential path ${hit.label}`);
          }
          if (s.isDirectory()) {
            entries.push({ rel: childRel, dir: true });
            walk(childRel);
          } else {
            add(s.size);
            entries.push({ rel: childRel, dir: false, dev: s.dev, ino: s.ino });
          }
        }
      };
      try {
        walk("");
      } catch (err) {
        if (err instanceof ArbabError) throw err;
        throw new ArbabError("io", `cannot read input ${raw}: ${(err as Error).message}`, { cause: err });
      }
    }
    planned.push({ raw, name, source: real, entries });
  }

  // Nothing is copied until every input passed. The worker owns .arbab-tmp/ and may have left links there: the old
  // copies go whole, and everything below is created anew (exclusive, no-follow), so nothing is written through one.
  const dest = clearInputs(input.worktree);
  let copied = 0;
  for (const p of planned) {
    const refuse = (why: string): never => {
      throw new ArbabError("usage", `input ${p.raw} ${why}`);
    };
    const target = join(dest, p.name);
    try {
      for (const e of p.entries) {
        const to = join(target, e.rel);
        if (e.dir) {
          mkdirSync(to);
          continue;
        }
        // Narrows, does not close, the window in which a directory of the input is swapped for a link to a credential
        // between the walk and the copy: the parent must still be the one the walk saw, the file the same inode.
        const from = join(p.source, e.rel);
        if (realOr(dirname(from)) !== dirname(from)) refuse(`changed while it was copied (${e.rel || p.name} moved)`);
        let fd: number;
        try {
          fd = openSync(from, constants.O_RDONLY | constants.O_NOFOLLOW);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "ELOOP") return refuse(`changed while it was copied (${e.rel || p.name} is now a link)`);
          throw err;
        }
        try {
          const s = fstatSync(fd);
          if (!s.isFile() || s.dev !== e.dev || s.ino !== e.ino) refuse(`changed while it was copied (${e.rel || p.name} is another file)`);
          copied += s.size;
          if (copied > MAX_INPUTS_BYTES) refuse("grew over the inputs' limit while it was copied");
          const out = openSync(to, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, s.mode & 0o777);
          try {
            writeFileSync(out, readFileSync(fd));
          } finally {
            closeSync(out);
          }
        } finally {
          closeSync(fd);
        }
      }
    } catch (err) {
      if (err instanceof ArbabError) throw err;
      throw new ArbabError("io", `cannot copy input ${p.raw}: ${(err as Error).message}`, { cause: err });
    }
  }
  return planned.map((p) => p.name);
}

/** Removes <worktree>/.arbab-tmp/inputs without following a link there, and makes it again, empty; returns it. */
function clearInputs(worktree: string): string {
  const rel = join(WORKER_TMP_DIR, "inputs");
  const dest = join(realDir(worktree, WORKER_TMP_DIR), "inputs");
  let stat: Stats | null = null;
  try {
    stat = lstatSync(dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw new ArbabError("io", `cannot read ${dest}: ${(err as Error).message}`, { cause: err });
  }
  try {
    // A recursive remove unlinks the links inside; it never follows them.
    if (stat?.isDirectory() === true) rmSync(dest, { recursive: true, force: true });
    else if (stat !== null) unlinkSync(dest);
  } catch (err) {
    throw new ArbabError("io", `cannot remove ${dest}: ${(err as Error).message}`, { cause: err });
  }
  return realDir(worktree, rel);
}
