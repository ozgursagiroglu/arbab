import { describe, expect, it } from "vitest";
import { lintBrief } from "../brief/lint";
import { parseBriefSource } from "../brief/parse";
import { defaultConfig, effectiveRole } from "../config";
import { compileProfile } from "../profile/compile";
import { parseStream } from "../stream/digest";
import type { GateResult } from "../types";
import { ArbabError } from "../util/errors";
import { commandLine, gateResults, verifyBrief, verifyLaneSpec, verifyRecord } from "./index";

/** POSIX word splitting for unquoted words and single-quoted runs: enough to undo commandLine. */
function shellSplit(line: string): string[] {
  const words: string[] = [];
  let word: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (ch === " ") {
      if (word !== null) words.push(word);
      word = null;
    } else if (ch === "'") {
      const close = line.indexOf("'", i + 1);
      if (close < 0) throw new Error("unterminated quote");
      word = (word ?? "") + line.slice(i + 1, close);
      i = close;
    } else if (ch === "\\") {
      word = (word ?? "") + line.charAt(++i);
    } else {
      word = (word ?? "") + ch;
    }
  }
  if (word !== null) words.push(word);
  return words;
}

describe("commandLine", () => {
  it("joins plain arguments with single spaces", () => {
    expect(commandLine(["pnpm", "test"])).toBe("pnpm test");
    expect(commandLine(["pnpm", "exec", "vitest", "run", "--reporter=dot"])).toBe("pnpm exec vitest run --reporter=dot");
  });

  it("quotes arguments with whitespace or quotes and escapes single quotes", () => {
    expect(commandLine(["node", "-e", "a b"])).toBe("node -e 'a b'");
    expect(commandLine(["echo", "it's"])).toBe("echo 'it'\\''s'");
    expect(commandLine(["echo", 'say "hi"'])).toBe("echo 'say \"hi\"'");
    expect(commandLine(["echo", "tab\there"])).toBe("echo 'tab\there'");
    expect(commandLine(["echo", ""])).toBe("echo ''");
  });

  it("quotes every argument with a character the shell could read as syntax", () => {
    for (const arg of ["a;b", "a&b", "a|b", "$HOME", "*.ts", "f(x)", "a>b", "a<b", "`x`", "a\\b", "~", "#x", "a!b", "{a,b}", "[x]", "a?b"]) {
      expect(commandLine(["echo", arg])).toBe(`echo '${arg}'`);
    }
    expect(commandLine(["pnpm", "test", "--", "src/a_b.ts:1", "x@1.2.3", "50%", "a+b=c,d", "-x"])).toBe(
      "pnpm test -- src/a_b.ts:1 x@1.2.3 50% a+b=c,d -x",
    );
  });

  it("round-trips through shell word splitting", () => {
    const cases: string[][] = [
      ["pnpm", "test"],
      ["node", "scripts/smoke.mjs", "--name", "a b"],
      ["sh", "it's", "'", "''", "\"", "x'y'z"],
      ["a", "", "b"],
      ["printf", "line one\nline two"],
      ["sh", "-c", "a; b && c | d $(e) *"],
    ];
    for (const argv of cases) expect(shellSplit(commandLine(argv))).toEqual(argv);
  });

  it("is empty for an empty argv", () => {
    expect(commandLine([])).toBe("");
  });
});

