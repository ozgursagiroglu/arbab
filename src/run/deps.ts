import { spawnSync } from "node:child_process";
import { lstatSync, realpathSync, rmSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DEPS_PROJECT_ENV, DEPS_RUNNER_ENV, type DependencyContext, type DependencyStrategy } from "../types";
import { ArbabError } from "../util/errors";
import { readText } from "../util/fs";
import { cloneDirectory, defaultCloneDeps, missingRoot, type CloneDeps } from "./clone";
import type { GitRunner } from "./git";

/** `env` is merged over the process environment; without it the command gets the process environment as it is. */
export type ArgvRunner = (argv: string[], cwd: string, env?: Record<string, string>) => { code: number; output: string };

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
export const runArgv: ArgvRunner = (argv, cwd, env) => {
  const [command, ...args] = argv;
  if (command === undefined) return { code: 127, output: "empty command" };
  const r = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...(env !== undefined && { env: { ...process.env, ...env } }),
  });
  if (r.error) return { code: 127, output: r.error.message };
  return { code: r.status ?? 128, output: `${r.stdout}${r.stderr}` };
};

/**
 * The dependency manifests that differ, in a way an install cares about, between `context.installedAt` and the main
 * checkout's working tree: tracked changes (staged or not) and untracked files, filtered by isDependencyManifest, a
 * package.json only through installRelevantChange. Sorted, once each. A git call that fails is drift, never a match.
 */
export function manifestDrift(context: DependencyContext): string[] {
  const { projectRoot, installedAt } = context;
  if (installedAt === "" || installedAt.startsWith("-")) return [`<git failed: ${JSON.stringify(installedAt)} is not a revision>`];
  const git = (args: string[]): ReturnType<GitRunner> => context.git(args, projectRoot);
  const list = (args: string[]): string[] | string => {
    const r = git(args);
    if (r.code !== 0) return `<git failed: git ${args.join(" ")} (${r.code}): ${(r.stderr || r.stdout).trim()}>`;
    return r.stdout.split("\0").filter((p) => p !== "");
  };
  // --no-renames: a manifest moved away is a manifest gone.
  const tracked = list(["diff", "--name-only", "-z", "--no-renames", "--no-ext-diff", installedAt, "--"]);
  if (typeof tracked === "string") return [tracked];
  const untracked = list(["ls-files", "--others", "--exclude-standard", "-z"]);
  if (typeof untracked === "string") return [untracked];
  const out = new Set<string>();
  for (const path of new Set([...tracked, ...untracked])) {
    if (!isDependencyManifest(path)) continue;
    if ((path.split("/").at(-1) ?? "").toLowerCase() !== "package.json") {
      out.add(path);
      continue;
    }
    let after: string | null;
    try {
      after = readText(join(projectRoot, path));
    } catch {
      // Unreadable is not the same as unchanged.
      out.add(path);
      continue;
    }
    const before = fileAt(git, installedAt, path);
    // git listed it, so it differs: absent on both sides means something failed.
    if ((before === null && after === null) || installRelevantChange(path, before, after)) out.add(path);
  }
  return [...out].sort();
}

type Prepared = { ok: boolean; code: number; output: string };

function installArgv(argv: unknown, field: string): string[] {
  if (!Array.isArray(argv) || argv.length === 0 || !argv.every((a) => typeof a === "string") || argv[0] === "") {
    throw new ArbabError("config", `${field} must be a non-empty argv array of strings`);
  }
  return argv as string[];
}

function runInstall(argv: unknown, field: string, worktree: string, run: ArgvRunner, env: Record<string, string>): Prepared {
  const r = run(installArgv(argv, field), worktree, env);
  return { ok: r.code === 0, code: r.code, output: r.output };
}

/**
 * What every dependency command gets in its environment (DESIGN.md §23): the main checkout, and the runner when the
 * caller knows it, so a script can call `node "$ARBAB_RUNNER" clone-dir <src> <dst>`.
 */
export function dependencyEnv(context: DependencyContext | undefined): Record<string, string> {
  if (context === undefined) return {};
  return {
    [DEPS_PROJECT_ENV]: context.projectRoot,
    ...(context.runner !== undefined && context.runner !== "" && { [DEPS_RUNNER_ENV]: context.runner }),
  };
}

/** `name` bare, or by its path in a system directory: another `cp` on PATH need not behave like the system's. */
function isTool(word: string | undefined, name: string): boolean {
  return word === name || word === `/bin/${name}` || word === `/usr/bin/${name}`;
}

/**
 * The copy a command argv makes, before any file is looked at: its sources, its destination, and where each source
 * lands. Null for anything but the three shapes of DESIGN.md §23.
 */
