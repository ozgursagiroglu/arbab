import { describe, expect, it } from "vitest";
import type { HostCheckRecord, IntegrationRecord, ReviewFinding, ReviewRecord, Tier, VerifyRecord } from "../types";
import { baseMergeInstruction, computeReadiness, renderReadiness, roundsLine } from "./index";
import type { ReadinessInput } from "./index";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const NOW = "2026-10-09T12:00:00.000Z";
const WORKTREE = "/repo/.arbab/worktrees/integrate-m3";

function integration(over: Partial<IntegrationRecord> = {}): IntegrationRecord {
  return {
    name: "m3",
    branch: "integrate/m3",
    worktree: WORKTREE,
    base: "main",
    baseSha: "c".repeat(40),
    merged: [{ lane: "lane-a", branch: "arbab/lane-a", sha: "d".repeat(40), manifests: [] }],
    manifests: [],
    depsConfirmedAt: null,
    depsConfirmed: false,
    headSha: HEAD,
    updatedAt: NOW,
    ...over,
  };
}

function verify(over: Partial<VerifyRecord> = {}): VerifyRecord {
  return {
    name: "m3",
    lane: "m3-verify",
    attempt: 1,
    headSha: HEAD,
    results: [
      { kind: "gate", argv: ["pnpm", "test"], command: "pnpm test", exitCode: 0 },
      { kind: "smoke", argv: ["pnpm", "smoke"], command: "pnpm smoke", exitCode: 0 },
    ],
    passed: true,
    finishedAt: NOW,
    ...over,
  };
}

function lensRow(
  lens: string,
  endState: "success" | "failed" = "success",
  over: { coverage?: string | null; pathsChecked?: number } = {},
) {
  return { lens, lane: `m3-review-${lens}`, endState, coverage: "read every file in scope", pathsChecked: 4, ...over };
}

function finding(over: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id: "correctness-1",
    lens: "correctness",
    title: "Off by one",
    severity: "HIGH",
    file: "src/x.ts",
    line: 3,
    failureScenario: "s",
    evidence: "e",
    verdict: "confirmed",
    ...over,
  };
}

function review(over: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    name: "m3",
    headSha: HEAD,
    lenses: ["correctness", "security", "contracts"].map((lens) => lensRow(lens)),
    skeptics: [],
    findings: [],
    finishedAt: NOW,
    ...over,
  };
}

const GOOD_REPORT = { open_questions: [], not_verified: [] };

function input(over: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    name: "m3",
    tier: "medium",
    integration: integration(),
    worktree: WORKTREE,
    verify: verify(),
    review: review(),
    laneReports: [{ lane: "lane-a", report: GOOD_REPORT }],
    configLenses: ["correctness", "security", "contracts"],
    smokeConfigured: true,
    waivers: [],
    now: NOW,
    ...over,
  };
}

const skippedIds = (over: Partial<ReadinessInput>) => computeReadiness(input(over)).skipped.map((item) => item.id);
const riskIds = (over: Partial<ReadinessInput>) => computeReadiness(input(over)).risks.map((item) => item.id);

describe("computeReadiness: tiers", () => {
  it.each<Tier>(["low", "medium", "high"])("%s: everything current and passing is ready with nothing skipped", (tier) => {
    const report = computeReadiness(input({ tier }));
    expect(report.skipped).toEqual([]);
    expect(report.risks).toEqual([]);
    expect(report.ready).toBe(true);
    expect(report).toMatchObject({ name: "m3", tier, headSha: HEAD, createdAt: NOW });
  });

  it("low requires verify only", () => {
    expect(skippedIds({ tier: "low", review: null, smokeConfigured: false })).toEqual([]);
    expect(skippedIds({ tier: "low", verify: null })).toEqual(["verify"]);
  });

  it("medium requires verify and one lens", () => {
    expect(skippedIds({ tier: "medium", review: null, smokeConfigured: false })).toEqual(["review"]);
    expect(skippedIds({ tier: "medium", review: review({ lenses: [lensRow("security")] }) })).toEqual([]);
  });

  it("high requires every lens, the skeptic pass and smoke", () => {
    expect(skippedIds({ tier: "high", verify: null, review: null, smokeConfigured: false })).toEqual([
      "verify",
      "review:correctness",
      "review:security",
      "review:contracts",
      "smoke",
    ]);
  });
});

