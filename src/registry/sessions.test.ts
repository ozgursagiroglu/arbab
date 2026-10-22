import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionActivity, ShepherdEntry, WaiterEntry } from "../types";
import { otherSessions, registerShepherd, registerWaiter, runnerPath, sessionId, sessionText } from "./index";

const ME = "aaaaaaaa-1111-2222-3333-444444444444";
const OTHER = "bbbbbbbb-1111-2222-3333-444444444444";
const THIRD = "cccccccc-1111-2222-3333-444444444444";
const AT = "2026-10-22T10:00:00.000Z";

let dir: string;
let home: string;
let root: string;
let elsewhere: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "arbab-sessions-")));
  home = join(dir, "arbab-home");
  root = join(dir, "repo");
  elsewhere = join(dir, "other-project");
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "dist", "arbab.mjs"), "");
  mkdirSync(elsewhere);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const shepherd = (pid: number, owner: string | null, over: Partial<ShepherdEntry> = {}): void =>
  registerShepherd(home, { pid, lane: `lane-${pid}`, project: root, owner, startedAt: AT, ...over });
const waiter = (pid: number, owner: string | null, over: Partial<WaiterEntry> = {}): void =>
  registerWaiter(home, { pid, project: root, owner, startedAt: AT, ...over });

const everyoneAlive = (): boolean => true;
const sessions = (over: { session?: string | null; changed?: string[]; alive?: (pid: number) => boolean } = {}): SessionActivity[] =>
  otherSessions({ home, projectRoot: root, session: ME, alive: everyoneAlive, changed: [], ...over });

const activity = (owner: string | null, over: Partial<SessionActivity> = {}): SessionActivity => ({
  owner,
  lanes: [],
  waiters: 0,
  runnerProjects: [],
  runnersChanged: [],
  ...over,
});

