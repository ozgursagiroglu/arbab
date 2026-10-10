#!/usr/bin/env node
// A stand-in for the claude binary (DESIGN.md §14): replays a stream fixture so the shepherd's lifecycle is tested
// without spending quota. The scenario comes from the JSON file named by FAKE_CLAUDE_SCENARIO:
//   fixture        name under test/fixtures/stream/ (".jsonl" optional) or an absolute path
//   resumeFixture  used instead of fixture when argv has --resume
//   lineDelayMs    pause before each line
//   touch          a file, relative to cwd, to write (simulates an edit)
//   spawnChild     start a `node -e "setInterval(()=>{},1e3)"`, not waited for: true puts it in a process group of
//                  its own (detached), "group" leaves it in the fake's group
//   hangMs         sleep after the last line; -1 means forever
//   exitCode       the exit status (default 0)
// Every call appends one JSON line to FAKE_CLAUDE_LOG: argv, the env keys it received, its pid and ppid, the
// spawned child's pid and whether it left the fake's process group, and the stdin length.
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, "..", "fixtures", "stream");

const argv = process.argv.slice(2);

function fail(message) {
  process.stderr.write(`fake-claude: ${message}\n`);
  process.exit(2);
}

function flag(name) {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

function fixturePath(name) {
  if (typeof name !== "string" || name === "") fail("scenario has no fixture");
  if (isAbsolute(name)) return name;
  return join(FIXTURES, name.endsWith(".jsonl") ? name : `${name}.jsonl`);
}

// Rewrites session_id at any depth, so the replayed stream names the session the caller asked for.
function rewrite(value, sessionId) {
  if (Array.isArray(value)) return value.map((v) => rewrite(v, sessionId));
  if (typeof value !== "object" || value === null) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = k === "session_id" ? sessionId : rewrite(v, sessionId);
  return out;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function readStdin() {
  let n = 0;
  for await (const chunk of process.stdin) n += chunk.length;
  return n;
}

async function main() {
  if (argv.includes("--version")) {
    process.stdout.write("2.1.295 (Claude Code)\n");
    return 0;
  }
  const scenarioFile = process.env.FAKE_CLAUDE_SCENARIO;
  if (!scenarioFile) fail("FAKE_CLAUDE_SCENARIO is not set");
  let scenario;
  try {
    scenario = JSON.parse(readFileSync(scenarioFile, "utf8"));
  } catch (err) {
    fail(`cannot read scenario ${scenarioFile}: ${err.message}`);
  }

  const resume = argv.includes("--resume");
  const sessionId = flag(resume ? "--resume" : "--session-id") ?? null;
  const stdinBytes = await readStdin();

  if (typeof scenario.touch === "string" && scenario.touch !== "") {
    const target = resolve(process.cwd(), scenario.touch);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `written by fake-claude in session ${sessionId}\n`);
  }

  let childPid = null;
  let childDetached = null;
  if (scenario.spawnChild === true || scenario.spawnChild === "group") {
    childDetached = scenario.spawnChild === true;
    const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1e3)"], { detached: childDetached, stdio: "ignore" });
    child.unref();
    childPid = child.pid ?? null;
  }

  if (process.env.FAKE_CLAUDE_LOG) {
    const entry = {
      pid: process.pid,
      ppid: process.ppid,
      cwd: process.cwd(),
      argv,
      envKeys: Object.keys(process.env).sort(),
      childPid,
      childDetached,
      stdinBytes,
    };
    appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify(entry)}\n`);
  }

  const name = resume && scenario.resumeFixture !== undefined ? scenario.resumeFixture : scenario.fixture;
  const lines = readFileSync(fixturePath(name), "utf8").split("\n").filter((l) => l.trim() !== "");
  const delay = Number.isFinite(scenario.lineDelayMs) ? scenario.lineDelayMs : 0;
  for (const line of lines) {
    if (delay > 0) await sleep(delay);
    let out = line;
    try {
      out = JSON.stringify(rewrite(JSON.parse(line), sessionId));
    } catch {
      // A deliberately truncated line is replayed as it is.
    }
    writeFileSync(1, `${out}\n`);
  }

  const hangMs = Number.isFinite(scenario.hangMs) ? scenario.hangMs : 0;
  if (hangMs === -1) {
    setInterval(() => {}, 1_000);
    await new Promise(() => {});
  }
  if (hangMs > 0) await sleep(hangMs);
  return Number.isInteger(scenario.exitCode) ? scenario.exitCode : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => fail(err?.stack ?? String(err)),
);
