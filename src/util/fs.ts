import { randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { ArbabError } from "./errors";

/** Parsed JSON, or null when the file does not exist. A file that exists but does not parse is an error. */
export function readJson<T>(path: string): T | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new ArbabError("io", `cannot read ${path}: ${(err as Error).message}`, { cause: err });
  }
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new ArbabError("io", `${path} is not valid JSON: ${(err as Error).message}`, { cause: err });
  }
}

/** A file's text, or null when it does not exist. Any other read failure is an error. */
export function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new ArbabError("io", `cannot read ${path}: ${(err as Error).message}`, { cause: err });
  }
}

/** Writes through a temporary file in the same directory and renames it, so readers never see a partial file. */
export function writeTextAtomic(path: string, text: string): void {
  ensureDir(dirname(path));
  const tmp = join(dirname(path), `.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(tmp, text, { flag: "wx" });
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw new ArbabError("io", `cannot write ${path}: ${(err as Error).message}`, { cause: err });
  }
}

export function writeJsonAtomic(path: string, value: unknown): void {
  writeTextAtomic(path, JSON.stringify(value, null, 2) + "\n");
}

/**
 * Creates a file only if it does not exist (O_EXCL). Returns false when it already exists, so callers can use it as
 * a lock or a never-overwrite guard.
 */
export function createExclusive(path: string, data: string): boolean {
  ensureDir(dirname(path));
  let fd: number;
  try {
    fd = openSync(path, "wx");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw new ArbabError("io", `cannot create ${path}: ${(err as Error).message}`, { cause: err });
  }
  try {
    writeSync(fd, data);
  } finally {
    closeSync(fd);
  }
  return true;
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

/**
 * Resolves `candidate` against `root` and refuses anything that escapes it (`..`, an absolute path elsewhere).
 * The check is lexical; callers that follow symlinks must realpath existing paths first.
 */
export function confine(root: string, candidate: string): string {
  const base = resolve(root);
  const full = resolve(base, candidate);
  const rel = relative(base, full);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return full;
  throw new ArbabError("usage", `path ${candidate} is outside ${base}`);
}
