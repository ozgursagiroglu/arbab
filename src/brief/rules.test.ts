import { describe, expect, it } from "vitest";
import { isAllowedCommand, matchesBashRule, splitCompound } from "./rules";

describe("matchesBashRule", () => {
  it("matches Bash(p) exactly", () => {
    expect(matchesBashRule("git status", "Bash(git status)")).toBe(true);
    expect(matchesBashRule("  git status  ", "Bash(git status)")).toBe(true);
    expect(matchesBashRule("git status -s", "Bash(git status)")).toBe(false);
    expect(matchesBashRule("git", "Bash(git status)")).toBe(false);
  });
  it("matches Bash(p *) as p followed by a space and anything", () => {
    expect(matchesBashRule("pnpm test src/a", "Bash(pnpm test *)")).toBe(true);
    expect(matchesBashRule("pnpm test", "Bash(pnpm test *)")).toBe(false);
    expect(matchesBashRule("pnpm tests", "Bash(pnpm test *)")).toBe(false);
  });
  it("treats Bash(p:*) like Bash(p *)", () => {
    expect(matchesBashRule("ls -la", "Bash(ls:*)")).toBe(true);
    expect(matchesBashRule("lsof", "Bash(ls:*)")).toBe(false);
  });
  it("matches everything for Bash and Bash(*)", () => {
    expect(matchesBashRule("rm -rf x", "Bash")).toBe(true);
    expect(matchesBashRule("anything at all", "Bash(*)")).toBe(true);
  });
  it("never matches non-Bash rules", () => {
    expect(matchesBashRule("Read", "Read")).toBe(false);
    expect(matchesBashRule("x", "Read(**/.env*)")).toBe(false);
    expect(matchesBashRule("x", "BashX")).toBe(false);
  });
  it("treats regex characters in the rule literally", () => {
    expect(matchesBashRule("a.b", "Bash(a.b)")).toBe(true);
    expect(matchesBashRule("axb", "Bash(a.b)")).toBe(false);
  });
});

describe("splitCompound", () => {
  it("splits on every separator and drops empty parts", () => {
    expect(splitCompound("a && b || c; d | e |& f & g\nh;")).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
  });
});

describe("isAllowedCommand", () => {
  const allow = ["Bash(ls)", "Bash(ls *)", "Bash(git status)", "Bash(git commit *)"];
  const deny = ["Bash(git commit *)"];
  it("allows a single allowed command", () => {
    expect(isAllowedCommand("ls -la", allow, deny)).toBe(true);
  });
  it("rejects a command no rule allows", () => {
    expect(isAllowedCommand("rm x", allow, deny)).toBe(false);
  });
  it("lets deny win over allow", () => {
    expect(isAllowedCommand("git commit -m x", allow, deny)).toBe(false);
  });
  it("allows a compound command only if every part is allowed", () => {
    expect(isAllowedCommand("ls && git status", allow, deny)).toBe(true);
    expect(isAllowedCommand("ls; rm x", allow, deny)).toBe(false);
    expect(isAllowedCommand("ls | rm x", allow, deny)).toBe(false);
  });
  it("denies a compound command if any part is denied, even under a bare Bash allow", () => {
    expect(isAllowedCommand("ls\ngit commit -m x", ["Bash"], deny)).toBe(false);
    expect(isAllowedCommand("ls\ngit status", ["Bash"], deny)).toBe(true);
  });
  it("rejects an empty command", () => {
    expect(isAllowedCommand("  ", ["Bash"], [])).toBe(false);
  });
});
