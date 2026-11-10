import { existsSync, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { listAttempts, listLanes, readAttempt, runPaths } from "../registry";
import { copyCommandDirs, type ArgvRunner } from "../run";
import type { DependencyStrategy } from "../types";
import { readOptional, readPackageJson } from "./read";
import type { DoctorCheck } from "./types";

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The clone strategy's prerequisites (DESIGN.md §22): python3 for clonefile(2) on macOS, and each listed directory in
 * the main checkout. Warnings only, since the strategy still works without them, slower or through its fallback. Null
 * for any other strategy.
 */
export function checkClone(root: string, dependencies: DependencyStrategy, platform: NodeJS.Platform, run: ArgvRunner): DoctorCheck[] | null {
  if (dependencies.strategy !== "clone") return null;
  const warn = (detail: string): DoctorCheck => ({ status: "warn", check: "dependencies", detail });
  const out: DoctorCheck[] = [];
  if (platform === "darwin" && run(["python3", "-I", "-c", "import ctypes"], root).code !== 0) {
    out.push(warn("clone falls back to cp -cR, much slower, without python3"));
  }
  for (const path of dependencies.paths) {
    if (!isDirectory(join(root, path))) out.push(warn(`every launch will fall back: ${path} is missing`));
  }
  if (out.length > 0) return out;
  const how = platform === "darwin" ? "clonefile(2)" : "cp -a --reflink=auto";
  return [{ status: "ok", check: "dependencies", detail: `clone ${dependencies.paths.join(", ")} with ${how}` }];
}

/** How far back doctor reads preparation times, and the median above which it advises (DESIGN.md §23). */
export const PREPARE_WINDOW_DAYS = 14;
export const SLOW_PREPARE_MS = 30_000;

/**
 * The `prepareMs` of every attempt under `runsRoot` that started in the last PREPARE_WINDOW_DAYS days before `nowMs`,
 * resumes aside (they prepare nothing). A record that does not read, or holds no such number, is skipped.
 */
export function preparationTimes(runsRoot: string, nowMs: number): number[] {
  const since = nowMs - PREPARE_WINDOW_DAYS * 24 * 3600 * 1000;
  const out: number[] = [];
  for (const lane of listLanes(runsRoot)) {
    for (const n of listAttempts(runsRoot, lane)) {
      let started: unknown;
      try {
        started = readAttempt(runPaths(runsRoot, lane).attemptDir(n)).started;
      } catch {
        continue;
      }
      if (typeof started !== "object" || started === null) continue;
      const { resume, prepareMs, startedAt } = started as Record<string, unknown>;
      if (resume === true || typeof prepareMs !== "number" || !Number.isFinite(prepareMs) || prepareMs < 0) continue;
      const at = typeof startedAt === "string" ? Date.parse(startedAt) : Number.NaN;
      if (Number.isFinite(at) && at >= since) out.push(prepareMs);
    }
  }
  return out;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

interface Token {
  /** As written, quotes included. */
  raw: string;
  /** With quotes and escapes removed; variables stay as written. */
  value: string;
  /** `;`, `&&`, `|`, `(`, …: a place where a new command starts. */
  op: boolean;
}

const BREAKS = " \t;&|()";

/** The shell words of one script line, enough to find simple `cp` commands; an unterminated quote ends the line. */
function shellTokens(line: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < line.length) {
    const c = line[i] ?? "";
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if (c === "#") break;
    const op = /^(?:&&|\|\||;;|[;&|()])/.exec(line.slice(i));
    if (op !== null) {
      out.push({ raw: op[0], value: op[0], op: true });
      i += op[0].length;
      continue;
    }
    const start = i;
    let value = "";
    while (i < line.length && !BREAKS.includes(line[i] ?? "")) {
      const ch = line[i] ?? "";
      if (ch === "'" || ch === '"') {
        let end = i + 1;
        while (end < line.length && line[end] !== ch) end += ch === '"' && line[end] === "\\" ? 2 : 1;
        if (end >= line.length) return out;
        const inner = line.slice(i + 1, end);
        value += ch === '"' ? inner.replace(/\\(["\\$`])/g, "$1") : inner;
        i = end + 1;
      } else if (ch === "\\") {
        value += line[i + 1] ?? "";
        i += 2;
      } else {
        value += ch;
        i++;
      }
    }
    out.push({ raw: line.slice(start, i), value, op: false });
  }
  return out;
}

/** Words after which a new command starts, besides the operators. */
const COMMAND_STARTS = new Set(["then", "do", "else", "elif", "if", "while", "until", "!", "time", "exec", "command"]);

/** What doctor tells a script to run instead of a cp of the main checkout's node_modules (DESIGN.md §23). */
const CLONE_DIR_LINE = 'node "$ARBAB_RUNNER" clone-dir "$ARBAB_PROJECT_ROOT/node_modules" node_modules';

/**
 * The lines of a dependency script that copy the main checkout's `node_modules` with `cp`: a `-R` or `-r` among its
 * short flags, exactly a source and a destination, the destination exactly `node_modules` or `./node_modules`, and the
 * source either led by a variable (such as `$MAIN`) and ending in `/node_modules`, or the absolute path of `root`'s own
 * `node_modules`. Only that shape: the one replacement, CLONE_DIR_LINE, does what such a line does, and nothing else.
 */
export function scriptCopyLines(text: string, root: string): Array<{ line: number; src: string }> {
  let realRoot = resolve(root);
  try {
    realRoot = realpathSync(root);
  } catch {
    // Then only the root as given names its node_modules.
  }
  const own = new Set([join(resolve(root), "node_modules"), join(realRoot, "node_modules")]);
  const out: Array<{ line: number; src: string }> = [];
  text.split("\n").forEach((line, index) => {
    const tokens = shellTokens(line);
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const before = tokens[i - 1];
      if (t === undefined || t.op || (t.value !== "cp" && !t.value.endsWith("/cp"))) continue;
      if (before !== undefined && !before.op && !COMMAND_STARTS.has(before.value)) continue;
      let j = i + 1;
      let recursive = false;
      for (; j < tokens.length; j++) {
        const w = tokens[j];
        if (w === undefined || w.op || !w.value.startsWith("-") || w.value === "-") break;
        if (w.value === "--") {
          j++;
          break;
        }
        if (/^-[A-Za-z]+$/.test(w.value) && /[Rr]/.test(w.value)) recursive = true;
      }
      const operands: Token[] = [];
      for (; j < tokens.length; j++) {
        const w = tokens[j];
        if (w === undefined || w.op || /^[0-9]*[<>]/.test(w.raw)) break;
        operands.push(w);
      }
      const [src, dst] = operands;
      if (!recursive || operands.length !== 2 || src === undefined || dst === undefined) continue;
      if (dst.value !== "node_modules" && dst.value !== "./node_modules") continue;
      const source = src.value;
      const variable = source.startsWith("$") && source.endsWith("/node_modules");
      // An absolute source elsewhere (another project, a folder beside this one) is not the main checkout's.
      if (!variable && !(source.startsWith("/") && own.has(resolve(source)))) continue;
      out.push({ line: index + 1, src: src.raw });
    }
  });
  return out;
}

const SHELLS = new Set(["sh", "bash", "zsh"]);

/**
 * The script file a `sh|bash|zsh <file>` command runs, as a real path inside `root`; null for `-c` and anything else.
 * A relative file is the worktree's, which at the install point holds what the main checkout does.
 */
function scriptFile(argv: string[], root: string): string | null {
  const [shell, ...words] = argv;
  if (shell === undefined || !SHELLS.has(basename(shell))) return null;
  let i = 0;
  for (; i < words.length; i++) {
    const w = words[i] ?? "";
    if (w === "--") {
      i++;
      break;
    }
    if (!/^[-+]/.test(w)) break;
    if (w === "-o" || w === "+o") i++;
    else if (/^-[A-Za-z]*c/.test(w)) return null;
  }
  const file = words[i];
  if (file === undefined || file === "") return null;
  try {
    const real = realpathSync(isAbsolute(file) ? file : resolve(root, file));
    const rootReal = realpathSync(root);
    const rel = relative(rootReal, real);
    if (rel === "" || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel) || !statSync(real).isFile()) return null;
    return real;
  } catch {
    return null;
  }
}

/** Which package manager installs the project, by its lockfile or package.json `packageManager`; null when unknown. */
function packageManager(root: string): "pnpm" | "npm" | "yarn" | null {
  const declared = readPackageJson(root)?.["packageManager"];
  const name = typeof declared === "string" ? declared.split("@")[0] : undefined;
  if (name === "pnpm" || existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (name === "yarn" || existsSync(join(root, "yarn.lock"))) return "yarn";
  if (name === "npm" || existsSync(join(root, "package-lock.json")) || existsSync(join(root, "npm-shrinkwrap.json"))) return "npm";
  return null;
}

export interface PrepareTimeInput {
  root: string;
  runsRoot: string;
  dependencies: DependencyStrategy;
  nowMs: number;
  /**
   * Where doctor may make an empty directory to stand for a new worktree, so copyCommandDirs answers as it would at
   * launch: the worktree root when it exists, its relative paths then resolving at a worktree's depth.
   */
  scratchParent: string;
}

/**
 * doctor's dependency advice (DESIGN.md §23). When the median preparation of the last PREPARE_WINDOW_DAYS days exceeds
 * SLOW_PREPARE_MS and the strategy is a `command` that copyCommandDirs does not turn into clones, a warning with the
 * median, then what to change: for a `sh|bash|zsh` script in the project, its main-checkout `cp` lines and their
 * clone-dir replacements; for an npm or yarn project otherwise, the clone strategy. pnpm projects get the median only:
 * their install is offline already. Null when there is nothing to say.
 */
export function checkPrepareTime(input: PrepareTimeInput): DoctorCheck[] | null {
  const { dependencies, root } = input;
  if (dependencies.strategy !== "command") return null;
  const times = preparationTimes(input.runsRoot, input.nowMs);
  if (times.length === 0) return null;
  const m = median(times);
  if (m <= SLOW_PREPARE_MS) return null;
  const scratch = mkdtempSync(join(input.scratchParent, ".arbab-doctor-"));
  let recognised: boolean;
  try {
    recognised = copyCommandDirs(dependencies.command, root, scratch) !== null;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (recognised) return null;

  const warn = (detail: string): DoctorCheck => ({ status: "warn", check: "dependencies", detail });
  const out = [warn(`worktree preparation takes ${Math.round(m / 1000)}s per lane (median of ${times.length})`)];
  const manager = packageManager(root);
  if (manager === "pnpm") return out;
  const script = scriptFile(dependencies.command, root);
  const text = script === null ? null : readOptional(script);
  if (script !== null && text !== null) {
    const file = relative(realpathSync(root), script);
    const lines = scriptCopyLines(text, root).map((c) => warn(`${file}:${c.line}: use ${CLONE_DIR_LINE}`));
    // A variable may name another directory than the main checkout; doctor cannot tell, the orchestrator can.
    if (lines.length > 0) return [...out, ...lines, warn("check that each source above is the main checkout's node_modules before you change it")];
  }
  if (manager !== null) {
    const strategy = JSON.stringify({ strategy: "clone", paths: ["node_modules"], fallback: dependencies.command });
    out.push(warn(`clone node_modules instead of installing: set "dependencies": ${strategy} in arbab.config.json (DESIGN.md §22)`));
  }
  return out;
}
