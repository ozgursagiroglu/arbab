import { spawnSync } from "node:child_process";
import type { DependencyStrategy } from "../types";
import { ArbabError } from "../util/errors";

export type ArgvRunner = (argv: string[], cwd: string) => { code: number; output: string };

/**
 * Files a package manager reads as code or as install instructions: lifecycle scripts, hooks, registries. A tree a
 * worker wrote can change them, and the next dependency install there would run what it put there on the host,
 * outside the fence.
 */
export const DEPENDENCY_MANIFESTS: readonly string[] = [
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  ".npmrc",
  ".yarnrc",
  ".yarnrc.yml",
  ".pnpmfile.cjs",
  ".pnpmfile.mjs",
];

const MANIFEST_NAMES = new Set(DEPENDENCY_MANIFESTS.map((name) => name.toLowerCase()));

/**
 * Whether a repository path names a dependency manifest, at any depth. Case-insensitive: on a case-insensitive file
 * system `Package.json` is the file npm opens.
 */
export function isDependencyManifest(path: string): boolean {
  const base = path.split("/").at(-1) ?? "";
  return MANIFEST_NAMES.has(base.toLowerCase());
}

/** Runs an argv without a shell; stdout and stderr are concatenated in that order. */
export const runArgv: ArgvRunner = (argv, cwd) => {
  const [command, ...args] = argv;
  if (command === undefined) return { code: 127, output: "empty command" };
  const r = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { code: 127, output: r.error.message };
  return { code: r.status ?? 128, output: `${r.stdout}${r.stderr}` };
};

/** Prepares a worktree's dependencies before the worker starts (DESIGN.md §9). */
export function prepareDependencies(
  strategy: DependencyStrategy,
  worktree: string,
  run: ArgvRunner,
): { ok: boolean; code: number; output: string } {
  if (strategy.strategy === "none") return { ok: true, code: 0, output: "" };
  if (strategy.strategy === "command") {
    const argv: unknown = strategy.command;
    if (!Array.isArray(argv) || argv.length === 0 || !argv.every((a) => typeof a === "string") || argv[0] === "") {
      throw new ArbabError("config", "dependencies.command must be a non-empty argv array of strings");
    }
    const r = run(argv as string[], worktree);
    return { ok: r.code === 0, code: r.code, output: r.output };
  }
  throw new ArbabError("config", `unknown dependencies strategy ${JSON.stringify((strategy as { strategy: unknown }).strategy)}`);
}
