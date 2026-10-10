// Entry point of the runner (DESIGN.md §10), bundled into dist/arbab.mjs. Everything else lives in src/commands.
import { readFileSync } from "node:fs";
import { defaultContext, dispatch } from "./commands";

// Set by scripts/build.mjs (esbuild define): the installed plugin has no package.json to read.
declare const __ARBAB_VERSION__: string | undefined;

function readVersion(): string {
  if (typeof __ARBAB_VERSION__ === "string") return __ARBAB_VERSION__;
  try {
    // Run from source (tests), the package root is one directory up.
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// "This script" for the detached shepherd is the file node was started with (dist/arbab.mjs in the plugin).
const scriptPath = process.argv[1] ?? "";
const code = await dispatch(process.argv.slice(2), defaultContext({ scriptPath, version: readVersion() }));
// A finished shepherd can leave one pending poll timer behind; it has written its state, so it exits at once. Other
// commands only set the exit code, so output piped to another process is never cut short.
if (process.argv[2] === "__shepherd") process.exit(code);
process.exitCode = code;
