import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { untrustedTree, type GitRunner } from "../run";
import { integrationDir, writeLanding } from "../summary/testkit";
import { baseMergeInstruction, baseMoved, type OwnLanding } from "./moved";

const HEAD = "a".repeat(40);
const NEW1 = "1".repeat(40);
const NEW2 = "2".repeat(40);

let root: string;
let own: OwnLanding;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "arbab-"));
  own = { name: "rel", landing: join(integrationDir(root, "rel"), "landing.json") };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A git whose `merge-base --is-ancestor` exits `ancestor` and whose `rev-list` prints `listed` (null: fails). */
function fakeGit(ancestor: number, listed: string[] | null): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitRunner = (args) => {
    calls.push(args);
    if (args[0] === "merge-base") return { code: ancestor, stdout: "", stderr: "" };
    if (args[0] === "rev-list") return listed === null ? { code: 128, stdout: "", stderr: "bad" } : { code: 0, stdout: listed.map((s) => `${s}\n`).join(""), stderr: "" };
    return { code: 1, stdout: "", stderr: "unexpected" };
  };
  return { git, calls };
}

describe("baseMergeInstruction", () => {
  it("is the merge with hooks off, then refresh, verify, review and readiness again", () => {
    expect(baseMergeInstruction("main", "rel", "/repo/wt")).toBe(
      `Merge main into integrate/rel with hooks off: git -C /repo/wt ${untrustedTree().join(" ")} merge --no-verify --no-edit main; ` +
        "then arbab integrate rel --refresh to record the new head, and verify, review and readiness for rel again",
    );
  });

  it("quotes the worktree and the base as one shell word each", () => {
    const text = baseMergeInstruction("feat/it's", "rel", "/work/my repo/wt");
    expect(text).toContain(`git -C '/work/my repo/wt' ${untrustedTree().join(" ")} merge --no-verify --no-edit 'feat/it'\\''s'; then`);
    expect(baseMergeInstruction("main", "rel", "/work/$HOME's!")).toContain(`git -C '/work/$HOME'\\''s!' `);
  });
});

describe("baseMoved", () => {
  it("is null when the head holds the base, or when git cannot tell", () => {
    expect(baseMoved(fakeGit(0, []).git, root, "main", HEAD, own)).toBeNull();
    expect(baseMoved(fakeGit(128, []).git, root, "main", HEAD, own)).toBeNull();
  });

  it("refuses a base or head that is no revision without asking git", () => {
    const { git, calls } = fakeGit(1, []);
    expect(baseMoved(git, root, "-x", HEAD, own)).toBeNull();
    expect(baseMoved(git, root, "", HEAD, own)).toBeNull();
    expect(baseMoved(git, root, "main", "HEAD", own)).toBeNull();
    expect(calls).toEqual([]);
  });

  it("counts the new commits and names the landings into the base among them", () => {
    writeLanding(root, "hot", { mergeSha: NEW1, landedAt: "2026-10-09T12:30:00.000Z" });
    writeLanding(root, "held", { mergeSha: HEAD, landedAt: "2026-10-09T12:40:00.000Z" });
    writeLanding(root, "other", { mergeSha: NEW2, into: "dev", landedAt: "2026-10-09T12:50:00.000Z" });
    const { git, calls } = fakeGit(1, [NEW2, NEW1]);
    const moved = baseMoved(git, root, "main", HEAD, own);
    expect(moved).toMatchObject({ base: "main", commits: 2 });
    expect(moved?.landings.map((l) => l.name)).toEqual(["hot"]);
    expect(calls).toEqual([
      ["merge-base", "--is-ancestor", "main", HEAD],
      ["rev-list", `${HEAD}..main`, "--"],
    ]);
  });

  it("says the base moved without a count when git cannot list the commits", () => {
    expect(baseMoved(fakeGit(1, null).git, root, "main", HEAD, own)).toEqual({ base: "main", landings: [], commits: null });
  });

  it("is null once the integration itself landed: its own merge is what the base gained", () => {
    writeLanding(root, "rel", { mergeSha: NEW1, landedAt: "2026-10-09T12:30:00.000Z" });
    const { git, calls } = fakeGit(1, [NEW1]);
    expect(baseMoved(git, root, "main", HEAD, own)).toBeNull();
    expect(calls).toEqual([]);
  });

  it("never names the integration's own landing record among those that moved the base", () => {
    writeLanding(root, "hot", { mergeSha: NEW1, landedAt: "2026-10-09T12:30:00.000Z" });
    writeLanding(root, "rel", { mergeSha: NEW2, landedAt: "2026-10-09T12:40:00.000Z" });
    // Its landing.json is elsewhere than the record listed: only the name check leaves it out.
    const moved = baseMoved(fakeGit(1, [NEW2, NEW1]).git, root, "main", HEAD, { name: "rel", landing: join(root, "none.json") });
    expect(moved?.landings.map((l) => l.name)).toEqual(["hot"]);
  });
});