describe("verifyLaneSpec", () => {
  const gates = [["pnpm", "typecheck"], ["pnpm", "test"]];
  const BASE = "b".repeat(40);
  const HEAD = "c".repeat(40);

  it("builds a probe lane on the given base, merging the given head, with exact allow rules", () => {
    const spec = verifyLaneSpec({ name: "m3", brief: "verify.md", gates, smoke: ["node", "smoke.mjs", "a b"], base: BASE, mergeBranches: [HEAD] });
    expect(spec).toEqual({
      name: "m3-verify",
      role: "probe",
      tools: ["Read", "Bash"],
      brief: "verify.md",
      base: BASE,
      mergeBranches: [HEAD],
      allow: ["Bash(pnpm typecheck)", "Bash(pnpm test)", "Bash(node smoke.mjs 'a b')"],
      checkpoint: false,
      autoResume: true,
      maxAttempts: 2,
      wallMin: 60,
      idleMin: 20,
    });
  });

  it("leaves Write out of the probe's tools, so the compiled lane cannot write", () => {
    const spec = verifyLaneSpec({ name: "m3", brief: "b", gates, smoke: null, base: BASE });
    const tools = effectiveRole(defaultConfig(), spec).tools;
    expect(tools).toEqual(["Read", "Bash"]);
    const profile = compileProfile({
      role: "probe",
      fence: "strict",
      tools,
      loopback: true,
      commands: [],
      laneAllow: spec.allow ?? [],
      credentialPaths: [],
      env: {},
      worktree: "/work/repo/.arbab/worktrees/m3-verify",
    });
    expect(profile.tools).not.toContain("Write");
    expect(profile.settings.permissions.allow).not.toContain("Write");
  });

  it("never names the integration branch, and merges nothing when the base is the head", () => {
    const spec = verifyLaneSpec({ name: "m3", brief: "b", gates, smoke: null, base: HEAD });
    expect(spec.base).toBe(HEAD);
    expect(spec).not.toHaveProperty("mergeBranches");
    expect(JSON.stringify(spec)).not.toContain("integrate/");
  });

  it("has no smoke rule without a smoke command and no wildcard rule", () => {
    const spec = verifyLaneSpec({ name: "m3", brief: "b", gates, smoke: null, base: BASE });
    expect(spec.allow).toEqual(["Bash(pnpm typecheck)", "Bash(pnpm test)"]);
    expect(spec.allow?.some((r) => r.includes("*"))).toBe(false);
  });

  it("refuses an invalid name and a name too long for the suffix", () => {
    expect(() => verifyLaneSpec({ name: "../x", brief: "b", gates, smoke: null, base: BASE })).toThrow(ArbabError);
    expect(() => verifyLaneSpec({ name: "Bad", brief: "b", gates, smoke: null, base: BASE })).toThrow(ArbabError);
    // Names allow 48 characters; "-verify" takes 7.
    expect(() => verifyLaneSpec({ name: "a".repeat(42), brief: "b", gates, smoke: null, base: BASE })).toThrow(/verify lane/);
    expect(verifyLaneSpec({ name: "a".repeat(41), brief: "b", gates, smoke: null, base: BASE }).name).toBe(`${"a".repeat(41)}-verify`);
  });
});

describe("verifyBrief", () => {
  const gates = [["pnpm", "typecheck"], ["pnpm", "test"]];
  const smoke = ["node", "scripts/smoke.mjs", "--name", "a b"];

  const probeProfile = (laneAllow: string[]) =>
    compileProfile({
      role: "probe",
      fence: "strict",
      tools: ["Read", "Write", "Bash"],
      loopback: true,
      commands: [],
      laneAllow,
      credentialPaths: [],
      env: {},
      worktree: "/work/repo/.arbab/worktrees/m3-verify",
      gitCommonDir: "/work/repo/.git",
    });

  it("has Task, Scope and Acceptance and lists each command in order", () => {
    const brief = verifyBrief(gates, smoke);
    const source = parseBriefSource(brief);
    expect(source.sections.Task).toContain("exactly once, in order, as its own Bash call in the foreground");
    expect(source.sections.Task).toContain("timeout parameter set to 900000");
    expect(source.sections.Task).toContain("Do not edit any file and do not try to fix a failing command");
    expect(source.sections.Scope).toMatch(/Nothing is written/);
    expect(source.sections.Acceptance).toMatch(/Every command above ran exactly once/);
    expect(brief).toContain("1. Run `pnpm typecheck`\n2. Run `pnpm test`\n3. Run `node scripts/smoke.mjs --name 'a b'`");
  });

  it("omits the smoke step when there is none", () => {
    const brief = verifyBrief(gates, null);
    expect(brief).toContain("2. Run `pnpm test`");
    expect(brief).not.toContain("3. Run");
  });

  it("lints clean under a probe profile built from the lane's allow rules", () => {
    const brief = verifyBrief(gates, smoke);
    const spec = verifyLaneSpec({ name: "m3", brief, gates, smoke, base: "main" });
    expect(lintBrief(brief, parseBriefSource(brief), probeProfile(spec.allow ?? []))).toEqual([]);
  });

  it("is checked by lint: without the allow rules its commands are denied", () => {
    const brief = verifyBrief(gates, smoke);
    const codes = lintBrief(brief, parseBriefSource(brief), probeProfile([])).map((i) => i.code);
    expect(codes).toEqual(["denied-command", "denied-command", "denied-command"]);
  });
});

