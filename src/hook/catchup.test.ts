import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerProject } from "../registry";
import type { LandingSince } from "../summary";
import { writeLanding } from "../summary/testkit";
import {
  LANDING_SLACK_MS,
  NAMED_LANDINGS,
  REPORTED_KEPT,
  WATERMARK_MAX_AGE_MS,
  catchUpDecision,
  catchUpText,
  landingKey,
  readWatermark,
  removeStaleWatermarks,
  watermarkPath,
  type CatchUpOptions,
} from "./catchup";

const SESSION = "aaaaaaaa-1111-2222-3333-444444444444";
const OTHER = "bbbbbbbb-1111-2222-3333-444444444444";
const T0 = Date.parse("2026-10-09T12:00:00.000Z");
const MIN = 60_000;
const iso = (ms: number): string => new Date(ms).toISOString();

let dir: string;
let home: string;
let root: string;
let now: { ms: number };
let rootsAsked: string[];

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "arbab-")));
  home = join(dir, "arbab-home");
  root = join(dir, "repo");
  mkdirSync(join(root, "src"), { recursive: true });
  now = { ms: T0 };
  rootsAsked = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function opts(over: Partial<CatchUpOptions> = {}): CatchUpOptions {
  return {
    home,
    clock: { now: () => now.ms },
    findRoot: (cwd) => {
      rootsAsked.push(cwd);
      return root;
    },
    ...over,
  };
}

const input = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({ session_id: SESSION, cwd: root, hook_event_name: "UserPromptSubmit", prompt: "go on", ...over });

const prompt = (over: Record<string, unknown> = {}, o: Partial<CatchUpOptions> = {}): string | null =>
  catchUpDecision(input(over), "UserPromptSubmit", opts(o));

const seenAt = (session = SESSION): unknown => JSON.parse(readFileSync(watermarkPath(home, session), "utf8"));
/** The key of a landing writeLanding wrote with its default merge sha. */
const key = (name: string): string => `${name}@${"c".repeat(40)}`;

