import { describe, expect, it } from "vitest";
import { FAILURE_MESSAGE_MAX } from "./command";
import { parseFailures, stripAnsi } from "./digest";

const VITEST_5 = `
 RUN  v5.0.3 /work/app

 ❯ test/assemble-plugin.test.ts (9 tests | 1 failed) 270ms
   ❯ the committed plugin/ (1)
     × holds the manifest 11ms
 ✓ test/build.test.ts (8 tests) 1200ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/assemble-plugin.test.ts > the committed plugin/ > holds the manifest
AssertionError: expected [ '.claude-plugin/plugin.json', …(8) ] to deeply equal [ '.claude-plugin/plugin.json', …(9) ]

- Expected
+ Received

 ❯ test/assemble-plugin.test.ts:152:31
    150|     const plugin = join(ROOT, "plugin");

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 16 passed (17)
   Start at  10:10:04
   Duration  1.56s (tests 79%, import 13%, transform 8%, worker 1%)
`;

const VITEST_4_PROJECTS = `
\u001b[31m⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯\u001b[39m

\u001b[41m\u001b[1m FAIL \u001b[22m\u001b[49m |unit| src/b.test.ts \u001b[2m[ src/b.test.ts ]\u001b[22m
\u001b[31mError: Cannot find module './missing' imported from src/b.test.ts\u001b[39m
\u001b[2m⎯⎯⎯⎯⎯⎯[1/3]⎯\u001b[22m

\u001b[31m⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯\u001b[39m

 FAIL  |web| src/a.test.ts > sum > adds
AssertionError: expected 3 to be 4 // Object.is equality
 FAIL  |web| src/a.test.ts > sum > subtracts

TypeError: Cannot read properties of undefined (reading 'x')

 Test Files  2 failed | 3 passed (5)
      Tests  2 failed | 10 passed (12)
`;

const JEST = `
PASS src/ok.test.js
FAIL src/math.test.js (5.21 s)
  math
    ✕ adds (4 ms)
    ✓ subtracts (1 ms)
    ✕ divides (1 ms)

  ● math › adds

    expect(received).toBe(expected) // Object.is equality

    Expected: 4
    Received: 3

      3 | test("adds", () => {
    > 4 |   expect(1 + 2).toBe(4);

  ● Console

    console.log
      noise

  ● math › divides

    TypeError: divide is not a function

Test Suites: 1 failed, 1 passed, 2 total
Tests:       2 failed, 3 passed, 5 total

Summary of all failing tests
FAIL src/math.test.js
  ● math › adds

    expect(received).toBe(expected) // Object.is equality
`;

const TSC_PLAIN = `src/a.ts(3,7): error TS2322: Type 'number' is not assignable to type 'string'.
src/dir/b.ts(10,1): error TS2304: Cannot find name 'foo'.
`;

const TSC_PRETTY = `\u001b[96msrc/a.ts\u001b[0m:\u001b[93m3\u001b[0m:\u001b[93m7\u001b[0m - \u001b[91merror\u001b[0m\u001b[90m TS2322: \u001b[0mType 'number' is not assignable to type 'string'.

\u001b[7m3\u001b[0m const x: string = 1;
\u001b[7m \u001b[0m \u001b[91m      ~\u001b[0m


Found 1 error in src/a.ts\u001b[90m:3\u001b[0m
`;

const ESLINT = `
/work/app/src/a.ts
  3:7   error    'x' is assigned a value but never used  @typescript-eslint/no-unused-vars
  5:1   error    Unexpected console statement            no-console

/work/app/src/b.ts
  2:10  warning  Missing return type                     @typescript-eslint/explicit-function-return-type

src/c.js
  1:1  error  Parsing error: Unexpected token

✖ 4 problems (3 errors, 1 warning)
`;

const PRETTIER = `Checking formatting...
[warn] src/a.ts
[warn] src/deep/b.tsx
[warn] Code style issues found in 2 files. Run Prettier with --write to fix.
`;

describe("stripAnsi", () => {
  it("removes colour codes and hyperlinks", () => {
    expect(stripAnsi("\u001b[31mred\u001b[39m \u001b]8;;http://x\u0007link\u001b]8;;\u0007")).toBe("red link");
  });
});