describe("otherSessions", () => {
  it("is empty without registries or when nothing counts", () => {
    expect(sessions()).toEqual([]);
    shepherd(10, ME);
    waiter(11, ME);
    expect(sessions()).toEqual([]);
  });

  it("ignores this session's entries and counts another session's shepherds and waiters in this project", () => {
    shepherd(10, ME);
    waiter(11, ME);
    shepherd(20, OTHER, { lane: "zeta" });
    shepherd(21, OTHER, { lane: "alpha" });
    waiter(22, OTHER);
    waiter(23, OTHER);
    expect(sessions()).toEqual([activity(OTHER, { lanes: ["alpha", "zeta"], waiters: 2 })]);
  });

  it("matches the project by its real path", () => {
    symlinkSync(root, join(dir, "repo-link"));
    shepherd(20, OTHER, { project: join(dir, "repo-link") });
    expect(sessions()).toEqual([activity(OTHER, { lanes: ["lane-20"] })]);
    expect(otherSessions({ home, projectRoot: join(dir, "repo-link"), session: ME, alive: everyoneAlive, changed: [] })).toEqual([
      activity(OTHER, { lanes: ["lane-20"] }),
    ]);
  });

  it("matches a project and a runner recorded in another spelling of case", () => {
    // On a case-insensitive file system realpath gives the spelling on disk; elsewhere the path does not resolve
    // and is folded as given. Either way the entry counts.
    shepherd(20, OTHER, { project: join(dir, "REPO") });
    waiter(21, OTHER, { project: join(dir, "Repo") });
    shepherd(30, THIRD, { project: elsewhere, runner: join(dir, "Repo", "DIST", "Arbab.mjs") });
    expect(sessions({ changed: ["dist/arbab.mjs"] })).toEqual([
      activity(OTHER, { lanes: ["lane-20"], waiters: 1 }),
      activity(THIRD, { runnerProjects: [elsewhere], runnersChanged: ["dist/arbab.mjs"] }),
    ]);
    // A name that only starts like the project's is another project.
    shepherd(40, OTHER, { project: join(dir, "REPO-old") });
    expect(sessions()).toEqual([activity(OTHER, { lanes: ["lane-20"], waiters: 1 })]);
  });

  it("counts an entry of another project running this project's runner only when the landing changes it", () => {
    const runner = join(root, "dist", "arbab.mjs");
    shepherd(30, OTHER, { project: elsewhere, lane: "theirs", runner });
    waiter(31, OTHER, { project: elsewhere, runner });
    expect(sessions({ changed: ["src/cli.ts"] })).toEqual([]);
    expect(sessions({ changed: ["src/cli.ts", "dist/arbab.mjs"] })).toEqual([
      activity(OTHER, { runnerProjects: [elsewhere], runnersChanged: ["dist/arbab.mjs"] }),
    ]);
  });

  it("reads changed paths from their base when the project is a subdirectory of it, reporting them from the project", () => {
    const top = join(dir, "mono");
    const app = join(top, "app");
    mkdirSync(join(app, "dist"), { recursive: true });
    writeFileSync(join(app, "dist", "arbab.mjs"), "");
    registerShepherd(home, { pid: 30, lane: "theirs", project: elsewhere, owner: OTHER, startedAt: AT, runner: join(app, "dist", "arbab.mjs") });
    const from = (changed: string[], changedBase?: string): SessionActivity[] =>
      otherSessions({ home, projectRoot: app, session: ME, alive: everyoneAlive, changed, ...(changedBase !== undefined && { changedBase }) });
    expect(from(["app/dist/arbab.mjs", "lib/x.ts"], top)).toEqual([activity(OTHER, { runnerProjects: [elsewhere], runnersChanged: ["dist/arbab.mjs"] })]);
    // A path of the repository outside the project is none of its runners, even one spelled like it.
    expect(from(["dist/arbab.mjs"], top)).toEqual([]);
    expect(from(["dist/arbab.mjs"])).toEqual([activity(OTHER, { runnerProjects: [elsewhere], runnersChanged: ["dist/arbab.mjs"] })]);
  });

  it("resolves the runner through symlinks and ignores one outside this project", () => {
    symlinkSync(join(root, "dist", "arbab.mjs"), join(elsewhere, "arbab.mjs"));
    shepherd(30, OTHER, { project: elsewhere, runner: join(elsewhere, "arbab.mjs") });
    writeFileSync(join(elsewhere, "own.mjs"), "");
    shepherd(31, THIRD, { project: elsewhere, runner: join(elsewhere, "own.mjs") });
    expect(sessions({ changed: ["dist/arbab.mjs", "../other-project/own.mjs", "own.mjs"] })).toEqual([
      activity(OTHER, { runnerProjects: [elsewhere], runnersChanged: ["dist/arbab.mjs"] }),
    ]);
  });

  it("compares a runner that cannot be resolved as given", () => {
    shepherd(30, OTHER, { project: elsewhere, runner: join(root, "dist", "gone.mjs") });
    expect(sessions({ changed: ["dist/gone.mjs"] })).toEqual([
      activity(OTHER, { runnerProjects: [elsewhere], runnersChanged: ["dist/gone.mjs"] }),
    ]);
  });

  it("still counts an entry without a runner (the 0.2.0 format) by its project", () => {
    shepherd(20, OTHER);
    waiter(21, OTHER);
    shepherd(22, THIRD, { project: elsewhere });
    expect(sessions({ changed: ["dist/arbab.mjs"] })).toEqual([activity(OTHER, { lanes: ["lane-20"], waiters: 1 })]);
  });

  it("names a lane in this project, not a runner change, for an entry of this project running its own runner", () => {
    shepherd(20, OTHER, { runner: join(root, "dist", "arbab.mjs") });
    expect(sessions({ changed: ["dist/arbab.mjs"] })).toEqual([activity(OTHER, { lanes: ["lane-20"] })]);
  });

  it("ignores dead pids", () => {
    shepherd(20, OTHER);
    waiter(21, OTHER);
    shepherd(30, THIRD, { project: elsewhere, runner: join(root, "dist", "arbab.mjs") });
    // Listing removes the entries of dead pids, so the partly dead registry is read first.
    expect(sessions({ alive: (pid) => pid === 21, changed: ["dist/arbab.mjs"] })).toEqual([activity(OTHER, { waiters: 1 })]);
    expect(sessions({ alive: () => false, changed: ["dist/arbab.mjs"] })).toEqual([]);
  });

  it("counts every entry when this session is null, and sorts by owner with null last", () => {
    shepherd(10, ME);
    shepherd(20, null);
    waiter(21, null);
    shepherd(30, OTHER);
    expect(sessions({ session: null })).toEqual([
      activity(ME, { lanes: ["lane-10"] }),
      activity(OTHER, { lanes: ["lane-30"] }),
      activity(null, { lanes: ["lane-20"], waiters: 1 }),
    ]);
    // Processes started outside Claude Code are never this session's.
    expect(sessions()).toEqual([activity(OTHER, { lanes: ["lane-30"] }), activity(null, { lanes: ["lane-20"], waiters: 1 })]);
  });

  it("lists each other project and runner once, sorted", () => {
    const second = join(dir, "another");
    mkdirSync(second);
    writeFileSync(join(root, "dist", "hook.mjs"), "");
    shepherd(30, OTHER, { project: second, runner: join(root, "dist", "hook.mjs") });
    shepherd(31, OTHER, { project: elsewhere, runner: join(root, "dist", "arbab.mjs") });
    waiter(32, OTHER, { project: elsewhere, runner: join(root, "dist", "arbab.mjs") });
    expect(sessions({ changed: ["dist/arbab.mjs", "dist/hook.mjs"] })).toEqual([
      activity(OTHER, { runnerProjects: [second, elsewhere], runnersChanged: ["dist/arbab.mjs", "dist/hook.mjs"] }),
    ]);
  });

  it("uses the injected realpath", () => {
    shepherd(20, OTHER, { project: "/virtual/repo" });
    const realpath = (p: string): string => (p === "/virtual/repo" ? root : realpathSync(p));
    expect(otherSessions({ home, projectRoot: root, session: ME, alive: everyoneAlive, changed: [], realpath })).toEqual([
      activity(OTHER, { lanes: ["lane-20"] }),
    ]);
  });
});

