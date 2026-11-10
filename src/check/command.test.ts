import { describe, expect, it } from "vitest";
import { CHECKS_ENV, CHECK_POLICY_ENV } from "../types";
import {
  FAILURE_FIELD_MAX,
  FAILURE_PREFIX,
  assertCheckName,
  checkCommandLine,
  checkScriptPath,
  checksEnv,
  defaultCheckConcurrency,
  deriveChecks,
  hasTargets,
  isBuildArgv,
  isSuiteArgv,
  runWord,
  failureFieldText,
  formatFailureLine,
  isCheckName,
  parseFailureLine,
  readChecksEnv,
} from "./command";

const policy = { cpus: 8, concurrent: 2, waitSec: 120, suites: "whole" as const };

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

describe("failureFieldText", () => {
  it("cleans a field as formatFailureLine does, without cutting it", () => {
    expect(failureFieldText("  \u001b[31msrc/a.ts\u001b[39m\t\n")).toBe("src/a.ts");
    expect(failureFieldText("a\u0007b\r\nc")).toBe("ab c");
    const long = "f".repeat(FAILURE_FIELD_MAX + 50);
    expect(failureFieldText(long)).toBe(long);
    expect(FAILURE_FIELD_MAX).toBe(200);
    // What it keeps of a field up to the cap is what the line prints.
    const file = ` src/${"d".repeat(150)}.ts `;
    expect(parseFailureLine(formatFailureLine({ file, test: null, message: "m" }))?.file).toBe(failureFieldText(file));
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
  it("strips C0 and C1 controls, ESC included, from every field when formatting", () => {
    const line = formatFailureLine({
      file: "src/\u001b[31ma\u0007.ts\u0000",
      test: "t\u001b]0;title\u0007\u009b2Jx\u0008",
      message: "\u001b[2Kboom\u007f\u0085 here\u001b",
    });
    expect(line).toBe(`${FAILURE_PREFIX}src/a.ts > t]0;title2Jx :: boom here`);
    expect(line).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(parseFailureLine(line)).toEqual({ file: "src/a.ts", test: "t]0;title2Jx", message: "boom here" });
  });
  it("strips controls when parsing a line it did not write", () => {
    const back = parseFailureLine(`${FAILURE_PREFIX}\u001b[1msrc/a.ts\u001b[0m > \u0007suite\u009d :: \u001b[31mfail\u0000ed\u001b[39m`);
    expect(back).toEqual({ file: "src/a.ts", test: "suite", message: "failed" });
    // A field that is only controls is no field.
    expect(parseFailureLine(`${FAILURE_PREFIX}\u001b > \u0007 :: x`)).toEqual({ file: null, test: null, message: "x" });
    expect(formatFailureLine({ file: "\u001b", test: "\u0000", message: "x" })).toBe(`${FAILURE_PREFIX}- :: x`);
  });
  it("cuts the file and the test to 200 characters each, the message to 300, on both sides", () => {
    const line = formatFailureLine({ file: "f".repeat(500), test: "t".repeat(500), message: "m".repeat(500) });
    expect(line).toBe(`${FAILURE_PREFIX}${"f".repeat(200)} > ${"t".repeat(200)} :: ${"m".repeat(300)}`);
    expect(parseFailureLine(line)).toEqual({ file: "f".repeat(200), test: "t".repeat(200), message: "m".repeat(300) });
    const raw = `${FAILURE_PREFIX}${"f".repeat(500)} > ${"t".repeat(500)} :: ${"m".repeat(500)}`;
    expect(parseFailureLine(raw)).toEqual({ file: "f".repeat(200), test: "t".repeat(200), message: "m".repeat(300) });
    // A cut that ends on a space is trimmed, so the line reads back as it was written.
    const spaced = { file: `${"a".repeat(199)} b`, test: null, message: "x" };
    expect(parseFailureLine(formatFailureLine(spaced))).toEqual({ file: "a".repeat(199), test: null, message: "x" });
  });
  it("is null for any other line", () => {
    expect(parseFailureLine("FAIL src/a.test.ts")).toBeNull();
    expect(parseFailureLine(`${FAILURE_PREFIX}no separator`)).toBeNull();
    expect(parseFailureLine(` ${FAILURE_PREFIX}a :: b`)).toBeNull();
  });
});

describe("checks without config (DESIGN.md §23)", () => {
  it("names what an argv runs", () => {
    expect(runWord(["pnpm", "-F", "@acme/web", "typecheck"])).toBe("typecheck");
    expect(runWord(["pnpm", "exec", "eslint", "apps/web"])).toBe("eslint");
    expect(runWord(["pnpm", "test:unit"])).toBe("test:unit");
    expect(runWord(["npm", "run", "lint", "--", "--fix"])).toBe("lint");
    expect(runWord(["yarn", "workspace", "web", "test"])).toBe("test");
    expect(runWord(["pnpm", "--filter=web", "build"])).toBe("build");
    expect(runWord(["node", "scripts/check-env.mjs"])).toBe("check-env");
    expect(runWord(["/usr/local/bin/tsc", "--noEmit"])).toBe("tsc");
    expect(runWord([])).toBe("");
    expect(runWord(["pnpm"])).toBe("");
  });

  it("reads -w by package manager: a switch in pnpm, a workspace name elsewhere", () => {
    expect(runWord(["pnpm", "-w", "test"])).toBe("test");
    expect(runWord(["pnpm", "--workspace", "test"])).toBe("test");
    expect(runWord(["pnpm", "-w", "run", "lint"])).toBe("lint");
    expect(runWord(["npm", "-w", "web", "test"])).toBe("test");
    expect(runWord(["npm", "--workspace", "web", "run", "lint"])).toBe("lint");
    expect(runWord(["npm", "--workspace=web", "test"])).toBe("test");
    expect(runWord(["yarn", "-w", "web", "test"])).toBe("test");
    expect(runWord(["bun", "--workspace", "web", "test"])).toBe("test");
    expect(isSuiteArgv(["pnpm", "-w", "test"])).toBe(true);
    expect(isSuiteArgv(["npm", "-w", "web", "test"])).toBe(true);
    expect(deriveChecks([["pnpm", "-w", "typecheck"]])).toEqual({ typecheck: ["pnpm", "-w", "typecheck"] });
  });

  it("names the first task a task runner runs, alone and behind a package manager", () => {
    const shapes: [string[], string][] = [
      [["turbo", "run", "test"], "test"],
      [["turbo", "test"], "test"],
      [["turbo", "run", "test", "--filter=web"], "test"],
      [["turbo", "run", "--filter", "web", "test"], "test"],
      [["turbo", "run", "test", "lint"], "test"],
      [["turbo", "run", "web#test"], "test"],
      [["nx", "run", "web:test"], "test"],
      [["nx", "run", "web:test:ci"], "test"],
      [["nx", "test", "web"], "test"],
      [["nx", "run-many", "-t", "test"], "test"],
      [["nx", "run-many", "-t", "test", "lint"], "test"],
      [["nx", "run-many", "--targets=test,lint"], "test"],
      [["nx", "run-many", "--target", "test", "-p", "web"], "test"],
      [["nx", "affected", "-t", "test"], "test"],
      [["lerna", "run", "test"], "test"],
      [["lerna", "run", "--scope", "web", "test"], "test"],
      [["moon", "run", "web:test"], "test"],
      [["moon", "run", ":test"], "test"],
      [["moon", "web:test"], "test"],
      [["make", "test"], "test"],
      [["make", "-C", "web", "test", "lint"], "test"],
      [["make", "-j", "4", "test"], "test"],
      [["make", "-j", "test"], "test"],
      [["make", "CI=1", "test"], "test"],
      [["make"], "make"],
      [["make", "-j8"], "make"],
      [["turbo"], "turbo"],
      [["turbo", "run"], "turbo"],
      [["nx", "run-many"], "nx"],
      [["lerna", "bootstrap"], "lerna"],
      [["moon", "check"], "moon"],
    ];
    for (const [argv, word] of shapes) {
      expect(runWord(argv), argv.join(" ")).toBe(word);
      for (const pm of [["pnpm"], ["pnpm", "exec"], ["npx"], ["yarn"], ["bunx"]]) {
        expect(runWord([...pm, ...argv]), [...pm, ...argv].join(" ")).toBe(word);
      }
    }
    expect(runWord(["pnpm", "turbo", "run", "test"])).toBe("test");
    expect(runWord(["npx", "nx", "test", "web"])).toBe("test");
    expect(runWord(["./node_modules/.bin/turbo", "run", "Lint"])).toBe("lint");
  });

  it("classifies task-runner gates by their task", () => {
    for (const argv of [
      ["turbo", "run", "test"],
      ["pnpm", "turbo", "test"],
      ["nx", "run", "web:test"],
      ["npx", "nx", "test", "web"],
      ["nx", "run-many", "-t", "test"],
      ["lerna", "run", "test:unit"],
      ["moon", "run", "web:test"],
      ["make", "test"],
      ["make", "e2e-test"],
    ]) {
      expect(isSuiteArgv(argv), argv.join(" ")).toBe(true);
    }
    for (const argv of [["turbo", "run", "lint"], ["nx", "run", "web:typecheck"], ["make"], ["make", "lint"], ["moon", "run", "web:build"]]) {
      expect(isSuiteArgv(argv), argv.join(" ")).toBe(false);
    }
    for (const argv of [["turbo", "run", "build"], ["pnpm", "turbo", "build"], ["nx", "run", "web:build"], ["nx", "build", "web"], ["make", "build"], ["moon", "run", "web:build"]]) {
      expect(isBuildArgv(argv), argv.join(" ")).toBe(true);
    }
    expect(isBuildArgv(["turbo", "run", "test"])).toBe(false);
  });

  it("judges a suite only by what the argv runs", () => {
    expect(isSuiteArgv(["pnpm", "exec", "eslint", "--plugin", "jest", "."])).toBe(false);
    expect(isSuiteArgv(["eslint", "--plugin", "jest", "."])).toBe(false);
    expect(isSuiteArgv(["pnpm", "exec", "tsc", "-p", "vitest.config.ts"])).toBe(false);
    expect(isSuiteArgv(["node", "scripts/x.mjs", "--test"])).toBe(false);
    expect(isSuiteArgv(["node", "--import", "tsx", "--test"])).toBe(true);
    expect(isSuiteArgv(["node", "--test", "src/"])).toBe(true);
    expect(isSuiteArgv(["pnpm", "exec", "node", "--test"])).toBe(true);
    for (const runner of ["vitest", "jest", "mocha", "ava", "playwright", "cypress"]) {
      expect(isSuiteArgv([runner]), runner).toBe(true);
      expect(isSuiteArgv(["pnpm", "exec", runner, "run"]), runner).toBe(true);
      expect(isSuiteArgv(["./node_modules/.bin/" + runner]), runner).toBe(true);
    }
  });

  it("knows every documented script-name form", () => {
    for (const script of ["test", "test:unit", "test-e2e", "test_int", "unit:test", "e2e-test", "int_test", "TEST"]) {
      expect(isSuiteArgv(["pnpm", script]), script).toBe(true);
      expect(isSuiteArgv(["npm", "run", script]), script).toBe(true);
    }
    for (const script of ["testimony", "contest", "attest", "latest", "tests", "test.ts", "pretest:x"]) {
      expect(isSuiteArgv(["pnpm", script]), script).toBe(false);
    }
  });

  it("tells suites apart", () => {
    for (const argv of [["pnpm", "test"], ["pnpm", "test:unit"], ["npm", "run", "unit:test"], ["pnpm", "vitest", "run"], ["npx", "jest"], ["node", "--test"], ["yarn", "test-e2e"]]) {
      expect(isSuiteArgv(argv), argv.join(" ")).toBe(true);
    }
    for (const argv of [["pnpm", "typecheck"], ["pnpm", "exec", "eslint", "."], ["pnpm", "env:check"], ["pnpm", "build"], ["pnpm", "testimony"]]) {
      expect(isSuiteArgv(argv), argv.join(" ")).toBe(false);
    }
  });

  it("tells builds apart", () => {
    for (const argv of [["pnpm", "build"], ["pnpm", "build:web"], ["npm", "run", "web:build"], ["pnpm", "exec", "next", "build"], ["npx", "tsup"]]) {
      expect(isBuildArgv(argv), argv.join(" ")).toBe(true);
    }
    for (const argv of [["pnpm", "typecheck"], ["pnpm", "exec", "next", "lint"], ["pnpm", "test"], ["pnpm", "bundle:check"]]) {
      expect(isBuildArgv(argv), argv.join(" ")).toBe(false);
    }
  });

  it("finds targets among a suite check's extra arguments", () => {
    expect(hasTargets([])).toBe(false);
    expect(hasTargets(["--reporter=dot"])).toBe(false);
    expect(hasTargets(["--project", "unit"])).toBe(false);
    expect(hasTargets(["-t", "does x"])).toBe(false);
    expect(hasTargets(["src/a.test.ts"])).toBe(true);
    expect(hasTargets(["--silent", "src/a.test.ts"])).toBe(true);
    expect(hasTargets(["--project", "unit", "src/a.test.ts"])).toBe(true);
    expect(hasTargets(["--project", "unit", "price-list"])).toBe(true);
    expect(hasTargets(["price-list"])).toBe(true);
  });

  it("derives one check per non-build gate, named by what it runs", () => {
    expect(
      deriveChecks([
        ["pnpm", "-F", "@acme/web", "typecheck"],
        ["pnpm", "exec", "eslint", "apps/web"],
        ["pnpm", "exec", "prettier", "--check", "apps/web"],
        ["pnpm", "env:check"],
        ["pnpm", "test:unit"],
        ["pnpm", "build"],
      ]),
    ).toEqual({
      typecheck: ["pnpm", "-F", "@acme/web", "typecheck"],
      eslint: ["pnpm", "exec", "eslint", "apps/web"],
      prettier: ["pnpm", "exec", "prettier", "--check", "apps/web"],
      "env-check": ["pnpm", "env:check"],
      "test-unit": ["pnpm", "test:unit"],
    });
  });

  it("names task-runner gates by their task and skips their builds", () => {
    expect(
      deriveChecks([
        ["pnpm", "turbo", "run", "typecheck"],
        ["turbo", "run", "lint", "--filter=web"],
        ["turbo", "run", "build"],
        ["pnpm", "turbo", "build"],
        ["nx", "run-many", "-t", "test"],
        ["npx", "nx", "e2e", "web"],
        ["nx", "run", "web:build"],
        ["make"],
      ]),
    ).toEqual({
      typecheck: ["pnpm", "turbo", "run", "typecheck"],
      lint: ["turbo", "run", "lint", "--filter=web"],
      test: ["nx", "run-many", "-t", "test"],
      e2e: ["npx", "nx", "e2e", "web"],
      make: ["make"],
    });
  });

  it("numbers repeats, falls back to gate-<i>, and copies the argv", () => {
    const gates = [["pnpm", "exec", "eslint", "a"], ["pnpm", "exec", "eslint", "b"], ["pnpm", "exec", "eslint", "c"], ["./___"]];
    const checks = deriveChecks(gates);
    expect(Object.keys(checks)).toEqual(["eslint", "eslint-2", "eslint-3", "gate-4"]);
    expect(checks.eslint).not.toBe(gates[0]);
    const long = deriveChecks([["pnpm", "x".repeat(40)], ["pnpm", "x".repeat(40)]]);
    for (const name of Object.keys(long)) expect(isCheckName(name), name).toBe(true);
  });
});

describe("readChecksEnv: suites (DESIGN.md §23)", () => {
  it("reads suites and treats a policy without it as whole", () => {
    const env = checksEnv({ t: ["x"] }, { ...policy, suites: "targeted" });
    expect(readChecksEnv(env).policy.suites).toBe("targeted");
    expect(readChecksEnv({ [CHECKS_ENV]: '{"t":["x"]}', [CHECK_POLICY_ENV]: '{"cpus":8,"concurrent":2,"waitSec":60}' }).policy.suites).toBe("whole");
    expect(() => readChecksEnv({ [CHECKS_ENV]: '{"t":["x"]}', [CHECK_POLICY_ENV]: '{"cpus":8,"concurrent":2,"waitSec":60,"suites":"all"}' })).toThrow(/suites/);
  });
});