describe("parseFailures", () => {
  it("returns nothing for empty output and for noise", () => {
    expect(parseFailures("")).toEqual([]);
    const noise = [
      " ✓ src/a.test.ts (3 tests) 5ms",
      "FAILED to connect",
      "  FAIL",
      "[warn] Code style issues found in the above file. Run Prettier with --write to fix.",
      "src/a.ts",
      "just text with src/a.ts(1,1) in it",
      " Test Files  4 passed (4)",
      "v20.1.0",
      "",
    ].join("\n");
    expect(parseFailures(noise)).toEqual([]);
  });

  it("reads vitest 5's failed tests, with the next line as the message", () => {
    expect(parseFailures(VITEST_5)).toEqual([
      {
        file: "test/assemble-plugin.test.ts",
        test: "the committed plugin/ > holds the manifest",
        message: "AssertionError: expected [ '.claude-plugin/plugin.json', …(8) ] to deeply equal [ '.claude-plugin/plugin.json', …(9) ]",
      },
    ]);
  });

  it("reads vitest 4 with projects and colours: suite failures, then tests, skipping blank lines", () => {
    expect(parseFailures(VITEST_4_PROJECTS)).toEqual([
      { file: "src/b.test.ts", test: null, message: "Error: Cannot find module './missing' imported from src/b.test.ts" },
      { file: "src/a.test.ts", test: "sum > adds", message: "AssertionError: expected 3 to be 4 // Object.is equality" },
      { file: "src/a.test.ts", test: "sum > subtracts", message: "TypeError: Cannot read properties of undefined (reading 'x')" },
    ]);
  });

  it("gives a FAIL line with no message before the summary a placeholder", () => {
    expect(parseFailures(" FAIL  src/x.test.ts > t\n\n Test Files  1 failed (1)\n")).toEqual([
      { file: "src/x.test.ts", test: "t", message: "failed" },
    ]);
  });

  it("reads jest: each ● test after its FAIL file, deduplicated against the summary, ● Console skipped", () => {
    expect(parseFailures(JEST)).toEqual([
      { file: "src/math.test.js", test: "math > adds", message: "expect(received).toBe(expected) // Object.is equality" },
      { file: "src/math.test.js", test: "math > divides", message: "TypeError: divide is not a function" },
    ]);
  });

  it("reads a jest FAIL file with no ● lines with its next line", () => {
    expect(parseFailures("FAIL src/a.test.js\n  ● Test suite failed to run\n\n    Cannot find module 'x'\n")).toEqual([
      { file: "src/a.test.js", test: "Test suite failed to run", message: "Cannot find module 'x'" },
    ]);
    expect(parseFailures("FAIL src/a.test.js\n  Your test suite must contain at least one test.\n")).toEqual([
      { file: "src/a.test.js", test: null, message: "Your test suite must contain at least one test." },
    ]);
  });

  it("reads tsc's plain form", () => {
    expect(parseFailures(TSC_PLAIN)).toEqual([
      { file: "src/a.ts", test: null, message: "TS2322: Type 'number' is not assignable to type 'string'." },
      { file: "src/dir/b.ts", test: null, message: "TS2304: Cannot find name 'foo'." },
    ]);
  });

  it("reads tsc's pretty form once its colours are stripped", () => {
    expect(parseFailures(TSC_PRETTY)).toEqual([
      { file: "src/a.ts", test: null, message: "TS2322: Type 'number' is not assignable to type 'string'." },
    ]);
  });

  it("reads eslint: one failure per file with its first error, warnings alone are not failures", () => {
    expect(parseFailures(ESLINT)).toEqual([
      { file: "/work/app/src/a.ts", test: null, message: "'x' is assigned a value but never used (@typescript-eslint/no-unused-vars)" },
      { file: "src/c.js", test: null, message: "Parsing error: Unexpected token" },
    ]);
  });

  it("reads prettier's unformatted files, not its summary", () => {
    expect(parseFailures(PRETTIER)).toEqual([
      { file: "src/a.ts", test: null, message: "not formatted (prettier)" },
      { file: "src/deep/b.tsx", test: null, message: "not formatted (prettier)" },
    ]);
  });

  it("keeps output order across formats and deduplicates", () => {
    const output = [TSC_PLAIN, TSC_PLAIN, PRETTIER, " FAIL  src/z.test.ts > z", "Error: z"].join("\n");
    expect(parseFailures(output).map((f) => f.file)).toEqual(["src/a.ts", "src/dir/b.ts", "src/a.ts", "src/deep/b.tsx", "src/z.test.ts"]);
  });

  it("stops at max and cuts long messages", () => {
    const many = Array.from({ length: 50 }, (_, i) => `src/f${i}.ts(1,1): error TS1005: ';' expected.`).join("\n");
    expect(parseFailures(many)).toHaveLength(30);
    expect(parseFailures(many, 3).map((f) => f.file)).toEqual(["src/f0.ts", "src/f1.ts", "src/f2.ts"]);
    const [long] = parseFailures(` FAIL  src/a.test.ts > t\nError: ${"x".repeat(1000)}\n`);
    expect(long?.message).toHaveLength(FAILURE_MESSAGE_MAX);
  });

  it("handles CRLF output", () => {
    expect(parseFailures("src/a.ts(1,2): error TS1005: ';' expected.\r\n")).toEqual([
      { file: "src/a.ts", test: null, message: "TS1005: ';' expected." },
    ]);
  });
});
