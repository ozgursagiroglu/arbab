// Review rounds (DESIGN.md §21): every review writes reviews/<round>.json beside review.json, and a `--lenses` subset
// run keeps the other lenses of the previous review of the same head.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { REVIEW_HISTORY_DIR, type ReviewRecord } from "../types";
import { ArbabError } from "../util/errors";
import { createExclusive } from "../util/fs";

const ROUND_FILE = /^([1-9][0-9]{0,8})\.json$/;

/** <integrationDir>/reviews/<round>.json */
export function reviewRoundPath(integrationDir: string, round: number): string {
  if (!Number.isInteger(round) || round < 1) throw new ArbabError("usage", `review round ${round} is not a positive integer`);
  return join(integrationDir, REVIEW_HISTORY_DIR, `${round}.json`);
}

/** The rounds on disk, ascending; files not named `<round>.json` are not rounds. */
export function reviewRounds(integrationDir: string): number[] {
  let names: string[];
  try {
    names = readdirSync(join(integrationDir, REVIEW_HISTORY_DIR));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new ArbabError("io", `cannot list ${join(integrationDir, REVIEW_HISTORY_DIR)}: ${(err as Error).message}`, { cause: err });
  }
  return names
    .flatMap((n) => {
      const round = ROUND_FILE.exec(n)?.[1];
      return round === undefined ? [] : [Number(round)];
    })
    .sort((a, b) => a - b);
}

/**
 * Writes the record as the next round, 1 + the highest on disk, and returns it with its round. The file is created
 * exclusively, so two reviews that finish together take two rounds instead of one overwriting the other.
 */
export function writeReviewRound(integrationDir: string, record: ReviewRecord): ReviewRecord {
  for (let round = (reviewRounds(integrationDir).at(-1) ?? 0) + 1; ; round++) {
    const numbered: ReviewRecord = { ...record, round };
    if (createExclusive(reviewRoundPath(integrationDir, round), JSON.stringify(numbered, null, 2) + "\n")) return numbered;
  }
}

/**
 * The record of a subset run with the previous record's other lenses kept: their reviewer entries, skeptics and
 * findings, verdicts included. Only a previous record of the same head counts; the lenses run now replace theirs.
 * Lens entries keep the previous order, lenses new to the record go last; skeptics and findings follow the lenses.
 */
export function keepOtherLenses(previous: ReviewRecord | null, current: ReviewRecord, ran: readonly string[]): ReviewRecord {
  if (previous === null || previous.headSha !== current.headSha) return current;
  const rerun = new Set(ran);
  const fresh = new Map(current.lenses.map((l) => [l.lens, l]));
  const lenses: ReviewRecord["lenses"] = [];
  for (const entry of previous.lenses) {
    if (!rerun.has(entry.lens)) lenses.push({ ...entry });
    else {
      const now = fresh.get(entry.lens);
      if (now !== undefined && !lenses.includes(now)) lenses.push(now);
    }
  }
  for (const entry of current.lenses) if (!lenses.includes(entry)) lenses.push(entry);

  const order = new Map(lenses.map((l, i) => [l.lens, i]));
  const byLens = <T extends { lens: string }>(items: T[]): T[] =>
    items
      .map((item, i) => ({ item, i }))
      .sort((a, b) => (order.get(a.item.lens) ?? order.size) - (order.get(b.item.lens) ?? order.size) || a.i - b.i)
      .map((x) => x.item);
  const kept = <T extends { lens: string }>(items: T[]): T[] => items.filter((x) => !rerun.has(x.lens)).map((x) => ({ ...x }));
  return {
    ...current,
    lenses,
    skeptics: byLens([...kept(previous.skeptics), ...current.skeptics]),
    findings: byLens([...kept(previous.findings), ...current.findings]),
  };
}
