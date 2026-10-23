// The FR-21 readiness report (DESIGN §17 `arbab readiness`): verified, skipped and risks, and the landing decision.
import { sessionId, sessionText } from "../registry";
import { BUILTIN_LENSES } from "../review";
import { landingText, type LandingSince } from "../summary";
import type {
  HostCheckRecord,
  IntegrationRecord,
  ReadinessItem,
  ReadinessReport,
  ReviewFinding,
  ReviewRecord,
  SessionActivity,
  Tier,
  VerifyRecord,
} from "../types";
import { commandLine } from "../verify";
import { groupLaneNotes, uniqueTexts, type LaneEntry } from "./notes";

export { reviewCarriesOver } from "./carry";
export { baseMoved } from "./moved";
export { fenceKind, groupLaneNotes, noteKey, uniqueTexts, type LaneEntry, type LaneNote } from "./notes";

/** One round of an integration's review history (reviews/<round>.json). */
export interface ReviewRound {
  round: number;
  findings: ReviewFinding[];
}

export interface ReadinessInput {
  name: string;
  tier: Tier;
  integration: IntegrationRecord;
  verify: VerifyRecord | null;
  review: ReviewRecord | null;
  /**
   * The latest report of each merged lane and of each lane that worked in a merged lane's worktree (`worktree` names
   * that lane): a borrower commits onto the owner's branch, so it never has a merged entry of its own.
   */
  laneReports: Array<{ lane: string; report: unknown; worktree?: string }>;
  /** The full lens list of the config; built-in lenses are always added for the high tier. */
  configLenses: string[];
  smokeConfigured: boolean;
  waivers: string[];
  now: string;
  /**
   * Set when the review's head differs from the integration head only by a clean merge of `base` (reviewCarriesOver):
   * a review made at `from` then counts as current.
   */
  reviewCarryOver?: { from: string; base: string } | null;
  /** config hostGates; none by default. */
  hostGates?: string[][];
  /** host-checks.json, or null before the first `host-check`. */
  hostChecks?: HostCheckRecord | null;
  /** The review history, any order. */
  reviewRounds?: ReviewRound[];
  /** Other sessions the landing affects (otherSessions); risks, never skipped items. */
  otherSessions?: SessionActivity[];
  /** Why the other sessions could not be told (the machine registry could not be listed): a risk `session:unknown`. */
  sessionsUnknown?: string;
  /** Set when the base's head is not in the integration head, so land would refuse: a risk `base-moved`. */
  baseMoved?: BaseMoved | null;
}

/** What the base gained that the integration head does not hold. */
export interface BaseMoved {
  base: string;
  /** The landings into the base whose commit the head does not hold, oldest first. */
  landings: LandingSince[];
  /** How many commits of the base the head does not hold; null when git could not count them. */
  commits: number | null;
}

/** The `base-moved` risk: what moved the base, by landing record or else by count, and the merge that answers it. */
export function baseMovedRisk(name: string, moved: BaseMoved): ReadinessItem {
  const what =
    moved.landings.length > 0
      ? `${moved.landings.map(landingText).join(", ")} landed`
      : moved.commits === null
        ? "it has new commits"
        : `${moved.commits} new ${moved.commits === 1 ? "commit" : "commits"}`;
  return {
    id: "base-moved",
    text: `${moved.base} moved since this integration started: ${what}. Merge ${moved.base} into integrate/${name} before landing.`,
  };
}

type Skipped = ReadinessItem & { waived: boolean };

function exitText(code: number | null): string {
  return code === null ? "missing (counts as a failure)" : `exit ${code}`;
}

function isMediumPlus(finding: ReviewFinding): boolean {
  return finding.severity === "HIGH" || finding.severity === "MEDIUM";
}

/**
 * Why a lens entry does not count as run, or null when it does. A review without coverage counts as failed (SKILL.md),
 * and so does one that checked no path.
 */
function lensShortfall(entry: ReviewRecord["lenses"][number]): string | null {
  if (entry.endState !== "success") return `ended ${entry.endState ?? "without an end state"}`;
  if (entry.coverage === null || entry.coverage.trim() === "") return "no coverage";
  if (!(entry.pathsChecked >= 1)) return "no paths checked";
  return null;
}