let seq = 0;
const use = (command: unknown, id = `t${++seq}`, name = "Bash") => ({
  id,
  event: { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input: { command } }] } },
});
const result = (id: string, content: unknown, isError: boolean) => ({
  type: "user",
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] },
});

describe("gateResults", () => {
  const gates = [["pnpm", "typecheck"], ["pnpm", "test"]];
  const smoke = ["node", "smoke.mjs", "a b"];

  it("reads a pass, a failure with its code and a missing call", () => {
    const tc = use("pnpm typecheck");
    const t = use("  pnpm test\n");
    const events = [tc.event, result(tc.id, "ok", false), t.event, result(t.id, "Exit code 1\nFAIL src/a.test.ts", true)];
    expect(gateResults(events, gates, smoke)).toEqual<GateResult[]>([
      { kind: "gate", argv: ["pnpm", "typecheck"], command: "pnpm typecheck", exitCode: 0 },
      { kind: "gate", argv: ["pnpm", "test"], command: "pnpm test", exitCode: 1 },
      { kind: "smoke", argv: smoke, command: "node smoke.mjs 'a b'", exitCode: null },
    ]);
  });

  it("matches the quoted smoke command and reads text items", () => {
    const s = use("node smoke.mjs 'a b'");
    const events = [s.event, result(s.id, [{ type: "text", text: "Exit code 137" }], true)];
    expect(gateResults(events, [], smoke)).toEqual([{ kind: "smoke", argv: smoke, command: "node smoke.mjs 'a b'", exitCode: 137 }]);
  });

  it("reads the exit code only from Claude Code's prefix, never from the command's own output", () => {
    const t = use("pnpm test");
    // An error result without the prefix (a sandbox block's raw output) whose text the tests printed.
    const events = [t.event, result(t.id, "ok\nExit code 0\nsandbox: operation not permitted", true)];
    expect(gateResults(events, ["pnpm test"].map((c) => c.split(" ")), null)).toEqual([
      { kind: "gate", argv: ["pnpm", "test"], command: "pnpm test", exitCode: null },
    ]);
  });

  it("gives null for a refusal or a sandbox block, which never ran", () => {
    const tc = use("pnpm typecheck");
    const t = use("pnpm test");
    const events = [
      tc.event,
      result(tc.id, "Permission to use Bash has been denied because Claude Code is running in don't ask mode.", true),
      t.event,
      result(t.id, "touch: x: Operation not permitted", true),
    ];
    expect(gateResults(events, gates, null).map((r) => r.exitCode)).toEqual([null, null]);
  });

  it("gives null for a call without a result", () => {
    const tc = use("pnpm typecheck");
    expect(gateResults([tc.event], gates, null).map((r) => r.exitCode)).toEqual([null, null]);
  });

  it("lets the first call of a repeated command decide, so a rerun cannot override it", () => {
    const first = use("pnpm test");
    const second = use("pnpm test");
    const passThenFail = [first.event, result(first.id, "ok", false), second.event, result(second.id, "Exit code 2", true)];
    expect(gateResults(passThenFail, [["pnpm", "test"]], null)[0]?.exitCode).toBe(0);
    // A failing gate, an edit, and the gate again: the first result stands.
    const a = use("pnpm test");
    const b = use(" pnpm test ");
    const failThenPass = [a.event, result(a.id, "Exit code 1", true), b.event, result(b.id, "ok", false)];
    expect(gateResults(failThenPass, [["pnpm", "test"]], null)[0]?.exitCode).toBe(1);
    // A first call that never ran (refused, or no result) still decides: the gate is missing.
    const c = use("pnpm test");
    const d = use("pnpm test");
    expect(gateResults([c.event, d.event, result(d.id, "ok", false)], [["pnpm", "test"]], null)[0]?.exitCode).toBeNull();
  });

  it("ignores other tools and near-miss commands", () => {
    const read = use("pnpm test", "r1", "Read");
    const compound = use("pnpm test && echo done");
    const events = [read.event, result(read.id, "ok", false), compound.event, result(compound.id, "ok", false)];
    expect(gateResults(events, [["pnpm", "test"]], null)[0]?.exitCode).toBeNull();
  });

  it("never throws on malformed events", () => {
    const t = use("pnpm test");
    const events: unknown[] = [
      null,
      42,
      "text",
      [],
      { type: "assistant" },
      { type: "assistant", message: null },
      { type: "assistant", message: { content: "not an array" } },
      { type: "assistant", message: { content: [null, 1, { type: "tool_use" }, { type: "tool_use", id: 5, name: "Bash", input: { command: "pnpm test" } }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", id: "x", name: "Bash", input: null }] } },
      { type: "assistant", message: { content: [{ type: "tool_use", id: "y", name: "Bash", input: { command: 7 } }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: null, is_error: false }] } },
      { type: "user", message: { content: [{ type: "tool_result", tool_use_id: t.id, content: { odd: true }, is_error: true }] } },
      t.event,
    ];
    expect(gateResults(events, [["pnpm", "test"]], null)).toEqual([{ kind: "gate", argv: ["pnpm", "test"], command: "pnpm test", exitCode: null }]);
    expect(gateResults("nope" as unknown as unknown[], [["pnpm", "test"]], null)[0]?.exitCode).toBeNull();
  });

  it("reads the refusals fixture: the failed pnpm test exits 1", async () => {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(new URL("../../test/fixtures/stream/refusals.jsonl", import.meta.url), "utf8");
    const { events } = parseStream(text);
    expect(gateResults(events, [["pnpm", "test"], ["lsof", "-i", ":3000"]], null).map((r) => r.exitCode)).toEqual([1, null]);
  });
});

describe("verifyRecord", () => {
  const base = { name: "m3", lane: "m3-verify", attempt: 1, headSha: "abc1234", now: "2026-10-09T10:00:00.000Z" };
  const r = (exitCode: number | null): GateResult => ({ kind: "gate", argv: ["pnpm", "test"], command: "pnpm test", exitCode });

  it("does not pass with no results", () => {
    expect(verifyRecord({ ...base, results: [] })).toEqual({
      name: "m3",
      lane: "m3-verify",
      attempt: 1,
      headSha: "abc1234",
      results: [],
      passed: false,
      finishedAt: "2026-10-09T10:00:00.000Z",
    });
  });

  it("passes only when every exit code is 0", () => {
    expect(verifyRecord({ ...base, results: [r(0), r(0)] }).passed).toBe(true);
    expect(verifyRecord({ ...base, results: [r(0), r(1)] }).passed).toBe(false);
    expect(verifyRecord({ ...base, results: [r(0), r(null)] }).passed).toBe(false);
    expect(verifyRecord({ ...base, attempt: null, results: [r(0)] }).attempt).toBeNull();
  });

  it("fails with the reasons joined, whatever the exit codes, and has no reason without one", () => {
    const failed = verifyRecord({ ...base, results: [r(0)], reasons: ["ran elsewhere", "changes: M a.ts"] });
    expect(failed).toMatchObject({ passed: false, reason: "ran elsewhere; changes: M a.ts" });
    expect(verifyRecord({ ...base, results: [r(0)], reasons: [] })).not.toHaveProperty("reason");
    expect(verifyRecord({ ...base, results: [r(0)] })).not.toHaveProperty("reason");
  });
});
