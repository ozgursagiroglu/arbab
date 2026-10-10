import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { IntegrationRecord, ReadinessReport } from "../types";
import { writeJsonAtomic } from "../util/fs";
import { runIntegrate } from "./integrate";
import { laneReports, parseTier, runReadiness } from "./readiness";
import { DEFAULT_CONFIG, branchWith, makeProject, passedVerify, writeLaneRun, type TestProject } from "./testkit";

let p: TestProject;
afterEach(() => p?.dispose());

const dir = (t: TestProject): string => join(t.root, ".arbab", "integrations", "rel");
const readRecord = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

async function integrated(config: Record<string, unknown> = {}): Promise<{ t: TestProject; head: string }> {
  const t = makeProject({ config: { ...DEFAULT_CONFIG, ...config } });
  branchWith(t, "arbab/a", "a.txt", "a\n");
  expect(await runIntegrate(["rel", "--lanes", "a"], t.ctx)).toBe(0);
  t.out.length = 0;
  return { t, head: readRecord<IntegrationRecord>(join(dir(t), "integration.json")).headSha };
}

describe("parseTier", () => {
  it("takes a tier, falls back when none is given and refuses anything else", () => {
    expect(parseTier("high", "medium")).toBe("high");
    expect(parseTier(undefined, "low")).toBe("low");
    expect(() => parseTier("extreme", "low")).toThrow(/must be one of low, medium, high/);
  });
});

describe("laneReports", () => {
  it("each merged lane's latest report, then each borrower of one with the worktree it borrowed", async () => {
    ({ t: p } = await integrated());
    const lane = (name: string, worktree: unknown) => ({ name, role: "implementer", brief: "lanes/demo.md", worktree });
    writeLaneRun(p.runsRoot, "a", { state: "finished", attempt: 1, report: { open_questions: ["old"], not_verified: [] } });
    writeLaneRun(p.runsRoot, "a", { state: "finished", attempt: 2, report: { open_questions: ["new"], not_verified: [] } });
    writeLaneRun(p.runsRoot, "a-fix", { state: "running", lane: lane("a-fix", "a") });
    writeLaneRun(p.runsRoot, "other", { state: "finished", lane: lane("other", 3) });
    expect(laneReports(p.runsRoot, ["a", "missing"])).toEqual([
      { lane: "a", report: { open_questions: ["new"], not_verified: [] } },
      { lane: "missing", report: null },
      { lane: "a-fix", report: null, worktree: "a" },
    ]);
  });
});

