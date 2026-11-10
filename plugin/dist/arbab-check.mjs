// src/check/main.ts
import { randomBytes as randomBytes2 } from "node:crypto";
import { tmpdir } from "node:os";

// src/util/proc.ts
var sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// src/check/registry.ts
import { closeSync as closeSync2, constants, fstatSync, openSync as openSync2, readdirSync, readFileSync as readFileSync2, rmSync as rmSync2 } from "node:fs";
import { join as join2 } from "node:path";

// src/util/errors.ts
var ArbabError = class extends Error {
  code;
  constructor(code, message2, options) {
    super(message2, options);
    this.name = "ArbabError";
    this.code = code;
  }
};

// src/util/fs.ts
import { randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
function writeTextAtomic(path, text) {
  ensureDir(dirname(path));
  const tmp = join(dirname(path), `.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(tmp, text, { flag: "wx" });
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw new ArbabError("io", `cannot write ${path}: ${err.message}`, { cause: err });
  }
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

// src/check/registry.ts
function registryDir(tmpdir2) {
  return join2(tmpdir2, "arbab-checks");
}
var ENTRY_MAX_AGE_MS = 20 * 6e4;
var ENTRY_MAX_AHEAD_MS = 6e4;
var ENTRY_MAX_BYTES = 16 * 1024;
var PID_MAX = 4194304;
var ENTRY_FILE = /^([1-9]\d*)\.json$/;
var ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
var entryPath = (dir, pid) => join2(dir, `${pid}.json`);
var isPositiveInt = (v) => typeof v === "number" && Number.isInteger(v) && v > 0;
function isEntryPid(v) {
  return typeof v === "number" && Number.isInteger(v) && v >= 2 && v <= PID_MAX;
}
function assertPid(pid) {
  if (!isPositiveInt(pid)) throw new ArbabError("usage", `invalid pid ${pid}`);
}
function entryTime(entry) {
  return ISO_TIME.test(entry.startedAt) ? Date.parse(entry.startedAt) : Number.NaN;
}
function registeredBefore(a, b) {
  const ta = entryTime(a);
  const tb = entryTime(b);
  return ta !== tb ? ta < tb : a.pid < b.pid;
}
function register(dir, entry, fs) {
  assertPid(entry.pid);
  fs.mkdirp(dir);
  const path = entryPath(dir, entry.pid);
  const data = JSON.stringify(entry) + "\n";
  if (fs.writeExclusive(path, data)) return;
  fs.remove(path);
  if (!fs.writeExclusive(path, data)) throw new ArbabError("io", `cannot register ${path}: it keeps existing`);
}
function update(dir, entry, fs) {
  assertPid(entry.pid);
  fs.replace(entryPath(dir, entry.pid), JSON.stringify(entry) + "\n");
}
function unregister(dir, pid, fs) {
  assertPid(pid);
  fs.remove(entryPath(dir, pid));
}
function parseEntry(text, pid) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw;
  if (r.pid !== pid || typeof r.name !== "string" || typeof r.cwd !== "string" || typeof r.startedAt !== "string" || !isPositiveInt(r.cpus)) {
    return null;
  }
  if (r.state !== void 0 && r.state !== "waiting" && r.state !== "running") return null;
  const entry = { pid, name: r.name, cwd: r.cwd, startedAt: r.startedAt, cpus: r.cpus, state: r.state ?? "running" };
  if (isPositiveInt(r.share)) entry.share = r.share;
  return entry;
}
function staleByTime(entry, now) {
  const t = entryTime(entry);
  if (Number.isNaN(t)) return "unparsable startedAt";
  if (now - t > ENTRY_MAX_AGE_MS) return "too old";
  if (t - now > ENTRY_MAX_AHEAD_MS) return "in the future";
  return null;
}
function liveEntries(dir, self, fs, probe, now) {
  const live = [];
  for (const file of fs.readDir(dir).sort()) {
    const match = ENTRY_FILE.exec(file);
    if (match === null) continue;
    const pid = Number(match[1]);
    if (pid === self || !isEntryPid(pid)) continue;
    let text;
    try {
      text = fs.readEntry(join2(dir, file));
    } catch {
      continue;
    }
    if (text === null) continue;
    const entry = parseEntry(text, pid);
    if (entry === null) continue;
    if (staleByTime(entry, now) === null && probe(pid) === "alive") {
      live.push(entry);
      continue;
    }
    try {
      fs.remove(join2(dir, file));
    } catch {
    }
  }
  return live;
}
function killProbe(kill) {
  return (pid) => {
    if (!isEntryPid(pid)) return "gone";
    try {
      kill(pid, 0);
      return "alive";
    } catch (err) {
      return err.code === "EPERM" ? "alive" : "gone";
    }
  };
}
var ENTRY_OPEN = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0);
function readEntryFile(path) {
  const fd = openSync2(path, ENTRY_OPEN);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > ENTRY_MAX_BYTES) return null;
    return readFileSync2(fd, "utf8");
  } finally {
    closeSync2(fd);
  }
}
var nodeRegistryFs = {
  mkdirp: ensureDir,
  writeExclusive: createExclusive,
  replace: writeTextAtomic,
  readDir: (dir) => readdirSync(dir),
  readFile: (path) => readFileSync2(path, "utf8"),
  readEntry: readEntryFile,
  remove: (path) => {
    rmSync2(path, { force: true });
  }
};

// src/check/run.ts
import { spawn as nodeSpawn } from "node:child_process";
import { closeSync as closeSync3, constants as fsConstants, openSync as openSync3, statSync, writeSync as writeSync2 } from "node:fs";
import { constants as constants2 } from "node:os";
import { isAbsolute as isAbsolute2, join as join3, relative as relative2 } from "node:path";

// src/types.ts
var CHECKS_ENV = "ARBAB_CHECKS";
var CHECK_POLICY_ENV = "ARBAB_CHECK_POLICY";

// src/check/command.ts
var CHECK_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;
function isCheckName(name) {
  return CHECK_NAME.test(name);
}
var FAILURE_PREFIX = "arbab-check failure: ";
var FAILURE_MESSAGE_MAX = 300;
var FAILURE_FIELD_MAX = 200;
var CSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
var CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
var field = (s, max) => s.replace(CSI, "").replace(/[\r\n\t]+/g, " ").replace(CONTROL, "").trim().slice(0, max).trim();
function failureFieldText(s) {
  return field(s, Number.POSITIVE_INFINITY);
}
function formatFailureLine(failure) {
  const file = failure.file === null ? "" : field(failure.file, FAILURE_FIELD_MAX);
  const test = failure.test === null ? "" : field(failure.test, FAILURE_FIELD_MAX);
  return `${FAILURE_PREFIX}${file === "" ? "-" : file}${test === "" ? "" : ` > ${test}`} :: ${field(failure.message, FAILURE_MESSAGE_MAX)}`;
}
function parseFailureLine(line) {
  if (!line.startsWith(FAILURE_PREFIX)) return null;
  const body = line.slice(FAILURE_PREFIX.length);
  const split = body.indexOf(" :: ");
  if (split < 0) return null;
  const where = body.slice(0, split).trim();
  const message2 = field(body.slice(split + 4), FAILURE_MESSAGE_MAX);
  const gt = where.indexOf(" > ");
  const file = field(gt < 0 ? where : where.slice(0, gt), FAILURE_FIELD_MAX);
  const test = gt < 0 ? "" : field(where.slice(gt + 3), FAILURE_FIELD_MAX);
  return { file: file === "" || file === "-" ? null : file, test: test === "" ? null : test, message: message2 };
}
var isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var positiveInt = (v, min) => typeof v === "number" && Number.isInteger(v) && v >= min;
function parsed(env, key) {
  const text = env[key];
  if (text === void 0 || text === "") throw new ArbabError("usage", `${key} is not set: this lane has no checks`);
  try {
    return JSON.parse(text);
  } catch {
    throw new ArbabError("usage", `${key} is not valid JSON`);
  }
}
function readChecksEnv(env) {
  const rawChecks = parsed(env, CHECKS_ENV);
  if (!isRecord(rawChecks)) throw new ArbabError("usage", `${CHECKS_ENV} must be an object of name \u2192 argv`);
  const checks = {};
  for (const [name, argv] of Object.entries(rawChecks)) {
    if (!isCheckName(name)) throw new ArbabError("usage", `${CHECKS_ENV} names an invalid check ${JSON.stringify(name)}`);
    if (!Array.isArray(argv) || argv.length === 0 || !argv.every((a) => typeof a === "string" && a !== "" && !a.includes("\0"))) {
      throw new ArbabError("usage", `${CHECKS_ENV}.${name} must be a non-empty argv of strings`);
    }
    checks[name] = [...argv];
  }
  const rawPolicy = parsed(env, CHECK_POLICY_ENV);
  if (!isRecord(rawPolicy) || !positiveInt(rawPolicy.cpus, 1) || !positiveInt(rawPolicy.concurrent, 1) || !positiveInt(rawPolicy.waitSec, 0)) {
    throw new ArbabError("usage", `${CHECK_POLICY_ENV} must be {"cpus": n \u2265 1, "concurrent": n \u2265 1, "waitSec": n \u2265 0}`);
  }
  return { checks, policy: { cpus: rawPolicy.cpus, concurrent: rawPolicy.concurrent, waitSec: rawPolicy.waitSec } };
}

// src/check/digest.ts
var ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
function stripAnsi(text) {
  return text.replace(ANSI, "");
}
var FAIL_LINE = /^\s*FAIL\s+(?:\|[^|]*\|\s+)?(\S.*?)\s*$/;
var FAIL_SUFFIX = /\s+(?:\[[^\]]*\]|\(\d+(?:\.\d+)?\s*m?s\))$/;
var JEST_BULLET = /^\s*●\s+(.+?)\s*$/;
var BLOCK_END = /^\s*(?:Test Files\s|Tests\s|Test Suites:|Snapshots:|PASS\s|⎯{3,})/;
var TSC_PAREN = /^(.+?)\((\d+),(\d+)\): error (TS\d+: .*)$/;
var TSC_COLON = /^(.+?):(\d+):(\d+) - error (TS\d+: .*)$/;
var ESLINT_HEADER = /^(?:\/\S*|\S*[^\s/\\]\.[A-Za-z0-9]+)$/;
var ESLINT_PROBLEM = /^\s+\d+:\d+\s+(error|warning)\s+(.*?)\s*$/;
var PRETTIER = /^\[warn\]\s+(\S+)\s*$/;
var cut = (message2) => message2.trim().slice(0, FAILURE_MESSAGE_MAX);
function failLine(line) {
  const match = FAIL_LINE.exec(line);
  if (match === null) return null;
  let rest = match[1] ?? "";
  while (FAIL_SUFFIX.test(rest)) rest = rest.replace(FAIL_SUFFIX, "");
  const gt = rest.indexOf(" > ");
  const file = (gt < 0 ? rest : rest.slice(0, gt)).trim();
  const test = gt < 0 ? null : rest.slice(gt + 3).trim() || null;
  return file === "" ? null : { file, test };
}
function blockFailures(block) {
  if (block.awaiting !== null) block.bullets.push({ ...block.awaiting, message: "failed" });
  block.awaiting = null;
  if (block.bullets.length > 0) return block.bullets;
  return [{ file: block.file, test: block.test, message: block.message ?? "failed" }];
}
function parseFailures(output, max = 30) {
  const entries = [];
  let block = null;
  let eslintFile = null;
  let eslintTaken = false;
  for (const raw of stripAnsi(output).split(/\r?\n/)) {
    const line = raw.trimEnd();
    const fail = failLine(line);
    if (fail !== null) {
      block = { ...fail, message: null, bullets: [], awaiting: null };
      entries.push(block);
      eslintFile = null;
      continue;
    }
    if (block !== null && line.trim() !== "") {
      if (BLOCK_END.test(line)) {
        block = null;
      } else {
        const bullet = block.test === null ? JEST_BULLET.exec(line) : null;
        if (bullet !== null && !/^Console\b/.test(bullet[1] ?? "")) {
          if (block.awaiting !== null) block.bullets.push({ ...block.awaiting, message: "failed" });
          block.awaiting = { file: block.file, test: (bullet[1] ?? "").split(" \u203A ").join(" > "), message: "" };
        } else if (block.awaiting !== null) {
          block.bullets.push({ ...block.awaiting, message: cut(line) });
          block.awaiting = null;
        } else if (block.message === null) {
          block.message = cut(line);
        }
      }
    }
    const tsc = TSC_PAREN.exec(line) ?? TSC_COLON.exec(line);
    if (tsc !== null) {
      entries.push({ file: tsc[1] ?? "", test: null, message: cut(tsc[4] ?? "") });
      continue;
    }
    const prettier = PRETTIER.exec(line);
    if (prettier !== null) {
      entries.push({ file: prettier[1] ?? "", test: null, message: "not formatted (prettier)" });
      continue;
    }
    if (ESLINT_HEADER.test(line)) {
      eslintFile = line;
      eslintTaken = false;
      continue;
    }
    const problem = ESLINT_PROBLEM.exec(line);
    if (problem !== null && eslintFile !== null) {
      if (problem[1] === "error" && !eslintTaken) {
        const [, text = "", rule] = /^(.*?)(?:\s{2,}(\S+))?$/.exec(problem[2] ?? "") ?? [];
        entries.push({ file: eslintFile, test: null, message: cut(rule === void 0 ? text : `${text} (${rule})`) });
        eslintTaken = true;
      }
      continue;
    }
    eslintFile = null;
  }
  const seen = /* @__PURE__ */ new Set();
  const failures = [];
  for (const entry of entries) {
    for (const failure of "bullets" in entry ? blockFailures(entry) : [entry]) {
      const key = `${failure.file ?? ""}\0${failure.test ?? ""}\0${failure.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      failures.push(failure);
      if (failures.length >= max) return failures;
    }
  }
  return failures;
}

// src/check/run.ts
var POLL_MS = 2e3;
var TAIL_KEEP = 200;
var TAIL_PASS = 15;
var TAIL_FAIL = 60;
var MAX_FAILURES = 30;
var COUNT_FAILURES = 1e3;
var STDOUT_MAX = 3800;
var HEADER_MAX = 1e3;
var FAILURES_CHARS = 2e3;
var FAILURE_LINE_MAX = 400;
var FAILURE_MESSAGE_MIN = 40;
var TAIL_LINE_MAX = 240;
var LOG_TRIES = 20;
var FALLBACK_LOG_TRIES = 5;
var message = (err) => err instanceof Error ? err.message : String(err);
function configuredNames(env) {
  try {
    const raw = JSON.parse(env[CHECKS_ENV] ?? "");
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      const names = Object.keys(raw).filter(isCheckName);
      if (names.length > 0) return names.join(", ");
    }
  } catch {
  }
  return "none";
}
function signalExitCode(signal) {
  const n = constants2.signals[signal];
  return 128 + (n ?? 0);
}
function createLog(name, deps) {
  const scratch = join3(deps.cwd, ".arbab-tmp");
  if (!deps.fs.isDir(scratch)) {
    for (let tries = 0; tries < FALLBACK_LOG_TRIES; tries++) {
      const path = join3(deps.tmpdir, `arbab-check-${name}-${deps.pid}-${deps.randomHex(3)}.log`);
      const file = deps.fs.createLog(path, 384);
      if (file !== null) return { path, file };
    }
    throw new Error(`no free log name in ${deps.tmpdir}`);
  }
  const dir = join3(scratch, "checks");
  deps.fs.mkdirp(dir);
  const pattern = new RegExp(`^${name}-(\\d+)\\.log$`);
  let n = 0;
  for (const file of deps.fs.readDir(dir)) {
    const match = pattern.exec(file);
    if (match !== null) n = Math.max(n, Number(match[1]));
  }
  for (let tries = 0; tries < LOG_TRIES; tries++) {
    n += 1;
    const path = join3(dir, `${name}-${n}.log`);
    const file = deps.fs.createLog(path, 438);
    if (file !== null) return { path, file };
  }
  throw new Error(`no free log number in ${dir}`);
}
var Tail = class {
  lines = [];
  partial = "";
  push(text) {
    const parts = (this.partial + text).split("\n");
    this.partial = parts.pop() ?? "";
    for (const line of parts) this.lines.push(line.replace(/\r$/, ""));
    if (this.lines.length > TAIL_KEEP) this.lines.splice(0, this.lines.length - TAIL_KEEP);
  }
  last(n) {
    const all = this.partial === "" ? this.lines : [...this.lines, this.partial.replace(/\r$/, "")];
    return all.slice(Math.max(0, all.length - n));
  }
};
function shortFailureLine(failure) {
  let file = failure.file === null ? null : failureFieldText(failure.file);
  let message2 = failure.message;
  if (file !== null && file.length > FAILURE_FIELD_MAX) {
    message2 = `${file}: ${message2}`;
    file = null;
  }
  const line = formatFailureLine({ file, test: failure.test, message: message2 });
  if (line.length <= FAILURE_LINE_MAX) return line;
  const clean = parseFailureLine(line) ?? { file: null, test: null, message: "" };
  const room = FAILURE_LINE_MAX - formatFailureLine({ file: clean.file, test: null, message: "" }).length;
  const testRoom = room - Math.min(clean.message.length, FAILURE_MESSAGE_MIN) - " > ".length;
  const test = clean.test === null || testRoom <= 0 ? null : clean.test.slice(0, testRoom);
  const head = formatFailureLine({ file: clean.file, test, message: "" });
  const cut2 = clean.message.slice(0, Math.max(0, FAILURE_LINE_MAX - head.length));
  return formatFailureLine({ file: clean.file, test, message: cut2 }).slice(0, FAILURE_LINE_MAX);
}
function summarize(header, failures, tail, budget) {
  const lines = [];
  let used = 0;
  const add = (line) => {
    lines.push(line);
    used += line.length + 1;
  };
  add(header.slice(0, HEADER_MAX));
  let failureChars = 0;
  let shown = 0;
  for (const failure of failures.slice(0, MAX_FAILURES)) {
    const line = shortFailureLine(failure);
    if (failureChars + line.length + 1 > FAILURES_CHARS) break;
    failureChars += line.length + 1;
    add(line);
    shown += 1;
  }
  if (shown < failures.length) add(`arbab-check: ${failures.length - shown} more failures in the log`);
  const markerRoom = `--- last ${tail.length} lines ---`.length + 1;
  let room = budget - used - markerRoom;
  const kept = [];
  for (let i = tail.length - 1; i >= 0; i--) {
    const line = (tail[i] ?? "").slice(0, TAIL_LINE_MAX);
    if (line.length + 1 > room) break;
    room -= line.length + 1;
    kept.unshift(line);
  }
  add(`--- last ${kept.length} lines ---`);
  for (const line of kept) add(line);
  return lines.join("\n") + "\n";
}
async function runCheck(args, deps) {
  let checks;
  let policy;
  try {
    ({ checks, policy } = readChecksEnv(deps.env));
  } catch (err) {
    deps.err(`arbab-check: ${message(err)}; configured checks: ${configuredNames(deps.env)}
`);
    return 2;
  }
  const [name, ...extra] = args;
  const names = Object.keys(checks).join(", ") || "none";
  if (name === void 0 || name === "") {
    deps.err(`arbab-check: usage: node arbab-check.mjs <name> [args\u2026]; configured checks: ${names}
`);
    return 2;
  }
  const argv = isCheckName(name) && Object.hasOwn(checks, name) ? checks[name] : void 0;
  if (argv === void 0) {
    deps.err(`arbab-check: unknown check ${JSON.stringify(name)}; configured checks: ${names}
`);
    return 2;
  }
  let pendingSignal = null;
  let child = null;
  const stopSignals = deps.onSignal((signal) => {
    if (child !== null) child.kill(signal);
    else pendingSignal = signal;
  });
  let printed = 0;
  const out = (text) => {
    printed += text.length;
    deps.out(text);
  };
  const dir = registryDir(deps.tmpdir);
  const entry = { pid: deps.pid, name, cwd: deps.cwd, startedAt: new Date(deps.now()).toISOString(), cpus: policy.cpus, state: "waiting" };
  let registered = false;
  try {
    register(dir, entry, deps.fs);
    registered = true;
  } catch (err) {
    deps.err(`arbab-check: the registry ${dir} is unusable (${message(err)}); running without waiting
`);
  }
  try {
    let usable = registered;
    const count = () => {
      if (!usable) return { running: 0, ahead: 0 };
      try {
        const others = liveEntries(dir, deps.pid, deps.fs, deps.probe, deps.now());
        return {
          running: others.filter((e) => e.state === "running").length,
          ahead: others.filter((e) => e.state === "waiting" && registeredBefore(e, entry)).length
        };
      } catch (err) {
        usable = false;
        deps.err(`arbab-check: the registry ${dir} is unusable (${message(err)}); running without waiting
`);
        return { running: 0, ahead: 0 };
      }
    };
    const full = (c) => c.running + c.ahead >= policy.concurrent;
    let seen = count();
    if (full(seen)) {
      const ahead = seen.ahead > 0 ? `, ${seen.ahead} waiting before this one` : "";
      out(`arbab-check: waiting for one of ${policy.concurrent} places (${seen.running} checks running${ahead})
`);
      const deadline = deps.now() + policy.waitSec * 1e3;
      while (full(seen) && pendingSignal === null) {
        const left = deadline - deps.now();
        if (left <= 0) break;
        await deps.sleep(Math.min(POLL_MS, left));
        seen = count();
      }
    }
    if (pendingSignal !== null) {
      deps.err(`arbab-check: ${pendingSignal} before ${name} started
`);
      return signalExitCode(pendingSignal);
    }
    const share = Math.max(1, Math.floor((policy.cpus - 1) / (seen.running + 1)));
    if (usable) {
      try {
        update(dir, { ...entry, state: "running", share }, deps.fs);
      } catch (err) {
        deps.err(`arbab-check: cannot mark ${name} running in ${dir} (${message(err)})
`);
      }
    }
    const command = [...argv.map((a) => a.split("{cpus}").join(String(share))), ...extra];
    let log = null;
    try {
      log = createLog(name, deps);
    } catch (err) {
      deps.err(`arbab-check: cannot create a log (${message(err)}); the output is not kept
`);
    }
    let logBroken = false;
    let logOpen = log !== null;
    const written = [];
    const tail = new Tail();
    const started = deps.now();
    const result = await new Promise((resolve2) => {
      try {
        child = deps.spawn(
          command[0] ?? "",
          command.slice(1),
          { cwd: deps.cwd, env: { ...deps.env, ARBAB_CHECK_CPUS: String(share), VITEST_MAX_WORKERS: String(share) } },
          {
            output: (text) => {
              tail.push(text);
              if (log === null || !logOpen) return;
              try {
                log.file.write(text);
                written.push(text);
              } catch (err) {
                logBroken = true;
                logOpen = false;
                written.length = 0;
                deps.err(`arbab-check: cannot write ${log.path} (${message(err)})
`);
              }
            },
            error: (error) => resolve2({ error }),
            exit: (code2, signal) => resolve2({ code: code2, signal })
          }
        );
      } catch (err) {
        resolve2({ error: err instanceof Error ? err : new Error(String(err)) });
      }
    });
    child = null;
    if (log !== null) {
      logOpen = false;
      try {
        log.file.close();
      } catch {
      }
    }
    if ("error" in result) {
      deps.err(`arbab-check: cannot run ${command[0] ?? ""}: ${result.error.message}
`);
      if (log !== null) {
        try {
          deps.fs.remove(log.path);
        } catch {
        }
      }
      return 127;
    }
    const code = result.signal !== null ? signalExitCode(result.signal) : result.code ?? 1;
    const seconds = ((deps.now() - started) / 1e3).toFixed(1);
    let where = "none";
    if (log !== null) {
      const rel = relative2(deps.cwd, log.path);
      where = rel !== "" && !rel.startsWith("..") && !isAbsolute2(rel) ? rel : log.path;
    }
    const header = `arbab-check ${name}: exit ${code} after ${seconds}s on ${share} CPUs; log ${where}`;
    let failures = [];
    if (code !== 0) {
      const whole = log !== null && !logBroken ? written.join("") : tail.last(TAIL_KEEP).join("\n");
      failures = parseFailures(whole, COUNT_FAILURES);
    }
    const last = tail.last(code === 0 ? TAIL_PASS : TAIL_FAIL).map(stripAnsi);
    out(summarize(header, failures, last, STDOUT_MAX - printed));
    return code;
  } finally {
    stopSignals();
    if (registered) {
      try {
        unregister(dir, deps.pid, deps.fs);
      } catch {
      }
    }
  }
}
var LOG_OPEN = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | (fsConstants.O_NOFOLLOW ?? 0);
function createLogFile(path, mode) {
  let fd;
  try {
    fd = openSync3(path, LOG_OPEN, mode);
  } catch (err) {
    const code = err.code;
    if (code === "EEXIST" || code === "ELOOP") return null;
    throw err;
  }
  return {
    write: (data) => {
      const bytes = Buffer.from(data, "utf8");
      for (let at = 0; at < bytes.length; ) at += writeSync2(fd, bytes, at, bytes.length - at);
    },
    close: () => {
      closeSync3(fd);
    }
  };
}
var nodeCheckFs = {
  ...nodeRegistryFs,
  isDir: (path) => {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
  createLog: createLogFile
};
function nodeCheckSpawn(spawn = nodeSpawn) {
  return (command, args, options, handlers) => {
    const proc = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"], shell: false });
    let settled = false;
    proc.stdout?.setEncoding("utf8");
    proc.stderr?.setEncoding("utf8");
    proc.stdout?.on("data", (text) => handlers.output(text));
    proc.stderr?.on("data", (text) => handlers.output(text));
    proc.on("error", (err) => {
      if (settled || proc.pid !== void 0) return;
      settled = true;
      handlers.error(err);
    });
    proc.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      handlers.exit(code, signal);
    });
    return {
      kill: (signal) => {
        proc.kill(signal);
      }
    };
  };
}

// src/check/main.ts
var SIGNALS = ["SIGINT", "SIGTERM"];
try {
  process.exitCode = await runCheck(process.argv.slice(2), {
    env: process.env,
    cwd: process.cwd(),
    tmpdir: tmpdir(),
    pid: process.pid,
    spawn: nodeCheckSpawn(),
    now: () => Date.now(),
    sleep,
    fs: nodeCheckFs,
    probe: killProbe((pid, signal) => process.kill(pid, signal)),
    randomHex: (bytes) => randomBytes2(bytes).toString("hex"),
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
    onSignal: (handler) => {
      for (const signal of SIGNALS) process.on(signal, handler);
      return () => {
        for (const signal of SIGNALS) process.off(signal, handler);
      };
    }
  });
} catch (err) {
  process.stderr.write(`arbab-check: ${err instanceof Error ? err.message : String(err)}
`);
  process.exitCode = 2;
}
