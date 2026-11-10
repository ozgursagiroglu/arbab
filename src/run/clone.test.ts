import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLONEFILE_PY, cloneDirectory, defaultCloneDeps, type CloneDeps } from "./clone";
import { runArgv, type ArgvRunner } from "./deps";

let dir: string;
let src: string;
let dst: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "arbab-clone-")));
  src = join(dir, "main", "node_modules");
  dst = join(dir, "wt", "sub", "node_modules");
  mkdirSync(join(src, "a"), { recursive: true });
  writeFileSync(join(src, "a", "index.js"), "module.exports = 1;\n");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Call {
  argv: string[];
  cwd: string;
  /** Whether dst existed when the command ran. */
  dstThere: boolean;
}

/** A runner that answers each command by its argv[0] and records what it was given. */
function fake(calls: Call[], answers: Record<string, { code: number; output: string; partial?: boolean }>): ArgvRunner {
  return (argv, cwd) => {
    calls.push({ argv, cwd, dstThere: existsSync(dst) });
    const a = answers[argv[0] ?? ""] ?? { code: 127, output: "not found" };
    if (a.code === 0 || a.partial === true) mkdirSync(argv.at(-1) ?? "", { recursive: true });
    return { code: a.code, output: a.output };
  };
}

const darwin = (run: ArgvRunner): CloneDeps => ({ platform: "darwin", run });

describe("CLONEFILE_PY", () => {
  it("is the clonefile program, one line per statement", () => {
    expect(CLONEFILE_PY.split("\n")).toEqual([
      "import ctypes,sys",
      'l=ctypes.CDLL("/usr/lib/libSystem.B.dylib",use_errno=True)',
      "l.clonefile.argtypes=[ctypes.c_char_p,ctypes.c_char_p,ctypes.c_uint32]",
      "sys.exit(0 if l.clonefile(sys.argv[1].encode(),sys.argv[2].encode(),0)==0 else 1)",
    ]);
  });
});

describe("cloneDirectory", () => {
  it("on macOS, clones with one clonefile call through python3 -I, creating dst's parent", () => {
    const calls: Call[] = [];
    const r = cloneDirectory(src, dst, darwin(fake(calls, { python3: { code: 0, output: "" } })));
    expect(r).toEqual({ ok: true, how: "clonefile", output: "" });
    expect(calls).toEqual([{ argv: ["python3", "-I", "-c", CLONEFILE_PY, src, dst], cwd: join(dir, "wt", "sub"), dstThere: false }]);
  });

  it("on macOS, removes a partial dst when clonefile fails and runs cp -cR", () => {
    const calls: Call[] = [];
    const run = fake(calls, { python3: { code: 1, output: "", partial: true }, cp: { code: 0, output: "" } });
    const r = cloneDirectory(src, dst, darwin(run));
    expect(r).toEqual({ ok: true, how: "cp", output: "clonefile failed (1)\n" });
    expect(calls.map((c) => [c.argv, c.dstThere])).toEqual([
      [["python3", "-I", "-c", CLONEFILE_PY, src, dst], false],
      [["cp", "-cR", src, dst], false],
    ]);
  });

  it("on macOS without python3, falls back to cp -cR", () => {
    const calls: Call[] = [];
    const r = cloneDirectory(src, dst, darwin(fake(calls, { cp: { code: 0, output: "" } })));
    expect(r).toEqual({ ok: true, how: "cp", output: "clonefile failed (127): not found\n" });
  });

  it("on macOS, fails when both fail, with both outputs", () => {
    const calls: Call[] = [];
    const run = fake(calls, { python3: { code: 1, output: "" }, cp: { code: 1, output: "cp: No space left on device" } });
    expect(cloneDirectory(src, dst, darwin(run))).toEqual({ ok: false, how: "cp", output: "clonefile failed (1)\ncp: No space left on device" });
    expect(calls).toHaveLength(2);
  });

  it("on Linux and others, runs cp -a --reflink=auto", () => {
    for (const platform of ["linux", "freebsd"] as const) {
      const calls: Call[] = [];
      const r = cloneDirectory(src, dst, { platform, run: fake(calls, { cp: { code: 0, output: "" } }) });
      expect(r).toEqual({ ok: true, how: "cp", output: "" });
      expect(calls.map((c) => c.argv)).toEqual([["cp", "-a", "--reflink=auto", src, dst]]);
      rmSync(dst, { recursive: true, force: true });
    }
    const failed = cloneDirectory(src, dst, { platform: "linux", run: () => ({ code: 1, output: "cp: boom" }) });
    expect(failed).toEqual({ ok: false, how: "cp", output: "cp: boom" });
  });

  it("refuses an existing dst, a dangling link included, and touches nothing", () => {
    const calls: Call[] = [];
    mkdirSync(join(dir, "wt", "sub"), { recursive: true });
    symlinkSync(join(dir, "nowhere"), dst);
    const r = cloneDirectory(src, dst, darwin(fake(calls, { python3: { code: 0, output: "" } })));
    expect(r).toEqual({ ok: false, how: "clonefile", output: `${dst} already exists` });
    expect(calls).toEqual([]);
    expect(lstatSync(dst).isSymbolicLink()).toBe(true);
  });

  it("refuses relative paths", () => {
    expect(() => cloneDirectory("node_modules", dst, darwin(fake([], {})))).toThrow(/must be absolute/);
    expect(() => cloneDirectory(src, "node_modules", darwin(fake([], {})))).toThrow(/must be absolute/);
  });

  it("clones a real tree on this machine: identical files, a relative symlink kept", () => {
    mkdirSync(join(src, ".bin"));
    symlinkSync("../a/index.js", join(src, ".bin", "a"));
    writeFileSync(join(src, "b.json"), '{"b":1}\n');
    const r = cloneDirectory(src, dst, defaultCloneDeps(runArgv));
    expect(r.ok, r.output).toBe(true);
    expect(readFileSync(join(dst, "a", "index.js"), "utf8")).toBe("module.exports = 1;\n");
    expect(readFileSync(join(dst, "b.json"), "utf8")).toBe('{"b":1}\n');
    expect(readlinkSync(join(dst, ".bin", "a"))).toBe("../a/index.js");
    expect(readFileSync(join(dst, ".bin", "a"), "utf8")).toBe("module.exports = 1;\n");
    // A clone, not a link to the source.
    writeFileSync(join(dst, "b.json"), "changed\n");
    expect(readFileSync(join(src, "b.json"), "utf8")).toBe('{"b":1}\n');
  });

  it("reads the real platform", () => {
    const run: ArgvRunner = () => ({ code: 0, output: "" });
    expect(defaultCloneDeps(run)).toEqual({ platform: process.platform, run });
  });
});
