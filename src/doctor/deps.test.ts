import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ArgvRunner } from "../run";
import type { DependencyStrategy } from "../types";
import { checkClone, checkPrepareTime, preparationTimes, scriptCopyLines, type PrepareTimeInput } from "./deps";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "arbab-doctor-deps-"));
  mkdirSync(join(root, "node_modules"));
  mkdirSync(join(root, "web", "node_modules"), { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const clone = (paths: string[]): DependencyStrategy => ({ strategy: "clone", paths, fallback: null });

function runner(calls: Array<[string[], string]>, code: number): ArgvRunner {
  return (argv, cwd) => {
    calls.push([argv, cwd]);
    return { code, output: "" };
  };
}

describe("checkClone", () => {
  it("says nothing for the other strategies, and runs nothing", () => {
    const calls: Array<[string[], string]> = [];
    expect(checkClone(root, { strategy: "none" }, "darwin", runner(calls, 1))).toBeNull();
    expect(checkClone(root, { strategy: "command", command: ["npm", "ci"] }, "darwin", runner(calls, 1))).toBeNull();
    expect(calls).toEqual([]);
  });

  it("is ok when python3 has ctypes on macOS and every path is a directory", () => {
    const calls: Array<[string[], string]> = [];
    expect(checkClone(root, clone(["node_modules", "web/node_modules"]), "darwin", runner(calls, 0))).toEqual([
      { status: "ok", check: "dependencies", detail: "clone node_modules, web/node_modules with clonefile(2)" },
    ]);
    expect(calls).toEqual([[["python3", "-I", "-c", "import ctypes"], root]]);
  });

  it("warns on macOS without python3", () => {
    expect(checkClone(root, clone(["node_modules"]), "darwin", runner([], 127))).toEqual([
      { status: "warn", check: "dependencies", detail: "clone falls back to cp -cR, much slower, without python3" },
    ]);
  });

  it("does not ask for python3 on Linux", () => {
    const calls: Array<[string[], string]> = [];
    expect(checkClone(root, clone(["node_modules"]), "linux", runner(calls, 1))).toEqual([
      { status: "ok", check: "dependencies", detail: "clone node_modules with cp -a --reflink=auto" },
    ]);
    expect(calls).toEqual([]);
  });

  it("warns for each listed path that is not a directory in the main checkout", () => {
    writeFileSync(join(root, "vendor"), "a file\n");
    expect(checkClone(root, clone(["node_modules", "gone", "vendor"]), "darwin", runner([], 1))).toEqual([
      { status: "warn", check: "dependencies", detail: "clone falls back to cp -cR, much slower, without python3" },
      { status: "warn", check: "dependencies", detail: "every launch will fall back: gone is missing" },
      { status: "warn", check: "dependencies", detail: "every launch will fall back: vendor is missing" },
    ]);
  });
});

const NOW = Date.parse("2026-11-10T12:00:00.000Z");
const DAY = 24 * 3600 * 1000;

/** started.json for attempt `n` of `lane`, started `ago` ms before NOW. */
function started(lane: string, n: number, fields: { prepareMs?: number; ago?: number; resume?: boolean }): void {
  const dir = join(root, ".arbab", "runs", lane, `attempt-${n}`);
  mkdirSync(dir, { recursive: true });
  const record = { lane, attempt: n, resume: fields.resume ?? false, startedAt: new Date(NOW - (fields.ago ?? DAY)).toISOString(), prepareMs: fields.prepareMs };
  writeFileSync(join(dir, "started.json"), JSON.stringify(record));
}

describe("preparationTimes", () => {
  it("reads first attempts of the last 14 days, resumes, older ones and broken records aside", () => {
    started("a", 1, { prepareMs: 55_000 });
    started("a", 2, { prepareMs: 9_000, resume: true });
    started("b", 1, { prepareMs: 61_000, ago: 13 * DAY });
    started("c", 1, { prepareMs: 70_000, ago: 15 * DAY });
    started("d", 1, {});
    mkdirSync(join(root, ".arbab", "runs", "e", "attempt-1"), { recursive: true });
    writeFileSync(join(root, ".arbab", "runs", "e", "attempt-1", "started.json"), "{ not json");
    expect(preparationTimes(join(root, ".arbab", "runs"), NOW).sort()).toEqual([55_000, 61_000]);
    expect(preparationTimes(join(root, "missing"), NOW)).toEqual([]);
  });
});

describe("scriptCopyLines", () => {
  it("finds only cp -R lines copying a node_modules into node_modules, from a variable or the project's own", () => {
    const script = [
      "#!/bin/sh",
      "set -eu",
      'MAIN="$ARBAB_PROJECT_ROOT"',
      'cp -cR "$MAIN/node_modules" node_modules',
      "  cp -R -c ${MAIN}/node_modules ./node_modules >/dev/null 2>&1",
      `/bin/cp -Rp ${join(root, "node_modules")} node_modules`,
      `cp -R ${join(root, "web", "node_modules")} node_modules`,
      "cp -R /elsewhere/design/node_modules node_modules",
      "cp -R ${MAIN}/apps/web/node_modules/ apps/web/node_modules",
      "mkdir -p api && cp -Rp $MAIN/api/node_modules api/",
      'cp -R "$MAIN/node_modules" .',
      "cp -R $MAIN/node_modules deps",
      "cp -R $MAIN/node_modules/ node_modules",
      "cp -R $MAIN/design node_modules",
      "cp -R ../../../node_modules node_modules",
      "# cp -cR $MAIN/node_modules node_modules",
      "cp $MAIN/node_modules node_modules",
      "cp -R $MAIN/a/node_modules $MAIN/b/node_modules node_modules",
      "echo cp -R $MAIN/node_modules node_modules",
      "cp -r '$MAIN/odd dir/node_modules' 'node_modules'",
    ].join("\n");
    expect(scriptCopyLines(script, root)).toEqual([
      { line: 4, src: '"$MAIN/node_modules"' },
      { line: 5, src: "${MAIN}/node_modules" },
      { line: 6, src: join(root, "node_modules") },
      { line: 20, src: "'$MAIN/odd dir/node_modules'" },
    ]);
  });
});

describe("checkPrepareTime", () => {
  const input = (dependencies: DependencyStrategy): PrepareTimeInput => ({
    root,
    runsRoot: join(root, ".arbab", "runs"),
    dependencies,
    nowMs: NOW,
    scratchParent: root,
  });
  const slow = (): void => {
    started("a", 1, { prepareMs: 55_000 });
    started("b", 1, { prepareMs: 69_000 });
    started("c", 1, { prepareMs: 20_000 });
  };
  const warn = (detail: string) => ({ status: "warn", check: "dependencies", detail });
  const MEDIAN = warn("worktree preparation takes 55s per lane (median of 3)");

  it("names each cp of the main checkout's node_modules with the clone-dir line, then asks to check the sources", () => {
    slow();
    mkdirSync(join(root, ".arbab"), { recursive: true });
    writeFileSync(
      join(root, ".arbab", "deps.sh"),
      'MAIN="$ARBAB_PROJECT_ROOT"\nset -e\ncp -cR "$MAIN/node_modules" node_modules\ncp -cR "$MAIN/web/node_modules" web/node_modules\ncp -R /elsewhere/node_modules node_modules\n',
    );
    writeFileSync(join(root, "package-lock.json"), "{}\n");
    expect(checkPrepareTime(input({ strategy: "command", command: ["/bin/sh", join(root, ".arbab", "deps.sh")] }))).toEqual([
      MEDIAN,
      warn('.arbab/deps.sh:3: use node "$ARBAB_RUNNER" clone-dir "$ARBAB_PROJECT_ROOT/node_modules" node_modules'),
      warn("check that each source above is the main checkout's node_modules before you change it"),
    ]);
    // A relative script is the worktree's copy of the project's file; bash and zsh too.
    expect(checkPrepareTime(input({ strategy: "command", command: ["bash", "-e", ".arbab/deps.sh"] }))?.length).toBe(3);
    expect(checkPrepareTime(input({ strategy: "command", command: ["zsh", ".arbab/deps.sh"] }))?.length).toBe(3);
    // No scratch directory is left behind.
    expect(readdirSync(root).filter((n) => n.startsWith(".arbab-doctor-"))).toEqual([]);
  });

  it("points an npm or yarn project without such a script at the clone strategy", () => {
    slow();
    writeFileSync(join(root, "yarn.lock"), "# yarn\n");
    const pointer = warn(
      'clone node_modules instead of installing: set "dependencies": {"strategy":"clone","paths":["node_modules"],"fallback":["yarn","install"]} in arbab.config.json (DESIGN.md §22)',
    );
    expect(checkPrepareTime(input({ strategy: "command", command: ["yarn", "install"] }))).toEqual([MEDIAN, pointer]);
    // A script with no copy to replace, or one outside the project, or run with -c: the pointer as well.
    writeFileSync(join(root, "deps.sh"), "yarn install --frozen-lockfile\n");
    // Copies of anything but the main checkout's node_modules get no clone-dir line.
    writeFileSync(join(root, "beside.sh"), "cp -R /elsewhere/design/node_modules node_modules\ncp -R $MAIN/web/node_modules web/node_modules\n");
    const outside = mkdtempSync(join(tmpdir(), "arbab-doctor-out-"));
    writeFileSync(join(outside, "deps.sh"), 'cp -cR "$MAIN/node_modules" node_modules\n');
    try {
      for (const command of [["sh", "deps.sh"], ["sh", "beside.sh"], ["sh", join(outside, "deps.sh")], ["sh", "-c", 'cp -cR "$MAIN/node_modules" node_modules']]) {
        expect(checkPrepareTime(input({ strategy: "command", command }))?.at(-1), command.join(" ")).toEqual({
          ...pointer,
          detail: pointer.detail.replace('["yarn","install"]', JSON.stringify(command)),
        });
      }
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("gives the median alone when it knows no package manager", () => {
    slow();
    expect(checkPrepareTime(input({ strategy: "command", command: ["make", "deps"] }))).toEqual([MEDIAN]);
  });

  it("gives a pnpm project the median alone: its install is offline already", () => {
    slow();
    writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    writeFileSync(join(root, "deps.sh"), 'cp -cR "$MAIN/node_modules" node_modules\n');
    expect(checkPrepareTime(input({ strategy: "command", command: ["pnpm", "install", "--offline"] }))).toEqual([MEDIAN]);
    expect(checkPrepareTime(input({ strategy: "command", command: ["sh", "deps.sh"] }))).toEqual([MEDIAN]);
  });

  it("says nothing at or below 30 s, without times, for a copy 0.3.1 clones itself, or for another strategy", () => {
    writeFileSync(join(root, "package-lock.json"), "{}\n");
    const npm: DependencyStrategy = { strategy: "command", command: ["npm", "ci"] };
    expect(checkPrepareTime(input(npm))).toBeNull();
    started("a", 1, { prepareMs: 30_000 });
    started("b", 1, { prepareMs: 29_000 });
    started("c", 1, { prepareMs: 31_000 });
    expect(checkPrepareTime(input(npm))).toBeNull();
    started("d", 1, { prepareMs: 90_000 });
    // Median of four: (30 + 31) / 2 s.
    expect(checkPrepareTime(input(npm))?.[0]).toEqual(warn("worktree preparation takes 31s per lane (median of 4)"));
    expect(checkPrepareTime(input({ strategy: "command", command: ["cp", "-Rc", join(root, "node_modules"), "node_modules"] }))).toBeNull();
    expect(checkPrepareTime(input(clone(["node_modules"])))).toBeNull();
    expect(checkPrepareTime(input({ strategy: "none" }))).toBeNull();
  });
});
