import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeLaneRun } from "../commands/testkit";
import { integrationDir, writeIntegration, writeLanding } from "./testkit";
import { formatWorktrees, integrationOfWorktree, readLastSweep, recordsIdleSince, unusedText, worktreeOverview } from "./worktrees";

const NOW_MS = Date.parse("2026-10-09T12:00:00.000Z");
const DAY = 86_400_000;
const LIVE = 5000;

let root: string;
let runsRoot: string;
let worktreeRoot: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "arbab-")));
  runsRoot = join(root, ".arbab", "runs");
  worktreeRoot = join(root, ".arbab", "worktrees");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const ago = (days: number): string => new Date(NOW_MS - days * DAY).toISOString();

function age(path: string, days: number): void {
  const sec = (NOW_MS - days * DAY) / 1000;
  utimesSync(path, sec, sec);
}

const overview = (idleDays = 3): ReturnType<typeof worktreeOverview> =>
  worktreeOverview({ project: { root, config: { worktrees: { idleDays } }, runsRoot, worktreeRoot }, alive: (pid) => pid === LIVE, nowMs: NOW_MS });

describe("recordsIdleSince", () => {
  it("is the newest mtime of the files directly in the directory, ignoring subdirectories", () => {
    const dir = join(root, "records");
    mkdirSync(join(dir, "lanes"), { recursive: true });
    writeFileSync(join(dir, "integration.json"), "{}");
    writeFileSync(join(dir, "verify.json"), "{}");
    writeFileSync(join(dir, "lanes", "x.json"), "{}");
    age(join(dir, "integration.json"), 10);
    age(join(dir, "verify.json"), 4);
    age(join(dir, "lanes", "x.json"), 0);
    expect(recordsIdleSince(dir)).toBe(NOW_MS - 4 * DAY);
  });

  it("is null for a missing directory or one without files", () => {
    expect(recordsIdleSince(join(root, "none"))).toBeNull();
    mkdirSync(join(root, "empty", "sub"), { recursive: true });
    expect(recordsIdleSince(join(root, "empty"))).toBeNull();
  });
});

describe("integrationOfWorktree", () => {
  it("names the integration of an integrate-<name> directory only", () => {
    expect(integrationOfWorktree("integrate-rel")).toBe("rel");
    expect(integrationOfWorktree("rel")).toBeNull();
    expect(integrationOfWorktree("integrate-")).toBeNull();
    expect(integrationOfWorktree("integrate-Bad Name")).toBeNull();
  });
});

describe("readLastSweep", () => {
  it("reads startedAt, finishedAt and the number removed, and refuses what does not fit", () => {
    expect(readLastSweep(root)).toBeNull();
    mkdirSync(join(root, ".arbab"), { recursive: true });
    const file = join(root, ".arbab", "sweep.json");
    writeFileSync(file, JSON.stringify({ startedAt: "s", finishedAt: null, idleDays: 3, removed: [{}, {}], kept: 0, warnings: [] }));
    expect(readLastSweep(root)).toEqual({ startedAt: "s", finishedAt: null, removed: 2 });
    for (const text of ["{", "[]", JSON.stringify({ startedAt: 1, finishedAt: null, removed: [] }), JSON.stringify({ startedAt: "s", finishedAt: 2, removed: [] })]) {
      writeFileSync(file, text);
      expect(readLastSweep(root), text).toBeNull();
    }
  });
});

describe("worktreeOverview", () => {
  it("counts every directory, and as idle the old finished lanes and unlanded integrations unused that long", () => {
    for (const dir of ["old", "young", "running", "dead", "nostate", "torn", "integrate-wip", "integrate-busy", "integrate-done", "integrate-none"]) {
      mkdirSync(join(worktreeRoot, dir), { recursive: true });
    }
    writeFileSync(join(worktreeRoot, "file"), "");
    writeLaneRun(runsRoot, "old", { state: "finished", since: ago(10) });
    writeLaneRun(runsRoot, "young", { state: "finished", since: ago(2) });
    writeLaneRun(runsRoot, "running", { state: "running", shepherdPid: LIVE, since: ago(10) });
    // A dead shepherd: orphaned, not finished.
    writeLaneRun(runsRoot, "dead", { state: "running", shepherdPid: 31337, since: ago(10) });
    mkdirSync(join(runsRoot, "torn"), { recursive: true });
    writeFileSync(join(runsRoot, "torn", "state.json"), "{");
    writeIntegration(root, "wip");
    age(join(integrationDir(root, "wip"), "integration.json"), 10);
    writeIntegration(root, "busy");
    age(join(integrationDir(root, "busy"), "integration.json"), 1);
    writeIntegration(root, "done");
    writeLanding(root, "done");
    for (const file of ["integration.json", "landing.json"]) age(join(integrationDir(root, "done"), file), 10);

    expect(overview()).toEqual({ total: 10, idle: 2, idleDays: 3, lastSweep: null });
    // Older than 0 days: every finished lane and every unlanded integration with records.
    expect(overview(0).idle).toBe(4);
  });

  it("is all zero without a worktree root, and an unparsable since is never idle", () => {
    expect(overview()).toEqual({ total: 0, idle: 0, idleDays: 3, lastSweep: null });
    mkdirSync(join(worktreeRoot, "odd"), { recursive: true });
    writeLaneRun(runsRoot, "odd", { state: "finished", since: "yesterday" });
    expect(overview().idle).toBe(0);
  });
});

describe("formatWorktrees", () => {
  it("gives the count, the unused ones and the last sweep", () => {
    expect(formatWorktrees({ total: 9, idle: 4, idleDays: 7, lastSweep: null })).toBe("worktrees: 9 (4 unused for 7+ days)");
    expect(formatWorktrees({ total: 9, idle: 4, idleDays: 7, lastSweep: { startedAt: "2026-10-09T10:00:00.000Z", finishedAt: "2026-10-09T10:00:01.000Z", removed: 3 } })).toBe(
      "worktrees: 9 (4 unused for 7+ days); last sweep 2026-10-09T10:00:00Z: removed 3",
    );
    expect(formatWorktrees({ total: 2, idle: 0, idleDays: 0, lastSweep: { startedAt: "2026-10-09T10:00:00.000Z", finishedAt: null, removed: 0 } })).toBe(
      "worktrees: 2 (automatic sweep off); last sweep 2026-10-09T10:00:00Z: removed 0, unfinished",
    );
    expect(unusedText(1, 3)).toBe("1 unused for 3+ days");
  });
});
