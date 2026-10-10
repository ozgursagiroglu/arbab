import { isAbsolute, join } from "node:path";
import type { BinaryInfo } from "../types";
import { ArbabError } from "../util/errors";

/** The first `x.y.z` in `text`, e.g. "2.1.295 (Claude Code)" → [2, 1, 295]. */
export function parseVersion(text: string): [number, number, number] | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  if (m === null) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Numeric per part: 2.1.295 > 2.1.29 (lexical order picked the wrong binary on machine 2). */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa === null || pb === null) {
    throw new ArbabError("binary", `cannot compare versions ${JSON.stringify(a)} and ${JSON.stringify(b)}`);
  }
  for (let i = 0; i < 3; i++) {
    const x = pa[i] as number;
    const y = pb[i] as number;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * The first `cmd` found in a colon-separated PATH. Empty and relative entries are skipped: they resolve against the
 * current directory, which a worktree controls.
 */
export function findOnPath(cmd: string, pathEnv: string, exists: (p: string) => boolean): string | null {
  if (cmd === "" || cmd.includes("/")) return null;
  for (const dir of pathEnv.split(":")) {
    if (dir === "" || !isAbsolute(dir)) continue;
    const candidate = join(dir, cmd);
    if (exists(candidate)) return candidate;
  }
  return null;
}

export interface ResolveBinaryOptions {
  /** The binary of the attempt this one resumes; a resumed session must keep it. */
  pinned: BinaryInfo | null;
  /** ARBAB_CLAUDE, read by the caller. */
  explicitPath: string | null;
  pathEnv: string;
  minVersion: string;
  run: (path: string, args: string[]) => string;
  exists: (p: string) => boolean;
  realpath: (p: string) => string;
}

export function resolveBinary(opts: ResolveBinaryOptions): BinaryInfo {
  if (opts.pinned !== null) return checkPinned(opts.pinned, opts);

  let found: string | null;
  if (opts.explicitPath !== null && opts.explicitPath !== "") {
    found = opts.exists(opts.explicitPath) ? opts.explicitPath : null;
    if (found === null) throw new ArbabError("binary", `ARBAB_CLAUDE ${opts.explicitPath} does not exist`);
  } else {
    found = findOnPath("claude", opts.pathEnv, opts.exists);
    if (found === null) throw new ArbabError("binary", "claude not found on PATH (set ARBAB_CLAUDE to its path)");
  }

  let path: string;
  try {
    path = opts.realpath(found);
  } catch (err) {
    throw new ArbabError("binary", `cannot resolve ${found}: ${(err as Error).message}`, { cause: err });
  }
  const version = readVersion(path, opts.run);
  if (compareVersions(version, opts.minVersion) < 0) {
    throw new ArbabError("binary", `claude ${version} at ${path} is older than the required ${opts.minVersion}`);
  }
  return { path, version };
}

function checkPinned(pinned: BinaryInfo, opts: ResolveBinaryOptions): BinaryInfo {
  const changed = (detail: string): ArbabError =>
    new ArbabError("binary", `binary changed since the attempt this one resumes: ${detail}`);
  if (!opts.exists(pinned.path)) throw changed(`${pinned.path} no longer exists`);
  let version: string;
  try {
    version = readVersion(pinned.path, opts.run);
  } catch (err) {
    throw changed((err as Error).message);
  }
  if (version !== pinned.version) throw changed(`${pinned.path} reports ${version}, not ${pinned.version}`);
  return { path: pinned.path, version };
}

function readVersion(path: string, run: ResolveBinaryOptions["run"]): string {
  let output: string;
  try {
    output = run(path, ["--version"]);
  } catch (err) {
    throw new ArbabError("binary", `${path} --version failed: ${(err as Error).message}`, { cause: err });
  }
  const parsed = parseVersion(output);
  if (parsed === null) {
    throw new ArbabError("binary", `${path} --version printed no version: ${JSON.stringify(output.slice(0, 200))}`);
  }
  return parsed.join(".");
}
