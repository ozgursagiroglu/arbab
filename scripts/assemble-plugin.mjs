// Assembles the installable plugin directory. Installing from a marketplace copies the plugin's whole
// source directory, ignored files included, so the plugin lives in a directory that holds only the plugin:
// the manifest, the skills, the hooks and the bundle.
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

/**
 * @param {string} root repository root
 * @param {string} bundle path of the bundled runner
 * @param {string} outDir directory to rebuild; removed first
 */
export function assemblePlugin(root, bundle, outDir) {
  const repo = resolve(root);
  const out = resolve(outDir);
  // outDir is removed recursively: never let it be, or contain, the sources.
  const fromOut = relative(out, repo);
  const outside = fromOut === ".." || fromOut.startsWith(`..${sep}`) || isAbsolute(fromOut);
  if (!outside) {
    throw new Error(`assemblePlugin: output directory ${out} contains the repository root`);
  }
  const manifest = join(repo, ".claude-plugin", "plugin.json");
  const skills = join(repo, "skills");
  const hooks = join(repo, "hooks", "hooks.json");
  const runner = resolve(repo, bundle);
  for (const [what, path] of [["plugin manifest", manifest], ["hooks file", hooks], ["bundle", runner]]) {
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`assemblePlugin: ${what} not found: ${path}`);
  }
  if (!existsSync(skills) || !statSync(skills).isDirectory()) {
    throw new Error(`assemblePlugin: skills directory not found: ${skills}`);
  }

  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, ".claude-plugin"), { recursive: true });
  mkdirSync(join(out, "dist"), { recursive: true });
  mkdirSync(join(out, "hooks"), { recursive: true });
  cpSync(manifest, join(out, ".claude-plugin", "plugin.json"));
  // Claude Code finds hooks/hooks.json at the plugin root by itself; plugin.json needs no "hooks" key.
  cpSync(hooks, join(out, "hooks", "hooks.json"));
  cpSync(skills, join(out, "skills"), { recursive: true, filter: (src) => basename(src) !== ".DS_Store" });
  cpSync(runner, join(out, "dist", "arbab.mjs"));
}