describe("runReadiness", () => {
  it("is ready at tier low once verify passed on the head; writes both files and prints the Markdown", async () => {
    let head: string;
    ({ t: p, head } = await integrated());
    writeJsonAtomic(join(dir(p), "verify.json"), passedVerify(head));
    writeLaneRun(p.runsRoot, "a", {
      state: "finished",
      endState: "success",
      report: { status: "done", open_questions: ["is the cache needed?"], not_verified: [] },
    });
    expect(await runReadiness(["rel", "--tier", "low"], p.ctx)).toBe(0);

    const report = readRecord<ReadinessReport>(join(dir(p), "readiness.json"));
    expect(report).toMatchObject({ name: "rel", tier: "low", headSha: head, ready: true, skipped: [] });
    expect(report.risks.map((r) => r.text)).toEqual(["a (open question): is the cache needed?"]);
    const markdown = readFileSync(join(dir(p), "readiness.md"), "utf8");
    expect(p.stdout()).toBe(markdown);
    expect(markdown).toContain("Ready to land: yes");
  });

  it("takes the tier from config, lists what it needs as skipped, and accepts waivers by id", async () => {
    let head: string;
    ({ t: p, head } = await integrated({ landing: { tier: "medium" } }));
    writeJsonAtomic(join(dir(p), "verify.json"), passedVerify(head));
    expect(await runReadiness(["rel", "--json"], p.ctx)).toBe(1);
    const report = JSON.parse(p.stdout()) as ReadinessReport;
    expect(report.tier).toBe("medium");
    expect(report.skipped).toEqual([{ id: "review", text: "no review of the head", waived: false }]);

    p.out.length = 0;
    expect(await runReadiness(["rel", "--waive", "review, nothing"], p.ctx)).toBe(0);
    const waived = readRecord<ReadinessReport>(join(dir(p), "readiness.json"));
    expect(waived.skipped).toEqual([{ id: "review", text: "no review of the head", waived: true }]);
    expect(waived.risks.map((r) => r.id)).toContain("waiver:nothing");
  });

  it("is not ready without a verify, or with a failed or stale one", async () => {
    let head: string;
    ({ t: p, head } = await integrated());
    expect(await runReadiness(["rel", "--tier", "low"], p.ctx)).toBe(1);
    expect(readRecord<ReadinessReport>(join(dir(p), "readiness.json")).skipped.map((s) => s.text)).toEqual(["verify has not run"]);
    writeJsonAtomic(join(dir(p), "verify.json"), passedVerify(head, false));
    expect(await runReadiness(["rel", "--tier", "low"], p.ctx)).toBe(1);
    writeJsonAtomic(join(dir(p), "verify.json"), passedVerify("0".repeat(40)));
    expect(await runReadiness(["rel", "--tier", "low"], p.ctx)).toBe(1);
    expect(readRecord<ReadinessReport>(join(dir(p), "readiness.json")).risks.map((r) => r.id)).toContain("stale:verify");
  });

  it("lists the risks of a lane that worked in a merged lane's worktree, after the owner's", async () => {
    let head: string;
    ({ t: p, head } = await integrated());
    writeJsonAtomic(join(dir(p), "verify.json"), passedVerify(head));
    writeLaneRun(p.runsRoot, "a", { state: "finished", endState: "success", report: { open_questions: ["QA"], not_verified: [] } });
    const borrower = (name: string, worktree: string) => ({ name, role: "verifier", brief: "lanes/demo.md", worktree });
    writeLaneRun(p.runsRoot, "a-verify", {
      state: "finished",
      endState: "success",
      lane: borrower("a-verify", "a"),
      report: { open_questions: [], not_verified: ["Windows"] },
    });
    writeLaneRun(p.runsRoot, "z-verify", {
      state: "finished",
      endState: "success",
      lane: borrower("z-verify", "z"),
      report: { open_questions: ["not this integration"], not_verified: [] },
    });
    writeLaneRun(p.runsRoot, "b-broken", { state: "finished" });
    writeFileSync(join(p.runsRoot, "b-broken", "lane.json"), "{not json");
    expect(await runReadiness(["rel", "--tier", "low"], p.ctx)).toBe(0);
    expect(readRecord<ReadinessReport>(join(dir(p), "readiness.json")).risks.map((r) => r.text)).toEqual([
      "a (open question): QA",
      "a-verify (not verified): Windows",
    ]);
  });

  it("says why verify did not pass", async () => {
    let head: string;
    ({ t: p, head } = await integrated());
    writeJsonAtomic(join(dir(p), "verify.json"), { ...passedVerify(head, false), reason: "the lane left changes behind" });
    expect(await runReadiness(["rel", "--tier", "low"], p.ctx)).toBe(1);
    expect(readRecord<ReadinessReport>(join(dir(p), "readiness.json")).skipped).toEqual([
      { id: "verify", text: "verify did not pass on the head: the lane left changes behind", waived: false },
    ]);
  });

  it("refuses a damaged verify.json, an unknown tier and a missing integration", async () => {
    ({ t: p } = await integrated());
    writeFileSync(join(dir(p), "verify.json"), JSON.stringify({ name: "rel", passed: "yes" }));
    await expect(runReadiness(["rel"], p.ctx)).rejects.toMatchObject({ code: "io" });
    await expect(runReadiness(["rel", "--tier", "max"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runReadiness(["other"], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/does not exist/) });
  });
});
