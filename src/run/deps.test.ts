import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DependencyContext, DependencyStrategy } from "../types";
import { ArbabError } from "../util/errors";
import type { CloneDeps } from "./clone";
import {
  copyCommandDirs,
  DEPENDENCY_MANIFESTS,
  dependencyEnv,
  installRelevantChange,
  installRelevantPaths,
  isDependencyManifest,
  manifestDrift,
  prepareDependencies,
  runArgv,
  type ArgvRunner,
} from "./deps";
import { makeGitRunner, type GitRunner } from "./git";

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "arbab-deps-")));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("prepareDependencies", () => {
  it("does nothing for strategy none", () => {
    const run: ArgvRunner = () => {
      throw new Error("must not run");
    };
    expect(prepareDependencies({ strategy: "none" }, dir, run)).toEqual({ ok: true, code: 0, output: "" });
  });
  it("runs the command argv in the worktree", () => {
    const calls: Array<[string[], string]> = [];
    const run: ArgvRunner = (argv, cwd) => {
      calls.push([argv, cwd]);
      return { code: 0, output: "installed" };
    };
    const r = prepareDependencies({ strategy: "command", command: ["pnpm", "install", "--offline"] }, dir, run);
    expect(r).toEqual({ ok: true, code: 0, output: "installed" });
    expect(calls).toEqual([[["pnpm", "install", "--offline"], dir]]);
  });
  it("reports a failing command", () => {
    const r = prepareDependencies({ strategy: "command", command: ["x"] }, dir, () => ({ code: 3, output: "boom" }));
    expect(r).toEqual({ ok: false, code: 3, output: "boom" });
  });
  it("rejects an empty or malformed command and unknown strategies", () => {
    const run: ArgvRunner = () => ({ code: 0, output: "" });
    expect(() => prepareDependencies({ strategy: "command", command: [] }, dir, run)).toThrow(ArbabError);
    expect(() => prepareDependencies({ strategy: "command", command: [""] }, dir, run)).toThrow(ArbabError);
    const bad = { strategy: "copy" } as unknown as DependencyStrategy;
    expect(() => prepareDependencies(bad, dir, run)).toThrow(/unknown dependencies strategy/);
  });
});

// Isolated from the user's global and system git config.
function isolatedGit(home: string): GitRunner {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"]) delete env[key];
  return makeGitRunner({
    ...env,
    HOME: home,
    XDG_CONFIG_HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(home, "gitconfig"),
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  });
}

const PKG = JSON.stringify({ name: "demo", scripts: { test: "vitest" }, dependencies: { "left-pad": "1.0.0" } }, null, 2) + "\n";

/** A main checkout with one commit (package.json, package-lock.json, src/a.ts) and node_modules ignored. */
function mainCheckout(): { root: string; git: GitRunner; head: string } {
  const root = join(dir, "main");
  const git = isolatedGit(dir);
  const ok = (args: string[]): string => {
    const r = git(args, root);
    if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout;
  };
  mkdirSync(join(root, "src"), { recursive: true });
  ok(["init", "-q", "-b", "main"]);
  writeFileSync(join(root, ".gitignore"), "node_modules/\n");
  writeFileSync(join(root, "package.json"), PKG);
  writeFileSync(join(root, "package-lock.json"), '{"lockfileVersion":3}\n');
  writeFileSync(join(root, "src", "a.ts"), "export {};\n");
  ok(["add", "-A"]);
  ok(["commit", "-q", "-m", "init"]);
  return { root, git, head: ok(["rev-parse", "HEAD"]).trim() };
}

