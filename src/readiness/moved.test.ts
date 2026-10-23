import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GitRunner } from "../run";
import { writeLanding } from "../summary/testkit";
import { baseMoved } from "./moved";

const HEAD = "a".repeat(40);
const NEW1 = "1".repeat(40);
const NEW2 = "2".repeat(40);

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "arbab-"));
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

describe("baseMoved", () => {
  it("is null when the head holds the base, or when git cannot tell", () => {
    expect(baseMoved(fakeGit(0, []).git, root, "main", HEAD)).toBeNull();
    expect(baseMoved(fakeGit(128, []).git, root, "main", HEAD)).toBeNull();
  });

  it("refuses a base or head that is no revision without asking git", () => {
    const { git, calls } = fakeGit(1, []);
    expect(baseMoved(git, root, "-x", HEAD)).toBeNull();
    expect(baseMoved(git, root, "", HEAD)).toBeNull();
    expect(baseMoved(git, root, "main", "HEAD")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("counts the new commits and names the landings into the base among them", () => {
    writeLanding(root, "hot", { mergeSha: NEW1, landedAt: "2026-10-09T12:30:00.000Z" });
    writeLanding(root, "held", { mergeSha: HEAD, landedAt: "2026-10-09T12:40:00.000Z" });
    writeLanding(root, "other", { mergeSha: NEW2, into: "dev", landedAt: "2026-10-09T12:50:00.000Z" });
    const { git, calls } = fakeGit(1, [NEW2, NEW1]);
    const moved = baseMoved(git, root, "main", HEAD);
    expect(moved).toMatchObject({ base: "main", commits: 2 });
    expect(moved?.landings.map((l) => l.name)).toEqual(["hot"]);
    expect(calls).toEqual([
      ["merge-base", "--is-ancestor", "main", HEAD],
      ["rev-list", `${HEAD}..main`, "--"],
    ]);
  });

  it("says the base moved without a count when git cannot list the commits", () => {
    expect(baseMoved(fakeGit(1, null).git, root, "main", HEAD)).toEqual({ base: "main", landings: [], commits: null });
  });
});
