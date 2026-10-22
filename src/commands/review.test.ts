import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { IntegrationRecord, LaneSpec, ReviewFinding, ReviewRecord } from "../types";
import { runIntegrate } from "./integrate";
import { readReviewHistory } from "./records";
import { applyLensVerdicts, formatFindings, formatReview, readLensFiles, reviewLenses, runReview, sinceCommit } from "./review";
import { DEFAULT_CONFIG, branchWith, makeProject, simulateShepherds, writeLaneRun, type LaneRun, type TestProject } from "./testkit";

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

describe("readLensFiles", () => {
  it("reads each lens's file, project-relative or absolute, trimmed", () => {
    p = makeProject({ files: { "lenses/perf.md": "  Hot paths.\n" } });
    const abs = join(p.dir, "abs.md");
    writeFileSync(abs, "Absolute.");
    expect(readLensFiles(p.root, ["perf=lenses/perf.md", `security=${abs}`])).toEqual({ perf: "Hot paths.", security: "Absolute." });
    expect(readLensFiles(p.root, [])).toEqual({});
    expect(() => readLensFiles(p.root, ["perf=lenses"])).toThrow(/cannot read the file of lens perf, lenses/);
  });
});

describe("sinceCommit", () => {
  it("resolves an ancestor of the head to its sha", () => {
    p = makeProject();
    const base = p.ok(["rev-parse", "main"]).trim();
    const head = branchWith(p, "next", "n.txt", "n\n");
    expect(sinceCommit(p.git, p.root, "main", head)).toBe(base);
    expect(() => sinceCommit(p.git, p.root, "next", base)).toThrow(/is not an ancestor of the integration head/);
    expect(() => sinceCommit(p.git, p.root, "", head)).toThrow(/is not a commit/);
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

  it("keeps every round in reviews/<round>.json beside review.json, which holds the latest", async () => {
    p = await integrated();
    simulateShepherds(p, { "rel-review-security": reviewer([finding("leak", "LOW", 1)]) });
    expect(await runReview(["rel", "--lenses", "security"], p.ctx)).toBe(0);
    expect(await runReview(["rel", "--lenses", "security"], p.ctx)).toBe(0);
    const latest = readRecord<ReviewRecord>(join(dir(p), "review.json"));
    expect(latest).toMatchObject({ round: 2, since: null });
    expect(readRecord<ReviewRecord>(join(dir(p), "reviews", "2.json"))).toEqual(latest);
    expect(readReviewHistory(dir(p)).map((r) => [r.round, r.findings.length])).toEqual([
      [1, 1],
      [2, 1],
    ]);
    // The second round ran its reviewer again: the first was taken into a record.
    expect(p.spawned.map((s) => s.lane)).toEqual(["rel-review-security", "rel-review-security"]);
  });

  it("keeps the other lenses of the previous review of the same head on a --lenses run, and drops them for a new head", async () => {
    p = await integrated();
    simulateShepherds(p, {
      "rel-review-correctness": reviewer([finding("off by one", "MEDIUM", 1)]),
      "rel-review-security": reviewer([finding("leak", "HIGH", 2)]),
      "rel-review-contracts": reviewer([]),
      "rel-skeptic-correctness": () => ({
        state: "finished",
        endState: "success",
        report: { verdicts: [{ id: "correctness-1", refuted: false, corrected_severity: "HIGH", reasoning: "real" }] },
      }),
      "rel-skeptic-security": () => ({
        state: "finished",
        endState: "success",
        report: { verdicts: [{ id: "security-1", refuted: true, corrected_severity: "NONE", reasoning: "no" }] },
      }),
    });
    expect(await runReview(["rel"], p.ctx)).toBe(0);

    simulateShepherds(p, { "rel-review-security": reviewer([]) });
    expect(await runReview(["rel", "--lenses", "security"], p.ctx)).toBe(0);
    const kept = readRecord<ReviewRecord>(join(dir(p), "review.json"));
    expect(kept.round).toBe(2);
    expect(kept.lenses.map((l) => l.lens)).toEqual(["correctness", "security", "contracts"]);
    expect(kept.skeptics.map((s) => s.lane)).toEqual(["rel-skeptic-correctness"]);
    expect(kept.findings.map((f) => [f.id, f.severity, f.verdict])).toEqual([["correctness-1", "HIGH", "confirmed"]]);

    branchWith(p, "arbab/b", "b.txt", "b\n");
    expect(await runIntegrate(["rel", "--lanes", "b"], p.ctx)).toBe(0);
    expect(await runReview(["rel", "--lenses", "security"], p.ctx)).toBe(0);
    const fresh = readRecord<ReviewRecord>(join(dir(p), "review.json"));
    expect(fresh.lenses.map((l) => l.lens)).toEqual(["security"]);
    expect(fresh.findings).toEqual([]);
    expect(readReviewHistory(dir(p)).map((r) => r.lenses.length)).toEqual([3, 3, 1]);
  });

  it("adds a --lens-file lens for this run only, and lets one replace a built-in's text", async () => {
    p = await integrated({ review: { lenses: { docs: "Stale docs." } } });
    p.write("lenses/perf.md", "\n## Perf\nHot paths and N+1 queries.\n");
    const security = join(p.dir, "security-lens.md");
    writeFileSync(security, "Only the token handling.");
    simulateShepherds(p, {});
    expect(await runReview(["rel", "--lens-file", "perf=lenses/perf.md", "--lens-file", `security=${security}`, "--timeout-min", "0.5"], p.ctx)).toBe(3);
    expect(p.spawned.map((s) => s.lane)).toEqual(["rel-review-correctness", "rel-review-security", "rel-review-contracts", "rel-review-docs", "rel-review-perf"]);
    const brief = (lens: string): string => readFileSync(join(dir(p), "lanes", `rel-review-${lens}.md`), "utf8");
    expect(brief("perf")).toContain("> ## Perf\n> Hot paths and N+1 queries.");
    expect(brief("security")).toContain("> Only the token handling.");
    expect(brief("security")).not.toContain("Fence escapes");
    // The config is untouched.
    expect(readFileSync(join(p.root, "arbab.config.json"), "utf8")).not.toMatch(/perf|token/);
  });

  it("refuses a --lens-file that is malformed, missing, empty, too long, given twice or not run", async () => {
    p = await integrated();
    simulateShepherds(p, {});
    p.write("empty.md", " \n");
    p.write("long.md", "x".repeat(8_001));
    p.write("ok.md", "Look for x.");
    const refused = async (args: string[], message: RegExp): Promise<void> => {
      await expect(runReview(["rel", ...args], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(message) });
    };
    await refused(["--lens-file", "perf"], /must be <name>=<file>/);
    await refused(["--lens-file", "Perf=ok.md"], /^lens "Perf" must match/);
    await refused(["--lens-file", "perf=none.md"], /the file of lens perf, none\.md, does not exist/);
    await refused(["--lens-file", "perf=../outside.md"], /is outside/);
    await refused(["--lens-file", "perf=empty.md"], /has 0 characters/);
    await refused(["--lens-file", "perf=long.md"], /has 8001 characters/);
    await refused(["--lens-file", "perf=ok.md", "--lens-file", "perf=ok.md"], /names lens perf twice/);
    await refused(["--lens-file", "perf=ok.md", "--lenses", "security"], /--lens-file gives perf, which --lenses does not run/);
    await refused(["--lens-file", `${"x".repeat(37)}=ok.md`], /49 characters/);
    expect(p.spawned).toEqual([]);
  });

  it("--since reviews what changed since an ancestor of the head, and records it", async () => {
    p = await integrated();
    const first = readRecord<IntegrationRecord>(join(dir(p), "integration.json")).headSha;
    branchWith(p, "arbab/b", "b.txt", "b\n");
    expect(await runIntegrate(["rel", "--lanes", "b"], p.ctx)).toBe(0);
    simulateShepherds(p, {
      "rel-review-security": reviewer([finding("leak", "HIGH", 1)]),
      "rel-skeptic-security": () => ({ state: "finished", endState: "success", report: { verdicts: [] } }),
    });
    expect(await runReview(["rel", "--lenses", "security", "--since", first.slice(0, 12)], p.ctx)).toBe(0);
    expect(readRecord<ReviewRecord>(join(dir(p), "review.json")).since).toBe(first);
    for (const lane of ["rel-review-security", "rel-skeptic-security"]) {
      expect(readFileSync(join(dir(p), "lanes", `${lane}.md`), "utf8")).toContain(`git diff ${first}..HEAD`);
    }
    expect(readFileSync(join(dir(p), "lanes", "rel-review-security.md"), "utf8")).toContain("this round covers only what changed since");
  });

  it("refuses a --since that is not a commit, not an ancestor of the head, or the head itself", async () => {
    p = await integrated();
    const head = readRecord<IntegrationRecord>(join(dir(p), "integration.json")).headSha;
    const elsewhere = branchWith(p, "other", "o.txt", "o\n");
    simulateShepherds(p, {});
    await expect(runReview(["rel", "--since", "nope"], p.ctx)).rejects.toMatchObject({ code: "usage", message: "--since nope does not name a commit" });
    await expect(runReview(["rel", "--since=--all"], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/is not a commit/) });
    await expect(runReview(["rel", "--since", elsewhere], p.ctx)).rejects.toMatchObject({
      code: "usage",
      message: `--since ${elsewhere} (${elsewhere}) is not an ancestor of the integration head ${head}`,
    });
    await expect(runReview(["rel", "--since", head], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/is the integration head itself/) });
    expect(p.spawned).toEqual([]);
  });

  it("after the reviewers timed out, takes the ones that finished on the same head and relaunches the others", async () => {
    p = await integrated();
    simulateShepherds(p, { "rel-review-security": () => ({ state: "running" }), "rel-review-contracts": () => ({ state: "running" }) });
    expect(await runReview(["rel", "--lenses", "security,contracts", "--timeout-min", "0.5"], p.ctx)).toBe(3);
    const pid = (lane: string): number => readRecord<{ shepherdPid: number }>(join(p.runsRoot, lane, "state.json")).shepherdPid;
    writeLaneRun(p.runsRoot, "rel-review-security", { ...reviewer([finding("leak", "HIGH", 1)])(), shepherdPid: pid("rel-review-security") });
    // contracts finished without a report: nothing to take.
    writeLaneRun(p.runsRoot, "rel-review-contracts", { state: "finished", endState: "success", shepherdPid: pid("rel-review-contracts") });
    simulateShepherds(p, {
      "rel-review-contracts": reviewer([]),
      "rel-skeptic-security": () => ({ state: "finished", endState: "success", report: { verdicts: [{ id: "security-1", refuted: false, corrected_severity: "HIGH", reasoning: "real" }] } }),
    });
    expect(await runReview(["rel", "--lenses", "security,contracts"], p.ctx)).toBe(0);
    expect(p.spawned.map((s) => s.lane)).toEqual(["rel-review-security", "rel-review-contracts", "rel-review-contracts", "rel-skeptic-security"]);
    expect(readRecord<ReviewRecord>(join(dir(p), "review.json")).findings.map((f) => [f.id, f.verdict])).toEqual([["security-1", "confirmed"]]);
  });

  it("after the skeptics timed out, the next review takes the reviewers and the skeptics as they finished", async () => {
    p = await integrated();
    simulateShepherds(p, { "rel-review-security": reviewer([finding("leak", "HIGH", 1)]), "rel-skeptic-security": () => ({ state: "running" }) });
    expect(await runReview(["rel", "--lenses", "security", "--timeout-min", "0.5"], p.ctx)).toBe(3);
    const pid = readRecord<{ shepherdPid: number }>(join(p.runsRoot, "rel-skeptic-security", "state.json")).shepherdPid;
    writeLaneRun(p.runsRoot, "rel-skeptic-security", {
      state: "finished",
      endState: "success",
      shepherdPid: pid,
      report: { verdicts: [{ id: "security-1", refuted: true, corrected_severity: "NONE", reasoning: "no" }] },
    });
    expect(await runReview(["rel", "--lenses", "security"], p.ctx)).toBe(0);
    expect(p.spawned.map((s) => s.lane)).toEqual(["rel-review-security", "rel-skeptic-security"]);
    expect(readRecord<ReviewRecord>(join(dir(p), "review.json"))).toMatchObject({ round: 2, findings: [{ id: "security-1", verdict: "refuted" }] });
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