describe("manifestDrift", () => {
  it("finds nothing when the working tree matches the install point, ignored node_modules and plain sources aside", () => {
    const m = mainCheckout();
    mkdirSync(join(m.root, "node_modules", "x"), { recursive: true });
    writeFileSync(join(m.root, "node_modules", "x", "package.json"), "{}");
    writeFileSync(join(m.root, "src", "a.ts"), "export const a = 1;\n");
    writeFileSync(join(m.root, "src", "b.ts"), "export {};\n");
    expect(manifestDrift({ projectRoot: m.root, installedAt: m.head, git: m.git })).toEqual([]);
  });

  it("lists a dependency change, staged or not, and not a scripts-only change", () => {
    const m = mainCheckout();
    const ctx = { projectRoot: m.root, installedAt: m.head, git: m.git };
    writeFileSync(join(m.root, "package.json"), PKG.replace('"test": "vitest"', '"test": "vitest run", "build": "tsc"'));
    expect(manifestDrift(ctx)).toEqual([]);
    writeFileSync(join(m.root, "package.json"), PKG.replace("1.0.0", "2.0.0"));
    expect(manifestDrift(ctx)).toEqual(["package.json"]);
    expect(m.git(["add", "package.json"], m.root).code).toBe(0);
    expect(manifestDrift(ctx)).toEqual(["package.json"]);
  });

  it("lists a lockfile change and an untracked lockfile or package.json, sorted and once each", () => {
    const m = mainCheckout();
    writeFileSync(join(m.root, "package-lock.json"), '{"lockfileVersion":3,"packages":{}}\n');
    writeFileSync(join(m.root, "yarn.lock"), "# yarn\n");
    mkdirSync(join(m.root, "web"));
    writeFileSync(join(m.root, "web", "package.json"), "{}\n");
    expect(manifestDrift({ projectRoot: m.root, installedAt: m.head, git: m.git })).toEqual(["package-lock.json", "web/package.json", "yarn.lock"]);
  });

  it("lists a manifest deleted from the working tree", () => {
    const m = mainCheckout();
    rmSync(join(m.root, "package.json"));
    expect(manifestDrift({ projectRoot: m.root, installedAt: m.head, git: m.git })).toEqual(["package.json"]);
  });

  it("compares against the install point, not HEAD", () => {
    const m = mainCheckout();
    writeFileSync(join(m.root, "package.json"), PKG.replace("1.0.0", "2.0.0"));
    expect(m.git(["commit", "-q", "-am", "bump"], m.root).code).toBe(0);
    expect(manifestDrift({ projectRoot: m.root, installedAt: m.head, git: m.git })).toEqual(["package.json"]);
  });

  it("counts a failed git, or an install point that is no revision, as drift", () => {
    const m = mainCheckout();
    const drift = manifestDrift({ projectRoot: m.root, installedAt: "0".repeat(40), git: m.git });
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatch(/^<git failed: git diff --name-only -z --no-renames --no-ext-diff 0{40} -- \(128\): .+>$/);
    const failing: GitRunner = (args) => (args[0] === "ls-files" ? { code: 1, stdout: "", stderr: "boom" } : { code: 0, stdout: "", stderr: "" });
    expect(manifestDrift({ projectRoot: m.root, installedAt: m.head, git: failing })).toEqual(["<git failed: git ls-files --others --exclude-standard -z (1): boom>"]);
    expect(manifestDrift({ projectRoot: m.root, installedAt: "--output=x", git: m.git })).toEqual(['<git failed: "--output=x" is not a revision>']);
  });
});