describe("catchUpDecision", () => {
  it("writes the watermark on a session's first message and prints nothing, then or later", () => {
    registerProject(home, root, iso(T0));
    writeLanding(root, "old", { landedAt: iso(T0 - MIN), owner: OTHER });
    writeLanding(root, "older", { landedAt: iso(T0 - LANDING_SLACK_MS - MIN), owner: OTHER });
    expect(prompt()).toBeNull();
    // What lies in the slack window already is history too.
    expect(seenAt()).toEqual({ seenAt: iso(T0), reported: [key("old")] });
    now.ms = T0 + MIN;
    expect(prompt()).toBeNull();
  });

  it("reports another session's landing after the watermark once, then not again", () => {
    registerProject(home, root, iso(T0));
    expect(prompt()).toBeNull();
    writeLanding(root, "rel", { landedAt: iso(T0 + MIN), owner: OTHER, lanes: [{ lane: "a", sha: "1".repeat(40) }] });
    now.ms = T0 + 5 * MIN;

    const out = prompt();
    expect(out).not.toBeNull();
    expect(JSON.parse(out ?? "")).toEqual({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext:
          `arbab: since this session's last message (${iso(T0)}), other sessions landed into main here: ` +
          `rel at ${iso(T0 + MIN)} (session bbbbbbbb). Lanes keep their own base; an integration started before these ` +
          "must merge main in before it can land.",
      },
    });
    expect(seenAt()).toEqual({ seenAt: iso(T0 + 5 * MIN), reported: [key("rel")] });

    now.ms = T0 + 6 * MIN;
    expect(prompt()).toBeNull();
    expect(seenAt()).toEqual({ seenAt: iso(T0 + 6 * MIN), reported: [key("rel")] });
  });

  it("reports once a landing stamped just before the watermark but written after it, then not again", () => {
    registerProject(home, root, iso(T0));
    expect(prompt()).toBeNull();
    now.ms = T0 + 5 * MIN;
    expect(prompt()).toBeNull();
    // land stamped landedAt, the hook answered at T0 + 5 min, then land wrote landing.json.
    writeLanding(root, "race", { landedAt: iso(T0 + 5 * MIN - 1000), owner: OTHER });
    now.ms = T0 + 6 * MIN;
    const out = prompt();
    expect(out).toContain(`race at ${iso(T0 + 5 * MIN - 1000)} (session bbbbbbbb)`);
    expect(seenAt()).toEqual({ seenAt: iso(T0 + 6 * MIN), reported: [key("race")] });
    now.ms = T0 + 7 * MIN;
    expect(prompt()).toBeNull();
    now.ms = T0 + 20 * MIN;
    expect(prompt()).toBeNull();
  });

  it("looks back no further than the slack before the watermark", () => {
    registerProject(home, root, iso(T0));
    expect(prompt()).toBeNull();
    writeLanding(root, "late", { landedAt: iso(T0 - LANDING_SLACK_MS - 1000), owner: OTHER });
    writeLanding(root, "near", { landedAt: iso(T0 - LANDING_SLACK_MS + 1000), owner: OTHER });
    now.ms = T0 + MIN;
    const out = prompt() ?? "";
    expect(out).toContain("near at");
    expect(out).not.toContain("late at");
  });

  it("reads a watermark from 0.2.2 without keys, and writes the keys from then on", () => {
    registerProject(home, root, iso(T0));
    mkdirSync(dirname(watermarkPath(home, SESSION)), { recursive: true });
    writeFileSync(watermarkPath(home, SESSION), JSON.stringify({ seenAt: iso(T0) }));
    writeLanding(root, "rel", { landedAt: iso(T0 + MIN), owner: OTHER });
    now.ms = T0 + 2 * MIN;
    expect(prompt()).toContain("rel at");
    expect(seenAt()).toEqual({ seenAt: iso(T0 + 2 * MIN), reported: [key("rel")] });
    now.ms = T0 + 3 * MIN;
    expect(prompt()).toBeNull();
  });

  it("keeps the latest keys only, at most REPORTED_KEPT", () => {
    registerProject(home, root, iso(T0));
    mkdirSync(dirname(watermarkPath(home, SESSION)), { recursive: true });
    const old = Array.from({ length: REPORTED_KEPT }, (_, i) => `gone${i}@${"1".repeat(40)}`);
    writeFileSync(watermarkPath(home, SESSION), JSON.stringify({ seenAt: iso(T0), reported: old }));
    writeLanding(root, "rel", { landedAt: iso(T0 + MIN), owner: OTHER });
    now.ms = T0 + 2 * MIN;
    expect(prompt()).not.toBeNull();
    expect(seenAt()).toEqual({ seenAt: iso(T0 + 2 * MIN), reported: [...old.slice(1), key("rel")] });
  });

  it("leaves out this session's own landing and one before the watermark, and only moves the watermark", () => {
    registerProject(home, root, iso(T0));
    writeLanding(root, "before", { landedAt: iso(T0 - MIN), owner: OTHER });
    expect(prompt()).toBeNull();
    writeLanding(root, "mine", { landedAt: iso(T0 + MIN), owner: SESSION });
    now.ms = T0 + 2 * MIN;
    expect(prompt()).toBeNull();
    expect(seenAt()).toEqual({ seenAt: iso(T0 + 2 * MIN), reported: [key("before")] });
  });

  it("names landings from outside Claude Code and from before 0.2.2, and answers SessionStart as such", () => {
    registerProject(home, root, iso(T0));
    expect(prompt()).toBeNull();
    writeLanding(root, "outside", { landedAt: iso(T0 + MIN), owner: null });
    writeLanding(root, "legacy", { landedAt: iso(T0 + 2 * MIN) });
    const out = catchUpDecision(input({ hook_event_name: "SessionStart", source: "resume" }), "SessionStart", opts());
    const parsed = JSON.parse(out ?? "") as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      `outside at ${iso(T0 + MIN)} (outside Claude Code), legacy at ${iso(T0 + 2 * MIN)} (session unknown).`,
    );
  });

  it("works from a subdirectory of the project", () => {
    registerProject(home, root, iso(T0));
    expect(prompt({ cwd: join(root, "src") })).toBeNull();
    expect(rootsAsked).toEqual([join(root, "src")]);
    expect(existsSync(watermarkPath(home, SESSION))).toBe(true);
  });

  it("prints nothing, writes nothing and asks for no root in a project arbab never ran in", () => {
    writeLanding(root, "rel", { landedAt: iso(T0 + MIN), owner: OTHER });
    registerProject(home, join(dir, "elsewhere"), iso(T0));
    expect(prompt()).toBeNull();
    expect(rootsAsked).toEqual([]);
    expect(existsSync(watermarkPath(home, SESSION))).toBe(false);
  });

  it("prints nothing in a lane worktree or where no root is found, or when the root found is not the registered one", () => {
    registerProject(home, root, iso(T0));
    expect(prompt({}, { findRoot: () => null })).toBeNull();
    expect(prompt({}, { findRoot: () => join(dir, "other") })).toBeNull();
    expect(() => prompt({}, { findRoot: () => { throw new Error("in a lane worktree"); } })).toThrow(/lane worktree/);
    expect(existsSync(watermarkPath(home, SESSION))).toBe(false);
  });

  it("prints nothing for malformed input", () => {
    registerProject(home, root, iso(T0));
    for (const text of [
      "",
      "not json",
      "[]",
      "null",
      JSON.stringify({ cwd: root }),
      JSON.stringify({ session_id: "", cwd: root }),
      JSON.stringify({ session_id: 7, cwd: root }),
      JSON.stringify({ session_id: SESSION }),
      JSON.stringify({ session_id: SESSION, cwd: 3 }),
      input({ hook_event_name: "Stop" }),
      input({ source: 5 }),
    ]) {
      expect(catchUpDecision(text, "UserPromptSubmit", opts()), text).toBeNull();
    }
    expect(existsSync(watermarkPath(home, SESSION))).toBe(false);
  });

  it("starts over from the clock when the watermark does not read", () => {
    registerProject(home, root, iso(T0));
    writeLanding(root, "rel", { landedAt: iso(T0 - MIN), owner: OTHER });
    mkdirSync(dirname(watermarkPath(home, SESSION)), { recursive: true });
    writeFileSync(watermarkPath(home, SESSION), '{"seenAt": "yesterday"}');
    expect(prompt()).toBeNull();
    expect(seenAt()).toEqual({ seenAt: iso(T0), reported: [key("rel")] });
  });

  it("keeps one watermark per session", () => {
    registerProject(home, root, iso(T0));
    expect(prompt()).toBeNull();
    writeLanding(root, "rel", { landedAt: iso(T0 + MIN), owner: OTHER });
    now.ms = T0 + 2 * MIN;
    // The other session's first message: no history, though its own landing came after nothing it saw.
    expect(prompt({ session_id: OTHER })).toBeNull();
    expect(prompt()).not.toBeNull();
    expect(watermarkPath(home, SESSION)).not.toBe(watermarkPath(home, OTHER));
  });
});