describe("computeReadiness: skipped items appear and disappear", () => {
  it("verify: absent, failed, stale", () => {
    expect(skippedIds({ verify: null })).toEqual(["verify"]);
    expect(skippedIds({ verify: verify({ passed: false }) })).toEqual(["verify"]);
    expect(skippedIds({ verify: verify({ headSha: OLD }) })).toEqual(["verify"]);
    expect(computeReadiness(input({ verify: verify({ headSha: OLD }) })).skipped[0]?.text).toContain(OLD);
    expect(skippedIds({})).toEqual([]);
  });

  it("verify: a failed one says why, its reason first, else the failing gates", () => {
    const text = (over: Partial<VerifyRecord>) => computeReadiness(input({ verify: verify(over) })).skipped[0]?.text;
    expect(text({ passed: false, reason: "the lane ran on 1234567, not on the head" })).toBe(
      "verify did not pass on the head: the lane ran on 1234567, not on the head",
    );
    const results: VerifyRecord["results"] = [
      { kind: "gate", argv: ["pnpm", "test"], command: "pnpm test", exitCode: 1 },
      { kind: "gate", argv: ["pnpm", "build"], command: "pnpm build", exitCode: 0 },
      { kind: "smoke", argv: ["pnpm", "smoke"], command: "pnpm smoke", exitCode: null },
    ];
    expect(text({ passed: false, results })).toBe(
      "verify did not pass on the head: failing pnpm test (exit 1), pnpm smoke (missing (counts as a failure))",
    );
    // A blank or non-string reason (verify.json is not checked for it) falls back to the gates.
    expect(text({ passed: false, results, reason: "  " })).toContain("failing pnpm test (exit 1)");
    expect(text({ passed: false, results, reason: 7 as unknown as string })).toContain("failing pnpm test (exit 1)");
    expect(text({ passed: false })).toBe("verify did not pass on the head");
  });

  it("deps: a changed manifest until confirmed", () => {
    const merged = [{ lane: "lane-a", branch: "arbab/lane-a", sha: "d".repeat(40), manifests: ["package.json"] }];
    const manifests = ["package.json"];
    expect(skippedIds({ tier: "low", integration: integration({ merged, manifests }) })).toEqual(["deps"]);
    expect(skippedIds({ tier: "low", integration: integration({ merged, manifests, depsConfirmed: true }) })).toEqual([]);
  });

  it("deps: from the whole record, naming the lanes and any commit arbab did not merge", () => {
    // lane-a's change was undone later; pnpm-lock.yaml changed by hand in the integration worktree.
    const merged = [
      { lane: "lane-a", branch: "arbab/lane-a", sha: "d".repeat(40), manifests: ["package.json", ".npmrc"] },
      { lane: "lane-b", branch: "arbab/lane-b", sha: "e".repeat(40), manifests: ["package.json"] },
    ];
    const report = computeReadiness(
      input({ tier: "low", integration: integration({ merged, manifests: ["package.json", "pnpm-lock.yaml"] }) }),
    );
    expect(report.skipped).toEqual([
      {
        id: "deps",
        text: "dependency manifests changed (package.json by lane-a, lane-b; pnpm-lock.yaml by a commit arbab did not merge) and their install is not confirmed",
        waived: false,
      },
    ]);
    // A lane's manifests alone are not the record's.
    expect(skippedIds({ tier: "low", integration: integration({ merged }) })).toEqual([]);
  });

  it("review: medium, no succeeded lens of a current review", () => {
    const failed = review({ lenses: [lensRow("correctness", "failed")] });
    expect(skippedIds({ review: failed })).toEqual(["review"]);
    expect(skippedIds({ review: review({ headSha: OLD }) })).toEqual(["review"]);
    expect(skippedIds({ tier: "low", review: failed })).toEqual([]);
    expect(skippedIds({ tier: "high" })).not.toContain("review");
  });

  it("review:<lens>: high, built-in and config lenses without a current success", () => {
    const partial = review({ lenses: [lensRow("correctness"), lensRow("security", "failed"), lensRow("perf")] });
    expect(skippedIds({ tier: "high", review: partial, configLenses: ["perf", "a11y"] })).toEqual([
      "review:security",
      "review:contracts",
      "review:a11y",
    ]);
    expect(skippedIds({ tier: "high", review: review({ headSha: OLD }), configLenses: [] })).toEqual([
      "review:correctness",
      "review:security",
      "review:contracts",
    ]);
  });

  it("a lens without coverage or without a checked path does not count, with the reason", () => {
    const empty = review({ lenses: [lensRow("correctness", "success", { coverage: null })] });
    const blank = review({ lenses: [lensRow("correctness", "success", { coverage: "  " })] });
    const noPaths = review({ lenses: [lensRow("correctness", "success", { pathsChecked: 0 })] });
    for (const r of [empty, blank, noPaths]) {
      expect(computeReadiness(input({ review: r })).verified.map((item) => item.id)).not.toContain("review:correctness");
      expect(skippedIds({ review: r })).toEqual(["review"]);
    }
    expect(computeReadiness(input({ review: empty })).skipped[0]?.text).toBe(
      "no review lens succeeded on the head (correctness: no coverage)",
    );
    expect(computeReadiness(input({ review: noPaths })).skipped[0]?.text).toBe(
      "no review lens succeeded on the head (correctness: no paths checked)",
    );
    const high = computeReadiness(input({ tier: "high", review: empty, configLenses: [] }));
    expect(high.skipped.find((item) => item.id === "review:correctness")?.text).toBe(
      "the correctness lens does not count on the head: no coverage",
    );
    expect(high.risks.map((item) => item.id)).not.toContain("lens:correctness");
  });

  it("a lens that counts once is not undone by another entry of it that does not", () => {
    const twice = review({ lenses: [lensRow("correctness", "success", { coverage: null }), lensRow("correctness")] });
    expect(skippedIds({ review: twice })).toEqual([]);
    expect(riskIds({ review: twice })).toEqual([]);
  });

  it("skeptic: high, MEDIUM+ findings still unverified", () => {
    const withFindings = (findings: ReviewFinding[]) => skippedIds({ tier: "high", review: review({ findings }) });
    expect(withFindings([finding({ verdict: "unverified" })])).toEqual(["skeptic"]);
    expect(withFindings([finding({ verdict: "unverified", severity: "MEDIUM" })])).toEqual(["skeptic"]);
    expect(withFindings([finding({ verdict: "unverified", severity: "LOW" })])).toEqual([]);
    expect(withFindings([finding({ verdict: "refuted" }), finding({ verdict: "confirmed" })])).toEqual([]);
    expect(skippedIds({ tier: "medium", review: review({ findings: [finding({ verdict: "unverified" })] }) })).toEqual(
      [],
    );
  });

  it("smoke: high, not configured, missing, failed or stale", () => {
    expect(skippedIds({ tier: "high", smokeConfigured: false })).toEqual(["smoke"]);
    const gateOnly = verify({ results: [{ kind: "gate", argv: ["x"], command: "x", exitCode: 0 }] });
    expect(skippedIds({ tier: "high", verify: gateOnly })).toEqual(["smoke"]);
    const smokeFailed = verify({
      passed: false,
      results: [{ kind: "smoke", argv: ["s"], command: "s", exitCode: null }],
    });
    expect(skippedIds({ tier: "high", verify: smokeFailed })).toEqual(["verify", "smoke"]);
    expect(skippedIds({ tier: "high", verify: verify({ headSha: OLD }) })).toEqual(["verify", "smoke"]);
    expect(skippedIds({ tier: "medium", smokeConfigured: false })).toEqual([]);
  });
});

