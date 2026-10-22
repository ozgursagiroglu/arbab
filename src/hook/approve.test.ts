import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { approves, APPROVAL, isRunnerCall, TEMP_DIRS, type ApproveOptions } from "./approve";

let dir: string;
let runner: string;
let repo: string;
let spaced: string;
let opts: ApproveOptions;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "arbab-")));
  runner = join(dir, "plugin root", "dist", "arbab.mjs");
  mkdirSync(join(dir, "plugin root", "dist"), { recursive: true });
  writeFileSync(runner, "// runner\n");
  writeFileSync(join(dir, "other.mjs"), "// other\n");
  symlinkSync(runner, join(dir, "runner-link.mjs"));
  symlinkSync(join(dir, "other.mjs"), join(dir, "other-link.mjs"));
  repo = join(dir, "repo");
  spaced = join(dir, "my repo");
  mkdirSync(repo);
  mkdirSync(spaced);
  opts = {
    scriptPath: runner,
    commands: ["status", "wait", "launch", "land", "hook", "__shepherd"],
    realpath: realpathSync,
    projectRoots: () => [repo, spaced],
    // The test dirs live under the OS temp dir, which may itself be under /tmp; temp dirs get their own tests.
    tempDirs: [],
  };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const call = (rest: string): string => `node "${runner}" ${rest}`;

describe("APPROVAL", () => {
  it("is the exact PreToolUse allow output", () => {
    expect(APPROVAL).toBe(
      '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"arbab runner"}}',
    );
  });
});

describe("isRunnerCall", () => {
  it("approves bare calls, with and without -C, with quoted runner path and arguments", () => {
    expect(isRunnerCall(call("status"), opts)).toBe(true);
    expect(isRunnerCall(call("status --json"), opts)).toBe(true);
    expect(isRunnerCall(call(`-C ${repo} wait --any --timeout-min 30`), opts)).toBe(true);
    expect(isRunnerCall(call(`-C '${spaced}' status`), opts)).toBe(true);
    expect(isRunnerCall(`node '${runner}' launch "lanes/a b.json"`, opts)).toBe(true);
    expect(isRunnerCall(call("launch 'lanes/$x.json'"), opts)).toBe(true);
    expect(isRunnerCall(`\tnode  "${runner}"\twait  `, opts)).toBe(true);
  });

  it("approves a plain runner path and a symlink to the runner", () => {
    const plain = join(dir, "runner.mjs");
    symlinkSync(runner, plain);
    expect(isRunnerCall(`node ${plain} status`, opts)).toBe(true);
    expect(isRunnerCall(`node ${join(dir, "runner-link.mjs")} status`, opts)).toBe(true);
    // The runner itself named through a symlinked scriptPath.
    expect(isRunnerCall(call("status"), { ...opts, scriptPath: join(dir, "runner-link.mjs") })).toBe(true);
  });

  it("refuses shell syntax around or inside the call", () => {
    for (const command of [
      call("status | tail -5"),
      call("status 2>&1"),
      `cd /work && ${call("status")}`,
      call("status && echo ok"),
      call("status; rm -rf x"),
      call("status &"),
      `(${call("status")})`,
      call("launch $(cat lane)"),
      call("launch `cat lane`"),
      call('launch "$HOME/lane.json"'),
      call("status\nrm -rf x"),
      call("status > out.txt"),
    ]) {
      expect(isRunnerCall(command, opts), command).toBe(false);
    }
  });

  it("refuses an env prefix, node options and another program", () => {
    expect(isRunnerCall(`FOO=bar ${call("status")}`, opts)).toBe(false);
    expect(isRunnerCall(`env ${call("status")}`, opts)).toBe(false);
    expect(isRunnerCall(`node --require ./x.js "${runner}" status`, opts)).toBe(false);
    expect(isRunnerCall(`/usr/bin/node "${runner}" status`, opts)).toBe(false);
    expect(isRunnerCall(`nodejs "${runner}" status`, opts)).toBe(false);
  });

  it("refuses another script, a symlink to another file, a missing file and a relative path", () => {
    expect(isRunnerCall(`node ${join(dir, "other.mjs")} status`, opts)).toBe(false);
    expect(isRunnerCall(`node ${join(dir, "other-link.mjs")} status`, opts)).toBe(false);
    expect(isRunnerCall(`node ${join(dir, "missing.mjs")} status`, opts)).toBe(false);
    expect(isRunnerCall("node arbab.mjs status", { ...opts, realpath: (p) => (p === "arbab.mjs" ? runner : realpathSync(p)) })).toBe(false);
    expect(isRunnerCall("node ~/arbab.mjs status", opts)).toBe(false);
    expect(isRunnerCall(call("status"), { ...opts, scriptPath: join(dir, "gone.mjs") })).toBe(false);
  });

  it("refuses unknown commands, hook, __shepherd and a missing command", () => {
    expect(isRunnerCall(call("rm"), opts)).toBe(false);
    expect(isRunnerCall(call("constructor"), opts)).toBe(false);
    expect(isRunnerCall(call("hook pre-tool-use"), opts)).toBe(false);
    expect(isRunnerCall(call("__shepherd /r demo {}"), opts)).toBe(false);
    expect(isRunnerCall(call(`-C ${repo} hook stop`), opts)).toBe(false);
    expect(isRunnerCall(call("--help"), opts)).toBe(false);
    expect(isRunnerCall(`node "${runner}"`, opts)).toBe(false);
    expect(isRunnerCall(call(`-C ${repo}`), opts)).toBe(false);
    expect(isRunnerCall(call("-C status"), opts)).toBe(false);
    expect(isRunnerCall("node", opts)).toBe(false);
    expect(isRunnerCall("", opts)).toBe(false);
  });

  it("refuses land, with and without -C", () => {
    expect(isRunnerCall(call("land rel"), opts)).toBe(false);
    expect(isRunnerCall(call("land rel --squash"), opts)).toBe(false);
    expect(isRunnerCall(call(`-C ${repo} land rel`), opts)).toBe(false);
  });
});

