// src/check/main.ts
import { tmpdir } from "node:os";

// src/util/proc.ts
var sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// src/check/registry.ts
import { readdirSync, readFileSync as readFileSync2, rmSync as rmSync2 } from "node:fs";
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
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
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
var ENTRY_FILE = /^([1-9]\d*)\.json$/;
var entryPath = (dir, pid) => join2(dir, `${pid}.json`);
var isPid = (v) => typeof v === "number" && Number.isInteger(v) && v > 0;
function assertPid(pid) {
  if (!isPid(pid)) throw new ArbabError("usage", `invalid pid ${pid}`);
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
  if (r.pid !== pid || typeof r.name !== "string" || typeof r.cwd !== "string" || typeof r.startedAt !== "string" || !isPid(r.cpus)) {
    return null;
  }
  return { pid, name: r.name, cwd: r.cwd, startedAt: r.startedAt, cpus: r.cpus };
}
function running(dir, self, fs, probe) {
  const live = [];
  for (const file of fs.readDir(dir).sort()) {
    const match = ENTRY_FILE.exec(file);
    if (match === null) continue;
    const pid = Number(match[1]);
    if (pid === self || !Number.isSafeInteger(pid)) continue;
    let text;
    try {
      text = fs.readFile(join2(dir, file));
    } catch {
      continue;
    }
    const entry = parseEntry(text, pid);
    if (entry === null) continue;
    if (probe(pid) === "alive") {
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
    try {
      kill(pid, 0);
      return "alive";
    } catch (err) {
      return err.code === "ESRCH" ? "gone" : "alive";
    }
  };
}
var nodeRegistryFs = {
  mkdirp: ensureDir,
  writeExclusive: createExclusive,
  readDir: (dir) => readdirSync(dir),
  readFile: (path) => readFileSync2(path, "utf8"),
  remove: (path) => {
    rmSync2(path, { force: true });
  }
};

// src/check/run.ts
import { spawn as nodeSpawn } from "node:child_process";
import { appendFileSync, statSync } from "node:fs";
import { constants } from "node:os";
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
var oneLine = (s) => s.replace(/[\r\n\t]+/g, " ").trim();
function formatFailureLine(failure) {
  const file = failure.file === null || oneLine(failure.file) === "" ? "-" : oneLine(failure.file);
  const test = failure.test === null || oneLine(failure.test) === "" ? "" : ` > ${oneLine(failure.test)}`;
  return `${FAILURE_PREFIX}${file}${test} :: ${oneLine(failure.message).slice(0, FAILURE_MESSAGE_MAX)}`;
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
  const n = constants.signals[signal];
  return 128 + (n ?? 0);
}
function createLog(name, deps) {
  const scratch = join3(deps.cwd, ".arbab-tmp");
  if (!deps.fs.isDir(scratch)) {
    const path = join3(deps.tmpdir, `arbab-check-${name}-${deps.pid}.log`);
    deps.fs.remove(path);
    if (!deps.fs.writeExclusive(path, "")) throw new Error(`${path} exists`);
    return path;
  }
  const dir = join3(scratch, "checks");
  deps.fs.mkdirp(dir);
  const pattern = new RegExp(`^${name}-(\\d+)\\.log$`);
  let n = 0;
  for (const file of deps.fs.readDir(dir)) {
    const match = pattern.exec(file);
    if (match !== null) n = Math.max(n, Number(match[1]));
  }
  for (let tries = 0; tries < 100; tries++) {
    n += 1;
    const path = join3(dir, `${name}-${n}.log`);
    if (deps.fs.writeExclusive(path, "")) return path;
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
  const dir = registryDir(deps.tmpdir);
  let registered = false;
  try {
    const entry = { pid: deps.pid, name, cwd: deps.cwd, startedAt: new Date(deps.now()).toISOString(), cpus: policy.cpus };
    register(dir, entry, deps.fs);
    registered = true;
  } catch (err) {
    deps.err(`arbab-check: the registry ${dir} is unusable (${message(err)}); running without waiting
`);
  }
  try {
    let usable = registered;
    const count = () => {
      if (!usable) return 0;
      try {
        return running(dir, deps.pid, deps.fs, deps.probe).length;
      } catch (err) {
        usable = false;
        deps.err(`arbab-check: the registry ${dir} is unusable (${message(err)}); running without waiting
`);
        return 0;
      }
    };
    let others = count();
    if (others >= policy.concurrent) {
      deps.out(`arbab-check: waiting for one of ${policy.concurrent} places (${others} checks running)
`);
      const deadline = deps.now() + policy.waitSec * 1e3;
      while (others >= policy.concurrent && pendingSignal === null) {
        const left = deadline - deps.now();
        if (left <= 0) break;
        await deps.sleep(Math.min(POLL_MS, left));
        others = count();
      }
    }
    if (pendingSignal !== null) {
      deps.err(`arbab-check: ${pendingSignal} before ${name} started
`);
      return signalExitCode(pendingSignal);
    }
    const share = Math.max(1, Math.floor((policy.cpus - 1) / (others + 1)));
    const command = [...argv.map((a) => a.split("{cpus}").join(String(share))), ...extra];
    let log = null;
    try {
      log = createLog(name, deps);
    } catch (err) {
      deps.err(`arbab-check: cannot create a log (${message(err)}); the output is not kept
`);
    }
    let logBroken = false;
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
              if (log === null || logBroken) return;
              try {
                deps.fs.append(log, text);
              } catch (err) {
                logBroken = true;
                deps.err(`arbab-check: cannot write ${log} (${message(err)})
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
    if ("error" in result) {
      deps.err(`arbab-check: cannot run ${command[0] ?? ""}: ${result.error.message}
`);
      if (log !== null) {
        try {
          deps.fs.remove(log);
        } catch {
        }
      }
      return 127;
    }
    const code = result.signal !== null ? signalExitCode(result.signal) : result.code ?? 1;
    const seconds = ((deps.now() - started) / 1e3).toFixed(1);
    let where = "none";
    if (log !== null) {
      const rel = relative2(deps.cwd, log);
      where = rel !== "" && !rel.startsWith("..") && !isAbsolute2(rel) ? rel : log;
    }
    const lines = [`arbab-check ${name}: exit ${code} after ${seconds}s on ${share} CPUs; log ${where}`];
    if (code !== 0) {
      let full = null;
      if (log !== null && !logBroken) {
        try {
          full = deps.fs.readFile(log);
        } catch {
        }
      }
      for (const failure of parseFailures(full ?? tail.last(TAIL_KEEP).join("\n"), MAX_FAILURES)) {
        lines.push(formatFailureLine(failure));
      }
    }
    const last = tail.last(code === 0 ? TAIL_PASS : TAIL_FAIL).map(stripAnsi);
    lines.push(`--- last ${last.length} lines ---`, ...last);
    deps.out(lines.join("\n") + "\n");
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
var nodeCheckFs = {
  ...nodeRegistryFs,
  isDir: (path) => {
    try {
      return statSync(path).isDirectory();
    } catch {
      return false;
    }
  },
  append: (path, data) => {
    appendFileSync(path, data);
  }
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
