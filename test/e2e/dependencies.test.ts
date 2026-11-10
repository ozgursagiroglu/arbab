// 0.3.0 worktree preparation end to end (DESIGN.md §22): dependencies cloned from the main checkout while its manifests
// match the install point, the fallback once they drift, and install: false, through real shepherds on this machine
// (clonefile or cp on macOS, cp elsewhere) and the fake claude.
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildBundle, fakeFixture, makeE2eProject, type E2eProject } from "./harness";

let bundle: { bundle: string; checkBundle: string; dispose(): void };
let p: E2eProject | undefined;

beforeAll(async () => {
  bundle = await buildBundle();
}, 60_000);
afterAll(() => bundle?.dispose());
afterEach(() => {
  p?.dispose();
  p = undefined;
});

// Appends the directory it runs in (the worktree) to the file its first argument names: the marker of an install.
const MARKER_SCRIPT = 'require("node:fs").appendFileSync(process.argv[2], process.cwd() + "\\n");\n';

/**
 * A package.json, a package-lock.json, an ignored node_modules/ with a few files, an executable and a relative
 * symlink, and `dependencies` in the config, all committed but node_modules. Returns the marker file's path.
 */
function npmProject(project: E2eProject, dependencies: (marker: string[]) => Record<string, unknown>): string {
  const marker = join(project.dir, "installs.log");
  writeFileSync(join(project.dir, "marker.cjs"), MARKER_SCRIPT);
  const install = [process.execPath, join(project.dir, "marker.cjs"), marker];
  const path = join(project.root, "arbab.config.json");
  const config = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  writeFileSync(path, JSON.stringify({ ...config, dependencies: dependencies(install) }, null, 2));
  writeFileSync(join(project.root, "package.json"), JSON.stringify({ name: "demo", version: "1.0.0", dependencies: { "left-pad": "1.3.0" } }, null, 2));
  writeFileSync(
    join(project.root, "package-lock.json"),
    JSON.stringify({ name: "demo", lockfileVersion: 3, packages: { "node_modules/left-pad": { version: "1.3.0" } } }, null, 2),
  );
  writeFileSync(join(project.root, ".gitignore"), "node_modules/\n");
  project.git(["add", "-A"]);
  project.git(["commit", "-q", "-m", "npm project"]);

  const modules = join(project.root, "node_modules");
  mkdirSync(join(modules, "left-pad", "lib"), { recursive: true });
  mkdirSync(join(modules, ".bin"));
  writeFileSync(join(modules, "left-pad", "package.json"), '{"name":"left-pad","version":"1.3.0","bin":"cli.js"}\n');
  writeFileSync(join(modules, "left-pad", "lib", "index.js"), "module.exports = (s, n) => s.padStart(n);\n");
  writeFileSync(join(modules, "left-pad", "cli.js"), "#!/usr/bin/env node\nconsole.log(require('./lib')(process.argv[2], 8));\n");
  chmodSync(join(modules, "left-pad", "cli.js"), 0o755);
  symlinkSync(join("..", "left-pad", "cli.js"), join(modules, ".bin", "left-pad"));
  expect(project.git(["status", "--porcelain"])).toBe("");
  return marker;
}

/** Every entry under `dir`, sorted: its kind, mode and content, or a link's target. */
function tree(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(dir, rel)).sort()) {
    const path = join(rel, name);
    const st = lstatSync(join(dir, path));
    const mode = (st.mode & 0o777).toString(8);
    if (st.isSymbolicLink()) out.push(`link ${path} -> ${readlinkSync(join(dir, path))}`);
    else if (st.isDirectory()) out.push(`dir ${path} ${mode}`, ...tree(dir, path));
    else out.push(`file ${path} ${mode} ${readFileSync(join(dir, path), "utf8")}`);
  }
  return out;
}

const installs = (marker: string): string[] => (existsSync(marker) ? readFileSync(marker, "utf8").split("\n").filter((l) => l !== "") : []);

async function launchAndWait(project: E2eProject, lanePath: string, lane: string): Promise<void> {
  const launch = await project.cli("launch", lanePath);
  expect(launch.code, launch.stderr).toBe(0);
  const wait = await project.cli("wait", "--any", "--timeout-min", "2", "--json", lane);
  expect(wait.code, wait.stderr).toBe(0);
  expect((JSON.parse(wait.stdout) as { finished: unknown[] }).finished).toEqual([expect.objectContaining({ lane, attempt: 1, endState: "success" })]);
}

describe("worktree preparation end to end", () => {
  it("clones node_modules while the manifests match, and runs the fallback once package-lock.json drifts", async () => {
    p = makeE2eProject(bundle.bundle);
    const project = p;
    const marker = npmProject(project, (fallback) => ({ strategy: "clone", paths: ["node_modules"], fallback }));
    project.scenario({ fixture: fakeFixture("success-report") });
    const main = tree(join(project.root, "node_modules"));
    expect(main).toContain("link .bin/left-pad -> ../left-pad/cli.js");
    expect(main).toContain(`file left-pad/cli.js 755 ${readFileSync(join(project.root, "node_modules", "left-pad", "cli.js"), "utf8")}`);

    await launchAndWait(project, project.lane("cloned"), "cloned");
    const cloned = join(project.worktreeRoot, "cloned", "node_modules");
    expect(lstatSync(cloned).isDirectory()).toBe(true);
    expect(tree(cloned)).toEqual(main);
    expect(installs(marker)).toEqual([]);
    // Ignored in the worktree too: the checkpoint left it out.
    expect(project.git(["ls-tree", "-r", "--name-only", "refs/heads/arbab/cloned"])).not.toContain("node_modules");

    // Uncommitted, after the lane file is committed: the main checkout's node_modules no longer matches the install point.
    const lanePath = project.lane("drifted");
    const lock = join(project.root, "package-lock.json");
    writeFileSync(lock, readFileSync(lock, "utf8").replace('"1.3.0"', '"1.3.1"'));
    expect(project.git(["status", "--porcelain"])).toBe(" M package-lock.json\n");
    await launchAndWait(project, lanePath, "drifted");
    const drifted = join(project.worktreeRoot, "drifted");
    expect(installs(marker)).toEqual([drifted]);
    expect(existsSync(join(drifted, "node_modules"))).toBe(false);
  }, 240_000);

  it("skips the install for a lane with install: false, and still prepares its worktree", async () => {
    p = makeE2eProject(bundle.bundle);
    const project = p;
    const marker = npmProject(project, (command) => ({ strategy: "command", command }));
    project.scenario({ fixture: fakeFixture("success-report") });

    // The same command does install for a lane that does not opt out.
    await launchAndWait(project, project.lane("installs"), "installs");
    expect(installs(marker)).toEqual([join(project.worktreeRoot, "installs")]);

    await launchAndWait(project, project.lane("reads", undefined, { install: false }), "reads");
    const worktree = join(project.worktreeRoot, "reads");
    expect(existsSync(join(worktree, "package-lock.json"))).toBe(true);
    expect(project.git(["symbolic-ref", "--short", "HEAD"], worktree).trim()).toBe("arbab/reads");
    expect(installs(marker)).toEqual([join(project.worktreeRoot, "installs")]);
    expect(project.calls().map((c) => c.cwd)).toEqual([join(project.worktreeRoot, "installs"), worktree]);
  }, 240_000);
});
