import { spawnSync } from "node:child_process";
import type { DependencyStrategy } from "../types";
import { ArbabError } from "../util/errors";
import type { GitRunner } from "./git";

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
  // bun's install config: registries, scopes.
  "bunfig.toml",
  // yarn PnP's loader, which yarn loads into the scripts it runs.
  ".pnp.cjs",
  ".pnp.loader.mjs",
];

const MANIFEST_NAMES = new Set(DEPENDENCY_MANIFESTS.map((name) => name.toLowerCase()));

/**
 * Patches applied to dependencies before their build scripts run (pnpm patchedDependencies, yarn patches,
 * patch-package's patches/*.patch).
 */
const PATCH_SUFFIX = ".patch";

/** yarn berry runs the release `yarnPath` names and loads its plugins on every install. */
const YARN_DIRECTORIES: readonly string[] = ["releases", "plugins", "patches"];

/**
 * Whether a repository path names a dependency manifest, at any depth: a name in DEPENDENCY_MANIFESTS, a `*.patch`
 * file, or a file under `.yarn/releases/`, `.yarn/plugins/` or `.yarn/patches/`. Case-insensitive: on a
 * case-insensitive file system `Package.json` is the file npm opens.
 */
export function isDependencyManifest(path: string): boolean {
  const segments = path.toLowerCase().split("/");
  const base = segments.at(-1) ?? "";
  if (MANIFEST_NAMES.has(base) || base.endsWith(PATCH_SUFFIX)) return true;
  // Directories only: the last segment is the file itself.
  for (let i = 0; i + 2 < segments.length; i++) {
    if (segments[i] === ".yarn" && YARN_DIRECTORIES.includes(segments[i + 1] ?? "")) return true;
  }
  return false;
}

/** The package.json fields a package manager reads when it installs. */
const INSTALL_FIELDS: readonly string[] = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "bundledDependencies",
  "bundleDependencies",
  "overrides",
  "resolutions",
  "pnpm",
  "workspaces",
  "packageManager",
  "dependenciesMeta",
  "peerDependenciesMeta",
  // Linked into node_modules/.bin, where scripts run them.
  "bin",
  // engine-strict, os, cpu and libc decide what installs; trustedDependencies which packages' scripts run (bun).
  "engines",
  "os",
  "cpu",
  "libc",
  "trustedDependencies",
  // It can make the package manager fetch and use another runtime.
  "devEngines",
];

/**
 * The scripts an install runs. npm 7 and later run `dependencies` after an install changes node_modules; pnpm runs
 * `pnpm:devPreinstall` from the root package.json before installing.
 */
const INSTALL_SCRIPTS: readonly string[] = [
  "preinstall",
  "install",
  "postinstall",
  "preprepare",
  "prepare",
  "postprepare",
  "prepublish",
  "dependencies",
  "pnpm:devPreinstall",
];

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** JSON with object keys sorted, so key order and formatting are not changes; an absent key is an undefined one. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (isPlainObject(v)) {
    const keys = Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "undefined";
}

const own = (o: Record<string, unknown>, key: string): unknown => (Object.hasOwn(o, key) ? o[key] : undefined);

/** What of a parsed package.json an install depends on; null when it is not an object npm could read. */
function installView(text: string): string | null {
  let pkg: unknown;
  try {
    pkg = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlainObject(pkg)) return null;
  const scripts = own(pkg, "scripts");
  // A `scripts` that is not an object is kept whole: what npm makes of it is not ours to guess.
  const lifecycle = scripts === undefined ? {} : isPlainObject(scripts) ? Object.fromEntries(INSTALL_SCRIPTS.map((s) => [s, own(scripts, s)])) : scripts;
  return canonical({ fields: Object.fromEntries(INSTALL_FIELDS.map((f) => [f, own(pkg, f)])), lifecycle });
}

/** Whether changing a manifest from `before` to `after` (file contents; null = absent) can change an install. */
export function installRelevantChange(path: string, before: string | null, after: string | null): boolean {
  if (before === after) return false;
  const base = (path.split("/").at(-1) ?? "").toLowerCase();
  if (base !== "package.json") return isDependencyManifest(path);
  if (before === null || after === null) return true;
  const a = installView(before);
  const b = installView(after);
  // A package.json that does not parse could mean anything to an install.
  return a === null || b === null || a !== b;
}

/** A file's contents at a commit (`git show <rev>:<path>`), or null when the commit has no such file. */
function fileAt(git: (args: string[]) => ReturnType<GitRunner>, rev: string, path: string): string | null {
  const r = git(["show", "--no-textconv", `${rev}:${path}`]);
  return r.code === 0 ? r.stdout : null;
}

/**
 * The dependency manifests among `paths` (what differs between the commits `from` and `to`) whose change can change
 * an install (installRelevantChange), once each, sorted. Only a package.json is read: any other manifest that differs
 * counts. One that git cannot show at either commit counts too.
 */
export function installRelevantPaths(git: (args: string[]) => ReturnType<GitRunner>, from: string, to: string, paths: string[]): string[] {
  const out = new Set<string>();
  for (const path of paths) {
    if (!isDependencyManifest(path)) continue;
    if ((path.split("/").at(-1) ?? "").toLowerCase() !== "package.json") {
      out.add(path);
      continue;
    }
    const before = fileAt(git, from, path);
    const after = fileAt(git, to, path);
    // The diff listed it, so it differs: when git shows it at neither commit, something failed.
    if ((before === null && after === null) || installRelevantChange(path, before, after)) out.add(path);
  }
  return [...out].sort();
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
