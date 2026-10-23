import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { shellWord, tokenize } from "./command";

const values = (command: string): string[] | null => tokenize(command)?.map((w) => w.value) ?? null;

describe("tokenize", () => {
  it("splits plain words on spaces and tabs", () => {
    expect(tokenize("node /x/arbab.mjs\tstatus  --json")).toEqual([
      { value: "node", quoted: false },
      { value: "/x/arbab.mjs", quoted: false },
      { value: "status", quoted: false },
      { value: "--json", quoted: false },
    ]);
    expect(values("  a  ")).toEqual(["a"]);
    expect(values("")).toEqual([]);
  });

  it("accepts every character of the plain-word set", () => {
    expect(values("AZaz09_@%+=:,./~-")).toEqual(["AZaz09_@%+=:,./~-"]);
  });

  it("reads wholly single-quoted words literally", () => {
    expect(tokenize("'a b $x `y` \\ !'")).toEqual([{ value: "a b $x `y` \\ !", quoted: true }]);
    expect(values("''")).toEqual([""]);
  });

  it("reads wholly double-quoted words without expansions", () => {
    expect(tokenize('"/path with space/arbab.mjs" "it\'s"')).toEqual([
      { value: "/path with space/arbab.mjs", quoted: true },
      { value: "it's", quoted: true },
    ]);
  });

  it("refuses expansions inside double quotes", () => {
    for (const c of ["$HOME", "$(id)", "`id`", "a\\b", "hi!"]) expect(tokenize(`"${c}"`), c).toBeNull();
  });

  it("refuses shell syntax in plain words", () => {
    for (const command of [
      "a | b",
      "a 2>&1",
      "a && b",
      "a; b",
      "a &",
      "(a)",
      "{ a; }",
      "a > f",
      "a < f",
      "$(id)",
      "`id`",
      "$HOME",
      "a*",
      "a?",
      "[a]",
      "#c",
      "a\\ b",
      "é",
    ]) {
      expect(tokenize(command), command).toBeNull();
    }
  });

  it("refuses newlines and control characters anywhere, quoted or not", () => {
    for (const command of ["a\nb", "'a\nb'", '"a\nb"', "a\rb", "a\x00", "'\x1b'"]) expect(tokenize(command), command).toBeNull();
  });

  it("refuses partly quoted words and unclosed quotes", () => {
    for (const command of ["a'b'", "'a'b", '"a"b', "'a'\"b\"", "'a''b'", "'a", '"a', "a'"]) {
      expect(tokenize(command), command).toBeNull();
    }
  });
});

describe("shellWord", () => {
  it("leaves plain words bare and quotes the rest so tokenize reads them back", () => {
    expect(shellWord("/work/repo")).toBe("/work/repo");
    expect(shellWord("/work/my repo")).toBe("'/work/my repo'");
    expect(values(shellWord("/work/my $repo"))).toEqual(["/work/my $repo"]);
  });

  it("single-quotes a word holding a single quote, each one as '\\''", () => {
    expect(shellWord(`it's "$x"`)).toBe(`'it'\\''s "$x"'`);
    expect(shellWord("it's!")).toBe(`'it'\\''s!'`);
    expect(shellWord("''")).toBe(`''\\'''\\'''`);
    expect(shellWord("")).toBe("''");
  });

  it("round-trips through bash", () => {
    for (const word of ["/work/repo", "it's", "it's!", "a!b", "$HOME", "`id`", "my repo", "a\\b", "x'y'z", `'!$ \\"`, "''", ""]) {
      const run = spawnSync("bash", ["-c", `printf %s ${shellWord(word)}`], { encoding: "utf8" });
      expect(run.status, word).toBe(0);
      expect(run.stdout, word).toBe(word);
    }
  });
});