function findingText(finding: ReviewFinding): string {
  const where = finding.line === undefined ? finding.file : `${finding.file}:${finding.line}`;
  return `${finding.id}: ${finding.title} (${where}) — ${finding.severity}, ${finding.verdict}`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** The string entries of a report field, or null when the field is not an array of strings. */
function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((entry): entry is string => typeof entry === "string") ? value : null;
}

/**
 * Why a verify of the head did not pass, as a suffix: its reason when it has one (the gates may all have exited 0),
 * else the failing gates. verify.json is read without checking `reason`, so a non-string one counts as absent.
 */
function verifyFailure(verify: VerifyRecord): string {
  const reason: unknown = verify.reason;
  if (typeof reason === "string" && reason.trim() !== "") return `: ${reason.trim()}`;
  const failing = verify.results.filter((result) => result.exitCode !== 0);
  if (failing.length === 0) return "";
  return `: failing ${failing.map((result) => `${result.command} (${exitText(result.exitCode)})`).join(", ")}`;
}

function laneEntries(lane: string, report: unknown): LaneEntry[] {
  if (typeof report !== "object" || report === null || Array.isArray(report)) {
    return [{ risk: { id: `report:${lane}`, text: `${lane}: the report is missing or not an object` } }];
  }
  const fields = report as Record<string, unknown>;
  const out: LaneEntry[] = [];
  for (const [field, label] of [
    ["open_questions", "open question"],
    ["not_verified", "not verified"],
  ] as const) {
    const entries = stringList(fields[field]);
    if (entries === null) {
      out.push({ risk: { id: `report:${lane}:${field}`, text: `${lane}: the report's ${field} is not a list of strings` } });
      continue;
    }
    entries.forEach((text, index) => {
      out.push({ note: { id: `${field}:${lane}:${index + 1}`, lane, label, text } });
    });
  }
  return out;
}

const SEVERITY_ORDER: ReadonlyArray<ReviewFinding["severity"]> = ["HIGH", "MEDIUM", "LOW"];

/**
 * `review rounds: 1: 2 MEDIUM, 4 LOW · 2: 1 LOW · 3: none`: the findings each round left standing (refuted ones are
 * not counted), so a reader sees whether the fix rounds converged. Null without a history.
 */
export function roundsLine(rounds: readonly ReviewRound[]): string | null {
  if (rounds.length === 0) return null;
  const parts = [...rounds]
    .sort((a, b) => a.round - b.round)
    .map(({ round, findings }) => {
      const standing = findings.filter((finding) => finding.verdict !== "refuted");
      const counts = SEVERITY_ORDER.map((severity) => [severity, standing.filter((f) => f.severity === severity).length] as const)
        .filter(([, n]) => n > 0)
        .map(([severity, n]) => `${n} ${severity}`);
      return `${round}: ${counts.length === 0 ? "none" : counts.join(", ")}`;
    });
  return `review rounds: ${parts.join(" · ")}`;
}

/** Why the host gates do not count on the head, or null when every configured gate passed there. */
function hostShortfall(gates: readonly string[][], checks: HostCheckRecord | null, head: string, name: string): string | null {
  const run = `run arbab host-check ${name} in a terminal`;
  if (checks === null) return `the host gates have not run; ${run}`;
  if (checks.headSha !== head) return `the host gates ran on ${checks.headSha}, not on the head ${head}; ${run}`;
  const failing = gates
    .map((argv) => {
      const command = commandLine(argv);
      const result = checks.results.find((r) => r.command === command);
      return result === undefined ? `${command} (not run)` : result.exitCode === 0 ? null : `${command} (${exitText(result.exitCode)})`;
    })
    .filter((text): text is string => text !== null);
  if (failing.length > 0) return `the host gates did not pass on the head: ${failing.join(", ")}`;
  if (!checks.passed) return "the host gates did not pass on the head";
  return null;
}

