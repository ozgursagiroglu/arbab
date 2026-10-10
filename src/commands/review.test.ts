import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { IntegrationRecord, LaneSpec, ReviewFinding, ReviewRecord } from "../types";
import { runIntegrate } from "./integrate";
import { applyLensVerdicts, formatFindings, formatReview, reviewLenses, runReview } from "./review";
import { DEFAULT_CONFIG, branchWith, makeProject, simulateShepherds, type LaneRun, type TestProject } from "./testkit";

let p: TestProject;
afterEach(() => p?.dispose());

const dir = (t: TestProject): string => join(t.root, ".arbab", "integrations", "rel");
const readRecord = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

const finding = (title: string, severity: string, line: number): Record<string, unknown> => ({
  title,
  severity,
  file: "a.txt",
  line,
  failure_scenario: `${title} happens`,
  evidence: `a.txt:${line}`,
});
const reviewer = (findings: unknown[], paths = ["a.txt"]): (() => LaneRun) => () => ({
  state: "finished",
  endState: "success",
  report: { findings, coverage: "read a.txt in full", paths_checked: paths },
});

async function integrated(config: Record<string, unknown> = {}, manifest = false): Promise<TestProject> {
  const t = makeProject({ config: { ...DEFAULT_CONFIG, ...config } });
  branchWith(t, "arbab/a", manifest ? "package.json" : "a.txt", "a\n");
  expect(await runIntegrate(["rel", "--lanes", "a"], t.ctx)).toBe(0);
  t.out.length = 0;
  return t;
}

describe("reviewLenses", () => {
  it("defaults to the built-ins and the config lenses", () => {
    expect(reviewLenses(undefined, { perf: "slow paths" })).toEqual(["correctness", "security", "contracts", "perf"]);
  });

  it("takes --lenses as given, once each, and refuses an unknown or empty list", () => {
    expect(reviewLenses("perf,security,perf", { perf: "slow paths" })).toEqual(["perf", "security"]);
    expect(() => reviewLenses("speed", {})).toThrow(/unknown lens speed \(known: correctness, security, contracts\)/);
    expect(() => reviewLenses(",", {})).toThrow(/names no lens/);
  });
});

describe("formatFindings", () => {
  it("groups by verdict, with location and severity", () => {
    const f: ReviewFinding = {
      id: "security-1",
      lens: "security",
      title: "Leaks\nthe token",
      severity: "HIGH",
      file: "src/x.ts",
      line: 3,
      failureScenario: "s",
      evidence: "e",
      verdict: "confirmed",
    };
    expect(formatFindings([f, { ...f, id: "security-2", line: undefined as unknown as number, verdict: "unverified" }])).toBe(
      "confirmed (1)\n  security-1  HIGH  src/x.ts:3  Leaks the token\nrefuted (0)\nunverified (1)\n  security-2  HIGH  src/x.ts  Leaks the token\n",
    );
  });
});

describe("applyLensVerdicts", () => {
  const f = (id: string, lens: string): ReviewFinding => ({
    id,
    lens,
    title: "t",
    severity: "HIGH",
    file: "a.txt",
    failureScenario: "s",
    evidence: "e",
    verdict: "unverified",
  });

  it("judges only the named lens's findings and keeps the order", () => {
    const findings = [f("a-1", "a"), f("b-1", "b"), f("a-2", "a")];
    const report = {
      verdicts: [
        { id: "a-1", refuted: true, corrected_severity: "NONE", reasoning: "no" },
        { id: "b-1", refuted: true, corrected_severity: "NONE", reasoning: "not a's" },
        { id: "a-2", refuted: false, corrected_severity: "MEDIUM", reasoning: "yes" },
      ],
    };
    expect(applyLensVerdicts(findings, "a", report).map((x) => [x.id, x.verdict, x.severity])).toEqual([
      ["a-1", "refuted", "HIGH"],
      ["b-1", "unverified", "HIGH"],
      ["a-2", "confirmed", "MEDIUM"],
    ]);
    expect(applyLensVerdicts(findings, "c", report)).toEqual(findings);
    expect(applyLensVerdicts(findings, "a", "not a report")).toEqual(findings);
  });
});

describe("formatReview", () => {
  it("lists the reviewer and skeptic lanes, then the findings by verdict", () => {
    const record: ReviewRecord = {
      name: "rel",
      headSha: "c".repeat(40),
      lenses: [
        { lens: "security", lane: "rel-review-security", endState: "success", coverage: "all", pathsChecked: 3 },
        { lens: "perf", lane: "rel-review-perf", endState: null, coverage: null, pathsChecked: 0 },
      ],
      skeptics: [{ lens: "security", lane: "rel-skeptic-security", endState: "budget" }],
      findings: [
        { id: "security-1", lens: "security", title: "Leak", severity: "HIGH", file: "src/x.ts", line: 2, failureScenario: "s", evidence: "e", verdict: "refuted" },
      ],
      finishedAt: "2026-10-09T12:00:00.000Z",
    };
    expect(formatReview(record)).toBe(
      "security  review   rel-review-security  success  3 paths\n" +
        "perf  review   rel-review-perf  unfinished  0 paths\n" +
        "security  skeptic  rel-skeptic-security  budget\n" +
        "confirmed (0)\nrefuted (1)\n  security-1  HIGH  src/x.ts:2  Leak\nunverified (0)\n",
    );
    expect(formatReview({ ...record, lenses: [], skeptics: [], findings: [] })).toBe("\nconfirmed (0)\nrefuted (0)\nunverified (0)\n");
  });
});

