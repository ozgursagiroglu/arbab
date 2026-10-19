#!/usr/bin/env node

// src/cli.ts
import { readFileSync as readFileSync2 } from "node:fs";

// src/util/errors.ts
var ArbabError = class extends Error {
  code;
  constructor(code4, message4, options) {
    super(message4, options);
    this.name = "ArbabError";
    this.code = code4;
  }
};
var EXIT_CODES = {
  usage: 1,
  lint: 1,
  config: 1,
  binary: 2,
  io: 2,
  git: 2,
  lock: 2,
  lease: 2,
  runtime: 2
};
function exitCodeFor(err) {
  return err instanceof ArbabError ? EXIT_CODES[err.code] : 2;
}

// src/commands/cleanup.ts
import { existsSync as existsSync11, rmSync as rmSync5, statSync as statSync5 } from "node:fs";
import { join as join20 } from "node:path";

// src/integrate/integrate.ts
import { existsSync as existsSync2, readdirSync as readdirSync3, realpathSync as realpathSync3, renameSync as renameSync3 } from "node:fs";
import { dirname as dirname3, join as join6, relative as relative4, resolve as resolve6, sep as sep3 } from "node:path";

// src/config/lane.ts
import { resolve as resolve2 } from "node:path";

// src/config/check.ts
import { realpathSync, statSync } from "node:fs";
import { isAbsolute as isAbsolute2, relative as relative2, sep } from "node:path";

// src/types.ts
var ROLES = ["implementer", "verifier", "reviewer", "researcher", "probe"];
var EFFORTS = ["low", "medium", "high", "xhigh", "max"];
var INTEGRATIONS_DIR = ".arbab/integrations";
var TIERS = ["low", "medium", "high"];
var NO_FREE_SLOT_REASON = "no free slot";

// src/util/fs.ts
import { randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
function readJson(path) {
  let text2;
  try {
    text2 = readFileSync(path, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw new ArbabError("io", `cannot read ${path}: ${err.message}`, { cause: err });
  }
  try {
    return JSON.parse(text2);
  } catch (err) {
    throw new ArbabError("io", `${path} is not valid JSON: ${err.message}`, { cause: err });
  }
}
function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw new ArbabError("io", `cannot read ${path}: ${err.message}`, { cause: err });
  }
}
function writeTextAtomic(path, text2) {
  ensureDir(dirname(path));
  const tmp = join(dirname(path), `.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(tmp, text2, { flag: "wx" });
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw new ArbabError("io", `cannot write ${path}: ${err.message}`, { cause: err });
  }
}
function writeJsonAtomic(path, value) {
  writeTextAtomic(path, JSON.stringify(value, null, 2) + "\n");
}
function createExclusive(path, data) {
  ensureDir(dirname(path));
  let fd;
  try {
    fd = openSync(path, "wx");
  } catch (err) {
    if (err.code === "EEXIST") return false;
    throw new ArbabError("io", `cannot create ${path}: ${err.message}`, { cause: err });
  }
  try {
    writeSync(fd, data);
  } finally {
    closeSync(fd);
  }
  return true;
}
function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}
function confine(root, candidate) {
  const base = resolve(root);
  const full = resolve(base, candidate);
  const rel = relative(base, full);
  if (rel === "" || !rel.startsWith("..") && !isAbsolute(rel)) return full;
  throw new ArbabError("usage", `path ${candidate} is outside ${base}`);
}

// src/util/names.ts
var NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;
function isValidName(name2) {
  return typeof name2 === "string" && NAME.test(name2);
}
function assertValidName(name2, what = "name") {
  if (!isValidName(name2)) {
    throw new ArbabError("usage", `${what} ${JSON.stringify(name2)} must match ${NAME.source}`);
  }
  return name2;
}
function envSuffix(name2) {
  return assertValidName(name2).replace(/-/g, "_").toUpperCase();
}

// src/config/check.ts
function fail(field, message4) {
  throw new ArbabError("config", `${field}: ${message4}`);
}
function readJsonFile(path) {
  const text2 = readText(path);
  if (text2 === null) return null;
  try {
    return JSON.parse(text2);
  } catch (err) {
    throw new ArbabError("config", `${path} is not valid JSON: ${err.message}`, { cause: err });
  }
}
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function record(v, field) {
  if (!isRecord(v)) fail(field, "must be an object");
  return v;
}
function knownKeys(obj, allowed, field) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) fail(field === "" ? key : `${field}.${key}`, "unknown key");
  }
}
function nonEmptyString(v, field) {
  if (typeof v !== "string" || v.trim() === "") fail(field, "must be a non-empty string");
  return v;
}
function stringArray(v, field) {
  if (!Array.isArray(v)) fail(field, "must be an array of strings");
  return v.map((item, i) => nonEmptyString(item, `${field}[${i}]`));
}
function argv(v, field) {
  if (!Array.isArray(v) || v.length === 0) fail(field, "must be a non-empty array of strings");
  return stringArray(v, field);
}
function boolean(v, field) {
  if (typeof v !== "boolean") fail(field, "must be true or false");
  return v;
}
function positiveNumber(v, field) {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) fail(field, "must be a positive number");
  return v;
}
function integerIn(v, lo, hi, field) {
  if (!Number.isInteger(v) || v < lo || v > hi) {
    fail(field, `must be an integer from ${lo} to ${hi}`);
  }
  return v;
}
function name(v, field) {
  if (!isValidName(v)) fail(field, `${JSON.stringify(v)} must match ^[a-z0-9][a-z0-9-]{0,47}$`);
  return v;
}
function nameArray(v, field) {
  if (!Array.isArray(v)) fail(field, "must be an array of names");
  return v.map((item, i) => name(item, `${field}[${i}]`));
}
function role(v, field) {
  if (!ROLES.includes(v)) fail(field, `must be one of ${ROLES.join(", ")}`);
  return v;
}
function effort(v, field) {
  if (!EFFORTS.includes(v)) fail(field, `must be one of ${EFFORTS.join(", ")}`);
  return v;
}
function ref(v, field) {
  const s = nonEmptyString(v, field);
  if (s.startsWith("-") || /\s/.test(s)) fail(field, "must not start with '-' or contain whitespace");
  return s;
}
function confined(root, v, field) {
  const s = nonEmptyString(v, field);
  try {
    return confine(root, s);
  } catch {
    return fail(field, `${s} is outside the project`);
  }
}
function existingFile(projectRoot, v, field) {
  const s = nonEmptyString(v, field);
  const full = confined(projectRoot, s, field);
  let real;
  try {
    if (!statSync(full).isFile()) fail(field, `${s} is not a file`);
    real = realpathSync(full);
  } catch (err) {
    if (err instanceof ArbabError) throw err;
    return fail(field, `${s} does not exist`);
  }
  const rel = relative2(realpathSync(projectRoot), real);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute2(rel)) fail(field, `${s} resolves outside the project`);
  return s;
}
var ROLE_FIELDS = [
  "tools",
  "model",
  "effort",
  "budgetUsd",
  "wallMin",
  "idleMin",
  "loopback",
  "checkpoint",
  "autoResume",
  "maxAttempts"
];
var MAX_ATTEMPTS = 10;
function roleOverrides(v, field) {
  const obj = record(v, field);
  knownKeys(obj, ROLE_FIELDS, field);
  const out = {};
  const f = (key) => `${field}.${key}`;
  if (obj.tools !== void 0) out.tools = stringArray(obj.tools, f("tools"));
  if (obj.model !== void 0) out.model = nonEmptyString(obj.model, f("model"));
  if (obj.effort !== void 0) out.effort = effort(obj.effort, f("effort"));
  if (obj.budgetUsd !== void 0) out.budgetUsd = positiveNumber(obj.budgetUsd, f("budgetUsd"));
  if (obj.wallMin !== void 0) out.wallMin = positiveNumber(obj.wallMin, f("wallMin"));
  if (obj.idleMin !== void 0) out.idleMin = positiveNumber(obj.idleMin, f("idleMin"));
  if (obj.loopback !== void 0) out.loopback = boolean(obj.loopback, f("loopback"));
  if (obj.checkpoint !== void 0) out.checkpoint = boolean(obj.checkpoint, f("checkpoint"));
  if (obj.autoResume !== void 0) out.autoResume = boolean(obj.autoResume, f("autoResume"));
  if (obj.maxAttempts !== void 0) out.maxAttempts = integerIn(obj.maxAttempts, 1, MAX_ATTEMPTS, f("maxAttempts"));
  return out;
}

// src/config/lane.ts
var LANE_KEYS = [
  "name",
  "role",
  "brief",
  "base",
  "worktree",
  "tools",
  "model",
  "effort",
  "budgetUsd",
  "wallMin",
  "idleMin",
  "fence",
  "allow",
  "schema",
  "resources",
  "semaphores",
  "checkpoint",
  "autoResume",
  "maxAttempts",
  "coordination",
  "upstream",
  "mergeBranches"
];
var PHASE_LANE_KEYS = [
  "role",
  "model",
  "effort",
  "budgetUsd",
  "wallMin",
  "idleMin",
  "fence",
  "allow",
  "schema",
  "resources",
  "semaphores",
  "worktree",
  "checkpoint",
  "autoResume",
  "maxAttempts"
];
var FENCES = ["strict", "sandbox-auto"];
var INTEGRATION_WORKTREE_PREFIX = "integrate-";
function worktreeName(v, field) {
  const valid = name(v, field);
  if (valid.startsWith(INTEGRATION_WORKTREE_PREFIX)) {
    fail(field, `${JSON.stringify(valid)} must not start with ${INTEGRATION_WORKTREE_PREFIX}: those worktrees are reserved for arbab integrate`);
  }
  return valid;
}
var TOOL_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;
function toolList(v, field) {
  if (!Array.isArray(v) || v.length === 0) fail(field, "must be a non-empty array of tool names");
  const seen = /* @__PURE__ */ new Set();
  return v.map((item, i) => {
    if (typeof item !== "string" || !TOOL_NAME.test(item)) fail(`${field}[${i}]`, `${JSON.stringify(item)} is not a tool name`);
    if (seen.has(item)) fail(`${field}[${i}]`, `${item} is listed twice`);
    seen.add(item);
    return item;
  });
}
function phaseLaneFields(projectRoot, obj, prefix = "") {
  const f = (key) => prefix === "" ? key : `${prefix}.${key}`;
  const out = {};
  if (obj.role !== void 0) out.role = role(obj.role, f("role"));
  if (obj.worktree !== void 0) out.worktree = worktreeName(obj.worktree, f("worktree"));
  if (obj.model !== void 0) out.model = nonEmptyString(obj.model, f("model"));
  if (obj.effort !== void 0) out.effort = effort(obj.effort, f("effort"));
  if (obj.budgetUsd !== void 0) out.budgetUsd = positiveNumber(obj.budgetUsd, f("budgetUsd"));
  if (obj.wallMin !== void 0) out.wallMin = positiveNumber(obj.wallMin, f("wallMin"));
  if (obj.idleMin !== void 0) out.idleMin = positiveNumber(obj.idleMin, f("idleMin"));
  if (obj.fence !== void 0) {
    if (!FENCES.includes(obj.fence)) fail(f("fence"), `must be one of ${FENCES.join(", ")}`);
    out.fence = obj.fence;
  }
  if (obj.allow !== void 0) out.allow = stringArray(obj.allow, f("allow"));
  if (obj.schema !== void 0) out.schema = existingFile(projectRoot, obj.schema, f("schema"));
  if (obj.resources !== void 0) {
    const res = record(obj.resources, f("resources"));
    out.resources = {};
    for (const [type, count] of Object.entries(res)) {
      name(type, f(`resources.${type}`));
      out.resources[type] = integerIn(count, 1, 8, f(`resources.${type}`));
    }
  }
  if (obj.semaphores !== void 0) out.semaphores = nameArray(obj.semaphores, f("semaphores"));
  if (obj.checkpoint !== void 0) out.checkpoint = boolean(obj.checkpoint, f("checkpoint"));
  if (obj.autoResume !== void 0) out.autoResume = boolean(obj.autoResume, f("autoResume"));
  if (obj.maxAttempts !== void 0) {
    out.maxAttempts = integerIn(obj.maxAttempts, 1, MAX_ATTEMPTS, f("maxAttempts"));
  }
  return out;
}
function loadLane(projectRoot, lanePath) {
  const file = resolve2(projectRoot, lanePath);
  const raw = readJsonFile(file);
  if (raw === null) throw new ArbabError("usage", `lane file ${lanePath} does not exist`);
  const obj = record(raw, lanePath);
  knownKeys(obj, LANE_KEYS, "");
  const lane = {
    name: worktreeName(obj.name, "name"),
    role: role(obj.role, "role"),
    brief: existingFile(projectRoot, obj.brief, "brief")
  };
  if (obj.base !== void 0) lane.base = ref(obj.base, "base");
  if (obj.tools !== void 0) lane.tools = toolList(obj.tools, "tools");
  Object.assign(lane, phaseLaneFields(projectRoot, obj));
  if (obj.coordination !== void 0) {
    if (typeof obj.coordination !== "string") fail("coordination", "must be a string");
    lane.coordination = obj.coordination;
  }
  if (obj.upstream !== void 0) lane.upstream = nameArray(obj.upstream, "upstream");
  if (obj.mergeBranches !== void 0) {
    if (!Array.isArray(obj.mergeBranches)) fail("mergeBranches", "must be an array of branch names");
    lane.mergeBranches = obj.mergeBranches.map((b, i) => ref(b, `mergeBranches[${i}]`));
  }
  return lane;
}

// src/run/git.ts
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, realpathSync as realpathSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname as dirname2, isAbsolute as isAbsolute3, join as join2, relative as relative3, resolve as resolve3, sep as sep2 } from "node:path";
function makeGitRunner(env2) {
  return (args, cwd) => {
    const r = spawnSync("git", args, { cwd, env: env2, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.error) return { code: 127, stdout: "", stderr: r.error.message };
    return { code: r.status ?? 128, stdout: r.stdout, stderr: r.stderr };
  };
}
var nodeGit = makeGitRunner();
function must(git, args, cwd, options = []) {
  const r = git([...options, ...args], cwd);
  if (r.code !== 0) {
    throw new ArbabError("git", `git ${args.join(" ")} failed (${r.code}): ${(r.stderr || r.stdout).trim()}`);
  }
  return r.stdout;
}
function ensureIgnored(projectRoot, entries2, git) {
  const excludeRel = must(git, ["rev-parse", "--git-path", "info/exclude"], projectRoot).trim();
  if (excludeRel === "") throw new ArbabError("git", "git rev-parse --git-path info/exclude printed nothing");
  const exclude = resolve3(projectRoot, excludeRel);
  const text2 = readText(exclude) ?? "";
  const present = new Set(text2.split(/\r?\n/).map((line) => line.trim()));
  const missing = entries2.filter((entry) => !present.has(entry));
  if (missing.length > 0) {
    const prefix = text2 === "" || text2.endsWith("\n") ? "" : "\n";
    ensureDir(dirname2(exclude));
    writeFileSync2(exclude, text2 + prefix + missing.join("\n") + "\n");
  }
  for (const entry of entries2) {
    const probe = `${entry.replace(/\/+$/, "")}/x`;
    const r = git(["check-ignore", "-q", "--", probe], projectRoot);
    if (r.code !== 0) throw new ArbabError("git", `${entry} is not ignored by git in ${projectRoot}`);
  }
}
function canonical(path) {
  try {
    return realpathSync2(path);
  } catch {
    return resolve3(path);
  }
}
function listWorktrees(projectRoot, git) {
  const out = /* @__PURE__ */ new Map();
  for (const block of must(git, ["worktree", "list", "--porcelain"], projectRoot).split("\n\n")) {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice("worktree ".length);
    if (path === void 0) continue;
    out.set(canonical(path), lines.find((l) => l.startsWith("branch "))?.slice("branch ".length) ?? null);
  }
  return out;
}
function branchExists(projectRoot, branch, git) {
  return git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], projectRoot).code === 0;
}
function refuseWorkerBranch(projectRoot, branch, base, path, git) {
  const r = git(["merge-base", "--is-ancestor", `refs/heads/${branch}`, base], projectRoot);
  if (r.code === 0) return;
  if (r.code !== 1) {
    throw new ArbabError("git", `git merge-base --is-ancestor refs/heads/${branch} ${base} failed (${r.code}): ${(r.stderr || r.stdout).trim()}`);
  }
  throw new ArbabError(
    "git",
    `the worktree ${path} is missing, and its branch ${branch} holds worker commits that are not on ${base}; arbab installs dependencies only on a trusted base. Restore the worktree at ${path}, or delete the branch ${branch}`
  );
}
function assertRevision(rev, what) {
  if (rev === "" || rev.startsWith("-")) throw new ArbabError("usage", `${what} ${JSON.stringify(rev)} is not a valid revision`);
  return rev;
}
function commonDir(projectRoot, git) {
  const out = must(git, ["rev-parse", "--git-common-dir"], projectRoot).trim();
  if (out === "") throw new ArbabError("git", "git rev-parse --git-common-dir printed nothing");
  return canonical(resolve3(projectRoot, out));
}
function createWorktree(input) {
  const lane = assertValidName(input.lane, "lane");
  const path = join2(confine(input.projectRoot, input.root), lane);
  const branch = `arbab/${lane}`;
  if (existsSync(path)) {
    const ref2 = listWorktrees(input.projectRoot, input.git).get(canonical(path));
    if (ref2 !== void 0) {
      if (ref2 !== `refs/heads/${branch}`) {
        throw new ArbabError("git", `${path} is a worktree on ${ref2 ?? "a detached HEAD"}, not on ${branch}; lane ${lane} cannot run there`);
      }
      return { path, branch, created: false, gitCommonDir: commonDir(input.projectRoot, input.git) };
    }
  }
  const trusted = assertRevision(input.trustedBase, "trusted base");
  if (typeof input.base === "string") assertRevision(input.base, "base");
  must(input.git, ["worktree", "prune"], input.projectRoot);
  ensureDir(dirname2(path));
  if (branchExists(input.projectRoot, branch, input.git)) {
    refuseWorkerBranch(input.projectRoot, branch, trusted, path, input.git);
    must(input.git, ["worktree", "add", path, branch], input.projectRoot, untrustedTree());
  } else {
    const base = assertRevision(typeof input.base === "string" ? input.base : input.base(), "base");
    must(input.git, ["worktree", "add", "-b", branch, path, base], input.projectRoot, untrustedTree());
  }
  return { path, branch, created: true, gitCommonDir: commonDir(input.projectRoot, input.git) };
}
function discardWorktree(input) {
  const lane = assertValidName(input.lane, "lane");
  const path = join2(confine(input.projectRoot, input.root), lane);
  const branch = `arbab/${lane}`;
  const sources = input.sources.map((s) => assertRevision(s, "source"));
  const head = branchExists(input.projectRoot, branch, input.git);
  const keeps = [];
  if (head) {
    const extra = must(input.git, ["rev-list", `refs/heads/${branch}`, "--not", ...sources, "--"], input.projectRoot).split("\n").filter((l) => l !== "");
    if (extra.length > 0) {
      const shown = extra.slice(0, 3).join(", ") + (extra.length > 3 ? ` and ${extra.length - 3} more` : "");
      keeps.push(`commits on ${branch} that are not on its base, its merge branches or the trusted base: ${shown}`);
    }
  }
  if (existsSync(path)) {
    const verified = verifyWorktreeGit({ worktree: path, branch, gitCommonDir: input.gitCommonDir });
    if (verified.gitDir === null) {
      keeps.push(`a git dir that cannot be verified (${verified.error})`);
    } else {
      const changes = worktreeStatus(path, verified.gitDir, input.git);
      if (changes.length > 0) {
        const shown = changes.slice(0, 5).join("; ") + (changes.length > 5 ? `; and ${changes.length - 5} more` : "");
        keeps.push(`uncommitted changes (${shown})`);
      }
    }
  }
  if (keeps.length > 0) {
    throw new ArbabError(
      "git",
      `no worker has run in ${path}, but it holds what arbab cannot rebuild: ${keeps.join("; ")}. arbab will neither install dependencies there nor remove it. Keep what you need, remove the worktree and the branch ${branch}, then launch ${lane} again`
    );
  }
  if (existsSync(path)) must(input.git, ["worktree", "remove", "--force", path], input.projectRoot, untrustedTree());
  must(input.git, ["worktree", "prune"], input.projectRoot);
  if (head) must(input.git, ["branch", "-D", branch], input.projectRoot, untrustedTree());
}
function verifyWorktreeGit(input) {
  const fail2 = (error) => ({ gitDir: null, error });
  const read2 = (path) => {
    try {
      return readText(path);
    } catch {
      return null;
    }
  };
  const common = canonical(input.gitCommonDir);
  const pointer = /^gitdir: (.+)$/.exec((read2(join2(input.worktree, ".git")) ?? "").trim());
  if (pointer?.[1] === void 0) return fail2(`${join2(input.worktree, ".git")} is not a worktree's gitdir pointer`);
  const gitDir = canonical(resolve3(input.worktree, pointer[1]));
  const rel = relative3(join2(common, "worktrees"), gitDir);
  if (rel === "" || rel.startsWith("..") || isAbsolute3(rel) || rel.includes(sep2)) {
    return fail2(`git dir ${gitDir} is not under ${join2(common, "worktrees")}`);
  }
  const head = read2(join2(gitDir, "HEAD"))?.trim();
  if (head !== `ref: refs/heads/${input.branch}`) return fail2(`HEAD of ${gitDir} is ${JSON.stringify(head ?? null)}, not ref: refs/heads/${input.branch}`);
  const commondir = read2(join2(gitDir, "commondir"))?.trim();
  if (commondir === void 0 || commondir === "" || canonical(resolve3(gitDir, commondir)) !== common) {
    return fail2(`commondir of ${gitDir} does not lead to ${common}`);
  }
  return { gitDir, error: null };
}
function explicitGit(gitDir, worktree) {
  return [`--git-dir=${gitDir}`, `--work-tree=${worktree}`];
}
function untrustedTree() {
  return [
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "diff.ignoreSubmodules=all",
    "-c",
    "submodule.recurse=false"
  ];
}
function holdsGit(path) {
  try {
    lstatSync(join2(path, ".git"));
    return true;
  } catch {
    return false;
  }
}
function indexGitlinks(worktree, gitDir, git) {
  return must(git, [...explicitGit(gitDir, worktree), "ls-files", "-s", "-z"], worktree, untrustedTree()).split("\0").filter((entry) => entry.startsWith("160000 ")).map((entry) => entry.slice(entry.indexOf("	") + 1)).filter((path) => path !== "");
}
function worktreeStatus(worktree, gitDir, git) {
  const args = [...explicitGit(gitDir, worktree), "status", "--porcelain", "--ignore-submodules=all"];
  const lines = must(git, args, worktree, untrustedTree()).split("\n").filter((line) => line.trim() !== "");
  const nested = indexGitlinks(worktree, gitDir, git).filter((path) => holdsGit(join2(worktree, path))).map((path) => `?? ${path}/`);
  return [...lines, ...nested.filter((line) => !lines.includes(line))];
}

// src/run/deps.ts
import { spawnSync as spawnSync2 } from "node:child_process";
var DEPENDENCY_MANIFESTS = [
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
  ".pnpmfile.mjs"
];
var MANIFEST_NAMES = new Set(DEPENDENCY_MANIFESTS.map((name2) => name2.toLowerCase()));
function isDependencyManifest(path) {
  const base = path.split("/").at(-1) ?? "";
  return MANIFEST_NAMES.has(base.toLowerCase());
}
var runArgv = (argv2, cwd) => {
  const [command, ...args] = argv2;
  if (command === void 0) return { code: 127, output: "empty command" };
  const r = spawnSync2(command, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { code: 127, output: r.error.message };
  return { code: r.status ?? 128, output: `${r.stdout}${r.stderr}` };
};
function prepareDependencies(strategy, worktree, run) {
  if (strategy.strategy === "none") return { ok: true, code: 0, output: "" };
  if (strategy.strategy === "command") {
    const argv2 = strategy.command;
    if (!Array.isArray(argv2) || argv2.length === 0 || !argv2.every((a) => typeof a === "string") || argv2[0] === "") {
      throw new ArbabError("config", "dependencies.command must be a non-empty argv array of strings");
    }
    const r = run(argv2, worktree);
    return { ok: r.code === 0, code: r.code, output: r.output };
  }
  throw new ArbabError("config", `unknown dependencies strategy ${JSON.stringify(strategy.strategy)}`);
}

// src/run/pool.ts
import { createHash, randomBytes as randomBytes2 } from "node:crypto";
import { linkSync, readdirSync, renameSync as renameSync2, rmSync as rmSync2 } from "node:fs";
import { join as join3, resolve as resolve4 } from "node:path";
function isHolder(value) {
  if (typeof value !== "object" || value === null) return false;
  const v = value;
  return Number.isInteger(v.pid) && v.pid > 0 && typeof v.lane === "string" && typeof v.project === "string" && typeof v.createdAt === "string";
}
function assertHolder(holder) {
  if (!isHolder(holder)) throw new ArbabError("usage", "pool holder needs a positive pid, lane, project and createdAt");
}
function entryPath(dir, value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new ArbabError("usage", `pool value ${value} is not a non-negative integer`);
  return join3(dir, `${value}.json`);
}
function parseHolder(text2) {
  try {
    const value = JSON.parse(text2);
    return isHolder(value) ? value : null;
  } catch {
    return null;
  }
}
function releaseIfStale(path, alive, unparsedIsStale = false) {
  const text2 = readText(path);
  if (text2 === null) return true;
  const holder = parseHolder(text2);
  if (holder === null ? !unparsedIsStale : alive(holder.pid)) return false;
  const tomb = `${path}.${randomBytes2(6).toString("hex")}.stale`;
  try {
    renameSync2(path, tomb);
  } catch (err) {
    if (err.code === "ENOENT") return true;
    throw new ArbabError("io", `cannot reclaim ${path}: ${err.message}`, { cause: err });
  }
  const moved = readText(tomb);
  if (moved !== text2) {
    try {
      linkSync(tomb, path);
    } catch {
    }
    rmSync2(tomb, { force: true });
    return false;
  }
  rmSync2(tomb, { force: true });
  return true;
}
function acquireFromPool(dir, values, holder, alive) {
  assertHolder(holder);
  const data = JSON.stringify(holder);
  for (const value of values) {
    const path = entryPath(dir, value);
    if (createExclusive(path, data)) return value;
    if (!releaseIfStale(path, alive) || !createExclusive(path, data)) continue;
    if (readText(path) === data) return value;
  }
  return null;
}
function releaseToPool(dir, value, holder) {
  const path = entryPath(dir, value);
  const text2 = readText(path);
  if (text2 === null) return false;
  const current = parseHolder(text2);
  if (current === null || current.pid !== holder.pid || current.lane !== holder.lane) return false;
  rmSync2(path, { force: true });
  return true;
}
function list(dir) {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}
var POOL_FILE = /^\d+\.json(\.[0-9a-f]+\.stale)?$/;
function listPoolEntries(home) {
  const root = resolve4(home);
  const dirs = [join3(root, "slots")];
  for (const kind of ["semaphores", "leases", "locks"]) {
    for (const name2 of list(join3(root, kind))) dirs.push(join3(root, kind, name2));
  }
  return dirs.flatMap((dir) => list(dir).filter((name2) => POOL_FILE.test(name2)).map((name2) => join3(dir, name2)));
}
var range = (n) => Array.from({ length: n }, (_, i) => i);
function assertCount(n, what) {
  if (!Number.isSafeInteger(n) || n < 1) throw new ArbabError("config", `${what} must be a positive integer, got ${n}`);
}
function acquireSlot(home, maxParallel, holder, alive) {
  assertCount(maxParallel, "maxParallel");
  return acquireFromPool(join3(resolve4(home), "slots"), range(maxParallel), holder, alive);
}
function releaseSlot(home, slot, holder) {
  return releaseToPool(join3(resolve4(home), "slots"), slot, holder);
}
function acquireSemaphore(home, name2, capacity, holder, alive) {
  assertValidName(name2, "semaphore");
  assertCount(capacity, `semaphore ${name2} capacity`);
  return acquireFromPool(join3(resolve4(home), "semaphores", name2), range(capacity), holder, alive);
}
function releaseSemaphore(home, name2, slot, holder) {
  assertValidName(name2, "semaphore");
  return releaseToPool(join3(resolve4(home), "semaphores", name2), slot, holder);
}
function writerLockKey(worktreeRealpath) {
  return createHash("sha1").update(worktreeRealpath).digest("hex");
}
function lockDir(home, key) {
  if (!/^[0-9a-f]{40}$/.test(key)) throw new ArbabError("usage", `writer lock key ${JSON.stringify(key)} is not a sha1`);
  return join3(resolve4(home), "locks", key);
}
function acquireWriterLock(home, key, holder, alive) {
  return acquireFromPool(lockDir(home, key), [0], holder, alive) === 0;
}
function releaseWriterLock(home, key, holder) {
  return releaseToPool(lockDir(home, key), 0, holder);
}

// src/run/leases.ts
import { createServer } from "node:net";
import { join as join4, resolve as resolve5 } from "node:path";
function isPortFree(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return Promise.resolve(false);
  return new Promise((done) => {
    const server = createServer();
    server.once("error", () => done(false));
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => {
      server.close(() => done(true));
    });
  });
}
function leaseDir(home, type) {
  return join4(resolve5(home), "leases", assertValidName(type, "resource type"));
}
function checkedRange(type, ranges) {
  const spec = Object.hasOwn(ranges, type) ? ranges[type] : void 0;
  const r = typeof spec === "object" && spec !== null ? spec.range : void 0;
  if (!Array.isArray(r) || r.length !== 2) throw new ArbabError("lease", `no range configured for resource ${type}`);
  const [lo, hi] = r;
  if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi) || lo < 0 || lo > hi) {
    throw new ArbabError("lease", `resource ${type} has an invalid range ${JSON.stringify(r)}`);
  }
  if (type === "port" && (lo < 1 || hi > 65535)) {
    throw new ArbabError("lease", `port range ${JSON.stringify(r)} is outside 1..65535`);
  }
  return [lo, hi];
}
async function acquireLeases(req) {
  const plan = [];
  for (const type of Object.keys(req.requests).sort()) {
    assertValidName(type, "resource type");
    const count = req.requests[type];
    if (count === void 0 || !Number.isSafeInteger(count) || count < 0) {
      throw new ArbabError("lease", `resource ${type} count must be a non-negative integer`);
    }
    if (count === 0) continue;
    const [lo, hi] = checkedRange(type, req.ranges);
    plan.push({ type, count, lo, hi });
  }
  const taken = [];
  try {
    for (const { type, count, lo, hi } of plan) {
      const dir = leaseDir(req.home, type);
      let got = 0;
      for (let value = lo; value <= hi && got < count; value++) {
        if (acquireFromPool(dir, [value], req.holder, req.alive) === null) continue;
        if (type === "port") {
          let isFree;
          try {
            isFree = await req.probePort(value);
          } catch (err) {
            releaseToPool(dir, value, req.holder);
            throw err;
          }
          if (!isFree) {
            releaseToPool(dir, value, req.holder);
            continue;
          }
        }
        const { pid, lane, project, createdAt } = req.holder;
        taken.push({ type, value, lane, project, pid, createdAt });
        got++;
      }
      if (got < count) throw new ArbabError("lease", `only ${got} of ${count} ${type} values free in ${lo}..${hi}`);
    }
  } catch (err) {
    releaseLeases(req.home, taken, req.holder);
    throw err instanceof ArbabError ? err : new ArbabError("lease", err.message, { cause: err });
  }
  return taken;
}
function releaseLeases(home, leases, holder) {
  for (const lease of leases) releaseToPool(leaseDir(home, lease.type), lease.value, holder);
}
function leaseEnv(leases) {
  const env2 = {};
  const next = /* @__PURE__ */ new Map();
  for (const lease of leases) {
    const i = next.get(lease.type) ?? 0;
    next.set(lease.type, i + 1);
    env2[`ARBAB_${envSuffix(lease.type)}_${i}`] = String(lease.value);
  }
  return env2;
}

// src/run/spawn.ts
import { spawn } from "node:child_process";
import { closeSync as closeSync2, openSync as openSync2 } from "node:fs";
function open(path, flags, opened) {
  try {
    const fd = openSync2(path, flags);
    opened.push(fd);
    return fd;
  } catch (err) {
    const code4 = err.code;
    const why = code4 === "EEXIST" ? "already exists (attempt files are never overwritten)" : err.message;
    throw new ArbabError("io", `cannot open ${path}: ${why}`, { cause: err });
  }
}
function spawnWorker(input) {
  const opened = [];
  let child2;
  try {
    const stdin = open(input.promptFile, "r", opened);
    const stdout = open(input.streamFile, "wx", opened);
    const stderr = open(input.stderrFile, "wx", opened);
    child2 = (input.spawnImpl ?? spawn)(input.binary, input.args, {
      cwd: input.cwd,
      env: input.env,
      detached: true,
      stdio: [stdin, stdout, stderr]
    });
  } finally {
    for (const fd of opened) closeSync2(fd);
  }
  const exited = new Promise((done) => {
    child2.once("error", () => {
      if (child2.pid === void 0) done({ code: null, signal: null });
    });
    child2.once("exit", (code4, signal) => done({ code: code4, signal }));
  });
  if (child2.pid === void 0) throw new ArbabError("runtime", `cannot start ${input.binary}`);
  return { pid: child2.pid, exited };
}

// src/run/tree.ts
import { execFileSync } from "node:child_process";

// src/util/proc.ts
function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}
function sendSignal(target, signal) {
  if (!Number.isInteger(target) || target === 0 || target === -1) {
    throw new RangeError(`refusing to signal ${target}`);
  }
  try {
    process.kill(target, signal);
    return true;
  } catch (err) {
    if (err.code === "ESRCH") return false;
    throw err;
  }
}
var sleep = (ms) => new Promise((done) => setTimeout(done, ms));
var systemClock = { now: () => Date.now() };
var isoAt = (clock) => new Date(clock.now()).toISOString();

// src/run/tree.ts
function parsePs(output4) {
  const rows = [];
  for (const line of output4.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 3 || !parts.every((p) => /^\d+$/.test(p))) continue;
    const [pid, ppid, pgid] = parts.map(Number);
    rows.push({ pid, ppid, pgid });
  }
  return rows;
}
var execText = (file, args) => execFileSync(file, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
function readPs(exec = execText) {
  return exec("ps", ["-A", "-o", "pid=,ppid=,pgid="]);
}
function descendantsOf(root, table2, known) {
  const children = /* @__PURE__ */ new Map();
  for (const row of table2) {
    const list3 = children.get(row.ppid);
    if (list3) list3.push(row.pid);
    else children.set(row.ppid, [row.pid]);
  }
  const found = /* @__PURE__ */ new Set();
  const queue = [root, ...known, ...table2.filter((r) => r.pgid === root).map((r) => r.pid)];
  for (const pid of queue) {
    if (pid !== root && pid > 1) found.add(pid);
  }
  while (queue.length > 0) {
    const pid = queue.pop();
    for (const child2 of children.get(pid) ?? []) {
      if (child2 === root || child2 <= 1 || found.has(child2)) continue;
      found.add(child2);
      queue.push(child2);
    }
  }
  return found;
}
function trackDescendants(root, table2, tracked, rootRunning) {
  const present = new Set(table2.map((row) => row.pid));
  const rows = rootRunning ? table2 : table2.filter((row) => row.ppid !== root);
  return new Set([...descendantsOf(root, rows, tracked)].filter((pid) => present.has(pid)));
}
function signalTargets(root, table2, tracked, rootRunning) {
  const present = new Set(table2.map((row) => row.pid));
  const parents = new Set([...tracked].filter((pid) => present.has(pid)));
  if (rootRunning) parents.add(root);
  const out = /* @__PURE__ */ new Set();
  for (const row of table2) {
    if (row.pid === root || row.pid <= 1) continue;
    if (row.pgid === root || parents.has(row.ppid)) out.add(row.pid);
  }
  return out;
}
async function reap(input) {
  const signal = input.signal ?? sendSignal;
  const alive = input.alive ?? isAlive;
  const sleep2 = input.sleep ?? sleep;
  const graceMs = input.graceMs ?? 1e4;
  const self = input.selfPid ?? process.pid;
  const safe = (pid) => Number.isInteger(pid) && pid > 1 && pid !== self;
  const vouched = (pids) => {
    if (input.verify === void 0) return pids;
    const ok = input.verify(pids);
    return ok === null ? [] : pids.filter((pid) => ok.has(pid));
  };
  const targets = [.../* @__PURE__ */ new Set([input.pgid, ...input.pids])].filter(safe);
  const living = vouched(targets.filter((pid) => alive(pid)));
  const group = safe(input.pgid) ? -input.pgid : null;
  const send = (target, sig) => {
    try {
      return signal(target, sig);
    } catch {
      return false;
    }
  };
  let sent = group !== null && send(group, "SIGTERM");
  for (const pid of living) sent = send(pid, "SIGTERM") || sent;
  if (!sent) return living;
  await sleep2(graceMs);
  if (group !== null) send(group, "SIGKILL");
  for (const pid of vouched(living.filter((p) => alive(p)))) send(pid, "SIGKILL");
  return living;
}

// src/run/watch.ts
import { closeSync as closeSync3, openSync as openSync3, readSync, statSync as statSync2 } from "node:fs";
function fileSize(path) {
  try {
    return statSync2(path).size;
  } catch (err) {
    if (err.code === "ENOENT") return 0;
    throw new ArbabError("io", `cannot stat ${path}: ${err.message}`, { cause: err });
  }
}
function fileRange(path, start, end) {
  const buf = Buffer.alloc(Math.max(0, end - start));
  if (buf.length === 0) return buf;
  const fd = openSync3(path, "r");
  try {
    let done = 0;
    while (done < buf.length) {
      const n = readSync(fd, buf, done, buf.length - done, start + done);
      if (n === 0) break;
      done += n;
    }
    return buf.subarray(0, done);
  } finally {
    closeSync3(fd);
  }
}
var NEWLINE = 10;
function createWatcher(input) {
  const hangAfterResultMs = input.hangAfterResultMs ?? 15 * 6e4;
  const hangAfterErrorMs = input.hangAfterErrorMs ?? 2 * 6e4;
  const readSize = input.readSize ?? fileSize;
  const readRange = input.readRange ?? fileRange;
  let offset = 0;
  let carry = Buffer.alloc(0);
  let lastGrowthMs = input.startedAtMs;
  let resultSeen = false;
  let lastResultIsError = false;
  let rateLimitEvent = null;
  const consume2 = (line) => {
    let event;
    try {
      event = JSON.parse(line.toString("utf8"));
    } catch {
      return;
    }
    if (typeof event !== "object" || event === null || Array.isArray(event)) return;
    const e = event;
    if (e.type === "rate_limit_event") rateLimitEvent = e;
    if (e.type !== "result") return;
    resultSeen = true;
    lastResultIsError = e.is_error === true;
  };
  const read2 = (now) => {
    const size = readSize(input.streamPath);
    if (size < offset) {
      offset = 0;
      carry = Buffer.alloc(0);
    }
    if (size <= offset) return;
    const chunk = readRange(input.streamPath, offset, size);
    if (chunk.length === 0) return;
    offset += chunk.length;
    lastGrowthMs = now;
    let data = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
    let nl = data.indexOf(NEWLINE);
    while (nl !== -1) {
      consume2(data.subarray(0, nl));
      data = data.subarray(nl + 1);
      nl = data.indexOf(NEWLINE);
    }
    carry = Buffer.from(data);
  };
  return {
    tick() {
      const now = input.clock.now();
      rateLimitEvent = null;
      read2(now);
      const quiet = now - lastGrowthMs;
      let kill = null;
      if (now - input.startedAtMs > input.wallMs) kill = "wall";
      else if (resultSeen && lastResultIsError && quiet > hangAfterErrorMs) kill = "hang-after-error";
      else if (resultSeen && quiet > hangAfterResultMs) kill = "hang-after-result";
      else if (quiet > input.idleMs) kill = "idle";
      return { kill, rateLimitEvent };
    },
    state: () => ({ offset, lastGrowthMs, resultSeen, lastResultIsError })
  };
}

// src/run/checkpoint.ts
import { readdirSync as readdirSync2 } from "node:fs";
import { join as join5 } from "node:path";
function nestedUnder(worktree, rel, out) {
  const abs = join5(worktree, rel);
  if (holdsGit(abs)) {
    out.push(rel);
    return;
  }
  let entries2;
  try {
    entries2 = readdirSync2(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries2) if (e.isDirectory()) nestedUnder(worktree, `${rel}/${e.name}`, out);
}
function untrackedRepositories(git, worktree) {
  const others = git(["ls-files", "--others", "--exclude-standard", "--directory", "-z"]);
  if (others.code !== 0) return others;
  const out = [];
  for (const entry of others.stdout.split("\0")) {
    if (entry.endsWith("/")) nestedUnder(worktree, entry.replace(/\/+$/, ""), out);
  }
  return out;
}
function stagedGitlinks(raw) {
  const fields = raw.split("\0");
  const out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const [src, dst] = (fields[i] ?? "").replace(/^:/, "").split(" ");
    const path = fields[i + 1] ?? "";
    if ((src === "160000" || dst === "160000") && path !== "") out.push(path);
  }
  return out.sort();
}
var ARBAB_STATE = [".arbab", ".arbab-tmp"];
function checkpoint(input) {
  const lane = assertValidName(input.lane, "lane");
  if (!Number.isSafeInteger(input.attempt) || input.attempt < 1) {
    throw new ArbabError("usage", `attempt ${input.attempt} is not a positive integer`);
  }
  const verified = verifyWorktreeGit({ worktree: input.worktree, branch: input.branch, gitCommonDir: input.gitCommonDir });
  if (verified.gitDir === null) return { sha: null, error: `checkpoint skipped: ${verified.error}` };
  const gitDir = verified.gitDir;
  const prefix = [...explicitGit(gitDir, input.worktree), ...untrustedTree()];
  const git = (args) => input.git([...prefix, ...args], input.worktree);
  let tracked;
  try {
    if (worktreeStatus(input.worktree, gitDir, input.git).length === 0) return { sha: null, error: null };
    tracked = indexGitlinks(input.worktree, gitDir, input.git);
  } catch (err) {
    return { sha: null, error: err.message };
  }
  const failed = (step, r) => ({
    sha: null,
    error: `${step} failed (${r.code}): ${(r.stderr || r.stdout).trim()}`
  });
  const untracked = untrackedRepositories(git, input.worktree);
  if (!Array.isArray(untracked)) return failed("git ls-files --others", untracked);
  const left = [.../* @__PURE__ */ new Set([...tracked.filter((p) => holdsGit(join5(input.worktree, p))), ...untracked])].sort();
  const leftOut = left.length === 0 ? null : `nested repositories were not committed: ${left.join(", ")}; arbab never commits or inspects them`;
  const state = ARBAB_STATE.filter((path) => git(["check-ignore", "-q", "--", path]).code !== 0);
  const add = git([
    "add",
    "-A",
    "--",
    ".",
    ...[.../* @__PURE__ */ new Set([...tracked, ...untracked])].map((p) => `:(exclude,literal)${p}`),
    ...state.map((p) => `:(exclude,icase,literal)${p}`)
  ]);
  if (add.code !== 0) return failed("git add -A", add);
  const cached = git(["diff", "--cached", "--raw", "-z", "--no-renames", "--ignore-submodules=none"]);
  if (cached.code !== 0) return failed("git diff --cached", cached);
  const staged = stagedGitlinks(cached.stdout);
  if (staged.length > 0) {
    return {
      sha: null,
      error: `nested repositories are staged in the index: ${staged.join(", ")}; arbab never commits or inspects them, so nothing was committed. Unstage them to let the checkpoint commit the rest`
    };
  }
  if (cached.stdout === "") return { sha: null, error: leftOut };
  const message4 = `arbab(${lane}): checkpoint attempt ${input.attempt} (${input.endState})

Co-Authored-By: Claude <noreply@anthropic.com>`;
  const commit = git(["commit", "--no-verify", "-m", message4]);
  if (commit.code !== 0) return failed("git commit", commit);
  const head = git(["rev-parse", "HEAD"]);
  if (head.code !== 0) return failed("git rev-parse HEAD", head);
  return { sha: head.stdout.trim(), error: leftOut };
}

// src/integrate/integrate.ts
function listIntegrations(projectRoot) {
  try {
    return readdirSync3(join6(resolve6(projectRoot), INTEGRATIONS_DIR), { withFileTypes: true }).filter((e) => e.isDirectory() && isValidName(e.name)).map((e) => e.name).sort();
  } catch {
    return [];
  }
}
function integrationPaths(projectRoot, config, name2) {
  const valid = assertValidName(name2, "integration");
  if (valid === "integrate" || valid.startsWith("integrate-")) {
    throw new ArbabError("usage", `integration name ${valid} may not be integrate or start with integrate-`);
  }
  const root = resolve6(projectRoot);
  const dir = join6(root, INTEGRATIONS_DIR, valid);
  return {
    name: valid,
    projectRoot: root,
    dir,
    integration: join6(dir, "integration.json"),
    verify: join6(dir, "verify.json"),
    review: join6(dir, "review.json"),
    readiness: join6(dir, "readiness.json"),
    readinessMd: join6(dir, "readiness.md"),
    landing: join6(dir, "landing.json"),
    lanesDir: join6(dir, "lanes"),
    worktree: join6(confine(root, config.worktreeRoot), `${INTEGRATION_WORKTREE_PREFIX}${valid}`),
    branch: `integrate/${valid}`
  };
}
var SHA = /^[0-9a-f]{40,64}$/;
var output = (r) => (r.stderr || r.stdout).trim();
function must2(git, args, cwd) {
  const r = git(args, cwd);
  if (r.code !== 0) throw new ArbabError("git", `git ${args.join(" ")} failed (${r.code}): ${output(r)}`);
  return r.stdout;
}
function canonical2(path) {
  try {
    return realpathSync3(path);
  } catch {
    return resolve6(path);
  }
}
function commitOf(git, rev, cwd) {
  const r = git(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], cwd);
  const sha = r.stdout.trim();
  return r.code === 0 && SHA.test(sha) ? sha : null;
}
function isAncestor(git, ancestor, of, cwd) {
  const r = git(["merge-base", "--is-ancestor", ancestor, of], cwd);
  if (r.code === 0) return true;
  if (r.code === 1) return false;
  throw new ArbabError("git", `git merge-base --is-ancestor ${ancestor} ${of} failed (${r.code}): ${output(r)}`);
}
function worktreeBranches(projectRoot, git) {
  const out = /* @__PURE__ */ new Map();
  for (const block of must2(git, ["worktree", "list", "--porcelain"], projectRoot).split("\n\n")) {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice("worktree ".length);
    if (path === void 0) continue;
    const ref2 = lines.find((l) => l.startsWith("branch "))?.slice("branch ".length) ?? null;
    out.set(canonical2(path), ref2);
  }
  return out;
}
function gitCommonDir(projectRoot, git) {
  const out = must2(git, ["rev-parse", "--git-common-dir"], projectRoot).trim();
  if (out === "") throw new ArbabError("git", "git rev-parse --git-common-dir printed nothing");
  return canonical2(resolve6(projectRoot, out));
}
function refuseLaneWorktree(paths, git) {
  const ref2 = worktreeBranches(paths.projectRoot, git).get(canonical2(paths.worktree));
  const lanePrefix = "refs/heads/arbab/";
  if (typeof ref2 !== "string" || !ref2.startsWith(lanePrefix)) return;
  throw new ArbabError(
    "usage",
    `${paths.worktree} is the worktree of lane ${ref2.slice(lanePrefix.length)}, where a worker runs, so integration ${paths.name} cannot use it. Lane names starting with ${INTEGRATION_WORKTREE_PREFIX} are reserved: rename that lane and remove its worktree, or choose another integration name`
  );
}
function ownedGitDir(paths, git) {
  const refused = (why) => new ArbabError("git", `${paths.worktree} exists but is not a worktree of this repository on ${paths.branch}: ${why}`);
  const ref2 = worktreeBranches(paths.projectRoot, git).get(canonical2(paths.worktree));
  if (ref2 === void 0) throw refused("git does not list it as a worktree");
  if (ref2 !== `refs/heads/${paths.branch}`) throw refused(`it is on ${ref2 ?? "a detached HEAD"}`);
  const verified = verifyWorktreeGit({
    worktree: paths.worktree,
    branch: paths.branch,
    gitCommonDir: gitCommonDir(paths.projectRoot, git)
  });
  if (verified.gitDir === null) throw refused(verified.error);
  return verified.gitDir;
}
function refuseLanded(paths) {
  if (!existsSync2(paths.landing)) return;
  let landedAt;
  try {
    const landing = readJson(paths.landing);
    landedAt = isRecord2(landing) ? landing["landedAt"] : void 0;
  } catch {
  }
  const when = typeof landedAt === "string" && landedAt !== "" ? `at ${landedAt}` : `(${paths.landing} does not say when)`;
  throw new ArbabError(
    "usage",
    `integration ${paths.name} landed ${when}; its records stay as that landing's measurement. Choose a new name for a new integration`
  );
}
function supersedeRecord(paths) {
  if (!existsSync2(paths.integration)) return;
  let updatedAt;
  try {
    const old = readJson(paths.integration);
    updatedAt = isRecord2(old) ? old["updatedAt"] : void 0;
  } catch {
  }
  const stamp = typeof updatedAt === "string" && updatedAt !== "" ? updatedAt.slice(0, 64).replace(/[^A-Za-z0-9._-]/g, "-") : "unknown";
  let target = join6(paths.dir, `integration.superseded-${stamp}.json`);
  for (let n = 2; existsSync2(target); n++) target = join6(paths.dir, `integration.superseded-${stamp}-${n}.json`);
  renameSync3(paths.integration, target);
}
function createIntegrationWorktree(input, paths) {
  const { git, projectRoot } = input;
  const base = input.config.baseBranch;
  if (base === "" || base.startsWith("-")) {
    throw new ArbabError("config", `baseBranch ${JSON.stringify(base)} is not a valid revision`);
  }
  const baseSha = commitOf(git, base, projectRoot);
  if (baseSha === null) throw new ArbabError("git", `base ${base} does not name a commit`);
  must2(git, ["worktree", "prune"], projectRoot);
  ensureDir(dirname3(paths.worktree));
  const existing = commitOf(git, `refs/heads/${paths.branch}`, projectRoot);
  if (existing === null) {
    must2(git, ["worktree", "add", "-b", paths.branch, paths.worktree, base], projectRoot);
    supersedeRecord(paths);
  } else {
    if (!isAncestor(git, existing, baseSha, projectRoot)) {
      throw new ArbabError(
        "git",
        `${paths.branch} exists without its worktree and holds commits that are not on ${base}; arbab prepares dependencies only on the trusted base. Restore the worktree at ${paths.worktree}, or delete the branch and integrate again`
      );
    }
    must2(git, ["worktree", "add", paths.worktree, paths.branch], projectRoot);
  }
  let deps;
  try {
    deps = prepareDependencies(input.config.dependencies, paths.worktree, input.runCommand);
  } catch (err) {
    removeWorktree(git, paths);
    throw err;
  }
  if (!deps.ok) {
    removeWorktree(git, paths);
    const tail = deps.output.trim().split("\n").slice(-5).join("\n");
    throw new ArbabError("runtime", `dependencies failed in ${paths.worktree} (${deps.code}): ${tail}`);
  }
}
function refuseDirtyLanes(input, lanes) {
  const { git, projectRoot } = input;
  const root = confine(projectRoot, input.config.worktreeRoot);
  let common = null;
  for (const lane of lanes) {
    const worktree = join6(root, lane);
    if (!existsSync2(worktree)) continue;
    common ??= gitCommonDir(projectRoot, git);
    const verified = verifyWorktreeGit({ worktree, branch: `arbab/${lane}`, gitCommonDir: common });
    if (verified.gitDir === null) {
      throw new ArbabError("git", `cannot check lane ${lane}'s worktree ${worktree} for uncommitted changes: ${verified.error}`);
    }
    const status = worktreeStatus(worktree, verified.gitDir, git).map((l) => l.slice(3));
    if (status.length === 0) continue;
    const shown = status.slice(0, 5).join(", ") + (status.length > 5 ? ` and ${status.length - 5} more` : "");
    throw new ArbabError(
      "usage",
      `lane ${lane} has uncommitted changes in ${worktree} (${shown}): its checkpoint did not commit them, and integrating its branch would leave them behind. Commit or discard them, then integrate again`
    );
  }
}
function removeWorktree(git, paths) {
  git(["worktree", "remove", "--force", paths.worktree], paths.projectRoot);
}
function ignoreEntries(projectRoot, config) {
  const rel = (p) => `${relative4(resolve6(projectRoot), confine(projectRoot, p)).split(sep3).join("/")}/`;
  return [.../* @__PURE__ */ new Set([rel(config.worktreeRoot), `${INTEGRATIONS_DIR}/`])];
}
function oneEntryPerLane(entries2) {
  const out = [];
  for (const e of entries2) {
    const i = out.findIndex((o) => o.lane === e.lane);
    const prior = i < 0 ? void 0 : out[i];
    if (prior === void 0) out.push({ ...e, manifests: [...e.manifests] });
    else out[i] = { ...e, manifests: [.../* @__PURE__ */ new Set([...prior.manifests, ...e.manifests])].sort() };
  }
  return out;
}
function integrate(input) {
  const paths = integrationPaths(input.projectRoot, input.config, input.name);
  const lanes = input.lanes.map((lane) => assertValidName(lane, "lane"));
  const { git, config } = input;
  refuseLanded(paths);
  refuseLaneWorktree(paths, git);
  refuseDirtyLanes(input, lanes);
  if (!existsSync2(paths.worktree)) createIntegrationWorktree(input, paths);
  const prefix = [...explicitGit(ownedGitDir(paths, git), paths.worktree), ...untrustedTree()];
  ensureIgnored(paths.projectRoot, ignoreEntries(paths.projectRoot, config), git);
  const wt = (args) => git([...prefix, ...args], paths.worktree);
  const head = () => {
    const sha = commitOf(wt, "HEAD", paths.worktree);
    if (sha === null) throw new ArbabError("git", `cannot read HEAD of ${paths.worktree}`);
    return sha;
  };
  const previous = readIntegration(paths);
  let headSha = head();
  const present = (sha) => SHA.test(sha) && commitOf(wt, sha, paths.worktree) !== null;
  let merged = oneEntryPerLane(
    (previous?.merged ?? []).filter((m) => present(m.sha) && isAncestor(wt, m.sha, headSha, paths.worktree))
  );
  const keptBase = previous !== null && present(previous.baseSha) && isAncestor(wt, previous.baseSha, headSha, paths.worktree);
  const base = keptBase ? previous.base : config.baseBranch;
  if (base === "" || base.startsWith("-")) {
    const from = keptBase ? `${paths.integration} records base` : "baseBranch";
    throw new ArbabError(keptBase ? "io" : "config", `${from} ${JSON.stringify(base)} is not a valid revision`);
  }
  const mergeBase = () => must2(wt, ["merge-base", headSha, base], paths.worktree).trim();
  let baseSha = mergeBase();
  let confirmedAt = previous?.depsConfirmedAt ?? null;
  const manifestsIn = (range2, what) => {
    const diff = wt(["diff", "--name-only", "-z", "--no-renames", "--no-ext-diff", ...range2, "--"]);
    if (diff.code !== 0) throw new ArbabError("git", `cannot list the files ${what} (${diff.code}): ${output(diff)}`);
    return [...new Set(diff.stdout.split("\0").filter((p) => p !== "" && isDependencyManifest(p)))].sort();
  };
  const stillConfirmed = (at) => commitOf(wt, at, paths.worktree) !== null && isAncestor(wt, at, headSha, paths.worktree) && manifestsIn([at, headSha], `${paths.branch} changed since ${at}`).length === 0;
  const record2 = () => {
    baseSha = mergeBase();
    const manifests = manifestsIn([baseSha, headSha], `${paths.branch} changed since ${baseSha}`);
    if (confirmedAt !== null && !stillConfirmed(confirmedAt)) confirmedAt = null;
    const depsConfirmedAt = confirmedAt;
    const rec = {
      name: paths.name,
      branch: paths.branch,
      worktree: paths.worktree,
      base,
      baseSha,
      merged: [...merged],
      manifests,
      depsConfirmedAt,
      depsConfirmed: manifests.length === 0 || depsConfirmedAt !== null,
      headSha,
      updatedAt: isoAt(input.clock)
    };
    writeJsonAtomic(paths.integration, rec);
    return rec;
  };
  record2();
  const alreadyIn = [];
  for (const lane of lanes) {
    const branch = `arbab/${lane}`;
    const sha = commitOf(wt, `refs/heads/${branch}`, paths.worktree);
    if (sha === null) throw new ArbabError("git", `cannot integrate ${lane}: branch ${branch} does not exist`);
    if (isAncestor(wt, sha, headSha, paths.worktree)) {
      alreadyIn.push(lane);
      if (merged.some((m) => m.lane === lane && m.sha === sha)) continue;
      const manifests2 = manifestsIn([`${baseSha}...${sha}`], `${lane} changed since ${baseSha}`);
      merged = oneEntryPerLane([...merged, { lane, branch, sha, manifests: manifests2 }]);
      record2();
      continue;
    }
    const r = wt(["merge", "--no-ff", "--no-edit", "--no-verify", "-m", `arbab: integrate ${lane} into ${paths.branch}`, sha]);
    if (r.code !== 0) {
      const unmerged = wt(["diff", "--name-only", "-z", "--diff-filter=U"]);
      const conflicts = unmerged.code === 0 ? unmerged.stdout.split("\0").filter((p) => p !== "") : [];
      wt(["merge", "--abort"]);
      const kept = merged.length > 0 ? `; ${merged.map((m) => m.lane).join(", ")} stay merged` : "";
      if (conflicts.length > 0) {
        throw new ArbabError("git", `integrating ${lane} into ${paths.branch} conflicts in ${conflicts.join(", ")}; the merge was aborted${kept}`);
      }
      throw new ArbabError("git", `integrating ${lane} into ${paths.branch} failed (${r.code}): ${output(r)}; the merge was aborted${kept}`);
    }
    const before = headSha;
    headSha = head();
    const manifests = manifestsIn([before, headSha], `${lane} changed in ${paths.branch}`);
    merged = oneEntryPerLane([...merged, { lane, branch, sha, manifests }]);
    record2();
  }
  return { record: record2(), alreadyIn };
}
function isRecord2(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
var isStringArray = (v) => Array.isArray(v) && v.every((s) => typeof s === "string");
function isMergedEntry(v) {
  return isRecord2(v) && typeof v["lane"] === "string" && typeof v["branch"] === "string" && typeof v["sha"] === "string" && isStringArray(v["manifests"]);
}
function mergedManifests(merged) {
  return [...new Set(merged.flatMap((m) => m.manifests))].sort();
}
var isOptional = (v, check2) => v === void 0 || check2(v);
function readIntegration(paths) {
  const raw = readJson(paths.integration);
  if (raw === null) return null;
  const ok = isRecord2(raw) && raw["name"] === paths.name && typeof raw["branch"] === "string" && typeof raw["worktree"] === "string" && typeof raw["base"] === "string" && typeof raw["baseSha"] === "string" && Array.isArray(raw["merged"]) && raw["merged"].every(isMergedEntry) && isOptional(raw["manifests"], isStringArray) && isOptional(raw["depsConfirmedAt"], (v) => v === null || typeof v === "string" && SHA.test(v)) && typeof raw["depsConfirmed"] === "boolean" && typeof raw["headSha"] === "string" && typeof raw["updatedAt"] === "string";
  if (!ok) throw new ArbabError("io", `${paths.integration} is not an integration record for ${paths.name}`);
  const stored = raw;
  const manifests = stored.manifests ?? mergedManifests(stored.merged);
  const depsConfirmedAt = stored.depsConfirmedAt ?? null;
  return { ...stored, manifests, depsConfirmedAt, depsConfirmed: manifests.length === 0 || depsConfirmedAt !== null };
}
function confirmCommand(name2, sha) {
  return `arbab integrate ${name2} --deps-installed ${sha}`;
}
function confirmDeps(paths, sha, git, clock) {
  refuseLanded(paths);
  const previous = readIntegration(paths);
  if (previous === null) throw new ArbabError("usage", `integration ${paths.name} does not exist; run arbab integrate first`);
  if (!SHA.test(sha)) {
    throw new ArbabError(
      "usage",
      `--deps-installed takes the full head sha arbab integrate printed, not ${JSON.stringify(sha)}; the recorded head is ${previous.headSha}: review its manifests, then run ${confirmCommand(paths.name, previous.headSha)}`
    );
  }
  if (sha !== previous.headSha) {
    throw new ArbabError(
      "usage",
      `integration ${paths.name} records head ${previous.headSha}, not ${sha}: it moved since you reviewed it. Review the manifests arbab integrate ${paths.name} lists for ${previous.headSha} (run it again with its lanes), then run ` + confirmCommand(paths.name, previous.headSha)
    );
  }
  const headSha = commitOf(git, `refs/heads/${paths.branch}`, paths.projectRoot);
  if (headSha === null) throw new ArbabError("git", `branch ${paths.branch} does not exist`);
  if (headSha !== previous.headSha) {
    throw new ArbabError(
      "usage",
      `${paths.branch} is at ${headSha}, not ${previous.headSha}, the head whose manifests arbab integrate listed; run arbab integrate ${paths.name} with its lanes again, review the manifests it lists, then run the arbab integrate ${paths.name} --deps-installed <sha> it prints`
    );
  }
  if (previous.manifests.length === 0) return previous;
  const rec = { ...previous, depsConfirmedAt: headSha, depsConfirmed: true, updatedAt: isoAt(clock) };
  writeJsonAtomic(paths.integration, rec);
  return rec;
}

// src/registry/paths.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync2, readdirSync as readdirSync4 } from "node:fs";
import { join as join7 } from "node:path";
var ATTEMPT_DIR = /^attempt-([1-9][0-9]*)$/;
function runPaths(runsRoot, lane) {
  assertValidName(lane, "lane");
  const laneDir = confine(runsRoot, lane);
  return {
    laneDir,
    laneFile: join7(laneDir, "lane.json"),
    stateFile: join7(laneDir, "state.json"),
    shepherdFile: join7(laneDir, "shepherd.json"),
    attemptDir(n) {
      if (!Number.isSafeInteger(n) || n < 1) throw new ArbabError("usage", `attempt ${n} must be a positive integer`);
      return join7(laneDir, `attempt-${n}`);
    }
  };
}
function attemptFiles(dir) {
  return {
    brief: join7(dir, "brief.md"),
    settings: join7(dir, "settings.json"),
    args: join7(dir, "args.json"),
    started: join7(dir, "started.json"),
    stream: join7(dir, "stream.jsonl"),
    stderr: join7(dir, "stderr.log"),
    registration: join7(dir, "registration.json"),
    exit: join7(dir, "exit.json"),
    summary: join7(dir, "summary.json"),
    report: join7(dir, "report.json"),
    acked: join7(dir, "acked")
  };
}
function entries(dir) {
  try {
    return readdirSync4(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw new ArbabError("io", `cannot list ${dir}: ${err.message}`, { cause: err });
  }
}
function listAttempts(runsRoot, lane) {
  const out = [];
  for (const entry of entries(runPaths(runsRoot, lane).laneDir)) {
    const match = ATTEMPT_DIR.exec(entry.name);
    if (match?.[1] !== void 0 && entry.isDirectory()) out.push(Number(match[1]));
  }
  return out.sort((a, b) => a - b);
}
function listLanes(runsRoot) {
  return entries(runsRoot).filter((entry) => entry.isDirectory() && isValidName(entry.name)).map((entry) => entry.name).sort();
}
function createAttempt(runsRoot, lane) {
  const paths = runPaths(runsRoot, lane);
  ensureDir(paths.laneDir);
  let n = (listAttempts(runsRoot, lane).at(-1) ?? 0) + 1;
  for (; ; ) {
    const dir = paths.attemptDir(n);
    try {
      mkdirSync2(dir);
      return { n, dir };
    } catch (err) {
      if (err.code !== "EEXIST") {
        throw new ArbabError("io", `cannot create ${dir}: ${err.message}`, { cause: err });
      }
      n += 1;
    }
  }
}
function readObject(path) {
  const value = readJson(path);
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new ArbabError("io", `${path} is not a JSON object`);
  return value;
}
function readAttempt(dir) {
  const files = attemptFiles(dir);
  return {
    started: readObject(files.started),
    exit: readObject(files.exit),
    summary: readObject(files.summary),
    acked: existsSync3(files.acked)
  };
}

// src/registry/state.ts
var LANE_STATES = [
  "queued",
  "held",
  "preparing",
  "running",
  "waiting-reset",
  "finished",
  "orphaned"
];
function isRecord3(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value;
  return isValidName(v["lane"]) && typeof v["state"] === "string" && LANE_STATES.includes(v["state"]) && Number.isSafeInteger(v["attempt"]) && typeof v["since"] === "string" && Number.isSafeInteger(v["shepherdPid"]);
}
function writeState(runsRoot, record2) {
  if (!isRecord3(record2)) throw new ArbabError("usage", "invalid lane state record");
  writeJsonAtomic(runPaths(runsRoot, record2.lane).stateFile, record2);
}
function readState(runsRoot, lane) {
  const path = runPaths(runsRoot, lane).stateFile;
  const value = readJson(path);
  if (value === null) return null;
  if (!isRecord3(value) || value.lane !== lane) throw new ArbabError("io", `${path} is not a valid state record`);
  return value;
}
function effectiveState(record2, alive) {
  if (record2.state === "finished" || record2.state === "orphaned") return record2.state;
  return alive(record2.shepherdPid) ? record2.state : "orphaned";
}

// src/registry/status.ts
var UNKNOWN = "\u2014";
var LIVE = /* @__PURE__ */ new Set(["queued", "held", "preparing", "running", "waiting-reset"]);
var isLive = (state) => LIVE.has(state);
function statusRow(record2, summary, nowMs) {
  return {
    lane: record2.lane,
    state: record2.state,
    attempt: record2.attempt,
    endState: record2.endState ?? (record2.state === "finished" && summary ? summary.state : null),
    elapsedMs: elapsed(record2, summary, nowMs),
    turns: summary?.turns ?? 0,
    toolCalls: summary?.toolCallTotal ?? 0,
    // AttemptSummary does not carry the stream's last tool yet.
    lastTool: summary?.lastTool ?? null,
    effort: dominantEffort(summary?.measuredEffort ?? null),
    failedTotal: summary?.failedTotal ?? 0,
    costUsd: summary?.costUsd ?? null,
    costDeltaUsd: summary?.costDeltaUsd ?? null,
    fiveHour: summary?.rateLimit?.fiveHour ?? null,
    sevenDay: summary?.rateLimit?.sevenDay ?? null
  };
}
function elapsed(record2, summary, nowMs) {
  if (!isLive(record2.state)) return summary?.wallMs ?? null;
  const since = Date.parse(record2.since);
  return Number.isNaN(since) ? null : Math.max(0, nowMs - since);
}
function dominantEffort(measured) {
  if (!measured) return null;
  let best = null;
  let bestCount = -1;
  for (const [effort2, count] of Object.entries(measured).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (count > bestCount) {
      best = effort2;
      bestCount = count;
    }
  }
  return best;
}
function formatElapsed(ms) {
  const total = Math.floor(ms / 1e3);
  const h = Math.floor(total / 3600);
  const m = Math.floor(total % 3600 / 60);
  const s = total % 60;
  const two = (n) => String(n).padStart(2, "0");
  if (h > 0) return `${h}h${two(m)}m`;
  if (m > 0) return `${m}m${two(s)}s`;
  return `${s}s`;
}
function formatCost(cost, delta) {
  if (cost === null) return UNKNOWN;
  const main = `$${cost.toFixed(2)}`;
  if (delta === null || delta.toFixed(2) === cost.toFixed(2)) return main;
  return `${main} (\u0394$${delta.toFixed(2)})`;
}
function formatWindows(fiveHour, sevenDay, nowSec) {
  const parts = [];
  for (const [label, window] of [
    ["5h", fiveHour],
    ["7d", sevenDay]
  ]) {
    if (window && window.resetsAt > nowSec) parts.push(`${label} ${Math.round(window.utilization * 100)}%`);
  }
  return parts.length > 0 ? parts.join(" \xB7 ") : UNKNOWN;
}
var HEADERS = ["lane", "state", "attempt", "elapsed", "turns", "calls", "last tool", "effort", "failed", "cost", "quota"];
function formatStatusTable(rows, nowSec) {
  const cells = rows.map((row) => [
    row.lane,
    row.state === "finished" && row.endState ? `finished (${row.endState})` : row.state,
    String(row.attempt),
    row.elapsedMs === null ? UNKNOWN : formatElapsed(row.elapsedMs),
    String(row.turns),
    String(row.toolCalls),
    row.lastTool ?? UNKNOWN,
    row.effort ?? UNKNOWN,
    String(row.failedTotal),
    formatCost(row.costUsd, row.costDeltaUsd),
    formatWindows(row.fiveHour, row.sevenDay, nowSec)
  ]);
  const table2 = [HEADERS, ...cells];
  const widths = HEADERS.map((_, i) => Math.max(...table2.map((line) => (line[i] ?? "").length)));
  return table2.map(
    (line) => line.map((cell2, i) => cell2.padEnd(widths[i] ?? 0)).join("  ").trimEnd()
  ).join("\n");
}

// src/registry/wait.ts
import { createHash as createHash2 } from "node:crypto";
import { existsSync as existsSync4 } from "node:fs";
import { join as join8 } from "node:path";
var isDone = (state) => state === "finished" || state === "orphaned";
function doneRecord(runsRoot, lane, alive) {
  const record2 = readState(runsRoot, lane);
  if (!record2) return null;
  const state = effectiveState(record2, alive);
  return isDone(state) ? { record: record2, state } : null;
}
function ackedFile(runsRoot, lane) {
  return join8(runPaths(runsRoot, lane).laneDir, "acked.json");
}
function runMarker(runsRoot, lane, run) {
  const since = createHash2("sha256").update(run.since).digest("hex").slice(0, 16);
  return join8(runPaths(runsRoot, lane).laneDir, "acks", `${run.shepherdPid}-${since}`);
}
var sameRun = (a, b) => typeof a === "object" && a !== null && a["shepherdPid"] === b.shepherdPid && a["since"] === b.since;
function isAcked(runsRoot, lane, run) {
  let recorded = null;
  try {
    recorded = readJson(ackedFile(runsRoot, lane));
  } catch {
  }
  return sameRun(recorded, run) || existsSync4(runMarker(runsRoot, lane, run));
}
function ackRun(runsRoot, lane, run, attempt = null) {
  if (!Number.isSafeInteger(run.shepherdPid) || typeof run.since !== "string") throw new ArbabError("usage", "invalid lane run");
  if (!createExclusive(runMarker(runsRoot, lane, run), `${JSON.stringify(run)}
`)) return false;
  writeJsonAtomic(ackedFile(runsRoot, lane), { shepherdPid: run.shepherdPid, since: run.since, attempt });
  if (attempt !== null) {
    const dir = runPaths(runsRoot, lane).attemptDir(attempt);
    if (existsSync4(dir)) createExclusive(attemptFiles(dir).acked, `${attempt}
`);
  }
  return true;
}
function pendingFinished(runsRoot, lanes, alive) {
  const out = [];
  for (const lane of lanes ?? listLanes(runsRoot)) {
    const done = doneRecord(runsRoot, lane, alive);
    if (!done) continue;
    const { record: record2, state } = done;
    const run = { shepherdPid: record2.shepherdPid, since: record2.since };
    if (isAcked(runsRoot, lane, run)) continue;
    const dir = record2.attempt >= 1 ? runPaths(runsRoot, lane).attemptDir(record2.attempt) : null;
    const attempt = dir !== null && existsSync4(dir) ? record2.attempt : null;
    const summary = attempt === null || dir === null ? null : readAttempt(dir).summary;
    const finished = record2.state === "finished";
    out.push({
      lane,
      attempt,
      state,
      endState: finished ? record2.endState ?? null : null,
      reason: finished ? record2.reason ?? null : null,
      summary,
      run
    });
  }
  return out;
}
function ack(runsRoot, lane, attempt) {
  const dir = runPaths(runsRoot, lane).attemptDir(attempt);
  if (!existsSync4(dir)) throw new ArbabError("usage", `lane ${lane} has no attempt ${attempt}`);
  const marked = createExclusive(attemptFiles(dir).acked, `${attempt}
`);
  const record2 = readState(runsRoot, lane);
  const run = record2 !== null && record2.attempt === attempt ? ackRun(runsRoot, lane, { shepherdPid: record2.shepherdPid, since: record2.since }, attempt) : false;
  return marked || run;
}
function claim(runsRoot, items) {
  return items.filter((item) => ackRun(runsRoot, item.lane, item.run, item.attempt));
}
async function waitForFinished(options) {
  const { runsRoot, lanes, mode, timeoutMs, pollMs, clock, sleep: sleep2, alive } = options;
  if (lanes) {
    for (const lane of lanes) {
      assertValidName(lane, "lane");
      if (!existsSync4(runPaths(runsRoot, lane).laneDir)) throw new ArbabError("usage", `no runs for lane ${lane}`);
    }
  }
  const start = clock.now();
  for (; ; ) {
    if (mode === "any") {
      const claimed = claim(runsRoot, pendingFinished(runsRoot, lanes, alive));
      if (claimed.length > 0) return { finished: claimed, timedOut: false };
    } else {
      const names = lanes ?? listLanes(runsRoot);
      if (names.every((lane) => doneRecord(runsRoot, lane, alive) !== null)) {
        return { finished: claim(runsRoot, pendingFinished(runsRoot, names, alive)), timedOut: false };
      }
    }
    const remaining = timeoutMs - (clock.now() - start);
    if (remaining <= 0) return { finished: [], timedOut: true };
    await sleep2(Math.min(pollMs, remaining));
  }
}

// src/commands/generated.ts
import { existsSync as existsSync5 } from "node:fs";
import { join as join9 } from "node:path";
var GENERATED = "generated.json";
var BY = "integration:";
var SHA2 = /^[0-9a-f]{40,64}$/;
var ownerTag = (owner) => `${BY}${owner.integration}`;
var markerPath = (runsRoot, lane) => join9(runsRoot, assertValidName(lane, "lane"), GENERATED);
function markGenerated(runsRoot, lane, owner, now) {
  const marker = { by: ownerTag(owner), createdAt: now, baseSha: owner.head };
  writeJsonAtomic(markerPath(runsRoot, lane), marker);
}
function readGenerated(runsRoot, lane) {
  const path = markerPath(runsRoot, lane);
  if (!existsSync5(path)) return null;
  let raw;
  try {
    raw = readJson(path);
  } catch {
    raw = null;
  }
  const fields = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {};
  return {
    by: typeof fields["by"] === "string" ? fields["by"] : null,
    baseSha: typeof fields["baseSha"] === "string" && SHA2.test(fields["baseSha"]) ? fields["baseSha"] : null
  };
}
function lanesGeneratedBy(runsRoot, integration) {
  const tag = ownerTag({ integration });
  return listLanes(runsRoot).filter((lane) => readGenerated(runsRoot, lane)?.by === tag);
}
function generatingIntegration(by) {
  if (by?.startsWith(BY) !== true) return null;
  const name2 = by.slice(BY.length);
  return isValidName(name2) ? name2 : null;
}
function assertNotGenerated(runsRoot, lane) {
  const marker = readGenerated(runsRoot, lane);
  if (marker === null) return;
  const owner = generatingIntegration(marker.by);
  throw new ArbabError(
    "usage",
    `lane ${lane} was generated by ${owner === null ? "an integration" : `integration ${owner}`}, which owns the name; only its arbab verify or arbab review runs it. Give your lane another name`
  );
}

// src/commands/integration.ts
import { existsSync as existsSync10 } from "node:fs";
import { join as join19 } from "node:path";

// src/stream/classify.ts
var UNSUPPORTED_CLI = /does not support this model|or newer is required/i;
var HANG_KILLS = /* @__PURE__ */ new Set(["hang-after-result", "hang-after-error"]);
var SUBTYPE_STATES = /* @__PURE__ */ new Map([
  ["error_max_budget_usd", "budget"],
  ["error_max_turns", "max-turns"],
  ["error_max_structured_output_retries", "invalid-report"]
]);
function classifyAttempt(input) {
  const { digest, exit, alive, schemaRequired, reportValid } = input;
  const final = digest.final;
  const killedBy = exit?.killedBy ?? null;
  if (killedBy !== null && !(final !== null && HANG_KILLS.has(killedBy))) return `killed:${killedBy}`;
  if (final === null) return alive ? "running" : "no-result";
  if (final.apiErrorStatus === 429) return "usage-limit";
  if (final.apiErrorStatus === 400 && UNSUPPORTED_CLI.test(final.resultText ?? "")) return "unsupported-cli";
  const bySubtype = final.subtype === null ? void 0 : SUBTYPE_STATES.get(final.subtype);
  if (bySubtype) return bySubtype;
  if (final.isError || final.subtype !== "success") return "failed";
  if (schemaRequired && (final.structuredOutput == null || reportValid === false)) return "invalid-report";
  return "success";
}

// src/stream/json.ts
function isRecord4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function stringOrNull(value) {
  return typeof value === "string" ? value : null;
}
function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}
var Counter = class {
  counts = /* @__PURE__ */ new Map();
  add(key) {
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }
  toObject() {
    return Object.fromEntries(this.counts);
  }
};
function sumValues(counts) {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

// src/stream/digest.ts
var REPORT_TOOL = "StructuredOutput";
function parseStream(text2) {
  const events = [];
  let unparsedLines = 0;
  for (const line of text2.split("\n")) {
    if (line.trim() === "") continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      unparsedLines++;
    }
  }
  return { events, unparsedLines };
}
var DENIED_TYPE_CAUSES = /* @__PURE__ */ new Map([
  ["mode", "dontAsk"],
  ["rule", "deny-rule"],
  ["other", "scope"],
  ["subcommandResults", "subcommand"]
]);
var TEXT_CAUSES = [
  [/can't be checked before it runs|expansion obfuscation|multiple targets|cannot be statically analy/i, "analyzer"],
  [/requires? approval|contains multiple operations/i, "needs-approval"],
  [/^Blocked: sleep/i, "sleep-guard"],
  [/InputValidationError/, "input"],
  [/denied by your permission settings/i, "deny-rule"],
  [/Operation not permitted|network-outbound|sandbox/i, "sandbox"],
  [/has been denied/i, "denied-other"]
];
function failureCause(text2, deniedType) {
  if (deniedType) return DENIED_TYPE_CAUSES.get(deniedType) ?? "denied-other";
  for (const [pattern, cause] of TEXT_CAUSES) {
    if (pattern.test(text2)) return cause;
  }
  return "real";
}
function quotaWindow(value) {
  if (!isRecord4(value)) return null;
  const utilization = numberOrNull(value.utilization);
  const resetsAt = numberOrNull(value.resetsAt);
  return utilization === null || resetsAt === null ? null : { utilization, resetsAt };
}
function rateLimitFromEvent(event, observedAt) {
  if (!isRecord4(event) || event.type !== "rate_limit_event") return null;
  const info = event.rate_limit_info;
  if (!isRecord4(info)) return null;
  const windows = isRecord4(info.unifiedWindows) ? info.unifiedWindows : {};
  return {
    observedAt,
    status: stringOrNull(info.status),
    type: stringOrNull(info.rateLimitType),
    fiveHour: quotaWindow(windows.five_hour),
    sevenDay: quotaWindow(windows.seven_day)
  };
}
function initFacts(event) {
  const plugins = [];
  for (const p of arrayOrEmpty(event.plugins)) {
    if (typeof p === "string") plugins.push(p);
    else if (isRecord4(p) && typeof p.name === "string") plugins.push(p.name);
  }
  const timing = isRecord4(event.startup_timing) ? event.startup_timing : {};
  return {
    tools: arrayOrEmpty(event.tools).filter((t) => typeof t === "string"),
    permissionMode: stringOrNull(event.permissionMode),
    version: stringOrNull(event.claude_code_version),
    model: stringOrNull(event.model),
    apiKeySource: stringOrNull(event.apiKeySource),
    mcpServers: arrayOrEmpty(event.mcp_servers),
    plugins,
    skills: arrayOrEmpty(event.skills).length,
    memoryPaths: Object.hasOwn(event, "memory_paths"),
    messagingSocket: Object.hasOwn(event, "messaging_socket_path"),
    entrypoint: stringOrNull(timing.entrypoint)
  };
}
function resultFacts(event) {
  return {
    subtype: stringOrNull(event.subtype),
    isError: event.is_error === true,
    terminalReason: stringOrNull(event.terminal_reason),
    apiErrorStatus: numberOrNull(event.api_error_status),
    numTurns: numberOrNull(event.num_turns),
    durationMs: numberOrNull(event.duration_ms),
    totalCostUsd: numberOrNull(event.total_cost_usd),
    resultText: stringOrNull(event.result),
    structuredOutput: event.structured_output === void 0 ? null : event.structured_output
  };
}
function toolResultText(content) {
  if (typeof content === "string") return content;
  return arrayOrEmpty(content).map((item) => isRecord4(item) && typeof item.text === "string" ? item.text : "").join("\n");
}
function contentBlocks(event) {
  return isRecord4(event) && isRecord4(event.message) ? arrayOrEmpty(event.message.content).filter(isRecord4) : [];
}
function toolUses(event) {
  if (!isRecord4(event) || event.type !== "assistant") return [];
  const out = [];
  for (const block of contentBlocks(event)) {
    if (block.type === "tool_use" && typeof block.name === "string") out.push({ id: stringOrNull(block.id), name: block.name });
  }
  return out;
}
function digestStream(events, observedAt, unparsedLines = 0) {
  const records = events.filter(isRecord4);
  let sessionId = null;
  let init = null;
  const results = [];
  const toolNames = /* @__PURE__ */ new Map();
  const countedToolUses = /* @__PURE__ */ new Set();
  const toolCalls = new Counter();
  let lastTool = null;
  const messageIds = /* @__PURE__ */ new Set();
  const deniedTypes = /* @__PURE__ */ new Map();
  let permissionDenied = 0;
  let rateLimit = null;
  for (const e of records) {
    if (sessionId === null && typeof e.session_id === "string" && e.session_id !== "") sessionId = e.session_id;
    if (e.type === "system" && e.subtype === "init") {
      if (init === null) {
        init = initFacts(e);
        if (typeof e.session_id === "string" && e.session_id !== "") sessionId = e.session_id;
      }
    } else if (e.type === "system" && e.subtype === "permission_denied") {
      permissionDenied++;
      const type = stringOrNull(e.decision_reason_type);
      if (typeof e.tool_use_id === "string" && type) deniedTypes.set(e.tool_use_id, type);
    } else if (e.type === "assistant") {
      if (isRecord4(e.message) && typeof e.message.id === "string") messageIds.add(e.message.id);
      for (const { id, name: name2 } of toolUses(e)) {
        if (id !== null) {
          if (countedToolUses.has(id)) continue;
          countedToolUses.add(id);
          toolNames.set(id, name2);
        }
        if (name2 === REPORT_TOOL) continue;
        toolCalls.add(name2);
        lastTool = name2;
      }
    } else if (e.type === "rate_limit_event") {
      rateLimit = rateLimitFromEvent(e, observedAt) ?? rateLimit;
    } else if (e.type === "result") {
      results.push(resultFacts(e));
    }
  }
  const failed = new Counter();
  for (const e of records) {
    if (e.type !== "user") continue;
    for (const block of contentBlocks(e)) {
      if (block.type !== "tool_result" || block.is_error !== true) continue;
      const id = stringOrNull(block.tool_use_id);
      const tool = (id !== null ? toolNames.get(id) : void 0) ?? "?";
      if (tool === REPORT_TOOL) continue;
      const cause = failureCause(toolResultText(block.content), id !== null ? deniedTypes.get(id) : void 0);
      failed.add(`${tool}:${cause}`);
    }
  }
  return {
    sessionId,
    init,
    results,
    final: results.at(-1) ?? null,
    toolCalls: toolCalls.toObject(),
    failedByCause: failed.toObject(),
    permissionDenied,
    turns: messageIds.size,
    lastTool,
    rateLimit,
    unparsedLines
  };
}

// src/stream/summary.ts
function wallMsOf(started, exit, nowMs) {
  if (exit) return exit.wallMs;
  if (!started) return null;
  const startedMs = Date.parse(started.startedAt);
  return Number.isNaN(startedMs) ? null : Math.max(0, nowMs - startedMs);
}
function buildAttemptSummary(input) {
  const { digest, started, exit } = input;
  const costUsd = digest.final?.totalCostUsd ?? null;
  let costDeltaUsd = null;
  if (costUsd !== null) costDeltaUsd = input.previousCostUsd === null ? costUsd : costUsd - input.previousCostUsd;
  return {
    lane: input.lane,
    attempt: input.attempt,
    role: input.role,
    state: input.state,
    sessionId: digest.sessionId ?? started?.sessionId ?? null,
    binary: started?.binary ?? null,
    model: digest.init?.model ?? null,
    requestedEffort: input.requestedEffort,
    measuredEffort: input.measuredEffort,
    wallMs: wallMsOf(started, exit, input.nowMs),
    turns: digest.turns,
    toolCalls: { ...digest.toolCalls },
    toolCallTotal: sumValues(digest.toolCalls),
    lastTool: digest.lastTool,
    failedByCause: { ...digest.failedByCause },
    failedTotal: sumValues(digest.failedByCause),
    permissionDenied: digest.permissionDenied,
    costUsd,
    costDeltaUsd,
    resultEvents: digest.results.length,
    final: digest.final,
    rateLimit: digest.rateLimit,
    init: digest.init,
    registration: input.registration,
    reportValid: input.reportValid,
    reportErrors: input.reportErrors
  };
}

// src/stream/transcript.ts
import { readdirSync as readdirSync5, statSync as statSync3 } from "node:fs";
import { join as join10 } from "node:path";
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function findTranscript(projectsDir, sessionId) {
  if (!UUID.test(sessionId)) return null;
  let dirs;
  try {
    dirs = readdirSync5(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    return null;
  }
  const file = `${sessionId}.jsonl`;
  for (const dir of dirs) {
    const candidate = join10(projectsDir, dir, file);
    if (statSync3(candidate, { throwIfNoEntry: false })?.isFile()) return candidate;
  }
  return null;
}
function measuredEffort(transcriptText) {
  const counts = new Counter();
  for (const entry of parseStream(transcriptText).events) {
    if (isRecord4(entry) && entry.type === "assistant" && typeof entry.effort === "string" && entry.effort !== "") {
      counts.add(entry.effort);
    }
  }
  return counts.toObject();
}

// src/commands/launch.ts
import { rmSync as rmSync3, statSync as statSync4 } from "node:fs";
import { join as join15 } from "node:path";

// src/commands/lint.ts
import { realpathSync as realpathSync4 } from "node:fs";
import { join as join14, resolve as resolve10 } from "node:path";

// src/brief/markdown.ts
var OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
var CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;
function scanLines(markdown) {
  const out = [];
  let fence = null;
  for (const text2 of markdown.split(/\r?\n/)) {
    if (fence === null) {
      const m = OPEN.exec(text2);
      const run2 = m?.[1];
      const rest = m?.[2] ?? "";
      if (run2 !== void 0 && !(run2.startsWith("`") && rest.includes("`"))) {
        fence = { char: run2.charAt(0), length: run2.length, info: rest.trim().split(/\s+/)[0] ?? "" };
        out.push({ text: text2, inFence: true, delimiter: true, info: fence.info });
      } else {
        out.push({ text: text2, inFence: false, delimiter: false, info: null });
      }
      continue;
    }
    const run = CLOSE.exec(text2)?.[1];
    if (run !== void 0 && run.charAt(0) === fence.char && run.length >= fence.length) {
      out.push({ text: text2, inFence: true, delimiter: true, info: fence.info });
      fence = null;
    } else {
      out.push({ text: text2, inFence: true, delimiter: false, info: fence.info });
    }
  }
  return out;
}
function inlineCodeSpans(line) {
  const spans = [];
  const runs = [...line.matchAll(/`+/g)];
  let i = 0;
  while (i < runs.length) {
    const open2 = runs[i];
    if (open2 === void 0) break;
    let j = i + 1;
    while (j < runs.length && runs[j]?.[0].length !== open2[0].length) j++;
    const close = runs[j];
    if (close === void 0) {
      i++;
      continue;
    }
    spans.push(line.slice(open2.index + open2[0].length, close.index));
    i = j + 1;
  }
  return spans;
}

// src/brief/schema.ts
var NO_SCHEMA_TEXT = "Your final answer is a short summary of what you did and what you could not do.";
function typeName(schema) {
  if (schema.enum !== void 0 && schema.enum.length > 0) return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
  if (schema.type === "array") {
    if (schema.items === void 0) return "unknown[]";
    const inner = typeName(schema.items);
    return `${inner.includes(" | ") ? `(${inner})` : inner}[]`;
  }
  if (schema.type !== void 0) return schema.type;
  return schema.properties !== void 0 ? "object" : "unknown";
}
function fieldLines(schema, depth) {
  const required = new Set(schema.required ?? []);
  const lines = [];
  for (const [name2, field] of Object.entries(schema.properties ?? {})) {
    let line = `${"  ".repeat(depth)}- \`${name2}\`: \`${typeName(field)}\``;
    if (!required.has(name2)) line += " (optional)";
    const description = field.description?.replace(/\s+/g, " ").trim();
    if (description) line += ` \u2014 ${description}`;
    lines.push(line);
    const nested = field.type === "array" ? field.items : field;
    if (nested?.properties !== void 0) lines.push(...fieldLines(nested, depth + 1));
  }
  return lines;
}
function describeSchema(schema) {
  if (schema === null) return NO_SCHEMA_TEXT;
  if (schema.properties === void 0) return `- the whole answer: \`${typeName(schema)}\``;
  return fieldLines(schema, 0).join("\n");
}

// src/profile/presets.ts
var BUILTIN_CREDENTIAL_PATHS = [
  "~/.ssh/**",
  "~/.aws/**",
  "~/.azure/**",
  "~/.config/**",
  "~/.docker/**",
  "~/.kube/**",
  "~/.gnupg/**",
  "~/.claude/**",
  "~/.claude.json",
  "~/.netrc",
  "~/.npmrc",
  "~/.pypirc",
  "~/.git-credentials",
  "~/Library/Keychains/**",
  "~/Library/Cookies/**",
  "**/.env*",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  "**/id_rsa*",
  "**/id_ed25519*",
  "**/*.tfstate"
];
var GIT_WRITE_VERBS = [
  "commit",
  "push",
  "reset",
  "checkout",
  "switch",
  "restore",
  "rebase",
  "merge",
  "cherry-pick",
  "stash",
  "clean",
  "branch",
  "worktree",
  "tag",
  "config",
  "update-ref",
  "remote"
];
var GIT_READ_VERBS = ["status", "diff", "log", "show", "ls-files", "blame"];
var READ_UTILITIES = ["ls", "cat", "head", "tail", "wc"];
var FILE_UTILITIES = ["mkdir", "cp", "mv", "rm", "touch"];
var ANY_CODE_PREFIXES = [
  "node",
  "npx",
  "npm",
  "pnpm",
  "yarn",
  "bun",
  "bunx",
  "deno",
  "python",
  "python3",
  "ruby",
  "perl",
  "php",
  "sh",
  "bash",
  "zsh",
  "fish",
  "env",
  "eval",
  "exec",
  "xargs",
  "find",
  "awk",
  "sed",
  "make",
  "sudo",
  "osascript",
  "open",
  "docker",
  "kubectl",
  "ssh",
  "curl",
  "wget",
  "git",
  "pnpm exec",
  "pnpm dlx",
  "pnpm run",
  "npm exec",
  "npm run",
  "yarn run",
  "yarn dlx",
  "bun run",
  "bun x",
  "git -C",
  "git config"
];
var BASH_INPUT_PARAMS = [
  "timeout",
  "description",
  "run_in_background",
  "dangerouslyDisableSandbox"
];
var FIXED_ENV = {
  BASH_DEFAULT_TIMEOUT_MS: "300000",
  BASH_MAX_TIMEOUT_MS: "900000"
};
var BACKGROUND_DENY = "Bash(run_in_background:true)";

// src/brief/toolbelt.ts
var FILE_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "NotebookEdit"];
var WEB_TOOLS = ["WebFetch", "WebSearch"];
function code(text2) {
  return `\`${text2}\``;
}
function allowedCommands(allow) {
  const seen = /* @__PURE__ */ new Map();
  for (const raw of allow) {
    const rule = raw.trim();
    if (rule === "Bash" || rule === "Bash(*)") return ["any command"];
    const inner = /^Bash\((.*)\)$/s.exec(rule)?.[1];
    if (inner === void 0) continue;
    const prefix = /^(.*?)(?: \*|:\*)$/s.exec(inner)?.[1];
    const key = prefix ?? inner;
    seen.set(key, (seen.get(key) ?? false) || prefix !== void 0);
  }
  return [...seen].map(([p, withArgs]) => code(withArgs ? `${p} \u2026` : p));
}
function minutes(n) {
  return n === 1 ? "1 minute" : `${n} minutes`;
}
function leaseLine(leases) {
  if (leases.length === 0) return null;
  const counts = /* @__PURE__ */ new Map();
  const vars2 = leases.map((lease) => {
    const i = counts.get(lease.type) ?? 0;
    counts.set(lease.type, i + 1);
    return code(`ARBAB_${envSuffix(lease.type)}_${i}=${lease.value}`);
  });
  return `- Leased resources, exported as environment variables: ${vars2.join(", ")}. Use these instead of picking your own.`;
}
function doNotTry(profile, hasBash) {
  const { deny } = profile.settings.permissions;
  const denied = new Set(deny.map((rule) => rule.trim()));
  const items = [];
  const gitWrite = deny.some((rule) => GIT_WRITE_VERBS.some((verb) => new RegExp(`^Bash\\(git ${verb}(?:[ :)]|$)`).test(rule.trim())));
  if (gitWrite) items.push("git writes (the runner commits)");
  if (WEB_TOOLS.some((t) => denied.has(t))) items.push("network access and web tools");
  else if (hasBash) items.push("network access from the shell");
  if (denied.has("Edit") || denied.has("Write")) items.push("editing or creating files");
  items.push("files outside the worktree");
  if (deny.some((rule) => /^(?:Read|Edit)\(/.test(rule.trim()))) items.push("credential files");
  return items;
}
function toolBelt(profile, leases, bashMaxTimeoutMin) {
  const lines = [];
  const hasBash = profile.tools.includes("Bash");
  if (!hasBash) {
    lines.push("- You have no shell: the Bash tool is not available.");
  } else if (profile.settings.sandbox.autoAllowBashIfSandboxed) {
    lines.push("- Shell commands run inside the sandbox without an allowlist: any command the sandbox permits runs, except the denied ones below.");
  } else {
    const commands2 = allowedCommands(profile.settings.permissions.allow);
    lines.push(commands2.length > 0 ? `- Shell commands you may run: ${commands2.join(", ")}.` : "- No shell command is allowed.");
  }
  const fileTools = profile.tools.filter((t) => FILE_TOOLS.includes(t));
  if (fileTools.length > 0) {
    const hints = [];
    if (fileTools.includes("Write")) hints.push("use Write to create directories and files");
    if (hasBash && fileTools.includes("Read") && fileTools.includes("Grep")) hints.push("use Read and Grep instead of shell pipelines");
    const hint = hints.length > 0 ? ` ${hints.join("; ").replace(/^u/, "U")}.` : "";
    lines.push(`- File tools: ${fileTools.join(", ")}.${hint}`);
  }
  const otherTools = profile.tools.filter((t) => t !== "Bash" && !FILE_TOOLS.includes(t));
  if (otherTools.length > 0) lines.push(`- Other tools: ${otherTools.join(", ")}.`);
  if (hasBash) {
    lines.push(
      "- One command per call, in the foreground. These are refused:",
      "  - `cd X && \u2026`: commands already run in the worktree;",
      "  - `&&`, `;` and pipes into `tail`/`head`: run single commands and read the full output;",
      "  - `$(\u2026)` and `echo $?`: the tool reports the exit code;",
      `  - \`sleep N\`: set the Bash \`timeout\` parameter instead, up to ${minutes(bashMaxTimeoutMin)};`,
      "  - background processes: refused; run everything in the foreground."
    );
  }
  const lease = leaseLine(leases);
  if (lease !== null) lines.push(lease);
  lines.push(`- Do not try: ${doNotTry(profile, hasBash).join(", ")}.`);
  return lines.join("\n");
}

// src/brief/assemble.ts
var SOURCE_ORDER = ["Task", "Scope", "Facts", "Unverified", "Acceptance", "Notes"];
var ROLE_SPECIFICS = {
  reviewer: "You cannot edit files. Report findings with evidence.",
  researcher: "You have only web tools. Cite a source for every claim.",
  probe: "Run each step exactly as written."
};
function roleAndIsolation(ctx, profile) {
  const loopback = profile.settings.sandbox.network.allowLocalBinding ? " Listening on 127.0.0.1 is allowed." : "";
  const lines = [
    `You are an arbab worker in the ${ctx.role} role. You run headless: nobody will answer questions. Decide, and report what you could not decide.`,
    "",
    `- Your working directory is a git worktree at \`${ctx.worktree}\` on branch \`${ctx.branch}\`. Work only inside it.`,
    `- Shell commands run in an OS sandbox: no network, no writes outside the worktree and the temp directory, and credential files are unreadable.${loopback}`,
    "- You cannot commit, push or switch branches. The runner commits your work when you finish.",
    "- A refused command costs you one turn. Do not retry it; use the tool belt."
  ];
  const specific = ROLE_SPECIFICS[ctx.role];
  if (specific !== void 0) lines.push(`- ${specific}`);
  return lines.join("\n");
}
function nestInstruction(content) {
  const lines = scanLines(content.trim());
  if (lines[0] !== void 0 && !lines[0].inFence && /^# /.test(lines[0].text)) lines.shift();
  return lines.map((l) => l.inFence ? l.text : l.text.replace(/^(#{1,6}) /, (_, h) => `${"#".repeat(Math.min(h.length + 2, 6))} `)).join("\n").trim();
}
function section(heading, body) {
  return `## ${heading}

${body}`;
}
function assembleBrief(source, ctx) {
  const parts = [`# ${source.title}`, section("Role and isolation", roleAndIsolation(ctx, ctx.profile))];
  if (ctx.instructions.length > 0) {
    parts.push(section("Project rules", ctx.instructions.map((i) => `### ${i.path}

${nestInstruction(i.content)}`).join("\n\n")));
  }
  for (const name2 of SOURCE_ORDER) {
    const text2 = source.sections[name2]?.trim();
    if (text2) parts.push(section(name2, text2));
  }
  parts.push(section("Tool belt", toolBelt(ctx.profile, ctx.leases, ctx.bashMaxTimeoutMin)));
  const coordination2 = ctx.coordination?.trim();
  if (coordination2) parts.push(section("Coordination", coordination2));
  if (ctx.upstream.length > 0) {
    parts.push(section("Upstream reports", ctx.upstream.map((u) => `### ${u.lane}

${u.summary.trim()}`).join("\n\n")));
  }
  const report = ctx.schema === null ? describeSchema(null) : `Your final answer is a JSON object with these fields:

${describeSchema(ctx.schema)}

End with that JSON object as your final answer.`;
  parts.push(section("Report", report));
  return `${parts.join("\n\n")}
`;
}

// src/brief/parse.ts
var SECTION_NAMES = ["Task", "Scope", "Acceptance", "Facts", "Unverified", "Notes"];
var TITLE = /^# +(.*?)(?:\s+#+)?\s*$/;
var SECTION = /^## +(.*?)(?:\s+#+)?\s*$/;
function isSectionName(name2) {
  return SECTION_NAMES.includes(name2);
}
function splitBlocks(markdown) {
  let title = null;
  const blocks2 = [];
  for (const line of scanLines(markdown)) {
    if (!line.inFence) {
      const section2 = SECTION.exec(line.text)?.[1];
      if (section2 !== void 0 && section2 !== "") {
        blocks2.push({ name: section2, lines: [] });
        continue;
      }
      const heading = title === null ? TITLE.exec(line.text)?.[1] : void 0;
      if (heading !== void 0) {
        title = heading;
        continue;
      }
    }
    blocks2.at(-1)?.lines.push(line.text);
  }
  return { title: title ?? "", blocks: blocks2.map((b) => ({ name: b.name, text: b.lines.join("\n").trim() })) };
}
function parseBriefSource(markdown) {
  const { title, blocks: blocks2 } = splitBlocks(markdown);
  const parts = {};
  for (const { name: name2, text: text2 } of blocks2) {
    const key = isSectionName(name2) ? name2 : "Notes";
    const value = isSectionName(name2) ? text2 : text2 === "" ? `### ${name2}` : `### ${name2}

${text2}`;
    (parts[key] ??= []).push(value);
  }
  const sections = {};
  for (const name2 of SECTION_NAMES) {
    const list3 = parts[name2];
    if (list3 !== void 0) sections[name2] = list3.filter((p) => p !== "").join("\n\n");
  }
  return { title, sections };
}
function unknownSections(markdown) {
  return splitBlocks(markdown).blocks.map((b) => b.name).filter((name2) => !isSectionName(name2));
}

// src/brief/rules.ts
var SEPARATORS = /&&|\|\||\|&|;|\||&|\r?\n/;
function globToRegExp(pattern) {
  const body = pattern.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${body}$`, "s");
}
function matchesBashRule(command, rule) {
  const r = rule.trim();
  if (r === "Bash") return true;
  const inner = /^Bash\((.*)\)$/s.exec(r)?.[1];
  if (inner === void 0) return false;
  const pattern = inner.endsWith(":*") ? `${inner.slice(0, -2)} *` : inner;
  if (pattern === "*") return true;
  return globToRegExp(pattern).test(command.trim());
}
function splitCompound(command) {
  return command.split(SEPARATORS).map((p) => p.trim()).filter((p) => p !== "");
}
function isAllowedCommand(command, allow, deny) {
  const parts = splitCompound(command);
  if (parts.length === 0) return false;
  if (parts.some((p) => deny.some((rule) => matchesBashRule(p, rule)))) return false;
  return parts.every((p) => allow.some((rule) => matchesBashRule(p, rule)));
}

// src/brief/lint.ts
var MAX_BRIEF_CHARS = 4e4;
var REQUIRED = ["Task", "Scope", "Acceptance"];
var COMMAND_WORDS = /* @__PURE__ */ new Set([
  "git",
  "pnpm",
  "npm",
  "npx",
  "node",
  "yarn",
  "bun",
  "curl",
  "wget",
  "ls",
  "cat",
  "rm",
  "mv",
  "cp",
  "mkdir",
  "make",
  "python",
  "python3",
  "docker",
  "gh"
]);
var SHELL_FENCES = /* @__PURE__ */ new Set(["", "sh", "bash", "zsh", "shell", "console", "shell-session"]);
var FORBIDDEN = [
  ["cd ", /(?:^|[\s;&|(])cd\s/],
  ["&&", /&&/],
  ["||", /\|\|/],
  [";", /;/],
  ["$(", /\$\(/],
  ["`", /`/],
  ["sleep ", /(?:^|[\s;&|(])sleep\s/],
  ["echo $?", /echo \$\?/],
  ["| tail", /\|\s*tail\b/],
  ["| head", /\|\s*head\b/],
  ["run_in_background", /run_in_background/]
];
var ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
var SHELLS = /* @__PURE__ */ new Set(["bash", "sh", "zsh"]);
function normalizeCommand(command) {
  const words = command.trim().split(/\s+/).filter((w) => w !== "");
  let i = 0;
  while (i < words.length && (ASSIGNMENT.test(words[i] ?? "") || words[i] === "env")) i++;
  const rest = words.slice(i);
  const first = rest[0];
  if (first !== void 0 && first.includes("/")) rest[0] = first.slice(first.lastIndexOf("/") + 1);
  return rest.join(" ");
}
function shellWithString(command) {
  const [shell, ...args] = normalizeCommand(command).split(" ");
  if (shell === void 0 || !SHELLS.has(shell)) return null;
  for (const arg of args) {
    if (!arg.startsWith("-")) break;
    if (/^-[A-Za-z]*c[A-Za-z]*$/.test(arg)) return `${shell} -c`;
  }
  return null;
}
function forbiddenShapes(command) {
  const shapes = FORBIDDEN.filter(([, re]) => re.test(command)).map(([shape]) => shape);
  const shell = shellWithString(command);
  return shell === null ? shapes : [...shapes, shell];
}
var SECTION2 = /^## +(.*?)(?:\s+#+)?\s*$/;
var HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
var LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;
var TABLE_ROW = /^\s*\|/;
var RUN_INTRO = /(?:\b(?:run|runs|execute|call)|\bwith the command|\bbash)\s*:?\s*$/i;
var CHAIN = /^\s*(?:(?:,|\band\b|\bthen\b)\s*)+$/i;
function spansIn(text2) {
  const out = [];
  let from = 0;
  for (const span of inlineCodeSpans(text2)) {
    for (const run of text2.slice(from).matchAll(/`+/g)) {
      const open2 = from + run.index;
      const ticks = run[0];
      const end = open2 + ticks.length + span.length;
      if (text2.startsWith(span, open2 + ticks.length) && text2.startsWith(ticks, end) && text2.charAt(end + ticks.length) !== "`") {
        out.push({ span, start: open2, end: end + ticks.length });
        from = end + ticks.length;
        break;
      }
    }
  }
  return out;
}
function paragraphCommands(text2, section2) {
  const out = [];
  let previous = null;
  for (const { span, start, end } of spansIn(text2)) {
    const chained = previous !== null && previous.command && CHAIN.test(text2.slice(previous.end, start));
    const command = section2 === "Acceptance" || RUN_INTRO.test(text2.slice(0, start)) || chained;
    if (command) out.push(span);
    previous = { end, command };
  }
  return out;
}
function commandCandidates(markdown) {
  const out = [];
  let section2 = "";
  let paragraph = [];
  const flush = () => {
    if (paragraph.length > 0) out.push(...paragraphCommands(paragraph.join(" "), section2).map((text2) => ({ text: text2, inline: true })));
    paragraph = [];
  };
  for (const line of scanLines(markdown)) {
    if (line.inFence) {
      flush();
      if (!line.delimiter && SHELL_FENCES.has((line.info ?? "").toLowerCase()) && line.text.trim() !== "") {
        out.push({ text: line.text, inline: false });
      }
    } else if (line.text.trim() === "") {
      flush();
    } else if (HEADING.test(line.text)) {
      flush();
      const heading = SECTION2.exec(line.text)?.[1];
      if (heading !== void 0 && heading !== "") section2 = heading;
      paragraph = [line.text];
      flush();
    } else {
      if (LIST_ITEM.test(line.text) || TABLE_ROW.test(line.text)) flush();
      paragraph.push(paragraph.length === 0 ? line.text : line.text.trim());
    }
  }
  flush();
  return out;
}
function effectiveAllow(profile) {
  if (!profile.tools.includes("Bash")) return [];
  return profile.settings.sandbox.autoAllowBashIfSandboxed ? ["Bash"] : profile.settings.permissions.allow;
}
function lintBrief(markdown, source, profile) {
  const issues = [];
  for (const name2 of REQUIRED) {
    if (!source.sections[name2]?.trim()) {
      issues.push({ severity: "error", code: "missing-section", message: `the ${name2} section is missing or empty`, where: name2 });
    }
  }
  const allow = effectiveAllow(profile);
  const { deny } = profile.settings.permissions;
  for (const { text: text2, inline: inline2 } of commandCandidates(markdown)) {
    const shapes = forbiddenShapes(text2);
    if (shapes.length > 0) {
      issues.push({
        severity: "error",
        code: "forbidden-shape",
        message: `${inline2 ? "inline code" : "a code line"} uses a shape the fence refuses (${shapes.join(", ")}): give one command per line, without compounds, cd, sleep or exit-code echoes`,
        where: text2.trim()
      });
    }
    const command = text2.trim();
    const normalized = normalizeCommand(command);
    const word = normalized.split(" ")[0] ?? "";
    if (COMMAND_WORDS.has(word) && !(isAllowedCommand(command, allow, deny) && isAllowedCommand(normalized, allow, deny))) {
      issues.push({
        severity: "error",
        code: "denied-command",
        message: `\`${command}\` is not allowed by this lane's profile: the worker would be refused`,
        where: command
      });
    }
  }
  for (const name2 of unknownSections(markdown)) {
    issues.push({ severity: "warning", code: "unknown-section", message: `unknown section "${name2}" is moved under Notes`, where: name2 });
  }
  if (markdown.length > MAX_BRIEF_CHARS) {
    issues.push({
      severity: "warning",
      code: "long-brief",
      message: `the brief has ${markdown.length} characters (over ${MAX_BRIEF_CHARS}); move background into files the worker reads`
    });
  }
  return issues;
}

// src/config/load.ts
import { join as join11, sep as sep4 } from "node:path";

// src/util/env-policy.ts
var FORBIDDEN_PREFIX = /^(CLAUDE|VSCODE|CURSOR|TERM_PROGRAM)/;
var RESERVED_PREFIX = /^ANTHROPIC/;
var RESERVED_EXACT = ["HOME", "PATH"];
function isForbiddenWorkerEnv(name2) {
  return FORBIDDEN_PREFIX.test(name2) || name2 === "CLAUDECODE";
}
function isReservedEnv(name2) {
  return isForbiddenWorkerEnv(name2) || RESERVED_PREFIX.test(name2) || RESERVED_EXACT.includes(name2);
}

// src/config/load.ts
var CONFIG_FILE = "arbab.config.json";
var TOP_LEVEL_KEYS = [
  "baseBranch",
  "worktreeRoot",
  "runsRoot",
  "instructions",
  "dependencies",
  "commands",
  "env",
  "passEnv",
  "credentialPaths",
  "resources",
  "semaphores",
  "gates",
  "preflight",
  "maxParallel",
  "quota",
  "roles",
  "minClaudeVersion",
  "verify",
  "review",
  "landing"
];
function defaultConfig() {
  return {
    baseBranch: "main",
    worktreeRoot: ".arbab/worktrees",
    runsRoot: ".arbab/runs",
    instructions: [],
    dependencies: { strategy: "none" },
    commands: {},
    env: {},
    passEnv: [],
    credentialPaths: [],
    resources: {},
    semaphores: {},
    gates: [],
    preflight: { steps: [] },
    maxParallel: 4,
    quota: { holdAbove: { fiveHour: 0.85, sevenDay: 0.95 } },
    roles: {},
    minClaudeVersion: "2.1.290",
    verify: { smoke: null },
    review: { lenses: {} },
    landing: { tier: "medium" }
  };
}
var SHELL_META = /[;&|`$<>()\\\n\r]/;
var ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
var VERSION = /^\d+\.\d+\.\d+$/;
function loadConfig(projectRoot) {
  const raw = readJsonFile(join11(projectRoot, CONFIG_FILE));
  const config = defaultConfig();
  if (raw === null) return config;
  const obj = record(raw, CONFIG_FILE);
  knownKeys(obj, TOP_LEVEL_KEYS, "");
  if (obj.baseBranch !== void 0) config.baseBranch = ref(obj.baseBranch, "baseBranch");
  if (obj.worktreeRoot !== void 0) config.worktreeRoot = arbabRoot(projectRoot, obj.worktreeRoot, "worktreeRoot");
  if (obj.runsRoot !== void 0) config.runsRoot = arbabRoot(projectRoot, obj.runsRoot, "runsRoot");
  if (obj.instructions !== void 0) {
    config.instructions = stringArray(obj.instructions, "instructions").map(
      (p, i) => existingFile(projectRoot, p, `instructions[${i}]`)
    );
  }
  if (obj.dependencies !== void 0) config.dependencies = dependencies(obj.dependencies);
  if (obj.commands !== void 0) config.commands = commands(obj.commands);
  if (obj.env !== void 0) config.env = env(obj.env);
  if (obj.passEnv !== void 0) config.passEnv = passEnv(obj.passEnv);
  if (obj.credentialPaths !== void 0) config.credentialPaths = stringArray(obj.credentialPaths, "credentialPaths");
  if (obj.resources !== void 0) config.resources = resources(obj.resources);
  if (obj.semaphores !== void 0) config.semaphores = semaphores(obj.semaphores);
  if (obj.gates !== void 0) config.gates = argvList(obj.gates, "gates");
  if (obj.preflight !== void 0) {
    const pre = record(obj.preflight, "preflight");
    knownKeys(pre, ["steps"], "preflight");
    if (pre.steps !== void 0) config.preflight = { steps: argvList(pre.steps, "preflight.steps") };
  }
  if (obj.maxParallel !== void 0) config.maxParallel = integerIn(obj.maxParallel, 1, 32, "maxParallel");
  if (obj.quota !== void 0) config.quota = quota(obj.quota, config.quota);
  if (obj.roles !== void 0) config.roles = roles(obj.roles);
  if (obj.minClaudeVersion !== void 0) {
    const v = nonEmptyString(obj.minClaudeVersion, "minClaudeVersion");
    if (!VERSION.test(v)) fail("minClaudeVersion", `${JSON.stringify(v)} must be x.y.z`);
    config.minClaudeVersion = v;
  }
  if (obj.verify !== void 0) {
    const v = record(obj.verify, "verify");
    knownKeys(v, ["smoke"], "verify");
    if (v.smoke !== void 0) config.verify = { smoke: v.smoke === null ? null : argv(v.smoke, "verify.smoke") };
  }
  if (obj.review !== void 0) {
    const r = record(obj.review, "review");
    knownKeys(r, ["lenses"], "review");
    if (r.lenses !== void 0) config.review = { lenses: lenses(r.lenses) };
  }
  if (obj.landing !== void 0) {
    const l = record(obj.landing, "landing");
    knownKeys(l, ["tier"], "landing");
    if (l.tier !== void 0) config.landing = { tier: tier(l.tier) };
  }
  return config;
}
function lenses(v) {
  const obj = record(v, "review.lenses");
  const out = {};
  for (const [key, text2] of Object.entries(obj)) {
    name(key, `review.lenses key ${JSON.stringify(key)}`);
    const t = nonEmptyString(text2, `review.lenses.${key}`);
    if (t.length > 2e3) fail(`review.lenses.${key}`, "must be at most 2000 characters");
    out[key] = t;
  }
  return out;
}
function tier(v) {
  if (typeof v !== "string" || !TIERS.includes(v)) fail("landing.tier", `must be one of ${TIERS.join(", ")}`);
  return v;
}
function arbabRoot(projectRoot, v, field) {
  const s = nonEmptyString(v, field);
  const path = confined(projectRoot, s, field);
  if (path === confined(projectRoot, ".", field)) fail(field, "must not be the project root");
  const records = confined(projectRoot, INTEGRATIONS_DIR, field);
  const inside = (a, b) => a === b || a.startsWith(`${b}${sep4}`);
  if (inside(path, records) || inside(records, path)) fail(field, `must not overlap ${INTEGRATIONS_DIR}, where integration records live`);
  return s;
}
function dependencies(v) {
  const obj = record(v, "dependencies");
  if (obj.strategy === "none") {
    knownKeys(obj, ["strategy"], "dependencies");
    return { strategy: "none" };
  }
  if (obj.strategy === "command") {
    knownKeys(obj, ["strategy", "command"], "dependencies");
    return { strategy: "command", command: argv(obj.command, "dependencies.command") };
  }
  return fail("dependencies.strategy", 'must be "none" or "command"');
}
function commands(v) {
  const obj = record(v, "commands");
  const out = {};
  for (const [key, list3] of Object.entries(obj)) {
    const r = role(key, `commands.${key}`);
    out[r] = stringArray(list3, `commands.${key}`).map((prefix, i) => {
      if (SHELL_META.test(prefix)) fail(`commands.${key}[${i}]`, `${JSON.stringify(prefix)} contains a shell metacharacter`);
      return prefix;
    });
  }
  return out;
}
function env(v) {
  const obj = record(v, "env");
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!ENV_NAME.test(key)) fail(`env.${key}`, "is not a valid environment variable name");
    if (isReservedEnv(key)) fail(`env.${key}`, "is reserved");
    if (typeof value !== "string") fail(`env.${key}`, "must be a string");
    out[key] = value;
  }
  return out;
}
function passEnv(v) {
  return stringArray(v, "passEnv").map((key, i) => {
    if (!ENV_NAME.test(key)) fail(`passEnv[${i}]`, `${JSON.stringify(key)} is not a valid environment variable name`);
    if (isForbiddenWorkerEnv(key)) fail(`passEnv[${i}]`, `${key} may not be passed through`);
    return key;
  });
}
function resources(v) {
  const obj = record(v, "resources");
  const out = {};
  for (const [key, spec] of Object.entries(obj)) {
    const field = `resources.${key}`;
    name(key, field);
    const s = record(spec, field);
    knownKeys(s, ["range"], field);
    const range2 = s.range;
    if (!Array.isArray(range2) || range2.length !== 2) fail(`${field}.range`, "must be [lo, hi]");
    const [lo, hi] = key === "port" ? [1024, 65535] : [0, Number.MAX_SAFE_INTEGER];
    const a = integerIn(range2[0], lo, hi, `${field}.range[0]`);
    const b = integerIn(range2[1], lo, hi, `${field}.range[1]`);
    if (a > b) fail(`${field}.range`, "lo must not exceed hi");
    out[key] = { range: [a, b] };
  }
  return out;
}
function semaphores(v) {
  const obj = record(v, "semaphores");
  const out = {};
  for (const [key, capacity] of Object.entries(obj)) {
    name(key, `semaphores.${key}`);
    out[key] = integerIn(capacity, 1, Number.MAX_SAFE_INTEGER, `semaphores.${key}`);
  }
  return out;
}
function argvList(v, field) {
  if (!Array.isArray(v)) fail(field, "must be an array of argv arrays");
  return v.map((item, i) => argv(item, `${field}[${i}]`));
}
function quota(v, defaults) {
  const obj = record(v, "quota");
  knownKeys(obj, ["holdAbove"], "quota");
  const holdAbove = { ...defaults.holdAbove };
  if (obj.holdAbove !== void 0) {
    const h = record(obj.holdAbove, "quota.holdAbove");
    knownKeys(h, ["fiveHour", "sevenDay"], "quota.holdAbove");
    if (h.fiveHour !== void 0) holdAbove.fiveHour = threshold(h.fiveHour, "quota.holdAbove.fiveHour");
    if (h.sevenDay !== void 0) holdAbove.sevenDay = threshold(h.sevenDay, "quota.holdAbove.sevenDay");
  }
  return { holdAbove };
}
function threshold(v, field) {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > 1) fail(field, "must be in (0, 1]");
  return v;
}
function roles(v) {
  const obj = record(v, "roles");
  const out = {};
  for (const [key, overrides] of Object.entries(obj)) {
    out[role(key, `roles.${key}`)] = roleOverrides(overrides, `roles.${key}`);
  }
  return out;
}

// src/config/roles.ts
var WRITE_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "Bash"];
function preset(d) {
  Object.freeze(d.tools);
  return Object.freeze(d);
}
var ROLE_DEFAULTS = Object.freeze({
  implementer: preset({
    tools: [...WRITE_TOOLS],
    model: "claude-opus-5-5",
    effort: "high",
    budgetUsd: 10,
    wallMin: 60,
    idleMin: 20,
    loopback: true,
    checkpoint: true,
    autoResume: true,
    maxAttempts: 4
  }),
  verifier: preset({
    tools: [...WRITE_TOOLS],
    model: "claude-opus-5-5",
    effort: "high",
    budgetUsd: 10,
    wallMin: 60,
    idleMin: 20,
    loopback: true,
    checkpoint: true,
    autoResume: true,
    maxAttempts: 4
  }),
  reviewer: preset({
    tools: ["Read", "Glob", "Grep", "Bash"],
    model: "claude-opus-5-5",
    effort: "high",
    budgetUsd: 5,
    wallMin: 30,
    idleMin: 15,
    loopback: false,
    checkpoint: false,
    autoResume: true,
    maxAttempts: 3
  }),
  researcher: preset({
    tools: ["WebSearch", "WebFetch"],
    model: "claude-opus-5-5",
    effort: "medium",
    budgetUsd: 5,
    wallMin: 40,
    idleMin: 15,
    loopback: false,
    checkpoint: false,
    autoResume: true,
    maxAttempts: 3
  }),
  probe: preset({
    tools: ["Read", "Write", "Bash"],
    model: "claude-haiku-5-5",
    effort: "low",
    budgetUsd: 0.5,
    wallMin: 10,
    idleMin: 5,
    loopback: true,
    checkpoint: false,
    autoResume: false,
    maxAttempts: 1
  })
});
function resolveRole(config, role2) {
  const out = { ...ROLE_DEFAULTS[role2], tools: [...ROLE_DEFAULTS[role2].tools] };
  const overrides = config.roles[role2] ?? {};
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== void 0) Object.assign(out, { [key]: Array.isArray(value) ? [...value] : value });
  }
  return out;
}
function effectiveRole(config, lane) {
  const r = resolveRole(config, lane.role);
  const listed = lane.tools;
  const tools = listed === void 0 ? r.tools : r.tools.filter((t) => listed.includes(t));
  if (tools.length === 0) {
    throw new ArbabError("config", `lane ${lane.name}: tools ${listed?.join(", ") ?? ""} name none of role ${lane.role}'s tools (${r.tools.join(", ")})`);
  }
  return {
    ...r,
    tools,
    model: lane.model ?? r.model,
    effort: lane.effort ?? r.effort,
    budgetUsd: lane.budgetUsd ?? r.budgetUsd,
    wallMin: lane.wallMin ?? r.wallMin,
    idleMin: lane.idleMin ?? r.idleMin,
    checkpoint: lane.checkpoint ?? r.checkpoint,
    autoResume: lane.autoResume ?? r.autoResume,
    maxAttempts: lane.maxAttempts ?? r.maxAttempts
  };
}

// src/profile/rules.ts
var FORBIDDEN2 = /[;&|`$<>()\\*\n\r]/;
var WORDS = /^\S+( \S+)*$/;
function commandRules(prefix) {
  if (prefix === "") throw new ArbabError("lint", "command prefix is empty");
  if (FORBIDDEN2.test(prefix)) {
    throw new ArbabError("lint", `command prefix ${JSON.stringify(prefix)} contains a shell metacharacter`);
  }
  if (!WORDS.test(prefix)) {
    throw new ArbabError("lint", `command prefix ${JSON.stringify(prefix)} must be words separated by single spaces`);
  }
  return [`Bash(${prefix})`, `Bash(${prefix} *)`];
}
function credentialDenies(extra) {
  const rules = [];
  for (const path of [...BUILTIN_CREDENTIAL_PATHS, ...extra]) rules.push(`Read(${path})`, `Edit(${path})`);
  return dedupe(rules);
}
function dedupe(items) {
  return [...new Set(items)];
}

// src/profile/compile.ts
import { isAbsolute as isAbsolute4, join as join12, resolve as resolve7 } from "node:path";
var FILE_TOOLS2 = /* @__PURE__ */ new Set(["Read", "Glob", "Grep", "Edit", "Write"]);
var WRITE_TOOLS2 = /* @__PURE__ */ new Set(["Edit", "Write"]);
var WRITERS = ["implementer", "verifier", "probe"];
function compileProfile(input) {
  if (!isAbsolute4(input.worktree)) {
    throw new ArbabError("usage", `worktree ${JSON.stringify(input.worktree)} must be an absolute path`);
  }
  const gitDir = input.gitCommonDir === void 0 ? void 0 : sharedGitDir(input.gitCommonDir);
  let allow = dedupe([
    ...input.tools.filter((t) => FILE_TOOLS2.has(t) && (!WRITE_TOOLS2.has(t) || WRITERS.includes(input.role))),
    ...roleAllow(input.role),
    ...input.commands.flatMap(commandRules),
    ...input.laneAllow
  ]);
  if (input.fence === "sandbox-auto") allow = allow.filter((rule) => !rule.startsWith("Bash("));
  const deny = dedupe([
    ...credentialDenies(input.credentialPaths),
    // `//` makes the path absolute; a single `/` would be relative to the settings file.
    ...gitDir === void 0 ? [] : [`Edit(/${gitDir}/**)`, `Write(/${gitDir}/**)`],
    BACKGROUND_DENY,
    ...GIT_WRITE_VERBS.flatMap((verb) => commandRules(`git ${verb}`)),
    "Bash(git -C)",
    "Bash(git -C *)",
    "NotebookEdit",
    ...input.role === "researcher" ? [] : ["WebFetch", "WebSearch"],
    ...input.role === "reviewer" ? ["Edit", "Write"] : []
  ]);
  const settings = {
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: input.fence === "sandbox-auto",
      allowUnsandboxedCommands: false,
      network: { allowLocalBinding: input.loopback },
      // Otherwise a sandboxed command can write refs and objects of the shared repository (measured, M1 review).
      ...gitDir === void 0 ? {} : { filesystem: { denyWrite: [gitDir] } }
    },
    env: {
      ...input.env,
      ...FIXED_ENV,
      // Keeps git and friends off the denied ~/.config, which otherwise warns with EPERM on every call.
      XDG_CONFIG_HOME: join12(input.worktree, ".arbab-tmp", "xdg-config")
    },
    permissions: { allow, deny }
  };
  return { tools: input.tools, settings };
}
function sharedGitDir(dir) {
  if (!isAbsolute4(dir)) {
    throw new ArbabError("usage", `gitCommonDir ${JSON.stringify(dir)} must be an absolute path`);
  }
  const normal = resolve7(dir);
  if (normal === "/") throw new ArbabError("usage", "gitCommonDir must not be the filesystem root");
  return normal;
}
function readAllow() {
  return [...GIT_READ_VERBS.flatMap((verb) => commandRules(`git ${verb}`)), ...READ_UTILITIES.flatMap(commandRules), "Bash(pwd)"];
}
function roleAllow(role2) {
  switch (role2) {
    case "implementer":
    case "verifier":
      return [...readAllow(), ...FILE_UTILITIES.flatMap(commandRules)];
    case "reviewer":
      return readAllow();
    case "researcher":
      return ["WebSearch", "WebFetch"];
    case "probe":
      return ["Bash(git rev-parse *)", "Bash(git status)", "Bash(ls)", "Bash(ls *)"];
  }
}

// src/profile/args.ts
var UUID2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function buildClaudeArgs(input) {
  if (input.model === "" || input.model.startsWith("-")) {
    throw new ArbabError("usage", `model ${JSON.stringify(input.model)} is not a model name`);
  }
  if (!EFFORTS.includes(input.effort)) {
    throw new ArbabError("usage", `effort ${JSON.stringify(input.effort)} must be one of ${EFFORTS.join(", ")}`);
  }
  if (!Number.isFinite(input.budgetUsd) || input.budgetUsd <= 0) {
    throw new ArbabError("usage", `budget ${String(input.budgetUsd)} must be a positive number`);
  }
  if (input.settingsPath === "") throw new ArbabError("usage", "settings path is empty");
  assertValidName(input.name, "lane name");
  if (!UUID2.test(input.session.id)) {
    throw new ArbabError("usage", `session id ${JSON.stringify(input.session.id)} is not a UUID`);
  }
  if (input.tools.length === 0) throw new ArbabError("usage", "tool list is empty");
  for (const tool of input.tools) {
    if (tool === "" || tool.includes(",")) {
      throw new ArbabError("usage", `tool ${JSON.stringify(tool)} must be a non-empty name without commas`);
    }
  }
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    input.model,
    "--effort",
    input.effort,
    "--permission-mode",
    "dontAsk",
    "--permission-prompts",
    "none",
    "--strict-mcp-config",
    // An empty source list: no user, project or local settings reach the worker.
    "--setting-sources",
    "",
    "--restricted",
    "--tools",
    input.tools.join(","),
    "--settings",
    input.settingsPath,
    "--max-budget-usd",
    String(input.budgetUsd),
    "-n",
    input.name,
    input.session.kind === "new" ? "--session-id" : "--resume",
    input.session.id
  ];
  if (input.schema !== null) args.push("--json-schema", JSON.stringify(input.schema));
  return args;
}

// src/profile/env.ts
import { isAbsolute as isAbsolute5 } from "node:path";
var HOST_KEYS = ["HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "SHELL"];
var SYSTEM_PATH = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
var ENV_NAME2 = /^[A-Za-z_][A-Za-z0-9_]*$/;
function workerEnv(host, opts) {
  for (const name2 of opts.passEnv) assertWorkerEnvName(name2, isForbiddenWorkerEnv);
  for (const name2 of Object.keys(opts.extra)) assertWorkerEnvName(name2, isReservedEnv);
  const dirs = opts.pnpmDir === void 0 ? [opts.nodeDir] : [opts.nodeDir, opts.pnpmDir];
  for (const dir of dirs) {
    if (!isAbsolute5(dir) || dir.includes(":")) {
      throw new ArbabError("config", `PATH entry ${JSON.stringify(dir)} must be an absolute path without ":"`);
    }
  }
  const env2 = {};
  for (const key of HOST_KEYS) {
    const value = host[key];
    if (value !== void 0) env2[key] = value;
  }
  env2.PATH = [.../* @__PURE__ */ new Set([...dirs, ...SYSTEM_PATH])].join(":");
  env2.TERM = "dumb";
  env2.DISABLE_AUTOUPDATER = "1";
  for (const name2 of opts.passEnv) {
    const value = host[name2];
    if (value !== void 0) env2[name2] = value;
  }
  Object.assign(env2, opts.extra);
  return env2;
}
function assertWorkerEnvName(name2, refused) {
  if (!ENV_NAME2.test(name2)) {
    throw new ArbabError("config", `environment name ${JSON.stringify(name2)} is not a valid variable name`);
  }
  if (refused(name2)) {
    throw new ArbabError("config", `environment name ${name2} must not reach a worker`);
  }
}

// src/profile/lint.ts
import { resolve as resolve8 } from "node:path";
var BASH_RULE = /^Bash\((.*)\)$/s;
var PARAM_RULE = /^\s*([A-Za-z_]+)\s*:/;
var PATH_RULE = /^(?:Read|Edit)\((.*)\)$/s;
function lintProfile(profile, input) {
  const issues = [];
  const error = (code4, message4, where) => {
    issues.push({ severity: "error", code: code4, message: message4, where });
  };
  const warn = (code4, message4, where) => {
    issues.push({ severity: "warning", code: code4, message: message4, where });
  };
  const { allow, deny } = profile.settings.permissions;
  const denied = new Set(deny);
  for (const rule of allow) {
    const bash = bashContent(rule);
    if (bash !== null) {
      if (bash === "" || bash.startsWith("*")) {
        error("bare-bash-allow", "allows every Bash command", rule);
      } else {
        const fixed = wildcardPrefix(bash);
        if (fixed !== null && ANY_CODE_PREFIXES.includes(fixed)) {
          error("any-code-allow", `"${fixed}" followed by a wildcard runs arbitrary code`, rule);
        }
      }
      if (bash.includes(":*")) warn("colon-star-form", "use the space form (`Bash(cmd *)`) instead of `:*`", rule);
    }
    if (denied.has(rule)) warn("shadowed-allow", "the same rule is denied, so this allow has no effect", rule);
  }
  const rules = [...allow.map((rule) => ({ rule, isDeny: false })), ...deny.map((rule) => ({ rule, isDeny: true }))];
  for (const { rule, isDeny } of rules) {
    const bash = bashContent(rule);
    const param = bash === null ? void 0 : PARAM_RULE.exec(bash)?.[1];
    if (param !== void 0 && BASH_INPUT_PARAMS.includes(param) && !(isDeny && rule === BACKGROUND_DENY)) {
      error("param-rule", `"${param}:" is read as a Bash input parameter rule, not a command`, rule);
    }
    const path = PATH_RULE.exec(rule)?.[1]?.trim();
    if (path !== void 0 && path.startsWith("/") && !path.startsWith("//")) {
      error("relative-path-rule", "a single leading / is relative to the settings file; use // for absolute", rule);
    }
  }
  const sandbox = profile.settings.sandbox;
  if (sandbox.enabled !== true) error("sandbox-disabled", "the sandbox must be enabled", "sandbox.enabled");
  if (sandbox.failIfUnavailable !== true) {
    error("sandbox-fail-open", "a missing sandbox must be fatal", "sandbox.failIfUnavailable");
  }
  if (sandbox.allowUnsandboxedCommands !== false) {
    error("unsandboxed-retry", "an allow rule could approve an unsandboxed retry", "sandbox.allowUnsandboxedCommands");
  }
  if (sandbox.autoAllowBashIfSandboxed !== false && input.fence === "strict") {
    error("auto-allow-strict", "fence strict must not auto-allow sandboxed Bash", "sandbox.autoAllowBashIfSandboxed");
  }
  if (profile.tools.includes("Bash")) {
    const gitDir = input.gitCommonDir;
    if (gitDir === void 0) {
      warn(
        "shared-git-writable",
        "no shared git directory is known, so sandboxed commands can write its refs and objects",
        "sandbox.filesystem.denyWrite"
      );
    } else if (!(sandbox.filesystem?.denyWrite ?? []).map((p) => resolve8(p)).includes(resolve8(gitDir))) {
      warn("shared-git-writable", `${gitDir} is not in the sandbox's denyWrite`, "sandbox.filesystem.denyWrite");
    }
  }
  for (const tool of profile.tools) {
    if (tool === "Task" || tool === "Agent") error("agent-tool", "nested agents are not budgeted", tool);
  }
  for (const key of Object.keys(input.env)) {
    if (Object.hasOwn(FIXED_ENV, key) || key === "XDG_CONFIG_HOME") {
      warn("reserved-env", `${key} is set by arbab; this value is ignored`, key);
    }
  }
  return issues;
}
function bashContent(rule) {
  if (rule === "Bash") return "";
  const content = BASH_RULE.exec(rule)?.[1];
  return content === void 0 ? null : content.trim();
}
function wildcardPrefix(content) {
  const star = content.indexOf("*");
  if (star === -1) return null;
  return content.slice(0, star).trim().replace(/:$/, "").trim().split(/\s+/).join(" ");
}

// src/commands/project.ts
import { existsSync as existsSync6 } from "node:fs";
import { dirname as dirname4, join as join13, resolve as resolve9 } from "node:path";
import { parseArgs } from "node:util";
function findProjectRoot(cwd, git) {
  let dir = resolve9(cwd);
  for (; ; ) {
    if (existsSync6(join13(dir, CONFIG_FILE))) return dir;
    const parent = dirname4(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const r = git(["rev-parse", "--show-toplevel"], cwd);
  const top = r.stdout.trim();
  return r.code === 0 && top !== "" ? top : null;
}
function openProject(ctx) {
  const root = findProjectRoot(ctx.cwd, ctx.git);
  if (root === null) {
    throw new ArbabError("usage", `no ${CONFIG_FILE} or git repository at or above ${ctx.cwd}`);
  }
  const config = loadConfig(root);
  return { root, config, runsRoot: confine(root, config.runsRoot), worktreeRoot: confine(root, config.worktreeRoot) };
}
function parse(command, config) {
  try {
    return parseArgs({ ...config, strict: true });
  } catch (err) {
    throw new ArbabError("usage", `${err.message} (see arbab ${command} --help)`, { cause: err });
  }
}
function onePositional(command, positionals, what) {
  const [value, ...rest] = positionals;
  if (value === void 0 || rest.length > 0) throw new ArbabError("usage", `usage: arbab ${command} <${what}>`);
  return value;
}
function printJson(ctx, value) {
  ctx.stdout(JSON.stringify(value, null, 2) + "\n");
}
var isActive = (state) => state !== "finished" && state !== "orphaned";

// src/commands/lint.ts
function resolveGitCommonDir(git, root) {
  const r = git(["rev-parse", "--git-common-dir"], root);
  const out = r.stdout.trim();
  if (r.code !== 0 || out === "") return void 0;
  const path = resolve10(root, out);
  try {
    return realpathSync4(path);
  } catch {
    return path;
  }
}
function profileInputFor(project, lane, gitCommonDir2) {
  const defaults = effectiveRole(project.config, lane);
  const leases = Object.entries(lane.resources ?? {}).flatMap(
    ([type, count]) => Array.from({ length: count }, () => ({ type, value: 0, lane: lane.name, project: project.root, pid: 0, createdAt: "" }))
  );
  return {
    role: lane.role,
    fence: lane.fence ?? "strict",
    tools: defaults.tools,
    loopback: defaults.loopback,
    commands: project.config.commands[lane.role] ?? [],
    laneAllow: lane.allow ?? [],
    credentialPaths: project.config.credentialPaths,
    env: { ...project.config.env, ...leaseEnv(leases) },
    worktree: join14(project.worktreeRoot, lane.worktree ?? lane.name),
    ...gitCommonDir2 !== void 0 && { gitCommonDir: gitCommonDir2 }
  };
}
function readRequired(path, what) {
  const text2 = readText(path);
  if (text2 === null) throw new ArbabError("io", `cannot read ${what} ${path}: no such file`);
  return text2;
}
function lintLane(project, lanePath, gitCommonDir2) {
  return lintLaneSpec(project, loadLane(project.root, lanePath), gitCommonDir2);
}
function lintLaneSpec(project, lane, gitCommonDir2) {
  const input = profileInputFor(project, lane, gitCommonDir2);
  const profile = compileProfile(input);
  const issues = lintProfile(profile, input);
  const markdown = readRequired(confine(project.root, lane.brief), "brief");
  issues.push(...lintBrief(markdown, parseBriefSource(markdown), profile));
  if (lane.schema !== void 0) {
    let schema;
    try {
      schema = JSON.parse(readRequired(confine(project.root, lane.schema), "schema"));
    } catch (err) {
      if (err instanceof ArbabError) throw err;
      issues.push({ severity: "error", code: "schema-json", message: `not valid JSON: ${err.message}`, where: lane.schema });
    }
    if (schema !== void 0 && (typeof schema !== "object" || schema === null || Array.isArray(schema))) {
      issues.push({ severity: "error", code: "schema-json", message: "the schema must be a JSON object", where: lane.schema });
    }
  }
  return { lane, profile, issues };
}
function formatIssue(issue) {
  const where = issue.where === void 0 ? "" : `  (${issue.where})`;
  return `${issue.severity}  ${issue.code}  ${issue.message}${where}`;
}
var hasErrors = (issues) => issues.some((i) => i.severity === "error");
function issueSummary(lane, issues) {
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;
  return issues.length === 0 ? `${lane}: ok` : `${lane}: ${errors} error(s), ${warnings} warning(s)`;
}
async function runLint(argv2, ctx) {
  const { values, positionals } = parse("lint", {
    args: argv2,
    options: { json: { type: "boolean" } },
    allowPositionals: true
  });
  const lanePath = onePositional("lint", positionals, "lane.json");
  const project = openProject(ctx);
  const { lane, issues } = lintLane(project, lanePath, resolveGitCommonDir(ctx.git, project.root));
  if (values.json === true) {
    printJson(ctx, { lane: lane.name, ok: !hasErrors(issues), issues });
  } else {
    for (const issue of issues) ctx.stdout(formatIssue(issue) + "\n");
    ctx.stdout(issueSummary(lane.name, issues) + "\n");
  }
  return hasErrors(issues) ? 1 : 0;
}

// src/commands/launch.ts
var LAUNCH_LOCK_MS = 1e4;
var LAUNCH_POLL_MS = 50;
var launchLockPath = (project, lane) => join15(runPaths(project.runsRoot, lane).laneDir, "launch.lock");
function takeLaunchLock(ctx, project, lane, pid) {
  const path = launchLockPath(project, lane);
  const holder = { pid, lane, project: project.root, createdAt: isoAt(ctx.clock) };
  const data = JSON.stringify(holder);
  const unparsedIsStale = () => {
    try {
      return ctx.clock.now() - statSync4(path).mtimeMs > LAUNCH_LOCK_MS;
    } catch {
      return false;
    }
  };
  if (!createExclusive(path, data) && !(releaseIfStale(path, ctx.alive, unparsedIsStale()) && createExclusive(path, data))) {
    throw new ArbabError("usage", `lane ${lane} is being launched by another arbab process (${path}); wait for it or check status`);
  }
  return () => {
    try {
      if (readText(path) === data) rmSync3(path, { force: true });
    } catch {
    }
  };
}
async function awaitFirstState(ctx, project, lane, shepherdPid2) {
  const deadline = ctx.clock.now() + LAUNCH_LOCK_MS;
  while (ctx.clock.now() < deadline && ctx.alive(shepherdPid2)) {
    try {
      if (readState(project.runsRoot, lane)?.shepherdPid === shepherdPid2) return;
    } catch {
    }
    await ctx.sleep(LAUNCH_POLL_MS);
  }
}
async function launchLane(ctx, project, lanePath, opts = {}) {
  const { lane, issues } = lintLane(project, lanePath, resolveGitCommonDir(ctx.git, project.root));
  if (hasErrors(issues)) {
    for (const issue of issues) ctx.stderr(formatIssue(issue) + "\n");
    throw new ArbabError("lint", `${issueSummary(lane.name, issues)}; not launched`);
  }
  const release = takeLaunchLock(ctx, project, lane.name, ctx.pid);
  try {
    if (opts.generated !== true) assertNotGenerated(project.runsRoot, lane.name);
    if (lane.worktree !== void 0 && lane.worktree !== lane.name) assertNotGeneratedWorktree(project.runsRoot, lane.name, lane.worktree);
    assertInactive(ctx, project, lane.name);
    assertNoLiveWorker(ctx, project, lane.name);
    const paths = runPaths(project.runsRoot, lane.name);
    const ranBefore = readState(project.runsRoot, lane.name) !== null || listAttempts(project.runsRoot, lane.name).length > 0;
    if (ranBefore && opts.onlyNew === true) throw new ArbabError("usage", `lane ${lane.name} has already been launched`);
    writeJsonAtomic(paths.laneFile, lane);
    const mode = ranBefore ? "fresh" : "start";
    const shepherdPid2 = ctx.spawnShepherd(project.root, lane.name, { kind: mode });
    await awaitFirstState(ctx, project, lane.name, shepherdPid2);
    return { lane: lane.name, runDir: paths.laneDir, shepherdPid: shepherdPid2, mode, warnings: issues };
  } finally {
    release();
  }
}
function assertNotGeneratedWorktree(runsRoot, lane, worktree) {
  const marker = readGenerated(runsRoot, worktree);
  if (marker === null) return;
  const prefix = ownerTag({ integration: "" });
  const owner = marker.by?.startsWith(prefix) === true ? marker.by.slice(prefix.length) : null;
  throw new ArbabError(
    "usage",
    `lane ${lane} borrows the worktree of lane ${worktree}, which was generated by ${owner === null ? "an integration" : `integration ${owner}`}, which owns it; only its arbab verify or arbab review works there. Borrow another lane's worktree`
  );
}
function assertInactive(ctx, project, lane) {
  const record2 = readState(project.runsRoot, lane);
  if (record2 === null) return;
  const state = effectiveState(record2, ctx.alive);
  if (isActive(state)) {
    throw new ArbabError("usage", `lane ${lane} is ${state} (shepherd ${record2.shepherdPid}); stop it or wait for it first`);
  }
}
function assertNoLiveWorker(ctx, project, lane) {
  const attempt = listAttempts(project.runsRoot, lane).at(-1);
  if (attempt === void 0) return;
  const { started, exit } = readAttempt(runPaths(project.runsRoot, lane).attemptDir(attempt));
  if (started === null || exit !== null) return;
  const pid = started.pid;
  if (!Number.isInteger(pid) || pid <= 1 || !ctx.alive(pid)) return;
  const command = ctx.processCommand(pid);
  const binary = typeof started.binary?.path === "string" ? started.binary.path : null;
  if (command !== null && binary !== null && !command.includes(binary)) return;
  throw new ArbabError("usage", `lane ${lane}'s worker from attempt ${attempt} (pid ${pid}) is still running without its shepherd; run arbab cleanup first`);
}
async function runLaunch(argv2, ctx) {
  const { values, positionals } = parse("launch", {
    args: argv2,
    options: { json: { type: "boolean" } },
    allowPositionals: true
  });
  const lanePath = onePositional("launch", positionals, "lane.json");
  const launched = await launchLane(ctx, openProject(ctx), lanePath);
  if (values.json === true) {
    printJson(ctx, launched);
  } else {
    for (const issue of launched.warnings) ctx.stderr(formatIssue(issue) + "\n");
    ctx.stdout(`launched ${launched.lane}  run ${launched.runDir}  shepherd ${launched.shepherdPid}
`);
  }
  return 0;
}

// src/commands/preflight.ts
import { existsSync as existsSync9 } from "node:fs";
import { join as join18, relative as relative5 } from "node:path";

// src/commands/doctor.ts
import { randomBytes as randomBytes3 } from "node:crypto";
import { rmSync as rmSync4 } from "node:fs";
import { join as join17 } from "node:path";

// src/binary/node.ts
import { execFileSync as execFileSync2 } from "node:child_process";
import { existsSync as existsSync7, realpathSync as realpathSync5 } from "node:fs";
function runVersion(path, args) {
  return execFileSync2(path, args, { encoding: "utf8", timeout: 3e4, stdio: ["ignore", "pipe", "pipe"] });
}
function pathExists(p) {
  return existsSync7(p);
}
function realpath(p) {
  return realpathSync5(p);
}

// src/binary/resolve.ts
import { isAbsolute as isAbsolute6, join as join16 } from "node:path";
function parseVersion(text2) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(text2);
  if (m === null) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa === null || pb === null) {
    throw new ArbabError("binary", `cannot compare versions ${JSON.stringify(a)} and ${JSON.stringify(b)}`);
  }
  for (let i = 0; i < 3; i++) {
    const x = pa[i];
    const y = pb[i];
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
function findOnPath(cmd, pathEnv, exists) {
  if (cmd === "" || cmd.includes("/")) return null;
  for (const dir of pathEnv.split(":")) {
    if (dir === "" || !isAbsolute6(dir)) continue;
    const candidate = join16(dir, cmd);
    if (exists(candidate)) return candidate;
  }
  return null;
}
function resolveBinary(opts) {
  if (opts.pinned !== null) return checkPinned(opts.pinned, opts);
  let found;
  if (opts.explicitPath !== null && opts.explicitPath !== "") {
    found = opts.exists(opts.explicitPath) ? opts.explicitPath : null;
    if (found === null) throw new ArbabError("binary", `ARBAB_CLAUDE ${opts.explicitPath} does not exist`);
  } else {
    found = findOnPath("claude", opts.pathEnv, opts.exists);
    if (found === null) throw new ArbabError("binary", "claude not found on PATH (set ARBAB_CLAUDE to its path)");
  }
  let path;
  try {
    path = opts.realpath(found);
  } catch (err) {
    throw new ArbabError("binary", `cannot resolve ${found}: ${err.message}`, { cause: err });
  }
  const version = readVersion(path, opts.run);
  if (compareVersions(version, opts.minVersion) < 0) {
    throw new ArbabError("binary", `claude ${version} at ${path} is older than the required ${opts.minVersion}`);
  }
  return { path, version };
}
function checkPinned(pinned, opts) {
  const changed = (detail) => new ArbabError("binary", `binary changed since the attempt this one resumes: ${detail}`);
  if (!opts.exists(pinned.path)) throw changed(`${pinned.path} no longer exists`);
  let version;
  try {
    version = readVersion(pinned.path, opts.run);
  } catch (err) {
    throw changed(err.message);
  }
  if (version !== pinned.version) throw changed(`${pinned.path} reports ${version}, not ${pinned.version}`);
  return { path: pinned.path, version };
}
function readVersion(path, run) {
  let output4;
  try {
    output4 = run(path, ["--version"]);
  } catch (err) {
    throw new ArbabError("binary", `${path} --version failed: ${err.message}`, { cause: err });
  }
  const parsed = parseVersion(output4);
  if (parsed === null) {
    throw new ArbabError("binary", `${path} --version printed no version: ${JSON.stringify(output4.slice(0, 200))}`);
  }
  return parsed.join(".");
}

// src/commands/doctor.ts
var MIN_NODE = "20.0.0";
var MIN_GIT = "2.20.0";
var message = (err) => err instanceof Error ? err.message : String(err);
function atLeast(version, min) {
  return parseVersion(version) !== null && compareVersions(version, min) >= 0;
}
function checkNode(nodeVersion) {
  return atLeast(nodeVersion, MIN_NODE) ? { status: "ok", check: "node", detail: nodeVersion } : { status: "fail", check: "node", detail: `${nodeVersion} is older than ${MIN_NODE}` };
}
function checkGit(ctx) {
  const r = ctx.git(["--version"], ctx.cwd);
  const version = parseVersion(r.stdout)?.join(".") ?? null;
  if (r.code !== 0 || version === null) return { status: "fail", check: "git", detail: `git --version failed: ${(r.stderr || r.stdout).trim()}` };
  return atLeast(version, MIN_GIT) ? { status: "ok", check: "git", detail: version } : { status: "fail", check: "git", detail: `${version} is older than ${MIN_GIT}` };
}
function checkClaude(deps, config) {
  try {
    const binary = resolveBinary({
      pinned: null,
      explicitPath: deps.explicitClaude,
      pathEnv: deps.pathEnv,
      minVersion: config.minClaudeVersion,
      run: deps.run,
      exists: deps.exists,
      realpath: deps.realpath
    });
    return { status: "ok", check: "claude", detail: `${binary.version} at ${binary.path} (minimum ${config.minClaudeVersion})` };
  } catch (err) {
    return { status: "fail", check: "claude", detail: message(err) };
  }
}
function checkSandbox(platform, deps) {
  if (platform === "darwin") {
    return deps.exists("/usr/bin/sandbox-exec") ? { status: "ok", check: "sandbox", detail: "/usr/bin/sandbox-exec" } : { status: "fail", check: "sandbox", detail: "/usr/bin/sandbox-exec is missing" };
  }
  if (platform === "linux") {
    const missing = ["bwrap", "socat"].filter((cmd) => findOnPath(cmd, deps.pathEnv, deps.exists) === null);
    return missing.length === 0 ? { status: "ok", check: "sandbox", detail: "bwrap and socat on PATH" } : { status: "fail", check: "sandbox", detail: `${missing.join(" and ")} not on PATH` };
  }
  return { status: "fail", check: "sandbox", detail: `Claude Code has no sandbox on ${platform}` };
}
function checkIgnored(ctx, root, config) {
  const notIgnored = [];
  for (const entry of [config.worktreeRoot, config.runsRoot]) {
    const probe = `${entry.replace(/\/+$/, "")}/x`;
    if (ctx.git(["check-ignore", "-q", "--", probe], root).code !== 0) notIgnored.push(entry);
  }
  return notIgnored.length === 0 ? { status: "ok", check: "ignored", detail: `${config.worktreeRoot} and ${config.runsRoot} are ignored` } : { status: "warn", check: "ignored", detail: `${notIgnored.join(", ")} not ignored yet (the shepherd adds them to info/exclude)` };
}
function checkHome(home) {
  const probe = join17(home, `.doctor-${randomBytes3(6).toString("hex")}`);
  try {
    ensureDir(home);
    createExclusive(probe, "");
    rmSync4(probe, { force: true });
    return { status: "ok", check: "home", detail: `${home} is writable` };
  } catch (err) {
    return { status: "fail", check: "home", detail: `${home} is not writable: ${message(err)}` };
  }
}
function doctorChecks(ctx) {
  const checks = [checkNode(ctx.nodeVersion), checkGit(ctx)];
  const root = findProjectRoot(ctx.cwd, ctx.git);
  let config = null;
  if (root === null) {
    checks.push({ status: "fail", check: "config", detail: `no arbab.config.json or git repository at or above ${ctx.cwd}` });
  } else {
    try {
      config = loadConfig(root);
      checks.push({ status: "ok", check: "config", detail: `${root}` });
    } catch (err) {
      checks.push({ status: "fail", check: "config", detail: message(err) });
    }
  }
  let deps = null;
  try {
    deps = ctx.shepherdDeps();
  } catch (err) {
    checks.push({ status: "fail", check: "claude", detail: message(err) });
    checks.push({ status: "fail", check: "sandbox", detail: message(err) });
  }
  if (deps !== null) {
    checks.push(checkClaude(deps, config ?? defaultConfig()));
    checks.push(checkSandbox(ctx.platform, deps));
  }
  if (root !== null && config !== null) checks.push(checkIgnored(ctx, root, config));
  checks.push(checkHome(ctx.home));
  return checks;
}
function formatChecks(checks) {
  const width = Math.max(...checks.map((c) => c.check.length));
  return checks.map((c) => `${c.status.padEnd(4)}  ${c.check.padEnd(width)}  ${c.detail}`).join("\n");
}
async function runDoctor(argv2, ctx) {
  const { values } = parse("doctor", { args: argv2, options: { json: { type: "boolean" } }, allowPositionals: false });
  const checks = doctorChecks(ctx);
  const ok = checks.every((c) => c.status !== "fail");
  if (values.json === true) printJson(ctx, { ok, checks });
  else ctx.stdout(formatChecks(checks) + "\n");
  return ok ? 0 : 1;
}

// src/commands/wait.ts
import { existsSync as existsSync8 } from "node:fs";
var WAIT_TIMEOUT_EXIT = 3;
var POLL_MS = 2e3;
var NONE = "\u2014";
function describeFinished(runsRoot, item) {
  const s = item.summary;
  const report = item.attempt === null ? null : attemptFiles(runPaths(runsRoot, item.lane).attemptDir(item.attempt)).report;
  const endState = item.endState ?? (item.state === "orphaned" ? "orphaned" : s?.state ?? item.state);
  return {
    lane: item.lane,
    attempt: item.attempt,
    state: item.state,
    endState,
    reason: item.reason,
    wallMs: s?.wallMs ?? null,
    turns: s?.turns ?? 0,
    toolCalls: s?.toolCallTotal ?? 0,
    failed: s?.failedTotal ?? 0,
    costDeltaUsd: s?.costDeltaUsd ?? null,
    report: report !== null && existsSync8(report) ? report : null
  };
}
function formatFinished(line) {
  const parts = [line.attempt === null ? line.lane : `${line.lane}#${line.attempt}`, line.endState];
  if (line.attempt !== null) {
    const wall = line.wallMs === null ? NONE : formatElapsed(line.wallMs);
    const cost = line.costDeltaUsd === null ? NONE : `$${line.costDeltaUsd.toFixed(2)}`;
    parts.push(wall, `turns=${line.turns}`, `calls=${line.toolCalls}`, `failed=${line.failed}`, `cost=${cost}`);
  }
  if (line.report !== null) parts.push(`report=${line.report}`);
  if (line.reason !== null && line.reason.trim() !== "") parts.push(`reason: ${line.reason.trim().replace(/\s+/g, " ")}`);
  return parts.join(" ");
}
function parseTimeoutMin(text2) {
  if (text2 === void 0) return Infinity;
  const n = Number(text2);
  if (text2.trim() === "" || !Number.isFinite(n) || n < 0) {
    throw new ArbabError("usage", `--timeout-min ${JSON.stringify(text2)} must be a non-negative number`);
  }
  return n * 6e4;
}
async function runWait(argv2, ctx) {
  const { values, positionals } = parse("wait", {
    args: argv2,
    options: {
      any: { type: "boolean" },
      all: { type: "boolean" },
      "timeout-min": { type: "string" },
      json: { type: "boolean" }
    },
    allowPositionals: true
  });
  if (values.any === true && values.all === true) throw new ArbabError("usage", "--any and --all exclude each other");
  const timeoutMs = parseTimeoutMin(values["timeout-min"]);
  for (const lane of positionals) assertValidName(lane, "lane");
  const project = openProject(ctx);
  const result = await waitForFinished({
    runsRoot: project.runsRoot,
    lanes: positionals.length > 0 ? positionals : null,
    mode: values.all === true ? "all" : "any",
    timeoutMs,
    pollMs: POLL_MS,
    clock: ctx.clock,
    sleep: ctx.sleep,
    alive: ctx.alive
  });
  const lines = result.finished.map((item) => describeFinished(project.runsRoot, item));
  if (values.json === true) {
    printJson(ctx, { timedOut: result.timedOut, finished: lines });
  } else {
    for (const line of lines) ctx.stdout(formatFinished(line) + "\n");
    if (result.timedOut) ctx.stderr("arbab wait: timed out\n");
  }
  return result.timedOut ? WAIT_TIMEOUT_EXIT : 0;
}

// src/commands/preflight.ts
var PROBE_MODEL = "claude-haiku-5-5";
var SHA_COMMAND = "git rev-parse --short HEAD";
var DEFAULT_TIMEOUT_MIN = 45;
var POLL_MS2 = 5e3;
var FALLBACK_STEP = ["git", "status"];
var TOOLS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: { n: { type: "integer" }, command: { type: "string" }, exit_code: { type: "integer" }, output: { type: "string" } },
        required: ["n", "command", "exit_code"]
      }
    }
  },
  required: ["steps"]
};
var MODEL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { answer: { type: "string" } },
  required: ["answer"]
};
function stepCommands(steps) {
  return (steps.length > 0 ? steps : [FALLBACK_STEP]).map((argv2) => argv2.join(" "));
}
function toolsBrief(lane, steps) {
  return [
    `# Preflight of ${lane}: tools and steps`,
    "",
    "## Task",
    "",
    "This is a preflight probe: it checks that the fence lets the project's checks run. Run each command below exactly once, in order, as its own Bash call in the foreground, with the Bash timeout parameter set to 900000. Do not edit any file and do not try to fix a failing command.",
    "",
    // "Run" makes each step a command span, so lint refuses a step the fence denies before anything launches.
    ...steps.map((cmd, i) => `${i + 1}. Run \`${cmd}\``),
    "",
    "## Scope",
    "",
    "No files: this probe changes nothing.",
    "",
    "## Acceptance",
    "",
    "- Each command above ran once.",
    "- The report lists every command with its number n, the command, and the exit code it returned.",
    ""
  ].join("\n");
}
function modelBrief(lane) {
  return [
    `# Preflight of ${lane}: model`,
    "",
    "## Task",
    "",
    `This is a preflight probe. Run \`${SHA_COMMAND}\` once, as a single Bash call. Then answer with exactly OK, a space and the hash it printed, and put that same answer in the report's answer field.`,
    "",
    "## Scope",
    "",
    "No files: this probe changes nothing.",
    "",
    "## Acceptance",
    "",
    "- The answer is OK and the short hash of HEAD, nothing else.",
    ""
  ].join("\n");
}
var PROBE_SUFFIXES = ["pf-tools", "pf-model"];
var MAX_PREFLIGHT_NAME = (() => {
  let n = 1;
  while (PROBE_SUFFIXES.every((s) => isValidName(`${"a".repeat(n + 1)}-${s}`))) n++;
  return n;
})();
var PREFLIGHT_DIR = ".arbab/preflight";
var preflightDir = (project, lane) => join18(project.root, PREFLIGHT_DIR, assertValidName(lane, "lane"));
function writeProbeLanes(project, lane) {
  if (lane.name.length > MAX_PREFLIGHT_NAME) {
    throw new ArbabError(
      "usage",
      `lane name ${lane.name} is ${lane.name.length} characters; preflight needs at most ${MAX_PREFLIGHT_NAME} to add -pf-tools and -pf-model`
    );
  }
  const dir = preflightDir(project, lane.name);
  const rel = (path) => relative5(project.root, path);
  const owner = lane.worktree ?? lane.name;
  const worktree = lane.worktree !== void 0 || existsSync9(join18(project.worktreeRoot, owner)) ? owner : void 0;
  const shared = {
    role: lane.role,
    ...lane.fence !== void 0 && { fence: lane.fence },
    // The probes check the tools the lane will have, so they get the same narrowing.
    ...lane.tools !== void 0 && { tools: lane.tools },
    ...lane.base !== void 0 && { base: lane.base },
    ...worktree !== void 0 && { worktree },
    ...lane.resources !== void 0 && { resources: lane.resources },
    ...lane.semaphores !== void 0 && { semaphores: lane.semaphores },
    budgetUsd: 1,
    checkpoint: false,
    autoResume: false,
    maxAttempts: 1
  };
  const write = (suffix, brief, schema, fields) => {
    const name2 = assertValidName(`${lane.name}-${suffix}`, "probe lane");
    const briefFile = join18(dir, `${name2}.md`);
    const schemaFile = join18(dir, `${name2}.schema.json`);
    const laneFile = join18(dir, `${name2}.json`);
    writeTextAtomic(briefFile, brief);
    writeJsonAtomic(schemaFile, schema);
    writeJsonAtomic(laneFile, { name: name2, ...shared, brief: rel(briefFile), schema: rel(schemaFile), ...fields });
    return { name: name2, laneFile: rel(laneFile) };
  };
  const steps = stepCommands(project.config.preflight.steps);
  return {
    tools: write("pf-tools", toolsBrief(lane.name, steps), TOOLS_SCHEMA, {
      model: PROBE_MODEL,
      effort: "low",
      wallMin: 30,
      idleMin: 20,
      ...lane.allow !== void 0 && { allow: lane.allow }
    }),
    model: write("pf-model", modelBrief(lane.name), MODEL_SCHEMA, {
      ...lane.model !== void 0 && { model: lane.model },
      ...lane.effort !== void 0 && { effort: lane.effort },
      wallMin: 10,
      idleMin: 5,
      allow: [...lane.allow ?? [], `Bash(${SHA_COMMAND})`]
    })
  };
}
var normalizeTool = (tool) => tool === "Agent" ? "Task" : tool;
function sameTools(init, expected) {
  const a = [...new Set(init.filter((t) => t !== "StructuredOutput").map(normalizeTool))].sort();
  const b = [...new Set(expected.map(normalizeTool))].sort();
  return a.length === b.length && a.every((t, i) => t === b[i]);
}
function answerOf(probe) {
  const report = probe.report;
  if (typeof report === "object" && report !== null && typeof report.answer === "string") {
    return report.answer;
  }
  return probe.summary?.final?.resultText ?? null;
}
function sameSha(a, b) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x));
}
function probeChecks(label, probe, expectedTools) {
  const checks = [];
  const add = (ok, check2, detail) => {
    checks.push({ status: ok ? "ok" : "fail", check: `${label} ${check2}`, detail });
  };
  const s = probe.summary;
  add(probe.endState === "success", "end state", `${probe.lane}: ${probe.endState ?? "no attempt finished"}`);
  if (s === null) {
    add(false, "summary", `${probe.lane} has no summary.json`);
    return checks;
  }
  const init = s.init;
  if (init === null) {
    add(false, "init", "the stream has no init event");
  } else {
    add(sameTools(init.tools, expectedTools), "tools", `init ${JSON.stringify(init.tools)}, expected ${JSON.stringify(expectedTools)}`);
    add(init.permissionMode === "dontAsk", "permission mode", String(init.permissionMode));
    add(init.mcpServers.length === 0, "mcp servers", `${init.mcpServers.length}`);
    add(!init.memoryPaths, "memory paths", init.memoryPaths ? "present (--restricted missing?)" : "absent");
    add(!init.messagingSocket, "messaging socket", init.messagingSocket ? "present (--restricted missing?)" : "absent");
    const pinned = s.binary?.version ?? null;
    add(pinned !== null && init.version === pinned, "version", `init ${String(init.version)}, pinned ${String(pinned)}`);
  }
  const warnings = ["has not been trusted", "Ignoring"].filter((w) => probe.stderr.includes(w));
  add(warnings.length === 0, "stderr", warnings.length === 0 ? "no trust or ignore warnings" : `contains ${warnings.map((w) => JSON.stringify(w)).join(", ")}`);
  const reg = s.registration;
  const vscode = reg !== null && (reg.kind === "claude-vscode" || reg.entrypoint === "claude-vscode");
  add(!vscode, "registration", reg === null ? "none" : `kind ${String(reg.kind)}, entrypoint ${String(reg.entrypoint)}`);
  add(s.toolCallTotal >= 1, "tool calls", `${s.toolCallTotal}`);
  return checks;
}
function stepsCheck(steps, report) {
  const list3 = typeof report === "object" && report !== null ? report.steps : void 0;
  if (!Array.isArray(list3)) return { status: "fail", check: "steps", detail: "the tools probe has no report with steps" };
  const failed = [];
  for (const item of list3) {
    const code4 = typeof item === "object" && item !== null ? item.exit_code : void 0;
    const command = typeof item === "object" && item !== null ? item.command : void 0;
    if (code4 !== 0) failed.push(`${String(command)} \u2192 ${String(code4)}`);
  }
  if (list3.length < steps.length) failed.push(`${list3.length} of ${steps.length} steps reported`);
  return failed.length === 0 ? { status: "ok", check: "steps", detail: `${list3.length} step(s) exited 0` } : { status: "fail", check: "steps", detail: failed.join("; ") };
}
function shaCheck(model, headSha) {
  const answer = answerOf(model);
  const sha = answer === null ? null : /\bOK\s+([0-9a-fA-F]{4,40})\b/.exec(answer)?.[1] ?? null;
  if (headSha === null) return { status: "fail", check: "sha", detail: "the model probe's worktree HEAD is unknown" };
  if (sha === null) return { status: "fail", check: "sha", detail: `no "OK <sha>" in the answer ${JSON.stringify(answer)}` };
  return sameSha(sha, headSha) ? { status: "ok", check: "sha", detail: `${sha} = HEAD` } : { status: "fail", check: "sha", detail: `answered ${sha}, HEAD is ${headSha}` };
}
function evaluatePreflight(input) {
  return [
    ...probeChecks("tools", input.tools, input.expectedTools),
    stepsCheck(input.steps, input.tools.report),
    ...probeChecks("model", input.model, input.expectedTools),
    shaCheck(input.model, input.headSha)
  ];
}
function collectProbe(runsRoot, lane, after) {
  const state = readState(runsRoot, lane);
  const attempt = listAttempts(runsRoot, lane).at(-1);
  if (attempt === void 0 || attempt <= after) {
    return { lane, endState: state?.endState ?? null, summary: null, stderr: "", report: null, cwd: null };
  }
  const dir = runPaths(runsRoot, lane).attemptDir(attempt);
  const record2 = readAttempt(dir);
  const files = attemptFiles(dir);
  ack(runsRoot, lane, attempt);
  return {
    lane,
    endState: state?.endState ?? record2.summary?.state ?? null,
    summary: record2.summary,
    stderr: readText(files.stderr) ?? "",
    report: readJson(files.report),
    cwd: record2.started?.cwd ?? null
  };
}
async function waitForProbes(ctx, runsRoot, probes, timeoutMs) {
  const start = ctx.clock.now();
  const done = (p) => {
    const record2 = readState(runsRoot, p.lane);
    if (record2 !== null && record2.shepherdPid === p.pid) return !isActive(effectiveState(record2, ctx.alive));
    return !ctx.alive(p.pid);
  };
  for (; ; ) {
    if (probes.every(done)) return true;
    const remaining = timeoutMs - (ctx.clock.now() - start);
    if (remaining <= 0) return false;
    await ctx.sleep(Math.min(POLL_MS2, remaining));
  }
}
async function runPreflight(argv2, ctx) {
  const { values, positionals } = parse("preflight", {
    args: argv2,
    options: { "timeout-min": { type: "string" }, json: { type: "boolean" } },
    allowPositionals: true
  });
  const lanePath = onePositional("preflight", positionals, "lane.json");
  const timeoutMs = parseTimeoutMin(values["timeout-min"] ?? String(DEFAULT_TIMEOUT_MIN));
  const project = openProject(ctx);
  const gitCommonDir2 = resolveGitCommonDir(ctx.git, project.root);
  const { lane, issues } = lintLane(project, lanePath, gitCommonDir2);
  if (hasErrors(issues)) {
    for (const issue of issues) ctx.stderr(formatIssue(issue) + "\n");
    throw new ArbabError("lint", `${issueSummary(lane.name, issues)}; fix the lane before its preflight`);
  }
  const expectedTools = effectiveRole(project.config, lane).tools;
  if (!expectedTools.includes("Bash")) throw new ArbabError("usage", `role ${lane.role} has no Bash tool; preflight needs one`);
  ensureIgnored(project.root, [`${PREFLIGHT_DIR}/`], ctx.git);
  const files = writeProbeLanes(project, lane);
  for (const probe of [files.tools, files.model]) {
    const probeLint = lintLane(project, probe.laneFile, gitCommonDir2).issues;
    if (hasErrors(probeLint)) {
      for (const issue of probeLint) ctx.stderr(formatIssue(issue) + "\n");
      throw new ArbabError("lint", `${issueSummary(probe.name, probeLint)}; preflight not started`);
    }
  }
  const probes = [];
  for (const probe of [files.tools, files.model]) {
    const before = listAttempts(project.runsRoot, probe.name).at(-1) ?? 0;
    const launched = await launchLane(ctx, project, probe.laneFile);
    probes.push({ lane: probe.name, pid: launched.shepherdPid, before });
  }
  ctx.stderr(`preflight: launched ${probes.map((p) => p.lane).join(" and ")}; waiting
`);
  const finished = await waitForProbes(ctx, project.runsRoot, probes, timeoutMs);
  const lanes = probes.map((p) => p.lane);
  if (!finished) {
    if (values.json === true) printJson(ctx, { ok: false, timedOut: true, lanes, checks: [] });
    else ctx.stderr(`arbab preflight: ${lanes.join(" and ")} did not finish in time
`);
    return WAIT_TIMEOUT_EXIT;
  }
  const [toolsProbe, modelProbe] = probes.map((p) => collectProbe(project.runsRoot, p.lane, p.before));
  let headSha = null;
  if (modelProbe.cwd !== null) {
    const r = ctx.git(["rev-parse", "--short", "HEAD"], modelProbe.cwd);
    if (r.code === 0 && r.stdout.trim() !== "") headSha = r.stdout.trim();
  }
  const checks = evaluatePreflight({
    expectedTools,
    steps: stepCommands(project.config.preflight.steps),
    tools: toolsProbe,
    model: modelProbe,
    headSha
  });
  const ok = checks.every((c) => c.status === "ok");
  if (values.json === true) printJson(ctx, { ok, timedOut: false, lanes, checks });
  else ctx.stdout(formatChecks(checks) + "\n");
  return ok ? 0 : 1;
}

// src/commands/integration.ts
function openIntegration(project, name2) {
  const paths = integrationPaths(project.root, project.config, name2);
  const record2 = readIntegration(paths);
  if (record2 === null) throw new ArbabError("usage", `integration ${paths.name} does not exist; run arbab integrate ${paths.name} first`);
  return { paths, record: record2 };
}
var SHA3 = /^[0-9a-f]{40,64}$/;
function branchHead(git, root, branch) {
  const r = git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`], root);
  const sha = r.stdout.trim();
  return r.code === 0 && SHA3.test(sha) ? sha : null;
}
function assertRecordedHead(git, project, integration) {
  const { paths, record: record2 } = integration;
  const head = branchHead(git, project.root, paths.branch);
  if (head !== record2.headSha) {
    throw new ArbabError(
      "usage",
      `${paths.branch} is at ${head ?? "no commit"}, but integration.json records ${record2.headSha}; run arbab integrate ${paths.name} again`
    );
  }
}
var UNMERGED = "a commit arbab did not merge";
function unconfirmedManifests(record2) {
  if (record2.manifests.length === 0 || record2.depsConfirmedAt !== null) return [];
  const groups = /* @__PURE__ */ new Map();
  for (const manifest of record2.manifests) {
    const lanes = record2.merged.filter((m) => m.manifests.includes(manifest)).map((m) => m.lane);
    const by = lanes.length > 0 ? lanes.join(", ") : UNMERGED;
    groups.set(by, [...groups.get(by) ?? [], manifest]);
  }
  return [...groups].map(([by, manifests]) => ({ by, manifests }));
}
function generatedBase(record2) {
  const base = record2.manifests.length === 0 ? record2.baseSha : record2.depsConfirmedAt;
  if (base === null) {
    const changes = unconfirmedManifests(record2).map((g) => `${g.by} changed ${g.manifests.join(", ")}`);
    throw new ArbabError(
      "usage",
      `${changes.join("; ")}: ${installReview(record2.headSha)}, install the dependencies in ${record2.worktree} yourself, then run ${confirmCommand(record2.name, record2.headSha)}`
    );
  }
  return base === record2.headSha ? { base } : { base, mergeBranches: [record2.headSha] };
}
function installReview(head) {
  return `review the change and what an install at ${head} runs (package.json scripts and the files they run, .npmrc, .pnpmfile.*)`;
}
function manifestAdvice(record2) {
  const groups = unconfirmedManifests(record2);
  if (groups.length === 0) return [];
  return [
    "dependency manifests changed and were not installed (installing would run worker code on the host); a human, not the orchestrator:",
    ...groups.map((g) => `  ${g.by}: ${g.manifests.join(", ")}`),
    `${installReview(record2.headSha)}, install the dependencies in ${record2.worktree} yourself, then run: ` + confirmCommand(record2.name, record2.headSha),
    "confirming lets arbab install at that head on this machine for verify and review"
  ];
}
function writeGeneratedLane(project, paths, lane) {
  const name2 = assertValidName(lane.spec.name, "lane");
  writeTextAtomic(confine(project.root, lane.spec.brief), lane.brief);
  if (lane.schema !== void 0) {
    if (lane.spec.schema === void 0) throw new ArbabError("usage", `lane ${name2} has a schema but no schema path`);
    writeJsonAtomic(confine(project.root, lane.spec.schema), lane.schema);
  }
  const file = join19(paths.lanesDir, `${name2}.json`);
  writeJsonAtomic(file, lane.spec);
  return file;
}
function lintGeneratedLanes(ctx, project, files) {
  const gitCommonDir2 = resolveGitCommonDir(ctx.git, project.root);
  for (const file of files) {
    const { lane, issues } = lintLane(project, file, gitCommonDir2);
    if (hasErrors(issues)) {
      for (const issue of issues) ctx.stderr(formatIssue(issue) + "\n");
      throw new ArbabError("lint", `${issueSummary(lane.name, issues)}; nothing launched`);
    }
  }
}
function mustGit(ctx, args, cwd) {
  const r = ctx.git(args, cwd);
  if (r.code !== 0) throw new ArbabError("git", `git ${args.join(" ")} failed (${r.code}): ${(r.stderr || r.stdout).trim()}`);
}
function generationOwner(integration) {
  return { integration: integration.paths.name, branch: integration.record.branch, head: integration.record.headSha };
}
function assertNotBorrowed(ctx, project, lane) {
  for (const other of listLanes(project.runsRoot)) {
    if (other === lane) continue;
    let spec;
    try {
      spec = readJson(runPaths(project.runsRoot, other).laneFile);
    } catch {
      continue;
    }
    const worktree = typeof spec === "object" && spec !== null ? Reflect.get(spec, "worktree") : void 0;
    if (worktree !== lane) continue;
    let state;
    try {
      const record2 = readState(project.runsRoot, other);
      if (record2 === null) continue;
      const current = effectiveState(record2, ctx.alive);
      if (!isActive(current)) continue;
      state = current;
    } catch (err) {
      state = `unreadable (${err instanceof Error ? err.message : String(err)})`;
    }
    throw new ArbabError(
      "usage",
      `lane ${other} works in lane ${lane}'s worktree and is ${state}, so nothing was removed; stop it or wait for it first`
    );
  }
}
function resetGeneratedWorktree(ctx, project, lane, owner) {
  const name2 = assertValidName(lane, "lane");
  assertInactive(ctx, project, name2);
  assertNoLiveWorker(ctx, project, name2);
  assertNotBorrowed(ctx, project, name2);
  const runDir = join19(project.runsRoot, name2);
  const path = join19(project.worktreeRoot, name2);
  const branch = `arbab/${name2}`;
  const head = branchHead(ctx.git, project.root, branch);
  if (!existsSync10(runDir) && !existsSync10(path) && head === null) return;
  const marker = readGenerated(project.runsRoot, name2);
  if (marker === null || marker.by !== ownerTag(owner)) {
    throw new ArbabError(
      "usage",
      `lane ${name2} already exists and was not generated for integration ${owner.integration}, so nothing was removed; use another integration name, or rename that lane`
    );
  }
  if (head !== null && head !== marker.baseSha) {
    const extra = ctx.git(["rev-list", branch, "--not", owner.branch], project.root);
    if (extra.code !== 0 || extra.stdout.trim() !== "") {
      throw new ArbabError("git", `${branch} has commits that are not on ${owner.branch}, so nothing was removed`);
    }
  }
  if (existsSync10(path)) mustGit(ctx, [...untrustedTree(), "worktree", "remove", "--force", path], project.root);
  mustGit(ctx, ["worktree", "prune"], project.root);
  if (head !== null) mustGit(ctx, [...untrustedTree(), "branch", "-D", branch], project.root);
}
function readReport(path) {
  try {
    return readJson(path);
  } catch {
    return null;
  }
}
function collectRun(runsRoot, run) {
  let state = null;
  try {
    state = readState(runsRoot, run.lane);
  } catch {
  }
  const own = state !== null && state.shepherdPid === run.pid && state.state === "finished" ? state : null;
  const attempts = listAttempts(runsRoot, run.lane).filter((n) => n > run.before);
  const latest = attempts.at(-1) ?? null;
  const report = latest === null ? null : readReport(attemptFiles(runPaths(runsRoot, run.lane).attemptDir(latest)).report);
  if (own !== null) ackRun(runsRoot, run.lane, { shepherdPid: own.shepherdPid, since: own.since }, latest);
  return { lane: run.lane, endState: own?.endState ?? null, reason: own?.reason ?? null, attempts, report };
}
function attemptEvents(runsRoot, lane, attempts) {
  const paths = runPaths(runsRoot, lane);
  return attempts.flatMap((n) => parseStream(readText(attemptFiles(paths.attemptDir(n)).stream) ?? "").events);
}
async function runGeneratedLanes(ctx, project, lanes, timeoutMs, owner) {
  for (const { lane } of lanes) {
    resetGeneratedWorktree(ctx, project, lane, owner);
    markGenerated(project.runsRoot, lane, owner, new Date(ctx.clock.now()).toISOString());
  }
  const started = [];
  for (const { lane, file } of lanes) {
    const before = listAttempts(project.runsRoot, lane).at(-1) ?? 0;
    const launched = await launchLane(ctx, project, file, { generated: true });
    started.push({ lane, pid: launched.shepherdPid, before });
  }
  ctx.stderr(`launched ${started.map((s) => s.lane).join(", ")}; waiting
`);
  if (!await waitForProbes(ctx, project.runsRoot, started, timeoutMs)) return { timedOut: true, outcomes: [] };
  return { timedOut: false, outcomes: started.map((run) => collectRun(project.runsRoot, run)) };
}
function latestReport(runsRoot, lane) {
  const latest = listAttempts(runsRoot, lane).at(-1);
  return latest === void 0 ? null : readReport(attemptFiles(runPaths(runsRoot, lane).attemptDir(latest)).report);
}

// src/commands/cleanup.ts
var UNPARSED_GRACE_MS = 5 * 6e4;
var REAP_GRACE_MS = 1e4;
function releaseStalePoolFiles(home, alive, nowMs) {
  const released = [];
  for (const path of listPoolEntries(home)) {
    let old;
    try {
      old = nowMs - statSync5(path).mtimeMs > UNPARSED_GRACE_MS;
    } catch {
      continue;
    }
    if (path.endsWith(".stale")) {
      if (old) {
        rmSync5(path, { force: true });
        released.push(path);
      }
      continue;
    }
    try {
      if (releaseIfStale(path, alive, old)) released.push(path);
    } catch {
    }
  }
  return released;
}
function runLaneSpec(project, lane) {
  try {
    const value = readJson(runPaths(project.runsRoot, lane).laneFile);
    return typeof value === "object" && value !== null ? value : {};
  } catch {
    return {};
  }
}
async function reapOrphans(ctx, project, report) {
  for (const lane of listLanes(project.runsRoot)) {
    let record2;
    try {
      record2 = readState(project.runsRoot, lane);
    } catch (err) {
      report.warnings.push(`${lane}: ${err.message}`);
      continue;
    }
    if (record2 === null) continue;
    const state = effectiveState(record2, ctx.alive);
    if (state !== "orphaned") continue;
    if (record2.state !== "orphaned") {
      writeState(project.runsRoot, {
        ...record2,
        state: "orphaned",
        since: isoAt(ctx.clock),
        reason: `shepherd ${record2.shepherdPid} died while ${record2.state}`
      });
      report.orphaned.push(lane);
    }
    const attempt = listAttempts(project.runsRoot, lane).at(-1);
    if (attempt === void 0) continue;
    let started;
    let exited;
    try {
      const rec = readAttempt(runPaths(project.runsRoot, lane).attemptDir(attempt));
      started = rec.started;
      exited = rec.exit !== null;
    } catch (err) {
      report.warnings.push(`${lane}: ${err.message}`);
      continue;
    }
    if (started === null || exited || !Number.isInteger(started.pid) || started.pid <= 1 || !ctx.alive(started.pid)) continue;
    const command = ctx.processCommand(started.pid);
    if (command === null || typeof started.binary?.path !== "string" || !command.includes(started.binary.path)) continue;
    await reap({ pgid: started.pid, pids: [], signal: ctx.signal, alive: ctx.alive, sleep: ctx.sleep, graceMs: REAP_GRACE_MS });
    report.reaped.push({ lane, pgid: started.pid });
  }
}
function commonDirOf(git, root) {
  let dir;
  return () => {
    dir ??= resolveGitCommonDir(git, root);
    if (dir === void 0) throw new ArbabError("git", `cannot find the git dir of ${root}`);
    return dir;
  };
}
var gitMessage = (r) => (r.stderr || r.stdout).trim();
function unmergedOrDirty(git, root, target, hasWorktree, hasBranch, base, common) {
  if (hasWorktree) {
    try {
      const verified = verifyWorktreeGit({ worktree: target.path, branch: target.branch, gitCommonDir: common() });
      if (verified.gitDir === null) return `cannot verify its git dir: ${verified.error}`;
      if (worktreeStatus(target.path, verified.gitDir, git).length > 0) return "uncommitted changes";
    } catch (err) {
      return err.message;
    }
  }
  if (!hasBranch) return `no branch ${target.branch}`;
  const merged = git(["merge-base", "--is-ancestor", `refs/heads/${target.branch}`, base], root);
  if (merged.code === 1) return `branch ${target.branch} is not merged into ${base}`;
  if (merged.code !== 0) return `git merge-base --is-ancestor failed (${merged.code}): ${gitMessage(merged)}`;
  return null;
}
function removeWorktreeAndBranch(git, root, target, base, out, blocker, common) {
  const hasWorktree = existsSync11(target.path);
  if (!hasWorktree && !target.deleteBranch) return;
  const hasBranch = branchHead(git, root, target.branch) !== null;
  if (!hasWorktree && !hasBranch) return;
  const reason = blocker() ?? unmergedOrDirty(git, root, target, hasWorktree, hasBranch, base, common);
  if (reason !== null) {
    if (hasWorktree) out.worktreesKept.push({ path: target.path, reason });
    else out.branchesKept.push({ branch: target.branch, reason });
    return;
  }
  if (hasWorktree) {
    const removed = git([...untrustedTree(), "worktree", "remove", target.path], root);
    if (removed.code !== 0) {
      out.worktreesKept.push({ path: target.path, reason: `git worktree remove failed: ${gitMessage(removed)}` });
      return;
    }
    out.worktreesRemoved.push(target.path);
  }
  if (!target.deleteBranch) return;
  const deleted = git([...untrustedTree(), "branch", "-d", target.branch], root);
  if (deleted.code !== 0) out.branchesKept.push({ branch: target.branch, reason: `git branch -d failed: ${gitMessage(deleted)}` });
  else out.branchesDeleted.push(target.branch);
}
function worktreeOwner(project, lane) {
  const spec = runLaneSpec(project, lane);
  return spec.worktree === void 0 ? lane : spec.worktree;
}
function removeLaneWorktrees(ctx, project, lanes, base, out) {
  const states = /* @__PURE__ */ new Map();
  const unreadable = /* @__PURE__ */ new Map();
  const all = listLanes(project.runsRoot);
  for (const lane of all) {
    try {
      const record2 = readState(project.runsRoot, lane);
      if (record2 !== null) states.set(lane, effectiveState(record2, ctx.alive));
    } catch (err) {
      unreadable.set(lane, err.message);
    }
  }
  const borrowed = /* @__PURE__ */ new Map();
  for (const lane of all) {
    const state = states.get(lane);
    const owner = worktreeOwner(project, lane);
    if (state !== void 0 && state !== "finished" && typeof owner === "string" && owner !== lane) borrowed.set(owner, lane);
  }
  const common = commonDirOf(ctx.git, project.root);
  for (const lane of new Set(lanes)) {
    if (!isValidName(lane)) {
      out.warnings.push(`${JSON.stringify(lane)} is not a valid lane name`);
      continue;
    }
    try {
      const target = {
        path: join20(project.worktreeRoot, lane),
        branch: `arbab/${lane}`,
        deleteBranch: readGenerated(project.runsRoot, lane) !== null
      };
      const owner = worktreeOwner(project, lane);
      if (owner !== lane) {
        const where = typeof owner === "string" && isValidName(owner) ? `lane ${owner}'s worktree` : `worktree ${JSON.stringify(owner)}`;
        const reason = `lane ${lane} works in ${where}`;
        if (existsSync11(target.path)) out.worktreesKept.push({ path: target.path, reason });
        else if (target.deleteBranch && branchHead(ctx.git, project.root, target.branch) !== null) out.branchesKept.push({ branch: target.branch, reason });
        continue;
      }
      const blocker = () => {
        const state = states.get(lane);
        if (state === void 0) {
          const error = unreadable.get(lane);
          if (error !== void 0) return error;
          return existsSync11(runPaths(project.runsRoot, lane).laneDir) ? "no run state" : null;
        }
        if (isActive(state)) return `lane ${lane} is ${state}`;
        if (state === "orphaned") return "orphaned: run arbab cleanup first";
        const user = borrowed.get(lane);
        return user === void 0 ? null : `in use by lane ${user}`;
      };
      removeWorktreeAndBranch(ctx.git, project.root, target, base, out, blocker, common);
    } catch (err) {
      out.warnings.push(`${lane}: ${err.message}`);
    }
  }
}
function removeIntegrationWorktree(ctx, project, paths, base, out) {
  try {
    const target = { path: paths.worktree, branch: paths.branch, deleteBranch: true };
    removeWorktreeAndBranch(ctx.git, project.root, target, base, out, () => null, commonDirOf(ctx.git, project.root));
  } catch (err) {
    out.warnings.push(`integration ${paths.name}: ${err.message}`);
  }
}
function removeLandedIntegrations(ctx, project, out) {
  for (const name2 of listIntegrations(project.root)) {
    try {
      const paths = integrationPaths(project.root, project.config, name2);
      if (!existsSync11(paths.landing)) continue;
      const record2 = readIntegration(paths);
      if (record2 === null) {
        out.warnings.push(`integration ${name2} landed but has no integration.json`);
        continue;
      }
      removeIntegrationWorktree(ctx, project, paths, record2.base, out);
    } catch (err) {
      out.warnings.push(`integration ${name2}: ${err.message}`);
    }
  }
}
function removeMergedWorktrees(ctx, project, report) {
  const lanes = listLanes(project.runsRoot).filter((lane) => {
    try {
      const record2 = readState(project.runsRoot, lane);
      return record2 === null || effectiveState(record2, ctx.alive) === "finished";
    } catch {
      return false;
    }
  });
  removeLaneWorktrees(ctx, project, lanes, project.config.baseBranch, report);
  removeLandedIntegrations(ctx, project, report);
}
var emptyWorktreeCleanup = () => ({
  worktreesRemoved: [],
  branchesDeleted: [],
  worktreesKept: [],
  branchesKept: [],
  warnings: []
});
function formatWorktreeCleanup(c) {
  return [
    ...c.worktreesRemoved.map((path) => `removed worktree ${path}`),
    ...c.branchesDeleted.map((branch) => `deleted branch ${branch}`),
    ...c.worktreesKept.map((k) => `kept worktree ${k.path}: ${k.reason}`),
    ...c.branchesKept.map((k) => `kept branch ${k.branch}: ${k.reason}`),
    ...c.warnings.map((w) => `warning ${w}`)
  ];
}
function formatCleanup(report) {
  const lines = [
    ...report.orphaned.map((lane) => `orphaned ${lane}`),
    ...report.reaped.map((r) => `reaped ${r.lane} pgid ${r.pgid}`),
    ...report.released.map((path) => `released ${path}`),
    ...formatWorktreeCleanup(report)
  ];
  return lines.length === 0 ? "nothing to clean" : lines.join("\n");
}
async function runCleanup(argv2, ctx) {
  const { values } = parse("cleanup", {
    args: argv2,
    options: { worktrees: { type: "boolean" }, json: { type: "boolean" } },
    allowPositionals: false
  });
  const project = openProject(ctx);
  const report = { orphaned: [], reaped: [], released: [], ...emptyWorktreeCleanup() };
  await reapOrphans(ctx, project, report);
  report.released = releaseStalePoolFiles(ctx.home, ctx.alive, ctx.clock.now());
  if (values.worktrees === true) removeMergedWorktrees(ctx, project, report);
  if (values.json === true) printJson(ctx, report);
  else ctx.stdout(formatCleanup(report) + "\n");
  return 0;
}

// src/plan/graph.ts
var LONG_WAVE = 8;
var PATTERN_SEGMENT = /[*?[{}]|[@!+]\(/;
function fixedPath(glob) {
  const out = [];
  for (const segment of glob.split("/")) {
    if (PATTERN_SEGMENT.test(segment)) break;
    if (segment !== "" && segment !== ".") out.push(segment);
  }
  return out;
}
function globsOverlap(a, b) {
  const fa = fixedPath(a);
  const fb = fixedPath(b);
  const n = Math.min(fa.length, fb.length);
  for (let i = 0; i < n; i++) if (fa[i]?.toLowerCase() !== fb[i]?.toLowerCase()) return false;
  return true;
}
function dependencyMap(plan) {
  const deps = /* @__PURE__ */ new Map();
  for (const phase of plan.phases) if (!deps.has(phase.name)) deps.set(phase.name, phase.dependsOn ?? []);
  return deps;
}
function levels(deps) {
  const placed = /* @__PURE__ */ new Set();
  const waves = [];
  let pending = [...deps.keys()];
  while (pending.length > 0) {
    const wave = pending.filter((n) => (deps.get(n) ?? []).every((d) => placed.has(d) || !deps.has(d))).sort();
    if (wave.length === 0) break;
    for (const n of wave) placed.add(n);
    waves.push(wave);
    pending = pending.filter((n) => !placed.has(n));
  }
  return { waves, stuck: pending.sort() };
}
function findCycles(deps) {
  const visiting = /* @__PURE__ */ new Set();
  const done = /* @__PURE__ */ new Set();
  const stack = [];
  const seen = /* @__PURE__ */ new Set();
  const cycles = [];
  const visit = (n) => {
    visiting.add(n);
    stack.push(n);
    for (const d of deps.get(n) ?? []) {
      if (!deps.has(d) || done.has(d)) continue;
      if (visiting.has(d)) {
        const cycle = stack.slice(stack.indexOf(d));
        const start = cycle.indexOf([...cycle].sort()[0] ?? d);
        const rotated = [...cycle.slice(start), ...cycle.slice(0, start)];
        const key = rotated.join(" ");
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(rotated);
        }
      } else {
        visit(d);
      }
    }
    stack.pop();
    visiting.delete(n);
    done.add(n);
  };
  for (const n of [...deps.keys()].sort()) if (!done.has(n)) visit(n);
  return cycles;
}
function describeCycle(cycle) {
  return [...cycle, cycle[0]].join(" \u2192 ");
}
function ancestors(deps) {
  const out = /* @__PURE__ */ new Map();
  for (const start of deps.keys()) {
    const reached = /* @__PURE__ */ new Set();
    const todo = [...deps.get(start) ?? []];
    for (let d = todo.pop(); d !== void 0; d = todo.pop()) {
      if (reached.has(d)) continue;
      reached.add(d);
      todo.push(...deps.get(d) ?? []);
    }
    out.set(start, reached);
  }
  return out;
}
function planWaves(plan) {
  const deps = dependencyMap(plan);
  for (const [name2, ds] of deps) {
    for (const d of ds) if (!deps.has(d)) throw new ArbabError("config", `phase ${name2} depends on unknown phase ${d}`);
  }
  const { waves, stuck } = levels(deps);
  if (stuck.length > 0) {
    const cycle = findCycles(deps)[0] ?? stuck;
    throw new ArbabError("config", `plan ${plan.name} has a dependency cycle: ${describeCycle(cycle)}`);
  }
  return waves;
}
function integrationLanes(plan) {
  const owners = /* @__PURE__ */ new Map();
  for (const phase of plan.phases) {
    if (owners.has(phase.name)) continue;
    owners.set(phase.name, phase.worktree ?? plan.defaults?.worktree ?? phase.name);
  }
  const lanes = /* @__PURE__ */ new Set();
  for (const name2 of planWaves(plan).flat()) {
    const owner = owners.get(name2) ?? name2;
    if (owner === name2 || !owners.has(owner)) lanes.add(owner);
  }
  return [...lanes];
}
function checkPlan(plan) {
  const issues = [];
  const error = (code4, message4, where) => {
    issues.push({ severity: "error", code: code4, message: message4, where });
  };
  const counts = /* @__PURE__ */ new Map();
  for (const phase of plan.phases) counts.set(phase.name, (counts.get(phase.name) ?? 0) + 1);
  for (const [name2, count] of counts) {
    if (count > 1) error("duplicate-phase", `phase ${name2} appears ${count} times`, name2);
  }
  for (const phase of plan.phases) {
    if (!isValidName(phase.name)) {
      error("invalid-name", `phase name ${JSON.stringify(phase.name)} is not a valid lane name`, phase.name);
    }
    for (const d of phase.dependsOn ?? []) {
      if (!counts.has(d)) error("unknown-dependency", `${phase.name} depends on ${d}, which is not a phase`, phase.name);
    }
    if (phase.scope.length === 0) error("empty-scope", `${phase.name} has no write scope`, phase.name);
  }
  const deps = dependencyMap(plan);
  for (const cycle of findCycles(deps)) {
    error("dependency-cycle", `dependency cycle: ${describeCycle(cycle)}`, cycle[0] ?? "");
  }
  const dependents = /* @__PURE__ */ new Map();
  for (const [name2, ds] of deps) for (const d of new Set(ds)) dependents.set(d, [...dependents.get(d) ?? [], name2]);
  const checked = /* @__PURE__ */ new Set();
  for (const phase of plan.phases) {
    const users = dependents.get(phase.name);
    if (users === void 0 || checked.has(phase.name)) continue;
    checked.add(phase.name);
    const role2 = phase.role ?? plan.defaults?.role ?? "implementer";
    const checkpoint2 = phase.checkpoint ?? plan.defaults?.checkpoint;
    const needs = `${users.join(", ")} ${users.length === 1 ? "depends" : "depend"} on it and receive its work only as its checkpoint commit`;
    if (checkpoint2 === false) {
      error("dependency-without-checkpoint", `${phase.name} sets checkpoint: false, but ${needs}`, phase.name);
    } else if (checkpoint2 === void 0 && Object.hasOwn(ROLE_DEFAULTS, role2) && !ROLE_DEFAULTS[role2].checkpoint) {
      error(
        "dependency-without-checkpoint",
        `${phase.name} uses role ${role2}, which does not checkpoint by default, but ${needs}; set checkpoint: true`,
        phase.name
      );
    }
  }
  const reach = ancestors(deps);
  const ordered = (a, b) => Boolean(reach.get(a)?.has(b) || reach.get(b)?.has(a));
  for (let i = 0; i < plan.phases.length; i++) {
    for (let j = i + 1; j < plan.phases.length; j++) {
      const a = plan.phases[i];
      const b = plan.phases[j];
      if (a === void 0 || b === void 0 || a.name === b.name || ordered(a.name, b.name)) continue;
      const pair = firstOverlap(a.scope, b.scope);
      if (pair === null) continue;
      error(
        "overlapping-scope",
        `${a.name} (${pair[0]}) and ${b.name} (${pair[1]}) can run at the same time with overlapping scopes; make one depend on the other or split the scopes`,
        `${a.name}, ${b.name}`
      );
    }
  }
  levels(deps).waves.forEach((wave, i) => {
    if (wave.length > LONG_WAVE) {
      issues.push({
        severity: "warning",
        code: "long-wave",
        message: `wave ${i} has ${wave.length} phases (more than ${LONG_WAVE}); consider splitting it`,
        where: `wave ${i}`
      });
    }
  });
  return issues;
}
function firstOverlap(a, b) {
  for (const ga of a) for (const gb of b) if (globsOverlap(ga, gb)) return [ga, gb];
  return null;
}

// src/plan/compile.ts
var COORDINATION_INTRO = "Other lanes run at the same time; do not edit their scopes:";
function compilePhase(plan, phaseName) {
  const phase = plan.phases.find((p) => p.name === phaseName);
  if (phase === void 0) throw new ArbabError("usage", `plan ${plan.name} has no phase ${phaseName}`);
  const { role: role2, ...fields } = { ...laneFields(plan.defaults ?? {}), ...laneFields(phase) };
  const lane = { name: phase.name, role: role2 ?? "implementer", brief: phase.brief };
  if (plan.base !== void 0) lane.base = plan.base;
  Object.assign(lane, fields);
  const deps = phase.dependsOn ?? [];
  if (deps.length > 0) {
    lane.upstream = [...deps];
    lane.mergeBranches = deps.map((d) => `arbab/${d}`);
  }
  const siblings = (planWaves(plan).find((w) => w.includes(phase.name)) ?? []).filter((n) => n !== phase.name);
  if (siblings.length > 0) lane.coordination = coordination(plan, siblings);
  return lane;
}
function laneFields(src) {
  const out = {};
  for (const key of PHASE_LANE_KEYS) {
    const v = src[key];
    if (v === void 0) continue;
    out[key] = Array.isArray(v) ? [...v] : typeof v === "object" && v !== null ? { ...v } : v;
  }
  return out;
}
function coordination(plan, siblings) {
  const lines = siblings.map((name2) => {
    const scope2 = plan.phases.find((p) => p.name === name2)?.scope ?? [];
    return `- \`${name2}\` owns ${scope2.map((g) => `\`${g}\``).join(", ")}`;
  });
  return [COORDINATION_INTRO, ...lines].join("\n");
}

// src/plan/load.ts
import { isAbsolute as isAbsolute7, resolve as resolve11 } from "node:path";
var PLAN_KEYS = ["name", "base", "defaults", "phases"];
var PHASE_KEYS = ["name", "brief", "scope", "dependsOn", ...PHASE_LANE_KEYS];
function loadPlan(projectRoot, planPath) {
  const file = resolve11(projectRoot, planPath);
  const raw = readJsonFile(file);
  if (raw === null) throw new ArbabError("usage", `plan file ${planPath} does not exist`);
  const obj = record(raw, planPath);
  knownKeys(obj, PLAN_KEYS, "");
  const plan = { name: name(obj.name, "name"), phases: [] };
  if (obj.base !== void 0) plan.base = ref(obj.base, "base");
  if (obj.defaults !== void 0) {
    const defaults = record(obj.defaults, "defaults");
    knownKeys(defaults, PHASE_LANE_KEYS, "defaults");
    plan.defaults = { role: "implementer", ...phaseLaneFields(projectRoot, defaults, "defaults") };
  }
  if (!Array.isArray(obj.phases) || obj.phases.length === 0) fail("phases", "must be a non-empty array of phases");
  const defaultRole = plan.defaults?.role ?? "implementer";
  plan.phases = obj.phases.map((p, i) => loadPhase(projectRoot, p, `phases[${i}]`, defaultRole));
  return plan;
}
function loadPhase(projectRoot, v, field, defaultRole) {
  const obj = record(v, field);
  knownKeys(obj, PHASE_KEYS, field);
  const phase = {
    // A phase becomes a lane of the same name.
    name: worktreeName(obj.name, `${field}.name`),
    brief: existingFile(projectRoot, obj.brief, `${field}.brief`),
    scope: scope(obj.scope, `${field}.scope`),
    role: defaultRole,
    ...phaseLaneFields(projectRoot, obj, field)
  };
  if (obj.dependsOn !== void 0) phase.dependsOn = nameArray(obj.dependsOn, `${field}.dependsOn`);
  return phase;
}
function scope(v, field) {
  if (!Array.isArray(v) || v.length === 0) fail(field, "must be a non-empty array of globs");
  return v.map((item, i) => {
    const glob = nonEmptyString(item, `${field}[${i}]`);
    if (isAbsolute7(glob) || /^[A-Za-z]:/.test(glob)) fail(`${field}[${i}]`, `${glob} must be relative`);
    if (glob.split(/[\\/]/).includes("..")) fail(`${field}[${i}]`, `${glob} must not contain ".."`);
    return glob;
  });
}

// src/plan/progress.ts
function outcome(s) {
  if (s === void 0) return { kind: "waiting" };
  if (s.state === "orphaned") return { kind: "failed", endState: "orphaned", reason: null };
  if (s.state !== "finished") return { kind: "waiting" };
  if (s.endState !== "success") return { kind: "failed", endState: s.endState, reason: null };
  if (s.exit === null) return { kind: "failed", endState: s.endState, reason: "its latest attempt has no readable exit.json" };
  if (s.exit.checkpointError !== null) {
    return { kind: "failed", endState: s.endState, reason: `its checkpoint failed: ${s.exit.checkpointError}` };
  }
  return { kind: "succeeded" };
}
function nextPhases(plan, states) {
  const out = { launch: [], blocked: [], failed: [] };
  const seen = /* @__PURE__ */ new Set();
  for (const phase of plan.phases) {
    if (seen.has(phase.name)) continue;
    seen.add(phase.name);
    if (states[phase.name] !== void 0) continue;
    const deps = phase.dependsOn ?? [];
    const outcomes = deps.map((d) => ({ dependency: d, outcome: outcome(states[d]) }));
    const failed = outcomes.find((o) => o.outcome.kind === "failed");
    if (failed !== void 0 && failed.outcome.kind === "failed") {
      const { endState, reason } = failed.outcome;
      out.failed.push({ phase: phase.name, dependency: failed.dependency, endState, reason });
      continue;
    }
    const waitingFor = outcomes.filter((o) => o.outcome.kind === "waiting").map((o) => o.dependency);
    if (waitingFor.length === 0) out.launch.push(phase.name);
    else out.blocked.push({ phase: phase.name, waitingFor });
  }
  return out;
}
function planStatus(plan, states) {
  const waveOf = /* @__PURE__ */ new Map();
  planWaves(plan).forEach((wave, i) => {
    for (const name2 of wave) waveOf.set(name2, i);
  });
  const seen = /* @__PURE__ */ new Set();
  const rows = [];
  for (const phase of plan.phases) {
    if (seen.has(phase.name)) continue;
    seen.add(phase.name);
    const s = states[phase.name];
    rows.push({
      phase: phase.name,
      wave: waveOf.get(phase.name) ?? 0,
      dependsOn: [...phase.dependsOn ?? []],
      state: s?.state ?? null,
      endState: s?.endState ?? null
    });
  }
  return rows;
}

// src/commands/integrate.ts
function splitList(text2) {
  return text2.split(",").map((s) => s.trim()).filter((s) => s !== "");
}
var planIntegrationLanes = integrationLanes;
function integrationLanes2(project, opts, planLanes = planIntegrationLanes) {
  if (opts.lanes !== void 0 && opts.plan !== void 0) throw new ArbabError("usage", "--lanes and --plan exclude each other");
  let lanes;
  if (opts.lanes !== void 0) {
    lanes = splitList(opts.lanes);
  } else if (opts.plan !== void 0) {
    lanes = planLanes(loadPlan(project.root, opts.plan));
  } else {
    throw new ArbabError("usage", "usage: arbab integrate <name> (--lanes a,b,\u2026 | --plan <plan.json> | --deps-installed <sha>)");
  }
  if (lanes.length === 0) throw new ArbabError("usage", "no lanes to integrate");
  const seen = /* @__PURE__ */ new Set();
  for (const lane of lanes) {
    assertValidName(lane, "lane");
    if (seen.has(lane)) throw new ArbabError("usage", `lane ${lane} is listed twice`);
    seen.add(lane);
  }
  return lanes;
}
function assertNoActiveBorrower(ctx, project, lanes) {
  const owners = new Set(lanes);
  for (const lane of listLanes(project.runsRoot)) {
    let spec;
    try {
      spec = readJson(runPaths(project.runsRoot, lane).laneFile);
    } catch {
      continue;
    }
    const owner = typeof spec === "object" && spec !== null ? Reflect.get(spec, "worktree") : void 0;
    if (typeof owner !== "string" || owner === lane || !owners.has(owner)) continue;
    const record2 = readState(project.runsRoot, lane);
    if (record2 === null) continue;
    const state = effectiveState(record2, ctx.alive);
    if (!isActive(state)) continue;
    throw new ArbabError(
      "usage",
      `lane ${lane} works in lane ${owner}'s worktree and commits onto arbab/${owner}, and it is ${state} (shepherd ${record2.shepherdPid}); stop it or wait for it before integrating ${owner}`
    );
  }
}
function formatIntegration(record2, alreadyIn = []) {
  const lines = alreadyIn.map((lane) => `${lane}: already in ${record2.branch}`);
  for (const m of record2.merged) {
    const manifests = m.manifests.length > 0 ? `  manifests: ${m.manifests.join(", ")}` : "";
    lines.push(`merged ${m.lane} ${m.sha}${manifests}`);
  }
  if (record2.merged.length === 0) lines.push(`nothing merged into ${record2.branch} yet`);
  lines.push(`head ${record2.headSha}  (${record2.branch} in ${record2.worktree})`);
  lines.push(...manifestAdvice(record2));
  return lines.join("\n") + "\n";
}
async function runIntegrate(argv2, ctx) {
  const { values, positionals } = parse("integrate", {
    args: argv2,
    options: {
      lanes: { type: "string" },
      plan: { type: "string" },
      "deps-installed": { type: "string" },
      json: { type: "boolean" }
    },
    allowPositionals: true
  });
  const name2 = assertValidName(onePositional("integrate", positionals, "name"), "integration");
  const project = openProject(ctx);
  let record2;
  const confirmed = values["deps-installed"];
  if (confirmed !== void 0) {
    if (values.lanes !== void 0 || values.plan !== void 0) {
      throw new ArbabError("usage", "--deps-installed takes no lanes: merge first, then confirm the install");
    }
    if (!ctx.interactive) {
      throw new ArbabError(
        "usage",
        "--deps-installed is the human's confirmation: run it yourself in a terminal, after reviewing the change and installing the dependencies in the integration worktree"
      );
    }
    const paths = integrationPaths(project.root, project.config, name2);
    if (readIntegration(paths) === null) throw new ArbabError("usage", `integration ${name2} does not exist; run arbab integrate ${name2} first`);
    record2 = confirmDeps(paths, confirmed, ctx.git, ctx.clock);
    if (values.json === true) printJson(ctx, record2);
    else if (record2.manifests.length === 0) ctx.stdout(`nothing to confirm for ${name2}: no dependency manifest differs between ${record2.base} and ${record2.headSha}
`);
    else ctx.stdout(`deps confirmed for ${name2} at ${record2.headSha}
`);
    return 0;
  }
  const lanes = integrationLanes2(project, { ...values.lanes !== void 0 && { lanes: values.lanes }, ...values.plan !== void 0 && { plan: values.plan } });
  for (const lane of lanes) {
    assertInactive(ctx, project, lane);
    assertNoLiveWorker(ctx, project, lane);
  }
  assertNoActiveBorrower(ctx, project, lanes);
  const { record: integrated, alreadyIn } = integrate({
    projectRoot: project.root,
    config: project.config,
    name: name2,
    lanes,
    git: ctx.git,
    runCommand: ctx.runCommand,
    clock: ctx.clock
  });
  record2 = integrated;
  if (values.json === true) printJson(ctx, record2);
  else ctx.stdout(formatIntegration(record2, alreadyIn));
  return 0;
}

// src/commands/records.ts
var isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var isString = (v) => typeof v === "string";
var isStringOrNull = (v) => v === null || typeof v === "string";
var isNumberOrNull = (v) => v === null || Number.isFinite(v);
var listOf = (v, item) => Array.isArray(v) && v.every(item);
function read(path, name2, what, valid) {
  const raw = readJson(path);
  if (raw === null) return null;
  if (!isObject(raw) || raw["name"] !== name2 || !valid(raw)) {
    throw new ArbabError("io", `${path} is not a ${what} for ${name2}`);
  }
  return raw;
}
var isGateResult = (v) => isObject(v) && (v["kind"] === "gate" || v["kind"] === "smoke") && listOf(v["argv"], isString) && isString(v["command"]) && isNumberOrNull(v["exitCode"]);
function readVerifyRecord(path, name2) {
  return read(
    path,
    name2,
    "verify record",
    (v) => isString(v["lane"]) && isNumberOrNull(v["attempt"]) && isString(v["headSha"]) && listOf(v["results"], isGateResult) && typeof v["passed"] === "boolean" && (v["reason"] === void 0 || isString(v["reason"])) && isString(v["finishedAt"])
  );
}
var SEVERITIES = ["HIGH", "MEDIUM", "LOW"];
var VERDICTS = ["confirmed", "refuted", "unverified"];
var isFinding = (v) => isObject(v) && isString(v["id"]) && isString(v["lens"]) && isString(v["title"]) && SEVERITIES.includes(v["severity"]) && isString(v["file"]) && (v["line"] === void 0 || Number.isInteger(v["line"])) && isString(v["failureScenario"]) && isString(v["evidence"]) && VERDICTS.includes(v["verdict"]);
var isLensEntry = (v) => isObject(v) && isString(v["lens"]) && isString(v["lane"]) && isStringOrNull(v["endState"]) && isStringOrNull(v["coverage"]) && Number.isInteger(v["pathsChecked"]);
var isSkepticEntry = (v) => isObject(v) && isString(v["lens"]) && isString(v["lane"]) && isStringOrNull(v["endState"]);
function readReviewRecord(path, name2) {
  return read(
    path,
    name2,
    "review record",
    (v) => isString(v["headSha"]) && listOf(v["lenses"], isLensEntry) && listOf(v["skeptics"], isSkepticEntry) && listOf(v["findings"], isFinding) && isString(v["finishedAt"])
  );
}
var isItem = (v) => isObject(v) && isString(v["id"]) && isString(v["text"]);
function readReadinessReport(path, name2) {
  return read(
    path,
    name2,
    "readiness report",
    (v) => TIERS.includes(v["tier"]) && isString(v["headSha"]) && listOf(v["verified"], isItem) && listOf(v["skipped"], (s) => isItem(s) && typeof s["waived"] === "boolean") && listOf(v["risks"], isItem) && typeof v["ready"] === "boolean" && isString(v["createdAt"])
  );
}

// src/commands/land.ts
var refuse = (message4) => new ArbabError("usage", `not landed: ${message4}`);
function gitOut(git, args, cwd) {
  const r = git(args, cwd);
  if (r.code !== 0) throw new ArbabError("git", `git ${args.join(" ")} failed (${r.code}): ${(r.stderr || r.stdout).trim()}`);
  return r.stdout;
}
function firstRemote(git, root) {
  const r = git(["remote"], root);
  if (r.code !== 0) return null;
  return r.stdout.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? null;
}
function assertCleanBase(git, root, base) {
  const r = git(["symbolic-ref", "--quiet", "--short", "HEAD"], root);
  const branch = r.code === 0 ? r.stdout.trim() : null;
  if (branch !== base) throw refuse(`the main checkout ${root} is on ${branch ?? "a detached HEAD"}, not ${base}`);
  const status = gitOut(git, ["status", "--porcelain"], root).split("\n").filter((l) => l.trim() !== "");
  if (status.length > 0) {
    const shown = status.slice(0, 5).join("; ") + (status.length > 5 ? `; and ${status.length - 5} more` : "");
    throw refuse(`the main checkout ${root} has uncommitted changes (${shown})`);
  }
}
function assertBaseInHead(git, root, base, head, name2, worktree) {
  const r = git(["merge-base", "--is-ancestor", "HEAD", head], root);
  if (r.code === 0) return;
  if (r.code !== 1) throw new ArbabError("git", `git merge-base --is-ancestor HEAD ${head} failed (${r.code}): ${(r.stderr || r.stdout).trim()}`);
  throw refuse(
    `${base} moved since the integration was verified: its HEAD is not in ${head}, so the merge would hold a tree nobody verified. Merge ${base} into integrate/${name2} with hooks off: git -C ${worktree} ${untrustedTree().join(" ")} merge --no-verify --no-edit ${base}; then run arbab integrate, verify, review and readiness for ${name2} again`
  );
}
var notBefore = (later, earlier) => Date.parse(later) >= Date.parse(earlier);
function assertReadinessCurrent(readiness, verify, review, name2) {
  for (const [what, record2, at] of [
    ["verify", verify, verify?.finishedAt],
    ["review", review, review?.finishedAt]
  ]) {
    if (record2 === null || at === void 0 || record2.headSha !== readiness.headSha) continue;
    if (!notBefore(readiness.createdAt, at)) {
      throw refuse(`the readiness report (${readiness.createdAt}) is older than ${what}.json (${at}); run arbab readiness ${name2} again`);
    }
  }
}
function assertTier(readiness, required, name2) {
  if (TIERS.indexOf(readiness.tier) < TIERS.indexOf(required)) {
    throw refuse(`readiness was checked at tier ${readiness.tier}, below the landing tier ${required}; run arbab readiness ${name2} --tier ${required}`);
  }
}
async function runLand(argv2, ctx) {
  const { values, positionals } = parse("land", {
    args: argv2,
    options: { "keep-worktrees": { type: "boolean" }, json: { type: "boolean" } },
    allowPositionals: true
  });
  const name2 = assertValidName(onePositional("land", positionals, "name"), "integration");
  const project = openProject(ctx);
  const { paths, record: record2 } = openIntegration(project, name2);
  const base = record2.base;
  const head = record2.headSha;
  const readiness = readReadinessReport(paths.readiness, name2);
  if (readiness === null) throw refuse(`no readiness report; run arbab readiness ${name2}`);
  if (readiness.headSha !== head) throw refuse(`the readiness report is for ${readiness.headSha}, the integration head is ${head}; run arbab readiness ${name2} again`);
  if (!readiness.ready) {
    const open2 = readiness.skipped.filter((s) => !s.waived).map((s) => s.id);
    throw refuse(`readiness is not ready${open2.length > 0 ? ` (unwaived: ${open2.join(", ")})` : ""}`);
  }
  assertTier(readiness, project.config.landing.tier, name2);
  const verify = readVerifyRecord(paths.verify, name2);
  if (verify === null || verify.headSha !== head || !verify.passed) throw refuse(`verify has not passed on ${head}; run arbab verify ${name2}`);
  assertReadinessCurrent(readiness, verify, readReviewRecord(paths.review, name2), name2);
  assertCleanBase(ctx.git, project.root, base);
  if (ctx.git(["merge-base", "--is-ancestor", head, "HEAD"], project.root).code === 0) throw refuse(`${head} is already in ${base}`);
  const branchAt = branchHead(ctx.git, project.root, paths.branch);
  if (branchAt !== head) throw refuse(`${paths.branch} is at ${branchAt ?? "no commit"}, not the verified head ${head}`);
  assertBaseInHead(ctx.git, project.root, base, head, name2, paths.worktree);
  const merge = ctx.git([...untrustedTree(), "merge", "--no-ff", "--no-edit", "-m", `Land ${name2}`, head], project.root);
  if (merge.code !== 0) {
    ctx.git([...untrustedTree(), "merge", "--abort"], project.root);
    throw new ArbabError("git", `merging ${paths.branch} into ${base} failed (${merge.code}): ${(merge.stderr || merge.stdout).trim()}; the merge was aborted`);
  }
  const mergeSha = gitOut(ctx.git, ["rev-parse", "HEAD"], project.root).trim();
  const landing = { name: name2, into: base, integrationHead: head, mergeSha, landedAt: isoAt(ctx.clock), pushed: false };
  writeJsonAtomic(paths.landing, landing);
  const cleanup = values["keep-worktrees"] === true ? null : cleanUpLanded(ctx, project, { paths, record: record2 });
  const remote = firstRemote(ctx.git, project.root);
  if (values.json === true) {
    printJson(ctx, { landing, remote, push: remote === null ? null : ["git", "push", remote, base], cleanup });
  } else {
    ctx.stdout(`landed ${name2}: ${head} into ${base} as ${mergeSha}
`);
    ctx.stdout(`Not pushed. To publish: git push ${remote ?? "<remote>"} ${base}${remote === null ? " (no remote configured)" : ""}
`);
    for (const line of cleanup === null ? [] : formatWorktreeCleanup(cleanup)) ctx.stdout(line + "\n");
  }
  return 0;
}
function cleanUpLanded(ctx, project, integration) {
  const { paths, record: record2 } = integration;
  const out = emptyWorktreeCleanup();
  try {
    const lanes = [...record2.merged.map((m) => m.lane), ...lanesGeneratedBy(project.runsRoot, paths.name)];
    removeLaneWorktrees(ctx, project, lanes, record2.base, out);
    removeIntegrationWorktree(ctx, project, paths, record2.base, out);
  } catch (err) {
    out.warnings.push(err.message);
  }
  return out;
}

// src/commands/plan.ts
import { join as join21 } from "node:path";
var phaseNames = (plan) => [...new Set(plan.phases.map((p) => p.name))];
var plansDir = (project, plan) => join21(project.root, ".arbab", "plans", assertValidName(plan, "plan"));
function checkPlanFile(ctx, project, planPath) {
  const plan = loadPlan(project.root, planPath);
  const issues = checkPlan(plan);
  let waves = null;
  try {
    waves = planWaves(plan);
  } catch (err) {
    if (!(err instanceof ArbabError)) throw err;
  }
  const phases = [];
  if (waves !== null) {
    const gitCommonDir2 = resolveGitCommonDir(ctx.git, project.root);
    for (const phase of phaseNames(plan)) {
      const lane = compilePhase(plan, phase);
      phases.push({ phase, lane, issues: lintLaneSpec(project, lane, gitCommonDir2).issues });
    }
  }
  return { plan, issues, phases, waves };
}
var planHasErrors = (check2) => hasErrors(check2.issues) || check2.phases.some((p) => hasErrors(p.issues));
function planSummary(check2) {
  return issueSummary(`plan ${check2.plan.name}`, [...check2.issues, ...check2.phases.flatMap((p) => p.issues)]);
}
function latestExit(runsRoot, lane) {
  let value;
  try {
    const n = listAttempts(runsRoot, lane).at(-1);
    if (n === void 0) return null;
    value = readJson(attemptFiles(runPaths(runsRoot, lane).attemptDir(n)).exit);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { checkpoint: checkpoint2, checkpointError } = value;
  const field = (v) => v === null || typeof v === "string";
  if (!field(checkpoint2) || !field(checkpointError)) return null;
  return { checkpoint: checkpoint2, checkpointError };
}
function phaseStates(project, plan, alive) {
  const states = {};
  for (const phase of phaseNames(plan)) {
    const record2 = readState(project.runsRoot, phase);
    states[phase] = record2 === null ? void 0 : { state: effectiveState(record2, alive), endState: record2.endState ?? null, exit: latestExit(project.runsRoot, phase) };
  }
  return states;
}
async function planNext(ctx, project, planPath) {
  const check2 = checkPlanFile(ctx, project, planPath);
  const plan = check2.plan;
  if (planHasErrors(check2)) {
    for (const issue of check2.issues) ctx.stderr(formatIssue(issue) + "\n");
    for (const p of check2.phases) for (const issue of p.issues) ctx.stderr(`${p.phase}: ${formatIssue(issue)}
`);
    throw new ArbabError("lint", `${planSummary(check2)}; nothing launched`);
  }
  const next = nextPhases(plan, phaseStates(project, plan, ctx.alive));
  const out = { plan: plan.name, launched: [], blocked: next.blocked, failed: next.failed, errors: [], warnings: [], code: 0 };
  if (next.launch.length === 0) return out;
  ensureIgnored(project.root, [".arbab/plans/"], ctx.git);
  for (const phase of next.launch) {
    const lane = check2.phases.find((p) => p.phase === phase)?.lane ?? compilePhase(plan, phase);
    const laneFile = join21(plansDir(project, plan.name), `${phase}.json`);
    try {
      writeJsonAtomic(laneFile, lane);
      const launched = await launchLane(ctx, project, laneFile, { onlyNew: true });
      out.launched.push({ phase, laneFile, runDir: launched.runDir, shepherdPid: launched.shepherdPid });
      for (const issue of launched.warnings) out.warnings.push({ phase, issue });
    } catch (err) {
      out.errors.push({ phase, message: err instanceof Error ? err.message : String(err) });
      out.code = Math.max(out.code, exitCodeFor(err));
    }
  }
  return out;
}
function table(rows) {
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length))) ?? [];
  return rows.map((r) => r.map((cell2, i) => i === r.length - 1 ? cell2 : cell2.padEnd(widths[i] ?? 0)).join("  ").trimEnd()).join("\n");
}
function formatPlanStatus(rows) {
  return table([
    ["PHASE", "WAVE", "STATE", "END", "DEPENDS ON"],
    ...rows.map((r) => [r.phase, String(r.wave), r.state ?? "-", r.endState ?? "-", r.dependsOn.length > 0 ? r.dependsOn.join(", ") : "-"])
  ]);
}
async function runCheck(argv2, ctx) {
  const { values, positionals } = parse("plan check", { args: argv2, options: { json: { type: "boolean" } }, allowPositionals: true });
  const planPath = onePositional("plan check", positionals, "plan.json");
  const check2 = checkPlanFile(ctx, openProject(ctx), planPath);
  const ok = !planHasErrors(check2);
  if (values.json === true) {
    printJson(ctx, {
      plan: check2.plan.name,
      ok,
      issues: check2.issues,
      phases: check2.phases.map((p) => ({ phase: p.phase, issues: p.issues })),
      waves: check2.waves
    });
  } else {
    for (const issue of check2.issues) ctx.stdout(formatIssue(issue) + "\n");
    for (const p of check2.phases) {
      for (const issue of p.issues) ctx.stdout(`  ${formatIssue(issue)}
`);
      ctx.stdout(issueSummary(p.phase, p.issues) + "\n");
    }
    if (check2.waves === null) ctx.stdout("phases not linted: the dependency graph does not resolve\n");
    else check2.waves.forEach((wave, i) => ctx.stdout(`wave ${i}: ${wave.join(", ")}
`));
    ctx.stdout(planSummary(check2) + "\n");
  }
  return ok ? 0 : 1;
}
async function runNext(argv2, ctx) {
  const { values, positionals } = parse("plan next", { args: argv2, options: { json: { type: "boolean" } }, allowPositionals: true });
  const planPath = onePositional("plan next", positionals, "plan.json");
  const next = await planNext(ctx, openProject(ctx), planPath);
  if (values.json === true) {
    printJson(ctx, {
      plan: next.plan,
      launched: next.launched,
      blocked: next.blocked,
      failed: next.failed,
      errors: next.errors,
      warnings: next.warnings.map((w) => ({ phase: w.phase, ...w.issue }))
    });
    return next.code;
  }
  for (const w of next.warnings) ctx.stderr(`${w.phase}: ${formatIssue(w.issue)}
`);
  for (const l of next.launched) ctx.stdout(`launched ${l.phase}  run ${l.runDir}  shepherd ${l.shepherdPid}
`);
  if (next.launched.length === 0) ctx.stdout("nothing launched\n");
  for (const b of next.blocked) ctx.stdout(`blocked ${b.phase}  waiting for ${b.waitingFor.join(", ")}
`);
  for (const f of next.failed) {
    const reason = f.reason === null ? "" : `; ${f.reason}`;
    ctx.stdout(`failed-upstream ${f.phase}  ${f.dependency} ended ${f.endState ?? "without an end state"}${reason}
`);
  }
  for (const e of next.errors) ctx.stderr(`error ${e.phase}  ${e.message}
`);
  return next.code;
}
async function runPlanStatus(argv2, ctx) {
  const { values, positionals } = parse("plan status", { args: argv2, options: { json: { type: "boolean" } }, allowPositionals: true });
  const planPath = onePositional("plan status", positionals, "plan.json");
  const project = openProject(ctx);
  const plan = loadPlan(project.root, planPath);
  const rows = planStatus(plan, phaseStates(project, plan, ctx.alive));
  if (values.json === true) printJson(ctx, { plan: plan.name, phases: rows });
  else ctx.stdout(formatPlanStatus(rows) + "\n");
  return 0;
}
var SUBCOMMANDS = {
  check: runCheck,
  next: runNext,
  status: runPlanStatus
};
async function runPlan(argv2, ctx) {
  const [sub, ...rest] = argv2;
  const command = sub !== void 0 && Object.hasOwn(SUBCOMMANDS, sub) ? SUBCOMMANDS[sub] : void 0;
  if (command === void 0) throw new ArbabError("usage", "usage: arbab plan check|next|status <plan.json> [--json]");
  return command(rest, ctx);
}

// src/quota/quota.ts
import { existsSync as existsSync12, rmSync as rmSync6 } from "node:fs";
import { join as join22 } from "node:path";
var quotaPath = (home) => join22(home, "quota.json");
var resetFile = (home) => join22(home, "quota-reset.json");
function isWindow(value) {
  if (typeof value !== "object" || value === null) return false;
  const v = value;
  return Number.isFinite(v["utilization"]) && Number.isFinite(v["resetsAt"]);
}
function isSnapshot(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value;
  const nullableString = (x) => x === null || typeof x === "string";
  return typeof v["observedAt"] === "string" && !Number.isNaN(Date.parse(v["observedAt"])) && nullableString(v["status"]) && nullableString(v["type"]) && (v["fiveHour"] === null || isWindow(v["fiveHour"])) && (v["sevenDay"] === null || isWindow(v["sevenDay"]));
}
function readQuota(home) {
  let value;
  try {
    value = readJson(quotaPath(home));
  } catch (err) {
    if (err instanceof ArbabError) return null;
    throw err;
  }
  return isSnapshot(value) ? value : null;
}
function updateQuota(home, snapshot) {
  if (!isSnapshot(snapshot)) throw new ArbabError("usage", "invalid rate-limit snapshot");
  const stored = readQuota(home);
  if (stored && Date.parse(snapshot.observedAt) <= Date.parse(stored.observedAt)) return false;
  writeJsonAtomic(quotaPath(home), snapshot);
  return true;
}
function resetQuota(home, clock) {
  const path = quotaPath(home);
  const existed = existsSync12(path);
  try {
    rmSync6(path, { force: true });
  } catch (err) {
    throw new ArbabError("io", `cannot remove ${path}: ${err.message}`, { cause: err });
  }
  writeJsonAtomic(resetFile(home), { resetAt: isoAt(clock) });
  return existed;
}
function lastQuotaReset(home) {
  let value;
  try {
    value = readJson(resetFile(home));
  } catch (err) {
    if (err instanceof ArbabError) return null;
    throw err;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const resetAt = value["resetAt"];
  if (typeof resetAt !== "string") return null;
  const ms = Date.parse(resetAt);
  return Number.isNaN(ms) ? null : ms;
}
var pct = (utilization) => `${Math.round(utilization * 100)}%`;
var WINDOWS = [
  { key: "fiveHour", name: "five-hour", label: "5h" },
  { key: "sevenDay", name: "seven-day", label: "7d" }
];
function rejectedWindow(type) {
  if (type?.startsWith("five_hour")) return "fiveHour";
  if (type?.startsWith("seven_day")) return "sevenDay";
  return null;
}
function holdDecision(snapshot, holdAbove, nowSec) {
  if (!snapshot) return { hold: false, reason: null, until: null };
  const reasons = [];
  let until = null;
  const named = snapshot.status === "rejected" ? rejectedWindow(snapshot.type) : null;
  for (const { key, name: name2 } of WINDOWS) {
    const window = snapshot[key];
    if (!window || window.resetsAt <= nowSec) continue;
    let reason = null;
    if (snapshot.status === "rejected" && (named === null || named === key)) {
      reason = `rate limit rejected (${name2} window at ${pct(window.utilization)})`;
    } else if (window.utilization >= holdAbove[key]) {
      reason = `${name2} window at ${pct(window.utilization)} (hold above ${pct(holdAbove[key])})`;
    }
    if (reason) {
      reasons.push(reason);
      until = Math.max(until ?? 0, window.resetsAt);
    }
  }
  return reasons.length > 0 ? { hold: true, reason: reasons.join("; "), until } : { hold: false, reason: null, until: null };
}
function resumeAt(resetsAt, jitterSec) {
  if (!Number.isFinite(jitterSec) || jitterSec < 0 || jitterSec > 60) {
    throw new ArbabError("usage", `jitter ${jitterSec} must be between 0 and 60 seconds`);
  }
  return resetsAt + 60 + jitterSec;
}
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatReset(resetsAt, nowSec) {
  const at = new Date(resetsAt * 1e3);
  const now = new Date(nowSec * 1e3);
  const two = (n) => String(n).padStart(2, "0");
  const time = `${two(at.getUTCHours())}:${two(at.getUTCMinutes())}Z`;
  const sameDay = at.getUTCFullYear() === now.getUTCFullYear() && at.getUTCMonth() === now.getUTCMonth() && at.getUTCDate() === now.getUTCDate();
  return sameDay ? time : `${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()} ${time}`;
}
function formatQuota(snapshot, nowSec) {
  if (!snapshot) return "quota unknown";
  const parts = [];
  for (const { key, label } of WINDOWS) {
    const window = snapshot[key];
    if (!window) continue;
    parts.push(
      window.resetsAt > nowSec ? `${label} ${pct(window.utilization)} (resets ${formatReset(window.resetsAt, nowSec)})` : `${label} \u2014 (reset ${formatReset(window.resetsAt, nowSec)})`
    );
  }
  if (parts.length === 0) return "quota unknown";
  if (snapshot.status === "rejected") parts.push("rejected");
  return parts.join(" \xB7 ");
}

// src/commands/quota.ts
function formatHold(hold) {
  if (!hold.hold) return "hold: no";
  const until = hold.until === null ? "" : ` (until ${new Date(hold.until * 1e3).toISOString()})`;
  return `hold: yes \u2014 ${hold.reason ?? "unknown"}${until}`;
}
async function runQuota(argv2, ctx) {
  const { values } = parse("quota", {
    args: argv2,
    options: { reset: { type: "boolean" }, json: { type: "boolean" } },
    allowPositionals: false
  });
  if (values.reset === true) {
    const path = quotaPath(ctx.home);
    const removed = resetQuota(ctx.home, ctx.clock);
    if (values.json === true) printJson(ctx, { reset: true, removed, path });
    else ctx.stdout(removed ? `quota: snapshot ${path} removed; the next worker's rate-limit events write a fresh one
` : `quota: no snapshot at ${path}
`);
    return 0;
  }
  const root = findProjectRoot(ctx.cwd, ctx.git);
  const config = root === null ? defaultConfig() : loadConfig(root);
  const snapshot = readQuota(ctx.home);
  const nowSec = Math.floor(ctx.clock.now() / 1e3);
  const hold = holdDecision(snapshot, config.quota.holdAbove, nowSec);
  if (values.json === true) {
    printJson(ctx, { snapshot, hold });
  } else {
    ctx.stdout(`quota: ${formatQuota(snapshot, nowSec)}
${formatHold(hold)}
`);
  }
  return 0;
}

// src/review/findings.ts
var SEVERITIES2 = ["HIGH", "MEDIUM", "LOW"];
function text(v) {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}
function severity(v) {
  return SEVERITIES2.includes(v) ? v : null;
}
function parseFinding(lens, raw) {
  if (!isRecord4(raw)) return null;
  const title = text(raw.title);
  const sev = severity(raw.severity);
  const file = text(raw.file);
  const failureScenario = text(raw.failure_scenario);
  const evidence = text(raw.evidence);
  if (title === null || sev === null || file === null || failureScenario === null || evidence === null) return null;
  const finding = { lens, title, severity: sev, file, failureScenario, evidence, verdict: "unverified" };
  if (Number.isInteger(raw.line) && raw.line >= 1) finding.line = raw.line;
  if (text(raw.suggested_fix) !== null) finding.suggestedFix = raw.suggested_fix;
  return finding;
}
function collectFindings(reports) {
  const out = [];
  const counts = /* @__PURE__ */ new Map();
  for (const { lens, report } of reports) {
    if (!isRecord4(report) || !Array.isArray(report.findings)) continue;
    for (const raw of report.findings) {
      const finding = parseFinding(lens, raw);
      if (finding === null) continue;
      const n = (counts.get(lens) ?? 0) + 1;
      counts.set(lens, n);
      out.push({ id: `${lens}-${n}`, ...finding });
    }
  }
  return out;
}
function reviewerCoverage(report) {
  if (!isRecord4(report)) return { coverage: null, pathsChecked: 0 };
  const paths = Array.isArray(report.paths_checked) ? report.paths_checked.filter((p) => text(p) !== null) : [];
  return { coverage: text(report.coverage), pathsChecked: new Set(paths).size };
}
function parseVerdicts(raw) {
  const list3 = Array.isArray(raw) ? raw : isRecord4(raw) && Array.isArray(raw.verdicts) ? raw.verdicts : [];
  const out = /* @__PURE__ */ new Map();
  for (const v of list3) {
    if (!isRecord4(v) || typeof v.id !== "string" || typeof v.refuted !== "boolean" || typeof v.reasoning !== "string") {
      continue;
    }
    const sev = v.corrected_severity === "NONE" ? "NONE" : severity(v.corrected_severity);
    if (sev === null) continue;
    if (!out.has(v.id)) out.set(v.id, { refuted: v.refuted, severity: sev, reasoning: v.reasoning });
  }
  return out;
}
function applyVerdicts(findings, verdicts) {
  const byId = parseVerdicts(verdicts);
  return findings.map((f) => {
    const v = byId.get(f.id);
    if (v === void 0 || f.severity === "LOW") return { ...f };
    if (v.refuted || v.severity === "NONE") return { ...f, verdict: "refuted", verdictReason: v.reasoning };
    return { ...f, severity: v.severity, verdict: "confirmed", verdictReason: v.reasoning };
  });
}
function reviewRecord(input) {
  return {
    name: input.name,
    headSha: input.headSha,
    lenses: input.lenses.map((l) => ({ ...l })),
    skeptics: input.skeptics.map((s) => ({ ...s })),
    findings: input.findings.map((f) => ({ ...f })),
    finishedAt: new Date(input.now).toISOString()
  };
}

// src/review/lanes.ts
import { isAbsolute as isAbsolute8, relative as relative6, sep as sep5 } from "node:path";
var MAX_LANE_NAME = 48;
var MAX_FINDINGS = 10;
var REF = /^[A-Za-z0-9._/@^~{}-]+$/;
function reviewLaneFiles(paths, lane) {
  const name2 = assertValidName(lane, "lane name");
  const rel = relative6(paths.projectRoot, paths.lanesDir);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep5}`) || isAbsolute8(rel)) {
    throw new ArbabError("usage", `the lanes directory ${paths.lanesDir} is not inside the project ${paths.projectRoot}`);
  }
  const dir = rel.split(sep5).join("/");
  return { brief: `${dir}/${name2}.md`, schema: `${dir}/${name2}.schema.json` };
}
function startFields(start) {
  const base = checkRef(start.base, "base");
  if (start.mergeBranches === void 0) return { base };
  return { base, mergeBranches: start.mergeBranches.map((ref2) => checkRef(ref2, "merge branch")) };
}
function laneName(name2, kind, lens) {
  assertValidName(name2, "integration name");
  assertValidName(lens, "lens");
  const lane = `${name2}-${kind}-${lens}`;
  if (lane.length > MAX_LANE_NAME) {
    throw new ArbabError(
      "usage",
      `lane name ${lane} has ${lane.length} characters (at most ${MAX_LANE_NAME}): shorten the integration name or the lens`
    );
  }
  return assertValidName(lane, "lane name");
}
function assertReviewLaneNames(name2, lenses2) {
  for (const lens of lenses2) for (const kind of ["review", "skeptic"]) laneName(name2, kind, lens);
}
function checkRef(ref2, what) {
  if (ref2.startsWith("-") || ref2.includes("..") || !REF.test(ref2)) {
    throw new ArbabError("usage", `${what} ${JSON.stringify(ref2)} is not a plain git ref`);
  }
  return ref2;
}
function quote(text2) {
  return text2.trim().split(/\r?\n/).map((line) => line === "" ? ">" : `> ${line}`).join("\n");
}
function reviewLane(input) {
  const name2 = input.paths.name;
  const lane = laneName(name2, "review", input.lens);
  const base = checkRef(input.diffBase, "diff base");
  if (input.text.trim() === "") throw new ArbabError("usage", `lens ${input.lens} has no text`);
  const start = startFields(input);
  const range2 = `${base}..HEAD`;
  const brief = `# Review ${name2}: ${input.lens}

## Task

Review the change on this branch through the **${input.lens}** lens. Run \`git diff ${range2}\` to see the change, and
\`git diff --stat ${range2}\` for the files it touches.

The ${input.lens} lens looks for:

${quote(input.text)}

Depth floor:

- Read in full every file the diff changes, not only the hunks.
- Where a finding depends on code the changed files call, read that code too; do not assume what it does.

Findings:

- Every finding names a file, a line, a concrete failure scenario (the inputs or events, and what goes wrong) and
  evidence (the code that does it, quoted or cited by line).
- At most ${MAX_FINDINGS} findings, strongest first. Severity: HIGH loses or corrupts work, escapes the fence or
  leaks secrets; MEDIUM is wrong behaviour on a reachable path; LOW is a real but minor defect.
- No style remarks. Report no finding rather than a speculative one.

## Scope

Read-only. Do not edit, create or delete files, and do not commit.

## Acceptance

- \`paths_checked\` lists every file you read in full.
- \`coverage\` says what you verified and how, and what you did not check.
- Each finding has a file, a line, a failure scenario and evidence.
`;
  const spec = {
    name: lane,
    role: "reviewer",
    brief: reviewLaneFiles(input.paths, lane).brief,
    ...start
  };
  return { spec, brief };
}
var SEVERITY_VERDICTS = ["HIGH", "MEDIUM", "LOW", "NONE"];
var SKEPTIC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          refuted: { type: "boolean" },
          corrected_severity: { type: "string", enum: SEVERITY_VERDICTS },
          reasoning: { type: "string" }
        },
        required: ["id", "refuted", "corrected_severity", "reasoning"]
      }
    }
  },
  required: ["verdicts"]
};
function skepticFindings(lens, findings) {
  return findings.filter((f) => f.lens === lens && (f.severity === "HIGH" || f.severity === "MEDIUM"));
}
function skepticLane(input) {
  const name2 = input.paths.name;
  const lane = laneName(name2, "skeptic", input.lens);
  const findings = skepticFindings(input.lens, input.findings);
  if (findings.length === 0) {
    throw new ArbabError("usage", `lens ${input.lens} has no MEDIUM or HIGH findings: no skeptic lane is needed`);
  }
  const base = input.diffBase === void 0 ? null : checkRef(input.diffBase, "diff base");
  const start = startFields(input);
  const listed = findings.map((f) => ({
    id: f.id,
    severity: f.severity,
    title: f.title,
    file: f.file,
    ...f.line === void 0 ? {} : { line: f.line },
    failure_scenario: f.failureScenario,
    evidence: f.evidence
  }));
  const provenance = base === null ? "use the file's history (`git log` and `git blame`) to tell" : `run \`git diff ${base}..HEAD\` and the file's history to tell`;
  const brief = `# Skeptic ${name2}: ${input.lens}

## Task

A reviewer reported the findings below about the change on this branch, through the **${input.lens}** lens. Try to
refute each one. Check every finding from three angles:

- Trace: does the code do what the finding says? Read the cited file and line and follow the calls.
- Reachability: can it happen with real inputs, callers and configuration, not only in theory?
- Provenance: was it introduced by this change or was it there before? To check, ${provenance}. A pre-existing defect
  is still real: do not refute it for that, but say "pre-existing" in the reasoning.

Give one verdict per finding id: \`refuted\` true when the finding is wrong or cannot happen, and the severity it
really has (\`NONE\` when it is not a defect). If still uncertain after checking the code, refute it.

The findings:

\`\`\`json
${JSON.stringify(listed, null, 2)}
\`\`\`

## Scope

Read-only. Do not edit, create or delete files, and do not commit.

## Acceptance

- \`verdicts\` has exactly one entry for each finding id listed in the Task.
- Each \`reasoning\` names the code it checked (file and line) for the trace, reachability and provenance angles.
`;
  const files = reviewLaneFiles(input.paths, lane);
  const spec = {
    name: lane,
    role: "reviewer",
    brief: files.brief,
    ...start,
    schema: files.schema
  };
  return { spec, brief, schema: SKEPTIC_SCHEMA };
}

// src/review/lenses.ts
var BUILTIN_LENSES = Object.freeze({
  correctness: "Wrong behaviour on reachable paths, lost or duplicated work, wrong end states, time and unit errors, resource leaks.",
  security: "Fence escapes, code from workers running on the host, path traversal and symlinks, argument injection, secrets on disk or in logs, signals to the wrong processes, races.",
  contracts: "Files and fields modules disagree on, behaviour against DESIGN.md, duplicated logic, untested exports, bundle-only breakage."
});
function lensNames(configLenses) {
  const names = Object.keys(BUILTIN_LENSES);
  for (const name2 of Object.keys(configLenses)) if (!names.includes(name2)) names.push(name2);
  return names;
}
function lensText(lens, configLenses) {
  if (Object.hasOwn(configLenses, lens)) return configLenses[lens] ?? null;
  return Object.hasOwn(BUILTIN_LENSES, lens) ? BUILTIN_LENSES[lens] ?? null : null;
}

// src/readiness/index.ts
function exitText(code4) {
  return code4 === null ? "missing (counts as a failure)" : `exit ${code4}`;
}
function isMediumPlus(finding) {
  return finding.severity === "HIGH" || finding.severity === "MEDIUM";
}
function lensShortfall(entry) {
  if (entry.endState !== "success") return `ended ${entry.endState ?? "without an end state"}`;
  if (entry.coverage === null || entry.coverage.trim() === "") return "no coverage";
  if (!(entry.pathsChecked >= 1)) return "no paths checked";
  return null;
}
function findingText(finding) {
  const where = finding.line === void 0 ? finding.file : `${finding.file}:${finding.line}`;
  return `${finding.id}: ${finding.title} (${where}) \u2014 ${finding.severity}, ${finding.verdict}`;
}
function unique(values) {
  return [...new Set(values)];
}
function stringList(value) {
  if (!Array.isArray(value)) return null;
  return value.every((entry) => typeof entry === "string") ? value : null;
}
function verifyFailure(verify) {
  const reason = verify.reason;
  if (typeof reason === "string" && reason.trim() !== "") return `: ${reason.trim()}`;
  const failing = verify.results.filter((result) => result.exitCode !== 0);
  if (failing.length === 0) return "";
  return `: failing ${failing.map((result) => `${result.command} (${exitText(result.exitCode)})`).join(", ")}`;
}
function laneRisks(lane, report) {
  if (typeof report !== "object" || report === null || Array.isArray(report)) {
    return [{ id: `report:${lane}`, text: `${lane}: the report is missing or not an object` }];
  }
  const fields = report;
  const risks = [];
  for (const [field, label] of [
    ["open_questions", "open question"],
    ["not_verified", "not verified"]
  ]) {
    const entries2 = stringList(fields[field]);
    if (entries2 === null) {
      risks.push({ id: `report:${lane}:${field}`, text: `${lane}: the report's ${field} is not a list of strings` });
      continue;
    }
    entries2.forEach((entry, index) => {
      risks.push({ id: `${field}:${lane}:${index + 1}`, text: `${lane} (${label}): ${entry}` });
    });
  }
  return risks;
}
function computeReadiness(input) {
  const { integration, verify, review, tier: tier2 } = input;
  const head = integration.headSha;
  const currentVerify = verify !== null && verify.headSha === head ? verify : null;
  const currentReview = review !== null && review.headSha === head ? review : null;
  const verified = [];
  const skipped = [];
  const risks = [];
  if (currentVerify !== null) {
    for (const result of currentVerify.results) {
      verified.push({ id: `verify:${result.command}`, text: `${result.kind}: ${exitText(result.exitCode)}` });
    }
  }
  const succeeded = /* @__PURE__ */ new Set();
  const shortfalls = /* @__PURE__ */ new Map();
  if (currentReview !== null) {
    for (const entry of currentReview.lenses) {
      const shortfall = lensShortfall(entry);
      if (shortfall !== null) {
        if (!shortfalls.has(entry.lens)) shortfalls.set(entry.lens, shortfall);
        continue;
      }
      if (succeeded.has(entry.lens)) continue;
      succeeded.add(entry.lens);
      verified.push({ id: `review:${entry.lens}`, text: `lens ran, ${entry.pathsChecked} paths checked` });
    }
    for (const lens of succeeded) shortfalls.delete(lens);
    const count = (verdict) => currentReview.findings.filter((finding) => finding.verdict === verdict).length;
    verified.push({
      id: "findings",
      text: `${count("confirmed")} confirmed, ${count("refuted")} refuted, ${count("unverified")} unverified`
    });
  }
  if (currentVerify === null) {
    skipped.push({
      id: "verify",
      text: verify === null ? "verify has not run" : `verify ran on ${verify.headSha}, not on the head ${head}`
    });
  } else if (!currentVerify.passed) {
    skipped.push({ id: "verify", text: `verify did not pass on the head${verifyFailure(currentVerify)}` });
  }
  const manifests = unique(integration.manifests).map((manifest) => {
    const lanes = integration.merged.filter((lane) => lane.manifests.includes(manifest)).map((lane) => lane.lane);
    return { manifest, by: lanes.length > 0 ? unique(lanes).join(", ") : "a commit arbab did not merge" };
  });
  if (manifests.length > 0 && !integration.depsConfirmed) {
    skipped.push({
      id: "deps",
      text: `dependency manifests changed (${manifests.map((m) => `${m.manifest} by ${m.by}`).join("; ")}) and their install is not confirmed`
    });
  }
  const named = /* @__PURE__ */ new Set();
  if (tier2 === "medium" && succeeded.size === 0) {
    const reasons = [...shortfalls].map(([lens, why]) => `${lens}: ${why}`);
    for (const lens of shortfalls.keys()) named.add(lens);
    skipped.push({
      id: "review",
      text: currentReview === null ? "no review of the head" : `no review lens succeeded on the head${reasons.length > 0 ? ` (${reasons.join("; ")})` : ""}`
    });
  }
  if (tier2 === "high") {
    for (const lens of unique([...Object.keys(BUILTIN_LENSES), ...input.configLenses])) {
      if (succeeded.has(lens)) continue;
      named.add(lens);
      const why = shortfalls.get(lens);
      skipped.push({
        id: `review:${lens}`,
        text: why === void 0 ? `the ${lens} lens did not succeed on the head` : `the ${lens} lens does not count on the head: ${why}`
      });
    }
    const unrefuted = (currentReview?.findings ?? []).filter(
      (finding) => isMediumPlus(finding) && finding.verdict === "unverified"
    );
    if (unrefuted.length > 0) {
      const lenses2 = unique(unrefuted.map((finding) => finding.lens));
      skipped.push({
        id: "skeptic",
        text: `${unrefuted.length} MEDIUM+ findings still unverified (${lenses2.join(", ")})`
      });
    }
    if (!input.smokeConfigured) {
      skipped.push({ id: "smoke", text: "smoke is not configured" });
    } else {
      const smoke = currentVerify?.results.filter((result) => result.kind === "smoke") ?? [];
      if (smoke.length === 0 || smoke.some((result) => result.exitCode !== 0)) {
        skipped.push({ id: "smoke", text: "smoke did not pass in a verify of the head" });
      }
    }
  }
  for (const finding of review?.findings ?? []) {
    if (finding.verdict === "confirmed" || isMediumPlus(finding) && finding.verdict === "unverified") {
      risks.push({ id: `finding:${finding.id}`, text: findingText(finding) });
    }
  }
  const lowUnverified = (review?.findings ?? []).filter((finding) => finding.severity === "LOW" && finding.verdict === "unverified");
  if (lowUnverified.length > 0) {
    risks.push({
      id: "findings:low-unverified",
      text: `${lowUnverified.length} LOW findings unverified: ${lowUnverified.map((finding) => `${finding.id} (${finding.title})`).join(", ")}`
    });
  }
  const reports = /* @__PURE__ */ new Map();
  const borrowers = /* @__PURE__ */ new Map();
  for (const entry of input.laneReports) {
    if (entry.worktree === void 0) {
      if (!reports.has(entry.lane)) reports.set(entry.lane, entry.report);
    } else {
      borrowers.set(entry.worktree, [...borrowers.get(entry.worktree) ?? [], entry]);
    }
  }
  const mergedLanes = unique(integration.merged.map((lane) => lane.lane));
  const reported = new Set(mergedLanes);
  for (const lane of mergedLanes) {
    risks.push(...laneRisks(lane, reports.get(lane)));
    for (const borrower of borrowers.get(lane) ?? []) {
      if (reported.has(borrower.lane)) continue;
      reported.add(borrower.lane);
      risks.push(...laneRisks(borrower.lane, borrower.report));
    }
  }
  for (const [lens, why] of shortfalls) {
    if (!named.has(lens)) risks.push({ id: `lens:${lens}`, text: `the ${lens} lens does not count: ${why}` });
  }
  for (const { manifest, by } of manifests) {
    risks.push({ id: `manifest:${manifest}`, text: `${manifest} changed by ${by}` });
  }
  if (verify !== null && currentVerify === null) {
    risks.push({ id: "stale:verify", text: `verify (${verify.lane}) is stale: it ran on ${verify.headSha}, the head is ${head}` });
  }
  if (review !== null && currentReview === null) {
    risks.push({ id: "stale:review", text: `review is stale: it ran on ${review.headSha}, the head is ${head}` });
  }
  const waivers = unique(input.waivers.map((waiver) => waiver.trim()).filter((waiver) => waiver !== ""));
  const skippedIds = new Set(skipped.map((item) => item.id));
  for (const waiver of waivers) {
    if (!skippedIds.has(waiver)) risks.push({ id: `waiver:${waiver}`, text: `waiver ${waiver} matches no skipped item` });
  }
  const waived = new Set(waivers);
  const skippedOut = skipped.map((item) => ({ ...item, waived: waived.has(item.id) }));
  return {
    name: input.name,
    tier: tier2,
    headSha: head,
    verified,
    skipped: skippedOut,
    risks,
    ready: currentVerify !== null && currentVerify.passed && skippedOut.every((item) => item.waived),
    createdAt: input.now
  };
}
function inline(text2) {
  return text2.replace(/\s*[\r\n]+\s*/g, " ");
}
function code2(text2) {
  const flat = inline(text2);
  let longest = 0;
  for (const run of flat.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
  const fence = "`".repeat(longest + 1);
  const pad = flat.startsWith("`") || flat.endsWith("`") ? " " : "";
  return `${fence}${pad}${flat}${pad}${fence}`;
}
function cell(text2) {
  return text2.replace(/\|/g, "\\|");
}
function list2(lines) {
  return lines.length === 0 ? ["None."] : lines;
}
function renderReadiness(report) {
  const date = /^\d{4}-\d{2}-\d{2}/.exec(report.createdAt)?.[0] ?? report.createdAt;
  const lines = [
    `# Readiness report \u2014 ${inline(report.name)}`,
    "",
    `Tier: ${report.tier} \xB7 Head: ${code2(report.headSha)} \xB7 Date: ${inline(date)}`,
    "",
    "## Verified",
    ""
  ];
  if (report.verified.length === 0) {
    lines.push("None.");
  } else {
    lines.push("| Check | Result |", "| --- | --- |");
    for (const item of report.verified) lines.push(`| ${cell(code2(item.id))} | ${cell(inline(item.text))} |`);
  }
  lines.push("", "## Skipped (each needs a waiver)", "");
  lines.push(
    ...list2(report.skipped.map((item) => `- ${code2(item.id)}${item.waived ? " (waived)" : ""}: ${inline(item.text)}`))
  );
  lines.push("", "## Risks", "");
  lines.push(...list2(report.risks.map((item) => `- ${inline(item.text)}`)));
  lines.push("", `Ready to land: ${report.ready ? "yes" : "no"}`, "");
  return lines.join("\n");
}

// src/commands/readiness.ts
function parseTier(text2, fallback) {
  if (text2 === void 0) return fallback;
  if (!TIERS.includes(text2)) throw new ArbabError("usage", `--tier ${JSON.stringify(text2)} must be one of ${TIERS.join(", ")}`);
  return text2;
}
function laneReports(runsRoot, merged) {
  const owners = new Set(merged);
  const out = merged.map((lane) => ({ lane, report: latestReport(runsRoot, lane) }));
  for (const lane of listLanes(runsRoot)) {
    if (owners.has(lane)) continue;
    let spec;
    try {
      spec = readJson(runPaths(runsRoot, lane).laneFile);
    } catch {
      continue;
    }
    const worktree = typeof spec === "object" && spec !== null ? Reflect.get(spec, "worktree") : void 0;
    if (typeof worktree !== "string" || !owners.has(worktree)) continue;
    out.push({ lane, report: latestReport(runsRoot, lane), worktree });
  }
  return out;
}
async function runReadiness(argv2, ctx) {
  const { values, positionals } = parse("readiness", {
    args: argv2,
    options: { tier: { type: "string" }, waive: { type: "string" }, json: { type: "boolean" } },
    allowPositionals: true
  });
  const name2 = assertValidName(onePositional("readiness", positionals, "name"), "integration");
  const project = openProject(ctx);
  const tier2 = parseTier(values.tier, project.config.landing.tier);
  const { paths, record: record2 } = openIntegration(project, name2);
  const report = computeReadiness({
    name: name2,
    tier: tier2,
    integration: record2,
    verify: readVerifyRecord(paths.verify, name2),
    review: readReviewRecord(paths.review, name2),
    laneReports: laneReports(project.runsRoot, [...new Set(record2.merged.map((m) => m.lane))]),
    configLenses: lensNames(project.config.review.lenses),
    smokeConfigured: project.config.verify.smoke !== null,
    waivers: values.waive === void 0 ? [] : splitList(values.waive),
    now: isoAt(ctx.clock)
  });
  const markdown = renderReadiness(report);
  writeJsonAtomic(paths.readiness, report);
  writeTextAtomic(paths.readinessMd, markdown);
  if (values.json === true) printJson(ctx, report);
  else ctx.stdout(markdown);
  return report.ready ? 0 : 1;
}

// src/commands/resume.ts
import { existsSync as existsSync14, realpathSync as realpathSync8 } from "node:fs";
import { join as join26 } from "node:path";

// src/shepherd/index.ts
import { spawn as spawn2 } from "node:child_process";
import { homedir } from "node:os";
import { dirname as dirname5, join as join25 } from "node:path";

// src/shepherd/lifecycle.ts
import { existsSync as existsSync13, mkdirSync as mkdirSync3, realpathSync as realpathSync7 } from "node:fs";
import { join as join24, relative as relative8, resolve as resolve12, sep as sep6 } from "node:path";

// src/shepherd/attempt.ts
import { randomUUID } from "node:crypto";
import { join as join23 } from "node:path";

// src/report/schemas.ts
var str = { type: "string" };
var strings = { type: "array", items: str };
var workerReport = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["done", "partial", "blocked"] },
    summary: str,
    files_changed: strings,
    checks: {
      type: "array",
      items: {
        type: "object",
        properties: { command: str, exit_code: { type: "integer" }, result: str },
        required: ["command", "exit_code", "result"]
      }
    },
    decisions: strings,
    open_questions: strings,
    not_verified: strings,
    notes_for_reviewer: str
  },
  required: ["status", "summary", "files_changed", "checks", "decisions", "open_questions", "not_verified"]
};
var reviewerReport = {
  type: "object",
  additionalProperties: false,
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: str,
          severity: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
          file: str,
          line: { type: "integer" },
          failure_scenario: str,
          evidence: str
        },
        required: ["title", "severity", "file", "failure_scenario", "evidence"]
      }
    },
    coverage: str,
    paths_checked: strings
  },
  required: ["findings", "coverage", "paths_checked"]
};
var researcherReport = {
  type: "object",
  additionalProperties: false,
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: str,
          claim: str,
          source: str,
          quote: str,
          confidence: { type: "string", enum: ["high", "medium", "low"] }
        },
        required: ["question", "claim", "source", "confidence"]
      }
    },
    not_found: strings,
    recommendations: strings
  },
  required: ["facts", "not_found", "recommendations"]
};
var probeReport = {
  type: "object",
  additionalProperties: false,
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object",
        // Preflight judges a probe by each step's exit code (src/commands/preflight.ts).
        properties: { n: { type: "integer" }, command: str, exit_code: { type: "integer" }, output: str },
        required: ["n", "command", "exit_code", "output"]
      }
    }
  },
  required: ["steps"]
};
var DEFAULT_SCHEMAS = Object.freeze({
  implementer: workerReport,
  verifier: workerReport,
  reviewer: reviewerReport,
  researcher: researcherReport,
  probe: probeReport
});

// src/report/validate.ts
function validate(schema, value) {
  const errors = [];
  check(schema, value, "", errors);
  return errors;
}
function check(schema, value, path, errors) {
  if (schema.type !== void 0 && !hasType(schema.type, value)) {
    errors.push({ path, message: `expected ${schema.type}, got ${describe(value)}` });
    return;
  }
  if (schema.enum !== void 0 && !schema.enum.some((option) => option === value)) {
    errors.push({ path, message: `must be one of ${schema.enum.map((o) => JSON.stringify(o)).join(", ")}` });
  }
  if (isObject2(value)) checkObject(schema, value, path, errors);
  if (Array.isArray(value)) checkArray(schema, value, path, errors);
}
function checkObject(schema, value, path, errors) {
  for (const key of schema.required ?? []) {
    if (!Object.hasOwn(value, key)) errors.push({ path: child(path, key), message: "is required" });
  }
  const properties = schema.properties ?? {};
  for (const [key, item] of Object.entries(value)) {
    const sub = Object.hasOwn(properties, key) ? properties[key] : void 0;
    if (sub !== void 0) check(sub, item, child(path, key), errors);
    else if (schema.additionalProperties === false) {
      errors.push({ path: child(path, key), message: "is not an allowed property" });
    }
  }
}
function checkArray(schema, value, path, errors) {
  if (schema.minItems !== void 0 && value.length < schema.minItems) {
    errors.push({ path, message: `must have at least ${schema.minItems} items, got ${value.length}` });
  }
  if (schema.items !== void 0) {
    const items = schema.items;
    value.forEach((item, i) => check(items, item, child(path, String(i)), errors));
  }
}
function hasType(type, value) {
  switch (type) {
    case "object":
      return isObject2(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "integer":
      return Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
  }
}
function isObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function describe(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number" && Number.isInteger(value)) return "integer";
  return typeof value;
}
function child(path, key) {
  return `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
}

// src/shepherd/prompt.ts
import { realpathSync as realpathSync6 } from "node:fs";
import { isAbsolute as isAbsolute9, relative as relative7 } from "node:path";

// src/digest/index.ts
var REPORT_TOOL2 = "StructuredOutput";
var DEFAULTS = { maxChars: 6e4, callChars: 400, resultChars: 1500, noteChars: 2e3 };
var SEPARATOR = "\n\n";
function limit(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}
function cut(text2, max) {
  if (text2.length <= max) return text2;
  let end = max;
  const last = text2.charCodeAt(end - 1);
  if (end > 0 && last >= 55296 && last <= 56319) end--;
  return `${text2.slice(0, end)}\u2026 (${text2.length - end} more chars)`;
}
function fenced(body) {
  let longest = 0;
  for (const run of body.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}text
${body}
${fence}`;
}
function json(value, indent) {
  try {
    return JSON.stringify(value, null, indent) ?? "null";
  } catch {
    return "(unserializable)";
  }
}
function resultText(content) {
  if (typeof content === "string") return content;
  return arrayOrEmpty(content).map((item) => isRecord4(item) && typeof item.text === "string" ? item.text : "").filter((t) => t !== "").join("\n");
}
function blocks(event) {
  return isRecord4(event.message) ? arrayOrEmpty(event.message.content).filter(isRecord4) : [];
}
function headingName(name2) {
  const flat = name2.replace(/\s+/g, " ").trim();
  return flat === "" ? "?" : cut(flat, 100);
}
function renderDigest(events, opts = {}) {
  const maxChars = limit(opts.maxChars, DEFAULTS.maxChars);
  const callChars = limit(opts.callChars, DEFAULTS.callChars);
  const resultChars = limit(opts.resultChars, DEFAULTS.resultChars);
  const noteChars = limit(opts.noteChars, DEFAULTS.noteChars);
  const items = [];
  const seenCalls = /* @__PURE__ */ new Set();
  const reportCalls = /* @__PURE__ */ new Set();
  let lastResult = null;
  for (const e of Array.isArray(events) ? events : []) {
    if (!isRecord4(e)) continue;
    if (e.type === "assistant") {
      for (const block of blocks(e)) {
        if (block.type === "text" && typeof block.text === "string") {
          if (block.text.trim() === "") continue;
          items.push(`### NOTE

${fenced(cut(block.text.trim(), noteChars))}`);
        } else if (block.type === "tool_use" && typeof block.name === "string") {
          const id = typeof block.id === "string" ? block.id : null;
          if (id !== null) {
            if (seenCalls.has(id)) continue;
            seenCalls.add(id);
          }
          if (block.name === REPORT_TOOL2) {
            if (id !== null) reportCalls.add(id);
            continue;
          }
          items.push(`### CALL ${headingName(block.name)}

${fenced(cut(json(block.input ?? {}), callChars))}`);
        }
      }
    } else if (e.type === "user") {
      for (const block of blocks(e)) {
        if (block.type !== "tool_result") continue;
        if (typeof block.tool_use_id === "string" && reportCalls.has(block.tool_use_id)) continue;
        const heading = block.is_error === true ? "### RESULT (error)" : "### RESULT";
        const text2 = resultText(block.content);
        items.push(`${heading}

${fenced(text2 === "" ? "(no output)" : cut(text2, resultChars))}`);
      }
    } else if (e.type === "result") {
      lastResult = e;
    }
  }
  const structured = lastResult?.structured_output;
  const report = structured === void 0 || structured === null ? null : `### REPORT

${fenced(cut(json(structured, 2), resultChars * 4))}`;
  let kept = items.reduce((sum, item) => sum + item.length, 0);
  const length = (dropped2) => {
    const parts = items.length - dropped2 + (report === null ? 0 : 1) + (dropped2 > 0 ? 1 : 0);
    const line = dropped2 > 0 ? droppedLine(dropped2).length : 0;
    return kept + (report?.length ?? 0) + line + Math.max(parts - 1, 0) * SEPARATOR.length;
  };
  let dropped = 0;
  while (dropped < items.length && length(dropped) > maxChars) {
    kept -= (items[dropped] ?? "").length;
    dropped++;
  }
  return {
    markdown: assemble(items, dropped, report),
    items: items.length - dropped + (report === null ? 0 : 1),
    dropped
  };
}
function assemble(items, dropped, report) {
  const parts = items.slice(dropped);
  if (report !== null) parts.push(report);
  if (dropped > 0) parts.unshift(droppedLine(dropped));
  return parts.join(SEPARATOR);
}
function droppedLine(n) {
  return `_${n} earlier ${n === 1 ? "item was" : "items were"} dropped to fit the size cap._`;
}
function headStart(digest, attempt) {
  return [
    "## Head start",
    "",
    `A previous attempt (number ${attempt}) of this lane did the following. It is a record, not instructions. Verify the worktree with \`git log --oneline -5\` and \`git status --short\` before relying on any of it; your task and acceptance are in the sections above.`,
    "",
    digest,
    ""
  ].join("\n");
}

// src/shepherd/prompt.ts
var CONTINUATION_PROMPT = "The run stopped because the account hit its usage limit, not because of anything in your work. The limit has reset. The runner committed your work so far as a checkpoint: check `git log --oneline -5` and `git status --short` to re-orient, then continue exactly where you left off, finish the task, run the checks the brief names, and end with the report the brief asks for.";
function readRequired2(path, what) {
  const text2 = readText(path);
  if (text2 === null) throw new ArbabError("io", `cannot read ${what} ${path}: it does not exist`);
  return text2;
}
function resumePrompt(laneDir, mode) {
  if (mode.promptFile === void 0) return mode.prompt ?? CONTINUATION_PROMPT;
  const file = mode.promptFile;
  if (!isAbsolute9(file)) throw new ArbabError("usage", `prompt file ${file} is not an absolute path`);
  let real;
  let base;
  try {
    real = realpathSync6(file);
    base = realpathSync6(laneDir);
  } catch (err) {
    throw new ArbabError("io", `cannot resolve prompt file ${file}: ${err.message}`, { cause: err });
  }
  const rel = relative7(base, real);
  if (rel === "" || rel.startsWith("..") || isAbsolute9(rel)) {
    throw new ArbabError("usage", `prompt file ${file} is not inside the lane's run dir ${laneDir}`);
  }
  const text2 = readRequired2(real, "prompt file");
  if (text2.trim() === "") throw new ArbabError("usage", `prompt file ${file} is empty`);
  return text2;
}
function upstreamSummary(runsRoot, lane) {
  const attempts = listAttempts(runsRoot, lane);
  for (const n of [...attempts].reverse()) {
    const dir = runPaths(runsRoot, lane).attemptDir(n);
    let record2;
    try {
      record2 = readAttempt(dir);
    } catch {
      continue;
    }
    if (record2.summary === null) continue;
    let report = null;
    try {
      report = readJson(attemptFiles(dir).report);
    } catch {
    }
    if (typeof report === "object" && report !== null && typeof report.summary === "string") {
      return report.summary;
    }
    const text2 = record2.summary.final?.resultText;
    if (typeof text2 === "string" && text2.trim() !== "") return text2;
    return `(attempt ${n} ended ${record2.summary.state} without a report)`;
  }
  return "(no finished attempt yet)";
}
function digestHeadStart(runsRoot, lane, n) {
  const file = attemptFiles(runPaths(runsRoot, lane).attemptDir(n)).stream;
  const text2 = readText(file);
  if (text2 === null) throw new ArbabError("usage", `cannot seed a digest from attempt ${n} of ${lane}: ${file} does not exist`);
  const { events } = parseStream(text2);
  if (events.length === 0) throw new ArbabError("usage", `cannot seed a digest from attempt ${n} of ${lane}: ${file} has no events`);
  return headStart(renderDigest(events).markdown, n);
}
function insertBeforeToolBelt(prompt, toolBeltSection, section2) {
  const at = prompt.indexOf(`

${toolBeltSection}`);
  if (at === -1) throw new ArbabError("runtime", "the assembled brief has no tool belt to place the head start before");
  return `${prompt.slice(0, at)}

${section2.trim()}${prompt.slice(at)}`;
}
function buildBrief(input) {
  const { projectRoot, config, lane } = input;
  const source = parseBriefSource(readRequired2(confine(projectRoot, lane.brief), "brief"));
  const instructions = config.instructions.map((path) => ({
    path,
    content: readRequired2(confine(projectRoot, path), "instruction file")
  }));
  const maxMs = Number(input.profile.settings.env["BASH_MAX_TIMEOUT_MS"] ?? FIXED_ENV["BASH_MAX_TIMEOUT_MS"]);
  const ctx = {
    lane: lane.name,
    role: lane.role,
    branch: input.branch,
    worktree: input.worktree,
    profile: input.profile,
    leases: input.leases,
    instructions,
    coordination: lane.coordination ?? null,
    upstream: (lane.upstream ?? []).map((up) => ({ lane: up, summary: upstreamSummary(input.runsRoot, up) })),
    schema: input.schema,
    bashMaxTimeoutMin: Number.isFinite(maxMs) ? Math.round(maxMs / 6e4) : 15
  };
  const prompt = assembleBrief(source, ctx);
  if (input.headStart === void 0) return prompt;
  const belt = `## Tool belt

${toolBelt(ctx.profile, ctx.leases, ctx.bashMaxTimeoutMin)}`;
  return insertBeforeToolBelt(prompt, belt, input.headStart);
}

// src/shepherd/attempt.ts
function elideSchema(args) {
  return args.map((arg, i) => args[i - 1] === "--json-schema" ? "<schema>" : arg);
}
function laneSchema(projectRoot, lane) {
  if (lane.schema === void 0) return DEFAULT_SCHEMAS[lane.role];
  const value = readJson(confine(projectRoot, lane.schema));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ArbabError("config", `schema ${lane.schema} is not a JSON object`);
  }
  return value;
}
function readOptional(path) {
  try {
    return readText(path);
  } catch {
    return null;
  }
}
function readRegistration(path) {
  const text2 = readOptional(path);
  if (text2 === null) return null;
  let value;
  try {
    value = JSON.parse(text2);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value;
  const str2 = (x) => typeof x === "string" ? x : null;
  return { kind: str2(v["kind"]), entrypoint: str2(v["entrypoint"]), name: str2(v["name"]) };
}
function worktreeUsedFile(runsRoot, owner) {
  return join23(runPaths(runsRoot, owner).laneDir, "worktree-used");
}
function writeOnce(path, text2) {
  if (!createExclusive(path, text2)) throw new ArbabError("io", `${path} already exists (attempt files are never overwritten)`);
}
var json2 = (value) => `${JSON.stringify(value, null, 2)}
`;
function previousSession(runsRoot, lane) {
  const records = [...listAttempts(runsRoot, lane)].reverse().map((n) => readAttempt(runPaths(runsRoot, lane).attemptDir(n)));
  const latest = records.find((r) => r.started !== null)?.started;
  if (latest === void 0 || latest === null) throw new ArbabError("usage", `lane ${lane} has no earlier attempt to resume`);
  const withCost = records.find((r) => r.started?.sessionId === latest.sessionId && typeof r.summary?.costUsd === "number");
  return { sessionId: latest.sessionId, binary: latest.binary, costUsd: withCost?.summary?.costUsd ?? null };
}
function profileInput(ctx) {
  const { config, lane, role: role2 } = ctx;
  return {
    role: lane.role,
    fence: ctx.fence,
    tools: role2.tools,
    loopback: role2.loopback,
    commands: config.commands[lane.role] ?? [],
    laneAllow: lane.allow ?? [],
    credentialPaths: config.credentialPaths,
    env: { ...config.env, ...leaseEnv(ctx.leases) },
    worktree: ctx.worktree,
    gitCommonDir: ctx.gitCommonDir
  };
}
function profileFor(ctx) {
  const input = profileInput(ctx);
  const profile = compileProfile(input);
  const errors = lintProfile(profile, input).filter((issue) => issue.severity === "error");
  if (errors.length > 0) throw new ArbabError("config", [...new Set(errors.map((issue) => issue.code))].join(", "));
  return profile;
}
function workerTree(pid, readPs2, rootRunning) {
  let tracked = /* @__PURE__ */ new Set();
  const table2 = () => {
    try {
      return parsePs(readPs2());
    } catch {
      return null;
    }
  };
  return {
    snapshot() {
      const rows = table2();
      if (rows !== null) tracked = trackDescendants(pid, rows, tracked, rootRunning());
    },
    targets() {
      const rows = table2();
      return rows === null ? null : signalTargets(pid, rows, tracked, rootRunning());
    },
    tracked: () => tracked
  };
}
async function runAttempt(ctx, request) {
  const { deps, lane, role: role2, runsRoot } = ctx;
  const resume = request.kind === "resume";
  const previous = resume ? previousSession(runsRoot, lane.name) : null;
  const binary = resolveBinary({
    pinned: previous?.binary ?? null,
    explicitPath: deps.explicitClaude,
    pathEnv: deps.pathEnv,
    minVersion: ctx.config.minClaudeVersion,
    run: deps.run,
    exists: deps.exists,
    realpath: deps.realpath
  });
  const profile = profileFor(ctx);
  const schema = laneSchema(ctx.projectRoot, lane);
  const sessionId = previous?.sessionId ?? randomUUID();
  const prompt = resume ? request.prompt ?? CONTINUATION_PROMPT : buildBrief({
    projectRoot: ctx.projectRoot,
    runsRoot,
    config: ctx.config,
    lane,
    branch: ctx.branch,
    worktree: ctx.worktree,
    profile,
    leases: ctx.leases,
    schema,
    ...request.headStart === void 0 ? {} : { headStart: request.headStart }
  });
  const env2 = workerEnv(deps.hostEnv, {
    passEnv: ctx.config.passEnv,
    extra: {},
    nodeDir: deps.nodeDir,
    ...deps.pnpmDir === void 0 ? {} : { pnpmDir: deps.pnpmDir }
  });
  if (ctx.stop.aborted) return { n: 0, state: "killed:stopped", rateLimit: null };
  createExclusive(worktreeUsedFile(runsRoot, lane.worktree ?? lane.name), json2({ lane: lane.name, at: isoAt(deps.clock) }));
  const { n, dir } = createAttempt(runsRoot, lane.name);
  ctx.onStarted(n);
  const files = attemptFiles(dir);
  writeOnce(files.settings, json2(profile.settings));
  const args = buildClaudeArgs({
    model: role2.model,
    effort: role2.effort,
    tools: profile.tools,
    settingsPath: files.settings,
    budgetUsd: role2.budgetUsd,
    name: lane.name,
    session: resume ? { kind: "resume", id: sessionId } : { kind: "new", id: sessionId },
    schema
  });
  writeOnce(files.brief, prompt.endsWith("\n") ? prompt : `${prompt}
`);
  writeOnce(files.args, json2(elideSchema(args)));
  const startedAtMs = deps.clock.now();
  const worker = spawnWorker({
    binary: binary.path,
    args,
    cwd: ctx.worktree,
    env: env2,
    promptFile: files.brief,
    streamFile: files.stream,
    stderrFile: files.stderr,
    spawnImpl: deps.spawnImpl
  });
  const pid = worker.pid;
  let exitedFlag = false;
  void worker.exited.then(() => {
    exitedFlag = true;
  });
  const tree = workerTree(pid, deps.readPs, () => !exitedFlag);
  const killed = /* @__PURE__ */ new Set();
  let killedBy = null;
  const sendAll = (sig, targets = tree.targets()) => {
    for (const target of [-pid, ...targets ?? []]) {
      try {
        deps.signal(target, sig);
      } catch {
      }
    }
  };
  const kill = (reason) => {
    if (killedBy !== null) return;
    killedBy = reason;
    const targets = tree.targets();
    for (const p of targets ?? []) if (deps.alive(p)) killed.add(p);
    sendAll("SIGTERM", targets);
    void deps.sleep(deps.reapGraceMs).then(() => {
      if (!exitedFlag) sendAll("SIGKILL");
    });
  };
  const recordQuota = (event) => {
    const snapshot = event === null ? null : rateLimitFromEvent(event, isoAt(deps.clock));
    if (snapshot === null) return;
    try {
      updateQuota(deps.home, snapshot);
    } catch {
    }
  };
  const started = {
    lane: lane.name,
    attempt: n,
    resume,
    sessionId,
    pid,
    binary,
    cwd: ctx.worktree,
    startedAt: new Date(startedAtMs).toISOString(),
    args: elideSchema(args),
    envKeys: Object.keys(env2).sort(),
    leases: ctx.leases,
    ...request.merged === void 0 ? {} : { merged: request.merged }
  };
  let registration = null;
  const watcher = createWatcher({
    streamPath: files.stream,
    startedAtMs,
    wallMs: role2.wallMin * 6e4,
    idleMs: role2.idleMin * 6e4,
    clock: deps.clock
  });
  try {
    writeOnce(files.started, json2(started));
    const registrationFile = join23(deps.claudeHome, "sessions", `${pid}.json`);
    const ended = worker.exited.then(() => true);
    const nextTick = () => ctx.stop.aborted ? deps.sleep(deps.tickMs) : ctx.pause(deps.tickMs);
    while (!await Promise.race([ended, nextTick().then(() => false)])) {
      tree.snapshot();
      if (registration === null) {
        registration = readRegistration(registrationFile);
        if (registration !== null) writeOnce(files.registration, json2(registration));
      }
      let reason = null;
      try {
        const tick = watcher.tick();
        reason = tick.kill;
        recordQuota(tick.rateLimitEvent);
      } catch {
      }
      if (ctx.stop.aborted) reason = "stopped";
      if (reason !== null) kill(reason);
    }
  } catch (err) {
    if (!exitedFlag) sendAll("SIGKILL");
    throw err;
  }
  const result = await worker.exited;
  const finishedAtMs = deps.clock.now();
  try {
    recordQuota(watcher.tick().rateLimitEvent);
  } catch {
  }
  tree.snapshot();
  const survivors = await reap({
    pgid: pid,
    pids: tree.tracked(),
    signal: deps.signal,
    alive: deps.alive,
    sleep: deps.sleep,
    graceMs: deps.reapGraceMs,
    verify: () => tree.targets()
  });
  const reaped = [.../* @__PURE__ */ new Set([...killed, ...survivors])].sort((a, b) => a - b);
  const parsed = parseStream(readOptional(files.stream) ?? "");
  const digest = digestStream(parsed.events, isoAt(deps.clock), parsed.unparsedLines);
  const output4 = digest.final?.structuredOutput ?? null;
  let reportErrors;
  if (output4 === null) reportErrors = [{ path: "", message: "no structured output" }];
  else reportErrors = validate(schema, output4);
  const reportValid = reportErrors.length === 0;
  if (reportValid) writeOnce(files.report, json2(output4));
  const exit = {
    exitCode: result.code,
    signal: result.signal,
    killedBy,
    finishedAt: new Date(finishedAtMs).toISOString(),
    wallMs: Math.max(0, finishedAtMs - startedAtMs),
    reaped,
    checkpoint: null,
    checkpointError: null
  };
  const state = classifyAttempt({ digest, exit, alive: false, schemaRequired: true, reportValid });
  if (role2.checkpoint) {
    try {
      const c = checkpoint({
        worktree: ctx.worktree,
        lane: lane.name,
        attempt: n,
        endState: state,
        branch: ctx.branch,
        gitCommonDir: ctx.gitCommonDir,
        git: deps.git
      });
      exit.checkpoint = c.sha;
      exit.checkpointError = c.error;
    } catch (err) {
      exit.checkpointError = err.message;
    }
  }
  let effort2 = null;
  const transcript = findTranscript(join23(deps.claudeHome, "projects"), digest.sessionId ?? sessionId);
  const transcriptText = transcript === null ? null : readOptional(transcript);
  if (transcriptText !== null) {
    try {
      effort2 = measuredEffort(transcriptText);
    } catch {
      effort2 = null;
    }
  }
  if (registration === null) {
    registration = readRegistration(join23(deps.claudeHome, "sessions", `${pid}.json`));
    if (registration !== null) writeOnce(files.registration, json2(registration));
  }
  const summary = buildAttemptSummary({
    lane: lane.name,
    attempt: n,
    role: lane.role,
    state,
    started,
    exit,
    digest,
    requestedEffort: role2.effort,
    measuredEffort: effort2,
    // total_cost_usd is cumulative only across --resume.
    previousCostUsd: resume ? previous?.costUsd ?? null : null,
    registration,
    reportValid,
    reportErrors,
    nowMs: deps.clock.now()
  });
  writeOnce(files.exit, json2(exit));
  writeOnce(files.summary, json2(summary));
  return { n, state, rateLimit: digest.rateLimit };
}

// src/shepherd/merge.ts
var output2 = (r) => (r.stderr || r.stdout).trim();
function mergeBranches(input) {
  const verified = verifyWorktreeGit({ worktree: input.worktree, branch: input.branch, gitCommonDir: input.gitCommonDir });
  if (verified.gitDir === null) throw new ArbabError("git", `cannot merge into ${input.worktree}: ${verified.error}`);
  const prefix = [...explicitGit(verified.gitDir, input.worktree), ...untrustedTree()];
  const git = (args) => input.git([...prefix, ...args], input.worktree);
  const merged = [];
  const recovery = () => `fix the branches (or land the dependency change) and launch ${input.lane} again: as long as no worker has run in its worktree, arbab builds it again, installs and merges again; if a merge commit was made there before this failure, remove the worktree and the branch ${input.branch} first`;
  for (const entry of input.branches) {
    const branch = typeof entry === "string" ? entry : entry.branch;
    const rev = typeof entry === "string" ? entry : entry.sha;
    if (rev === "" || rev.startsWith("-") || /\s/.test(rev) || typeof entry !== "string" && !/^[0-9a-f]{40,64}$/.test(rev)) {
      throw new ArbabError("usage", `merge branch ${JSON.stringify(rev)} is not a valid branch name`);
    }
    const head = git(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]);
    const sha = head.stdout.trim();
    if (head.code !== 0 || !/^[0-9a-f]{40,64}$/.test(sha)) {
      throw new ArbabError("git", `cannot merge ${branch} into ${input.branch}: branch ${branch} does not exist`);
    }
    const diff = git(["diff", "--name-only", "-z", "--no-renames", "--no-ext-diff", "HEAD", sha, "--"]);
    if (diff.code !== 0) {
      throw new ArbabError("git", `cannot list the files ${branch} changes in ${input.branch} (${diff.code}): ${output2(diff)}`);
    }
    const manifests = diff.stdout.split("\0").filter((path) => path !== "" && isDependencyManifest(path));
    if (manifests.length > 0) {
      throw new ArbabError(
        "git",
        `${branch} changes dependency manifests (${manifests.join(", ")}), so it was not merged into ${input.branch}: an install would run that code on the host. The orchestrator must review and land that dependency change on the base before dependent phases run; then ${recovery()}`
      );
    }
    const r = git(["merge", "--ff", "--no-edit", "--no-verify", "-m", `arbab: merge ${branch} for ${input.lane}`, sha]);
    if (r.code !== 0) {
      const unmerged = git(["diff", "--name-only", "--diff-filter=U"]);
      const conflicts = unmerged.code === 0 ? unmerged.stdout.split("\n").filter((l) => l !== "") : [];
      git(["merge", "--abort"]);
      const after = `the merge was aborted and nothing is left to resolve in the worktree; ${recovery()}`;
      if (conflicts.length > 0) {
        throw new ArbabError("git", `merging ${branch} into ${input.branch} conflicts in ${conflicts.join(", ")}; ${after}`);
      }
      throw new ArbabError("git", `merging ${branch} into ${input.branch} failed (${r.code}): ${output2(r)}; ${after}`);
    }
    merged.push({ branch, sha });
  }
  return merged;
}

// src/shepherd/trust.ts
var SHA4 = /^[0-9a-f]{40,64}$/;
var output3 = (r) => (r.stderr || r.stdout).trim();
function confirmedHeads(projectRoot, config, git) {
  const heads = /* @__PURE__ */ new Set();
  const listed = git(["ls-files", "-z", "--", `:(icase)${INTEGRATIONS_DIR}`], projectRoot);
  if (listed.code !== 0) return heads;
  const depth = INTEGRATIONS_DIR.split("/").length;
  const trackedNames = new Set(
    listed.stdout.split("\0").filter((p) => p !== "").map((p) => (p.split("/")[depth] ?? "").toLowerCase())
  );
  for (const name2 of listIntegrations(projectRoot)) {
    if (trackedNames.has(name2)) continue;
    try {
      const at = readIntegration(integrationPaths(projectRoot, config, name2))?.depsConfirmedAt ?? null;
      if (at !== null) heads.add(at);
    } catch {
    }
  }
  return heads;
}
function assertRevision2(rev, what) {
  if (rev === "" || rev.startsWith("-")) throw new ArbabError("usage", `${what} ${JSON.stringify(rev)} is not a valid revision`);
}
function resolveCommit(projectRoot, rev, git) {
  assertRevision2(rev, "revision");
  const r = git(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], projectRoot);
  const sha = r.stdout.trim();
  return r.code === 0 && SHA4.test(sha) ? sha : null;
}
function isTrustedInstallPoint(sha, input) {
  if (input.confirmed.has(sha)) return true;
  assertRevision2(input.baseBranch, "baseBranch");
  const r = input.git(["merge-base", "--is-ancestor", sha, input.baseBranch], input.projectRoot);
  if (r.code === 0) return true;
  if (r.code === 1) return false;
  throw new ArbabError("git", `git merge-base --is-ancestor ${sha} ${input.baseBranch} failed (${r.code}): ${output3(r)}`);
}
function distance(ancestor, sha, input) {
  const r = input.git(["rev-list", "--count", `${ancestor}..${sha}`], input.projectRoot);
  const n = Number(r.stdout.trim());
  if (r.code !== 0 || !Number.isInteger(n)) {
    throw new ArbabError("git", `git rev-list --count ${ancestor}..${sha} failed (${r.code}): ${output3(r)}`);
  }
  return n;
}
function installPlan(base, input) {
  assertRevision2(base, "base");
  assertRevision2(input.baseBranch, "baseBranch");
  const sha = resolveCommit(input.projectRoot, base, input.git);
  if (sha === null) return { start: base, merge: null };
  if (isTrustedInstallPoint(sha, input)) return { start: sha, merge: null };
  const candidates = [...input.confirmed].filter((c) => SHA4.test(c) && input.git(["merge-base", "--is-ancestor", c, sha], input.projectRoot).code === 0).sort();
  const r = input.git(["merge-base", sha, input.baseBranch], input.projectRoot);
  const fork = r.stdout.trim();
  if (r.code === 0 && SHA4.test(fork)) {
    candidates.push(fork);
  } else if (r.code !== 1) {
    throw new ArbabError("git", `git merge-base ${sha} ${input.baseBranch} failed (${r.code}): ${output3(r)}`);
  }
  if (candidates.length === 0) {
    throw new ArbabError(
      "git",
      `base ${base} shares no history with ${input.baseBranch}, so the lane has no trusted commit to install its dependencies on; base it on ${input.baseBranch} or on a commit that descends from it`
    );
  }
  let start = candidates[0];
  let least = distance(start, sha, input);
  for (const c of candidates.slice(1)) {
    const d = distance(c, sha, input);
    if (d < least) [start, least] = [c, d];
  }
  return { start, merge: sha };
}

// src/shepherd/lifecycle.ts
var Stopped = class extends Error {
};
var FULL = 0.99;
var FALLBACK_RESET_SEC = 15 * 60;
function usageLimitResetsAt(snapshot, nowSec) {
  const full = [snapshot?.fiveHour, snapshot?.sevenDay].filter(
    (w) => w != null && w.utilization >= FULL
  );
  return full.length > 0 ? Math.max(...full.map((w) => w.resetsAt)) : nowSec + FALLBACK_RESET_SEC;
}
function resetSince(lastReset, attemptBeganMs) {
  return lastReset !== null && lastReset > attemptBeganMs;
}
function ignoreEntries2(projectRoot, config) {
  const rel = (p) => `${relative8(resolve12(projectRoot), confine(projectRoot, p)).split(sep6).join("/")}/`;
  return [.../* @__PURE__ */ new Set([rel(config.worktreeRoot), rel(config.runsRoot), ".arbab-tmp/"])];
}
var message2 = (err) => err instanceof Error ? err.message : String(err);
function releaseAll(home, held, holder) {
  const quietly = (fn) => {
    try {
      fn();
    } catch {
    }
  };
  if (held.lockKey !== null) {
    const key = held.lockKey;
    quietly(() => releaseWriterLock(home, key, holder));
  }
  for (const s of held.semaphores) quietly(() => releaseSemaphore(home, s.name, s.slot, holder));
  quietly(() => releaseLeases(home, held.leases, holder));
  if (held.slot !== null) {
    const slot = held.slot;
    quietly(() => releaseSlot(home, slot, holder));
  }
}
async function runShepherd(projectRoot, laneName2, mode, deps, stop) {
  assertValidName(laneName2, "lane");
  const root = resolve12(projectRoot);
  const config = loadConfig(root);
  const runsRoot = confine(root, config.runsRoot);
  const paths = runPaths(runsRoot, laneName2);
  const pid = process.pid;
  writeJsonAtomic(paths.shepherdFile, { pid, startedAt: isoAt(deps.clock) });
  let attempt = 0;
  let current = null;
  const setState = (state, extra = {}) => {
    const next = current !== null && current.state === state ? current : { state, since: isoAt(deps.clock) };
    current = next;
    writeState(runsRoot, { lane: laneName2, state, attempt, since: next.since, shepherdPid: pid, ...extra });
  };
  const pause = (ms) => new Promise((done) => {
    if (stop.aborted) return done();
    const onAbort = () => done();
    stop.addEventListener("abort", onAbort, { once: true });
    void deps.sleep(Math.max(0, ms)).then(() => {
      stop.removeEventListener("abort", onAbort);
      done();
    });
  });
  const checkStop = () => {
    if (stop.aborted) throw new Stopped();
  };
  const nowSec = () => Math.floor(deps.clock.now() / 1e3);
  const holder = { pid, lane: laneName2, project: root, createdAt: isoAt(deps.clock) };
  const held = { slot: null, leases: [], semaphores: [], lockKey: null };
  const awaitQuota = async () => {
    for (; ; ) {
      checkStop();
      const decision = holdDecision(readQuota(deps.home), config.quota.holdAbove, nowSec());
      if (!decision.hold) return;
      setState("held", { reason: decision.reason ?? "quota", ...decision.until === null ? {} : { until: decision.until } });
      const untilMs = decision.until === null ? Infinity : decision.until * 1e3 - deps.clock.now();
      await pause(Math.min(untilMs, deps.holdPollMs));
    }
  };
  let endState;
  let reason;
  try {
    setState("queued");
    const lane = loadLane(root, paths.laneFile);
    if (lane.name !== laneName2) throw new ArbabError("usage", `${paths.laneFile} names lane ${lane.name}, not ${laneName2}`);
    const role2 = effectiveRole(config, lane);
    const resumeText = mode.kind === "resume" ? resumePrompt(paths.laneDir, mode) : null;
    const seed = mode.kind === "fresh" && mode.digestFrom !== void 0 ? digestHeadStart(runsRoot, laneName2, mode.digestFrom) : null;
    for (; ; ) {
      checkStop();
      held.slot = acquireSlot(deps.home, config.maxParallel, holder, deps.alive);
      if (held.slot !== null) break;
      setState("held", { reason: NO_FREE_SLOT_REASON });
      await pause(deps.slotPollMs);
    }
    await awaitQuota();
    setState("preparing");
    const prepared = await prepare(root, config, lane, deps, holder, held, async (why) => {
      checkStop();
      setState("preparing", { reason: why });
      await pause(deps.slotPollMs);
    });
    let request = resumeText === null ? { kind: mode.kind } : { kind: "resume", prompt: resumeText };
    if (seed !== null) request.headStart = seed;
    if (prepared.merged.length > 0) request.merged = prepared.merged;
    let made = 0;
    for (; ; ) {
      checkStop();
      const attemptBegan = deps.clock.now();
      const outcome2 = await runAttempt(
        {
          projectRoot: root,
          runsRoot,
          config,
          lane,
          role: role2,
          fence: lane.fence ?? "strict",
          worktree: prepared.worktree,
          branch: prepared.branch,
          gitCommonDir: prepared.gitCommonDir,
          leases: held.leases,
          deps,
          stop,
          pause,
          onStarted: (n) => {
            attempt = n;
            setState("running");
          }
        },
        request
      );
      if (outcome2.n > 0) made += 1;
      checkStop();
      if (outcome2.state !== "usage-limit" || !role2.autoResume || made >= role2.maxAttempts) {
        endState = outcome2.state;
        break;
      }
      const resetsAt = usageLimitResetsAt(outcome2.rateLimit ?? readQuota(deps.home), nowSec());
      const jitter = Math.min(60, Math.max(0, deps.random() * 60));
      const until = Math.ceil(resumeAt(resetsAt, jitter));
      setState("waiting-reset", { reason: "usage limit", until });
      while (deps.clock.now() < until * 1e3) {
        checkStop();
        await pause(Math.min(until * 1e3 - deps.clock.now(), deps.holdPollMs));
        checkStop();
        if (resetSince(lastQuotaReset(deps.home), attemptBegan)) break;
      }
      await awaitQuota();
      request = { kind: "resume" };
    }
  } catch (err) {
    if (err instanceof Stopped || stop.aborted) {
      endState = "killed:stopped";
    } else {
      endState = "failed";
      reason = message2(err);
    }
  } finally {
    releaseAll(deps.home, held, holder);
  }
  if (stop.aborted) endState = "killed:stopped";
  setState("finished", { endState, ...reason === void 0 ? {} : { reason } });
  return endState;
}
async function prepare(root, config, lane, deps, holder, held, wait) {
  ensureIgnored(root, ignoreEntries2(root, config), deps.git);
  const owner = lane.worktree ?? lane.name;
  if (owner !== lane.name && !existsSync13(join24(confine(root, config.worktreeRoot), owner))) {
    throw new ArbabError("usage", `lane ${lane.name} works in lane ${owner}'s worktree, which does not exist`);
  }
  const base = lane.base ?? config.baseBranch;
  let trust = null;
  const trusted = () => trust ??= { projectRoot: root, baseBranch: config.baseBranch, confirmed: confirmedHeads(root, config, deps.git), git: deps.git };
  let plan = null;
  const planned = () => plan ??= installPlan(base, trusted());
  const worktreeInput = {
    projectRoot: root,
    root: config.worktreeRoot,
    lane: owner,
    base: () => planned().start,
    trustedBase: config.baseBranch,
    git: deps.git
  };
  const worktreeRoot = confine(root, config.worktreeRoot);
  mkdirSync3(worktreeRoot, { recursive: true });
  const worktree = join24(realpathSync7(worktreeRoot), owner);
  held.leases = await acquireLeases({
    home: deps.home,
    requests: lane.resources ?? {},
    ranges: config.resources,
    holder,
    alive: deps.alive,
    probePort: deps.probePort
  });
  for (const name2 of lane.semaphores ?? []) {
    if (!Object.hasOwn(config.semaphores, name2)) throw new ArbabError("config", `semaphore ${name2} is not configured`);
    const capacity = config.semaphores[name2];
    for (; ; ) {
      const slot = acquireSemaphore(deps.home, name2, capacity, holder, deps.alive);
      if (slot !== null) {
        held.semaphores.push({ name: name2, slot });
        break;
      }
      await wait(`waiting for semaphore ${name2}`);
    }
  }
  const key = writerLockKey(worktree);
  while (!acquireWriterLock(deps.home, key, holder, deps.alive)) await wait("waiting for the writer lock");
  held.lockKey = key;
  let wt = createWorktree(worktreeInput);
  if (realpathSync7(wt.path) !== worktree) throw new ArbabError("git", `${wt.path} is not the worktree ${worktree}`);
  let merged = [];
  const runsRoot = confine(root, config.runsRoot);
  const pristine = wt.created || !existsSync13(worktreeUsedFile(runsRoot, owner)) && listAttempts(runsRoot, owner).length === 0;
  if (pristine && owner !== lane.name) {
    throw new ArbabError("usage", `lane ${lane.name} works in lane ${owner}'s worktree, where no attempt has run yet; launch ${owner} first`);
  }
  if (pristine && !wt.created) {
    const sources = [config.baseBranch, base, ...lane.mergeBranches ?? []].flatMap((rev) => {
      try {
        return [resolveCommit(root, rev, deps.git)].filter((sha) => sha !== null);
      } catch {
        return [];
      }
    });
    discardWorktree({ projectRoot: root, root: config.worktreeRoot, lane: owner, sources, gitCommonDir: wt.gitCommonDir, git: deps.git });
    wt = createWorktree(worktreeInput);
    if (realpathSync7(wt.path) !== worktree) throw new ArbabError("git", `${wt.path} moved while it was built again`);
  }
  if (pristine) {
    const { merge } = planned();
    const installedAt = resolveCommit(root, `refs/heads/${wt.branch}`, deps.git);
    if (installedAt === null) throw new ArbabError("git", `cannot read branch ${wt.branch}`);
    if (!isTrustedInstallPoint(installedAt, trusted())) {
      throw new ArbabError(
        "git",
        `${worktree} is at ${installedAt}, which is neither on ${config.baseBranch} nor an integration head a human confirmed, so arbab will not install dependencies there. Remove the worktree and the branch ${wt.branch}, then launch ${lane.name} again`
      );
    }
    const dependencies2 = prepareDependencies(config.dependencies, worktree, deps.runCommand);
    if (!dependencies2.ok) {
      const tail = dependencies2.output.trim().split("\n").slice(-5).join("\n");
      throw new ArbabError("runtime", `dependencies failed (${dependencies2.code}): ${tail}`);
    }
    const branches = [...merge === null ? [] : [{ branch: base, sha: merge }], ...lane.mergeBranches ?? []];
    if (branches.length > 0) {
      merged = mergeBranches({ worktree, branch: wt.branch, gitCommonDir: wt.gitCommonDir, lane: lane.name, branches, git: deps.git });
    }
  }
  mkdirSync3(join24(worktree, ".arbab-tmp", "xdg-config"), { recursive: true });
  return { worktree, branch: wt.branch, gitCommonDir: wt.gitCommonDir, merged };
}

// src/shepherd/index.ts
function defaultDeps() {
  const home = homedir();
  const pathEnv = process.env["PATH"] ?? "";
  const pnpm = findOnPath("pnpm", pathEnv, pathExists);
  const explicit = process.env["ARBAB_CLAUDE"];
  return {
    home: join25(home, ".arbab"),
    claudeHome: join25(home, ".claude"),
    clock: systemClock,
    sleep,
    random: Math.random,
    hostEnv: { ...process.env },
    nodeDir: dirname5(process.execPath),
    pnpmDir: pnpm === null ? void 0 : dirname5(pnpm),
    git: nodeGit,
    runCommand: runArgv,
    spawnImpl: spawn2,
    readPs: () => readPs(),
    signal: sendSignal,
    alive: isAlive,
    probePort: isPortFree,
    explicitClaude: explicit === void 0 || explicit === "" ? null : explicit,
    pathEnv,
    run: runVersion,
    exists: pathExists,
    realpath,
    tickMs: 1e4,
    holdPollMs: 6e4,
    slotPollMs: 15e3,
    reapGraceMs: 1e4
  };
}

// src/commands/resume.ts
var MAX_PROMPT_BYTES = 64 * 1024;
function readPrompt(project, file) {
  let path;
  try {
    path = realpathSync8(confine(project.root, file));
  } catch (err) {
    if (err instanceof ArbabError) throw err;
    throw new ArbabError("usage", `cannot read prompt ${file}: ${err.message}`, { cause: err });
  }
  confine(realpathSync8(project.root), path);
  const text2 = readText(path);
  if (text2 === null) throw new ArbabError("usage", `cannot read prompt ${file}: no such file`);
  if (text2.trim() === "") throw new ArbabError("usage", `prompt ${file} is empty`);
  if (Buffer.byteLength(text2) > MAX_PROMPT_BYTES) {
    throw new ArbabError("usage", `prompt ${file} is over ${MAX_PROMPT_BYTES} bytes; point the worker at a file instead`);
  }
  return text2;
}
function writeResumePrompt(project, lane, text2) {
  const laneDir = runPaths(project.runsRoot, lane).laneDir;
  for (let n = (listAttempts(project.runsRoot, lane).at(-1) ?? 0) + 1; ; n++) {
    const path = join26(laneDir, `resume-prompt-${n}.md`);
    if (createExclusive(path, text2)) return path;
  }
}
function latestSession(project, lane) {
  const attempt = listAttempts(project.runsRoot, lane).at(-1);
  if (attempt === void 0) throw new ArbabError("usage", `lane ${lane} has no attempt to resume`);
  const record2 = readAttempt(runPaths(project.runsRoot, lane).attemptDir(attempt));
  const id = record2.started?.sessionId ?? record2.summary?.sessionId ?? null;
  if (typeof id !== "string" || id === "") {
    throw new ArbabError("usage", `lane ${lane} attempt ${attempt} has no session id; launch it again instead`);
  }
  return id;
}
function assertResumable(ctx, project, lane) {
  assertNotGenerated(project.runsRoot, lane);
  const spec = readJson(runPaths(project.runsRoot, lane).laneFile);
  const worktree = typeof spec === "object" && spec !== null ? spec.worktree : void 0;
  if (typeof worktree === "string" && worktree !== lane) assertNotGeneratedWorktree(project.runsRoot, lane, worktree);
  assertInactive(ctx, project, lane);
  assertNoLiveWorker(ctx, project, lane);
}
async function resumeWithDigest(ctx, project, lane) {
  const release = takeLaunchLock(ctx, project, lane, ctx.pid);
  try {
    assertResumable(ctx, project, lane);
    const attempt = listAttempts(project.runsRoot, lane).at(-1);
    if (attempt === void 0) throw new ArbabError("usage", `lane ${lane} has no attempt to seed a digest from; launch it instead`);
    digestHeadStart(project.runsRoot, lane, attempt);
    const shepherdPid2 = ctx.spawnShepherd(project.root, lane, { kind: "fresh", digestFrom: attempt });
    await awaitFirstState(ctx, project, lane, shepherdPid2);
    return { attempt, shepherdPid: shepherdPid2 };
  } finally {
    release();
  }
}
async function runResume(argv2, ctx) {
  const { values, positionals } = parse("resume", {
    args: argv2,
    options: { prompt: { type: "string" }, digest: { type: "boolean" }, json: { type: "boolean" } },
    allowPositionals: true
  });
  const lane = assertValidName(onePositional("resume", positionals, "lane"), "lane");
  if (values.digest === true && values.prompt !== void 0) {
    throw new ArbabError("usage", "resume takes --prompt or --digest, not both: a digest starts a fresh session with the lane's brief");
  }
  const project = openProject(ctx);
  const paths = runPaths(project.runsRoot, lane);
  if (!existsSync14(paths.laneFile)) throw new ArbabError("usage", `no runs for lane ${lane}`);
  if (values.digest === true) {
    const seeded = await resumeWithDigest(ctx, project, lane);
    if (values.json === true) {
      printJson(ctx, { lane, sessionId: null, shepherdPid: seeded.shepherdPid, prompt: "digest", digestFrom: seeded.attempt });
    } else {
      ctx.stdout(`resumed ${lane}  fresh session with the digest of attempt ${seeded.attempt}  shepherd ${seeded.shepherdPid}
`);
    }
    return 0;
  }
  const prompt = values.prompt === void 0 ? void 0 : readPrompt(project, values.prompt);
  const release = takeLaunchLock(ctx, project, lane, ctx.pid);
  let sessionId;
  let shepherdPid2;
  try {
    assertResumable(ctx, project, lane);
    sessionId = latestSession(project, lane);
    const mode = prompt === void 0 ? { kind: "resume" } : { kind: "resume", promptFile: writeResumePrompt(project, lane, prompt) };
    shepherdPid2 = ctx.spawnShepherd(project.root, lane, mode);
    await awaitFirstState(ctx, project, lane, shepherdPid2);
  } finally {
    release();
  }
  if (values.json === true) {
    printJson(ctx, { lane, sessionId, shepherdPid: shepherdPid2, prompt: prompt === void 0 ? "default" : "file" });
  } else {
    ctx.stdout(`resumed ${lane}  session ${sessionId}  shepherd ${shepherdPid2}
`);
  }
  return 0;
}

// src/commands/review.ts
var DEFAULT_TIMEOUT_MIN2 = 120;
function reviewLenses(option, configLenses) {
  const known = lensNames(configLenses);
  if (option === void 0) return known;
  const lenses2 = [...new Set(splitList(option))];
  if (lenses2.length === 0) throw new ArbabError("usage", "--lenses names no lens");
  for (const lens of lenses2) {
    if (lensText(lens, configLenses) === null) throw new ArbabError("usage", `unknown lens ${lens} (known: ${known.join(", ")})`);
  }
  return lenses2;
}
var VERDICT_ORDER = ["confirmed", "refuted", "unverified"];
function formatFindings(findings) {
  const lines = [];
  for (const verdict of VERDICT_ORDER) {
    const group = findings.filter((f) => f.verdict === verdict);
    lines.push(`${verdict} (${group.length})`);
    for (const f of group) {
      const where = f.line === void 0 ? f.file : `${f.file}:${f.line}`;
      lines.push(`  ${f.id}  ${f.severity}  ${where}  ${f.title.replace(/\s+/g, " ")}`);
    }
  }
  return lines.join("\n") + "\n";
}
function applyLensVerdicts(findings, lens, report) {
  const judged = new Map(applyVerdicts(findings.filter((f) => f.lens === lens), report).map((f) => [f.id, f]));
  return findings.map((f) => f.lens === lens ? judged.get(f.id) ?? f : f);
}
function formatReview(record2) {
  const lanes = [
    ...record2.lenses.map((l) => `${l.lens}  review   ${l.lane}  ${l.endState ?? "unfinished"}  ${l.pathsChecked} paths`),
    ...record2.skeptics.map((s) => `${s.lens}  skeptic  ${s.lane}  ${s.endState ?? "unfinished"}`)
  ];
  return `${lanes.join("\n")}
${formatFindings(record2.findings)}`;
}
async function runReview(argv2, ctx) {
  const { values, positionals } = parse("review", {
    args: argv2,
    options: { lenses: { type: "string" }, "timeout-min": { type: "string" }, json: { type: "boolean" } },
    allowPositionals: true
  });
  const name2 = assertValidName(onePositional("review", positionals, "name"), "integration");
  const timeoutMs = parseTimeoutMin(values["timeout-min"] ?? String(DEFAULT_TIMEOUT_MIN2));
  const project = openProject(ctx);
  const configLenses = project.config.review.lenses;
  const lenses2 = reviewLenses(values.lenses, configLenses);
  const integration = openIntegration(project, name2);
  const owner = generationOwner(integration);
  const { record: rec, paths } = integration;
  assertReviewLaneNames(paths.name, lenses2);
  const start = generatedBase(rec);
  assertRecordedHead(ctx.git, project, integration);
  const reviewers = lenses2.map((lens) => {
    const lane = reviewLane({ paths, lens, text: lensText(lens, configLenses) ?? "", diffBase: rec.baseSha, ...start });
    return { lens, lane: lane.spec.name, file: writeGeneratedLane(project, paths, lane) };
  });
  lintGeneratedLanes(ctx, project, reviewers.map((r) => r.file));
  const reviewed = await runGeneratedLanes(ctx, project, reviewers, timeoutMs, owner);
  if (reviewed.timedOut) {
    if (values.json === true) printJson(ctx, { timedOut: true, review: null });
    else ctx.stderr(`arbab review: the reviewer lanes did not finish in time; they keep running
`);
    return WAIT_TIMEOUT_EXIT;
  }
  const outcomeOf = (outcomes, lane) => outcomes.find((o) => o.lane === lane);
  let findings = collectFindings(reviewers.map((r) => ({ lens: r.lens, report: outcomeOf(reviewed.outcomes, r.lane)?.report ?? null })));
  const lensEntries = reviewers.map((r) => {
    const outcome2 = outcomeOf(reviewed.outcomes, r.lane);
    return { lens: r.lens, lane: r.lane, endState: outcome2?.endState ?? null, ...reviewerCoverage(outcome2?.report ?? null) };
  });
  const skeptics = lenses2.filter((lens) => skepticFindings(lens, findings).length > 0).map((lens) => {
    const lane = skepticLane({ paths, lens, findings, diffBase: rec.baseSha, ...start });
    return { lens, lane: lane.spec.name, file: writeGeneratedLane(project, paths, lane) };
  });
  let skepticEntries = [];
  let skepticsTimedOut = false;
  if (skeptics.length > 0) {
    lintGeneratedLanes(ctx, project, skeptics.map((s) => s.file));
    const checked = await runGeneratedLanes(ctx, project, skeptics, timeoutMs, owner);
    skepticsTimedOut = checked.timedOut;
    skepticEntries = skeptics.map((s) => ({ lens: s.lens, lane: s.lane, endState: outcomeOf(checked.outcomes, s.lane)?.endState ?? null }));
    for (const s of skeptics) {
      const report = outcomeOf(checked.outcomes, s.lane)?.report;
      if (report !== void 0 && report !== null) findings = applyLensVerdicts(findings, s.lens, report);
    }
  }
  const record2 = reviewRecord({ name: name2, headSha: rec.headSha, lenses: lensEntries, skeptics: skepticEntries, findings, now: ctx.clock.now() });
  writeJsonAtomic(paths.review, record2);
  if (values.json === true) printJson(ctx, { timedOut: skepticsTimedOut, review: record2 });
  else ctx.stdout(formatReview(record2));
  if (skepticsTimedOut) {
    if (values.json !== true) ctx.stderr("arbab review: the skeptic lanes did not finish in time; their findings stay unverified\n");
    return WAIT_TIMEOUT_EXIT;
  }
  const allSucceeded = [...lensEntries, ...skepticEntries].every((entry) => entry.endState === "success");
  return allSucceeded ? 0 : 1;
}

// src/commands/shepherd.ts
import { isAbsolute as isAbsolute10 } from "node:path";
function parseMode(text2) {
  let value;
  try {
    value = JSON.parse(text2);
  } catch {
    throw new ArbabError("usage", `shepherd mode ${JSON.stringify(text2)} is not JSON`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ArbabError("usage", "shepherd mode must be an object");
  const { kind, prompt, promptFile, digestFrom } = value;
  if (kind === "start") return { kind };
  if (kind === "fresh") {
    if (digestFrom === void 0) return { kind };
    if (Number.isSafeInteger(digestFrom) && digestFrom >= 1) return { kind, digestFrom };
    throw new ArbabError("usage", "shepherd mode digestFrom must be a positive integer");
  }
  if (kind === "resume") {
    if (prompt !== void 0 && promptFile !== void 0) throw new ArbabError("usage", "shepherd mode takes prompt or promptFile, not both");
    if (promptFile !== void 0) {
      if (typeof promptFile === "string" && isAbsolute10(promptFile)) return { kind, promptFile };
      throw new ArbabError("usage", "shepherd mode promptFile must be an absolute path");
    }
    if (prompt === void 0) return { kind };
    if (typeof prompt === "string" && prompt.trim() !== "") return { kind, prompt };
    throw new ArbabError("usage", "shepherd mode prompt must be a non-empty string");
  }
  throw new ArbabError("usage", `shepherd mode kind ${JSON.stringify(kind)} must be start, resume or fresh`);
}
async function runShepherdProcess(argv2, ctx) {
  const [root, lane, modeText, ...rest] = argv2;
  if (root === void 0 || lane === void 0 || modeText === void 0 || rest.length > 0) {
    throw new ArbabError("usage", "usage: arbab __shepherd <root> <lane> <mode-json>");
  }
  if (!isAbsolute10(root)) throw new ArbabError("usage", `project root ${root} must be absolute`);
  assertValidName(lane, "lane");
  const mode = parseMode(modeText);
  const controller = new AbortController();
  const untrap = ctx.trapSignals(() => controller.abort());
  try {
    const end = await ctx.runShepherd(root, lane, mode, ctx.shepherdDeps(), controller.signal);
    ctx.stdout(`${lane}: ${end}
`);
    return 0;
  } finally {
    untrap();
  }
}

// src/commands/status.ts
import { existsSync as existsSync15 } from "node:fs";
function laneRole(runsRoot, lane) {
  const spec = readJson(runPaths(runsRoot, lane).laneFile);
  const role2 = typeof spec === "object" && spec !== null ? spec.role : void 0;
  return ROLES.includes(role2) ? role2 : "implementer";
}
function liveSummary(runsRoot, lane, attempt, record2, nowMs) {
  const dir = runPaths(runsRoot, lane).attemptDir(attempt);
  const { events, unparsedLines } = parseStream(readText(attemptFiles(dir).stream) ?? "");
  const observedAt = new Date(nowMs).toISOString();
  let previousCostUsd = null;
  if (record2.started?.resume === true && attempt > 1) {
    previousCostUsd = readAttempt(runPaths(runsRoot, lane).attemptDir(attempt - 1)).summary?.costUsd ?? null;
  }
  return buildAttemptSummary({
    lane,
    attempt,
    role: laneRole(runsRoot, lane),
    state: "running",
    started: record2.started,
    exit: null,
    digest: digestStream(events, observedAt, unparsedLines),
    requestedEffort: null,
    measuredEffort: null,
    previousCostUsd,
    registration: null,
    reportValid: null,
    reportErrors: [],
    nowMs
  });
}
function laneStatus(project, lane, alive, nowMs) {
  const record2 = readState(project.runsRoot, lane);
  if (record2 === null) return null;
  const effective = { ...record2, state: effectiveState(record2, alive) };
  let summary = null;
  if (record2.attempt >= 1) {
    const dir = runPaths(project.runsRoot, lane).attemptDir(record2.attempt);
    if (existsSync15(dir)) {
      const attempt = readAttempt(dir);
      summary = attempt.summary;
      if (summary === null && effective.state === "running" && attempt.started !== null) {
        summary = liveSummary(project.runsRoot, lane, record2.attempt, attempt, nowMs);
      }
    }
  }
  return statusRow(effective, summary, nowMs);
}
async function runStatus(argv2, ctx) {
  const { values, positionals } = parse("status", {
    args: argv2,
    options: { json: { type: "boolean" } },
    allowPositionals: true
  });
  const project = openProject(ctx);
  const named = positionals.length > 0;
  for (const lane of positionals) {
    assertValidName(lane, "lane");
    if (!existsSync15(runPaths(project.runsRoot, lane).laneDir)) throw new ArbabError("usage", `no runs for lane ${lane}`);
  }
  const nowMs = ctx.clock.now();
  const rows = [];
  for (const lane of named ? positionals : listLanes(project.runsRoot)) {
    const row = laneStatus(project, lane, ctx.alive, nowMs);
    if (row !== null) rows.push(row);
    else if (named) ctx.stderr(`${lane}: no state yet (the shepherd is starting)
`);
  }
  const snapshot = readQuota(ctx.home);
  const nowSec = Math.floor(nowMs / 1e3);
  if (values.json === true) {
    printJson(ctx, { lanes: rows, quota: { snapshot, hold: holdDecision(snapshot, project.config.quota.holdAbove, nowSec) } });
  } else {
    ctx.stdout((rows.length > 0 ? formatStatusTable(rows, nowSec) : "no lanes") + "\n");
    ctx.stdout(`quota: ${formatQuota(snapshot, nowSec)}
`);
  }
  return 0;
}

// src/commands/stop.ts
function isShepherdOf(command, lane) {
  if (command === null) return false;
  const words = command.split(/\s+/);
  return words.includes("__shepherd") && words.includes(lane);
}
function shepherdPid(file) {
  const value = readJson(file);
  const pid = typeof value === "object" && value !== null ? value.pid : void 0;
  return Number.isInteger(pid) && pid > 1 ? pid : null;
}
async function runStop(argv2, ctx) {
  const { values, positionals } = parse("stop", {
    args: argv2,
    options: { json: { type: "boolean" } },
    allowPositionals: true
  });
  const lane = assertValidName(onePositional("stop", positionals, "lane"), "lane");
  const project = openProject(ctx);
  const paths = runPaths(project.runsRoot, lane);
  const state = readState(project.runsRoot, lane);
  if (state?.state === "finished") throw new ArbabError("usage", `lane ${lane} is not running (finished)`);
  const pid = shepherdPid(paths.shepherdFile);
  if (pid === null || !ctx.alive(pid)) throw new ArbabError("usage", `lane ${lane} is not running`);
  if (!isShepherdOf(ctx.processCommand(pid), lane)) {
    throw new ArbabError("usage", `lane ${lane} is not running: pid ${pid} is no longer its shepherd; nothing signalled`);
  }
  ctx.signal(pid, "SIGTERM");
  if (values.json === true) printJson(ctx, { lane, shepherdPid: pid });
  else ctx.stdout(`stopping ${lane} (shepherd ${pid})
`);
  return 0;
}

// src/commands/ui.ts
import { randomBytes as randomBytes4 } from "node:crypto";
import { basename as basename2 } from "node:path";

// src/ui/client/app/bundle.ts
var UI_SCRIPT = '"use strict";(()=>{var ra=Object.defineProperty;var sa=(e,t,n)=>t in e?ra(e,t,{enumerable:!0,configurable:!0,writable:!0,value:n}):e[t]=n;var gt=(e,t,n)=>sa(e,typeof t!="symbol"?t+"":t,n);var nt={page:"/",script:"/app.js",style:"/app.css",events:"/events",snapshot:"/snapshot.json",icon:"/icon.svg"},wo="token",ko={snapshot:"snapshot",problem:"problem"};var T={spawn:{x:-16,y:248},exit:{x:-16,y:258},camp:{x:22,y:204},arbab:{x:116,y:262},audience:{x:144,y:260},rations:{x:86,y:262},treasury:{x:62,y:264},well:{x:444,y:206},horizon:{x:496,y:196},sledge:{x:402,y:208}},Qe={columns:5,rows:2,step:12,rowStep:16},K={centerX:268,baseY:208,maxWidth:228,maxHeight:104},fe={w:12,h:18},So={w:16,h:26};function ia(e){let t=4;for(;t*(t+1)/2<e;)t+=1;return t}function Eo(e){let t=ia(Math.max(0,Math.floor(e))),{centerX:n,baseY:o,maxWidth:r,maxHeight:s}=K,i=Math.min(32,Math.floor(r/t));i-=i%2;let a=Math.min(i/2,Math.floor(s/t));i=Math.min(i,2*a);let l=[];for(let c=0;c<t;c+=1){let u=t-c,f=n-u*i/2,m=o-(c+1)*a;for(let h=0;h<u;h+=1)l.push({x:f+h*i,y:m,w:i,h:a,course:c})}return{base:t,blockW:i,blockH:a,slots:l,apex:{x:n,y:o-t*a}}}function kr(e){let t=Qe.columns*Qe.rows,n=(Math.floor(e)%t+t)%t,o=Math.floor(n/Qe.columns),r=n%Qe.columns;return{x:T.camp.x+r*Qe.step+o*Qe.step/2,y:T.camp.y+o*Qe.rowStep}}var vo=[152,108,64];function Sr(e,t){let n=vo[Math.min(vo.length-1,Math.max(0,Math.floor(e)))]??vo[0],o=Math.min(22,Math.max(8,Math.round(8+.6*t)));return{x:n,y:128,height:o}}function An(e){return{x:e.x+e.w/2,y:e.y+e.h}}var aa=600*1e3,No=K.baseY,Je=No+2,vr=28,la=18,Ln=16,Nn=.8,Co=3,Er=.15,ca=1.2,Cr=.4,ua=6,da=.2,fa=2,pa=.6,ma=1,ha=300,Mr=300,ga=60,ba=48,ya=4,xa=3,wa=2,ka=20,Sa=100,va=12,Ea=6,Ca=5,Ma=18e3,Aa=1.5,La=2,Na=3,Ta=6,Ra=4,Ar=.25,Pa=.5,Ba=new Set(["walk","slump","carry-scroll","carry-stone","carry-ration"]);function Tn(e){switch(e.kind){case"verify":return"surveyor";case"review":return"scribe";case"skeptic":return"skeptic";case"preflight":return"waterboy"}switch(e.role){case"implementer":return"laborer";case"verifier":return"mason";case"reviewer":return"scribe";case"probe":return"waterboy";case"researcher":return"scout";default:return"waterboy"}}function Lo(e){return e.kind==="lane"&&(e.role==="implementer"||e.role==="verifier"&&e.worktreeOf===null)}function Kt(e){if(e===null)return-1/0;let t=Date.parse(e);return Number.isFinite(t)?t:-1/0}function Oa(e,t){let n=null,o=-1/0;for(let r of e){let s=t(r);(n===null||s>=o)&&(n=r,o=s)}return n}function Fa(e){let t=Kt(e.now),n=e.integrations.map((u,f)=>({integration:u,index:f,at:Kt(u.landedAt)})).filter(u=>u.integration.landedAt!==null).sort((u,f)=>u.at===f.at?f.index-u.index:f.at>u.at?1:-1).map(u=>u.integration),o=new Set(n.filter(u=>Number.isFinite(t)&&t-Kt(u.landedAt)<aa)),r=n.find(u=>o.has(u))??null,s=new Map(e.integrations.map(u=>[u.name,u])),i=e.lanes.filter(u=>{if(!Lo(u))return!1;if(u.integration===null)return!0;let f=s.get(u.integration);return f===void 0?!1:f.landedAt===null||o.has(f)}),a=r;if(a===null){let u=new Set(i.map(m=>m.name)),f=e.integrations.filter(m=>m.landedAt===null&&m.lanes.some(h=>u.has(h)));a=Oa(f,m=>Kt(m.updatedAt))}let l=i.length===0&&r===null?n[0]??null:null,c=n.filter(u=>!o.has(u)&&u!==l).slice(0,3);return{lanes:i,capstone:a,capstoneLanded:r!==null,monument:l,far:c}}function To(e){let t=Number.isFinite(e)?Math.max(0,e):0;return Math.min(.95,1-Math.exp(-t/40))}function Ia(e){let t=e.costDeltaUsd??e.costUsd??0,n=Number.isFinite(t)?t:0;return n<1?1:n<5?2:3}function Da(e){return e.reportStatus==="partial"?1:e.reportStatus==="blocked"?0:e.endState==="success"?Ia(e):0}function Ua(e){switch(e.state){case"running":return"building";case"waiting-reset":return"stalled";case"orphaned":return"orphaned";case"finished":return e.reportStatus==="partial"||e.reportStatus==="blocked"?"stalled":e.endState==="success"?"set":"fallen";default:return"planned"}}function $a(e){return typeof e.costUsd=="number"&&Number.isFinite(e.costUsd)?Math.max(0,e.costUsd):0}function _a(e){return e<.5?2*e*e:1-(-2*e+2)**2/2}function Le(e,t,n={}){return{kind:"go",to:e,pose:t,...n}}function Ce(e,t,n={}){return{kind:"hold",pose:e,time:t,...n}}function ot(e,t){e.pose!==t&&(e.pose=t,e.poseTime=0)}function Mo(e){let t=K.maxWidth/2;return e.y<No&&e.x>=K.centerX-t&&e.x<=K.centerX+t}function Ga(e,t){return e.x===t.x&&e.y===t.y}function Lr(e,t,n,o){return{id:e,lane:t,cast:n,x:o.x,y:o.y,facing:1,pose:"idle",poseTime:0,stroke:0,ration:0,icon:null,bubble:null,alpha:1,ghost:!1,highlight:!1}}function Ao(e){return{lane:null,x:e.x,y:e.y,w:e.w,h:e.h,look:"empty",fill:0,flash:0,highlight:!1}}function Ro(e){let t=e.reducedMotion,n=e.random,o=Lr("arbab",null,"arbab",T.arbab),r=Eo(0),s={sky:{phase:"day",sun:.5},pyramid:{base:r.base,blockW:r.blockW,blockH:r.blockH,blocks:r.slots.map(Ao),rubble:0,apex:{...r.apex},capstone:{state:"none",integration:null,...T.sledge,flag:"none",ready:!1,glow:0},monument:null},far:[],actors:[o],particles:[],coins:0,events:[],reducedMotion:t,time:0,shake:0},i=new Map,a=new Map,l=new Map,c=[],u=null,f=new Map,m=new Map,h=!1,w=0,y=null,x=0,S=0,v=null,E=!1,M=()=>Math.floor(n()*2147483647),U=(d,p)=>{s.events.push({kind:d,lane:p})},$=()=>({x:K.centerX,y:Je}),_=()=>r.base*r.blockW/2,G=(d,p)=>{let b=K.centerX-_();return Math.round(b+(d+(p-d)*n())*2*_())};function Y(d){if(d.builder){let p=f.get(d.lane.name);return p?An(p):$()}switch(d.actor.cast){case"mason":{let p=d.lane.worktreeOf===null?void 0:f.get(d.lane.worktreeOf);if(!p)return $();let b=An(p);return{x:b.x+Ca,y:b.y}}case"surveyor":return{x:T.sledge.x-14,y:Je};default:return null}}function Oe(){let d=r.slots.filter(b=>b.course<2),p=d[Math.min(d.length-1,Math.floor(n()*d.length))];return p?An(p):$()}function Fe(d){switch(d.actor.cast){case"scribe":case"skeptic":return Oe();case"waterboy":return{...T.well};default:return{x:G(.5,1),y:Je}}}let ve=d=>d.x<0||d.x>480;function Ie(d,p){if(p!=="work")return p;let b=Y(d)??$();return d.spot=b,b}function de(d,p,b){let g=b==="slump"?la:vr,k=b==="carry-stone"?"climb-stone":"climb",C=[],P=Mo(d),D=Mo(p);return P&&D&&d.x===p.x?[{kind:"move",x:p.x,y:p.y,pose:p.y<d.y?k:"climb",speed:Ln}]:(P&&C.push({kind:"move",x:d.x,y:Je,pose:"climb",speed:Ln}),D?(C.push({kind:"move",x:p.x,y:Je,pose:b,speed:g}),C.push({kind:"move",x:p.x,y:p.y,pose:k,speed:Ln})):C.push({kind:"move",x:p.x,y:p.y,pose:b,speed:g}),C)}function ze(d){if(d.seat!==null)return d.seat;let p=new Set;for(let g of i.values())g.seat!==null&&p.add(g.seat);let b=0;for(;p.has(b);)b+=1;return d.seat=b,b}function De(d){let p=c.indexOf(d);p>=0&&c.splice(p,1),u?.crew===d&&(u=null,o.bubble=null,d.actor.bubble=null)}function be(d){De(d),d.seat=null,i.get(d.lane.name)===d&&i.delete(d.lane.name),E=!0}function me(d,p,b,g,k,C){if(t)return;let P={kind:d,x:p,y:b,vx:g,vy:k,life:C};s.particles.push(P),s.particles.length>Mr&&s.particles.splice(0,s.particles.length-Mr)}let ae=d=>{s.pyramid.rubble=Math.min(ga,s.pyramid.rubble+d)};function Ee(d){De(d);let p=d.lane,b=d.actor;switch(p.state!=="queued"&&p.state!=="held"&&(d.seat=null),d.queue=[],d.loop=!1,d.spot=null,d.begun=!1,d.elapsed=0,d.chatIn=null,d.chatLeft=0,d.descending=!1,b.alpha=1,b.stroke=0,b.bubble=null,p.state){case"queued":case"held":{let g=p.state==="held"?{icon:p.hold==="slot"?"dots":"hourglass"}:{};d.queue.push(Le(kr(ze(d)),"walk"),Ce("sit",1/0,g));break}case"preparing":case"running":d.briefed||d.queue.push({kind:"talk",event:"brief"}),Y(d)!==null?d.queue.push(Le("work",d.builder?"carry-stone":"walk"),Ce("work",1/0,{faceCenter:!0})):d.loop=!0;break;case"waiting-reset":{let g=Y(d)!==null?"work":d.briefed&&!ve(b)?{x:b.x,y:b.y}:Fe(d);d.queue.push(Le(g,"walk"),Ce("sleep",1/0,{icon:"zzz",faceCenter:!0}));break}case"finished":{let g=Da(p);d.queue.push({kind:"talk",event:"report"},Le({...T.rations},"walk"),Ce("idle",pa),Le({...T.exit},g>0?"carry-ration":"slump",{ration:g}),{kind:"exit"});break}case"orphaned":ve(b)&&d.queue.push(Le(Y(d)!==null?"work":Fe(d),"walk")),d.queue.push(Ce("idle",1/0,{ghost:!0,icon:"question"}));break;default:d.queue.push(Ce("idle",1/0))}We(d,0)}function ft(d){switch(d.actor.cast){case"scribe":case"skeptic":return[Le(Oe(),"walk"),Ce("work",3+3*n(),{faceCenter:!0})];case"waterboy":return[Le({...T.well},"walk"),Ce("idle",1),Le({x:G(0,1),y:Je},"walk"),Ce("idle",1)];case"scout":{let p=6+4*n();return[Le({...T.horizon},"walk"),Ce("idle",p,{alpha:0}),Le({x:G(.5,1),y:Je},"walk",{alpha:1}),Ce("idle",2)]}default:return[Ce("idle",1/0)]}}function Ue(d){d.queue.shift(),d.begun=!1,d.elapsed=0}function $t(d,p){let b=d.actor;if(b.bubble=null,b.stroke=0,d.chatLeft=0,p.kind==="go"){let g=Ie(d,p.to);return p.alpha!==void 0&&(b.alpha=p.alpha),p.ration!==void 0&&(b.ration=p.ration),d.queue.splice(0,1,...de(b,g,p.pose)),!0}return b.icon=p.kind==="hold"?p.icon??null:null,b.ghost=p.kind==="hold"&&p.ghost===!0,p.kind==="hold"&&(ot(b,p.pose),p.alpha!==void 0&&(b.alpha=p.alpha),p.faceCenter&&(b.facing=b.x<=K.centerX?1:-1)),!1}function _t(d,p,b,g,k){let C=p.x-d.x,P=p.y-d.y,D=Math.hypot(C,P);return D===0?k:(C!==0&&(d.facing=C>0?1:-1),ot(d,b),t||g*k>=D?(d.x=p.x,d.y=p.y,t?k:Math.max(0,k-D/g)):(d.x+=C/D*g*k,d.y+=P/D*g*k,-1))}function We(d,p){let b=d.actor,g=p;for(let k=0;k<64;k+=1){if(i.get(d.lane.name)!==d)return;if(d.queue.length===0){if(!d.loop){ot(b,"idle");return}d.queue=ft(d),d.begun=!1}let C=d.queue[0];if(C===void 0)return;if(!d.begun&&(d.begun=!0,d.elapsed=0,$t(d,C))){d.begun=!1;continue}switch(C.kind){case"go":continue;case"move":if(g=_t(b,C,C.pose,C.speed,g),g<0)return;Ue(d);continue;case"hold":{let P=Math.min(g,C.time-d.elapsed);if(d.elapsed+=P,g-=P,C.pose==="work"&&xo(d,P),d.elapsed<C.time)return;Ue(d);continue}case"talk":if(g=yo(d,C.event,g),g<0)return;Ue(d);continue;case"exit":be(d);return}}}function yo(d,p,b){let g=d.actor,k=b;if(c.includes(d)||c.push(d),u?.crew!==d){let ht=c.indexOf(d);if(ht>Ea)return g.pose!=="sit"&&ot(g,"idle"),-1;if(Mo(g)&&(d.descending=!0),d.descending){if(k=_t(g,{x:g.x,y:Je},"climb",Ln,k),k<0)return-1;d.descending=!1}let Mn={x:T.audience.x+va*ht,y:T.audience.y};if(k=_t(g,Mn,"walk",vr,k),k<0)return-1;if(g.facing=-1,ht!==0||u!==null)return ot(g,"idle"),-1;u={crew:d,t:0,turn:-1}}let C=u;C.t+=k;let P=Math.min(Co-1,Math.floor(C.t/Nn));for(;C.turn<P;){C.turn+=1;let ht=C.turn===1,Mn={seed:M(),open:0};g.bubble=ht?Mn:null,o.bubble=ht?null:Mn}let D=C.turn===1?g:o;if(D.bubble&&(D.bubble.open=t?1:Math.min(1,(C.t-C.turn*Nn)/Er)),ot(g,C.turn===1?"talk":"idle"),g.facing=-1,C.t<Co*Nn)return-1;let Xe=C.t-Co*Nn;u=null,o.bubble=null,g.bubble=null;let wr=c.indexOf(d);return wr>=0&&c.splice(wr,1),p==="brief"&&(d.briefed=!0),U(p,d.lane.name),Xe}function xo(d,p){let b=d.actor,g=p;for(;g>0&&d.pending>0;){let k=b.stroke,C=(1-k)*Cr;g>=C?(b.stroke=1,g-=C):(b.stroke=k+g/Cr,g=0),k<.5&&b.stroke>=.5&&bn(d),b.stroke>=1&&(b.stroke=0,d.pending-=1)}b.cast==="skeptic"&&yn(d,p)}function bn(d){if(!d.builder)return;let p=d.lane.name,b=a.get(p);if(!b||!f.has(p))return;let g=l.get(p)??0,k=t?g:b.fill+Math.max(.02,(g-b.fill)/Math.max(1,d.pending));if(b.fill=Math.max(b.fill,Math.min(g,k)),b.flash=1,!t){let C=3+Math.floor(n()*3);for(let P=0;P<C;P+=1){let D=b.x+n()*b.w,Xe=b.y+n()*b.h;me("dust",D,Xe,(n()-.5)*16,-(10+20*n()),.5)}}U("stone",p)}function yn(d,p){let b=d.actor;if(d.chatLeft>0){d.chatLeft-=p,b.bubble&&(b.bubble.open=t?1:Math.min(1,b.bubble.open+p/Er)),d.chatLeft<=0&&(b.bubble=null,d.chatIn=4+4*n());return}d.chatIn===null&&(d.chatIn=4+4*n()),d.chatIn-=p,d.chatIn<=0&&(b.bubble={seed:M(),open:t?1:0},d.chatLeft=ca)}function je(d){let p=Math.round(d.fill*8);if(t)ae(p);else{for(let b=0;b<p;b+=1){let g=d.x+n()*d.w,k=d.y+n()*d.h;me("stone",g,k,(n()*2-1)*40,0,5)}s.shake=Math.max(s.shake,La)}d.fill=0,U("fall",d.lane)}function Gt(d,p,b){let g=d.name,k=Ua(d),C=To(d.toolCalls);l.set(g,C);let P=f.get(g),D=a.get(g),Xe=D===void 0;if(D===void 0&&(D={lane:g,x:0,y:0,w:0,h:0,look:k,fill:0,flash:0,highlight:!1},a.set(g,D)),P&&Object.assign(D,{x:P.x,y:P.y,w:P.w,h:P.h}),Xe||p===void 0){D.look=k,D.flash=0,k==="set"?D.fill=1:k==="planned"||k==="fallen"||!b&&k==="building"?D.fill=0:D.fill=C,b&&k==="fallen"&&ae(ya);return}p.state==="finished"&&d.state!=="finished"&&(D.fill=0,D.flash=0),k!==D.look&&P&&(k==="set"?(D.fill=1,D.flash=1,U("set",g)):k==="fallen"&&je(D)),D.look=k,t&&k==="building"&&(D.fill=Math.max(D.fill,C))}function Ht(d){let p={actor:Lr(d.name,d.name,Tn(d),T.spawn),lane:d,builder:Lo(d),queue:[],begun:!1,elapsed:0,loop:!1,briefed:!1,pending:0,spot:null,seat:null,fading:!1,descending:!1,chatIn:null,chatLeft:0,dust:0};return i.set(d.name,p),E=!0,p}function Wt(d){let p=d.actor;for(let b=0;b<64;b+=1){if(d.queue.length===0){if(!d.loop)break;d.queue=ft(d),d.begun=!1}let g=d.queue[0];if(g===void 0)break;if(g.kind==="go"){let k=Ie(d,g.to);g.alpha!==void 0&&(p.alpha=g.alpha),p.x=k.x,p.y=k.y,Ue(d)}else if(g.kind==="move")p.x=g.x,p.y=g.y,Ue(d);else break}We(d,0)}function xn(d,p,b){let g=d.name,k=i.get(g);if(k?.fading&&(be(k),k=void 0),Lo(d)?Gt(d,p,b):(a.delete(g),l.delete(g)),b){if(d.state==="finished")return;let C=Ht(d);C.briefed=d.state!=="queued"&&d.state!=="held",Ee(C),Wt(C);return}if(k===void 0){if(d.state==="finished")return;k=Ht(d),Ee(k)}else k.lane=d,(p===void 0||p.state!==d.state||d.state==="held"&&p.hold!==d.hold)&&(p?.state==="finished"&&(k.briefed=!1,k.actor.ration=0),d.state!=="running"&&(k.pending=0),Ee(k));if(d.state==="running"){let C=p!==void 0&&p.attempt===d.attempt?p.toolCalls:0,P=d.toolCalls-C;P>0&&(k.pending=Math.min(ua,k.pending+P))}}function wn(d){let p=i.get(d);p&&!p.fading&&(De(p),p.seat=null,p.fading=!0,p.queue=[],p.loop=!1,p.pending=0,p.spot=null,p.actor.stroke=0,p.actor.bubble=null),a.delete(d),l.delete(d)}function et(d){let p=s.pyramid.capstone;p.integration=d.name,p.flag=d.verify==="passed"?"passed":d.verify==="failed"?"failed":"none",p.ready=d.ready===!0}function kn(){Object.assign(s.pyramid.capstone,{state:"hoisting",...T.sledge,glow:0}),w=0,mt()}function pt(d,p){let b=s.pyramid.capstone,g=d.capstone,k=b.state==="hoisting"||x>0;if(d.capstoneLanded&&g!==null&&k&&b.integration!==g.name){y=g;return}if(y=null,x=0,d.monument!==null){et(d.monument),Object.assign(b,{state:"set",...s.pyramid.apex,ready:!0,glow:0});return}if(g===null){Object.assign(b,{state:"none",integration:null,...T.sledge,flag:"none",ready:!1,glow:0});return}let C=b.integration===g.name;if(et(g),!d.capstoneLanded){Object.assign(b,{state:"waiting",...T.sledge,glow:0});return}if(!(C&&b.state==="hoisting")){if(C&&b.state==="set"){Object.assign(b,s.pyramid.apex);return}if(p){Object.assign(b,{state:"set",...s.pyramid.apex,glow:0});return}kn(),t&&Sn()}}function Sn(){let d=s.pyramid.capstone,p=s.pyramid.apex;Object.assign(d,{state:"set",...p,glow:1}),mt(),t||(s.shake=Math.max(s.shake,Na));for(let b=0;b<ka&&!t;b+=1){let g=p.x+(n()-.5)*8,k=p.y-n()*6;me("sparkle",g,k,(n()-.5)*12,-n()*10,.8)}U("capstone",d.integration),S=wa}function Ve(d){let p=Kt(d.now)/1e3,b=d.quota,g=P=>P!==null&&Number.isFinite(p)&&P.resetsAt>p?P:null,k=g(b.fiveHour),C=g(b.sevenDay);s.sky.phase=b.status==="rejected"&&(k!==null||C!==null)?"night":b.hold.hold?"dusk":"day",s.sky.sun=k!==null?Math.min(1,Math.max(0,1-(k.resetsAt-p)/Ma)):.5}function Yt(d,p){let b=d.lanes.reduce((k,C)=>k+$a(C),0),g=Math.min(ba,Math.round(6*Math.sqrt(b)));if(!p&&g>s.coins&&!t){let k=1+Math.floor(n()*3);for(let C=0;C<k;C+=1){let P=T.treasury.x+(n()-.5)*6;me("coin",P,T.treasury.y-8,(n()-.5)*20,-40,.6)}}s.coins=g}function vn(d){let p=s.pyramid;p.base=r.base,p.blockW=r.blockW,p.blockH=r.blockH,p.apex={...r.apex};let b=d.monument;if(p.monument=b===null?null:b.name,b!==null){p.blocks=r.slots.map((g,k)=>({...Ao(g),lane:b.lanes[k]??null,look:"set",fill:1}));return}p.blocks=r.slots.map((g,k)=>{let C=d.lanes[k],P=C===void 0?void 0:a.get(C.name);return P===void 0?Ao(g):(Object.assign(P,{x:g.x,y:g.y,w:g.w,h:g.h}),P)}),p.capstone.state==="set"&&Object.assign(p.capstone,p.apex)}function mt(){let d=s.pyramid.capstone.state==="set";for(let p of s.pyramid.blocks)p.lane===null&&(p.look=d?"set":"empty",p.fill=d?1:0)}function En(d){for(let p of[...i.values()]){if(p.fading||c.includes(p))continue;let b=Y(p);(p.spot!==null&&b!==null&&!Ga(p.spot,b)||d&&p.loop&&(p.lane.state==="running"||p.lane.state==="preparing"))&&Ee(p)}}function L(){if(E){E=!1,s.actors.length=0,s.actors.push(o);for(let d of i.values())s.actors.push(d.actor);I()}}function I(){for(let d of s.actors)d.highlight=v!==null&&d.lane===v;for(let d of s.pyramid.blocks)d.highlight=v!==null&&d.lane===v}function F(){o.x=T.arbab.x,o.y=T.arbab.y,o.facing=1,ot(o,S>0?"cheer":u!==null&&u.turn>=0&&u.turn!==1?"talk":"idle")}function Q(d){let p=!h;h=!0;let b=Fa(d);Ve(d);let g=r;r=Eo(b.monument===null?b.lanes.length:b.monument.lanes.length);let k=g.base!==r.base||g.blockW!==r.blockW||g.blockH!==r.blockH;f=new Map,b.lanes.forEach((P,D)=>{let Xe=r.slots[D];Xe&&f.set(P.name,Xe)}),s.pyramid.apex={...r.apex};let C=new Set(d.lanes.map(P=>P.name));for(let P of m.keys())C.has(P)||wn(P);for(let P of d.lanes)xn(P,m.get(P.name),p);vn(b),En(k),pt(b,p),mt(),s.far=b.far.map((P,D)=>({integration:P.name,...Sr(D,P.lanes.length)})),Yt(d,p),m=new Map(d.lanes.map(P=>[P.name,P])),E=!0,L(),F()}function re(d){let p=Math.min(Sa,Number.isFinite(d)?Math.max(0,d):0)/1e3;if(p<=0)return;s.time+=p,o.poseTime+=p,s.shake=Math.max(0,s.shake-Ta*p);let b=s.pyramid.capstone;b.glow=Math.max(0,b.glow-p/Ra);for(let g of a.values())g.flash=Math.max(0,g.flash-fa*p);for(let g of[...i.values()]){if(g.actor.poseTime+=p,g.fading){g.actor.alpha=Math.max(0,g.actor.alpha-p/ma),g.actor.alpha<=0&&be(g);continue}let{x:k,y:C}=g.actor;We(g,p),ye(g,p,g.actor.x!==k||g.actor.y!==C)}for(let[g,k]of a){if(k.look!=="building")continue;let C=l.get(g)??0;t?k.fill=Math.max(k.fill,C):(i.get(g)?.pending??0)===0&&k.fill<C&&(k.fill=Math.min(C,k.fill+da*p))}if(b.state==="hoisting"){w=Math.min(1,w+p/xa);let g=_a(w),k=s.pyramid.apex;b.x=T.sledge.x+(k.x-T.sledge.x)*g,b.y=T.sledge.y+(k.y-T.sledge.y)*g,w>=1&&(Sn(),y!==null&&(x=Aa))}else x>0&&(x=Math.max(0,x-p),x===0&&y!==null&&(et(y),y=null,kn()));$e(p),S=Math.max(0,S-p),F(),L()}function ye(d,p,b){let g=d.actor;if(!(t||!b||!Ba.has(g.pose)))for(d.dust+=p;d.dust>=Ar;)d.dust-=Ar,me("dust",g.x,g.y,-4+8*n(),-6+4*n(),Pa)}function $e(d){let p=0;for(let b of s.particles){if(b.x+=b.vx*d,b.y+=b.vy*d,(b.kind==="stone"||b.kind==="coin")&&(b.vy+=ha*d),b.life-=d,b.kind==="stone"&&b.y>=No){ae(1);continue}b.life<=0||(s.particles[p]=b,p+=1)}s.particles.length=p}function Cn(d,p){let b=s.actors.map((g,k)=>({a:g,i:k})).filter(({a:g})=>g.lane!==null&&g.cast!=="arbab"&&g.alpha>=.1).sort((g,k)=>k.a.y===g.a.y?k.i-g.i:k.a.y-g.a.y);for(let{a:g}of b)if(d>=g.x-fe.w/2&&d<=g.x+fe.w/2&&p>=g.y-fe.h&&p<=g.y)return g.lane;for(let g of s.pyramid.blocks)if(g.lane!==null&&d>=g.x&&d<g.x+g.w&&p>=g.y&&p<g.y+g.h)return g.lane;return null}function tt(d){v=d,I()}return{world:s,apply:Q,step:re,pick:Cn,highlight:tt}}var Ha=new Set(["queued","held","preparing","running","waiting-reset"]),Nr=e=>Ha.has(e);function bt(e){let t=Math.floor(e/1e3),n=Math.floor(t/3600),o=Math.floor(t%3600/60),r=t%60,s=i=>String(i).padStart(2,"0");return n>0?`${n}h${s(o)}m`:o>0?`${o}m${s(r)}s`:`${r}s`}function Tr(e,t,n){let o=[];for(let[r,s]of[["5h",e],["7d",t]])s&&s.resetsAt>n&&o.push(`${r} ${Math.round(s.utilization*100)}%`);return o.length>0?o.join(" \\xB7 "):"\\u2014"}var qt="\\u2014";function Wa(e,t,n){let o=Number.isFinite(n)&&n>0?n:1,r=Math.min(e/480,t/270);return!Number.isFinite(r)||r<=0?0:Math.floor(r*o+1e-9)/o}function Pr(e,t,n){let o=Wa(e,t,n);return o>=1?{fluid:!1,scale:o,width:480*o,height:270*o}:Number.isFinite(e)&&e>=480?{fluid:!1,scale:1,width:480,height:270}:{fluid:!0}}var Ya=40;function Br(e,t,n,o){let r=e-t-n-o-Ya;return Number.isFinite(r)?Math.max(0,r):0}function Or(e){return/^#?(?:.*&)?token=([0-9a-fA-F]{8,128})(?:&.*)?$/.exec(e)?.[1]??null}function Rn(e){return typeof e=="object"&&e!==null&&!Array.isArray(e)}function Fr(e){let t;try{t=JSON.parse(e)}catch{return{ok:!1,message:"The server sent a snapshot that is not JSON."}}return Rn(t)?t.protocol!==1?{ok:!1,message:`This page speaks protocol ${1} and the server speaks ${String(t.protocol)}: reload the page.`}:!Array.isArray(t.lanes)||!Array.isArray(t.integrations)||!Rn(t.quota)?{ok:!1,message:"The server sent a snapshot without lanes, integrations or quota."}:t.lanes.every(n=>Rn(n)&&typeof n.name=="string"&&typeof n.state=="string")?{ok:!0,snapshot:t}:{ok:!1,message:"The server sent a lane without a name or state."}:{ok:!1,message:"The server sent a snapshot that is not an object."}}function Ir(e){try{let t=JSON.parse(e);if(Rn(t)&&typeof t.message=="string"&&t.message!=="")return t.message}catch{}return"The server reported a problem."}function Po(e){let t={running:0,preparing:0,waiting:0,asleep:0,orphaned:0,succeeded:0,failed:0};for(let n of e)switch(n.state){case"running":t.running++;break;case"preparing":t.preparing++;break;case"queued":case"held":t.waiting++;break;case"waiting-reset":t.asleep++;break;case"orphaned":t.orphaned++;break;case"finished":n.endState==="success"?t.succeeded++:t.failed++;break}return t}function Ka(e){let t=[];for(let[o,r]of[["running",e.running],["preparing",e.preparing],["waiting",e.waiting],["asleep",e.asleep],["orphaned",e.orphaned]])r>0&&t.push(`${r} ${o}`);let n=[];return e.succeeded>0&&n.push(`\\u2713 ${e.succeeded}`),e.failed>0&&n.push(`\\u2717 ${e.failed}`),n.length>0&&t.push(n.join(" ")),t.length>0?t.join(" \\xB7 "):"no lanes"}function Ye(e){return e===null||!Number.isFinite(e)?qt:`$${e.toFixed(2)}`}function Bo(e){return e.reduce((t,n)=>t+(typeof n.costUsd=="number"&&Number.isFinite(n.costUsd)?n.costUsd:0),0)}function Dr(e){let t=Date.parse(e.now),n=Number.isNaN(t)?0:t/1e3,o=e.hiddenLanes>0?` \\xB7 ${e.hiddenLanes} older ${e.hiddenLanes===1?"lane":"lanes"} not shown`:"";return{project:e.project,version:`v${e.version}`,counts:Ka(Po(e.lanes)),cost:Ye(Bo(e.lanes)),quota:Tr(e.quota.fiveHour,e.quota.sevenDay,n),held:e.quota.hold.hold===!0,footer:`Read-only \\xB7 arbab ${e.version}${o}`}}function qa(e){return e.state==="finished"&&e.endState?`finished (${e.endState})`:e.state==="held"&&e.hold?`held (${e.hold})`:e.state}function yt(e,t){if(e.elapsedMs!==null)return e.elapsedMs;if(!Nr(e.state))return null;let n=Date.parse(e.since);return Number.isNaN(n)?null:Math.max(0,t-n)}function Ur(e,t,n){let o=yt(e,t+n),r=[e.name,`${e.role} \\xB7 ${e.kind}`,qa(e),`attempt ${e.attempt}`,`elapsed ${o===null?qt:bt(o)}`,`tool calls ${e.toolCalls}`,`last tool ${e.lastTool??qt}`,`cost ${Ye(e.costUsd)}`,`${e.model??qt} \\xB7 ${e.effort??qt}`];return e.hold&&r.push(`held for ${e.hold==="quota"?"the quota":"a free slot"}`),e.reason&&r.push(e.reason),r}var za=new Set(["preparing","running"]),ja=new Set(["preparing","running","waiting-reset"]);function $r(e,t){if(!e)return[];let n=[],o=new Map(e.lanes.map(s=>[s.name,s]));for(let s of t.lanes){let i=o.get(s.name);za.has(s.state)&&!(i&&ja.has(i.state))&&n.push(`${s.name} started`),s.state==="finished"&&i&&i.state!=="finished"&&n.push(`${s.name} finished: ${s.endState??"unknown"}`)}let r=new Set(e.integrations.filter(s=>s.landedAt!==null).map(s=>s.name));for(let s of t.integrations)s.landedAt!==null&&!r.has(s.name)&&e.integrations.some(i=>i.name===s.name)&&n.push(`${s.name} landed`);return n}var Va=60;function xt(e){let t=Math.max(0,Math.floor(e/1e3));if(t<60)return"just now";let n=Math.floor(t/60);if(n<60)return`${n}m ago`;let o=Math.floor(n/60);return o<48?`${o}h ago`:`${Math.floor(o/24)}d ago`}function zt(e,t){if(e===null)return t;let n=Date.parse(e);return Number.isFinite(n)?n:t}function _r(e){return zt(e.now,0)}function Gr(e,t){let n=zt(e.since,t),o=e.attempt>1?` (attempt ${e.attempt})`:"";return{id:`started:${e.name}:${e.attempt}:${n}`,at:n,kind:"started",text:`${e.name} started${o}`}}function Hr(e,t){let n=zt(e.since,t),o=e.endState??"unknown",r=e.costUsd===null?"":` \\xB7 ${Ye(e.costUsd)}`;return{id:`finished:${e.name}:${e.attempt}:${n}`,at:n,kind:e.endState==="success"?"finished":"failed",text:`${e.name} finished: ${o}${r}`}}function Wr(e,t){let n=zt(e.since,t);if(e.state==="held"){let r=e.hold==="slot"?"a free slot":"the quota";return{id:`held:${e.name}:${n}`,at:n,kind:e.hold==="slot"?"waiting":"held",text:`${e.name} held for ${r}`}}let o=e.state==="waiting-reset"?"asleep until the quota resets":"queued";return{id:`waiting:${e.name}:${e.state}:${n}`,at:n,kind:"waiting",text:`${e.name} ${o}`}}function Yr(e,t){return{id:`landed:${e.name}`,at:zt(e.landedAt,t),kind:"landed",text:`${e.name} landed`}}function Xa(e,t){let n=e.verify==="passed";return{id:`verify:${e.name}:${e.headSha}:${e.verify}`,at:t,kind:n?"verify-passed":"verify-failed",text:`${e.name} verify ${n?"passed":"failed"}`}}function Oo(e,t,n=Va){let o=new Set,r=[];for(let s of[...t,...e])o.has(s.id)||(o.add(s.id),r.push(s));return r.sort((s,i)=>i.at-s.at).slice(0,n)}function Kr(e){let t=_r(e),n=[];for(let o of e.lanes)o.state==="finished"?n.push(Hr(o,t)):o.state==="running"||o.state==="preparing"?n.push(Gr(o,t)):(o.state==="queued"||o.state==="held"||o.state==="waiting-reset")&&n.push(Wr(o,t));for(let o of e.integrations)o.landedAt!==null&&n.push(Yr(o,t));return Oo([],n)}var Qa=new Set(["preparing","running"]),Ja=new Set(["preparing","running","waiting-reset"]);function qr(e,t){let n=_r(t),o=[],r=new Map(e.lanes.map(i=>[i.name,i]));for(let i of t.lanes){let a=r.get(i.name);Qa.has(i.state)&&!(a&&Ja.has(a.state))&&o.push(Gr(i,n)),i.state==="finished"&&a&&a.state!=="finished"&&o.push(Hr(i,n)),i.state==="held"&&i.hold==="quota"&&!(a&&a.state==="held"&&a.hold==="quota")&&o.push(Wr(i,n))}let s=new Map(e.integrations.map(i=>[i.name,i]));for(let i of t.integrations){let a=s.get(i.name);i.landedAt!==null&&(!a||a.landedAt===null)&&o.push(Yr(i,n)),i.verify!==null&&(!a||a.verify!==i.verify||a.headSha!==i.headSha)&&o.push(Xa(i,n))}return o}function zr(e){switch(e){case"started":return"\\u2192";case"finished":case"verify-passed":return"\\u2713";case"failed":case"verify-failed":return"\\u2717";case"landed":return"\\u25C6";default:return"\\u23F3"}}var Za={none:"",waiting:"capstone waiting",hoisting:"capstone rising",set:"capstone set"};function Fo(e){let t=e.pyramid,n=t.blocks.filter(r=>r.lane!==null),o=n.filter(r=>r.look==="set").length;return`${t.monument??""}|${o}/${n.length}|${t.capstone.state}|${t.capstone.integration??""}|${t.capstone.flag}`}function jr(e,t,n){let o=n.pyramid;if(o.monument!==null){let a=e.integrations.find(f=>f.name===o.monument),l=a?.landedAt?Date.parse(a.landedAt):Number.NaN,c=Number.isFinite(l)?` \\xB7 landed ${xt(t-l)}`:"",u=a?a.lanes.length:o.blocks.filter(f=>f.lane!==null).length;return`monument \\xB7 ${o.monument} \\xB7 ${u} ${u===1?"block":"blocks"}${c}`.toUpperCase()}let r=o.blocks.filter(a=>a.lane!==null),s=o.capstone;if(r.length===0&&s.state==="none")return"THE SITE IS QUIET";let i=[];return s.state!=="none"&&s.integration!==null&&i.push(s.integration),i.push(`${r.filter(a=>a.look==="set").length}/${r.length} blocks set`),s.state!=="none"&&(i.push(Za[s.state]),i.push(`verify ${s.flag==="passed"?"\\u2713":s.flag==="failed"?"\\u2717":"\\xB7"}`)),i.join(" \\xB7 ").toUpperCase()}function R(e,t,n="",o=null){let r=e.createElement(t);return n!==""&&(r.className=n),o!==null&&(r.textContent=o),r}function jt(e){return e&&typeof e.getContext=="function"?e:null}function Vr(e){return Number.isFinite(e)?Math.max(1,Math.round(e)):1}function rt(e,t,n,o,r="px"){let s=jt(e.createElement("canvas"));return s?(s.className=r,s.setAttribute("aria-hidden","true"),Vt(s,t,n,o),s):null}function Vt(e,t,n,o){e.width=t*o,e.height=n*o,e.style.width=`${t}px`,e.style.height=`${n}px`}function Io(e,t){let n=[],o=new Map;for(let s of t){let i=e[s]??0,a=0,l=n.length;for(;a<l;){let c=a+l>>1;(e[n[c]??0]??0)<i?a=c+1:l=c}a>0&&o.set(s,n[a-1]??-1),n[a]=s}let r=[];for(let s=n[n.length-1];s!==void 0&&s>=0;s=o.get(s))r.push(s);return r}function el(e,t,n=null){let o=new Map(e.map((f,m)=>[f,m])),r=t.map(f=>o.get(f)??-1),s=t.map((f,m)=>m).filter(f=>(r[f]??-1)>=0),i=n===null?-1:t.indexOf(n),a=r[i]??-1,l;if(i<0||a<0)l=Io(r,s);else{let f=s.filter(h=>h<i&&(r[h]??0)<a),m=s.filter(h=>h>i&&(r[h]??0)>a);l=[...Io(r,f),i,...Io(r,m)]}let c=new Set(l),u=[];for(let f=t.length-1;f>=0;f--)c.has(f)||u.push({key:t[f]??"",before:t[f+1]??null});return u}function wt(e,t,n,o,r=null){let s=new Set(n),i=t.filter(a=>s.has(a)?!0:(o(a)?.remove(),!1));for(let{key:a,before:l}of el(i,n,r)){let c=o(a);c&&e.insertBefore(c,l===null?null:o(l)??null)}return[...n]}var A={bg:"#120d0a","bg-2":"#1b140f",panel:"#241a12","panel-2":"#2e2116","panel-hi":"#3a2a1b","frame-dark":"#0b0705",frame:"#6b4a26","frame-hi":"#a87a3f","frame-lo":"#3a2716",text:"#f4ead2",muted:"#b89f74",faint:"#7d6a4d",gold:"#ffd54a","gold-2":"#e0a800",sand:"#e9c886",sky:"#5ba8d9","st-running":"#5ba8d9","st-preparing":"#8cc6e3","st-waiting":"#e0a800","st-asleep":"#8e7cc3","st-success":"#3faf5a","st-failed":"#d04040","st-orphaned":"#85827a","badge-failed":"#b23a3a"},Do={laborer:"#c9a46b",mason:"#3c6fb0",scribe:"#6e4c9e",skeptic:"#b23a3a",surveyor:"#3f8f5a",waterboy:"#e2b23a",scout:"#2f6b4f"},kt=A.bg;function Pn(e){return e==="failed"?{ground:A["badge-failed"],ink:A.text}:{ground:tl(e),ink:kt}}function Xt(e){switch(e.state){case"running":return{tone:"running",label:"RUNNING"};case"preparing":return{tone:"preparing",label:"PREPARING"};case"queued":return{tone:"waiting",label:"QUEUED"};case"held":return{tone:"waiting",label:"HELD"};case"waiting-reset":return{tone:"asleep",label:"ASLEEP"};case"orphaned":return{tone:"orphaned",label:"ORPHANED"};case"finished":return e.endState==="success"?{tone:"success",label:"\\u2713 DONE"}:{tone:"failed",label:"\\u2717 FAILED"};default:return{tone:"orphaned",label:String(e.state).toUpperCase()}}}function tl(e){return A[`st-${e}`]}var Xr={Y:A.gold,y:A["gold-2"],W:"#fff6c9",L:"#f1e2bc",l:"#dcc796",S:"#b5843f",s:"#8f6a33",i:"#c9c3b0",I:"#85827a",w:"#8b5a2b",g:A.sand,m:A.muted,b:A["st-running"],p:A["st-asleep"],e:A["st-success"],r:A["st-failed"],a:A["st-waiting"]},Uo=nl();function nl(){let e=[];for(let t=0;t<16;t++){let n=Math.floor(t/2),o="";for(let r=0;r<16;r++)r<7-n||r>8+n?o+=".":t===0&&r===7?o+="W":t<4?o+=r<=7?"Y":"y":t%2===1?o+=r<=7?"l":"s":o+=r<=7?"L":"S";e.push(o)}return e}var ol={logo:Uo,hammer:["iiiiiii.","IiiiiiI.","...w....","...w....","...w....","...w....","...w....","...w...."],hourglass:["yyyyyyy",".mgggm.","..mgm..","...m...","..mgm..",".mgggm.","yyyyyyy"],zzz:["...pppp",".....p.","....p..","...pppp","ppp....",".p.....","ppp...."],check:[".......","......e",".....ee","e...ee.","ee.ee..",".eee...","..e...."],coin:["..YYY..",".YyyyY.","YyYYYyY","YyYyyyY","YyYYYyY",".YyyyY.","..YYY.."],cross:[".......","r.....r","rr...rr",".rr.rr.","..rrr..",".rr.rr.","rr...rr"],arrow:[".......","...b...","....b..","bbbbbb.","....b..","...b...","......."],diamond:[".......","...Y...","..YYy..",".YYyyy.","..Yyy..","...y...","......."],wait:["aaaaaaa",".aggga.","..aga..","...a...","..a.a..",".aggga.","aaaaaaa"]};function $o(e,t,n,o,r){t.forEach((s,i)=>{let a=0;for(;a<s.length;){let l=Xr[s[a]??"."];if(l===void 0){a++;continue}let c=a+1;for(;c<s.length&&Xr[s[c]??"."]===l;)c++;e.fillStyle=l,e.fillRect(n+a*r,o+i*r,(c-a)*r,r),a=c}})}function rl(e){return{w:Math.max(0,...e.map(t=>t.length)),h:e.length}}function Bn(e,t,n,o,r){let s=ol[t],{w:i,h:a}=rl(s),l=r??i*n,c=r??a*n,u=rt(e,l,c,o,`px icon icon-${t}`);if(!u)return null;let f=u.getContext("2d");if(f){let m=n*o;$o(f,s,Math.floor((l-i*n)/2)*o,Math.floor((c-a*n)/2)*o,m)}return u}var sl={" ":["...","...","...","...","...","...","..."],A:[".###.","#...#","#...#","#####","#...#","#...#","#...#"],B:["####.","#...#","#...#","####.","#...#","#...#","####."],C:[".###.","#...#","#....","#....","#....","#...#",".###."],D:["####.","#...#","#...#","#...#","#...#","#...#","####."],E:["#####","#....","#....","####.","#....","#....","#####"],F:["#####","#....","#....","####.","#....","#....","#...."],G:[".###.","#...#","#....","#.###","#...#","#...#",".###."],H:["#...#","#...#","#...#","#####","#...#","#...#","#...#"],I:["###",".#.",".#.",".#.",".#.",".#.","###"],J:["..###","....#","....#","....#","....#","#...#",".###."],K:["#...#","#..#.","#.#..","##...","#.#..","#..#.","#...#"],L:["#....","#....","#....","#....","#....","#....","#####"],M:["#...#","##.##","#.#.#","#.#.#","#...#","#...#","#...#"],N:["#...#","#...#","##..#","#.#.#","#..##","#...#","#...#"],O:[".###.","#...#","#...#","#...#","#...#","#...#",".###."],P:["####.","#...#","#...#","####.","#....","#....","#...."],Q:[".###.","#...#","#...#","#...#","#.#.#","#..#.",".##.#"],R:["####.","#...#","#...#","####.","#.#..","#..#.","#...#"],S:[".###.","#...#","#....",".###.","....#","#...#",".###."],T:["#####","..#..","..#..","..#..","..#..","..#..","..#.."],U:["#...#","#...#","#...#","#...#","#...#","#...#",".###."],V:["#...#","#...#","#...#","#...#","#...#",".#.#.","..#.."],W:["#...#","#...#","#...#","#.#.#","#.#.#","#.#.#",".#.#."],X:["#...#","#...#",".#.#.","..#..",".#.#.","#...#","#...#"],Y:["#...#","#...#",".#.#.","..#..","..#..","..#..","..#.."],Z:["#####","....#","...#.","..#..",".#...","#....","#####"],a:[".....",".....",".###.","....#",".####","#...#",".####"],b:["#....","#....","####.","#...#","#...#","#...#","####."],c:[".....",".....",".###.","#....","#....","#...#",".###."],d:["....#","....#",".####","#...#","#...#","#...#",".####"],e:[".....",".....",".###.","#...#","#####","#....",".###."],f:["..##",".#..","####",".#..",".#..",".#..",".#.."],g:[".....",".....",".####","#...#","#...#","#...#",".####","....#",".###."],h:["#....","#....","####.","#...#","#...#","#...#","#...#"],i:["#",".","#","#","#","#","#"],j:["..#","...","..#","..#","..#","..#","..#","..#","##."],k:["#...","#...","#..#","#.#.","##..","#.#.","#..#"],l:["#","#","#","#","#","#","#"],m:[".....",".....","##.#.","#.#.#","#.#.#","#.#.#","#...#"],n:[".....",".....","####.","#...#","#...#","#...#","#...#"],o:[".....",".....",".###.","#...#","#...#","#...#",".###."],p:[".....",".....","####.","#...#","#...#","#...#","####.","#....","#...."],q:[".....",".....",".####","#...#","#...#","#...#",".####","....#","....#"],r:["....","....","#.##","##..","#...","#...","#..."],s:[".....",".....",".####","#....",".###.","....#","####."],t:[".#..",".#..","####",".#..",".#..",".#..","..##"],u:[".....",".....","#...#","#...#","#...#","#...#",".####"],v:[".....",".....","#...#","#...#","#...#",".#.#.","..#.."],w:[".....",".....","#...#","#...#","#.#.#","#.#.#",".#.#."],x:[".....",".....","#...#",".#.#.","..#..",".#.#.","#...#"],y:[".....",".....","#...#","#...#","#...#","#...#",".####","....#",".###."],z:[".....",".....","#####","...#.","..#..",".#...","#####"],0:[".###.","#...#","#..##","#.#.#","##..#","#...#",".###."],1:["..#..",".##..","..#..","..#..","..#..","..#..",".###."],2:[".###.","#...#","....#","...#.","..#..",".#...","#####"],3:[".###.","#...#","....#","..##.","....#","#...#",".###."],4:["...#.","..##.",".#.#.","#..#.","#####","...#.","...#."],5:["#####","#....","####.","....#","....#","#...#",".###."],6:["..##.",".#...","#....","####.","#...#","#...#",".###."],7:["#####","....#","...#.","..#..",".#...",".#...",".#..."],8:[".###.","#...#","#...#",".###.","#...#","#...#",".###."],9:[".###.","#...#","#...#",".####","....#","...#.",".##.."],"!":["#","#","#","#","#",".","#"],\'"\':["#.#","#.#","...","...","...","...","..."],"#":[".#.#.",".#.#.","#####",".#.#.","#####",".#.#.",".#.#."],$:["..#..",".####","#.#..",".###.","..#.#","####.","..#.."],"%":["##...","##..#","...#.","..#..",".#...","#..##","...##"],"&":[".##..","#..#.","#..#.",".##..","#.#.#","#..#.",".##.#"],"\'":["#","#",".",".",".",".","."],"(":["..#",".#.","#..","#..","#..",".#.","..#"],")":["#..",".#.","..#","..#","..#",".#.","#.."],"*":[".....","..#..","#.#.#",".###.","#.#.#","..#..","....."],"+":[".....","..#..","..#..","#####","..#..","..#..","....."],",":["..","..","..","..","..","..",".#","#.",".."],"-":["...","...","...","###","...","...","..."],".":[".",".",".",".",".",".","#"],"/":["....#","....#","...#.","..#..",".#...","#....","#...."],":":[".",".","#",".",".",".","#"],";":["..","..",".#","..","..","..",".#","#.",".."],"<":["...#","..#.",".#..","#...",".#..","..#.","...#"],"=":[".....",".....","#####",".....","#####",".....","....."],">":["#...",".#..","..#.","...#","..#.",".#..","#..."],"?":[".###.","#...#","....#","...#.","..#..",".....","..#.."],"@":[".###.","#...#","#.###","#.#.#","#.###","#....",".####"],"[":["###","#..","#..","#..","#..","#..","###"],"\\\\":["#....","#....",".#...","..#..","...#.","....#","....#"],"]":["###","..#","..#","..#","..#","..#","###"],"^":["..#..",".#.#.","#...#",".....",".....",".....","....."],_:[".....",".....",".....",".....",".....",".....",".....",".....","#####"],"`":["#.",".#","..","..","..","..",".."],"{":["..##",".#..",".#..","#...",".#..",".#..","..##"],"|":["#","#","#","#","#","#","#"],"}":["##..","..#.","..#.","...#","..#.","..#.","##.."],"~":[".....",".....",".#...","#.#.#","...#.",".....","....."],"\\u2713":[".....","....#","...##","#.##.","###..",".#...","....."],"\\u2717":[".....","#...#","##.##",".###.","##.##","#...#","....."],"\\xB7":[".",".",".","#",".",".","."],"\\u2022":["....","....",".##.","####","####",".##.","...."],"\\u2192":[".....","..#..","...#.","#####","...#.","..#..","....."],"\\u2190":[".....","..#..",".#...","#####",".#...","..#..","....."],"\\u2191":["..#..",".###.","#.#.#","..#..","..#..","..#..","..#.."],"\\u2193":["..#..","..#..","..#..","..#..","#.#.#",".###.","..#.."],"\\u2026":[".....",".....",".....",".....",".....",".....","#.#.#"],"\\u2014":[".....",".....",".....","#####",".....",".....","....."],"\\u2013":["....","....","....","####","....","....","...."],"\\xD7":["...","...","#.#",".#.","#.#","...","..."],"\\xB0":[".#.","#.#",".#.","...","...","...","..."]},il=["#####","#...#","#...#","#...#","#...#","#...#","#####"];function Qr(e,t){if(t.length!==7&&t.length!==9)throw new Error(`glyph ${JSON.stringify(e)} has ${t.length} rows`);let n=t[0]?.length??0,o=[];return t.forEach((r,s)=>{if(r.length!==n||!/^[#.]*$/.test(r))throw new Error(`glyph ${JSON.stringify(e)} row ${s} is malformed`);for(let i=0;i<n;i++){if(r[i]!=="#")continue;let a=i+1;for(;r[a]==="#";)a++;o.push({x:i,y:s,w:a-i}),i=a}}),{w:n,runs:o}}var al=new Map(Object.entries(sl).map(([e,t])=>[e,Qr(e,t)])),ll=Qr("missing",il);function Jr(e){return al.get(e)??ll}function Ke(e){let t=0,n=0;for(let o of e)t+=Jr(o).w,n++;return n===0?0:t+(n-1)*1}function On(e,t,n,o,r,s=1){if(!Number.isFinite(s)||s<=0)return 0;e.fillStyle=r;let i=0,a=!0;for(let l of t){a||(i+=1),a=!1;let c=Jr(l);for(let u of c.runs)e.fillRect(n+(i+u.x)*s,o+u.y*s,u.w*s,s);i+=c.w}return i*s}var ul=1;function dl(e,t,n){let o=Ke(e)*t,r=11*t;return{width:o*n,height:r*n,cssWidth:o,cssHeight:r}}function q(e,t,n=""){let o=R(e,"span",t.className?`pxt ${t.className}`:"pxt"),r=rt(e,0,0,t.dpr),s=R(e,"span","visually-hidden");r&&o.appendChild(r),o.appendChild(s);let i=null,a=t.color,l=t.scale,c={el:o,canvas:r,set(u,f=a,m=l){if(u===i&&f===a&&m===l)return;if(i=u,a=f,l=m,s.textContent=u,!r){s.className="";return}let h=dl(u,l,t.dpr);Vt(r,h.cssWidth,h.cssHeight,t.dpr);let w=r.getContext("2d");if(!w)return;w.clearRect(0,0,h.width,h.height);let y=l*t.dpr;On(w,u,0,ul*y,a,y)},text:()=>i??""};return c.set(n),c}var fl={started:A["st-running"],finished:A["st-success"],"verify-passed":A["st-success"],failed:A["st-failed"],"verify-failed":A["st-failed"],landed:A.gold,held:A["st-waiting"],waiting:A["st-waiting"]},pl={"\\u25C6":"diamond","\\u23F3":"wait"};function Zr(e,t,n){let o=q(e,{scale:2,color:A.gold,dpr:n},"CHRONICLE");t.title.replaceChildren(o.el);let r=new Map,s=[],i=!1,a=c=>{let u=R(e,"li",i?`chronicle-line kind-${c.kind} enter`:`chronicle-line kind-${c.kind}`),f=zr(c.kind),m=pl[f],h=m?Bn(e,m,1,n,9):q(e,{scale:1,color:fl[c.kind],dpr:n,className:"glyph"},f).el;h&&u.appendChild(h),m&&u.appendChild(R(e,"span","visually-hidden",c.kind==="landed"?"landed:":"waiting:")),u.appendChild(R(e,"span","text",c.text));let w=R(e,"time","ago");return w.setAttribute("datetime",new Date(c.at).toISOString()),u.appendChild(w),{li:u,time:w,at:c.at}},l={update(c,u){for(let h of c)!r.has(h.id)&&Number.isFinite(h.at)&&r.set(h.id,a(h));let f=c.filter(h=>r.has(h.id)).map(h=>h.id);s=wt(t.list,s,f,h=>r.get(h)?.li);let m=new Set(f);for(let h of[...r.keys()])m.has(h)||r.delete(h);t.empty.hidden=f.length>0,i=!0,l.refresh(u)},refresh(c){for(let u of r.values())u.time.textContent=xt(c-u.at)}};return l}var Ho="#E8E6D8",Jt="#C9C6B4";var In=["#E9C886","#DDB66E","#C89A56","#B5843F"],he={light:"#F1E2BC",face:"#DCC796",mortar:"#B9A06C",edge:"#8F7A50"},Dn="#8C7A5B",ts="#CDB27E",Et={gap:"#6E5A3C",crack:"#4A3B26"},Ct={light:"#A7A39A",dark:"#85827A"},O={gleam:"#FFF6C9",light:"#FFD54A",mid:"#E0A800",shadow:"#A87400"},St={base:"#B9784E",shadow:"#925A38"},_o={white:"#F4F0E2",shadow:"#D6CFBC"},xe="#3A2716",vt={laborer:"#C9A46B",mason:"#3C6FB0",scribe:"#6E4C9E",skeptic:"#B23A3A",surveyor:"#3F8F5A",waterboy:"#E2B23A",scout:"#2F6B4F"},Un="#2A4FA0",z=["#8B5A2B","#6B4220"],Go={leaf:"#3E7D3A",leafDark:"#2D5E2B",trunk:"#7A5230"},_e={cloth:"#E7D6B0",shade:"#C2A97A",stripe:"#B23A3A"},ml="#4F8FBF",hl="#C98A3E",es="#8E5B3E",Mt={fill:"#FFFDF5",glyph:"#5A4630"},Wo={green:"#3FAF5A",red:"#D04040"},$n={face:"#F2C14E",shadow:"#C9962C"},Yo="#FFFFFF",At={day:["#2E6CAF","#3D82C2","#5299CF","#6CAED9","#8DC2E0","#B1D3DF","#D3DDCB","#ECE1BA"],dusk:["#2A2350","#45306A","#6C3B70","#984870","#C25A66","#E0755A","#F1954E","#F6B860"],night:["#060A1C","#0A1027","#0F1733","#151E3E","#1B2648","#222E52","#2A375C","#334166"]},_n={core:"#FFA640",rim:"#FFCB6B",halo:"#FFB85C"},Gn={core:"#FFF7DC",rim:"#FFFCEF",halo:"#FFF3C4"},ns={day:["#FFFDF6","#F1ECDF","#CBD3DD"],dusk:["#FFD39A","#E8968A","#9C5A7C"],night:["#5A6688","#46507A","#343D63"]},J={bright:"#F5F3E8",mid:"#C9CCE0",dim:"#7E86AA"},os={day:"#4A3A3C",dusk:"#3A2236"},rs=[{light:"#DCD3C6",face:"#C9BFB6",shade:"#B0A7A9"},{light:"#E5CBA2",face:"#D2B58C",shade:"#B39575"}],ss={light:"#E2BE7C",face:"#D4AA68",shade:"#BF9456"},ge={light:"#7E9A4A",face:"#5F7D3A",shade:"#465F2E"},se={sky:"#9CC9DD",light:"#6FA8CC",face:"#4F8FBF",deep:"#3D78A8",bank:"#A88654"},is={day:"#E6F4FA",dusk:"#FFE0A8",night:"#A9B6D8"},Zt={light:"#9CAA52",face:"#6E8A3C",shade:"#4E6A2E",tip:"#C8B068"},V={light:"#EADCB8",face:"#D6C499",shade:"#B5A27C",dark:"#9A8868"},st=["#CFAA6A","#D8B36F","#DFBC77","#E6C582","#E9C886","#E3BF7A"],en={light:"#F1D9A2",face:"#ECD195",track:"#D9B878"},qe={light:"#CDB693",face:"#A8906C",shade:"#7E6A4E"},tn={light:"#A3A057",face:"#7C7E43",shade:"#5A5E34"},Ge={light:"#D9AE73",face:"#BE8E55",shade:"#97693C",dark:"#6E4A2A"},it={white:"#FFF6D0",yellow:"#FFD24A",orange:"#F68B2C",red:"#D1452A",ember:"#8E2E1E"},Ko="#CFC8C0",qo={light:"#A8A094",shade:"#756E64"},at={light:"#E0A859",face:"#B37A3A",shade:"#7E5226"},le={cream:"#F2E4C2",creamShade:"#D7C29A",red:"#B8433A",redShade:"#8E2F2B"},Hn={light:"#FBF7EC",shade:"#DCD4C2"},pe={light:"#F3E6C2",face:"#E0CD9F",shade:"#C2AA78",edge:"#9C8558"},Wn="#3E2A1C",as="#0A0E22",Yn="#FFB45A",ls={day:"#4A321E",dusk:"#2E1830",night:"#05071A"},lt={fill:"#2B1D14",rim:O.mid,text:O.gleam},zo={o:xe,k:St.base,K:St.shadow,"*":St.base,"&":St.shadow,t:St.base,T:St.shadow,w:_o.white,W:_o.shadow,h:vt.laborer,H:Qt(vt.laborer,.72),s:_o.shadow,n:z[0],N:z[1],l:he.light,L:he.face,m:he.mortar,e:he.edge,G:O.gleam,y:O.light,Y:O.mid,z:O.shadow,B:Un,b:hl,j:es,J:Qt(es,.75),a:ml,v:Go.leaf,V:Go.leafDark,r:Go.trunk,c:_e.cloth,C:_e.shade,q:_e.stripe,U:In[3],f:Mt.fill},gl=Et.crack;function cs(e){switch(e){case"arbab":return{};case"scribe":case"skeptic":return{h:gl,H:xe,s:vt[e]};case"scout":{let t=vt.scout;return{h:t,H:Qt(t,.72),t,T:Qt(t,.72)}}default:return{h:vt[e],H:Qt(vt[e],.72)}}}function Fn(e){if(!/^#[0-9a-fA-F]{6}$/.test(e))throw new Error(`not a #rrggbb color: ${e}`);let t=Number.parseInt(e.slice(1),16);return[t>>16&255,t>>8&255,t&255]}function jo(e,t,n){let o=r=>Math.max(0,Math.min(255,Math.round(r))).toString(16).padStart(2,"0");return`#${o(e)}${o(t)}${o(n)}`.toUpperCase()}function Qt(e,t){let[n,o,r]=Fn(e);return jo(n*t,o*t,r*t)}function W(e,t,n){let[o,r,s]=Fn(e),[i,a,l]=Fn(t);return jo(o+(i-o)*n,r+(a-r)*n,s+(l-s)*n)}function us(e){let[t,n,o]=Fn(e),r=.3*t+.59*n+.11*o;return jo(r,r,r)}function Lt(e){return W(e,us(e),.65)}function ds(e){return W(us(e),Ho,.55)}function ce(e,t){let n=e.length,o=Math.max(0,...e.map(i=>i.length)),r=[],s=n;for(let i=0;i<n;i++){let a=e[i]??"",l=0;for(;l<a.length;){let c=a[l]??".";if(c==="."){l++;continue}let u=t[c];if(u===void 0)throw new Error(`sprite character ${JSON.stringify(c)} has no color`);let f=l+1;for(;f<a.length&&t[a[f]??"."]===u;)f++;r.push({x:l,y:i,w:f-l,color:u}),s=Math.min(s,i),l=f}}return{w:o,h:n,top:s===n?0:s,runs:r,mirrored:r.map(i=>({...i,x:o-i.x-i.w}))}}function Ze(e,t,n){let o=Array.from({length:t},()=>Array.from({length:e},()=>"."));for(let{grid:r,dx:s=0,dy:i=0}of n)r.forEach((a,l)=>{for(let c=0;c<a.length;c++){let u=a[c]??".";if(u==="."||u==="+")continue;let f=c+s,m=l+i,h=o[m];if(h===void 0||f<0||f>=e)throw new Error(`sprite pixel (${f}, ${m}) is outside ${e}\\xD7${t}`);h[f]=u}});return o.map(r=>r.join(""))}function fs(e,t){for(let n=0;n<e.length;n++){let o=(e[n]??"").indexOf(t);if(o>=0)return{x:o,y:n}}return null}function Xo(e,t,n){let o=fs(e,n),r=fs(t,"+");if(!o||!r)throw new Error(`no ${n} or + to hold an item by`);return{grid:t,dx:o.x-r.x,dy:o.y-r.y}}function we(e,t,n="*"){let o=[{grid:e}];return t&&o.push(Xo(e,t,n)),Ze(e[0]?.length??0,e.length,o)}var Ne=["....ooooo...","...ohhhhho..","..ohhhhhhho.","..oHhhhkkko.","..oHhhkkoko.","..oHhhkkkkko","..oHhokkKko.","..oHo.okko.."],ps=an(Ne,[[6,9,"o"]]),Vo=["............","....ooooo...","...ohhhhho..","..ohhhhhhho.","..oHhhhhkko.","..oHhhkkkko.","..oHhhkoKko.","..oHhokkkko."],nn=["....ooooo...","...ohhhhho..","..ohhhhhkko.","..oHhhkkoko.","..oHhhkkkkko","..oHhokkkko.","..oHhoKkko..","..oHo.oko..."];function an(e,t){let n=[...e];for(let[o,r,s]of t){let i=n[o]??"";n[o]=i.slice(0,r)+s+i.slice(r+1)}return n}var ne={idle:["..otttttto..",".oTtttttTko.",".okTttttTko.",".okossssoko.",".o&o....o*o."],swingA:["..otttttto..",".oTtttttTko.","o&oTttttTko.","oo.ossssok*o","...........o"],swingB:["..otttttto..",".oTtttttTko.","okoTttttTo..","o&ossssso*o.",".o.....oo.o."],hold:["..otttttto..",".oTtttttTo..",".okTttttko*o",".okosssso.o.",".o&o........"],shoulder:["..o&ttttto..",".okTttttTko.",".oTTttttTko.","..ossssoko..","........o*o."],write:["..otttttto..",".oTtttttTo..",".ok&ttttt*o.",".okosssso.o.",".oo........."]},Nt={front:["..........o.",".........o*o",".........oko",".........oko","..ottttttoko",".oTtttttTko.",".okTttttto..",".okosssso...",".o&o........"],both:[".o........o.","o&o......o*o","oko......oko","oko......oko","okottttttoko",".okTttttTko.","..oTttttto..","..ossssso...","............"],half:["............","............","o&o......o*o","oko......oko","okottttttoko",".okTttttTko.","..oTttttto..","..ossssso...","............"],climbA:[".........o*o",".........oko",".........oko","........oko.","..ottttttko.",".o&tttttTo..",".okTttttto..","..ossssso...","............"],climbB:["............","............","..........o.",".........o*o","..ottttttoko",".o&tttttTko.",".okTttttto..","..ossssso...","............"]},gs=["...owwwWo...","..owwwwWWo..","..oowwwWoo.."],X={stand:["...oko.oko..","...oko.oko..","..ooo..oooo."],strideA:["..oKo..oko..",".oKo....oko.",".ooo....oooo"],pass:["....oKko....","....oKko....","....oooooo.."],strideB:["..oko..oKo..",".oko....oKo.",".ooo....oooo"],climbA:["..oko.oKo...","..oko..oo...","..ooo......."],climbB:["...oKo.oko..","....oo.oko..",".......ooo.."]},bl=[".owwwwwWkkko",".oooooooooo."],yl=["................","................","..........ooooo.",".oooooooooHhhhho","oKkkwwwWttoHkoko","okkkwwWWtttHkkko",".oooooooooooooo."],Te={hammerDown:[".+.",".N.","nnn","NNN"],hammerUp:["nnn","NNN",".N.",".+."],plumb:["+","o","o","Y","z"],papyrus:["lL","+L","lL","LL"],penUp:["..o",".o.","+.."],penDown:["o+"],scroll:["mlllm","mLL+m"],loaf:[".oo.","obbo","ob+o",".oo."],basket:["..+.","obbo","onNo","oNno",".oo."],jug:[".+.","ojo","ojJo",".oo."]},ms=["oooooo","olllLo","olLLLo","oLLLeo","oooooo"],xl=[".oo.","ojjo","oJJo"];function jn(e,t,n){let o=[];for(let r=0;r<e;r++){let s=n?Math.floor(r/2)%2===0?"n":"y":r===0?"N":"n";o.push(r===t?`+${s}`:`.${s}`)}return o}function wl(e){switch(e){case"laborer":case"mason":return"hammer";case"scribe":case"skeptic":return"pen";case"surveyor":return"rod";default:return null}}function kl(e){switch(e){case"laborer":return Te.hammerDown;case"mason":return Te.plumb;case"scribe":case"skeptic":return Te.papyrus;case"surveyor":return jn(15,10,!0);case"scout":return jn(16,11,!1);default:return null}}function ie(e,t,n,o=0,r=!1){let s={grid:t,dy:(r?4:8)+o},i={grid:e,dy:o};return Ze(fe.w,fe.h,[{grid:n,dy:15},{grid:gs,dy:12+o},...r?[i,s]:[s,i]])}var on=[X.strideA,X.pass,X.strideB,X.pass],rn=[0,1,0,1],Sl=[ne.swingA,ne.idle,ne.swingB,ne.idle];function sn(e){return[0,1,2,3].map(e)}function vl(e){let t=kl(e),n=wl(e),o=[we(ie(Ne,ne.idle,X.stand),t),we(ie(Ne,ne.idle,X.stand,1),t)],r=sn(v=>we(ie(Ne,Sl[v]??ne.idle,on[v]??X.pass,rn[v]),t)),s=(v,E,M)=>Ze(fe.w,fe.h,[{grid:E,dy:15},{grid:gs,dy:12},{grid:v,dy:4},{grid:nn},...M?[{grid:ms,dx:0,dy:6}]:[]]),i=v=>[s(Nt.climbA,X.climbA,v),s(Nt.climbB,X.climbB,v)],a=[Ze(fe.w,fe.h,[{grid:bl,dy:16},{grid:ne.idle,dy:12},{grid:Ne,dy:4}])],l;if(n==="hammer")l=[we(ie(Ne,ne.hold,X.stand,1),Te.hammerDown),we(ie(nn,Nt.front,X.stand,0,!0),Te.hammerUp)];else if(n==="pen"){let v=E=>an(E,[[10,5,"l"],[10,6,"l"],[10,7,"L"],[11,5,"l"],[11,6,"L"],[11,7,"L"]]);l=[we(v(ie(Vo,ne.write,X.stand)),Te.penDown),we(v(ie(Vo,ne.write,X.stand)),Te.penUp)]}else n==="rod"?l=[we(ie(Ne,ne.hold,X.stand),jn(10,3,!0)),we(ie(nn,ne.hold,X.stand),jn(14,9,!0))]:l=o;let u=[e==="skeptic"?we(ie(ps,Nt.front,X.stand,0,!0),["o","+"]):we(ie(ps,ne.hold,X.stand),null),we(ie(Ne,ne.idle,X.stand),e==="skeptic"?null:t)],f=sn(v=>we(ie(Ne,ne.hold,on[v]??X.pass,rn[v]),Te.scroll)),m=sn(v=>Ze(fe.w,fe.h,[{grid:ie(Ne,ne.shoulder,on[v]??X.pass,rn[v])},{grid:ms,dx:0,dy:4+(rn[v]??0)}])),h=v=>sn(E=>{let M=ie(Ne,ne.hold,on[E]??X.pass,rn[E]),U=[{grid:M},Xo(M,v===3?Te.basket:Te.loaf,"*")];return v>1&&U.push(Xo(M,Te.jug,"&")),Ze(fe.w,fe.h,U)}),w=sn(v=>ie(Vo,ne.idle,on[v]??X.pass,v%2)),y=[ie(nn,Nt.both,X.stand,0,!0),ie(nn,Nt.half,X.stand,1,!0)],x={idle:o,walk:r,climb:i(!1),"climb-stone":i(!0),sit:a,work:l,sleep:[[...yl]],talk:u,"carry-scroll":f,"carry-stone":m,"carry-ration":h(1),"carry-ration-2":h(2),"carry-ration-3":h(3),slump:w,cheer:y};if(e!=="waterboy")return x;let S={};for(let[v,E]of Object.entries(x))S[v]=E.map(M=>v==="sleep"?M:Cl(v==="sit"?M:El(M)));return S}function El(e){let t=".".repeat(e[0]?.length??0);return[t,t,...e.filter((n,o)=>o!==10&&o!==13)]}function Cl(e){let t=e.findIndex(r=>r.includes("h")),n=e[t]??"",o=Math.floor((n.indexOf("h")+n.lastIndexOf("h"))/2);return Ze(e[0]?.length??0,e.length,[{grid:e},{grid:xl,dx:o-1,dy:t-3}])}var zn=[".....oooooo.....","....oyBYyBYo....","...oyBYyBYyyo...","...oBYyBYyyyyo..","..oyBYyBokkkkko.","..oBYyBYokkokko.","..oyBYyBokkkkkko","..oBYyBYokkKkko.","..oyBYyBookkkoo.","..oBYyBo.oYYo..."],hs=[".....oooooo.....","....oyBYyBYo....","...oyBYyBYyyo...","...oBYyBYyykko..","..oyBYyBokkokko.","..oBYyBYokkkkkko","..oyBYyBokkkkko.","..oBYyBYoKkkkoo.","..oyBYyBookko...","..oBYyBo.oYYo..."],Ml=an(zn,[[7,12,"o"]]),Qo=["..oyBYoGyyyyyo..",".oGyyyGyyyGyyYo.",".oYzYYzYYzYYzYo.",".okowwwwwwwWokko",".okowwwwwwwWokko",".o&owwwwwwwWo*o.","..oowwwwwwWWoo..","...owyyyyyyYo...","...owwwwwwWWo...","...owwwwwwWWo...","...owwwwwwWWo...","..owwwwwwwWWWo..","..owwwwwwwWWWo..","..owwwwwwwWWWo..","..oooooooooooo..","...okko..okko..."],Kn=an(Qo,[[3,1,"."],[3,2,"o"],[3,3,"w"],[4,1,"."],[4,2,"o"],[4,3,"w"],[5,1,"."],[5,2,"o"],[5,3,"w"]]);function qn(e){let t=Array.from({length:13},()=>"...");t[e-1]=".o.",t[e]="o&o";for(let n=e+1;n<12;n++)t[n]="oko";return t[12]=".oo",t}var Al=[".y.","yGz",".z.",...Array.from({length:22},()=>".n.")];function Tt(e,t,n){let o=[{grid:Al,dx:13},{grid:t,dy:10},{grid:e}];return n&&o.push({grid:n}),Ze(So.w,So.h,o)}function Ll(){let e=an(Qo,[[1,2,"y"],[1,6,"y"],[1,10,"y"],[1,4,"G"],[1,8,"G"]]);return{idle:[Tt(zn,Qo,null),Tt(zn,e,null)],talk:[Tt(Ml,Kn,qn(6)),Tt(zn,Kn,qn(7))],cheer:[Tt(hs,Kn,qn(1)),Tt(hs,Kn,qn(4))]}}var Me={tent:["............oo............","...........occo...........","..........occcCo..........",".........occccCCo.........","........occccqCCCo........",".......occccqqCCCCo.......","......occccqqoqCCCCo......",".....occccqqooqqCCCCo.....","....occccqqoooqqqCCCCo....","...occcccccoooooCCCCCCo...","..occcccccooooooCCCCCCCo..",".occccccccooooooCCCCCCCCo.","occccccccoooooooCCCCCCCCCo","oooooooooooooooooooooooooo"],palm:[".......vvv.........","....vvvvvvVv..vvv..","..vvvVVvvvvVvvvvvv.",".vvV...vVvvvvVV..vv","vvV...vvVrVvvv...Vv","vV...vV.JrJ.vVv...V","V...vV..rNJ..vV....","....V...rN....V....","........rN.........","........rN.........",".........rN........",".........rN........",".........rN........",".........rN........",".........rrN.......","..........rN.......","..........rN.......","..........rN.......","..........rN.......","..........rN.......","..........rN.......","..........rN.......","..........rrN......","..........rrN......","..........rrN......",".........rrN.......",".........rrN.......",".........rrN.......",".........rrN.......",".........rrNN......","........UUUUUU....."],table:["........oo..............",".......ojjo.............","..oo..ojjjJo..ooo.......",".obbo.ojjJJo.obbbo.ommo.","obbbbo.oJJo.obbbbbmlqlm.","ooooooooooooooooooomLLLm","onnnnnnnnnnnnnnnnnnnnnNo","oNNNNNNNNNNNNNNNNNNNNNNo",".oNo................oNo.",".oNo................oNo.",".ooo................ooo."],chest:["..oooooooooo..",".onnnnnnnnnNo.","onnnnnnnnnnNNo","oyyyyyyyyyyYYo","onnnnnoyonnNNo","oNNNNNoYoNNNNo","onnnnnnonnnNNo","onnnnnnnnnnNNo","oyyyyyyyyyyYYo","oooooooooooooo"],well:["..oooooooooooooooo..","..onnnnnnnnnnnnnNo..","..ooooooooooooooo...","..oNo....o....oNo...","..oNo....o....oNo...","..oNo...ooo...oNo...","..oNo..onnNo..oNo...","..oNo..oNNNo..oNo...","..oNo...ooo...oNo...","..oNo.........oNo...",".ooooooooooooooooo..","olllLlllLlllLlllLeo.","oLLmLLLmLLLmLLLmLeo.","oaaaaaaaaaaaaaaaaeo.","ollLlllLlllLlllLLeo.","oLmLLLmLLLmLLLmLLeo.","oLLLmLLLmLLLmLLLeeo.",".oooooooooooooooooo."],sledge:["oooooooooooooooooooooo..","onnnnnnnnnnnnnnnnnnnNo..","oNNNNNNNNNNNNNNNNNNNNo.o",".oNo....oNo.....oNo..onN","ooooooooooooooooooooooNo","oNNNNNNNNNNNNNNNNNNNNNo."],capstone:["....yY....","...yyYz...","...yyYz...","..yyyYzz..","..yyyYzz..",".yyyyYzzz.","yyyyyYzzzz"],capstoneGleam:["....GY....","...GyYz...","...yGYz...","..GyyYzz..","..yGyYzz..",".GyyGYzzz.","yyyyyYzzzz"],glint:[".G.","GGG",".G."],rubble:[["llLo","LLeo","oooo"],[".llo","lLLe","oooo"],["lLo","eeo"]]},Vn={hourglass:["ooooo","oGyGo",".oyo.","..o..",".oGo.","oyyyo","ooooo"],dots:["ooo.ooo.ooo","ofo.ofo.ofo","ooo.ooo.ooo"],zzz:[".....oooooo",".....offffo",".....ooofoo",".....oofooo","ooooooffffo","offfooooooo","oofoo......","offfo......","ooooo......"],question:[".ooo.","offfo","oo.fo","..ofo","..oo.","..of.","..oo."]},bs=["ooooooo","oyyyyYo",".oyyYo.","..oYo..","...o..."],Xn=[["...","###","#.#",".#."],["##.",".##",".#.","#.#"],[".#.","##.",".#.",".#."],["...","#.#",".#.","..."],[".#.","#.#","###",".#."],["###","#.#","###","..."],["#..","#..","##.","#.#"],["###","#..","##.","..."],["##.","..#",".#.","#.."],["...",".#.","###","..."],["...","###","#.#","###"],["...","#.#","###","..."],["###",".#.",".#.","###"],["#.#","###","#.#","###"],["###","#.#","#.#","#.#"],["#.#",".#.","#.#","..."]];function Nl(e,t){let n=new Map;for(let[o,r]of Object.entries(e))n.set(o,r.map(s=>ce(s,t)));return n}function Tl(e,t){let n={...zo,...cs(e)};if(t)for(let o of Object.keys(n))n[o]=ds(n[o]??"#000000");return n}function Qn(){let e=new Map,t=(n,o)=>{let r=`${n}:${o?"ghost":"solid"}`,s=e.get(r);return s||(s=Nl(n==="arbab"?Ll():vl(n),Tl(n,o)),e.set(r,s)),s};return{frames(n,o,r,s){let i=t(n,s),a=o==="carry-ration"&&r>=2?`carry-ration-${Math.min(3,r)}`:o;return i.get(a)??i.get("idle")??[]}}}function Rt(e){return ce(e,zo)}var ct={w:36,h:54,scale:3},ln={w:48,h:78,scale:3},Rl=6,ys={running:0,preparing:1,"waiting-reset":2,held:3,queued:4,orphaned:5,finished:6},Es=(e,t)=>e.name<t.name?-1:e.name>t.name?1:0;function Pl(e){return e.filter(t=>t.state!=="finished").sort((t,n)=>(ys[t.state]??9)-(ys[n.state]??9)||Es(t,n))}function xs(e){let t=Date.parse(e);return Number.isFinite(t)?t:-1/0}function Bl(e,t=Rl){return e.filter(n=>n.state==="finished").sort((n,o)=>xs(o.since)-xs(n.since)||Es(n,o)).slice(0,t)}function ws(e){switch(e.state){case"running":return{pose:"work",ghost:!1};case"held":case"queued":return{pose:"sit",ghost:!1};case"waiting-reset":return{pose:"sleep",ghost:!1};case"orphaned":return{pose:"idle",ghost:!0};default:return{pose:"idle",ghost:!1}}}function Ol(e){return e.state==="finished"&&e.endState==="success"&&(e.reportStatus===null||e.reportStatus==="done")}function Fl(e){return Ol(e)?1:To(e.toolCalls)}function Cs(e){let{scrollHeight:t=0,clientHeight:n=0,scrollTop:o=0}=e;return[t,n,o].every(Number.isFinite)&&t-n-o>1}function Il(e){return`CREW \\xB7 ${e.filter(n=>n.state==="running"||n.state==="preparing").length} AT WORK`}function Ms(e,t,n,o,r,s){let i=e.getContext("2d");if(!i)return 0;i.clearRect(0,0,n*s,o*s);let a=Math.max(1,Math.min(r,Math.floor(n/Math.max(1,t.w)),Math.floor(o/Math.max(1,t.h))));return As(i,t,Math.floor((n-t.w*a)/2),o-t.h*a,a,s),a}function As(e,t,n,o,r,s){let i=r*s;for(let a of t.runs)e.fillStyle=a.color,e.fillRect((n+a.x*r)*s,(o+a.y*r)*s,a.w*i,i)}var Jo=Rt(Vn.zzz);function Dl(e,t,n,o){let r=Ms(e,t,ct.w,ct.h,ct.scale,o),s=e.getContext("2d");if(n==="sleep"&&s){let i=t.h-t.top;As(s,Jo,ct.w-Jo.w*2-2,ct.h-i*r-Jo.h*2-4,2,o)}return r}function ks(e,t,n){let o=R(e,"span","tile");o.setAttribute("aria-hidden","true");let r=rt(e,ct.w,ct.h,n,"px avatar");r&&o.appendChild(r);let s="";return{el:o,set(i,a,l){let c=`${i}:${a}:${l}`;if(c===s)return;s=c,o.className=`tile cast-${i}${l?" ghost":""}`;let u=t.frames(i,a,0,l)[0];r&&u&&Dl(r,u,a,n)}}}function Ul(e,t,n){let o=R(e,"span","tile tile-arbab");o.setAttribute("aria-hidden","true");let r=rt(e,ln.w,ln.h,n,"px avatar"),s=t.frames("arbab","idle",0,!1)[0];return r&&(o.appendChild(r),s&&Ms(r,s,ln.w,ln.h,ln.scale,n)),o}function Ss(e){let t=Tn(e);return t==="arbab"?"laborer":t}function vs(e,t){let{tone:n,label:o}=Xt(t);e.el.className=`pxt badge tone-${n}`,e.set(o,Pn(n).ink)}function Zo(e,t){let n=yt(e,t);return n===null?"\\u2014":bt(n)}function Ls(e,t,n,o,r){let s=q(e,{scale:2,color:A.gold,dpr:o},"CREW");t.title.replaceChildren(s.el);let i=q(e,{scale:1,color:A.muted,dpr:o},"RECENTLY FINISHED");t.recentTitle.replaceChildren(i.el);let a=R(e,"p","empty-lead","The site is quiet."),l=R(e,"p","empty-hint");l.appendChild(R(e,"span","","No lane is at work. Launch one with ")),l.appendChild(R(e,"code","","arbab launch")),l.appendChild(R(e,"span","",", or ")),l.appendChild(R(e,"code","","arbab plan next")),l.appendChild(R(e,"span","",": workers walk in from the village."));let c=R(e,"div","empty-words");c.appendChild(a),c.appendChild(l),t.empty.replaceChildren(Ul(e,n,o),c);let u=new Map,f=[],m=null,h=null,w="",y=(E,M)=>{let U=R(e,"li","crew-item"),$=R(e,"button","card frame-btn");$.setAttribute("type","button"),$.setAttribute("aria-pressed","false");let _=ks(e,n,o),G=R(e,"span","card-body"),Y=R(e,"span","card-head"),Oe=R(e,"span","name"),Fe=q(e,{scale:1,color:kt,dpr:o,className:"badge"});Y.appendChild(Oe),Y.appendChild(Fe.el);let ve=R(e,"span","meta"),Ie=R(e,"span","progress"),de=R(e,"span","bar"),ze=R(e,"span","bar-fill");de.appendChild(ze);let De=R(e,"span","calls");Ie.appendChild(de),Ie.appendChild(De);let be=R(e,"span","card-foot"),me=R(e,"span","stats"),ae=R(e,"span","elapsed");be.appendChild(me),be.appendChild(ae);for(let Ee of[Y,ve,Ie,be])G.appendChild(Ee);return $.appendChild(_.el),$.appendChild(G),U.appendChild($),$.addEventListener("focus",()=>{h=E,r.enter(E)}),$.addEventListener("mouseenter",()=>r.enter(E)),$.addEventListener("blur",()=>{h===E&&(h=null),r.leave(E)}),$.addEventListener("mouseleave",()=>r.leave(E)),$.addEventListener("click",()=>r.toggle(E)),{li:U,button:$,avatar:_,name:Oe,meta:ve,badge:Fe,elapsed:ae,fill:ze,calls:De,stats:me,lane:M}},x=(E,M,U)=>{E.lane=M;let{pose:$,ghost:_}=ws(M);E.avatar.set(Ss(M),$,_),E.name.textContent=M.name,E.meta.textContent=`${M.role} \\xB7 ${M.kind}`,vs(E.badge,M),E.elapsed.textContent=Zo(M,U),E.fill.style.width=`${Math.round(Fl(M)*100)}%`,E.calls.textContent=`${M.toolCalls} ${M.toolCalls===1?"call":"calls"}`,E.stats.textContent=`${M.lastTool??"\\u2014"} \\xB7 ${Ye(M.costUsd)}`},S=(E,M)=>{let U=Bl(E.lanes),$=JSON.stringify(U.map(_=>[_.name,_.endState,_.costUsd,_.elapsedMs,_.since]));t.recentGroup.hidden=U.length===0,$!==w&&(w=$,t.recent.replaceChildren(...U.map(_=>{let G=R(e,"li","recent-item"),Y=ks(e,n,o),{pose:Oe,ghost:Fe}=ws(_);Y.set(Ss(_),Oe,Fe);let ve=q(e,{scale:1,color:kt,dpr:o});return vs(ve,_),G.appendChild(Y.el),G.appendChild(R(e,"span","name",_.name)),G.appendChild(ve.el),G.appendChild(R(e,"span","num",Ye(_.costUsd))),G.appendChild(R(e,"span","num",Zo(_,M))),G})))},v={update(E,M){s.set(Il(E.lanes));let U=Pl(E.lanes);for(let G of U){let Y=u.get(G.name);Y||(Y=y(G.name,G),u.set(G.name,Y)),x(Y,G,M)}let $=U.map(G=>G.name);f=wt(t.list,f,$,G=>u.get(G)?.li,h);let _=new Set($);for(let G of[...u.keys()])_.has(G)||u.delete(G);t.empty.hidden=U.length>0,S(E,M),m!==null&&!_.has(m)&&(m=null),v.setPinned(m)},tick(E){for(let M of u.values())M.elapsed.textContent=Zo(M.lane,E)},setPinned(E){m=E;for(let[M,U]of u)U.button.setAttribute("aria-pressed",String(M===E))},order:()=>f,button:E=>u.get(E)?.button};return v}var er=96,Ns=4,$l=.7;function _l(e,t){return e>=t?"hold":e>=$l?"warn":"ok"}var Gl={ok:A.sand,warn:A["gold-2"],hold:A["st-failed"]};function Hl(e){let t=Math.max(0,Math.floor(e)),n=i=>String(i).padStart(2,"0"),o=Math.floor(t/86400),r=Math.floor(t%86400/3600),s=Math.floor(t%3600/60);return o>0?`${o}d ${n(r)}h`:r>0?`${r}h ${n(s)}m`:s>0?`${s}m`:"<1m"}function tr(e,t,n,o){let r=Math.max(0,Math.min(er-1,Math.round(n*er))),s=`hold at ${Math.round(n*100)}%`;if(!t||!Number.isFinite(t.utilization)||t.resetsAt<=o)return{percent:"\\u2014",fill:0,tick:r,level:"ok",title:`${e} window: no current reading \\xB7 ${s}`};let i=Math.max(0,Math.min(1,t.utilization)),a=er/Ns,l=Math.min(a,Math.ceil(i*a))*Ns,c=`${Math.round(t.utilization*100)}%`;return{percent:c,fill:l,tick:r,level:_l(t.utilization,n),title:`${e} window ${c} \\xB7 resets in ${Hl(t.resetsAt-o)} \\xB7 ${s}`}}function nr(e,t,n,o){let r=q(e,{scale:1,color:A.muted,dpr:o,className:"gauge-label"},n.toUpperCase()),s=R(e,"span","gauge-bar"),i=R(e,"span","gauge-fill"),a=R(e,"span","gauge-tick");s.appendChild(i),s.appendChild(a);let l=q(e,{scale:1,color:A.sand,dpr:o,className:"gauge-pct"});return t.replaceChildren(r.el,s,l.el),{update(c){t.setAttribute("title",c.title),t.setAttribute("data-level",c.level),i.style.width=`${c.fill}px`,a.style.left=`${c.tick}px`,l.set(c.percent,c.percent==="\\u2014"?A.muted:Gl[c.level])}}}var Rs=600,Ts=136;function Wl(e){let t=Po(e.lanes);return{atWork:t.running+t.preparing,waiting:t.waiting,asleep:t.asleep,succeeded:t.succeeded,failed:t.failed,treasury:Bo(e.lanes)}}function Yl(e){return 1-(1-e)**3}function Kl(e,t,n,o=Rs){if(!(n<o)||o<=0)return t;let r=Math.max(0,n/o);return e+(t-e)*Yl(r)}function ql(e,t=Rs){let n=[],o=[],r=0,s=i=>o.map((a,l)=>Kl(n[l]??0,a,i-r,t));return{set(i,a){if(i.length===o.length&&i.every((c,u)=>c===o[u]))return;let l=s(a);n=e?[...i]:i.map((c,u)=>l[u]??0),o=[...i],r=a},value:s}}function zl(e){let t=Ke(e);return t*4<=Ts?4:t*3<=Ts?3:2}var cn=e=>Math.round(e??0),jl=[{key:"at-work",label:"AT WORK",icon:"hammer",values:e=>[e.atWork],format:e=>String(cn(e[0])),color:A.text},{key:"waiting",label:"WAITING",icon:"hourglass",values:e=>[e.waiting],format:e=>String(cn(e[0])),color:A.text},{key:"asleep",label:"ASLEEP",icon:"zzz",values:e=>[e.asleep],format:e=>String(cn(e[0])),color:A.text},{key:"finished",label:"FINISHED",icon:"check",values:e=>[e.succeeded,e.failed],format:e=>`\\u2713${cn(e[0])} \\u2717${cn(e[1])}`,color:A.text},{key:"treasury",label:"TREASURY",icon:"coin",values:e=>[e.treasury],format:e=>`$${(e[0]??0).toFixed(2)}`,color:A.gold}];function Vl(e,t){let n=e.format(t);return{text:n,zero:!/[1-9]/.test(n)}}function Ps(e,t,n){let o=jl.map(s=>{let i=R(e,"li","kpi frame");i.setAttribute("data-kpi",s.key);let a=Bn(e,s.icon,2,n.dpr,16),l=q(e,{scale:4,color:A.muted,dpr:n.dpr,className:"kpi-number"}),c=q(e,{scale:1,color:A.muted,dpr:n.dpr,className:"kpi-label"},s.label);return a&&i.appendChild(a),i.appendChild(l.el),i.appendChild(c.el),{spec:s,counter:ql(n.reducedMotion),number:l,li:i}});t.replaceChildren(...o.map(s=>s.li));let r=(s,i)=>{let{text:a,zero:l}=Vl(s.spec,s.counter.value(i));s.li.setAttribute("data-zero",String(l)),s.number.set(a,l?A.muted:s.spec.color,zl(a))};return{update(s,i){let a=Wl(s);for(let l of o)l.counter.set(l.spec.values(a),i),r(l,i)},tick(s){for(let i of o)r(i,s)}}}var Jn=[{key:"lane",label:"lane",numeric:!1},{key:"role",label:"role",numeric:!1},{key:"state",label:"state",numeric:!1},{key:"attempt",label:"attempt",numeric:!0},{key:"calls",label:"calls",numeric:!0},{key:"lastTool",label:"last tool",numeric:!1},{key:"elapsed",label:"elapsed",numeric:!0},{key:"cost",label:"cost",numeric:!0}],Xl={key:"state",dir:"ascending"},Ql={running:0,preparing:1,"waiting-reset":2,held:3,queued:4,orphaned:5,finished:6};function Jl(e){let t=Ql[e.state]??9;return e.state==="finished"&&e.endState!=="success"?t+1:t}function Bs(e,t,n){switch(t){case"lane":return e.name;case"role":return e.role;case"state":return Jl(e);case"attempt":return e.attempt;case"calls":return e.toolCalls;case"lastTool":return e.lastTool;case"elapsed":return yt(e,n);case"cost":return e.costUsd!==null&&Number.isFinite(e.costUsd)?e.costUsd:null}}function Os(e,t){return e<t?-1:e>t?1:0}function Zl(e,t,n){let o=t.dir==="ascending"?1:-1;return[...e].sort((r,s)=>{let i=Bs(r,t.key,n),a=Bs(s,t.key,n);if(i===null||a===null){if(i!==a)return i===null?1:-1}else{let l=Os(i,a);if(l!==0)return o*l}return Os(r.name,s.name)})}function ec(e,t){return e.key===t?{key:t,dir:e.dir==="ascending"?"descending":"ascending"}:{key:t,dir:"ascending"}}function Fs(e,t){let n=yt(e,t);return[e.name,e.role,Xt(e).label,String(e.attempt),String(e.toolCalls),e.lastTool??"\\u2014",n===null?"\\u2014":bt(n),Ye(e.costUsd)]}function Is(e,t,n,o){let r=q(e,{scale:2,color:A.gold,dpr:n},"LEDGER");t.title.replaceChildren(r.el);let s=Xl,i=[],a=0,l=new Map,c=[],u=Jn.map(x=>{let S=R(e,"th",x.numeric?"num":"");S.setAttribute("scope","col");let v=R(e,"button","sort",x.label);return v.setAttribute("type","button"),v.addEventListener("click",()=>y.sortBy(x.key)),S.appendChild(v),{th:S,key:x.key}});t.head.replaceChildren(...u.map(x=>x.th));let f=()=>{for(let x of u)x.th.setAttribute("aria-sort",x.key===s.key?s.dir:"none")};f();let m=(x,S)=>{let v=R(e,"tr"),E=q(e,{scale:1,color:kt,dpr:n,className:"badge"}),M=Jn.map((U,$)=>{let _=R(e,$===0?"th":"td",U.numeric?"num":"");return $===0&&_.setAttribute("scope","row"),U.key==="state"&&_.appendChild(E.el),v.appendChild(_),_});return v.addEventListener("mouseenter",()=>o.enter(x)),v.addEventListener("mouseleave",()=>o.leave(x)),v.addEventListener("click",()=>o.toggle(x)),{tr:v,cells:M,badge:E,lane:S}},h=(x,S)=>{let v=Fs(x.lane,S);Jn.forEach((E,M)=>{if(E.key==="state"){let{tone:$,label:_}=Xt(x.lane);x.badge.el.className=`pxt badge tone-${$}`,x.badge.set(_,Pn($).ink);return}let U=x.cells[M];U&&(U.textContent=v[M]??"")})},w=()=>{let x=Zl(i,s,a).map(S=>S.name);c=wt(t.body,c,x,S=>l.get(S)?.tr)},y={update(x,S){i=x.lanes,a=S;let v=new Set(i.map(E=>E.name));for(let E of i){let M=l.get(E.name);M||(M=m(E.name,E),l.set(E.name,M)),M.lane=E,h(M,S)}w();for(let E of[...l.keys()])v.has(E)||l.delete(E)},tick(x){a=x;let S=Jn.findIndex(v=>v.key==="elapsed");for(let v of l.values()){let E=v.cells[S];E&&(E.textContent=Fs(v.lane,x)[S]??"")}},setPinned(x){for(let[S,v]of l)v.tr.className=S===x?"pinned":""},sort:()=>s,sortBy(x){s=ec(s,x),f(),w()},order:()=>c};return y}function or(e){if(e===null)return-1/0;let t=Date.parse(e);return Number.isFinite(t)?t:-1/0}function Ds(e,t){let n=null,o=-1/0;for(let r of e){let s=t(r);(n===null||s>=o)&&(n=r,o=s)}return n}function tc(e){let t=e.filter(n=>n.landedAt===null);return t.length>0?Ds(t,n=>or(n.updatedAt)):Ds(e,n=>or(n.landedAt))}var nc={done:"\\u2713",failed:"\\u2717",pending:"\\xB7"};function Re(e,t,n){return{label:e,state:t,mark:nc[t],detail:n}}var oc=(e,t)=>`${e} ${t}${e===1?"":"s"}`;function rc(e){return`${e.lenses} ${e.lenses===1?"lens":"lenses"} \\xB7 ${e.confirmed} confirmed \\xB7 ${e.unverified} unverified`}function sc(e,t){let n=e.verify,o=e.ready,r=or(e.landedAt);return[Re("INTEGRATED","done",oc(e.lanes.length,"lane")),n==="passed"?Re("VERIFY","done","passed"):n==="failed"?Re("VERIFY","failed","failed"):Re("VERIFY","pending","not run"),e.review?Re("REVIEW","done",rc(e.review)):Re("REVIEW","pending","not run"),o===!0?Re("READY","done","ready"):o===!1?Re("READY","failed","not ready"):Re("READY","pending","not checked"),e.landedAt!==null?Re("LANDED","done",Number.isFinite(r)?xt(t-r):"landed"):Re("LANDED","pending","not landed")]}var Us={done:A.gold,failed:A["st-failed"],pending:A.faint};function $s(e,t,n){let o=q(e,{scale:2,color:A.gold,dpr:n},"MONUMENT");t.title.replaceChildren(o.el);let r=R(e,"p","monument-head"),s=R(e,"span","name"),i=R(e,"code","sha");r.appendChild(s),r.appendChild(i);let a=R(e,"ol","stepper"),l=[0,1,2,3,4].map(()=>{let u=R(e,"li","step"),f=q(e,{scale:1,color:A.faint,dpr:n,className:"node"}),m=q(e,{scale:1,color:A.faint,dpr:n,className:"step-label"}),h=R(e,"span","detail");return u.appendChild(f.el),u.appendChild(m.el),u.appendChild(h),a.appendChild(u),{li:u,mark:f,label:m,detail:h}}),c=R(e,"p","empty","No integration yet.");return t.body.replaceChildren(r,a,c),{update(u,f){let m=tc(u.integrations);r.hidden=m===null,a.hidden=m===null,c.hidden=m!==null,m&&(s.textContent=m.name,i.textContent=m.headSha.slice(0,7),sc(m,f).forEach((h,w)=>{let y=l[w];y&&(y.li.setAttribute("data-state",h.state),y.mark.set(h.mark,Us[h.state]),y.label.set(h.label,Us[h.state]),y.detail.textContent=h.detail)}))}}}var Zn="This session ended or restarted. Use the tab the new `arbab ui` opened, or the URL it printed.",_s="This page is one too many: arbab ui serves 16 at once. Close another of its tabs and reload.",Gs="arbab ui is not running.";function rr(e){return e===null?Gs:e.status===200?_s:Zn}function Hs(e){switch(e){case"live":return{text:"LIVE",color:A["st-success"]};case"lost":return{text:"RECONNECTING",color:A["st-waiting"]};case"closed":return{text:"OFFLINE",color:A["st-failed"]};default:return{text:"CONNECTING",color:A.muted}}}var to={header:"top",logo:"logo",title:"title",project:"project",version:"version",gauge5h:"gauge-5h",gauge7d:"gauge-7d",held:"held",connection:"connection",sound:"sound",banner:"banner",kpis:"kpis",site:"site",siteTitle:"site-title",siteFullscreen:"site-fullscreen",stage:"stage",canvas:"scene",titleCard:"title-card",titleCardLogo:"title-card-logo",titleCardWord:"title-card-word",tooltip:"tooltip",notice:"notice",caption:"caption",crewPanel:"crew-panel",crewTitle:"crew-title",crewScroll:"crew-scroll",crew:"crew",crewEmpty:"crew-empty",recentGroup:"recent-group",recentTitle:"recent-title",recent:"recent",monumentTitle:"monument-title",monument:"monument",chronicleTitle:"chronicle-title",chronicle:"chronicle",chronicleEmpty:"chronicle-empty",ledgerTitle:"ledger-title",ledgerHead:"ledger-head",table:"lanes",footer:"footer",live:"live"},B=to,qf=`<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="robots" content="noindex">\n<meta name="color-scheme" content="dark">\n<title>arbab \\xB7 pyramid</title>\n<link rel="icon" href="${nt.icon}" type="image/svg+xml">\n<link rel="stylesheet" href="${nt.style}">\n<script src="${nt.script}" defer><\\/script>\n</head>\n<body>\n<header id="${B.header}" class="topbar">\n<div class="brand">\n<canvas id="${B.logo}" class="px logo" width="32" height="32" aria-hidden="true"></canvas>\n<h1 id="${B.title}" class="wordmark">arbab</h1>\n<p class="project"><span id="${B.project}">connecting\\u2026</span> <span id="${B.version}" class="version"></span></p>\n</div>\n<div class="status">\n<div class="gauges">\n<div id="${B.gauge5h}" class="gauge" data-level="ok"></div>\n<div id="${B.gauge7d}" class="gauge" data-level="ok"></div>\n</div>\n<div class="controls">\n<span id="${B.held}" class="pill held" hidden>held</span>\n<span id="${B.connection}" class="pill connection" data-state="connecting">connecting</span>\n<button id="${B.sound}" type="button" aria-pressed="false">sound</button>\n</div>\n</div>\n</header>\n<p id="${B.banner}" class="banner" role="alert" hidden></p>\n<main class="hud">\n<section class="kpi-row" aria-labelledby="kpi-heading">\n<h2 id="kpi-heading" class="visually-hidden">Lanes at a glance</h2>\n<ul id="${B.kpis}" class="kpis"></ul>\n</section>\n<div class="grid">\n<section id="${B.site}" class="frame panel site" aria-labelledby="${B.siteTitle}">\n<div class="titlebar">\n<h2 id="${B.siteTitle}">The site</h2>\n<button id="${B.siteFullscreen}" type="button" class="small" aria-controls="${B.site}">full screen</button>\n</div>\n<div id="${B.stage}" class="stage">\n<canvas id="${B.canvas}" width="480" height="270" role="img" aria-label="The pyramid scene: each lane is a worker building a block, and arbab hands out the work. The crew, the chronicle and the ledger say the same in text."></canvas>\n<div id="${B.titleCard}" class="title-card" aria-hidden="true">\n<canvas id="${B.titleCardLogo}" class="px" width="64" height="64"></canvas>\n<div id="${B.titleCardWord}" class="title-card-word">ARBAB</div>\n<p class="awakens">the site awakens\\u2026</p>\n</div>\n<div id="${B.tooltip}" class="tooltip frame" role="tooltip" hidden></div>\n<div id="${B.notice}" class="notice" hidden></div>\n</div>\n<p id="${B.caption}" class="caption">THE SITE IS QUIET</p>\n</section>\n<aside class="side" aria-label="Crew and monument">\n<section id="${B.crewPanel}" class="frame panel crew-panel" aria-labelledby="${B.crewTitle}" data-more="false">\n<div class="titlebar"><h2 id="${B.crewTitle}">Crew</h2></div>\n<div id="${B.crewScroll}" class="crew-scroll">\n<ul id="${B.crew}" class="crew"></ul>\n<div id="${B.crewEmpty}" class="crew-empty"></div>\n<details id="${B.recentGroup}" class="recent-group" hidden>\n<summary id="${B.recentTitle}">Recently finished</summary>\n<ul id="${B.recent}" class="recent"></ul>\n</details>\n</div>\n</section>\n<section class="frame panel monument-panel" aria-labelledby="${B.monumentTitle}">\n<div class="titlebar"><h2 id="${B.monumentTitle}">Monument</h2></div>\n<div id="${B.monument}" class="monument"></div>\n</section>\n</aside>\n</div>\n<div class="below">\n<section class="frame panel" aria-labelledby="${B.chronicleTitle}">\n<div class="titlebar"><h2 id="${B.chronicleTitle}">Chronicle</h2></div>\n<ol id="${B.chronicle}" class="chronicle"></ol>\n<p id="${B.chronicleEmpty}" class="empty">Nothing has happened yet.</p>\n</section>\n<section class="frame panel" aria-labelledby="${B.ledgerTitle}">\n<div class="titlebar"><h2 id="${B.ledgerTitle}">Ledger</h2></div>\n<div class="table-wrap">\n<table aria-labelledby="${B.ledgerTitle}">\n<thead><tr id="${B.ledgerHead}"><th scope="col">lane</th><th scope="col">role</th><th scope="col">state</th><th scope="col">attempt</th><th scope="col">calls</th><th scope="col">last tool</th><th scope="col">elapsed</th><th scope="col">cost</th></tr></thead>\n<tbody id="${B.table}"></tbody>\n</table>\n</div>\n</section>\n</div>\n</main>\n<footer>\n<p id="${B.footer}">Read-only</p>\n</footer>\n<div id="${B.live}" class="visually-hidden" aria-live="polite"></div>\n</body>\n</html>\n`,Ws=(e,t="")=>e.map(([n,o])=>`  --${t}${n}: ${o};`).join(`\n`),eo=(e,t,n="var(--frame-hi)",o="var(--frame-lo)")=>`0 -${e}px 0 0 var(--frame-dark), 0 ${e}px 0 0 var(--frame-dark), -${e}px 0 0 0 var(--frame-dark), ${e}px 0 0 0 var(--frame-dark),\n    inset ${t}px ${t}px 0 0 ${n}, inset -${t}px -${t}px 0 0 ${o}`,zf=`:root {\n  color-scheme: dark;\n${Ws(Object.entries(A))}\n${Ws(Object.entries(Do),"chip-")}\n  --s1: 4px;\n  --s2: 8px;\n  --s3: 12px;\n  --s4: 16px;\n  --s5: 20px;\n  --s6: 24px;\n  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;\n  font-size: 14px;\n  font-variant-numeric: tabular-nums;\n}\n* { box-sizing: border-box; }\nbody {\n  margin: 0; color: var(--text); line-height: 1.45;\n  background: radial-gradient(ellipse 120% 60% at 50% -10%, #2a1d12 0, var(--bg) 70%) fixed, var(--bg);\n}\np { margin: 0; }\ncode { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--sand); }\ncanvas.px { display: inline-block; vertical-align: middle; image-rendering: crisp-edges; image-rendering: pixelated; }\n.pxt { display: inline-flex; align-items: center; line-height: 0; }\n:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }\n.visually-hidden {\n  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0;\n  overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;\n}\n[hidden] { display: none !important; }\n\n/* Pixel frames: square, notched corners; never rounded. */\n.frame {\n  margin: var(--s1); background: var(--panel); border-radius: 0;\n  box-shadow: ${eo(4,2)};\n}\nbutton {\n  font: inherit; font-size: 13px; color: var(--text); background: var(--panel-2); border: 0; border-radius: 0;\n  margin: 2px; padding: var(--s1) 10px; cursor: pointer; white-space: nowrap;\n  box-shadow: ${eo(2,2)};\n}\nbutton:hover { background: var(--panel-hi); }\nbutton:active, button[aria-pressed="true"] {\n  color: var(--gold); background: var(--panel);\n  box-shadow: ${eo(2,2,"var(--frame-lo)","var(--frame-hi)")};\n}\nbutton.small { font-size: 12px; padding: 2px var(--s2); }\n\n/* Top bar */\n.topbar {\n  position: sticky; top: 0; z-index: 10; height: 56px; display: flex; align-items: center; gap: var(--s4);\n  padding: 0 var(--s4); background: var(--bg-2); border-bottom: 2px solid var(--frame);\n  box-shadow: 0 2px 0 0 var(--frame-dark);\n}\n.brand { display: flex; align-items: center; gap: var(--s3); min-width: 0; }\n.logo { width: 32px; height: 32px; }\nh1 { margin: 0; font-size: 18px; line-height: 0; color: var(--gold); }\n.project { color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n#${B.project} { color: var(--text); font-weight: 600; }\n.version { color: var(--muted); }\n.status, .gauges, .controls { display: flex; align-items: center; gap: var(--s3); min-width: 0; }\n.status { margin-left: auto; }\n.gauge { display: flex; align-items: center; gap: 6px; --level: var(--sand); }\n.gauge[data-level="warn"] { --level: var(--gold-2); }\n.gauge[data-level="hold"] { --level: var(--st-failed); }\n.gauge-bar {\n  position: relative; width: 96px; height: 10px; background: var(--frame-dark);\n  box-shadow: 0 0 0 1px var(--frame-lo);\n}\n.gauge-fill {\n  position: absolute; left: 0; top: 0; bottom: 0; width: 0;\n  background: repeating-linear-gradient(90deg, var(--level) 0 3px, transparent 3px 4px);\n}\n.gauge-tick { position: absolute; top: -2px; bottom: -2px; width: 1px; background: var(--text); }\n.pill {\n  display: inline-flex; align-items: center; gap: 6px; padding: 3px var(--s2); margin: 2px; line-height: 0;\n  background: var(--panel); box-shadow: ${eo(2,1)}; font-size: 12px;\n}\n.pill.held { line-height: 1; color: var(--bg); background: var(--st-waiting); font-weight: 700; text-transform: uppercase; }\n.connection::before { content: ""; width: 6px; height: 6px; background: var(--muted); }\n.connection[data-state="live"]::before { background: var(--st-success); animation: pulse 2s steps(4) infinite; }\n.connection[data-state="lost"]::before { background: var(--st-waiting); }\n.connection[data-state="closed"]::before { background: var(--st-failed); }\n@keyframes pulse { 50% { opacity: 0.3; } }\n.banner { padding: var(--s2) var(--s4); background: var(--st-failed); color: #fff; font-weight: 600; }\n\n/* The dashboard. Its vertical spacing around the scene card is PAGE_GAPS in hud.ts: keep the two in step. */\n.hud { display: grid; gap: var(--s3); padding: var(--s3) var(--s4) var(--s4); max-width: 1880px; margin: 0 auto; }\n.grid, .side, .below { display: grid; gap: var(--s3); grid-template-columns: minmax(0, 1fr); align-items: start; }\n.hud > *, .grid > *, .side > *, .below > * { min-width: 0; }\n.side { align-content: start; }\n@media (min-width: 900px) {\n  .side { grid-template-columns: repeat(2, minmax(0, 1fr)); }\n  .below { grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); }\n}\n@media (min-width: 1280px) {\n  .grid { grid-template-columns: minmax(0, 1fr) 360px; align-items: stretch; }\n  /* As tall as the scene card and no taller: size containment keeps the crew from stretching the row. The items\n     stretch, so the crew panel fills the first row instead of shrinking to its title around a zero-basis list. */\n  .side { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; align-content: stretch; align-items: stretch; contain: size; }\n  .crew-panel { display: flex; flex-direction: column; min-height: 0; }\n  .crew-panel > .titlebar { flex: none; }\n  .crew-panel .crew-scroll { flex: 1 1 0; min-height: 0; max-height: none; overflow-y: auto; }\n}\n.panel { padding: var(--s3); min-width: 0; }\n.titlebar {\n  display: flex; align-items: center; justify-content: space-between; gap: var(--s2);\n  min-height: 30px; margin-bottom: var(--s3); padding-bottom: var(--s2); border-bottom: 2px solid var(--frame-lo);\n}\nh2 { margin: 0; font-size: 14px; line-height: 0; color: var(--gold); }\n.empty { color: var(--muted); padding: var(--s2) 0; }\n\n/* KPI cards */\n.kpis { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s3); grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); }\n.kpi { display: grid; grid-template-columns: 16px minmax(0, 1fr); grid-template-areas: "icon label" "num num"; gap: var(--s2) var(--s2); align-items: center; padding: var(--s3) 14px; }\n.kpi .icon { grid-area: icon; width: 16px; height: 16px; }\n.kpi .kpi-label { grid-area: label; }\n.kpi .kpi-number { grid-area: num; min-height: 44px; }\n/* Wide: one row per card (icon, label, number), so the KPI row leaves the scene its height. */\n@media (min-width: 1280px) {\n  .kpi { grid-template-columns: 16px auto minmax(0, 1fr); grid-template-areas: "icon label num"; padding: var(--s2) 14px; }\n  .kpi .kpi-number { justify-self: end; }\n}\n\n/* The scene card: lean chrome, so 3\\xD7 fits a 1080-px screen (stageRoom in hud.ts measures it). */\n.site { padding: var(--s2); }\n.site .titlebar { min-height: 28px; margin-bottom: var(--s2); padding-bottom: 6px; }\n.stage {\n  position: relative; display: flex; align-items: center; justify-content: center; min-width: 0; overflow: hidden;\n  background-color: var(--frame-dark);\n  background-image:\n    repeating-linear-gradient(45deg, rgb(255 255 255 / 0.025) 0 2px, transparent 2px 8px),\n    repeating-linear-gradient(-45deg, rgb(0 0 0 / 0.25) 0 2px, transparent 2px 8px),\n    radial-gradient(ellipse at center, var(--bg-2) 0, var(--frame-dark) 80%);\n  box-shadow: inset 0 0 0 2px var(--frame-lo);\n}\n#${B.canvas} { display: block; flex: none; width: 480px; height: 270px; image-rendering: crisp-edges; image-rendering: pixelated; }\n/* Below 1\\xD7: the stage\'s width, the height by the art\'s aspect ratio. */\n#${B.canvas}.fluid { flex: 1 1 auto; max-width: 100%; aspect-ratio: 480 / 270; }\n.caption {\n  display: flex; justify-content: center; min-height: 27px; margin-top: 6px; padding: var(--s2);\n  line-height: 0; color: var(--sand); background: var(--bg-2); box-shadow: inset 0 0 0 2px var(--frame-lo);\n}\n.site:fullscreen { margin: 0; width: 100vw; height: 100vh; display: flex; flex-direction: column; background: var(--bg); box-shadow: none; }\n.site:fullscreen .stage { flex: 1; min-height: 0; }\n.title-card {\n  position: absolute; inset: 0; z-index: 3; display: flex; flex-direction: column; align-items: center; justify-content: center;\n  gap: var(--s4); background: radial-gradient(ellipse at center, var(--panel) 0, var(--bg) 75%);\n  transition: opacity 0.6s steps(6), visibility 0s linear 0.6s;\n}\n.title-card.gone { opacity: 0; visibility: hidden; }\n.title-card-word { line-height: 0; color: var(--gold); font-size: 32px; }\n.awakens { color: var(--muted); font-style: italic; }\n.tooltip { position: absolute; z-index: 4; pointer-events: none; min-width: 190px; max-width: 320px; padding: 10px 12px; font-size: 13px; }\n.tooltip .tip-title { margin-bottom: 6px; line-height: 0; }\n.tooltip div + div { color: var(--muted); }\n.notice {\n  position: absolute; inset: 0; z-index: 5; display: grid; place-items: center; padding: var(--s4); text-align: center;\n  background: rgb(18 13 10 / 0.94); font-size: 15px;\n}\n\n/* Crew: the list scrolls inside its panel, with a fade at the bottom edge while there is more below. */\n.crew-panel { position: relative; }\n.crew-scroll { min-height: 0; max-height: 640px; overflow: auto; }\n.crew-panel[data-more="true"]::after {\n  content: ""; position: absolute; left: var(--s3); right: var(--s3); bottom: var(--s3); height: 36px; pointer-events: none;\n  background: linear-gradient(to bottom, transparent, var(--panel));\n}\n.crew { list-style: none; margin: 0; padding: 2px; display: grid; gap: var(--s3); }\n.card {\n  width: calc(100% - 4px); display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 10px; align-items: start;\n  padding: var(--s2); text-align: left; white-space: normal; font-size: 14px; color: var(--text); background: var(--panel-2);\n}\n.card[aria-pressed="true"] { color: var(--text); }\n.card[aria-pressed="true"] .name { color: var(--gold); }\n.tile {\n  display: grid; place-items: end center; width: 44px; height: 62px; padding-bottom: var(--s1);\n  background: color-mix(in srgb, var(--chip, var(--frame)) 38%, var(--bg-2)); box-shadow: inset 0 0 0 2px var(--frame-dark);\n}\n.tile .avatar { width: 36px; height: 54px; }\n.tile-arbab { flex: none; width: 56px; height: 86px; background: var(--bg-2); }\n.tile-arbab .avatar { width: 48px; height: 78px; }\n.tile.ghost .avatar { opacity: 0.75; }\n${Object.keys(Do).map(e=>`.cast-${e} { --chip: var(--chip-${e}); }`).join(`\n`)}\n.card-body { display: grid; gap: 3px; min-width: 0; }\n.card-head, .card-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--s2); min-width: 0; }\n.name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.meta, .stats, .calls, .elapsed, .num { color: var(--muted); font-size: 13px; }\n.stats { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.elapsed, .calls { white-space: nowrap; }\n.progress { display: flex; align-items: center; gap: var(--s2); }\n.bar { position: relative; flex: 1; height: 8px; overflow: hidden; background: var(--frame-dark); box-shadow: 0 0 0 1px var(--frame-lo); }\n.bar-fill {\n  position: absolute; left: 0; top: 0; bottom: 0; width: 0;\n  background: repeating-linear-gradient(90deg, var(--gold) 0 4px, var(--gold-2) 4px 5px, var(--frame-dark) 5px 6px);\n}\n.badge { display: inline-flex; align-items: center; flex: none; padding: 2px var(--s1); background: var(--tone, var(--st-orphaned)); box-shadow: 0 0 0 1px var(--frame-dark); }\n${["running","preparing","waiting","asleep","success","orphaned"].map(e=>`.tone-${e} { --tone: var(--st-${e}); }`).join(`\n`)}\n.tone-failed { --tone: var(--badge-failed); }\n.crew-empty { display: flex; align-items: center; gap: var(--s3); padding: var(--s2) 0; }\n.empty-lead { font-weight: 600; }\n.empty-hint { color: var(--muted); font-size: 13px; }\n.recent-group { margin-top: var(--s3); }\n.recent-group summary { cursor: pointer; padding: var(--s1) 0; line-height: 0; }\n.recent { list-style: none; margin: var(--s2) 0 0; padding: 0; display: grid; gap: var(--s1); }\n.recent-item { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto auto auto; gap: var(--s2); align-items: center; }\n.recent-item .tile { height: 44px; overflow: hidden; }\n\n/* Monument */\n.monument-head { display: flex; align-items: baseline; gap: var(--s2); margin-bottom: 10px; }\n.stepper { list-style: none; margin: 0; padding: 0; }\n.step { position: relative; display: grid; grid-template-columns: 20px auto minmax(0, 1fr); gap: 10px; align-items: center; padding: 6px 0; }\n.step + .step::before { content: ""; position: absolute; left: 9px; top: -8px; width: 2px; height: 16px; background: var(--frame-lo); }\n.step[data-state="done"] + .step::before { background: var(--gold-2); }\n.node {\n  position: relative; z-index: 1; justify-content: center; width: 20px; height: 20px; background: var(--bg-2);\n  box-shadow: 0 0 0 2px var(--frame-dark), inset 0 0 0 2px var(--frame-lo);\n}\n.step[data-state="done"] .node { box-shadow: 0 0 0 2px var(--frame-dark), inset 0 0 0 2px var(--gold-2); }\n.step[data-state="failed"] .node { box-shadow: 0 0 0 2px var(--frame-dark), inset 0 0 0 2px var(--st-failed); }\n.detail { color: var(--muted); font-size: 13px; text-align: right; }\n\n/* Chronicle */\n.chronicle { list-style: none; margin: 0; padding: 0; max-height: 380px; overflow: auto; }\n.chronicle-line {\n  display: grid; grid-template-columns: 12px minmax(0, 1fr) auto; gap: var(--s2); align-items: center;\n  padding: 5px var(--s1); border-bottom: 1px solid var(--frame-lo);\n}\n.chronicle-line .ago { color: var(--muted); font-size: 12px; white-space: nowrap; }\n.chronicle-line.enter { animation: slide-in 0.4s steps(5) both; }\n@keyframes slide-in { from { transform: translateX(-16px); opacity: 0; } to { transform: none; opacity: 1; } }\n\n/* Ledger */\n.table-wrap { max-height: 380px; overflow: auto; box-shadow: inset 0 0 0 1px var(--frame-lo); }\ntable { border-collapse: separate; border-spacing: 0; width: 100%; font-size: 13px; }\nthead th { position: sticky; top: 0; z-index: 1; padding: 0; text-align: left; background: var(--panel-hi); border-bottom: 2px solid var(--frame-dark); }\nthead th.num { text-align: right; }\nbutton.sort {\n  width: 100%; margin: 0; padding: 6px var(--s2); text-align: inherit; font-size: 12px; font-weight: 600;\n  color: var(--muted); background: transparent; box-shadow: none; text-transform: uppercase; letter-spacing: 0.04em;\n}\nbutton.sort:hover { color: var(--text); }\nth[aria-sort="ascending"] .sort, th[aria-sort="descending"] .sort { color: var(--gold); }\nth[aria-sort="ascending"] .sort::after { content: " \\u25B2"; }\nth[aria-sort="descending"] .sort::after { content: " \\u25BC"; }\ntbody th, tbody td { padding: 5px var(--s2); text-align: left; font-weight: 400; white-space: nowrap; border-bottom: 1px solid var(--frame-lo); }\ntbody th { font-weight: 600; }\ntbody tr { cursor: pointer; }\ntbody tr:nth-child(even) { background: var(--panel-2); }\ntbody tr:hover, tbody tr.pinned { background: var(--panel-hi); }\ntbody tr.pinned th { color: var(--gold); }\ntbody .num { text-align: right; color: var(--text); }\n\nfooter { padding: 0 var(--s4) var(--s4); color: var(--muted); font-size: 13px; text-align: center; }\n\n@media (max-width: 899px) {\n  .topbar { height: auto; min-height: 56px; flex-wrap: wrap; padding: var(--s2) var(--s4); }\n  .status { flex-wrap: wrap; }\n}\n/* Narrow (a phone): nothing wider than the screen. The top bar stacks its rows: the logo, the gauges, the buttons. */\n@media (max-width: 599px) {\n  .topbar { flex-direction: column; align-items: stretch; gap: var(--s2); }\n  .status { margin-left: 0; flex-direction: column; align-items: flex-start; gap: var(--s2); }\n  .gauges, .controls { flex-wrap: wrap; }\n  .hud { padding: var(--s2); }\n  .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }\n  .card-head, .card-foot { flex-wrap: wrap; }\n  .recent-item { grid-template-columns: 44px minmax(0, 1fr) auto; }\n}\n@media (prefers-reduced-motion: reduce) {\n  *, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }\n}\n`;function Ks(e){let t="",n=null,o=0,r=0,s=(i,a,l,c,u)=>{let f=n?n(u):u,m=Math.round(i)+o,h=Math.round(a)+r,w=m+Math.round(l),y=h+Math.round(c);m=Math.max(0,m),h=Math.max(0,h),w=Math.min(480,w),y=Math.min(270,y),!(w<=m||y<=h)&&(f!==t&&(e.fillStyle=f,t=f),e.fillRect(m,h,w-m,y-h))};return{rect:s,rects(i,a=0,l=0){for(let c of i)s(c.x+a,c.y+l,c.w,c.h,c.color)},sprite(i,a,l,c=!1){for(let u of c?i.mirrored:i.runs)s(a+u.x,l+u.y,u.w,1,u.color)},alpha(i){e.globalAlpha=Math.min(1,Math.max(0,Number.isFinite(i)?i:1))},tint(i){n=i},offset(i,a){o=Number.isFinite(i)?Math.round(i):0,r=Number.isFinite(a)?Math.round(a):0},text(i,a,l,c){let u=n?n(c):c;return t=u,On(e,i,Math.round(a)+o,Math.round(l)+r,u,1)}}}var ic={day:null,dusk:{color:"#B04A64",amount:.3},night:{color:"#16286A",amount:.58}},Ys=new Map;function Pt(e){let t=ic[e];if(!t)return null;let n=Ys.get(e);if(!n){let o=new Map;n=r=>{let s=o.get(r);return s===void 0&&(s=W(r,t.color,t.amount),o.set(r,s)),s},Ys.set(e,n)}return n}function Z(e){let t=e>>>0;return()=>{t=t+1831565813>>>0;let n=t;return n=Math.imul(n^n>>>15,n|1),n^=n+Math.imul(n^n>>>7,n|61),((n^n>>>14)>>>0)/4294967296}}var ac=[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];function lc(e,t){return ac[t&3]?.[e&3]??0}function ee(e,t,n){return lc(e,t)<n*16}function te(e){return Number.isFinite(e)&&e>0?e:0}function no(e,t){return(e%t+t)%t}var ue=class{constructor(t,n){gt(this,"width");gt(this,"height");gt(this,"cells");gt(this,"palette",[]);gt(this,"index",new Map);this.width=t,this.height=n,this.cells=new Int32Array(t*n).fill(-1)}set(t,n,o){let r=Math.round(t),s=Math.round(n);if(r<0||s<0||r>=this.width||s>=this.height)return;let i=this.index.get(o);i===void 0&&(i=this.palette.length,this.palette.push(o),this.index.set(o,i)),this.cells[s*this.width+r]=i}get(t,n){if(t<0||n<0||t>=this.width||n>=this.height)return null;let o=this.cells[n*this.width+t]??-1;return o<0?null:this.palette[o]??null}fill(t,n,o,r,s){for(let i=n;i<n+r;i++)for(let a=t;a<t+o;a++)this.set(a,i,s)}runs(t=null,n=0,o=0){let r=[],s=i=>{let a=this.palette[i]??"#000000";return t?t(a):a};for(let i=0;i<this.height;i++){let a=i*this.width,l=0;for(;l<this.width;){if((this.cells[a+l]??-1)<0){l++;continue}let c=l;for(;c<this.width&&(this.cells[a+c]??-1)>=0;)c++;let u=new Map;for(let w=l;w<c;w++){let y=this.cells[a+w]??-1;(w===l||this.cells[a+w-1]!==y)&&u.set(y,(u.get(y)??0)+1)}let f=-1,m=1;for(let[w,y]of u)y>m&&(m=y,f=w);f>=0&&r.push({x:l+n,y:i+o,w:c-l,h:1,color:s(f)});let h=l;for(;h<c;){let w=this.cells[a+h]??-1;if(w===f){h++;continue}let y=h+1;for(;y<c&&this.cells[a+y]===w;)y++;r.push({x:h+n,y:i+o,w:y-h,h:1,color:s(w)}),h=y}l=c}}return r}};function ke(e,t,n,o,r){for(let s=-o;s<=o;s++){let i=Math.floor(Math.sqrt((o+.5)**2-s*s));e.push({x:t-i,y:n+s,w:i*2+1,h:1,color:r})}}function Bt(e,t,n,o,r,s,i){for(let a=-r;a<=r;a++)for(let l=-r;l<=r;l++){let c=Math.sqrt(l*l+a*a);if(c<o-.5||c>r+.5)continue;let u=r===o?1:1-(c-o)/(r-o+1);ee(t+l,n+a,s*u)&&e.push({x:t+l,y:n+a,w:1,h:1,color:i})}}function qs(e,t){let n=[];for(let o=-t;o<=t;o++){let r=t===0?0:o/(t+.5),s=Math.round(e*Math.sqrt(Math.max(0,1-r*r)));s<=0||(n.push({dx:-s,dy:o,w:s*2}),(o&1)===0&&n.push({dx:-s-1,dy:o,w:1},{dx:s,dy:o,w:1}))}return n}function so(e){let n=40+400*(Number.isFinite(e)?Math.min(1,Math.max(0,e)):.5);return{x:n,y:26+86/200**2*(n-240)**2}}var oe={x:400,y:30};function cc(e){let t=Math.min(1,Math.max(0,(112-e)/86)),n=Math.round(t**.8*24)/24;return{core:W(_n.core,Gn.core,n),rim:W(_n.rim,Gn.rim,n),halo:W(_n.halo,Gn.halo,n)}}function uc(e){let t=[];for(let n=1;n<e;n++)t.push(Math.round(128*(n/e)**.78));return t}var zs=new Map,Ot=6;function dc(e,t,n,o,r){for(let s=o;s<r;s++){let i=n.findIndex(m=>s<m);i<0&&(i=t.length-1);let a=t[i]??"#000000",l=null,c=0,u=n[i],f=i>0?n[i-1]:void 0;u!==void 0&&u-s<=Ot/2?(l=t[i+1]??a,c=(Ot/2-(u-s)+.5)/Ot):f!==void 0&&s-f<Ot/2&&(l=t[i-1]??a,c=(Ot/2-(s-f)-.5)/Ot),l&&c>.5&&([a,l,c]=[l,a,1-c]);for(let m=0;m<480;m++)e.set(m,s,l&&ee(m,s,c)?l:a)}}function fc(e){let t=zs.get(e);if(t)return t;let n=At[e],o=new ue(480,128);dc(o,n,uc(n.length),0,128),e==="night"&&pc(o);let r=o.runs();return zs.set(e,r),r}function pc(e){let t=Z(4242);for(let n=0;n<520;n++){let o=t(),r=Math.floor(o*480),s=(t()+t()+t()-1.5)*14,i=Math.round(8+o*70+s+6*Math.sin(o*7));if(i<0||i>=100)continue;let a=e.get(r,i);if(!a)continue;let l=Math.abs(s)<6;e.set(r,i,W(a,J.dim,l?.32:.18))}}var js=new Map;function mc(e){let t=`${e.core}${e.rim}`,n=js.get(t);if(!n){let o=[];ke(o,0,0,14,e.halo),Bt(o,0,0,15,19,.5,e.halo);let r=[];ke(r,0,0,11,e.halo),Bt(r,0,0,12,13,.5,e.rim);let s=[];ke(s,0,0,9,e.rim);let i=[];ke(i,0,0,7,e.rim),ke(i,0,0,6,e.core),i.push({x:-3,y:-4,w:4,h:1,color:e.rim},{x:-4,y:-3,w:3,h:2,color:e.rim}),n={inner:s,mid:r,outer:o,body:i},js.set(t,n)}return n}function hc(e,t){let n=so(t),o=Math.round(n.x),r=Math.round(n.y),s=mc(cc(n.y));e.alpha(.14),e.rects(s.outer,o,r),e.alpha(1),e.alpha(.22),e.rects(s.mid,o,r),e.alpha(1),e.alpha(.4),e.rects(s.inner,o,r),e.alpha(1),e.rects(s.body,o,r)}var gc=(()=>{let e=[];return ke(e,oe.x,oe.y,11,"#B9C3E6"),Bt(e,oe.x,oe.y,12,15,.5,"#B9C3E6"),e})(),bc=(()=>{let e=[];ke(e,oe.x,oe.y,7,Ho);for(let t=-6;t<=6;t++){let n=Math.floor(Math.sqrt(56.25-t*t));e.push({x:oe.x+n-1,y:oe.y+t,w:2,h:1,color:Jt})}return e.push({x:oe.x+1,y:oe.y-3,w:2,h:2,color:Jt},{x:oe.x-3,y:oe.y+1,w:3,h:2,color:Jt},{x:oe.x+3,y:oe.y+3,w:1,h:1,color:Jt},{x:oe.x-4,y:oe.y-4,w:2,h:1,color:"#F6F4EA"}),e})();function yc(e){e.alpha(.1),e.rects(gc),e.alpha(1),e.rects(bc)}var io=(()=>{let e=Z(1907),t=[];for(let n=0;n<90;n++){let o=Math.floor(e()*480),r=2+Math.floor(e()**1.3*98),s=e(),i=s<.45?0:s<.8?1:s<.95?2:3,l=e()<.3?1.6+e()*2.6:0,c=e()*Math.PI*2;Math.abs(o-oe.x)<14&&Math.abs(r-oe.y)<14||t.push({x:o,y:r,level:i,speed:l,phase:c})}return t})();function xc(e,t){let n=io[e];if(!n)return-1;if(n.speed===0)return n.level;let o=Math.sin(te(t)*n.speed+n.phase);return Math.max(-1,Math.min(3,n.level+(o>.55?1:o<-.55?-1:0)))}var op=io.length,wc=(()=>{let e=[];for(let t of io)t.speed===0&&Qs(e,t.x,t.y,t.level);return e})();function Qs(e,t,n,o){if(o<0)return;let r=o===0?J.dim:o===1?J.mid:J.bright;e.push({x:t,y:n,w:1,h:1,color:r}),o>=3&&e.push({x:t-1,y:n,w:1,h:1,color:J.mid},{x:t+1,y:n,w:1,h:1,color:J.mid},{x:t,y:n-1,w:1,h:1,color:J.mid},{x:t,y:n+1,w:1,h:1,color:J.mid})}function kc(e,t){e.rects(wc);let n=[];io.forEach((o,r)=>{o.speed!==0&&Qs(n,o.x,o.y,xc(r,t))}),e.rects(n)}var oo={every:40,lasts:.6};function Sc(e){let t=te(e),n=t%oo.every;if(n>=oo.lasts)return null;let o=Z(Math.floor(t/oo.every)*7919+13),r=o()<.5?-1:1,s=90+Math.floor(o()*260),i=8+Math.floor(o()*30),a=n/oo.lasts,l=84*a;return{x:Math.round(s+r*l),y:Math.round(i+l*.42),dir:r,progress:a}}var Vs=["#FFFFFF",J.bright,J.bright,J.mid,J.mid,J.mid,J.dim,J.dim,J.dim,J.dim,J.dim,J.dim];function vc(e,t){let n=Sc(t);if(!n)return;let o=Math.min(Vs.length,3+Math.round(n.progress*22)),r=n.progress>.8?(1-n.progress)/.2:1;r<1&&e.alpha(r);for(let s=o-1;s>=0;s--){let i=n.x-n.dir*s,a=Math.round(n.y-s*.42);e.rect(i,a,1,1,Vs[s]??J.dim)}e.rect(n.x,n.y+1,1,1,J.mid),r<1&&e.alpha(1)}var ro=[{speed:2,count:4,minW:24,maxW:34,y0:70,y1:90,alpha:.7},{speed:4,count:3,minW:32,maxW:46,y0:42,y1:62,alpha:.88},{speed:6,count:2,minW:44,maxW:56,y0:10,y1:30,alpha:1}],sr=600;function Ec(e,t){let n=Z(t),o=4+Math.floor(e/18),r=Math.floor(o*.4+n()*1.2),s=[];for(let y=0;y<o;y++)s.push(Math.max(.35,1-Math.abs(y-r)*(.22+n()*.12))*(.85+n()*.3));let i=[],a=s[0]??1;s.forEach((y,x)=>{x>0&&(a+=.65*((s[x-1]??y)+y)),i.push(a)});let l=a+(s[o-1]??1),c=(e-1)/l,u=Math.max(6,Math.round(Math.max(...s)*c*1.5)),f=u-1,m=s.map((y,x)=>{let S=y*c;return{cx:(i[x]??0)*c,cy:f-S*.5,r:S}}),h=new Array(e*u).fill(-1),w=(y,x)=>m.some(S=>(y-S.cx)**2+(x-S.cy)**2<=S.r*S.r);for(let y=0;y<u;y++)for(let x=0;x<e;x++){let S=y===u-1?2:y===u-2?1:0;x<S||x>=e-S||w(x,y)&&(h[y*e+x]=1)}for(let y=0;y<e;y++){let x=-1;for(let S=0;S<u;S++)if((h[S*e+y]??-1)>=0){x=S;break}if(!(x<0))for(let S=x;S<u;S++){let v=S*e+y;if((h[v]??-1)<0)continue;let E=S-x,M=u-1-S,U=(h[v-1]??-1)<0||y===0;E<=1||E<=2&&U?h[v]=0:(M<=1||M===2&&(y+S)%2===0)&&(h[v]=2)}}return{w:e,h:u,tones:h}}var ao=(()=>{let e=Z(611),t=[];return ro.forEach((n,o)=>{for(let r=0;r<n.count;r++){let s=n.minW+Math.floor(e()*(n.maxW-n.minW+1)),i=n.y0+Math.floor(e()*(n.y1-n.y0)),a=r*sr/n.count+Math.floor(e()*60);t.push({layer:o,x0:a,y:i,shape:Ec(s,100+o*10+r)})}}),t})();function Cc(e,t){let n=ao[e];if(!n)return 0;let o=ro[n.layer]?.speed??0;return Math.floor(no(n.x0+o*te(t),sr))-(sr-480)}var rp=ao.length,Xs=new Map;function Mc(e,t){let n=`${e}:${t}`,o=Xs.get(n);if(!o){let r=ao[e];if(o=[],r){let{w:s,h:i,tones:a}=r.shape,l=new ue(s,i),c=ns[t];for(let u=0;u<i;u++)for(let f=0;f<s;f++){let m=a[u*s+f]??-1;m>=0&&l.set(f,u,c[m]??c[1])}o=l.runs()}Xs.set(n,o)}return o}function Ac(e,t,n){for(let o=0;o<ro.length;o++){let r=(ro[o]?.alpha??1)*(t==="night"?.5:1);r<1&&e.alpha(r),ao.forEach((s,i)=>{s.layer===o&&e.rects(Mc(i,t),Cc(i,n),s.y)}),r<1&&e.alpha(1)}}var un={every:45,speed:30},Lc=570/un.speed;function Nc(e){let t=te(e),n=t%un.every;if(n>=Lc)return[];let o=Math.floor(t/un.every),r=Z(o*104729+7),s=3+Math.floor(r()*3),i=44+Math.floor(r()*28),a=o%2===0?1:-1,l=a===1?-12+un.speed*n:492-un.speed*n,c=[];for(let u=0;u<s;u++){let f=u===0?0:6*Math.ceil(u/2)+Math.floor(r()*3),m=u===0?0:(u%2===1?-1:1)*(3*Math.ceil(u/2)+Math.floor(r()*2)),h=Math.round(Math.sin(n*2.1+u*1.7)),w=Math.floor(n*6+u*.5)%2;c.push({x:Math.round(l-a*f),y:i+m+h,frame:w})}return c}function Tc(e,t,n){if(t==="night")return;let o=os[t];for(let r of Nc(n))r.frame===0?(e.rect(r.x-1,r.y,1,1,o),e.rect(r.x+1,r.y,1,1,o),e.rect(r.x,r.y+1,1,1,o)):(e.rect(r.x,r.y,1,1,o),e.rect(r.x-1,r.y+1,1,1,o),e.rect(r.x+1,r.y+1,1,1,o))}function Js(e,t,n){e.rects(fc(t.phase)),t.phase==="night"?(kc(e,n),vc(e,n),yc(e)):hc(e,t.sun),Ac(e,t.phase,n),Tc(e,t.phase,n)}function si(e,t){if(!(e>0)||!Number.isFinite(e))return{dx:0,dy:0};let n=te(t);return{dx:Math.round(e*Math.sin(53*n))||0,dy:Math.round(e*Math.cos(47*n))||0}}function ii(e,t){if(e.phase==="night")return 0;let n=so(e.sun),o=Math.min(1,Math.max(0,(112-n.y)/86)),r=1+Math.round(2*(1-o));return Math.sign(Math.round(t)-Math.round(n.x))*r}var Zs=new Map;function Pc(e,t){let n=`${e}x${t}`,o=Zs.get(n);return o||(o=qs(e,t),Zs.set(n,o)),o}function dn(e,t,n,o=1){if(n.length===0)return;let r=t.phase==="night",s=(r?.14:.25)*Math.min(1,Math.max(0,o));if(s<=0)return;let i=r?as:Wn;e.alpha(s);for(let a of n){let l=Math.round(a.cx)+ii(t,a.cx),c=Math.round(a.y);for(let u of Pc(Math.max(1,Math.round(a.rx)),Math.max(0,Math.round(a.ry))))e.rect(l+u.dx,c+u.dy,u.w,1,i)}e.alpha(1)}function Bc(e,t){let n=te(t),o=Math.sin(n*9.1+e.seed*1.7)*.6+Math.sin(n*23.3+e.seed*2.9)*.4;return{radius:e.radius+Math.round(o*1.5),alpha:.11+.025*o}}var ei=new Map;function Oc(e){let t=ei.get(e);if(!t){let n=[];Bt(n,0,0,Math.round(e*.66),e,.5,Yn);let o=[];ke(o,0,0,Math.round(e*.66),Yn);let r=[];ke(r,0,0,Math.round(e*.33),Yn),t={outer:n,mid:o,core:r},ei.set(e,t)}return t}function ai(e,t,n){for(let o of t){let{radius:r,alpha:s}=Bc(o,n),i=Oc(r);e.alpha(s),e.rects(i.outer,o.x,o.y),e.rects(i.mid,o.x,o.y),e.rects(i.core,o.x,o.y),e.alpha(1)}}var Fc={day:.045,dusk:.06,night:.1},ti=[12,10,8,6,4,2];function Ic(e,t,n){e.push({x:0,y:0,w:480,h:t,color:n},{x:0,y:270-t,w:480,h:t,color:n},{x:0,y:t,w:t,h:270-2*t,color:n},{x:480-t,y:t,w:t,h:270-2*t,color:n})}var ni=new Map;function Dc(e){let t=ni.get(e);if(!t){let n=ls[e];t=[];for(let r of ti)Ic(t,r,n);let o=ti[0];for(let r=0;r<480;r++)ee(r,o,.5)&&t.push({x:r,y:o,w:1,h:1,color:n}),ee(r,270-o-1,.5)&&t.push({x:r,y:270-o-1,w:1,h:1,color:n});for(let r=o+1;r<270-o-1;r++)ee(o,r,.5)&&t.push({x:o,y:r,w:1,h:1,color:n}),ee(480-o-1,r,.5)&&t.push({x:480-o-1,y:r,w:1,h:1,color:n});ni.set(e,t)}return t}function li(e,t){e.alpha(Fc[t]),e.rects(Dc(t)),e.alpha(1)}var Uc=6;function ci(e,t,n){let o=Number.isFinite(t.glow)?Math.min(1,t.glow):0;if(!(o>0)||t.state==="none")return;let r=Math.round(t.state==="set"?n.x:t.x),s=Math.round(t.state==="set"?n.y:t.y)-Uc,i=o*.5;e.alpha(i),e.rect(r-4,0,8,s,O.light),e.rect(r-2,0,4,s,O.gleam),e.rect(r-1,0,2,s,"#FFFFFF");for(let l=0;l<s;l++)ee(r-5,l,.5)&&e.rect(r-5,l,1,1,O.light),ee(r+4,l,.5)&&e.rect(r+4,l,1,1,O.light);for(let l of[-75,-50,-28,28,50,75]){let c=l*Math.PI/180,u=16+Math.abs(l)/4;for(let f=5;f<u;f++)f>u*.6&&f%2===1||e.rect(Math.round(r+Math.sin(c)*f),Math.round(s-Math.cos(c)*f*.7),1,1,f<9?O.gleam:O.light)}let a=[];ke(a,r,s,5,O.light),ke(a,r,s,3,O.gleam),e.rects(a),e.alpha(1)}function ui(e,t,n,o){let{base:r,blockW:s,blockH:i}=o;if(t.phase==="night"||!(r>0)||!(s>0)||!(i>0))return;let a=r*s/2,l=ii(t,n.centerX),c=l>=0,u=4+4*Math.max(1,Math.abs(l)),f=Math.min(2*i,24);e.alpha(.25);for(let m=0;m<f;m++){let h=n.baseY-1-m,w=Math.round(u*(1-m/f));if(w<=0)continue;let y=a-Math.floor(m/i)*(s/2),x=c?n.centerX+y:n.centerX-y-w;e.rect(x,h,w,1,Wn);let S=c?x+w:x-1;ee(S,h,.5)&&e.rect(S,h,1,1,Wn)}e.alpha(1)}var $c=13;function di(e,t){if(Ke(e)<=t)return e;let n=[...e];for(;n.length>0&&Ke(`${n.join("")}\\u2026`)>t;)n.pop();return`${n.join("")}\\u2026`}function _c(e,t,n,o){let r=di(e,468),s=Ke(r)+8,i=$c,a=Math.min(479-s,Math.max(1,Math.round(t-s/2)+o.dx))-o.dx,l=Math.min(269-i,Math.max(1,Math.round(n-i)+o.dy))-o.dy;return{text:r,x:a,y:l,w:s,h:i}}function fi(e,t,n,o,r){let s=_c(t,n,o,r),{x:i,y:a,w:l,h:c}=s;e.rect(i+1,a,l-2,1,lt.rim),e.rect(i+1,a+c-1,l-2,1,lt.rim),e.rect(i,a+1,1,c-2,lt.rim),e.rect(i+l-1,a+1,1,c-2,lt.rim),e.rect(i+1,a+1,l-2,c-2,lt.fill),e.rect(i+1,a+c-2,l-2,1,"#1F140D"),e.text(s.text,i+4,a+2,lt.text)}var Pe={light:"#9C8E84",face:"#7E7068",shade:"#5C5049",dark:"#463C37"},oi=15;function ir(e,t,n){let o=di(e.toUpperCase(),200),r=Ke(o)+12;return{text:o,x:Math.round(t-r/2),y:Math.round(n)-3-oi,w:r,h:oi}}function pi(e,t,n,o){let{text:r,x:s,y:i,w:a,h:l}=ir(t,n,o);e.rect(s-2,i+l,a+4,3,Pe.shade),e.rect(s-2,i+l,a+4,1,Pe.face),e.rect(s-2,i+l+2,a+4,1,Pe.dark),e.rect(s,i,a,l,Pe.face),e.rect(s,i,a,1,Pe.light),e.rect(s,i,1,l,Pe.light),e.rect(s+a-1,i+1,1,l-1,Pe.shade),e.rect(s+2,i+2,a-4,1,Pe.shade),e.rect(s+2,i+l-3,a-4,1,Pe.light),e.rect(s+2,i+2,1,l-4,Pe.shade),e.rect(s+a-3,i+3,1,l-5,Pe.light),e.text(r,s+6,i+4,O.shadow),e.text(r,s+6,i+3,O.light)}var lo=128,He=136;function mi(e,t,n,o){let r=Z(e),s=[];for(let i=0;i<t;i++){let a=r()<.55;s.push({c:Math.floor((i+r()*.9)/t*560)-40,half:a?14+Math.floor(r()*26):3+Math.floor(r()*8),h:a?n+Math.floor(r()*(o-n+1)):n-2+Math.floor(r()*6)})}return s}function co(e){let t=Math.imul(e^2654435769,2246822507);return t^=t>>>13,t=Math.imul(t,3266489909),(t^t>>>16)>>>0}function hi(e,t,n){let o=[];for(let s=0;s<480;s++){let i=t(s);for(let a of e){let l=Math.abs(s-a.c)-a.half,c=a.h-(l<=0?Math.round((Math.abs(s-a.c)/Math.max(1,a.half))**3*1.5):0),u=l<=0?c:Math.max(a.h-2.6*l,a.h*.6-.5*l);i=Math.max(i,u)}o.push(i)}let r=Z(n);for(let s=0;s<14;s++){let i=Math.floor(r()*480),a=1+Math.floor(r()*3),l=1+Math.floor(r()*2);for(let c=-l;c<=l;c++){let u=i+c;u<0||u>=480||(o[u]=(o[u]??0)-Math.max(0,a-Math.abs(c)))}}return o.map((s,i)=>Math.round(s-(co(i*3+n)%7===0?1:0)))}function ar(e,t,n,o,r){for(let s=0;s<480;s++){let i=t[s]??0,a=o-i,l=(t[s+1]??i)-(t[s-1]??i),c=r&&co(s*11+5)%13===0?2+co(s)%6:0;for(let u=a;u<o;u++){let f=u-a,m=n.face;if(l>=2&&f<Math.max(2,i*.55)?m=n.light:l<=-2&&f<Math.max(2,i*.6)?m=n.shade:l<=-2&&f<i*.75?m=ee(s,u,.5)?n.shade:n.face:f===0&&(m=n.light),r&&f>=3){let h=o-u;h%4===0&&co(Math.floor((s+h*13)/17)*7+h)%4!==0&&(m=m===n.light?n.face:n.shade),f>1&&f<2+c&&(m=n.shade)}e.set(s,u,m)}}}function Gc(){let e=[];for(let t=0;t<480;t++)e.push(Math.max(3,Math.round(8+3*Math.sin(t/37+.5)+2*Math.sin(t/13+2))));return e}function Hc(e){let[t,n]=rs,o=hi(mi(31,11,21,31),s=>14+2*Math.sin(s/29),3);ar(e,o,t,128,!0);let r=hi(mi(57,9,12,19),s=>9+2*Math.sin(s/23+1),4);ar(e,r,n,128,!0),ar(e,Gc(),ss,128,!1)}var Wc=428,Yc=[404,454];function Kc(e){let t=Z(97);for(let o=0;o<480;o++)e.set(o,125,ee(o,125,.5)?ge.light:ge.face),e.set(o,126,ge.face),e.set(o,127,ge.shade);let n=4;for(;n<480;){let o=1+Math.floor(t()*4);for(let r=0;r<o;r++){let s=n+r*4;if(t()<.3){let i=119-Math.floor(t()*2);for(let a=i+2;a<126;a++)e.set(s,a,ge.shade);e.fill(s-2,i,5,1,ge.face),e.set(s-3,i+1,ge.shade),e.set(s+3,i+1,ge.shade),e.fill(s-1,i-1,3,1,ge.light)}else{let i=2+Math.floor(t()*2),a=125-i;for(let l=-i;l<=i;l++)for(let c=-i;c<=i;c++){if(c*c+l*l>i*i+1)continue;let u=c+l<-1,f=c+l>1;e.set(s+c,a+l,u?ge.light:f?ge.shade:ge.face)}}}n+=o*4+10+Math.floor(t()*26)}qc(e,Wc,127);for(let o of Yc)zc(e,o,127)}function qc(e,t,n){let o=(r,s)=>{for(let u=0;u<17;u++){let f=n-u,m=Math.floor(u/6),h=r+m,w=s-m;for(let y=h;y<=w;y++){let x=V.face;y===h?x=V.light:y>=w-1&&(x=V.shade),e.set(y,f,x)}}let a=n-17,l=Math.floor(16/6);e.fill(r+l-1,a,s-r-2*l+3,1,V.light),e.fill(r+l,a+1,s-r-2*l+1,1,V.shade);for(let u=0;u<2;u++){let f=r+3+u*4;e.fill(f,n-11,1,5,V.shade),e.set(f+1,n-10,V.shade)}let c=r+1+Math.floor((s-r)/2);for(let u=a-6;u<=n;u++)e.set(c,u,V.dark);e.fill(c+1,a-6,2,1,"#B8433A"),e.set(c+1,a-5,"#8E2F2B")};o(t-15,t-4),o(t+4,t+15),e.fill(t-4,n-11,9,1,V.light),e.fill(t-4,n-10,9,1,V.face),e.fill(t-3,n-9,7,10,V.face),e.fill(t-2,n-8,5,9,V.dark),e.fill(t-2,n-8,5,1,V.shade)}function zc(e,t,n){for(let r=0;r<18;r++){let s=n-r,i=r<9;e.set(t-1,s,V.light),e.set(t,s,V.face),i&&e.set(t+1,s,V.shade)}e.set(t-1,n-21+3,O.light),e.set(t,n-21+3,O.mid),e.set(t,n-21+2,O.light),e.fill(t-2,n,5,1,V.shade)}function jc(e,t,n){let o=At[n],r=W(se.sky,o[o.length-1]??se.sky,.6),s=W(se.light,o[o.length-2]??se.light,.45);[[W(ge.shade,se.face,.45),r,.25],[r,s,.25],[s,r,.25],[s,se.face,.5],[se.face,se.light,.12],[se.face,se.deep,.25],[se.deep,se.face,.25],[se.deep,se.bank,.12]].forEach(([a,l,c],u)=>{let f=lo+u;for(let m=0;m<480;m++)e.set(m,f,ee(m,f,c)?l:a)});for(let a=0;a<480;a++)for(let l=1;l<=5;l++){let c=t.get(a,125-l);if(!c||!ee(a,lo+l,.55-l*.08))continue;let u=lo+l;e.set(a,u,W(e.get(a,u)??se.face,c,.45))}}var Vc=(()=>{let e=Z(23);return Array.from({length:26},()=>({x:e()*480,y:lo+1+Math.floor(e()*6),w:1+Math.floor(e()*3),speed:3+e()*4,blink:1.2+e()*2.4,phase:e()*Math.PI*2}))})(),Xc=488;function Qc(e){let t=te(e),n=[];for(let o of Vc)Math.sin(t*o.blink+o.phase)<-.3||n.push({x:Math.floor(no(o.x+o.speed*t,Xc))-4,y:o.y,w:o.w});return n}var Jc=["....y................","....nS...............","....nSS..............","....nsSS.............","....nsSSS............","....nssSSS...........",".....nsSSSS..........",".....nssSSSS.........",".....nssSSSSS........",".....nssSSSSSS.......",".....nssSSSSSSS......","...k.nssSSSSSSSn.....","...w.NnnnnnnnnnnN...n","n..w.....N.........nN","NnnnnnnnnnnnnnnnnnnN.",".NNNNNNNNNNNNNNNNNNN.","..oooooooooooooooo..."],Zc={S:Hn.light,s:Hn.shade,n:z[0],N:z[1],o:"#4A2E18",y:O.light,k:"#B9784E",w:"#F4F0E2"},cr=ce(Jc,Zc),lr={every:120,crossing:80};function eu(e){let t=te(e)%lr.every;if(t>=lr.crossing)return null;let n=-cr.w-2,o=482,r=Math.round(n+(o-n)*t/lr.crossing),s=Math.sin(t*1.9)>.55?-1:0;return{x:r,y:He-1+s}}function tu(e,t){let n=eu(t);if(!n)return;let o=n.y-cr.h+1;e.sprite(cr,n.x,o);for(let r=6;r<15;r++)(r+n.x)%2===0&&e.rect(n.x+r,n.y+1,1,1,Hn.shade)}var nu=[[".ll.........","lffl........","o.ff..rqr...","..ff.lrqrl..","..fflffffffl","...ffffffffs","...sssssss..","...f.s..f.s.","...f.s..f.s.","...d.d..d.d."],[".ll.........","lffl........","o.ff..rqr...","..ff.lrqrl..","..fflffffffl","...ffffffffs","...sssssss..","....fs...fs.","....fs...fs.","....dd...dd."]],ou=[[".w..","wwk.",".wn.",".Bn.",".Bn.",".Wn.",".W.n","k.k."],[".w..","wwk.",".wn.",".Bn.",".Bn.",".Wn.",".Wn.",".kk."]],yi={l:Ge.light,f:Ge.face,s:Ge.shade,d:Ge.dark,o:Ge.dark,r:"#B8433A",q:"#F2E4C2",w:"#F4F0E2",W:"#D6CFBC",B:"#3C6FB0",k:"#925A38",n:z[0]},gi=nu.map(e=>ce(e,yi)),ru=ou.map(e=>ce(e,yi)),uo={every:180,crossing:70,feet:124};function su(e){let t=te(e)%uo.every;if(t>=uo.crossing)return[];let n=550,o=Math.round(486-n*t/uo.crossing),r=Math.floor(t*4);return[{kind:"walker",x:o,frame:r%2},{kind:"camel",x:o+6,frame:(r+1)%2},{kind:"camel",x:o+20,frame:r%2},{kind:"camel",x:o+34,frame:(r+1)%2}]}function iu(e,t){for(let n of su(t)){let o=(n.kind==="walker"?ru:gi)[n.frame]??gi[0];o&&e.sprite(o,n.x,uo.feet-o.h)}}var au=[[[-12,250],[40,252],[96,256],[T.audience.x,T.audience.y-1]],[[52,230],[84,240],[118,250],[T.audience.x,T.audience.y-1]],[[T.audience.x,T.audience.y-1],[176,246],[206,230],[236,216],[258,211]]];function lu(e,t,n){let o=1/0;for(let r=0;r+1<n.length;r++){let[s,i]=n[r]??[0,0],[a,l]=n[r+1]??[0,0],c=a-s,u=l-i,f=c*c+u*u,m=f===0?0:Math.max(0,Math.min(1,((e-s)*c+(t-i)*u)/f)),h=Math.hypot(e-(s+m*c),t-(i+m*u));o=Math.min(o,h)}return o}function cu(e){let t=He,n=[t,146,166,196,232,262];for(let o=t;o<270;o++){let r=n.findIndex((u,f)=>o>=u&&o<(n[f+1]??270));r<0&&(r=0);let s=st[r]??st[0],i=n[r+1],a=n[r],l=null,c=0;i!==void 0&&i-o<=2?(l=st[r+1]??s,c=i-o===1?3/8:1/8):a!==void 0&&r>0&&o-a<=1&&(l=st[r-1]??s,c=o-a===0?3/8:1/8);for(let u=0;u<480;u++)e.set(u,o,l&&ee(u,o,c)?l:s)}for(let o=0;o<480;o++)e.set(o,t,se.bank),ee(o,t+1,.5)&&e.set(o,t+1,se.bank);du(e),pu(e),mu(e),hu(e),fu(e),gu(e),bu(e)}var uu=[{cx:300,hw:120,h:16,bottom:272},{cx:470,hw:86,h:26,bottom:272},{cx:214,hw:56,h:7,bottom:238},{cx:372,hw:50,h:6,bottom:224}];function du(e){for(let t of uu){let n=t.bottom-t.h;for(let o=Math.max(0,t.cx-t.hw);o<Math.min(480,t.cx+t.hw);o++){let r=(o-t.cx)/t.hw,s=Math.round(t.bottom-t.h*(1-r*r)**.8);for(let i=s;i<Math.min(270,t.bottom);i++){let a=e.get(o,i);if(!a)continue;let l=t.cx+(i-n)*.9,c=o<l,u=Math.abs(o-l)<2,f=W(a,"#FFF4D6",.26),m=W(a,"#8A5E2E",.17),h;i===s?h=c?W(a,"#FFF4D6",.5):W(a,"#8A5E2E",.26):u?h=ee(o,i,.5)?f:m:i-s<2?h=ee(o,i,.5)?c?f:m:a:h=c?f:m,e.set(o,i,h)}}}}function fu(e){let t=[{x:6,y:266,w:10,h:6},{x:16,y:268,w:6,h:4},{x:228,y:266,w:9,h:5},{x:238,y:267,w:5,h:3},{x:404,y:240,w:8,h:5},{x:336,y:228,w:6,h:4},{x:182,y:186,w:7,h:4}];for(let n of t){let o=e.get(n.x+n.w,n.y);o&&e.fill(n.x+2,n.y,n.w,1,W(o,"#6B4A28",.35));for(let r=0;r<n.h;r++){let s=n.y-n.h+r,i=r===0?2:r===1?1:0;for(let a=n.x+i;a<n.x+n.w-i;a++){let l=(a-n.x)/n.w+r/n.h,c=l<.5?qe.light:l<1.15?qe.face:qe.shade;(r===n.h-1||a===n.x+n.w-i-1)&&(c=qe.shade),e.set(a,s,c)}}}}function pu(e){let t=Z(77);for(let n=0;n<150;n++){let o=t()**.8,r=Math.floor(He+6+o*(270-He-8)),s=Math.floor(t()*480),i=3+Math.floor(o*12+t()*4),a=Math.max(1,Math.round(i/9));for(let l=0;l<i;l++){let c=s+l,u=-Math.round(Math.sin(Math.PI*l/Math.max(1,i-1))*a),f=e.get(c,r+u);if(!f)continue;e.set(c,r+u,W(f,"#FFF4DA",.32));let m=e.get(c,r+u+1);m&&e.set(c,r+u+1,W(m,"#8A5E2E",.22))}}}function mu(e){for(let t=He;t<270;t++){let n=2+(t-200)/40;if(!(n<1.5))for(let o=0;o<480;o++){let r=1/0;for(let a of au)r=Math.min(r,lu(o,t,a));if(r>n+1)continue;let s=r<n-.5;if(!s&&!ee(o,t,.5))continue;let i=s?en.face:en.light;s&&((o*13+t*7)%17===0||(o*5+t*11)%23===0)?i=en.track:s&&ee(o,t,.2)&&(i=en.light),e.set(o,t,i)}}}function hu(e){let t=Z(301);for(let n=0;n<56;n++){let o=t(),r=Math.floor(He+8+o*(270-He-12)),s=Math.floor(t()*480),i=o>.6&&t()<.5?3:o>.25?2:1,a=e.get(s+i,r+1);if(a&&e.fill(s+1,r+1,i,1,W(a,"#6B4A28",.3)),i===1){e.set(s,r,qe.face);continue}e.fill(s,r,i,i-1,qe.face),e.fill(s,r,i-1,1,qe.light),e.fill(s,r+i-1,i,1,qe.shade)}}function gu(e){let t=Z(503);for(let n=0;n<22;n++){let o=n<12,r=Math.floor(t()*480),s=o?He+4+Math.floor(t()*14):150+Math.floor(t()*110),i=3+Math.floor(t()*4),a=e.get(r,s+1);a&&e.fill(r,s+1,i,1,W(a,"#6B4A28",.25));for(let l=0;l<i;l++){let c=1+Math.round(Math.sin(Math.PI*(l+.5)/i)*(1+(i>4?1:0)));for(let u=0;u<c;u++){let f=u===c-1?l<i/2?tn.light:tn.face:(l+u)%2===0?tn.face:tn.shade;e.set(r+l,s-u,f)}}}}function bu(e){let t=Z(211),n=0;for(;n<480;){let o=2+Math.floor(t()*4);for(let r=0;r<o;r++){let s=n+r,i=2+Math.floor(t()*4);for(let a=0;a<i;a++){let l=He+1-a;e.set(s,l,a===i-1&&t()<.4?Zt.tip:r%2===0?Zt.face:a>i/2?Zt.light:Zt.shade)}}n+=o+2+Math.floor(t()*9)}}var bi=new Map;function xi(e){let t=bi.get(e);if(!t){let n=Pt(e),o=new ue(480,270);Hc(o);let r=new ue(480,270);Kc(r);let s=new ue(480,270);jc(s,r,e);let i=new ue(480,270);cu(i),t={far:o.runs(n),bank:r.runs(n),water:s.runs(n),plain:i.runs(n)},bi.set(e,t)}return t}function wi(e,t,n){let o=xi(t);e.rects(o.far),e.tint(Pt(t)),iu(e,n),e.tint(null),e.rects(o.bank)}function ki(e,t,n){let o=xi(t);e.rects(o.water);let r=is[t];for(let s of Qc(n))e.rect(s.x,s.y,s.w,1,r);e.tint(Pt(t)),tu(e,n),e.tint(null),e.rects(o.plain),t==="day"&&xu(e,n)}function yu(e){return Math.floor(te(e)*5)%8}function xu(e,t){let n=yu(t);e.alpha(.22);for(let o=0;o<3;o++){let r=He+3+o*2,s=o%2===0?n:7-n;for(let i=-8+s;i<480;i+=8)e.rect(i,r,3,1,"#FFF6E0")}e.alpha(1)}var It="#4A3020";function hn(e){let t=e.runs().map(n=>({x:n.x,y:n.y,w:n.w,color:n.color}));return{w:e.width,h:e.height,top:0,runs:t,mirrored:t.map(n=>({...n,x:e.width-n.x-n.w}))}}function ut(e,t,n){return{left:t-Math.floor(e.w/2),top:n-e.h}}function Si(e,t,n){let o=e+8,r=t+5,s=new ue(o,r),i=Math.floor(o/2),a=5,l=r-1,c=Math.floor(e/2);for(let m of[-1,1]){let h=i+m*3,w=i+m*(c+3);for(let y=a+3;y<=l;y++){let x=(y-a-3)/(l-a-3);s.set(Math.round(h+(w-h)*x),y,"#8A6A44")}s.set(w,l,It)}for(let m=1;m<a;m++)s.set(i,m,z[1]);let u=n%2===0?_e.stripe:Un;s.fill(i+1,1,3,1,u),s.fill(i+1,2,2,1,u);for(let m=a;m<=l;m++){let h=m-a,w=Math.round(c*h/(l-a));for(let y=-w;y<=w;y++){let x=i+y,S=y<0?y>-w+1||h<3?_e.cloth:"#F3E6C8":_e.shade;y<0&&y>=-Math.max(1,Math.floor(w/3))&&(S=W(_e.cloth,_e.shade,.35)),(l-m===3||l-m===4)&&(S=y<0?_e.stripe:"#8E2F2B"),Math.abs(y)===w&&(S=It),s.set(x,m,S)}}let f=a+Math.floor((l-a)*.42);for(let m=f;m<l;m++){let h=Math.floor((m-f)*3/(l-f))+1;for(let w=-h;w<=h;w++)s.set(i+w,m,m===f?It:"#3E2A1C");s.set(i-h-1,m,"#F6EBD2")}return s.fill(i-c,l,2*c+1,1,It),hn(s)}var Pi=[{x:24,bottom:T.camp.y-24,sprite:Si(28,15,0)},{x:63,bottom:T.camp.y-26,sprite:Si(24,13,1)}],Se={x:86,y:197},wu=[["...r...","..ro...","..roy..",".royyr.",".oyWyo.","royWyor",".ryyyr."],["....r..","...or..","..ryo..",".roWyr.",".oyWyo.","royyWor",".ryyyr."],["..r....","..oy...",".royo..",".ryWyr.","royWyo.","royWyor",".ryyyr."]],ku=[["..r..",".roy.",".oWo.","ryWyr",".ryr."],["...r.","..or.",".ryo.","royWr",".ryr."],[".r...",".oy..",".oWr.","ryWyo",".ryr."]],Bi={W:it.white,y:it.yellow,o:it.orange,r:it.red},vi=wu.map(e=>ce(e,Bi)),Ei=ku.map(e=>ce(e,Bi));function Oi(e,t){return(Math.floor(te(e)*8)+t)%3}var Ci=ce(["..ennnNe..",".gnNnnNNg.","GgsgGgsgGg",".gGgsgGg.."],{n:z[0],N:z[1],e:it.ember,g:qo.shade,G:qo.light,s:"#5A4636"}),ur=4;function Su(e){let t=te(e),n=[];for(let o=0;o<5;o++){let r=(t+o*(ur/5))%ur/ur;n.push({x:Math.round(Se.x+Math.sin(r*5+o)*1.5+r*9),y:Math.round(Se.y-11-r*30),r:r<.25?1:r<.6?2:3,alpha:.7*(1-r)**1.2})}return n}var Mi=new Map;function vu(e){let t=Mi.get(e);if(!t){t=[];for(let n=-e;n<=e;n++){let o=Math.round(Math.sqrt(Math.max(0,(e+.4)**2-n*n)));t.push({x:-o,y:n,w:2*o+1,h:1,color:n<0?W(Ko,"#FFFFFF",.2):Ko})}Mi.set(e,t)}return t}function Eu(e,t,n){let o=ut(Ci,Se.x,Se.y);e.sprite(Ci,o.left,o.top);for(let i of Su(t))e.alpha(i.alpha),e.rects(vu(i.r),i.x,i.y),e.alpha(1);e.tint(null);let r=vi[Oi(t,0)]??vi[0];r&&e.sprite(r,Se.x-3,Se.y-3-r.h);let s=Math.floor(te(t)*3)%5;e.rect(Se.x-2+s,Se.y-11-s%3,1,1,it.yellow),e.tint(n)}var dr=["..oo....................",".olloo..................","olllffo.................","offeffo.................","ommfffo.................",".oofffo.................","...offfo.......ooooo....","...offfo.....oolllllo...","....offfo...ollllllllo..","....offffo.ollqqqqqllfo.","....offfffollqrrrrrqfffo","....offffffffqqqqqqqffso","...ooffffffffffffffsssso","..offssooooooooooossssso","..oooooo..........oooooo"],fr={o:"#5A3A20",l:Ge.light,f:Ge.face,s:Ge.shade,e:"#2E1E12",m:"#E2C090",q:le.cream,r:le.red},Ai=(e,t)=>{let n=[...e];for(let[o,r,s]of t){let i=n[o]??"";n[o]=i.slice(0,r)+s+i.slice(r+1)}return n},Cu={rest:ce(dr,fr),blink:ce(Ai(dr,[[3,3,"s"]]),fr),chew:ce(Ai(dr,[[4,1,"f"],[4,2,"f"],[5,1,"m"],[5,2,"m"],[6,1,"o"],[6,2,"o"]]),fr)},pn={x:112,y:178};function Mu(e){let t=te(e);if(t%3.7<.15)return"blink";let n=t%9;return n<3&&Math.floor(n*4)%2===1?"chew":"rest"}function Au(){let e=new ue(46,22),t=(n,o,r,s)=>{e.fill(n,o,r,2,pe.light),e.fill(n,o+2,r,s-2,pe.face),e.fill(n+r-2,o+2,1,s-3,pe.shade),e.fill(n,o+s-2,r-1,1,pe.shade),e.fill(n,o+s-1,r,1,pe.edge),e.fill(n+r-1,o,1,s,pe.edge),e.fill(n,o+2,1,s-3,W(pe.light,pe.face,.4));for(let i=2;i<r-3;i+=3)e.set(n+i,o+3+i%2,pe.shade)};for(let n=0;n<32;n++){let o=9+Math.round(3*Math.sin(n/5))-(n>22?n-22:0)-(n<3?3-n:0);for(let r=15-o;r<15;r++){let s=(r+Math.floor(n/6))%4===0,i=r===15-o?pe.face:s?pe.edge:n%6===5?pe.edge:pe.shade;e.set(n,r,i)}}t(2,14,10,7),t(12,14,10,7),t(22,14,10,7),t(7,8,10,6),t(17,8,10,6),t(12,3,9,5),e.fill(33,19,13,1,z[0]),e.fill(33,20,13,1,z[1]),e.set(45,18,z[0]),t(35,13,9,6);for(let n=44;n<46;n++)e.set(n,16,"#8A6A44");for(let[n,o]of[[0,21],[31,21],[4,20],[27,21]])e.set(n,o,pe.light);return hn(e)}var Li=Au(),mn={x:128,y:204},Ft={light:"#79A84C",face:"#4C8A3C",shade:"#2F612C",dark:"#234A22"},fn={light:"#A47447",face:"#7A5230",shade:"#563A22"};function Be(e,t,n,o=1){let r=Z(n),s=[{a:168,len:12},{a:148,len:13},{a:118,len:9},{a:88,len:7},{a:60,len:10},{a:30,len:13},{a:10,len:12},{a:200,len:9},{a:-22,len:9}].map(l=>({a:l.a+(r()-.5)*12,len:Math.max(3,Math.round((l.len+Math.floor(r()*3))*o))})),i=34,a=e+10;return[0,1].map(l=>{let c=new ue(i,a),u={x:Math.floor(i/2),y:a-1},f={x:u.x+t,y:a-1-e};for(let w=u.y;w>=f.y;w--){let y=(u.y-w)/e,x=Math.round(u.x+t*y*y+(l===1?Math.round(y*y*1.2):0)),S=(u.y-w)%3===0;c.set(x,w,S?fn.face:fn.light),c.set(x+1,w,S?fn.shade:fn.face),w>u.y-3&&c.set(x+2,w,fn.shade)}let m=f.x+(l===1?1:0),h=f.y;for(let w of s){let y=w.a*Math.PI/180;for(let x=1;x<=w.len;x++){let S=x/w.len,v=l===1?Math.round(S*S*1.4):0,E=Math.round(m+Math.cos(y)*x)+v,M=Math.round(h-Math.sin(y)*x+S*S*w.len*.55);c.set(E,M,S<.4?Ft.face:Ft.light),x>2&&c.set(E,M+1,S>.7?Ft.shade:Ft.face),x>3&&x%2===0&&c.set(E,M+2,Ft.dark)}}return c.fill(m-1,h-1,3,2,Ft.shade),c.set(m-1,h+1,"#B8642E"),c.set(m+1,h+2,"#8E4A22"),c.set(m,h+1,"#B8642E"),hn(c)})}var po=[{x:7,bottom:194,frames:Be(30,2,1),phase:0},{x:470,bottom:202,frames:Be(32,-3,2),phase:.7},{x:182,bottom:156,frames:Be(22,1,3),phase:1.3},{x:424,bottom:258,frames:Be(36,3,4),phase:1.9},{x:456,bottom:266,frames:Be(40,-2,5),phase:.4},{x:6,bottom:142,frames:Be(16,1,6,.6),phase:.2},{x:19,bottom:140,frames:Be(12,-1,7,.5),phase:1.1},{x:31,bottom:143,frames:Be(18,2,8,.62),phase:2},{x:447,bottom:141,frames:Be(14,-1,9,.55),phase:.9},{x:460,bottom:143,frames:Be(19,-2,10,.65),phase:1.6},{x:474,bottom:140,frames:Be(12,1,11,.5),phase:.5}],Ni=2.4;function Lu(e,t){let n=po[e];return n?Math.floor((te(t)+n.phase)%Ni/(Ni/2)):0}var kp=po.length,Ae={left:97,right:135,top:257,bottom:266},fo=[98,134];function Nu(){let e=Ae.right-Ae.left+1,t=new ue(e,Ae.bottom-Ae.top+1),n="#A86E38";for(let o=0;o<5;o++)for(let r=0;r<e;r++){let s=(r+o%2*5)%10===0;t.set(r,o,s?z[1]:o===0?n:o%2===0?z[0]:W(z[0],n,.4))}t.fill(9,0,21,5,le.red),t.fill(9,0,21,1,O.mid),t.fill(9,4,21,1,O.shadow);for(let o=11;o<28;o+=3)t.set(o,2,O.light);t.fill(0,5,e,1,O.mid),t.fill(0,6,e,3,z[1]);for(let o=2;o<e;o+=4)t.fill(o,6,1,3,"#553418");for(let o of[0,Math.floor(e/2),e-2])t.fill(o,6,2,4,"#553418");return t.fill(0,9,e,1,"#3E2614"),hn(t)}var pr=219,Tu=231;function Ru(){let e=fo[0]-2,n=fo[1]+2-e+1,o=Tu-pr+1,r=new ue(n,o),s=Math.floor(n/2),i=a=>Math.floor((a+1)/4)%2===0;for(let a=0;a<4;a++){let l=Math.round(s*(.6+.4*(a/3)));for(let c=s-l;c<=s+l;c++){let u=c<s,f=i(c)?u?le.red:le.redShade:u?le.cream:le.creamShade;(Math.abs(c-s)===l||a===0)&&(f=It),r.set(c,a,f)}}r.fill(s-1,0,3,1,O.light);for(let a=4;a<10;a++)for(let l=0;l<n;l++){let c=a>=8,u=i(l)?c?le.redShade:le.red:c?le.creamShade:le.cream;a===4&&(u=O.mid),a===5&&(u=O.shadow),(l===0||l===n-1)&&(u=It),r.set(l,a,u)}for(let a=1;a<n-1;a++){let l=(a+1)%4;l>=1&&r.set(a,10,i(a)?le.redShade:le.creamShade),l===2&&r.set(a,11,i(a)?le.redShade:le.creamShade),l===2&&r.set(a,12,O.mid)}return hn(r)}var Pu=[["yyyyy..","yBBBBy.","yBGBBBy","yBBBBy.","yyyyy.."],["yyyy...","yBBBy..","yBGBBy.","yBBBBBy","yyyyyy."],["yyyyyy.","yBBBBBy","yBGBBy.","yBBBy..","yyyy..."]],Ti=Pu.map(e=>ce(e,{y:O.mid,B:Un,G:O.gleam}));function Bu(e,t){return(Math.floor(te(e)*5)+t)%3}var Ou=Nu(),Fu=Ru();function Iu(e,t){e.sprite(Ou,Ae.left,Ae.top);let n=pr-6;fo.forEach((o,r)=>{e.rect(o-1,n,1,Ae.top+6-n,"#7E522A"),e.rect(o,n,1,Ae.top+6-n,"#5A3618"),e.rect(o-1,n-2,2,2,O.light);let s=Ti[Bu(t,r)]??Ti[0];s&&e.sprite(s,o+1,n)}),e.sprite(Fu,fo[0]-2,pr)}var Du=ce(["oyyyyyyo","obbbbbbo",".oBBBBo.","..oBBo..","...oo...","..o..o..",".o....o.","o......o"],{o:"#4A2E18",y:at.light,b:at.face,B:at.shade}),Fi=ce(["oyyyo","obbbo",".oBo.","..n..","..n..","..N..","..n..","..n..","..N..","..n..","..n..","..N..","..n..",".nNn."],{o:"#4A2E18",y:at.light,b:at.face,B:at.shade,n:z[0],N:z[1]}),hr=[{x:103,y:259,seed:1},{x:129,y:259,seed:2}],gr=[{x:422,y:214,seed:2}],Uu=128,$u=26;function Ii(e){let t=e.base>0&&e.blockW>0?e.base*e.blockW:Uu,n=Math.min(K.maxWidth,t)/2,o=K.baseY+6;return[{x:Math.round(K.centerX-n-7),y:o,seed:0},{x:Math.min(Math.round(K.centerX+n+7),T.sledge.x-26),y:o,seed:1}]}function Di(e){return{y:e.y,draw:(t,n,o)=>mr(t,Fi,e.x,e.y,e.seed,n,o)}}function Ui(e){return{x:e.x,y:e.y-16,radius:$u,seed:e.seed+3}}function $i(e){return{cx:e.x,y:e.y,rx:3,ry:1}}function mr(e,t,n,o,r,s,i){let a=ut(t,n,o);e.sprite(t,a.left,a.top),e.tint(null);let l=Ei[Oi(s,r)]??Ei[0];l&&e.sprite(l,n-2,a.top-l.h+1),e.tint(i)}var Ri=Rt(Me.well),_i=[{x:Se.x,y:Se.y-4,radius:26,seed:0},...hr.map(e=>({x:e.x,y:e.y-12,radius:20,seed:e.seed})),...gr.map(e=>({x:e.x,y:e.y-16,radius:20,seed:e.seed+3}))],Gi=[...Pi.map(e=>({cx:e.x,y:e.bottom,rx:Math.floor(e.sprite.w/2)-3,ry:2})),...po.map(e=>({cx:e.x+1,y:e.bottom,rx:e.bottom<150?3:6,ry:1})),{cx:Se.x,y:Se.y,rx:6,ry:1},{cx:pn.x,y:pn.y,rx:12,ry:2},{cx:mn.x,y:mn.y,rx:23,ry:2},{cx:T.well.x,y:T.well.y-2,rx:11,ry:2},{cx:Math.round((Ae.left+Ae.right)/2)+1,y:Ae.bottom,rx:21,ry:2},...hr.map(e=>({cx:e.x,y:e.y,rx:4,ry:1})),...gr.map(e=>({cx:e.x,y:e.y,rx:3,ry:1}))];function Hi(){let e=[];for(let o of Pi){let r=ut(o.sprite,o.x,o.bottom);e.push({y:o.bottom,draw:s=>s.sprite(o.sprite,r.left,r.top)})}po.forEach((o,r)=>{e.push({y:o.bottom,draw:(s,i)=>{let a=o.frames[Lu(r,i)]??o.frames[0];if(!a)return;let l=ut(a,o.x,o.bottom+1);s.sprite(a,l.left,l.top)}})}),e.push({y:pn.y,draw:(o,r)=>{let s=Cu[Mu(r)],i=ut(s,pn.x,pn.y);o.sprite(s,i.left,i.top)}}),e.push({y:Se.y,draw:Eu});let t=ut(Li,mn.x,mn.y);e.push({y:mn.y,draw:o=>o.sprite(Li,t.left,t.top)});let n=ut(Ri,T.well.x,T.well.y-2);e.push({y:T.well.y-2,draw:o=>o.sprite(Ri,n.left,n.top)}),e.push({y:Ae.top+1,draw:(o,r)=>Iu(o,r)});for(let o of hr)e.push({y:o.y,draw:(r,s,i)=>mr(r,Du,o.x,o.y,o.seed,s,i)});for(let o of gr)e.push({y:o.y,draw:(r,s,i)=>mr(r,Fi,o.x,o.y,o.seed,s,i)});return e}var Dt=K.baseY+2,_u=Qn(),Wi=new Map;function Ut(e){let t=Wi.get(e);return t||(t=Rt(e),Wi.set(e,t)),t}function Gu(e,t,n){return e.runs.map(o=>({x:t+o.x,y:n+o.y,w:o.w,h:1,color:o.color}))}function br(e,t,n){let o=Ut(e);return Gu(o,t-Math.floor(o.w/2),n-o.h)}var yr=T.rations.y+3,xr=T.sledge.y+6,bo=(e,t)=>({y:e,draw:n=>n.rects(t)}),Hu=[bo(xr,br(Me.sledge,T.sledge.x+1,xr)),bo(T.treasury.y,br(Me.chest,T.treasury.x,T.treasury.y)),bo(yr,br(Me.table,T.rations.x,yr))],Wu=[{cx:T.sledge.x+1,y:xr,rx:12,ry:1},{cx:T.treasury.x,y:T.treasury.y,rx:8,ry:1},{cx:T.rations.x,y:yr,rx:11,ry:1},{cx:T.treasury.x-22,y:T.treasury.y+1,rx:12,ry:1}],dt={x:K.centerX,y:K.baseY+22},ji=Hi(),Yu=ji.filter(e=>e.y<K.baseY).sort((e,t)=>e.y-t.y),Ku=ji.filter(e=>e.y>=K.baseY);function qu(e,t){let n=[...Ku,...Hu,bo(T.treasury.y+1,ju(e.coins)),...t.map(Di)],o=e.pyramid.monument;return o&&n.push({y:dt.y,draw:r=>pi(r,o,dt.x,dt.y)}),n.sort((r,s)=>r.y-s.y)}function zu(e,t){let n=[...Gi,...Wu,...t.map($i)],o=e.pyramid.monument;if(o){let r=ir(o,dt.x,dt.y);n.push({cx:dt.x,y:dt.y,rx:Math.ceil(r.w/2)+2,ry:1})}return n}var gn=6,Yi=new Map;function ju(e){let t=Math.max(0,Math.min(48,Math.floor(Number.isFinite(e)?e:0))),n=Yi.get(t);if(n)return n;let o=new Array(gn).fill(0);for(let s=0;s<t;s++){let i=0,a=1/0;for(let l=0;l<gn;l++){let c=(o[l]??0)+Math.abs(l-(gn-1)/2)*1.8;c<a&&(a=c,i=l)}o[i]=(o[i]??0)+1}n=[];let r=T.treasury.y+1;for(let s=0;s<gn;s++){let i=o[s]??0;if(i===0)continue;let a=T.treasury.x-10-(gn-s)*4;n.push({x:a-1,y:r-i,w:1,h:i,color:xe});for(let l=0;l<i;l++)n.push({x:a,y:r-1-l,w:3,h:1,color:l%2===0?$n.shadow:$n.face});n.push({x:a,y:r-i-1,w:3,h:1,color:$n.face},{x:a+1,y:r-i-1,w:1,h:1,color:O.gleam})}return Yi.set(t,n),n}var Ki=new Map;function Vu(e,t){let n=`${e}x${t}`,o=Ki.get(n);if(o)return o;let r=e>=16,s=r?8:4,i=r?4:2;o=[];let a=Math.max(1,Math.ceil(t/i));for(let l=0;l<a;l++){let c=t-l*i,u=Math.max(0,c-i);for(let f=l%2===1?-s/2:0;f<e;f+=s){let m=Math.max(0,f),h=Math.min(e,f+s);h>m&&o.push({dx:m,dy:u,w:h-m,h:c-u})}}return Ki.set(n,o),o}var qi=he,Xu={light:Lt(he.light),face:Lt(he.face),mortar:Lt(he.mortar),edge:Lt(he.edge)},Qu={light:W(Ct.light,"#FFFFFF",.25),face:Ct.light,mortar:Ct.dark,edge:Ct.dark};function Ju(e,t,n,o,r){e.rect(t+o.dx,n+o.dy,o.w,o.h,r.mortar);let s=Math.max(1,o.w-1),i=Math.max(1,o.h-1);e.rect(t+o.dx,n+o.dy,s,i,r.face),o.h>=3&&(e.rect(t+o.dx,n+o.dy,s,1,r.light),e.rect(t+o.dx,n+o.dy,1,i,r.light))}function Vi(e,t,n){e.rect(t.x,t.y,t.w,1,n),e.rect(t.x,t.y+t.h-1,t.w,1,n),e.rect(t.x,t.y,1,t.h,n),e.rect(t.x+t.w-1,t.y,1,t.h,n)}function mo(e,t,n){for(let o=0;o<t.w;o+=2)e.rect(t.x+o,t.y,1,1,n),e.rect(t.x+o,t.y+t.h-1,1,1,n);for(let o=2;o<t.h-1;o+=2)e.rect(t.x,t.y+o,1,1,n),e.rect(t.x+t.w-1,t.y+o,1,1,n)}function ho(e,t,n,o){let r=Vu(t.w,t.h),s=Number.isFinite(n)?Math.min(1,Math.max(0,n)):0,i=Math.round(s*r.length);for(let a=0;a<i;a++){let l=r[a];l&&Ju(e,t.x,t.y,l,o)}}function Zu(e,t){switch(t.look){case"empty":Vi(e,t,ts);break;case"planned":mo(e,t,Dn);break;case"building":mo(e,t,Dn),ho(e,t,t.fill,qi);break;case"stalled":mo(e,t,Lt(Dn)),ho(e,t,t.fill,Xu);break;case"orphaned":mo(e,t,Ct.dark),ho(e,t,Math.max(t.fill,.15),Qu);break;case"set":ho(e,t,1,qi),e.rect(t.x,t.y,t.w,1,he.light),e.rect(t.x+t.w-1,t.y+1,1,t.h-1,he.edge);break;case"fallen":{e.rect(t.x,t.y,t.w,t.h,Et.gap),e.rect(t.x,t.y,t.w,1,Et.crack);let n=Z(t.x*31+t.y*17),o=t.x+Math.floor(t.w/2);for(let r=t.y+1;r<t.y+t.h;r++)o=Math.min(t.x+t.w-2,Math.max(t.x+1,o+Math.floor(n()*3)-1)),e.rect(o,r,1,1,Et.crack),r%3===0&&e.rect(o+1,r,1,1,Et.crack);break}}}function ed(e,t,n){let o=Number.isFinite(e)?Math.min(1,Math.max(0,e)):0;return Math.round((1-o)*(t+n+4))-2}function td(e,t){let n=ed(t.flash,t.w,t.h);e.alpha(.75);for(let o=0;o<t.h;o++){let r=t.x+n-o;for(let[s,i,a]of[[0,3,Yo],[-3,1,O.gleam]]){let l=Math.max(t.x,r+s),c=Math.min(t.x+t.w,r+s+i);c>l&&e.rect(l,t.y+o,c-l,1,a)}}e.alpha(1)}function nd(e,t){let n=t.base>0?t.base*t.blockW:K.maxWidth/2,o=Math.imul(e+1,2654435761)>>>0,r=Math.max(0,n-4);return{x:K.centerX-r/2+o%1e3/1e3*r,y:K.baseY+1+(o>>>12)%7}}function od(e,t){for(let r of t.blocks)Zu(e,r);for(let r of t.blocks)r.flash>0&&(e.alpha(Math.min(1,r.flash)*.6),e.rect(r.x,r.y,r.w,r.h,Yo),e.alpha(1),r.look==="set"&&td(e,r));for(let r of t.blocks)r.highlight&&Vi(e,r,O.light);let n=Math.max(0,Math.min(200,Math.floor(t.rubble)));for(let r=0;r<n;r++){let s=nd(r,t),i=Me.rubble[r%Me.rubble.length]??Me.rubble[0],a=Ut(i);e.sprite(a,Math.round(s.x)-Math.floor(a.w/2),Math.round(s.y)-a.h+1)}let o=t.capstone;if(o.state!=="none"){if(o.state==="waiting"&&o.flag!=="none"){let r=T.sledge.x+15,s=T.sledge.y+5;e.rect(r,s-18,1,18,z[1]),e.rect(r,s-19,1,1,O.light);let i=o.flag==="passed"?Wo.green:Wo.red;for(let a=0;a<4;a++)e.rect(r+1,s-18+a,6-a*1.5,1,i);e.rect(r+1,s-15,1,1,xe)}Xi(e,o)}}function Xi(e,t){let n=Ut(t.ready?Me.capstoneGleam:Me.capstone),o=Math.round(t.x)-Math.floor(n.w/2),r=Math.round(t.y)-n.h;e.sprite(n,o,r),t.ready&&e.sprite(Ut(Me.glint),o-3,r-2)}function rd(e,t,n,o){let r=Math.max(4,Math.min(40,Math.round(o))),s=Math.round(t),i=Math.round(n);for(let a=0;a<r;a++){let l=r-(a-a%2),c=i-1-a,u=a>=r-3,f=a%2===1;e.rect(s-l,c,l,1,u?O.light:f?V.face:V.light),e.rect(s,c,l,1,u?O.mid:f?V.dark:V.shade)}e.rect(s-r-1,i-1,2*r+2,1,V.dark)}var sd=new Set(["walk","carry-scroll","carry-stone","carry-ration"]),id=new Set(["laborer","mason","scribe","skeptic","surveyor"]);function ad(e,t){if(t<=1)return 0;if(e.pose==="work"&&id.has(e.cast))return e.stroke<.5?1:0;let n=sd.has(e.pose)?8:4,o=Number.isFinite(e.poseTime)?Math.max(0,e.poseTime):0;return Math.floor(o*n)%t}function ld(e){let t=_u.frames(e.cast,e.pose,e.ration,e.ghost);return t[ad(e,t.length)]??null}function cd(e,t){let n=t.blockH;if(!(n>0)||!Number.isFinite(e))return e-8;let o=Math.max(1,Math.ceil((K.baseY-(e-6))/n));return o<=t.base?K.baseY-o*n:e-8}function ud(e,t,n,o){let r=cd(n,o);if(!(r>=Dt)){e.rect(t-4,r,1,Dt-r,z[1]),e.rect(t+3,r,1,Dt-r,z[1]);for(let s=Dt-2;s>=r;s-=3)e.rect(t-3,s,6,1,z[0])}}function dd(e,t,n){e.rect(t-7,n+2,1,Dt-n-2,z[1]),e.rect(t+6,n+2,1,Dt-n-2,z[1]),e.rect(t-9,n,18,1,z[0]),e.rect(t-9,n+1,18,1,z[1])}function zi(e,t){return Math.round(e.y)-t.h+t.top}function fd(e,t,n,o){let r=Z(t.seed),s=3+Math.floor(r()*5),i=s>4?2:1,a=Math.ceil(s/i),l=a*4-1+6,c=i*5-1+6,u=Number.isFinite(t.open)?Math.min(1,Math.max(0,t.open)):1;if(u<=0)return o;let f=Math.max(4,Math.round(l*u)),m=Math.max(4,Math.round(c*u)),h=u>=.5?3:1,y=Math.max(m+1,o-1-h)-m,x=Math.min(479-f,Math.max(1,n-Math.floor(f/2)-2));e.rect(x+1,y,f-2,1,xe),e.rect(x+1,y+m-1,f-2,1,xe),e.rect(x,y+1,1,m-2,xe),e.rect(x+f-1,y+1,1,m-2,xe),e.rect(x+1,y+1,f-2,m-2,Mt.fill);let S=Math.min(x+f-4,Math.max(x+2,n-1));if(e.rect(S,y+m-1,2,1,Mt.fill),h>=3&&(e.rect(S-1,y+m-1,1,2,xe),e.rect(S,y+m,1,1,Mt.fill),e.rect(S+1,y+m,1,1,xe),e.rect(S+2,y+m-1,1,1,xe),e.rect(S,y+m+1,1,1,xe)),u<1)return y;for(let v=0;v<s;v++){let E=Xn[Math.floor(r()*Xn.length)]??Xn[0]??[],M=Math.floor(v/a),U=x+3+v%a*4,$=y+3+M*5;E.forEach((_,G)=>{for(let Y=0;Y<_.length;Y++)_[Y]==="#"&&e.rect(U+Y,$+G,1,1,Mt.glyph)})}return y}function Qi(e){return Math.min(1,Math.max(0,Number.isFinite(e.alpha)?e.alpha:1))*(e.ghost?.5:1)}function Ji(e){return e.pose==="work"&&Math.round(e.y)<K.baseY}function pd(e){let t=[],n=[];for(let o of e.actors){if(o.pose==="climb"||o.pose==="climb-stone"||Ji(o)||!Number.isFinite(o.x)||!Number.isFinite(o.y))continue;let r=Qi(o);if(r<=0)continue;let s=o.cast==="arbab"?7:o.pose==="sleep"?8:5,i={cx:Math.round(o.x),y:Math.round(o.y),rx:s,ry:1};r>=1?t.push(i):n.push({spot:i,alpha:r})}return{solid:t,faded:n}}function md(e,t,n,o,r){let s=t.actors.map((c,u)=>({actor:c,i:u}));s.sort((c,u)=>c.actor.y-u.actor.y||c.i-u.i);let i=qu(t,n),a=0,l=[];for(let{actor:c}of s){for(;a<i.length&&(i[a]?.y??0)<=c.y;a++)i[a]?.draw(e,r,o);let u=ld(c);if(!u)continue;let f=Math.round(c.x),m=Math.round(c.y);(c.pose==="climb"||c.pose==="climb-stone")&&ud(e,f,m,t.pyramid);let h=Qi(c);Ji(c)&&(dd(e,f,m),e.tint(null),dn(e,t.sky,[{cx:f,y:m,rx:4,ry:0}],h),e.tint(o)),!(h<=0)&&(h<1&&e.alpha(h),e.sprite(u,f-Math.floor(u.w/2),m-u.h,c.facing===-1),h<1&&e.alpha(1),l.push({actor:c,sprite:u}))}for(;a<i.length;a++)i[a]?.draw(e,r,o);return l}function hd(e,t,n,o){let r=new Map;for(let{actor:s,sprite:i}of n){let a=Math.round(s.x),l=zi(s,i);if(s.icon){let c=Ut(Vn[s.icon]);l-=c.h+2,e.sprite(c,a-Math.floor(c.w/2),l)}if(s.highlight){let c=Ut(bs);(t.reducedMotion||Math.floor(Math.max(0,s.poseTime)*4)%2===0)&&e.sprite(c,a-Math.floor(c.w/2),l-c.h-1),l-=c.h+1}r.set(s,l)}for(let{actor:s,sprite:i}of n){if(!s.bubble)continue;let a=fd(e,s.bubble,Math.round(s.x),zi(s,i));r.set(s,Math.min(r.get(s)??a,a))}for(let{actor:s}of n)s.highlight&&fi(e,s.lane??s.id,Math.round(s.x),(r.get(s)??Math.round(s.y))-2,o)}var go="#FBF0D6",gd=.3;function bd(e,t){let{x:n,y:o}=t;switch(t.kind){case"dust":t.life>gd?(e.rect(n,o-1,2,1,go),e.rect(n,o,1,1,go),e.rect(n+1,o,1,1,In[2])):(e.alpha(.8),e.rect(n-1,o,3,1,go),e.rect(n,o-1,1,1,go),e.rect(n+1,o+1,1,1,In[2]),e.alpha(1));break;case"stone":e.rect(n,o,2,2,he.face),e.rect(n,o,1,1,he.light);break;case"sparkle":e.rect(n,o,1,1,Math.floor(t.life*10)%2===0?O.gleam:O.light);break;case"coin":e.rect(n,o,2,2,O.light);break}}function Zi(e,t){e.imageSmoothingEnabled=!1,e.globalAlpha=1;let n=Ks(e),o=t.sky.phase,r=te(t.time),s=Pt(o),i=si(t.shake,r);(i.dx!==0||i.dy!==0)&&(n.rect(0,0,480,128,At[o][0]??"#000000"),n.tint(s),n.rect(0,128,480,142,st[4]),n.tint(null)),n.offset(i.dx,i.dy),Js(n,t.sky,r),wi(n,o,r),n.tint(s);for(let f of t.far.slice(0,3))rd(n,f.x,f.y,f.height);n.tint(null),ki(n,o,r);let a=Ii(t.pyramid);dn(n,t.sky,zu(t,a)),t.pyramid.blocks.some(f=>f.look!=="empty"&&f.look!=="planned")&&ui(n,t.sky,K,t.pyramid),n.tint(s);for(let f of Yu)f.draw(n,r,s);od(n,t.pyramid),n.tint(null);let l=pd(t);dn(n,t.sky,l.solid);for(let f of l.faded)dn(n,t.sky,[f.spot],f.alpha);n.tint(s);let c=md(n,t,a,s,r);for(let f of t.particles)bd(n,f);n.tint(null),o==="night"&&ai(n,[..._i,...a.map(Ui)],r);let u=t.pyramid.capstone;ci(n,u,t.pyramid.apex),u.state!=="none"&&u.glow>0&&Xi(n,u),hd(n,t,c,i),n.offset(0,0),li(n,o),e.globalAlpha=1}var ea="arbab-ui-sound";function yd(e){try{return e()?.getItem(ea)==="on"}catch{return!1}}function xd(e,t){try{e()?.setItem(ea,t?"on":"off")}catch{}}function ta(e){let t=yd(e.storage),n=null,o=null,r=null,s=[],i=()=>{if(!(n||!e.AudioContext))try{n=new e.AudioContext;let f=n.createGain();f.gain.value=.25,f.connect(n.destination),o=f;let m=Math.floor(n.sampleRate*.2);r=n.createBuffer(1,m,n.sampleRate);let h=r.getChannelData(0),w=12345;for(let y=0;y<h.length;y++)w=Math.imul(w,1103515245)+12345>>>0,h[y]=w/4294967296*2-1}catch{n=null,o=null}},a=()=>{n&&n.state==="suspended"&&n.resume().catch(()=>{})},l=(f,m,h,w,y)=>{let x=f.createOscillator();x.type="sine",x.frequency.setValueAtTime(w,h),x.frequency.exponentialRampToValueAtTime(w*.4,h+.16);let S=f.createGain();if(S.gain.setValueAtTime(y,h),S.gain.exponentialRampToValueAtTime(.001,h+.22),x.connect(S),S.connect(m),x.start(h),x.stop(h+.25),r){let v=f.createBufferSource();v.buffer=r;let E=f.createBiquadFilter();E.type="lowpass",E.frequency.setValueAtTime(1800,h);let M=f.createGain();M.gain.setValueAtTime(y*.35,h),M.gain.exponentialRampToValueAtTime(.001,h+.06),v.connect(E),E.connect(M),M.connect(m),v.start(h),v.stop(h+.08)}},c=(f,m,h,w,y=.4)=>{let x=f.createBiquadFilter();x.type="lowpass",x.frequency.setValueAtTime(900,h);let S=f.createGain();S.gain.setValueAtTime(1e-4,h),S.gain.linearRampToValueAtTime(.35,h+.05),S.gain.setValueAtTime(.3,h+y-.1),S.gain.exponentialRampToValueAtTime(.001,h+y),x.connect(S),S.connect(m);for(let v of[-7,7]){let E=f.createOscillator();E.type="sawtooth",E.frequency.setValueAtTime(w,h),E.detune.setValueAtTime(v,h),E.connect(x),E.start(h),E.stop(h+y+.02)}},u=(f,m,h)=>{c(f,m,h,196,.35),c(f,m,h+.3,294,.5)};return{get enabled(){return t},toggle(){return t=!t,xd(e.storage,t),t&&(i(),a()),t},unlock(){t&&(i(),a())},play(f){if(!t||!n||!o)return;let m=n,h=o,w=m.currentTime+.01;switch(f){case"brief":case"report":c(m,h,w,220);break;case"stone":{let y=e.now();for(;s.length>0&&y-(s[0]??0)>=1e3;)s.shift();if(s.length>=3)return;s.push(y),l(m,h,w,140,.5);break}case"set":u(m,h,w);break;case"fall":l(m,h,w,60,.8);break;case"capstone":u(m,h,w);for(let y=0;y<10;y++)l(m,h,w+.9+y*.06,120,.2+y*.05);break}}}}var wd="This page needs its session token. Use the tab `arbab ui` opened, or run `arbab ui --no-open` to print a URL that carries it.",kd=2,Sd=3e4,vd=600;function Ed(e){let t={};for(let[n,o]of Object.entries(to)){let r=e.getElementById(o);if(!r)return null;t[n]=r}return t}function na(e,t,n){if(!e)return;Vt(e,16*t,16*t,n);let o=e.getContext("2d");o&&$o(o,Uo,0,0,t*n)}function Cd(e){let t=e.document,n=Ed(t),o=jt(t.getElementById(to.canvas));if(!n||!o)return null;let{stage:r,tooltip:s,notice:i,banner:a,connection:l,live:c,site:u}=n,f=Vr(e.devicePixelRatio),m=L=>{i.textContent=L,i.hidden=!1},h=q(t,{scale:1,color:A.muted,dpr:f});l.replaceChildren(h.el);let w=L=>{l.setAttribute("data-state",L);let{text:I,color:F}=Hs(L);h.set(I,F)};w("connecting");let y=Or(e.location.hash);if(!y)return m(wd),n.project.textContent="no session token",w("closed"),null;let x=o.getContext("2d");if(!x)return m("This browser cannot draw the scene; the ledger below still works."),null;o.width=480,o.height=270;let S=!1;try{S=e.matchMedia("(prefers-reduced-motion: reduce)").matches}catch{S=!1}let v=Ro({reducedMotion:S,random:Math.random}),E=Qn();na(jt(n.logo),2,f),na(jt(n.titleCardLogo),4,f),n.title.replaceChildren(q(t,{scale:3,color:A.gold,dpr:f},"ARBAB").el),n.titleCardWord.replaceChildren(q(t,{scale:6,color:A.gold,dpr:f},"ARBAB").el),n.siteTitle.replaceChildren(q(t,{scale:2,color:A.gold,dpr:f},"THE SITE").el);let M=q(t,{scale:1,color:A.sand,dpr:f},"THE SITE IS QUIET");n.caption.replaceChildren(M.el);let U="",$=(L,I)=>{U=Fo(v.world),M.set(jr(L,I,v.world))},_=[nr(t,n.gauge5h,"5h",f),nr(t,n.gauge7d,"7d",f)],G=Ps(t,n.kpis,{dpr:f,reducedMotion:S}),Y=ta({AudioContext:e.AudioContext,storage:e.storage,now:e.now}),Oe=()=>{n.sound.setAttribute("aria-pressed",String(Y.enabled)),n.sound.textContent=Y.enabled?"sound on":"sound off"};Oe(),n.sound.addEventListener("click",()=>{Y.toggle(),Oe()});let Fe=()=>t.fullscreenElement!==void 0&&t.fullscreenElement!==null&&t.fullscreenElement===u;n.siteFullscreen.hidden=typeof u.requestFullscreen!="function",n.siteFullscreen.addEventListener("click",()=>{try{let L=Fe()&&typeof t.exitFullscreen=="function"?t.exitFullscreen():u.requestFullscreen?.();L instanceof Promise&&L.catch(()=>{})}catch{}});let ve=()=>n.crewPanel.setAttribute("data-more",String(Cs(n.crewScroll)));n.crewScroll.addEventListener("scroll",ve);let Ie=()=>{let L=r.getBoundingClientRect(),I=Fe()?L.height:Br(e.window.innerHeight,n.header.getBoundingClientRect().height,n.kpis.getBoundingClientRect().height,u.getBoundingClientRect().height-L.height),F=Pr(L.width,I,e.devicePixelRatio);o.className=F.fluid?"fluid":"",o.style.width=F.fluid?"100%":`${F.width}px`,o.style.height=F.fluid?"auto":`${F.height}px`,ve()};Ie(),e.window.addEventListener("resize",Ie),t.addEventListener("fullscreenchange",Ie);let de=null,ze=new Map,De=0,be=null,me=null,ae=null,Ee=null,ft=[],Ue=()=>e.now()+De,$t=L=>{a.textContent=L,a.hidden=!1},_t=()=>{a.hidden=!0,a.textContent=""},We=()=>v.highlight(be??me??ae),yo=()=>{let L=o.getBoundingClientRect(),I=r.getBoundingClientRect();return{x:L.left-I.left,y:L.top-I.top}},xo=L=>{let I=yo(),F=o.getBoundingClientRect().width,Q=F>0?F/480:1,re=v.world.actors.find($e=>$e.lane===L);if(re)return{x:I.x+re.x*Q,y:I.y+(re.y-20)*Q};let ye=v.world.pyramid.blocks.find($e=>$e.lane===L);return ye?{x:I.x+(ye.x+ye.w)*Q,y:I.y+ye.y*Q}:{x:I.x+8,y:I.y+8}},bn=q(t,{scale:1,color:A.gold,dpr:f}),yn=R(t,"div","tip-title");yn.appendChild(bn.el);let je=()=>{let L=be??me??ae,I=L===null?void 0:ze.get(L);if(!L||!I){s.hidden=!0;return}let[F=L,...Q]=Ur(I,e.now(),De);bn.set(F),s.replaceChildren(yn,...Q.map($e=>R(t,"div","",$e)));let re=be!==null&&Ee?Ee:xo(L),ye=r.getBoundingClientRect().width;s.style.left=`${Math.max(0,Math.min(ye-220,re.x+12))}px`,s.style.top=`${Math.max(0,re.y+12)}px`,s.hidden=!1},Gt=L=>{ae=L,Wt.setPinned(L),et.setPinned(L),We(),je()},Ht={enter(L){me=L,We(),je()},leave(L){me===L&&(me=null),We(),je()},toggle(L){Gt(ae===L?null:L)}},Wt=Ls(t,{title:n.crewTitle,list:n.crew,empty:n.crewEmpty,recentGroup:n.recentGroup,recentTitle:n.recentTitle,recent:n.recent},E,f,Ht),xn=$s(t,{title:n.monumentTitle,body:n.monument},f),wn=Zr(t,{title:n.chronicleTitle,list:n.chronicle,empty:n.chronicleEmpty},f),et=Is(t,{title:n.ledgerTitle,head:n.ledgerHead,body:n.table},f,Ht);t.addEventListener("pointerdown",()=>Y.unlock()),t.addEventListener("keydown",L=>{Y.unlock(),L.key==="Escape"&&ae!==null&&Gt(null)}),o.addEventListener("pointermove",L=>{let I=o.getBoundingClientRect();if(I.width<=0||I.height<=0)return;let F=L.clientX??0,Q=L.clientY??0;be=v.pick((F-I.left)*480/I.width,(Q-I.top)*270/I.height);let re=r.getBoundingClientRect();Ee={x:F-re.left,y:Q-re.top},We(),je()}),o.addEventListener("pointerleave",()=>{be=null,Ee=null,We(),je()});let kn=L=>{let I=Fr(L);if(!I.ok){$t(I.message);return}let F=I.snapshot;_t(),w("live");let Q=Date.parse(F.now);De=Number.isNaN(Q)?0:Q-e.now();let re=Ue();try{v.apply(F)}catch{$t("The scene could not show this snapshot; the ledger is up to date.")}if(de===null){n.titleCard.className="title-card gone";let tt=()=>{n.titleCard.hidden=!0};S?tt():e.setTimeout(tt,vd)}let ye=Dr(F);n.project.textContent=ye.project,n.version.textContent=ye.version,n.held.hidden=!ye.held,n.footer.textContent=ye.footer;let $e=re/1e3;_[0].update(tr("5h",F.quota.fiveHour,F.quota.holdAbove.fiveHour,$e)),_[1].update(tr("7d",F.quota.sevenDay,F.quota.holdAbove.sevenDay,$e)),G.update(F,e.now()),$(F,re),ze=new Map(F.lanes.map(tt=>[tt.name,tt])),ae!==null&&!ze.has(ae)&&(ae=null),Wt.update(F,re),ve(),et.update(F,re),xn.update(F,re),ft=Oo(ft,de===null?Kr(F):qr(de,F)),wn.update(ft,re);let Cn=$r(de,F);Cn.length>0&&(c.textContent=Cn.join(". ")),de=F,Gt(ae)},pt=!1,Sn=()=>{let L=e.fetch;if(!L){m(Zn);return}let I;try{I=L(`${nt.snapshot}?${wo}=${encodeURIComponent(y)}`)}catch{I=Promise.reject(new Error("fetch threw"))}I.then(F=>{pt||m(rr(F))},()=>{pt||m(rr(null))})},Ve=new e.EventSource(`${nt.events}?${wo}=${encodeURIComponent(y)}`);Ve.addEventListener("open",()=>w("live")),Ve.addEventListener(ko.snapshot,L=>kn(L.data)),Ve.addEventListener(ko.problem,L=>$t(Ir(L.data))),Ve.addEventListener("error",()=>{Ve.readyState===kd?(w("closed"),Sn()):w("lost")});let Yt=null,vn=0,mt=0,En=L=>{if(pt)return;let I=Yt===null?16:Math.max(0,L-Yt);Yt=L,v.step(I),Zi(x,v.world),de&&Fo(v.world)!==U&&$(de,Ue());let F=v.world.events;for(let Q of F)Y.play(Q.kind);if(F.length=0,G.tick(e.now()),L-vn>=1e3){vn=L;let Q=Ue();Wt.tick(Q),et.tick(Q),s.hidden||je()}if(L-mt>=Sd){mt=L;let Q=Ue();wn.refresh(Q),de&&(xn.update(de,Q),$(de,Q))}e.requestAnimationFrame(En)};return e.requestAnimationFrame(En),{stop(){pt=!0,Ve.close()}}}function Md(){let e=globalThis,t=e.document,n=e.window;if(typeof t!="object"||t===null||typeof n!="object"||n===null||typeof e.EventSource!="function"||typeof e.requestAnimationFrame!="function")return null;let o=e.requestAnimationFrame,r=typeof e.matchMedia=="function"?e.matchMedia:null,s=typeof e.AudioContext=="function"?e.AudioContext:typeof e.webkitAudioContext=="function"?e.webkitAudioContext:null,i=typeof e.fetch=="function"?e.fetch:null;return{document:t,window:n,location:e.location,EventSource:e.EventSource,fetch:i?a=>i.call(n,a):null,AudioContext:s,storage:()=>{try{return e.localStorage??null}catch{return null}},matchMedia:a=>r?r.call(n,a):{matches:!1},requestAnimationFrame:a=>o.call(n,a),setTimeout:(a,l)=>e.setTimeout.call(n,a,l),devicePixelRatio:typeof e.devicePixelRatio=="number"?e.devicePixelRatio:1,now:()=>Date.now()}}var oa=Md();oa&&Cd(oa);})();\n';

// src/ui/client/app/hud/tokens.ts
var TOKENS = {
  bg: "#120d0a",
  "bg-2": "#1b140f",
  panel: "#241a12",
  "panel-2": "#2e2116",
  "panel-hi": "#3a2a1b",
  "frame-dark": "#0b0705",
  frame: "#6b4a26",
  "frame-hi": "#a87a3f",
  "frame-lo": "#3a2716",
  text: "#f4ead2",
  muted: "#b89f74",
  faint: "#7d6a4d",
  gold: "#ffd54a",
  "gold-2": "#e0a800",
  sand: "#e9c886",
  sky: "#5ba8d9",
  "st-running": "#5ba8d9",
  "st-preparing": "#8cc6e3",
  "st-waiting": "#e0a800",
  "st-asleep": "#8e7cc3",
  "st-success": "#3faf5a",
  "st-failed": "#d04040",
  "st-orphaned": "#85827a",
  /** The failed badge's ground: darker than st-failed, so light ink reads on it. */
  "badge-failed": "#b23a3a"
};
var CHIPS = {
  laborer: "#c9a46b",
  mason: "#3c6fb0",
  scribe: "#6e4c9e",
  skeptic: "#b23a3a",
  surveyor: "#3f8f5a",
  waterboy: "#e2b23a",
  scout: "#2f6b4f"
};
var BADGE_INK = TOKENS.bg;

// src/ui/client/app/hud/icons.ts
var ICON_COLORS = {
  // Gold: light, mid, gleam.
  Y: TOKENS.gold,
  y: TOKENS["gold-2"],
  W: "#fff6c9",
  // Sandstone: the lit face, its course line, the shaded face, its course line.
  L: "#f1e2bc",
  l: "#dcc796",
  S: "#b5843f",
  s: "#8f6a33",
  // Iron, wood, glass and sand, ink.
  i: "#c9c3b0",
  I: "#85827a",
  w: "#8b5a2b",
  g: TOKENS.sand,
  m: TOKENS.muted,
  // States.
  b: TOKENS["st-running"],
  p: TOKENS["st-asleep"],
  e: TOKENS["st-success"],
  r: TOKENS["st-failed"],
  a: TOKENS["st-waiting"]
};
var PYRAMID_GRID = pyramidGrid();
function pyramidGrid() {
  const rows = [];
  for (let y = 0; y < 16; y++) {
    const k = Math.floor(y / 2);
    let row = "";
    for (let x = 0; x < 16; x++) {
      if (x < 7 - k || x > 8 + k) row += ".";
      else if (y === 0 && x === 7) row += "W";
      else if (y < 4) row += x <= 7 ? "Y" : "y";
      else if (y % 2 === 1) row += x <= 7 ? "l" : "s";
      else row += x <= 7 ? "L" : "S";
    }
    rows.push(row);
  }
  return rows;
}
function gridSize(grid) {
  return { w: Math.max(0, ...grid.map((row) => row.length)), h: grid.length };
}

// src/ui/protocol.ts
var UI_PROTOCOL = 1;
var UI_ROUTES = {
  page: "/",
  script: "/app.js",
  style: "/app.css",
  events: "/events",
  snapshot: "/snapshot.json",
  icon: "/icon.svg"
};
var UI_TOKEN_PARAM = "token";
var UI_EVENTS = { snapshot: "snapshot", problem: "problem" };

// src/ui/client/app/page.ts
var PAGE_IDS = {
  header: "top",
  logo: "logo",
  title: "title",
  project: "project",
  version: "version",
  gauge5h: "gauge-5h",
  gauge7d: "gauge-7d",
  held: "held",
  connection: "connection",
  sound: "sound",
  banner: "banner",
  kpis: "kpis",
  site: "site",
  siteTitle: "site-title",
  siteFullscreen: "site-fullscreen",
  stage: "stage",
  canvas: "scene",
  titleCard: "title-card",
  titleCardLogo: "title-card-logo",
  titleCardWord: "title-card-word",
  tooltip: "tooltip",
  notice: "notice",
  caption: "caption",
  crewPanel: "crew-panel",
  crewTitle: "crew-title",
  crewScroll: "crew-scroll",
  crew: "crew",
  crewEmpty: "crew-empty",
  recentGroup: "recent-group",
  recentTitle: "recent-title",
  recent: "recent",
  monumentTitle: "monument-title",
  monument: "monument",
  chronicleTitle: "chronicle-title",
  chronicle: "chronicle",
  chronicleEmpty: "chronicle-empty",
  ledgerTitle: "ledger-title",
  ledgerHead: "ledger-head",
  table: "lanes",
  footer: "footer",
  live: "live"
};
var I = PAGE_IDS;
var PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="dark">
<title>arbab \xB7 pyramid</title>
<link rel="icon" href="${UI_ROUTES.icon}" type="image/svg+xml">
<link rel="stylesheet" href="${UI_ROUTES.style}">
<script src="${UI_ROUTES.script}" defer></script>
</head>
<body>
<header id="${I.header}" class="topbar">
<div class="brand">
<canvas id="${I.logo}" class="px logo" width="32" height="32" aria-hidden="true"></canvas>
<h1 id="${I.title}" class="wordmark">arbab</h1>
<p class="project"><span id="${I.project}">connecting\u2026</span> <span id="${I.version}" class="version"></span></p>
</div>
<div class="status">
<div class="gauges">
<div id="${I.gauge5h}" class="gauge" data-level="ok"></div>
<div id="${I.gauge7d}" class="gauge" data-level="ok"></div>
</div>
<div class="controls">
<span id="${I.held}" class="pill held" hidden>held</span>
<span id="${I.connection}" class="pill connection" data-state="connecting">connecting</span>
<button id="${I.sound}" type="button" aria-pressed="false">sound</button>
</div>
</div>
</header>
<p id="${I.banner}" class="banner" role="alert" hidden></p>
<main class="hud">
<section class="kpi-row" aria-labelledby="kpi-heading">
<h2 id="kpi-heading" class="visually-hidden">Lanes at a glance</h2>
<ul id="${I.kpis}" class="kpis"></ul>
</section>
<div class="grid">
<section id="${I.site}" class="frame panel site" aria-labelledby="${I.siteTitle}">
<div class="titlebar">
<h2 id="${I.siteTitle}">The site</h2>
<button id="${I.siteFullscreen}" type="button" class="small" aria-controls="${I.site}">full screen</button>
</div>
<div id="${I.stage}" class="stage">
<canvas id="${I.canvas}" width="480" height="270" role="img" aria-label="The pyramid scene: each lane is a worker building a block, and arbab hands out the work. The crew, the chronicle and the ledger say the same in text."></canvas>
<div id="${I.titleCard}" class="title-card" aria-hidden="true">
<canvas id="${I.titleCardLogo}" class="px" width="64" height="64"></canvas>
<div id="${I.titleCardWord}" class="title-card-word">ARBAB</div>
<p class="awakens">the site awakens\u2026</p>
</div>
<div id="${I.tooltip}" class="tooltip frame" role="tooltip" hidden></div>
<div id="${I.notice}" class="notice" hidden></div>
</div>
<p id="${I.caption}" class="caption">THE SITE IS QUIET</p>
</section>
<aside class="side" aria-label="Crew and monument">
<section id="${I.crewPanel}" class="frame panel crew-panel" aria-labelledby="${I.crewTitle}" data-more="false">
<div class="titlebar"><h2 id="${I.crewTitle}">Crew</h2></div>
<div id="${I.crewScroll}" class="crew-scroll">
<ul id="${I.crew}" class="crew"></ul>
<div id="${I.crewEmpty}" class="crew-empty"></div>
<details id="${I.recentGroup}" class="recent-group" hidden>
<summary id="${I.recentTitle}">Recently finished</summary>
<ul id="${I.recent}" class="recent"></ul>
</details>
</div>
</section>
<section class="frame panel monument-panel" aria-labelledby="${I.monumentTitle}">
<div class="titlebar"><h2 id="${I.monumentTitle}">Monument</h2></div>
<div id="${I.monument}" class="monument"></div>
</section>
</aside>
</div>
<div class="below">
<section class="frame panel" aria-labelledby="${I.chronicleTitle}">
<div class="titlebar"><h2 id="${I.chronicleTitle}">Chronicle</h2></div>
<ol id="${I.chronicle}" class="chronicle"></ol>
<p id="${I.chronicleEmpty}" class="empty">Nothing has happened yet.</p>
</section>
<section class="frame panel" aria-labelledby="${I.ledgerTitle}">
<div class="titlebar"><h2 id="${I.ledgerTitle}">Ledger</h2></div>
<div class="table-wrap">
<table aria-labelledby="${I.ledgerTitle}">
<thead><tr id="${I.ledgerHead}"><th scope="col">lane</th><th scope="col">role</th><th scope="col">state</th><th scope="col">attempt</th><th scope="col">calls</th><th scope="col">last tool</th><th scope="col">elapsed</th><th scope="col">cost</th></tr></thead>
<tbody id="${I.table}"></tbody>
</table>
</div>
</section>
</div>
</main>
<footer>
<p id="${I.footer}">Read-only</p>
</footer>
<div id="${I.live}" class="visually-hidden" aria-live="polite"></div>
</body>
</html>
`;
var vars = (entries2, prefix = "") => entries2.map(([name2, value]) => `  --${prefix}${name2}: ${value};`).join("\n");
var frame = (edge, bevel, hi = "var(--frame-hi)", lo = "var(--frame-lo)") => `0 -${edge}px 0 0 var(--frame-dark), 0 ${edge}px 0 0 var(--frame-dark), -${edge}px 0 0 0 var(--frame-dark), ${edge}px 0 0 0 var(--frame-dark),
    inset ${bevel}px ${bevel}px 0 0 ${hi}, inset -${bevel}px -${bevel}px 0 0 ${lo}`;
var PAGE_CSS = `:root {
  color-scheme: dark;
${vars(Object.entries(TOKENS))}
${vars(Object.entries(CHIPS), "chip-")}
  --s1: 4px;
  --s2: 8px;
  --s3: 12px;
  --s4: 16px;
  --s5: 20px;
  --s6: 24px;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
* { box-sizing: border-box; }
body {
  margin: 0; color: var(--text); line-height: 1.45;
  background: radial-gradient(ellipse 120% 60% at 50% -10%, #2a1d12 0, var(--bg) 70%) fixed, var(--bg);
}
p { margin: 0; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--sand); }
canvas.px { display: inline-block; vertical-align: middle; image-rendering: crisp-edges; image-rendering: pixelated; }
.pxt { display: inline-flex; align-items: center; line-height: 0; }
:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
.visually-hidden {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0;
  overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;
}
[hidden] { display: none !important; }

/* Pixel frames: square, notched corners; never rounded. */
.frame {
  margin: var(--s1); background: var(--panel); border-radius: 0;
  box-shadow: ${frame(4, 2)};
}
button {
  font: inherit; font-size: 13px; color: var(--text); background: var(--panel-2); border: 0; border-radius: 0;
  margin: 2px; padding: var(--s1) 10px; cursor: pointer; white-space: nowrap;
  box-shadow: ${frame(2, 2)};
}
button:hover { background: var(--panel-hi); }
button:active, button[aria-pressed="true"] {
  color: var(--gold); background: var(--panel);
  box-shadow: ${frame(2, 2, "var(--frame-lo)", "var(--frame-hi)")};
}
button.small { font-size: 12px; padding: 2px var(--s2); }

/* Top bar */
.topbar {
  position: sticky; top: 0; z-index: 10; height: 56px; display: flex; align-items: center; gap: var(--s4);
  padding: 0 var(--s4); background: var(--bg-2); border-bottom: 2px solid var(--frame);
  box-shadow: 0 2px 0 0 var(--frame-dark);
}
.brand { display: flex; align-items: center; gap: var(--s3); min-width: 0; }
.logo { width: 32px; height: 32px; }
h1 { margin: 0; font-size: 18px; line-height: 0; color: var(--gold); }
.project { color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#${I.project} { color: var(--text); font-weight: 600; }
.version { color: var(--muted); }
.status, .gauges, .controls { display: flex; align-items: center; gap: var(--s3); min-width: 0; }
.status { margin-left: auto; }
.gauge { display: flex; align-items: center; gap: 6px; --level: var(--sand); }
.gauge[data-level="warn"] { --level: var(--gold-2); }
.gauge[data-level="hold"] { --level: var(--st-failed); }
.gauge-bar {
  position: relative; width: 96px; height: 10px; background: var(--frame-dark);
  box-shadow: 0 0 0 1px var(--frame-lo);
}
.gauge-fill {
  position: absolute; left: 0; top: 0; bottom: 0; width: 0;
  background: repeating-linear-gradient(90deg, var(--level) 0 3px, transparent 3px 4px);
}
.gauge-tick { position: absolute; top: -2px; bottom: -2px; width: 1px; background: var(--text); }
.pill {
  display: inline-flex; align-items: center; gap: 6px; padding: 3px var(--s2); margin: 2px; line-height: 0;
  background: var(--panel); box-shadow: ${frame(2, 1)}; font-size: 12px;
}
.pill.held { line-height: 1; color: var(--bg); background: var(--st-waiting); font-weight: 700; text-transform: uppercase; }
.connection::before { content: ""; width: 6px; height: 6px; background: var(--muted); }
.connection[data-state="live"]::before { background: var(--st-success); animation: pulse 2s steps(4) infinite; }
.connection[data-state="lost"]::before { background: var(--st-waiting); }
.connection[data-state="closed"]::before { background: var(--st-failed); }
@keyframes pulse { 50% { opacity: 0.3; } }
.banner { padding: var(--s2) var(--s4); background: var(--st-failed); color: #fff; font-weight: 600; }

/* The dashboard. Its vertical spacing around the scene card is PAGE_GAPS in hud.ts: keep the two in step. */
.hud { display: grid; gap: var(--s3); padding: var(--s3) var(--s4) var(--s4); max-width: 1880px; margin: 0 auto; }
.grid, .side, .below { display: grid; gap: var(--s3); grid-template-columns: minmax(0, 1fr); align-items: start; }
.hud > *, .grid > *, .side > *, .below > * { min-width: 0; }
.side { align-content: start; }
@media (min-width: 900px) {
  .side { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .below { grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); }
}
@media (min-width: 1280px) {
  .grid { grid-template-columns: minmax(0, 1fr) 360px; align-items: stretch; }
  /* As tall as the scene card and no taller: size containment keeps the crew from stretching the row. The items
     stretch, so the crew panel fills the first row instead of shrinking to its title around a zero-basis list. */
  .side { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; align-content: stretch; align-items: stretch; contain: size; }
  .crew-panel { display: flex; flex-direction: column; min-height: 0; }
  .crew-panel > .titlebar { flex: none; }
  .crew-panel .crew-scroll { flex: 1 1 0; min-height: 0; max-height: none; overflow-y: auto; }
}
.panel { padding: var(--s3); min-width: 0; }
.titlebar {
  display: flex; align-items: center; justify-content: space-between; gap: var(--s2);
  min-height: 30px; margin-bottom: var(--s3); padding-bottom: var(--s2); border-bottom: 2px solid var(--frame-lo);
}
h2 { margin: 0; font-size: 14px; line-height: 0; color: var(--gold); }
.empty { color: var(--muted); padding: var(--s2) 0; }

/* KPI cards */
.kpis { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s3); grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); }
.kpi { display: grid; grid-template-columns: 16px minmax(0, 1fr); grid-template-areas: "icon label" "num num"; gap: var(--s2) var(--s2); align-items: center; padding: var(--s3) 14px; }
.kpi .icon { grid-area: icon; width: 16px; height: 16px; }
.kpi .kpi-label { grid-area: label; }
.kpi .kpi-number { grid-area: num; min-height: 44px; }
/* Wide: one row per card (icon, label, number), so the KPI row leaves the scene its height. */
@media (min-width: 1280px) {
  .kpi { grid-template-columns: 16px auto minmax(0, 1fr); grid-template-areas: "icon label num"; padding: var(--s2) 14px; }
  .kpi .kpi-number { justify-self: end; }
}

/* The scene card: lean chrome, so 3\xD7 fits a 1080-px screen (stageRoom in hud.ts measures it). */
.site { padding: var(--s2); }
.site .titlebar { min-height: 28px; margin-bottom: var(--s2); padding-bottom: 6px; }
.stage {
  position: relative; display: flex; align-items: center; justify-content: center; min-width: 0; overflow: hidden;
  background-color: var(--frame-dark);
  background-image:
    repeating-linear-gradient(45deg, rgb(255 255 255 / 0.025) 0 2px, transparent 2px 8px),
    repeating-linear-gradient(-45deg, rgb(0 0 0 / 0.25) 0 2px, transparent 2px 8px),
    radial-gradient(ellipse at center, var(--bg-2) 0, var(--frame-dark) 80%);
  box-shadow: inset 0 0 0 2px var(--frame-lo);
}
#${I.canvas} { display: block; flex: none; width: 480px; height: 270px; image-rendering: crisp-edges; image-rendering: pixelated; }
/* Below 1\xD7: the stage's width, the height by the art's aspect ratio. */
#${I.canvas}.fluid { flex: 1 1 auto; max-width: 100%; aspect-ratio: 480 / 270; }
.caption {
  display: flex; justify-content: center; min-height: 27px; margin-top: 6px; padding: var(--s2);
  line-height: 0; color: var(--sand); background: var(--bg-2); box-shadow: inset 0 0 0 2px var(--frame-lo);
}
.site:fullscreen { margin: 0; width: 100vw; height: 100vh; display: flex; flex-direction: column; background: var(--bg); box-shadow: none; }
.site:fullscreen .stage { flex: 1; min-height: 0; }
.title-card {
  position: absolute; inset: 0; z-index: 3; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: var(--s4); background: radial-gradient(ellipse at center, var(--panel) 0, var(--bg) 75%);
  transition: opacity 0.6s steps(6), visibility 0s linear 0.6s;
}
.title-card.gone { opacity: 0; visibility: hidden; }
.title-card-word { line-height: 0; color: var(--gold); font-size: 32px; }
.awakens { color: var(--muted); font-style: italic; }
.tooltip { position: absolute; z-index: 4; pointer-events: none; min-width: 190px; max-width: 320px; padding: 10px 12px; font-size: 13px; }
.tooltip .tip-title { margin-bottom: 6px; line-height: 0; }
.tooltip div + div { color: var(--muted); }
.notice {
  position: absolute; inset: 0; z-index: 5; display: grid; place-items: center; padding: var(--s4); text-align: center;
  background: rgb(18 13 10 / 0.94); font-size: 15px;
}

/* Crew: the list scrolls inside its panel, with a fade at the bottom edge while there is more below. */
.crew-panel { position: relative; }
.crew-scroll { min-height: 0; max-height: 640px; overflow: auto; }
.crew-panel[data-more="true"]::after {
  content: ""; position: absolute; left: var(--s3); right: var(--s3); bottom: var(--s3); height: 36px; pointer-events: none;
  background: linear-gradient(to bottom, transparent, var(--panel));
}
.crew { list-style: none; margin: 0; padding: 2px; display: grid; gap: var(--s3); }
.card {
  width: calc(100% - 4px); display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 10px; align-items: start;
  padding: var(--s2); text-align: left; white-space: normal; font-size: 14px; color: var(--text); background: var(--panel-2);
}
.card[aria-pressed="true"] { color: var(--text); }
.card[aria-pressed="true"] .name { color: var(--gold); }
.tile {
  display: grid; place-items: end center; width: 44px; height: 62px; padding-bottom: var(--s1);
  background: color-mix(in srgb, var(--chip, var(--frame)) 38%, var(--bg-2)); box-shadow: inset 0 0 0 2px var(--frame-dark);
}
.tile .avatar { width: 36px; height: 54px; }
.tile-arbab { flex: none; width: 56px; height: 86px; background: var(--bg-2); }
.tile-arbab .avatar { width: 48px; height: 78px; }
.tile.ghost .avatar { opacity: 0.75; }
${Object.keys(CHIPS).map((cast) => `.cast-${cast} { --chip: var(--chip-${cast}); }`).join("\n")}
.card-body { display: grid; gap: 3px; min-width: 0; }
.card-head, .card-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--s2); min-width: 0; }
.name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.meta, .stats, .calls, .elapsed, .num { color: var(--muted); font-size: 13px; }
.stats { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.elapsed, .calls { white-space: nowrap; }
.progress { display: flex; align-items: center; gap: var(--s2); }
.bar { position: relative; flex: 1; height: 8px; overflow: hidden; background: var(--frame-dark); box-shadow: 0 0 0 1px var(--frame-lo); }
.bar-fill {
  position: absolute; left: 0; top: 0; bottom: 0; width: 0;
  background: repeating-linear-gradient(90deg, var(--gold) 0 4px, var(--gold-2) 4px 5px, var(--frame-dark) 5px 6px);
}
.badge { display: inline-flex; align-items: center; flex: none; padding: 2px var(--s1); background: var(--tone, var(--st-orphaned)); box-shadow: 0 0 0 1px var(--frame-dark); }
${["running", "preparing", "waiting", "asleep", "success", "orphaned"].map((t) => `.tone-${t} { --tone: var(--st-${t}); }`).join("\n")}
.tone-failed { --tone: var(--badge-failed); }
.crew-empty { display: flex; align-items: center; gap: var(--s3); padding: var(--s2) 0; }
.empty-lead { font-weight: 600; }
.empty-hint { color: var(--muted); font-size: 13px; }
.recent-group { margin-top: var(--s3); }
.recent-group summary { cursor: pointer; padding: var(--s1) 0; line-height: 0; }
.recent { list-style: none; margin: var(--s2) 0 0; padding: 0; display: grid; gap: var(--s1); }
.recent-item { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto auto auto; gap: var(--s2); align-items: center; }
.recent-item .tile { height: 44px; overflow: hidden; }

/* Monument */
.monument-head { display: flex; align-items: baseline; gap: var(--s2); margin-bottom: 10px; }
.stepper { list-style: none; margin: 0; padding: 0; }
.step { position: relative; display: grid; grid-template-columns: 20px auto minmax(0, 1fr); gap: 10px; align-items: center; padding: 6px 0; }
.step + .step::before { content: ""; position: absolute; left: 9px; top: -8px; width: 2px; height: 16px; background: var(--frame-lo); }
.step[data-state="done"] + .step::before { background: var(--gold-2); }
.node {
  position: relative; z-index: 1; justify-content: center; width: 20px; height: 20px; background: var(--bg-2);
  box-shadow: 0 0 0 2px var(--frame-dark), inset 0 0 0 2px var(--frame-lo);
}
.step[data-state="done"] .node { box-shadow: 0 0 0 2px var(--frame-dark), inset 0 0 0 2px var(--gold-2); }
.step[data-state="failed"] .node { box-shadow: 0 0 0 2px var(--frame-dark), inset 0 0 0 2px var(--st-failed); }
.detail { color: var(--muted); font-size: 13px; text-align: right; }

/* Chronicle */
.chronicle { list-style: none; margin: 0; padding: 0; max-height: 380px; overflow: auto; }
.chronicle-line {
  display: grid; grid-template-columns: 12px minmax(0, 1fr) auto; gap: var(--s2); align-items: center;
  padding: 5px var(--s1); border-bottom: 1px solid var(--frame-lo);
}
.chronicle-line .ago { color: var(--muted); font-size: 12px; white-space: nowrap; }
.chronicle-line.enter { animation: slide-in 0.4s steps(5) both; }
@keyframes slide-in { from { transform: translateX(-16px); opacity: 0; } to { transform: none; opacity: 1; } }

/* Ledger */
.table-wrap { max-height: 380px; overflow: auto; box-shadow: inset 0 0 0 1px var(--frame-lo); }
table { border-collapse: separate; border-spacing: 0; width: 100%; font-size: 13px; }
thead th { position: sticky; top: 0; z-index: 1; padding: 0; text-align: left; background: var(--panel-hi); border-bottom: 2px solid var(--frame-dark); }
thead th.num { text-align: right; }
button.sort {
  width: 100%; margin: 0; padding: 6px var(--s2); text-align: inherit; font-size: 12px; font-weight: 600;
  color: var(--muted); background: transparent; box-shadow: none; text-transform: uppercase; letter-spacing: 0.04em;
}
button.sort:hover { color: var(--text); }
th[aria-sort="ascending"] .sort, th[aria-sort="descending"] .sort { color: var(--gold); }
th[aria-sort="ascending"] .sort::after { content: " \u25B2"; }
th[aria-sort="descending"] .sort::after { content: " \u25BC"; }
tbody th, tbody td { padding: 5px var(--s2); text-align: left; font-weight: 400; white-space: nowrap; border-bottom: 1px solid var(--frame-lo); }
tbody th { font-weight: 600; }
tbody tr { cursor: pointer; }
tbody tr:nth-child(even) { background: var(--panel-2); }
tbody tr:hover, tbody tr.pinned { background: var(--panel-hi); }
tbody tr.pinned th { color: var(--gold); }
tbody .num { text-align: right; color: var(--text); }

footer { padding: 0 var(--s4) var(--s4); color: var(--muted); font-size: 13px; text-align: center; }

@media (max-width: 899px) {
  .topbar { height: auto; min-height: 56px; flex-wrap: wrap; padding: var(--s2) var(--s4); }
  .status { flex-wrap: wrap; }
}
/* Narrow (a phone): nothing wider than the screen. The top bar stacks its rows: the logo, the gauges, the buttons. */
@media (max-width: 599px) {
  .topbar { flex-direction: column; align-items: stretch; gap: var(--s2); }
  .status { margin-left: 0; flex-direction: column; align-items: flex-start; gap: var(--s2); }
  .gauges, .controls { flex-wrap: wrap; }
  .hud { padding: var(--s2); }
  .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .card-head, .card-foot { flex-wrap: wrap; }
  .recent-item { grid-template-columns: 44px minmax(0, 1fr) auto; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
}
`;

// src/ui/client/app/assets.ts
var PLACEHOLDER_SCRIPT = `(function () {
  var p = document.createElement("p");
  p.className = "banner";
  p.textContent = "The page script is built by pnpm build.";
  (document.querySelector("main") || document.body).appendChild(p);
})();
`;
function gridSvg(grid) {
  const { w, h } = gridSize(grid);
  const rects = [];
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const color = ICON_COLORS[row[x] ?? "."];
      if (color === void 0) {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < row.length && ICON_COLORS[row[end] ?? "."] === color) end++;
      rects.push(`<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${color}"/>`);
      x = end;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" shape-rendering="crispEdges">${rects.join("")}</svg>
`;
}
var ICON_SVG = gridSvg(PYRAMID_GRID);
function uiAssets() {
  return { html: PAGE_HTML, css: PAGE_CSS, js: UI_SCRIPT ?? PLACEHOLDER_SCRIPT, icon: ICON_SVG };
}

// src/ui/server/http.ts
import { timingSafeEqual } from "node:crypto";
import { createServer as createServer2 } from "node:http";
var SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cross-Origin-Opener-Policy": "same-origin"
};
var MAX_URL_LENGTH = 2048;
var FAILURES_BEFORE_PROBLEM = 3;
var PROBLEM_MAX = 200;
var MAX_BUFFERED = 4 * 1024 * 1024;
var TEXT = "text/plain; charset=utf-8";
var message3 = (err) => err instanceof Error ? err.message : String(err);
function comparable(snapshot) {
  const { now: _now, ...rest } = snapshot;
  return JSON.stringify(rest);
}
function startUiServer(options) {
  const tickMs = options.tickMs ?? 1e3;
  const heartbeatTicks = Math.max(1, Math.ceil((options.heartbeatMs ?? 3e4) / tickMs));
  const maxClients = options.maxClients ?? 16;
  const token = Buffer.from(options.token);
  let port = options.port;
  const clients = /* @__PURE__ */ new Set();
  let timer = null;
  let latest = null;
  let lastSent = null;
  let ticksSinceSent = 0;
  let failures = 0;
  let problem = null;
  const send = (res, event, data) => {
    res.write(`event: ${event}
data: ${data}

`);
    if (res.writableLength > MAX_BUFFERED) res.destroy();
  };
  const broadcast = (event, data) => {
    for (const res of clients) send(res, event, data);
  };
  function built(snapshot, counts) {
    const recovered = problem !== null;
    failures = 0;
    problem = null;
    latest = JSON.stringify(snapshot);
    const key = comparable(snapshot);
    if (counts) ticksSinceSent++;
    if (recovered || key !== lastSent || ticksSinceSent >= heartbeatTicks) {
      lastSent = key;
      ticksSinceSent = 0;
      broadcast(UI_EVENTS.snapshot, latest);
    }
    return latest;
  }
  function tick() {
    let snapshot;
    try {
      snapshot = options.snapshot();
    } catch (err) {
      failures++;
      if (failures >= FAILURES_BEFORE_PROBLEM && problem === null) {
        problem = JSON.stringify({ message: message3(err).slice(0, PROBLEM_MAX) });
        broadcast(UI_EVENTS.problem, problem);
      }
      return;
    }
    built(snapshot, true);
  }
  function stopTicking() {
    if (timer !== null) clearInterval(timer);
    timer = null;
    latest = null;
    lastSent = null;
    ticksSinceSent = 0;
    failures = 0;
    problem = null;
  }
  function reply(req, res, status, type, body, extra = {}) {
    res.writeHead(status, { ...SECURITY_HEADERS, ...extra, "Content-Type": type, "Content-Length": String(Buffer.byteLength(body)) });
    res.end(req.method === "HEAD" ? void 0 : body);
  }
  function tokenMatches(query) {
    const given = query.get(UI_TOKEN_PARAM);
    if (given === null) return false;
    const bytes = Buffer.from(given);
    return bytes.length === token.length && timingSafeEqual(bytes, token);
  }
  function openEvents(req, res) {
    if (clients.size >= maxClients) {
      reply(req, res, 503, TEXT, "too many clients\n");
      return;
    }
    res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": "text/event-stream; charset=utf-8", Connection: "keep-alive" });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.write("retry: 2000\n\n");
    let first = latest;
    if (first === null) {
      try {
        first = built(options.snapshot(), false);
      } catch {
      }
    }
    if (first !== null) send(res, UI_EVENTS.snapshot, first);
    if (problem !== null) send(res, UI_EVENTS.problem, problem);
    clients.add(res);
    res.on("close", () => {
      clients.delete(res);
      if (clients.size === 0) stopTicking();
    });
    timer ??= setInterval(tick, tickMs);
  }
  function handle(req, res) {
    const host = (req.headers.host ?? "").toLowerCase();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return reply(req, res, 403, TEXT, "forbidden host\n");
    if (req.method !== "GET" && req.method !== "HEAD") {
      return reply(req, res, 405, TEXT, "method not allowed\n", { Allow: "GET, HEAD" });
    }
    const url = req.url ?? "/";
    if (url.length > MAX_URL_LENGTH) return reply(req, res, 414, TEXT, "URL too long\n");
    const origin = req.headers.origin;
    if (req.headers["sec-fetch-site"] === "cross-site" || origin !== void 0 && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`) {
      return reply(req, res, 403, TEXT, "forbidden origin\n");
    }
    const q = url.indexOf("?");
    const path = q === -1 ? url : url.slice(0, q);
    const query = new URLSearchParams(q === -1 ? "" : url.slice(q + 1));
    switch (path) {
      case UI_ROUTES.page:
        return reply(req, res, 200, "text/html; charset=utf-8", options.assets.html);
      case UI_ROUTES.script:
        return reply(req, res, 200, "text/javascript; charset=utf-8", options.assets.js);
      case UI_ROUTES.style:
        return reply(req, res, 200, "text/css; charset=utf-8", options.assets.css);
      case UI_ROUTES.icon:
        return reply(req, res, 200, "image/svg+xml; charset=utf-8", options.assets.icon);
      case "/favicon.ico":
        res.writeHead(204, SECURITY_HEADERS);
        return void res.end();
      case UI_ROUTES.snapshot:
      case UI_ROUTES.events:
        if (!tokenMatches(query)) return reply(req, res, 401, TEXT, "a valid token is required\n");
        if (path === UI_ROUTES.events) return openEvents(req, res);
        try {
          return reply(req, res, 200, "application/json; charset=utf-8", JSON.stringify(options.snapshot()));
        } catch (err) {
          return reply(req, res, 500, TEXT, `${message3(err)}
`);
        }
      default:
        return reply(req, res, 404, TEXT, "not found\n");
    }
  }
  const server = createServer2({ requireHostHeader: false }, (req, res) => {
    try {
      handle(req, res);
    } catch (err) {
      if (!res.headersSent) reply(req, res, 500, TEXT, `${message3(err)}
`);
      else res.destroy();
    }
  });
  server.on("clientError", (err, socket) => {
    if (!socket.writable || err.code === "ECONNRESET") return void socket.destroy();
    const status = err.code === "HPE_HEADER_OVERFLOW" ? "431 Request Header Fields Too Large" : "400 Bad Request";
    const headers = Object.entries(SECURITY_HEADERS).map(([name2, value]) => `${name2}: ${value}\r
`);
    socket.end(`HTTP/1.1 ${status}\r
${headers.join("")}Connection: close\r
Content-Length: 0\r
\r
`);
  });
  return new Promise((resolve13, reject) => {
    server.once("error", (err) => {
      reject(new ArbabError("runtime", `cannot listen on 127.0.0.1:${options.port}: ${err.message}`, { cause: err }));
    });
    server.listen(options.port, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new ArbabError("runtime", "the server has no TCP address"));
        return;
      }
      port = address.port;
      let closing = null;
      resolve13({
        url: `http://127.0.0.1:${port}/#${UI_TOKEN_PARAM}=${options.token}`,
        port,
        close: () => {
          closing ??= new Promise((done) => {
            stopTicking();
            for (const res of clients) res.end();
            clients.clear();
            server.close(() => done());
            server.closeAllConnections();
          });
          return closing;
        }
      });
    });
  });
}

// src/ui/server/snapshot.ts
import { statSync as statSync6 } from "node:fs";
import { basename, isAbsolute as isAbsolute11, join as join27, relative as relative9, sep as sep7 } from "node:path";
var MAX_LANES = 300;
var LANDED_KEPT = 5;
var REASON_MAX = 200;
var TOOL_NAME2 = /^[A-Za-z0-9_.:-]{1,64}$/;
var REPORT_STATUSES = ["done", "partial", "blocked"];
var isObject3 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var finiteOrNull = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
var countOrZero = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0;
var tokenOrNull = (v) => typeof v === "string" && TOOL_NAME2.test(v) ? v : null;
var parsedMs = (v) => {
  if (typeof v !== "string") return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
};
var stateKey = (r) => JSON.stringify([r.state, r.attempt, r.since, r.shepherdPid, r.endState ?? null, r.reason ?? null]);
function briefUnderPreflight(root, brief) {
  if (typeof brief !== "string" || brief === "") return false;
  const rel = relative9(join27(root, PREFLIGHT_DIR), isAbsolute11(brief) ? brief : join27(root, brief));
  return rel !== "" && !isAbsolute11(rel) && rel.split(sep7)[0] !== "..";
}
function laneKind(name2, generatedBy, preflightBrief) {
  if (generatedBy !== null) {
    if (name2 === `${generatedBy}-verify`) return "verify";
    if (name2.startsWith(`${generatedBy}-review-`)) return "review";
    if (name2.startsWith(`${generatedBy}-skeptic-`)) return "skeptic";
  }
  if (preflightBrief && (name2.endsWith("-pf-tools") || name2.endsWith("-pf-model"))) return "preflight";
  return "lane";
}
function readSummary(runsRoot, lane, attempt) {
  const value = readJson(attemptFiles(runPaths(runsRoot, lane).attemptDir(attempt)).summary);
  if (value === null) return null;
  if (!isObject3(value)) throw new ArbabError("io", `the summary of ${lane} attempt ${attempt} is not a JSON object`);
  return value;
}
function readLane(source, name2, record2, state, nowMs) {
  const { runsRoot } = source;
  const paths = runPaths(runsRoot, name2);
  const spec = readJson(paths.laneFile);
  const role2 = isObject3(spec) ? spec["role"] : void 0;
  if (!ROLES.includes(role2)) throw new ArbabError("io", `the lane file of ${name2} has no valid role`);
  const worktree = isObject3(spec) ? spec["worktree"] : void 0;
  const preflightBrief = briefUnderPreflight(source.root, isObject3(spec) ? spec["brief"] : void 0);
  const generatedBy = generatingIntegration(readGenerated(runsRoot, name2)?.by ?? null);
  const attempts = listAttempts(runsRoot, name2);
  const files = (n) => attemptFiles(paths.attemptDir(n));
  let firstMs = null;
  if (attempts[0] !== void 0) {
    const started = readJson(files(attempts[0]).started);
    firstMs = isObject3(started) ? parsedMs(started["startedAt"]) : null;
  }
  if (firstMs === null) {
    const shepherd = readJson(paths.shepherdFile);
    firstMs = isObject3(shepherd) ? parsedMs(shepherd["startedAt"]) : null;
  }
  firstMs ??= parsedMs(record2.since);
  const current = record2.attempt >= 1 && attempts.includes(record2.attempt) ? record2.attempt : null;
  const summary = current === null ? null : readSummary(runsRoot, name2, current);
  const row = statusRow({ ...record2, state }, summary, nowMs);
  let toolCalls = countOrZero(row.toolCalls);
  let lastTool = row.lastTool;
  if (state === "running" && summary === null && current !== null) {
    const live = source.counter.count(name2, current, files(current).stream);
    toolCalls = live.toolCalls;
    lastTool = live.lastTool;
  }
  let costed = null;
  for (const n of [...attempts].reverse()) {
    costed = n === current ? summary : readSummary(runsRoot, name2, n);
    if (costed !== null) break;
  }
  let reportStatus = null;
  let findings = null;
  const reported = current !== null && current === attempts.at(-1);
  if (reported && (role2 === "implementer" || role2 === "verifier" || role2 === "reviewer")) {
    const report = latestReport(runsRoot, name2);
    if (role2 === "reviewer") {
      findings = isObject3(report) && Array.isArray(report["findings"]) ? report["findings"].length : null;
    } else {
      const status = isObject3(report) ? report["status"] : void 0;
      reportStatus = REPORT_STATUSES.find((s) => s === status) ?? null;
    }
  }
  const reason = typeof record2.reason === "string" && record2.reason !== "" ? record2.reason.slice(0, REASON_MAX) : null;
  const until = state === "held" || state === "waiting-reset" ? finiteOrNull(record2.until) : null;
  return {
    name: name2,
    role: role2,
    kind: laneKind(name2, generatedBy, preflightBrief),
    generatedBy,
    // A lane in its own worktree (a verifier's `worktree` may name itself) builds its own block.
    worktreeOf: isValidName(worktree) && worktree !== name2 ? worktree : null,
    state,
    endState: row.endState,
    hold: state === "held" ? record2.reason === NO_FREE_SLOT_REASON ? "slot" : "quota" : null,
    reason,
    until,
    attempt: record2.attempt,
    firstSeen: firstMs === null ? record2.since : new Date(firstMs).toISOString(),
    since: record2.since,
    elapsedMs: isLive(state) ? null : finiteOrNull(row.elapsedMs),
    toolCalls,
    lastTool: tokenOrNull(lastTool),
    turns: countOrZero(row.turns),
    failedTotal: countOrZero(row.failedTotal),
    costUsd: finiteOrNull(costed?.costUsd),
    costDeltaUsd: finiteOrNull(costed?.costDeltaUsd),
    model: typeof costed?.model === "string" ? costed.model.slice(0, 64) : null,
    effort: tokenOrNull(row.effort),
    reportStatus,
    findings
  };
}
function integrationSignature(files) {
  return files.map((file) => {
    const st = statSync6(file, { throwIfNoEntry: false });
    return st === void 0 ? "-" : `${st.size}:${st.mtimeMs}`;
  }).join("|");
}
function readUiIntegration(source, name2) {
  const paths = integrationPaths(source.root, source.config, name2);
  const record2 = readIntegration(paths);
  if (record2 === null) return null;
  const head = record2.headSha;
  const verify = readVerifyRecord(paths.verify, name2);
  const review = readReviewRecord(paths.review, name2);
  const readiness = readReadinessReport(paths.readiness, name2);
  const landing = readJson(paths.landing);
  let reviewCounts = null;
  if (review !== null && review.headSha === head) {
    reviewCounts = { lenses: review.lenses.length, confirmed: 0, refuted: 0, unverified: 0 };
    for (const finding of review.findings) reviewCounts[finding.verdict]++;
  }
  const landedAt = isObject3(landing) && landing["name"] === name2 && parsedMs(landing["landedAt"]) !== null ? landing["landedAt"] : null;
  return {
    name: name2,
    lanes: record2.merged.map((m) => m.lane),
    headSha: head,
    updatedAt: record2.updatedAt,
    verify: verify !== null && verify.headSha === head ? verify.passed ? "passed" : "failed" : null,
    review: reviewCounts,
    ready: readiness !== null && readiness.headSha === head ? readiness.ready : null,
    landedAt
  };
}
var byTime = (a, b) => (a ?? 0) - (b ?? 0);
var byName = (a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
function createSnapshotBuilder(source) {
  const lanes = /* @__PURE__ */ new Map();
  const integrations = /* @__PURE__ */ new Map();
  function readIntegrations() {
    const names = listIntegrations(source.root);
    for (const name2 of integrations.keys()) if (!names.includes(name2)) integrations.delete(name2);
    const out = [];
    for (const name2 of names) {
      let value = null;
      try {
        const paths = integrationPaths(source.root, source.config, name2);
        const signature = integrationSignature([paths.integration, paths.verify, paths.review, paths.readiness, paths.landing]);
        const cached = integrations.get(name2);
        if (cached?.signature === signature) {
          value = cached.value;
        } else {
          try {
            value = readUiIntegration(source, name2);
          } catch {
            value = null;
          }
          integrations.set(name2, { signature, value });
        }
      } catch {
        value = null;
      }
      if (value !== null) out.push(value);
    }
    return out;
  }
  return {
    build(nowMs) {
      const cutoffMs = nowMs - source.windowHours * 36e5;
      const all = readIntegrations().sort((a, b) => byTime(parsedMs(a.updatedAt), parsedMs(b.updatedAt)) || byName(a, b));
      const mergedBy = /* @__PURE__ */ new Map();
      const mergedRecently = /* @__PURE__ */ new Set();
      for (const integration of all) {
        const landedMs = parsedMs(integration.landedAt);
        const recent = integration.landedAt === null || landedMs !== null && landedMs >= cutoffMs;
        for (const lane of integration.lanes) {
          mergedBy.set(lane, integration.name);
          if (recent) mergedRecently.add(lane);
        }
      }
      let hidden = 0;
      const names = listLanes(source.runsRoot);
      const present = new Set(names);
      for (const name2 of lanes.keys()) if (!present.has(name2)) lanes.delete(name2);
      const inWindow = [];
      for (const name2 of names) {
        let facts;
        let record2;
        try {
          record2 = readState(source.runsRoot, name2);
          if (record2 === null) continue;
          const state = effectiveState(record2, source.alive);
          const key = stateKey(record2);
          const cached = lanes.get(name2);
          if (cached !== void 0 && cached.key === key && cached.facts.state === state && !isLive(state)) {
            facts = cached.facts;
          } else {
            facts = readLane(source, name2, record2, state, nowMs);
            if (isLive(state)) lanes.delete(name2);
            else lanes.set(name2, { key, facts });
          }
        } catch {
          lanes.delete(name2);
          hidden++;
          continue;
        }
        const sinceMs = parsedMs(record2.since);
        const visible = facts.state !== "finished" || sinceMs !== null && sinceMs >= cutoffMs || mergedRecently.has(name2);
        if (!visible) {
          hidden++;
          continue;
        }
        const { generatedBy, ...rest } = facts;
        const lane = { ...rest, integration: generatedBy ?? mergedBy.get(name2) ?? null };
        inWindow.push({ lane, firstMs: parsedMs(lane.firstSeen) ?? 0 });
      }
      inWindow.sort((a, b) => b.firstMs - a.firstMs || byName(a.lane, b.lane));
      hidden += Math.max(0, inWindow.length - MAX_LANES);
      const kept = inWindow.slice(0, MAX_LANES).sort((a, b) => a.firstMs - b.firstMs || byName(a.lane, b.lane));
      source.counter.retain(new Set(kept.map((k) => k.lane.name)));
      const landed = all.filter((i) => i.landedAt !== null).sort((a, b) => byTime(parsedMs(b.landedAt), parsedMs(a.landedAt)) || byName(a, b)).slice(0, LANDED_KEPT);
      const shown = all.filter((i) => i.landedAt === null || landed.includes(i));
      const quota2 = readQuota(source.home);
      const holdAbove = source.config.quota.holdAbove;
      return {
        protocol: UI_PROTOCOL,
        version: source.version,
        project: basename(source.root),
        now: new Date(nowMs).toISOString(),
        lanes: kept.map((k) => k.lane),
        hiddenLanes: hidden,
        integrations: shown,
        quota: {
          status: quota2?.status ?? null,
          fiveHour: quota2?.fiveHour ?? null,
          sevenDay: quota2?.sevenDay ?? null,
          observedAt: quota2?.observedAt ?? null,
          hold: holdDecision(quota2, holdAbove, Math.floor(nowMs / 1e3)),
          holdAbove: { fiveHour: holdAbove.fiveHour, sevenDay: holdAbove.sevenDay }
        },
        maxParallel: source.config.maxParallel
      };
    }
  };
}

// src/ui/server/tail.ts
import { closeSync as closeSync4, fstatSync, openSync as openSync4, readSync as readSync2 } from "node:fs";
var DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
var NEWLINE2 = 10;
var fresh = (attempt, path) => ({
  attempt,
  path,
  offset: 0,
  primed: false,
  pending: Buffer.alloc(0),
  seen: /* @__PURE__ */ new Set(),
  toolCalls: 0,
  lastTool: null
});
function countLine(tail, line) {
  if (line.trim() === "") return;
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  for (const { id, name: name2 } of toolUses(event)) {
    if (id !== null) {
      if (tail.seen.has(id)) continue;
      tail.seen.add(id);
    }
    if (name2 === REPORT_TOOL) continue;
    tail.toolCalls++;
    tail.lastTool = name2;
  }
}
function readMore(tail, max) {
  let fd;
  try {
    fd = openSync4(tail.path, "r");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw new ArbabError("io", `cannot open ${tail.path}: ${err.message}`, { cause: err });
  }
  try {
    const size = fstatSync(fd).size;
    if (size < tail.offset) {
      Object.assign(tail, fresh(tail.attempt, tail.path));
    }
    const want = Math.min(size - tail.offset, max);
    const chunk = Buffer.allocUnsafe(Math.max(0, want));
    let got = 0;
    while (got < want) {
      const n = readSync2(fd, chunk, got, want - got, tail.offset + got);
      if (n === 0) break;
      got += n;
    }
    return chunk.subarray(0, got);
  } catch (err) {
    throw new ArbabError("io", `cannot read ${tail.path}: ${err.message}`, { cause: err });
  } finally {
    closeSync4(fd);
  }
}
function consume(tail, chunk) {
  if (chunk.length === 0) return;
  tail.offset += chunk.length;
  const bytes = tail.pending.length > 0 ? Buffer.concat([tail.pending, chunk]) : chunk;
  let start = 0;
  for (let end = bytes.indexOf(NEWLINE2, start); end !== -1; end = bytes.indexOf(NEWLINE2, start)) {
    countLine(tail, bytes.toString("utf8", start, end));
    start = end + 1;
  }
  tail.pending = Buffer.from(bytes.subarray(start));
}
function createToolCallCounter(options = {}) {
  const max = options.maxBytesPerCall ?? DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(max) || max < 1) throw new ArbabError("usage", `maxBytesPerCall ${max} must be a positive integer`);
  const tails = /* @__PURE__ */ new Map();
  return {
    count(lane, attempt, streamPath) {
      let tail = tails.get(lane);
      if (tail === void 0 || tail.attempt !== attempt || tail.path !== streamPath) {
        tail = fresh(attempt, streamPath);
        tails.set(lane, tail);
      }
      let chunk;
      do {
        chunk = readMore(tail, max);
        if (chunk === null) {
          tails.set(lane, fresh(attempt, streamPath));
          return { toolCalls: 0, lastTool: null };
        }
        consume(tail, chunk);
      } while (!tail.primed && chunk.length === max);
      tail.primed = true;
      return { toolCalls: tail.toolCalls, lastTool: tail.lastTool };
    },
    retain(lanes) {
      for (const lane of tails.keys()) if (!lanes.has(lane)) tails.delete(lane);
    }
  };
}

// src/commands/ui.ts
function intOption(flag, value, fallback, min, max) {
  if (value === void 0) return fallback;
  const n = /^[0-9]{1,6}$/.test(value) ? Number(value) : Number.NaN;
  if (!(n >= min && n <= max)) throw new ArbabError("usage", `${flag} must be an integer from ${min} to ${max}, not ${JSON.stringify(value)}`);
  return n;
}
function portOption(value) {
  if (value === void 0) return 0;
  const n = /^[0-9]{1,6}$/.test(value) ? Number(value) : Number.NaN;
  if (!(n === 0 || n >= 1024 && n <= 65535)) throw new ArbabError("usage", `--port must be 0 or an integer from 1024 to 65535, not ${JSON.stringify(value)}`);
  return n;
}
async function runUi(argv2, ctx) {
  const { values } = parse("ui", {
    args: argv2,
    options: {
      port: { type: "string" },
      hours: { type: "string" },
      "no-open": { type: "boolean" },
      json: { type: "boolean" }
    },
    allowPositionals: false
  });
  const port = portOption(values.port);
  const hours = intOption("--hours", values.hours, 24, 1, 720);
  const project = openProject(ctx);
  const builder = createSnapshotBuilder({
    root: project.root,
    runsRoot: project.runsRoot,
    config: project.config,
    home: ctx.home,
    version: ctx.version,
    alive: ctx.alive,
    windowHours: hours,
    counter: createToolCallCounter()
  });
  const server = await startUiServer({
    port,
    token: randomBytes4(16).toString("hex"),
    assets: uiAssets(),
    snapshot: () => builder.build(ctx.clock.now())
  });
  let stop = () => void 0;
  const stopped = new Promise((done) => {
    stop = done;
  });
  const untrap = ctx.trapSignals(() => stop());
  try {
    if (values.json === true) {
      printJson(ctx, { url: server.url, port: server.port });
      if (values["no-open"] !== true && !await ctx.openUrl(server.url)) ctx.stderr("open the URL above in a browser\n");
    } else {
      const opened = values["no-open"] !== true && await ctx.openUrl(server.url);
      const where = opened ? `http://127.0.0.1:${server.port}/ (opened in your browser)` : server.url;
      ctx.stdout(`arbab ui: ${basename2(project.root)} at ${where}
read-only; Ctrl-C stops it
`);
      if (!opened && values["no-open"] !== true) ctx.stderr("open the URL above in a browser\n");
    }
    await stopped;
  } finally {
    untrap();
    await server.close();
  }
  return 0;
}

// src/commands/verify.ts
import { join as join28 } from "node:path";

// src/verify/index.ts
var VERIFY_TIMEOUT_MS = 9e5;
var NEEDS_QUOTES = /[^A-Za-z0-9_./:@%+=,-]|^$/;
function commandLine(argv2) {
  return argv2.map((arg) => NEEDS_QUOTES.test(arg) ? `'${arg.replace(/'/g, "'\\''")}'` : arg).join(" ");
}
function expectedCommands(gates, smoke) {
  const out = gates.map((argv2) => ({ kind: "gate", argv: argv2, command: commandLine(argv2) }));
  if (smoke !== null) out.push({ kind: "smoke", argv: smoke, command: commandLine(smoke) });
  return out;
}
function verifyBrief(gates, smoke) {
  const commands2 = expectedCommands(gates, smoke);
  return [
    "# Verify",
    "",
    "## Task",
    "",
    `Run each command below exactly once, in order, as its own Bash call in the foreground, with the Bash timeout parameter set to ${VERIFY_TIMEOUT_MS}. Do not edit any file and do not try to fix a failing command.`,
    "",
    // "Run" makes each one a command span, so lint checks it against the lane's allow rules before launch.
    ...commands2.map((c, i) => `${i + 1}. Run \`${c.command}\``),
    "",
    "## Scope",
    "",
    "Nothing is written: this lane only runs the commands above.",
    "",
    "## Acceptance",
    "",
    "- Every command above ran exactly once.",
    ""
  ].join("\n");
}
function verifyLaneSpec(input) {
  assertValidName(input.name, "integration name");
  const name2 = assertValidName(`${input.name}-verify`, "verify lane");
  return {
    name: name2,
    role: "probe",
    // Without Write the lane cannot change the tree it verifies; a test's output could otherwise steer it into an edit.
    tools: ["Read", "Bash"],
    brief: input.brief,
    base: input.base,
    ...input.mergeBranches === void 0 ? {} : { mergeBranches: [...input.mergeBranches] },
    // Exact rules, no wildcard: the lane may run these commands and nothing else of its own choosing.
    allow: expectedCommands(input.gates, input.smoke).map((c) => `Bash(${c.command})`),
    checkpoint: false,
    autoResume: true,
    maxAttempts: 2,
    wallMin: 60,
    idleMin: 20
  };
}
var EXIT_CODE = /^Exit code (\d+)/;
function exitCodeOf(result) {
  if (result === void 0) return null;
  if (result.is_error !== true) return 0;
  const match = EXIT_CODE.exec(toolResultText(result.content));
  return match?.[1] !== void 0 ? Number(match[1]) : null;
}
function gateResults(events, gates, smoke) {
  const firstCall = /* @__PURE__ */ new Map();
  const results = /* @__PURE__ */ new Map();
  for (const event of Array.isArray(events) ? events : []) {
    for (const block of contentBlocks(event)) {
      if (block.type === "tool_use" && block.name === "Bash" && isRecord4(block.input)) {
        const id = stringOrNull(block.id);
        const command = stringOrNull(block.input.command)?.trim() ?? null;
        if (id !== null && command !== null && !firstCall.has(command)) firstCall.set(command, id);
      } else if (block.type === "tool_result") {
        const id = stringOrNull(block.tool_use_id);
        if (id !== null) results.set(id, block);
      }
    }
  }
  return expectedCommands(gates, smoke).map(({ kind, argv: argv2, command }) => {
    const id = firstCall.get(command);
    return { kind, argv: argv2, command, exitCode: exitCodeOf(id !== void 0 ? results.get(id) : void 0) };
  });
}
function verifyRecord(input) {
  const reasons = input.reasons ?? [];
  return {
    name: input.name,
    lane: input.lane,
    attempt: input.attempt,
    headSha: input.headSha,
    results: input.results,
    passed: reasons.length === 0 && input.results.length > 0 && input.results.every((r) => r.exitCode === 0),
    ...reasons.length > 0 && { reason: reasons.join("; ") },
    finishedAt: input.now
  };
}

// src/commands/verify.ts
var DEFAULT_TIMEOUT_MIN3 = 90;
function formatGateResult(result) {
  const code4 = result.exitCode === null ? "missing" : `exit ${result.exitCode}`;
  return `${code4.padEnd(8)}  ${result.kind.padEnd(5)}  ${result.command}`;
}
async function runVerify(argv2, ctx) {
  const { values, positionals } = parse("verify", {
    args: argv2,
    options: { "timeout-min": { type: "string" }, json: { type: "boolean" } },
    allowPositionals: true
  });
  const name2 = assertValidName(onePositional("verify", positionals, "name"), "integration");
  const timeoutMs = parseTimeoutMin(values["timeout-min"] ?? String(DEFAULT_TIMEOUT_MIN3));
  const project = openProject(ctx);
  const { gates } = project.config;
  const smoke = project.config.verify.smoke;
  if (gates.length === 0) throw new ArbabError("usage", "no gates are configured (arbab.config.json gates); verify has nothing to run");
  const integration = openIntegration(project, name2);
  const owner = generationOwner(integration);
  const start = generatedBase(integration.record);
  assertRecordedHead(ctx.git, project, integration);
  const head = integration.record.headSha;
  const lane = `${name2}-verify`;
  const spec = verifyLaneSpec({ name: name2, brief: reviewLaneFiles(integration.paths, lane).brief, gates, smoke, ...start });
  const file = writeGeneratedLane(project, integration.paths, { spec, brief: verifyBrief(gates, smoke) });
  lintGeneratedLanes(ctx, project, [file]);
  const run = await runGeneratedLanes(ctx, project, [{ lane: spec.name, file }], timeoutMs, owner);
  const outcome2 = run.outcomes[0];
  if (run.timedOut || outcome2 === void 0) {
    if (values.json === true) printJson(ctx, { timedOut: true, endState: null, verify: null });
    else ctx.stderr(`arbab verify: ${spec.name} did not finish in time; it keeps running
`);
    return WAIT_TIMEOUT_EXIT;
  }
  const reasons = [];
  if (outcome2.attempts.length > 0) {
    const ran = branchHead(ctx.git, project.root, `arbab/${spec.name}`);
    if (ran !== head) reasons.push(`${spec.name} ran on ${ran ?? "no commit"}, not on the integration head ${head}; run arbab verify ${name2} again`);
    const left = worktreeChanges(ctx, project, spec.name);
    if (left !== null) reasons.push(left);
  }
  const results = gateResults(attemptEvents(project.runsRoot, spec.name, outcome2.attempts), gates, smoke);
  const record2 = verifyRecord({
    name: name2,
    lane: spec.name,
    attempt: outcome2.attempts.at(-1) ?? null,
    headSha: head,
    results,
    now: isoAt(ctx.clock),
    reasons
  });
  writeJsonAtomic(integration.paths.verify, record2);
  if (values.json === true) {
    printJson(ctx, { timedOut: false, endState: outcome2.endState, verify: record2 });
  } else {
    for (const result of results) ctx.stdout(formatGateResult(result) + "\n");
    const ended = outcome2.endState ?? "without an end state";
    const reason = outcome2.reason === null ? "" : `; ${outcome2.reason.trim().replace(/\s+/g, " ")}`;
    const why = record2.reason === void 0 ? "" : `: ${record2.reason}`;
    ctx.stdout(`verify ${name2}: ${record2.passed ? "passed" : "failed"} at ${head} (lane ${spec.name} ${ended}${reason})${why}
`);
  }
  return record2.passed ? 0 : 1;
}
var MAX_LISTED = 5;
function worktreeChanges(ctx, project, lane) {
  const worktree = join28(project.worktreeRoot, lane);
  const gitCommonDir2 = resolveGitCommonDir(ctx.git, project.root);
  if (gitCommonDir2 === void 0) return `the git directory of ${project.root} could not be resolved, so ${worktree} was not checked`;
  const verified = verifyWorktreeGit({ worktree, branch: `arbab/${lane}`, gitCommonDir: gitCommonDir2 });
  if (verified.gitDir === null) return `the worktree ${worktree} failed verification: ${verified.error}`;
  let entries2;
  try {
    entries2 = worktreeStatus(worktree, verified.gitDir, ctx.git).map((l) => l.trim());
  } catch (err) {
    return `the worktree ${worktree} could not be checked: ${err instanceof Error ? err.message : String(err)}`;
  }
  if (entries2.length === 0) return null;
  const listed = entries2.slice(0, MAX_LISTED).join(", ") + (entries2.length > MAX_LISTED ? `, and ${entries2.length - MAX_LISTED} more` : "");
  return `the worktree ${worktree} has changes after the run${listed === "" ? "" : `: ${listed}`}`;
}

// src/commands/context.ts
import { execFileSync as execFileSync3, spawn as spawn3 } from "node:child_process";
import { closeSync as closeSync5, openSync as openSync5 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join29 } from "node:path";
var OPENER_WAIT_MS = 5e3;
function makeOpenUrl(platform, spawnFn = spawn3) {
  const opener = platform === "darwin" ? "open" : platform === "linux" ? "xdg-open" : null;
  return (url) => {
    if (opener === null) return Promise.resolve(false);
    return new Promise((resolve13) => {
      const timer = setTimeout(() => resolve13(true), OPENER_WAIT_MS);
      timer.unref();
      const settle = (opened) => {
        clearTimeout(timer);
        resolve13(opened);
      };
      let child2;
      try {
        child2 = spawnFn(opener, [url], { detached: true, stdio: "ignore" });
      } catch {
        settle(false);
        return;
      }
      child2.on("error", () => settle(false));
      child2.on("exit", (code4) => settle(code4 === 0));
      child2.unref();
    });
  };
}
function shepherdArgv(scriptPath2, root, lane, mode) {
  return [scriptPath2, "__shepherd", root, lane, JSON.stringify(mode)];
}
function makeSpawnShepherd(execPath, scriptPath2, env2) {
  return (root, lane, mode) => {
    const laneDir = runPaths(confine(root, loadConfig(root).runsRoot), lane).laneDir;
    ensureDir(laneDir);
    const log = openSync5(join29(laneDir, "shepherd.log"), "a");
    try {
      const child2 = spawn3(execPath, shepherdArgv(scriptPath2, root, lane, mode), {
        cwd: root,
        env: env2,
        detached: true,
        stdio: ["ignore", log, log]
      });
      child2.once("error", () => void 0);
      if (child2.pid === void 0) throw new ArbabError("runtime", `cannot start the shepherd for ${lane}`);
      child2.unref();
      return child2.pid;
    } finally {
      closeSync5(log);
    }
  };
}
function processCommand(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    const out = execFileSync3("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.trim() === "" ? null : out.trim();
  } catch {
    return null;
  }
}
function trapSignals(handler) {
  process.on("SIGTERM", handler);
  process.on("SIGINT", handler);
  return () => {
    process.off("SIGTERM", handler);
    process.off("SIGINT", handler);
  };
}
function defaultContext(opts) {
  const home = homedir2();
  return {
    cwd: process.cwd(),
    pid: process.pid,
    stdout: (text2) => process.stdout.write(text2),
    stderr: (text2) => process.stderr.write(text2),
    hostEnv: { ...process.env },
    home: join29(home, ".arbab"),
    claudeHome: join29(home, ".claude"),
    clock: systemClock,
    sleep,
    alive: isAlive,
    signal: sendSignal,
    spawnShepherd: makeSpawnShepherd(process.execPath, opts.scriptPath, process.env),
    shepherdDeps: defaultDeps,
    runShepherd,
    trapSignals,
    git: nodeGit,
    runCommand: runArgv,
    processCommand,
    platform: process.platform,
    nodeVersion: process.versions.node,
    version: opts.version,
    interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
    openUrl: makeOpenUrl(process.platform)
  };
}

// src/commands/index.ts
var COMMANDS = {
  doctor: runDoctor,
  lint: runLint,
  launch: runLaunch,
  plan: runPlan,
  status: runStatus,
  wait: runWait,
  resume: runResume,
  stop: runStop,
  preflight: runPreflight,
  quota: runQuota,
  cleanup: runCleanup,
  integrate: runIntegrate,
  verify: runVerify,
  review: runReview,
  readiness: runReadiness,
  land: runLand,
  ui: runUi,
  __shepherd: runShepherdProcess
};
var HELP = `usage: arbab <command> [options]

  doctor [--json]                         node, git, claude binary, sandbox, config, ignored roots, ~/.arbab
  lint <lane.json> [--json]               profile, brief and schema lint; exit 1 on errors
  launch <lane.json> [--json]             lint, then start the lane's shepherd
  plan check <plan.json> [--json]         validate a plan, lint every phase, print the waves; exit 1 on errors
  plan next <plan.json> [--json]          launch every phase whose dependencies all succeeded and that never ran
  plan status <plan.json> [--json]        one row per phase: wave, state, end state, dependencies
  status [--json] [lane\u2026]                 one row per lane, then the quota
  wait [--any|--all] [--timeout-min N] [--json] [lane\u2026]
                                          report finished lanes not yet acked; exit 3 on timeout
  resume <lane> [--prompt <file> | --digest] [--json]
                                          a new attempt resuming the latest session; --digest starts a fresh
                                          session seeded with the latest attempt's digest
  stop <lane> [--json]                    stop the lane's shepherd and worker
  preflight <lane.json> [--timeout-min N] [--json]
                                          probe the lane's fence and model; exit 1 on any failed check
  quota [--reset] [--json]                the account snapshot and the hold decision; --reset deletes the snapshot
                                          (after switching accounts)
  cleanup [--worktrees] [--json]          reap orphans, release stale pool entries; --worktrees removes finished lanes'
                                          merged clean worktrees (lane branches stay), and landed integrations'
                                          worktrees and branches
  integrate <name> (--lanes a,b,\u2026 | --plan <plan.json>) [--json]
                                          merge lane branches into integrate/<name>, in order or by plan waves
  integrate <name> --deps-installed <sha> [--json]
                                          record that you reviewed and installed changed dependencies at the head
                                          <sha> that integrate printed
  verify <name> [--timeout-min N] [--json]
                                          run the gates and smoke inside the fence on the integration head;
                                          exit 1 unless all exit 0, 3 on timeout
  review <name> [--lenses a,b] [--timeout-min N] [--json]
                                          one reviewer lane per lens, then skeptics for MEDIUM+ findings
  readiness <name> [--tier low|medium|high] [--waive id,\u2026] [--json]
                                          the readiness report (verified, skipped, risks); exit 1 unless ready
  land <name> [--keep-worktrees] [--json]
                                          merge a ready integration into the base branch; never pushes; then
                                          remove the worktrees it landed (lane branches stay) unless --keep-worktrees
  ui [--port N] [--hours N] [--no-open] [--json]
                                          serve the pyramid scene on 127.0.0.1 until stopped (read-only)
  help, --help                            this text
  version, --version                      the arbab version

Exit codes: 0 ok, 1 usage or lint error, 2 runtime error, 3 wait timeout.
`;
async function dispatch(argv2, ctx) {
  const [name2, ...rest] = argv2;
  if (name2 === void 0 || name2 === "--help" || name2 === "help" || name2 === "-h") {
    ctx.stdout(HELP);
    return 0;
  }
  if (name2 === "--version" || name2 === "version") {
    ctx.stdout(`${ctx.version}
`);
    return 0;
  }
  const command = Object.hasOwn(COMMANDS, name2) ? COMMANDS[name2] : void 0;
  if (command === void 0) {
    ctx.stderr(`arbab: unknown command ${JSON.stringify(name2)}
${HELP}`);
    return 1;
  }
  if (rest.includes("--help") && name2 !== "__shepherd") {
    ctx.stdout(HELP);
    return 0;
  }
  try {
    return await command(rest, ctx);
  } catch (err) {
    const text2 = err instanceof ArbabError ? err.message : err instanceof Error ? err.stack ?? err.message : String(err);
    ctx.stderr(`arbab ${name2}: ${text2}
`);
    return exitCodeFor(err);
  }
}

// src/cli.ts
function readVersion2() {
  if (true) return "0.1.0";
  try {
    const pkg = JSON.parse(readFileSync2(new URL("../package.json", import.meta.url), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
var scriptPath = process.argv[1] ?? "";
var code3 = await dispatch(process.argv.slice(2), defaultContext({ scriptPath, version: readVersion2() }));
if (process.argv[2] === "__shepherd") process.exit(code3);
process.exitCode = code3;
