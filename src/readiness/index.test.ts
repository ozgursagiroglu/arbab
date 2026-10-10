import { describe, expect, it } from "vitest";
import type { IntegrationRecord, ReviewFinding, ReviewRecord, Tier, VerifyRecord } from "../types";
import { computeReadiness, renderReadiness } from "./index";
import type { ReadinessInput } from "./index";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const NOW = "2026-10-09T12:00:00.000Z";

function integration(over: Partial<IntegrationRecord> = {}): IntegrationRecord {
  return {
    name: "m3",
    branch: "integrate/m3",
    worktree: "/repo/.arbab/worktrees/integrate-m3",
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
  it("every confirmed finding and each unverified MEDIUM+ one, not refuted ones", () => {
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
      { id: "finding:security-1", text: "security-1: Off by one (src/x.ts) — MEDIUM, unverified" },
      { id: "finding:correctness-3", text: "correctness-3: Off by one (src/x.ts:3) — LOW, confirmed" },
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
        "- lane-a (open question): two lines",
        "- package.json changed by lane-a",
        "- waiver nope matches no skipped item",
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
