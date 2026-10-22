import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isolatedGit } from "../commands/testkit";
import type { GitRunner } from "../run";
import { reviewCarriesOver } from "./carry";

let dir: string;
let root: string;
let git: GitRunner;

function ok(args: string[], cwd = root): string {
  const r = git(args, cwd);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function commit(file: string, text: string, message = `write ${file}`): string {
  writeFileSync(join(root, file), text);
  ok(["add", "--", file]);
  ok(["commit", "-q", "-m", message]);
  return ok(["rev-parse", "HEAD"]);
}

/** integrate/rel with one reviewed commit, and main one commit further than where integrate/rel started. */
function setup(): { reviewed: string } {
  commit("a.txt", "a\n");
  ok(["checkout", "-q", "-b", "integrate/rel"]);
  const reviewed = commit("lane.txt", "lane\n");
  ok(["checkout", "-q", "main"]);
  commit("base.txt", "base\n");
  ok(["checkout", "-q", "integrate/rel"]);
  return { reviewed };
}

const merge = (ref: string): string => {
  ok(["merge", "-q", "--no-ff", "--no-edit", ref]);
  return ok(["rev-parse", "HEAD"]);
};

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "arbab-")));
  root = join(dir, "repo");
  mkdirSync(root);
  git = isolatedGit(dir);
  ok(["init", "-q", "-b", "main", root], dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("reviewCarriesOver", () => {
  it("is true for a clean merge of the base on top of the reviewed head", () => {
    const { reviewed } = setup();
    const head = merge("main");
    expect(reviewCarriesOver(git, root, reviewed, head, "main")).toBe(true);
  });

  it("is false for a merge whose result was edited by hand", () => {
    const { reviewed } = setup();
    merge("main");
    writeFileSync(join(root, "lane.txt"), "changed while merging\n");
    ok(["add", "--", "lane.txt"]);
    ok(["commit", "-q", "--amend", "--no-edit"]);
    expect(reviewCarriesOver(git, root, reviewed, ok(["rev-parse", "HEAD"]), "main")).toBe(false);
  });

  it("is false for a merge that needed a conflict resolved by hand", () => {
    commit("a.txt", "a\n");
    ok(["checkout", "-q", "-b", "integrate/rel"]);
    const reviewed = commit("a.txt", "lane\n");
    ok(["checkout", "-q", "main"]);
    commit("a.txt", "base\n");
    ok(["checkout", "-q", "integrate/rel"]);
    expect(git(["merge", "-q", "--no-edit", "main"], root).code).not.toBe(0);
    writeFileSync(join(root, "a.txt"), "lane and base\n");
    ok(["add", "--", "a.txt"]);
    ok(["commit", "-q", "--no-edit"]);
    expect(reviewCarriesOver(git, root, reviewed, ok(["rev-parse", "HEAD"]), "main")).toBe(false);
  });

  it("is false for a merge of a branch that is not in the base", () => {
    const { reviewed } = setup();
    ok(["checkout", "-q", "-b", "other", "main"]);
    commit("other.txt", "other\n");
    ok(["checkout", "-q", "integrate/rel"]);
    const head = merge("other");
    expect(reviewCarriesOver(git, root, reviewed, head, "main")).toBe(false);
  });

  it("is false for a commit that is not a merge, and for a merge on top of another head", () => {
    const { reviewed } = setup();
    const plain = commit("more.txt", "more\n");
    expect(reviewCarriesOver(git, root, reviewed, plain, "main")).toBe(false);
    const head = merge("main");
    expect(reviewCarriesOver(git, root, reviewed, head, "main")).toBe(false);
    expect(reviewCarriesOver(git, root, plain, head, "main")).toBe(true);
  });

  it("is false for unknown commits, the same head, a non-sha and a base that reads as an option", () => {
    const { reviewed } = setup();
    const head = merge("main");
    expect(reviewCarriesOver(git, root, "f".repeat(40), head, "main")).toBe(false);
    expect(reviewCarriesOver(git, root, reviewed, "f".repeat(40), "main")).toBe(false);
    expect(reviewCarriesOver(git, root, head, head, "main")).toBe(false);
    expect(reviewCarriesOver(git, root, "HEAD~1", head, "main")).toBe(false);
    expect(reviewCarriesOver(git, root, reviewed, head, "--all")).toBe(false);
    expect(reviewCarriesOver(git, root, reviewed, head, "no-such-branch")).toBe(false);
  });
});
