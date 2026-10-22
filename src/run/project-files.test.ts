import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../config";
import { arbabIgnoreEntries, ensureArbabMarkers } from "./index";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "arbab-pfiles-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("arbabIgnoreEntries", () => {
  it("excludes .arbab/ as a whole and .arbab-tmp/ with the default roots", () => {
    expect(arbabIgnoreEntries("/p", defaultConfig())).toEqual([".arbab/", ".arbab-tmp/"]);
    expect(arbabIgnoreEntries("/p", { worktreeRoot: ".arbab/wt", runsRoot: "./.arbab/r/" })).toEqual([".arbab/", ".arbab-tmp/"]);
  });

  it("adds roots outside .arbab/, normalised, each once", () => {
    expect(arbabIgnoreEntries("/p", { worktreeRoot: "./w/", runsRoot: "w" })).toEqual([".arbab/", ".arbab-tmp/", "w/"]);
    expect(arbabIgnoreEntries("/p", { worktreeRoot: "tmp/wt", runsRoot: ".arbab/runs" })).toEqual([".arbab/", ".arbab-tmp/", "tmp/wt/"]);
    // A sibling whose name only starts like .arbab is outside it.
    expect(arbabIgnoreEntries("/p", { worktreeRoot: ".arbab-wt", runsRoot: ".arbab/runs" })).toEqual([".arbab/", ".arbab-tmp/", ".arbab-wt/"]);
  });

  it("refuses a root outside the project", () => {
    expect(() => arbabIgnoreEntries("/p", { worktreeRoot: "../x", runsRoot: "r" })).toThrow(/outside/);
  });
});

describe("ensureArbabMarkers", () => {
  const marker = (): string => join(root, ".arbab", ".eslintrc.json");

  it("writes .arbab/.eslintrc.json with root true, creating .arbab/", () => {
    ensureArbabMarkers(root);
    expect(JSON.parse(readFileSync(marker(), "utf8"))).toEqual({ root: true });
  });

  it("never overwrites an existing marker", () => {
    mkdirSync(join(root, ".arbab"));
    writeFileSync(marker(), '{"root": true, "rules": {}}\n');
    ensureArbabMarkers(root);
    ensureArbabMarkers(root);
    expect(readFileSync(marker(), "utf8")).toBe('{"root": true, "rules": {}}\n');
  });

  it("fails when .arbab is not a directory", () => {
    writeFileSync(join(root, ".arbab"), "x");
    expect(() => ensureArbabMarkers(root)).toThrow();
  });
});
