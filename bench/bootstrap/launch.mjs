#!/usr/bin/env node
// The hand-written launcher arbab uses to build itself until its own runner (M1) exists.
// One call runs one attempt of one lane, in the foreground, and prints one summary line at the end:
//
//   node bench/bootstrap/launch.mjs <lane.json> [--resume]
//
// lane.json fields:
//   name, role, cwd, model, effort, tools[], settings{}, budgetUsd, promptFile,
//   jsonSchemaFile?, restricted? (default true), wallMin? (60), idleMin? (20),
//   checkpoint? (commit the worktree after exit), env?{}, resumePrompt?
//
// Lessons built in (REQUIREMENTS §2): the binary is resolved once and pinned across attempts; the session
// id is pre-assigned; the worker gets a scrubbed environment, its own process group, and no host settings,
// MCP servers or prompts; every attempt has its own directory and nothing is overwritten; exit codes are
// read directly; the process tree is reaped after exit; the runner, not the worker, commits.
import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync,
  statSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { summarize, formatLine } from "./summarize.mjs";

const MIN_VERSION = [2, 1, 290];
const HERE = dirname(fileURLToPath(import.meta.url));
const RUNS_ROOT = process.env.ARBAB_RUNS ?? resolve(HERE, "../../.arbab/runs");
const DEFAULT_RESUME_PROMPT =
  "The run stopped because the account hit its usage limit, not because of anything in your work. The limit has " +
  "reset. The runner committed your work so far as a checkpoint: check `git log --oneline -5` and " +
  "`git status --short` to re-orient, then continue exactly where you left off, finish the task, run the checks " +
  "the brief names, and end with the report the brief asks for.";

const iso = () => new Date().toISOString();
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + "\n", { flag: "wx" });
const parseVersion = (s) => (s.match(/(\d+)\.(\d+)\.(\d+)/) ?? []).slice(1, 4).map(Number);
const versionAtLeast = (v, min) => {
  for (let i = 0; i < 3; i++) if (v[i] !== min[i]) return v[i] > min[i];
  return true;
};

function which(cmd, path) {
  for (const dir of path.split(":")) {
    const p = join(dir, cmd);
    if (existsSync(p)) return realpathSync(p);
  }
  return null;
}

function resolveBinary(previous) {
  if (previous) return previous; // pinned: an attempt reuses the binary of the lane's first attempt
  const path = process.env.ARBAB_CLAUDE ?? which("claude", process.env.PATH ?? "");
  if (!path) throw new Error("claude not found on PATH (set ARBAB_CLAUDE)");
  const out = execFileSync(path, ["--version"], { encoding: "utf8", timeout: 30_000 });
  const version = parseVersion(out);
  if (version.length !== 3 || !versionAtLeast(version, MIN_VERSION)) {
    throw new Error(`claude ${out.trim()} at ${path} is older than ${MIN_VERSION.join(".")}`);
  }
  return { path, version: version.join(".") };
}

function scrubbedEnv(lane, tmp) {
  const env = {};
  for (const k of ["HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "SHELL"]) {
    if (process.env[k]) env[k] = process.env[k];
  }
  const dirs = [dirname(process.execPath)];
  const pnpm = which("pnpm", process.env.PATH ?? "");
  if (pnpm) dirs.push(dirname(pnpm));
  dirs.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin");
  env.PATH = [...new Set(dirs)].join(":");
  env.TERM = "dumb";
  env.TMPDIR = tmp;
  env.DISABLE_AUTOUPDATER = "1";
  return { ...env, ...(lane.env ?? {}) };
}

function nextAttemptDir(laneDir) {
  mkdirSync(laneDir, { recursive: true });
  const n = readdirSync(laneDir).filter((d) => /^attempt-\d+$/.test(d)).length + 1;
  const dir = join(laneDir, `attempt-${n}`);
  mkdirSync(dir); // fails if it exists: an attempt is never overwritten
  return { n, dir };
}

function previousAttempt(laneDir, n) {
  if (n < 2) return null;
  const dir = join(laneDir, `attempt-${n - 1}`);
  const started = JSON.parse(readFileSync(join(dir, "started.json"), "utf8"));
  const summary = existsSync(join(dir, "summary.json"))
    ? JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"))
    : null;
  return { dir, started, summary };
}

function psTable() {
  const out = execFileSync("ps", ["-A", "-o", "pid=,ppid=,pgid="], { encoding: "utf8" });
  return out.trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number));
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Signals a pid (or, negative, a process group); a target that is already gone is not an error.
function signal(target, sig) {
  try {
    process.kill(target, sig);
  } catch {
    /* already gone */
  }
}