describe("prepareDependencies: clone (DESIGN.md §22)", () => {
  interface Call {
    argv: string[];
    cwd: string;
  }
  /** A runner that makes every clone's destination (its last argument) and answers installs with "installed". */
  const runner = (calls: Call[], clone = { code: 0, output: "" }): ArgvRunner => (argv, cwd) => {
    calls.push({ argv, cwd });
    if (argv[0] === "python3" || argv[0] === "cp") {
      if (clone.code === 0) mkdirSync(argv.at(-1) ?? "", { recursive: true });
      return clone;
    }
    return { code: 0, output: "installed" };
  };
  const linux = (run: ArgvRunner): CloneDeps => ({ platform: "linux", run });
  const strategy = (over: Partial<{ paths: string[]; fallback: string[] | null }> = {}): DependencyStrategy => ({
    strategy: "clone",
    paths: ["node_modules"],
    fallback: ["npm", "ci"],
    ...over,
  });

  let m: { root: string; git: GitRunner; head: string };
  let wt: string;
  let ctx: DependencyContext;
  beforeEach(() => {
    m = mainCheckout();
    mkdirSync(join(m.root, "node_modules", "a"), { recursive: true });
    mkdirSync(join(m.root, "web", "node_modules"), { recursive: true });
    wt = join(dir, "wt");
    mkdirSync(join(wt, "web"), { recursive: true });
    ctx = { projectRoot: m.root, installedAt: m.head, git: m.git };
  });

  it("clones every path in order and says how", () => {
    const calls: Call[] = [];
    const run = runner(calls);
    const r = prepareDependencies(strategy({ paths: ["node_modules", "web/node_modules"] }), wt, run, ctx, linux(run));
    expect(r).toEqual({ ok: true, code: 0, output: "cloned node_modules (cp)\ncloned web/node_modules (cp)" });
    expect(calls.map((c) => c.argv)).toEqual([
      ["cp", "-a", "--reflink=auto", join(m.root, "node_modules"), join(wt, "node_modules")],
      ["cp", "-a", "--reflink=auto", join(m.root, "web", "node_modules"), join(wt, "web", "node_modules")],
    ]);
  });

  it("clones with clonefile on macOS", () => {
    const calls: Call[] = [];
    const run = runner(calls);
    const r = prepareDependencies(strategy(), wt, run, ctx, { platform: "darwin", run });
    expect(r).toEqual({ ok: true, code: 0, output: "cloned node_modules (clonefile)" });
    expect(calls.map((c) => c.argv[0])).toEqual(["python3"]);
  });

  it("treats a missing context as drift", () => {
    const calls: Call[] = [];
    const run = runner(calls);
    const r = prepareDependencies(strategy(), wt, run, undefined, linux(run));
    expect(r).toEqual({
      ok: true,
      code: 0,
      output: "dependencies.clone: the main checkout's manifests differ from the install point: no install context; running dependencies.fallback\ninstalled",
    });
    expect(calls).toEqual([{ argv: ["npm", "ci"], cwd: wt }]);
    expect(prepareDependencies(strategy({ fallback: null }), wt, run, undefined, linux(run))).toMatchObject({ ok: false, code: 1 });
  });

  it("runs the fallback on drift, and fails naming the difference without one", () => {
    writeFileSync(join(m.root, "yarn.lock"), "# yarn\n");
    const calls: Call[] = [];
    const run = runner(calls);
    const r = prepareDependencies(strategy(), wt, run, ctx, linux(run));
    expect(r).toMatchObject({ ok: true, code: 0, output: expect.stringMatching(/differ from [0-9a-f]{40}: yarn\.lock; running dependencies\.fallback\ninstalled$/) });
    expect(calls.map((c) => c.argv)).toEqual([["npm", "ci"]]);
    expect(prepareDependencies(strategy({ fallback: null }), wt, run, ctx, linux(run))).toEqual({
      ok: false,
      code: 1,
      output: `dependencies.clone: the main checkout's manifests differ from ${m.head}: yarn.lock; set dependencies.fallback to install instead`,
    });
    expect(existsSync(join(wt, "node_modules"))).toBe(false);
  });

  it("passes on a failed fallback", () => {
    const r = prepareDependencies(strategy(), wt, () => ({ code: 5, output: "no network" }), undefined, linux(runner([])));
    expect(r).toMatchObject({ ok: false, code: 5, output: expect.stringMatching(/no network$/) });
  });

  it("falls back, before any clone, when a source is missing or not a directory", () => {
    writeFileSync(join(m.root, "vendor"), "a file\n");
    for (const [missing, reason] of [
      ["gone", "gone does not exist in the main checkout"],
      ["vendor", "vendor is not a directory in the main checkout"],
    ]) {
      const calls: Call[] = [];
      const run = runner(calls);
      const r = prepareDependencies(strategy({ paths: ["node_modules", missing ?? ""] }), wt, run, ctx, linux(run));
      expect(r.output).toBe(`dependencies.clone: ${reason}; running dependencies.fallback\ninstalled`);
      expect(calls.map((c) => c.argv)).toEqual([["npm", "ci"]]);
      const none = prepareDependencies(strategy({ paths: [missing ?? ""], fallback: null }), wt, run, ctx, linux(run));
      expect(none).toEqual({ ok: false, code: 1, output: `dependencies.clone: ${reason}; set dependencies.fallback to install instead` });
    }
  });

  it("refuses a source link that leads out of the main checkout, without the fallback", () => {
    const outside = join(dir, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(m.root, "linked"));
    symlinkSync(join(m.root, "node_modules"), join(m.root, "inner"));
    const calls: Call[] = [];
    const run = runner(calls);
    const r = prepareDependencies(strategy({ paths: ["node_modules", "linked"] }), wt, run, ctx, linux(run));
    expect(r).toEqual({ ok: false, code: 1, output: `dependencies.clone: linked in the main checkout leads to ${outside}, outside ${m.root}` });
    expect(calls).toEqual([]);
    // A link that stays inside clones its target.
    const inner = prepareDependencies(strategy({ paths: ["inner"] }), wt, run, ctx, linux(run));
    expect(inner.ok).toBe(true);
    expect(calls.map((c) => c.argv.slice(-2))).toEqual([[join(m.root, "node_modules"), join(wt, "inner")]]);
  });

  it("refuses a destination that exists, a dangling link included, without the fallback", () => {
    symlinkSync(join(dir, "nowhere"), join(wt, "node_modules"));
    const calls: Call[] = [];
    const run = runner(calls);
    const r = prepareDependencies(strategy(), wt, run, ctx, linux(run));
    expect(r).toEqual({ ok: false, code: 1, output: `dependencies.clone: ${join(wt, "node_modules")} already exists in the worktree` });
    expect(calls).toEqual([]);
  });

  it("refuses a destination whose parent leads out of the worktree", () => {
    rmSync(join(wt, "web"), { recursive: true });
    mkdirSync(join(dir, "elsewhere"));
    symlinkSync(join(dir, "elsewhere"), join(wt, "web"));
    const calls: Call[] = [];
    const run = runner(calls);
    const r = prepareDependencies(strategy({ paths: ["web/node_modules"] }), wt, run, ctx, linux(run));
    expect(r).toMatchObject({ ok: false, code: 1, output: expect.stringMatching(/web\/node_modules would be cloned through .*elsewhere, outside the worktree/) });
    expect(calls).toEqual([]);
  });

  it("fails a clone that fails, keeping what it cloned before and running no fallback", () => {
    const calls: Call[] = [];
    let n = 0;
    const run: ArgvRunner = (argv, cwd) => {
      calls.push({ argv, cwd });
      if (++n === 1) {
        mkdirSync(argv.at(-1) ?? "", { recursive: true });
        return { code: 0, output: "" };
      }
      return { code: 1, output: "cp: No space left on device\n" };
    };
    const r = prepareDependencies(strategy({ paths: ["node_modules", "web/node_modules"] }), wt, run, ctx, linux(run));
    expect(r).toEqual({
      ok: false,
      code: 1,
      output: "dependencies.clone: cloned node_modules (cp)\ncloning web/node_modules failed (cp): cp: No space left on device",
    });
    expect(calls.map((c) => c.argv[0])).toEqual(["cp", "cp"]);
  });

  it("validates the fallback argv when it runs", () => {
    const bad = { strategy: "clone", paths: ["node_modules"], fallback: [""] } as DependencyStrategy;
    expect(() => prepareDependencies(bad, wt, runner([]), undefined, linux(runner([])))).toThrow(/dependencies.fallback must be/);
  });
});

