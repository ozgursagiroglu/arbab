import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import type { Stats } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { workerTmpPaths } from "../run/workertmp";
import { ArbabError } from "../util/errors";

// A lane's inputs: files outside the repository its brief points at, which the fence keeps the worker from reading
// where they are (DESIGN.md §21). The shepherd copies them into the worktree, refusing anything that looks like a
// credential: the copy lands where the worker reads freely.

/** The most a lane's inputs may hold together, in bytes. */
export const MAX_INPUTS_BYTES = 50 * 1024 * 1024;

/** Home directories the fence denies (src/profile/presets.ts), plus ~/Library as a whole. */
const CREDENTIAL_DIRS: readonly string[] = [".ssh", ".aws", ".azure", ".config", ".docker", ".kube", ".gnupg", ".claude", "Library"];

/** The credential file patterns of src/profile/presets.ts, by file name. */
const CREDENTIAL_NAMES: readonly RegExp[] = [
  /^\.env/,
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /\.pfx$/,
  /^id_rsa/,
  /^id_ed25519/,
  /\.tfstate$/,
  /^\.npmrc$/,
  /^\.netrc$/,
  /^\.git-credentials$/,
];

export const isCredentialName = (name: string): boolean => CREDENTIAL_NAMES.some((re) => re.test(name));

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

interface Entry {
  /** Relative to the input; "" for the input itself. */
  rel: string;
  dir: boolean;
}

interface Planned {
  raw: string;
  name: string;
  source: string;
  entries: Entry[];
}

/**
 * Copies each lane input into <worktree>/.arbab-tmp/inputs/<basename>, replacing an earlier copy; returns the
 * names copied. Throws ArbabError("usage") naming the input on any refusal.
 */
export function copyInputs(input: { projectRoot: string; worktree: string; inputs: string[]; userHome: string }): string[] {
  const home = resolve(input.userHome);
  // Lexical and real: a home reached through a link is the same home.
  const homes = [...new Set([home, realOr(home)])];
  const worktree = realOr(resolve(input.worktree));
  const credentialDir = (path: string): string | null => {
    for (const h of homes) {
      const rel = relative(h, path);
      if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) continue;
      const first = rel.split(sep)[0] as string;
      if (CREDENTIAL_DIRS.includes(first)) return `~/${first}`;
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
      const dir = credentialDir(p);
      if (dir !== null) refuse(`is under ${dir}, where credentials live`);
    }
    if (stat.isFile() && isCredentialName(name)) refuse(`is named like a credential file (${name})`);
    if (stat.isDirectory() && homes.some((h) => within(real, h))) refuse("holds the home directory, credentials included");
    if (stat.isDirectory() && within(real, worktree)) refuse("holds the worktree it would be copied into");

    const entries: Entry[] = [];
    const add = (bytes: number): void => {
      total += bytes;
      if (total > MAX_INPUTS_BYTES) refuse(`brings the inputs over ${MAX_INPUTS_BYTES / 1024 / 1024} MB`);
    };
    if (stat.isFile()) {
      add(stat.size);
      entries.push({ rel: "", dir: false });
    } else {
      entries.push({ rel: "", dir: true });
      const walk = (rel: string): void => {
        for (const child of readdirSync(join(real, rel)).sort()) {
          const childRel = join(rel, child);
          const full = join(real, childRel);
          const s = lstatSync(full);
          // Links are skipped: one could point anywhere, a credential directory included.
          if (s.isSymbolicLink()) continue;
          if (s.isDirectory()) {
            const dir = credentialDir(full);
            if (dir !== null) refuse(`holds ${dir}, where credentials live`);
            entries.push({ rel: childRel, dir: true });
            walk(childRel);
          } else if (s.isFile()) {
            if (isCredentialName(child)) refuse(`holds ${childRel}, named like a credential file`);
            add(s.size);
            entries.push({ rel: childRel, dir: false });
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

  // Nothing is copied until every input passed.
  const dest = workerTmpPaths(input.worktree).inputs;
  mkdirSync(dest, { recursive: true });
  let copied = 0;
  for (const p of planned) {
    const target = join(dest, p.name);
    try {
      rmSync(target, { recursive: true, force: true });
      for (const e of p.entries) {
        const to = join(target, e.rel);
        if (e.dir) {
          mkdirSync(to, { recursive: true });
          continue;
        }
        // No-follow: a file swapped for a link since the walk is not followed into what it points at.
        const fd = openSync(join(p.source, e.rel), constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const s = fstatSync(fd);
          if (!s.isFile()) continue;
          copied += s.size;
          if (copied > MAX_INPUTS_BYTES) throw new ArbabError("usage", `input ${p.raw} grew over the inputs' limit while it was copied`);
          writeFileSync(to, readFileSync(fd), { mode: s.mode & 0o777 });
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
