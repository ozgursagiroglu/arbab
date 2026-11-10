import { lstatSync, mkdirSync, rmSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { ArbabError } from "../util/errors";
import type { ArgvRunner } from "./deps";

/**
 * One clonefile(2) call through ctypes: it clones a whole directory hierarchy at once, where `cp -cR` clones file by
 * file (2.7 s against 55.5 s on an 85,091-entry node_modules, DESIGN.md §22). Exits 1 on any failure (EEXIST, EXDEV,
 * ENOTSUP off APFS).
 */
export const CLONEFILE_PY = [
  "import ctypes,sys",
  'l=ctypes.CDLL("/usr/lib/libSystem.B.dylib",use_errno=True)',
  "l.clonefile.argtypes=[ctypes.c_char_p,ctypes.c_char_p,ctypes.c_uint32]",
  "sys.exit(0 if l.clonefile(sys.argv[1].encode(),sys.argv[2].encode(),0)==0 else 1)",
].join("\n");

export interface CloneDeps {
  platform: NodeJS.Platform;
  /** python3 and cp, as argv, never a shell. */
  run: ArgvRunner;
}

/** The real platform and runArgv; the only place this module reads process.platform. */
export function defaultCloneDeps(run: ArgvRunner): CloneDeps {
  return { platform: process.platform, run };
}

/** Whether anything, a dangling link included, is at `path`. */
function present(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * The outermost of `path` and its ancestors that does not exist: what creating `path` with its parents creates, and so
 * what removing undoes it. Null when `path` exists.
 */
export function missingRoot(path: string): string | null {
  if (present(path)) return null;
  let top = path;
  for (let p = dirname(path); p !== top && !present(p); p = dirname(p)) top = p;
  return top;
}

/**
 * Clones the directory `src` to `dst`, which must not exist (its parent is created). macOS: one clonefile(2) call
 * through `python3 -I -c <CLONEFILE_PY> <src> <dst>`; when that fails, a partial `dst` is removed and `cp -cR <src>
 * <dst>` runs. Linux and others: `cp -a --reflink=auto <src> <dst>`.
 */
export function cloneDirectory(src: string, dst: string, deps: CloneDeps): { ok: boolean; how: "clonefile" | "cp"; output: string } {
  if (!isAbsolute(src) || !isAbsolute(dst)) throw new ArbabError("usage", `clone paths must be absolute: ${JSON.stringify(src)} → ${JSON.stringify(dst)}`);
  const darwin = deps.platform === "darwin";
  // What is there is not ours to remove after a failed clone.
  if (present(dst)) return { ok: false, how: darwin ? "clonefile" : "cp", output: `${dst} already exists` };
  const parent = dirname(dst);
  mkdirSync(parent, { recursive: true });
  if (!darwin) {
    const r = deps.run(["cp", "-a", "--reflink=auto", src, dst], parent);
    return { ok: r.code === 0, how: "cp", output: r.output };
  }
  const py = deps.run(["python3", "-I", "-c", CLONEFILE_PY, src, dst], parent);
  if (py.code === 0) return { ok: true, how: "clonefile", output: py.output };
  rmSync(dst, { recursive: true, force: true });
  const cp = deps.run(["cp", "-cR", src, dst], parent);
  const why = `clonefile failed (${py.code})${py.output.trim() === "" ? "" : `: ${py.output.trim()}`}`;
  return { ok: cp.code === 0, how: "cp", output: `${why}\n${cp.output}` };
}