async function main() {
  const lanePath = resolve(process.argv[2] ?? "");
  const resume = process.argv.includes("--resume");
  const lane = JSON.parse(readFileSync(lanePath, "utf8"));
  for (const k of ["name", "cwd", "model", "effort", "tools", "settings", "budgetUsd", "promptFile"]) {
    if (lane[k] === undefined) throw new Error(`lane.${k} is required`);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(lane.name)) throw new Error("lane.name must be kebab-case");

  const laneDir = join(RUNS_ROOT, lane.name);
  const { n, dir } = nextAttemptDir(laneDir);
  const prev = previousAttempt(laneDir, n);
  if (resume && !prev) throw new Error("--resume needs an earlier attempt");

  const binary = resolveBinary(prev?.started.binary);
  const sessionId = resume ? prev.started.sessionId : randomUUID();
  const cwd = realpathSync(lane.cwd);
  const tmp = join(cwd, ".arbab-tmp");
  mkdirSync(tmp, { recursive: true });

  // Inputs are snapshotted into the attempt directory; the worker cannot write there (outside its worktree).
  writeJson(join(dir, "lane.json"), lane);
  const settings = { ...lane.settings, env: { ...(lane.settings.env ?? {}), TMPDIR: tmp } };
  const settingsPath = join(dir, "settings.json");
  writeJson(settingsPath, settings);
  const promptPath = join(dir, "prompt.md");
  writeFileSync(promptPath, resume ? (lane.resumePrompt ?? DEFAULT_RESUME_PROMPT) : readFileSync(lane.promptFile, "utf8"), { flag: "wx" });

  // --max-budget-usd counts only this invocation's spend: totals restored by --resume do not count toward
  // it (cli-reference), although total_cost_usd reports the whole conversation. So each attempt gets the
  // lane's per-attempt budget, and summaries compute per-attempt deltas.
  const args = [
    "-p", "--output-format", "stream-json", "--verbose",
    "--model", lane.model, "--effort", lane.effort,
    "--permission-mode", "dontAsk", "--permission-prompts", "none",
    "--strict-mcp-config", "--setting-sources", "",
    "--tools", lane.tools.join(","),
    "--settings", settingsPath,
    "--max-budget-usd", String(lane.budgetUsd),
    "-n", lane.name,
  ];
  if (lane.restricted !== false) args.push("--restricted");
  args.push(...(resume ? ["--resume", sessionId] : ["--session-id", sessionId]));
  if (lane.jsonSchemaFile) args.push("--json-schema", JSON.stringify(JSON.parse(readFileSync(lane.jsonSchemaFile, "utf8"))));
  const env = scrubbedEnv(lane, tmp);

  const startedAt = iso();
  const promptFd = openSync(promptPath, "r");
  const outFd = openSync(join(dir, "stream.jsonl"), "wx");
  const errFd = openSync(join(dir, "stderr.log"), "wx");
  const child = spawn(binary.path, args, { cwd, env, stdio: [promptFd, outFd, errFd], detached: true });
  closeSync(promptFd);
  closeSync(outFd);
  closeSync(errFd);
  const pid = child.pid;
  writeJson(join(dir, "started.json"), {
    name: lane.name, role: lane.role, attempt: n, resume, sessionId, pid, pgid: pid, binary, cwd, startedAt,
    args: args.map((a, i) => (args[i - 1] === "--json-schema" ? "<schema>" : a)),
    envKeys: Object.keys(env).sort(),
  });

  // Watch the run: descendants (so background children can be reaped after the worker exits), stream
  // growth (idle), the last result event (a worker that hangs after its final turn), and the wall clock.
  const descendants = new Map();
  const streamPath = join(dir, "stream.jsonl");
  let size = 0;
  let lastGrowth = Date.now();
  let lastResult = null;
  let carry = "";
  let killedBy = null;
  let registration = null;
  const wallMs = (lane.wallMin ?? 60) * 60_000;
  const idleMs = (lane.idleMin ?? 20) * 60_000;

  const kill = (reason) => {
    if (killedBy) return;
    killedBy = reason;
    signal(-pid, "SIGTERM");
    for (const p of descendants.keys()) signal(p, "SIGTERM");
    setTimeout(() => {
      signal(-pid, "SIGKILL");
      for (const p of descendants.keys()) signal(p, "SIGKILL");
    }, 10_000).unref();
  };

  const readNewLines = () => {
    const now = statSync(streamPath).size;
    if (now === size) return;
    const fd = openSync(streamPath, "r");
    const buf = Buffer.alloc(now - size);
    readSync(fd, buf, 0, buf.length, size);
    closeSync(fd);
    size = now;
    lastGrowth = Date.now();
    const lines = (carry + buf.toString("utf8")).split("\n");
    carry = lines.pop();
    for (const line of lines) {
      if (!line.includes('"type":"result"')) continue;
      try {
        const e = JSON.parse(line);
        if (e.type === "result") lastResult = { at: Date.now(), isError: e.is_error === true, status: e.api_error_status ?? null };
      } catch {
        /* a partial line; it is completed on the next read */
      }
    }
  };

  const tick = setInterval(() => {
    try {
      // Transitive descendants of the worker, recorded while their parents are still alive: once the
      // worker exits they are reparented to PID 1 and can no longer be traced back to it.
      const rows = psTable();
      const parent = new Map(rows.map(([p, pp]) => [p, pp]));
      for (const [p, , g] of rows) {
        let a = parent.get(p);
        for (let hops = 0; a && a > 1 && hops < 64; hops++) {
          if (a === pid || descendants.has(a)) {
            descendants.set(p, g);
            break;
          }
          a = parent.get(a);
        }
      }
      readNewLines();
      if (!registration) {
        const reg = join(homedir(), ".claude", "sessions", `${pid}.json`);
        if (existsSync(reg)) {
          const r = JSON.parse(readFileSync(reg, "utf8"));
          registration = { kind: r.kind ?? null, entrypoint: r.entrypoint ?? null, name: r.name ?? null };
          writeJson(join(dir, "registration.json"), registration);
        }
      }
      const quiet = Date.now() - lastGrowth;
      if (Date.now() - Date.parse(startedAt) > wallMs) kill("wall");
      else if (lastResult && lastResult.isError && quiet > 2 * 60_000) kill("hang-after-error");
      else if (lastResult && quiet > 15 * 60_000) kill("hang-after-result");
      else if (quiet > idleMs) kill("idle");
    } catch (err) {
      process.stderr.write(`watch: ${err.message}\n`);
    }
  }, 10_000);

  const { code, exitSignal } = await new Promise((res) => child.on("exit", (c, s) => res({ code: c, exitSignal: s })));
  clearInterval(tick);
  const finishedAt = iso();

  // Reap whatever the worker left behind: its process group and every descendant seen while it ran.
  const reaped = [...descendants.keys()].filter(alive);
  signal(-pid, "SIGTERM");
  for (const p of reaped) signal(p, "SIGTERM");
  if (reaped.length) {
    await new Promise((r) => setTimeout(r, 5_000));
    for (const p of reaped) signal(p, "SIGKILL");
  }

  // The runner, not the worker, commits a checkpoint of the worktree.
  let checkpoint = null;
  if (lane.checkpoint) {
    const git = (...a) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8" });
    if (git("status", "--porcelain").trim()) {
      git("add", "-A");
      git("commit", "-q", "-m", `checkpoint(${lane.name}): attempt ${n}\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`);
      checkpoint = git("rev-parse", "HEAD").trim();
    }
  }

  writeJson(join(dir, "exit.json"), {
    exitCode: code, signal: exitSignal, killedBy, finishedAt,
    wallMs: Date.parse(finishedAt) - Date.parse(startedAt), reaped, checkpoint,
  });
  const summary = summarize(dir);
  writeJson(join(dir, "summary.json"), summary);
  console.log(formatLine(summary));
  await resumeAfterLimit(lanePath, lane, summary, n);
}