function parseCopy(argv: string[]): { sources: string[]; dest: string; tool: "cp" | "ditto" | "rsync" } | null {
  const [command, ...words] = argv;
  let tool: "cp" | "ditto" | "rsync";
  let operands: string[];
  if (isTool(command, "cp")) {
    let i = 0;
    let recursive = false;
    for (; i < words.length && (words[i] ?? "").startsWith("-"); i++) {
      const flags = words[i] ?? "";
      if (!/^-[RcapP]+$/.test(flags)) return null;
      if (flags.includes("R")) recursive = true;
    }
    if (!recursive) return null;
    tool = "cp";
    operands = words.slice(i);
  } else if (isTool(command, "ditto")) {
    tool = "ditto";
    operands = words;
  } else if (isTool(command, "rsync")) {
    let i = 0;
    const flags = new Set<string>();
    for (; i < words.length && (words[i] ?? "").startsWith("-"); i++) {
      const flag = words[i] ?? "";
      if ((flag !== "-a" && flag !== "--delete") || flags.has(flag)) return null;
      flags.add(flag);
    }
    if (!flags.has("-a")) return null;
    // host:path is a remote copy unless a slash comes before the colon; no such source or destination is ours.
    if (words.slice(i).some((w) => w.includes(":"))) return null;
    tool = "rsync";
    operands = words.slice(i);
  } else {
    return null;
  }
  // An option after the operands, or before them in ditto: something this parser does not know.
  if (operands.length < 2 || operands.some((w) => w === "" || w.startsWith("-"))) return null;
  return { sources: operands.slice(0, -1), dest: operands.at(-1) ?? "", tool };
}

/**
 * The directories a `command` dependency strategy only copies from the main checkout (DESIGN.md §23), as clone pairs,
 * or null when the argv is anything else. Recognised: `cp` whose short-flag words hold `R` and nothing but `R`, `c`,
 * `a`, `p`, `P`, with one source and a destination whose parent directory exists, as cp requires; `ditto` with no flags
 * and one source; `rsync` with exactly `-a`, and optionally `--delete`. Each source, relative to the worktree (the
 * command's directory) or absolute, must not be a link itself, and its real path must be an existing directory inside
 * the real project root that does not hold the destination. The destination is a relative path inside the worktree
 * that does not exist yet: cp into an existing directory copies into it. Where a source lands follows the tool: the
 * destination itself for a cp or ditto source, or an rsync source ending in `/`; `<dst>/<name>` for an rsync source
 * without one. A shape whose result differs from that (several sources merged by ditto or by a trailing `/`, two
 * sources of one name) is not recognised.
 */
export function copyCommandDirs(argv: string[], projectRoot: string, worktree: string): Array<{ src: string; dst: string }> | null {
  const copy = parseCopy(argv);
  if (copy === null || isAbsolute(copy.dest)) return null;
  const several = copy.sources.length > 1;
  if (several && copy.tool === "ditto") return null;
  let root: string;
  let worktreeReal: string;
  try {
    root = realpathSync(projectRoot);
    worktreeReal = realpathSync(worktree);
  } catch {
    return null;
  }
  const base = resolve(worktree);
  const dest = resolve(base, copy.dest);
  if (!inside(base, dest) || present(dest)) return null;
  // cp copies several sources only into an existing directory, and makes no parent: anything else it would refuse.
  if (copy.tool === "cp" && (several || !isDirectory(dirname(dest)))) return null;
  const pairs: Array<{ src: string; dst: string }> = [];
  for (const source of copy.sources) {
    const abs = resolve(base, source);
    let src: string;
    try {
      if (lstatSync(abs).isSymbolicLink()) return null;
      src = realpathSync(abs);
      if (!statSync(src).isDirectory()) return null;
    } catch {
      return null;
    }
    if (!inside(root, src)) return null;
    const contents = source.endsWith("/");
    let dst: string;
    if (copy.tool === "rsync") dst = contents ? dest : join(dest, basename(abs));
    else dst = dest;
    // Merged into one destination: not one clone per source.
    if (contents && several) return null;
    if (pairs.some((p) => p.dst === dst)) return null;
    const at = realAncestor(dirname(dst));
    if (at === null || (at !== worktreeReal && !inside(worktreeReal, at))) return null;
    // A source that holds its own destination would be cloned into itself.
    if (at === src || inside(src, at)) return null;
    pairs.push({ src, dst });
  }
  return pairs;
}

/**
 * The command strategy. A command that only copies directories of the main checkout (copyCommandDirs) is cloned
 * instead, with the same result; when any clone fails, what this call made is removed and the command runs as given.
 * No manifest check: the command copies whatever the main checkout holds, and so does the clone.
 */
