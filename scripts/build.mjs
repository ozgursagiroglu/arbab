// Bundles the runner into one dependency-free ESM file. The plugin runs it as
// `node "${CLAUDE_PLUGIN_ROOT}/dist/arbab.mjs"`, so it needs no node_modules and no executable bit.
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { assemblePlugin } from "./assemble-plugin.mjs";

/** package.json's version. */
export function packageVersion(root) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (typeof pkg.version !== "string" || pkg.version === "") throw new Error(`${join(root, "package.json")} has no version`);
  return pkg.version;
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
  };
}

// Only when run as the build script; tests import the functions above.
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  await build(bundleOptions({ version: packageVersion("."), outfile: "dist/arbab.mjs" }));
  // The marketplace installs plugin/, so the install carries the plugin and nothing else from the repository.
  assemblePlugin(".", "dist/arbab.mjs", "plugin");
}
