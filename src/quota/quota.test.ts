import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RateLimitSnapshot } from "../types";
import { ArbabError } from "../util/errors";
import {
  formatQuota,
  holdDecision,
  lastQuotaReset,
  quotaPath,
  readQuota,
  replaceQuota,
  resetQuota,
  resumeAt,
  updateQuota,
} from "./index";

// The real snapshot from 2026-10-09: 12:30Z today and Oct 15 08:00Z.
const FIVE_RESET = 1791549000;
const SEVEN_RESET = 1792051200;
const NOW = FIVE_RESET - 2 * 3600; // 10:30Z
const HOLD = { fiveHour: 0.85, sevenDay: 0.95 };

function snap(over: Partial<RateLimitSnapshot> = {}): RateLimitSnapshot {
  return {
    observedAt: "2026-10-09T10:00:00.000Z",
    status: "allowed_warning",
    type: "seven_day",
    fiveHour: { utilization: 0.6, resetsAt: FIVE_RESET },
    sevenDay: { utilization: 0.6, resetsAt: SEVEN_RESET },
    ...over,
  };
}

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "arbab-quota-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("readQuota / updateQuota", () => {
  it("reads null when nothing is stored", () => {
    expect(readQuota(home)).toBeNull();
  });

  it("writes the first snapshot and reads it back", () => {
    expect(updateQuota(home, snap())).toBe(true);
    expect(readQuota(home)).toEqual(snap());
  });

  it("replaces only with a newer observation", () => {
    updateQuota(home, snap());
    const older = snap({ observedAt: "2026-10-09T09:59:59.000Z", status: "rejected" });
    expect(updateQuota(home, older)).toBe(false);
    expect(readQuota(home)?.status).toBe("allowed_warning");

    const same = snap({ status: "rejected" });
    expect(updateQuota(home, same)).toBe(false);

    const newer = snap({ observedAt: "2026-10-09T10:00:01.000Z", status: "rejected" });
    expect(updateQuota(home, newer)).toBe(true);
    expect(readQuota(home)?.status).toBe("rejected");
  });

  it("treats a corrupt or malformed file as unknown and overwrites it", () => {
    writeFileSync(join(home, "quota.json"), "{");
    expect(readQuota(home)).toBeNull();
    writeFileSync(join(home, "quota.json"), JSON.stringify({ observedAt: "never" }));
    expect(readQuota(home)).toBeNull();
    expect(updateQuota(home, snap())).toBe(true);
    expect(JSON.parse(readFileSync(join(home, "quota.json"), "utf8"))).toEqual(snap());
  });

  it("refuses an invalid snapshot", () => {
    expect(() => updateQuota(home, snap({ observedAt: "yesterday" }))).toThrow(ArbabError);
    expect(() => updateQuota(home, { ...snap(), fiveHour: { utilization: Number.NaN, resetsAt: 1 } })).toThrow(
      ArbabError,
    );
  });
});

describe("replaceQuota", () => {
  const at = { now: () => Date.parse("2026-10-09T10:30:00.000Z") };

  it("stores an older observation over a newer one and records the switch", () => {
    updateQuota(home, snap({ observedAt: "2026-10-09T11:00:00.000Z", status: "rejected" }));
    replaceQuota(home, snap(), at);
    expect(readQuota(home)).toEqual(snap());
    expect(lastQuotaReset(home)).toBe(at.now());
  });

  it("refuses an invalid snapshot and writes nothing", () => {
    expect(() => replaceQuota(home, snap({ observedAt: "yesterday" }), at)).toThrow(ArbabError);
    expect(existsSync(quotaPath(home))).toBe(false);
    expect(lastQuotaReset(home)).toBeNull();
  });
});

describe("resetQuota / lastQuotaReset", () => {
  const at = (ms: number) => ({ now: () => ms });
  const RESET_MS = Date.parse("2026-10-09T10:30:00.000Z");

  it("names the snapshot's path", () => {
    expect(quotaPath(home)).toBe(join(home, "quota.json"));
  });

  it("reads null before any reset", () => {
    expect(lastQuotaReset(home)).toBeNull();
  });

  it("removes the snapshot, records the reset and reports whether a snapshot was there", () => {
    updateQuota(home, snap());
    expect(resetQuota(home, at(RESET_MS))).toBe(true);
    expect(existsSync(quotaPath(home))).toBe(false);
    expect(readQuota(home)).toBeNull();
    expect(lastQuotaReset(home)).toBe(RESET_MS);
    expect(JSON.parse(readFileSync(join(home, "quota-reset.json"), "utf8"))).toEqual({ resetAt: "2026-10-09T10:30:00.000Z" });
  });

  it("records a reset without a snapshot, and the latest one wins", () => {
    expect(resetQuota(home, at(RESET_MS))).toBe(false);
    expect(lastQuotaReset(home)).toBe(RESET_MS);
    expect(resetQuota(home, at(RESET_MS + 1000))).toBe(false);
    expect(lastQuotaReset(home)).toBe(RESET_MS + 1000);
  });

  it("reads null from a corrupt or malformed record", () => {
    const file = join(home, "quota-reset.json");
    for (const text of ["{", "[]", "null", JSON.stringify({ resetAt: 5 }), JSON.stringify({ resetAt: "never" })]) {
      writeFileSync(file, text);
      expect(lastQuotaReset(home)).toBeNull();
    }
  });

  it("fails with an ArbabError when the snapshot cannot be removed", () => {
    mkdirSync(join(quotaPath(home), "child"), { recursive: true });
    expect(() => resetQuota(home, at(RESET_MS))).toThrow(ArbabError);
  });
});

