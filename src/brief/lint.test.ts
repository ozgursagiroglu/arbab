import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, loadLane, resolveRole } from "../config";
import { compileProfile } from "../profile";
import type { CompiledProfile, LaneSpec } from "../types";
import { MAX_BRIEF_CHARS, forbiddenShapes, lintBrief, normalizeCommand } from "./lint";
import { parseBriefSource } from "./parse";
import { RESEARCHER, SANDBOX_AUTO, STRICT } from "./test-profiles";

const ROOT = join(import.meta.dirname, "..", "..");

// Acceptance holds command spans, so tests swap `git status` for the command under test.
const VALID = "# T\n\n## Task\n\nRun `pnpm test`.\n\n## Scope\n\nsrc/x/**\n\n## Acceptance\n\n- [ ] `git status` shows only src/x\n";

function lint(markdown: string, profile: CompiledProfile = STRICT) {
  return lintBrief(markdown, parseBriefSource(markdown), profile);
}
const codes = (markdown: string, profile?: CompiledProfile): string[] => lint(markdown, profile).map((i) => i.code);

describe("forbiddenShapes", () => {
  it.each([
    ["cd src && ls", ["cd ", "&&"]],
    ["a || b", ["||"]],
    ["ls; echo $?", [";", "echo $?"]],
    ["x=$(pwd)", ["$("]],
    ["a ` b", ["`"]],
    ["sleep 5", ["sleep "]],
    ["pnpm test | tail -5", ["| tail"]],
    ["pnpm test |head", ["| head"]],
    ["run_in_background: true", ["run_in_background"]],
  ])("finds the shapes in %s", (command, shapes) => {
    expect(forbiddenShapes(command)).toEqual(shapes);
  });
  it("finds a shell started with -c, after normalisation", () => {
    expect(forbiddenShapes("bash -c x")).toEqual(["bash -c"]);
    expect(forbiddenShapes("A=1 /bin/sh -xc 'a; b'")).toEqual([";", "sh -c"]);
    expect(forbiddenShapes("bash script.sh -c")).toEqual([]);
    expect(forbiddenShapes("fish -c x")).toEqual([]);
  });
  it("does not flag cd or sleep inside other words", () => {
    expect(forbiddenShapes("abcd x")).toEqual([]);
    expect(forbiddenShapes("nosleep 1")).toEqual([]);
    expect(forbiddenShapes("pnpm test src/a")).toEqual([]);
  });
});

describe("normalizeCommand", () => {
  it.each([
    ["git push", "git push"],
    ["  FOO=1 BAR= git   push ", "git push"],
    ["env git push", "git push"],
    ["env FOO=1 git push", "git push"],
    ["/usr/bin/git push", "git push"],
    ["../tools/pnpm test", "pnpm test"],
    ["git push origin/main", "git push origin/main"],
    ["FOO=1", ""],
    ["", ""],
  ])("normalises %j to %j", (command, expected) => {
    expect(normalizeCommand(command)).toBe(expected);
  });
});