describe("copyCommandDirs (DESIGN.md §23)", () => {
  let root: string;
  let wt: string;
  beforeEach(() => {
    root = join(dir, "main");
    mkdirSync(join(root, "node_modules", "a"), { recursive: true });
    mkdirSync(join(root, "web", "node_modules"), { recursive: true });
    mkdirSync(join(root, "api", "node_modules"), { recursive: true });
    writeFileSync(join(root, "README.md"), "x\n");
    wt = join(root, ".arbab", "worktrees", "lane");
    mkdirSync(join(wt, "web"), { recursive: true });
  });
  const nm = (): string => join(root, "node_modules");

  it("recognises cp with R among R, c, a, p and P, in one or several short-flag words", () => {
    for (const flags of [["-R"], ["-Rc"], ["-cR"], ["-R", "-c"], ["-a", "-R"], ["-RpP"], ["-Rcap"]]) {
      expect(copyCommandDirs(["cp", ...flags, nm(), "node_modules"], root, wt), flags.join(" ")).toEqual([{ src: nm(), dst: join(wt, "node_modules") }]);
    }
    expect(copyCommandDirs(["/bin/cp", "-Rc", nm(), "node_modules"], root, wt)).toEqual([{ src: nm(), dst: join(wt, "node_modules") }]);
  });

  it("refuses cp without R, with any other flag, or with an option among the operands", () => {
    for (const argv of [
      ["cp", nm(), "node_modules"],
      ["cp", "-a", nm(), "node_modules"],
      ["cp", "-c", nm(), "node_modules"],
      ["cp", "-r", nm(), "node_modules"],
      ["cp", "-Rv", nm(), "node_modules"],
      ["cp", "-R", "-n", nm(), "node_modules"],
      ["cp", "--recursive", nm(), "node_modules"],
      ["cp", "-R", "--", nm(), "node_modules"],
      ["cp", "-R", nm(), "node_modules", "-v"],
      ["cp", "-R", nm()],
      ["cp", "-R", "", "node_modules"],
      ["/usr/local/bin/cp", "-R", nm(), "node_modules"],
      ["gcp", "-R", nm(), "node_modules"],
    ]) {
      expect(copyCommandDirs(argv, root, wt), argv.join(" ")).toBeNull();
    }
  });

  it("recognises ditto with no flags and one source", () => {
    expect(copyCommandDirs(["ditto", nm(), "node_modules"], root, wt)).toEqual([{ src: nm(), dst: join(wt, "node_modules") }]);
    expect(copyCommandDirs(["ditto", "--rsrc", nm(), "node_modules"], root, wt)).toBeNull();
    // ditto merges several sources into one destination: not one clone each.
    expect(copyCommandDirs(["ditto", nm(), join(root, "web", "node_modules"), "deps"], root, wt)).toBeNull();
  });

  it("recognises rsync with exactly -a, optionally --delete, where rsync puts each source", () => {
    expect(copyCommandDirs(["rsync", "-a", `${nm()}/`, "node_modules"], root, wt)).toEqual([{ src: nm(), dst: join(wt, "node_modules") }]);
    expect(copyCommandDirs(["rsync", "-a", "--delete", `${nm()}/`, "node_modules"], root, wt)).toEqual([{ src: nm(), dst: join(wt, "node_modules") }]);
    expect(copyCommandDirs(["rsync", "--delete", "-a", nm(), "deps"], root, wt)).toEqual([{ src: nm(), dst: join(wt, "deps", "node_modules") }]);
    for (const argv of [
      ["rsync", nm(), "node_modules"],
      ["rsync", "-av", nm(), "node_modules"],
      ["rsync", "-a", "-a", nm(), "node_modules"],
      ["rsync", "-a", "--exclude=x", nm(), "node_modules"],
      ["rsync", "-a", nm(), "host:node_modules"],
      ["rsync", "-a", `${nm()}/`, `${join(root, "web", "node_modules")}/`, "deps"],
    ]) {
      expect(copyCommandDirs(argv, root, wt), argv.join(" ")).toBeNull();
    }
  });

  it("recognises cp only with one source and a destination whose parent exists, as cp itself requires", () => {
    const api = join(root, "api");
    // cp refuses several sources unless the destination is an existing directory, where it copies into it.
    expect(copyCommandDirs(["cp", "-R", nm(), api, "deps"], root, wt)).toBeNull();
    expect(copyCommandDirs(["cp", "-R", nm(), api, "web"], root, wt)).toBeNull();
    expect(copyCommandDirs(["cp", "-R", nm(), "web"], root, wt)).toBeNull();
    // cp makes no parent directory.
    expect(copyCommandDirs(["cp", "-R", nm(), "missing/node_modules"], root, wt)).toBeNull();
    expect(copyCommandDirs(["cp", "-R", nm(), "web/node_modules"], root, wt)).toEqual([{ src: nm(), dst: join(wt, "web", "node_modules") }]);
    // A parent that is a file is no directory either.
    writeFileSync(join(wt, "file"), "x\n");
    expect(copyCommandDirs(["cp", "-R", nm(), "file/node_modules"], root, wt)).toBeNull();
    // A trailing slash on the one source changes nothing: the destination does not exist.
    expect(copyCommandDirs(["cp", "-R", `${nm()}/`, "node_modules"], root, wt)).toEqual([{ src: nm(), dst: join(wt, "node_modules") }]);
  });

  it("takes a relative source from the worktree, the command's directory", () => {
    expect(copyCommandDirs(["cp", "-Rc", "../../../node_modules", "node_modules"], root, wt)).toEqual([{ src: nm(), dst: join(wt, "node_modules") }]);
    expect(copyCommandDirs(["cp", "-R", "../../../web/node_modules", "web/node_modules"], root, wt)).toEqual([
      { src: join(root, "web", "node_modules"), dst: join(wt, "web", "node_modules") },
    ]);
  });

  it("refuses a source outside the project, a link, a file, a missing one and the root itself", () => {
    const outside = join(dir, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(root, "linked"));
    symlinkSync(nm(), join(root, "inner"));
    mkdirSync(join(root, "vendor"));
    symlinkSync(outside, join(root, "vendor", "via"));
    for (const src of [outside, join(root, "linked"), join(root, "inner"), join(root, "README.md"), join(root, "gone"), root]) {
      expect(copyCommandDirs(["cp", "-R", src, "node_modules"], root, wt), src).toBeNull();
    }
    // A link on the way that leads out: the real path decides.
    mkdirSync(join(outside, "node_modules"));
    expect(copyCommandDirs(["cp", "-R", join(root, "vendor", "via", "node_modules"), "node_modules"], root, wt)).toBeNull();
  });

  it("refuses a destination that is absolute, escapes the worktree or is the worktree, or whose parent leads out", () => {
    mkdirSync(join(dir, "elsewhere"));
    symlinkSync(join(dir, "elsewhere"), join(wt, "out"));
    for (const dst of [join(wt, "node_modules"), "../node_modules", "../../../x", ".", "out/node_modules"]) {
      expect(copyCommandDirs(["cp", "-R", nm(), dst], root, wt), dst).toBeNull();
    }
    symlinkSync(join(dir, "nowhere"), join(wt, "dangling"));
    expect(copyCommandDirs(["cp", "-R", nm(), "dangling"], root, wt)).toBeNull();
  });

  it("refuses a source that holds the destination", () => {
    expect(copyCommandDirs(["cp", "-R", join(root, ".arbab"), "copy"], root, wt)).toBeNull();
  });

  it("returns null for any other command, and when the root or the worktree does not resolve", () => {
    expect(copyCommandDirs(["npm", "ci"], root, wt)).toBeNull();
    expect(copyCommandDirs(["sh", "-c", `cp -R ${nm()} node_modules`], root, wt)).toBeNull();
    expect(copyCommandDirs(["cp", "-R", nm(), "node_modules"], join(dir, "missing"), wt)).toBeNull();
    expect(copyCommandDirs(["cp", "-R", nm(), "node_modules"], root, join(dir, "missing"))).toBeNull();
  });
});