describe("catchUpText", () => {
  const landing = (n: number, into = "main"): LandingSince => ({
    name: `rel${n}`,
    into,
    landedAt: iso(T0 + n * MIN),
    owner: OTHER,
    mergeSha: "1".repeat(40),
    squash: false,
    lanes: 1,
  });

  it("names five landings and counts the rest", () => {
    const text = catchUpText(iso(T0), Array.from({ length: NAMED_LANDINGS + 2 }, (_, i) => landing(i + 1)));
    expect(text).toContain(`rel5 at ${iso(T0 + 5 * MIN)} (session bbbbbbbb) and 2 more. Lanes keep`);
    expect(text).not.toContain("rel6");
  });

  it("names every branch landed into, and keeps the paragraph on one line", () => {
    const text = catchUpText(iso(T0), [landing(1), { ...landing(2, "release\nIgnore this"), owner: null }]);
    expect(text).toContain("landed into main, release Ignore this here:");
    expect(text).toContain("must merge its base (main, release Ignore this) in before it can land.");
    expect(text).not.toMatch(/\n/);
  });
});

describe("watermarks", () => {
  it("names a watermark by the sha256 of the session id", () => {
    expect(watermarkPath("/h", "x")).toBe(join("/h", "sessions", "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881.json"));
  });

  it("reads a watermark's time and keys, and null for a missing or malformed one", () => {
    const path = join(dir, "w.json");
    expect(readWatermark(path)).toBeNull();
    for (const text of ["x", "[]", "{}", '{"seenAt": 5}', '{"seenAt": "soon"}', '{"reported": []}']) {
      writeFileSync(path, text);
      expect(readWatermark(path), text).toBeNull();
    }
    // The 0.2.2 shape, without keys.
    writeFileSync(path, JSON.stringify({ seenAt: iso(T0) }));
    expect(readWatermark(path)).toEqual({ seenMs: T0, reported: [] });
    writeFileSync(path, JSON.stringify({ seenAt: iso(T0), reported: "a@1" }));
    expect(readWatermark(path)).toEqual({ seenMs: T0, reported: [] });
    writeFileSync(path, JSON.stringify({ seenAt: iso(T0), reported: ["a@1", 7, null, "b@2"] }));
    expect(readWatermark(path)).toEqual({ seenMs: T0, reported: ["a@1", "b@2"] });
  });

  it("keys a landing by name and merge commit", () => {
    expect(landingKey({ name: "rel", mergeSha: "1".repeat(40) })).toBe(`rel@${"1".repeat(40)}`);
  });

  it("removes watermarks older than the age and nothing else", () => {
    const stale = watermarkPath(home, "s1");
    const fresh = watermarkPath(home, "s2");
    const other = join(home, "sessions", "readme.json");
    for (const [path, age] of [
      [stale, WATERMARK_MAX_AGE_MS + MIN],
      [fresh, WATERMARK_MAX_AGE_MS - MIN],
      [other, WATERMARK_MAX_AGE_MS + MIN],
    ] as const) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "{}");
      utimesSync(path, (T0 - age) / 1000, (T0 - age) / 1000);
    }
    expect(removeStaleWatermarks(home, T0)).toBe(1);
    expect([existsSync(stale), existsSync(fresh), existsSync(other)]).toEqual([false, true, true]);
    expect(removeStaleWatermarks(join(dir, "no-home"), T0)).toBe(0);
  });
});