describe("holdDecision", () => {
  it("never holds on a null snapshot", () => {
    expect(holdDecision(null, HOLD, NOW)).toEqual({ hold: false, reason: null, until: null });
  });

  it("does not hold the real snapshot below the thresholds", () => {
    expect(holdDecision(snap(), HOLD, NOW)).toEqual({ hold: false, reason: null, until: null });
  });

  it("holds a five-hour window at or above its threshold until its reset", () => {
    const d = holdDecision(snap({ fiveHour: { utilization: 0.85, resetsAt: FIVE_RESET } }), HOLD, NOW);
    expect(d).toEqual({ hold: true, reason: "five-hour window at 85% (hold above 85%)", until: FIVE_RESET });
  });

  it("holds a seven-day window at or above its threshold until its reset", () => {
    const d = holdDecision(snap({ sevenDay: { utilization: 0.97, resetsAt: SEVEN_RESET } }), HOLD, NOW);
    expect(d).toEqual({ hold: true, reason: "seven-day window at 97% (hold above 95%)", until: SEVEN_RESET });
  });

  it("takes the latest reset when both windows hold", () => {
    const d = holdDecision(
      snap({
        fiveHour: { utilization: 0.9, resetsAt: FIVE_RESET },
        sevenDay: { utilization: 0.99, resetsAt: SEVEN_RESET },
      }),
      HOLD,
      NOW,
    );
    expect(d.hold).toBe(true);
    expect(d.until).toBe(SEVEN_RESET);
    expect(d.reason).toBe("five-hour window at 90% (hold above 85%); seven-day window at 99% (hold above 95%)");
  });

  it("holds a rejection until the named window resets, whatever its utilisation", () => {
    const d = holdDecision(snap({ status: "rejected", type: "five_hour" }), HOLD, NOW);
    expect(d).toEqual({ hold: true, reason: "rate limit rejected (five-hour window at 60%)", until: FIVE_RESET });
  });

  it("holds an unnamed rejection on every live window", () => {
    const d = holdDecision(snap({ status: "rejected", type: null }), HOLD, NOW);
    expect(d.hold).toBe(true);
    expect(d.until).toBe(SEVEN_RESET);
  });

  it("does not hold a rejection whose windows have reset", () => {
    const d = holdDecision(snap({ status: "rejected", type: "five_hour" }), HOLD, FIVE_RESET);
    expect(d.hold).toBe(false);
  });

  it("never holds on expired windows, even above the thresholds", () => {
    const full = snap({
      fiveHour: { utilization: 1, resetsAt: FIVE_RESET },
      sevenDay: { utilization: 1, resetsAt: SEVEN_RESET },
    });
    expect(holdDecision(full, HOLD, SEVEN_RESET).hold).toBe(false);
    const fiveOnly = holdDecision(full, { fiveHour: 0.85, sevenDay: 1.01 }, FIVE_RESET + 1);
    expect(fiveOnly.hold).toBe(false);
  });

  it("ignores missing windows", () => {
    expect(holdDecision(snap({ fiveHour: null, sevenDay: null, status: "rejected" }), HOLD, NOW).hold).toBe(false);
  });
});

describe("resumeAt", () => {
  it("adds a minute and the jitter", () => {
    expect(resumeAt(FIVE_RESET, 0)).toBe(FIVE_RESET + 60);
    expect(resumeAt(FIVE_RESET, 60)).toBe(FIVE_RESET + 120);
  });
  it("refuses a jitter outside 0–60", () => {
    expect(() => resumeAt(FIVE_RESET, -1)).toThrow(ArbabError);
    expect(() => resumeAt(FIVE_RESET, 61)).toThrow(ArbabError);
    expect(() => resumeAt(FIVE_RESET, Number.NaN)).toThrow(ArbabError);
  });
});

describe("formatQuota", () => {
  it("formats the real snapshot", () => {
    expect(formatQuota(snap({ fiveHour: { utilization: 0.62, resetsAt: FIVE_RESET } }), NOW)).toBe(
      "5h 62% (resets 12:30Z) · 7d 60% (resets Oct 15 08:00Z)",
    );
  });
  it("says unknown without a snapshot or windows", () => {
    expect(formatQuota(null, NOW)).toBe("quota unknown");
    expect(formatQuota(snap({ fiveHour: null, sevenDay: null }), NOW)).toBe("quota unknown");
  });
  it("marks reset windows and rejections", () => {
    expect(formatQuota(snap({ status: "rejected", sevenDay: null }), FIVE_RESET + 60)).toBe(
      "5h — (reset 12:30Z) · rejected",
    );
  });
});
