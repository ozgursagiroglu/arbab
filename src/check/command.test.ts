import { describe, expect, it } from "vitest";
import { CHECKS_ENV, CHECK_POLICY_ENV } from "../types";
import {
  FAILURE_PREFIX,
  assertCheckName,
  checkCommandLine,
  checkScriptPath,
  checksEnv,
  defaultCheckConcurrency,
  formatFailureLine,
  isCheckName,
  parseFailureLine,
  readChecksEnv,
} from "./command";

const policy = { cpus: 8, concurrent: 2, waitSec: 120 };

describe("check names", () => {
  it("accepts lowercase words with digits and dashes", () => {
    for (const name of ["test", "gate-1", "smoke", "a", "type-check-2"]) expect(isCheckName(name)).toBe(true);
  });
  it("refuses anything that could be more than one word or a flag", () => {
    for (const name of ["", "-x", "Test", "a b", "a;b", "a/b", "x".repeat(33), "gate_1"]) expect(isCheckName(name)).toBe(false);
    expect(() => assertCheckName("a b")).toThrow(/must match/);
  });
});

describe("checkScriptPath and checkCommandLine", () => {
  it("puts the script in the lane's run directory", () => {
    expect(checkScriptPath("/p/.arbab/runs", "fix-1")).toBe("/p/.arbab/runs/fix-1/bin/arbab-check.mjs");
  });
  it("is node, the script and the name, quoted only where needed", () => {
    expect(checkCommandLine("/p/.arbab/runs/l/bin/arbab-check.mjs", "test")).toBe("node /p/.arbab/runs/l/bin/arbab-check.mjs test");
    expect(checkCommandLine("/my project/bin/arbab-check.mjs", "gate-1")).toBe("node '/my project/bin/arbab-check.mjs' gate-1");
  });
  it("refuses an invalid name", () => {
    expect(() => checkCommandLine("/s.mjs", "x;y")).toThrow(/must match/);
  });
});

describe("defaultCheckConcurrency", () => {
  it("is a quarter of the CPUs, at least one", () => {
    expect(defaultCheckConcurrency(1)).toBe(1);
    expect(defaultCheckConcurrency(8)).toBe(2);
    expect(defaultCheckConcurrency(10)).toBe(2);
    expect(defaultCheckConcurrency(16)).toBe(4);
  });
});

describe("checksEnv and readChecksEnv", () => {
  it("round-trips the checks and the policy", () => {
    const env = checksEnv({ test: ["pnpm", "test"], "gate-1": ["pnpm", "typecheck"] }, policy);
    expect(Object.keys(env).sort()).toEqual([CHECKS_ENV, CHECK_POLICY_ENV].sort());
    expect(readChecksEnv(env)).toEqual({ checks: { test: ["pnpm", "test"], "gate-1": ["pnpm", "typecheck"] }, policy });
  });
  it("refuses a missing or malformed entry", () => {
    expect(() => readChecksEnv({})).toThrow(/ARBAB_CHECKS is not set/);
    expect(() => readChecksEnv({ [CHECKS_ENV]: "{", [CHECK_POLICY_ENV]: JSON.stringify(policy) })).toThrow(/not valid JSON/);
    expect(() => readChecksEnv({ [CHECKS_ENV]: "[]", [CHECK_POLICY_ENV]: JSON.stringify(policy) })).toThrow(/object of name/);
    expect(() => readChecksEnv({ [CHECKS_ENV]: '{"Bad":["x"]}', [CHECK_POLICY_ENV]: JSON.stringify(policy) })).toThrow(/invalid check/);
    expect(() => readChecksEnv({ [CHECKS_ENV]: '{"t":[]}', [CHECK_POLICY_ENV]: JSON.stringify(policy) })).toThrow(/non-empty argv/);
    expect(() => readChecksEnv({ [CHECKS_ENV]: '{"t":["a\\u0000"]}', [CHECK_POLICY_ENV]: JSON.stringify(policy) })).toThrow(/non-empty argv/);
    expect(() => readChecksEnv({ [CHECKS_ENV]: '{"t":["x"]}', [CHECK_POLICY_ENV]: '{"cpus":0,"concurrent":1,"waitSec":0}' })).toThrow(/ARBAB_CHECK_POLICY/);
    expect(() => readChecksEnv({ [CHECKS_ENV]: '{"t":["x"]}' })).toThrow(/ARBAB_CHECK_POLICY is not set/);
  });
  it("refuses an invalid name on the writing side too", () => {
    expect(() => checksEnv({ "a b": ["x"] }, policy)).toThrow(/must match/);
  });
});

describe("formatFailureLine and parseFailureLine", () => {
  it("round-trips a failure with a file and a test", () => {
    const f = { file: "apps/web/src/a.test.ts", test: "suite > does x", message: "AssertionError: expected 1 to be 2" };
    const line = formatFailureLine(f);
    expect(line).toBe("arbab-check failure: apps/web/src/a.test.ts > suite > does x :: AssertionError: expected 1 to be 2");
    expect(parseFailureLine(line)).toEqual(f);
  });
  it("writes - for a missing file and leaves the test out when there is none", () => {
    expect(formatFailureLine({ file: null, test: null, message: "boom" })).toBe(`${FAILURE_PREFIX}- :: boom`);
    expect(parseFailureLine(`${FAILURE_PREFIX}- :: boom`)).toEqual({ file: null, test: null, message: "boom" });
    expect(parseFailureLine(`${FAILURE_PREFIX}src/a.ts :: TS2322`)).toEqual({ file: "src/a.ts", test: null, message: "TS2322" });
  });
  it("keeps every field on one line and cuts the message", () => {
    const line = formatFailureLine({ file: "a\nb.ts", test: "t\r\nu", message: `${"x".repeat(400)}\nmore` });
    expect(line.includes("\n")).toBe(false);
    const back = parseFailureLine(line);
    expect(back?.file).toBe("a b.ts");
    expect(back?.test).toBe("t u");
    expect(back?.message.length).toBe(300);
  });
  it("is null for any other line", () => {
    expect(parseFailureLine("FAIL src/a.test.ts")).toBeNull();
    expect(parseFailureLine(`${FAILURE_PREFIX}no separator`)).toBeNull();
    expect(parseFailureLine(` ${FAILURE_PREFIX}a :: b`)).toBeNull();
  });
});
