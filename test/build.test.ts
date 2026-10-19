import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundleOptions, packageVersion, UI_BUNDLE_FILTER } from "../scripts/build.mjs";

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

  it("carries the page script plugin", () => {
    const { plugins } = bundleOptions({ version: "0.1.0", outfile: "dist/arbab.mjs" });
    expect(plugins.map((p) => p.name)).toEqual(["arbab-ui-script"]);
    expect(UI_BUNDLE_FILTER.test(join("src", "ui", "client", "app", "bundle.ts"))).toBe(true);
    expect(UI_BUNDLE_FILTER.test("src\\ui\\client\\app\\bundle.ts")).toBe(true);
    expect(UI_BUNDLE_FILTER.test("src/ui/client/app/bundle.test.ts")).toBe(false);
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

const FORBIDDEN = ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function"];

describe("the page script", () => {
  it("replaces bundle.ts with main.ts built for the browser", async () => {
    // A tiny entry that imports bundle.ts, built from a temporary directory with bundleOptions' plugins.
    const entry = join(tmp, "entry.ts");
    const bundleTs = join(ROOT, "src", "ui", "client", "app", "bundle.ts");
    writeFileSync(entry, `import { UI_SCRIPT } from ${JSON.stringify(bundleTs)};\nprocess.stdout.write(JSON.stringify(UI_SCRIPT));\n`);
    const outfile = join(tmp, "out", "entry.mjs");
    const { plugins } = bundleOptions({ version: "0.1.0", outfile });
    await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", outfile, plugins, logLevel: "silent", absWorkingDir: tmp });
    const script: unknown = JSON.parse(execFileSync(process.execPath, [outfile], { cwd: tmp, encoding: "utf8" }));
    expect(typeof script).toBe("string");
    // A marker from main.ts, and the IIFE wrapper.
    expect(script).toContain("This page needs its session token");
    expect(String(script)).toMatch(/\}\)\(\);\s*$/);
    for (const call of FORBIDDEN) expect(String(script), call).not.toContain(call);
  });

  it("builds main.ts for the browser on its own, with no node: module", async () => {
    const result = await build({
      entryPoints: [join(ROOT, "src", "ui", "client", "app", "main.ts")],
      bundle: true,
      platform: "browser",
      format: "iife",
      target: "es2020",
      minify: true,
      write: false,
      metafile: true,
      logLevel: "silent",
      absWorkingDir: ROOT,
    });
    const inputs = Object.keys(result.metafile.inputs);
    expect(inputs.some((input) => input.startsWith("node:"))).toBe(false);
    expect(inputs.some((input) => input.endsWith("raster.ts"))).toBe(false);
    const text = result.outputFiles[0]?.text ?? "";
    expect(text.length).toBeGreaterThan(1000);
    for (const call of FORBIDDEN) expect(text, call).not.toContain(call);
  });
});
