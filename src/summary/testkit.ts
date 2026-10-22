// Fixtures for src/summary and the summary and report commands: integration records, plan lane files and slot
// entries as the runner leaves them. Not part of the bundle; only *.test.ts files import it.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IntegrationRecord, ReadinessReport, ReviewRecord, VerifyRecord } from "../types";

export const SHA_BASE = "a".repeat(40);
export const SHA_HEAD = "b".repeat(40);
export const SHA_OLD = "c".repeat(40);

export const integrationDir = (root: string, name: string): string => join(root, ".arbab", "integrations", name);

function writeRecord(root: string, name: string, file: string, value: unknown): void {
  const dir = integrationDir(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), JSON.stringify(value));
}

export function writeIntegration(root: string, name: string, over: Partial<IntegrationRecord> = {}): IntegrationRecord {
  const record: IntegrationRecord = {
    name,
    branch: `integrate/${name}`,
    worktree: "/nonexistent/worktree",
    base: "main",
    baseSha: SHA_BASE,
    merged: [],
    manifests: [],
    depsConfirmedAt: null,
    depsConfirmed: true,
    headSha: SHA_HEAD,
    updatedAt: "2026-10-09T11:00:00.000Z",
    ...over,
  };
  writeRecord(root, name, "integration.json", record);
  return record;
}

export function writeVerify(root: string, name: string, over: Partial<VerifyRecord> = {}): void {
  writeRecord(root, name, "verify.json", {
    name,
    lane: `${name}-verify`,
    attempt: 1,
    headSha: SHA_HEAD,
    results: [{ kind: "gate", argv: ["pnpm", "test"], command: "pnpm test", exitCode: 0 }],
    passed: true,
    finishedAt: "2026-10-09T11:10:00.000Z",
    ...over,
  } satisfies VerifyRecord);
}

export function writeReview(root: string, name: string, over: Partial<ReviewRecord> = {}): void {
  writeRecord(root, name, "review.json", {
    name,
    headSha: SHA_HEAD,
    lenses: [{ lens: "correctness", lane: `${name}-review-correctness`, endState: "success", coverage: "all", pathsChecked: 3 }],
    skeptics: [],
    findings: [],
    finishedAt: "2026-10-09T11:20:00.000Z",
    ...over,
  } satisfies ReviewRecord);
}

export function writeReadiness(root: string, name: string, over: Partial<ReadinessReport> = {}): void {
  writeRecord(root, name, "readiness.json", {
    name,
    tier: "medium",
    headSha: SHA_HEAD,
    verified: [],
    skipped: [],
    risks: [],
    ready: true,
    createdAt: "2026-10-09T11:30:00.000Z",
    ...over,
  } satisfies ReadinessReport);
}

export function writeLanding(root: string, name: string): void {
  writeRecord(root, name, "landing.json", {
    name,
    into: "main",
    integrationHead: SHA_HEAD,
    mergeSha: SHA_OLD,
    landedAt: "2026-10-09T11:40:00.000Z",
    pushed: false,
  });
}

/** The lane file `plan next` writes for a launched phase. */
export function writePlanPhase(root: string, plan: string, phase: string): void {
  const dir = join(root, ".arbab", "plans", plan);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${phase}.json`), JSON.stringify({ name: phase, role: "implementer", brief: "lanes/demo.md" }));
}

export function writeSlot(home: string, slot: number, holder: unknown): void {
  mkdirSync(join(home, "slots"), { recursive: true });
  writeFileSync(join(home, "slots", `${slot}.json`), typeof holder === "string" ? holder : JSON.stringify(holder));
}

/** Overwrites the run's shepherd.json with an owner. */
export function writeOwner(runsRoot: string, lane: string, owner: string | null): void {
  writeFileSync(join(runsRoot, lane, "shepherd.json"), JSON.stringify({ pid: 4242, startedAt: "2026-10-09T11:00:00.000Z", owner }));
}

export function writeQuota(home: string, fiveHour: number, sevenDay: number, resetsAt: number): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, "quota.json"),
    JSON.stringify({
      observedAt: "2026-10-09T11:55:00.000Z",
      status: "allowed",
      type: null,
      fiveHour: { utilization: fiveHour, resetsAt },
      sevenDay: { utilization: sevenDay, resetsAt: resetsAt + 86_400 },
    }),
  );
}
