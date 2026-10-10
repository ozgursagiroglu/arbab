import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundleOptions, packageVersion } from "../scripts/build.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "arbab-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("packageVersion", () => {
  it("reads package.json's version and refuses a package without one", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
    expect(packageVersion(ROOT)).toBe(pkg.version);
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ name: "x" }));
    expect(() => packageVersion(tmp)).toThrow(/has no version/);
  });
});

describe("bundleOptions", () => {
  it("compiles the version in, so the installed bundle prints it without a package.json", async () => {
    // Laid out like the plugin: plugin/dist/arbab.mjs, with no package.json above it.
    const bundle = join(tmp, "plugin", "dist", "arbab.mjs");
    await build({ ...bundleOptions({ version: "1.2.3-test", outfile: bundle }), absWorkingDir: ROOT });
    expect(execFileSync(process.execPath, [bundle, "--version"], { cwd: tmp, encoding: "utf8" })).toBe("1.2.3-test\n");
  });

  it("bundles src/cli.ts as one node ESM file with a shebang", () => {
    const options = bundleOptions({ version: "0.1.0", outfile: "dist/arbab.mjs" });
    expect(options).toMatchObject({
      entryPoints: ["src/cli.ts"],
      bundle: true,
      platform: "node",
      format: "esm",
      outfile: "dist/arbab.mjs",
      banner: { js: "#!/usr/bin/env node" },
      define: { __ARBAB_VERSION__: '"0.1.0"' },
    });
  });
});