describe("computeReadiness: waivers", () => {
  it("marks waived items; ready once all are waived and verify passed", () => {
    const report = computeReadiness(input({ tier: "high", review: null, waivers: ["review:correctness", " smoke "] }));
    expect(report.skipped.filter((item) => item.waived).map((item) => item.id)).toEqual(["review:correctness"]);
    expect(report.ready).toBe(false);
    const all = computeReadiness(
      input({ tier: "high", review: null, waivers: ["review:correctness", "review:security", "review:contracts"] }),
    );
    expect(all.skipped.every((item) => item.waived)).toBe(true);
    expect(all.ready).toBe(true);
  });

  it("a waived verify never makes it ready", () => {
    const report = computeReadiness(input({ verify: null, waivers: ["verify"] }));
    expect(report.skipped).toEqual([{ id: "verify", text: "verify has not run", waived: true }]);
    expect(report.ready).toBe(false);
  });

  it("an unknown waiver becomes a risk, once; blank waivers are ignored", () => {
    const report = computeReadiness(input({ waivers: ["skeptic", "skeptic", "", "  "] }));
    expect(report.risks).toEqual([{ id: "waiver:skeptic", text: "waiver skeptic matches no skipped item" }]);
    expect(report.ready).toBe(true);
  });
});

describe("computeReadiness: verified", () => {
  it("lists current verify results, succeeded lenses and finding counts", () => {
    const report = computeReadiness(
      input({
        verify: verify({
          passed: false,
          results: [
            { kind: "gate", argv: ["pnpm", "test"], command: "pnpm test", exitCode: 1 },
            { kind: "gate", argv: ["pnpm", "build"], command: "pnpm build", exitCode: null },
          ],
        }),
        review: review({
          lenses: [lensRow("correctness"), lensRow("correctness"), lensRow("security", "failed")],
          findings: [finding(), finding({ verdict: "refuted" }), finding({ verdict: "unverified", severity: "LOW" })],
        }),
      }),
    );
    expect(report.verified).toEqual([
      { id: "verify:pnpm test", text: "gate: exit 1" },
      { id: "verify:pnpm build", text: "gate: missing (counts as a failure)" },
      { id: "review:correctness", text: "lens ran, 4 paths checked" },
      { id: "findings", text: "1 confirmed, 1 refuted, 1 unverified" },
    ]);
  });

  it("lists nothing from stale records", () => {
    const report = computeReadiness(input({ verify: verify({ headSha: OLD }), review: review({ headSha: OLD }) }));
    expect(report.verified).toEqual([]);
  });
});

