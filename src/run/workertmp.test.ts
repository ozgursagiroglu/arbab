import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WORKER_TMP_DIR, ensureWorkerTmp, workerTmpPaths } from "./index";

let wt: string;
beforeEach(() => {
  wt = mkdtempSync(join(tmpdir(), "arbab-wtmp-"));
});
afterEach(() => {
  rmSync(wt, { recursive: true, force: true });
});

describe("workerTmpPaths", () => {
  it("names every path under <worktree>/.arbab-tmp without touching the disk", () => {
    expect(WORKER_TMP_DIR).toBe(".arbab-tmp");
    const root = join("/w", ".arbab-tmp");
    expect(workerTmpPaths("/w")).toEqual({
      root,
      xdgConfig: join(root, "xdg-config"),
      xdgData: join(root, "xdg-data"),
      xdgCache: join(root, "xdg-cache"),
      yarnCache: join(root, "yarn-cache"),
      npmrc: join(root, "npmrc"),
      inputs: join(root, "inputs"),
    });
  });
});

describe("ensureWorkerTmp", () => {
  it("creates the directories and an empty npmrc", () => {
    const paths = ensureWorkerTmp(wt);
    expect(paths).toEqual(workerTmpPaths(wt));
    for (const dir of [paths.root, paths.xdgConfig, paths.xdgData, paths.xdgCache, paths.yarnCache, paths.inputs]) {
      expect(statSync(dir).isDirectory(), dir).toBe(true);
    }
    expect(statSync(paths.npmrc).isFile()).toBe(true);
    expect(readFileSync(paths.npmrc, "utf8")).toBe("");
  });

  it("is idempotent and keeps what is already there", () => {
    const paths = ensureWorkerTmp(wt);
    writeFileSync(paths.npmrc, "registry=https://registry.example.test/\n");
    writeFileSync(join(paths.inputs, "note.md"), "x");
    ensureWorkerTmp(wt);
    expect(readFileSync(paths.npmrc, "utf8")).toBe("registry=https://registry.example.test/\n");
    expect(readFileSync(join(paths.inputs, "note.md"), "utf8")).toBe("x");
  });

  it("fails when a directory cannot be created", () => {
    writeFileSync(join(wt, ".arbab-tmp"), "a file where the directory goes");
    expect(() => ensureWorkerTmp(wt)).toThrow();
  });
});
