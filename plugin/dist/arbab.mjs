#!/usr/bin/env node

// src/cli.ts
import { readFileSync as readFileSync9 } from "node:fs";

// src/commands/index.ts
import { statSync as statSync8 } from "node:fs";
import { resolve as resolve17 } from "node:path";

// src/util/errors.ts
var ArbabError = class extends Error {
  code;
  constructor(code4, message5, options) {
    super(message5, options);
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
import { existsSync as existsSync14, readdirSync as readdirSync10, rmdirSync as rmdirSync2, rmSync as rmSync7, statSync as statSync5 } from "node:fs";
import { join as join31 } from "node:path";

// src/config/lane.ts
import { resolve as resolve2 } from "node:path";

// src/config/check.ts
import { realpathSync, statSync } from "node:fs";
import { isAbsolute as isAbsolute2, relative as relative2, sep } from "node:path";

// src/types.ts
var ROLES = ["implementer", "verifier", "reviewer", "researcher", "probe"];
var EFFORTS = ["low", "medium", "high", "xhigh", "max"];
var MACHINE_CONFIG_FILE = "machine.json";
var INTEGRATIONS_DIR = ".arbab/integrations";
var TIERS = ["low", "medium", "high"];
var NO_FREE_SLOT_REASON = "no free slot";
var REVIEW_HISTORY_DIR = "reviews";
var HOST_CHECKS_FILE = "host-checks.json";

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
function fail(field, message5) {
  throw new ArbabError("config", `${field}: ${message5}`);
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
  let real2;
  try {
    if (!statSync(full).isFile()) fail(field, `${s} is not a file`);
    real2 = realpathSync(full);
  } catch (err) {
    if (err instanceof ArbabError) throw err;
    return fail(field, `${s} does not exist`);
  }
  const rel = relative2(realpathSync(projectRoot), real2);
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
  "mergeBranches",
  "inputs"
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
  "maxAttempts",
  "inputs"
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
  if (obj.inputs !== void 0) out.inputs = inputList(obj.inputs, f("inputs"));
  return out;
}
var MAX_INPUTS = 20;
function inputList(v, field) {
  if (!Array.isArray(v)) fail(field, "must be an array of paths");
  if (v.length > MAX_INPUTS) fail(field, `must list at most ${MAX_INPUTS} paths`);
  return v.map((item, i) => {
    if (typeof item !== "string" || item === "") fail(`${field}[${i}]`, "must be a non-empty string");
    if (/[\0\n\r]/.test(item)) fail(`${field}[${i}]`, "must not contain NUL or a newline");
    return item;
  });
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

// src/integrate/integrate.ts
import { existsSync as existsSync2, readdirSync as readdirSync3, realpathSync as realpathSync3, renameSync as renameSync3 } from "node:fs";
import { dirname as dirname3, join as join8, resolve as resolve7 } from "node:path";

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
function ensureIgnored(projectRoot, entries3, git) {
  const excludeRel = must(git, ["rev-parse", "--git-path", "info/exclude"], projectRoot).trim();
  if (excludeRel === "") throw new ArbabError("git", "git rev-parse --git-path info/exclude printed nothing");
  const exclude = resolve3(projectRoot, excludeRel);
  const text2 = readText(exclude) ?? "";
  const present = new Set(text2.split(/\r?\n/).map((line2) => line2.trim()));
  const missing = entries3.filter((entry) => !present.has(entry));
  if (missing.length > 0) {
    const prefix = text2 === "" || text2.endsWith("\n") ? "" : "\n";
    ensureDir(dirname2(exclude));
    writeFileSync2(exclude, text2 + prefix + missing.join("\n") + "\n");
  }
  for (const entry of entries3) {
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
  for (const block3 of must(git, ["worktree", "list", "--porcelain"], projectRoot).split("\n\n")) {
    const lines = block3.split("\n");
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
  const lines = must(git, args, worktree, untrustedTree()).split("\n").filter((line2) => line2.trim() !== "");
  const nested = indexGitlinks(worktree, gitDir, git).filter((path) => holdsGit(join2(worktree, path))).map((path) => `?? ${path}/`);
  return [...lines, ...nested.filter((line2) => !lines.includes(line2))];
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
var INSTALL_FIELDS = [
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
  "trustedDependencies"
];
var INSTALL_SCRIPTS = ["preinstall", "install", "postinstall", "preprepare", "prepare", "postprepare", "prepublish"];
var isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function canonical2(v) {
  if (Array.isArray(v)) return `[${v.map(canonical2).join(",")}]`;
  if (isPlainObject(v)) {
    const keys = Object.keys(v).filter((k) => v[k] !== void 0).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical2(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "undefined";
}
var own = (o, key) => Object.hasOwn(o, key) ? o[key] : void 0;
function installView(text2) {
  let pkg;
  try {
    pkg = JSON.parse(text2);
  } catch {
    return null;
  }
  if (!isPlainObject(pkg)) return null;
  const scripts = own(pkg, "scripts");
  const lifecycle = scripts === void 0 ? {} : isPlainObject(scripts) ? Object.fromEntries(INSTALL_SCRIPTS.map((s) => [s, own(scripts, s)])) : scripts;
  return canonical2({ fields: Object.fromEntries(INSTALL_FIELDS.map((f) => [f, own(pkg, f)])), lifecycle });
}
function installRelevantChange(path, before, after) {
  if (before === after) return false;
  const base = (path.split("/").at(-1) ?? "").toLowerCase();
  if (base !== "package.json") return isDependencyManifest(path);
  if (before === null || after === null) return true;
  const a = installView(before);
  const b = installView(after);
  return a === null || b === null || a !== b;
}
function fileAt(git, rev, path) {
  const r = git(["show", "--no-textconv", `${rev}:${path}`]);
  return r.code === 0 ? r.stdout : null;
}
function installRelevantPaths(git, from, to, paths) {
  const out = /* @__PURE__ */ new Set();
  for (const path of paths) {
    if (!isDependencyManifest(path)) continue;
    if ((path.split("/").at(-1) ?? "").toLowerCase() !== "package.json") {
      out.add(path);
      continue;
    }
    const before = fileAt(git, from, path);
    const after = fileAt(git, to, path);
    if (before === null && after === null || installRelevantChange(path, before, after)) out.add(path);
  }
  return [...out].sort();
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
import { linkSync, readdirSync, renameSync as renameSync2, rmdirSync, rmSync as rmSync2 } from "node:fs";
import { join as join3, resolve as resolve4 } from "node:path";
function isHolder(value) {
  if (typeof value !== "object" || value === null) return false;
  const v = value;
  return Number.isInteger(v.pid) && v.pid > 0 && typeof v.lane === "string" && typeof v.project === "string" && typeof v.createdAt === "string";
}
function assertHolder(holder2) {
  if (!isHolder(holder2)) throw new ArbabError("usage", "pool holder needs a positive pid, lane, project and createdAt");
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
  const holder2 = parseHolder(text2);
  if (holder2 === null ? !unparsedIsStale : alive(holder2.pid)) return false;
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
function acquireFromPool(dir, values, holder2, alive) {
  assertHolder(holder2);
  const data = JSON.stringify(holder2);
  for (const value of values) {
    const path = entryPath(dir, value);
    if (createExclusive(path, data)) return value;
    if (!releaseIfStale(path, alive) || !createExclusive(path, data)) continue;
    if (readText(path) === data) return value;
  }
  return null;
}
function releaseToPool(dir, value, holder2) {
  const path = entryPath(dir, value);
  const text2 = readText(path);
  if (text2 === null) return false;
  const current = parseHolder(text2);
  if (current === null || current.pid !== holder2.pid || current.lane !== holder2.lane) return false;
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
function acquireSlot(home, maxParallel, holder2, alive) {
  assertCount(maxParallel, "maxParallel");
  return acquireFromPool(join3(resolve4(home), "slots"), range(maxParallel), holder2, alive);
}
function releaseSlot(home, slot, holder2) {
  return releaseToPool(join3(resolve4(home), "slots"), slot, holder2);
}
function acquireSemaphore(home, name2, capacity, holder2, alive) {
  assertValidName(name2, "semaphore");
  assertCount(capacity, `semaphore ${name2} capacity`);
  return acquireFromPool(join3(resolve4(home), "semaphores", name2), range(capacity), holder2, alive);
}
function releaseSemaphore(home, name2, slot, holder2) {
  assertValidName(name2, "semaphore");
  return releaseToPool(join3(resolve4(home), "semaphores", name2), slot, holder2);
}
function writerLockKey(worktreeRealpath) {
  return createHash("sha1").update(worktreeRealpath).digest("hex");
}
function lockDir(home, key) {
  if (!/^[0-9a-f]{40}$/.test(key)) throw new ArbabError("usage", `writer lock key ${JSON.stringify(key)} is not a sha1`);
  return join3(resolve4(home), "locks", key);
}
var LOCK_DIR_RETRIES = 5;
function vanished(err) {
  return err instanceof ArbabError && err.cause?.code === "ENOENT";
}
function acquireWriterLock(home, key, holder2, alive) {
  const dir = lockDir(home, key);
  for (let tries = 1; ; tries++) {
    try {
      return acquireFromPool(dir, [0], holder2, alive) === 0;
    } catch (err) {
      if (!vanished(err) || tries >= LOCK_DIR_RETRIES) throw err;
    }
  }
}
function releaseWriterLock(home, key, holder2) {
  const dir = lockDir(home, key);
  const released = releaseToPool(dir, 0, holder2);
  if (released) {
    try {
      rmdirSync(dir);
    } catch {
    }
  }
  return released;
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
function releaseLeases(home, leases, holder2) {
  for (const lease of leases) releaseToPool(leaseDir(home, lease.type), lease.value, holder2);
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
  for (const line2 of output4.split("\n")) {
    const parts = line2.trim().split(/\s+/);
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
function descendantsOf(root, table3, known) {
  const children = /* @__PURE__ */ new Map();
  for (const row of table3) {
    const list3 = children.get(row.ppid);
    if (list3) list3.push(row.pid);
    else children.set(row.ppid, [row.pid]);
  }
  const found = /* @__PURE__ */ new Set();
  const queue = [root, ...known, ...table3.filter((r) => r.pgid === root).map((r) => r.pid)];
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
function trackDescendants(root, table3, tracked, rootRunning) {
  const present = new Set(table3.map((row) => row.pid));
  const rows = rootRunning ? table3 : table3.filter((row) => row.ppid !== root);
  return new Set([...descendantsOf(root, rows, tracked)].filter((pid) => present.has(pid)));
}
function signalTargets(root, table3, tracked, rootRunning) {
  const present = new Set(table3.map((row) => row.pid));
  const parents = new Set([...tracked].filter((pid) => present.has(pid)));
  if (rootRunning) parents.add(root);
  const out = /* @__PURE__ */ new Set();
  for (const row of table3) {
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
  const consume2 = (line2) => {
    let event;
    try {
      event = JSON.parse(line2.toString("utf8"));
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
    const size2 = readSize(input.streamPath);
    if (size2 < offset) {
      offset = 0;
      carry = Buffer.alloc(0);
    }
    if (size2 <= offset) return;
    const chunk = readRange(input.streamPath, offset, size2);
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
  let entries3;
  try {
    entries3 = readdirSync2(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries3) if (e.isDirectory()) nestedUnder(worktree, `${rel}/${e.name}`, out);
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
  const message5 = `arbab(${lane}): checkpoint attempt ${input.attempt} (${input.endState})

Co-Authored-By: Claude <noreply@anthropic.com>`;
  const commit = git(["commit", "--no-verify", "-m", message5]);
  if (commit.code !== 0) return failed("git commit", commit);
  const head = git(["rev-parse", "HEAD"]);
  if (head.code !== 0) return failed("git rev-parse HEAD", head);
  return { sha: head.stdout.trim(), error: leftOut };
}

// src/run/workertmp.ts
import { closeSync as closeSync4, constants, lstatSync as lstatSync2, mkdirSync as mkdirSync2, openSync as openSync4, rmSync as rmSync3, unlinkSync } from "node:fs";
import { join as join6 } from "node:path";
var WORKER_TMP_DIR = ".arbab-tmp";
function workerTmpPaths(worktree) {
  const root = join6(worktree, WORKER_TMP_DIR);
  return {
    root,
    xdgConfig: join6(root, "xdg-config"),
    yarnCache: join6(root, "yarn-cache"),
    npmrc: join6(root, "npmrc"),
    inputs: join6(root, "inputs")
  };
}
function lstatOrNull(path) {
  try {
    return lstatSync2(path);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw new ArbabError("io", `cannot read ${path}: ${err.message}`, { cause: err });
  }
}
function removeEntry(path, stat) {
  try {
    if (stat.isDirectory()) rmSync3(path, { recursive: true, force: true });
    else unlinkSync(path);
  } catch (err) {
    throw new ArbabError("io", `cannot remove ${path}: ${err.message}`, { cause: err });
  }
}
function realDir(worktree, rel) {
  let at = worktree;
  for (const part of rel.split(/[\\/]+/)) {
    if (part === "" || part === ".") continue;
    if (part === "..") throw new ArbabError("usage", `${rel} leaves the worktree`);
    at = join6(at, part);
    const stat = lstatOrNull(at);
    if (stat?.isDirectory() === true) continue;
    if (stat !== null) removeEntry(at, stat);
    try {
      mkdirSync2(at);
    } catch (err) {
      throw new ArbabError("io", `cannot create ${at}: ${err.message}`, { cause: err });
    }
  }
  return at;
}
function ensureWorkerTmp(worktree) {
  const paths = workerTmpPaths(worktree);
  for (const dir of ["xdg-config", "yarn-cache", "inputs"]) realDir(worktree, join6(WORKER_TMP_DIR, dir));
  const stat = lstatOrNull(paths.npmrc);
  if (stat?.isFile() === true) return paths;
  if (stat !== null) removeEntry(paths.npmrc, stat);
  let fd;
  try {
    fd = openSync4(paths.npmrc, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 384);
  } catch (err) {
    throw new ArbabError("io", `cannot create ${paths.npmrc}: ${err.message}`, { cause: err });
  }
  closeSync4(fd);
  return paths;
}

// src/run/project-files.ts
import { join as join7, relative as relative4, resolve as resolve6, sep as sep3 } from "node:path";
var ARBAB_DIR = ".arbab";
var ESLINT_MARKER = ".eslintrc.json";
function arbabIgnoreEntries(projectRoot, config) {
  const rel = (p) => `${relative4(resolve6(projectRoot), confine(projectRoot, p)).split(sep3).join("/")}/`;
  const own2 = `${ARBAB_DIR}/`;
  const outside = [rel(config.worktreeRoot), rel(config.runsRoot)].filter((r) => !r.startsWith(own2));
  return [.../* @__PURE__ */ new Set([own2, `${WORKER_TMP_DIR}/`, ...outside])];
}
function ensureArbabMarkers(projectRoot) {
  createExclusive(join7(projectRoot, ARBAB_DIR, ESLINT_MARKER), `${JSON.stringify({ root: true }, null, 2)}
`);
}

// src/shepherd/trust.ts
var SHA = /^[0-9a-f]{40,64}$/;
var output = (r) => (r.stderr || r.stdout).trim();
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
  return r.code === 0 && SHA.test(sha) ? sha : null;
}
function isTrustedInstallPoint(sha, input) {
  if (input.confirmed.has(sha)) return true;
  assertRevision2(input.baseBranch, "baseBranch");
  const r = input.git(["merge-base", "--is-ancestor", sha, input.baseBranch], input.projectRoot);
  if (r.code === 0) return true;
  if (r.code === 1) return false;
  throw new ArbabError("git", `git merge-base --is-ancestor ${sha} ${input.baseBranch} failed (${r.code}): ${output(r)}`);
}
function distance(ancestor, sha, input) {
  const r = input.git(["rev-list", "--count", `${ancestor}..${sha}`], input.projectRoot);
  const n = Number(r.stdout.trim());
  if (r.code !== 0 || !Number.isInteger(n)) {
    throw new ArbabError("git", `git rev-list --count ${ancestor}..${sha} failed (${r.code}): ${output(r)}`);
  }
  return n;
}
function installPlan(base, input) {
  assertRevision2(base, "base");
  assertRevision2(input.baseBranch, "baseBranch");
  const sha = resolveCommit(input.projectRoot, base, input.git);
  if (sha === null) return { start: base, merge: null };
  if (isTrustedInstallPoint(sha, input)) return { start: sha, merge: null };
  const candidates = [...input.confirmed].filter((c) => SHA.test(c) && input.git(["merge-base", "--is-ancestor", c, sha], input.projectRoot).code === 0).sort();
  const r = input.git(["merge-base", sha, input.baseBranch], input.projectRoot);
  const fork = r.stdout.trim();
  if (r.code === 0 && SHA.test(fork)) {
    candidates.push(fork);
  } else if (r.code !== 1) {
    throw new ArbabError("git", `git merge-base ${sha} ${input.baseBranch} failed (${r.code}): ${output(r)}`);
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

// src/integrate/integrate.ts
function listIntegrations(projectRoot) {
  try {
    return readdirSync3(join8(resolve7(projectRoot), INTEGRATIONS_DIR), { withFileTypes: true }).filter((e) => e.isDirectory() && isValidName(e.name)).map((e) => e.name).sort();
  } catch {
    return [];
  }
}
function integrationPaths(projectRoot, config, name2) {
  const valid = assertValidName(name2, "integration");
  if (valid === "integrate" || valid.startsWith("integrate-")) {
    throw new ArbabError("usage", `integration name ${valid} may not be integrate or start with integrate-`);
  }
  const root = resolve7(projectRoot);
  const dir = join8(root, INTEGRATIONS_DIR, valid);
  return {
    name: valid,
    projectRoot: root,
    dir,
    integration: join8(dir, "integration.json"),
    verify: join8(dir, "verify.json"),
    review: join8(dir, "review.json"),
    readiness: join8(dir, "readiness.json"),
    readinessMd: join8(dir, "readiness.md"),
    landing: join8(dir, "landing.json"),
    lanesDir: join8(dir, "lanes"),
    worktree: join8(confine(root, config.worktreeRoot), `${INTEGRATION_WORKTREE_PREFIX}${valid}`),
    branch: `integrate/${valid}`
  };
}
var SHA2 = /^[0-9a-f]{40,64}$/;
var output2 = (r) => (r.stderr || r.stdout).trim();
function must2(git, args, cwd) {
  const r = git(args, cwd);
  if (r.code !== 0) throw new ArbabError("git", `git ${args.join(" ")} failed (${r.code}): ${output2(r)}`);
  return r.stdout;
}
function canonical3(path) {
  try {
    return realpathSync3(path);
  } catch {
    return resolve7(path);
  }
}
function commitOf(git, rev, cwd) {
  const r = git(["rev-parse", "--verify", "--quiet", `${rev}^{commit}`], cwd);
  const sha = r.stdout.trim();
  return r.code === 0 && SHA2.test(sha) ? sha : null;
}
function isAncestor(git, ancestor, of, cwd) {
  const r = git(["merge-base", "--is-ancestor", ancestor, of], cwd);
  if (r.code === 0) return true;
  if (r.code === 1) return false;
  throw new ArbabError("git", `git merge-base --is-ancestor ${ancestor} ${of} failed (${r.code}): ${output2(r)}`);
}
function worktreeBranches(projectRoot, git) {
  const out = /* @__PURE__ */ new Map();
  for (const block3 of must2(git, ["worktree", "list", "--porcelain"], projectRoot).split("\n\n")) {
    const lines = block3.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice("worktree ".length);
    if (path === void 0) continue;
    const ref2 = lines.find((l) => l.startsWith("branch "))?.slice("branch ".length) ?? null;
    out.set(canonical3(path), ref2);
  }
  return out;
}
function gitCommonDir(projectRoot, git) {
  const out = must2(git, ["rev-parse", "--git-common-dir"], projectRoot).trim();
  if (out === "") throw new ArbabError("git", "git rev-parse --git-common-dir printed nothing");
  return canonical3(resolve7(projectRoot, out));
}
function refuseLaneWorktree(paths, git) {
  const ref2 = worktreeBranches(paths.projectRoot, git).get(canonical3(paths.worktree));
  const lanePrefix = "refs/heads/arbab/";
  if (typeof ref2 !== "string" || !ref2.startsWith(lanePrefix)) return;
  throw new ArbabError(
    "usage",
    `${paths.worktree} is the worktree of lane ${ref2.slice(lanePrefix.length)}, where a worker runs, so integration ${paths.name} cannot use it. Lane names starting with ${INTEGRATION_WORKTREE_PREFIX} are reserved: rename that lane and remove its worktree, or choose another integration name`
  );
}
function ownedGitDir(paths, git) {
  const refused = (why) => new ArbabError("git", `${paths.worktree} exists but is not a worktree of this repository on ${paths.branch}: ${why}`);
  const ref2 = worktreeBranches(paths.projectRoot, git).get(canonical3(paths.worktree));
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
  let target = join8(paths.dir, `integration.superseded-${stamp}.json`);
  for (let n = 2; existsSync2(target); n++) target = join8(paths.dir, `integration.superseded-${stamp}-${n}.json`);
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
    const worktree = join8(root, lane);
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
function oneEntryPerLane(entries3) {
  const out = [];
  for (const e of entries3) {
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
  ensureIgnored(paths.projectRoot, arbabIgnoreEntries(paths.projectRoot, config), git);
  ensureArbabMarkers(paths.projectRoot);
  const wt = (args) => git([...prefix, ...args], paths.worktree);
  const head = () => {
    const sha = commitOf(wt, "HEAD", paths.worktree);
    if (sha === null) throw new ArbabError("git", `cannot read HEAD of ${paths.worktree}`);
    return sha;
  };
  const previous = readIntegration(paths);
  let headSha = head();
  const present = (sha) => SHA2.test(sha) && commitOf(wt, sha, paths.worktree) !== null;
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
  const manifestsBetween = (from, to, what) => {
    const diff = wt(["diff", "--name-only", "-z", "--no-renames", "--no-ext-diff", from, to, "--"]);
    if (diff.code !== 0) throw new ArbabError("git", `cannot list the files ${what} (${diff.code}): ${output2(diff)}`);
    return installRelevantPaths(wt, from, to, diff.stdout.split("\0").filter((p) => p !== ""));
  };
  const stillConfirmed = (at) => commitOf(wt, at, paths.worktree) !== null && isAncestor(wt, at, headSha, paths.worktree) && manifestsBetween(at, headSha, `${paths.branch} changed since ${at}`).length === 0;
  const record2 = () => {
    baseSha = mergeBase();
    const manifests = manifestsBetween(baseSha, headSha, `${paths.branch} changed since ${baseSha}`);
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
      const fork = must2(wt, ["merge-base", baseSha, sha], paths.worktree).trim();
      const manifests2 = manifestsBetween(fork, sha, `${lane} changed since ${baseSha}`);
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
      throw new ArbabError("git", `integrating ${lane} into ${paths.branch} failed (${r.code}): ${output2(r)}; the merge was aborted${kept}`);
    }
    const before = headSha;
    headSha = head();
    const manifests = manifestsBetween(before, headSha, `${lane} changed in ${paths.branch}`);
    merged = oneEntryPerLane([...merged, { lane, branch, sha, manifests }]);
    record2();
  }
  return { record: record2(), alreadyIn };
}
function assertRevision3(rev, what) {
  if (rev === "" || rev.startsWith("-") || /\s/.test(rev)) throw new ArbabError("usage", `${what} ${JSON.stringify(rev)} is not a valid revision`);
}
function adoptIntegration(input) {
  const paths = integrationPaths(input.projectRoot, input.config, input.name);
  const { git, projectRoot } = input;
  const base = input.base ?? input.config.baseBranch;
  assertRevision3(input.ref, "--adopt");
  assertRevision3(base, input.base === void 0 ? "baseBranch" : "--base");
  refuseLanded(paths);
  refuseLaneWorktree(paths, git);
  const existing = [
    existsSync2(paths.integration) ? paths.integration : null,
    commitOf(git, `refs/heads/${paths.branch}`, projectRoot) !== null ? `branch ${paths.branch}` : null,
    existsSync2(paths.worktree) ? paths.worktree : null
  ].filter((e) => e !== null);
  if (existing.length > 0) {
    throw new ArbabError("usage", `integration ${paths.name} already exists (${existing.join(", ")}); choose a new name to adopt ${input.ref}`);
  }
  const sha = commitOf(git, input.ref, projectRoot);
  if (sha === null) throw new ArbabError("usage", `--adopt ${input.ref} does not name a commit`);
  const baseSha = commitOf(git, base, projectRoot);
  if (baseSha === null) throw new ArbabError("usage", `base ${base} does not name a commit`);
  const trusted = input.config.baseBranch;
  assertRevision3(trusted, "baseBranch");
  if (!isAncestor(git, baseSha, trusted, projectRoot)) {
    throw new ArbabError(
      "usage",
      `${input.base === void 0 ? "baseBranch" : "--base"} ${base} is not contained in ${trusted}: arbab installs dependencies only on a commit of ${trusted}, and ${base} may hold worker code. Adopt against ${trusted} or a commit it contains`
    );
  }
  const fork = git(["merge-base", sha, baseSha], projectRoot);
  if (fork.code !== 0 || !SHA2.test(fork.stdout.trim())) {
    if (fork.code === 1) throw new ArbabError("usage", `${input.ref} shares no history with ${base}: there is nothing to land it into`);
    throw new ArbabError("git", `git merge-base ${sha} ${baseSha} failed (${fork.code}): ${output2(fork)}`);
  }
  const start = fork.stdout.trim();
  const trust = { projectRoot, baseBranch: trusted, confirmed: confirmedHeads(projectRoot, input.config, git), git };
  if (!isTrustedInstallPoint(start, trust)) {
    throw new ArbabError(
      "usage",
      `the fork point ${start} of ${input.ref} and ${base} is not a trusted install point (a commit of ${trusted} or an integration head a human confirmed), so arbab will not install dependencies there`
    );
  }
  must2(git, ["worktree", "prune"], projectRoot);
  ensureDir(dirname3(paths.worktree));
  must2(git, ["worktree", "add", "-b", paths.branch, paths.worktree, start], projectRoot);
  try {
    const deps = prepareDependencies(input.config.dependencies, paths.worktree, input.runCommand);
    if (!deps.ok) {
      const tail = deps.output.trim().split("\n").slice(-5).join("\n");
      throw new ArbabError("runtime", `dependencies failed in ${paths.worktree} (${deps.code}): ${tail}`);
    }
    if (sha !== start) {
      const prefix = [...explicitGit(ownedGitDir(paths, git), paths.worktree), ...untrustedTree()];
      must2(git, [...prefix, "merge", "--ff-only", "--no-verify", sha], paths.worktree);
    }
  } catch (err) {
    removeWorktree(git, paths);
    git([...untrustedTree(), "branch", "-D", paths.branch], projectRoot);
    throw err;
  }
  return integrate({ ...input, config: { ...input.config, baseBranch: base }, lanes: [] });
}
function refreshIntegration(input) {
  const paths = integrationPaths(input.projectRoot, input.config, input.name);
  refuseLanded(paths);
  if (readIntegration(paths) === null) {
    throw new ArbabError("usage", `integration ${paths.name} does not exist; run arbab integrate ${paths.name} with its lanes, or --adopt <ref>`);
  }
  if (!existsSync2(paths.worktree)) {
    throw new ArbabError("usage", `integration ${paths.name} has no worktree at ${paths.worktree}; restore it on ${paths.branch} to refresh`);
  }
  const tracked = worktreeStatus(paths.worktree, ownedGitDir(paths, input.git), input.git).filter((l) => !l.startsWith("?? ")).map((l) => l.slice(3));
  if (tracked.length > 0) {
    const shown = tracked.slice(0, 5).join(", ") + (tracked.length > 5 ? ` and ${tracked.length - 5} more` : "");
    throw new ArbabError(
      "usage",
      `integration ${paths.name} has uncommitted changes in ${paths.worktree} (${shown}); commit or discard them, then refresh`
    );
  }
  return integrate({ ...input, lanes: [] });
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
  const ok = isRecord2(raw) && raw["name"] === paths.name && typeof raw["branch"] === "string" && typeof raw["worktree"] === "string" && typeof raw["base"] === "string" && typeof raw["baseSha"] === "string" && Array.isArray(raw["merged"]) && raw["merged"].every(isMergedEntry) && isOptional(raw["manifests"], isStringArray) && isOptional(raw["depsConfirmedAt"], (v) => v === null || typeof v === "string" && SHA2.test(v)) && typeof raw["depsConfirmed"] === "boolean" && typeof raw["headSha"] === "string" && typeof raw["updatedAt"] === "string";
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
  if (!SHA2.test(sha)) {
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
      `${paths.branch} is at ${headSha}, not ${previous.headSha}, the head whose manifests arbab integrate listed; run arbab integrate ${paths.name} --refresh (or with its lanes) again, review the manifests it lists, then run the arbab integrate ${paths.name} --deps-installed <sha> it prints`
    );
  }
  if (previous.manifests.length === 0) return previous;
  const rec = { ...previous, depsConfirmedAt: headSha, depsConfirmed: true, updatedAt: isoAt(clock) };
  writeJsonAtomic(paths.integration, rec);
  return rec;
}

// src/registry/paths.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync3, readdirSync as readdirSync4 } from "node:fs";
import { join as join9 } from "node:path";
var ATTEMPT_DIR = /^attempt-([1-9][0-9]*)$/;
function runPaths(runsRoot, lane) {
  assertValidName(lane, "lane");
  const laneDir = confine(runsRoot, lane);
  return {
    laneDir,
    laneFile: join9(laneDir, "lane.json"),
    stateFile: join9(laneDir, "state.json"),
    shepherdFile: join9(laneDir, "shepherd.json"),
    attemptDir(n) {
      if (!Number.isSafeInteger(n) || n < 1) throw new ArbabError("usage", `attempt ${n} must be a positive integer`);
      return join9(laneDir, `attempt-${n}`);
    }
  };
}
function attemptFiles(dir) {
  return {
    brief: join9(dir, "brief.md"),
    settings: join9(dir, "settings.json"),
    args: join9(dir, "args.json"),
    started: join9(dir, "started.json"),
    stream: join9(dir, "stream.jsonl"),
    stderr: join9(dir, "stderr.log"),
    registration: join9(dir, "registration.json"),
    exit: join9(dir, "exit.json"),
    summary: join9(dir, "summary.json"),
    report: join9(dir, "report.json"),
    acked: join9(dir, "acked")
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
      mkdirSync3(dir);
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

// src/registry/events.ts
import { appendFileSync, mkdirSync as mkdirSync4, readFileSync as readFileSync2 } from "node:fs";
import { join as join10 } from "node:path";

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

// src/registry/events.ts
var EVENTS_FILE = "events.jsonl";
function eventsFile(runsRoot, lane) {
  return join10(runPaths(runsRoot, lane).laneDir, EVENTS_FILE);
}
function appendLaneEvent(runsRoot, lane, event) {
  try {
    const file = eventsFile(runsRoot, lane);
    mkdirSync4(join10(file, ".."), { recursive: true });
    appendFileSync(file, `${JSON.stringify(event)}
`);
  } catch {
  }
}

// src/registry/machine.ts
import { createHash as createHash2 } from "node:crypto";
import { readdirSync as readdirSync5, readFileSync as readFileSync3, rmSync as rmSync4 } from "node:fs";
import { join as join11 } from "node:path";
var SHEPHERDS_DIR = "shepherds";
var WAITERS_DIR = "waiters";
var PROJECTS_DIR = "projects";
var ENTRY_FILE = /^([1-9][0-9]*)\.json$/;
function pidFile(home, dir, pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new ArbabError("usage", `pid ${pid} must be a positive integer`);
  return join11(home, dir, `${pid}.json`);
}
function remove(path) {
  try {
    rmSync4(path, { force: true });
  } catch {
  }
}
function fileNames(dir) {
  try {
    return readdirSync5(dir);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw new ArbabError("io", `cannot list ${dir}: ${err.message}`, { cause: err });
  }
}
function parsed(path) {
  try {
    return JSON.parse(readFileSync3(path, "utf8"));
  } catch {
    return void 0;
  }
}
function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
var isPid = (v) => Number.isSafeInteger(v) && v > 0;
var isOwner = (v) => v === null || typeof v === "string";
function asShepherd(v) {
  if (!isObject(v) || !isPid(v.pid) || typeof v.lane !== "string" || typeof v.project !== "string") return null;
  if (!isOwner(v.owner) || typeof v.startedAt !== "string") return null;
  return { pid: v.pid, lane: v.lane, project: v.project, owner: v.owner, startedAt: v.startedAt };
}
function asWaiter(v) {
  if (!isObject(v) || !isPid(v.pid) || typeof v.project !== "string") return null;
  if (!isOwner(v.owner) || typeof v.startedAt !== "string") return null;
  return { pid: v.pid, project: v.project, owner: v.owner, startedAt: v.startedAt };
}
function asProject(v) {
  if (!isObject(v) || typeof v.root !== "string" || typeof v.lastLaunchAt !== "string") return null;
  return { root: v.root, lastLaunchAt: v.lastLaunchAt };
}
function listByPid(home, dir, as, alive) {
  const out = [];
  for (const file of fileNames(join11(home, dir))) {
    const match = ENTRY_FILE.exec(file);
    if (match === null) continue;
    const path = join11(home, dir, file);
    const entry = as(parsed(path));
    if (entry === null || entry.pid !== Number(match[1])) continue;
    if (!alive(entry.pid)) {
      remove(path);
      continue;
    }
    out.push(entry);
  }
  return out.sort((a, b) => a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : a.pid - b.pid);
}
function registerShepherd(home, entry) {
  writeJsonAtomic(pidFile(home, SHEPHERDS_DIR, entry.pid), entry);
}
function unregisterShepherd(home, pid) {
  remove(pidFile(home, SHEPHERDS_DIR, pid));
}
function listShepherds(home, alive) {
  return listByPid(home, SHEPHERDS_DIR, asShepherd, alive);
}
function registerWaiter(home, entry) {
  writeJsonAtomic(pidFile(home, WAITERS_DIR, entry.pid), entry);
}
function unregisterWaiter(home, pid) {
  remove(pidFile(home, WAITERS_DIR, pid));
}
function listWaiters(home, alive) {
  return listByPid(home, WAITERS_DIR, asWaiter, alive);
}
function projectFile(home, root) {
  return join11(home, PROJECTS_DIR, `${createHash2("sha1").update(root).digest("hex")}.json`);
}
function registerProject(home, root, at) {
  const entry = { root, lastLaunchAt: at };
  writeJsonAtomic(projectFile(home, root), entry);
}
function listProjects(home) {
  const out = [];
  for (const file of fileNames(join11(home, PROJECTS_DIR))) {
    if (!/^[0-9a-f]{40}\.json$/.test(file)) continue;
    const entry = asProject(parsed(join11(home, PROJECTS_DIR, file)));
    if (entry !== null) out.push(entry);
  }
  return out.sort((a, b) => a.root < b.root ? -1 : a.root > b.root ? 1 : 0);
}

// src/registry/owner.ts
import { readFileSync as readFileSync4 } from "node:fs";
function sessionOf(env2) {
  const id = env2["CLAUDE_CODE_SESSION_ID"];
  return id === void 0 || id.trim() === "" ? null : id;
}
function readShepherdRecord(runsRoot, lane) {
  let v;
  try {
    v = JSON.parse(readFileSync4(runPaths(runsRoot, lane).shepherdFile, "utf8"));
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const obj = v;
  if (!Number.isSafeInteger(obj.pid) || obj.pid < 1 || typeof obj.startedAt !== "string") return null;
  const record2 = { pid: obj.pid, startedAt: obj.startedAt };
  if (obj.owner === null || typeof obj.owner === "string") record2.owner = obj.owner;
  return record2;
}
function ownedBy(record2, session, opts = {}) {
  if (session === null) return true;
  const owner = record2?.owner ?? null;
  if (owner === null) return opts.ownerless ?? true;
  return owner === session;
}

// src/registry/status.ts
var UNKNOWN = "\u2014";
var LIVE = /* @__PURE__ */ new Set(["queued", "held", "preparing", "running", "waiting-reset"]);
var isLive = (state) => LIVE.has(state);
function statusRow(record2, summary, nowMs, owner = null) {
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
    sevenDay: summary?.rateLimit?.sevenDay ?? null,
    owner,
    reason: typeof record2.reason === "string" ? record2.reason : null,
    // Summaries written before §21 have no tokens.
    tokens: tokenUsage(summary?.tokens)
  };
}
function tokenUsage(v) {
  if (typeof v !== "object" || v === null) return null;
  const t = v;
  const count = (k) => {
    const n = t[k];
    return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
  };
  const [input, cacheCreation, cacheRead, output4] = [count("input"), count("cacheCreation"), count("cacheRead"), count("output")];
  if (input === null || cacheCreation === null || cacheRead === null || output4 === null) return null;
  return { input, cacheCreation, cacheRead, output: output4 };
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
function formatTokens(tokens) {
  const n = tokens.input + tokens.cacheCreation + tokens.output;
  if (n < 1e3) return `${n} tok`;
  if (n < 999950) return `${(n / 1e3).toFixed(1)}k tok`;
  return `${(n / 1e6).toFixed(1)}M tok`;
}
function formatCost(row) {
  const { costUsd: cost, costDeltaUsd: delta } = row;
  if (cost === null) return row.tokens ? formatTokens(row.tokens) : UNKNOWN;
  const main = `$${cost.toFixed(2)}`;
  if (delta === null || delta.toFixed(2) === cost.toFixed(2)) return main;
  return `${main} (\u0394$${delta.toFixed(2)})`;
}
var WHY_MAX = 40;
function formatWhy(reason) {
  const text2 = (reason ?? "").trim().replace(/\s+/g, " ");
  return text2.length > WHY_MAX ? `${text2.slice(0, WHY_MAX - 1)}\u2026` : text2;
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
var HEADERS = ["lane", "state", "attempt", "elapsed", "turns", "calls", "last tool", "effort", "failed", "cost", "quota", "why"];
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
    formatCost(row),
    formatWindows(row.fiveHour, row.sevenDay, nowSec),
    formatWhy(row.reason)
  ]);
  const table3 = [HEADERS, ...cells];
  const widths = HEADERS.map((_, i) => Math.max(...table3.map((line2) => (line2[i] ?? "").length)));
  return table3.map(
    (line2) => line2.map((cell2, i) => cell2.padEnd(widths[i] ?? 0)).join("  ").trimEnd()
  ).join("\n");
}

// src/registry/wait.ts
import { createHash as createHash3 } from "node:crypto";
import { existsSync as existsSync4 } from "node:fs";
import { join as join12 } from "node:path";
var isDone = (state) => state === "finished" || state === "orphaned";
function doneRecord(runsRoot, lane, alive) {
  const record2 = readState(runsRoot, lane);
  if (!record2) return null;
  const state = effectiveState(record2, alive);
  return isDone(state) ? { record: record2, state } : null;
}
function isRunning(runsRoot, lane, alive) {
  const record2 = readState(runsRoot, lane);
  if (record2 !== null) return !isDone(effectiveState(record2, alive));
  const shepherd = readShepherdRecord(runsRoot, lane);
  return shepherd !== null && alive(shepherd.pid);
}
function ackedFile(runsRoot, lane) {
  return join12(runPaths(runsRoot, lane).laneDir, "acked.json");
}
function runMarker(runsRoot, lane, run) {
  const since = createHash3("sha256").update(run.since).digest("hex").slice(0, 16);
  return join12(runPaths(runsRoot, lane).laneDir, "acks", `${run.shepherdPid}-${since}`);
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
  const { runsRoot, lanes, include, mode, timeoutMs, pollMs, clock, sleep: sleep2, alive, stopWhenIdle } = options;
  if (lanes) {
    for (const lane of lanes) {
      assertValidName(lane, "lane");
      if (!existsSync4(runPaths(runsRoot, lane).laneDir)) throw new ArbabError("usage", `no runs for lane ${lane}`);
    }
  }
  const start = clock.now();
  for (; ; ) {
    const names2 = lanes ?? (include ? listLanes(runsRoot).filter(include) : listLanes(runsRoot));
    const running = stopWhenIdle === true && names2.some((lane) => isRunning(runsRoot, lane, alive));
    if (mode === "any") {
      const claimed = claim(runsRoot, pendingFinished(runsRoot, names2, alive));
      if (claimed.length > 0) return { finished: claimed, timedOut: false };
    } else if (names2.every((lane) => doneRecord(runsRoot, lane, alive) !== null)) {
      const claimed = claim(runsRoot, pendingFinished(runsRoot, names2, alive));
      if (claimed.length > 0 || stopWhenIdle !== true) return { finished: claimed, timedOut: false };
    }
    if (stopWhenIdle === true && !running) {
      const claimed = mode === "all" ? claim(runsRoot, pendingFinished(runsRoot, names2, alive)) : [];
      return claimed.length > 0 ? { finished: claimed, timedOut: false } : { finished: [], timedOut: false, idle: true };
    }
    const remaining = timeoutMs - (clock.now() - start);
    if (remaining <= 0) return { finished: [], timedOut: true };
    await sleep2(Math.min(pollMs, remaining));
  }
}

// src/commands/generated.ts
import { existsSync as existsSync5 } from "node:fs";
import { join as join13 } from "node:path";
var GENERATED = "generated.json";
var BY = "integration:";
var SHA3 = /^[0-9a-f]{40,64}$/;
var ownerTag = (owner) => `${BY}${owner.integration}`;
var markerPath = (runsRoot, lane) => join13(runsRoot, assertValidName(lane, "lane"), GENERATED);
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
    baseSha: typeof fields["baseSha"] === "string" && SHA3.test(fields["baseSha"]) ? fields["baseSha"] : null
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
import { createHash as createHash4 } from "node:crypto";
import { existsSync as existsSync13 } from "node:fs";
import { join as join30 } from "node:path";

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
  for (const line2 of text2.split("\n")) {
    if (line2.trim() === "") continue;
    try {
      events.push(JSON.parse(line2));
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
function tokenUsageOf(usage) {
  if (!isRecord4(usage)) return null;
  return {
    input: numberOrNull(usage.input_tokens) ?? 0,
    cacheCreation: numberOrNull(usage.cache_creation_input_tokens) ?? 0,
    cacheRead: numberOrNull(usage.cache_read_input_tokens) ?? 0,
    output: numberOrNull(usage.output_tokens) ?? 0
  };
}
function sumTokenUsage(usages) {
  let total = null;
  for (const u of usages) {
    total ??= { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 };
    total.input += u.input;
    total.cacheCreation += u.cacheCreation;
    total.cacheRead += u.cacheRead;
    total.output += u.output;
  }
  return total;
}
function maxGapMs(events) {
  let previous = null;
  let max = null;
  for (const e of events) {
    if (!isRecord4(e) || typeof e.timestamp !== "string") continue;
    const ms = Date.parse(e.timestamp);
    if (Number.isNaN(ms)) continue;
    if (previous !== null) max = Math.max(max ?? 0, ms - previous, 0);
    previous = ms;
  }
  return max;
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
  for (const block3 of contentBlocks(event)) {
    if (block3.type === "tool_use" && typeof block3.name === "string") out.push({ id: stringOrNull(block3.id), name: block3.name });
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
  const usageById = /* @__PURE__ */ new Map();
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
      if (isRecord4(e.message) && typeof e.message.id === "string") {
        messageIds.add(e.message.id);
        const usage = tokenUsageOf(e.message.usage);
        if (usage !== null) usageById.set(e.message.id, usage);
      }
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
    for (const block3 of contentBlocks(e)) {
      if (block3.type !== "tool_result" || block3.is_error !== true) continue;
      const id = stringOrNull(block3.tool_use_id);
      const tool = (id !== null ? toolNames.get(id) : void 0) ?? "?";
      if (tool === REPORT_TOOL) continue;
      const cause = failureCause(toolResultText(block3.content), id !== null ? deniedTypes.get(id) : void 0);
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
    unparsedLines,
    tokens: sumTokenUsage(usageById.values()),
    maxGapMs: maxGapMs(records)
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
    reportErrors: input.reportErrors,
    // From the stream itself, so a killed attempt without a result still has them.
    tokens: digest.tokens ? { ...digest.tokens } : null,
    maxGapMs: digest.maxGapMs ?? null
  };
}

// src/stream/transcript.ts
import { readdirSync as readdirSync6, statSync as statSync3 } from "node:fs";
import { join as join14 } from "node:path";
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function findTranscript(projectsDir, sessionId) {
  if (!UUID.test(sessionId)) return null;
  let dirs;
  try {
    dirs = readdirSync6(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    return null;
  }
  const file = `${sessionId}.jsonl`;
  for (const dir of dirs) {
    const candidate = join14(projectsDir, dir, file);
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
import { rmSync as rmSync5, statSync as statSync4 } from "node:fs";
import { join as join20 } from "node:path";

// src/commands/lint.ts
import { realpathSync as realpathSync6 } from "node:fs";
import { join as join19, resolve as resolve11 } from "node:path";

// src/brief/markdown.ts
var OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
var CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;
function scanLines(markdown) {
  const out = [];
  let fence2 = null;
  for (const text2 of markdown.split(/\r?\n/)) {
    if (fence2 === null) {
      const m = OPEN.exec(text2);
      const run2 = m?.[1];
      const rest = m?.[2] ?? "";
      if (run2 !== void 0 && !(run2.startsWith("`") && rest.includes("`"))) {
        fence2 = { char: run2.charAt(0), length: run2.length, info: rest.trim().split(/\s+/)[0] ?? "" };
        out.push({ text: text2, inFence: true, delimiter: true, info: fence2.info });
      } else {
        out.push({ text: text2, inFence: false, delimiter: false, info: null });
      }
      continue;
    }
    const run = CLOSE.exec(text2)?.[1];
    if (run !== void 0 && run.charAt(0) === fence2.char && run.length >= fence2.length) {
      out.push({ text: text2, inFence: true, delimiter: true, info: fence2.info });
      fence2 = null;
    } else {
      out.push({ text: text2, inFence: true, delimiter: false, info: fence2.info });
    }
  }
  return out;
}
function inlineCodeSpans(line2) {
  const spans = [];
  const runs = [...line2.matchAll(/`+/g)];
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
    spans.push(line2.slice(open2.index + open2[0].length, close.index));
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
    let line2 = `${"  ".repeat(depth)}- \`${name2}\`: \`${typeName(field)}\``;
    if (!required.has(name2)) line2 += " (optional)";
    const description = field.description?.replace(/\s+/g, " ").trim();
    if (description) line2 += ` \u2014 ${description}`;
    lines.push(line2);
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
var WORKER_TMP_ENV = [
  "XDG_CONFIG_HOME",
  "YARN_CACHE_FOLDER",
  "NPM_CONFIG_USERCONFIG"
];
var WORKER_SHELL = "/bin/bash";
var DEFAULT_BASH_OUTPUT_MAX_CHARS = 1e5;
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
  if (hasBash) {
    const maxChars = profile.settings.bashOutputMaxChars ?? DEFAULT_BASH_OUTPUT_MAX_CHARS;
    lines.push(
      `- Bash output longer than ${maxChars} characters is saved to a file you cannot read: run one test file, use a quiet reporter, or print only what you need.`,
      "- Quote paths that contain [ ] ( ), such as app/[slug]/page.tsx: unquoted, the shell or the permission check refuses them."
    );
    const templates = profile.settings.sandbox.filesystem?.allowRead ?? [];
    if (templates.length > 0) {
      lines.push(`- Tracked env templates ${templates.map(code).join(", ")} are readable by shell commands only.`);
    }
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
  if (ctx.inputs !== void 0 && ctx.inputs.length > 0) {
    const names2 = ctx.inputs.map((name2) => `\`${name2}\``).join(", ");
    parts.push(section("Inputs", `Read-only copies made for this lane, in .arbab-tmp/inputs/: ${names2}.`));
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
  for (const line2 of scanLines(markdown)) {
    if (!line2.inFence) {
      const section2 = SECTION.exec(line2.text)?.[1];
      if (section2 !== void 0 && section2 !== "") {
        blocks2.push({ name: section2, lines: [] });
        continue;
      }
      const heading = title === null ? TITLE.exec(line2.text)?.[1] : void 0;
      if (heading !== void 0) {
        title = heading;
        continue;
      }
    }
    blocks2.at(-1)?.lines.push(line2.text);
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
  for (const line2 of scanLines(markdown)) {
    if (line2.inFence) {
      flush();
      if (!line2.delimiter && SHELL_FENCES.has((line2.info ?? "").toLowerCase()) && line2.text.trim() !== "") {
        out.push({ text: line2.text, inline: false });
      }
    } else if (line2.text.trim() === "") {
      flush();
    } else if (HEADING.test(line2.text)) {
      flush();
      const heading = SECTION2.exec(line2.text)?.[1];
      if (heading !== void 0 && heading !== "") section2 = heading;
      paragraph = [line2.text];
      flush();
    } else {
      if (LIST_ITEM.test(line2.text) || TABLE_ROW.test(line2.text)) flush();
      paragraph.push(paragraph.length === 0 ? line2.text : line2.text.trim());
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
import { isAbsolute as isAbsolute4, join as join15, sep as sep4 } from "node:path";

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
var LOCAL_CONFIG_FILE = ".arbab/config.json";
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
  "landing",
  "fence",
  "hostGates"
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
    landing: { tier: "medium", squash: false },
    fence: { readableEnvFiles: [], bashOutputMaxChars: 1e5 },
    hostGates: []
  };
}
var SHELL_META = /[;&|`$<>()\\\n\r]/;
var ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
var VERSION = /^\d+\.\d+\.\d+$/;
function loadConfig(projectRoot) {
  let raw = null;
  let label = CONFIG_FILE;
  for (const rel of [CONFIG_FILE, LOCAL_CONFIG_FILE]) {
    raw = readJsonFile(join15(projectRoot, rel));
    label = rel;
    if (raw !== null) break;
  }
  const config = defaultConfig();
  if (raw === null) return config;
  const obj = record(raw, label);
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
    knownKeys(l, ["tier", "squash"], "landing");
    if (l.tier !== void 0) config.landing = { ...config.landing, tier: tier(l.tier) };
    if (l.squash !== void 0) config.landing = { ...config.landing, squash: boolean(l.squash, "landing.squash") };
  }
  if (obj.fence !== void 0) config.fence = fence(obj.fence, config.fence);
  if (obj.hostGates !== void 0) config.hostGates = argvList(obj.hostGates, "hostGates");
  return config;
}
function fence(v, defaults) {
  const obj = record(v, "fence");
  knownKeys(obj, ["readableEnvFiles", "bashOutputMaxChars"], "fence");
  const out = { ...defaults, readableEnvFiles: [...defaults.readableEnvFiles] };
  if (obj.readableEnvFiles !== void 0) out.readableEnvFiles = readableEnvFiles(obj.readableEnvFiles);
  if (obj.bashOutputMaxChars !== void 0) {
    out.bashOutputMaxChars = integerIn(obj.bashOutputMaxChars, 4e3, 128e3, "fence.bashOutputMaxChars");
  }
  return out;
}
function readableEnvFiles(v) {
  const seen = /* @__PURE__ */ new Set();
  return stringArray(v, "fence.readableEnvFiles").map((p, i) => {
    const field = `fence.readableEnvFiles[${i}]`;
    if (isAbsolute4(p) || p.startsWith("~")) fail(field, `${JSON.stringify(p)} must be project-relative`);
    if (/[\0\n\r]/.test(p)) fail(field, "must not contain NUL or a newline");
    const segments = p.split(/[\\/]/);
    if (segments.includes("..")) fail(field, `${JSON.stringify(p)} must not contain a .. segment`);
    if (!(segments[segments.length - 1] ?? "").startsWith(".env")) fail(field, `${JSON.stringify(p)} must name a file starting with .env`);
    if (seen.has(p)) fail(field, `${p} is listed twice`);
    seen.add(p);
    return p;
  });
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

// src/config/machine.ts
import { join as join16 } from "node:path";
function loadMachineConfig(home) {
  const raw = readJsonFile(join16(home, MACHINE_CONFIG_FILE));
  const config = { maxParallel: null };
  if (raw === null) return config;
  const obj = record(raw, MACHINE_CONFIG_FILE);
  knownKeys(obj, ["maxParallel"], MACHINE_CONFIG_FILE);
  if (obj.maxParallel !== void 0 && obj.maxParallel !== null) {
    config.maxParallel = integerIn(obj.maxParallel, 1, 32, `${MACHINE_CONFIG_FILE} maxParallel`);
  }
  return config;
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
    // Reviewers and skeptics run tests to check findings, and tests listen on 127.0.0.1 (DESIGN.md §21).
    loopback: true,
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
function credentialDenies(extra, projectRoot) {
  const rules = [];
  for (const path of [...BUILTIN_CREDENTIAL_PATHS, ...extra]) {
    const paths = [path];
    if (path.startsWith("**/")) {
      paths.push(`~/${path}`);
      if (projectRoot !== void 0) paths.push(`/${projectRoot}/${path}`);
    }
    for (const p of paths) rules.push(`Read(${p})`, `Edit(${p})`);
  }
  return dedupe(rules);
}
function dedupe(items) {
  return [...new Set(items)];
}

// src/profile/compile.ts
import { isAbsolute as isAbsolute5, relative as relative5, resolve as resolve8 } from "node:path";
var FILE_TOOLS2 = /* @__PURE__ */ new Set(["Read", "Glob", "Grep", "Edit", "Write"]);
var WRITE_TOOLS2 = /* @__PURE__ */ new Set(["Edit", "Write"]);
var WRITERS = ["implementer", "verifier", "probe"];
function compileProfile(input) {
  if (!isAbsolute5(input.worktree)) {
    throw new ArbabError("usage", `worktree ${JSON.stringify(input.worktree)} must be an absolute path`);
  }
  const gitDir = input.gitCommonDir === void 0 ? void 0 : absoluteDir("gitCommonDir", input.gitCommonDir);
  const projectRoot = input.projectRoot === void 0 ? void 0 : absoluteDir("projectRoot", input.projectRoot);
  const tmp = workerTmpPaths(input.worktree);
  let allow = dedupe([
    ...input.tools.filter((t) => FILE_TOOLS2.has(t) && (!WRITE_TOOLS2.has(t) || WRITERS.includes(input.role))),
    ...roleAllow(input.role),
    ...input.commands.flatMap(commandRules),
    ...input.laneAllow
  ]);
  if (input.fence === "sandbox-auto") allow = allow.filter((rule) => !rule.startsWith("Bash("));
  const allowRead = envAllowReads(input.worktree, input.envFileAllowReads ?? []);
  const filesystem = gitDir === void 0 && allowRead.length === 0 ? void 0 : { denyWrite: gitDir === void 0 ? [] : [gitDir], ...allowRead.length === 0 ? {} : { allowRead } };
  const deny = dedupe([
    // The `**/.env*` deny stays whatever readableEnvFiles says; allowRead re-opens the tracked templates only.
    ...credentialDenies(input.credentialPaths, projectRoot),
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
      // denyWrite: otherwise a sandboxed command can write refs and objects of the shared repository (measured, M1
      // review). allowRead: the tracked env templates, readable by shell commands only (DESIGN.md §21).
      ...filesystem === void 0 ? {} : { filesystem }
    },
    env: {
      ...input.env,
      ...FIXED_ENV,
      // Keeps git and package managers off the denied ~/.config and ~/.npmrc, which otherwise fail with EPERM.
      // XDG_DATA_HOME and XDG_CACHE_HOME stay unset: corepack's cache and pnpm's Linux store live under them.
      XDG_CONFIG_HOME: tmp.xdgConfig,
      YARN_CACHE_FOLDER: tmp.yarnCache,
      NPM_CONFIG_USERCONFIG: tmp.npmrc
    },
    permissions: { allow, deny },
    ...input.bashOutputMaxChars === void 0 ? {} : { bashOutputMaxChars: input.bashOutputMaxChars }
  };
  return { tools: input.tools, settings };
}
function absoluteDir(field, dir) {
  if (!isAbsolute5(dir)) {
    throw new ArbabError("usage", `${field} ${JSON.stringify(dir)} must be an absolute path`);
  }
  const normal = resolve8(dir);
  if (normal === "/") throw new ArbabError("usage", `${field} must not be the filesystem root`);
  return normal;
}
function envAllowReads(worktree, paths) {
  return dedupe(paths.map((path) => {
    if (!isAbsolute5(path)) throw new ArbabError("usage", `env template ${JSON.stringify(path)} must be an absolute path`);
    const normal = resolve8(path);
    const rel = relative5(resolve8(worktree), normal);
    if (rel === "" || rel.startsWith("..") || isAbsolute5(rel)) {
      throw new ArbabError("usage", `env template ${path} is outside the worktree ${worktree}`);
    }
    return normal;
  }));
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

// src/profile/envfiles.ts
import { readdirSync as readdirSync7, realpathSync as realpathSync4 } from "node:fs";
import { basename, dirname as dirname4, join as join17, posix, relative as relative6, sep as sep5 } from "node:path";
function envFileAllowReads(input) {
  let real2;
  try {
    real2 = realpathSync4(input.worktree);
  } catch {
    return [];
  }
  const out = /* @__PURE__ */ new Set();
  for (const listed of input.readable) {
    let path;
    try {
      path = confine(input.worktree, normalRel(listed));
    } catch {
      continue;
    }
    const rel = relative6(input.worktree, path).split(sep5).join("/");
    if (rel === "") continue;
    if (isRegularFile(input.worktree, real2, path) && isTracked(input.git, input.worktree, rel)) out.add(path);
  }
  return [...out].sort();
}
function normalRel(path) {
  return posix.normalize(path.split("\\").join("/"));
}
function isTracked(git, root, rel) {
  return git(["ls-files", "--error-unmatch", "--", `:(literal)${rel}`], root).code === 0;
}
function isRegularFile(worktree, realWorktree, path) {
  const dir = dirname4(path);
  try {
    if (realpathSync4(dir) !== join17(realWorktree, relative6(worktree, dir))) return false;
    const entry = readdirSync7(dir, { withFileTypes: true }).find((e) => e.name === basename(path));
    return entry !== void 0 && entry.isFile();
  } catch {
    return false;
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
import { isAbsolute as isAbsolute6 } from "node:path";
var HOST_KEYS = ["HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "SHELL"];
var SYSTEM_PATH = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
var ENV_NAME2 = /^[A-Za-z_][A-Za-z0-9_]*$/;
function workerEnv(host, opts) {
  for (const name2 of opts.passEnv) assertWorkerEnvName(name2, isForbiddenWorkerEnv);
  for (const name2 of Object.keys(opts.extra)) assertWorkerEnvName(name2, isReservedEnv);
  const dirs = opts.pnpmDir === void 0 ? [opts.nodeDir] : [opts.nodeDir, opts.pnpmDir];
  for (const dir of dirs) {
    if (!isAbsolute6(dir) || dir.includes(":")) {
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
  env2.CLAUDE_CODE_SHELL = WORKER_SHELL;
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
import { resolve as resolve9 } from "node:path";
var BASH_RULE = /^Bash\((.*)\)$/s;
var PARAM_RULE = /^\s*([A-Za-z_]+)\s*:/;
var PATH_RULE = /^(?:Read|Edit)\((.*)\)$/s;
function lintProfile(profile, input) {
  const issues = [];
  const error = (code4, message5, where) => {
    issues.push({ severity: "error", code: code4, message: message5, where });
  };
  const warn = (code4, message5, where) => {
    issues.push({ severity: "warning", code: code4, message: message5, where });
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
    } else if (!(sandbox.filesystem?.denyWrite ?? []).map((p) => resolve9(p)).includes(resolve9(gitDir))) {
      warn("shared-git-writable", `${gitDir} is not in the sandbox's denyWrite`, "sandbox.filesystem.denyWrite");
    }
  }
  for (const tool of profile.tools) {
    if (tool === "Task" || tool === "Agent") error("agent-tool", "nested agents are not budgeted", tool);
  }
  const reopened = new Set((input.envFileAllowReads ?? []).map((p) => resolve9(p)));
  for (const listed of input.readableEnvFiles ?? []) {
    const path = resolve9(input.worktree, listed.split("\\").join("/"));
    if (!reopened.has(path)) {
      warn(
        "env-template-untracked",
        `${listed} is not a regular file git tracks in the worktree, so it stays unreadable`,
        "fence.readableEnvFiles"
      );
    }
  }
  for (const key of Object.keys(input.env)) {
    if (Object.hasOwn(FIXED_ENV, key) || WORKER_TMP_ENV.includes(key)) {
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
import { existsSync as existsSync6, realpathSync as realpathSync5 } from "node:fs";
import { dirname as dirname5, join as join18, resolve as resolve10, sep as sep6 } from "node:path";
import { parseArgs } from "node:util";
function inLaneWorktree(path) {
  const parts = path.split(sep6);
  return parts.some((part, i) => part === ".arbab" && parts[i + 1] === "worktrees");
}
function notALaneWorktree(root) {
  let real2;
  try {
    real2 = realpathSync5(root);
  } catch {
    real2 = resolve10(root);
  }
  if (inLaneWorktree(real2) || inLaneWorktree(resolve10(root))) {
    throw new ArbabError("usage", `${root} is in a lane worktree, not a project; run arbab from the project root`);
  }
  return root;
}
function findProjectRoot(cwd, git) {
  let dir = resolve10(cwd);
  for (; ; ) {
    if (existsSync6(join18(dir, CONFIG_FILE))) return notALaneWorktree(dir);
    const parent = dirname5(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const r = git(["rev-parse", "--show-toplevel"], cwd);
  const top = r.stdout.trim();
  return r.code === 0 && top !== "" ? notALaneWorktree(top) : null;
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
  const path = resolve11(root, out);
  try {
    return realpathSync6(path);
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
    worktree: join19(project.worktreeRoot, lane.worktree ?? lane.name),
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
var launchLockPath = (project, lane) => join20(runPaths(project.runsRoot, lane).laneDir, "launch.lock");
function takeLaunchLock(ctx, project, lane, pid) {
  const path = launchLockPath(project, lane);
  const holder2 = { pid, lane, project: project.root, createdAt: isoAt(ctx.clock) };
  const data = JSON.stringify(holder2);
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
      if (readText(path) === data) rmSync5(path, { force: true });
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
import { existsSync as existsSync12 } from "node:fs";
import { join as join29, relative as relative7 } from "node:path";

// src/commands/doctor.ts
import { randomBytes as randomBytes3 } from "node:crypto";
import { rmSync as rmSync6 } from "node:fs";
import { join as join28 } from "node:path";

// src/binary/node.ts
import { execFileSync as execFileSync2 } from "node:child_process";
import { existsSync as existsSync7, realpathSync as realpathSync7 } from "node:fs";
function runVersion(path, args) {
  return execFileSync2(path, args, { encoding: "utf8", timeout: 3e4, stdio: ["ignore", "pipe", "pipe"] });
}
function pathExists(p) {
  return existsSync7(p);
}
function realpath(p) {
  return realpathSync7(p);
}

// src/binary/resolve.ts
import { isAbsolute as isAbsolute7, join as join21 } from "node:path";
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
    if (dir === "" || !isAbsolute7(dir)) continue;
    const candidate = join21(dir, cmd);
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
  const parsed2 = parseVersion(output4);
  if (parsed2 === null) {
    throw new ArbabError("binary", `${path} --version printed no version: ${JSON.stringify(output4.slice(0, 200))}`);
  }
  return parsed2.join(".");
}

// src/doctor/env.ts
import { posix as posix2 } from "node:path";
var ENV_TEMPLATES = [".env.example", ".env.sample", ".env.template", ".env.dist", ".env.defaults"];
function trackedEnvTemplates(git, root) {
  const r = git(["ls-files", "-z", "--", ...ENV_TEMPLATES.map((n) => `*${n}`)], root);
  if (r.code !== 0) return [];
  return r.stdout.split("\0").filter((p) => p !== "" && ENV_TEMPLATES.includes(posix2.basename(p))).sort();
}
function checkEnvTemplates(git, root, readableEnvFiles2) {
  const tracked = trackedEnvTemplates(git, root);
  if (tracked.length === 0) return null;
  const listed = new Set(readableEnvFiles2.map((p) => posix2.normalize(p.split("\\").join("/"))));
  const missing = tracked.filter((p) => !listed.has(p));
  return missing.length === 0 ? { status: "ok", check: "env", detail: `fence.readableEnvFiles lists ${tracked.join(", ")}` } : { status: "warn", check: "env", detail: `workers cannot read ${missing.join(", ")}; add them to fence.readableEnvFiles` };
}

// src/doctor/gates.ts
import { basename as basename2, join as join23 } from "node:path";

// src/doctor/read.ts
import { readdirSync as readdirSync8, readFileSync as readFileSync5 } from "node:fs";
import { join as join22 } from "node:path";
function readOptional(path) {
  try {
    return readFileSync5(path, "utf8");
  } catch {
    return null;
  }
}
function listNames(dir) {
  try {
    return readdirSync8(dir).sort();
  } catch {
    return [];
  }
}
function readPackageJson(root) {
  const text2 = readOptional(join22(root, "package.json"));
  if (text2 === null) return null;
  try {
    const value = JSON.parse(text2);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
function packageScripts(pkg) {
  const raw = pkg?.["scripts"];
  const out = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  for (const [name2, body] of Object.entries(raw)) {
    if (typeof body === "string") out[name2] = body;
  }
  return out;
}

// src/doctor/gates.ts
var CHECK_NAMES = /* @__PURE__ */ new Set(["check", "lint", "test", "typecheck", "type-check", "build", "format", "format:check"]);
var CHECK_PREFIXES = ["check:", "lint:", "test:", "i18n", "e2e"];
var RUNNERS = /* @__PURE__ */ new Set(["run-s", "run-p", "npm-run-all"]);
var SCRIPT_NAME = /^[^\s-][^\s]*$/;
function isCheckScript(name2) {
  return CHECK_NAMES.has(name2) || CHECK_PREFIXES.some((p) => name2.startsWith(p));
}
function scriptOf(argv2) {
  const pm = basename2(argv2[0] ?? "");
  let name2;
  if (pm === "pnpm" || pm === "yarn") name2 = argv2[1] === "run" ? argv2[2] : argv2[1];
  else if (pm === "npm") name2 = argv2[1] === "run" || argv2[1] === "run-script" ? argv2[2] : argv2[1] === "test" ? "test" : void 0;
  return name2 !== void 0 && SCRIPT_NAME.test(name2) ? name2 : null;
}
function scriptCalls(command) {
  const out = [];
  for (const segment of command.split(/&&|\|\||[;|&\n]/)) {
    const words = segment.trim().split(/\s+/).map((w) => w.replace(/^['"]|['"]$/g, "")).filter((w) => w !== "");
    while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] ?? "")) words.shift();
    const name2 = scriptOf(words);
    if (name2 !== null) out.push(name2);
    if (RUNNERS.has(basename2(words[0] ?? ""))) out.push(...words.slice(1).filter((w) => SCRIPT_NAME.test(w)));
  }
  return out;
}
function matching(pattern, names2) {
  if (!pattern.endsWith("*")) return names2.includes(pattern) ? [pattern] : [];
  const prefix = pattern.replace(/\*+$/, "");
  return names2.filter((n) => n.startsWith(prefix));
}
function coveredScripts(gates, scripts) {
  const names2 = Object.keys(scripts);
  const covered = /* @__PURE__ */ new Set();
  const queue = [];
  const mark = (pattern) => {
    for (const name2 of matching(pattern, names2)) {
      if (covered.has(name2)) continue;
      covered.add(name2);
      queue.push(name2);
    }
  };
  for (const gate of gates) {
    const name2 = scriptOf(gate);
    if (name2 !== null) mark(name2);
  }
  for (let name2 = queue.pop(); name2 !== void 0; name2 = queue.pop()) {
    for (const call of scriptCalls(scripts[name2] ?? "")) mark(call);
  }
  return covered;
}
function workflowRunLines(yaml) {
  const lines = yaml.split(/\r?\n/);
  const out = [];
  const indentOf = (line2) => line2.length - line2.trimStart().length;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:-\s+)?run:(?:\s+(.*))?$/.exec(lines[i] ?? "");
    if (m === null) continue;
    const indent = (m[1] ?? "").length;
    const value = (m[2] ?? "").replace(/\s+#.*$/, "").trim();
    if (value === "" || /^[|>][-+0-9]*$/.test(value)) {
      while (i + 1 < lines.length) {
        const next = lines[i + 1] ?? "";
        if (next.trim() !== "" && indentOf(next) <= indent) break;
        if (next.trim() !== "") out.push(next.trim());
        i++;
      }
    } else {
      out.push(value.replace(/^(['"])(.*)\1$/, "$2"));
    }
  }
  return out;
}
function checkGates(root, gates) {
  const scripts = packageScripts(readPackageJson(root));
  const checks = Object.keys(scripts).filter(isCheckScript).sort();
  if (checks.length === 0) return [];
  const covered = coveredScripts(gates, scripts);
  const missing = checks.filter((s) => !covered.has(s));
  const out = [
    missing.length === 0 ? { status: "ok", check: "gates", detail: `gates run ${checks.join(", ")}` } : { status: "warn", check: "gates", detail: `no gate runs these package.json scripts: ${missing.join(", ")}` }
  ];
  const workflows = join23(root, ".github", "workflows");
  const inCi = /* @__PURE__ */ new Set();
  for (const file of listNames(workflows).filter((n) => /\.ya?ml$/.test(n))) {
    for (const line2 of workflowRunLines(readOptional(join23(workflows, file)) ?? "")) {
      for (const call of scriptCalls(line2)) for (const name2 of matching(call, missing)) inCi.add(name2);
    }
  }
  if (inCi.size > 0) out.push({ status: "warn", check: "gates", detail: `CI runs checks verify does not: ${[...inCi].sort().join(", ")}` });
  return out;
}

// src/doctor/hook.ts
import { basename as basename3, dirname as dirname6, join as join24 } from "node:path";
var HOOK_MISSING = "runner calls will wait for approval: the plugin hook is missing (update the plugin)";
function hookFile(scriptPath2) {
  const dist = dirname6(scriptPath2);
  return basename3(dist) === "dist" ? join24(dirname6(dist), "hooks", "hooks.json") : null;
}
function checkHook(scriptPath2) {
  const file = hookFile(scriptPath2);
  if (file === null) return null;
  return readOptional(file)?.includes("hook pre-tool-use") === true ? { status: "ok", check: "hook", detail: file } : { status: "warn", check: "hook", detail: HOOK_MISSING };
}

// src/doctor/machine.ts
import { existsSync as existsSync8, readdirSync as readdirSync9 } from "node:fs";
import { join as join25 } from "node:path";
var MAX_WORKTREE_DIRS = 30;
var MAX_EMPTY_LOCK_DIRS = 100;
var message = (err) => err instanceof Error ? err.message : String(err);
function entries2(dir) {
  try {
    return readdirSync9(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
function countDirs(dir) {
  return entries2(dir).filter((e) => e.isDirectory()).length;
}
function countEmptyDirs(dir) {
  return entries2(dir).filter((e) => e.isDirectory() && entries2(join25(dir, e.name)).length === 0).length;
}
function checkDisk(worktreeDir, worktreeLabel, home) {
  const worktrees = countDirs(worktreeDir);
  const locks = countEmptyDirs(join25(home, "locks"));
  const out = [];
  if (worktrees > MAX_WORKTREE_DIRS) {
    out.push({
      status: "warn",
      check: "disk",
      detail: `${worktrees} directories in ${worktreeLabel} (more than ${MAX_WORKTREE_DIRS}): arbab cleanup --worktrees removes finished lanes' worktrees`
    });
  }
  if (locks > MAX_EMPTY_LOCK_DIRS) {
    out.push({ status: "warn", check: "disk", detail: `${locks} empty lock directories (more than ${MAX_EMPTY_LOCK_DIRS}): arbab cleanup removes them` });
  }
  if (out.length === 0) out.push({ status: "ok", check: "disk", detail: `${worktrees} worktree directories, ${locks} empty lock directories` });
  return out;
}
function checkMachineCap(home, root, maxParallel) {
  let machine;
  try {
    machine = loadMachineConfig(home);
  } catch (err) {
    return { status: "fail", check: "machine", detail: message(err) };
  }
  if (machine.maxParallel !== null) {
    const cap = Math.min(maxParallel, machine.maxParallel);
    return { status: "ok", check: "machine", detail: `maxParallel min(${maxParallel}, ${machine.maxParallel}) = ${cap}` };
  }
  const caps = /* @__PURE__ */ new Map([[root, maxParallel]]);
  let projects = [];
  try {
    projects = listProjects(home);
  } catch {
  }
  for (const p of projects) {
    if (caps.has(p.root) || !existsSync8(p.root)) continue;
    try {
      caps.set(p.root, loadConfig(p.root).maxParallel);
    } catch {
    }
  }
  const distinct = [...new Set(caps.values())].sort((a, b) => a - b);
  if (distinct.length < 2) return null;
  return {
    status: "warn",
    check: "machine",
    detail: `slots are shared machine-wide: set maxParallel in ~/.arbab/machine.json (projects set ${distinct.join(", ")})`
  };
}

// src/doctor/project.ts
import { existsSync as existsSync9 } from "node:fs";
import { join as join26 } from "node:path";
function checkIgnored(git, root, config) {
  const entries3 = arbabIgnoreEntries(root, config).filter((e) => e !== `${WORKER_TMP_DIR}/`);
  const notIgnored = entries3.filter((e) => git(["check-ignore", "-q", "--", `${e}x`], root).code !== 0);
  if (notIgnored.length === 0) return { status: "ok", check: "ignored", detail: `${entries3.join(", ")} ignored` };
  const them = notIgnored.length === 1 ? "it" : "them";
  return {
    status: "warn",
    check: "ignored",
    detail: `${notIgnored.join(", ")} not ignored yet (the shepherd adds ${them} to info/exclude on the next launch)`
  };
}
function checkConfigFiles(root) {
  if (!existsSync9(join26(root, CONFIG_FILE)) || !existsSync9(join26(root, LOCAL_CONFIG_FILE))) return null;
  return { status: "warn", check: "configs", detail: `both ${CONFIG_FILE} and ${LOCAL_CONFIG_FILE} exist: ${CONFIG_FILE} wins` };
}

// src/doctor/scanners.ts
import { existsSync as existsSync10 } from "node:fs";
import { join as join27 } from "node:path";
var FLAT_CONFIG = /^eslint\.config\.(js|mjs|cjs|ts|mts|cts)$/;
var TEST_CONFIG = /^(vitest|vite|jest)\.config\.(js|mjs|cjs|ts|mts|cts|json)$/;
var ESLINT_FLAT_UNGUARDED = "eslint in this checkout also lints .arbab/worktrees: add '.arbab/**' to its ignores";
function checkEslint(root) {
  const names2 = listNames(root);
  const flat2 = names2.filter((n) => FLAT_CONFIG.test(n));
  const legacy = names2.filter((n) => n.startsWith(".eslintrc"));
  if (readPackageJson(root)?.["eslintConfig"] !== void 0) legacy.push("package.json eslintConfig");
  if (flat2.length === 0 && legacy.length === 0) return [];
  const out = [];
  const unguarded = flat2.filter((n) => !(readOptional(join27(root, n)) ?? "").includes(ARBAB_DIR));
  if (unguarded.length > 0) out.push({ status: "warn", check: "eslint", detail: `${ESLINT_FLAT_UNGUARDED} (${unguarded.join(", ")})` });
  const marker = `${ARBAB_DIR}/${ESLINT_MARKER}`;
  if (legacy.length > 0 && !existsSync10(join27(root, marker))) {
    out.push({
      status: "warn",
      check: "eslint",
      detail: `${marker} is missing, so ESLint in a worktree also loads ${legacy.join(", ")} of this checkout (the shepherd writes the marker on the next launch)`
    });
  }
  if (out.length === 0) out.push({ status: "ok", check: "eslint", detail: `${[...flat2, ...legacy].join(", ")} stop at ${ARBAB_DIR}/` });
  return out;
}
function confinesTests(text2) {
  return /\b(include|testMatch)\b/.test(text2) || text2.includes(ARBAB_DIR);
}
function checkTestConfigs(root) {
  const configs = [];
  const open2 = [];
  for (const name2 of listNames(root).filter((n) => TEST_CONFIG.test(n))) {
    const text2 = readOptional(join27(root, name2)) ?? "";
    if (name2.startsWith("vite.") && !/\btest\s*:/.test(text2)) continue;
    configs.push(name2);
    if (!confinesTests(text2)) open2.push(name2);
  }
  if (configs.length === 0) return null;
  return open2.length === 0 ? { status: "ok", check: "tests", detail: `${configs.join(", ")} limit what they collect` } : {
    status: "warn",
    check: "tests",
    detail: `${open2.join(", ")} may collect tests from .arbab/worktrees: set include, or exclude '.arbab/**'`
  };
}

// src/commands/doctor.ts
var MIN_NODE = "20.0.0";
var MIN_GIT = "2.20.0";
var message2 = (err) => err instanceof Error ? err.message : String(err);
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
    return { status: "fail", check: "claude", detail: message2(err) };
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
function checkHome(home) {
  const probe = join28(home, `.doctor-${randomBytes3(6).toString("hex")}`);
  try {
    ensureDir(home);
    createExclusive(probe, "");
    rmSync6(probe, { force: true });
    return { status: "ok", check: "home", detail: `${home} is writable` };
  } catch (err) {
    return { status: "fail", check: "home", detail: `${home} is not writable: ${message2(err)}` };
  }
}
function guarded(check2, run) {
  try {
    const result = run();
    return result === null ? [] : Array.isArray(result) ? result : [result];
  } catch (err) {
    return [{ status: "warn", check: check2, detail: `could not check: ${message2(err)}` }];
  }
}
function projectChecks(ctx, root, config) {
  return [
    ...guarded("ignored", () => checkIgnored(ctx.git, root, config)),
    ...guarded("eslint", () => checkEslint(root)),
    ...guarded("tests", () => checkTestConfigs(root)),
    ...guarded("gates", () => checkGates(root, config.gates)),
    ...guarded("env", () => checkEnvTemplates(ctx.git, root, config.fence.readableEnvFiles)),
    ...guarded("disk", () => checkDisk(confine(root, config.worktreeRoot), config.worktreeRoot, ctx.home)),
    ...guarded("machine", () => checkMachineCap(ctx.home, root, config.maxParallel))
  ];
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
      checks.push({ status: "fail", check: "config", detail: message2(err) });
    }
    checks.push(...guarded("configs", () => checkConfigFiles(root)));
  }
  let deps = null;
  try {
    deps = ctx.shepherdDeps();
  } catch (err) {
    checks.push({ status: "fail", check: "claude", detail: message2(err) });
    checks.push({ status: "fail", check: "sandbox", detail: message2(err) });
  }
  if (deps !== null) {
    checks.push(checkClaude(deps, config ?? defaultConfig()));
    checks.push(checkSandbox(ctx.platform, deps));
  }
  checks.push(...guarded("hook", () => checkHook(ctx.scriptPath)));
  if (root !== null && config !== null) checks.push(...projectChecks(ctx, root, config));
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
import { existsSync as existsSync11 } from "node:fs";
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
    report: report !== null && existsSync11(report) ? report : null
  };
}
function formatFinished(line2) {
  const parts = [line2.attempt === null ? line2.lane : `${line2.lane}#${line2.attempt}`, line2.endState];
  if (line2.attempt !== null) {
    const wall = line2.wallMs === null ? NONE : formatElapsed(line2.wallMs);
    const cost = line2.costDeltaUsd === null ? NONE : `$${line2.costDeltaUsd.toFixed(2)}`;
    parts.push(wall, `turns=${line2.turns}`, `calls=${line2.toolCalls}`, `failed=${line2.failed}`, `cost=${cost}`);
  }
  if (line2.report !== null) parts.push(`report=${line2.report}`);
  if (line2.reason !== null && line2.reason.trim() !== "") parts.push(`reason: ${line2.reason.trim().replace(/\s+/g, " ")}`);
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
      "all-sessions": { type: "boolean" },
      "timeout-min": { type: "string" },
      notify: { type: "boolean" },
      json: { type: "boolean" }
    },
    allowPositionals: true
  });
  if (values.any === true && values.all === true) throw new ArbabError("usage", "--any and --all exclude each other");
  const timeoutMs = parseTimeoutMin(values["timeout-min"]);
  for (const lane of positionals) assertValidName(lane, "lane");
  const project = openProject(ctx);
  const named = positionals.length > 0;
  const session = sessionOf(ctx.hostEnv);
  const owned = !named && values["all-sessions"] !== true;
  registerWaiter(ctx.home, { pid: ctx.pid, project: project.root, owner: session, startedAt: isoAt(ctx.clock) });
  let result;
  try {
    result = await waitForFinished({
      runsRoot: project.runsRoot,
      lanes: named ? positionals : null,
      // Another session's orchestrator acks its own runs; claiming them would hide them from it.
      ...owned && { include: (lane) => ownedBy(readShepherdRecord(project.runsRoot, lane), session) },
      mode: values.all === true ? "all" : "any",
      timeoutMs,
      pollMs: POLL_MS,
      clock: ctx.clock,
      sleep: ctx.sleep,
      alive: ctx.alive,
      stopWhenIdle: true
    });
  } finally {
    unregisterWaiter(ctx.home, ctx.pid);
  }
  const lines = result.finished.map((item) => describeFinished(project.runsRoot, item));
  const idle = result.idle === true;
  if (values.json === true) {
    printJson(ctx, idle ? { timedOut: false, finished: [], idle: true } : { timedOut: result.timedOut, finished: lines });
  } else {
    for (const line2 of lines) ctx.stdout(formatFinished(line2) + "\n");
    if (idle) ctx.stdout("no lanes are running\n");
    if (result.timedOut) ctx.stderr("arbab wait: timed out\n");
  }
  if (values.notify === true) {
    for (const line2 of lines) await ctx.notify("arbab", `${line2.lane}: ${line2.endState}`);
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
var preflightDir = (project, lane) => join29(project.root, PREFLIGHT_DIR, assertValidName(lane, "lane"));
function writeProbeLanes(project, lane) {
  if (lane.name.length > MAX_PREFLIGHT_NAME) {
    throw new ArbabError(
      "usage",
      `lane name ${lane.name} is ${lane.name.length} characters; preflight needs at most ${MAX_PREFLIGHT_NAME} to add -pf-tools and -pf-model`
    );
  }
  const dir = preflightDir(project, lane.name);
  const rel = (path) => relative7(project.root, path);
  const owner = lane.worktree ?? lane.name;
  const worktree = lane.worktree !== void 0 || existsSync12(join29(project.worktreeRoot, owner)) ? owner : void 0;
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
    const briefFile = join29(dir, `${name2}.md`);
    const schemaFile = join29(dir, `${name2}.schema.json`);
    const laneFile = join29(dir, `${name2}.json`);
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
      // The steps are the project's checks, not the role's work: a reviewer's commands need not list them.
      allow: [.../* @__PURE__ */ new Set([...lane.allow ?? [], ...steps.map((cmd) => `Bash(${cmd})`)])]
    }),
    model: write("pf-model", modelBrief(lane.name), MODEL_SCHEMA, {
      ...lane.model !== void 0 && { model: lane.model },
      ...lane.effort !== void 0 && { effort: lane.effort },
      wallMin: 10,
      idleMin: 5,
      allow: [...lane.allow ?? [], `Bash(${SHA_COMMAND})`]
    }),
    borrowed: worktree ?? null
  };
}
var gitMessage = (r) => (r.stderr || r.stdout).trim();
function removeProbeWorktree(git, project, probe, gitCommonDir2) {
  const path = join29(project.worktreeRoot, assertValidName(probe, "probe lane"));
  const branch = `arbab/${probe}`;
  if (existsSync12(path)) {
    if (gitCommonDir2 === void 0) return `kept ${path}: the repository's git directory is unknown`;
    const verified = verifyWorktreeGit({ worktree: path, branch, gitCommonDir: gitCommonDir2 });
    if (verified.gitDir === null) return `kept ${path}: ${verified.error}`;
    const removed = git([...untrustedTree(), "worktree", "remove", path], project.root);
    if (removed.code !== 0) return `kept ${path}: git worktree remove failed: ${gitMessage(removed)}`;
  }
  git(["worktree", "prune"], project.root);
  if (git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], project.root).code !== 0) return null;
  const deleted = git([...untrustedTree(), "branch", "-d", branch], project.root);
  return deleted.code === 0 ? null : `kept ${branch}: git branch -d failed: ${gitMessage(deleted)}`;
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
  const answer2 = answerOf(model);
  const sha = answer2 === null ? null : /\bOK\s+([0-9a-fA-F]{4,40})\b/.exec(answer2)?.[1] ?? null;
  if (headSha === null) return { status: "fail", check: "sha", detail: "the model probe's worktree HEAD is unknown" };
  if (sha === null) return { status: "fail", check: "sha", detail: `no "OK <sha>" in the answer ${JSON.stringify(answer2)}` };
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
async function whileWaiting(ctx, root, wait) {
  registerWaiter(ctx.home, { pid: ctx.pid, project: root, owner: sessionOf(ctx.hostEnv), startedAt: isoAt(ctx.clock) });
  try {
    return await wait();
  } finally {
    unregisterWaiter(ctx.home, ctx.pid);
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
  ensureIgnored(project.root, arbabIgnoreEntries(project.root, project.config), ctx.git);
  ensureArbabMarkers(project.root);
  const files = writeProbeLanes(project, lane);
  for (const probe of [files.tools, files.model]) {
    const probeLint = lintLane(project, probe.laneFile, gitCommonDir2).issues;
    if (hasErrors(probeLint)) {
      for (const issue of probeLint) ctx.stderr(formatIssue(issue) + "\n");
      throw new ArbabError("lint", `${issueSummary(probe.name, probeLint)}; preflight not started`);
    }
  }
  const own2 = files.borrowed === null ? [files.tools.name, files.model.name] : [];
  for (const name2 of own2) {
    assertInactive(ctx, project, name2);
    assertNoLiveWorker(ctx, project, name2);
  }
  for (const name2 of own2) {
    const kept = removeProbeWorktree(ctx.git, project, name2, gitCommonDir2);
    if (kept !== null) throw new ArbabError("git", `a previous preflight's probe is in the way: ${kept}; remove it, then run preflight again`);
  }
  const probes = [];
  for (const probe of [files.tools, files.model]) {
    const before = listAttempts(project.runsRoot, probe.name).at(-1) ?? 0;
    const launched = await launchLane(ctx, project, probe.laneFile);
    probes.push({ lane: probe.name, pid: launched.shepherdPid, before });
  }
  ctx.stderr(`preflight: launched ${probes.map((p) => p.lane).join(" and ")}; waiting
`);
  const finished = await whileWaiting(ctx, project.root, () => waitForProbes(ctx, project.runsRoot, probes, timeoutMs));
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
  for (const name2 of own2) {
    const kept = removeProbeWorktree(ctx.git, project, name2, gitCommonDir2);
    if (kept !== null) ctx.stderr(`preflight: ${kept}
`);
  }
  return ok ? 0 : 1;
}

// src/commands/integration.ts
function openIntegration(project, name2) {
  const paths = integrationPaths(project.root, project.config, name2);
  const record2 = readIntegration(paths);
  if (record2 === null) throw new ArbabError("usage", `integration ${paths.name} does not exist; run arbab integrate ${paths.name} first`);
  return { paths, record: record2 };
}
var SHA4 = /^[0-9a-f]{40,64}$/;
function branchHead(git, root, branch) {
  const r = git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`], root);
  const sha = r.stdout.trim();
  return r.code === 0 && SHA4.test(sha) ? sha : null;
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
  const file = join30(paths.lanesDir, `${name2}.json`);
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
  const runDir = join30(project.runsRoot, name2);
  const path = join30(project.worktreeRoot, name2);
  const branch = `arbab/${name2}`;
  const head = branchHead(ctx.git, project.root, branch);
  if (!existsSync13(runDir) && !existsSync13(path) && head === null) return;
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
  if (existsSync13(path)) mustGit(ctx, [...untrustedTree(), "worktree", "remove", "--force", path], project.root);
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
function readOwnFinished(runsRoot, run) {
  let state = null;
  try {
    state = readState(runsRoot, run.lane);
  } catch {
  }
  return state !== null && state.shepherdPid === run.pid && state.state === "finished" ? state : null;
}
function readOutcome(runsRoot, run) {
  const own2 = readOwnFinished(runsRoot, run);
  const attempts = listAttempts(runsRoot, run.lane).filter((n) => n > run.before);
  const latest = attempts.at(-1) ?? null;
  const report = latest === null ? null : readReport(attemptFiles(runPaths(runsRoot, run.lane).attemptDir(latest)).report);
  return { lane: run.lane, endState: own2?.endState ?? null, reason: own2?.reason ?? null, attempts, report };
}
function collectRun(runsRoot, run) {
  const outcome2 = readOutcome(runsRoot, run);
  const own2 = readOwnFinished(runsRoot, run);
  if (own2 !== null) ackRun(runsRoot, run.lane, { shepherdPid: own2.shepherdPid, since: own2.since }, outcome2.attempts.at(-1) ?? null);
  return outcome2;
}
var runRecordPath = (lanesDir, lane) => join30(lanesDir, `${assertValidName(lane, "lane")}.run.json`);
function readGeneratedRun(lanesDir, lane) {
  let raw;
  try {
    raw = readJson(runRecordPath(lanesDir, lane));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw;
  const valid = r["lane"] === lane && Number.isInteger(r["shepherdPid"]) && Number.isInteger(r["before"]) && typeof r["head"] === "string" && SHA4.test(r["head"]) && typeof r["fingerprint"] === "string" && typeof r["settled"] === "boolean";
  return valid ? r : null;
}
function settleGeneratedRuns(lanesDir, lanes) {
  for (const lane of lanes) {
    const run = readGeneratedRun(lanesDir, lane);
    if (run !== null && !run.settled) writeJsonAtomic(runRecordPath(lanesDir, lane), { ...run, settled: true });
  }
}
function laneFingerprint(lane) {
  return createHash4("sha256").update(JSON.stringify([lane.spec, lane.brief, lane.schema ?? null])).digest("hex");
}
var hasReport = (o) => o.report !== null;
function reusableRun(ctx, project, lanesDir, lane, owner, fingerprint, usable = hasReport) {
  const prior = readGeneratedRun(lanesDir, lane);
  if (prior === null || prior.settled || prior.head !== owner.head || prior.fingerprint !== fingerprint) return null;
  const marker = readGenerated(project.runsRoot, lane);
  if (marker === null || marker.by !== ownerTag(owner) || marker.baseSha !== owner.head) return null;
  let state;
  try {
    state = readState(project.runsRoot, lane);
  } catch {
    return null;
  }
  if (state === null || state.shepherdPid !== prior.shepherdPid) return null;
  const run = { lane, pid: prior.shepherdPid, before: prior.before };
  if (isActive(effectiveState(state, ctx.alive))) return { kind: "wait", run };
  const outcome2 = readOutcome(project.runsRoot, run);
  return outcome2.endState === "success" && usable(outcome2) ? { kind: "adopt", run } : null;
}
function attemptEvents(runsRoot, lane, attempts) {
  const paths = runPaths(runsRoot, lane);
  return attempts.flatMap((n) => parseStream(readText(attemptFiles(paths.attemptDir(n)).stream) ?? "").events);
}
async function runGeneratedLanes(ctx, project, paths, lanes, timeoutMs, owner, usable = hasReport) {
  const plans = lanes.map((lane) => {
    const name2 = assertValidName(lane.spec.name, "lane");
    const fingerprint = laneFingerprint(lane);
    return { lane, name: name2, fingerprint, prior: reusableRun(ctx, project, paths.lanesDir, name2, owner, fingerprint, usable) };
  });
  const fresh2 = plans.filter((p) => p.prior === null);
  for (const p of fresh2) assertInactive(ctx, project, p.name);
  const written = fresh2.map((p) => ({ ...p, file: writeGeneratedLane(project, paths, p.lane) }));
  lintGeneratedLanes(ctx, project, written.map((p) => p.file));
  for (const p of written) {
    resetGeneratedWorktree(ctx, project, p.name, owner);
    markGenerated(project.runsRoot, p.name, owner, new Date(ctx.clock.now()).toISOString());
  }
  const runs = /* @__PURE__ */ new Map();
  for (const p of plans) if (p.prior !== null) runs.set(p.name, p.prior.run);
  for (const p of written) {
    const before = listAttempts(project.runsRoot, p.name).at(-1) ?? 0;
    const launched = await launchLane(ctx, project, p.file, { generated: true });
    const run = { lane: p.name, pid: launched.shepherdPid, before };
    const record2 = { lane: p.name, shepherdPid: run.pid, before, head: owner.head, fingerprint: p.fingerprint, settled: false };
    writeJsonAtomic(runRecordPath(paths.lanesDir, p.name), record2);
    runs.set(p.name, run);
  }
  const named = (kind) => plans.filter((p) => p.prior?.kind === kind).map((p) => p.name).join(", ");
  if (named("adopt") !== "") ctx.stderr(`adopted ${named("adopt")}: finished for this head after an earlier run stopped waiting
`);
  if (named("wait") !== "") ctx.stderr(`${named("wait")} still running for this head from an earlier run; waiting
`);
  if (fresh2.length > 0) ctx.stderr(`launched ${fresh2.map((p) => p.name).join(", ")}; waiting
`);
  const started = plans.flatMap((p) => runs.get(p.name) ?? []);
  if (!await whileWaiting(ctx, project.root, () => waitForProbes(ctx, project.runsRoot, started, timeoutMs))) return { timedOut: true, outcomes: [] };
  return { timedOut: false, outcomes: started.map((run) => collectRun(project.runsRoot, run)) };
}
function latestReport(runsRoot, lane) {
  const latest = listAttempts(runsRoot, lane).at(-1);
  return latest === void 0 ? null : readReport(attemptFiles(runPaths(runsRoot, lane).attemptDir(latest)).report);
}

// src/commands/cleanup.ts
var UNPARSED_GRACE_MS = 5 * 6e4;
var REAP_GRACE_MS = 1e4;
var DAY_MS = 864e5;
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
        rmSync7(path, { force: true });
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
function removeEmptyLockDirs(home) {
  const root = join31(home, "locks");
  let entries3;
  try {
    entries3 = readdirSync10(root, { withFileTypes: true });
  } catch {
    return 0;
  }
  let removed = 0;
  for (const entry of entries3) {
    if (!entry.isDirectory()) continue;
    try {
      rmdirSync2(join31(root, entry.name));
      removed++;
    } catch {
    }
  }
  return removed;
}
function runLaneSpec(project, lane) {
  try {
    const value = readJson(runPaths(project.runsRoot, lane).laneFile);
    return typeof value === "object" && value !== null ? value : {};
  } catch {
    return {};
  }
}
async function reapOrphans(ctx, project, report, include = () => true) {
  for (const lane of listLanes(project.runsRoot).filter(include)) {
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
var gitMessage2 = (r) => (r.stderr || r.stdout).trim();
var SHA5 = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
function landedLanes(project) {
  const out = /* @__PURE__ */ new Map();
  for (const name2 of listIntegrations(project.root)) {
    let raw;
    try {
      raw = readJson(integrationPaths(project.root, project.config, name2).landing);
    } catch {
      continue;
    }
    if (typeof raw !== "object" || raw === null) continue;
    const lanes = raw["lanes"];
    if (!Array.isArray(lanes)) continue;
    for (const entry of lanes) {
      if (typeof entry !== "object" || entry === null) continue;
      const { lane, sha } = entry;
      if (typeof lane !== "string" || !isValidName(lane) || typeof sha !== "string" || !SHA5.test(sha)) continue;
      out.set(lane, [...out.get(lane) ?? [], { integration: name2, sha }]);
    }
  }
  return out;
}
function landedIntegration(paths) {
  try {
    const raw = readJson(paths.landing);
    const head = typeof raw === "object" && raw !== null ? raw["integrationHead"] : void 0;
    return typeof head === "string" && SHA5.test(head) ? [{ integration: paths.name, sha: head }] : [];
  } catch {
    return [];
  }
}
function judge(git, root, target, hasWorktree, hasBranch, rules, common) {
  if (hasWorktree) {
    try {
      const verified = verifyWorktreeGit({ worktree: target.path, branch: target.branch, gitCommonDir: common() });
      if (verified.gitDir === null) return { keep: `cannot verify its git dir: ${verified.error}` };
      const changes = worktreeStatus(target.path, verified.gitDir, git).filter((line2) => !line2.startsWith(`?? ${WORKER_TMP_DIR}/`));
      if (changes.length > 0) return { keep: "uncommitted changes" };
    } catch (err) {
      return { keep: err.message };
    }
  }
  if (!hasBranch) return { keep: `no branch ${target.branch}` };
  const ref2 = `refs/heads/${target.branch}`;
  const merged = git(["merge-base", "--is-ancestor", ref2, rules.base], root);
  if (merged.code === 0) return { remove: `merged into ${rules.base}`, deleteBranch: true };
  if (merged.code !== 1) return { keep: `git merge-base --is-ancestor failed (${merged.code}): ${gitMessage2(merged)}` };
  for (const landing of rules.landed) {
    if (git(["merge-base", "--is-ancestor", ref2, landing.sha], root).code === 0) {
      return { remove: `landed by integration ${landing.integration}`, deleteBranch: false };
    }
  }
  if (rules.stale !== null && hasWorktree) return { remove: rules.stale, deleteBranch: false };
  return { keep: `branch ${target.branch} is not merged into ${rules.base}` };
}
function removeWorktreeAndBranch(git, root, target, rules, out, blocker, common) {
  const hasWorktree = existsSync14(target.path);
  if (!hasWorktree && !target.deleteBranch) return;
  const hasBranch = branchHead(git, root, target.branch) !== null;
  if (!hasWorktree && !hasBranch) return;
  const blocked = blocker();
  const verdict = blocked === null ? judge(git, root, target, hasWorktree, hasBranch, rules, common) : { keep: blocked };
  if ("keep" in verdict) {
    if (hasWorktree) out.worktreesKept.push({ path: target.path, reason: verdict.keep });
    else out.branchesKept.push({ branch: target.branch, reason: verdict.keep });
    return;
  }
  if (hasWorktree) {
    const removed = git([...untrustedTree(), "worktree", "remove", target.path], root);
    if (removed.code !== 0) {
      out.worktreesKept.push({ path: target.path, reason: `git worktree remove failed: ${gitMessage2(removed)}` });
      return;
    }
    out.worktreesRemoved.push(target.path);
    rules.removals?.push({ path: target.path, reason: verdict.remove });
  }
  if (!target.deleteBranch || !verdict.deleteBranch) return;
  const deleted = git([...untrustedTree(), "branch", "-d", target.branch], root);
  if (deleted.code !== 0) out.branchesKept.push({ branch: target.branch, reason: `git branch -d failed: ${gitMessage2(deleted)}` });
  else out.branchesDeleted.push(target.branch);
}
function worktreeOwner(project, lane) {
  const spec = runLaneSpec(project, lane);
  return spec.worktree === void 0 ? lane : spec.worktree;
}
function removeLaneWorktrees(ctx, project, lanes, base, out, opts = {}) {
  const states = /* @__PURE__ */ new Map();
  const records = /* @__PURE__ */ new Map();
  const unreadable = /* @__PURE__ */ new Map();
  const all = listLanes(project.runsRoot);
  for (const lane of all) {
    try {
      const record2 = readState(project.runsRoot, lane);
      if (record2 === null) continue;
      states.set(lane, effectiveState(record2, ctx.alive));
      records.set(lane, record2);
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
  const landed = landedLanes(project);
  const nowMs = ctx.clock.now();
  const stale = (lane, branch) => {
    const record2 = records.get(lane);
    if (opts.olderThanMs === void 0 || record2 === void 0 || states.get(lane) !== "finished") return null;
    if (lane.startsWith(INTEGRATION_WORKTREE_PREFIX)) return null;
    const age = nowMs - Date.parse(record2.since);
    if (!(age > opts.olderThanMs)) return null;
    return `unchanged for ${Math.floor(age / DAY_MS)} days; branch ${branch} kept`;
  };
  for (const lane of new Set(lanes)) {
    if (!isValidName(lane)) {
      out.warnings.push(`${JSON.stringify(lane)} is not a valid lane name`);
      continue;
    }
    try {
      const target = {
        path: join31(project.worktreeRoot, lane),
        branch: `arbab/${lane}`,
        deleteBranch: readGenerated(project.runsRoot, lane) !== null
      };
      const owner = worktreeOwner(project, lane);
      if (owner !== lane) {
        const where = typeof owner === "string" && isValidName(owner) ? `lane ${owner}'s worktree` : `worktree ${JSON.stringify(owner)}`;
        const reason = `lane ${lane} works in ${where}`;
        if (existsSync14(target.path)) out.worktreesKept.push({ path: target.path, reason });
        else if (target.deleteBranch && branchHead(ctx.git, project.root, target.branch) !== null) out.branchesKept.push({ branch: target.branch, reason });
        continue;
      }
      const blocker = () => {
        const state = states.get(lane);
        if (state === void 0) {
          const error = unreadable.get(lane);
          if (error !== void 0) return error;
          return existsSync14(runPaths(project.runsRoot, lane).laneDir) ? "no run state" : null;
        }
        if (isActive(state)) return `lane ${lane} is ${state}`;
        if (state === "orphaned") return "orphaned: run arbab cleanup first";
        const user = borrowed.get(lane);
        return user === void 0 ? null : `in use by lane ${user}`;
      };
      const rules = { base, landed: landed.get(lane) ?? [], stale: stale(lane, target.branch), removals: opts.removals };
      removeWorktreeAndBranch(ctx.git, project.root, target, rules, out, blocker, common);
    } catch (err) {
      out.warnings.push(`${lane}: ${err.message}`);
    }
  }
}
function removeIntegrationWorktree(ctx, project, paths, base, out, opts = {}) {
  try {
    const target = { path: paths.worktree, branch: paths.branch, deleteBranch: true };
    const rules = { base, landed: landedIntegration(paths), stale: null, removals: opts.removals };
    removeWorktreeAndBranch(ctx.git, project.root, target, rules, out, () => null, commonDirOf(ctx.git, project.root));
  } catch (err) {
    out.warnings.push(`integration ${paths.name}: ${err.message}`);
  }
}
function removeLandedIntegrations(ctx, project, out, opts = {}) {
  for (const name2 of listIntegrations(project.root)) {
    try {
      const paths = integrationPaths(project.root, project.config, name2);
      if (!existsSync14(paths.landing)) continue;
      const record2 = readIntegration(paths);
      if (record2 === null) {
        out.warnings.push(`integration ${name2} landed but has no integration.json`);
        continue;
      }
      removeIntegrationWorktree(ctx, project, paths, record2.base, out, opts);
    } catch (err) {
      out.warnings.push(`integration ${name2}: ${err.message}`);
    }
  }
}
function removeMergedWorktrees(ctx, project, report, opts = {}) {
  const { include } = opts;
  const lanes = listLanes(project.runsRoot).filter((lane) => {
    if (include !== void 0 && !include(lane)) return false;
    try {
      const record2 = readState(project.runsRoot, lane);
      return record2 === null || effectiveState(record2, ctx.alive) === "finished";
    } catch {
      return false;
    }
  });
  const removals = report.worktreeRemovals;
  removeLaneWorktrees(ctx, project, lanes, project.config.baseBranch, report, { olderThanMs: opts.olderThanMs, removals });
  if (include === void 0) removeLandedIntegrations(ctx, project, report, { removals });
}
var emptyWorktreeCleanup = () => ({
  worktreesRemoved: [],
  branchesDeleted: [],
  worktreesKept: [],
  branchesKept: [],
  warnings: []
});
function formatWorktreeCleanup(c, removals = []) {
  const why = new Map(removals.map((r) => [r.path, r.reason]));
  return [
    ...c.worktreesRemoved.map((path) => {
      const reason = why.get(path);
      return reason === void 0 ? `removed worktree ${path}` : `removed worktree ${path}: ${reason}`;
    }),
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
    ...report.lockDirsRemoved > 0 ? [`removed ${report.lockDirsRemoved} empty lock ${report.lockDirsRemoved === 1 ? "directory" : "directories"}`] : [],
    ...formatWorktreeCleanup(report, report.worktreeRemovals)
  ];
  return lines.length === 0 ? "nothing to clean" : lines.join("\n");
}
function olderThanMs(value) {
  const ms = Number(value) * DAY_MS;
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(ms)) {
    throw new ArbabError("usage", `--older-than takes a positive whole number of days, not ${JSON.stringify(value)} (see arbab cleanup --help)`);
  }
  return ms;
}
async function runCleanup(argv2, ctx) {
  const { values } = parse("cleanup", {
    args: argv2,
    options: { worktrees: { type: "boolean" }, "older-than": { type: "string" }, mine: { type: "boolean" }, json: { type: "boolean" } },
    allowPositionals: false
  });
  const days = values["older-than"];
  if (days !== void 0 && values.worktrees !== true) throw new ArbabError("usage", "--older-than needs --worktrees (see arbab cleanup --help)");
  const ageMs = days === void 0 ? void 0 : olderThanMs(days);
  const project = openProject(ctx);
  const session = sessionOf(ctx.hostEnv);
  const include = values.mine === true && session !== null ? (lane) => ownedBy(readShepherdRecord(project.runsRoot, lane), session, { ownerless: false }) : void 0;
  const report = { orphaned: [], reaped: [], released: [], ...emptyWorktreeCleanup(), worktreeRemovals: [], lockDirsRemoved: 0 };
  await reapOrphans(ctx, project, report, include);
  report.released = releaseStalePoolFiles(ctx.home, ctx.alive, ctx.clock.now());
  report.lockDirsRemoved = removeEmptyLockDirs(ctx.home);
  if (values.worktrees === true) removeMergedWorktrees(ctx, project, report, { olderThanMs: ageMs, include });
  if (values.json === true) printJson(ctx, report);
  else ctx.stdout(formatCleanup(report) + "\n");
  return 0;
}

// src/commands/hook.ts
import { realpathSync as realpathSync8 } from "node:fs";

// src/hook/approve.ts
import { isAbsolute as isAbsolute8, resolve as resolve12, sep as sep7 } from "node:path";

// src/hook/command.ts
var UNQUOTED = /^[A-Za-z0-9_@%+=:,./~-]+$/;
var DOUBLE_QUOTED_UNSAFE = /[$`\\!]/;
var CONTROL = /[\x00-\x08\x0a-\x1f\x7f]/;
var isSeparator = (c) => c === " " || c === "	";
function tokenize(command) {
  if (CONTROL.test(command)) return null;
  const words = [];
  let i = 0;
  while (i < command.length) {
    const c = command[i];
    if (isSeparator(c)) {
      i++;
      continue;
    }
    let end;
    let word;
    if (c === "'" || c === '"') {
      const close = command.indexOf(c, i + 1);
      if (close < 0) return null;
      const value = command.slice(i + 1, close);
      if (c === '"' && DOUBLE_QUOTED_UNSAFE.test(value)) return null;
      word = { value, quoted: true };
      end = close + 1;
    } else {
      end = i;
      while (end < command.length && !isSeparator(command[end])) end++;
      const value = command.slice(i, end);
      if (!UNQUOTED.test(value)) return null;
      word = { value, quoted: false };
    }
    if (end < command.length && !isSeparator(command[end])) return null;
    words.push(word);
    i = end;
  }
  return words;
}
function shellWord(s) {
  if (UNQUOTED.test(s)) return s;
  if (!s.includes("'")) return `'${s}'`;
  return `"${s.replace(/[$`\\!"]/g, "\\$&")}"`;
}

// src/hook/approve.ts
var APPROVAL = JSON.stringify({
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "arbab runner" }
});
var NEVER = /* @__PURE__ */ new Set(["__shepherd", "hook", "land"]);
var TEMP_DIRS = ["/tmp", "/private/tmp"];
function real(path, realpath2) {
  try {
    return realpath2(path);
  } catch {
    return null;
  }
}
function sameFile(a, b, realpath2) {
  const ra = real(a, realpath2);
  return ra !== null && ra === real(b, realpath2);
}
function under(base, path) {
  const b = resolve12(base);
  return path === b || path.startsWith(b.endsWith(sep7) ? b : b + sep7);
}
function knownProject(dir, opts) {
  if (!isAbsolute8(dir)) return false;
  const path = real(dir, opts.realpath);
  if (path === null || inLaneWorktree(path)) return false;
  for (const temp of opts.tempDirs) {
    if (!isAbsolute8(temp)) continue;
    const realTemp = real(temp, opts.realpath);
    if (under(temp, path) || realTemp !== null && under(realTemp, path)) return false;
  }
  return opts.projectRoots().some((root) => isAbsolute8(root) && (root === path || real(root, opts.realpath) === path));
}
function isRunnerCall(command, opts) {
  const words = tokenize(command);
  if (words === null || words.length < 3) return false;
  const [node, runner] = words;
  if (node?.value !== "node" || runner === void 0) return false;
  if (!isAbsolute8(runner.value) || !sameFile(runner.value, opts.scriptPath, opts.realpath)) return false;
  let at = 2;
  if (words[at]?.value === "-C") at += 2;
  const name2 = words[at]?.value;
  if (name2 === void 0 || NEVER.has(name2) || !opts.commands.includes(name2)) return false;
  const dir = at === 4 ? words[3]?.value : void 0;
  return dir === void 0 || knownProject(dir, opts);
}
function isObject2(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
var STRING_FIELDS = ["session_id", "transcript_path", "cwd", "permission_mode", "tool_use_id"];
function approves(input, opts) {
  let parsed2;
  try {
    parsed2 = JSON.parse(input);
  } catch {
    return false;
  }
  if (!isObject2(parsed2)) return false;
  for (const field of STRING_FIELDS) {
    if (parsed2[field] !== void 0 && typeof parsed2[field] !== "string") return false;
  }
  if (parsed2.hook_event_name !== void 0 && parsed2.hook_event_name !== "PreToolUse") return false;
  if (parsed2.tool_name !== "Bash" || !isObject2(parsed2.tool_input)) return false;
  const command = parsed2.tool_input.command;
  return typeof command === "string" && isRunnerCall(command, opts);
}

// src/hook/stop.ts
var NAMED_LANES = 5;
function isObject3(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function runnerWord(path) {
  return /[$`\\!"]/.test(path) ? shellWord(path) : `"${path}"`;
}
function waitCommand(scriptPath2, lanes, cwd) {
  const projects = new Set(lanes.map((l) => l.project));
  const [project] = projects;
  const dir = projects.size === 1 && project !== void 0 && project !== cwd ? ` -C ${shellWord(project)}` : "";
  return `node ${runnerWord(scriptPath2)}${dir} wait --any`;
}
function blockReason(lanes, scriptPath2, cwd) {
  const named = lanes.slice(0, NAMED_LANES).map((l) => `${l.lane} (${l.project})`);
  const more = lanes.length > NAMED_LANES ? ` and ${lanes.length - NAMED_LANES} more` : "";
  const subject = lanes.length === 1 ? "lane is" : "lanes are";
  return `arbab: ${lanes.length} ${subject} still running for this session and no \`arbab wait\` is running for them: ${named.join(", ")}${more}. Start one in the background (run_in_background) so their results reach you: ` + waitCommand(scriptPath2, lanes, cwd);
}
function stopDecision(input, opts) {
  let parsed2;
  try {
    parsed2 = JSON.parse(input);
  } catch {
    return null;
  }
  if (!isObject3(parsed2)) return null;
  const { session_id: session, stop_hook_active: active, cwd } = parsed2;
  if (typeof session !== "string" || session === "") return null;
  if (active !== void 0 && typeof active !== "boolean") return null;
  if (active === true) return null;
  if (cwd !== void 0 && typeof cwd !== "string") return null;
  if (parsed2.hook_event_name !== void 0 && parsed2.hook_event_name !== "Stop") return null;
  const lanes = listShepherds(opts.home, opts.alive).filter((s) => s.owner === session);
  if (lanes.length === 0) return null;
  if (listWaiters(opts.home, opts.alive).some((w) => w.owner === session)) return null;
  return JSON.stringify({ decision: "block", reason: blockReason(lanes, opts.scriptPath, cwd ?? opts.cwd) });
}

// src/commands/hook.ts
var HOOK_EVENTS = ["pre-tool-use", "stop"];
async function answer(event, ctx, tempDirs) {
  const input = await ctx.readStdin();
  if (event === "pre-tool-use") {
    const tmp = ctx.hostEnv["TMPDIR"];
    const ok = approves(input, {
      scriptPath: ctx.scriptPath,
      // COMMANDS is read here, not at load: index.ts imports this module.
      commands: Object.keys(COMMANDS),
      realpath: realpathSync8,
      projectRoots: () => listProjects(ctx.home).map((entry) => entry.root),
      tempDirs: tmp === void 0 || tmp === "" ? tempDirs : [...tempDirs, tmp]
    });
    return ok ? APPROVAL : null;
  }
  return stopDecision(input, { home: ctx.home, alive: ctx.alive, scriptPath: ctx.scriptPath, cwd: ctx.cwd });
}
async function runHook(argv2, ctx, tempDirs = TEMP_DIRS) {
  const [event, ...rest] = argv2;
  if (event !== "pre-tool-use" && event !== "stop") {
    throw new ArbabError("usage", `hook takes one of ${HOOK_EVENTS.join(", ")}, got ${JSON.stringify(event ?? "")}`);
  }
  if (rest.length > 0) throw new ArbabError("usage", `hook ${event} takes no arguments`);
  let out = null;
  try {
    out = await answer(event, ctx, tempDirs);
  } catch {
    out = null;
  }
  if (out !== null) ctx.stdout(out);
  return 0;
}

// src/commands/host-check.ts
import { existsSync as existsSync15 } from "node:fs";
import { join as join32 } from "node:path";

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
    for (const block3 of contentBlocks(event)) {
      if (block3.type === "tool_use" && block3.name === "Bash" && isRecord4(block3.input)) {
        const id = stringOrNull(block3.id);
        const command = stringOrNull(block3.input.command)?.trim() ?? null;
        if (id !== null && command !== null && !firstCall.has(command)) firstCall.set(command, id);
      } else if (block3.type === "tool_result") {
        const id = stringOrNull(block3.tool_use_id);
        if (id !== null) results.set(id, block3);
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

// src/commands/host-check.ts
var isObject4 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var isGateResult = (v) => isObject4(v) && (v["kind"] === "gate" || v["kind"] === "smoke") && Array.isArray(v["argv"]) && v["argv"].every((a) => typeof a === "string") && typeof v["command"] === "string" && (v["exitCode"] === null || Number.isInteger(v["exitCode"]));
function readHostCheckRecord(path, name2) {
  const raw = readJson(path);
  if (raw === null) return null;
  const ok = isObject4(raw) && raw["name"] === name2 && typeof raw["headSha"] === "string" && Array.isArray(raw["results"]) && raw["results"].every(isGateResult) && typeof raw["passed"] === "boolean" && raw["interactive"] === true && typeof raw["finishedAt"] === "string";
  if (!ok) throw new ArbabError("io", `${path} is not a host check record for ${name2}`);
  return raw;
}
function assertWorktreeAt(ctx, worktree, head) {
  if (!existsSync15(worktree)) throw new ArbabError("usage", `the integration worktree ${worktree} does not exist; run arbab integrate again`);
  const at = ctx.git([...untrustedTree(), "rev-parse", "HEAD"], worktree);
  if (at.code !== 0 || at.stdout.trim() !== head) {
    throw new ArbabError("usage", `${worktree} is at ${at.code === 0 ? at.stdout.trim() : "no commit"}, not at the integration head ${head}`);
  }
  const status = ctx.git([...untrustedTree(), "status", "--porcelain", "--untracked-files=no"], worktree);
  if (status.code !== 0) throw new ArbabError("git", `git status failed in ${worktree}: ${status.stderr.trim()}`);
  if (status.stdout.trim() !== "") {
    throw new ArbabError("usage", `${worktree} has tracked changes, so the gates would not check ${head}; commit or discard them first`);
  }
}
async function runHostCheck(argv2, ctx) {
  const { positionals } = parse("host-check", { args: argv2, options: {}, allowPositionals: true });
  const name2 = assertValidName(onePositional("host-check", positionals, "name"), "integration");
  if (!ctx.interactive) {
    throw new ArbabError(
      "usage",
      "host-check runs worker-written code on the host: run it yourself in a terminal, after reviewing the integration"
    );
  }
  const project = openProject(ctx);
  const gates = project.config.hostGates;
  if (gates.length === 0) throw new ArbabError("usage", "no hostGates are configured; add them to the config first");
  const integration = openIntegration(project, name2);
  assertRecordedHead(ctx.git, project, integration);
  const head = integration.record.headSha;
  const worktree = integration.paths.worktree;
  assertWorktreeAt(ctx, worktree, head);
  const results = [];
  for (const gate of gates) {
    const command = commandLine(gate);
    const r = ctx.runCommand(gate, worktree);
    results.push({ kind: "gate", argv: gate, command, exitCode: r.code });
    ctx.stdout(`${r.code === 0 ? "pass" : `FAIL (exit ${r.code})`}  ${command}
`);
    if (r.code !== 0 && r.output.trim() !== "") ctx.stderr(`--- ${command}
${r.output.endsWith("\n") ? r.output : `${r.output}
`}`);
  }
  const record2 = {
    name: name2,
    headSha: head,
    results,
    passed: results.every((result) => result.exitCode === 0),
    interactive: true,
    finishedAt: isoAt(ctx.clock)
  };
  writeJsonAtomic(join32(integration.paths.dir, HOST_CHECKS_FILE), record2);
  return record2.passed ? 0 : 1;
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
function fixedPathsOverlap(a, b) {
  const fa = fixedPath(a);
  const fb = fixedPath(b);
  const n = Math.min(fa.length, fb.length);
  for (let i = 0; i < n; i++) if (fa[i]?.toLowerCase() !== fb[i]?.toLowerCase()) return false;
  return true;
}
var MAX_EXPANSIONS = 256;
function expandBraces(glob) {
  const open2 = glob.indexOf("{");
  if (open2 === -1) return glob.includes("}") ? null : [glob];
  let depth = 0;
  let close = -1;
  const commas = [];
  for (let i = open2; i < glob.length && close === -1; i++) {
    const c = glob[i];
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) close = i;
    else if (c === "," && depth === 1) commas.push(i);
  }
  if (close === -1 || commas.length === 0 || glob.slice(0, open2).includes("}")) return null;
  const bounds = [open2, ...commas, close];
  const out = [];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const alternative = glob.slice(0, open2) + glob.slice((bounds[k] ?? 0) + 1, bounds[k + 1]) + glob.slice(close + 1);
    const expanded = expandBraces(alternative);
    if (expanded === null) return null;
    out.push(...expanded);
    if (out.length > MAX_EXPANSIONS) return null;
  }
  return out;
}
function splitSegments(glob) {
  const out = [];
  let depth = 0;
  let current = "";
  const push = () => {
    if (current !== "" && current !== ".") out.push(current);
    current = "";
  };
  for (const c of glob) {
    if (c === "/") {
      if (depth > 0) return null;
      push();
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    current += c;
  }
  push();
  if (glob.endsWith("/")) out.push("**");
  return out;
}
function globSegments(glob) {
  if (glob.includes("\\")) return null;
  const alternatives = expandBraces(glob);
  if (alternatives === null) return null;
  const out = [];
  for (const alternative of alternatives) {
    const segments = splitSegments(alternative);
    if (segments === null) return null;
    out.push(segments);
  }
  return out;
}
function scopeForms(glob) {
  const forms = globSegments(glob);
  if (forms === null || PATTERN_SEGMENT.test(glob)) return forms;
  return forms.flatMap((segments) => segments.at(-1) === "**" ? [segments] : [segments, [...segments, "**"]]);
}
var EXTGLOB = /[@!+*?]\(/;
function segmentRegExp(pattern) {
  if (EXTGLOB.test(pattern)) return null;
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] ?? "";
    if (c === "*") source += "[^/]*";
    else if (c === "?") source += "[^/]";
    else if (c === "[" && pattern.indexOf("]", i + 2) !== -1) {
      const negated = pattern[i + 1] === "!" || pattern[i + 1] === "^";
      const start = i + 1 + (negated ? 1 : 0);
      const end = pattern.indexOf("]", start + 1);
      if (end === -1) return null;
      const body = pattern.slice(start, end);
      if (body.includes("[:")) return null;
      source += `[${negated ? "^/" : ""}${body.replace(/[\\\]^[]/g, "\\$&")}]`;
      i = end;
    } else source += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  try {
    return new RegExp(`^${source}$`, "i");
  } catch {
    return null;
  }
}
function literalEnds(pattern) {
  const first = pattern.search(/[*?[]|[@!+]\(/);
  const last = Math.max(...["*", "?", "]", ")"].map((c) => pattern.lastIndexOf(c)));
  return { prefix: pattern.slice(0, first), suffix: pattern.slice(last + 1) };
}
function segmentsMeet(a, b) {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  const globA = PATTERN_SEGMENT.test(a);
  const globB = PATTERN_SEGMENT.test(b);
  if (!globA && !globB) return la === lb;
  if (globA && globB) {
    const ea = literalEnds(la);
    const eb = literalEnds(lb);
    const prefixes = ea.prefix.startsWith(eb.prefix) || eb.prefix.startsWith(ea.prefix);
    const suffixes = ea.suffix.endsWith(eb.suffix) || eb.suffix.endsWith(ea.suffix);
    return prefixes && suffixes;
  }
  const [glob, literal] = globA ? [la, lb] : [lb, la];
  const re = segmentRegExp(glob);
  if (re !== null) return re.test(literal);
  const { prefix, suffix } = literalEnds(glob);
  return literal.startsWith(prefix) && literal.endsWith(suffix) && literal.length >= prefix.length + suffix.length;
}
function pathsMeet(a, b) {
  const memo = /* @__PURE__ */ new Map();
  const meet = (i, j) => {
    const key = i * (b.length + 1) + j;
    const known = memo.get(key);
    if (known !== void 0) return known;
    let result;
    if (a[i] === "**") result = meet(i + 1, j) || j < b.length && meet(i, j + 1);
    else if (b[j] === "**") result = meet(i, j + 1) || i < a.length && meet(i + 1, j);
    else if (i === a.length || j === b.length) result = i === a.length && j === b.length;
    else result = segmentsMeet(a[i] ?? "", b[j] ?? "") && meet(i + 1, j + 1);
    memo.set(key, result);
    return result;
  };
  return meet(0, 0);
}
function globsOverlap(a, b) {
  const sa = scopeForms(a);
  const sb = scopeForms(b);
  if (sa === null || sb === null) return fixedPathsOverlap(a, b);
  return sa.some((x) => sb.some((y) => pathsMeet(x, y)));
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
  const error = (code4, message5, where) => {
    issues.push({ severity: "error", code: code4, message: message5, where });
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
import { isAbsolute as isAbsolute9, resolve as resolve13 } from "node:path";
var PLAN_KEYS = ["name", "base", "defaults", "phases"];
var PHASE_KEYS = ["name", "brief", "scope", "dependsOn", ...PHASE_LANE_KEYS];
function loadPlan(projectRoot, planPath) {
  const file = resolve13(projectRoot, planPath);
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
    if (isAbsolute9(glob) || /^[A-Za-z]:/.test(glob)) fail(`${field}[${i}]`, `${glob} must be relative`);
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
function retryRefusal(plan, states, phase) {
  if (!plan.phases.some((p) => p.name === phase)) return `phase ${phase} is not in plan ${plan.name}`;
  const s = states[phase];
  if (s === void 0) return `phase ${phase} never ran; plan next launches it when its dependencies succeed`;
  if (s.state === "orphaned") return null;
  if (s.state !== "finished") return `phase ${phase} is ${s.state}; stop it or wait for it first`;
  if (s.endState === "success") return `phase ${phase} succeeded; there is nothing to retry`;
  return null;
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
var RESERVED_PREFIX2 = "ref-";
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
    throw new ArbabError("usage", "usage: arbab integrate <name> (--lanes a,b,\u2026 | --plan <plan.json> | --deps-installed <sha> | --adopt <ref> | --refresh)");
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
      adopt: { type: "string" },
      base: { type: "string" },
      refresh: { type: "boolean" },
      json: { type: "boolean" }
    },
    allowPositionals: true
  });
  const name2 = assertValidName(onePositional("integrate", positionals, "name"), "integration");
  if (name2.startsWith(RESERVED_PREFIX2)) {
    throw new ArbabError("usage", `integration name ${name2}: the prefix ${RESERVED_PREFIX2} is reserved for verify --ref; choose another name`);
  }
  const project = openProject(ctx);
  let record2;
  const confirmed = values["deps-installed"];
  const adopt = values.adopt;
  if (values.base !== void 0 && adopt === void 0) throw new ArbabError("usage", "--base goes with --adopt <ref>");
  if (values.refresh === true) {
    const others = [
      values.lanes !== void 0 && "--lanes",
      values.plan !== void 0 && "--plan",
      confirmed !== void 0 && "--deps-installed",
      adopt !== void 0 && "--adopt"
    ].filter((o) => o !== false);
    if (others.length > 0) throw new ArbabError("usage", `--refresh takes no ${others.join(" or ")}: it records the existing head again and merges nothing`);
    const { record: refreshed } = refreshIntegration({
      projectRoot: project.root,
      config: project.config,
      name: name2,
      git: ctx.git,
      runCommand: ctx.runCommand,
      clock: ctx.clock
    });
    if (values.json === true) printJson(ctx, refreshed);
    else ctx.stdout(`refreshed ${name2}: recorded ${refreshed.branch} at ${refreshed.headSha}
` + formatIntegration(refreshed));
    return 0;
  }
  if (confirmed !== void 0) {
    if (values.lanes !== void 0 || values.plan !== void 0) {
      throw new ArbabError("usage", "--deps-installed takes no lanes: merge first, then confirm the install");
    }
    if (adopt !== void 0) throw new ArbabError("usage", "--deps-installed and --adopt exclude each other: adopt first, then confirm the install");
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
  if (adopt !== void 0) {
    if (values.lanes !== void 0 || values.plan !== void 0) {
      throw new ArbabError("usage", "--adopt takes no --lanes or --plan: it makes an integration of an existing branch; merge lanes into it afterwards");
    }
    const { record: adopted } = adoptIntegration({
      projectRoot: project.root,
      config: project.config,
      name: name2,
      ref: adopt,
      ...values.base !== void 0 && { base: values.base },
      git: ctx.git,
      runCommand: ctx.runCommand,
      clock: ctx.clock
    });
    if (values.json === true) printJson(ctx, adopted);
    else ctx.stdout(`adopted ${adopt} as ${adopted.branch} (base ${adopted.base} at ${adopted.baseSha})
` + formatIntegration(adopted));
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

// src/commands/land.ts
import { existsSync as existsSync16, readFileSync as readFileSync6, realpathSync as realpathSync9 } from "node:fs";
import { basename as basename4, resolve as resolve14 } from "node:path";

// src/review/findings.ts
var SEVERITIES = ["HIGH", "MEDIUM", "LOW"];
function text(v) {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}
function severity(v) {
  return SEVERITIES.includes(v) ? v : null;
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
    finishedAt: new Date(input.now).toISOString(),
    ...input.since !== void 0 && { since: input.since }
  };
}

// src/review/history.ts
import { readdirSync as readdirSync11 } from "node:fs";
import { join as join33 } from "node:path";
var ROUND_FILE = /^([1-9][0-9]{0,8})\.json$/;
function reviewRoundPath(integrationDir, round) {
  if (!Number.isInteger(round) || round < 1) throw new ArbabError("usage", `review round ${round} is not a positive integer`);
  return join33(integrationDir, REVIEW_HISTORY_DIR, `${round}.json`);
}
function reviewRounds(integrationDir) {
  let names2;
  try {
    names2 = readdirSync11(join33(integrationDir, REVIEW_HISTORY_DIR));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw new ArbabError("io", `cannot list ${join33(integrationDir, REVIEW_HISTORY_DIR)}: ${err.message}`, { cause: err });
  }
  return names2.flatMap((n) => {
    const round = ROUND_FILE.exec(n)?.[1];
    return round === void 0 ? [] : [Number(round)];
  }).sort((a, b) => a - b);
}
function writeReviewRound(integrationDir, record2) {
  for (let round = (reviewRounds(integrationDir).at(-1) ?? 0) + 1; ; round++) {
    const numbered = { ...record2, round };
    if (createExclusive(reviewRoundPath(integrationDir, round), JSON.stringify(numbered, null, 2) + "\n")) return numbered;
  }
}
function keepOtherLenses(previous, current, ran) {
  if (previous === null || previous.headSha !== current.headSha) return current;
  const rerun = new Set(ran);
  const fresh2 = new Map(current.lenses.map((l) => [l.lens, l]));
  const lenses2 = [];
  for (const entry of previous.lenses) {
    if (!rerun.has(entry.lens)) lenses2.push({ ...entry });
    else {
      const now = fresh2.get(entry.lens);
      if (now !== void 0 && !lenses2.includes(now)) lenses2.push(now);
    }
  }
  for (const entry of current.lenses) if (!lenses2.includes(entry)) lenses2.push(entry);
  const order = new Map(lenses2.map((l, i) => [l.lens, i]));
  const byLens = (items) => items.map((item, i) => ({ item, i })).sort((a, b) => (order.get(a.item.lens) ?? order.size) - (order.get(b.item.lens) ?? order.size) || a.i - b.i).map((x) => x.item);
  const kept = (items) => items.filter((x) => !rerun.has(x.lens)).map((x) => ({ ...x }));
  return {
    ...current,
    lenses: lenses2,
    skeptics: byLens([...kept(previous.skeptics), ...current.skeptics]),
    findings: byLens([...kept(previous.findings), ...current.findings])
  };
}

// src/review/lanes.ts
import { isAbsolute as isAbsolute10, relative as relative8, sep as sep8 } from "node:path";
var MAX_LANE_NAME = 48;
var MAX_FINDINGS = 10;
var REF = /^[A-Za-z0-9._/@^~{}-]+$/;
function reviewLaneFiles(paths, lane) {
  const name2 = assertValidName(lane, "lane name");
  const rel = relative8(paths.projectRoot, paths.lanesDir);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep8}`) || isAbsolute10(rel)) {
    throw new ArbabError("usage", `the lanes directory ${paths.lanesDir} is not inside the project ${paths.projectRoot}`);
  }
  const dir = rel.split(sep8).join("/");
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
  return text2.trim().split(/\r?\n/).map((line2) => line2 === "" ? ">" : `> ${line2}`).join("\n");
}
function reviewLane(input) {
  const name2 = input.paths.name;
  const lane = laneName(name2, "review", input.lens);
  const base = checkRef(input.diffBase, "diff base");
  if (input.text.trim() === "") throw new ArbabError("usage", `lens ${input.lens} has no text`);
  const start = startFields(input);
  const range2 = `${base}..HEAD`;
  const since = input.since === true ? `

The branch's earlier commits were reviewed in an earlier round: this round covers only what changed since
\`${base}\`.` : "";
  const brief = `# Review ${name2}: ${input.lens}

## Task

Review the change on this branch through the **${input.lens}** lens. Run \`git diff ${range2}\` to see the change, and
\`git diff --stat ${range2}\` for the files it touches.${since}

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
  const names2 = Object.keys(BUILTIN_LENSES);
  for (const name2 of Object.keys(configLenses)) if (!names2.includes(name2)) names2.push(name2);
  return names2;
}
function lensText(lens, configLenses) {
  if (Object.hasOwn(configLenses, lens)) return configLenses[lens] ?? null;
  return Object.hasOwn(BUILTIN_LENSES, lens) ? BUILTIN_LENSES[lens] ?? null : null;
}
var MAX_LENS_FILE_TEXT = 8e3;
function parseLensFileOption(option) {
  const at = option.indexOf("=");
  if (at <= 0 || at === option.length - 1) {
    throw new ArbabError("usage", `--lens-file ${JSON.stringify(option)} must be <name>=<file>`);
  }
  return { name: assertValidName(option.slice(0, at), "lens"), file: option.slice(at + 1) };
}
function lensFileText(name2, text2) {
  const trimmed = text2.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LENS_FILE_TEXT) {
    throw new ArbabError("usage", `the file of lens ${name2} has ${trimmed.length} characters; a lens text has 1 to ${MAX_LENS_FILE_TEXT}`);
  }
  return trimmed;
}

// src/commands/records.ts
var isObject5 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var isString = (v) => typeof v === "string";
var isStringOrNull = (v) => v === null || typeof v === "string";
var isNumberOrNull = (v) => v === null || Number.isFinite(v);
var listOf = (v, item) => Array.isArray(v) && v.every(item);
function read(path, name2, what, valid) {
  const raw = readJson(path);
  if (raw === null) return null;
  if (!isObject5(raw) || raw["name"] !== name2 || !valid(raw)) {
    throw new ArbabError("io", `${path} is not a ${what} for ${name2}`);
  }
  return raw;
}
var isGateResult2 = (v) => isObject5(v) && (v["kind"] === "gate" || v["kind"] === "smoke") && listOf(v["argv"], isString) && isString(v["command"]) && isNumberOrNull(v["exitCode"]);
function readVerifyRecord(path, name2) {
  return read(
    path,
    name2,
    "verify record",
    (v) => isString(v["lane"]) && isNumberOrNull(v["attempt"]) && isString(v["headSha"]) && listOf(v["results"], isGateResult2) && typeof v["passed"] === "boolean" && (v["reason"] === void 0 || isString(v["reason"])) && isString(v["finishedAt"])
  );
}
var SEVERITIES2 = ["HIGH", "MEDIUM", "LOW"];
var VERDICTS = ["confirmed", "refuted", "unverified"];
var isFinding = (v) => isObject5(v) && isString(v["id"]) && isString(v["lens"]) && isString(v["title"]) && SEVERITIES2.includes(v["severity"]) && isString(v["file"]) && (v["line"] === void 0 || Number.isInteger(v["line"])) && isString(v["failureScenario"]) && isString(v["evidence"]) && VERDICTS.includes(v["verdict"]);
var isLensEntry = (v) => isObject5(v) && isString(v["lens"]) && isString(v["lane"]) && isStringOrNull(v["endState"]) && isStringOrNull(v["coverage"]) && Number.isInteger(v["pathsChecked"]);
var isSkepticEntry = (v) => isObject5(v) && isString(v["lens"]) && isString(v["lane"]) && isStringOrNull(v["endState"]);
function readReviewRecord(path, name2) {
  return read(
    path,
    name2,
    "review record",
    (v) => isString(v["headSha"]) && listOf(v["lenses"], isLensEntry) && listOf(v["skeptics"], isSkepticEntry) && listOf(v["findings"], isFinding) && isString(v["finishedAt"]) && (v["round"] === void 0 || Number.isInteger(v["round"]) && v["round"] >= 1) && (v["since"] === void 0 || isStringOrNull(v["since"]))
  );
}
var isItem = (v) => isObject5(v) && isString(v["id"]) && isString(v["text"]);
function readReadinessReport(path, name2) {
  return read(
    path,
    name2,
    "readiness report",
    (v) => TIERS.includes(v["tier"]) && isString(v["headSha"]) && listOf(v["verified"], isItem) && listOf(v["skipped"], (s) => isItem(s) && typeof s["waived"] === "boolean") && listOf(v["risks"], isItem) && typeof v["ready"] === "boolean" && isString(v["createdAt"])
  );
}

// src/commands/land.ts
var refuse = (message5) => new ArbabError("usage", `not landed: ${message5}`);
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
function porcelainEntries(out) {
  const tokens = out.split("\0");
  const entries3 = [];
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i] ?? "";
    if (entry.length < 4) continue;
    entries3.push(entry);
    if (/[RC]/.test(entry.slice(0, 2))) i++;
  }
  return entries3;
}
var firstFive = (items, sep11) => items.slice(0, 5).join(sep11) + (items.length > 5 ? `${sep11}and ${items.length - 5} more` : "");
function assertCleanBase(git, root, base, head) {
  const r = git(["symbolic-ref", "--quiet", "--short", "HEAD"], root);
  const branch = r.code === 0 ? r.stdout.trim() : null;
  if (branch !== base) throw refuse(`the main checkout ${root} is on ${branch ?? "a detached HEAD"}, not ${base}`);
  const status = porcelainEntries(gitOut(git, ["status", "--porcelain", "-z", "--untracked-files=normal"], root));
  const tracked = status.filter((e) => !e.startsWith("?? "));
  if (tracked.length > 0) throw refuse(`the main checkout ${root} has uncommitted changes (${firstFive(tracked, "; ")})`);
  const untracked = status.map((e) => e.slice(3));
  if (untracked.length === 0) return [];
  const written = gitOut(git, ["diff", "--name-only", "-z", "--no-renames", "--no-ext-diff", "HEAD", head, "--"], root).split("\0").filter((p) => p !== "");
  const collides = (u) => written.some((p) => u.endsWith("/") ? p.startsWith(u) : p === u || p.startsWith(`${u}/`));
  const blocking = untracked.filter(collides);
  if (blocking.length > 0) {
    throw refuse(`the main checkout ${root} has untracked files where the merge writes (${firstFive(blocking, "; ")}); move them away and land again`);
  }
  return untracked;
}
var isEnvFile = (path) => basename4(path).toLowerCase().startsWith(".env");
function readMessage(root, file) {
  let path;
  try {
    path = confine(root, file);
  } catch {
    throw refuse(`the --message file ${file} is outside the project ${resolve14(root)}`);
  }
  if (isEnvFile(path)) throw refuse(`the --message file ${path} is a .env file, which may hold credentials`);
  let text2;
  try {
    const real2 = realpathSync9(path);
    try {
      confine(realpathSync9(root), real2);
    } catch {
      throw refuse(`the --message file ${path} resolves outside the project`);
    }
    if (isEnvFile(real2)) throw refuse(`the --message file ${path} resolves to a .env file, which may hold credentials`);
    text2 = readFileSync6(real2, "utf8");
  } catch (err) {
    if (err instanceof ArbabError) throw err;
    throw refuse(`cannot read the --message file ${path}: ${err.message}`);
  }
  if (text2.trim() === "") throw refuse(`the --message file ${path} is empty`);
  return text2;
}
function assertBaseInHead(git, root, base, head, name2, worktree) {
  const r = git(["merge-base", "--is-ancestor", "HEAD", head], root);
  if (r.code === 0) return;
  if (r.code !== 1) throw new ArbabError("git", `git merge-base --is-ancestor HEAD ${head} failed (${r.code}): ${(r.stderr || r.stdout).trim()}`);
  throw refuse(
    `${base} moved since the integration was verified: its HEAD is not in ${head}, so the merge would hold a tree nobody verified. Merge ${base} into integrate/${name2} with hooks off: git -C ${worktree} ${untrustedTree().join(" ")} merge --no-verify --no-edit ${base}; then arbab integrate ${name2} --refresh to record the new head, and verify, review and readiness for ${name2} again`
  );
}
var notBefore = (later, earlier) => Date.parse(later) >= Date.parse(earlier);
function assertReadinessCurrent(readiness, verify, review, name2) {
  for (const [what, record2, at, heads] of [
    ["verify", verify, verify?.finishedAt, [readiness.headSha]],
    ["review", review, review?.finishedAt, [readiness.headSha, readiness.reviewCarriedOverFrom]]
  ]) {
    if (record2 === null || at === void 0 || !heads.includes(record2.headSha)) continue;
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
    options: { "keep-worktrees": { type: "boolean" }, squash: { type: "boolean" }, message: { type: "string" }, json: { type: "boolean" } },
    allowPositionals: true
  });
  const name2 = assertValidName(onePositional("land", positionals, "name"), "integration");
  const project = openProject(ctx);
  const message5 = values.message === void 0 ? `Land ${name2}` : readMessage(project.root, values.message);
  const squash = values.squash ?? project.config.landing.squash;
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
  const leftAlone = assertCleanBase(ctx.git, project.root, base, head);
  if (ctx.git(["merge-base", "--is-ancestor", head, "HEAD"], project.root).code === 0) throw refuse(`${head} is already in ${base}`);
  if (existsSync16(paths.landing)) throw refuse(`${name2} already landed (${paths.landing})`);
  const branchAt = branchHead(ctx.git, project.root, paths.branch);
  if (branchAt !== head) throw refuse(`${paths.branch} is at ${branchAt ?? "no commit"}, not the verified head ${head}`);
  assertBaseInHead(ctx.git, project.root, base, head, name2, paths.worktree);
  if (squash) squashLand(ctx, project.root, head, message5, `squashing ${paths.branch} into ${base}`);
  else {
    const merge = ctx.git([...untrustedTree(), "merge", "--no-ff", "--no-edit", "-m", message5, head], project.root);
    if (merge.code !== 0) {
      ctx.git([...untrustedTree(), "merge", "--abort"], project.root);
      throw new ArbabError("git", `merging ${paths.branch} into ${base} failed (${merge.code}): ${(merge.stderr || merge.stdout).trim()}; the merge was aborted`);
    }
  }
  const mergeSha = gitOut(ctx.git, ["rev-parse", "HEAD"], project.root).trim();
  const landing = {
    name: name2,
    into: base,
    integrationHead: head,
    mergeSha,
    landedAt: isoAt(ctx.clock),
    pushed: false,
    squash,
    lanes: record2.merged.map((m) => ({ lane: m.lane, sha: m.sha }))
  };
  writeJsonAtomic(paths.landing, landing);
  const cleanup = values["keep-worktrees"] === true ? null : cleanUpLanded(ctx, project, { paths, record: record2 }, landing);
  const remote = firstRemote(ctx.git, project.root);
  if (values.json === true) {
    printJson(ctx, { landing, remote, push: remote === null ? null : ["git", "push", remote, base], cleanup, leftAlone });
  } else {
    ctx.stdout(`landed ${name2}: ${head} into ${base} as ${mergeSha}
`);
    ctx.stdout(`Not pushed. To publish: git push ${remote ?? "<remote>"} ${base}${remote === null ? " (no remote configured)" : ""}
`);
    if (leftAlone.length > 0) ctx.stdout(`left alone: ${firstFive(leftAlone, ", ")}
`);
    for (const line2 of cleanup === null ? [] : formatWorktreeCleanup(cleanup)) ctx.stdout(line2 + "\n");
  }
  return 0;
}
function squashLand(ctx, root, head, message5, what) {
  const fail2 = (r) => {
    ctx.git([...untrustedTree(), "reset", "--merge"], root);
    return new ArbabError("git", `${what} failed (${r.code}): ${(r.stderr || r.stdout).trim()}; the squash was reset`);
  };
  const staged = ctx.git([...untrustedTree(), "merge", "--squash", head], root);
  if (staged.code !== 0) throw fail2(staged);
  const commit = ctx.git([...untrustedTree(), "commit", "--no-verify", "--allow-empty", "-m", message5], root);
  if (commit.code !== 0) throw fail2(commit);
}
function cleanUpLanded(ctx, project, integration, landing) {
  const { paths, record: record2 } = integration;
  const out = emptyWorktreeCleanup();
  try {
    const generated = lanesGeneratedBy(project.runsRoot, paths.name);
    const lanes = [...record2.merged.map((m) => m.lane), ...generated];
    const landed = landing?.squash === true ? landing.integrationHead : record2.base;
    removeLaneWorktrees(ctx, project, lanes, landed, out);
    removeIntegrationWorktree(ctx, project, paths, landed, out);
    if (landing?.squash === true) deleteSquashedBranches(ctx, project.root, [...generated.map((g) => `arbab/${g}`), paths.branch], landing.integrationHead, out);
  } catch (err) {
    out.warnings.push(err.message);
  }
  return out;
}
function deleteSquashedBranches(ctx, root, branches, landedHead, out) {
  const listed = ctx.git(["worktree", "list", "--porcelain"], root);
  if (listed.code !== 0) return;
  const checkedOut = new Set(listed.stdout.split("\n").filter((l) => l.startsWith("branch ")).map((l) => l.slice("branch ".length)));
  for (const kept of [...out.branchesKept]) {
    if (!branches.includes(kept.branch) || !kept.reason.startsWith("git branch -d failed")) continue;
    const ref2 = `refs/heads/${kept.branch}`;
    const sha = branchHead(ctx.git, root, kept.branch);
    if (sha === null || checkedOut.has(ref2)) continue;
    if (ctx.git(["merge-base", "--is-ancestor", sha, landedHead], root).code !== 0) continue;
    if (ctx.git([...untrustedTree(), "update-ref", "-d", ref2, sha], root).code !== 0) continue;
    out.branchesKept.splice(out.branchesKept.indexOf(kept), 1);
    out.branchesDeleted.push(kept.branch);
  }
}

// src/commands/plan.ts
import { join as join34 } from "node:path";
var phaseNames = (plan) => [...new Set(plan.phases.map((p) => p.name))];
var plansDir = (project, plan) => join34(project.root, ".arbab", "plans", assertValidName(plan, "plan"));
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
async function planNext(ctx, project, planPath, opts = {}) {
  const check2 = checkPlanFile(ctx, project, planPath);
  const plan = check2.plan;
  if (planHasErrors(check2)) {
    for (const issue of check2.issues) ctx.stderr(formatIssue(issue) + "\n");
    for (const p of check2.phases) for (const issue of p.issues) ctx.stderr(`${p.phase}: ${formatIssue(issue)}
`);
    throw new ArbabError("lint", `${planSummary(check2)}; nothing launched`);
  }
  const states = phaseStates(project, plan, ctx.alive);
  if (opts.retry !== void 0) {
    const refusal = retryRefusal(plan, states, opts.retry);
    if (refusal !== null) throw new ArbabError("usage", `cannot retry: ${refusal}; nothing launched`);
  }
  const out = { plan: plan.name, launched: [], blocked: [], failed: [], errors: [], warnings: [], code: 0 };
  let prepared = false;
  const launch = async (phase, onlyNew) => {
    if (!prepared) {
      ensureIgnored(project.root, arbabIgnoreEntries(project.root, project.config), ctx.git);
      ensureArbabMarkers(project.root);
      prepared = true;
    }
    const lane = check2.phases.find((p) => p.phase === phase)?.lane ?? compilePhase(plan, phase);
    const laneFile = join34(plansDir(project, plan.name), `${phase}.json`);
    try {
      writeJsonAtomic(laneFile, lane);
      const launched = await launchLane(ctx, project, laneFile, { onlyNew });
      out.launched.push({ phase, laneFile, runDir: launched.runDir, shepherdPid: launched.shepherdPid });
      for (const issue of launched.warnings) out.warnings.push({ phase, issue });
      return true;
    } catch (err) {
      out.errors.push({ phase, message: err instanceof Error ? err.message : String(err) });
      out.code = Math.max(out.code, exitCodeFor(err));
      return false;
    }
  };
  if (opts.retry !== void 0 && await launch(opts.retry, false)) states[opts.retry] = { state: "queued", endState: null, exit: null };
  const next = nextPhases(plan, states);
  out.blocked = next.blocked;
  out.failed = next.failed;
  for (const phase of next.launch) await launch(phase, true);
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
  const { values, positionals } = parse("plan next", {
    args: argv2,
    options: { json: { type: "boolean" }, retry: { type: "string" } },
    allowPositionals: true
  });
  const planPath = onePositional("plan next", positionals, "plan.json");
  const next = await planNext(ctx, openProject(ctx), planPath, values.retry === void 0 ? {} : { retry: values.retry });
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
  if (command === void 0) throw new ArbabError("usage", "usage: arbab plan check|next|status <plan.json> [--json] (next also takes --retry <phase>)");
  return command(rest, ctx);
}

// src/quota/quota.ts
import { existsSync as existsSync17, rmSync as rmSync8 } from "node:fs";
import { join as join35 } from "node:path";
var quotaPath = (home) => join35(home, "quota.json");
var resetFile = (home) => join35(home, "quota-reset.json");
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
  const existed = existsSync17(path);
  try {
    rmSync8(path, { force: true });
  } catch (err) {
    throw new ArbabError("io", `cannot remove ${path}: ${err.message}`, { cause: err });
  }
  writeJsonAtomic(resetFile(home), { resetAt: isoAt(clock) });
  return existed;
}
function replaceQuota(home, snapshot, clock) {
  if (!isSnapshot(snapshot)) throw new ArbabError("usage", "invalid rate-limit snapshot");
  writeJsonAtomic(quotaPath(home), snapshot);
  writeJsonAtomic(resetFile(home), { resetAt: isoAt(clock) });
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

// src/quota/refresh.ts
import { mkdtempSync, rmSync as rmSync9 } from "node:fs";
import { join as join36 } from "node:path";
var REFRESH_PROMPT = "Reply with the single word: ok";
var REFRESH_TIMEOUT_MS = 6e4;
var STDERR_TAIL_LINES = 5;
var STDERR_KEEP_CHARS = 16384;
var TAIL_LINE_CHARS = 500;
function refreshArgs() {
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    "haiku",
    "--max-turns",
    "1",
    "--tools",
    "",
    // The same empty source list as a worker's: no user, project or local settings.
    "--setting-sources",
    "",
    "--strict-mcp-config"
  ];
}
function makeRefreshSpawn(spawnImpl, graceMs = 2e3) {
  return (binary, args, opts) => new Promise((resolve18) => {
    const out = [];
    let err = "";
    let timedOut = false;
    let exit = null;
    const timers = [];
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      for (const t of timers) clearTimeout(t);
      resolve18({ code: exit?.code ?? null, signal: exit?.signal ?? null, timedOut, stdout: Buffer.concat(out).toString("utf8"), stderr: err });
    };
    let child2;
    try {
      child2 = spawnImpl(binary, args, { cwd: opts.cwd, env: opts.env, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      err = `cannot start ${binary}: ${e.message}`;
      finish();
      return;
    }
    const kill = (sig) => {
      try {
        child2.kill(sig);
      } catch {
      }
    };
    child2.stdout?.on("data", (chunk) => out.push(chunk));
    child2.stderr?.on("data", (chunk) => {
      err = (err + chunk.toString("utf8")).slice(-STDERR_KEEP_CHARS);
    });
    child2.once("error", (e) => {
      err += `${err === "" || err.endsWith("\n") ? "" : "\n"}${e.message}
`;
      if (child2.pid === void 0) finish();
    });
    child2.once("exit", (code4, signal) => {
      exit = { code: code4, signal };
      if (!timedOut) for (const t of timers.splice(0)) clearTimeout(t);
      timers.push(setTimeout(finish, graceMs));
    });
    child2.once("close", finish);
    timers.push(
      setTimeout(() => {
        timedOut = true;
        kill("SIGTERM");
        timers.push(
          setTimeout(() => {
            kill("SIGKILL");
            timers.push(setTimeout(finish, graceMs));
          }, graceMs)
        );
      }, opts.timeoutMs)
    );
    child2.stdin?.on("error", () => void 0);
    child2.stdin?.end(opts.input);
  });
}
function stderrTail(stderr) {
  return stderr.split("\n").map((line2) => line2.trimEnd()).filter((line2) => line2.trim() !== "").slice(-STDERR_TAIL_LINES).map((line2) => line2.length > TAIL_LINE_CHARS ? `${line2.slice(0, TAIL_LINE_CHARS)}\u2026` : line2);
}
async function refreshQuota(input) {
  const timeoutMs = input.timeoutMs ?? REFRESH_TIMEOUT_MS;
  const tmpRoot = join36(input.home, "tmp");
  let cwd;
  try {
    ensureDir(tmpRoot);
    cwd = mkdtempSync(join36(tmpRoot, "quota-refresh-"));
  } catch (err) {
    throw new ArbabError("io", `cannot create a working directory under ${tmpRoot}: ${err.message}`, { cause: err });
  }
  let run;
  try {
    run = await input.spawn(input.binary, refreshArgs(), { cwd, env: input.env, input: REFRESH_PROMPT, timeoutMs });
  } finally {
    rmSync9(cwd, { recursive: true, force: true });
  }
  const fail2 = (what) => {
    const tail = stderrTail(run.stderr);
    const lines = tail.length === 0 ? ["  (stderr empty)"] : tail.map((line2) => `  ${line2}`);
    return new ArbabError("runtime", [`refresh failed: ${what}; ${quotaPath(input.home)} is unchanged`, "stderr:", ...lines].join("\n"));
  };
  if (run.timedOut) throw fail2(`claude did not finish within ${Math.round(timeoutMs / 1e3)} s`);
  if (run.code !== 0) throw fail2(`claude exited with ${run.code === null ? `signal ${run.signal ?? "unknown"}` : `code ${run.code}`}`);
  const parsed2 = parseStream(run.stdout);
  const snapshot = digestStream(parsed2.events, isoAt(input.clock), parsed2.unparsedLines).rateLimit;
  if (snapshot === null) throw fail2("claude's stream had no rate_limit_event");
  replaceQuota(input.home, snapshot, input.clock);
  return snapshot;
}

// src/commands/quota.ts
function formatHold(hold) {
  if (!hold.hold) return "hold: no";
  const until = hold.until === null ? "" : ` (until ${new Date(hold.until * 1e3).toISOString()})`;
  return `hold: yes \u2014 ${hold.reason ?? "unknown"}${until}`;
}
async function refresh(ctx, config, spawn4) {
  const deps = ctx.shepherdDeps();
  const binary = resolveBinary({
    pinned: null,
    explicitPath: deps.explicitClaude,
    pathEnv: deps.pathEnv,
    minVersion: config.minClaudeVersion,
    run: deps.run,
    exists: deps.exists,
    realpath: deps.realpath
  });
  const env2 = workerEnv(deps.hostEnv, {
    passEnv: [],
    extra: {},
    nodeDir: deps.nodeDir,
    ...deps.pnpmDir === void 0 ? {} : { pnpmDir: deps.pnpmDir }
  });
  return refreshQuota({ home: ctx.home, binary: binary.path, env: env2, clock: ctx.clock, spawn: spawn4 ?? makeRefreshSpawn(deps.spawnImpl) });
}
async function runQuota(argv2, ctx, spawn4) {
  const { values } = parse("quota", {
    args: argv2,
    options: { reset: { type: "boolean" }, refresh: { type: "boolean" }, json: { type: "boolean" } },
    allowPositionals: false
  });
  if (values.reset === true && values.refresh === true) {
    throw new ArbabError("usage", "quota takes --reset or --refresh, not both: --refresh already replaces the snapshot");
  }
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
  const snapshot = values.refresh === true ? await refresh(ctx, config, spawn4) : readQuota(ctx.home);
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

// src/commands/readiness.ts
import { join as join37 } from "node:path";

// src/readiness/notes.ts
var FENCE_KINDS = [
  ["database", /\bno database\b/i],
  ["browser", /\bbrowsers?\b/i],
  ["network", /\bnetwork\b/i],
  ["sandbox", /\bsandbox|\bEPERM\b|\bcannot run\b|\bnot permitted\b/i]
];
var MAX_EXAMPLES = 3;
var EXAMPLE_CHARS = 100;
function fenceKind(text2) {
  return FENCE_KINDS.find(([, pattern]) => pattern.test(text2))?.[0] ?? null;
}
function noteKey(text2) {
  return text2.trim().toLowerCase().replace(/\d+/g, "N").replace(/\s+/g, " ");
}
function flat(text2) {
  return text2.trim().replace(/\s+/g, " ");
}
function example(note) {
  const text2 = flat(note.text);
  return `${note.lane}: ${text2.length > EXAMPLE_CHARS ? `${text2.slice(0, EXAMPLE_CHARS - 1)}\u2026` : text2}`;
}
function groupLaneNotes(entries3) {
  const fence2 = /* @__PURE__ */ new Map();
  const lanesOf = /* @__PURE__ */ new Map();
  for (const entry of entries3) {
    if (!("note" in entry)) continue;
    const kind = fenceKind(entry.note.text);
    if (kind !== null) {
      fence2.set(kind, [...fence2.get(kind) ?? [], entry.note]);
      continue;
    }
    const key = noteKey(entry.note.text);
    lanesOf.set(key, (lanesOf.get(key) ?? /* @__PURE__ */ new Set()).add(entry.note.lane));
  }
  const out = [];
  const emitted = /* @__PURE__ */ new Set();
  for (const entry of entries3) {
    if (!("note" in entry)) {
      out.push(entry.risk);
      continue;
    }
    const { note } = entry;
    const kind = fenceKind(note.text);
    if (kind !== null) {
      if (emitted.has(`fence:${kind}`)) continue;
      emitted.add(`fence:${kind}`);
      const notes = fence2.get(kind) ?? [note];
      const examples = [...new Set(notes.map(example))].slice(0, MAX_EXAMPLES);
      out.push({
        id: `fence:${kind}`,
        text: `Not run inside the fence (${notes.length} ${notes.length === 1 ? "note" : "notes"}): ${examples.join("; ")}`
      });
      continue;
    }
    const key = noteKey(note.text);
    const lanes = lanesOf.get(key)?.size ?? 1;
    if (lanes < 2) {
      out.push({ id: note.id, text: `${note.lane} (${note.label}): ${note.text}` });
      continue;
    }
    if (emitted.has(`notes:${key}`)) continue;
    emitted.add(`notes:${key}`);
    out.push({ id: `notes:${note.id}`, text: `${lanes} lanes: ${flat(note.text)}` });
  }
  return out;
}
function uniqueTexts(items) {
  const seen = /* @__PURE__ */ new Set();
  return items.filter((item) => {
    if (seen.has(item.text)) return false;
    seen.add(item.text);
    return true;
  });
}

// src/readiness/carry.ts
var SHA6 = /^[0-9a-f]{40,64}$/;
function line(git, args, cwd) {
  const r = git([...untrustedTree(), ...args], cwd);
  return r.code === 0 ? r.stdout.trim() : null;
}
function reviewCarriesOver(git, cwd, reviewed, head, baseBranch) {
  if (!SHA6.test(reviewed) || !SHA6.test(head) || reviewed === head || baseBranch.startsWith("-")) return false;
  const parents = line(git, ["rev-list", "--parents", "-n", "1", head], cwd)?.split(/\s+/);
  if (parents === void 0 || parents.length !== 3 || parents[0] !== head) return false;
  const [, first, second] = parents;
  if (first !== reviewed) return false;
  if (git(["merge-base", "--is-ancestor", second, baseBranch], cwd).code !== 0) return false;
  const merged = line(git, ["merge-tree", "--write-tree", first, second], cwd)?.split("\n")[0]?.trim();
  const tree = line(git, ["rev-parse", "--verify", "--quiet", `${head}^{tree}`], cwd);
  return merged !== void 0 && tree !== null && SHA6.test(tree) && merged === tree;
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
function laneEntries(lane, report) {
  if (typeof report !== "object" || report === null || Array.isArray(report)) {
    return [{ risk: { id: `report:${lane}`, text: `${lane}: the report is missing or not an object` } }];
  }
  const fields = report;
  const out = [];
  for (const [field, label] of [
    ["open_questions", "open question"],
    ["not_verified", "not verified"]
  ]) {
    const entries3 = stringList(fields[field]);
    if (entries3 === null) {
      out.push({ risk: { id: `report:${lane}:${field}`, text: `${lane}: the report's ${field} is not a list of strings` } });
      continue;
    }
    entries3.forEach((text2, index) => {
      out.push({ note: { id: `${field}:${lane}:${index + 1}`, lane, label, text: text2 } });
    });
  }
  return out;
}
var SEVERITY_ORDER = ["HIGH", "MEDIUM", "LOW"];
function roundsLine(rounds) {
  if (rounds.length === 0) return null;
  const parts = [...rounds].sort((a, b) => a.round - b.round).map(({ round, findings }) => {
    const standing = findings.filter((finding) => finding.verdict !== "refuted");
    const counts = SEVERITY_ORDER.map((severity2) => [severity2, standing.filter((f) => f.severity === severity2).length]).filter(([, n]) => n > 0).map(([severity2, n]) => `${n} ${severity2}`);
    return `${round}: ${counts.length === 0 ? "none" : counts.join(", ")}`;
  });
  return `review rounds: ${parts.join(" \xB7 ")}`;
}
function hostShortfall(gates, checks, head, name2) {
  const run = `run arbab host-check ${name2} in a terminal`;
  if (checks === null) return `the host gates have not run; ${run}`;
  if (checks.headSha !== head) return `the host gates ran on ${checks.headSha}, not on the head ${head}; ${run}`;
  const failing = gates.map((argv2) => {
    const command = commandLine(argv2);
    const result = checks.results.find((r) => r.command === command);
    return result === void 0 ? `${command} (not run)` : result.exitCode === 0 ? null : `${command} (${exitText(result.exitCode)})`;
  }).filter((text2) => text2 !== null);
  if (failing.length > 0) return `the host gates did not pass on the head: ${failing.join(", ")}`;
  if (!checks.passed) return "the host gates did not pass on the head";
  return null;
}
function computeReadiness(input) {
  const { integration, verify, review, tier: tier2 } = input;
  const head = integration.headSha;
  const currentVerify = verify !== null && verify.headSha === head ? verify : null;
  const carry = input.reviewCarryOver ?? null;
  const carriedFrom = review !== null && review.headSha !== head && carry !== null && carry.from === review.headSha ? review.headSha : null;
  const currentReview = review !== null && (review.headSha === head || carriedFrom !== null) ? review : null;
  const hostGates = input.hostGates ?? [];
  const hostChecks = input.hostChecks ?? null;
  const verified = [];
  const skipped = [];
  if (currentVerify !== null) {
    for (const result of currentVerify.results) {
      verified.push({ id: `verify:${result.command}`, text: `${result.kind}: ${exitText(result.exitCode)}` });
    }
  }
  const hostMissing = hostGates.length === 0 ? null : hostShortfall(hostGates, hostChecks, head, input.name);
  if (hostGates.length > 0 && hostMissing === null) {
    for (const argv2 of hostGates) verified.push({ id: `host:${commandLine(argv2)}`, text: "host gate: exit 0" });
  }
  if (carriedFrom !== null && carry !== null) {
    verified.push({
      id: "review-carried-over",
      text: `review carried over from ${carriedFrom.slice(0, 7)}: the head adds only a clean merge of ${carry.base}`
    });
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
  const rounds = roundsLine(input.reviewRounds ?? []);
  if (rounds !== null) verified.push({ id: "review-rounds", text: rounds });
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
  if (hostMissing !== null) skipped.push({ id: "host", text: hostMissing });
  const findings = review?.findings ?? [];
  const confirmed = findings.filter((finding) => finding.verdict === "confirmed").map((finding) => ({ id: `finding:${finding.id}`, text: findingText(finding) }));
  const unverified = findings.filter((finding) => isMediumPlus(finding) && finding.verdict === "unverified").map((finding) => ({ id: `finding:${finding.id}`, text: findingText(finding) }));
  const lowUnverified = findings.filter((finding) => finding.severity === "LOW" && finding.verdict === "unverified");
  if (lowUnverified.length > 0) {
    unverified.push({
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
  const notes = [];
  for (const lane of mergedLanes) {
    notes.push(...laneEntries(lane, reports.get(lane)));
    for (const borrower of borrowers.get(lane) ?? []) {
      if (reported.has(borrower.lane)) continue;
      reported.add(borrower.lane);
      notes.push(...laneEntries(borrower.lane, borrower.report));
    }
  }
  const manifestRisks = manifests.map(({ manifest, by }) => ({ id: `manifest:${manifest}`, text: `${manifest} changed by ${by}` }));
  const hostRisks = hostMissing === null ? [] : [{ id: "host-gates", text: hostMissing }];
  const stale = [];
  for (const [lens, why] of shortfalls) {
    if (!named.has(lens)) stale.push({ id: `lens:${lens}`, text: `the ${lens} lens does not count: ${why}` });
  }
  if (verify !== null && currentVerify === null) {
    stale.push({ id: "stale:verify", text: `verify (${verify.lane}) is stale: it ran on ${verify.headSha}, the head is ${head}` });
  }
  if (review !== null && currentReview === null) {
    stale.push({ id: "stale:review", text: `review is stale: it ran on ${review.headSha}, the head is ${head}` });
  }
  const waivers = unique(input.waivers.map((waiver) => waiver.trim()).filter((waiver) => waiver !== ""));
  const skippedIds = new Set(skipped.map((item) => item.id));
  for (const waiver of waivers) {
    if (!skippedIds.has(waiver)) stale.push({ id: `waiver:${waiver}`, text: `waiver ${waiver} matches no skipped item` });
  }
  const waived = new Set(waivers);
  const skippedOut = skipped.map((item) => ({ ...item, waived: waived.has(item.id) }));
  const risks = uniqueTexts([...confirmed, ...unverified, ...manifestRisks, ...hostRisks, ...stale, ...groupLaneNotes(notes)]);
  return {
    name: input.name,
    tier: tier2,
    headSha: head,
    verified,
    skipped: skippedOut,
    risks,
    ready: currentVerify !== null && currentVerify.passed && skippedOut.every((item) => item.waived),
    createdAt: input.now,
    ...carriedFrom !== null && { reviewCarriedOverFrom: carriedFrom }
  };
}
function inline(text2) {
  return text2.replace(/\s*[\r\n]+\s*/g, " ");
}
function code2(text2) {
  const flat2 = inline(text2);
  let longest = 0;
  for (const run of flat2.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
  const fence2 = "`".repeat(longest + 1);
  const pad = flat2.startsWith("`") || flat2.endsWith("`") ? " " : "";
  return `${fence2}${pad}${flat2}${pad}${fence2}`;
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
function reviewRounds2(integrationDir, name2) {
  let rounds;
  try {
    rounds = reviewRounds(integrationDir);
  } catch {
    return [];
  }
  return rounds.flatMap((round) => {
    try {
      const record2 = readReviewRecord(reviewRoundPath(integrationDir, round), name2);
      return record2 === null ? [] : [{ round, findings: record2.findings }];
    } catch {
      return [];
    }
  });
}
async function runReadiness(argv2, ctx) {
  const { values, positionals } = parse("readiness", {
    args: argv2,
    options: { tier: { type: "string" }, waive: { type: "string" }, json: { type: "boolean" } },
    allowPositionals: true
  });
  const name2 = assertValidName(onePositional("readiness", positionals, "name"), "integration");
  if (values.waive !== void 0 && !ctx.interactive) {
    throw new ArbabError(
      "usage",
      "--waive is the human's decision: run it yourself in a terminal, after reading what each skipped item leaves unchecked"
    );
  }
  const project = openProject(ctx);
  const tier2 = parseTier(values.tier, project.config.landing.tier);
  const { paths, record: record2 } = openIntegration(project, name2);
  const review = readReviewRecord(paths.review, name2);
  const base = record2.base;
  const carried = review !== null && review.headSha !== record2.headSha && reviewCarriesOver(ctx.git, project.root, review.headSha, record2.headSha, base);
  const report = computeReadiness({
    name: name2,
    tier: tier2,
    integration: record2,
    verify: readVerifyRecord(paths.verify, name2),
    review,
    laneReports: laneReports(project.runsRoot, [...new Set(record2.merged.map((m) => m.lane))]),
    configLenses: lensNames(project.config.review.lenses),
    smokeConfigured: project.config.verify.smoke !== null,
    waivers: values.waive === void 0 ? [] : splitList(values.waive),
    now: isoAt(ctx.clock),
    reviewCarryOver: carried && review !== null ? { from: review.headSha, base } : null,
    hostGates: project.config.hostGates,
    hostChecks: readHostCheckRecord(join37(paths.dir, HOST_CHECKS_FILE), name2),
    reviewRounds: reviewRounds2(paths.dir, name2)
  });
  const markdown = renderReadiness(report);
  writeJsonAtomic(paths.readiness, report);
  writeTextAtomic(paths.readinessMd, markdown);
  if (values.json === true) printJson(ctx, report);
  else ctx.stdout(markdown);
  return report.ready ? 0 : 1;
}

// src/summary/advice.ts
var ATTENTION_END_STATES = /* @__PURE__ */ new Set([
  "failed",
  "invalid-report",
  "no-result",
  "budget",
  "max-turns",
  "unsupported-cli"
]);
function needsAttention(endState) {
  if (endState === null) return false;
  return ATTENTION_END_STATES.has(endState) || endState.startsWith("killed:");
}
var ADVICE = {
  "killed:wall": "ran past wallMin: read the last events; split the task or name the timeout, then relaunch or resume",
  "killed:idle": "no stream growth for idleMin (often a foreground server or watcher): fix the brief, then resume or relaunch",
  "killed:hang-after-result": "the work ended but the process hung: read report.json as for success; check the reaped pids in exit.json",
  "killed:hang-after-error": "treat as the error it followed: read stderr.log and the last result",
  "killed:stopped": "stopped by arbab stop: resume or relaunch when you have the correction",
  "no-result": "crashed before a result: read stderr.log and exit.json, then decide as for failed",
  "unsupported-cli": "the claude binary is too old for the model: run arbab doctor, upgrade or pin it, then relaunch",
  budget: "spent budgetUsd: check the report and checkpoint, split or decide more, then resume or relaunch",
  "max-turns": "hit the turn cap: check the report and checkpoint, split or decide more, then resume or relaunch",
  "invalid-report": "the report is not usable: check the diff and reportErrors in summary.json; resume asking only for the report",
  failed: "read the report, stderr.log and the last events; then arbab resume <lane> --prompt <file>, arbab resume <lane> --digest, or relaunch with a corrected brief",
  orphaned: "the shepherd died before finishing: arbab cleanup, then decide as for failed"
};
function adviceFor(state) {
  return Object.hasOwn(ADVICE, state) ? ADVICE[state] : "see references/end-states.md";
}

// src/summary/integrations.ts
import { existsSync as existsSync18 } from "node:fs";
var SHORT_SHA = 7;
var short = (sha) => sha.slice(0, SHORT_SHA);
function integrationLine(projectRoot, config, name2) {
  const paths = integrationPaths(projectRoot, config, name2);
  const record2 = readIntegration(paths);
  if (record2 === null) return null;
  const head = record2.headSha;
  const verify = readVerifyRecord(paths.verify, name2);
  const review = readReviewRecord(paths.review, name2);
  const readiness = readReadinessReport(paths.readiness, name2);
  const readinessOnHead = readiness !== null && readiness.headSha === head ? readiness : null;
  const verified = verify !== null && verify.headSha === head && verify.passed;
  const reviewed = review !== null && (review.headSha === head || readinessOnHead?.reviewCarriedOverFrom === review.headSha);
  const ready = readinessOnHead?.ready === true;
  const landed = existsSync18(paths.landing);
  const stage = landed ? "landed" : ready ? "ready" : reviewed ? "reviewed" : verified ? "verified" : "integrated";
  const waitsFor = [];
  if (!landed) {
    if (!record2.depsConfirmed) waitsFor.push(`dependencies to confirm: ${confirmCommand(name2, head)}`);
    if (verify === null) waitsFor.push("verify has not run");
    else if (verify.headSha !== head) waitsFor.push(`verify is stale (ran on ${short(verify.headSha)})`);
    else if (!verify.passed) waitsFor.push(`verify failed${verify.reason === void 0 ? "" : `: ${verify.reason}`}`);
    if (review === null) waitsFor.push("review missing");
    else if (!reviewed) waitsFor.push(`review is stale (ran on ${short(review.headSha)})`);
    if (readinessOnHead === null) waitsFor.push(readiness === null ? "readiness has not run" : "readiness is stale");
    else {
      const open2 = readinessOnHead.skipped.filter((s) => !s.waived).map((s) => s.id);
      if (open2.length > 0) waitsFor.push(`readiness skipped, not waived: ${open2.join(", ")}`);
    }
    if (ready) waitsFor.push("ready: ask the human to land");
  }
  return { name: name2, stage, head, waitsFor };
}
function integrationOverview(projectRoot, config) {
  const integrations = [];
  const errors = [];
  for (const name2 of listIntegrations(projectRoot)) {
    try {
      const line2 = integrationLine(projectRoot, config, name2);
      if (line2 !== null) integrations.push(line2);
    } catch (err) {
      errors.push(`integration ${name2}: ${err.message}`);
    }
  }
  return { integrations, errors };
}

// src/summary/format.ts
var NONE2 = "-";
var INDENT = "  ";
function table2(rows) {
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length))) ?? [];
  return rows.map((r) => r.map((cell2, i) => i === r.length - 1 ? cell2 : cell2.padEnd(widths[i] ?? 0)).join("  ").trimEnd());
}
function formatCounts(counts) {
  const parts = [];
  const s = counts.byState;
  for (const state of ["running", "held", "preparing", "waiting-reset", "queued"]) {
    if (s[state] > 0) parts.push(`${s[state]} ${state}`);
  }
  const finished = Object.entries(counts.finished).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const total = finished.reduce((n, [, c]) => n + c, 0);
  if (total > 0) parts.push(`${total} finished (${finished.map(([end, c]) => `${c} ${end}`).join(", ")})`);
  if (s.orphaned > 0) parts.push(`${s.orphaned} orphaned`);
  return parts.join(" \xB7 ");
}
function phaseText(p) {
  return p.status === "failed" && p.endState !== null ? `failed (${p.endState})` : p.status;
}
var isoAt2 = (sec) => new Date(sec * 1e3).toISOString().replace(/\.000Z$/, "Z");
function formatSummary(s, nowSec) {
  const out = [];
  const section2 = (title, lines) => {
    if (out.length > 0) out.push("");
    out.push(title, ...lines.map((l) => INDENT + l));
  };
  if (s.lanes.total > 0) {
    const lines = [formatCounts(s.lanes.counts)];
    if (s.lanes.active.length > 0) {
      lines.push(
        ...table2([
          ["LANE", "STATE", "ELAPSED", "ATTEMPT", "OWNER", "REASON"],
          ...s.lanes.active.map((l) => [
            l.lane,
            l.state,
            l.elapsedMs === null ? NONE2 : formatElapsed(l.elapsedMs),
            String(l.attempt),
            l.owner ?? NONE2,
            l.reason ?? NONE2
          ])
        ])
      );
    }
    section2(`Lanes (${s.lanes.total})`, lines);
  }
  if (s.plans.length > 0) {
    const lines = [];
    for (const plan of s.plans) {
      lines.push(`${plan.plan}:`);
      lines.push(...table2(plan.phases.map((p) => [phaseText(p), p.phase])).map((l) => INDENT + l));
    }
    lines.push("run `arbab plan status <plan file>` for the phases not launched yet");
    section2("Plans", lines);
  }
  if (s.integrations.length > 0) {
    section2(
      "Integrations",
      table2(
        s.integrations.map((i) => [
          i.name,
          i.stage,
          i.head.slice(0, SHORT_SHA),
          i.waitsFor.length > 0 ? `waits for: ${i.waitsFor.join("; ")}` : NONE2
        ])
      )
    );
  }
  if (s.attention.length > 0) {
    const lines = [];
    for (const a of s.attention) {
      lines.push(`${a.lane}: ${a.state} (attempt ${a.attempt})${a.reason === null ? "" : `: ${a.reason}`}`);
      lines.push(`${INDENT}${a.todo}`);
    }
    section2("Needs attention", lines);
  }
  const q = s.quota;
  const machine = q.slots.machineMaxParallel === null ? "" : `, machine cap ${q.slots.machineMaxParallel}`;
  section2("Quota and slots", [
    `quota: ${formatQuota(q.snapshot, nowSec)}`,
    q.hold.hold ? `hold: yes, ${q.hold.reason ?? "quota"}${q.hold.until === null ? "" : ` (until ${isoAt2(q.hold.until)})`}` : "hold: no",
    `slots: ${q.slots.inUse.length} in use machine-wide of ${q.slots.cap} (maxParallel ${q.slots.projectMaxParallel}${machine})`
  ]);
  if (s.errors.length > 0) section2("Unreadable records", s.errors);
  return out.join("\n");
}

// src/summary/lanes.ts
import { existsSync as existsSync19 } from "node:fs";
var OWNER_CHARS = 8;
var emptyCounts = () => ({
  byState: { running: 0, held: 0, preparing: 0, "waiting-reset": 0, queued: 0, orphaned: 0 },
  finished: {}
});
function attemptSummary(runsRoot, lane, attempt) {
  if (attempt < 1) return null;
  const dir = runPaths(runsRoot, lane).attemptDir(attempt);
  return existsSync19(dir) ? readAttempt(dir).summary : null;
}
function laneOverview(runsRoot, alive, nowMs) {
  const out = { total: 0, counts: emptyCounts(), active: [], attention: [], errors: [] };
  for (const lane of listLanes(runsRoot)) {
    try {
      const record2 = readState(runsRoot, lane);
      if (record2 === null) continue;
      const state = effectiveState(record2, alive);
      const summary = attemptSummary(runsRoot, lane, record2.attempt);
      const reason = record2.reason ?? null;
      out.total++;
      if (state === "finished") {
        const end = record2.endState ?? summary?.state ?? null;
        const key = end ?? "unknown";
        out.counts.finished[key] = (out.counts.finished[key] ?? 0) + 1;
        if (needsAttention(end)) {
          const endState = end;
          out.attention.push({ lane, state: endState, attempt: record2.attempt, reason, todo: adviceFor(endState) });
        }
        continue;
      }
      out.counts.byState[state]++;
      const owner = readShepherdRecord(runsRoot, lane)?.owner ?? null;
      out.active.push({
        lane,
        state,
        attempt: record2.attempt,
        elapsedMs: statusRow({ ...record2, state }, summary, nowMs).elapsedMs,
        owner: owner === null ? null : owner.slice(0, OWNER_CHARS),
        reason
      });
      if (state === "orphaned") {
        out.attention.push({ lane, state: "orphaned", attempt: record2.attempt, reason, todo: adviceFor("orphaned") });
      }
    } catch (err) {
      out.errors.push(`lane ${lane}: ${err.message}`);
    }
  }
  return out;
}

// src/summary/plans.ts
import { readdirSync as readdirSync12 } from "node:fs";
import { join as join38 } from "node:path";
var PLANS_DIR = join38(".arbab", "plans");
function names(dir, keep) {
  try {
    return readdirSync12(dir, { withFileTypes: true }).filter(keep).map((e) => e.name).sort();
  } catch {
    return [];
  }
}
function phaseLine(runsRoot, phase, alive) {
  const record2 = readState(runsRoot, phase);
  if (record2 === null) return { phase, status: "launched", endState: null };
  const state = effectiveState(record2, alive);
  if (state === "orphaned") return { phase, status: "failed", endState: "orphaned" };
  if (state !== "finished") return { phase, status: state, endState: null };
  let end = record2.endState ?? null;
  if (end === null && record2.attempt >= 1) end = readAttempt(runPaths(runsRoot, phase).attemptDir(record2.attempt)).summary?.state ?? null;
  return { phase, status: end === "success" ? "done" : "failed", endState: end };
}
function planOverview(projectRoot, runsRoot, alive) {
  const root = join38(projectRoot, PLANS_DIR);
  const plans = [];
  const errors = [];
  for (const plan of names(root, (e) => e.isDirectory() && isValidName(e.name))) {
    const phases = [];
    for (const file of names(join38(root, plan), (e) => e.isFile() && e.name.endsWith(".json"))) {
      const phase = file.slice(0, -".json".length);
      if (!isValidName(phase)) continue;
      try {
        phases.push(phaseLine(runsRoot, phase, alive));
      } catch (err) {
        errors.push(`plan ${plan} phase ${phase}: ${err.message}`);
      }
    }
    if (phases.length > 0) plans.push({ plan, phases });
  }
  return { plans, errors };
}

// src/summary/slots.ts
import { readdirSync as readdirSync13, readFileSync as readFileSync7 } from "node:fs";
import { join as join39 } from "node:path";
var SLOT_FILE = /^(0|[1-9][0-9]*)\.json$/;
function holder(path) {
  let v;
  try {
    v = JSON.parse(readFileSync7(path, "utf8"));
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v;
  if (!Number.isSafeInteger(o.pid) || o.pid < 1 || typeof o.lane !== "string" || typeof o.project !== "string") return null;
  return { pid: o.pid, lane: o.lane, project: o.project };
}
function slotsInUse(home, alive) {
  let files;
  try {
    files = readdirSync13(join39(home, "slots"));
  } catch {
    return [];
  }
  const out = [];
  for (const file of files) {
    const match = SLOT_FILE.exec(file);
    if (match === null) continue;
    const h = holder(join39(home, "slots", file));
    if (h !== null && alive(h.pid)) out.push({ slot: Number(match[1]), ...h });
  }
  return out.sort((a, b) => a.slot - b.slot);
}
function effectiveCap(projectMaxParallel, machine) {
  return machine.maxParallel === null ? projectMaxParallel : Math.min(projectMaxParallel, machine.maxParallel);
}
function quotaOverview(input) {
  const snapshot = readQuota(input.home);
  return {
    snapshot,
    hold: holdDecision(snapshot, input.config.quota.holdAbove, input.nowSec),
    slots: {
      inUse: slotsInUse(input.home, input.alive),
      cap: effectiveCap(input.config.maxParallel, input.machine),
      projectMaxParallel: input.config.maxParallel,
      machineMaxParallel: input.machine.maxParallel
    }
  };
}

// src/summary/project.ts
function projectSummary(input) {
  const { project, alive, nowMs } = input;
  const lanes = laneOverview(project.runsRoot, alive, nowMs);
  const plans = planOverview(project.root, project.runsRoot, alive);
  const integrations = integrationOverview(project.root, project.config);
  return {
    root: project.root,
    lanes: { total: lanes.total, counts: lanes.counts, active: lanes.active },
    plans: plans.plans,
    integrations: integrations.integrations,
    attention: lanes.attention,
    quota: quotaOverview({ home: input.home, config: project.config, machine: input.machine, alive, nowSec: Math.floor(nowMs / 1e3) }),
    errors: [...lanes.errors, ...plans.errors, ...integrations.errors]
  };
}

// src/summary/report.ts
import { existsSync as existsSync20, statSync as statSync6 } from "node:fs";
var FILES_SHOWN = 10;
function size(path) {
  try {
    return statSync6(path).size;
  } catch {
    return null;
  }
}
function laneFileRole(path) {
  try {
    const spec = readJson(path);
    const role2 = typeof spec === "object" && spec !== null ? spec["role"] : void 0;
    return ROLES.includes(role2) ? role2 : null;
  } catch {
    return null;
  }
}
function readLaneReport(runsRoot, lane, n) {
  const paths = runPaths(runsRoot, lane);
  if (!existsSync20(paths.laneDir)) throw new ArbabError("usage", `no runs for lane ${lane}`);
  const attempts = listAttempts(runsRoot, lane);
  const latest = attempts.at(-1);
  if (latest === void 0) throw new ArbabError("usage", `lane ${lane} has no attempt yet`);
  const attempt = n ?? latest;
  if (!attempts.includes(attempt)) throw new ArbabError("usage", `lane ${lane} has no attempt ${attempt} (attempts: ${attempts.join(", ")})`);
  const dir = paths.attemptDir(attempt);
  const files = attemptFiles(dir);
  const record2 = readAttempt(dir);
  let report = null;
  let reportError = null;
  try {
    report = readJson(files.report);
  } catch (err) {
    reportError = err.message;
  }
  const summaryRole = record2.summary !== null && ROLES.includes(record2.summary.role) ? record2.summary.role : null;
  return {
    lane,
    role: summaryRole ?? laneFileRole(paths.laneFile),
    attempt,
    latest,
    record: record2,
    report,
    reportError,
    stderr: { path: files.stderr, bytes: size(files.stderr) },
    stream: { path: files.stream, bytes: size(files.stream) }
  };
}
var isObject6 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var str = (v) => typeof v === "string" ? v : null;
var strings = (v) => Array.isArray(v) ? v.filter((x) => typeof x === "string") : null;
var objects = (v) => Array.isArray(v) ? v.filter(isObject6) : null;
var INDENT2 = "  ";
var block = (text2, indent = INDENT2) => text2.split("\n").join(`
${indent}`);
function formatTokens2(t) {
  return `${t.input} in \xB7 ${t.cacheCreation} cache write \xB7 ${t.cacheRead} cache read \xB7 ${t.output} out`;
}
function isTokens(v) {
  return isObject6(v) && ["input", "cacheCreation", "cacheRead", "output"].every((k) => Number.isFinite(v[k]));
}
function costLine(s) {
  if (typeof s.costUsd === "number") {
    const delta = typeof s.costDeltaUsd === "number" && s.costDeltaUsd.toFixed(2) !== s.costUsd.toFixed(2) ? ` (\u0394$${s.costDeltaUsd.toFixed(2)})` : "";
    return `cost:      $${s.costUsd.toFixed(2)}${delta}`;
  }
  return isTokens(s.tokens) ? `tokens:    ${formatTokens2(s.tokens)}` : "cost:      -";
}
function effortText(s) {
  const measured = isObject6(s.measuredEffort) ? Object.entries(s.measuredEffort).filter(([, n]) => Number.isFinite(n)).map(([e, n]) => `${e} ${n}`) : [];
  const requested = s.requestedEffort ?? "-";
  return measured.length > 0 ? `${requested} (measured: ${measured.join(", ")})` : requested;
}
function formatHeader(r, live = null) {
  const s = r.record.summary ?? live;
  const lines = [
    `lane:      ${r.lane}`,
    `role:      ${r.role ?? "-"}`,
    `attempt:   ${r.attempt}${r.attempt === r.latest ? "" : ` (latest ${r.latest})`}`
  ];
  if (s === null) {
    lines.push("end state: - (no summary.json)");
    return lines;
  }
  const wallMs = s.wallMs ?? r.record.exit?.wallMs ?? null;
  lines.push(
    `end state: ${s.state}${r.record.summary === null ? " (live, no summary.json yet)" : ""}`,
    `wall:      ${typeof wallMs === "number" ? formatElapsed(wallMs) : "-"}`,
    `turns:     ${s.turns}`,
    costLine(s),
    `effort:    ${effortText(s)}`
  );
  return lines;
}
function listSection(title, items) {
  if (items === null) return [];
  if (items.length === 0) return [`${title}: none`];
  return [`${title}:`, ...items.map((i) => `${INDENT2}- ${block(i, INDENT2 + "  ")}`)];
}
function workerBody(rep) {
  const lines = [];
  const status = str(rep["status"]);
  if (status !== null) lines.push(`status: ${status}`);
  const summary = str(rep["summary"]);
  if (summary !== null) lines.push(`summary: ${block(summary)}`);
  const files = strings(rep["files_changed"]);
  if (files !== null) {
    const more = files.length > FILES_SHOWN ? `, \u2026 ${files.length - FILES_SHOWN} more` : "";
    lines.push(`files changed (${files.length})${files.length > 0 ? `: ${files.slice(0, FILES_SHOWN).join(", ")}${more}` : ""}`);
  }
  const checks = objects(rep["checks"]);
  if (checks !== null) {
    if (checks.length === 0) lines.push("checks: none");
    else {
      lines.push("checks:");
      for (const c of checks) {
        const code4 = Number.isInteger(c["exit_code"]) ? String(c["exit_code"]) : "?";
        const result = str(c["result"]);
        lines.push(`${INDENT2}${str(c["command"]) ?? "?"} \u2192 ${code4}${result === null || result === "" ? "" : `  ${block(result, INDENT2 + "  ")}`}`);
      }
    }
  }
  lines.push(...listSection("decisions", strings(rep["decisions"])));
  lines.push(...listSection("open questions", strings(rep["open_questions"])));
  lines.push(...listSection("not verified", strings(rep["not_verified"])));
  const notes = str(rep["notes_for_reviewer"]);
  if (notes !== null) lines.push(`notes for reviewer: ${block(notes)}`);
  return lines;
}
function reviewerBody(rep, findings) {
  const lines = [];
  const coverage = str(rep["coverage"]);
  if (coverage !== null) lines.push(`coverage: ${block(coverage)}`);
  const paths = strings(rep["paths_checked"]);
  if (paths !== null) lines.push(`paths checked: ${paths.length}`);
  lines.push(findings.length === 0 ? "findings: none" : `findings (${findings.length}):`);
  findings.forEach((f, i) => {
    const line2 = Number.isInteger(f["line"]) ? `:${f["line"]}` : "";
    const id = str(f["id"]) ?? String(i + 1);
    lines.push(`${INDENT2}${id}  ${str(f["severity"]) ?? "?"}  ${str(f["title"]) ?? "?"}  ${str(f["file"]) ?? "?"}${line2}`);
  });
  return lines;
}
function skepticBody(verdicts) {
  const lines = [verdicts.length === 0 ? "verdicts: none" : `verdicts (${verdicts.length}):`];
  for (const v of verdicts) {
    const refuted = v["refuted"] === true ? "refuted" : v["refuted"] === false ? "stands" : "?";
    const reasoning = str(v["reasoning"]);
    lines.push(
      `${INDENT2}${str(v["id"]) ?? "?"}  ${refuted}  ${str(v["corrected_severity"]) ?? "?"}${reasoning === null ? "" : `  ${block(reasoning, INDENT2 + "  ")}`}`
    );
  }
  return lines;
}
function formatReportBody(report) {
  if (!isObject6(report)) return ["report.json is not an object (see --json)"];
  const findings = objects(report["findings"]);
  if (findings !== null) return reviewerBody(report, findings);
  const verdicts = objects(report["verdicts"]);
  if (verdicts !== null) return skepticBody(verdicts);
  const worker = workerBody(report);
  if (worker.length > 0) return worker;
  return [`report fields: ${Object.keys(report).join(", ") || "none"} (see --json)`];
}
var bytes = (n) => n === null ? "missing" : `${n} bytes`;
function formatLaneReport(r, live = null) {
  const lines = formatHeader(r, live);
  lines.push("");
  if (r.reportError !== null) {
    lines.push(`report.json cannot be read: ${r.reportError}`);
  } else if (r.report === null) {
    lines.push(`no report.json; see ${r.stderr.path} (${bytes(r.stderr.bytes)}); stream.jsonl: ${bytes(r.stream.bytes)}`);
  } else {
    lines.push(...formatReportBody(r.report));
  }
  return lines.join("\n");
}

// src/commands/status.ts
import { existsSync as existsSync21 } from "node:fs";
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
    if (existsSync21(dir)) {
      const attempt = readAttempt(dir);
      summary = attempt.summary;
      if (summary === null && effective.state === "running" && attempt.started !== null) {
        summary = liveSummary(project.runsRoot, lane, record2.attempt, attempt, nowMs);
      }
    }
  }
  return statusRow(effective, summary, nowMs, readShepherdRecord(project.runsRoot, lane)?.owner ?? null);
}
async function runStatus(argv2, ctx) {
  const { values, positionals } = parse("status", {
    args: argv2,
    options: { json: { type: "boolean" }, active: { type: "boolean" }, mine: { type: "boolean" } },
    allowPositionals: true
  });
  const session = sessionOf(ctx.hostEnv);
  const project = openProject(ctx);
  const named = positionals.length > 0;
  for (const lane of positionals) {
    assertValidName(lane, "lane");
    if (!existsSync21(runPaths(project.runsRoot, lane).laneDir)) throw new ArbabError("usage", `no runs for lane ${lane}`);
  }
  const nowMs = ctx.clock.now();
  const rows = [];
  for (const lane of named ? positionals : listLanes(project.runsRoot)) {
    if (values.mine === true && !ownedBy(readShepherdRecord(project.runsRoot, lane), session)) continue;
    const row = laneStatus(project, lane, ctx.alive, nowMs);
    if (row === null) {
      if (named) ctx.stderr(`${lane}: no state yet (the shepherd is starting)
`);
    } else if (values.active !== true || row.state !== "finished") {
      rows.push(row);
    }
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

// src/commands/report.ts
function attemptNumber(value) {
  if (value === void 0) return void 0;
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new ArbabError("usage", `--attempt ${JSON.stringify(value)} must be a positive integer`);
  }
  return Number(value);
}
async function runReport(argv2, ctx) {
  const { values, positionals } = parse("report", {
    args: argv2,
    options: { attempt: { type: "string" }, json: { type: "boolean" } },
    allowPositionals: true
  });
  const lane = assertValidName(onePositional("report", positionals, "lane"), "lane");
  const attempt = attemptNumber(values.attempt);
  const project = openProject(ctx);
  const r = readLaneReport(project.runsRoot, lane, attempt);
  if (values.json === true) {
    printJson(ctx, { summary: r.record.summary, report: r.report });
    if (r.reportError !== null) ctx.stderr(`report.json cannot be read: ${r.reportError}
`);
    return 0;
  }
  let live = null;
  if (r.record.summary === null && r.record.started !== null && r.attempt === r.latest) {
    const state = readState(project.runsRoot, lane);
    if (state !== null && state.attempt === r.attempt && effectiveState(state, ctx.alive) === "running") {
      live = liveSummary(project.runsRoot, lane, r.attempt, r.record, ctx.clock.now());
    }
  }
  ctx.stdout(formatLaneReport(r, live) + "\n");
  return 0;
}

// src/commands/resume.ts
import { existsSync as existsSync23, realpathSync as realpathSync13 } from "node:fs";
import { join as join44 } from "node:path";

// src/shepherd/index.ts
import { spawn as spawn2 } from "node:child_process";
import { homedir } from "node:os";
import { dirname as dirname9, join as join43 } from "node:path";

// src/shepherd/lifecycle.ts
import { existsSync as existsSync22, mkdirSync as mkdirSync6, realpathSync as realpathSync12 } from "node:fs";
import { dirname as dirname8, join as join42, resolve as resolve16 } from "node:path";

// src/shepherd/attempt.ts
import { randomUUID } from "node:crypto";
import { join as join40 } from "node:path";

// src/report/schemas.ts
var str2 = { type: "string" };
var strings2 = { type: "array", items: str2 };
var workerReport = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["done", "partial", "blocked"] },
    summary: str2,
    files_changed: strings2,
    checks: {
      type: "array",
      items: {
        type: "object",
        properties: { command: str2, exit_code: { type: "integer" }, result: str2 },
        required: ["command", "exit_code", "result"]
      }
    },
    decisions: strings2,
    open_questions: strings2,
    not_verified: strings2,
    notes_for_reviewer: str2
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
          title: str2,
          severity: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
          file: str2,
          line: { type: "integer" },
          failure_scenario: str2,
          evidence: str2
        },
        required: ["title", "severity", "file", "failure_scenario", "evidence"]
      }
    },
    coverage: str2,
    paths_checked: strings2
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
          question: str2,
          claim: str2,
          source: str2,
          quote: str2,
          confidence: { type: "string", enum: ["high", "medium", "low"] }
        },
        required: ["question", "claim", "source", "confidence"]
      }
    },
    not_found: strings2,
    recommendations: strings2
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
        properties: { n: { type: "integer" }, command: str2, exit_code: { type: "integer" }, output: str2 },
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
  if (isObject7(value)) checkObject(schema, value, path, errors);
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
      return isObject7(value);
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
function isObject7(value) {
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
import { realpathSync as realpathSync10 } from "node:fs";
import { isAbsolute as isAbsolute11, relative as relative9 } from "node:path";

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
  const fence2 = "`".repeat(Math.max(3, longest + 1));
  return `${fence2}text
${body}
${fence2}`;
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
  const flat2 = name2.replace(/\s+/g, " ").trim();
  return flat2 === "" ? "?" : cut(flat2, 100);
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
      for (const block3 of blocks(e)) {
        if (block3.type === "text" && typeof block3.text === "string") {
          if (block3.text.trim() === "") continue;
          items.push(`### NOTE

${fenced(cut(block3.text.trim(), noteChars))}`);
        } else if (block3.type === "tool_use" && typeof block3.name === "string") {
          const id = typeof block3.id === "string" ? block3.id : null;
          if (id !== null) {
            if (seenCalls.has(id)) continue;
            seenCalls.add(id);
          }
          if (block3.name === REPORT_TOOL2) {
            if (id !== null) reportCalls.add(id);
            continue;
          }
          items.push(`### CALL ${headingName(block3.name)}

${fenced(cut(json(block3.input ?? {}), callChars))}`);
        }
      }
    } else if (e.type === "user") {
      for (const block3 of blocks(e)) {
        if (block3.type !== "tool_result") continue;
        if (typeof block3.tool_use_id === "string" && reportCalls.has(block3.tool_use_id)) continue;
        const heading = block3.is_error === true ? "### RESULT (error)" : "### RESULT";
        const text2 = resultText(block3.content);
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
    const line2 = dropped2 > 0 ? droppedLine(dropped2).length : 0;
    return kept + (report?.length ?? 0) + line2 + Math.max(parts - 1, 0) * SEPARATOR.length;
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
  if (!isAbsolute11(file)) throw new ArbabError("usage", `prompt file ${file} is not an absolute path`);
  let real2;
  let base;
  try {
    real2 = realpathSync10(file);
    base = realpathSync10(laneDir);
  } catch (err) {
    throw new ArbabError("io", `cannot resolve prompt file ${file}: ${err.message}`, { cause: err });
  }
  const rel = relative9(base, real2);
  if (rel === "" || rel.startsWith("..") || isAbsolute11(rel)) {
    throw new ArbabError("usage", `prompt file ${file} is not inside the lane's run dir ${laneDir}`);
  }
  const text2 = readRequired2(real2, "prompt file");
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
    bashMaxTimeoutMin: Number.isFinite(maxMs) ? Math.round(maxMs / 6e4) : 15,
    ...input.inputs === void 0 || input.inputs.length === 0 ? {} : { inputs: [...input.inputs] }
  };
  const prompt = assembleBrief(source, ctx);
  if (input.headStart === void 0) return prompt;
  const belt = `## Tool belt

${toolBelt(ctx.profile, ctx.leases, ctx.bashMaxTimeoutMin)}`;
  return insertBeforeToolBelt(prompt, belt, input.headStart);
}

// src/shepherd/attempt.ts
function startedFields(request) {
  return {
    ...request.merged === void 0 ? {} : { merged: request.merged },
    ...request.timing === void 0 ? {} : { heldMs: request.timing.heldMs, prepareMs: request.timing.prepareMs },
    ...request.inputs === void 0 ? {} : { inputs: request.inputs }
  };
}
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
function readOptional2(path) {
  try {
    return readText(path);
  } catch {
    return null;
  }
}
function readRegistration(path) {
  const text2 = readOptional2(path);
  if (text2 === null) return null;
  let value;
  try {
    value = JSON.parse(text2);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value;
  const str3 = (x) => typeof x === "string" ? x : null;
  return { kind: str3(v["kind"]), entrypoint: str3(v["entrypoint"]), name: str3(v["name"]) };
}
function worktreeUsedFile(runsRoot, owner) {
  return join40(runPaths(runsRoot, owner).laneDir, "worktree-used");
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
  const readable = config.fence.readableEnvFiles;
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
    gitCommonDir: ctx.gitCommonDir,
    // Anchors the relative credential denies at the main checkout, whose .env files the sandbox would not cover.
    projectRoot: ctx.projectRoot,
    readableEnvFiles: readable,
    bashOutputMaxChars: config.fence.bashOutputMaxChars,
    // Each listed template costs a git call; with none listed there is nothing to re-open.
    envFileAllowReads: readable.length === 0 ? [] : envFileAllowReads({ worktree: ctx.worktree, readable, git: ctx.deps.git })
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
  const table3 = () => {
    try {
      return parsePs(readPs2());
    } catch {
      return null;
    }
  };
  return {
    snapshot() {
      const rows = table3();
      if (rows !== null) tracked = trackDescendants(pid, rows, tracked, rootRunning());
    },
    targets() {
      const rows = table3();
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
  const briefInput = {
    projectRoot: ctx.projectRoot,
    runsRoot,
    config: ctx.config,
    lane,
    branch: ctx.branch,
    worktree: ctx.worktree,
    profile,
    leases: ctx.leases,
    schema,
    ...request.headStart === void 0 ? {} : { headStart: request.headStart },
    ...request.inputs === void 0 || request.inputs.length === 0 ? {} : { inputs: request.inputs }
  };
  const prompt = resume ? request.prompt ?? CONTINUATION_PROMPT : buildBrief(briefInput);
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
    ...startedFields(request)
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
    const registrationFile = join40(deps.claudeHome, "sessions", `${pid}.json`);
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
  const parsed2 = parseStream(readOptional2(files.stream) ?? "");
  const digest = digestStream(parsed2.events, isoAt(deps.clock), parsed2.unparsedLines);
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
  const transcript = findTranscript(join40(deps.claudeHome, "projects"), digest.sessionId ?? sessionId);
  const transcriptText = transcript === null ? null : readOptional2(transcript);
  if (transcriptText !== null) {
    try {
      effort2 = measuredEffort(transcriptText);
    } catch {
      effort2 = null;
    }
  }
  if (registration === null) {
    registration = readRegistration(join40(deps.claudeHome, "sessions", `${pid}.json`));
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

// src/shepherd/inputs.ts
import { closeSync as closeSync5, constants as constants2, fstatSync, lstatSync as lstatSync3, mkdirSync as mkdirSync5, openSync as openSync5, readdirSync as readdirSync14, readFileSync as readFileSync8, realpathSync as realpathSync11, rmSync as rmSync10, unlinkSync as unlinkSync2, writeFileSync as writeFileSync3 } from "node:fs";
import { basename as basename5, dirname as dirname7, isAbsolute as isAbsolute12, join as join41, relative as relative10, resolve as resolve15, sep as sep9 } from "node:path";
var MAX_INPUTS_BYTES = 50 * 1024 * 1024;
var LIBRARY = "~/Library/**";
function within(parent, child2) {
  const rel = relative10(parent, child2);
  return rel === "" || !rel.startsWith("..") && !isAbsolute12(rel);
}
function realOr(path) {
  try {
    return realpathSync11(path);
  } catch {
    return path;
  }
}
var GLOB_CHARS = /[*?[\]{}]/;
var escapeRe = (text2) => text2.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
function globSource(glob) {
  const whole = glob.endsWith("/**");
  const body = whole ? glob.slice(0, -3) : glob;
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "*" && body[i + 1] === "*") {
      i++;
      if (body[i + 1] === "/") {
        i++;
        out += "(?:.*/)?";
      } else out += ".*";
    } else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else out += escapeRe(c);
  }
  return whole ? `${out}(?:/.*)?` : out;
}
function patternRegexes(pattern, homes) {
  const anchored = (prefix, glob) => new RegExp(`^${escapeRe(prefix)}${globSource(glob)}$`);
  if (pattern.startsWith("~/")) return homes.map((h) => anchored(h.endsWith("/") ? h : `${h}/`, pattern.slice(2)));
  if (pattern.startsWith("/")) return [anchored("/", pattern.replace(/^\/+/, ""))];
  return [new RegExp(`(?:^|/)${globSource(pattern)}$`)];
}
function credentialRules(patterns, homes) {
  return patterns.map((pattern) => {
    if (pattern.startsWith("~/")) {
      const rest = pattern.slice(2);
      const dir = rest.endsWith("/**") ? rest.slice(0, -3) : null;
      const plain = dir ?? rest;
      if (plain !== "" && !GLOB_CHARS.test(plain)) {
        const hit = { kind: dir !== null ? "dir" : "file", label: `~/${plain}` };
        return (path) => homes.some((h) => within(join41(h, plain), path)) ? hit : null;
      }
    }
    if (pattern.startsWith("**/")) {
      const name2 = pattern.slice(3);
      if (name2 !== "" && !name2.includes("/") && !name2.includes("**")) {
        const re = new RegExp(`^${globSource(name2)}$`);
        return (path) => {
          const component = path.split(sep9).find((c) => re.test(c));
          return component === void 0 ? null : { kind: "name", label: component };
        };
      }
    }
    const res = patternRegexes(pattern, homes);
    return (path) => res.some((re) => re.test(path)) ? { kind: "pattern", label: pattern } : null;
  });
}
function copyInputs(input) {
  const home = resolve15(input.userHome);
  const homes = [.../* @__PURE__ */ new Set([home, realOr(home)])];
  const worktree = realOr(resolve15(input.worktree));
  const rules = credentialRules([...BUILTIN_CREDENTIAL_PATHS, LIBRARY, ...input.credentialPaths], homes);
  const credential = (path) => {
    for (const rule of rules) {
      const hit = rule(path);
      if (hit !== null) return hit;
    }
    return null;
  };
  const names2 = /* @__PURE__ */ new Map();
  const planned = [];
  let total = 0;
  for (const raw of input.inputs) {
    const refuse2 = (why) => {
      throw new ArbabError("usage", `input ${raw} ${why}`);
    };
    let path;
    if (raw === "~" || raw.startsWith("~/")) path = join41(home, raw.slice(2));
    else if (raw.startsWith("~")) path = refuse2("names another user's home; write the full path");
    else path = resolve15(input.projectRoot, raw);
    const name2 = basename5(path);
    if (name2 === "") refuse2("has no name to copy it under");
    const clash = names2.get(name2);
    if (clash !== void 0) refuse2(`has the same name (${name2}) as input ${clash}`);
    names2.set(name2, raw);
    let stat;
    try {
      stat = lstatSync3(path);
    } catch {
      return refuse2(`does not exist (${path})`);
    }
    if (stat.isSymbolicLink()) refuse2("is a symbolic link; name the file it points to");
    if (!stat.isFile() && !stat.isDirectory()) refuse2("is neither a file nor a directory");
    const real2 = realOr(path);
    for (const p of [path, real2]) {
      const hit = credential(p);
      if (hit === null) continue;
      if (hit.kind === "dir") refuse2(`is under ${hit.label}, where credentials live`);
      if (hit.kind === "file") refuse2(`is the credential file ${hit.label}`);
      if (hit.kind === "name") refuse2(`is named like a credential file (${hit.label})`);
      refuse2(`matches the credential path ${hit.label}`);
    }
    if (stat.isDirectory() && homes.some((h) => within(real2, h))) refuse2("holds the home directory, credentials included");
    if (stat.isDirectory() && within(real2, worktree)) refuse2("holds the worktree it would be copied into");
    const entries3 = [];
    const add = (bytes2) => {
      total += bytes2;
      if (total > MAX_INPUTS_BYTES) refuse2(`brings the inputs over ${MAX_INPUTS_BYTES / 1024 / 1024} MB`);
    };
    if (stat.isFile()) {
      add(stat.size);
      entries3.push({ rel: "", dir: false, dev: stat.dev, ino: stat.ino });
    } else {
      entries3.push({ rel: "", dir: true });
      const walk = (rel) => {
        for (const child2 of readdirSync14(join41(real2, rel)).sort()) {
          const childRel = join41(rel, child2);
          const full = join41(real2, childRel);
          const s = lstatSync3(full);
          if (s.isSymbolicLink()) continue;
          if (!s.isDirectory() && !s.isFile()) continue;
          const hit = credential(full) ?? credential(join41(path, childRel));
          if (hit !== null) {
            if (hit.kind === "dir") refuse2(`holds ${hit.label}, where credentials live`);
            if (hit.kind === "file") refuse2(`holds ${hit.label}, a credential file`);
            if (hit.kind === "name") refuse2(`holds ${childRel}, named like a credential file`);
            refuse2(`holds ${childRel}, which matches the credential path ${hit.label}`);
          }
          if (s.isDirectory()) {
            entries3.push({ rel: childRel, dir: true });
            walk(childRel);
          } else {
            add(s.size);
            entries3.push({ rel: childRel, dir: false, dev: s.dev, ino: s.ino });
          }
        }
      };
      try {
        walk("");
      } catch (err) {
        if (err instanceof ArbabError) throw err;
        throw new ArbabError("io", `cannot read input ${raw}: ${err.message}`, { cause: err });
      }
    }
    planned.push({ raw, name: name2, source: real2, entries: entries3 });
  }
  const dest = clearInputs(input.worktree);
  let copied = 0;
  for (const p of planned) {
    const refuse2 = (why) => {
      throw new ArbabError("usage", `input ${p.raw} ${why}`);
    };
    const target = join41(dest, p.name);
    try {
      for (const e of p.entries) {
        const to = join41(target, e.rel);
        if (e.dir) {
          mkdirSync5(to);
          continue;
        }
        const from = join41(p.source, e.rel);
        if (realOr(dirname7(from)) !== dirname7(from)) refuse2(`changed while it was copied (${e.rel || p.name} moved)`);
        let fd;
        try {
          fd = openSync5(from, constants2.O_RDONLY | constants2.O_NOFOLLOW);
        } catch (err) {
          if (err.code === "ELOOP") return refuse2(`changed while it was copied (${e.rel || p.name} is now a link)`);
          throw err;
        }
        try {
          const s = fstatSync(fd);
          if (!s.isFile() || s.dev !== e.dev || s.ino !== e.ino) refuse2(`changed while it was copied (${e.rel || p.name} is another file)`);
          copied += s.size;
          if (copied > MAX_INPUTS_BYTES) refuse2("grew over the inputs' limit while it was copied");
          const out = openSync5(to, constants2.O_WRONLY | constants2.O_CREAT | constants2.O_EXCL | constants2.O_NOFOLLOW, s.mode & 511);
          try {
            writeFileSync3(out, readFileSync8(fd));
          } finally {
            closeSync5(out);
          }
        } finally {
          closeSync5(fd);
        }
      }
    } catch (err) {
      if (err instanceof ArbabError) throw err;
      throw new ArbabError("io", `cannot copy input ${p.raw}: ${err.message}`, { cause: err });
    }
  }
  return planned.map((p) => p.name);
}
function clearInputs(worktree) {
  const rel = join41(WORKER_TMP_DIR, "inputs");
  const dest = join41(realDir(worktree, WORKER_TMP_DIR), "inputs");
  let stat = null;
  try {
    stat = lstatSync3(dest);
  } catch (err) {
    if (err.code !== "ENOENT") throw new ArbabError("io", `cannot read ${dest}: ${err.message}`, { cause: err });
  }
  try {
    if (stat?.isDirectory() === true) rmSync10(dest, { recursive: true, force: true });
    else if (stat !== null) unlinkSync2(dest);
  } catch (err) {
    throw new ArbabError("io", `cannot remove ${dest}: ${err.message}`, { cause: err });
  }
  return realDir(worktree, rel);
}

// src/shepherd/merge.ts
var output3 = (r) => (r.stderr || r.stdout).trim();
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
      throw new ArbabError("git", `cannot list the files ${branch} changes in ${input.branch} (${diff.code}): ${output3(diff)}`);
    }
    const manifests = installRelevantPaths(git, "HEAD", sha, diff.stdout.split("\0").filter((path) => path !== ""));
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
      throw new ArbabError("git", `merging ${branch} into ${input.branch} failed (${r.code}): ${output3(r)}; ${after}`);
    }
    merged.push({ branch, sha });
  }
  return merged;
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
var message3 = (err) => err instanceof Error ? err.message : String(err);
function slotCap(home, projectMax) {
  let machine = null;
  try {
    machine = loadMachineConfig(home).maxParallel;
  } catch {
  }
  return Math.min(projectMax, machine ?? projectMax);
}
function releaseAll(home, held, holder2) {
  const quietly = (fn) => {
    try {
      fn();
    } catch {
    }
  };
  if (held.lockKey !== null) {
    const key = held.lockKey;
    quietly(() => releaseWriterLock(home, key, holder2));
  }
  for (const s of held.semaphores) quietly(() => releaseSemaphore(home, s.name, s.slot, holder2));
  quietly(() => releaseLeases(home, held.leases, holder2));
  if (held.slot !== null) {
    const slot = held.slot;
    quietly(() => releaseSlot(home, slot, holder2));
  }
}
async function runShepherd(projectRoot, laneName2, mode, deps, stop) {
  assertValidName(laneName2, "lane");
  const root = resolve16(projectRoot);
  const config = loadConfig(root);
  const runsRoot = confine(root, config.runsRoot);
  const paths = runPaths(runsRoot, laneName2);
  const pid = process.pid;
  const startedMs = deps.clock.now();
  const startedAt = new Date(startedMs).toISOString();
  const owner = sessionOf(deps.hostEnv);
  writeJsonAtomic(paths.shepherdFile, { pid, startedAt, owner });
  let attempt = 0;
  let current = null;
  let preparingMs = null;
  const setState = (state, extra = {}) => {
    const changed = current === null || current.state !== state || current.reason !== extra.reason;
    const since = current !== null && current.state === state ? current.since : isoAt(deps.clock);
    current = { state, since, reason: extra.reason };
    if (state === "preparing") preparingMs ??= deps.clock.now();
    writeState(runsRoot, { lane: laneName2, state, attempt, since, shepherdPid: pid, ...extra });
    if (changed) appendLaneEvent(runsRoot, laneName2, { at: isoAt(deps.clock), shepherdPid: pid, state, attempt, ...extra });
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
  const holder2 = { pid, lane: laneName2, project: root, createdAt: isoAt(deps.clock) };
  const held = { slot: null, leases: [], semaphores: [], lockKey: null };
  const quotaDecision = () => holdDecision(readQuota(deps.home), config.quota.holdAbove, nowSec());
  const awaitQuota = async () => {
    for (; ; ) {
      checkStop();
      const decision = quotaDecision();
      if (!decision.hold) return;
      setState("held", { reason: decision.reason ?? "quota", ...decision.until === null ? {} : { until: decision.until } });
      const untilMs = decision.until === null ? Infinity : decision.until * 1e3 - deps.clock.now();
      await pause(Math.min(untilMs, deps.holdPollMs));
    }
  };
  const releaseHeldSlot = () => {
    if (held.slot === null) return;
    const slot = held.slot;
    held.slot = null;
    releaseSlot(deps.home, slot, holder2);
  };
  const awaitSlot = async () => {
    for (; ; ) {
      await awaitQuota();
      for (; ; ) {
        checkStop();
        held.slot = acquireSlot(deps.home, slotCap(deps.home, config.maxParallel), holder2, deps.alive);
        if (held.slot !== null) break;
        setState("held", { reason: NO_FREE_SLOT_REASON });
        await pause(deps.slotPollMs);
      }
      if (!quotaDecision().hold) return;
      releaseHeldSlot();
    }
  };
  let endState;
  let reason;
  try {
    registerShepherd(deps.home, { pid, lane: laneName2, project: root, owner, startedAt });
    registerProject(deps.home, root, startedAt);
    setState("queued");
    const lane = loadLane(root, paths.laneFile);
    if (lane.name !== laneName2) throw new ArbabError("usage", `${paths.laneFile} names lane ${lane.name}, not ${laneName2}`);
    const role2 = effectiveRole(config, lane);
    const resumeText = mode.kind === "resume" ? resumePrompt(paths.laneDir, mode) : null;
    const seed = mode.kind === "fresh" && mode.digestFrom !== void 0 ? digestHeadStart(runsRoot, laneName2, mode.digestFrom) : null;
    await awaitSlot();
    setState("preparing");
    const userHome = deps.hostEnv["HOME"] ?? dirname8(deps.home);
    const prepared = await prepare(root, config, lane, deps, holder2, held, userHome, async (why) => {
      checkStop();
      setState("preparing", { reason: why });
      await pause(deps.slotPollMs);
    });
    let request = resumeText === null ? { kind: mode.kind } : { kind: "resume", prompt: resumeText };
    if (seed !== null) request.headStart = seed;
    if (prepared.merged.length > 0) request.merged = prepared.merged;
    if (prepared.inputs !== null) request.inputs = prepared.inputs;
    const preparedFrom = preparingMs ?? startedMs;
    request.timing = { heldMs: preparedFrom - startedMs, prepareMs: deps.clock.now() - preparedFrom };
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
      releaseHeldSlot();
      while (deps.clock.now() < until * 1e3) {
        checkStop();
        await pause(Math.min(until * 1e3 - deps.clock.now(), deps.holdPollMs));
        checkStop();
        if (resetSince(lastQuotaReset(deps.home), attemptBegan)) break;
      }
      await awaitSlot();
      request = { kind: "resume" };
    }
  } catch (err) {
    if (err instanceof Stopped || stop.aborted) {
      endState = "killed:stopped";
    } else {
      endState = "failed";
      reason = message3(err);
    }
  } finally {
    releaseAll(deps.home, held, holder2);
    try {
      unregisterShepherd(deps.home, pid);
    } catch {
    }
  }
  if (stop.aborted) endState = "killed:stopped";
  setState("finished", { endState, ...reason === void 0 ? {} : { reason } });
  return endState;
}
async function prepare(root, config, lane, deps, holder2, held, userHome, wait) {
  ensureIgnored(root, arbabIgnoreEntries(root, config), deps.git);
  ensureArbabMarkers(root);
  const owner = lane.worktree ?? lane.name;
  if (owner !== lane.name && !existsSync22(join42(confine(root, config.worktreeRoot), owner))) {
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
  mkdirSync6(worktreeRoot, { recursive: true });
  const worktree = join42(realpathSync12(worktreeRoot), owner);
  held.leases = await acquireLeases({
    home: deps.home,
    requests: lane.resources ?? {},
    ranges: config.resources,
    holder: holder2,
    alive: deps.alive,
    probePort: deps.probePort
  });
  for (const name2 of lane.semaphores ?? []) {
    if (!Object.hasOwn(config.semaphores, name2)) throw new ArbabError("config", `semaphore ${name2} is not configured`);
    const capacity = config.semaphores[name2];
    for (; ; ) {
      const slot = acquireSemaphore(deps.home, name2, capacity, holder2, deps.alive);
      if (slot !== null) {
        held.semaphores.push({ name: name2, slot });
        break;
      }
      await wait(`waiting for semaphore ${name2}`);
    }
  }
  const key = writerLockKey(worktree);
  while (!acquireWriterLock(deps.home, key, holder2, deps.alive)) await wait("waiting for the writer lock");
  held.lockKey = key;
  let wt = createWorktree(worktreeInput);
  if (realpathSync12(wt.path) !== worktree) throw new ArbabError("git", `${wt.path} is not the worktree ${worktree}`);
  let merged = [];
  const runsRoot = confine(root, config.runsRoot);
  const pristine = wt.created || !existsSync22(worktreeUsedFile(runsRoot, owner)) && listAttempts(runsRoot, owner).length === 0;
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
    if (realpathSync12(wt.path) !== worktree) throw new ArbabError("git", `${wt.path} moved while it was built again`);
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
  ensureWorkerTmp(worktree);
  const copied = copyInputs({ projectRoot: root, worktree, inputs: lane.inputs ?? [], userHome, credentialPaths: config.credentialPaths });
  const inputs = copied.length > 0 ? copied : null;
  return { worktree, branch: wt.branch, gitCommonDir: wt.gitCommonDir, merged, inputs };
}

// src/shepherd/index.ts
function defaultDeps() {
  const home = homedir();
  const pathEnv = process.env["PATH"] ?? "";
  const pnpm = findOnPath("pnpm", pathEnv, pathExists);
  const explicit = process.env["ARBAB_CLAUDE"];
  return {
    home: join43(home, ".arbab"),
    claudeHome: join43(home, ".claude"),
    clock: systemClock,
    sleep,
    random: Math.random,
    hostEnv: { ...process.env },
    nodeDir: dirname9(process.execPath),
    pnpmDir: pnpm === null ? void 0 : dirname9(pnpm),
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
    path = realpathSync13(confine(project.root, file));
  } catch (err) {
    if (err instanceof ArbabError) throw err;
    throw new ArbabError("usage", `cannot read prompt ${file}: ${err.message}`, { cause: err });
  }
  confine(realpathSync13(project.root), path);
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
    const path = join44(laneDir, `resume-prompt-${n}.md`);
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
  if (!existsSync23(paths.laneFile)) throw new ArbabError("usage", `no runs for lane ${lane}`);
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
import { realpathSync as realpathSync14 } from "node:fs";
import { basename as basename6 } from "node:path";
var DEFAULT_TIMEOUT_MIN2 = 120;
var SHA7 = /^[0-9a-f]{40,64}$/;
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
function lensFilePath(root, name2, file) {
  const refuse2 = (why) => new ArbabError("usage", `--lens-file ${name2}=${file}: ${why}`);
  const isEnv = (path2) => basename6(path2).startsWith(".env");
  let path;
  try {
    path = confine(root, file);
  } catch {
    throw refuse2("the file must be inside the project root");
  }
  if (isEnv(path)) throw refuse2("a .env file is not a lens");
  let real2;
  try {
    real2 = realpathSync14(path);
  } catch (err) {
    if (err.code === "ENOENT") throw new ArbabError("usage", `the file of lens ${name2}, ${file}, does not exist`);
    throw new ArbabError("usage", `cannot read the file of lens ${name2}, ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    confine(realpathSync14(root), real2);
  } catch {
    throw refuse2("the file must be inside the project root, and a symlink in it may not lead out");
  }
  if (isEnv(real2)) throw refuse2("a .env file is not a lens");
  return real2;
}
function readLensFiles(root, options) {
  const lenses2 = {};
  for (const option of options) {
    const { name: name2, file } = parseLensFileOption(option);
    if (Object.hasOwn(lenses2, name2)) throw new ArbabError("usage", `--lens-file names lens ${name2} twice`);
    const path = lensFilePath(root, name2, file);
    let text2;
    try {
      text2 = readText(path);
    } catch (err) {
      throw new ArbabError("usage", `cannot read the file of lens ${name2}, ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (text2 === null) throw new ArbabError("usage", `the file of lens ${name2}, ${file}, does not exist`);
    lenses2[name2] = lensFileText(name2, text2);
  }
  return lenses2;
}
function sinceCommit(git, root, since, head) {
  if (since === "" || since.startsWith("-")) throw new ArbabError("usage", `--since ${JSON.stringify(since)} is not a commit`);
  const r = git(["rev-parse", "--verify", "--quiet", `${since}^{commit}`], root);
  const sha = r.stdout.trim();
  if (r.code !== 0 || !SHA7.test(sha)) throw new ArbabError("usage", `--since ${since} does not name a commit`);
  if (sha === head) throw new ArbabError("usage", `--since ${since} is the integration head itself: nothing changed since`);
  const ancestor = git(["merge-base", "--is-ancestor", sha, head], root);
  if (ancestor.code === 1) throw new ArbabError("usage", `--since ${since} (${sha}) is not an ancestor of the integration head ${head}`);
  if (ancestor.code !== 0) {
    throw new ArbabError("git", `git merge-base --is-ancestor ${sha} ${head} failed (${ancestor.code}): ${(ancestor.stderr || ancestor.stdout).trim()}`);
  }
  return sha;
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
function previousReview(ctx, integration) {
  try {
    return readReviewRecord(integration.paths.review, integration.paths.name);
  } catch (err) {
    ctx.stderr(`arbab review: ${err instanceof Error ? err.message : String(err)}; no lens of it is kept
`);
    return null;
  }
}
async function runReview(argv2, ctx) {
  const { values, positionals } = parse("review", {
    args: argv2,
    options: {
      lenses: { type: "string" },
      "lens-file": { type: "string", multiple: true },
      since: { type: "string" },
      "timeout-min": { type: "string" },
      json: { type: "boolean" }
    },
    allowPositionals: true
  });
  const name2 = assertValidName(onePositional("review", positionals, "name"), "integration");
  const timeoutMs = parseTimeoutMin(values["timeout-min"] ?? String(DEFAULT_TIMEOUT_MIN2));
  const project = openProject(ctx);
  const fileLenses = readLensFiles(project.root, values["lens-file"] ?? []);
  const runLenses = { ...project.config.review.lenses, ...fileLenses };
  const lenses2 = reviewLenses(values.lenses, runLenses);
  const unrun = Object.keys(fileLenses).filter((lens) => !lenses2.includes(lens));
  if (unrun.length > 0) throw new ArbabError("usage", `--lens-file gives ${unrun.join(", ")}, which --lenses does not run`);
  const integration = openIntegration(project, name2);
  const owner = generationOwner(integration);
  const { record: rec, paths } = integration;
  assertReviewLaneNames(paths.name, lenses2);
  const start = generatedBase(rec);
  assertRecordedHead(ctx.git, project, integration);
  const since = values.since === void 0 ? null : sinceCommit(ctx.git, project.root, values.since, rec.headSha);
  const diffBase = since ?? rec.baseSha;
  const previous = values.lenses === void 0 ? null : previousReview(ctx, integration);
  const reviewers = lenses2.map((lens) => ({
    lens,
    lane: reviewLane({ paths, lens, text: lensText(lens, runLenses) ?? "", diffBase, since: since !== null, ...start })
  }));
  const reviewed = await runGeneratedLanes(ctx, project, paths, reviewers.map((r) => r.lane), timeoutMs, owner);
  if (reviewed.timedOut) {
    if (values.json === true) printJson(ctx, { timedOut: true, review: null });
    else ctx.stderr(`arbab review: the reviewer lanes did not finish in time; they keep running
`);
    return WAIT_TIMEOUT_EXIT;
  }
  const outcomeOf = (outcomes, lane) => outcomes.find((o) => o.lane === lane);
  let findings = collectFindings(reviewers.map((r) => ({ lens: r.lens, report: outcomeOf(reviewed.outcomes, r.lane.spec.name)?.report ?? null })));
  const lensEntries = reviewers.map((r) => {
    const outcome2 = outcomeOf(reviewed.outcomes, r.lane.spec.name);
    return { lens: r.lens, lane: r.lane.spec.name, endState: outcome2?.endState ?? null, ...reviewerCoverage(outcome2?.report ?? null) };
  });
  const skeptics = lenses2.filter((lens) => skepticFindings(lens, findings).length > 0).map((lens) => ({ lens, lane: skepticLane({ paths, lens, findings, diffBase, ...start }) }));
  let skepticEntries = [];
  let skepticsTimedOut = false;
  if (skeptics.length > 0) {
    const checked = await runGeneratedLanes(ctx, project, paths, skeptics.map((s) => s.lane), timeoutMs, owner);
    skepticsTimedOut = checked.timedOut;
    skepticEntries = skeptics.map((s) => ({ lens: s.lens, lane: s.lane.spec.name, endState: outcomeOf(checked.outcomes, s.lane.spec.name)?.endState ?? null }));
    for (const s of skeptics) {
      const report = outcomeOf(checked.outcomes, s.lane.spec.name)?.report;
      if (report !== void 0 && report !== null) findings = applyLensVerdicts(findings, s.lens, report);
    }
  }
  const current = reviewRecord({ name: name2, headSha: rec.headSha, lenses: lensEntries, skeptics: skepticEntries, findings, now: ctx.clock.now(), since });
  const record2 = writeReviewRound(paths.dir, keepOtherLenses(previous, current, lenses2));
  writeJsonAtomic(paths.review, record2);
  if (!skepticsTimedOut) settleGeneratedRuns(paths.lanesDir, [...reviewers, ...skeptics].map((x) => x.lane.spec.name));
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
import { isAbsolute as isAbsolute13 } from "node:path";
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
      if (typeof promptFile === "string" && isAbsolute13(promptFile)) return { kind, promptFile };
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
  if (!isAbsolute13(root)) throw new ArbabError("usage", `project root ${root} must be absolute`);
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

// src/commands/summary.ts
import { existsSync as existsSync24 } from "node:fs";
function machineConfig(ctx, errors) {
  try {
    return loadMachineConfig(ctx.home);
  } catch (err) {
    if (!(err instanceof ArbabError)) throw err;
    errors.push(`machine config: ${err.message}`);
    return { maxParallel: null };
  }
}
function summarize(ctx, project, machine, machineErrors, nowMs) {
  const summary = projectSummary({ project, home: ctx.home, machine, alive: ctx.alive, nowMs });
  return { ...summary, errors: [...machineErrors, ...summary.errors] };
}
function openRoot(root) {
  const config = loadConfig(root);
  return { root, config, runsRoot: confine(root, config.runsRoot), worktreeRoot: confine(root, config.worktreeRoot) };
}
async function runSummary(argv2, ctx) {
  const { values } = parse("summary", {
    args: argv2,
    options: { all: { type: "boolean" }, json: { type: "boolean" } },
    allowPositionals: false
  });
  const nowMs = ctx.clock.now();
  const nowSec = Math.floor(nowMs / 1e3);
  const machineErrors = [];
  const machine = machineConfig(ctx, machineErrors);
  if (values.all !== true) {
    const summary = summarize(ctx, openProject(ctx), machine, machineErrors, nowMs);
    if (values.json === true) printJson(ctx, summary);
    else ctx.stdout(formatSummary(summary, nowSec) + "\n");
    return 0;
  }
  const summaries = [];
  for (const entry of listProjects(ctx.home)) {
    if (!existsSync24(entry.root)) continue;
    let project;
    try {
      project = openRoot(entry.root);
    } catch (err) {
      if (!(err instanceof ArbabError)) throw err;
      ctx.stderr(`${entry.root}: skipped: ${err.message}
`);
      continue;
    }
    summaries.push(summarize(ctx, project, machine, machineErrors, nowMs));
  }
  if (values.json === true) printJson(ctx, summaries);
  else if (summaries.length === 0) ctx.stdout("no projects recorded on this machine\n");
  else ctx.stdout(summaries.map((s) => `== ${s.root} ==
${formatSummary(s, nowSec)}`).join("\n\n") + "\n");
  return 0;
}

// src/commands/ui.ts
import { randomBytes as randomBytes4 } from "node:crypto";
import { basename as basename8 } from "node:path";

// src/ui/client/app/bundle.ts
var UI_SCRIPT = '"use strict";(()=>{var ca=Object.defineProperty;var ua=(e,t,n)=>t in e?ca(e,t,{enumerable:!0,configurable:!0,writable:!0,value:n}):e[t]=n;var xt=(e,t,n)=>ua(e,typeof t!="symbol"?t+"":t,n);var st={page:"/",script:"/app.js",style:"/app.css",events:"/events",snapshot:"/snapshot.json",icon:"/icon.svg"},So="token",vo={snapshot:"snapshot",problem:"problem"};var L={spawn:{x:-16,y:248},exit:{x:-16,y:258},camp:{x:22,y:204},arbab:{x:116,y:262},audience:{x:144,y:260},rations:{x:86,y:262},treasury:{x:62,y:264},well:{x:444,y:206},horizon:{x:496,y:196},sledge:{x:402,y:208}},Je={columns:5,rows:2,step:12,rowStep:16},q={centerX:268,baseY:208,maxWidth:228,maxHeight:104},me={w:12,h:18},Eo={w:16,h:26};function da(e){let t=4;for(;t*(t+1)/2<e;)t+=1;return t}function Mo(e){let t=da(Math.max(0,Math.floor(e))),{centerX:n,baseY:o,maxWidth:r,maxHeight:s}=q,i=Math.min(32,Math.floor(r/t));i-=i%2;let a=Math.min(i/2,Math.floor(s/t));i=Math.min(i,2*a);let l=[];for(let u=0;u<t;u+=1){let d=t-u,f=n-d*i/2,m=o-(u+1)*a;for(let y=0;y<d;y+=1)l.push({x:f+y*i,y:m,w:i,h:a,course:u})}return{base:t,blockW:i,blockH:a,slots:l,apex:{x:n,y:o-t*a}}}function Er(e){let t=Je.columns*Je.rows,n=(Math.floor(e)%t+t)%t,o=Math.floor(n/Je.columns),r=n%Je.columns;return{x:L.camp.x+r*Je.step+o*Je.step/2,y:L.camp.y+o*Je.rowStep}}var Co=[152,108,64];function Cr(e,t){let n=Co[Math.min(Co.length-1,Math.max(0,Math.floor(e)))]??Co[0],o=Math.min(22,Math.max(8,Math.round(8+.6*t)));return{x:n,y:128,height:o}}function An(e){return{x:e.x+e.w/2,y:e.y+e.h}}var fa=600*1e3,Po=q.baseY,Ze=Po+2,Mr=28,pa=18,Ln=16,Nn=.8,Ao=3,Ar=.15,ma=1.2,Lr=.4,ha=6,ga=.2,ba=2,ya=.6,xa=1,wa=300,Nr=300,ka=60,Sa=48,va=4,Ea=3,Ca=2,Ma=20,Aa=100,La=12,Na=6,Ta=5,Ra=18e3,Pa=1.5,Oa=2,Ba=3,Fa=6,Ia=4,Tr=.25,Da=.5,Ua=new Set(["walk","slump","carry-scroll","carry-stone","carry-ration"]);function Tn(e){switch(e.kind){case"verify":return"surveyor";case"review":return"scribe";case"skeptic":return"skeptic";case"preflight":return"waterboy"}switch(e.role){case"implementer":return"laborer";case"verifier":return"mason";case"reviewer":return"scribe";case"probe":return"waterboy";case"researcher":return"scout";default:return"waterboy"}}function To(e){return e.kind==="lane"&&(e.role==="implementer"||e.role==="verifier"&&e.worktreeOf===null)}function qe(e){if(e===null)return-1/0;let t=Date.parse(e);return Number.isFinite(t)?t:-1/0}function Ro(e,t){let n=null,o=-1/0;for(let r of e){let s=t(r);(n===null||s>=o)&&(n=r,o=s)}return n}function Pr(e){let t=qe(e.now),n=e.integrations.map((d,f)=>({integration:d,index:f,at:qe(d.landedAt)})).filter(d=>d.integration.landedAt!==null).sort((d,f)=>d.at===f.at?f.index-d.index:f.at>d.at?1:-1).map(d=>d.integration),o=new Set(n.filter(d=>Number.isFinite(t)&&t-qe(d.landedAt)<fa)),r=n.find(d=>o.has(d))??null,s=new Map(e.integrations.map(d=>[d.name,d])),i=e.lanes.filter(d=>{if(!To(d))return!1;if(d.integration===null)return!0;let f=s.get(d.integration);return f===void 0?!1:f.landedAt===null||o.has(f)}),a=r;if(a===null){let d=new Set(i.map(m=>m.name)),f=e.integrations.filter(m=>m.landedAt===null&&m.lanes.some(y=>d.has(y)));a=Ro(f,m=>qe(m.updatedAt))}let l=i.length===0&&r===null?n[0]??null:null,u=n.filter(d=>!o.has(d)&&d!==l).slice(0,3);return{lanes:i,capstone:a,capstoneLanded:r!==null,monument:l,far:u}}function Or(e){let t=Pr(e);if(t.capstone!==null)return t.capstone;if(t.monument!==null)return t.monument;let n=e.integrations.filter(o=>o.landedAt===null);return n.length>0?Ro(n,o=>qe(o.updatedAt)):Ro(e.integrations,o=>qe(o.landedAt))}function Oo(e){let t=Number.isFinite(e)?Math.max(0,e):0;return Math.min(.95,1-Math.exp(-t/40))}function $a(e){let t=e.costDeltaUsd??e.costUsd??0,n=Number.isFinite(t)?t:0;return n<1?1:n<5?2:3}function _a(e){return e.reportStatus==="partial"?1:e.reportStatus==="blocked"?0:e.endState==="success"?$a(e):0}function Br(e){switch(e.state){case"running":return"building";case"waiting-reset":return"stalled";case"orphaned":return"orphaned";case"finished":return e.reportStatus==="partial"||e.reportStatus==="blocked"?"stalled":e.endState==="success"?"set":"fallen";default:return"planned"}}function Fr(e){return Br(e)==="set"}function Ga(e){return typeof e.costUsd=="number"&&Number.isFinite(e.costUsd)?Math.max(0,e.costUsd):0}function Ha(e){return e<.5?2*e*e:1-(-2*e+2)**2/2}function Ae(e,t,n={}){return{kind:"go",to:e,pose:t,...n}}function Ee(e,t,n={}){return{kind:"hold",pose:e,time:t,...n}}function it(e,t){e.pose!==t&&(e.pose=t,e.poseTime=0)}function Lo(e){let t=q.maxWidth/2;return e.y<Po&&e.x>=q.centerX-t&&e.x<=q.centerX+t}function Wa(e,t){return e.x===t.x&&e.y===t.y}function Rr(e,t,n,o){return{id:e,lane:t,cast:n,x:o.x,y:o.y,facing:1,pose:"idle",poseTime:0,stroke:0,ration:0,icon:null,bubble:null,alpha:1,ghost:!1,highlight:!1}}function No(e){return{lane:null,x:e.x,y:e.y,w:e.w,h:e.h,look:"empty",fill:0,flash:0,highlight:!1}}function Bo(e){let t=e.reducedMotion,n=e.random,o=Rr("arbab",null,"arbab",L.arbab),r=Mo(0),s={sky:{phase:"day",sun:.5},pyramid:{base:r.base,blockW:r.blockW,blockH:r.blockH,blocks:r.slots.map(No),rubble:0,apex:{...r.apex},capstone:{state:"none",integration:null,...L.sledge,flag:"none",ready:!1,glow:0},monument:null},far:[],actors:[o],particles:[],coins:0,events:[],reducedMotion:t,time:0,shake:0},i=new Map,a=new Map,l=new Map,u=[],d=null,f=new Map,m=new Map,y=!1,E=0,g=null,w=0,x=0,k=null,S=!1,C=()=>Math.floor(n()*2147483647),O=(c,p)=>{s.events.push({kind:c,lane:p})},I=()=>({x:q.centerX,y:Ze}),P=()=>r.base*r.blockW/2,G=(c,p)=>{let b=q.centerX-P();return Math.round(b+(c+(p-c)*n())*2*P())};function Y(c){if(c.builder){let p=f.get(c.lane.name);return p?An(p):I()}switch(c.actor.cast){case"mason":{let p=c.lane.worktreeOf===null?void 0:f.get(c.lane.worktreeOf);if(!p)return I();let b=An(p);return{x:b.x+Ta,y:b.y}}case"surveyor":return{x:L.sledge.x-14,y:Ze};default:return null}}function Oe(){let c=r.slots.filter(b=>b.course<2),p=c[Math.min(c.length-1,Math.floor(n()*c.length))];return p?An(p):I()}function Be(c){switch(c.actor.cast){case"scribe":case"skeptic":return Oe();case"waterboy":return{...L.well};default:return{x:G(.5,1),y:Ze}}}let ve=c=>c.x<0||c.x>480;function Fe(c,p){if(p!=="work")return p;let b=Y(c)??I();return c.spot=b,b}function fe(c,p,b){let h=b==="slump"?pa:Mr,v=b==="carry-stone"?"climb-stone":"climb",M=[],B=Lo(c),_=Lo(p);return B&&_&&c.x===p.x?[{kind:"move",x:p.x,y:p.y,pose:p.y<c.y?v:"climb",speed:Ln}]:(B&&M.push({kind:"move",x:c.x,y:Ze,pose:"climb",speed:Ln}),_?(M.push({kind:"move",x:p.x,y:Ze,pose:b,speed:h}),M.push({kind:"move",x:p.x,y:p.y,pose:v,speed:Ln})):M.push({kind:"move",x:p.x,y:p.y,pose:b,speed:h}),M)}function Ie(c){if(c.seat!==null)return c.seat;let p=new Set;for(let h of i.values())h.seat!==null&&p.add(h.seat);let b=0;for(;p.has(b);)b+=1;return c.seat=b,b}function De(c){let p=u.indexOf(c);p>=0&&u.splice(p,1),d?.crew===c&&(d=null,o.bubble=null,c.actor.bubble=null)}function le(c){De(c),c.seat=null,i.get(c.lane.name)===c&&i.delete(c.lane.name),S=!0}function ne(c,p,b,h,v,M){if(t)return;let B={kind:c,x:p,y:b,vx:h,vy:v,life:M};s.particles.push(B),s.particles.length>Nr&&s.particles.splice(0,s.particles.length-Nr)}function nt(c){if(c.paid=!0,O("pay",c.lane.name),t)return;let p=3+Math.floor(n()*3);for(let b=0;b<p;b+=1){let h=L.treasury.x+(n()-.5)*6;ne("coin",h,L.treasury.y-8,(n()-.5)*24,-40-n()*15,.6)}}let pe=c=>{s.pyramid.rubble=Math.min(ka,s.pyramid.rubble+c)};function Ue(c){De(c);let p=c.lane,b=c.actor;switch(p.state!=="queued"&&p.state!=="held"&&(c.seat=null),c.queue=[],c.loop=!1,c.spot=null,c.begun=!1,c.elapsed=0,c.chatIn=null,c.chatLeft=0,c.descending=!1,b.alpha=1,b.stroke=0,b.bubble=null,p.state){case"queued":case"held":{let h=p.state==="held"?{icon:p.hold==="slot"?"dots":"hourglass"}:{};c.queue.push(Ae(Er(Ie(c)),"walk"),Ee("sit",1/0,h));break}case"preparing":case"running":c.briefed||c.queue.push({kind:"talk",event:"brief"}),Y(c)!==null?c.queue.push(Ae("work",c.builder?"carry-stone":"walk"),Ee("work",1/0,{faceCenter:!0})):c.loop=!0;break;case"waiting-reset":{let h=Y(c)!==null?"work":c.briefed&&!ve(b)?{x:b.x,y:b.y}:Be(c);c.queue.push(Ae(h,"walk"),Ee("sleep",1/0,{icon:"zzz",faceCenter:!0}));break}case"finished":{let h=_a(p);c.queue.push({kind:"talk",event:"report"},Ae({...L.rations},"walk"),Ee("idle",ya),Ae({...L.exit},h>0?"carry-ration":"slump",{ration:h}),{kind:"exit"});break}case"orphaned":ve(b)&&c.queue.push(Ae(Y(c)!==null?"work":Be(c),"walk")),c.queue.push(Ee("idle",1/0,{ghost:!0,icon:"question"}));break;default:c.queue.push(Ee("idle",1/0))}Ye(c,0)}function ht(c){switch(c.actor.cast){case"scribe":case"skeptic":return[Ae(Oe(),"walk"),Ee("work",3+3*n(),{faceCenter:!0})];case"waterboy":return[Ae({...L.well},"walk"),Ee("idle",1),Ae({x:G(0,1),y:Ze},"walk"),Ee("idle",1)];case"scout":{let p=6+4*n();return[Ae({...L.horizon},"walk"),Ee("idle",p,{alpha:0}),Ae({x:G(.5,1),y:Ze},"walk",{alpha:1}),Ee("idle",2)]}default:return[Ee("idle",1/0)]}}function $e(c){c.queue.shift(),c.begun=!1,c.elapsed=0}function Gt(c,p){let b=c.actor;if(b.bubble=null,b.stroke=0,c.chatLeft=0,p.kind==="go"){let h=Fe(c,p.to);return p.alpha!==void 0&&(b.alpha=p.alpha),p.ration!==void 0&&(b.ration=p.ration),p.ration!==void 0&&p.ration>0&&!c.paid&&nt(c),c.queue.splice(0,1,...fe(b,h,p.pose)),!0}return b.icon=p.kind==="hold"?p.icon??null:null,b.ghost=p.kind==="hold"&&p.ghost===!0,p.kind==="hold"&&(it(b,p.pose),p.alpha!==void 0&&(b.alpha=p.alpha),p.faceCenter&&(b.facing=b.x<=q.centerX?1:-1)),!1}function Ht(c,p,b,h,v){let M=p.x-c.x,B=p.y-c.y,_=Math.hypot(M,B);return _===0?v:(M!==0&&(c.facing=M>0?1:-1),it(c,b),t||h*v>=_?(c.x=p.x,c.y=p.y,t?v:Math.max(0,v-_/h)):(c.x+=M/_*h*v,c.y+=B/_*h*v,-1))}function Ye(c,p){let b=c.actor,h=p;for(let v=0;v<64;v+=1){if(i.get(c.lane.name)!==c)return;if(c.queue.length===0){if(!c.loop){it(b,"idle");return}c.queue=ht(c),c.begun=!1}let M=c.queue[0];if(M===void 0)return;if(!c.begun&&(c.begun=!0,c.elapsed=0,Gt(c,M))){c.begun=!1;continue}switch(M.kind){case"go":continue;case"move":if(h=Ht(b,M,M.pose,M.speed,h),h<0)return;$e(c);continue;case"hold":{let B=Math.min(h,M.time-c.elapsed);if(c.elapsed+=B,h-=B,M.pose==="work"&&xo(c,B),c.elapsed<M.time)return;$e(c);continue}case"talk":if(h=yo(c,M.event,h),h<0)return;$e(c);continue;case"exit":le(c);return}}}function yo(c,p,b){let h=c.actor,v=b;if(u.includes(c)||u.push(c),d?.crew!==c){let yt=u.indexOf(c);if(yt>Na)return h.pose!=="sit"&&it(h,"idle"),-1;if(Lo(h)&&(c.descending=!0),c.descending){if(v=Ht(h,{x:h.x,y:Ze},"climb",Ln,v),v<0)return-1;c.descending=!1}let Mn={x:L.audience.x+La*yt,y:L.audience.y};if(v=Ht(h,Mn,"walk",Mr,v),v<0)return-1;if(h.facing=-1,yt!==0||d!==null)return it(h,"idle"),-1;d={crew:c,t:0,turn:-1}}let M=d;M.t+=v;let B=Math.min(Ao-1,Math.floor(M.t/Nn));for(;M.turn<B;){M.turn+=1;let yt=M.turn===1,Mn={seed:C(),open:0};h.bubble=yt?Mn:null,o.bubble=yt?null:Mn}let _=M.turn===1?h:o;if(_.bubble&&(_.bubble.open=t?1:Math.min(1,(M.t-M.turn*Nn)/Ar)),it(h,M.turn===1?"talk":"idle"),h.facing=-1,M.t<Ao*Nn)return-1;let Qe=M.t-Ao*Nn;d=null,o.bubble=null,h.bubble=null;let vr=u.indexOf(c);return vr>=0&&u.splice(vr,1),p==="brief"&&(c.briefed=!0),O(p,c.lane.name),Qe}function xo(c,p){let b=c.actor,h=p;for(;h>0&&c.pending>0;){let v=b.stroke,M=(1-v)*Lr;h>=M?(b.stroke=1,h-=M):(b.stroke=v+h/Lr,h=0),v<.5&&b.stroke>=.5&&xn(c),b.stroke>=1&&(b.stroke=0,c.pending-=1)}b.cast==="skeptic"&&wn(c,p)}function xn(c){if(!c.builder)return;let p=c.lane.name,b=a.get(p);if(!b||!f.has(p))return;let h=l.get(p)??0,v=t?h:b.fill+Math.max(.02,(h-b.fill)/Math.max(1,c.pending));if(b.fill=Math.max(b.fill,Math.min(h,v)),b.flash=1,!t){let M=3+Math.floor(n()*3);for(let B=0;B<M;B+=1){let _=b.x+n()*b.w,Qe=b.y+n()*b.h;ne("dust",_,Qe,(n()-.5)*16,-(10+20*n()),.5)}}O("stone",p)}function wn(c,p){let b=c.actor;if(c.chatLeft>0){c.chatLeft-=p,b.bubble&&(b.bubble.open=t?1:Math.min(1,b.bubble.open+p/Ar)),c.chatLeft<=0&&(b.bubble=null,c.chatIn=4+4*n());return}c.chatIn===null&&(c.chatIn=4+4*n()),c.chatIn-=p,c.chatIn<=0&&(b.bubble={seed:C(),open:t?1:0},c.chatLeft=ma)}function Ve(c){let p=Math.round(c.fill*8);if(t)pe(p);else{for(let b=0;b<p;b+=1){let h=c.x+n()*c.w,v=c.y+n()*c.h;ne("stone",h,v,(n()*2-1)*40,0,5)}s.shake=Math.max(s.shake,Oa)}c.fill=0,O("fall",c.lane)}function Wt(c,p,b){let h=c.name,v=Br(c),M=Oo(c.toolCalls);l.set(h,M);let B=f.get(h),_=a.get(h),Qe=_===void 0;if(_===void 0&&(_={lane:h,x:0,y:0,w:0,h:0,look:v,fill:0,flash:0,highlight:!1},a.set(h,_)),B&&Object.assign(_,{x:B.x,y:B.y,w:B.w,h:B.h}),Qe||p===void 0){_.look=v,_.flash=0,v==="set"?_.fill=1:v==="planned"||v==="fallen"||!b&&v==="building"?_.fill=0:_.fill=M,b&&v==="fallen"&&pe(va);return}p.state==="finished"&&c.state!=="finished"&&(_.fill=0,_.flash=0),v!==_.look&&B&&(v==="set"?(_.fill=1,_.flash=1,O("set",h)):v==="fallen"&&Ve(_)),_.look=v,t&&v==="building"&&(_.fill=Math.max(_.fill,M))}function Yt(c){let p={actor:Rr(c.name,c.name,Tn(c),L.spawn),lane:c,builder:To(c),queue:[],begun:!1,elapsed:0,loop:!1,briefed:!1,pending:0,spot:null,seat:null,fading:!1,descending:!1,chatIn:null,chatLeft:0,dust:0,paid:!1};return i.set(c.name,p),S=!0,p}function gt(c){let p=c.actor;for(let b=0;b<64;b+=1){if(c.queue.length===0){if(!c.loop)break;c.queue=ht(c),c.begun=!1}let h=c.queue[0];if(h===void 0)break;if(h.kind==="go"){let v=Fe(c,h.to);h.alpha!==void 0&&(p.alpha=h.alpha),p.x=v.x,p.y=v.y,$e(c)}else if(h.kind==="move")p.x=h.x,p.y=h.y,$e(c);else break}Ye(c,0)}function kn(c,p,b){let h=c.name,v=i.get(h);if(v?.fading&&(le(v),v=void 0),To(c)?Wt(c,p,b):(a.delete(h),l.delete(h)),b){if(c.state==="finished")return;let M=Yt(c);M.briefed=c.state!=="queued"&&c.state!=="held",Ue(M),gt(M);return}if(v===void 0){if(c.state==="finished")return;v=Yt(c),Ue(v)}else v.lane=c,(p===void 0||p.state!==c.state||c.state==="held"&&p.hold!==c.hold)&&(p?.state==="finished"&&(v.briefed=!1,v.actor.ration=0),c.state!=="running"&&(v.pending=0),Ue(v));if(c.state==="running"){let M=p!==void 0&&p.attempt===c.attempt?p.toolCalls:0,B=c.toolCalls-M;B>0&&(v.pending=Math.min(ha,v.pending+B))}}function Sn(c){let p=i.get(c);p&&!p.fading&&(De(p),p.seat=null,p.fading=!0,p.queue=[],p.loop=!1,p.pending=0,p.spot=null,p.actor.stroke=0,p.actor.bubble=null),a.delete(c),l.delete(c)}function ot(c){let p=s.pyramid.capstone;p.integration=c.name,p.flag=c.verify==="passed"?"passed":c.verify==="failed"?"failed":"none",p.ready=c.ready===!0}function vn(){Object.assign(s.pyramid.capstone,{state:"hoisting",...L.sledge,glow:0}),E=0,bt()}function wo(c,p){let b=s.pyramid.capstone,h=c.capstone,v=b.state==="hoisting"||w>0;if(c.capstoneLanded&&h!==null&&v&&b.integration!==h.name){g=h;return}if(g=null,w=0,c.monument!==null){ot(c.monument),Object.assign(b,{state:"set",...s.pyramid.apex,ready:!0,glow:0});return}if(h===null){Object.assign(b,{state:"none",integration:null,...L.sledge,flag:"none",ready:!1,glow:0});return}let M=b.integration===h.name;if(ot(h),!c.capstoneLanded){Object.assign(b,{state:"waiting",...L.sledge,glow:0});return}if(!(M&&b.state==="hoisting")){if(M&&b.state==="set"){Object.assign(b,s.pyramid.apex);return}if(p){Object.assign(b,{state:"set",...s.pyramid.apex,glow:0});return}vn(),t&&rt()}}function rt(){let c=s.pyramid.capstone,p=s.pyramid.apex;Object.assign(c,{state:"set",...p,glow:1}),bt(),t||(s.shake=Math.max(s.shake,Ba));for(let b=0;b<Ma&&!t;b+=1){let h=p.x+(n()-.5)*8,v=p.y-n()*6;ne("sparkle",h,v,(n()-.5)*12,-n()*10,.8)}O("capstone",c.integration),x=Ca}function ko(c){let p=qe(c.now)/1e3,b=c.quota,h=B=>B!==null&&Number.isFinite(p)&&B.resetsAt>p?B:null,v=h(b.fiveHour),M=h(b.sevenDay);s.sky.phase=b.status==="rejected"&&(v!==null||M!==null)?"night":b.hold.hold?"dusk":"day",s.sky.sun=v!==null?Math.min(1,Math.max(0,1-(v.resetsAt-p)/Ra)):.5}function Xe(c,p){let b=c.lanes.reduce((v,M)=>v+Ga(M),0),h=Math.min(Sa,Math.round(6*Math.sqrt(b)));if(!p&&h>s.coins&&!t){let v=1+Math.floor(n()*3);for(let M=0;M<v;M+=1){let B=L.treasury.x+(n()-.5)*6;ne("coin",B,L.treasury.y-8,(n()-.5)*20,-40,.6)}}s.coins=h}function qt(c){let p=s.pyramid;p.base=r.base,p.blockW=r.blockW,p.blockH=r.blockH,p.apex={...r.apex};let b=c.monument;if(p.monument=b===null?null:b.name,b!==null){p.blocks=r.slots.map((h,v)=>({...No(h),lane:b.lanes[v]??null,look:"set",fill:1}));return}p.blocks=r.slots.map((h,v)=>{let M=c.lanes[v],B=M===void 0?void 0:a.get(M.name);return B===void 0?No(h):(Object.assign(B,{x:h.x,y:h.y,w:h.w,h:h.h}),B)}),p.capstone.state==="set"&&Object.assign(p.capstone,p.apex)}function bt(){let c=s.pyramid.capstone.state==="set";for(let p of s.pyramid.blocks)p.lane===null&&(p.look=c?"set":"empty",p.fill=c?1:0)}function En(c){for(let p of[...i.values()]){if(p.fading||u.includes(p))continue;let b=Y(p);(p.spot!==null&&b!==null&&!Wa(p.spot,b)||c&&p.loop&&(p.lane.state==="running"||p.lane.state==="preparing"))&&Ue(p)}}function Kt(){if(S){S=!1,s.actors.length=0,s.actors.push(o);for(let c of i.values())s.actors.push(c.actor);R()}}function R(){for(let c of s.actors)c.highlight=k!==null&&c.lane===k;for(let c of s.pyramid.blocks)c.highlight=k!==null&&c.lane===k}function D(){o.x=L.arbab.x,o.y=L.arbab.y,o.facing=1,it(o,x>0?"cheer":d!==null&&d.turn>=0&&d.turn!==1?"talk":"idle")}function $(c){let p=!y;y=!0;let b=Pr(c);ko(c);let h=r;r=Mo(b.monument===null?b.lanes.length:b.monument.lanes.length);let v=h.base!==r.base||h.blockW!==r.blockW||h.blockH!==r.blockH;f=new Map,b.lanes.forEach((B,_)=>{let Qe=r.slots[_];Qe&&f.set(B.name,Qe)}),s.pyramid.apex={...r.apex};let M=new Set(c.lanes.map(B=>B.name));for(let B of m.keys())M.has(B)||Sn(B);for(let B of c.lanes)kn(B,m.get(B.name),p);qt(b),En(v),wo(b,p),bt(),s.far=b.far.map((B,_)=>({integration:B.name,...Cr(_,B.lanes.length)})),Xe(c,p),m=new Map(c.lanes.map(B=>[B.name,B])),S=!0,Kt(),D()}function Q(c){let p=Math.min(Aa,Number.isFinite(c)?Math.max(0,c):0)/1e3;if(p<=0)return;s.time+=p,o.poseTime+=p,s.shake=Math.max(0,s.shake-Fa*p);let b=s.pyramid.capstone;b.glow=Math.max(0,b.glow-p/Ia);for(let h of a.values())h.flash=Math.max(0,h.flash-ba*p);for(let h of[...i.values()]){if(h.actor.poseTime+=p,h.fading){h.actor.alpha=Math.max(0,h.actor.alpha-p/xa),h.actor.alpha<=0&&le(h);continue}let{x:v,y:M}=h.actor;Ye(h,p),se(h,p,h.actor.x!==v||h.actor.y!==M)}for(let[h,v]of a){if(v.look!=="building")continue;let M=l.get(h)??0;t?v.fill=Math.max(v.fill,M):(i.get(h)?.pending??0)===0&&v.fill<M&&(v.fill=Math.min(M,v.fill+ga*p))}if(b.state==="hoisting"){E=Math.min(1,E+p/Ea);let h=Ha(E),v=s.pyramid.apex;b.x=L.sledge.x+(v.x-L.sledge.x)*h,b.y=L.sledge.y+(v.y-L.sledge.y)*h,E>=1&&(rt(),g!==null&&(w=Pa))}else w>0&&(w=Math.max(0,w-p),w===0&&g!==null&&(ot(g),g=null,vn()));ye(p),x=Math.max(0,x-p),D(),Kt()}function se(c,p,b){let h=c.actor;if(!(t||!b||!Ua.has(h.pose)))for(c.dust+=p;c.dust>=Tr;)c.dust-=Tr,ne("dust",h.x,h.y,-4+8*n(),-6+4*n(),Da)}function ye(c){let p=0;for(let b of s.particles){if(b.x+=b.vx*c,b.y+=b.vy*c,(b.kind==="stone"||b.kind==="coin")&&(b.vy+=wa*c),b.life-=c,b.kind==="stone"&&b.y>=Po){pe(1);continue}b.life<=0||(s.particles[p]=b,p+=1)}s.particles.length=p}function _e(c,p){let b=s.actors.map((h,v)=>({a:h,i:v})).filter(({a:h})=>h.lane!==null&&h.cast!=="arbab"&&h.alpha>=.1).sort((h,v)=>v.a.y===h.a.y?v.i-h.i:v.a.y-h.a.y);for(let{a:h}of b)if(c>=h.x-me.w/2&&c<=h.x+me.w/2&&p>=h.y-me.h&&p<=h.y)return h.lane;for(let h of s.pyramid.blocks)if(h.lane!==null&&c>=h.x&&c<h.x+h.w&&p>=h.y&&p<h.y+h.h)return h.lane;return null}function Cn(c){k=c,R()}return{world:s,apply:$,step:Q,pick:_e,highlight:Cn}}var Ya=new Set(["queued","held","preparing","running","waiting-reset"]),Ir=e=>Ya.has(e);function wt(e){let t=Math.floor(e/1e3),n=Math.floor(t/3600),o=Math.floor(t%3600/60),r=t%60,s=i=>String(i).padStart(2,"0");return n>0?`${n}h${s(o)}m`:o>0?`${o}m${s(r)}s`:`${r}s`}function Dr(e,t,n){let o=[];for(let[r,s]of[["5h",e],["7d",t]])s&&s.resetsAt>n&&o.push(`${r} ${Math.round(s.utilization*100)}%`);return o.length>0?o.join(" \\xB7 "):"\\u2014"}var zt="\\u2014";function qa(e,t,n){let o=Number.isFinite(n)&&n>0?n:1,r=Math.min(e/480,t/270);return!Number.isFinite(r)||r<=0?0:Math.floor(r*o+1e-9)/o}function $r(e,t,n){let o=qa(e,t,n);return o>=1?{fluid:!1,scale:o,width:480*o,height:270*o}:Number.isFinite(e)&&e>=480?{fluid:!1,scale:1,width:480,height:270}:{fluid:!0}}var Ka=40;function _r(e,t,n,o){let r=e-t-n-o-Ka;return Number.isFinite(r)?Math.max(0,r):0}function Gr(e){return/^#?(?:.*&)?token=([0-9a-fA-F]{8,128})(?:&.*)?$/.exec(e)?.[1]??null}function Rn(e){return typeof e=="object"&&e!==null&&!Array.isArray(e)}function Hr(e){let t;try{t=JSON.parse(e)}catch{return{ok:!1,message:"The server sent a snapshot that is not JSON."}}return Rn(t)?t.protocol!==1?{ok:!1,message:`This page speaks protocol ${1} and the server speaks ${String(t.protocol)}: reload the page.`}:!Array.isArray(t.lanes)||!Array.isArray(t.integrations)||!Rn(t.quota)?{ok:!1,message:"The server sent a snapshot without lanes, integrations or quota."}:t.lanes.every(n=>Rn(n)&&typeof n.name=="string"&&typeof n.state=="string")?{ok:!0,snapshot:t}:{ok:!1,message:"The server sent a lane without a name or state."}:{ok:!1,message:"The server sent a snapshot that is not an object."}}function Wr(e){try{let t=JSON.parse(e);if(Rn(t)&&typeof t.message=="string"&&t.message!=="")return t.message}catch{}return"The server reported a problem."}function Fo(e){let t={running:0,preparing:0,waiting:0,asleep:0,orphaned:0,succeeded:0,failed:0};for(let n of e)switch(n.state){case"running":t.running++;break;case"preparing":t.preparing++;break;case"queued":case"held":t.waiting++;break;case"waiting-reset":t.asleep++;break;case"orphaned":t.orphaned++;break;case"finished":n.endState==="success"?t.succeeded++:t.failed++;break}return t}function za(e){let t=[];for(let[o,r]of[["running",e.running],["preparing",e.preparing],["waiting",e.waiting],["asleep",e.asleep],["orphaned",e.orphaned]])r>0&&t.push(`${r} ${o}`);let n=[];return e.succeeded>0&&n.push(`\\u2713 ${e.succeeded}`),e.failed>0&&n.push(`\\u2717 ${e.failed}`),n.length>0&&t.push(n.join(" ")),t.length>0?t.join(" \\xB7 "):"no lanes"}function Ke(e){return e===null||!Number.isFinite(e)?zt:`$${e.toFixed(2)}`}function Io(e){return e.reduce((t,n)=>t+(typeof n.costUsd=="number"&&Number.isFinite(n.costUsd)?n.costUsd:0),0)}function Yr(e){let t=Date.parse(e.now),n=Number.isNaN(t)?0:t/1e3,o=e.hiddenLanes>0?` \\xB7 ${e.hiddenLanes} older ${e.hiddenLanes===1?"lane":"lanes"} not shown`:"";return{project:e.project,version:`v${e.version}`,counts:za(Fo(e.lanes)),cost:Ke(Io(e.lanes)),quota:Dr(e.quota.fiveHour,e.quota.sevenDay,n),held:e.quota.hold.hold===!0,footer:`Read-only \\xB7 arbab ${e.version}${o}`}}function ja(e){return e.state==="finished"&&e.endState?`finished (${e.endState})`:e.state==="held"&&e.hold?`held (${e.hold})`:e.state}function kt(e,t){if(e.elapsedMs!==null)return e.elapsedMs;if(!Ir(e.state))return null;let n=Date.parse(e.since);return Number.isNaN(n)?null:Math.max(0,t-n)}function qr(e,t,n){let o=kt(e,t+n),r=[e.name,`${e.role} \\xB7 ${e.kind}`,ja(e),`attempt ${e.attempt}`,`elapsed ${o===null?zt:wt(o)}`,`tool calls ${e.toolCalls}`,`last tool ${e.lastTool??zt}`,`cost ${Ke(e.costUsd)}`,`${e.model??zt} \\xB7 ${e.effort??zt}`];return e.hold&&r.push(`held for ${e.hold==="quota"?"the quota":"a free slot"}`),e.reason&&r.push(e.reason),r}var jt={running:0,preparing:1,"waiting-reset":2,held:3,queued:4,orphaned:5,finished:6},Va=new Set(["preparing","running"]),Xa=new Set(["preparing","running","waiting-reset"]);function Do(e,t){return Va.has(e.state)&&!(t!==void 0&&Xa.has(t.state))}function Kr(e,t){if(!e)return[];let n=[],o=new Map(e.lanes.map(s=>[s.name,s]));for(let s of t.lanes){let i=o.get(s.name);Do(s,i)&&n.push(`${s.name} started`),s.state==="finished"&&i&&i.state!=="finished"&&n.push(`${s.name} finished: ${s.endState??"unknown"}`)}let r=new Set(e.integrations.filter(s=>s.landedAt!==null).map(s=>s.name));for(let s of t.integrations)s.landedAt!==null&&!r.has(s.name)&&e.integrations.some(i=>i.name===s.name)&&n.push(`${s.name} landed`);return n}var Qa=60;function St(e){let t=Math.max(0,Math.floor(e/1e3));if(t<60)return"just now";let n=Math.floor(t/60);if(n<60)return`${n}m ago`;let o=Math.floor(n/60);return o<48?`${o}h ago`:`${Math.floor(o/24)}d ago`}function Vt(e,t){if(e===null)return t;let n=Date.parse(e);return Number.isFinite(n)?n:t}function zr(e){return Vt(e.now,0)}function jr(e,t){let n=Vt(e.since,t),o=e.attempt>1?` (attempt ${e.attempt})`:"";return{id:`started:${e.name}:${e.attempt}:${n}`,at:n,kind:"started",text:`${e.name} started${o}`}}function Vr(e,t){let n=Vt(e.since,t),o=e.endState??"unknown",r=e.costUsd===null?"":` \\xB7 ${Ke(e.costUsd)}`;return{id:`finished:${e.name}:${e.attempt}:${n}`,at:n,kind:e.endState==="success"?"finished":"failed",text:`${e.name} finished: ${o}${r}`}}function Xr(e,t){let n=Vt(e.since,t);if(e.state==="held"){let r=e.hold==="slot"?"a free slot":"the quota";return{id:`held:${e.name}:${n}`,at:n,kind:e.hold==="slot"?"waiting":"held",text:`${e.name} held for ${r}`}}let o=e.state==="waiting-reset"?"asleep until the quota resets":"queued";return{id:`waiting:${e.name}:${e.state}:${n}`,at:n,kind:"waiting",text:`${e.name} ${o}`}}function Qr(e,t){return{id:`landed:${e.name}`,at:Vt(e.landedAt,t),kind:"landed",text:`${e.name} landed`}}function Ja(e,t){let n=e.verify==="passed";return{id:`verify:${e.name}:${e.headSha}:${e.verify}`,at:t,kind:n?"verify-passed":"verify-failed",text:`${e.name} verify ${n?"passed":"failed"}`}}function Uo(e,t,n=Qa){let o=new Set,r=[];for(let s of[...t,...e])o.has(s.id)||(o.add(s.id),r.push(s));return r.sort((s,i)=>i.at-s.at).slice(0,n)}function Jr(e){let t=zr(e),n=[];for(let o of e.lanes)o.state==="finished"?n.push(Vr(o,t)):o.state==="running"||o.state==="preparing"?n.push(jr(o,t)):(o.state==="queued"||o.state==="held"||o.state==="waiting-reset")&&n.push(Xr(o,t));for(let o of e.integrations)o.landedAt!==null&&n.push(Qr(o,t));return Uo([],n)}function Zr(e,t){let n=zr(t),o=[],r=new Map(e.lanes.map(i=>[i.name,i]));for(let i of t.lanes){let a=r.get(i.name);Do(i,a)&&o.push(jr(i,n)),i.state==="finished"&&a&&a.state!=="finished"&&o.push(Vr(i,n)),i.state==="held"&&i.hold==="quota"&&!(a&&a.state==="held"&&a.hold==="quota")&&o.push(Xr(i,n))}let s=new Map(e.integrations.map(i=>[i.name,i]));for(let i of t.integrations){let a=s.get(i.name);i.landedAt!==null&&(!a||a.landedAt===null)&&o.push(Qr(i,n)),i.verify!==null&&(!a||a.verify!==i.verify||a.headSha!==i.headSha)&&o.push(Ja(i,n))}return o}function es(e){switch(e){case"started":return"\\u2192";case"finished":case"verify-passed":return"\\u2713";case"failed":case"verify-failed":return"\\u2717";case"landed":return"\\u25C6";default:return"\\u23F3"}}var Za={none:"",waiting:"capstone waiting",hoisting:"capstone rising",set:"capstone set"};function $o(e){let t=e.pyramid,n=t.blocks.filter(r=>r.lane!==null),o=n.filter(r=>r.look==="set").length;return`${t.monument??""}|${o}/${n.length}|${t.capstone.state}|${t.capstone.integration??""}|${t.capstone.flag}`}function ts(e,t,n){let o=n.pyramid;if(o.monument!==null){let a=e.integrations.find(f=>f.name===o.monument),l=a?.landedAt?Date.parse(a.landedAt):Number.NaN,u=Number.isFinite(l)?` \\xB7 landed ${St(t-l)}`:"",d=a?a.lanes.length:o.blocks.filter(f=>f.lane!==null).length;return`monument \\xB7 ${o.monument} \\xB7 ${d} ${d===1?"block":"blocks"}${u}`.toUpperCase()}let r=o.blocks.filter(a=>a.lane!==null),s=o.capstone;if(r.length===0&&s.state==="none")return"THE SITE IS QUIET";let i=[];return s.state!=="none"&&s.integration!==null&&i.push(s.integration),i.push(`${r.filter(a=>a.look==="set").length}/${r.length} blocks set`),s.state!=="none"&&(i.push(Za[s.state]),i.push(`verify ${s.flag==="passed"?"\\u2713":s.flag==="failed"?"\\u2717":"\\xB7"}`)),i.join(" \\xB7 ").toUpperCase()}function T(e,t,n="",o=null){let r=e.createElement(t);return n!==""&&(r.className=n),o!==null&&(r.textContent=o),r}function Xt(e){return e&&typeof e.getContext=="function"?e:null}function ns(e){return Number.isFinite(e)?Math.max(1,Math.round(e)):1}function at(e,t,n,o,r="px"){let s=Xt(e.createElement("canvas"));return s?(s.className=r,s.setAttribute("aria-hidden","true"),Qt(s,t,n,o),s):null}function Qt(e,t,n,o){e.width=t*o,e.height=n*o,e.style.width=`${t}px`,e.style.height=`${n}px`}function _o(e,t){let n=[],o=new Map;for(let s of t){let i=e[s]??0,a=0,l=n.length;for(;a<l;){let u=a+l>>1;(e[n[u]??0]??0)<i?a=u+1:l=u}a>0&&o.set(s,n[a-1]??-1),n[a]=s}let r=[];for(let s=n[n.length-1];s!==void 0&&s>=0;s=o.get(s))r.push(s);return r}function el(e,t,n=null){let o=new Map(e.map((f,m)=>[f,m])),r=t.map(f=>o.get(f)??-1),s=t.map((f,m)=>m).filter(f=>(r[f]??-1)>=0),i=n===null?-1:t.indexOf(n),a=r[i]??-1,l;if(i<0||a<0)l=_o(r,s);else{let f=s.filter(y=>y<i&&(r[y]??0)<a),m=s.filter(y=>y>i&&(r[y]??0)>a);l=[..._o(r,f),i,..._o(r,m)]}let u=new Set(l),d=[];for(let f=t.length-1;f>=0;f--)u.has(f)||d.push({key:t[f]??"",before:t[f+1]??null});return d}function vt(e,t,n,o,r=null){let s=new Set(n),i=t.filter(a=>s.has(a)?!0:(o(a)?.remove(),!1));for(let{key:a,before:l}of el(i,n,r)){let u=o(a);u&&e.insertBefore(u,l===null?null:o(l)??null)}return[...n]}var Wo="#E8E6D8",Zt="#C9C6B4";var On=["#E9C886","#DDB66E","#C89A56","#B5843F"],ge={light:"#F1E2BC",face:"#DCC796",mortar:"#B9A06C",edge:"#8F7A50"},Bn="#8C7A5B",rs="#CDB27E",Ct={gap:"#6E5A3C",crack:"#4A3B26"},Mt={light:"#A7A39A",dark:"#85827A"},U={gleam:"#FFF6C9",light:"#FFD54A",mid:"#E0A800",shadow:"#A87400"},Et={base:"#B9784E",shadow:"#925A38"},Go={white:"#F4F0E2",shadow:"#D6CFBC"},xe="#3A2716",et={laborer:"#C9A46B",mason:"#3C6FB0",scribe:"#6E4C9E",skeptic:"#B23A3A",surveyor:"#3F8F5A",waterboy:"#E2B23A",scout:"#2F6B4F"},Fn="#2A4FA0",K=["#8B5A2B","#6B4220"],Ho={leaf:"#3E7D3A",leafDark:"#2D5E2B",trunk:"#7A5230"},Ge={cloth:"#E7D6B0",shade:"#C2A97A",stripe:"#B23A3A"},tl="#4F8FBF",nl="#C98A3E",os="#8E5B3E",At={fill:"#FFFDF5",glyph:"#5A4630"},Yo={green:"#3FAF5A",red:"#D04040"},In={face:"#F2C14E",shadow:"#C9962C"},qo="#FFFFFF",Lt={day:["#2E6CAF","#3D82C2","#5299CF","#6CAED9","#8DC2E0","#B1D3DF","#D3DDCB","#ECE1BA"],dusk:["#2A2350","#45306A","#6C3B70","#984870","#C25A66","#E0755A","#F1954E","#F6B860"],night:["#060A1C","#0A1027","#0F1733","#151E3E","#1B2648","#222E52","#2A375C","#334166"]},Dn={core:"#FFA640",rim:"#FFCB6B",halo:"#FFB85C"},Un={core:"#FFF7DC",rim:"#FFFCEF",halo:"#FFF3C4"},ss={day:["#FFFDF6","#F1ECDF","#CBD3DD"],dusk:["#FFD39A","#E8968A","#9C5A7C"],night:["#5A6688","#46507A","#343D63"]},J={bright:"#F5F3E8",mid:"#C9CCE0",dim:"#7E86AA"},is={day:"#4A3A3C",dusk:"#3A2236"},as=[{light:"#DCD3C6",face:"#C9BFB6",shade:"#B0A7A9"},{light:"#E5CBA2",face:"#D2B58C",shade:"#B39575"}],ls={light:"#E2BE7C",face:"#D4AA68",shade:"#BF9456"},be={light:"#7E9A4A",face:"#5F7D3A",shade:"#465F2E"},ie={sky:"#9CC9DD",light:"#6FA8CC",face:"#4F8FBF",deep:"#3D78A8",bank:"#A88654"},cs={day:"#E6F4FA",dusk:"#FFE0A8",night:"#A9B6D8"},en={light:"#9CAA52",face:"#6E8A3C",shade:"#4E6A2E",tip:"#C8B068"},V={light:"#EADCB8",face:"#D6C499",shade:"#B5A27C",dark:"#9A8868"},lt=["#CFAA6A","#D8B36F","#DFBC77","#E6C582","#E9C886","#E3BF7A"],tn={light:"#F1D9A2",face:"#ECD195",track:"#D9B878"},ze={light:"#CDB693",face:"#A8906C",shade:"#7E6A4E"},nn={light:"#A3A057",face:"#7C7E43",shade:"#5A5E34"},He={light:"#D9AE73",face:"#BE8E55",shade:"#97693C",dark:"#6E4A2A"},ct={white:"#FFF6D0",yellow:"#FFD24A",orange:"#F68B2C",red:"#D1452A",ember:"#8E2E1E"},Ko="#CFC8C0",zo={light:"#A8A094",shade:"#756E64"},ut={light:"#E0A859",face:"#B37A3A",shade:"#7E5226"},ce={cream:"#F2E4C2",creamShade:"#D7C29A",red:"#B8433A",redShade:"#8E2F2B"},$n={light:"#FBF7EC",shade:"#DCD4C2"},he={light:"#F3E6C2",face:"#E0CD9F",shade:"#C2AA78",edge:"#9C8558"},_n="#3E2A1C",us="#0A0E22",Gn="#FFB45A",ds={day:"#4A321E",dusk:"#2E1830",night:"#05071A"},dt={fill:"#2B1D14",rim:U.mid,text:U.gleam},jo={o:xe,k:Et.base,K:Et.shadow,"*":Et.base,"&":Et.shadow,t:Et.base,T:Et.shadow,w:Go.white,W:Go.shadow,h:et.laborer,H:Jt(et.laborer,.72),s:Go.shadow,n:K[0],N:K[1],l:ge.light,L:ge.face,m:ge.mortar,e:ge.edge,G:U.gleam,y:U.light,Y:U.mid,z:U.shadow,B:Fn,b:nl,j:os,J:Jt(os,.75),a:tl,v:Ho.leaf,V:Ho.leafDark,r:Ho.trunk,c:Ge.cloth,C:Ge.shade,q:Ge.stripe,U:On[3],f:At.fill},ol=Ct.crack;function fs(e){switch(e){case"arbab":return{};case"scribe":case"skeptic":return{h:ol,H:xe,s:et[e]};case"scout":{let t=et.scout;return{h:t,H:Jt(t,.72),t,T:Jt(t,.72)}}default:return{h:et[e],H:Jt(et[e],.72)}}}function Pn(e){if(!/^#[0-9a-fA-F]{6}$/.test(e))throw new Error(`not a #rrggbb color: ${e}`);let t=Number.parseInt(e.slice(1),16);return[t>>16&255,t>>8&255,t&255]}function Vo(e,t,n){let o=r=>Math.max(0,Math.min(255,Math.round(r))).toString(16).padStart(2,"0");return`#${o(e)}${o(t)}${o(n)}`.toUpperCase()}function Jt(e,t){let[n,o,r]=Pn(e);return Vo(n*t,o*t,r*t)}function W(e,t,n){let[o,r,s]=Pn(e),[i,a,l]=Pn(t);return Vo(o+(i-o)*n,r+(a-r)*n,s+(l-s)*n)}function ps(e){let[t,n,o]=Pn(e),r=.3*t+.59*n+.11*o;return Vo(r,r,r)}function Nt(e){return W(e,ps(e),.65)}function ms(e){return W(ps(e),Wo,.55)}var A={bg:"#120d0a","bg-2":"#1b140f",panel:"#241a12","panel-2":"#2e2116","panel-hi":"#3a2a1b","frame-dark":"#0b0705",frame:"#6b4a26","frame-hi":"#a87a3f","frame-lo":"#3a2716",text:"#f4ead2",muted:"#b89f74",faint:"#7d6a4d",gold:"#ffd54a","gold-2":"#e0a800",sand:"#e9c886",sky:"#5ba8d9","st-running":"#5ba8d9","st-preparing":"#8cc6e3","st-waiting":"#e0a800","st-asleep":"#8e7cc3","st-success":"#3faf5a","st-failed":"#d04040","st-orphaned":"#85827a","badge-failed":"#b23a3a"},Xo=Object.fromEntries(Object.entries(et).map(([e,t])=>[e,t.toLowerCase()])),Tt=A.bg;function Hn(e){return e==="failed"?{ground:A["badge-failed"],ink:A.text}:{ground:rl(e),ink:Tt}}function on(e){switch(e.state){case"running":return{tone:"running",label:"RUNNING"};case"preparing":return{tone:"preparing",label:"PREPARING"};case"queued":return{tone:"waiting",label:"QUEUED"};case"held":return{tone:"waiting",label:"HELD"};case"waiting-reset":return{tone:"asleep",label:"ASLEEP"};case"orphaned":return{tone:"orphaned",label:"ORPHANED"};case"finished":return e.endState==="success"?{tone:"success",label:"\\u2713 DONE"}:{tone:"failed",label:"\\u2717 FAILED"};default:return{tone:"orphaned",label:String(e.state).toUpperCase()}}}function rl(e){return A[`st-${e}`]}var hs={Y:A.gold,y:A["gold-2"],W:"#fff6c9",L:"#f1e2bc",l:"#dcc796",S:"#b5843f",s:"#8f6a33",i:"#c9c3b0",I:"#85827a",w:"#8b5a2b",g:A.sand,m:A.muted,b:A["st-running"],p:A["st-asleep"],e:A["st-success"],r:A["st-failed"],a:A["st-waiting"]},Qo=sl();function sl(){let e=[];for(let t=0;t<16;t++){let n=Math.floor(t/2),o="";for(let r=0;r<16;r++)r<7-n||r>8+n?o+=".":t===0&&r===7?o+="W":t<4?o+=r<=7?"Y":"y":t%2===1?o+=r<=7?"l":"s":o+=r<=7?"L":"S";e.push(o)}return e}var il={logo:Qo,hammer:["iiiiiii.","IiiiiiI.","...w....","...w....","...w....","...w....","...w....","...w...."],hourglass:["yyyyyyy",".mgggm.","..mgm..","...m...","..mgm..",".mgggm.","yyyyyyy"],zzz:["...pppp",".....p.","....p..","...pppp","ppp....",".p.....","ppp...."],check:[".......","......e",".....ee","e...ee.","ee.ee..",".eee...","..e...."],coin:["..YYY..",".YyyyY.","YyYYYyY","YyYyyyY","YyYYYyY",".YyyyY.","..YYY.."],cross:[".......","r.....r","rr...rr",".rr.rr.","..rrr..",".rr.rr.","rr...rr"],arrow:[".......","...b...","....b..","bbbbbb.","....b..","...b...","......."],diamond:[".......","...Y...","..YYy..",".YYyyy.","..Yyy..","...y...","......."],wait:["aaaaaaa",".aggga.","..aga..","...a...","..a.a..",".aggga.","aaaaaaa"]};function Jo(e,t,n,o,r){t.forEach((s,i)=>{let a=0;for(;a<s.length;){let l=hs[s[a]??"."];if(l===void 0){a++;continue}let u=a+1;for(;u<s.length&&hs[s[u]??"."]===l;)u++;e.fillStyle=l,e.fillRect(n+a*r,o+i*r,(u-a)*r,r),a=u}})}function al(e){return{w:Math.max(0,...e.map(t=>t.length)),h:e.length}}function Wn(e,t,n,o,r){let s=il[t],{w:i,h:a}=al(s),l=r??i*n,u=r??a*n,d=at(e,l,u,o,`px icon icon-${t}`);if(!d)return null;let f=d.getContext("2d");if(f){let m=n*o;Jo(f,s,Math.floor((l-i*n)/2)*o,Math.floor((u-a*n)/2)*o,m)}return d}var ll={" ":["...","...","...","...","...","...","..."],A:[".###.","#...#","#...#","#####","#...#","#...#","#...#"],B:["####.","#...#","#...#","####.","#...#","#...#","####."],C:[".###.","#...#","#....","#....","#....","#...#",".###."],D:["####.","#...#","#...#","#...#","#...#","#...#","####."],E:["#####","#....","#....","####.","#....","#....","#####"],F:["#####","#....","#....","####.","#....","#....","#...."],G:[".###.","#...#","#....","#.###","#...#","#...#",".###."],H:["#...#","#...#","#...#","#####","#...#","#...#","#...#"],I:["###",".#.",".#.",".#.",".#.",".#.","###"],J:["..###","....#","....#","....#","....#","#...#",".###."],K:["#...#","#..#.","#.#..","##...","#.#..","#..#.","#...#"],L:["#....","#....","#....","#....","#....","#....","#####"],M:["#...#","##.##","#.#.#","#.#.#","#...#","#...#","#...#"],N:["#...#","#...#","##..#","#.#.#","#..##","#...#","#...#"],O:[".###.","#...#","#...#","#...#","#...#","#...#",".###."],P:["####.","#...#","#...#","####.","#....","#....","#...."],Q:[".###.","#...#","#...#","#...#","#.#.#","#..#.",".##.#"],R:["####.","#...#","#...#","####.","#.#..","#..#.","#...#"],S:[".###.","#...#","#....",".###.","....#","#...#",".###."],T:["#####","..#..","..#..","..#..","..#..","..#..","..#.."],U:["#...#","#...#","#...#","#...#","#...#","#...#",".###."],V:["#...#","#...#","#...#","#...#","#...#",".#.#.","..#.."],W:["#...#","#...#","#...#","#.#.#","#.#.#","#.#.#",".#.#."],X:["#...#","#...#",".#.#.","..#..",".#.#.","#...#","#...#"],Y:["#...#","#...#",".#.#.","..#..","..#..","..#..","..#.."],Z:["#####","....#","...#.","..#..",".#...","#....","#####"],a:[".....",".....",".###.","....#",".####","#...#",".####"],b:["#....","#....","####.","#...#","#...#","#...#","####."],c:[".....",".....",".###.","#....","#....","#...#",".###."],d:["....#","....#",".####","#...#","#...#","#...#",".####"],e:[".....",".....",".###.","#...#","#####","#....",".###."],f:["..##",".#..","####",".#..",".#..",".#..",".#.."],g:[".....",".....",".####","#...#","#...#","#...#",".####","....#",".###."],h:["#....","#....","####.","#...#","#...#","#...#","#...#"],i:["#",".","#","#","#","#","#"],j:["..#","...","..#","..#","..#","..#","..#","..#","##."],k:["#...","#...","#..#","#.#.","##..","#.#.","#..#"],l:["#","#","#","#","#","#","#"],m:[".....",".....","##.#.","#.#.#","#.#.#","#.#.#","#...#"],n:[".....",".....","####.","#...#","#...#","#...#","#...#"],o:[".....",".....",".###.","#...#","#...#","#...#",".###."],p:[".....",".....","####.","#...#","#...#","#...#","####.","#....","#...."],q:[".....",".....",".####","#...#","#...#","#...#",".####","....#","....#"],r:["....","....","#.##","##..","#...","#...","#..."],s:[".....",".....",".####","#....",".###.","....#","####."],t:[".#..",".#..","####",".#..",".#..",".#..","..##"],u:[".....",".....","#...#","#...#","#...#","#...#",".####"],v:[".....",".....","#...#","#...#","#...#",".#.#.","..#.."],w:[".....",".....","#...#","#...#","#.#.#","#.#.#",".#.#."],x:[".....",".....","#...#",".#.#.","..#..",".#.#.","#...#"],y:[".....",".....","#...#","#...#","#...#","#...#",".####","....#",".###."],z:[".....",".....","#####","...#.","..#..",".#...","#####"],0:[".###.","#...#","#..##","#.#.#","##..#","#...#",".###."],1:["..#..",".##..","..#..","..#..","..#..","..#..",".###."],2:[".###.","#...#","....#","...#.","..#..",".#...","#####"],3:[".###.","#...#","....#","..##.","....#","#...#",".###."],4:["...#.","..##.",".#.#.","#..#.","#####","...#.","...#."],5:["#####","#....","####.","....#","....#","#...#",".###."],6:["..##.",".#...","#....","####.","#...#","#...#",".###."],7:["#####","....#","...#.","..#..",".#...",".#...",".#..."],8:[".###.","#...#","#...#",".###.","#...#","#...#",".###."],9:[".###.","#...#","#...#",".####","....#","...#.",".##.."],"!":["#","#","#","#","#",".","#"],\'"\':["#.#","#.#","...","...","...","...","..."],"#":[".#.#.",".#.#.","#####",".#.#.","#####",".#.#.",".#.#."],$:["..#..",".####","#.#..",".###.","..#.#","####.","..#.."],"%":["##...","##..#","...#.","..#..",".#...","#..##","...##"],"&":[".##..","#..#.","#..#.",".##..","#.#.#","#..#.",".##.#"],"\'":["#","#",".",".",".",".","."],"(":["..#",".#.","#..","#..","#..",".#.","..#"],")":["#..",".#.","..#","..#","..#",".#.","#.."],"*":[".....","..#..","#.#.#",".###.","#.#.#","..#..","....."],"+":[".....","..#..","..#..","#####","..#..","..#..","....."],",":["..","..","..","..","..","..",".#","#.",".."],"-":["...","...","...","###","...","...","..."],".":[".",".",".",".",".",".","#"],"/":["....#","....#","...#.","..#..",".#...","#....","#...."],":":[".",".","#",".",".",".","#"],";":["..","..",".#","..","..","..",".#","#.",".."],"<":["...#","..#.",".#..","#...",".#..","..#.","...#"],"=":[".....",".....","#####",".....","#####",".....","....."],">":["#...",".#..","..#.","...#","..#.",".#..","#..."],"?":[".###.","#...#","....#","...#.","..#..",".....","..#.."],"@":[".###.","#...#","#.###","#.#.#","#.###","#....",".####"],"[":["###","#..","#..","#..","#..","#..","###"],"\\\\":["#....","#....",".#...","..#..","...#.","....#","....#"],"]":["###","..#","..#","..#","..#","..#","###"],"^":["..#..",".#.#.","#...#",".....",".....",".....","....."],_:[".....",".....",".....",".....",".....",".....",".....",".....","#####"],"`":["#.",".#","..","..","..","..",".."],"{":["..##",".#..",".#..","#...",".#..",".#..","..##"],"|":["#","#","#","#","#","#","#"],"}":["##..","..#.","..#.","...#","..#.","..#.","##.."],"~":[".....",".....",".#...","#.#.#","...#.",".....","....."],"\\u2713":[".....","....#","...##","#.##.","###..",".#...","....."],"\\u2717":[".....","#...#","##.##",".###.","##.##","#...#","....."],"\\xB7":[".",".",".","#",".",".","."],"\\u2022":["....","....",".##.","####","####",".##.","...."],"\\u2192":[".....","..#..","...#.","#####","...#.","..#..","....."],"\\u2190":[".....","..#..",".#...","#####",".#...","..#..","....."],"\\u2191":["..#..",".###.","#.#.#","..#..","..#..","..#..","..#.."],"\\u2193":["..#..","..#..","..#..","..#..","#.#.#",".###.","..#.."],"\\u2026":[".....",".....",".....",".....",".....",".....","#.#.#"],"\\u2014":[".....",".....",".....","#####",".....",".....","....."],"\\u2013":["....","....","....","####","....","....","...."],"\\xD7":["...","...","#.#",".#.","#.#","...","..."],"\\xB0":[".#.","#.#",".#.","...","...","...","..."]},cl=["#####","#...#","#...#","#...#","#...#","#...#","#####"];function gs(e,t){if(t.length!==7&&t.length!==9)throw new Error(`glyph ${JSON.stringify(e)} has ${t.length} rows`);let n=t[0]?.length??0,o=[];return t.forEach((r,s)=>{if(r.length!==n||!/^[#.]*$/.test(r))throw new Error(`glyph ${JSON.stringify(e)} row ${s} is malformed`);for(let i=0;i<n;i++){if(r[i]!=="#")continue;let a=i+1;for(;r[a]==="#";)a++;o.push({x:i,y:s,w:a-i}),i=a}}),{w:n,runs:o}}var ul=new Map(Object.entries(ll).map(([e,t])=>[e,gs(e,t)])),dl=gs("missing",cl);function bs(e){return ul.get(e)??dl}function je(e){let t=0,n=0;for(let o of e)t+=bs(o).w,n++;return n===0?0:t+(n-1)*1}function Yn(e,t,n,o,r,s=1){if(!Number.isFinite(s)||s<=0)return 0;e.fillStyle=r;let i=0,a=!0;for(let l of t){a||(i+=1),a=!1;let u=bs(l);for(let d of u.runs)e.fillRect(n+(i+d.x)*s,o+d.y*s,d.w*s,s);i+=u.w}return i*s}var pl=1;function ml(e,t,n){let o=je(e)*t,r=11*t;return{width:o*n,height:r*n,cssWidth:o,cssHeight:r}}function z(e,t,n=""){let o=T(e,"span",t.className?`pxt ${t.className}`:"pxt"),r=at(e,0,0,t.dpr),s=T(e,"span","visually-hidden");r&&o.appendChild(r),o.appendChild(s);let i=null,a=t.color,l=t.scale,u={el:o,canvas:r,set(d,f=a,m=l){if(d===i&&f===a&&m===l)return;if(i=d,a=f,l=m,s.textContent=d,!r){s.className="";return}let y=ml(d,l,t.dpr);Qt(r,y.cssWidth,y.cssHeight,t.dpr);let E=r.getContext("2d");if(!E)return;E.clearRect(0,0,y.width,y.height);let g=l*t.dpr;Yn(E,d,0,pl*g,a,g)},text:()=>i??""};return u.set(n),u}var hl={started:A["st-running"],finished:A["st-success"],"verify-passed":A["st-success"],failed:A["st-failed"],"verify-failed":A["st-failed"],landed:A.gold,held:A["st-waiting"],waiting:A["st-waiting"]},gl={"\\u25C6":"diamond","\\u23F3":"wait"};function ys(e,t,n){let o=z(e,{scale:2,color:A.gold,dpr:n},"CHRONICLE");t.title.replaceChildren(o.el);let r=new Map,s=[],i=!1,a=u=>{let d=T(e,"li",i?`chronicle-line kind-${u.kind} enter`:`chronicle-line kind-${u.kind}`),f=es(u.kind),m=gl[f],y=m?Wn(e,m,1,n,9):z(e,{scale:1,color:hl[u.kind],dpr:n,className:"glyph"},f).el;y&&d.appendChild(y),m&&d.appendChild(T(e,"span","visually-hidden",u.kind==="landed"?"landed:":"waiting:")),d.appendChild(T(e,"span","text",u.text));let E=T(e,"time","ago");return E.setAttribute("datetime",new Date(u.at).toISOString()),d.appendChild(E),{li:d,time:E,at:u.at}},l={update(u,d){for(let y of u)!r.has(y.id)&&Number.isFinite(y.at)&&r.set(y.id,a(y));let f=u.filter(y=>r.has(y.id)).map(y=>y.id);s=vt(t.list,s,f,y=>r.get(y)?.li);let m=new Set(f);for(let y of[...r.keys()])m.has(y)||r.delete(y);t.empty.hidden=f.length>0,i=!0,l.refresh(d)},refresh(u){for(let d of r.values())d.time.textContent=St(u-d.at)}};return l}function ue(e,t){let n=e.length,o=Math.max(0,...e.map(i=>i.length)),r=[],s=n;for(let i=0;i<n;i++){let a=e[i]??"",l=0;for(;l<a.length;){let u=a[l]??".";if(u==="."){l++;continue}let d=t[u];if(d===void 0)throw new Error(`sprite character ${JSON.stringify(u)} has no color`);let f=l+1;for(;f<a.length&&t[a[f]??"."]===d;)f++;r.push({x:l,y:i,w:f-l,color:d}),s=Math.min(s,i),l=f}}return{w:o,h:n,top:s===n?0:s,runs:r,mirrored:r.map(i=>({...i,x:o-i.x-i.w}))}}function tt(e,t,n){let o=Array.from({length:t},()=>Array.from({length:e},()=>"."));for(let{grid:r,dx:s=0,dy:i=0}of n)r.forEach((a,l)=>{for(let u=0;u<a.length;u++){let d=a[u]??".";if(d==="."||d==="+")continue;let f=u+s,m=l+i,y=o[m];if(y===void 0||f<0||f>=e)throw new Error(`sprite pixel (${f}, ${m}) is outside ${e}\\xD7${t}`);y[f]=d}});return o.map(r=>r.join(""))}function xs(e,t){for(let n=0;n<e.length;n++){let o=(e[n]??"").indexOf(t);if(o>=0)return{x:o,y:n}}return null}function er(e,t,n){let o=xs(e,n),r=xs(t,"+");if(!o||!r)throw new Error(`no ${n} or + to hold an item by`);return{grid:t,dx:o.x-r.x,dy:o.y-r.y}}function we(e,t,n="*"){let o=[{grid:e}];return t&&o.push(er(e,t,n)),tt(e[0]?.length??0,e.length,o)}var Le=["....ooooo...","...ohhhhho..","..ohhhhhhho.","..oHhhhkkko.","..oHhhkkoko.","..oHhhkkkkko","..oHhokkKko.","..oHo.okko.."],ws=cn(Le,[[6,9,"o"]]),Zo=["............","....ooooo...","...ohhhhho..","..ohhhhhhho.","..oHhhhhkko.","..oHhhkkkko.","..oHhhkoKko.","..oHhokkkko."],rn=["....ooooo...","...ohhhhho..","..ohhhhhkko.","..oHhhkkoko.","..oHhhkkkkko","..oHhokkkko.","..oHhoKkko..","..oHo.oko..."];function cn(e,t){let n=[...e];for(let[o,r,s]of t){let i=n[o]??"";n[o]=i.slice(0,r)+s+i.slice(r+1)}return n}var oe={idle:["..otttttto..",".oTtttttTko.",".okTttttTko.",".okossssoko.",".o&o....o*o."],swingA:["..otttttto..",".oTtttttTko.","o&oTttttTko.","oo.ossssok*o","...........o"],swingB:["..otttttto..",".oTtttttTko.","okoTttttTo..","o&ossssso*o.",".o.....oo.o."],hold:["..otttttto..",".oTtttttTo..",".okTttttko*o",".okosssso.o.",".o&o........"],shoulder:["..o&ttttto..",".okTttttTko.",".oTTttttTko.","..ossssoko..","........o*o."],write:["..otttttto..",".oTtttttTo..",".ok&ttttt*o.",".okosssso.o.",".oo........."]},Rt={front:["..........o.",".........o*o",".........oko",".........oko","..ottttttoko",".oTtttttTko.",".okTttttto..",".okosssso...",".o&o........"],both:[".o........o.","o&o......o*o","oko......oko","oko......oko","okottttttoko",".okTttttTko.","..oTttttto..","..ossssso...","............"],half:["............","............","o&o......o*o","oko......oko","okottttttoko",".okTttttTko.","..oTttttto..","..ossssso...","............"],climbA:[".........o*o",".........oko",".........oko","........oko.","..ottttttko.",".o&tttttTo..",".okTttttto..","..ossssso...","............"],climbB:["............","............","..........o.",".........o*o","..ottttttoko",".o&tttttTko.",".okTttttto..","..ossssso...","............"]},vs=["...owwwWo...","..owwwwWWo..","..oowwwWoo.."],X={stand:["...oko.oko..","...oko.oko..","..ooo..oooo."],strideA:["..oKo..oko..",".oKo....oko.",".ooo....oooo"],pass:["....oKko....","....oKko....","....oooooo.."],strideB:["..oko..oKo..",".oko....oKo.",".ooo....oooo"],climbA:["..oko.oKo...","..oko..oo...","..ooo......."],climbB:["...oKo.oko..","....oo.oko..",".......ooo.."]},bl=[".owwwwwWkkko",".oooooooooo."],yl=["................","................","..........ooooo.",".oooooooooHhhhho","oKkkwwwWttoHkoko","okkkwwWWtttHkkko",".oooooooooooooo."],Ne={hammerDown:[".+.",".N.","nnn","NNN"],hammerUp:["nnn","NNN",".N.",".+."],plumb:["+","o","o","Y","z"],papyrus:["lL","+L","lL","LL"],penUp:["..o",".o.","+.."],penDown:["o+"],scroll:["mlllm","mLL+m"],loaf:[".oo.","obbo","ob+o",".oo."],basket:["..+.","obbo","onNo","oNno",".oo."],jug:[".+.","ojo","ojJo",".oo."]},ks=["oooooo","olllLo","olLLLo","oLLLeo","oooooo"],xl=[".oo.","ojjo","oJJo"];function jn(e,t,n){let o=[];for(let r=0;r<e;r++){let s=n?Math.floor(r/2)%2===0?"n":"y":r===0?"N":"n";o.push(r===t?`+${s}`:`.${s}`)}return o}function wl(e){switch(e){case"laborer":case"mason":return"hammer";case"scribe":case"skeptic":return"pen";case"surveyor":return"rod";default:return null}}function kl(e){switch(e){case"laborer":return Ne.hammerDown;case"mason":return Ne.plumb;case"scribe":case"skeptic":return Ne.papyrus;case"surveyor":return jn(15,10,!0);case"scout":return jn(16,11,!1);default:return null}}function ae(e,t,n,o=0,r=!1){let s={grid:t,dy:(r?4:8)+o},i={grid:e,dy:o};return tt(me.w,me.h,[{grid:n,dy:15},{grid:vs,dy:12+o},...r?[i,s]:[s,i]])}var sn=[X.strideA,X.pass,X.strideB,X.pass],an=[0,1,0,1],Sl=[oe.swingA,oe.idle,oe.swingB,oe.idle];function ln(e){return[0,1,2,3].map(e)}function vl(e){let t=kl(e),n=wl(e),o=[we(ae(Le,oe.idle,X.stand),t),we(ae(Le,oe.idle,X.stand,1),t)],r=ln(k=>we(ae(Le,Sl[k]??oe.idle,sn[k]??X.pass,an[k]),t)),s=(k,S,C)=>tt(me.w,me.h,[{grid:S,dy:15},{grid:vs,dy:12},{grid:k,dy:4},{grid:rn},...C?[{grid:ks,dx:0,dy:6}]:[]]),i=k=>[s(Rt.climbA,X.climbA,k),s(Rt.climbB,X.climbB,k)],a=[tt(me.w,me.h,[{grid:bl,dy:16},{grid:oe.idle,dy:12},{grid:Le,dy:4}])],l;if(n==="hammer")l=[we(ae(Le,oe.hold,X.stand,1),Ne.hammerDown),we(ae(rn,Rt.front,X.stand,0,!0),Ne.hammerUp)];else if(n==="pen"){let k=S=>cn(S,[[10,5,"l"],[10,6,"l"],[10,7,"L"],[11,5,"l"],[11,6,"L"],[11,7,"L"]]);l=[we(k(ae(Zo,oe.write,X.stand)),Ne.penDown),we(k(ae(Zo,oe.write,X.stand)),Ne.penUp)]}else n==="rod"?l=[we(ae(Le,oe.hold,X.stand),jn(10,3,!0)),we(ae(rn,oe.hold,X.stand),jn(14,9,!0))]:l=o;let d=[e==="skeptic"?we(ae(ws,Rt.front,X.stand,0,!0),["o","+"]):we(ae(ws,oe.hold,X.stand),null),we(ae(Le,oe.idle,X.stand),e==="skeptic"?null:t)],f=ln(k=>we(ae(Le,oe.hold,sn[k]??X.pass,an[k]),Ne.scroll)),m=ln(k=>tt(me.w,me.h,[{grid:ae(Le,oe.shoulder,sn[k]??X.pass,an[k])},{grid:ks,dx:0,dy:4+(an[k]??0)}])),y=k=>ln(S=>{let C=ae(Le,oe.hold,sn[S]??X.pass,an[S]),O=[{grid:C},er(C,k===3?Ne.basket:Ne.loaf,"*")];return k>1&&O.push(er(C,Ne.jug,"&")),tt(me.w,me.h,O)}),E=ln(k=>ae(Zo,oe.idle,sn[k]??X.pass,k%2)),g=[ae(rn,Rt.both,X.stand,0,!0),ae(rn,Rt.half,X.stand,1,!0)],w={idle:o,walk:r,climb:i(!1),"climb-stone":i(!0),sit:a,work:l,sleep:[[...yl]],talk:d,"carry-scroll":f,"carry-stone":m,"carry-ration":y(1),"carry-ration-2":y(2),"carry-ration-3":y(3),slump:E,cheer:g};if(e!=="waterboy")return w;let x={};for(let[k,S]of Object.entries(w))x[k]=S.map(C=>k==="sleep"?C:Cl(k==="sit"?C:El(C)));return x}function El(e){let t=".".repeat(e[0]?.length??0);return[t,t,...e.filter((n,o)=>o!==10&&o!==13)]}function Cl(e){let t=e.findIndex(r=>r.includes("h")),n=e[t]??"",o=Math.floor((n.indexOf("h")+n.lastIndexOf("h"))/2);return tt(e[0]?.length??0,e.length,[{grid:e},{grid:xl,dx:o-1,dy:t-3}])}var zn=[".....oooooo.....","....oyBYyBYo....","...oyBYyBYyyo...","...oBYyBYyyyyo..","..oyBYyBokkkkko.","..oBYyBYokkokko.","..oyBYyBokkkkkko","..oBYyBYokkKkko.","..oyBYyBookkkoo.","..oBYyBo.oYYo..."],Ss=[".....oooooo.....","....oyBYyBYo....","...oyBYyBYyyo...","...oBYyBYyykko..","..oyBYyBokkokko.","..oBYyBYokkkkkko","..oyBYyBokkkkko.","..oBYyBYoKkkkoo.","..oyBYyBookko...","..oBYyBo.oYYo..."],Ml=cn(zn,[[7,12,"o"]]),tr=["..oyBYoGyyyyyo..",".oGyyyGyyyGyyYo.",".oYzYYzYYzYYzYo.",".okowwwwwwwWokko",".okowwwwwwwWokko",".o&owwwwwwwWo*o.","..oowwwwwwWWoo..","...owyyyyyyYo...","...owwwwwwWWo...","...owwwwwwWWo...","...owwwwwwWWo...","..owwwwwwwWWWo..","..owwwwwwwWWWo..","..owwwwwwwWWWo..","..oooooooooooo..","...okko..okko..."],qn=cn(tr,[[3,1,"."],[3,2,"o"],[3,3,"w"],[4,1,"."],[4,2,"o"],[4,3,"w"],[5,1,"."],[5,2,"o"],[5,3,"w"]]);function Kn(e){let t=Array.from({length:13},()=>"...");t[e-1]=".o.",t[e]="o&o";for(let n=e+1;n<12;n++)t[n]="oko";return t[12]=".oo",t}var Al=[".y.","yGz",".z.",...Array.from({length:22},()=>".n.")];function Pt(e,t,n){let o=[{grid:Al,dx:13},{grid:t,dy:10},{grid:e}];return n&&o.push({grid:n}),tt(Eo.w,Eo.h,o)}function Ll(){let e=cn(tr,[[1,2,"y"],[1,6,"y"],[1,10,"y"],[1,4,"G"],[1,8,"G"]]);return{idle:[Pt(zn,tr,null),Pt(zn,e,null)],talk:[Pt(Ml,qn,Kn(6)),Pt(zn,qn,Kn(7))],cheer:[Pt(Ss,qn,Kn(1)),Pt(Ss,qn,Kn(4))]}}var Ce={tent:["............oo............","...........occo...........","..........occcCo..........",".........occccCCo.........","........occccqCCCo........",".......occccqqCCCCo.......","......occccqqoqCCCCo......",".....occccqqooqqCCCCo.....","....occccqqoooqqqCCCCo....","...occcccccoooooCCCCCCo...","..occcccccooooooCCCCCCCo..",".occccccccooooooCCCCCCCCo.","occccccccoooooooCCCCCCCCCo","oooooooooooooooooooooooooo"],palm:[".......vvv.........","....vvvvvvVv..vvv..","..vvvVVvvvvVvvvvvv.",".vvV...vVvvvvVV..vv","vvV...vvVrVvvv...Vv","vV...vV.JrJ.vVv...V","V...vV..rNJ..vV....","....V...rN....V....","........rN.........","........rN.........",".........rN........",".........rN........",".........rN........",".........rN........",".........rrN.......","..........rN.......","..........rN.......","..........rN.......","..........rN.......","..........rN.......","..........rN.......","..........rN.......","..........rrN......","..........rrN......","..........rrN......",".........rrN.......",".........rrN.......",".........rrN.......",".........rrN.......",".........rrNN......","........UUUUUU....."],table:["........oo..............",".......ojjo.............","..oo..ojjjJo..ooo.......",".obbo.ojjJJo.obbbo.ommo.","obbbbo.oJJo.obbbbbmlqlm.","ooooooooooooooooooomLLLm","onnnnnnnnnnnnnnnnnnnnnNo","oNNNNNNNNNNNNNNNNNNNNNNo",".oNo................oNo.",".oNo................oNo.",".ooo................ooo."],chest:["..oooooooooo..",".onnnnnnnnnNo.","onnnnnnnnnnNNo","oyyyyyyyyyyYYo","onnnnnoyonnNNo","oNNNNNoYoNNNNo","onnnnnnonnnNNo","onnnnnnnnnnNNo","oyyyyyyyyyyYYo","oooooooooooooo"],well:["..oooooooooooooooo..","..onnnnnnnnnnnnnNo..","..ooooooooooooooo...","..oNo....o....oNo...","..oNo....o....oNo...","..oNo...ooo...oNo...","..oNo..onnNo..oNo...","..oNo..oNNNo..oNo...","..oNo...ooo...oNo...","..oNo.........oNo...",".ooooooooooooooooo..","olllLlllLlllLlllLeo.","oLLmLLLmLLLmLLLmLeo.","oaaaaaaaaaaaaaaaaeo.","ollLlllLlllLlllLLeo.","oLmLLLmLLLmLLLmLLeo.","oLLLmLLLmLLLmLLLeeo.",".oooooooooooooooooo."],sledge:["oooooooooooooooooooooo..","onnnnnnnnnnnnnnnnnnnNo..","oNNNNNNNNNNNNNNNNNNNNo.o",".oNo....oNo.....oNo..onN","ooooooooooooooooooooooNo","oNNNNNNNNNNNNNNNNNNNNNo."],capstone:["....yY....","...yyYz...","...yyYz...","..yyyYzz..","..yyyYzz..",".yyyyYzzz.","yyyyyYzzzz"],capstoneGleam:["....GY....","...GyYz...","...yGYz...","..GyyYzz..","..yGyYzz..",".GyyGYzzz.","yyyyyYzzzz"],glint:[".G.","GGG",".G."],rubble:[["llLo","LLeo","oooo"],[".llo","lLLe","oooo"],["lLo","eeo"]]},Vn={hourglass:["ooooo","oGyGo",".oyo.","..o..",".oGo.","oyyyo","ooooo"],dots:["ooo.ooo.ooo","ofo.ofo.ofo","ooo.ooo.ooo"],zzz:[".....oooooo",".....offffo",".....ooofoo",".....oofooo","ooooooffffo","offfooooooo","oofoo......","offfo......","ooooo......"],question:[".ooo.","offfo","oo.fo","..ofo","..oo.","..of.","..oo."]},Es=["ooooooo","oyyyyYo",".oyyYo.","..oYo..","...o..."],Xn=[["...","###","#.#",".#."],["##.",".##",".#.","#.#"],[".#.","##.",".#.",".#."],["...","#.#",".#.","..."],[".#.","#.#","###",".#."],["###","#.#","###","..."],["#..","#..","##.","#.#"],["###","#..","##.","..."],["##.","..#",".#.","#.."],["...",".#.","###","..."],["...","###","#.#","###"],["...","#.#","###","..."],["###",".#.",".#.","###"],["#.#","###","#.#","###"],["###","#.#","#.#","#.#"],["#.#",".#.","#.#","..."]];function Nl(e,t){let n=new Map;for(let[o,r]of Object.entries(e))n.set(o,r.map(s=>ue(s,t)));return n}function Tl(e,t){let n={...jo,...fs(e)};if(t)for(let o of Object.keys(n))n[o]=ms(n[o]??"#000000");return n}function Qn(){let e=new Map,t=(n,o)=>{let r=`${n}:${o?"ghost":"solid"}`,s=e.get(r);return s||(s=Nl(n==="arbab"?Ll():vl(n),Tl(n,o)),e.set(r,s)),s};return{frames(n,o,r,s){let i=t(n,s),a=o==="carry-ration"&&r>=2?`carry-ration-${Math.min(3,r)}`:o;return i.get(a)??i.get("idle")??[]}}}function Ot(e){return ue(e,jo)}var ft={w:36,h:54,scale:3},un={w:48,h:78,scale:3},Rl=6,Ts=(e,t)=>e.name<t.name?-1:e.name>t.name?1:0;function Pl(e){return e.filter(t=>t.state!=="finished").sort((t,n)=>(jt[t.state]??9)-(jt[n.state]??9)||Ts(t,n))}function Cs(e){let t=Date.parse(e);return Number.isFinite(t)?t:-1/0}function Ol(e,t=Rl){return e.filter(n=>n.state==="finished").sort((n,o)=>Cs(o.since)-Cs(n.since)||Ts(n,o)).slice(0,t)}function Ms(e){switch(e.state){case"running":return{pose:"work",ghost:!1};case"held":case"queued":return{pose:"sit",ghost:!1};case"waiting-reset":return{pose:"sleep",ghost:!1};case"orphaned":return{pose:"idle",ghost:!0};default:return{pose:"idle",ghost:!1}}}function Bl(e){return Fr(e)?1:Oo(e.toolCalls)}function Rs(e){let{scrollHeight:t=0,clientHeight:n=0,scrollTop:o=0}=e;return[t,n,o].every(Number.isFinite)&&t-n-o>1}function Fl(e){return`CREW \\xB7 ${e.filter(n=>n.state==="running"||n.state==="preparing").length} AT WORK`}function Ps(e,t,n,o,r,s){let i=e.getContext("2d");if(!i)return 0;i.clearRect(0,0,n*s,o*s);let a=Math.max(1,Math.min(r,Math.floor(n/Math.max(1,t.w)),Math.floor(o/Math.max(1,t.h))));return Os(i,t,Math.floor((n-t.w*a)/2),o-t.h*a,a,s),a}function Os(e,t,n,o,r,s){let i=r*s;for(let a of t.runs)e.fillStyle=a.color,e.fillRect((n+a.x*r)*s,(o+a.y*r)*s,a.w*i,i)}var nr=Ot(Vn.zzz);function Il(e,t,n,o){let r=Ps(e,t,ft.w,ft.h,ft.scale,o),s=e.getContext("2d");if(n==="sleep"&&s){let i=t.h-t.top;Os(s,nr,ft.w-nr.w*2-2,ft.h-i*r-nr.h*2-4,2,o)}return r}function As(e,t,n){let o=T(e,"span","tile");o.setAttribute("aria-hidden","true");let r=at(e,ft.w,ft.h,n,"px avatar");r&&o.appendChild(r);let s="";return{el:o,set(i,a,l){let u=`${i}:${a}:${l}`;if(u===s)return;s=u,o.className=`tile cast-${i}${l?" ghost":""}`;let d=t.frames(i,a,0,l)[0];r&&d&&Il(r,d,a,n)}}}function Dl(e,t,n){let o=T(e,"span","tile tile-arbab");o.setAttribute("aria-hidden","true");let r=at(e,un.w,un.h,n,"px avatar"),s=t.frames("arbab","idle",0,!1)[0];return r&&(o.appendChild(r),s&&Ps(r,s,un.w,un.h,un.scale,n)),o}function Ls(e){let t=Tn(e);return t==="arbab"?"laborer":t}function Ns(e,t){let{tone:n,label:o}=on(t);e.el.className=`pxt badge tone-${n}`,e.set(o,Hn(n).ink)}function or(e,t){let n=kt(e,t);return n===null?"\\u2014":wt(n)}function Bs(e,t,n,o,r){let s=z(e,{scale:2,color:A.gold,dpr:o},"CREW");t.title.replaceChildren(s.el);let i=z(e,{scale:1,color:A.muted,dpr:o},"RECENTLY FINISHED");t.recentTitle.replaceChildren(i.el);let a=T(e,"p","empty-lead","The site is quiet."),l=T(e,"p","empty-hint");l.appendChild(T(e,"span","","No lane is at work. Launch one with ")),l.appendChild(T(e,"code","","arbab launch")),l.appendChild(T(e,"span","",", or ")),l.appendChild(T(e,"code","","arbab plan next")),l.appendChild(T(e,"span","",": workers walk in from the village."));let u=T(e,"div","empty-words");u.appendChild(a),u.appendChild(l),t.empty.replaceChildren(Dl(e,n,o),u);let d=new Map,f=[],m=null,y=null,E="",g=(S,C)=>{let O=T(e,"li","crew-item"),I=T(e,"button","card frame-btn");I.setAttribute("type","button"),I.setAttribute("aria-pressed","false");let P=As(e,n,o),G=T(e,"span","card-body"),Y=T(e,"span","card-head"),Oe=T(e,"span","name"),Be=z(e,{scale:1,color:Tt,dpr:o,className:"badge"});Y.appendChild(Oe),Y.appendChild(Be.el);let ve=T(e,"span","meta"),Fe=T(e,"span","progress"),fe=T(e,"span","bar"),Ie=T(e,"span","bar-fill");fe.appendChild(Ie);let De=T(e,"span","calls");Fe.appendChild(fe),Fe.appendChild(De);let le=T(e,"span","card-foot"),ne=T(e,"span","stats"),nt=T(e,"span","elapsed");le.appendChild(ne),le.appendChild(nt);for(let pe of[Y,ve,Fe,le])G.appendChild(pe);return I.appendChild(P.el),I.appendChild(G),O.appendChild(I),I.addEventListener("focus",()=>{y=S,r.enter(S)}),I.addEventListener("mouseenter",()=>r.enter(S)),I.addEventListener("blur",()=>{y===S&&(y=null),r.leave(S)}),I.addEventListener("mouseleave",()=>r.leave(S)),I.addEventListener("click",()=>r.toggle(S)),{li:O,button:I,avatar:P,name:Oe,meta:ve,badge:Be,elapsed:nt,fill:Ie,calls:De,stats:ne,lane:C}},w=(S,C,O)=>{S.lane=C;let{pose:I,ghost:P}=Ms(C);S.avatar.set(Ls(C),I,P),S.name.textContent=C.name,S.meta.textContent=`${C.role} \\xB7 ${C.kind}`,Ns(S.badge,C),S.elapsed.textContent=or(C,O),S.fill.style.width=`${Math.round(Bl(C)*100)}%`,S.calls.textContent=`${C.toolCalls} ${C.toolCalls===1?"call":"calls"}`,S.stats.textContent=`${C.lastTool??"\\u2014"} \\xB7 ${Ke(C.costUsd)}`},x=(S,C)=>{let O=Ol(S.lanes),I=JSON.stringify(O.map(P=>[P.name,P.endState,P.costUsd,P.elapsedMs,P.since]));t.recentGroup.hidden=O.length===0,I!==E&&(E=I,t.recent.replaceChildren(...O.map(P=>{let G=T(e,"li","recent-item"),Y=As(e,n,o),{pose:Oe,ghost:Be}=Ms(P);Y.set(Ls(P),Oe,Be);let ve=z(e,{scale:1,color:Tt,dpr:o});return Ns(ve,P),G.appendChild(Y.el),G.appendChild(T(e,"span","name",P.name)),G.appendChild(ve.el),G.appendChild(T(e,"span","num",Ke(P.costUsd))),G.appendChild(T(e,"span","num",or(P,C))),G})))},k={update(S,C){s.set(Fl(S.lanes));let O=Pl(S.lanes);for(let G of O){let Y=d.get(G.name);Y||(Y=g(G.name,G),d.set(G.name,Y)),w(Y,G,C)}let I=O.map(G=>G.name);f=vt(t.list,f,I,G=>d.get(G)?.li,y);let P=new Set(I);for(let G of[...d.keys()])P.has(G)||d.delete(G);y!==null&&!P.has(y)&&(y=null),t.empty.hidden=O.length>0,x(S,C),m!==null&&!P.has(m)&&(m=null),k.setPinned(m)},tick(S){for(let C of d.values())C.elapsed.textContent=or(C.lane,S)},setPinned(S){m=S;for(let[C,O]of d)O.button.setAttribute("aria-pressed",String(C===S))},order:()=>f,button:S=>d.get(S)?.button};return k}var rr=96,Fs=4,Ul=.7;function $l(e,t){return e>=t?"hold":e>=Ul?"warn":"ok"}var _l={ok:A.sand,warn:A["gold-2"],hold:A["st-failed"]};function Gl(e){let t=Math.max(0,Math.floor(e)),n=i=>String(i).padStart(2,"0"),o=Math.floor(t/86400),r=Math.floor(t%86400/3600),s=Math.floor(t%3600/60);return o>0?`${o}d ${n(r)}h`:r>0?`${r}h ${n(s)}m`:s>0?`${s}m`:"<1m"}function sr(e,t,n,o){let r=Math.max(0,Math.min(rr-1,Math.round(n*rr))),s=`hold at ${Math.round(n*100)}%`;if(!t||!Number.isFinite(t.utilization)||t.resetsAt<=o)return{percent:"\\u2014",fill:0,tick:r,level:"ok",title:`${e} window: no current reading \\xB7 ${s}`};let i=Math.max(0,Math.min(1,t.utilization)),a=rr/Fs,l=Math.min(a,Math.ceil(i*a))*Fs,u=`${Math.round(t.utilization*100)}%`;return{percent:u,fill:l,tick:r,level:$l(t.utilization,n),title:`${e} window ${u} \\xB7 resets in ${Gl(t.resetsAt-o)} \\xB7 ${s}`}}function ir(e,t,n,o){let r=z(e,{scale:1,color:A.muted,dpr:o,className:"gauge-label"},n.toUpperCase()),s=T(e,"span","gauge-bar"),i=T(e,"span","gauge-fill"),a=T(e,"span","gauge-tick");s.appendChild(i),s.appendChild(a);let l=z(e,{scale:1,color:A.sand,dpr:o,className:"gauge-pct"});return t.replaceChildren(r.el,s,l.el),{update(u){t.setAttribute("title",u.title),t.setAttribute("data-level",u.level),i.style.width=`${u.fill}px`,a.style.left=`${u.tick}px`,l.set(u.percent,u.percent==="\\u2014"?A.muted:_l[u.level])}}}var Ds=600,Is=136;function Hl(e){let t=Fo(e.lanes);return{atWork:t.running+t.preparing,waiting:t.waiting,asleep:t.asleep,succeeded:t.succeeded,failed:t.failed,treasury:Io(e.lanes)}}function Wl(e){return 1-(1-e)**3}function Yl(e,t,n,o=Ds){if(!(n<o)||o<=0)return t;let r=Math.max(0,n/o);return e+(t-e)*Wl(r)}function ql(e,t=Ds){let n=[],o=[],r=0,s=i=>o.map((a,l)=>Yl(n[l]??0,a,i-r,t));return{set(i,a){if(i.length===o.length&&i.every((u,d)=>u===o[d]))return;let l=s(a);n=e?[...i]:i.map((u,d)=>l[d]??0),o=[...i],r=a},value:s}}function Kl(e){let t=je(e);return t*4<=Is?4:t*3<=Is?3:2}var dn=e=>Math.round(e??0),zl=[{key:"at-work",label:"AT WORK",icon:"hammer",values:e=>[e.atWork],format:e=>String(dn(e[0])),color:A.text},{key:"waiting",label:"WAITING",icon:"hourglass",values:e=>[e.waiting],format:e=>String(dn(e[0])),color:A.text},{key:"asleep",label:"ASLEEP",icon:"zzz",values:e=>[e.asleep],format:e=>String(dn(e[0])),color:A.text},{key:"finished",label:"FINISHED",icon:"check",values:e=>[e.succeeded,e.failed],format:e=>`\\u2713${dn(e[0])} \\u2717${dn(e[1])}`,color:A.text},{key:"treasury",label:"TREASURY",icon:"coin",values:e=>[e.treasury],format:e=>`$${(e[0]??0).toFixed(2)}`,color:A.gold}];function jl(e,t){let n=e.format(t);return{text:n,zero:!/[1-9]/.test(n)}}function Us(e,t,n){let o=zl.map(s=>{let i=T(e,"li","kpi frame");i.setAttribute("data-kpi",s.key);let a=Wn(e,s.icon,2,n.dpr,16),l=z(e,{scale:4,color:A.muted,dpr:n.dpr,className:"kpi-number"}),u=z(e,{scale:1,color:A.muted,dpr:n.dpr,className:"kpi-label"},s.label);return a&&i.appendChild(a),i.appendChild(l.el),i.appendChild(u.el),{spec:s,counter:ql(n.reducedMotion),number:l,li:i}});t.replaceChildren(...o.map(s=>s.li));let r=(s,i)=>{let{text:a,zero:l}=jl(s.spec,s.counter.value(i));s.li.setAttribute("data-zero",String(l)),s.number.set(a,l?A.muted:s.spec.color,Kl(a))};return{update(s,i){let a=Hl(s);for(let l of o)l.counter.set(l.spec.values(a),i),r(l,i)},tick(s){for(let i of o)r(i,s)}}}var Jn=[{key:"lane",label:"lane",numeric:!1},{key:"role",label:"role",numeric:!1},{key:"state",label:"state",numeric:!1},{key:"attempt",label:"attempt",numeric:!0},{key:"calls",label:"calls",numeric:!0},{key:"lastTool",label:"last tool",numeric:!1},{key:"elapsed",label:"elapsed",numeric:!0},{key:"cost",label:"cost",numeric:!0}],Vl={key:"state",dir:"ascending"};function Xl(e){let t=jt[e.state]??9;return e.state==="finished"&&e.endState!=="success"?t+1:t}function $s(e,t,n){switch(t){case"lane":return e.name;case"role":return e.role;case"state":return Xl(e);case"attempt":return e.attempt;case"calls":return e.toolCalls;case"lastTool":return e.lastTool;case"elapsed":return kt(e,n);case"cost":return e.costUsd!==null&&Number.isFinite(e.costUsd)?e.costUsd:null}}function _s(e,t){return e<t?-1:e>t?1:0}function Ql(e,t,n){let o=t.dir==="ascending"?1:-1;return[...e].sort((r,s)=>{let i=$s(r,t.key,n),a=$s(s,t.key,n);if(i===null||a===null){if(i!==a)return i===null?1:-1}else{let l=_s(i,a);if(l!==0)return o*l}return _s(r.name,s.name)})}function Jl(e,t){return e.key===t?{key:t,dir:e.dir==="ascending"?"descending":"ascending"}:{key:t,dir:"ascending"}}function Gs(e,t){let n=kt(e,t);return[e.name,e.role,on(e).label,String(e.attempt),String(e.toolCalls),e.lastTool??"\\u2014",n===null?"\\u2014":wt(n),Ke(e.costUsd)]}function Hs(e,t,n,o){let r=z(e,{scale:2,color:A.gold,dpr:n},"LEDGER");t.title.replaceChildren(r.el);let s=Vl,i=[],a=0,l=new Map,u=[],d=Jn.map(w=>{let x=T(e,"th",w.numeric?"num":"");x.setAttribute("scope","col");let k=T(e,"button","sort",w.label);return k.setAttribute("type","button"),k.addEventListener("click",()=>g.sortBy(w.key)),x.appendChild(k),{th:x,key:w.key}});t.head.replaceChildren(...d.map(w=>w.th));let f=()=>{for(let w of d)w.th.setAttribute("aria-sort",w.key===s.key?s.dir:"none")};f();let m=(w,x)=>{let k=T(e,"tr"),S=z(e,{scale:1,color:Tt,dpr:n,className:"badge"}),C=Jn.map((O,I)=>{let P=T(e,I===0?"th":"td",O.numeric?"num":"");return I===0&&P.setAttribute("scope","row"),O.key==="state"&&P.appendChild(S.el),k.appendChild(P),P});return k.addEventListener("mouseenter",()=>o.enter(w)),k.addEventListener("mouseleave",()=>o.leave(w)),k.addEventListener("click",()=>o.toggle(w)),{tr:k,cells:C,badge:S,lane:x}},y=(w,x)=>{let k=Gs(w.lane,x);Jn.forEach((S,C)=>{if(S.key==="state"){let{tone:I,label:P}=on(w.lane);w.badge.el.className=`pxt badge tone-${I}`,w.badge.set(P,Hn(I).ink);return}let O=w.cells[C];O&&(O.textContent=k[C]??"")})},E=()=>{let w=Ql(i,s,a).map(x=>x.name);u=vt(t.body,u,w,x=>l.get(x)?.tr)},g={update(w,x){i=w.lanes,a=x;let k=new Set(i.map(S=>S.name));for(let S of i){let C=l.get(S.name);C||(C=m(S.name,S),l.set(S.name,C)),C.lane=S,y(C,x)}E();for(let S of[...l.keys()])k.has(S)||l.delete(S)},tick(w){a=w;let x=Jn.findIndex(k=>k.key==="elapsed");for(let k of l.values()){let S=k.cells[x];S&&(S.textContent=Gs(k.lane,w)[x]??"")}},setPinned(w){for(let[x,k]of l)k.tr.className=x===w?"pinned":""},sort:()=>s,sortBy(w){s=Jl(s,w),f(),E()},order:()=>u};return g}var Zl={done:"\\u2713",failed:"\\u2717",pending:"\\xB7"};function Te(e,t,n){return{label:e,state:t,mark:Zl[t],detail:n}}var ec=(e,t)=>`${e} ${t}${e===1?"":"s"}`;function tc(e){return`${e.lenses} ${e.lenses===1?"lens":"lenses"} \\xB7 ${e.confirmed} confirmed \\xB7 ${e.unverified} unverified`}function nc(e,t){let n=e.verify,o=e.ready,r=qe(e.landedAt);return[Te("INTEGRATED","done",ec(e.lanes.length,"lane")),n==="passed"?Te("VERIFY","done","passed"):n==="failed"?Te("VERIFY","failed","failed"):Te("VERIFY","pending","not run"),e.review?Te("REVIEW","done",tc(e.review)):Te("REVIEW","pending","not run"),o===!0?Te("READY","done","ready"):o===!1?Te("READY","failed","not ready"):Te("READY","pending","not checked"),e.landedAt!==null?Te("LANDED","done",Number.isFinite(r)?St(t-r):"landed"):Te("LANDED","pending","not landed")]}var Ws={done:A.gold,failed:A["st-failed"],pending:A.faint};function Ys(e,t,n){let o=z(e,{scale:2,color:A.gold,dpr:n},"MONUMENT");t.title.replaceChildren(o.el);let r=T(e,"p","monument-head"),s=T(e,"span","name"),i=T(e,"code","sha");r.appendChild(s),r.appendChild(i);let a=T(e,"ol","stepper"),l=[0,1,2,3,4].map(()=>{let d=T(e,"li","step"),f=z(e,{scale:1,color:A.faint,dpr:n,className:"node"}),m=z(e,{scale:1,color:A.faint,dpr:n,className:"step-label"}),y=T(e,"span","detail");return d.appendChild(f.el),d.appendChild(m.el),d.appendChild(y),a.appendChild(d),{li:d,mark:f,label:m,detail:y}}),u=T(e,"p","empty","No integration yet.");return t.body.replaceChildren(r,a,u),{update(d,f){let m=Or(d);r.hidden=m===null,a.hidden=m===null,u.hidden=m!==null,m&&(s.textContent=m.name,i.textContent=m.headSha.slice(0,7),nc(m,f).forEach((y,E)=>{let g=l[E];g&&(g.li.setAttribute("data-state",y.state),g.mark.set(y.mark,Ws[y.state]),g.label.set(y.label,Ws[y.state]),g.detail.textContent=y.detail)}))}}}var Zn="This session ended or restarted. Use the tab the new `arbab ui` opened, or the URL it printed.",qs="This page is one too many: arbab ui serves 16 at once. Close another of its tabs and reload.",Ks="arbab ui is not running.";function ar(e){return e===null?Ks:e.status===200?qs:Zn}function zs(e){switch(e){case"live":return{text:"LIVE",color:A["st-success"]};case"lost":return{text:"RECONNECTING",color:A["st-waiting"]};case"closed":return{text:"OFFLINE",color:A["st-failed"]};default:return{text:"CONNECTING",color:A.muted}}}var to={header:"top",logo:"logo",title:"title",project:"project",version:"version",gauge5h:"gauge-5h",gauge7d:"gauge-7d",held:"held",connection:"connection",sound:"sound",banner:"banner",kpis:"kpis",site:"site",siteTitle:"site-title",siteFullscreen:"site-fullscreen",stage:"stage",canvas:"scene",titleCard:"title-card",titleCardLogo:"title-card-logo",titleCardWord:"title-card-word",tooltip:"tooltip",notice:"notice",caption:"caption",crewPanel:"crew-panel",crewTitle:"crew-title",crewScroll:"crew-scroll",crew:"crew",crewEmpty:"crew-empty",recentGroup:"recent-group",recentTitle:"recent-title",recent:"recent",monumentTitle:"monument-title",monument:"monument",chronicleTitle:"chronicle-title",chronicle:"chronicle",chronicleEmpty:"chronicle-empty",ledgerTitle:"ledger-title",ledgerHead:"ledger-head",table:"lanes",footer:"footer",live:"live"},F=to,Kf=`<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="robots" content="noindex">\n<meta name="color-scheme" content="dark">\n<title>arbab \\xB7 pyramid</title>\n<link rel="icon" href="${st.icon}" type="image/svg+xml">\n<link rel="stylesheet" href="${st.style}">\n<script src="${st.script}" defer><\\/script>\n</head>\n<body>\n<header id="${F.header}" class="topbar">\n<div class="brand">\n<canvas id="${F.logo}" class="px logo" width="32" height="32" aria-hidden="true"></canvas>\n<h1 id="${F.title}" class="wordmark">arbab</h1>\n<p class="project"><span id="${F.project}">connecting\\u2026</span> <span id="${F.version}" class="version"></span></p>\n</div>\n<div class="status">\n<div class="gauges">\n<div id="${F.gauge5h}" class="gauge" data-level="ok"></div>\n<div id="${F.gauge7d}" class="gauge" data-level="ok"></div>\n</div>\n<div class="controls">\n<span id="${F.held}" class="pill held" hidden>held</span>\n<span id="${F.connection}" class="pill connection" data-state="connecting">connecting</span>\n<button id="${F.sound}" type="button" aria-pressed="false">sound</button>\n</div>\n</div>\n</header>\n<p id="${F.banner}" class="banner" role="alert" hidden></p>\n<main class="hud">\n<section class="kpi-row" aria-labelledby="kpi-heading">\n<h2 id="kpi-heading" class="visually-hidden">Lanes at a glance</h2>\n<ul id="${F.kpis}" class="kpis"></ul>\n</section>\n<div class="grid">\n<section id="${F.site}" class="frame panel site" aria-labelledby="${F.siteTitle}">\n<div class="titlebar">\n<h2 id="${F.siteTitle}">The site</h2>\n<button id="${F.siteFullscreen}" type="button" class="small" aria-controls="${F.site}">full screen</button>\n</div>\n<div id="${F.stage}" class="stage">\n<canvas id="${F.canvas}" width="480" height="270" role="img" aria-label="The pyramid scene: each lane is a worker building a block, and arbab hands out the work. The crew, the chronicle and the ledger say the same in text."></canvas>\n<div id="${F.titleCard}" class="title-card" aria-hidden="true">\n<canvas id="${F.titleCardLogo}" class="px" width="64" height="64"></canvas>\n<div id="${F.titleCardWord}" class="title-card-word">ARBAB</div>\n<p class="awakens">the site awakens\\u2026</p>\n</div>\n<div id="${F.tooltip}" class="tooltip frame" role="tooltip" hidden></div>\n<div id="${F.notice}" class="notice" hidden></div>\n</div>\n<p id="${F.caption}" class="caption">THE SITE IS QUIET</p>\n</section>\n<aside class="side" aria-label="Crew and monument">\n<section id="${F.crewPanel}" class="frame panel crew-panel" aria-labelledby="${F.crewTitle}" data-more="false">\n<div class="titlebar"><h2 id="${F.crewTitle}">Crew</h2></div>\n<div id="${F.crewScroll}" class="crew-scroll">\n<ul id="${F.crew}" class="crew"></ul>\n<div id="${F.crewEmpty}" class="crew-empty"></div>\n<details id="${F.recentGroup}" class="recent-group" hidden>\n<summary id="${F.recentTitle}">Recently finished</summary>\n<ul id="${F.recent}" class="recent"></ul>\n</details>\n</div>\n</section>\n<section class="frame panel monument-panel" aria-labelledby="${F.monumentTitle}">\n<div class="titlebar"><h2 id="${F.monumentTitle}">Monument</h2></div>\n<div id="${F.monument}" class="monument"></div>\n</section>\n</aside>\n</div>\n<div class="below">\n<section class="frame panel" aria-labelledby="${F.chronicleTitle}">\n<div class="titlebar"><h2 id="${F.chronicleTitle}">Chronicle</h2></div>\n<ol id="${F.chronicle}" class="chronicle"></ol>\n<p id="${F.chronicleEmpty}" class="empty">Nothing has happened yet.</p>\n</section>\n<section class="frame panel" aria-labelledby="${F.ledgerTitle}">\n<div class="titlebar"><h2 id="${F.ledgerTitle}">Ledger</h2></div>\n<div class="table-wrap">\n<table aria-labelledby="${F.ledgerTitle}">\n<thead><tr id="${F.ledgerHead}"><th scope="col">lane</th><th scope="col">role</th><th scope="col">state</th><th scope="col">attempt</th><th scope="col">calls</th><th scope="col">last tool</th><th scope="col">elapsed</th><th scope="col">cost</th></tr></thead>\n<tbody id="${F.table}"></tbody>\n</table>\n</div>\n</section>\n</div>\n</main>\n<footer>\n<p id="${F.footer}">Read-only</p>\n</footer>\n<div id="${F.live}" class="visually-hidden" aria-live="polite"></div>\n</body>\n</html>\n`,js=(e,t="")=>e.map(([n,o])=>`  --${t}${n}: ${o};`).join(`\n`),eo=(e,t,n="var(--frame-hi)",o="var(--frame-lo)")=>`0 -${e}px 0 0 var(--frame-dark), 0 ${e}px 0 0 var(--frame-dark), -${e}px 0 0 0 var(--frame-dark), ${e}px 0 0 0 var(--frame-dark),\n    inset ${t}px ${t}px 0 0 ${n}, inset -${t}px -${t}px 0 0 ${o}`,zf=`:root {\n  color-scheme: dark;\n${js(Object.entries(A))}\n${js(Object.entries(Xo),"chip-")}\n  --s1: 4px;\n  --s2: 8px;\n  --s3: 12px;\n  --s4: 16px;\n  --s5: 20px;\n  --s6: 24px;\n  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;\n  font-size: 14px;\n  font-variant-numeric: tabular-nums;\n}\n* { box-sizing: border-box; }\nbody {\n  margin: 0; color: var(--text); line-height: 1.45;\n  background: radial-gradient(ellipse 120% 60% at 50% -10%, #2a1d12 0, var(--bg) 70%) fixed, var(--bg);\n}\np { margin: 0; }\ncode { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--sand); }\ncanvas.px { display: inline-block; vertical-align: middle; image-rendering: crisp-edges; image-rendering: pixelated; }\n.pxt { display: inline-flex; align-items: center; line-height: 0; }\n:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }\n.visually-hidden {\n  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0;\n  overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;\n}\n[hidden] { display: none !important; }\n\n/* Pixel frames: square, notched corners; never rounded. */\n.frame {\n  margin: var(--s1); background: var(--panel); border-radius: 0;\n  box-shadow: ${eo(4,2)};\n}\nbutton {\n  font: inherit; font-size: 13px; color: var(--text); background: var(--panel-2); border: 0; border-radius: 0;\n  margin: 2px; padding: var(--s1) 10px; cursor: pointer; white-space: nowrap;\n  box-shadow: ${eo(2,2)};\n}\nbutton:hover { background: var(--panel-hi); }\nbutton:active, button[aria-pressed="true"] {\n  color: var(--gold); background: var(--panel);\n  box-shadow: ${eo(2,2,"var(--frame-lo)","var(--frame-hi)")};\n}\nbutton.small { font-size: 12px; padding: 2px var(--s2); }\n\n/* Top bar */\n.topbar {\n  position: sticky; top: 0; z-index: 10; height: 56px; display: flex; align-items: center; gap: var(--s4);\n  padding: 0 var(--s4); background: var(--bg-2); border-bottom: 2px solid var(--frame);\n  box-shadow: 0 2px 0 0 var(--frame-dark);\n}\n.brand { display: flex; align-items: center; gap: var(--s3); min-width: 0; }\n.logo { width: 32px; height: 32px; }\nh1 { margin: 0; font-size: 18px; line-height: 0; color: var(--gold); }\n.project { color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n#${F.project} { color: var(--text); font-weight: 600; }\n.version { color: var(--muted); }\n.status, .gauges, .controls { display: flex; align-items: center; gap: var(--s3); min-width: 0; }\n.status { margin-left: auto; }\n.gauge { display: flex; align-items: center; gap: 6px; --level: var(--sand); }\n.gauge[data-level="warn"] { --level: var(--gold-2); }\n.gauge[data-level="hold"] { --level: var(--st-failed); }\n.gauge-bar {\n  position: relative; width: 96px; height: 10px; background: var(--frame-dark);\n  box-shadow: 0 0 0 1px var(--frame-lo);\n}\n.gauge-fill {\n  position: absolute; left: 0; top: 0; bottom: 0; width: 0;\n  background: repeating-linear-gradient(90deg, var(--level) 0 3px, transparent 3px 4px);\n}\n.gauge-tick { position: absolute; top: -2px; bottom: -2px; width: 1px; background: var(--text); }\n.pill {\n  display: inline-flex; align-items: center; gap: 6px; padding: 3px var(--s2); margin: 2px; line-height: 0;\n  background: var(--panel); box-shadow: ${eo(2,1)}; font-size: 12px;\n}\n.pill.held { line-height: 1; color: var(--bg); background: var(--st-waiting); font-weight: 700; text-transform: uppercase; }\n.connection::before { content: ""; width: 6px; height: 6px; background: var(--muted); }\n.connection[data-state="live"]::before { background: var(--st-success); animation: pulse 2s steps(4) infinite; }\n.connection[data-state="lost"]::before { background: var(--st-waiting); }\n.connection[data-state="closed"]::before { background: var(--st-failed); }\n@keyframes pulse { 50% { opacity: 0.3; } }\n.banner { padding: var(--s2) var(--s4); background: var(--st-failed); color: #fff; font-weight: 600; }\n\n/* The dashboard. Its vertical spacing around the scene card is PAGE_GAPS in hud.ts: keep the two in step. */\n.hud { display: grid; gap: var(--s3); padding: var(--s3) var(--s4) var(--s4); max-width: 1880px; margin: 0 auto; }\n.grid, .side, .below { display: grid; gap: var(--s3); grid-template-columns: minmax(0, 1fr); align-items: start; }\n.hud > *, .grid > *, .side > *, .below > * { min-width: 0; }\n.side { align-content: start; }\n@media (min-width: 900px) {\n  .side { grid-template-columns: repeat(2, minmax(0, 1fr)); }\n  .below { grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); }\n}\n@media (min-width: 1280px) {\n  .grid { grid-template-columns: minmax(0, 1fr) 360px; align-items: stretch; }\n  /* As tall as the scene card and no taller: size containment keeps the crew from stretching the row. The items\n     stretch, so the crew panel fills the first row instead of shrinking to its title around a zero-basis list. */\n  .side { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; align-content: stretch; align-items: stretch; contain: size; }\n  .crew-panel { display: flex; flex-direction: column; min-height: 0; }\n  .crew-panel > .titlebar { flex: none; }\n  .crew-panel .crew-scroll { flex: 1 1 0; min-height: 0; max-height: none; overflow-y: auto; }\n}\n.panel { padding: var(--s3); min-width: 0; }\n.titlebar {\n  display: flex; align-items: center; justify-content: space-between; gap: var(--s2);\n  min-height: 30px; margin-bottom: var(--s3); padding-bottom: var(--s2); border-bottom: 2px solid var(--frame-lo);\n}\nh2 { margin: 0; font-size: 14px; line-height: 0; color: var(--gold); }\n.empty { color: var(--muted); padding: var(--s2) 0; }\n\n/* KPI cards */\n.kpis { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s3); grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); }\n.kpi { display: grid; grid-template-columns: 16px minmax(0, 1fr); grid-template-areas: "icon label" "num num"; gap: var(--s2) var(--s2); align-items: center; padding: var(--s3) 14px; }\n.kpi .icon { grid-area: icon; width: 16px; height: 16px; }\n.kpi .kpi-label { grid-area: label; }\n.kpi .kpi-number { grid-area: num; min-height: 44px; }\n/* Wide: one row per card (icon, label, number), so the KPI row leaves the scene its height. */\n@media (min-width: 1280px) {\n  .kpi { grid-template-columns: 16px auto minmax(0, 1fr); grid-template-areas: "icon label num"; padding: var(--s2) 14px; }\n  .kpi .kpi-number { justify-self: end; }\n}\n\n/* The scene card: lean chrome, so 3\\xD7 fits a 1080-px screen (stageRoom in hud.ts measures it). */\n.site { padding: var(--s2); }\n.site .titlebar { min-height: 28px; margin-bottom: var(--s2); padding-bottom: 6px; }\n.stage {\n  position: relative; display: flex; align-items: center; justify-content: center; min-width: 0; overflow: hidden;\n  background-color: var(--frame-dark);\n  background-image:\n    repeating-linear-gradient(45deg, rgb(255 255 255 / 0.025) 0 2px, transparent 2px 8px),\n    repeating-linear-gradient(-45deg, rgb(0 0 0 / 0.25) 0 2px, transparent 2px 8px),\n    radial-gradient(ellipse at center, var(--bg-2) 0, var(--frame-dark) 80%);\n  box-shadow: inset 0 0 0 2px var(--frame-lo);\n}\n#${F.canvas} { display: block; flex: none; width: 480px; height: 270px; image-rendering: crisp-edges; image-rendering: pixelated; }\n/* Below 1\\xD7: the stage\'s width, the height by the art\'s aspect ratio. */\n#${F.canvas}.fluid { flex: 1 1 auto; max-width: 100%; aspect-ratio: 480 / 270; }\n.caption {\n  display: flex; justify-content: center; min-height: 27px; margin-top: 6px; padding: var(--s2);\n  line-height: 0; color: var(--sand); background: var(--bg-2); box-shadow: inset 0 0 0 2px var(--frame-lo);\n}\n.site:fullscreen { margin: 0; width: 100vw; height: 100vh; display: flex; flex-direction: column; background: var(--bg); box-shadow: none; }\n.site:fullscreen .stage { flex: 1; min-height: 0; }\n.title-card {\n  position: absolute; inset: 0; z-index: 3; display: flex; flex-direction: column; align-items: center; justify-content: center;\n  gap: var(--s4); background: radial-gradient(ellipse at center, var(--panel) 0, var(--bg) 75%);\n  transition: opacity 0.6s steps(6), visibility 0s linear 0.6s;\n}\n.title-card.gone { opacity: 0; visibility: hidden; }\n.title-card-word { line-height: 0; color: var(--gold); font-size: 32px; }\n.awakens { color: var(--muted); font-style: italic; }\n.tooltip { position: absolute; z-index: 4; pointer-events: none; min-width: 190px; max-width: 320px; padding: 10px 12px; font-size: 13px; }\n.tooltip .tip-title { margin-bottom: 6px; line-height: 0; }\n.tooltip div + div { color: var(--muted); }\n.notice {\n  position: absolute; inset: 0; z-index: 5; display: grid; place-items: center; padding: var(--s4); text-align: center;\n  background: rgb(18 13 10 / 0.94); font-size: 15px;\n}\n\n/* Crew: the list scrolls inside its panel, with a fade at the bottom edge while there is more below. */\n.crew-panel { position: relative; }\n.crew-scroll { min-height: 0; max-height: 640px; overflow: auto; }\n.crew-panel[data-more="true"]::after {\n  content: ""; position: absolute; left: var(--s3); right: var(--s3); bottom: var(--s3); height: 36px; pointer-events: none;\n  background: linear-gradient(to bottom, transparent, var(--panel));\n}\n.crew { list-style: none; margin: 0; padding: 2px; display: grid; gap: var(--s3); }\n.card {\n  width: calc(100% - 4px); display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 10px; align-items: start;\n  padding: var(--s2); text-align: left; white-space: normal; font-size: 14px; color: var(--text); background: var(--panel-2);\n}\n.card[aria-pressed="true"] { color: var(--text); }\n.card[aria-pressed="true"] .name { color: var(--gold); }\n.tile {\n  display: grid; place-items: end center; width: 44px; height: 62px; padding-bottom: var(--s1);\n  background: color-mix(in srgb, var(--chip, var(--frame)) 38%, var(--bg-2)); box-shadow: inset 0 0 0 2px var(--frame-dark);\n}\n.tile .avatar { width: 36px; height: 54px; }\n.tile-arbab { flex: none; width: 56px; height: 86px; background: var(--bg-2); }\n.tile-arbab .avatar { width: 48px; height: 78px; }\n.tile.ghost .avatar { opacity: 0.75; }\n${Object.keys(Xo).map(e=>`.cast-${e} { --chip: var(--chip-${e}); }`).join(`\n`)}\n.card-body { display: grid; gap: 3px; min-width: 0; }\n.card-head, .card-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--s2); min-width: 0; }\n.name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.meta, .stats, .calls, .elapsed, .num { color: var(--muted); font-size: 13px; }\n.stats { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.elapsed, .calls { white-space: nowrap; }\n.progress { display: flex; align-items: center; gap: var(--s2); }\n.bar { position: relative; flex: 1; height: 8px; overflow: hidden; background: var(--frame-dark); box-shadow: 0 0 0 1px var(--frame-lo); }\n.bar-fill {\n  position: absolute; left: 0; top: 0; bottom: 0; width: 0;\n  background: repeating-linear-gradient(90deg, var(--gold) 0 4px, var(--gold-2) 4px 5px, var(--frame-dark) 5px 6px);\n}\n.badge { display: inline-flex; align-items: center; flex: none; padding: 2px var(--s1); background: var(--tone, var(--st-orphaned)); box-shadow: 0 0 0 1px var(--frame-dark); }\n${["running","preparing","waiting","asleep","success","orphaned"].map(e=>`.tone-${e} { --tone: var(--st-${e}); }`).join(`\n`)}\n.tone-failed { --tone: var(--badge-failed); }\n.crew-empty { display: flex; align-items: center; gap: var(--s3); padding: var(--s2) 0; }\n.empty-lead { font-weight: 600; }\n.empty-hint { color: var(--muted); font-size: 13px; }\n.recent-group { margin-top: var(--s3); }\n.recent-group summary { cursor: pointer; padding: var(--s1) 0; line-height: 0; }\n.recent { list-style: none; margin: var(--s2) 0 0; padding: 0; display: grid; gap: var(--s1); }\n.recent-item { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto auto auto; gap: var(--s2); align-items: center; }\n.recent-item .tile { height: 44px; overflow: hidden; }\n\n/* Monument */\n.monument-head { display: flex; align-items: baseline; gap: var(--s2); margin-bottom: 10px; }\n.stepper { list-style: none; margin: 0; padding: 0; }\n.step { position: relative; display: grid; grid-template-columns: 20px auto minmax(0, 1fr); gap: 10px; align-items: center; padding: 6px 0; }\n.step + .step::before { content: ""; position: absolute; left: 9px; top: -8px; width: 2px; height: 16px; background: var(--frame-lo); }\n.step[data-state="done"] + .step::before { background: var(--gold-2); }\n.node {\n  position: relative; z-index: 1; justify-content: center; width: 20px; height: 20px; background: var(--bg-2);\n  box-shadow: 0 0 0 2px var(--frame-dark), inset 0 0 0 2px var(--frame-lo);\n}\n.step[data-state="done"] .node { box-shadow: 0 0 0 2px var(--frame-dark), inset 0 0 0 2px var(--gold-2); }\n.step[data-state="failed"] .node { box-shadow: 0 0 0 2px var(--frame-dark), inset 0 0 0 2px var(--st-failed); }\n.detail { color: var(--muted); font-size: 13px; text-align: right; }\n\n/* Chronicle */\n.chronicle { list-style: none; margin: 0; padding: 0; max-height: 380px; overflow: auto; }\n.chronicle-line {\n  display: grid; grid-template-columns: 12px minmax(0, 1fr) auto; gap: var(--s2); align-items: center;\n  padding: 5px var(--s1); border-bottom: 1px solid var(--frame-lo);\n}\n.chronicle-line .ago { color: var(--muted); font-size: 12px; white-space: nowrap; }\n.chronicle-line.enter { animation: slide-in 0.4s steps(5) both; }\n@keyframes slide-in { from { transform: translateX(-16px); opacity: 0; } to { transform: none; opacity: 1; } }\n\n/* Ledger */\n.table-wrap { max-height: 380px; overflow: auto; box-shadow: inset 0 0 0 1px var(--frame-lo); }\ntable { border-collapse: separate; border-spacing: 0; width: 100%; font-size: 13px; }\nthead th { position: sticky; top: 0; z-index: 1; padding: 0; text-align: left; background: var(--panel-hi); border-bottom: 2px solid var(--frame-dark); }\nthead th.num { text-align: right; }\nbutton.sort {\n  width: 100%; margin: 0; padding: 6px var(--s2); text-align: inherit; font-size: 12px; font-weight: 600;\n  color: var(--muted); background: transparent; box-shadow: none; text-transform: uppercase; letter-spacing: 0.04em;\n}\nbutton.sort:hover { color: var(--text); }\nth[aria-sort="ascending"] .sort, th[aria-sort="descending"] .sort { color: var(--gold); }\nth[aria-sort="ascending"] .sort::after { content: " \\u25B2"; }\nth[aria-sort="descending"] .sort::after { content: " \\u25BC"; }\ntbody th, tbody td { padding: 5px var(--s2); text-align: left; font-weight: 400; white-space: nowrap; border-bottom: 1px solid var(--frame-lo); }\ntbody th { font-weight: 600; }\ntbody tr { cursor: pointer; }\ntbody tr:nth-child(even) { background: var(--panel-2); }\ntbody tr:hover, tbody tr.pinned { background: var(--panel-hi); }\ntbody tr.pinned th { color: var(--gold); }\ntbody .num { text-align: right; color: var(--text); }\n\nfooter { padding: 0 var(--s4) var(--s4); color: var(--muted); font-size: 13px; text-align: center; }\n\n@media (max-width: 899px) {\n  .topbar { height: auto; min-height: 56px; flex-wrap: wrap; padding: var(--s2) var(--s4); }\n  .status { flex-wrap: wrap; }\n}\n/* Narrow (a phone): nothing wider than the screen. The top bar stacks its rows: the logo, the gauges, the buttons. */\n@media (max-width: 599px) {\n  .topbar { flex-direction: column; align-items: stretch; gap: var(--s2); }\n  .status { margin-left: 0; flex-direction: column; align-items: flex-start; gap: var(--s2); }\n  .gauges, .controls { flex-wrap: wrap; }\n  .hud { padding: var(--s2); }\n  .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }\n  .card-head, .card-foot { flex-wrap: wrap; }\n  .recent-item { grid-template-columns: 44px minmax(0, 1fr) auto; }\n}\n@media (prefers-reduced-motion: reduce) {\n  *, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }\n}\n`;function Xs(e){let t="",n=null,o=0,r=0,s=(i,a,l,u,d)=>{let f=n?n(d):d,m=Math.round(i)+o,y=Math.round(a)+r,E=m+Math.round(l),g=y+Math.round(u);m=Math.max(0,m),y=Math.max(0,y),E=Math.min(480,E),g=Math.min(270,g),!(E<=m||g<=y)&&(f!==t&&(e.fillStyle=f,t=f),e.fillRect(m,y,E-m,g-y))};return{rect:s,rects(i,a=0,l=0){for(let u of i)s(u.x+a,u.y+l,u.w,u.h,u.color)},sprite(i,a,l,u=!1){for(let d of u?i.mirrored:i.runs)s(a+d.x,l+d.y,d.w,1,d.color)},alpha(i){e.globalAlpha=Math.min(1,Math.max(0,Number.isFinite(i)?i:1))},tint(i){n=i},offset(i,a){o=Number.isFinite(i)?Math.round(i):0,r=Number.isFinite(a)?Math.round(a):0},text(i,a,l,u){let d=n?n(u):u;return t=d,Yn(e,i,Math.round(a)+o,Math.round(l)+r,d,1)}}}var oc={day:null,dusk:{color:"#B04A64",amount:.3},night:{color:"#16286A",amount:.58}},Vs=new Map;function Bt(e){let t=oc[e];if(!t)return null;let n=Vs.get(e);if(!n){let o=new Map;n=r=>{let s=o.get(r);return s===void 0&&(s=W(r,t.color,t.amount),o.set(r,s)),s},Vs.set(e,n)}return n}function Z(e){let t=e>>>0;return()=>{t=t+1831565813>>>0;let n=t;return n=Math.imul(n^n>>>15,n|1),n^=n+Math.imul(n^n>>>7,n|61),((n^n>>>14)>>>0)/4294967296}}var rc=[[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];function sc(e,t){return rc[t&3]?.[e&3]??0}function ee(e,t,n){return sc(e,t)<n*16}function te(e){return Number.isFinite(e)&&e>0?e:0}function no(e,t){return(e%t+t)%t}var de=class{constructor(t,n){xt(this,"width");xt(this,"height");xt(this,"cells");xt(this,"palette",[]);xt(this,"index",new Map);this.width=t,this.height=n,this.cells=new Int32Array(t*n).fill(-1)}set(t,n,o){let r=Math.round(t),s=Math.round(n);if(r<0||s<0||r>=this.width||s>=this.height)return;let i=this.index.get(o);i===void 0&&(i=this.palette.length,this.palette.push(o),this.index.set(o,i)),this.cells[s*this.width+r]=i}get(t,n){if(t<0||n<0||t>=this.width||n>=this.height)return null;let o=this.cells[n*this.width+t]??-1;return o<0?null:this.palette[o]??null}fill(t,n,o,r,s){for(let i=n;i<n+r;i++)for(let a=t;a<t+o;a++)this.set(a,i,s)}runs(t=null,n=0,o=0){let r=[],s=i=>{let a=this.palette[i]??"#000000";return t?t(a):a};for(let i=0;i<this.height;i++){let a=i*this.width,l=0;for(;l<this.width;){if((this.cells[a+l]??-1)<0){l++;continue}let u=l;for(;u<this.width&&(this.cells[a+u]??-1)>=0;)u++;let d=new Map;for(let E=l;E<u;E++){let g=this.cells[a+E]??-1;(E===l||this.cells[a+E-1]!==g)&&d.set(g,(d.get(g)??0)+1)}let f=-1,m=1;for(let[E,g]of d)g>m&&(m=g,f=E);f>=0&&r.push({x:l+n,y:i+o,w:u-l,h:1,color:s(f)});let y=l;for(;y<u;){let E=this.cells[a+y]??-1;if(E===f){y++;continue}let g=y+1;for(;g<u&&this.cells[a+g]===E;)g++;r.push({x:y+n,y:i+o,w:g-y,h:1,color:s(E)}),y=g}l=u}}return r}};function ke(e,t,n,o,r){for(let s=-o;s<=o;s++){let i=Math.floor(Math.sqrt((o+.5)**2-s*s));e.push({x:t-i,y:n+s,w:i*2+1,h:1,color:r})}}function Ft(e,t,n,o,r,s,i){for(let a=-r;a<=r;a++)for(let l=-r;l<=r;l++){let u=Math.sqrt(l*l+a*a);if(u<o-.5||u>r+.5)continue;let d=r===o?1:1-(u-o)/(r-o+1);ee(t+l,n+a,s*d)&&e.push({x:t+l,y:n+a,w:1,h:1,color:i})}}function Qs(e,t){let n=[];for(let o=-t;o<=t;o++){let r=t===0?0:o/(t+.5),s=Math.round(e*Math.sqrt(Math.max(0,1-r*r)));s<=0||(n.push({dx:-s,dy:o,w:s*2}),(o&1)===0&&n.push({dx:-s-1,dy:o,w:1},{dx:s,dy:o,w:1}))}return n}function so(e){let n=40+400*(Number.isFinite(e)?Math.min(1,Math.max(0,e)):.5);return{x:n,y:26+86/200**2*(n-240)**2}}var re={x:400,y:30};function ic(e){let t=Math.min(1,Math.max(0,(112-e)/86)),n=Math.round(t**.8*24)/24;return{core:W(Dn.core,Un.core,n),rim:W(Dn.rim,Un.rim,n),halo:W(Dn.halo,Un.halo,n)}}function ac(e){let t=[];for(let n=1;n<e;n++)t.push(Math.round(128*(n/e)**.78));return t}var Js=new Map,It=6;function lc(e,t,n,o,r){for(let s=o;s<r;s++){let i=n.findIndex(m=>s<m);i<0&&(i=t.length-1);let a=t[i]??"#000000",l=null,u=0,d=n[i],f=i>0?n[i-1]:void 0;d!==void 0&&d-s<=It/2?(l=t[i+1]??a,u=(It/2-(d-s)+.5)/It):f!==void 0&&s-f<It/2&&(l=t[i-1]??a,u=(It/2-(s-f)-.5)/It),l&&u>.5&&([a,l,u]=[l,a,1-u]);for(let m=0;m<480;m++)e.set(m,s,l&&ee(m,s,u)?l:a)}}function cc(e){let t=Js.get(e);if(t)return t;let n=Lt[e],o=new de(480,128);lc(o,n,ac(n.length),0,128),e==="night"&&uc(o);let r=o.runs();return Js.set(e,r),r}function uc(e){let t=Z(4242);for(let n=0;n<520;n++){let o=t(),r=Math.floor(o*480),s=(t()+t()+t()-1.5)*14,i=Math.round(8+o*70+s+6*Math.sin(o*7));if(i<0||i>=100)continue;let a=e.get(r,i);if(!a)continue;let l=Math.abs(s)<6;e.set(r,i,W(a,J.dim,l?.32:.18))}}var Zs=new Map;function dc(e){let t=`${e.core}${e.rim}`,n=Zs.get(t);if(!n){let o=[];ke(o,0,0,14,e.halo),Ft(o,0,0,15,19,.5,e.halo);let r=[];ke(r,0,0,11,e.halo),Ft(r,0,0,12,13,.5,e.rim);let s=[];ke(s,0,0,9,e.rim);let i=[];ke(i,0,0,7,e.rim),ke(i,0,0,6,e.core),i.push({x:-3,y:-4,w:4,h:1,color:e.rim},{x:-4,y:-3,w:3,h:2,color:e.rim}),n={inner:s,mid:r,outer:o,body:i},Zs.set(t,n)}return n}function fc(e,t){let n=so(t),o=Math.round(n.x),r=Math.round(n.y),s=dc(ic(n.y));e.alpha(.14),e.rects(s.outer,o,r),e.alpha(1),e.alpha(.22),e.rects(s.mid,o,r),e.alpha(1),e.alpha(.4),e.rects(s.inner,o,r),e.alpha(1),e.rects(s.body,o,r)}var pc=(()=>{let e=[];return ke(e,re.x,re.y,11,"#B9C3E6"),Ft(e,re.x,re.y,12,15,.5,"#B9C3E6"),e})(),mc=(()=>{let e=[];ke(e,re.x,re.y,7,Wo);for(let t=-6;t<=6;t++){let n=Math.floor(Math.sqrt(56.25-t*t));e.push({x:re.x+n-1,y:re.y+t,w:2,h:1,color:Zt})}return e.push({x:re.x+1,y:re.y-3,w:2,h:2,color:Zt},{x:re.x-3,y:re.y+1,w:3,h:2,color:Zt},{x:re.x+3,y:re.y+3,w:1,h:1,color:Zt},{x:re.x-4,y:re.y-4,w:2,h:1,color:"#F6F4EA"}),e})();function hc(e){e.alpha(.1),e.rects(pc),e.alpha(1),e.rects(mc)}var io=(()=>{let e=Z(1907),t=[];for(let n=0;n<90;n++){let o=Math.floor(e()*480),r=2+Math.floor(e()**1.3*98),s=e(),i=s<.45?0:s<.8?1:s<.95?2:3,l=e()<.3?1.6+e()*2.6:0,u=e()*Math.PI*2;Math.abs(o-re.x)<14&&Math.abs(r-re.y)<14||t.push({x:o,y:r,level:i,speed:l,phase:u})}return t})();function gc(e,t){let n=io[e];if(!n)return-1;if(n.speed===0)return n.level;let o=Math.sin(te(t)*n.speed+n.phase);return Math.max(-1,Math.min(3,n.level+(o>.55?1:o<-.55?-1:0)))}var op=io.length,bc=(()=>{let e=[];for(let t of io)t.speed===0&&ni(e,t.x,t.y,t.level);return e})();function ni(e,t,n,o){if(o<0)return;let r=o===0?J.dim:o===1?J.mid:J.bright;e.push({x:t,y:n,w:1,h:1,color:r}),o>=3&&e.push({x:t-1,y:n,w:1,h:1,color:J.mid},{x:t+1,y:n,w:1,h:1,color:J.mid},{x:t,y:n-1,w:1,h:1,color:J.mid},{x:t,y:n+1,w:1,h:1,color:J.mid})}function yc(e,t){e.rects(bc);let n=[];io.forEach((o,r)=>{o.speed!==0&&ni(n,o.x,o.y,gc(r,t))}),e.rects(n)}var oo={every:40,lasts:.6};function xc(e){let t=te(e),n=t%oo.every;if(n>=oo.lasts)return null;let o=Z(Math.floor(t/oo.every)*7919+13),r=o()<.5?-1:1,s=90+Math.floor(o()*260),i=8+Math.floor(o()*30),a=n/oo.lasts,l=84*a;return{x:Math.round(s+r*l),y:Math.round(i+l*.42),dir:r,progress:a}}var ei=["#FFFFFF",J.bright,J.bright,J.mid,J.mid,J.mid,J.dim,J.dim,J.dim,J.dim,J.dim,J.dim];function wc(e,t){let n=xc(t);if(!n)return;let o=Math.min(ei.length,3+Math.round(n.progress*22)),r=n.progress>.8?(1-n.progress)/.2:1;r<1&&e.alpha(r);for(let s=o-1;s>=0;s--){let i=n.x-n.dir*s,a=Math.round(n.y-s*.42);e.rect(i,a,1,1,ei[s]??J.dim)}e.rect(n.x,n.y+1,1,1,J.mid),r<1&&e.alpha(1)}var ro=[{speed:2,count:4,minW:24,maxW:34,y0:70,y1:90,alpha:.7},{speed:4,count:3,minW:32,maxW:46,y0:42,y1:62,alpha:.88},{speed:6,count:2,minW:44,maxW:56,y0:10,y1:30,alpha:1}],lr=600;function kc(e,t){let n=Z(t),o=4+Math.floor(e/18),r=Math.floor(o*.4+n()*1.2),s=[];for(let g=0;g<o;g++)s.push(Math.max(.35,1-Math.abs(g-r)*(.22+n()*.12))*(.85+n()*.3));let i=[],a=s[0]??1;s.forEach((g,w)=>{w>0&&(a+=.65*((s[w-1]??g)+g)),i.push(a)});let l=a+(s[o-1]??1),u=(e-1)/l,d=Math.max(6,Math.round(Math.max(...s)*u*1.5)),f=d-1,m=s.map((g,w)=>{let x=g*u;return{cx:(i[w]??0)*u,cy:f-x*.5,r:x}}),y=new Array(e*d).fill(-1),E=(g,w)=>m.some(x=>(g-x.cx)**2+(w-x.cy)**2<=x.r*x.r);for(let g=0;g<d;g++)for(let w=0;w<e;w++){let x=g===d-1?2:g===d-2?1:0;w<x||w>=e-x||E(w,g)&&(y[g*e+w]=1)}for(let g=0;g<e;g++){let w=-1;for(let x=0;x<d;x++)if((y[x*e+g]??-1)>=0){w=x;break}if(!(w<0))for(let x=w;x<d;x++){let k=x*e+g;if((y[k]??-1)<0)continue;let S=x-w,C=d-1-x,O=(y[k-1]??-1)<0||g===0;S<=1||S<=2&&O?y[k]=0:(C<=1||C===2&&(g+x)%2===0)&&(y[k]=2)}}return{w:e,h:d,tones:y}}var ao=(()=>{let e=Z(611),t=[];return ro.forEach((n,o)=>{for(let r=0;r<n.count;r++){let s=n.minW+Math.floor(e()*(n.maxW-n.minW+1)),i=n.y0+Math.floor(e()*(n.y1-n.y0)),a=r*lr/n.count+Math.floor(e()*60);t.push({layer:o,x0:a,y:i,shape:kc(s,100+o*10+r)})}}),t})();function Sc(e,t){let n=ao[e];if(!n)return 0;let o=ro[n.layer]?.speed??0;return Math.floor(no(n.x0+o*te(t),lr))-(lr-480)}var rp=ao.length,ti=new Map;function vc(e,t){let n=`${e}:${t}`,o=ti.get(n);if(!o){let r=ao[e];if(o=[],r){let{w:s,h:i,tones:a}=r.shape,l=new de(s,i),u=ss[t];for(let d=0;d<i;d++)for(let f=0;f<s;f++){let m=a[d*s+f]??-1;m>=0&&l.set(f,d,u[m]??u[1])}o=l.runs()}ti.set(n,o)}return o}function Ec(e,t,n){for(let o=0;o<ro.length;o++){let r=(ro[o]?.alpha??1)*(t==="night"?.5:1);r<1&&e.alpha(r),ao.forEach((s,i)=>{s.layer===o&&e.rects(vc(i,t),Sc(i,n),s.y)}),r<1&&e.alpha(1)}}var fn={every:45,speed:30},Cc=570/fn.speed;function Mc(e){let t=te(e),n=t%fn.every;if(n>=Cc)return[];let o=Math.floor(t/fn.every),r=Z(o*104729+7),s=3+Math.floor(r()*3),i=44+Math.floor(r()*28),a=o%2===0?1:-1,l=a===1?-12+fn.speed*n:492-fn.speed*n,u=[];for(let d=0;d<s;d++){let f=d===0?0:6*Math.ceil(d/2)+Math.floor(r()*3),m=d===0?0:(d%2===1?-1:1)*(3*Math.ceil(d/2)+Math.floor(r()*2)),y=Math.round(Math.sin(n*2.1+d*1.7)),E=Math.floor(n*6+d*.5)%2;u.push({x:Math.round(l-a*f),y:i+m+y,frame:E})}return u}function Ac(e,t,n){if(t==="night")return;let o=is[t];for(let r of Mc(n))r.frame===0?(e.rect(r.x-1,r.y,1,1,o),e.rect(r.x+1,r.y,1,1,o),e.rect(r.x,r.y+1,1,1,o)):(e.rect(r.x,r.y,1,1,o),e.rect(r.x-1,r.y+1,1,1,o),e.rect(r.x+1,r.y+1,1,1,o))}function oi(e,t,n){e.rects(cc(t.phase)),t.phase==="night"?(yc(e,n),wc(e,n),hc(e)):fc(e,t.sun),Ec(e,t.phase,n),Ac(e,t.phase,n)}function ui(e,t){if(!(e>0)||!Number.isFinite(e))return{dx:0,dy:0};let n=te(t);return{dx:Math.round(e*Math.sin(53*n))||0,dy:Math.round(e*Math.cos(47*n))||0}}function di(e,t){if(e.phase==="night")return 0;let n=so(e.sun),o=Math.min(1,Math.max(0,(112-n.y)/86)),r=1+Math.round(2*(1-o));return Math.sign(Math.round(t)-Math.round(n.x))*r}var ri=new Map;function Nc(e,t){let n=`${e}x${t}`,o=ri.get(n);return o||(o=Qs(e,t),ri.set(n,o)),o}function pn(e,t,n,o=1){if(n.length===0)return;let r=t.phase==="night",s=(r?.14:.25)*Math.min(1,Math.max(0,o));if(s<=0)return;let i=r?us:_n;e.alpha(s);for(let a of n){let l=Math.round(a.cx)+di(t,a.cx),u=Math.round(a.y);for(let d of Nc(Math.max(1,Math.round(a.rx)),Math.max(0,Math.round(a.ry))))e.rect(l+d.dx,u+d.dy,d.w,1,i)}e.alpha(1)}function Tc(e,t){let n=te(t),o=Math.sin(n*9.1+e.seed*1.7)*.6+Math.sin(n*23.3+e.seed*2.9)*.4;return{radius:e.radius+Math.round(o*1.5),alpha:.11+.025*o}}var si=new Map;function Rc(e){let t=si.get(e);if(!t){let n=[];Ft(n,0,0,Math.round(e*.66),e,.5,Gn);let o=[];ke(o,0,0,Math.round(e*.66),Gn);let r=[];ke(r,0,0,Math.round(e*.33),Gn),t={outer:n,mid:o,core:r},si.set(e,t)}return t}function fi(e,t,n){for(let o of t){let{radius:r,alpha:s}=Tc(o,n),i=Rc(r);e.alpha(s),e.rects(i.outer,o.x,o.y),e.rects(i.mid,o.x,o.y),e.rects(i.core,o.x,o.y),e.alpha(1)}}var Pc={day:.045,dusk:.06,night:.1},ii=[12,10,8,6,4,2];function Oc(e,t,n){e.push({x:0,y:0,w:480,h:t,color:n},{x:0,y:270-t,w:480,h:t,color:n},{x:0,y:t,w:t,h:270-2*t,color:n},{x:480-t,y:t,w:t,h:270-2*t,color:n})}var ai=new Map;function Bc(e){let t=ai.get(e);if(!t){let n=ds[e];t=[];for(let r of ii)Oc(t,r,n);let o=ii[0];for(let r=0;r<480;r++)ee(r,o,.5)&&t.push({x:r,y:o,w:1,h:1,color:n}),ee(r,270-o-1,.5)&&t.push({x:r,y:270-o-1,w:1,h:1,color:n});for(let r=o+1;r<270-o-1;r++)ee(o,r,.5)&&t.push({x:o,y:r,w:1,h:1,color:n}),ee(480-o-1,r,.5)&&t.push({x:480-o-1,y:r,w:1,h:1,color:n});ai.set(e,t)}return t}function pi(e,t){e.alpha(Pc[t]),e.rects(Bc(t)),e.alpha(1)}var Fc=6;function mi(e,t,n){let o=Number.isFinite(t.glow)?Math.min(1,t.glow):0;if(!(o>0)||t.state==="none")return;let r=Math.round(t.state==="set"?n.x:t.x),s=Math.round(t.state==="set"?n.y:t.y)-Fc,i=o*.5;e.alpha(i),e.rect(r-4,0,8,s,U.light),e.rect(r-2,0,4,s,U.gleam),e.rect(r-1,0,2,s,"#FFFFFF");for(let l=0;l<s;l++)ee(r-5,l,.5)&&e.rect(r-5,l,1,1,U.light),ee(r+4,l,.5)&&e.rect(r+4,l,1,1,U.light);for(let l of[-75,-50,-28,28,50,75]){let u=l*Math.PI/180,d=16+Math.abs(l)/4;for(let f=5;f<d;f++)f>d*.6&&f%2===1||e.rect(Math.round(r+Math.sin(u)*f),Math.round(s-Math.cos(u)*f*.7),1,1,f<9?U.gleam:U.light)}let a=[];ke(a,r,s,5,U.light),ke(a,r,s,3,U.gleam),e.rects(a),e.alpha(1)}function hi(e,t,n,o){let{base:r,blockW:s,blockH:i}=o;if(t.phase==="night"||!(r>0)||!(s>0)||!(i>0))return;let a=r*s/2,l=di(t,n.centerX),u=l>=0,d=4+4*Math.max(1,Math.abs(l)),f=Math.min(2*i,24);e.alpha(.25);for(let m=0;m<f;m++){let y=n.baseY-1-m,E=Math.round(d*(1-m/f));if(E<=0)continue;let g=a-Math.floor(m/i)*(s/2),w=u?n.centerX+g:n.centerX-g-E;e.rect(w,y,E,1,_n);let x=u?w+E:w-1;ee(x,y,.5)&&e.rect(x,y,1,1,_n)}e.alpha(1)}var Ic=13;function gi(e,t){if(je(e)<=t)return e;let n=[...e];for(;n.length>0&&je(`${n.join("")}\\u2026`)>t;)n.pop();return`${n.join("")}\\u2026`}function Dc(e,t,n,o){let r=gi(e,468),s=je(r)+8,i=Ic,a=Math.min(479-s,Math.max(1,Math.round(t-s/2)+o.dx))-o.dx,l=Math.min(269-i,Math.max(1,Math.round(n-i)+o.dy))-o.dy;return{text:r,x:a,y:l,w:s,h:i}}function bi(e,t,n,o,r){let s=Dc(t,n,o,r),{x:i,y:a,w:l,h:u}=s;e.rect(i+1,a,l-2,1,dt.rim),e.rect(i+1,a+u-1,l-2,1,dt.rim),e.rect(i,a+1,1,u-2,dt.rim),e.rect(i+l-1,a+1,1,u-2,dt.rim),e.rect(i+1,a+1,l-2,u-2,dt.fill),e.rect(i+1,a+u-2,l-2,1,"#1F140D"),e.text(s.text,i+4,a+2,dt.text)}var Re={light:"#9C8E84",face:"#7E7068",shade:"#5C5049",dark:"#463C37"},li=15;function cr(e,t,n){let o=gi(e.toUpperCase(),200),r=je(o)+12;return{text:o,x:Math.round(t-r/2),y:Math.round(n)-3-li,w:r,h:li}}function yi(e,t,n,o){let{text:r,x:s,y:i,w:a,h:l}=cr(t,n,o);e.rect(s-2,i+l,a+4,3,Re.shade),e.rect(s-2,i+l,a+4,1,Re.face),e.rect(s-2,i+l+2,a+4,1,Re.dark),e.rect(s,i,a,l,Re.face),e.rect(s,i,a,1,Re.light),e.rect(s,i,1,l,Re.light),e.rect(s+a-1,i+1,1,l-1,Re.shade),e.rect(s+2,i+2,a-4,1,Re.shade),e.rect(s+2,i+l-3,a-4,1,Re.light),e.rect(s+2,i+2,1,l-4,Re.shade),e.rect(s+a-3,i+3,1,l-5,Re.light),e.text(r,s+6,i+4,U.shadow),e.text(r,s+6,i+3,U.light)}var lo=128,We=136;function xi(e,t,n,o){let r=Z(e),s=[];for(let i=0;i<t;i++){let a=r()<.55;s.push({c:Math.floor((i+r()*.9)/t*560)-40,half:a?14+Math.floor(r()*26):3+Math.floor(r()*8),h:a?n+Math.floor(r()*(o-n+1)):n-2+Math.floor(r()*6)})}return s}function co(e){let t=Math.imul(e^2654435769,2246822507);return t^=t>>>13,t=Math.imul(t,3266489909),(t^t>>>16)>>>0}function wi(e,t,n){let o=[];for(let s=0;s<480;s++){let i=t(s);for(let a of e){let l=Math.abs(s-a.c)-a.half,u=a.h-(l<=0?Math.round((Math.abs(s-a.c)/Math.max(1,a.half))**3*1.5):0),d=l<=0?u:Math.max(a.h-2.6*l,a.h*.6-.5*l);i=Math.max(i,d)}o.push(i)}let r=Z(n);for(let s=0;s<14;s++){let i=Math.floor(r()*480),a=1+Math.floor(r()*3),l=1+Math.floor(r()*2);for(let u=-l;u<=l;u++){let d=i+u;d<0||d>=480||(o[d]=(o[d]??0)-Math.max(0,a-Math.abs(u)))}}return o.map((s,i)=>Math.round(s-(co(i*3+n)%7===0?1:0)))}function ur(e,t,n,o,r){for(let s=0;s<480;s++){let i=t[s]??0,a=o-i,l=(t[s+1]??i)-(t[s-1]??i),u=r&&co(s*11+5)%13===0?2+co(s)%6:0;for(let d=a;d<o;d++){let f=d-a,m=n.face;if(l>=2&&f<Math.max(2,i*.55)?m=n.light:l<=-2&&f<Math.max(2,i*.6)?m=n.shade:l<=-2&&f<i*.75?m=ee(s,d,.5)?n.shade:n.face:f===0&&(m=n.light),r&&f>=3){let y=o-d;y%4===0&&co(Math.floor((s+y*13)/17)*7+y)%4!==0&&(m=m===n.light?n.face:n.shade),f>1&&f<2+u&&(m=n.shade)}e.set(s,d,m)}}}function Uc(){let e=[];for(let t=0;t<480;t++)e.push(Math.max(3,Math.round(8+3*Math.sin(t/37+.5)+2*Math.sin(t/13+2))));return e}function $c(e){let[t,n]=as,o=wi(xi(31,11,21,31),s=>14+2*Math.sin(s/29),3);ur(e,o,t,128,!0);let r=wi(xi(57,9,12,19),s=>9+2*Math.sin(s/23+1),4);ur(e,r,n,128,!0),ur(e,Uc(),ls,128,!1)}var _c=428,Gc=[404,454];function Hc(e){let t=Z(97);for(let o=0;o<480;o++)e.set(o,125,ee(o,125,.5)?be.light:be.face),e.set(o,126,be.face),e.set(o,127,be.shade);let n=4;for(;n<480;){let o=1+Math.floor(t()*4);for(let r=0;r<o;r++){let s=n+r*4;if(t()<.3){let i=119-Math.floor(t()*2);for(let a=i+2;a<126;a++)e.set(s,a,be.shade);e.fill(s-2,i,5,1,be.face),e.set(s-3,i+1,be.shade),e.set(s+3,i+1,be.shade),e.fill(s-1,i-1,3,1,be.light)}else{let i=2+Math.floor(t()*2),a=125-i;for(let l=-i;l<=i;l++)for(let u=-i;u<=i;u++){if(u*u+l*l>i*i+1)continue;let d=u+l<-1,f=u+l>1;e.set(s+u,a+l,d?be.light:f?be.shade:be.face)}}}n+=o*4+10+Math.floor(t()*26)}Wc(e,_c,127);for(let o of Gc)Yc(e,o,127)}function Wc(e,t,n){let o=(r,s)=>{for(let d=0;d<17;d++){let f=n-d,m=Math.floor(d/6),y=r+m,E=s-m;for(let g=y;g<=E;g++){let w=V.face;g===y?w=V.light:g>=E-1&&(w=V.shade),e.set(g,f,w)}}let a=n-17,l=Math.floor(16/6);e.fill(r+l-1,a,s-r-2*l+3,1,V.light),e.fill(r+l,a+1,s-r-2*l+1,1,V.shade);for(let d=0;d<2;d++){let f=r+3+d*4;e.fill(f,n-11,1,5,V.shade),e.set(f+1,n-10,V.shade)}let u=r+1+Math.floor((s-r)/2);for(let d=a-6;d<=n;d++)e.set(u,d,V.dark);e.fill(u+1,a-6,2,1,"#B8433A"),e.set(u+1,a-5,"#8E2F2B")};o(t-15,t-4),o(t+4,t+15),e.fill(t-4,n-11,9,1,V.light),e.fill(t-4,n-10,9,1,V.face),e.fill(t-3,n-9,7,10,V.face),e.fill(t-2,n-8,5,9,V.dark),e.fill(t-2,n-8,5,1,V.shade)}function Yc(e,t,n){for(let r=0;r<18;r++){let s=n-r,i=r<9;e.set(t-1,s,V.light),e.set(t,s,V.face),i&&e.set(t+1,s,V.shade)}e.set(t-1,n-21+3,U.light),e.set(t,n-21+3,U.mid),e.set(t,n-21+2,U.light),e.fill(t-2,n,5,1,V.shade)}function qc(e,t,n){let o=Lt[n],r=W(ie.sky,o[o.length-1]??ie.sky,.6),s=W(ie.light,o[o.length-2]??ie.light,.45);[[W(be.shade,ie.face,.45),r,.25],[r,s,.25],[s,r,.25],[s,ie.face,.5],[ie.face,ie.light,.12],[ie.face,ie.deep,.25],[ie.deep,ie.face,.25],[ie.deep,ie.bank,.12]].forEach(([a,l,u],d)=>{let f=lo+d;for(let m=0;m<480;m++)e.set(m,f,ee(m,f,u)?l:a)});for(let a=0;a<480;a++)for(let l=1;l<=5;l++){let u=t.get(a,125-l);if(!u||!ee(a,lo+l,.55-l*.08))continue;let d=lo+l;e.set(a,d,W(e.get(a,d)??ie.face,u,.45))}}var Kc=(()=>{let e=Z(23);return Array.from({length:26},()=>({x:e()*480,y:lo+1+Math.floor(e()*6),w:1+Math.floor(e()*3),speed:3+e()*4,blink:1.2+e()*2.4,phase:e()*Math.PI*2}))})(),zc=488;function jc(e){let t=te(e),n=[];for(let o of Kc)Math.sin(t*o.blink+o.phase)<-.3||n.push({x:Math.floor(no(o.x+o.speed*t,zc))-4,y:o.y,w:o.w});return n}var Vc=["....y................","....nS...............","....nSS..............","....nsSS.............","....nsSSS............","....nssSSS...........",".....nsSSSS..........",".....nssSSSS.........",".....nssSSSSS........",".....nssSSSSSS.......",".....nssSSSSSSS......","...k.nssSSSSSSSn.....","...w.NnnnnnnnnnnN...n","n..w.....N.........nN","NnnnnnnnnnnnnnnnnnnN.",".NNNNNNNNNNNNNNNNNNN.","..oooooooooooooooo..."],Xc={S:$n.light,s:$n.shade,n:K[0],N:K[1],o:"#4A2E18",y:U.light,k:"#B9784E",w:"#F4F0E2"},fr=ue(Vc,Xc),dr={every:120,crossing:80};function Qc(e){let t=te(e)%dr.every;if(t>=dr.crossing)return null;let n=-fr.w-2,o=482,r=Math.round(n+(o-n)*t/dr.crossing),s=Math.sin(t*1.9)>.55?-1:0;return{x:r,y:We-1+s}}function Jc(e,t){let n=Qc(t);if(!n)return;let o=n.y-fr.h+1;e.sprite(fr,n.x,o);for(let r=6;r<15;r++)(r+n.x)%2===0&&e.rect(n.x+r,n.y+1,1,1,$n.shade)}var Zc=[[".ll.........","lffl........","o.ff..rqr...","..ff.lrqrl..","..fflffffffl","...ffffffffs","...sssssss..","...f.s..f.s.","...f.s..f.s.","...d.d..d.d."],[".ll.........","lffl........","o.ff..rqr...","..ff.lrqrl..","..fflffffffl","...ffffffffs","...sssssss..","....fs...fs.","....fs...fs.","....dd...dd."]],eu=[[".w..","wwk.",".wn.",".Bn.",".Bn.",".Wn.",".W.n","k.k."],[".w..","wwk.",".wn.",".Bn.",".Bn.",".Wn.",".Wn.",".kk."]],vi={l:He.light,f:He.face,s:He.shade,d:He.dark,o:He.dark,r:"#B8433A",q:"#F2E4C2",w:"#F4F0E2",W:"#D6CFBC",B:"#3C6FB0",k:"#925A38",n:K[0]},ki=Zc.map(e=>ue(e,vi)),tu=eu.map(e=>ue(e,vi)),uo={every:180,crossing:70,feet:124};function nu(e){let t=te(e)%uo.every;if(t>=uo.crossing)return[];let n=550,o=Math.round(486-n*t/uo.crossing),r=Math.floor(t*4);return[{kind:"walker",x:o,frame:r%2},{kind:"camel",x:o+6,frame:(r+1)%2},{kind:"camel",x:o+20,frame:r%2},{kind:"camel",x:o+34,frame:(r+1)%2}]}function ou(e,t){for(let n of nu(t)){let o=(n.kind==="walker"?tu:ki)[n.frame]??ki[0];o&&e.sprite(o,n.x,uo.feet-o.h)}}var ru=[[[-12,250],[40,252],[96,256],[L.audience.x,L.audience.y-1]],[[52,230],[84,240],[118,250],[L.audience.x,L.audience.y-1]],[[L.audience.x,L.audience.y-1],[176,246],[206,230],[236,216],[258,211]]];function su(e,t,n){let o=1/0;for(let r=0;r+1<n.length;r++){let[s,i]=n[r]??[0,0],[a,l]=n[r+1]??[0,0],u=a-s,d=l-i,f=u*u+d*d,m=f===0?0:Math.max(0,Math.min(1,((e-s)*u+(t-i)*d)/f)),y=Math.hypot(e-(s+m*u),t-(i+m*d));o=Math.min(o,y)}return o}function iu(e){let t=We,n=[t,146,166,196,232,262];for(let o=t;o<270;o++){let r=n.findIndex((d,f)=>o>=d&&o<(n[f+1]??270));r<0&&(r=0);let s=lt[r]??lt[0],i=n[r+1],a=n[r],l=null,u=0;i!==void 0&&i-o<=2?(l=lt[r+1]??s,u=i-o===1?3/8:1/8):a!==void 0&&r>0&&o-a<=1&&(l=lt[r-1]??s,u=o-a===0?3/8:1/8);for(let d=0;d<480;d++)e.set(d,o,l&&ee(d,o,u)?l:s)}for(let o=0;o<480;o++)e.set(o,t,ie.bank),ee(o,t+1,.5)&&e.set(o,t+1,ie.bank);lu(e),uu(e),du(e),fu(e),cu(e),pu(e),mu(e)}var au=[{cx:300,hw:120,h:16,bottom:272},{cx:470,hw:86,h:26,bottom:272},{cx:214,hw:56,h:7,bottom:238},{cx:372,hw:50,h:6,bottom:224}];function lu(e){for(let t of au){let n=t.bottom-t.h;for(let o=Math.max(0,t.cx-t.hw);o<Math.min(480,t.cx+t.hw);o++){let r=(o-t.cx)/t.hw,s=Math.round(t.bottom-t.h*(1-r*r)**.8);for(let i=s;i<Math.min(270,t.bottom);i++){let a=e.get(o,i);if(!a)continue;let l=t.cx+(i-n)*.9,u=o<l,d=Math.abs(o-l)<2,f=W(a,"#FFF4D6",.26),m=W(a,"#8A5E2E",.17),y;i===s?y=u?W(a,"#FFF4D6",.5):W(a,"#8A5E2E",.26):d?y=ee(o,i,.5)?f:m:i-s<2?y=ee(o,i,.5)?u?f:m:a:y=u?f:m,e.set(o,i,y)}}}}function cu(e){let t=[{x:6,y:266,w:10,h:6},{x:16,y:268,w:6,h:4},{x:228,y:266,w:9,h:5},{x:238,y:267,w:5,h:3},{x:404,y:240,w:8,h:5},{x:336,y:228,w:6,h:4},{x:182,y:186,w:7,h:4}];for(let n of t){let o=e.get(n.x+n.w,n.y);o&&e.fill(n.x+2,n.y,n.w,1,W(o,"#6B4A28",.35));for(let r=0;r<n.h;r++){let s=n.y-n.h+r,i=r===0?2:r===1?1:0;for(let a=n.x+i;a<n.x+n.w-i;a++){let l=(a-n.x)/n.w+r/n.h,u=l<.5?ze.light:l<1.15?ze.face:ze.shade;(r===n.h-1||a===n.x+n.w-i-1)&&(u=ze.shade),e.set(a,s,u)}}}}function uu(e){let t=Z(77);for(let n=0;n<150;n++){let o=t()**.8,r=Math.floor(We+6+o*(270-We-8)),s=Math.floor(t()*480),i=3+Math.floor(o*12+t()*4),a=Math.max(1,Math.round(i/9));for(let l=0;l<i;l++){let u=s+l,d=-Math.round(Math.sin(Math.PI*l/Math.max(1,i-1))*a),f=e.get(u,r+d);if(!f)continue;e.set(u,r+d,W(f,"#FFF4DA",.32));let m=e.get(u,r+d+1);m&&e.set(u,r+d+1,W(m,"#8A5E2E",.22))}}}function du(e){for(let t=We;t<270;t++){let n=2+(t-200)/40;if(!(n<1.5))for(let o=0;o<480;o++){let r=1/0;for(let a of ru)r=Math.min(r,su(o,t,a));if(r>n+1)continue;let s=r<n-.5;if(!s&&!ee(o,t,.5))continue;let i=s?tn.face:tn.light;s&&((o*13+t*7)%17===0||(o*5+t*11)%23===0)?i=tn.track:s&&ee(o,t,.2)&&(i=tn.light),e.set(o,t,i)}}}function fu(e){let t=Z(301);for(let n=0;n<56;n++){let o=t(),r=Math.floor(We+8+o*(270-We-12)),s=Math.floor(t()*480),i=o>.6&&t()<.5?3:o>.25?2:1,a=e.get(s+i,r+1);if(a&&e.fill(s+1,r+1,i,1,W(a,"#6B4A28",.3)),i===1){e.set(s,r,ze.face);continue}e.fill(s,r,i,i-1,ze.face),e.fill(s,r,i-1,1,ze.light),e.fill(s,r+i-1,i,1,ze.shade)}}function pu(e){let t=Z(503);for(let n=0;n<22;n++){let o=n<12,r=Math.floor(t()*480),s=o?We+4+Math.floor(t()*14):150+Math.floor(t()*110),i=3+Math.floor(t()*4),a=e.get(r,s+1);a&&e.fill(r,s+1,i,1,W(a,"#6B4A28",.25));for(let l=0;l<i;l++){let u=1+Math.round(Math.sin(Math.PI*(l+.5)/i)*(1+(i>4?1:0)));for(let d=0;d<u;d++){let f=d===u-1?l<i/2?nn.light:nn.face:(l+d)%2===0?nn.face:nn.shade;e.set(r+l,s-d,f)}}}}function mu(e){let t=Z(211),n=0;for(;n<480;){let o=2+Math.floor(t()*4);for(let r=0;r<o;r++){let s=n+r,i=2+Math.floor(t()*4);for(let a=0;a<i;a++){let l=We+1-a;e.set(s,l,a===i-1&&t()<.4?en.tip:r%2===0?en.face:a>i/2?en.light:en.shade)}}n+=o+2+Math.floor(t()*9)}}var Si=new Map;function Ei(e){let t=Si.get(e);if(!t){let n=Bt(e),o=new de(480,270);$c(o);let r=new de(480,270);Hc(r);let s=new de(480,270);qc(s,r,e);let i=new de(480,270);iu(i),t={far:o.runs(n),bank:r.runs(n),water:s.runs(n),plain:i.runs(n)},Si.set(e,t)}return t}function Ci(e,t,n){let o=Ei(t);e.rects(o.far),e.tint(Bt(t)),ou(e,n),e.tint(null),e.rects(o.bank)}function Mi(e,t,n){let o=Ei(t);e.rects(o.water);let r=cs[t];for(let s of jc(n))e.rect(s.x,s.y,s.w,1,r);e.tint(Bt(t)),Jc(e,n),e.tint(null),e.rects(o.plain),t==="day"&&gu(e,n)}function hu(e){return Math.floor(te(e)*5)%8}function gu(e,t){let n=hu(t);e.alpha(.22);for(let o=0;o<3;o++){let r=We+3+o*2,s=o%2===0?n:7-n;for(let i=-8+s;i<480;i+=8)e.rect(i,r,3,1,"#FFF6E0")}e.alpha(1)}var Ut="#4A3020";function bn(e){let t=e.runs().map(n=>({x:n.x,y:n.y,w:n.w,color:n.color}));return{w:e.width,h:e.height,top:0,runs:t,mirrored:t.map(n=>({...n,x:e.width-n.x-n.w}))}}function pt(e,t,n){return{left:t-Math.floor(e.w/2),top:n-e.h}}function Ai(e,t,n){let o=e+8,r=t+5,s=new de(o,r),i=Math.floor(o/2),a=5,l=r-1,u=Math.floor(e/2);for(let m of[-1,1]){let y=i+m*3,E=i+m*(u+3);for(let g=a+3;g<=l;g++){let w=(g-a-3)/(l-a-3);s.set(Math.round(y+(E-y)*w),g,"#8A6A44")}s.set(E,l,Ut)}for(let m=1;m<a;m++)s.set(i,m,K[1]);let d=n%2===0?Ge.stripe:Fn;s.fill(i+1,1,3,1,d),s.fill(i+1,2,2,1,d);for(let m=a;m<=l;m++){let y=m-a,E=Math.round(u*y/(l-a));for(let g=-E;g<=E;g++){let w=i+g,x=g<0?g>-E+1||y<3?Ge.cloth:"#F3E6C8":Ge.shade;g<0&&g>=-Math.max(1,Math.floor(E/3))&&(x=W(Ge.cloth,Ge.shade,.35)),(l-m===3||l-m===4)&&(x=g<0?Ge.stripe:"#8E2F2B"),Math.abs(g)===E&&(x=Ut),s.set(w,m,x)}}let f=a+Math.floor((l-a)*.42);for(let m=f;m<l;m++){let y=Math.floor((m-f)*3/(l-f))+1;for(let E=-y;E<=y;E++)s.set(i+E,m,m===f?Ut:"#3E2A1C");s.set(i-y-1,m,"#F6EBD2")}return s.fill(i-u,l,2*u+1,1,Ut),bn(s)}var Di=[{x:24,bottom:L.camp.y-24,sprite:Ai(28,15,0)},{x:63,bottom:L.camp.y-26,sprite:Ai(24,13,1)}],Se={x:86,y:197},bu=[["...r...","..ro...","..roy..",".royyr.",".oyWyo.","royWyor",".ryyyr."],["....r..","...or..","..ryo..",".roWyr.",".oyWyo.","royyWor",".ryyyr."],["..r....","..oy...",".royo..",".ryWyr.","royWyo.","royWyor",".ryyyr."]],yu=[["..r..",".roy.",".oWo.","ryWyr",".ryr."],["...r.","..or.",".ryo.","royWr",".ryr."],[".r...",".oy..",".oWr.","ryWyo",".ryr."]],Ui={W:ct.white,y:ct.yellow,o:ct.orange,r:ct.red},Li=bu.map(e=>ue(e,Ui)),Ni=yu.map(e=>ue(e,Ui));function $i(e,t){return(Math.floor(te(e)*8)+t)%3}var Ti=ue(["..ennnNe..",".gnNnnNNg.","GgsgGgsgGg",".gGgsgGg.."],{n:K[0],N:K[1],e:ct.ember,g:zo.shade,G:zo.light,s:"#5A4636"}),pr=4;function xu(e){let t=te(e),n=[];for(let o=0;o<5;o++){let r=(t+o*(pr/5))%pr/pr;n.push({x:Math.round(Se.x+Math.sin(r*5+o)*1.5+r*9),y:Math.round(Se.y-11-r*30),r:r<.25?1:r<.6?2:3,alpha:.7*(1-r)**1.2})}return n}var Ri=new Map;function wu(e){let t=Ri.get(e);if(!t){t=[];for(let n=-e;n<=e;n++){let o=Math.round(Math.sqrt(Math.max(0,(e+.4)**2-n*n)));t.push({x:-o,y:n,w:2*o+1,h:1,color:n<0?W(Ko,"#FFFFFF",.2):Ko})}Ri.set(e,t)}return t}function ku(e,t,n){let o=pt(Ti,Se.x,Se.y);e.sprite(Ti,o.left,o.top);for(let i of xu(t))e.alpha(i.alpha),e.rects(wu(i.r),i.x,i.y),e.alpha(1);e.tint(null);let r=Li[$i(t,0)]??Li[0];r&&e.sprite(r,Se.x-3,Se.y-3-r.h);let s=Math.floor(te(t)*3)%5;e.rect(Se.x-2+s,Se.y-11-s%3,1,1,ct.yellow),e.tint(n)}var mr=["..oo....................",".olloo..................","olllffo.................","offeffo.................","ommfffo.................",".oofffo.................","...offfo.......ooooo....","...offfo.....oolllllo...","....offfo...ollllllllo..","....offffo.ollqqqqqllfo.","....offfffollqrrrrrqfffo","....offffffffqqqqqqqffso","...ooffffffffffffffsssso","..offssooooooooooossssso","..oooooo..........oooooo"],hr={o:"#5A3A20",l:He.light,f:He.face,s:He.shade,e:"#2E1E12",m:"#E2C090",q:ce.cream,r:ce.red},Pi=(e,t)=>{let n=[...e];for(let[o,r,s]of t){let i=n[o]??"";n[o]=i.slice(0,r)+s+i.slice(r+1)}return n},Su={rest:ue(mr,hr),blink:ue(Pi(mr,[[3,3,"s"]]),hr),chew:ue(Pi(mr,[[4,1,"f"],[4,2,"f"],[5,1,"m"],[5,2,"m"],[6,1,"o"],[6,2,"o"]]),hr)},hn={x:112,y:178};function vu(e){let t=te(e);if(t%3.7<.15)return"blink";let n=t%9;return n<3&&Math.floor(n*4)%2===1?"chew":"rest"}function Eu(){let e=new de(46,22),t=(n,o,r,s)=>{e.fill(n,o,r,2,he.light),e.fill(n,o+2,r,s-2,he.face),e.fill(n+r-2,o+2,1,s-3,he.shade),e.fill(n,o+s-2,r-1,1,he.shade),e.fill(n,o+s-1,r,1,he.edge),e.fill(n+r-1,o,1,s,he.edge),e.fill(n,o+2,1,s-3,W(he.light,he.face,.4));for(let i=2;i<r-3;i+=3)e.set(n+i,o+3+i%2,he.shade)};for(let n=0;n<32;n++){let o=9+Math.round(3*Math.sin(n/5))-(n>22?n-22:0)-(n<3?3-n:0);for(let r=15-o;r<15;r++){let s=(r+Math.floor(n/6))%4===0,i=r===15-o?he.face:s?he.edge:n%6===5?he.edge:he.shade;e.set(n,r,i)}}t(2,14,10,7),t(12,14,10,7),t(22,14,10,7),t(7,8,10,6),t(17,8,10,6),t(12,3,9,5),e.fill(33,19,13,1,K[0]),e.fill(33,20,13,1,K[1]),e.set(45,18,K[0]),t(35,13,9,6);for(let n=44;n<46;n++)e.set(n,16,"#8A6A44");for(let[n,o]of[[0,21],[31,21],[4,20],[27,21]])e.set(n,o,he.light);return bn(e)}var Oi=Eu(),gn={x:128,y:204},Dt={light:"#79A84C",face:"#4C8A3C",shade:"#2F612C",dark:"#234A22"},mn={light:"#A47447",face:"#7A5230",shade:"#563A22"};function Pe(e,t,n,o=1){let r=Z(n),s=[{a:168,len:12},{a:148,len:13},{a:118,len:9},{a:88,len:7},{a:60,len:10},{a:30,len:13},{a:10,len:12},{a:200,len:9},{a:-22,len:9}].map(l=>({a:l.a+(r()-.5)*12,len:Math.max(3,Math.round((l.len+Math.floor(r()*3))*o))})),i=34,a=e+10;return[0,1].map(l=>{let u=new de(i,a),d={x:Math.floor(i/2),y:a-1},f={x:d.x+t,y:a-1-e};for(let E=d.y;E>=f.y;E--){let g=(d.y-E)/e,w=Math.round(d.x+t*g*g+(l===1?Math.round(g*g*1.2):0)),x=(d.y-E)%3===0;u.set(w,E,x?mn.face:mn.light),u.set(w+1,E,x?mn.shade:mn.face),E>d.y-3&&u.set(w+2,E,mn.shade)}let m=f.x+(l===1?1:0),y=f.y;for(let E of s){let g=E.a*Math.PI/180;for(let w=1;w<=E.len;w++){let x=w/E.len,k=l===1?Math.round(x*x*1.4):0,S=Math.round(m+Math.cos(g)*w)+k,C=Math.round(y-Math.sin(g)*w+x*x*E.len*.55);u.set(S,C,x<.4?Dt.face:Dt.light),w>2&&u.set(S,C+1,x>.7?Dt.shade:Dt.face),w>3&&w%2===0&&u.set(S,C+2,Dt.dark)}}return u.fill(m-1,y-1,3,2,Dt.shade),u.set(m-1,y+1,"#B8642E"),u.set(m+1,y+2,"#8E4A22"),u.set(m,y+1,"#B8642E"),bn(u)})}var po=[{x:7,bottom:194,frames:Pe(30,2,1),phase:0},{x:470,bottom:202,frames:Pe(32,-3,2),phase:.7},{x:182,bottom:156,frames:Pe(22,1,3),phase:1.3},{x:424,bottom:258,frames:Pe(36,3,4),phase:1.9},{x:456,bottom:266,frames:Pe(40,-2,5),phase:.4},{x:6,bottom:142,frames:Pe(16,1,6,.6),phase:.2},{x:19,bottom:140,frames:Pe(12,-1,7,.5),phase:1.1},{x:31,bottom:143,frames:Pe(18,2,8,.62),phase:2},{x:447,bottom:141,frames:Pe(14,-1,9,.55),phase:.9},{x:460,bottom:143,frames:Pe(19,-2,10,.65),phase:1.6},{x:474,bottom:140,frames:Pe(12,1,11,.5),phase:.5}],Bi=2.4;function Cu(e,t){let n=po[e];return n?Math.floor((te(t)+n.phase)%Bi/(Bi/2)):0}var kp=po.length,Me={left:97,right:135,top:257,bottom:266},fo=[98,134];function Mu(){let e=Me.right-Me.left+1,t=new de(e,Me.bottom-Me.top+1),n="#A86E38";for(let o=0;o<5;o++)for(let r=0;r<e;r++){let s=(r+o%2*5)%10===0;t.set(r,o,s?K[1]:o===0?n:o%2===0?K[0]:W(K[0],n,.4))}t.fill(9,0,21,5,ce.red),t.fill(9,0,21,1,U.mid),t.fill(9,4,21,1,U.shadow);for(let o=11;o<28;o+=3)t.set(o,2,U.light);t.fill(0,5,e,1,U.mid),t.fill(0,6,e,3,K[1]);for(let o=2;o<e;o+=4)t.fill(o,6,1,3,"#553418");for(let o of[0,Math.floor(e/2),e-2])t.fill(o,6,2,4,"#553418");return t.fill(0,9,e,1,"#3E2614"),bn(t)}var gr=219,Au=231;function Lu(){let e=fo[0]-2,n=fo[1]+2-e+1,o=Au-gr+1,r=new de(n,o),s=Math.floor(n/2),i=a=>Math.floor((a+1)/4)%2===0;for(let a=0;a<4;a++){let l=Math.round(s*(.6+.4*(a/3)));for(let u=s-l;u<=s+l;u++){let d=u<s,f=i(u)?d?ce.red:ce.redShade:d?ce.cream:ce.creamShade;(Math.abs(u-s)===l||a===0)&&(f=Ut),r.set(u,a,f)}}r.fill(s-1,0,3,1,U.light);for(let a=4;a<10;a++)for(let l=0;l<n;l++){let u=a>=8,d=i(l)?u?ce.redShade:ce.red:u?ce.creamShade:ce.cream;a===4&&(d=U.mid),a===5&&(d=U.shadow),(l===0||l===n-1)&&(d=Ut),r.set(l,a,d)}for(let a=1;a<n-1;a++){let l=(a+1)%4;l>=1&&r.set(a,10,i(a)?ce.redShade:ce.creamShade),l===2&&r.set(a,11,i(a)?ce.redShade:ce.creamShade),l===2&&r.set(a,12,U.mid)}return bn(r)}var Nu=[["yyyyy..","yBBBBy.","yBGBBBy","yBBBBy.","yyyyy.."],["yyyy...","yBBBy..","yBGBBy.","yBBBBBy","yyyyyy."],["yyyyyy.","yBBBBBy","yBGBBy.","yBBBy..","yyyy..."]],Fi=Nu.map(e=>ue(e,{y:U.mid,B:Fn,G:U.gleam}));function Tu(e,t){return(Math.floor(te(e)*5)+t)%3}var Ru=Mu(),Pu=Lu();function Ou(e,t){e.sprite(Ru,Me.left,Me.top);let n=gr-6;fo.forEach((o,r)=>{e.rect(o-1,n,1,Me.top+6-n,"#7E522A"),e.rect(o,n,1,Me.top+6-n,"#5A3618"),e.rect(o-1,n-2,2,2,U.light);let s=Fi[Tu(t,r)]??Fi[0];s&&e.sprite(s,o+1,n)}),e.sprite(Pu,fo[0]-2,gr)}var Bu=ue(["oyyyyyyo","obbbbbbo",".oBBBBo.","..oBBo..","...oo...","..o..o..",".o....o.","o......o"],{o:"#4A2E18",y:ut.light,b:ut.face,B:ut.shade}),_i=ue(["oyyyo","obbbo",".oBo.","..n..","..n..","..N..","..n..","..n..","..N..","..n..","..n..","..N..","..n..",".nNn."],{o:"#4A2E18",y:ut.light,b:ut.face,B:ut.shade,n:K[0],N:K[1]}),yr=[{x:103,y:259,seed:1},{x:129,y:259,seed:2}],xr=[{x:422,y:214,seed:2}],Fu=128,Iu=26;function Gi(e){let t=e.base>0&&e.blockW>0?e.base*e.blockW:Fu,n=Math.min(q.maxWidth,t)/2,o=q.baseY+6;return[{x:Math.round(q.centerX-n-7),y:o,seed:0},{x:Math.min(Math.round(q.centerX+n+7),L.sledge.x-26),y:o,seed:1}]}function Hi(e){return{y:e.y,draw:(t,n,o)=>br(t,_i,e.x,e.y,e.seed,n,o)}}function Wi(e){return{x:e.x,y:e.y-16,radius:Iu,seed:e.seed+3}}function Yi(e){return{cx:e.x,y:e.y,rx:3,ry:1}}function br(e,t,n,o,r,s,i){let a=pt(t,n,o);e.sprite(t,a.left,a.top),e.tint(null);let l=Ni[$i(s,r)]??Ni[0];l&&e.sprite(l,n-2,a.top-l.h+1),e.tint(i)}var Ii=Ot(Ce.well),qi=[{x:Se.x,y:Se.y-4,radius:26,seed:0},...yr.map(e=>({x:e.x,y:e.y-12,radius:20,seed:e.seed})),...xr.map(e=>({x:e.x,y:e.y-16,radius:20,seed:e.seed+3}))],Ki=[...Di.map(e=>({cx:e.x,y:e.bottom,rx:Math.floor(e.sprite.w/2)-3,ry:2})),...po.map(e=>({cx:e.x+1,y:e.bottom,rx:e.bottom<150?3:6,ry:1})),{cx:Se.x,y:Se.y,rx:6,ry:1},{cx:hn.x,y:hn.y,rx:12,ry:2},{cx:gn.x,y:gn.y,rx:23,ry:2},{cx:L.well.x,y:L.well.y-2,rx:11,ry:2},{cx:Math.round((Me.left+Me.right)/2)+1,y:Me.bottom,rx:21,ry:2},...yr.map(e=>({cx:e.x,y:e.y,rx:4,ry:1})),...xr.map(e=>({cx:e.x,y:e.y,rx:3,ry:1}))];function zi(){let e=[];for(let o of Di){let r=pt(o.sprite,o.x,o.bottom);e.push({y:o.bottom,draw:s=>s.sprite(o.sprite,r.left,r.top)})}po.forEach((o,r)=>{e.push({y:o.bottom,draw:(s,i)=>{let a=o.frames[Cu(r,i)]??o.frames[0];if(!a)return;let l=pt(a,o.x,o.bottom+1);s.sprite(a,l.left,l.top)}})}),e.push({y:hn.y,draw:(o,r)=>{let s=Su[vu(r)],i=pt(s,hn.x,hn.y);o.sprite(s,i.left,i.top)}}),e.push({y:Se.y,draw:ku});let t=pt(Oi,gn.x,gn.y);e.push({y:gn.y,draw:o=>o.sprite(Oi,t.left,t.top)});let n=pt(Ii,L.well.x,L.well.y-2);e.push({y:L.well.y-2,draw:o=>o.sprite(Ii,n.left,n.top)}),e.push({y:Me.top+1,draw:(o,r)=>Ou(o,r)});for(let o of yr)e.push({y:o.y,draw:(r,s,i)=>br(r,Bu,o.x,o.y,o.seed,s,i)});for(let o of xr)e.push({y:o.y,draw:(r,s,i)=>br(r,_i,o.x,o.y,o.seed,s,i)});return e}var $t=q.baseY+2,Du=Qn(),ji=new Map;function _t(e){let t=ji.get(e);return t||(t=Ot(e),ji.set(e,t)),t}function Uu(e,t,n){return e.runs.map(o=>({x:t+o.x,y:n+o.y,w:o.w,h:1,color:o.color}))}function wr(e,t,n){let o=_t(e);return Uu(o,t-Math.floor(o.w/2),n-o.h)}var kr=L.rations.y+3,Sr=L.sledge.y+6,bo=(e,t)=>({y:e,draw:n=>n.rects(t)}),$u=[bo(Sr,wr(Ce.sledge,L.sledge.x+1,Sr)),bo(L.treasury.y,wr(Ce.chest,L.treasury.x,L.treasury.y)),bo(kr,wr(Ce.table,L.rations.x,kr))],_u=[{cx:L.sledge.x+1,y:Sr,rx:12,ry:1},{cx:L.treasury.x,y:L.treasury.y,rx:8,ry:1},{cx:L.rations.x,y:kr,rx:11,ry:1},{cx:L.treasury.x-22,y:L.treasury.y+1,rx:12,ry:1}],mt={x:q.centerX,y:q.baseY+22},Zi=zi(),Gu=Zi.filter(e=>e.y<q.baseY).sort((e,t)=>e.y-t.y),Hu=Zi.filter(e=>e.y>=q.baseY);function Wu(e,t){let n=[...Hu,...$u,bo(L.treasury.y+1,qu(e.coins)),...t.map(Hi)],o=e.pyramid.monument;return o&&n.push({y:mt.y,draw:r=>yi(r,o,mt.x,mt.y)}),n.sort((r,s)=>r.y-s.y)}function Yu(e,t){let n=[...Ki,..._u,...t.map(Yi)],o=e.pyramid.monument;if(o){let r=cr(o,mt.x,mt.y);n.push({cx:mt.x,y:mt.y,rx:Math.ceil(r.w/2)+2,ry:1})}return n}var yn=6,Vi=new Map;function qu(e){let t=Math.max(0,Math.min(48,Math.floor(Number.isFinite(e)?e:0))),n=Vi.get(t);if(n)return n;let o=new Array(yn).fill(0);for(let s=0;s<t;s++){let i=0,a=1/0;for(let l=0;l<yn;l++){let u=(o[l]??0)+Math.abs(l-(yn-1)/2)*1.8;u<a&&(a=u,i=l)}o[i]=(o[i]??0)+1}n=[];let r=L.treasury.y+1;for(let s=0;s<yn;s++){let i=o[s]??0;if(i===0)continue;let a=L.treasury.x-10-(yn-s)*4;n.push({x:a-1,y:r-i,w:1,h:i,color:xe});for(let l=0;l<i;l++)n.push({x:a,y:r-1-l,w:3,h:1,color:l%2===0?In.shadow:In.face});n.push({x:a,y:r-i-1,w:3,h:1,color:In.face},{x:a+1,y:r-i-1,w:1,h:1,color:U.gleam})}return Vi.set(t,n),n}var Xi=new Map;function Ku(e,t){let n=`${e}x${t}`,o=Xi.get(n);if(o)return o;let r=e>=16,s=r?8:4,i=r?4:2;o=[];let a=Math.max(1,Math.ceil(t/i));for(let l=0;l<a;l++){let u=t-l*i,d=Math.max(0,u-i);for(let f=l%2===1?-s/2:0;f<e;f+=s){let m=Math.max(0,f),y=Math.min(e,f+s);y>m&&o.push({dx:m,dy:d,w:y-m,h:u-d})}}return Xi.set(n,o),o}var Qi=ge,zu={light:Nt(ge.light),face:Nt(ge.face),mortar:Nt(ge.mortar),edge:Nt(ge.edge)},ju={light:W(Mt.light,"#FFFFFF",.25),face:Mt.light,mortar:Mt.dark,edge:Mt.dark};function Vu(e,t,n,o,r){e.rect(t+o.dx,n+o.dy,o.w,o.h,r.mortar);let s=Math.max(1,o.w-1),i=Math.max(1,o.h-1);e.rect(t+o.dx,n+o.dy,s,i,r.face),o.h>=3&&(e.rect(t+o.dx,n+o.dy,s,1,r.light),e.rect(t+o.dx,n+o.dy,1,i,r.light))}function ea(e,t,n){e.rect(t.x,t.y,t.w,1,n),e.rect(t.x,t.y+t.h-1,t.w,1,n),e.rect(t.x,t.y,1,t.h,n),e.rect(t.x+t.w-1,t.y,1,t.h,n)}function mo(e,t,n){for(let o=0;o<t.w;o+=2)e.rect(t.x+o,t.y,1,1,n),e.rect(t.x+o,t.y+t.h-1,1,1,n);for(let o=2;o<t.h-1;o+=2)e.rect(t.x,t.y+o,1,1,n),e.rect(t.x+t.w-1,t.y+o,1,1,n)}function ho(e,t,n,o){let r=Ku(t.w,t.h),s=Number.isFinite(n)?Math.min(1,Math.max(0,n)):0,i=Math.round(s*r.length);for(let a=0;a<i;a++){let l=r[a];l&&Vu(e,t.x,t.y,l,o)}}function Xu(e,t){switch(t.look){case"empty":ea(e,t,rs);break;case"planned":mo(e,t,Bn);break;case"building":mo(e,t,Bn),ho(e,t,t.fill,Qi);break;case"stalled":mo(e,t,Nt(Bn)),ho(e,t,t.fill,zu);break;case"orphaned":mo(e,t,Mt.dark),ho(e,t,Math.max(t.fill,.15),ju);break;case"set":ho(e,t,1,Qi),e.rect(t.x,t.y,t.w,1,ge.light),e.rect(t.x+t.w-1,t.y+1,1,t.h-1,ge.edge);break;case"fallen":{e.rect(t.x,t.y,t.w,t.h,Ct.gap),e.rect(t.x,t.y,t.w,1,Ct.crack);let n=Z(t.x*31+t.y*17),o=t.x+Math.floor(t.w/2);for(let r=t.y+1;r<t.y+t.h;r++)o=Math.min(t.x+t.w-2,Math.max(t.x+1,o+Math.floor(n()*3)-1)),e.rect(o,r,1,1,Ct.crack),r%3===0&&e.rect(o+1,r,1,1,Ct.crack);break}}}function Qu(e,t,n){let o=Number.isFinite(e)?Math.min(1,Math.max(0,e)):0;return Math.round((1-o)*(t+n+4))-2}function Ju(e,t){let n=Qu(t.flash,t.w,t.h);e.alpha(.75);for(let o=0;o<t.h;o++){let r=t.x+n-o;for(let[s,i,a]of[[0,3,qo],[-3,1,U.gleam]]){let l=Math.max(t.x,r+s),u=Math.min(t.x+t.w,r+s+i);u>l&&e.rect(l,t.y+o,u-l,1,a)}}e.alpha(1)}function Zu(e,t){let n=t.base>0?t.base*t.blockW:q.maxWidth/2,o=Math.imul(e+1,2654435761)>>>0,r=Math.max(0,n-4);return{x:q.centerX-r/2+o%1e3/1e3*r,y:q.baseY+1+(o>>>12)%7}}function ed(e,t){for(let r of t.blocks)Xu(e,r);for(let r of t.blocks)r.flash>0&&(e.alpha(Math.min(1,r.flash)*.6),e.rect(r.x,r.y,r.w,r.h,qo),e.alpha(1),r.look==="set"&&Ju(e,r));for(let r of t.blocks)r.highlight&&ea(e,r,U.light);let n=Math.max(0,Math.min(200,Math.floor(t.rubble)));for(let r=0;r<n;r++){let s=Zu(r,t),i=Ce.rubble[r%Ce.rubble.length]??Ce.rubble[0],a=_t(i);e.sprite(a,Math.round(s.x)-Math.floor(a.w/2),Math.round(s.y)-a.h+1)}let o=t.capstone;if(o.state!=="none"){if(o.state==="waiting"&&o.flag!=="none"){let r=L.sledge.x+15,s=L.sledge.y+5;e.rect(r,s-18,1,18,K[1]),e.rect(r,s-19,1,1,U.light);let i=o.flag==="passed"?Yo.green:Yo.red;for(let a=0;a<4;a++)e.rect(r+1,s-18+a,6-a*1.5,1,i);e.rect(r+1,s-15,1,1,xe)}ta(e,o)}}function ta(e,t){let n=_t(t.ready?Ce.capstoneGleam:Ce.capstone),o=Math.round(t.x)-Math.floor(n.w/2),r=Math.round(t.y)-n.h;e.sprite(n,o,r),t.ready&&e.sprite(_t(Ce.glint),o-3,r-2)}function td(e,t,n,o){let r=Math.max(4,Math.min(40,Math.round(o))),s=Math.round(t),i=Math.round(n);for(let a=0;a<r;a++){let l=r-(a-a%2),u=i-1-a,d=a>=r-3,f=a%2===1;e.rect(s-l,u,l,1,d?U.light:f?V.face:V.light),e.rect(s,u,l,1,d?U.mid:f?V.dark:V.shade)}e.rect(s-r-1,i-1,2*r+2,1,V.dark)}var nd=new Set(["walk","carry-scroll","carry-stone","carry-ration"]),od=new Set(["laborer","mason","scribe","skeptic","surveyor"]);function rd(e,t){if(t<=1)return 0;if(e.pose==="work"&&od.has(e.cast))return e.stroke<.5?1:0;let n=nd.has(e.pose)?8:4,o=Number.isFinite(e.poseTime)?Math.max(0,e.poseTime):0;return Math.floor(o*n)%t}function sd(e){let t=Du.frames(e.cast,e.pose,e.ration,e.ghost);return t[rd(e,t.length)]??null}function id(e,t){let n=t.blockH;if(!(n>0)||!Number.isFinite(e))return e-8;let o=Math.max(1,Math.ceil((q.baseY-(e-6))/n));return o<=t.base?q.baseY-o*n:e-8}function ad(e,t,n,o){let r=id(n,o);if(!(r>=$t)){e.rect(t-4,r,1,$t-r,K[1]),e.rect(t+3,r,1,$t-r,K[1]);for(let s=$t-2;s>=r;s-=3)e.rect(t-3,s,6,1,K[0])}}function ld(e,t,n){e.rect(t-7,n+2,1,$t-n-2,K[1]),e.rect(t+6,n+2,1,$t-n-2,K[1]),e.rect(t-9,n,18,1,K[0]),e.rect(t-9,n+1,18,1,K[1])}function Ji(e,t){return Math.round(e.y)-t.h+t.top}function cd(e,t,n,o){let r=Z(t.seed),s=3+Math.floor(r()*5),i=s>4?2:1,a=Math.ceil(s/i),l=a*4-1+6,u=i*5-1+6,d=Number.isFinite(t.open)?Math.min(1,Math.max(0,t.open)):1;if(d<=0)return o;let f=Math.max(4,Math.round(l*d)),m=Math.max(4,Math.round(u*d)),y=d>=.5?3:1,g=Math.max(m+1,o-1-y)-m,w=Math.min(479-f,Math.max(1,n-Math.floor(f/2)-2));e.rect(w+1,g,f-2,1,xe),e.rect(w+1,g+m-1,f-2,1,xe),e.rect(w,g+1,1,m-2,xe),e.rect(w+f-1,g+1,1,m-2,xe),e.rect(w+1,g+1,f-2,m-2,At.fill);let x=Math.min(w+f-4,Math.max(w+2,n-1));if(e.rect(x,g+m-1,2,1,At.fill),y>=3&&(e.rect(x-1,g+m-1,1,2,xe),e.rect(x,g+m,1,1,At.fill),e.rect(x+1,g+m,1,1,xe),e.rect(x+2,g+m-1,1,1,xe),e.rect(x,g+m+1,1,1,xe)),d<1)return g;for(let k=0;k<s;k++){let S=Xn[Math.floor(r()*Xn.length)]??Xn[0]??[],C=Math.floor(k/a),O=w+3+k%a*4,I=g+3+C*5;S.forEach((P,G)=>{for(let Y=0;Y<P.length;Y++)P[Y]==="#"&&e.rect(O+Y,I+G,1,1,At.glyph)})}return g}function na(e){return Math.min(1,Math.max(0,Number.isFinite(e.alpha)?e.alpha:1))*(e.ghost?.5:1)}function oa(e){return e.pose==="work"&&Math.round(e.y)<q.baseY}function ud(e){let t=[],n=[];for(let o of e.actors){if(o.pose==="climb"||o.pose==="climb-stone"||oa(o)||!Number.isFinite(o.x)||!Number.isFinite(o.y))continue;let r=na(o);if(r<=0)continue;let s=o.cast==="arbab"?7:o.pose==="sleep"?8:5,i={cx:Math.round(o.x),y:Math.round(o.y),rx:s,ry:1};r>=1?t.push(i):n.push({spot:i,alpha:r})}return{solid:t,faded:n}}function dd(e,t,n,o,r){let s=t.actors.map((u,d)=>({actor:u,i:d}));s.sort((u,d)=>u.actor.y-d.actor.y||u.i-d.i);let i=Wu(t,n),a=0,l=[];for(let{actor:u}of s){for(;a<i.length&&(i[a]?.y??0)<=u.y;a++)i[a]?.draw(e,r,o);let d=sd(u);if(!d)continue;let f=Math.round(u.x),m=Math.round(u.y);(u.pose==="climb"||u.pose==="climb-stone")&&ad(e,f,m,t.pyramid);let y=na(u);oa(u)&&(ld(e,f,m),e.tint(null),pn(e,t.sky,[{cx:f,y:m,rx:4,ry:0}],y),e.tint(o)),!(y<=0)&&(y<1&&e.alpha(y),e.sprite(d,f-Math.floor(d.w/2),m-d.h,u.facing===-1),y<1&&e.alpha(1),l.push({actor:u,sprite:d}))}for(;a<i.length;a++)i[a]?.draw(e,r,o);return l}function fd(e,t,n,o){let r=new Map;for(let{actor:s,sprite:i}of n){let a=Math.round(s.x),l=Ji(s,i);if(s.icon){let u=_t(Vn[s.icon]);l-=u.h+2,e.sprite(u,a-Math.floor(u.w/2),l)}if(s.highlight){let u=_t(Es);(t.reducedMotion||Math.floor(Math.max(0,s.poseTime)*4)%2===0)&&e.sprite(u,a-Math.floor(u.w/2),l-u.h-1),l-=u.h+1}r.set(s,l)}for(let{actor:s,sprite:i}of n){if(!s.bubble)continue;let a=cd(e,s.bubble,Math.round(s.x),Ji(s,i));r.set(s,Math.min(r.get(s)??a,a))}for(let{actor:s}of n)s.highlight&&bi(e,s.lane??s.id,Math.round(s.x),(r.get(s)??Math.round(s.y))-2,o)}var go="#FBF0D6",pd=.3;function md(e,t){let{x:n,y:o}=t;switch(t.kind){case"dust":t.life>pd?(e.rect(n,o-1,2,1,go),e.rect(n,o,1,1,go),e.rect(n+1,o,1,1,On[2])):(e.alpha(.8),e.rect(n-1,o,3,1,go),e.rect(n,o-1,1,1,go),e.rect(n+1,o+1,1,1,On[2]),e.alpha(1));break;case"stone":e.rect(n,o,2,2,ge.face),e.rect(n,o,1,1,ge.light);break;case"sparkle":e.rect(n,o,1,1,Math.floor(t.life*10)%2===0?U.gleam:U.light);break;case"coin":e.rect(n,o,2,2,U.light);break}}function ra(e,t){e.imageSmoothingEnabled=!1,e.globalAlpha=1;let n=Xs(e),o=t.sky.phase,r=te(t.time),s=Bt(o),i=ui(t.shake,r);(i.dx!==0||i.dy!==0)&&(n.rect(0,0,480,128,Lt[o][0]??"#000000"),n.tint(s),n.rect(0,128,480,142,lt[4]),n.tint(null)),n.offset(i.dx,i.dy),oi(n,t.sky,r),Ci(n,o,r),n.tint(s);for(let f of t.far.slice(0,3))td(n,f.x,f.y,f.height);n.tint(null),Mi(n,o,r);let a=Gi(t.pyramid);pn(n,t.sky,Yu(t,a)),t.pyramid.blocks.some(f=>f.look!=="empty"&&f.look!=="planned")&&hi(n,t.sky,q,t.pyramid),n.tint(s);for(let f of Gu)f.draw(n,r,s);ed(n,t.pyramid),n.tint(null);let l=ud(t);pn(n,t.sky,l.solid);for(let f of l.faded)pn(n,t.sky,[f.spot],f.alpha);n.tint(s);let u=dd(n,t,a,s,r);for(let f of t.particles)md(n,f);n.tint(null),o==="night"&&fi(n,[...qi,...a.map(Wi)],r);let d=t.pyramid.capstone;mi(n,d,t.pyramid.apex),d.state!=="none"&&d.glow>0&&ta(n,d),fd(n,t,u,i),n.offset(0,0),pi(n,o),e.globalAlpha=1}var sa="arbab-ui-sound";var hd=[{at:0,freq:3150},{at:.065,freq:3420},{at:.14,freq:2980}];function gd(e){try{return e()?.getItem(sa)==="on"}catch{return!1}}function bd(e,t){try{e()?.setItem(sa,t?"on":"off")}catch{}}function ia(e){let t=gd(e.storage),n=null,o=null,r=null,s=[],i=[],a=(g,w)=>{let x=e.now();for(;g.length>0&&x-(g[0]??0)>=1e3;)g.shift();return g.length>=w?!1:(g.push(x),!0)},l=()=>{if(!(n||!e.AudioContext))try{n=new e.AudioContext;let g=n.createGain();g.gain.value=.25,g.connect(n.destination),o=g;let w=Math.floor(n.sampleRate*.2);r=n.createBuffer(1,w,n.sampleRate);let x=r.getChannelData(0),k=12345;for(let S=0;S<x.length;S++)k=Math.imul(k,1103515245)+12345>>>0,x[S]=k/4294967296*2-1}catch{n=null,o=null}},u=()=>{n&&n.state==="suspended"&&n.resume().catch(()=>{})},d=(g,w,x,k,S)=>{let C=g.createOscillator();C.type="sine",C.frequency.setValueAtTime(k,x),C.frequency.exponentialRampToValueAtTime(k*.4,x+.16);let O=g.createGain();if(O.gain.setValueAtTime(S,x),O.gain.exponentialRampToValueAtTime(.001,x+.22),C.connect(O),O.connect(w),C.start(x),C.stop(x+.25),r){let I=g.createBufferSource();I.buffer=r;let P=g.createBiquadFilter();P.type="lowpass",P.frequency.setValueAtTime(1800,x);let G=g.createGain();G.gain.setValueAtTime(S*.35,x),G.gain.exponentialRampToValueAtTime(.001,x+.06),I.connect(P),P.connect(G),G.connect(w),I.start(x),I.stop(x+.08)}},f=(g,w,x,k,S=.4)=>{let C=g.createBiquadFilter();C.type="lowpass",C.frequency.setValueAtTime(900,x);let O=g.createGain();O.gain.setValueAtTime(1e-4,x),O.gain.linearRampToValueAtTime(.35,x+.05),O.gain.setValueAtTime(.3,x+S-.1),O.gain.exponentialRampToValueAtTime(.001,x+S),C.connect(O),O.connect(w);for(let I of[-7,7]){let P=g.createOscillator();P.type="sawtooth",P.frequency.setValueAtTime(k,x),P.detune.setValueAtTime(I,x),P.connect(C),P.start(x),P.stop(x+S+.02)}},m=(g,w,x)=>{f(g,w,x,196,.35),f(g,w,x+.3,294,.5)},y=(g,w,x,k,S,C,O)=>{let I=g.createOscillator();I.type=k,I.frequency.setValueAtTime(S,x);let P=g.createGain();P.gain.setValueAtTime(C,x),P.gain.exponentialRampToValueAtTime(.001,x+O),I.connect(P),P.connect(w),I.start(x),I.stop(x+O+.01)},E=(g,w,x)=>{let k=g.createOscillator();k.type="sine",k.frequency.setValueAtTime(160,x),k.frequency.exponentialRampToValueAtTime(120,x+.06);let S=g.createGain();S.gain.setValueAtTime(.15,x),S.gain.exponentialRampToValueAtTime(.001,x+.06),k.connect(S),S.connect(w),k.start(x),k.stop(x+.07);for(let C of hd)y(g,w,x+C.at,"triangle",C.freq,.1,.12),y(g,w,x+C.at,"sine",C.freq*1.3,.04,.09)};return{get enabled(){return t},toggle(){return t=!t,bd(e.storage,t),t&&(l(),u()),t},unlock(){t&&(l(),u())},play(g){if(!t||!n||!o)return;let w=n,x=o,k=w.currentTime+.01;switch(g){case"brief":case"report":f(w,x,k,220);break;case"stone":if(!a(s,3))return;d(w,x,k,140,.5);break;case"pay":if(!a(i,2))return;E(w,x,k);break;case"set":m(w,x,k);break;case"fall":d(w,x,k,60,.8);break;case"capstone":m(w,x,k);for(let S=0;S<10;S++)d(w,x,k+.9+S*.06,120,.2+S*.05);break}}}}var yd="This page needs its session token. Use the tab `arbab ui` opened, or run `arbab ui --no-open` to print a URL that carries it.",xd=2,wd=3e4,kd=600;function Sd(e){let t={};for(let[n,o]of Object.entries(to)){let r=e.getElementById(o);if(!r)return null;t[n]=r}return t}function aa(e,t,n){if(!e)return;Qt(e,16*t,16*t,n);let o=e.getContext("2d");o&&Jo(o,Qo,0,0,t*n)}function vd(e){let t=e.document,n=Sd(t),o=Xt(t.getElementById(to.canvas));if(!n||!o)return null;let{stage:r,tooltip:s,notice:i,banner:a,connection:l,live:u,site:d}=n,f=ns(e.devicePixelRatio),m=R=>{i.textContent=R,i.hidden=!1},y=z(t,{scale:1,color:A.muted,dpr:f});l.replaceChildren(y.el);let E=R=>{l.setAttribute("data-state",R);let{text:D,color:$}=zs(R);y.set(D,$)};E("connecting");let g=Gr(e.location.hash);if(!g)return m(yd),n.project.textContent="no session token",E("closed"),null;let w=o.getContext("2d");if(!w)return m("This browser cannot draw the scene; the ledger below still works."),null;o.width=480,o.height=270;let x=!1;try{x=e.matchMedia("(prefers-reduced-motion: reduce)").matches}catch{x=!1}let k=Bo({reducedMotion:x,random:Math.random}),S=Qn();aa(Xt(n.logo),2,f),aa(Xt(n.titleCardLogo),4,f),n.title.replaceChildren(z(t,{scale:3,color:A.gold,dpr:f},"ARBAB").el),n.titleCardWord.replaceChildren(z(t,{scale:6,color:A.gold,dpr:f},"ARBAB").el),n.siteTitle.replaceChildren(z(t,{scale:2,color:A.gold,dpr:f},"THE SITE").el);let C=z(t,{scale:1,color:A.sand,dpr:f},"THE SITE IS QUIET");n.caption.replaceChildren(C.el);let O="",I=(R,D)=>{O=$o(k.world),C.set(ts(R,D,k.world))},P=[ir(t,n.gauge5h,"5h",f),ir(t,n.gauge7d,"7d",f)],G=Us(t,n.kpis,{dpr:f,reducedMotion:x}),Y=ia({AudioContext:e.AudioContext,storage:e.storage,now:e.now}),Oe=()=>{n.sound.setAttribute("aria-pressed",String(Y.enabled)),n.sound.textContent=Y.enabled?"sound on":"sound off"};Oe(),n.sound.addEventListener("click",()=>{Y.toggle(),Oe()});let Be=()=>t.fullscreenElement!==void 0&&t.fullscreenElement!==null&&t.fullscreenElement===d;n.siteFullscreen.hidden=typeof d.requestFullscreen!="function",n.siteFullscreen.addEventListener("click",()=>{try{let R=Be()&&typeof t.exitFullscreen=="function"?t.exitFullscreen():d.requestFullscreen?.();R instanceof Promise&&R.catch(()=>{})}catch{}});let ve=()=>n.crewPanel.setAttribute("data-more",String(Rs(n.crewScroll)));n.crewScroll.addEventListener("scroll",ve);let Fe=()=>{let R=r.getBoundingClientRect(),D=Be()?R.height:_r(e.window.innerHeight,n.header.getBoundingClientRect().height,n.kpis.getBoundingClientRect().height,d.getBoundingClientRect().height-R.height),$=$r(R.width,D,e.devicePixelRatio);o.className=$.fluid?"fluid":"",o.style.width=$.fluid?"100%":`${$.width}px`,o.style.height=$.fluid?"auto":`${$.height}px`,ve()};Fe(),e.window.addEventListener("resize",Fe),t.addEventListener("fullscreenchange",Fe);let fe=null,Ie=new Map,De=0,le=null,ne=null,nt="crew",pe=null,Ue=null,ht=[],$e=()=>e.now()+De,Gt=R=>{a.textContent=R,a.hidden=!1},Ht=()=>{a.hidden=!0,a.textContent=""},Ye=()=>k.highlight(le??ne??pe),yo=()=>{let R=o.getBoundingClientRect(),D=r.getBoundingClientRect();return{x:R.left-D.left,y:R.top-D.top}},xo=R=>{let D=yo(),$=o.getBoundingClientRect().width,Q=$>0?$/480:1,se=k.world.actors.find(_e=>_e.lane===R);if(se)return{x:D.x+se.x*Q,y:D.y+(se.y-20)*Q};let ye=k.world.pyramid.blocks.find(_e=>_e.lane===R);return ye?{x:D.x+(ye.x+ye.w)*Q,y:D.y+ye.y*Q}:{x:D.x+8,y:D.y+8}},xn=z(t,{scale:1,color:A.gold,dpr:f}),wn=T(t,"div","tip-title");wn.appendChild(xn.el);let Ve=()=>{let R=le??ne??pe,D=R===null?void 0:Ie.get(R);if(!R||!D){s.hidden=!0;return}let[$=R,...Q]=qr(D,e.now(),De);xn.set($),s.replaceChildren(wn,...Q.map(_e=>T(t,"div","",_e)));let se=le!==null&&Ue?Ue:xo(R),ye=r.getBoundingClientRect().width;s.style.left=`${Math.max(0,Math.min(ye-220,se.x+12))}px`,s.style.top=`${Math.max(0,se.y+12)}px`,s.hidden=!1},Wt=R=>{pe=R,gt.setPinned(R),ot.setPinned(R),Ye(),Ve()},Yt=R=>({enter(D){ne=D,nt=R,Ye(),Ve()},leave(D){ne===D&&(ne=null),Ye(),Ve()},toggle(D){Wt(pe===D?null:D)}}),gt=Bs(t,{title:n.crewTitle,list:n.crew,empty:n.crewEmpty,recentGroup:n.recentGroup,recentTitle:n.recentTitle,recent:n.recent},S,f,Yt("crew")),kn=Ys(t,{title:n.monumentTitle,body:n.monument},f),Sn=ys(t,{title:n.chronicleTitle,list:n.chronicle,empty:n.chronicleEmpty},f),ot=Hs(t,{title:n.ledgerTitle,head:n.ledgerHead,body:n.table},f,Yt("ledger")),vn=()=>{ne!==null&&!(nt==="crew"?gt.order().includes(ne):Ie.has(ne))&&(ne=null),le!==null&&!Ie.has(le)&&(le=null)};t.addEventListener("pointerdown",()=>Y.unlock()),t.addEventListener("keydown",R=>{Y.unlock(),R.key==="Escape"&&pe!==null&&Wt(null)}),o.addEventListener("pointermove",R=>{let D=o.getBoundingClientRect();if(D.width<=0||D.height<=0)return;let $=R.clientX??0,Q=R.clientY??0;le=k.pick(($-D.left)*480/D.width,(Q-D.top)*270/D.height);let se=r.getBoundingClientRect();Ue={x:$-se.left,y:Q-se.top},Ye(),Ve()}),o.addEventListener("pointerleave",()=>{le=null,Ue=null,Ye(),Ve()});let wo=R=>{let D=Hr(R);if(!D.ok){Gt(D.message);return}let $=D.snapshot;Ht(),E("live");let Q=Date.parse($.now);De=Number.isNaN(Q)?0:Q-e.now();let se=$e();try{k.apply($)}catch{Gt("The scene could not show this snapshot; the ledger is up to date.")}if(fe===null){n.titleCard.className="title-card gone";let c=()=>{n.titleCard.hidden=!0};x?c():e.setTimeout(c,kd)}let ye=Yr($);n.project.textContent=ye.project,n.version.textContent=ye.version,n.held.hidden=!ye.held,n.footer.textContent=ye.footer;let _e=se/1e3;P[0].update(sr("5h",$.quota.fiveHour,$.quota.holdAbove.fiveHour,_e)),P[1].update(sr("7d",$.quota.sevenDay,$.quota.holdAbove.sevenDay,_e)),G.update($,e.now()),I($,se),Ie=new Map($.lanes.map(c=>[c.name,c])),pe!==null&&!Ie.has(pe)&&(pe=null),gt.update($,se),ve(),ot.update($,se),vn(),kn.update($,se),ht=Uo(ht,fe===null?Jr($):Zr(fe,$)),Sn.update(ht,se);let Cn=Kr(fe,$);Cn.length>0&&(u.textContent=Cn.join(". ")),fe=$,Wt(pe)},rt=!1,ko=()=>{let R=e.fetch;if(!R){m(Zn);return}let D;try{D=R(`${st.snapshot}?${So}=${encodeURIComponent(g)}`)}catch{D=Promise.reject(new Error("fetch threw"))}D.then($=>{rt||m(ar($))},()=>{rt||m(ar(null))})},Xe=new e.EventSource(`${st.events}?${So}=${encodeURIComponent(g)}`);Xe.addEventListener("open",()=>E("live")),Xe.addEventListener(vo.snapshot,R=>wo(R.data)),Xe.addEventListener(vo.problem,R=>Gt(Wr(R.data))),Xe.addEventListener("error",()=>{Xe.readyState===xd?(E("closed"),ko()):E("lost")});let qt=null,bt=0,En=0,Kt=R=>{if(rt)return;let D=qt===null?16:Math.max(0,R-qt);qt=R,k.step(D),ra(w,k.world),fe&&$o(k.world)!==O&&I(fe,$e());let $=k.world.events;for(let Q of $)Y.play(Q.kind);if($.length=0,G.tick(e.now()),R-bt>=1e3){bt=R;let Q=$e();gt.tick(Q),ot.tick(Q),s.hidden||Ve()}if(R-En>=wd){En=R;let Q=$e();Sn.refresh(Q),fe&&(kn.update(fe,Q),I(fe,Q))}e.requestAnimationFrame(Kt)};return e.requestAnimationFrame(Kt),{stop(){rt=!0,Xe.close()}}}function Ed(){let e=globalThis,t=e.document,n=e.window;if(typeof t!="object"||t===null||typeof n!="object"||n===null||typeof e.EventSource!="function"||typeof e.requestAnimationFrame!="function")return null;let o=e.requestAnimationFrame,r=typeof e.matchMedia=="function"?e.matchMedia:null,s=typeof e.AudioContext=="function"?e.AudioContext:typeof e.webkitAudioContext=="function"?e.webkitAudioContext:null,i=typeof e.fetch=="function"?e.fetch:null;return{document:t,window:n,location:e.location,EventSource:e.EventSource,fetch:i?a=>i.call(n,a):null,AudioContext:s,storage:()=>{try{return e.localStorage??null}catch{return null}},matchMedia:a=>r?r.call(n,a):{matches:!1},requestAnimationFrame:a=>o.call(n,a),setTimeout:(a,l)=>e.setTimeout.call(n,a,l),devicePixelRatio:typeof e.devicePixelRatio=="number"?e.devicePixelRatio:1,now:()=>Date.now()}}var la=Ed();la&&vd(la);})();\n';

// src/ui/client/app/palette.ts
var SAND = ["#E9C886", "#DDB66E", "#C89A56", "#B5843F"];
var LIMESTONE = { light: "#F1E2BC", face: "#DCC796", mortar: "#B9A06C", edge: "#8F7A50" };
var FALLEN = { gap: "#6E5A3C", crack: "#4A3B26" };
var GOLD = { gleam: "#FFF6C9", light: "#FFD54A", mid: "#E0A800", shadow: "#A87400" };
var SKIN = { base: "#B9784E", shadow: "#925A38" };
var CLOTH = { white: "#F4F0E2", shadow: "#D6CFBC" };
var OUTLINE = "#3A2716";
var HEADCLOTH = {
  laborer: "#C9A46B",
  mason: "#3C6FB0",
  scribe: "#6E4C9E",
  skeptic: "#B23A3A",
  surveyor: "#3F8F5A",
  waterboy: "#E2B23A",
  scout: "#2F6B4F"
};
var NEMES_BLUE = "#2A4FA0";
var WOOD = ["#8B5A2B", "#6B4220"];
var PALM = { leaf: "#3E7D3A", leafDark: "#2D5E2B", trunk: "#7A5230" };
var TENT = { cloth: "#E7D6B0", shade: "#C2A97A", stripe: "#B23A3A" };
var WATER = "#4F8FBF";
var BREAD = "#C98A3E";
var JUG = "#8E5B3E";
var BUBBLE = { fill: "#FFFDF5", glyph: "#5A4630" };
var PLATE = { fill: "#2B1D14", rim: GOLD.mid, text: GOLD.gleam };
var SPRITE_CHARS = {
  o: OUTLINE,
  k: SKIN.base,
  K: SKIN.shadow,
  // The front hand: an anchor for held items, drawn as skin.
  "*": SKIN.base,
  // The back hand, in the shadow side.
  "&": SKIN.shadow,
  t: SKIN.base,
  T: SKIN.shadow,
  w: CLOTH.white,
  W: CLOTH.shadow,
  h: HEADCLOTH.laborer,
  H: shade(HEADCLOTH.laborer, 0.72),
  s: CLOTH.shadow,
  n: WOOD[0],
  N: WOOD[1],
  l: LIMESTONE.light,
  L: LIMESTONE.face,
  m: LIMESTONE.mortar,
  e: LIMESTONE.edge,
  G: GOLD.gleam,
  y: GOLD.light,
  Y: GOLD.mid,
  z: GOLD.shadow,
  B: NEMES_BLUE,
  b: BREAD,
  j: JUG,
  J: shade(JUG, 0.75),
  a: WATER,
  v: PALM.leaf,
  V: PALM.leafDark,
  r: PALM.trunk,
  c: TENT.cloth,
  C: TENT.shade,
  q: TENT.stripe,
  U: SAND[3],
  f: BUBBLE.fill
};
var HAIR = FALLEN.crack;
function parseHex(color) {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error(`not a #rrggbb color: ${color}`);
  const n = Number.parseInt(color.slice(1), 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}
function toHex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}
function shade(color, factor) {
  const [r, g, b] = parseHex(color);
  return toHex(r * factor, g * factor, b * factor);
}

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
var CHIPS = Object.fromEntries(
  Object.entries(HEADCLOTH).map(([cast, color]) => [cast, color.toLowerCase()])
);
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
var vars = (entries3, prefix = "") => entries3.map(([name2, value]) => `  --${prefix}${name2}: ${value};`).join("\n");
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
var message4 = (err) => err instanceof Error ? err.message : String(err);
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
        problem = JSON.stringify({ message: message4(err).slice(0, PROBLEM_MAX) });
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
    const bytes2 = Buffer.from(given);
    return bytes2.length === token.length && timingSafeEqual(bytes2, token);
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
          return reply(req, res, 500, TEXT, `${message4(err)}
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
      if (!res.headersSent) reply(req, res, 500, TEXT, `${message4(err)}
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
  return new Promise((resolve18, reject) => {
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
      resolve18({
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
import { statSync as statSync7 } from "node:fs";
import { basename as basename7, isAbsolute as isAbsolute14, join as join45, relative as relative11, sep as sep10 } from "node:path";
var MAX_LANES = 300;
var LANDED_KEPT = 5;
var REASON_MAX = 200;
var TOOL_NAME2 = /^[A-Za-z0-9_.:-]{1,64}$/;
var REPORT_STATUSES = ["done", "partial", "blocked"];
var isObject8 = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
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
  const rel = relative11(join45(root, PREFLIGHT_DIR), isAbsolute14(brief) ? brief : join45(root, brief));
  return rel !== "" && !isAbsolute14(rel) && rel.split(sep10)[0] !== "..";
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
  if (!isObject8(value)) throw new ArbabError("io", `the summary of ${lane} attempt ${attempt} is not a JSON object`);
  return value;
}
function readLane(source, name2, record2, state, nowMs) {
  const { runsRoot } = source;
  const paths = runPaths(runsRoot, name2);
  const spec = readJson(paths.laneFile);
  const role2 = isObject8(spec) ? spec["role"] : void 0;
  if (!ROLES.includes(role2)) throw new ArbabError("io", `the lane file of ${name2} has no valid role`);
  const worktree = isObject8(spec) ? spec["worktree"] : void 0;
  const preflightBrief = briefUnderPreflight(source.root, isObject8(spec) ? spec["brief"] : void 0);
  const generatedBy = generatingIntegration(readGenerated(runsRoot, name2)?.by ?? null);
  const attempts = listAttempts(runsRoot, name2);
  const files = (n) => attemptFiles(paths.attemptDir(n));
  let firstMs = null;
  if (attempts[0] !== void 0) {
    const started = readJson(files(attempts[0]).started);
    firstMs = isObject8(started) ? parsedMs(started["startedAt"]) : null;
  }
  if (firstMs === null) {
    const shepherd = readJson(paths.shepherdFile);
    firstMs = isObject8(shepherd) ? parsedMs(shepherd["startedAt"]) : null;
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
      findings = isObject8(report) && Array.isArray(report["findings"]) ? report["findings"].length : null;
    } else {
      const status = isObject8(report) ? report["status"] : void 0;
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
    const st = statSync7(file, { throwIfNoEntry: false });
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
  const landedAt = isObject8(landing) && landing["name"] === name2 && parsedMs(landing["landedAt"]) !== null ? landing["landedAt"] : null;
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
    const names2 = listIntegrations(source.root);
    for (const name2 of integrations.keys()) if (!names2.includes(name2)) integrations.delete(name2);
    const out = [];
    for (const name2 of names2) {
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
      const names2 = listLanes(source.runsRoot);
      const present = new Set(names2);
      for (const name2 of lanes.keys()) if (!present.has(name2)) lanes.delete(name2);
      const inWindow = [];
      for (const name2 of names2) {
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
        project: basename7(source.root),
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
import { closeSync as closeSync6, fstatSync as fstatSync2, openSync as openSync6, readSync as readSync2 } from "node:fs";
var DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
var FIRST_READ_CHUNKS = 8;
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
function countLine(tail, line2) {
  if (line2.trim() === "") return;
  let event;
  try {
    event = JSON.parse(line2);
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
    fd = openSync6(tail.path, "r");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw new ArbabError("io", `cannot open ${tail.path}: ${err.message}`, { cause: err });
  }
  try {
    const size2 = fstatSync2(fd).size;
    if (size2 < tail.offset) {
      Object.assign(tail, fresh(tail.attempt, tail.path));
    }
    const want = Math.min(size2 - tail.offset, max);
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
    closeSync6(fd);
  }
}
function consume(tail, chunk) {
  if (chunk.length === 0) return;
  tail.offset += chunk.length;
  const bytes2 = tail.pending.length > 0 ? Buffer.concat([tail.pending, chunk]) : chunk;
  let start = 0;
  for (let end = bytes2.indexOf(NEWLINE2, start); end !== -1; end = bytes2.indexOf(NEWLINE2, start)) {
    countLine(tail, bytes2.toString("utf8", start, end));
    start = end + 1;
  }
  tail.pending = Buffer.from(bytes2.subarray(start));
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
      let reads = 0;
      do {
        chunk = readMore(tail, max);
        if (chunk === null) {
          tails.set(lane, fresh(attempt, streamPath));
          return { toolCalls: 0, lastTool: null };
        }
        consume(tail, chunk);
        reads++;
      } while (chunk.length === max && reads < (tail.primed ? 1 : FIRST_READ_CHUNKS));
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
      ctx.stdout(`arbab ui: ${basename8(project.root)} at ${where}
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

// src/commands/usage.ts
function block2(usages, options = []) {
  const width = Math.max(0, ...options.map(([flag]) => flag.length));
  const lines = usages.map((u, i) => `${i === 0 ? "usage:" : "      "} arbab ${u}`);
  for (const [flag, text2] of options) lines.push(`  ${flag.padEnd(width)}  ${text2}`);
  return lines.join("\n") + "\n";
}
var JSON_OPT = ["--json", "print JSON instead of text"];
var timeout = (fallback) => ["--timeout-min <n>", `give up after <n> minutes, exit 3 (default ${fallback})`];
var USAGE = {
  doctor: block2(["doctor [--json]"], [JSON_OPT]),
  lint: block2(["lint <lane.json> [--json]"], [JSON_OPT]),
  launch: block2(["launch <lane.json> [--json]"], [JSON_OPT]),
  plan: block2(
    ["plan check <plan.json> [--json]", "plan next <plan.json> [--retry <phase>] [--json]", "plan status <plan.json> [--json]"],
    [["--retry <phase>", "next: first relaunch a phase that failed or was orphaned, in its worktree"], JSON_OPT]
  ),
  status: block2(
    ["status [<lane>\u2026] [--active] [--mine] [--json]"],
    [
      ["--active", "only lanes not finished"],
      ["--mine", "only runs owned by this session or by none"],
      JSON_OPT
    ]
  ),
  wait: block2(
    ["wait [<lane>\u2026 | --any | --all] [--all-sessions] [--timeout-min <n>] [--notify] [--json]"],
    [
      ["--any", "return when one run finished (the default)"],
      ["--all", "return when every run finished"],
      ["--all-sessions", "every session's runs; without it, this session's and ownerless ones (named lanes: any owner)"],
      timeout("none"),
      ["--notify", "a desktop notification per finished lane"],
      JSON_OPT
    ]
  ),
  resume: block2(
    ["resume <lane> [--prompt <file> | --digest] [--json]"],
    [
      ["--prompt <file>", "the prompt for the resumed session"],
      ["--digest", "start a fresh session seeded with the latest attempt's digest"],
      JSON_OPT
    ]
  ),
  stop: block2(["stop <lane> [--json]"], [JSON_OPT]),
  preflight: block2(["preflight <lane.json> [--timeout-min <n>] [--json]"], [timeout("45"), JSON_OPT]),
  quota: block2(
    ["quota [--reset | --refresh] [--json]"],
    [
      ["--reset", "delete the snapshot (after switching accounts)"],
      ["--refresh", "read the current account's windows with one tool-less haiku call"],
      JSON_OPT
    ]
  ),
  cleanup: block2(
    ["cleanup [--worktrees [--older-than <days>]] [--mine] [--json]"],
    [
      ["--worktrees", "also remove finished lanes' clean worktrees merged into the base or landed, and landed integrations'"],
      ["--older-than <days>", "with --worktrees: also finished lanes' clean worktrees unchanged for over <days> days (branches stay)"],
      ["--mine", "only runs this session owns (not ownerless ones), and no integration"],
      JSON_OPT
    ]
  ),
  integrate: block2(
    [
      "integrate <name> (--lanes a,b,\u2026 | --plan <plan.json>) [--json]",
      "integrate <name> --adopt <ref> [--base <ref>] [--json]",
      "integrate <name> --refresh [--json]",
      "integrate <name> --deps-installed <sha> [--json]"
    ],
    [
      ["--lanes a,b,\u2026", "merge these lane branches into integrate/<name>, in order"],
      ["--plan <plan.json>", "merge the plan's lane branches by waves"],
      ["--adopt <ref>", "make a new integration whose branch starts at <ref>'s commit, nothing merged"],
      ["--base <ref>", "with --adopt: its base, which config baseBranch must contain (default baseBranch)"],
      ["--refresh", "record the head again after a hand commit or a base merge; merges and installs nothing"],
      ["--deps-installed <sha>", "record that you reviewed and installed changed dependencies at <sha>"],
      JSON_OPT
    ]
  ),
  verify: block2(
    ["verify <name> [--timeout-min <n>] [--json]", "verify --ref <branch> [--timeout-min <n>] [--json]"],
    [["--ref <branch>", "run the gates on a branch head with no integration (lane ref-<slug>-<hash>-verify)"], timeout("90"), JSON_OPT]
  ),
  review: block2(
    ["review <name> [--lenses a,b] [--lens-file <name>=<file>]\u2026 [--since <sha>] [--timeout-min <n>] [--json]"],
    [
      ["--lenses a,b", "only these lenses; the others' findings from the same head stay"],
      ["--lens-file <name>=<file>", "add lens <name>, or replace its text, from <file> (in the project, not .env*) for this run; repeatable"],
      ["--since <sha>", "diff from <sha>, an ancestor of the head, instead of the base (a fix round)"],
      timeout("120"),
      JSON_OPT
    ]
  ),
  readiness: block2(
    ["readiness <name> [--tier low|medium|high] [--waive id,\u2026] [--json]"],
    [
      ["--tier low|medium|high", "the risk tier (default config landing.tier)"],
      ["--waive id,\u2026", "waive these skipped items (a person in a terminal only)"],
      JSON_OPT
    ]
  ),
  land: block2(
    ["land <name> [--squash] [--message <file>] [--keep-worktrees] [--json]"],
    [
      ["--squash", "one commit instead of a merge (default config landing.squash)"],
      ["--message <file>", 'the commit message, from a file in the project, not .env* (default "Land <name>")'],
      ["--keep-worktrees", "skip removing the landed worktrees and branches"],
      JSON_OPT
    ]
  ),
  ui: block2(
    ["ui [--port <n>] [--hours <n>] [--no-open] [--json]"],
    [
      ["--port <n>", "0 (a free port, the default) or 1024 to 65535"],
      ["--hours <n>", "how far back the scene goes (default 24)"],
      ["--no-open", "print the URL instead of opening the browser"],
      JSON_OPT
    ]
  ),
  summary: block2(["summary [--all] [--json]"], [["--all", "every project that launched a lane on this machine"], JSON_OPT]),
  report: block2(["report <lane> [--attempt <n>] [--json]"], [["--attempt <n>", "this attempt instead of the latest"], JSON_OPT]),
  hook: block2(["hook <pre-tool-use|stop>"]),
  "host-check": block2(["host-check <name>"])
};

// src/commands/verify.ts
import { createHash as createHash5 } from "node:crypto";
import { join as join46 } from "node:path";
var DEFAULT_TIMEOUT_MIN3 = 90;
var REFS_DIR = ".arbab/refs";
var REF_SLUG_MAX = 22;
var REF_HASH_HEX = 6;
function formatGateResult(result) {
  const code4 = result.exitCode === null ? "missing" : `exit ${result.exitCode}`;
  return `${code4.padEnd(8)}  ${result.kind.padEnd(5)}  ${result.command}`;
}
function refSlug(branch) {
  return branch.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, REF_SLUG_MAX);
}
function refId(branch) {
  const hash = createHash5("sha1").update(branch).digest("hex").slice(0, REF_HASH_HEX);
  return `ref-${refSlug(branch)}-${hash}`;
}
function refHead(ctx, project, branch) {
  if (branch === "" || branch.startsWith("-")) throw new ArbabError("usage", `--ref ${JSON.stringify(branch)} is not a branch name`);
  const r = ctx.git(["show-ref", "--verify", "--hash", `refs/heads/${branch}`], project.root);
  const sha = r.stdout.trim();
  if (r.code !== 0 || !/^[0-9a-f]{40,64}$/.test(sha)) throw new ArbabError("usage", `there is no branch ${branch}`);
  return sha;
}
async function runVerify(argv2, ctx) {
  const { values, positionals } = parse("verify", {
    args: argv2,
    options: { ref: { type: "string" }, "timeout-min": { type: "string" }, json: { type: "boolean" } },
    allowPositionals: true
  });
  const ref2 = values.ref;
  if (ref2 !== void 0 && positionals.length > 0) throw new ArbabError("usage", "usage: arbab verify <name> or arbab verify --ref <branch>, not both");
  if (ref2 === void 0 && positionals.length !== 1) throw new ArbabError("usage", "usage: arbab verify <name>");
  const name2 = ref2 === void 0 ? assertValidName(positionals[0], "integration") : null;
  const timeoutMs = parseTimeoutMin(values["timeout-min"] ?? String(DEFAULT_TIMEOUT_MIN3));
  const project = openProject(ctx);
  const { gates } = project.config;
  if (gates.length === 0) throw new ArbabError("usage", "no gates are configured (arbab.config.json gates); verify has nothing to run");
  let target;
  if (name2 !== null) {
    const integration = openIntegration(project, name2);
    const owner = generationOwner(integration);
    const start = generatedBase(integration.record);
    assertRecordedHead(ctx.git, project, integration);
    target = {
      label: name2,
      prefix: name2,
      lanesDir: integration.paths.lanesDir,
      recordPath: integration.paths.verify,
      start,
      owner,
      head: integration.record.headSha,
      again: `arbab verify ${name2}`
    };
  } else {
    const branch = ref2 ?? "";
    const head = refHead(ctx, project, branch);
    const prefix = refId(branch);
    const dir = confine(project.root, join46(REFS_DIR, prefix));
    target = {
      label: `ref:${branch}`,
      prefix,
      lanesDir: join46(dir, "lanes"),
      recordPath: join46(dir, "verify.json"),
      // The branch head is landed code, so the install runs on it: nothing is merged on top.
      start: { base: head },
      owner: { integration: prefix, branch: `refs/heads/${branch}`, head },
      head,
      again: `arbab verify --ref ${branch}`
    };
  }
  return verifyTarget(ctx, project, target, timeoutMs, values.json === true);
}
async function verifyTarget(ctx, project, target, timeoutMs, json3) {
  const { gates } = project.config;
  const smoke = project.config.verify.smoke;
  const { head } = target;
  const paths = { name: target.prefix, projectRoot: project.root, lanesDir: target.lanesDir };
  const lane = `${target.prefix}-verify`;
  const spec = verifyLaneSpec({ name: target.prefix, brief: reviewLaneFiles(paths, lane).brief, gates, smoke, ...target.start });
  const run = await runGeneratedLanes(ctx, project, paths, [{ spec, brief: verifyBrief(gates, smoke) }], timeoutMs, target.owner, (o) => o.attempts.length > 0);
  const outcome2 = run.outcomes[0];
  if (run.timedOut || outcome2 === void 0) {
    if (json3) printJson(ctx, { timedOut: true, endState: null, verify: null });
    else ctx.stderr(`arbab verify: ${spec.name} did not finish in time; it keeps running
`);
    return WAIT_TIMEOUT_EXIT;
  }
  const reasons = [];
  if (outcome2.attempts.length > 0) {
    const ran = branchHead(ctx.git, project.root, `arbab/${spec.name}`);
    const what = target.label.startsWith("ref:") ? `the head of ${target.label.slice(4)}` : "the integration head";
    if (ran !== head) reasons.push(`${spec.name} ran on ${ran ?? "no commit"}, not on ${what} ${head}; run ${target.again} again`);
    const left = worktreeChanges(ctx, project, spec.name);
    if (left !== null) reasons.push(left);
  }
  const results = gateResults(attemptEvents(project.runsRoot, spec.name, outcome2.attempts), gates, smoke);
  const record2 = verifyRecord({
    name: target.label,
    lane: spec.name,
    attempt: outcome2.attempts.at(-1) ?? null,
    headSha: head,
    results,
    now: isoAt(ctx.clock),
    reasons
  });
  writeJsonAtomic(target.recordPath, record2);
  settleGeneratedRuns(target.lanesDir, [spec.name]);
  if (json3) {
    printJson(ctx, { timedOut: false, endState: outcome2.endState, verify: record2 });
  } else {
    for (const result of results) ctx.stdout(formatGateResult(result) + "\n");
    const ended = outcome2.endState ?? "without an end state";
    const reason = outcome2.reason === null ? "" : `; ${outcome2.reason.trim().replace(/\s+/g, " ")}`;
    const why = record2.reason === void 0 ? "" : `: ${record2.reason}`;
    ctx.stdout(`verify ${target.label}: ${record2.passed ? "passed" : "failed"} at ${head} (lane ${spec.name} ${ended}${reason})${why}
`);
  }
  return record2.passed ? 0 : 1;
}
var MAX_LISTED = 5;
function worktreeChanges(ctx, project, lane) {
  const worktree = join46(project.worktreeRoot, lane);
  const gitCommonDir2 = resolveGitCommonDir(ctx.git, project.root);
  if (gitCommonDir2 === void 0) return `the git directory of ${project.root} could not be resolved, so ${worktree} was not checked`;
  const verified = verifyWorktreeGit({ worktree, branch: `arbab/${lane}`, gitCommonDir: gitCommonDir2 });
  if (verified.gitDir === null) return `the worktree ${worktree} failed verification: ${verified.error}`;
  let entries3;
  try {
    entries3 = worktreeStatus(worktree, verified.gitDir, ctx.git).map((l) => l.trim());
  } catch (err) {
    return `the worktree ${worktree} could not be checked: ${err instanceof Error ? err.message : String(err)}`;
  }
  if (entries3.length === 0) return null;
  const listed = entries3.slice(0, MAX_LISTED).join(", ") + (entries3.length > MAX_LISTED ? `, and ${entries3.length - MAX_LISTED} more` : "");
  return `the worktree ${worktree} has changes after the run${listed === "" ? "" : `: ${listed}`}`;
}

// src/commands/context.ts
import { execFile, execFileSync as execFileSync3, spawn as spawn3 } from "node:child_process";
import { closeSync as closeSync7, openSync as openSync7 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join47 } from "node:path";
var NOTIFY_TIMEOUT_MS = 5e3;
var nodeNotifyExec = (file, args, opts, done) => {
  execFile(file, args, { timeout: opts.timeout, windowsHide: true }, (err) => done(err));
};
function appleScriptString(s) {
  return `"${s.replace(/[\\"]/g, "\\$&")}"`;
}
function makeNotify(platform, execFileImpl = nodeNotifyExec) {
  return (title, body) => {
    let argv2;
    if (platform === "darwin") {
      argv2 = ["osascript", ["-e", `display notification ${appleScriptString(body)} with title ${appleScriptString(title)}`]];
    } else if (platform === "linux") {
      argv2 = ["notify-send", ["--", title, body]];
    } else {
      return Promise.resolve(false);
    }
    return new Promise((resolve18) => {
      try {
        execFileImpl(argv2[0], argv2[1], { timeout: NOTIFY_TIMEOUT_MS }, (err) => resolve18(err === null || err === void 0));
      } catch {
        resolve18(false);
      }
    });
  };
}
function makeReadStdin(stdin) {
  return () => {
    if (stdin.isTTY === true) return Promise.resolve("");
    return new Promise((resolve18, reject) => {
      const chunks = [];
      stdin.on("data", (chunk) => chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk));
      stdin.once("end", () => resolve18(Buffer.concat(chunks).toString("utf8")));
      stdin.once("error", (err) => reject(new ArbabError("io", `cannot read stdin: ${err.message}`, { cause: err })));
    });
  };
}
var OPENER_WAIT_MS = 5e3;
function makeOpenUrl(platform, spawnFn = spawn3) {
  const opener = platform === "darwin" ? "open" : platform === "linux" ? "xdg-open" : null;
  return (url) => {
    if (opener === null) return Promise.resolve(false);
    return new Promise((resolve18) => {
      const timer = setTimeout(() => resolve18(true), OPENER_WAIT_MS);
      timer.unref();
      const settle = (opened) => {
        clearTimeout(timer);
        resolve18(opened);
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
    const log = openSync7(join47(laneDir, "shepherd.log"), "a");
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
      closeSync7(log);
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
    home: join47(home, ".arbab"),
    claudeHome: join47(home, ".claude"),
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
    openUrl: makeOpenUrl(process.platform),
    scriptPath: opts.scriptPath,
    readStdin: makeReadStdin(process.stdin),
    notify: makeNotify(process.platform)
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
  summary: runSummary,
  report: runReport,
  hook: runHook,
  "host-check": runHostCheck,
  __shepherd: runShepherdProcess
};
var HELP = `usage: arbab [-C <dir>] <command> [options]

  -C <dir>                                find the project from <dir> instead of the working directory (never a
                                          lane worktree)

  doctor [--json]                         node, git, claude binary, sandbox, config, ignored roots, ~/.arbab, the
                                          plugin hook, gates, env templates, scanners, disk, machine cap
  lint <lane.json> [--json]               profile, brief and schema lint; exit 1 on errors
  launch <lane.json> [--json]             lint, then start the lane's shepherd
  plan check <plan.json> [--json]         validate a plan, lint every phase, print the waves; exit 1 on errors
  plan next <plan.json> [--retry <phase>] [--json]
                                          launch every phase whose dependencies all succeeded and that never ran;
                                          --retry first relaunches a phase that failed or was orphaned
  plan status <plan.json> [--json]        one row per phase: wave, state, end state, dependencies
  status [<lane>\u2026] [--active] [--mine] [--json]
                                          one row per lane, then the quota
  wait [<lane>\u2026 | --any | --all] [--all-sessions] [--timeout-min N] [--notify] [--json]
                                          report finished lanes not yet acked (without lanes: this session's runs and
                                          ownerless ones, every session's with --all-sessions); exit 3 on timeout
  resume <lane> [--prompt <file> | --digest] [--json]
                                          a new attempt resuming the latest session; --digest starts a fresh
                                          session seeded with the latest attempt's digest
  stop <lane> [--json]                    stop the lane's shepherd and worker
  preflight <lane.json> [--timeout-min N] [--json]
                                          probe the lane's fence and model; exit 1 on any failed check
  quota [--reset | --refresh] [--json]    the account snapshot and the hold decision; --reset deletes the snapshot
                                          (after switching accounts), --refresh reads the current account's windows
  cleanup [--worktrees [--older-than <days>]] [--mine] [--json]
                                          reap orphans, release stale pool entries, remove empty lock directories;
                                          --worktrees removes finished lanes' clean worktrees merged or landed (lane
                                          branches stay), and landed integrations' worktrees and branches
  integrate <name> (--lanes a,b,\u2026 | --plan <plan.json>) [--json]
                                          merge lane branches into integrate/<name>, in order or by plan waves
  integrate <name> --adopt <ref> [--base <ref>] [--json]
                                          make an integration of an existing branch; the base must be contained in
                                          config baseBranch
  integrate <name> --refresh [--json]     record the integration's head again after a hand commit or a base merge;
                                          merges and installs nothing
  integrate <name> --deps-installed <sha> [--json]
                                          record that you reviewed and installed changed dependencies at the head
                                          <sha> that integrate printed
  verify (<name> | --ref <branch>) [--timeout-min N] [--json]
                                          run the gates and smoke inside the fence on the integration head (or a
                                          branch head); exit 1 unless all exit 0, 3 on timeout
  review <name> [--lenses a,b] [--lens-file <name>=<file>]\u2026 [--since <sha>] [--timeout-min N] [--json]
                                          one reviewer lane per lens, then skeptics for MEDIUM+ findings
  readiness <name> [--tier low|medium|high] [--waive id,\u2026] [--json]
                                          the readiness report (verified, skipped, risks); exit 1 unless ready
  land <name> [--squash] [--message <file>] [--keep-worktrees] [--json]
                                          merge a ready integration into the base branch (--squash: one commit);
                                          never pushes; then remove the worktrees it landed (lane branches stay)
                                          unless --keep-worktrees
  ui [--port N] [--hours N] [--no-open] [--json]
                                          serve the pyramid scene on 127.0.0.1 until stopped (read-only)
  summary [--all] [--json]                plans, lanes by state, integrations by stage and what needs you
  report <lane> [--attempt <n>] [--json]  an attempt's summary and report, the latest unless --attempt
  host-check <name>                       run hostGates on the integration head from a terminal
  help [<command>], --help                this text, or a command's options
  version, --version                      the arbab version

arbab <command> --help shows a command's options.

Exit codes: 0 ok, 1 usage or lint error, 2 runtime error, 3 wait timeout.
`;
function globalDir(argv2, cwd) {
  if (argv2[0] !== "-C") return { cwd, argv: argv2 };
  const dir = argv2[1];
  if (dir === void 0 || dir === "") throw new ArbabError("usage", "-C needs a directory");
  if (dir === "-C" || argv2[2] === "-C") throw new ArbabError("usage", "-C given twice");
  const abs = resolve17(cwd, dir);
  const stat = statSync8(abs, { throwIfNoEntry: false });
  if (stat === void 0) throw new ArbabError("usage", `-C ${JSON.stringify(dir)}: no such directory ${abs}`);
  if (!stat.isDirectory()) throw new ArbabError("usage", `-C ${JSON.stringify(dir)}: not a directory: ${abs}`);
  return { cwd: abs, argv: argv2.slice(2) };
}
var helpFor = (name2) => (Object.hasOwn(USAGE, name2) ? USAGE[name2] : void 0) ?? HELP;
async function dispatch(argv2, ctx) {
  let global;
  try {
    global = globalDir(argv2, ctx.cwd);
  } catch (err) {
    ctx.stderr(`arbab: ${err instanceof Error ? err.message : String(err)}
`);
    return exitCodeFor(err);
  }
  if (global.cwd !== ctx.cwd) ctx = { ...ctx, cwd: global.cwd };
  const [name2, ...rest] = global.argv;
  if (name2 === void 0 || name2 === "--help" || name2 === "help" || name2 === "-h") {
    ctx.stdout(name2 === "help" && rest[0] !== void 0 ? helpFor(rest[0]) : HELP);
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
  if ((rest.includes("--help") || rest.includes("-h")) && name2 !== "__shepherd") {
    ctx.stdout(helpFor(name2));
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
    const pkg = JSON.parse(readFileSync9(new URL("../package.json", import.meta.url), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
var scriptPath = process.argv[1] ?? "";
var code3 = await dispatch(process.argv.slice(2), defaultContext({ scriptPath, version: readVersion2() }));
if (process.argv[2] === "__shepherd") process.exit(code3);
process.exitCode = code3;
