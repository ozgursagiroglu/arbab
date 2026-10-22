// Readers for an integration's records (DESIGN.md §17). They are arbab's own files, but they sit on disk between
// commands and a person may edit them, so each is checked before a command trusts it.
import { basename } from "node:path";
import { reviewRoundPath, reviewRounds } from "../review";
import { TIERS } from "../types";
import type { ReadinessReport, ReviewRecord, VerifyRecord } from "../types";
import { ArbabError } from "../util/errors";
import { readJson } from "../util/fs";

type Fields = Record<string, unknown>;

const isObject = (v: unknown): v is Fields => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";
const isStringOrNull = (v: unknown): boolean => v === null || typeof v === "string";
const isNumberOrNull = (v: unknown): boolean => v === null || Number.isFinite(v);
const listOf = (v: unknown, item: (x: unknown) => boolean): boolean => Array.isArray(v) && v.every(item);

function read<T>(path: string, name: string, what: string, valid: (v: Fields) => boolean): T | null {
  const raw = readJson<unknown>(path);
  if (raw === null) return null;
  if (!isObject(raw) || raw["name"] !== name || !valid(raw)) {
    throw new ArbabError("io", `${path} is not a ${what} for ${name}`);
  }
  return raw as unknown as T;
}

const isGateResult = (v: unknown): boolean =>
  isObject(v) &&
  (v["kind"] === "gate" || v["kind"] === "smoke") &&
  listOf(v["argv"], isString) &&
  isString(v["command"]) &&
  isNumberOrNull(v["exitCode"]);

/** verify.json, or null before the first `verify`. */
export function readVerifyRecord(path: string, name: string): VerifyRecord | null {
  return read<VerifyRecord>(path, name, "verify record", (v) =>
    isString(v["lane"]) &&
    isNumberOrNull(v["attempt"]) &&
    isString(v["headSha"]) &&
    listOf(v["results"], isGateResult) &&
    typeof v["passed"] === "boolean" &&
    (v["reason"] === undefined || isString(v["reason"])) &&
    isString(v["finishedAt"]),
  );
}

const SEVERITIES = ["HIGH", "MEDIUM", "LOW"];
const VERDICTS = ["confirmed", "refuted", "unverified"];

const isFinding = (v: unknown): boolean =>
  isObject(v) &&
  isString(v["id"]) &&
  isString(v["lens"]) &&
  isString(v["title"]) &&
  SEVERITIES.includes(v["severity"] as string) &&
  isString(v["file"]) &&
  (v["line"] === undefined || Number.isInteger(v["line"])) &&
  isString(v["failureScenario"]) &&
  isString(v["evidence"]) &&
  VERDICTS.includes(v["verdict"] as string);

const isLensEntry = (v: unknown): boolean =>
  isObject(v) &&
  isString(v["lens"]) &&
  isString(v["lane"]) &&
  isStringOrNull(v["endState"]) &&
  isStringOrNull(v["coverage"]) &&
  Number.isInteger(v["pathsChecked"]);

const isSkepticEntry = (v: unknown): boolean =>
  isObject(v) && isString(v["lens"]) && isString(v["lane"]) && isStringOrNull(v["endState"]);

/** review.json, or null before the first `review`. Records written before §21 have no `round` and no `since`. */
export function readReviewRecord(path: string, name: string): ReviewRecord | null {
  return read<ReviewRecord>(path, name, "review record", (v) =>
    isString(v["headSha"]) &&
    listOf(v["lenses"], isLensEntry) &&
    listOf(v["skeptics"], isSkepticEntry) &&
    listOf(v["findings"], isFinding) &&
    isString(v["finishedAt"]) &&
    (v["round"] === undefined || (Number.isInteger(v["round"]) && (v["round"] as number) >= 1)) &&
    (v["since"] === undefined || isStringOrNull(v["since"])),
  );
}

/**
 * Every round in <integrationDir>/reviews/, by round; empty before the first review that kept one. The integration's
 * name is the directory's. A round whose file does not hold a review record of that round is refused.
 */
export function readReviewHistory(integrationDir: string): ReviewRecord[] {
  const name = basename(integrationDir);
  return reviewRounds(integrationDir).flatMap((round) => {
    const path = reviewRoundPath(integrationDir, round);
    const record = readReviewRecord(path, name);
    if (record === null) return [];
    if (record.round !== round) throw new ArbabError("io", `${path} is not the review record of round ${round}`);
    return [record];
  });
}

const isItem = (v: unknown): boolean => isObject(v) && isString(v["id"]) && isString(v["text"]);

/** readiness.json, or null before the first `readiness`. */
export function readReadinessReport(path: string, name: string): ReadinessReport | null {
  return read<ReadinessReport>(path, name, "readiness report", (v) =>
    (TIERS as readonly unknown[]).includes(v["tier"]) &&
    isString(v["headSha"]) &&
    listOf(v["verified"], isItem) &&
    listOf(v["skipped"], (s) => isItem(s) && typeof (s as Fields)["waived"] === "boolean") &&
    listOf(v["risks"], isItem) &&
    typeof v["ready"] === "boolean" &&
    isString(v["createdAt"]),
  );
}