export function computeReadiness(input: ReadinessInput): ReadinessReport {
  const { integration, verify, review, tier } = input;
  const head = integration.headSha;
  // Verify is never carried over: the gates must pass on the head itself.
  const currentVerify = verify !== null && verify.headSha === head ? verify : null;
  const carry = input.reviewCarryOver ?? null;
  const carriedFrom =
    review !== null && review.headSha !== head && carry !== null && carry.from === review.headSha ? review.headSha : null;
  const currentReview = review !== null && (review.headSha === head || carriedFrom !== null) ? review : null;
  const hostGates = input.hostGates ?? [];
  const hostChecks = input.hostChecks ?? null;
  const verified: ReadinessItem[] = [];
  const skipped: Array<Omit<Skipped, "waived">> = [];

  if (currentVerify !== null) {
    for (const result of currentVerify.results) {
      verified.push({ id: `verify:${result.command}`, text: `${result.kind}: ${exitText(result.exitCode)}` });
    }
  }
  const hostMissing = hostGates.length === 0 ? null : hostShortfall(hostGates, hostChecks, head, input.name);
  if (hostGates.length > 0 && hostMissing === null) {
    for (const argv of hostGates) verified.push({ id: `host:${commandLine(argv)}`, text: "host gate: exit 0" });
  }
  if (carriedFrom !== null && carry !== null) {
    verified.push({
      id: "review-carried-over",
      text: `review carried over from ${carriedFrom.slice(0, 7)}: the head adds only a clean merge of ${carry.base}`,
    });
  }
  const succeeded = new Set<string>();
  // Lenses of the current review that ran but do not count, with why (the first entry's reason).
  const shortfalls = new Map<string, string>();
  if (currentReview !== null) {
    for (const entry of currentReview.lenses) {
      const shortfall = lensShortfall(entry);
      if (shortfall !== null) {
        if (!shortfalls.has(entry.lens)) shortfalls.set(entry.lens, shortfall);
        continue;
      }
      if (succeeded.has(entry.lens)) continue;
      succeeded.add(entry.lens);
      verified.push({ id: `review:${entry.lens}`, text: `lens ran, ${entry.pathsChecked} paths checked` });
    }
    for (const lens of succeeded) shortfalls.delete(lens);
    const count = (verdict: ReviewFinding["verdict"]): number =>
      currentReview.findings.filter((finding) => finding.verdict === verdict).length;
    verified.push({
      id: "findings",
      text: `${count("confirmed")} confirmed, ${count("refuted")} refuted, ${count("unverified")} unverified`,
    });
  }
  const rounds = roundsLine(input.reviewRounds ?? []);
  if (rounds !== null) verified.push({ id: "review-rounds", text: rounds });

  // Skipped: every check the tier requires that did not run or did not pass, so none is ever silently absent.
  if (currentVerify === null) {
    skipped.push({
      id: "verify",
      text: verify === null ? "verify has not run" : `verify ran on ${verify.headSha}, not on the head ${head}`,
    });
  } else if (!currentVerify.passed) {
    skipped.push({ id: "verify", text: `verify did not pass on the head${verifyFailure(currentVerify)}` });
  }
  // The manifests that differ between the base and the head, whoever changed them, each with the merged lanes that did.
  const manifests = unique(integration.manifests).map((manifest) => {
    const lanes = integration.merged.filter((lane) => lane.manifests.includes(manifest)).map((lane) => lane.lane);
    return { manifest, by: lanes.length > 0 ? unique(lanes).join(", ") : "a commit arbab did not merge" };
  });
  if (manifests.length > 0 && !integration.depsConfirmed) {
    skipped.push({
      id: "deps",
      text: `dependency manifests changed (${manifests.map((m) => `${m.manifest} by ${m.by}`).join("; ")}) and their install is not confirmed`,
    });
  }
  // Lenses a skipped item already names with their reason; the others that fell short become risks.
  const named = new Set<string>();
  if (tier === "medium" && succeeded.size === 0) {
    const reasons = [...shortfalls].map(([lens, why]) => `${lens}: ${why}`);
    for (const lens of shortfalls.keys()) named.add(lens);
    skipped.push({
      id: "review",
      text:
        currentReview === null
          ? "no review of the head"
          : `no review lens succeeded on the head${reasons.length > 0 ? ` (${reasons.join("; ")})` : ""}`,
    });
  }
  if (tier === "high") {
    for (const lens of unique([...Object.keys(BUILTIN_LENSES), ...input.configLenses])) {
      if (succeeded.has(lens)) continue;
      named.add(lens);
      const why = shortfalls.get(lens);
      skipped.push({
        id: `review:${lens}`,
        text: why === undefined ? `the ${lens} lens did not succeed on the head` : `the ${lens} lens does not count on the head: ${why}`,
      });
    }
    const unrefuted = (currentReview?.findings ?? []).filter(
      (finding) => isMediumPlus(finding) && finding.verdict === "unverified",
    );
    if (unrefuted.length > 0) {
      const lenses = unique(unrefuted.map((finding) => finding.lens));
      skipped.push({
        id: "skeptic",
        text: `${unrefuted.length} MEDIUM+ findings still unverified (${lenses.join(", ")})`,
      });
    }
    if (!input.smokeConfigured) {
      skipped.push({ id: "smoke", text: "smoke is not configured" });
    } else {
      const smoke = currentVerify?.results.filter((result) => result.kind === "smoke") ?? [];
      if (smoke.length === 0 || smoke.some((result) => result.exitCode !== 0)) {
        skipped.push({ id: "smoke", text: "smoke did not pass in a verify of the head" });
      }
    }
  }
  // At every tier: a check the project says matters, which nothing inside the fence could run.
  if (hostMissing !== null) skipped.push({ id: "host", text: hostMissing });

  // Risks by weight: confirmed findings, unverified findings, dependency manifests, host gates, stale or waived items,
  // then lane notes.
  // Findings of a stale review stay risks: the stale-review risk says they may be outdated. A confirmed finding is one
  // whatever its severity: a skeptic may confirm it and lower it to LOW.
  const findings = review?.findings ?? [];
  const confirmed = findings
    .filter((finding) => finding.verdict === "confirmed")
    .map((finding) => ({ id: `finding:${finding.id}`, text: findingText(finding) }));
  const unverified = findings
    .filter((finding) => isMediumPlus(finding) && finding.verdict === "unverified")
    .map((finding) => ({ id: `finding:${finding.id}`, text: findingText(finding) }));
  // No skeptic looks at LOW findings, so nothing checked them: one line, so they are neither lost nor drown the rest.
  const lowUnverified = findings.filter((finding) => finding.severity === "LOW" && finding.verdict === "unverified");
  if (lowUnverified.length > 0) {
    unverified.push({
      id: "findings:low-unverified",
      text: `${lowUnverified.length} LOW findings unverified: ${lowUnverified.map((finding) => `${finding.id} (${finding.title})`).join(", ")}`,
    });
  }
  const reports = new Map<string, unknown>();
  const borrowers = new Map<string, Array<{ lane: string; report: unknown }>>();
  for (const entry of input.laneReports) {
    if (entry.worktree === undefined) {
      if (!reports.has(entry.lane)) reports.set(entry.lane, entry.report);
    } else {
      borrowers.set(entry.worktree, [...(borrowers.get(entry.worktree) ?? []), entry]);
    }
  }
  const mergedLanes = unique(integration.merged.map((lane) => lane.lane));
  const reported = new Set(mergedLanes);
  const notes: LaneEntry[] = [];
  for (const lane of mergedLanes) {
    notes.push(...laneEntries(lane, reports.get(lane)));
    // After the owner's, under each borrower's own name; a lane is reported once even if it is merged too.
    for (const borrower of borrowers.get(lane) ?? []) {
      if (reported.has(borrower.lane)) continue;
      reported.add(borrower.lane);
      notes.push(...laneEntries(borrower.lane, borrower.report));
    }
  }
  const manifestRisks = manifests.map(({ manifest, by }) => ({ id: `manifest:${manifest}`, text: `${manifest} changed by ${by}` }));
  const hostRisks = hostMissing === null ? [] : [{ id: "host-gates", text: hostMissing }];
  const stale: ReadinessItem[] = [];
  for (const [lens, why] of shortfalls) {
    if (!named.has(lens)) stale.push({ id: `lens:${lens}`, text: `the ${lens} lens does not count: ${why}` });
  }
  if (verify !== null && currentVerify === null) {
    stale.push({ id: "stale:verify", text: `verify (${verify.lane}) is stale: it ran on ${verify.headSha}, the head is ${head}` });
  }
  if (review !== null && currentReview === null) {
    stale.push({ id: "stale:review", text: `review is stale: it ran on ${review.headSha}, the head is ${head}` });
  }

  const waivers = unique(input.waivers.map((waiver) => waiver.trim()).filter((waiver) => waiver !== ""));
  const skippedIds = new Set(skipped.map((item) => item.id));
  for (const waiver of waivers) {
    if (!skippedIds.has(waiver)) stale.push({ id: `waiver:${waiver}`, text: `waiver ${waiver} matches no skipped item` });
  }
  const waived = new Set(waivers);
  const skippedOut = skipped.map((item) => ({ ...item, waived: waived.has(item.id) }));
  // First: they ask for an action before landing, and no waiver answers them.
  const sessionRisks = (input.otherSessions ?? []).map((activity) => ({ id: sessionId(activity), text: sessionText(activity, "readiness") }));
  if (input.sessionsUnknown !== undefined) {
    sessionRisks.unshift({ id: "session:unknown", text: `cannot tell which other sessions are working here: ${input.sessionsUnknown}` });
  }
  // Before the sessions: land refuses until it is answered.
  if (input.baseMoved !== undefined && input.baseMoved !== null) sessionRisks.unshift(baseMovedRisk(input.name, input.baseMoved));
  const risks = uniqueTexts([
    ...sessionRisks,
    ...confirmed,
    ...unverified,
    ...manifestRisks,
    ...hostRisks,
    ...stale,
    ...groupLaneNotes(notes),
  ]);

  return {
    name: input.name,
    tier,
    headSha: head,
    verified,
    skipped: skippedOut,
    risks,
    ready: currentVerify !== null && currentVerify.passed && skippedOut.every((item) => item.waived),
    createdAt: input.now,
    ...(carriedFrom !== null && { reviewCarriedOverFrom: carriedFrom }),
    ...(input.otherSessions !== undefined && { otherSessions: input.otherSessions }),
  };
}