function commandDependencies(command: unknown, worktree: string, run: ArgvRunner, context: DependencyContext | undefined, deps: CloneDeps): Prepared {
  const argv = installArgv(command, "dependencies.command");
  const env = dependencyEnv(context);
  const pairs = context === undefined ? null : copyCommandDirs(argv, context.projectRoot, worktree);
  if (pairs === null) return runInstall(argv, "dependencies.command", worktree, run, env);
  const made: string[] = [];
  const lines: string[] = [];
  for (const { src, dst } of pairs) {
    const label = relative(resolve(worktree), dst);
    const top = missingRoot(dst);
    if (top !== null) made.push(top);
    let failure: string | null;
    try {
      const r = cloneDirectory(src, dst, deps);
      failure = r.ok ? null : `cloning ${label} failed (${r.how}): ${r.output.trim()}`;
      if (r.ok) lines.push(`cloned ${label} (${r.how})`);
    } catch (err) {
      failure = `cloning ${label} failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (failure !== null) {
      for (const path of made.reverse()) rmSync(path, { recursive: true, force: true });
      const r = runInstall(argv, "dependencies.command", worktree, run, env);
      return { ...r, output: `dependencies.command: ${failure}; running the command\n${r.output}` };
    }
  }
  return { ok: true, code: 0, output: lines.join("\n") };
}

/** Whether `path` lies inside `root` (both real paths), the root itself excluded. */
function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
}

/** The real path of `path`'s nearest existing ancestor (or of itself), or null when even the root fails. */
function realAncestor(path: string): string | null {
  for (let p = path; ; p = dirname(p)) {
    try {
      return realpathSync(p);
    } catch {
      if (dirname(p) === p) return null;
    }
  }
}

/**
 * The clone strategy (DESIGN.md §22): the main checkout's directories cloned copy-on-write into a worktree no worker
 * has run in, only while its manifests match the install point; otherwise the fallback install, or a failure naming
 * the difference. Every source and destination is checked before the first clone, so nothing falls back after a
 * partial clone: such a worktree is the shepherd's to discard.
 */
function cloneDependencies(
  strategy: Extract<DependencyStrategy, { strategy: "clone" }>,
  worktree: string,
  run: ArgvRunner,
  context: DependencyContext | undefined,
  deps: CloneDeps,
): Prepared {
  const fallBack = (reason: string): Prepared => {
    if (strategy.fallback === null) {
      return { ok: false, code: 1, output: `dependencies.clone: ${reason}; set dependencies.fallback to install instead` };
    }
    const r = runInstall(strategy.fallback, "dependencies.fallback", worktree, run, dependencyEnv(context));
    return { ...r, output: `dependencies.clone: ${reason}; running dependencies.fallback\n${r.output}` };
  };
  const refuse = (reason: string): Prepared => ({ ok: false, code: 1, output: `dependencies.clone: ${reason}` });

  const drift = context === undefined ? ["no install context"] : manifestDrift(context);
  if (drift.length > 0 || context === undefined) {
    return fallBack(`the main checkout's manifests differ from ${context?.installedAt ?? "the install point"}: ${drift.join(", ")}`);
  }

  let root: string;
  let worktreeReal: string;
  try {
    root = realpathSync(context.projectRoot);
    worktreeReal = realpathSync(worktree);
  } catch (err) {
    return refuse(`cannot resolve the main checkout or the worktree: ${err instanceof Error ? err.message : String(err)}`);
  }
  const pairs: Array<{ path: string; src: string; dst: string }> = [];
  for (const path of strategy.paths) {
    let src: string;
    try {
      src = realpathSync(join(context.projectRoot, path));
    } catch {
      // Missing, or a dangling link: nothing to clone, as when the manifests differ.
      return fallBack(`${path} does not exist in the main checkout`);
    }
    if (!inside(root, src)) return refuse(`${path} in the main checkout leads to ${src}, outside ${root}`);
    if (!statSync(src).isDirectory()) return fallBack(`${path} is not a directory in the main checkout`);
    const dst = join(worktree, path);
    if (present(dst)) return refuse(`${dst} already exists in the worktree`);
    const at = realAncestor(dirname(dst));
    if (at === null || (at !== worktreeReal && !inside(worktreeReal, at))) {
      return refuse(`${path} would be cloned through ${at ?? "an unresolvable path"}, outside the worktree ${worktreeReal}`);
    }
    pairs.push({ path, src, dst });
  }

  const lines: string[] = [];
  for (const { path, src, dst } of pairs) {
    const r = cloneDirectory(src, dst, deps);
    if (!r.ok) return refuse([...lines, `cloning ${path} failed (${r.how}): ${r.output.trim()}`].join("\n"));
    lines.push(`cloned ${path} (${r.how})`);
  }
  return { ok: true, code: 0, output: lines.join("\n") };
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

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Prepares a worktree's dependencies before the worker starts (DESIGN.md §9, §22, §23). `context` is what the clone
 * strategy compares against (the main checkout and the install point), and what every dependency command gets in its
 * environment (dependencyEnv); every caller passes it. `cloneDeps` is the clone's platform and runner, `run` with the
 * real platform unless a test injects them.
 */
export function prepareDependencies(
  strategy: DependencyStrategy,
  worktree: string,
  run: ArgvRunner,
  context?: DependencyContext,
  cloneDeps: CloneDeps = defaultCloneDeps(run),
): Prepared {
  if (strategy.strategy === "none") return { ok: true, code: 0, output: "" };
  if (strategy.strategy === "command") return commandDependencies(strategy.command, worktree, run, context, cloneDeps);
  if (strategy.strategy === "clone") return cloneDependencies(strategy, worktree, run, context, cloneDeps);
  throw new ArbabError("config", `unknown dependencies strategy ${JSON.stringify((strategy as { strategy: unknown }).strategy)}`);
}
