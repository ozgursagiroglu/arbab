import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerShepherd, registerWaiter } from "../registry";
import type { ShepherdEntry } from "../types";
import { tokenize } from "./command";
import { blockReason, stopDecision, waitCommand, type StopOptions } from "./stop";

const SESSION = "aaaaaaaa-1111-2222-3333-444444444444";
const OTHER = "bbbbbbbb-1111-2222-3333-444444444444";
const RUNNER = "/plugins/arbab/dist/arbab.mjs";

let home: string;
let alive: Set<number>;
let opts: StopOptions;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "arbab-"));
  alive = new Set();
  opts = { home, alive: (pid) => alive.has(pid), scriptPath: RUNNER, cwd: "/work/repo" };
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const lane = (pid: number, name: string, over: Partial<ShepherdEntry> = {}): ShepherdEntry => ({
  pid,
  lane: name,
  project: "/work/repo",
  owner: SESSION,
  startedAt: `2026-10-21T10:00:0${pid % 10}.000Z`,
  ...over,
});

function shepherd(pid: number, name: string, over: Partial<ShepherdEntry> = {}): void {
  registerShepherd(home, lane(pid, name, over));
  alive.add(pid);
}

const input = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({ session_id: SESSION, cwd: "/work/repo", hook_event_name: "Stop", stop_hook_active: false, ...over });

function reason(out: string | null): string {
  expect(out).not.toBeNull();
  const parsed = JSON.parse(out ?? "") as { decision: string; reason: string };
  expect(parsed.decision).toBe("block");
  return parsed.reason;
}

describe("stopDecision", () => {
  it("blocks once when this session owns live shepherds and no waiter, then lets the next stop through", () => {
    shepherd(101, "alpha");
    shepherd(102, "beta");
    const text = reason(stopDecision(input(), opts));
    expect(text).toContain("alpha (/work/repo), beta (/work/repo)");
    expect(text).toContain("no `arbab wait` is running");
    expect(text).toContain(`node "${RUNNER}" wait --any`);
    expect(text).not.toContain("-C");
    expect(stopDecision(input({ stop_hook_active: true }), opts)).toBeNull();
  });

  it("blocks when stop_hook_active is absent", () => {
    shepherd(101, "alpha");
    expect(stopDecision(JSON.stringify({ session_id: SESSION }), opts)).not.toBeNull();
  });

  it("stays quiet with a live waiter of this session", () => {
    shepherd(101, "alpha");
    registerWaiter(home, { pid: 201, project: "/work/repo", owner: SESSION, startedAt: "2026-10-21T10:00:00.000Z" });
    alive.add(201);
    expect(stopDecision(input(), opts)).toBeNull();
  });

  it("blocks when the only waiters are dead or another session's", () => {
    shepherd(101, "alpha");
    registerWaiter(home, { pid: 201, project: "/work/repo", owner: SESSION, startedAt: "2026-10-21T10:00:00.000Z" });
    registerWaiter(home, { pid: 202, project: "/work/repo", owner: OTHER, startedAt: "2026-10-21T10:00:00.000Z" });
    alive.add(202);
    expect(stopDecision(input(), opts)).not.toBeNull();
  });

  it("stays quiet with only other sessions' or unowned shepherds", () => {
    shepherd(101, "alpha", { owner: OTHER });
    shepherd(102, "beta", { owner: null });
    expect(stopDecision(input(), opts)).toBeNull();
  });

  it("stays quiet when this session's shepherds are dead", () => {
    registerShepherd(home, lane(101, "alpha"));
    expect(stopDecision(input(), opts)).toBeNull();
  });

  it("stays quiet with no registry at all", () => {
    expect(stopDecision(input(), { ...opts, home: join(home, "missing") })).toBeNull();
  });

  it("stays quiet without a session id or on malformed input", () => {
    shepherd(101, "alpha");
    expect(stopDecision(input({ session_id: undefined }), opts)).toBeNull();
    expect(stopDecision(input({ session_id: "" }), opts)).toBeNull();
    expect(stopDecision(input({ session_id: 5 }), opts)).toBeNull();
    expect(stopDecision(input({ stop_hook_active: "false" }), opts)).toBeNull();
    expect(stopDecision(input({ cwd: 3 }), opts)).toBeNull();
    expect(stopDecision(input({ hook_event_name: "SubagentStop" }), opts)).toBeNull();
    expect(stopDecision("{", opts)).toBeNull();
    expect(stopDecision("", opts)).toBeNull();
    expect(stopDecision('"x"', opts)).toBeNull();
  });

  it("adds -C when the lanes share a project other than the input's cwd, else the context's", () => {
    shepherd(101, "alpha", { project: "/work/other repo" });
    expect(reason(stopDecision(input(), opts))).toContain(`node "${RUNNER}" -C '/work/other repo' wait --any`);
    expect(reason(stopDecision(input({ cwd: "/work/other repo" }), opts))).toContain(`node "${RUNNER}" wait --any`);
    expect(reason(stopDecision(input({ cwd: undefined }), { ...opts, cwd: "/work/other repo" }))).not.toContain("-C");
  });
});

describe("waitCommand", () => {
  it("leaves -C out when the lanes span several projects", () => {
    const lanes = [lane(1, "a", { project: "/p/one" }), lane(2, "b", { project: "/p/two" })];
    expect(waitCommand(RUNNER, lanes, "/work/repo")).toBe(`node "${RUNNER}" wait --any`);
  });

  it("is a command the PreToolUse tokenizer accepts", () => {
    const command = waitCommand(RUNNER, [lane(1, "a", { project: "/work/my repo" })], "/elsewhere");
    expect(tokenize(command)?.map((w) => w.value)).toEqual(["node", RUNNER, "-C", "/work/my repo", "wait", "--any"]);
  });

  it("quotes a runner path that double quotes would not keep literal", () => {
    expect(waitCommand("/p/$x/arbab.mjs", [lane(1, "a")], "/work/repo")).toBe("node '/p/$x/arbab.mjs' wait --any");
    expect(waitCommand("/p/it's!/arbab.mjs", [lane(1, "a")], "/work/repo")).toBe("node '/p/it'\\''s!/arbab.mjs' wait --any");
  });

  it("double-quotes a project holding a single quote when that keeps it literal, and single-quotes it otherwise", () => {
    const command = waitCommand(RUNNER, [lane(1, "a", { project: "/work/it's" })], "/elsewhere");
    expect(command).toBe(`node "${RUNNER}" -C "/work/it's" wait --any`);
    expect(tokenize(command)?.map((w) => w.value)).toEqual(["node", RUNNER, "-C", "/work/it's", "wait", "--any"]);
    expect(waitCommand(RUNNER, [lane(1, "a", { project: "/work/it's!" })], "/elsewhere")).toBe(
      `node "${RUNNER}" -C '/work/it'\\''s!' wait --any`,
    );
  });
});

describe("blockReason", () => {
  it("names five lanes and counts the rest", () => {
    const lanes = [1, 2, 3, 4, 5, 6, 7].map((n) => lane(n, `lane-${n}`));
    const text = blockReason(lanes, RUNNER, "/work/repo");
    expect(text).toContain("7 lanes are still running");
    expect(text).toContain("lane-5 (/work/repo) and 2 more");
    expect(text).not.toContain("lane-6");
  });

  it("speaks of one lane in the singular", () => {
    expect(blockReason([lane(1, "solo")], RUNNER, "/work/repo")).toContain("1 lane is still running");
  });
});