/** One line of untrusted text: Markdown that cannot open a block of its own. */
function inline(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ");
}

/** A code span whose fence is longer than any backtick run inside it. */
function code(text: string): string {
  const flat = inline(text);
  let longest = 0;
  for (const run of flat.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
  const fence = "`".repeat(longest + 1);
  const pad = flat.startsWith("`") || flat.endsWith("`") ? " " : "";
  return `${fence}${pad}${flat}${pad}${fence}`;
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

function list(lines: string[]): string[] {
  return lines.length === 0 ? ["None."] : lines;
}

export function renderReadiness(report: ReadinessReport): string {
  const date = /^\d{4}-\d{2}-\d{2}/.exec(report.createdAt)?.[0] ?? report.createdAt;
  const lines = [
    `# Readiness report — ${inline(report.name)}`,
    "",
    `Tier: ${report.tier} · Head: ${code(report.headSha)} · Date: ${inline(date)}`,
    "",
    "## Verified",
    "",
  ];
  if (report.verified.length === 0) {
    lines.push("None.");
  } else {
    lines.push("| Check | Result |", "| --- | --- |");
    for (const item of report.verified) lines.push(`| ${cell(code(item.id))} | ${cell(inline(item.text))} |`);
  }
  lines.push("", "## Skipped (each needs a waiver)", "");
  lines.push(
    ...list(report.skipped.map((item) => `- ${code(item.id)}${item.waived ? " (waived)" : ""}: ${inline(item.text)}`)),
  );
  lines.push("", "## Risks", "");
  lines.push(...list(report.risks.map((item) => `- ${inline(item.text)}`)));
  lines.push("", `Ready to land: ${report.ready ? "yes" : "no"}`, "");
  return lines.join("\n");
}