describe("runnerPath", () => {
  it("resolves a path, and returns one that cannot be resolved as given", () => {
    symlinkSync(join(root, "dist", "arbab.mjs"), join(dir, "link.mjs"));
    expect(runnerPath(join(dir, "link.mjs"))).toBe(join(root, "dist", "arbab.mjs"));
    expect(runnerPath(join(dir, "missing.mjs"))).toBe(join(dir, "missing.mjs"));
    expect(runnerPath("x", () => "/real/x")).toBe("/real/x");
  });
});

describe("sessionId and sessionText", () => {
  it("ids a session by the first 8 characters of its owner, or as outside", () => {
    expect(sessionId(activity(OTHER))).toBe("session:bbbbbbbb");
    expect(sessionId(activity(null))).toBe("session:outside");
  });

  it("names the lanes and waiters in this project", () => {
    expect(sessionText(activity(OTHER, { lanes: ["a", "b"], waiters: 2 }))).toBe(
      "Session bbbbbbbb runs lanes a, b and 2 waiters in this project, whose base this landing moves. " +
        "Tell them before landing: Claude Code's ListAgents lists sessions by name and SendMessage reaches them.",
    );
    expect(sessionText(activity(OTHER, { waiters: 1 }))).toMatch(/^Session bbbbbbbb runs a waiter in this project,/);
    expect(sessionText(activity(null, { lanes: ["a"] }))).toMatch(/^Processes started outside Claude Code run lane a in this project,/);
  });

  it("names the runner files and the projects that run them", () => {
    expect(
      sessionText(activity(OTHER, { lanes: ["a"], runnerProjects: ["/work/x", "/work/y"], runnersChanged: ["dist/arbab.mjs"] })),
    ).toBe(
      "Session bbbbbbbb runs lane a in this project, whose base this landing moves, and runs this project's " +
        "dist/arbab.mjs in /work/x, /work/y, which this landing replaces. " +
        "Tell them before landing: Claude Code's ListAgents lists sessions by name and SendMessage reaches them.",
    );
  });
});