// FR-6: a usage-limit stop resumes the same session, on the same binary, after the window resets. Every other end
// state is the orchestrator's decision. A wait longer than six hours (a weekly window) is left to a person.
async function resumeAfterLimit(lanePath, lane, summary, n) {
  if (summary.state !== "usage-limit" || lane.autoResume === false || n >= (lane.maxAttempts ?? 4)) return;
  const nowSec = Date.now() / 1000;
  const full = [summary.rateLimit?.fiveHour, summary.rateLimit?.sevenDay]
    .filter((w) => w && w.utilization >= 0.99 && w.resetsAt > nowSec);
  const resetsAt = full.length ? Math.max(...full.map((w) => w.resetsAt)) : nowSec + 15 * 60;
  const at = (resetsAt + 60 + Math.floor(Math.random() * 60)) * 1000;
  if (at - Date.now() > 6 * 3_600_000) {
    console.log(`usage limit resets at ${new Date(resetsAt * 1000).toISOString()}: too far to wait; resume by hand`);
    return;
  }
  console.log(`usage limit: resuming ${lane.name} at ${new Date(at).toISOString()}`);
  await new Promise((done) => setTimeout(done, Math.max(0, at - Date.now())));
  execFileSync(process.execPath, [fileURLToPath(import.meta.url), lanePath, "--resume"], { stdio: "inherit" });
}

main().catch((err) => {
  console.error(`launch failed: ${err.stack ?? err}`);
  process.exit(2);
});