describe("prepareDependencies: command (DESIGN.md §23)", () => {
  interface Call {
    argv: string[];
    cwd: string;
    env: Record<string, string> | undefined;
  }
  let m: { root: string; git: GitRunner; head: string };
  let wt: string;
  let ctx: DependencyContext;
  beforeEach(() => {
    m = mainCheckout();
    mkdirSync(join(m.root, "node_modules", "a"), { recursive: true });
    mkdirSync(join(m.root, "web", "node_modules"), { recursive: true });
    wt = join(dir, "wt");
    mkdirSync(wt);
    ctx = { projectRoot: m.root, installedAt: m.head, git: m.git, runner: "/plugin/dist/arbab.mjs" };
  });
  /** Clones (cp, python3) make their destination unless `failAt` is their 1-based number; anything else "installed". */
  const runner = (calls: Call[], failAt = 0): ArgvRunner => {
    let clones = 0;
    return (argv, cwd, env) => {
      calls.push({ argv, cwd, env });
      if (argv[0] !== "python3" && !(argv[0] === "cp" && argv[1] === "-a")) return { code: 0, output: "installed" };
      if (++clones === failAt) {
        mkdirSync(join(argv.at(-1) ?? "", "partial"), { recursive: true });
        return { code: 1, output: "cp: No space left on device\n" };
      }
      mkdirSync(argv.at(-1) ?? "", { recursive: true });
      return { code: 0, output: "" };
    };
  };
  const linux = (run: ArgvRunner): CloneDeps => ({ platform: "linux", run });

  it("clones what a recognised copy would copy, without running it, and says how", () => {
    const calls: Call[] = [];
    const run = runner(calls);
    const command = ["rsync", "-a", join(m.root, "node_modules"), join(m.root, "web"), "deps"];
    const r = prepareDependencies({ strategy: "command", command }, wt, run, ctx, linux(run));
    expect(r).toEqual({ ok: true, code: 0, output: "cloned deps/node_modules (cp)\ncloned deps/web (cp)" });
    expect(calls.map((c) => c.argv)).toEqual([
      ["cp", "-a", "--reflink=auto", join(m.root, "node_modules"), join(wt, "deps", "node_modules")],
      ["cp", "-a", "--reflink=auto", join(m.root, "web"), join(wt, "deps", "web")],
    ]);
  });

  it("clones a single copy with clonefile on macOS, with no manifest check", () => {
    // A manifest that differs from the install point stops the clone strategy, not a copy the command would make.
    writeFileSync(join(m.root, "yarn.lock"), "# yarn\n");
    const calls: Call[] = [];
    const run = runner(calls);
    const r = prepareDependencies({ strategy: "command", command: ["cp", "-Rc", join(m.root, "node_modules"), "node_modules"] }, wt, run, ctx, { platform: "darwin", run });
    expect(r).toEqual({ ok: true, code: 0, output: "cloned node_modules (clonefile)" });
    expect(calls.map((c) => c.argv[0])).toEqual(["python3"]);
    expect(existsSync(join(wt, "node_modules"))).toBe(true);
  });

  it("removes what it made when a clone fails, then runs the command itself", () => {
    const calls: Call[] = [];
    const run = runner(calls, 2);
    const command = ["rsync", "-a", join(m.root, "node_modules"), join(m.root, "web"), "deps"];
    const r = prepareDependencies({ strategy: "command", command }, wt, run, ctx, linux(run));
    expect(r).toEqual({
      ok: true,
      code: 0,
      output: "dependencies.command: cloning deps/web failed (cp): cp: No space left on device; running the command\ninstalled",
    });
    expect(calls.map((c) => c.argv[0])).toEqual(["cp", "cp", "rsync"]);
    expect(calls.at(-1)?.argv).toEqual(command);
    expect(existsSync(join(wt, "deps"))).toBe(false);
  });

  it("keeps what was there before a failed clone", () => {
    mkdirSync(join(wt, "web"));
    writeFileSync(join(wt, "web", "keep.ts"), "x\n");
    const calls: Call[] = [];
    const run = runner(calls, 1);
    const r = prepareDependencies({ strategy: "command", command: ["cp", "-R", join(m.root, "web", "node_modules"), "web/node_modules"] }, wt, run, ctx, linux(run));
    expect(r.output).toMatch(/^dependencies\.command: cloning web\/node_modules failed \(cp\): .*; running the command\ninstalled$/);
    expect(existsSync(join(wt, "web", "node_modules"))).toBe(false);
    expect(existsSync(join(wt, "web", "keep.ts"))).toBe(true);
  });

  it("runs any other command as given, and passes on its failure", () => {
    const calls: Call[] = [];
    const r = prepareDependencies({ strategy: "command", command: ["/bin/sh", "deps.sh"] }, wt, runner(calls), ctx, linux(runner([])));
    expect(r).toEqual({ ok: true, code: 0, output: "installed" });
    expect(calls.map((c) => [c.argv, c.cwd])).toEqual([[["/bin/sh", "deps.sh"], wt]]);
    expect(prepareDependencies({ strategy: "command", command: ["x"] }, wt, () => ({ code: 3, output: "boom" }), ctx)).toEqual({ ok: false, code: 3, output: "boom" });
  });

  it("gives every dependency command ARBAB_RUNNER and ARBAB_PROJECT_ROOT", () => {
    const calls: Call[] = [];
    prepareDependencies({ strategy: "command", command: ["npm", "ci"] }, wt, runner(calls), ctx);
    // The clone strategy's fallback too.
    writeFileSync(join(m.root, "yarn.lock"), "# yarn\n");
    const run = runner(calls);
    prepareDependencies({ strategy: "clone", paths: ["node_modules"], fallback: ["npm", "ci"] }, wt, run, ctx, linux(run));
    const env = { ARBAB_RUNNER: "/plugin/dist/arbab.mjs", ARBAB_PROJECT_ROOT: m.root };
    expect(calls).toEqual([
      { argv: ["npm", "ci"], cwd: wt, env },
      { argv: ["npm", "ci"], cwd: wt, env },
    ]);
    // Without a runner, the project root alone; without a context, nothing.
    const { runner: _, ...bare } = ctx;
    expect(dependencyEnv(bare)).toEqual({ ARBAB_PROJECT_ROOT: m.root });
    expect(dependencyEnv(undefined)).toEqual({});
  });

  it("reaches a real command's environment, over the process environment", () => {
    const r = prepareDependencies(
      { strategy: "command", command: [process.execPath, "-e", "process.stdout.write([process.env.ARBAB_RUNNER, process.env.ARBAB_PROJECT_ROOT, typeof process.env.PATH].join('|'))"] },
      wt,
      runArgv,
      ctx,
    );
    expect(r).toEqual({ ok: true, code: 0, output: `/plugin/dist/arbab.mjs|${m.root}|string` });
  });
});

