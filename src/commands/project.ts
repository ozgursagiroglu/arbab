import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { parseArgs, type ParseArgsConfig } from "node:util";
import { CONFIG_FILE, LOCAL_CONFIG_FILE, loadConfig } from "../config";
import type { GitRunner } from "../run";
import type { LaneState, ProjectConfig } from "../types";
import { ArbabError } from "../util/errors";
import { confine } from "../util/fs";
import { foldPath, sameOrInside } from "../util/pathcase";
import type { CommandContext } from "./context";

export interface LaneWorktreeIo {
  /** The path in the spelling on disk; throws when there is none. Default: `realpathSync.native`. */
  realpath?: (path: string) => string;
  /** A file's text; throws when it cannot be read. */
  readFile?: (path: string) => string;
}

// Case-insensitive file systems (macOS, Windows) take any spelling, so every comparison here goes through foldPath.
function hasWorktreesPair(path: string): boolean {
  const parts = path.split(sep).map(foldPath);
  return parts.some((part, i) => part === ".arbab" && parts[i + 1] === "worktrees");
}

/**
 * The worktree roots the configs at `dir` name, absolute: as written and, when the root exists, its real path, so a
 * `worktreeRoot` that is a link to elsewhere in the project (`wt` → `.arbab/pool`) covers lanes reached either way.
 * Only `worktreeRoot` is read, never the whole config: a broken file, or a root outside `dir` or at it (by either
 * spelling), adds nothing.
 */
function configuredWorktreeRoots(dir: string, io: Required<LaneWorktreeIo>): string[] {
  const roots: string[] = [];
  let realDir: string | null = null;
  try {
    realDir = io.realpath(dir);
  } catch {
    // Without the directory's real path, no real root can be shown to lie inside it.
  }
  for (const file of [CONFIG_FILE, LOCAL_CONFIG_FILE]) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(io.readFile(join(dir, file))) as unknown;
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
    const value = (parsed as Record<string, unknown>)["worktreeRoot"];
    if (typeof value !== "string" || value === "") continue;
    let full: string;
    try {
      full = confine(dir, value);
    } catch {
      continue;
    }
    if (full === resolve(dir)) continue;
    roots.push(full);
    let real: string;
    try {
      real = io.realpath(full);
    } catch {
      continue;
    }
    if (realDir !== null && sameOrInside(realDir, real) && foldPath(real) !== foldPath(realDir)) roots.push(real);
  }
  return roots;
}

function underConfiguredRoot(path: string, io: Required<LaneWorktreeIo>): boolean {
  for (let dir = path; ; dir = dirname(dir)) {
    if (configuredWorktreeRoots(dir, io).some((root) => sameOrInside(root, path))) return true;
    if (dirname(dir) === dir) return false;
  }
}

/**
 * Whether a path lies in a lane worktree, in its spelling on disk or as written: it has a `.arbab/worktrees` pair of
 * components, or an ancestor's arbab.config.json or .arbab/config.json sets a `worktreeRoot` the path is at or under,
 * as written or by the root's real path.
 */
export function inLaneWorktree(path: string, io: LaneWorktreeIo = {}): boolean {
  const full: Required<LaneWorktreeIo> = {
    realpath: io.realpath ?? ((p) => realpathSync.native(p)),
    readFile: io.readFile ?? ((p) => readFileSync(p, "utf8")),
  };
  const lexical = resolve(path);
  let canonical: string;
  try {
    canonical = full.realpath(lexical);
  } catch {
    canonical = lexical;
  }
  return [...new Set([canonical, lexical])].some((p) => hasWorktreesPair(p) || underConfiguredRoot(p, full));
}

/** A worker writes its worktree, so config found there is the worker's, not the human's: never load it. */
function notALaneWorktree(root: string): string {
  if (inLaneWorktree(root)) {
    throw new ArbabError("usage", `${root} is in a lane worktree, not a project; run arbab from the project root`);
  }
  return root;
}

/**
 * The nearest ancestor of `cwd` holding arbab.config.json, else the git top level, else null. A root inside a lane
 * worktree is a usage error.
 */
export function findProjectRoot(cwd: string, git: GitRunner): string | null {
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, CONFIG_FILE))) return notALaneWorktree(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const r = git(["rev-parse", "--show-toplevel"], cwd);
  const top = r.stdout.trim();
  return r.code === 0 && top !== "" ? notALaneWorktree(top) : null;
}

export interface Project {
  root: string;
  config: ProjectConfig;
  /** Absolute. */
  runsRoot: string;
  /** Absolute. */
  worktreeRoot: string;
}

export function openProject(ctx: Pick<CommandContext, "cwd" | "git">): Project {
  const root = findProjectRoot(ctx.cwd, ctx.git);
  if (root === null) {
    throw new ArbabError("usage", `no ${CONFIG_FILE} or git repository at or above ${ctx.cwd}`);
  }
  const config = loadConfig(root);
  return { root, config, runsRoot: confine(root, config.runsRoot), worktreeRoot: confine(root, config.worktreeRoot) };
}

/** Strict parseArgs; an unknown flag or a missing value is a usage error (exit 1). */
export function parse<T extends ParseArgsConfig>(command: string, config: T): ReturnType<typeof parseArgs<T>> {
  try {
    return parseArgs<T>({ ...config, strict: true });
  } catch (err) {
    throw new ArbabError("usage", `${(err as Error).message} (see arbab ${command} --help)`, { cause: err });
  }
}

export function onePositional(command: string, positionals: string[], what: string): string {
  const [value, ...rest] = positionals;
  if (value === undefined || rest.length > 0) throw new ArbabError("usage", `usage: arbab ${command} <${what}>`);
  return value;
}

export function printJson(ctx: Pick<CommandContext, "stdout">, value: unknown): void {
  ctx.stdout(JSON.stringify(value, null, 2) + "\n");
}

/** A lane whose shepherd may still act: anything but finished or orphaned. */
export const isActive = (state: LaneState): boolean => state !== "finished" && state !== "orphaned";
