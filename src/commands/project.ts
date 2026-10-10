import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs, type ParseArgsConfig } from "node:util";
import { CONFIG_FILE, loadConfig } from "../config";
import type { GitRunner } from "../run";
import type { LaneState, ProjectConfig } from "../types";
import { ArbabError } from "../util/errors";
import { confine } from "../util/fs";
import type { CommandContext } from "./context";

/** The nearest ancestor of `cwd` holding arbab.config.json, else the git top level, else null. */
export function findProjectRoot(cwd: string, git: GitRunner): string | null {
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, CONFIG_FILE))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const r = git(["rev-parse", "--show-toplevel"], cwd);
  const top = r.stdout.trim();
  return r.code === 0 && top !== "" ? top : null;
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