describe("isRunnerCall -C", () => {
  it("approves a registered root, named directly or through a symlink, and a root registered through a symlink", () => {
    symlinkSync(repo, join(dir, "repo-link"));
    expect(isRunnerCall(call(`-C ${repo} status`), opts)).toBe(true);
    expect(isRunnerCall(call(`-C ${join(dir, "repo-link")} status`), opts)).toBe(true);
    expect(isRunnerCall(call(`-C ${repo} status`), { ...opts, projectRoots: () => [join(dir, "repo-link")] })).toBe(true);
  });

  it("reads the registry only for a -C call", () => {
    let reads = 0;
    const counted = {
      ...opts,
      projectRoots: () => {
        reads++;
        return [repo];
      },
    };
    expect(isRunnerCall(call("status"), counted)).toBe(true);
    expect(reads).toBe(0);
    expect(isRunnerCall(call(`-C ${repo} status`), counted)).toBe(true);
    expect(reads).toBe(1);
  });

  it("refuses an unregistered, missing or relative dir, and a subdirectory of a registered root", () => {
    mkdirSync(join(dir, "elsewhere"));
    mkdirSync(join(repo, "sub"));
    expect(isRunnerCall(call(`-C ${join(dir, "elsewhere")} status`), opts)).toBe(false);
    expect(isRunnerCall(call(`-C ${join(dir, "gone")} status`), { ...opts, projectRoots: () => [join(dir, "gone")] })).toBe(false);
    expect(isRunnerCall(call("-C repo status"), { ...opts, projectRoots: () => ["repo"] })).toBe(false);
    expect(isRunnerCall(call(`-C ${join(repo, "sub")} status`), opts)).toBe(false);
    expect(isRunnerCall(call(`-C ${repo} status`), { ...opts, projectRoots: () => [] })).toBe(false);
  });

  it("refuses a lane worktree even when registered, and a symlink into one", () => {
    const lane = join(repo, ".arbab", "worktrees", "a");
    mkdirSync(lane, { recursive: true });
    symlinkSync(lane, join(dir, "lane-link"));
    const withLane = { ...opts, projectRoots: () => [lane, join(dir, "lane-link")] };
    expect(isRunnerCall(call(`-C ${lane} status`), withLane)).toBe(false);
    expect(isRunnerCall(call(`-C ${join(dir, "lane-link")} status`), withLane)).toBe(false);
  });

  it("refuses a lane worktree by its spelling on disk, a .ARBAB/WORKTREES spelling and a configured worktreeRoot", () => {
    // A fake case-insensitive file system: every spelling of the lane resolves to the one on disk.
    const fake = (p: string): string => {
      if (p === runner) return runner;
      if (p.toLowerCase() === "/work/repo/.arbab/worktrees/a") return "/work/repo/.arbab/worktrees/a";
      if (p === "/work/repo") return p;
      throw new Error(`ENOENT ${p}`);
    };
    const base = { ...opts, realpath: fake, projectRoots: () => ["/WORK/REPO/.ARBAB/WORKTREES/A", "/work/repo"] };
    expect(isRunnerCall(call("-C /WORK/REPO/.ARBAB/WORKTREES/A status"), base)).toBe(false);
    expect(isRunnerCall(call("-C /work/repo status"), base)).toBe(true);

    writeFileSync(join(repo, "arbab.config.json"), JSON.stringify({ worktreeRoot: "wt" }));
    const lane = join(repo, "wt", "a");
    mkdirSync(join(lane, "src"), { recursive: true });
    const withLane = { ...opts, projectRoots: () => [repo, lane, join(lane, "src")] };
    expect(isRunnerCall(call(`-C ${lane} status`), withLane)).toBe(false);
    expect(isRunnerCall(call(`-C ${join(lane, "src")} status`), withLane)).toBe(false);
    expect(isRunnerCall(call(`-C ${repo} status`), withLane)).toBe(true);
  });

  it("refuses a lane worktree under a worktreeRoot linked to elsewhere in the project, by either path", () => {
    writeFileSync(join(repo, "arbab.config.json"), JSON.stringify({ worktreeRoot: "wt" }));
    const pool = join(repo, ".arbab", "pool");
    mkdirSync(join(pool, "a"), { recursive: true });
    symlinkSync(pool, join(repo, "wt"));
    const lanes = [join(pool, "a"), join(repo, "wt", "a")];
    const withLane = { ...opts, projectRoots: () => [repo, ...lanes] };
    for (const lane of lanes) expect(isRunnerCall(call(`-C ${lane} status`), withLane), lane).toBe(false);
    expect(isRunnerCall(call(`-C ${repo} status`), withLane)).toBe(true);
  });

  it("refuses a registered root in or under a temp dir, named directly or through its real path", () => {
    expect(isRunnerCall(call(`-C ${repo} status`), { ...opts, tempDirs: [dir] })).toBe(false);
    expect(isRunnerCall(call(`-C ${repo} status`), { ...opts, tempDirs: [repo] })).toBe(false);
    symlinkSync(dir, join(repo, "tmp-link"));
    expect(isRunnerCall(call(`-C ${repo} status`), { ...opts, tempDirs: [join(repo, "tmp-link")] })).toBe(false);
    // A relative temp dir is no anchor; a sibling sharing a prefix is not under it.
    expect(isRunnerCall(call(`-C ${repo} status`), { ...opts, tempDirs: ["repo", `${repo}-x`] })).toBe(true);
  });

  it("refuses /tmp and /private/tmp by default", () => {
    // A fake file system: /tmp is a symlink to /private/tmp, as on macOS.
    const fake = (p: string): string => {
      if (p === runner) return runner;
      if (p === "/tmp" || p.startsWith("/tmp/")) return `/private${p}`;
      if (p.startsWith("/private/tmp") || p === "/work/repo") return p;
      throw new Error(`ENOENT ${p}`);
    };
    const roots = (): string[] => ["/tmp/claude-1/evil", "/private/tmp/evil", "/work/repo"];
    const base = { ...opts, realpath: fake, projectRoots: roots, tempDirs: TEMP_DIRS };
    expect(isRunnerCall(call("-C /tmp/claude-1/evil status"), base)).toBe(false);
    expect(isRunnerCall(call("-C /private/tmp/evil status"), base)).toBe(false);
    expect(isRunnerCall(call("-C /tmp status"), { ...base, projectRoots: () => ["/tmp"] })).toBe(false);
    expect(isRunnerCall(call("-C /work/repo status"), base)).toBe(true);
  });
});