describe("isDependencyManifest", () => {
  it("matches every manifest by its last segment, at any depth and in any case", () => {
    for (const name of DEPENDENCY_MANIFESTS) {
      expect(isDependencyManifest(name), name).toBe(true);
      expect(isDependencyManifest(`a/b/${name}`), name).toBe(true);
      expect(isDependencyManifest(name.toUpperCase()), name).toBe(true);
    }
  });

  it("matches npm's own lockfile, npm-shrinkwrap.json", () => {
    expect(isDependencyManifest("npm-shrinkwrap.json")).toBe(true);
    expect(isDependencyManifest("pkgs/web/npm-shrinkwrap.json")).toBe(true);
  });

  it("matches bun's and yarn PnP's install files", () => {
    for (const path of ["bunfig.toml", "sub/BunFig.toml", ".pnp.cjs", "a/.pnp.loader.mjs"]) {
      expect(isDependencyManifest(path), path).toBe(true);
    }
  });

  it("matches every patch file, at any depth and in any case", () => {
    for (const path of ["fix.PATCH", "patches/left-pad+1.0.0.patch", ".yarn/patches/a.patch", "a/b/c.patch"]) {
      expect(isDependencyManifest(path), path).toBe(true);
    }
  });

  it("matches every file under .yarn/releases, .yarn/plugins and .yarn/patches, at any depth and in any case", () => {
    for (const path of [".YARN/Releases/x.cjs", ".yarn/releases/yarn-4.0.0.cjs", "sub/.yarn/plugins/p.cjs", ".yarn/plugins/@yarnpkg/x.cjs", ".yarn/patches/a.diff"]) {
      expect(isDependencyManifest(path), path).toBe(true);
    }
  });

  it("does not match other names", () => {
    for (const path of [
      "package.json.bak",
      "mypackage.json",
      "package.json/x.ts",
      "src/npmrc",
      "pnpmfile.cjs",
      "shrinkwrap.json",
      "",
      "src/patcher.ts",
      "src/patch.ts",
      "fix.patch.md",
      ".yarn/cache/a.zip",
      ".yarn/releases",
      "yarn/releases/x.cjs",
      "src/releases/x.cjs",
      "pnp.cjs",
    ]) {
      expect(isDependencyManifest(path), path).toBe(false);
    }
  });
});

