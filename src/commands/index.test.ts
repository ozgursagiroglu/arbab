import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArbabError } from "../util/errors";
import { COMMANDS, HELP, INTERNAL_COMMANDS, dispatch, type CommandContext } from "./index";
import { DEFAULT_BRIEF, DEFAULT_CONFIG, makeProject, type TestProject } from "./testkit";
import { USAGE } from "./usage";

let p: TestProject;
afterEach(() => p?.dispose());

describe("dispatch", () => {
  it("prints help for no command, help and --help, listing every command but the internal ones", async () => {
    p = makeProject();
    for (const argv of [[], ["help"], ["--help"], ["-h"], ["help", "nope"]]) {
      p.out.length = 0;
      expect(await dispatch(argv, p.ctx)).toBe(0);
      expect(p.stdout()).toBe(HELP);
    }
    for (const name of Object.keys(COMMANDS).filter((n) => !n.startsWith("__") && n !== "hook")) expect(HELP).toContain(`  ${name} `);
    expect(HELP).not.toContain("  hook ");
    expect(HELP).toContain("  -C <dir> ");
    expect(HELP).toContain("arbab <command> --help shows a command's options");
    expect(HELP).toContain("as the automatic sweep does (worktrees.idleDays)");
    expect(HELP).toContain("installs only to rebuild a missing worktree");
  });

  it("prints a command's usage for <command> --help, -h and help <command>", async () => {
    p = makeProject();
    for (const argv of [["status", "--help"], ["status", "-h"], ["help", "status"], ["status", "--json", "--help"]]) {
      p.out.length = 0;
      expect(await dispatch(argv, p.ctx), argv.join(" ")).toBe(0);
      expect(p.stdout()).toBe(USAGE.status);
    }
    p.out.length = 0;
    expect(await dispatch(["plan", "next", "--help"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe(USAGE.plan);
  });

  it("still refuses an unknown command given --help", async () => {
    p = makeProject();
    expect(await dispatch(["launhc", "--help"], p.ctx)).toBe(1);
    expect(p.stderr()).toBe(`arbab: unknown command "launhc"\n${HELP}`);
  });

  it("prints the version", async () => {
    p = makeProject();
    expect(await dispatch(["--version"], p.ctx)).toBe(0);
    expect(await dispatch(["version"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe("9.9.9\n9.9.9\n");
  });

  it("refuses an unknown command with exit 1", async () => {
    p = makeProject();
    expect(await dispatch(["launhc"], p.ctx)).toBe(1);
    expect(p.stderr()).toMatch(/^arbab: unknown command "launhc"/);
    expect(await dispatch(["toString"], p.ctx)).toBe(1);
  });

  it("maps usage errors (an unknown flag) to exit 1 with a message", async () => {
    p = makeProject();
    expect(await dispatch(["status", "--bogus"], p.ctx)).toBe(1);
    expect(p.stderr()).toMatch(/^arbab status: Unknown option '--bogus'/);
  });

  it("maps runtime errors to exit 2 and lint refusals to 1", async () => {
    p = makeProject();
    p.ctx.runShepherd = async () => {
      throw new ArbabError("runtime", "the shepherd is not implemented yet");
    };
    expect(await dispatch(["__shepherd", p.root, "demo", '{"kind":"start"}'], p.ctx)).toBe(2);
    expect(p.stderr()).toContain("arbab __shepherd: the shepherd is not implemented yet");
    p.write("lanes/bad.json", JSON.stringify({ name: "bad", role: "implementer", brief: "lanes/demo.md", allow: ["Bash"] }));
    expect(await dispatch(["launch", "lanes/bad.json"], p.ctx)).toBe(1);
  });

  it("maps unexpected errors to exit 2", async () => {
    p = makeProject();
    p.ctx.runShepherd = async () => {
      throw new TypeError("oops");
    };
    expect(await dispatch(["__shepherd", p.root, "demo", '{"kind":"start"}'], p.ctx)).toBe(2);
    expect(p.stderr()).toContain("TypeError: oops");
  });

  it("registers summary, report, hook and host-check", async () => {
    p = makeProject();
    for (const name of ["summary", "report", "hook", "host-check"]) expect(Object.hasOwn(COMMANDS, name), name).toBe(true);
    expect(await dispatch(["hook", "x"], p.ctx)).toBe(1);
    expect(p.stderr()).toBe('arbab hook: hook takes one of pre-tool-use, stop, user-prompt-submit, session-start, got "x"\n');
    for (const name of ["summary", "report", "host-check"] as const) {
      p.out.length = 0;
      expect(await dispatch([name, "--help"], p.ctx), name).toBe(0);
      expect(p.stdout()).toBe(USAGE[name]);
    }
  });

  it("runs a command and returns its status", async () => {
    p = makeProject();
    expect(await dispatch(["lint", "lanes/demo.json"], p.ctx)).toBe(0);
    expect(p.stdout()).toBe("demo: ok\n");
  });

  it("runs __sweep, which is in neither COMMANDS nor the help and takes no --help", async () => {
    p = makeProject();
    expect(Object.hasOwn(COMMANDS, "__sweep")).toBe(false);
    expect(Object.hasOwn(INTERNAL_COMMANDS, "__sweep")).toBe(true);
    expect(HELP).not.toContain("__sweep");
    expect(await dispatch(["__sweep", p.root], p.ctx)).toBe(0);
    expect(p.stdout()).toMatch(/sweep of .* \(unused for 3\+ days\)\nnothing to remove\n$/);
    expect(existsSync(join(p.root, ".arbab", "sweep.json"))).toBe(true);
    p.out.length = 0;
    expect(await dispatch(["__sweep", p.root, "--help"], p.ctx)).toBe(1);
    expect(p.stdout()).toBe("");
    expect(p.stderr()).toBe("arbab __sweep: usage: arbab __sweep <root>\n");
  });
});

describe("dispatch -C <dir>", () => {
  // The project's parent holds no project, so a command finds one only through -C.
  const outside = (): CommandContext => ({ ...p.ctx, cwd: p.dir });

  it("runs the command from a relative or an absolute directory", async () => {
    p = makeProject();
    expect(await dispatch(["lint", "lanes/demo.json"], outside())).toBe(1);
    expect(p.stderr()).toContain("no arbab.config.json or git repository");
    p.out.length = 0;
    for (const dir of ["repo", p.root, "repo/lanes", "./repo/lanes/.."]) {
      expect(await dispatch(["-C", dir, "lint", "lanes/demo.json"], outside()), dir).toBe(0);
    }
    expect(p.stdout()).toBe("demo: ok\n".repeat(4));
  });

  it("hands the command the resolved directory as its cwd", async () => {
    // A nested project: its lane exists only under its own root, which the command finds from -C's directory.
    p = makeProject({
      files: {
        "sub/arbab.config.json": JSON.stringify(DEFAULT_CONFIG),
        "sub/lanes/other.md": DEFAULT_BRIEF,
        "sub/lanes/other.json": JSON.stringify({ name: "other", role: "implementer", brief: "lanes/other.md" }),
      },
    });
    expect(await dispatch(["-C", "repo", "lint", "lanes/other.json"], outside())).toBe(1);
    p.out.length = 0;
    expect(await dispatch(["-C", "repo/sub", "lint", "lanes/other.json"], outside())).toBe(0);
    expect(p.stdout()).toBe("other: ok\n");
  });

  it("works with help and --version", async () => {
    p = makeProject();
    expect(await dispatch(["-C", "repo", "help"], outside())).toBe(0);
    expect(await dispatch(["-C", "repo", "status", "--help"], outside())).toBe(0);
    expect(await dispatch(["-C", "repo", "--version"], outside())).toBe(0);
    expect(p.stdout()).toBe(`${HELP}${USAGE.status}9.9.9\n`);
  });

  it("refuses a missing directory, a file, an empty value and a second -C", async () => {
    p = makeProject();
    const cases: Array<[string[], RegExp]> = [
      [["-C", "nope", "status"], /^arbab: -C "nope": no such directory .*nope\n$/],
      [["-C", "repo/arbab.config.json", "status"], /^arbab: -C "repo\/arbab.config.json": not a directory: /],
      [["-C", "", "status"], /^arbab: -C needs a directory\n$/],
      [["-C"], /^arbab: -C needs a directory\n$/],
      [["-C", "repo", "-C", "repo", "status"], /^arbab: -C given twice\n$/],
      [["-C", "-C", "repo", "status"], /^arbab: -C given twice\n$/],
    ];
    for (const [argv, message] of cases) {
      p.err.length = 0;
      expect(await dispatch(argv, outside()), JSON.stringify(argv)).toBe(1);
      expect(p.stderr()).toMatch(message);
    }
    expect(p.stdout()).toBe("");
  });
});