describe("approves", () => {
  const input = (over: Record<string, unknown> = {}): string =>
    JSON.stringify({
      session_id: "s-1",
      cwd: "/work/repo",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: call("status"), description: "status" },
      tool_use_id: "t-1",
      permission_mode: "default",
      ...over,
    });

  it("approves a Bash runner call", () => {
    expect(approves(input(), opts)).toBe(true);
    expect(approves(JSON.stringify({ tool_name: "Bash", tool_input: { command: call("wait --any") } }), opts)).toBe(true);
  });

  it("refuses another tool, invalid JSON and fields of the wrong type", () => {
    expect(approves(input({ tool_name: "Read" }), opts)).toBe(false);
    expect(approves(input({ tool_name: "bash" }), opts)).toBe(false);
    expect(approves("{not json", opts)).toBe(false);
    expect(approves("", opts)).toBe(false);
    expect(approves("[]", opts)).toBe(false);
    expect(approves("null", opts)).toBe(false);
    expect(approves(input({ tool_input: { command: 1 } }), opts)).toBe(false);
    expect(approves(input({ tool_input: call("status") }), opts)).toBe(false);
    expect(approves(input({ tool_input: [call("status")] }), opts)).toBe(false);
    expect(approves(input({ session_id: 7 }), opts)).toBe(false);
    expect(approves(input({ cwd: null }), opts)).toBe(false);
    expect(approves(input({ hook_event_name: "PostToolUse" }), opts)).toBe(false);
  });

  it("refuses a Bash call that is not a bare runner call", () => {
    expect(approves(input({ tool_input: { command: `${call("status")} | tail` } }), opts)).toBe(false);
  });

  it("refuses -C into an unregistered dir and land", () => {
    expect(approves(input({ tool_input: { command: call(`-C ${repo} status`) } }), opts)).toBe(true);
    expect(approves(input({ tool_input: { command: call(`-C ${repo} status`) } }), { ...opts, projectRoots: () => [] })).toBe(false);
    expect(approves(input({ tool_input: { command: call("land rel") } }), opts)).toBe(false);
  });
});