describe("installRelevantChange", () => {
  const pkg = (fields: Record<string, unknown>): string => JSON.stringify({ name: "x", version: "1.0.0", ...fields }, null, 2) + "\n";
  const FIELDS: Array<[string, unknown, unknown]> = [
    ["dependencies", { a: "1" }, { a: "2" }],
    ["devDependencies", { a: "1" }, { a: "1", b: "1" }],
    ["optionalDependencies", undefined, { a: "1" }],
    ["peerDependencies", { a: "1" }, undefined],
    ["bundledDependencies", ["a"], ["a", "b"]],
    ["bundleDependencies", true, false],
    ["overrides", { a: "1" }, { a: "2" }],
    ["resolutions", { a: "1" }, { a: "2" }],
    ["pnpm", { overrides: {} }, { overrides: { a: "1" } }],
    ["workspaces", ["pkgs/*"], ["pkgs/*", "apps/*"]],
    ["packageManager", "pnpm@9.0.0", "pnpm@9.1.0"],
    ["dependenciesMeta", { a: { injected: false } }, { a: { injected: true } }],
    ["peerDependenciesMeta", { a: { optional: false } }, { a: { optional: true } }],
    ["bin", "./cli.js", "./other.js"],
    ["bin", { x: "./x.js" }, { x: "./x.js", y: "./y.js" }],
    ["engines", { node: ">=20" }, { node: ">=22" }],
    ["os", ["darwin"], ["darwin", "linux"]],
    ["cpu", ["arm64"], ["x64"]],
    ["libc", ["glibc"], ["musl"]],
    ["trustedDependencies", ["a"], ["a", "b"]],
    ["devEngines", { runtime: { name: "node", version: "20" } }, { runtime: { name: "node", version: "22" } }],
  ];

  it("counts a change to every field an install reads", () => {
    for (const [field, before, after] of FIELDS) {
      expect(installRelevantChange("package.json", pkg({ [field]: before }), pkg({ [field]: after })), field).toBe(true);
      // Added where there was none counts as well.
      if (after !== undefined) expect(installRelevantChange("package.json", pkg({}), pkg({ [field]: after })), field).toBe(true);
    }
  });

  it("counts a change to every install-time script, and not to other scripts", () => {
    const scripts = ["preinstall", "install", "postinstall", "preprepare", "prepare", "postprepare", "prepublish", "dependencies", "pnpm:devPreinstall"];
    for (const script of scripts) {
      expect(installRelevantChange("package.json", pkg({ scripts: { test: "x" } }), pkg({ scripts: { test: "x", [script]: "node s.js" } })), script).toBe(true);
      expect(installRelevantChange("package.json", pkg({ scripts: { [script]: "a" } }), pkg({ scripts: { [script]: "b" } })), script).toBe(true);
    }
    expect(installRelevantChange("package.json", pkg({ scripts: { test: "x" } }), pkg({ scripts: { test: "y", build: "z" } }))).toBe(false);
    expect(installRelevantChange("package.json", pkg({}), pkg({ scripts: { test: "y" } }))).toBe(false);
    // A scripts value npm cannot read as scripts counts whole.
    expect(installRelevantChange("package.json", pkg({ scripts: "a" }), pkg({ scripts: "b" }))).toBe(true);
  });

  it("does not count an exports-only edit, a version bump or other fields, at any depth", () => {
    const before = pkg({ dependencies: { a: "1" }, exports: { ".": "./a.js" } });
    expect(installRelevantChange("package.json", before, pkg({ dependencies: { a: "1" }, exports: { ".": "./b.js", "./x": "./x.js" } }))).toBe(false);
    expect(installRelevantChange("pkgs/web/package.json", pkg({ version: "1.0.0" }), pkg({ version: "1.1.0" }))).toBe(false);
    for (const field of ["main", "types", "files", "description", "license", "type", "keywords"]) {
      expect(installRelevantChange("package.json", pkg({}), pkg({ [field]: "x" })), field).toBe(false);
    }
  });

  it("ignores formatting and key order", () => {
    const a = JSON.stringify({ dependencies: { a: "1", b: "2" }, name: "x" });
    const b = JSON.stringify({ name: "x", dependencies: { b: "2", a: "1" } }, null, 4);
    expect(installRelevantChange("package.json", a, b)).toBe(false);
  });

  it("counts a package.json that appears, disappears or does not parse", () => {
    expect(installRelevantChange("package.json", null, pkg({}))).toBe(true);
    expect(installRelevantChange("package.json", pkg({}), null)).toBe(true);
    expect(installRelevantChange("package.json", pkg({}), "{ not json")).toBe(true);
    expect(installRelevantChange("package.json", "{ not json", pkg({}))).toBe(true);
    expect(installRelevantChange("package.json", "[]", "[1]")).toBe(true);
    expect(installRelevantChange("Package.JSON", pkg({}), pkg({ dependencies: { a: "1" } }))).toBe(true);
  });

  it("counts any change to the other manifests, lockfiles included, and nothing that did not change", () => {
    for (const name of DEPENDENCY_MANIFESTS.filter((n) => n !== "package.json")) {
      expect(installRelevantChange(`a/${name}`, "x", "y"), name).toBe(true);
      expect(installRelevantChange(name, null, "y"), name).toBe(true);
      expect(installRelevantChange(name, "x", "x"), name).toBe(false);
    }
    expect(installRelevantChange("pnpm-lock.yaml", "lockfileVersion: '9.0'\n", "lockfileVersion: '9.0'\npackages: {}\n")).toBe(true);
    for (const path of ["patches/a+1.0.0.patch", ".yarn/releases/yarn-4.cjs", ".yarn/plugins/p.cjs", "bunfig.toml", ".pnp.cjs"]) {
      expect(installRelevantChange(path, "x", "y"), path).toBe(true);
    }
    expect(installRelevantChange("src/a.ts", "x", "y")).toBe(false);
    expect(installRelevantChange("src/patcher.ts", "x", "y")).toBe(false);
    expect(installRelevantChange("package.json", null, null)).toBe(false);
  });
});

