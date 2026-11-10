import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bundleOptions, checkBundleOptions, packageVersion, UI_BUNDLE_FILTER } from "../scripts/build.mjs";

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

describe("checkBundleOptions", () => {
  it("bundles src/check/main.ts as one node ESM file", () => {
    expect(checkBundleOptions({ outfile: "dist/arbab-check.mjs" })).toMatchObject({
      entryPoints: ["src/check/main.ts"],
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node20",
      outfile: "dist/arbab-check.mjs",
      legalComments: "none",
    });
  });

  it("runs alone, with node built-ins only: an unknown name exits 2, a passing check prints its summary", async () => {
    // Laid out like a lane's run directory: the script alone in bin/, no package.json or node_modules near it.
    const script = join(tmp, "runs", "lane", "bin", "arbab-check.mjs");
    const result = await build({ ...checkBundleOptions({ outfile: script }), absWorkingDir: ROOT, metafile: true });
    const inputs = Object.keys(result.metafile?.inputs ?? {});
    expect(inputs.some((input) => input.includes("node_modules"))).toBe(false);

    const work = join(tmp, "work");
    mkdirSync(join(work, ".arbab-tmp"), { recursive: true });
    const env = {
      PATH: process.env.PATH,
      TMPDIR: tmp,
      ARBAB_CHECKS: JSON.stringify({ hello: [process.execPath, "-e", "console.log('hello from ' + process.env.ARBAB_CHECK_CPUS)"] }),
      ARBAB_CHECK_POLICY: JSON.stringify({ cpus: 3, concurrent: 1, waitSec: 0 }),
    };
    const unknown = spawnSync(process.execPath, [script, "nope"], { cwd: work, env, encoding: "utf8" });
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain('unknown check "nope"; configured checks: hello');

    const ok = spawnSync(process.execPath, [script, "hello"], { cwd: work, env, encoding: "utf8" });
    expect(ok.stderr).toBe("");
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/^arbab-check hello: exit 0 after \d+\.\ds on 2 CPUs; log \.arbab-tmp\/checks\/hello-1\.log\n--- last 1 lines ---\nhello from 2\n$/);
    expect(readFileSync(join(work, ".arbab-tmp", "checks", "hello-1.log"), "utf8")).toBe("hello from 2\n");
    // The run's registry entry is gone.
    expect(readdirSync(join(tmp, "arbab-checks"))).toEqual([]);
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
