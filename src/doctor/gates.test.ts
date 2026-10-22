import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkGates, coveredScripts, isCheckScript, scriptCalls, scriptOf, workflowRunLines } from "./gates";

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "arbab-")));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const write = (rel: string, text: string): void => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const scripts = (s: Record<string, string>): void => write("package.json", JSON.stringify({ scripts: s }));

describe("isCheckScript", () => {
  it("knows the check names and prefixes", () => {
    for (const name of ["check", "lint", "test", "typecheck", "type-check", "build", "format", "format:check", "check:types", "lint:css", "test:unit", "i18n:check", "e2e"]) {
      expect(isCheckScript(name)).toBe(true);
    }
    for (const name of ["dev", "start", "format:write", "release", "prepare", "checks", "linter", "testing"]) {
      expect(isCheckScript(name)).toBe(false);
    }
  });
});

describe("scriptOf", () => {
  it("reads the package-manager forms", () => {
    expect(scriptOf(["pnpm", "lint"])).toBe("lint");
    expect(scriptOf(["pnpm", "run", "lint"])).toBe("lint");
    expect(scriptOf(["npm", "run", "lint"])).toBe("lint");
    expect(scriptOf(["npm", "test"])).toBe("test");
    expect(scriptOf(["yarn", "lint"])).toBe("lint");
    expect(scriptOf(["yarn", "run", "test:unit", "--watch=false"])).toBe("test:unit");
    expect(scriptOf(["/usr/local/bin/pnpm", "test"])).toBe("test");
  });

  it("returns null for anything else", () => {
    expect(scriptOf([])).toBeNull();
    expect(scriptOf(["pnpm"])).toBeNull();
    expect(scriptOf(["pnpm", "run"])).toBeNull();
    expect(scriptOf(["pnpm", "--filter", "x", "lint"])).toBeNull();
    expect(scriptOf(["npm", "lint"])).toBeNull();
    expect(scriptOf(["npx", "vitest"])).toBeNull();
    expect(scriptOf(["make", "test"])).toBeNull();
  });
});

describe("scriptCalls", () => {
  it("finds package-manager calls and run-s / npm-run-all arguments", () => {
    expect(scriptCalls("pnpm lint && pnpm run typecheck; npm test || yarn build")).toEqual(["lint", "typecheck", "test", "build"]);
    expect(scriptCalls("CI=1 pnpm test")).toEqual(["test"]);
    expect(scriptCalls("run-s lint 'test:*' --print-label")).toEqual(["lint", "test:*"]);
    expect(scriptCalls("npm-run-all -p lint:*")).toEqual(["lint:*"]);
    expect(scriptCalls("eslint . && tsc --noEmit")).toEqual([]);
  });
});

describe("coveredScripts", () => {
  it("follows the scripts a gate's script calls", () => {
    const s = { check: "run-s lint:* typecheck", "lint:js": "eslint .", "lint:css": "stylelint", typecheck: "tsc", test: "vitest", e2e: "playwright" };
    expect([...coveredScripts([["pnpm", "check"]], s)].sort()).toEqual(["check", "lint:css", "lint:js", "typecheck"]);
    expect([...coveredScripts([["npm", "test"], ["make", "e2e"]], s)]).toEqual(["test"]);
    expect(coveredScripts([], s).size).toBe(0);
  });

  it("ignores a script that calls itself and calls to missing scripts", () => {
    expect([...coveredScripts([["pnpm", "test"]], { test: "pnpm test && pnpm nope" })]).toEqual(["test"]);
  });
});

describe("workflowRunLines", () => {
  it("reads inline values and block scalars", () => {
    const yaml = [
      "jobs:",
      "  ci:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - run: pnpm install --frozen-lockfile",
      "      - name: checks",
      "        run: |",
      "          pnpm lint",
      "",
      "          pnpm test:unit",
      "      - run: 'pnpm build' # bundle",
      "      - name: folded",
      "        run: >-",
      "          pnpm e2e",
      "        env:",
      "          CI: true",
    ].join("\n");
    expect(workflowRunLines(yaml)).toEqual(["pnpm install --frozen-lockfile", "pnpm lint", "pnpm test:unit", "pnpm build", "pnpm e2e"]);
  });

  it("finds nothing in a workflow without run steps", () => {
    expect(workflowRunLines("on: push\njobs:\n  x:\n    runs-on: ubuntu-latest\n")).toEqual([]);
  });
});

describe("checkGates", () => {
  it("skips a project without package.json or without check scripts", () => {
    expect(checkGates(dir, [])).toEqual([]);
    scripts({ dev: "vite", start: "node ." });
    expect(checkGates(dir, [])).toEqual([]);
  });

  it("is ok when the gates run every check script", () => {
    scripts({ check: "pnpm lint && pnpm test", lint: "eslint .", test: "vitest run", dev: "vite" });
    expect(checkGates(dir, [["pnpm", "check"]])).toEqual([{ status: "ok", check: "gates", detail: "gates run check, lint, test" }]);
  });

  it("warns about the check scripts no gate runs", () => {
    scripts({ lint: "eslint .", test: "vitest run", typecheck: "tsc", "format:check": "prettier -c ." });
    expect(checkGates(dir, [["pnpm", "test"], ["npm", "run", "typecheck"]])).toEqual([
      { status: "warn", check: "gates", detail: "no gate runs these package.json scripts: format:check, lint" },
    ]);
  });

  it("warns separately about the checks CI runs that no gate does", () => {
    scripts({ lint: "eslint .", test: "vitest run", "test:e2e": "playwright test", i18n: "i18n-check" });
    write(
      ".github/workflows/ci.yml",
      "jobs:\n  ci:\n    steps:\n      - run: pnpm install\n      - run: |\n          pnpm lint\n          pnpm test\n",
    );
    write(".github/workflows/e2e.yaml", "jobs:\n  e2e:\n    steps:\n      - run: yarn run test:e2e\n");
    write(".github/workflows/notes.txt", "run: pnpm i18n\n");
    expect(checkGates(dir, [["pnpm", "test"]])).toEqual([
      { status: "warn", check: "gates", detail: "no gate runs these package.json scripts: i18n, lint, test:e2e" },
      { status: "warn", check: "gates", detail: "CI runs checks verify does not: lint, test:e2e" },
    ]);
  });
});