describe("runReview", () => {
  it("runs one reviewer per lens, a skeptic per lens with MEDIUM+ findings, and records the verdicts", async () => {
    p = await integrated();
    simulateShepherds(p, {
      "rel-review-correctness": reviewer([finding("off by one", "MEDIUM", 1), finding("typo", "LOW", 2)]),
      "rel-review-security": reviewer([], ["a.txt", "b.txt"]),
      "rel-review-contracts": reviewer([finding("wrong field", "HIGH", 1)]),
      "rel-skeptic-correctness": () => ({
        state: "finished",
        endState: "success",
        report: { verdicts: [{ id: "correctness-1", refuted: true, corrected_severity: "NONE", reasoning: "cannot happen" }] },
      }),
      "rel-skeptic-contracts": () => ({
        state: "finished",
        endState: "success",
        report: { verdicts: [{ id: "contracts-1", refuted: false, corrected_severity: "MEDIUM", reasoning: "real" }] },
      }),
    });
    expect(await runReview(["rel"], p.ctx)).toBe(0);

    const integration = readRecord<IntegrationRecord>(join(dir(p), "integration.json"));
    const record = readRecord<ReviewRecord>(join(dir(p), "review.json"));
    expect(record.headSha).toBe(integration.headSha);
    expect(record.lenses).toEqual([
      { lens: "correctness", lane: "rel-review-correctness", endState: "success", coverage: "read a.txt in full", pathsChecked: 1 },
      { lens: "security", lane: "rel-review-security", endState: "success", coverage: "read a.txt in full", pathsChecked: 2 },
      { lens: "contracts", lane: "rel-review-contracts", endState: "success", coverage: "read a.txt in full", pathsChecked: 1 },
    ]);
    expect(record.skeptics.map((s) => s.lane)).toEqual(["rel-skeptic-correctness", "rel-skeptic-contracts"]);
    expect(record.findings.map((f) => [f.id, f.severity, f.verdict])).toEqual([
      ["correctness-1", "MEDIUM", "refuted"],
      ["correctness-2", "LOW", "unverified"],
      ["contracts-1", "MEDIUM", "confirmed"],
    ]);
    expect(p.stdout()).toContain("confirmed (1)\n  contracts-1  MEDIUM  a.txt:1  wrong field\nrefuted (1)\n");

    // Reviewers and skeptics install on the integration's base commit (no manifest changed) and merge the recorded
    // head on top, never integrate/rel by name; they diff against the base. The skeptic's schema sits next to its brief.
    const lane = readRecord<LaneSpec>(join(dir(p), "lanes", "rel-review-security.json"));
    expect(lane).toMatchObject({ role: "reviewer", base: integration.baseSha, mergeBranches: [integration.headSha] });
    expect(readFileSync(join(p.root, lane.brief), "utf8")).toContain(`git diff ${integration.baseSha}..HEAD`);
    const skeptic = readRecord<LaneSpec>(join(dir(p), "lanes", "rel-skeptic-contracts.json"));
    expect(skeptic).toMatchObject({ role: "reviewer", base: integration.baseSha, mergeBranches: [integration.headSha] });
    expect(skeptic.schema).toBe(".arbab/integrations/rel/lanes/rel-skeptic-contracts.schema.json");
    expect(existsSync(join(p.root, skeptic.schema ?? ""))).toBe(true);
    expect(p.spawned.map((s) => s.lane)).toEqual([
      "rel-review-correctness",
      "rel-review-security",
      "rel-review-contracts",
      "rel-skeptic-correctness",
      "rel-skeptic-contracts",
    ]);
  });

  it("runs only the named lenses, no skeptic without MEDIUM+ findings, and exits 1 when a reviewer failed", async () => {
    p = await integrated({ review: { lenses: { perf: "slow paths" } } });
    simulateShepherds(p, {
      "rel-review-perf": reviewer([finding("slow", "LOW", 1)]),
      "rel-review-security": () => ({ state: "finished", endState: "budget" }),
    });
    expect(await runReview(["rel", "--lenses", "perf,security", "--json"], p.ctx)).toBe(1);
    const out = JSON.parse(p.stdout()) as { timedOut: boolean; review: ReviewRecord };
    expect(out.timedOut).toBe(false);
    expect(out.review.lenses.map((l) => [l.lens, l.endState, l.coverage])).toEqual([
      ["perf", "success", "read a.txt in full"],
      ["security", "budget", null],
    ]);
    expect(out.review.skeptics).toEqual([]);
    expect(out.review.findings.map((f) => f.verdict)).toEqual(["unverified"]);
  });

  it("exits 3 when the reviewers do not finish, writing nothing", async () => {
    p = await integrated();
    simulateShepherds(p, {});
    expect(await runReview(["rel", "--lenses", "security", "--timeout-min", "0.5"], p.ctx)).toBe(3);
    expect(existsSync(join(dir(p), "review.json"))).toBe(false);
  });

  it("keeps findings unverified and exits 3 when the skeptics do not finish", async () => {
    p = await integrated();
    simulateShepherds(p, { "rel-review-security": reviewer([finding("leak", "HIGH", 1)]) });
    expect(await runReview(["rel", "--lenses", "security", "--timeout-min", "0.5"], p.ctx)).toBe(3);
    const record = readRecord<ReviewRecord>(join(dir(p), "review.json"));
    expect(record.skeptics).toEqual([{ lens: "security", lane: "rel-skeptic-security", endState: null }]);
    expect(record.findings.map((f) => f.verdict)).toEqual(["unverified"]);
  });

  it("refuses unconfirmed manifest changes as verify does, whatever the dependency strategy, launching nothing", async () => {
    for (const dependencies of [{ strategy: "command", command: ["true"] }, { strategy: "none" }]) {
      p = await integrated({ dependencies }, true);
      simulateShepherds(p, {});
      const { worktree, headSha } = readRecord<IntegrationRecord>(join(dir(p), "integration.json"));
      await expect(runReview(["rel"], p.ctx)).rejects.toMatchObject({
        code: "usage",
        message: `a changed package.json: review the change and what an install at ${headSha} runs (package.json scripts and the files they run, .npmrc, .pnpmfile.*), install the dependencies in ${worktree} yourself, then run arbab integrate rel --deps-installed ${headSha}`,
      });
      expect(p.spawned).toEqual([]);
      // Once a human confirms the install, review runs, installing on the head the human confirmed.
      expect(await runIntegrate(["rel", "--deps-installed", headSha], p.ctx)).toBe(0);
      expect(await runReview(["rel", "--lenses", "security", "--timeout-min", "0.5"], p.ctx)).toBe(3);
      expect(p.spawned.map((s) => s.lane)).toEqual(["rel-review-security"]);
      const confirmed = readRecord<IntegrationRecord>(join(dir(p), "integration.json"));
      const lane = readRecord<LaneSpec>(join(dir(p), "lanes", "rel-review-security.json"));
      expect(confirmed.depsConfirmedAt).toBe(confirmed.headSha);
      expect(lane.base).toBe(confirmed.headSha);
      expect(lane).not.toHaveProperty("mergeBranches");
      p.dispose();
    }
  });

  it("applies each skeptic's verdicts to its own lens's findings only", async () => {
    p = await integrated();
    simulateShepherds(p, {
      "rel-review-correctness": reviewer([finding("off by one", "MEDIUM", 1)]),
      "rel-review-contracts": reviewer([finding("wrong field", "HIGH", 1)]),
      // Answers for the other lens too: those verdicts are not its to give.
      "rel-skeptic-correctness": () => ({
        state: "finished",
        endState: "success",
        report: {
          verdicts: [
            { id: "correctness-1", refuted: false, corrected_severity: "MEDIUM", reasoning: "real" },
            { id: "contracts-1", refuted: true, corrected_severity: "NONE", reasoning: "not mine" },
          ],
        },
      }),
      "rel-skeptic-contracts": () => ({ state: "finished", endState: "success", report: { verdicts: [] } }),
    });
    expect(await runReview(["rel", "--lenses", "correctness,contracts"], p.ctx)).toBe(0);
    const record = readRecord<ReviewRecord>(join(dir(p), "review.json"));
    expect(record.findings.map((f) => [f.id, f.verdict])).toEqual([
      ["correctness-1", "confirmed"],
      ["contracts-1", "unverified"],
    ]);
  });

  it("refuses an unknown lens before launching anything", async () => {
    p = await integrated();
    simulateShepherds(p, {});
    await expect(runReview(["rel", "--lenses", "speed"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    expect(p.spawned).toEqual([]);
  });

  it("refuses a lens whose skeptic lane name would be too long before launching any reviewer", async () => {
    // "rel-review-<lens>" fits in 48 characters with a 37-character lens; "rel-skeptic-<lens>" does not.
    const lens = "x".repeat(37);
    p = await integrated({ review: { lenses: { [lens]: "Look for x." } } });
    simulateShepherds(p, {});
    await expect(runReview(["rel", "--lenses", lens], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/49 characters/) });
    expect(p.spawned).toEqual([]);
  });
});