describe("installRelevantPaths", () => {
  /** A git that knows the files of two commits, A and B. */
  const fakeGit = (files: Record<string, Record<string, string>>, calls: string[][] = []) => (args: string[]) => {
    calls.push(args);
    const spec = args.at(-1) ?? "";
    const [rev = "", path = ""] = spec.split(/:(.*)/s);
    const text = files[rev]?.[path];
    return text === undefined ? { code: 128, stdout: "", stderr: `fatal: path '${path}' does not exist in '${rev}'` } : { code: 0, stdout: text, stderr: "" };
  };

  it("keeps the manifests whose change an install sees, once each and sorted, reading only package.json", () => {
    const calls: string[][] = [];
    const git = fakeGit(
      {
        A: { "package.json": '{"version":"1"}', "web/package.json": '{"dependencies":{}}' },
        B: { "package.json": '{"version":"2"}', "web/package.json": '{"dependencies":{"a":"1"}}', "api/package.json": "{}" },
      },
      calls,
    );
    const paths = ["yarn.lock", "src/x.ts", "package.json", "web/package.json", "api/package.json", "yarn.lock"];
    expect(installRelevantPaths(git, "A", "B", paths)).toEqual(["api/package.json", "web/package.json", "yarn.lock"]);
    expect(calls.every((args) => args[0] === "show" && !(args.at(-1) ?? "").endsWith("yarn.lock"))).toBe(true);
    expect(calls).toContainEqual(["show", "--no-textconv", "A:web/package.json"]);
  });

  it("keeps patches and yarn's releases and plugins without reading them", () => {
    const calls: string[][] = [];
    const paths = ["src/patcher.ts", "fix.PATCH", "sub/.yarn/plugins/p.cjs", ".YARN/Releases/x.cjs", "bunfig.toml"];
    expect(installRelevantPaths(fakeGit({}, calls), "A", "B", paths)).toEqual([".YARN/Releases/x.cjs", "bunfig.toml", "fix.PATCH", "sub/.yarn/plugins/p.cjs"]);
    expect(calls).toEqual([]);
  });

  it("counts a package.json git shows at neither commit", () => {
    expect(installRelevantPaths(fakeGit({}), "A", "B", ["package.json"])).toEqual(["package.json"]);
  });
});

describe("runArgv", () => {
  it("runs without a shell in the given directory and joins stdout and stderr", () => {
    const r = runArgv(
      [process.execPath, "-e", "process.stdout.write(process.cwd()); process.stderr.write('|err'); process.exit(4)"],
      dir,
    );
    expect(r.code).toBe(4);
    expect(r.output).toMatch(/arbab-deps-.*\|err$/);
  });
  it("passes shell metacharacters through as plain arguments", () => {
    const r = runArgv([process.execPath, "-e", "process.stdout.write(process.argv[1])", "$(echo hi); ls"], dir);
    expect(r).toEqual({ code: 0, output: "$(echo hi); ls" });
  });
  it("reports an empty argv and a missing binary as 127", () => {
    expect(runArgv([], dir).code).toBe(127);
    expect(runArgv([join(dir, "missing")], dir).code).toBe(127);
  });
});