describe("lintBrief", () => {
  it("passes a valid brief", () => {
    expect(lint(VALID)).toEqual([]);
  });

  it("reports missing and empty required sections", () => {
    const issues = lint("# T\n\n## Task\n\n\n## Acceptance\n\nok\n");
    expect(issues.filter((i) => i.code === "missing-section").map((i) => [i.severity, i.where])).toEqual([
      ["error", "Task"],
      ["error", "Scope"],
    ]);
  });

  it("reports forbidden shapes in inline code", () => {
    const issues = lint(VALID.replace("`git status`", "`cd src && ls`"));
    const shape = issues.find((i) => i.code === "forbidden-shape");
    expect(shape).toMatchObject({ severity: "error", where: "cd src && ls" });
    expect(shape?.message).toContain("cd , &&");
  });
  it("reports a nested backtick in a double-backtick span", () => {
    expect(codes(VALID.replace("`git status`", "`` echo `pwd` ``"))).toContain("forbidden-shape");
  });
  it("reports forbidden shapes in shell fences but not in code samples of other languages", () => {
    expect(codes(`${VALID}\n\`\`\`sh\nsleep 5\n\`\`\`\n`)).toEqual(["forbidden-shape"]);
    expect(codes(`${VALID}\n\`\`\`\npnpm test | tail -3\n\`\`\`\n`)).toEqual(["forbidden-shape"]);
    expect(codes(`${VALID}\n\`\`\`ts\nconst a = 1; const b = a && 2;\n\`\`\`\n`)).toEqual([]);
  });

  it("reports inline commands the profile does not allow", () => {
    const issues = lint(VALID.replace("`git status`", "`git commit -m x`"));
    expect(issues).toEqual([expect.objectContaining({ severity: "error", code: "denied-command", where: "git commit -m x" })]);
    expect(codes(VALID.replace("`git status`", "`git -C src status`"))).toEqual(["denied-command"]);
    expect(codes(VALID.replace("`git status`", "`git grep -O vim x`"))).toEqual(["denied-command"]);
    expect(codes(VALID.replace("`git status`", "`curl https://example.com`"))).toEqual(["denied-command"]);
  });
  it("accepts the file utilities an implementer may run", () => {
    expect(codes(VALID.replace("`git status`", "`rm -rf dist`"))).toEqual([]);
    expect(codes(VALID.replace("`git status`", "`mv a.ts b.ts`"))).toEqual([]);
  });
  it("ignores inline code that does not start with a command word", () => {
    expect(codes(VALID.replace("`git status`", "`src/brief/index.ts`"))).toEqual([]);
    expect(codes(VALID.replace("`git status`", "`gitk`"))).toEqual([]);
  });
  it("allows any non-denied command under sandbox-auto, and none without Bash", () => {
    const md = VALID.replace("`git status`", "`make check`");
    expect(codes(md, SANDBOX_AUTO)).toEqual([]);
    expect(codes(md)).toEqual(["denied-command"]);
    expect(codes(VALID.replace("`git status`", "`git push`"), SANDBOX_AUTO)).toEqual(["denied-command"]);
    expect(codes(VALID.replace("`git status`", "`git -C .. log`"), SANDBOX_AUTO)).toEqual(["denied-command"]);
    expect(codes(VALID, RESEARCHER)).toEqual(["denied-command", "denied-command"]);
  });

  describe("command spans", () => {
    const withTask = (task: string): string => VALID.replace("Run `pnpm test`.", task);

    it("checks inline code in Acceptance", () => {
      expect(codes(VALID.replace("`git status`", "`git push`"))).toEqual(["denied-command"]);
      expect(codes(VALID.replace("`git status`", "`a && b`"))).toEqual(["forbidden-shape"]);
    });
    it("checks every line of a shell fence, wherever it is", () => {
      expect(codes(withTask("Context:\n\n```sh\npnpm test\nls; ls\n```"))).toEqual(["forbidden-shape"]);
    });
    it("checks shell-fence lines for denied commands", () => {
      const issues = lint(withTask("Finish with:\n\n```sh\npnpm test\ngit push\n```"));
      expect(issues).toEqual([expect.objectContaining({ severity: "error", code: "denied-command", where: "git push" })]);
      expect(codes(withTask("```\ngit push\n```"))).toEqual(["denied-command"]);
      expect(codes(withTask("```ts\ngit push\n```"))).toEqual([]);
    });
    it.each(["Bash", "SH", "Shell", "ZSH"])("treats a %s fence as a shell fence", (tag) => {
      expect(codes(withTask(`\`\`\`${tag}\nsleep 5\n\`\`\``))).toEqual(["forbidden-shape"]);
      expect(codes(withTask(`\`\`\`${tag}\ngit push\n\`\`\``))).toEqual(["denied-command"]);
    });
    it.each([
      "FOO=1 git push",
      "env git push",
      "env A=1 B=2 git push",
      "/usr/bin/git push",
      "./bin/git push",
      "GIT_DIR=x /usr/local/bin/git push",
    ])("normalises %s before checking it", (command) => {
      expect(codes(VALID.replace("`git status`", `\`${command}\``), SANDBOX_AUTO)).toEqual(["denied-command"]);
    });
    it("reports a path-prefixed command the strict profile would refuse though its basename is allowed", () => {
      expect(codes(VALID.replace("`git status`", "`/usr/bin/git status`"))).toEqual(["denied-command"]);
      expect(codes(VALID.replace("`git status`", "`/usr/bin/git status`"), SANDBOX_AUTO)).toEqual([]);
    });
    it.each(["bash -c 'git push'", "sh -c x", "zsh -lc x", "/bin/bash -c x", "env FOO=1 sh -ec x"])(
      "reports a shell started with -c: %s",
      (command) => {
        expect(codes(VALID.replace("`git status`", `\`${command}\``), SANDBOX_AUTO)).toEqual(["forbidden-shape"]);
      },
    );
    it("passes a shell that runs a script", () => {
      expect(codes(VALID.replace("`git status`", "`bash scripts/check.sh -c`"), SANDBOX_AUTO)).toEqual([]);
    });
    it.each([
      "Run `git push`.",
      "Then runs `git push` for you.",
      "execute: `git push`",
      "Call `git push`",
      "Publish it with the command `git push`.",
      "Bash: `git push`",
      "- RUN  :  `git push`",
      "Run `pnpm test`, then run `git push`.",
    ])("checks inline code its line introduces as something to run: %s", (task) => {
      expect(codes(withTask(task))).toEqual(["denied-command"]);
    });
    it("checks shapes in an introduced span", () => {
      expect(lint(withTask("Run `cd src && pnpm test`."))).toEqual([
        expect.objectContaining({ code: "forbidden-shape", where: "cd src && pnpm test" }),
      ]);
    });

    it.each([
      ["a parameter name in prose", "Task", "Pass `run_in_background` through unchanged."],
      ["a command mentioned in Facts", "Facts", "M1 measured `git -C .. log` reading the parent repository."],
      ["a compound command a test should reject", "Task", "Add a test that rejects `cd src && pnpm test; sleep 5`."],
      ["a span after a word that only ends in run", "Task", "Do not rerun `git push`."],
      ["a span after run when other prose follows", "Task", "Run the suite; `git push` is the runner's job."],
    ])("passes descriptive inline code: %s", (_, section, line) => {
      const md = section === "Task" ? withTask(line) : `${VALID}\n## Facts\n\n${line}\n`;
      expect(codes(md)).toEqual([]);
    });
    it.each([
      "Run `pnpm test` and `git push`.",
      "Run `pnpm test`, then `git push`.",
      "Run `pnpm test`, `git status`, and then `git push`.",
    ])("checks the spans chained to a command span in its sentence: %s", (task) => {
      expect(codes(withTask(task))).toEqual(["denied-command"]);
    });
    it.each([
      ["a sentence ends between them", "Run `pnpm test`. Do not `git push`."],
      ["other prose joins them", "Run `pnpm test` before `git push` happens."],
      ["the first span is descriptive", "The runner does `pnpm test` and `git push`."],
    ])("leaves a span unchecked when %s", (_, task) => {
      expect(codes(withTask(task))).toEqual([]);
    });
    it("introduces a span from the paragraph's previous line", () => {
      expect(codes(withTask("When you are done, run\n`git push`."))).toEqual(["denied-command"]);
      expect(codes(withTask("When you are done, run\n  the suite with the command\n`git push`."))).toEqual(["denied-command"]);
    });
    it("does not carry an intro across paragraphs, list items or headings", () => {
      expect(codes(withTask("Then run\n\n`git push` is the runner's."))).toEqual([]);
      expect(codes(withTask("- Run\n- `git push` is the runner's."))).toEqual([]);
    });
    it("tracks sections, and ignores headings inside fences", () => {
      expect(codes(`${VALID}\n## Notes\n\n\`git push\` is the runner's.\n`)).toEqual([]);
      expect(codes(VALID.replace("- [ ]", "```ts\n## Notes\n```\n\n- [ ]").replace("`git status`", "`git push`"))).toEqual([
        "denied-command",
      ]);
    });
    it("finds a span whose text also appears in the prose before it", () => {
      expect(codes(withTask("git push is described; run `git push`"))).toEqual(["denied-command"]);
      expect(codes(withTask("Run ``git push``"))).toEqual(["denied-command"]);
    });
  });

  describe("this repository's lane briefs", () => {
    const config = loadConfig(ROOT);
    // Only briefs with a lane file have a profile; M1's first wave predates lane files and launched by hand.
    const lanes = readdirSync(join(ROOT, "lanes"))
      .filter((f) => f.endsWith(".md") && existsSync(join(ROOT, "lanes", f.replace(/\.md$/, ".json"))))
      .map((f) => `lanes/${f.replace(/\.md$/, ".json")}`);

    it("finds them", () => {
      expect(lanes.length).toBeGreaterThan(0);
    });
    it.each(lanes)("lints the brief of %s without errors under its lane's profile", (path) => {
      const lane: LaneSpec = loadLane(ROOT, path);
      const defaults = resolveRole(config, lane.role);
      const profile = compileProfile({
        role: lane.role,
        fence: lane.fence ?? "strict",
        tools: defaults.tools,
        loopback: defaults.loopback,
        commands: config.commands[lane.role] ?? [],
        laneAllow: lane.allow ?? [],
        credentialPaths: config.credentialPaths,
        env: {},
        worktree: join(ROOT, ".arbab", "worktrees", lane.worktree ?? lane.name),
        gitCommonDir: join(ROOT, ".git"),
      });
      const markdown = readFileSync(join(ROOT, lane.brief), "utf8");
      expect(lintBrief(markdown, parseBriefSource(markdown), profile).filter((i) => i.severity === "error")).toEqual([]);
    });
  });

  it("warns about unknown sections", () => {
    const issues = lint(`${VALID}\n## Background\n\nwhy\n`);
    expect(issues).toEqual([expect.objectContaining({ severity: "warning", code: "unknown-section", where: "Background" })]);
  });

  it("warns about a long brief, and not at the limit", () => {
    const pad = (n: number): string => `${VALID}\n## Notes\n\n${"x".repeat(n)}`;
    const atLimit = pad(MAX_BRIEF_CHARS - pad(0).length);
    expect(atLimit.length).toBe(MAX_BRIEF_CHARS);
    expect(codes(atLimit)).toEqual([]);
    expect(lint(`${atLimit}x`)).toEqual([expect.objectContaining({ severity: "warning", code: "long-brief" })]);
  });
});
