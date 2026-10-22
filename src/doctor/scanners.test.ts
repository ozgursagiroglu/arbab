import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkEslint, checkTestConfigs, confinesTests, ESLINT_FLAT_UNGUARDED } from "./scanners";

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "arbab-")));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const write = (rel: string, text: string): void => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

describe("checkEslint", () => {
  it("skips a project without ESLint", () => {
    write("package.json", JSON.stringify({ name: "x" }));
    expect(checkEslint(dir)).toEqual([]);
  });

  it("warns about a flat config that does not mention .arbab", () => {
    write("eslint.config.mjs", "export default [{ ignores: ['dist/**'] }];\n");
    expect(checkEslint(dir)).toEqual([{ status: "warn", check: "eslint", detail: `${ESLINT_FLAT_UNGUARDED} (eslint.config.mjs)` }]);
  });

  it("is ok with a flat config that ignores .arbab", () => {
    write("eslint.config.ts", "export default [{ ignores: ['.arbab/**'] }];\n");
    expect(checkEslint(dir)).toEqual([{ status: "ok", check: "eslint", detail: "eslint.config.ts stop at .arbab/" }]);
  });

  it("warns about a legacy config while the cascade marker is missing", () => {
    write(".eslintrc.cjs", "module.exports = {};\n");
    const [check] = checkEslint(dir);
    expect(check).toMatchObject({ status: "warn", check: "eslint" });
    expect(check?.detail).toMatch(/^\.arbab\/\.eslintrc\.json is missing, .* \.eslintrc\.cjs of this checkout/);
    write(".arbab/.eslintrc.json", '{"root": true}');
    expect(checkEslint(dir)).toMatchObject([{ status: "ok" }]);
  });

  it("finds a legacy config in package.json", () => {
    write("package.json", JSON.stringify({ eslintConfig: { extends: "x" } }));
    expect(checkEslint(dir)[0]?.detail).toMatch(/package\.json eslintConfig/);
  });

  it("reports both problems on two lines", () => {
    write("eslint.config.js", "export default [];\n");
    write(".eslintrc.json", "{}");
    expect(checkEslint(dir).map((c) => c.status)).toEqual(["warn", "warn"]);
  });
});

describe("confinesTests", () => {
  it("accepts include, testMatch or an .arbab exclude", () => {
    expect(confinesTests("test: { include: ['src/**/*.test.ts'] }")).toBe(true);
    expect(confinesTests('{"testMatch": ["<rootDir>/src/**"]}')).toBe(true);
    expect(confinesTests("test: { exclude: ['.arbab/**'] }")).toBe(true);
    expect(confinesTests("test: { environment: 'node' }")).toBe(false);
  });
});

describe("checkTestConfigs", () => {
  it("skips a project without a test config, and a vite config without a test block", () => {
    expect(checkTestConfigs(dir)).toBeNull();
    write("vite.config.ts", "export default { plugins: [] };\n");
    expect(checkTestConfigs(dir)).toBeNull();
  });

  it("warns about configs that collect by default", () => {
    write("vitest.config.ts", "export default { test: { environment: 'node' } };\n");
    write("vite.config.mts", "export default { test: { globals: true } };\n");
    write("jest.config.js", "module.exports = { testMatch: ['<rootDir>/src/**/*.test.js'] };\n");
    expect(checkTestConfigs(dir)).toEqual({
      status: "warn",
      check: "tests",
      detail: "vite.config.mts, vitest.config.ts may collect tests from .arbab/worktrees: set include, or exclude '.arbab/**'",
    });
  });

  it("is ok when every config limits what it collects", () => {
    write("vitest.config.ts", "export default { test: { include: ['src/**/*.test.ts'] } };\n");
    write("jest.config.json", '{"testPathIgnorePatterns": ["/.arbab/"]}');
    expect(checkTestConfigs(dir)).toEqual({ status: "ok", check: "tests", detail: "jest.config.json, vitest.config.ts limit what they collect" });
  });
});
