// Bundles the runner into one dependency-free ESM file. The plugin runs it as
// `node "${CLAUDE_PLUGIN_ROOT}/dist/arbab.mjs"`, so it needs no node_modules and no executable bit.
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { assemblePlugin } from "./assemble-plugin.mjs";

/** package.json's version. */
export function packageVersion(root) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (typeof pkg.version !== "string" || pkg.version === "") throw new Error(`${join(root, "package.json")} has no version`);
  return pkg.version;
}

/** src/ui/client/app/bundle.ts, wherever the build runs from. */
export const UI_BUNDLE_FILTER = /src[\\/]ui[\\/]client[\\/]app[\\/]bundle\.ts$/;

/**
 * An esbuild plugin that replaces src/ui/client/app/bundle.ts with the page script: main.ts next to it, bundled for the
 * browser (DESIGN.md §19, Build). The path comes from the loaded file itself, so it does not depend on the working
 * directory.
 */
export function uiScriptPlugin() {
  return {
    name: "arbab-ui-script",
    setup(pluginBuild) {
      pluginBuild.onLoad({ filter: UI_BUNDLE_FILTER }, async (args) => {
        const entry = join(dirname(args.path), "main.ts");
        const result = await build({
          entryPoints: [entry],
          absWorkingDir: dirname(entry),
          bundle: true,
          platform: "browser",
          format: "iife",
          target: "es2020",
          minify: true,
          write: false,
          legalComments: "none",
          logLevel: "silent",
          metafile: true,
        });
        const script = result.outputFiles[0]?.text ?? "";
        if (script === "") throw new Error(`the page script built from ${entry} is empty`);
        return {
          contents: `export const UI_SCRIPT = ${JSON.stringify(script)};\n`,
          loader: "ts",
          watchFiles: Object.keys(result.metafile.inputs).map((input) => join(dirname(entry), input)),
        };
      });
    },
  };
}

/**
 * The esbuild options for the bundle. The version is compiled in: the installed plugin/ has no package.json for the
 * runner to read it from.
 */
export function bundleOptions({ version, outfile }) {
  return {
    entryPoints: ["src/cli.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile,
    banner: { js: "#!/usr/bin/env node" },
    define: { __ARBAB_VERSION__: JSON.stringify(version) },
    legalComments: "none",
    logLevel: "warning",
    plugins: [uiScriptPlugin()],
  };
}

// Only when run as the build script; tests import the functions above.
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  await build(bundleOptions({ version: packageVersion("."), outfile: "dist/arbab.mjs" }));
  // The marketplace installs plugin/, so the install carries the plugin and nothing else from the repository.
  assemblePlugin(".", "dist/arbab.mjs", "plugin");
}