describe("computeReadiness: risks", () => {
  it("every confirmed finding, then each unverified MEDIUM+ one, not refuted ones", () => {
    const findings = [
      finding({ id: "correctness-1" }),
      finding({ id: "security-1", lens: "security", severity: "MEDIUM", verdict: "unverified", line: undefined }),
      finding({ id: "correctness-2", verdict: "refuted" }),
      // Confirmed by a skeptic who lowered it to LOW.
      finding({ id: "correctness-3", severity: "LOW" }),
      finding({ id: "correctness-4", severity: "LOW", verdict: "refuted" }),
    ];
    expect(computeReadiness(input({ review: review({ findings }) })).risks).toEqual([
      { id: "finding:correctness-1", text: "correctness-1: Off by one (src/x.ts:3) — HIGH, confirmed" },
      { id: "finding:correctness-3", text: "correctness-3: Off by one (src/x.ts:3) — LOW, confirmed" },
      { id: "finding:security-1", text: "security-1: Off by one (src/x.ts) — MEDIUM, unverified" },
    ]);
  });

  it("orders risks by weight: findings, manifests, host gates, stale and waived items, lane notes", () => {
    const merged = [{ lane: "lane-a", branch: "arbab/lane-a", sha: "d".repeat(40), manifests: ["package.json"] }];
    const report = computeReadiness(
      input({
        integration: integration({ merged, manifests: ["package.json"], depsConfirmed: true }),
        verify: verify({ headSha: OLD }),
        review: review({
          findings: [
            finding({ id: "security-1", lens: "security", severity: "MEDIUM", verdict: "unverified" }),
            finding({ id: "correctness-2", severity: "LOW", verdict: "unverified", title: "Typo" }),
            finding({ id: "correctness-1" }),
          ],
        }),
        laneReports: [{ lane: "lane-a", report: { open_questions: ["Q"], not_verified: [] } }],
        hostGates: [["docker", "build", "."]],
        waivers: ["nope"],
      }),
    );
    expect(report.risks.map((item) => item.id)).toEqual([
      "finding:correctness-1",
      "finding:security-1",
      "findings:low-unverified",
      "manifest:package.json",
      "host-gates",
      "stale:verify",
      "waiver:nope",
      "open_questions:lane-a:1",
    ]);
  });

  it("lists other sessions first, as risks: never skipped items, never in the way of ready", () => {
    const otherSessions = [
      { owner: "bbbbbbbb-1111-2222", lanes: ["theirs"], waiters: 1, runnerProjects: [], runnersChanged: [] },
      { owner: null, lanes: [], waiters: 0, runnerProjects: ["/work/x"], runnersChanged: ["dist/arbab.mjs"] },
    ];
    const report = computeReadiness(input({ otherSessions, review: review({ findings: [finding({ id: "correctness-1" })] }) }));
    expect(report.risks.map((item) => item.id)).toEqual(["session:bbbbbbbb", "session:outside", "finding:correctness-1"]);
    expect(report.risks[0]?.text).toBe(
      "Session bbbbbbbb runs lane theirs and a waiter in this project, whose base this landing moves. " +
        "Tell them before landing: Claude Code's ListAgents lists sessions by name and SendMessage reaches them.",
    );
    expect(report.risks[1]?.text).toMatch(/^Processes started outside Claude Code run this project's dist\/arbab\.mjs in \/work\/x,/);
    expect(report.skipped).toEqual([]);
    expect(report.ready).toBe(true);
    expect(report.otherSessions).toEqual(otherSessions);
    // Under Risks, after the skipped section.
    const md = renderReadiness(report);
    expect(md.indexOf("- Session bbbbbbbb runs lane theirs")).toBeGreaterThan(md.indexOf("## Risks"));
    expect(md).toContain("- Processes started outside Claude Code run this project's dist/arbab.mjs in /work/x");
  });

  it("says first when it cannot tell the other sessions, as one risk that leaves the rest of the report as it is", () => {
    const reason = "cannot list /x/shepherds: ENOTDIR";
    const known = computeReadiness(input({ review: review({ findings: [finding({ id: "correctness-1" })] }) }));
    const unknown = computeReadiness(input({ sessionsUnknown: reason, review: review({ findings: [finding({ id: "correctness-1" })] }) }));
    expect(unknown.risks).toEqual([
      { id: "session:unknown", text: `cannot tell which other sessions are working here: ${reason}` },
      ...known.risks,
    ]);
    expect({ ...unknown, risks: known.risks }).toEqual(known);
    expect(unknown.ready).toBe(true);
  });

  it("puts a moved base first, naming the landings that moved it, as a risk that needs no waiver", () => {
    const landings = [
      { name: "hot", into: "main", landedAt: NOW, owner: "cccccccc-1111", mergeSha: OLD, squash: false, lanes: 1 },
      { name: "cold", into: "main", landedAt: NOW, owner: null, mergeSha: OLD, squash: true, lanes: 2 },
    ];
    const report = computeReadiness(input({ sessionsUnknown: "x", baseMoved: { base: "main", landings, commits: 4 } }));
    expect(report.risks[0]).toEqual({
      id: "base-moved",
      text:
        `main moved since this integration started: hot at ${NOW} (session cccccccc), cold at ${NOW} (outside Claude Code) landed, ` +
        `so land would refuse. ${baseMergeInstruction("main", "m3", WORKTREE)}.`,
    });
    // The safe merge land gives too: hooks off, then refresh, verify, review and readiness again.
    expect(report.risks[0]?.text).toContain(
      `Merge main into integrate/m3 with hooks off: git -C ${WORKTREE} -c core.hooksPath=/dev/null -c core.fsmonitor=false ` +
        "-c diff.ignoreSubmodules=all -c submodule.recurse=false merge --no-verify --no-edit main; then arbab integrate m3 " +
        "--refresh to record the new head, and verify, review and readiness for m3 again.",
    );
    expect(report.risks[1]?.id).toBe("session:unknown");
    expect(report.skipped).toEqual([]);
    expect(report.ready).toBe(true);
  });

  it("counts the new commits when no landing record explains a moved base, and says nothing of a base that did not move", () => {
    const risk = (commits: number | null) =>
      computeReadiness(input({ baseMoved: { base: "dev", landings: [], commits } })).risks.find((r) => r.id === "base-moved")?.text;
    const merge = `, so land would refuse. ${baseMergeInstruction("dev", "m3", WORKTREE)}.`;
    expect(risk(1)).toBe(`dev moved since this integration started: 1 new commit${merge}`);
    expect(risk(3)).toBe(`dev moved since this integration started: 3 new commits${merge}`);
    expect(risk(null)).toBe(`dev moved since this integration started: it has new commits${merge}`);
    expect(riskIds({ baseMoved: null })).not.toContain("base-moved");
    expect(riskIds({})).not.toContain("base-moved");
  });

  it("names the worktree it is given, as land does, not integration.json's copy", () => {
    const report = computeReadiness(
      input({ integration: integration({ worktree: "/elsewhere" }), worktree: "/my repo/wt", baseMoved: { base: "main", landings: [], commits: 1 } }),
    );
    expect(report.risks[0]?.text).toContain(`${baseMergeInstruction("main", "m3", "/my repo/wt")}.`);
    expect(report.risks[0]?.text).toContain("git -C '/my repo/wt' ");
    expect(report.risks[0]?.text).not.toContain("/elsewhere");
  });

  it("records an empty otherSessions when given none, and leaves it out of a report computed without", () => {
    expect(computeReadiness(input({ otherSessions: [] })).otherSessions).toEqual([]);
    expect("otherSessions" in computeReadiness(input())).toBe(false);
  });

  it("identical risk texts collapse to the first", () => {
    const merged = ["lane-a", "lane-b"].map((lane) => ({ lane, branch: `arbab/${lane}`, sha: "d".repeat(40), manifests: [] }));
    const report = computeReadiness(
      input({
        integration: integration({ merged }),
        laneReports: [
          { lane: "lane-a", report: { open_questions: ["Q", "Q"], not_verified: [] } },
          { lane: "lane-b", report: "broken" },
          { lane: "x", report: "broken", worktree: "lane-b" },
        ],
      }),
    );
    expect(report.risks).toEqual([
      { id: "open_questions:lane-a:1", text: "lane-a (open question): Q" },
      { id: "report:lane-b", text: "lane-b: the report is missing or not an object" },
      { id: "report:x", text: "x: the report is missing or not an object" },
    ]);
  });

  it("a lens that does not count, when no skipped item names it", () => {
    const r = review({ lenses: [lensRow("correctness"), lensRow("security", "success", { coverage: null }), lensRow("contracts", "failed")] });
    expect(computeReadiness(input({ review: r })).risks).toEqual([
      { id: "lens:security", text: "the security lens does not count: no coverage" },
      { id: "lens:contracts", text: "the contracts lens does not count: ended failed" },
    ]);
    expect(riskIds({ tier: "low", review: r })).toEqual(["lens:security", "lens:contracts"]);
  });

  it("one line for the unverified LOW findings, with their count, ids and titles", () => {
    const findings = [
      finding({ id: "correctness-2", severity: "LOW", verdict: "unverified", title: "Typo" }),
      finding({ id: "correctness-3", severity: "LOW", verdict: "refuted" }),
      finding({ id: "security-1", lens: "security", severity: "LOW", verdict: "unverified", title: "Loose mode" }),
      finding({ id: "security-2", lens: "security", severity: "MEDIUM", verdict: "unverified" }),
    ];
    expect(computeReadiness(input({ review: review({ findings }) })).risks).toEqual([
      { id: "finding:security-2", text: "security-2: Off by one (src/x.ts:3) — MEDIUM, unverified" },
      { id: "findings:low-unverified", text: "2 LOW findings unverified: correctness-2 (Typo), security-1 (Loose mode)" },
    ]);
    expect(riskIds({ review: review({ findings: [finding({ severity: "LOW", verdict: "confirmed" })] }) })).toEqual([
      "finding:correctness-1",
    ]);
  });

  it("stale verify and review, with findings of the stale review kept", () => {
    const report = computeReadiness(
      input({ verify: verify({ headSha: OLD }), review: review({ headSha: OLD, findings: [finding()] }) }),
    );
    expect(report.risks.map((item) => item.id)).toEqual(["finding:correctness-1", "stale:verify", "stale:review"]);
    expect(report.risks[1]?.text).toBe(`verify (m3-verify) is stale: it ran on ${OLD}, the head is ${HEAD}`);
    expect(report.risks[2]?.text).toBe(`review is stale: it ran on ${OLD}, the head is ${HEAD}`);
    expect(report.ready).toBe(false);
  });

  it("lane reports: open questions and not_verified, prefixed by the lane", () => {
    const report = computeReadiness(
      input({ laneReports: [{ lane: "lane-a", report: { open_questions: ["Q1"], not_verified: ["Linux", "ps"] } }] }),
    );
    expect(report.risks).toEqual([
      { id: "open_questions:lane-a:1", text: "lane-a (open question): Q1" },
      { id: "not_verified:lane-a:1", text: "lane-a (not verified): Linux" },
      { id: "not_verified:lane-a:2", text: "lane-a (not verified): ps" },
    ]);
  });

  it("malformed, missing and unmerged lane reports", () => {
    const merged = ["lane-a", "lane-b", "lane-c", "lane-d"].map((lane) => ({
      lane,
      branch: `arbab/${lane}`,
      sha: "d".repeat(40),
      manifests: [],
    }));
    const report = computeReadiness(
      input({
        integration: integration({ merged }),
        laneReports: [
          { lane: "lane-a", report: "not json" },
          { lane: "lane-b", report: { open_questions: [1], not_verified: ["x"] } },
          { lane: "lane-c", report: [] },
          { lane: "other", report: { open_questions: ["ignored"], not_verified: [] } },
        ],
      }),
    );
    expect(report.risks).toEqual([
      { id: "report:lane-a", text: "lane-a: the report is missing or not an object" },
      { id: "report:lane-b:open_questions", text: "lane-b: the report's open_questions is not a list of strings" },
      { id: "not_verified:lane-b:1", text: "lane-b (not verified): x" },
      { id: "report:lane-c", text: "lane-c: the report is missing or not an object" },
      { id: "report:lane-d", text: "lane-d: the report is missing or not an object" },
    ]);
  });

  it("lanes that worked in a merged lane's worktree: under their own name, after the owner's", () => {
    const merged = ["lane-a", "lane-b"].map((lane) => ({ lane, branch: `arbab/${lane}`, sha: "d".repeat(40), manifests: [] }));
    const report = computeReadiness(
      input({
        integration: integration({ merged }),
        laneReports: [
          { lane: "lane-a", report: { open_questions: ["QA"], not_verified: [] } },
          { lane: "lane-b", report: GOOD_REPORT },
          { lane: "a-fix", report: { open_questions: ["QF"], not_verified: ["NF"] }, worktree: "lane-a" },
          { lane: "a-verify", report: null, worktree: "lane-a" },
          { lane: "b-verify", report: { open_questions: [], not_verified: ["NB"] }, worktree: "lane-b" },
          // Not a merged lane's worktree, or merged itself: nothing extra.
          { lane: "x-verify", report: { open_questions: ["ignored"], not_verified: [] }, worktree: "other" },
          { lane: "lane-b", report: { open_questions: ["twice"], not_verified: [] }, worktree: "lane-a" },
        ],
      }),
    );
    expect(report.risks).toEqual([
      { id: "open_questions:lane-a:1", text: "lane-a (open question): QA" },
      { id: "open_questions:a-fix:1", text: "a-fix (open question): QF" },
      { id: "not_verified:a-fix:1", text: "a-fix (not verified): NF" },
      { id: "report:a-verify", text: "a-verify: the report is missing or not an object" },
      { id: "not_verified:b-verify:1", text: "b-verify (not verified): NB" },
    ]);
  });

  it("each changed manifest of the record, even when confirmed, with the lanes that changed it", () => {
    const merged = [{ lane: "lane-a", branch: "arbab/lane-a", sha: "d".repeat(40), manifests: ["package.json", "go.mod"] }];
    const record = integration({ merged, manifests: ["package.json", "pnpm-lock.yaml"], depsConfirmed: true });
    expect(computeReadiness(input({ integration: record })).risks).toEqual([
      { id: "manifest:package.json", text: "package.json changed by lane-a" },
      { id: "manifest:pnpm-lock.yaml", text: "pnpm-lock.yaml changed by a commit arbab did not merge" },
    ]);
  });
});

describe("computeReadiness: a review carried over a clean base merge", () => {
  it("counts the review of the earlier head, says so, and never carries verify over", () => {
    const report = computeReadiness(
      input({
        verify: verify({ headSha: OLD }),
        review: review({ headSha: OLD, findings: [finding()] }),
        reviewCarryOver: { from: OLD, base: "main" },
      }),
    );
    expect(report.reviewCarriedOverFrom).toBe(OLD);
    expect(report.verified).toContainEqual({
      id: "review-carried-over",
      text: "review carried over from bbbbbbb: the head adds only a clean merge of main",
    });
    expect(report.verified.map((item) => item.id)).toContain("review:correctness");
    expect(report.skipped.map((item) => item.id)).toEqual(["verify"]);
    expect(report.risks.map((item) => item.id)).toEqual(["finding:correctness-1", "stale:verify"]);
    expect(report.ready).toBe(false);
  });

  it("is ignored for another reviewed head, and absent when the review is of the head", () => {
    const other = computeReadiness(input({ review: review({ headSha: OLD }), reviewCarryOver: { from: "e".repeat(40), base: "main" } }));
    expect(other.reviewCarriedOverFrom).toBeUndefined();
    expect(other.risks.map((item) => item.id)).toContain("stale:review");
    const same = computeReadiness(input({ reviewCarryOver: { from: HEAD, base: "main" } }));
    expect(same).not.toHaveProperty("reviewCarriedOverFrom");
    expect(same.verified.map((item) => item.id)).not.toContain("review-carried-over");
  });
});

describe("computeReadiness: host gates", () => {
  const gates = [["docker", "build", "."], ["pnpm", "e2e"]];
  const checks = (over: Partial<HostCheckRecord> = {}): HostCheckRecord => ({
    name: "m3",
    headSha: HEAD,
    results: gates.map((argv) => ({ kind: "gate", argv, command: argv.join(" "), exitCode: 0 })),
    passed: true,
    interactive: true,
    finishedAt: NOW,
    ...over,
  });

  it("nothing without configured gates", () => {
    const report = computeReadiness(input({ hostChecks: checks() }));
    expect(report.verified.map((item) => item.id)).not.toContain("host:docker build .");
    expect(report.skipped).toEqual([]);
  });

  it("each gate is verified once host-checks.json passed on the head", () => {
    const report = computeReadiness(input({ hostGates: gates, hostChecks: checks() }));
    expect(report.verified.filter((item) => item.id.startsWith("host:"))).toEqual([
      { id: "host:docker build .", text: "host gate: exit 0" },
      { id: "host:pnpm e2e", text: "host gate: exit 0" },
    ]);
    expect(report.skipped).toEqual([]);
    expect(report.ready).toBe(true);
  });

  it("one skipped item `host` while they have not run, ran on another head, failed or miss a gate", () => {
    const host = (hostChecks: HostCheckRecord | null) =>
      computeReadiness(input({ hostGates: gates, hostChecks })).skipped.find((item) => item.id === "host")?.text;
    expect(host(null)).toBe("the host gates have not run; run arbab host-check m3 in a terminal");
    expect(host(checks({ headSha: OLD }))).toBe(`the host gates ran on ${OLD}, not on the head ${HEAD}; run arbab host-check m3 in a terminal`);
    const failed = checks({
      passed: false,
      results: [{ kind: "gate", argv: ["docker", "build", "."], command: "docker build .", exitCode: 2 }],
    });
    expect(host(failed)).toBe("the host gates did not pass on the head: docker build . (exit 2), pnpm e2e (not run)");
    expect(host(checks({ passed: false }))).toBe("the host gates did not pass on the head");
    const report = computeReadiness(input({ hostGates: gates, hostChecks: null }));
    expect(report.skipped.map((item) => item.id)).toEqual(["host"]);
    expect(report.risks.map((item) => item.id)).toEqual(["host-gates"]);
    expect(report.verified.map((item) => item.id)).not.toContain("host:pnpm e2e");
    expect(report.ready).toBe(false);
  });

  it("the human may waive host", () => {
    const report = computeReadiness(input({ hostGates: gates, hostChecks: null, waivers: ["host"] }));
    expect(report.skipped).toEqual([{ id: "host", text: expect.any(String), waived: true }]);
    expect(report.ready).toBe(true);
  });
});

describe("computeReadiness: lane notes people can read", () => {
  const merged = ["lane-a", "lane-b", "lane-c"].map((lane) => ({ lane, branch: `arbab/${lane}`, sha: "d".repeat(40), manifests: [] }));
  const report = computeReadiness(
    input({
      integration: integration({ merged }),
      laneReports: [
        {
          lane: "lane-a",
          report: {
            open_questions: ["Should the cache be shared?"],
            not_verified: ["pnpm build: the sandbox blocks writes to plugin/", "Ran 12 tests on Linux only", "Postgres: no database here"],
          },
        },
        {
          lane: "lane-b",
          report: {
            open_questions: [],
            not_verified: ["pnpm install hit EPERM on ~/.npmrc", "ran 40 tests on linux only", "Playwright needs a browser"],
          },
        },
        {
          lane: "lane-c",
          report: {
            open_questions: ["Is 2 retries enough?"],
            not_verified: ["Docker cannot run inside the fence", "Network access is not permitted", "Integration tests: no database"],
          },
        },
      ],
    }),
  );

  it("groups fence notes by kind and repeated notes across lanes, in first-seen order", () => {
    expect(report.risks).toEqual([
      { id: "open_questions:lane-a:1", text: "lane-a (open question): Should the cache be shared?" },
      {
        id: "fence:sandbox",
        text:
          "Not run inside the fence (3 notes): lane-a: pnpm build: the sandbox blocks writes to plugin/; " +
          "lane-b: pnpm install hit EPERM on ~/.npmrc; lane-c: Docker cannot run inside the fence",
      },
      { id: "notes:not_verified:lane-a:2", text: "2 lanes: Ran 12 tests on Linux only" },
      {
        id: "fence:database",
        text: "Not run inside the fence (2 notes): lane-a: Postgres: no database here; lane-c: Integration tests: no database",
      },
      { id: "fence:browser", text: "Not run inside the fence (1 note): lane-b: Playwright needs a browser" },
      { id: "open_questions:lane-c:1", text: "lane-c (open question): Is 2 retries enough?" },
      { id: "fence:network", text: "Not run inside the fence (1 note): lane-c: Network access is not permitted" },
    ]);
  });

  it("renders the risks in the same order", () => {
    const risks = renderReadiness(report).split("## Risks\n\n")[1]?.split("\n\nReady to land")[0];
    expect(risks).toBe(report.risks.map((item) => `- ${item.text}`).join("\n"));
  });
});

describe("roundsLine", () => {
  it("each round's standing findings by severity, in round order", () => {
    const f = (severity: ReviewFinding["severity"], verdict: ReviewFinding["verdict"] = "confirmed") => finding({ severity, verdict });
    const rounds = [
      { round: 3, findings: [f("HIGH", "refuted")] },
      { round: 1, findings: [f("LOW"), f("MEDIUM"), f("LOW", "unverified"), f("MEDIUM", "unverified"), f("LOW"), f("LOW")] },
      { round: 2, findings: [f("LOW")] },
    ];
    expect(roundsLine(rounds)).toBe("review rounds: 1: 2 MEDIUM, 4 LOW · 2: 1 LOW · 3: none");
    expect(roundsLine([])).toBeNull();
  });

  it("is a verified line when there is a history, even with a stale review", () => {
    const report = computeReadiness(input({ review: review({ headSha: OLD }), reviewRounds: [{ round: 1, findings: [] }] }));
    expect(report.verified).toEqual([
      { id: "verify:pnpm test", text: "gate: exit 0" },
      { id: "verify:pnpm smoke", text: "smoke: exit 0" },
      { id: "review-rounds", text: "review rounds: 1: none" },
    ]);
    expect(computeReadiness(input()).verified.map((item) => item.id)).not.toContain("review-rounds");
  });
});

describe("renderReadiness", () => {
  it("renders a fixed report exactly", () => {
    const merged = [{ lane: "lane-a", branch: "arbab/lane-a", sha: "d".repeat(40), manifests: ["package.json"] }];
    const report = computeReadiness(
      input({
        tier: "high",
        integration: integration({ merged, manifests: ["package.json"], headSha: "1234567" }),
        verify: verify({
          headSha: "1234567",
          results: [{ kind: "gate", argv: ["pnpm", "test"], command: "pnpm test | x", exitCode: 0 }],
        }),
        review: review({ headSha: "1234567", lenses: [lensRow("correctness")], findings: [finding()] }),
        laneReports: [{ lane: "lane-a", report: { open_questions: ["two\nlines"], not_verified: [] } }],
        waivers: ["deps", "nope"],
      }),
    );
    expect(renderReadiness(report)).toBe(
      [
        "# Readiness report — m3",
        "",
        "Tier: high · Head: `1234567` · Date: 2026-10-09",
        "",
        "## Verified",
        "",
        "| Check | Result |",
        "| --- | --- |",
        "| `verify:pnpm test \\| x` | gate: exit 0 |",
        "| `review:correctness` | lens ran, 4 paths checked |",
        "| `findings` | 1 confirmed, 0 refuted, 0 unverified |",
        "",
        "## Skipped (each needs a waiver)",
        "",
        "- `deps` (waived): dependency manifests changed (package.json by lane-a) and their install is not confirmed",
        "- `review:security`: the security lens did not succeed on the head",
        "- `review:contracts`: the contracts lens did not succeed on the head",
        "- `smoke`: smoke did not pass in a verify of the head",
        "",
        "## Risks",
        "",
        "- correctness-1: Off by one (src/x.ts:3) — HIGH, confirmed",
        "- package.json changed by lane-a",
        "- waiver nope matches no skipped item",
        "- lane-a (open question): two lines",
        "",
        "Ready to land: no",
        "",
      ].join("\n"),
    );
  });

  it("renders empty sections and a ready report", () => {
    const report = computeReadiness(input({ tier: "low", verify: verify({ results: [] }), review: null, laneReports: [{ lane: "lane-a", report: GOOD_REPORT }] }));
    const text = renderReadiness({ ...report, createdAt: "not-a-date" });
    expect(text).toContain("Date: not-a-date");
    expect(text).toContain("## Verified\n\nNone.\n");
    expect(text).toContain("## Skipped (each needs a waiver)\n\nNone.\n");
    expect(text).toContain("## Risks\n\nNone.\n");
    expect(text.endsWith("Ready to land: yes\n")).toBe(true);
  });

  it("fences ids holding backticks", () => {
    const text = renderReadiness({
      ...computeReadiness(input({ tier: "low" })),
      verified: [{ id: "a `b` c", text: "ok" }],
    });
    expect(text).toContain("| ``a `b` c`` | ok |");
  });
});
