import { describe, expect, it } from "vitest";
import type { UiQuota, UiSnapshot } from "../../protocol";
import { integration, lane, snapshot } from "./fixtures";
import {
  announcements,
  computeScale,
  formatCounts,
  formatState,
  formatUsd,
  header,
  laneCounts,
  laneElapsedMs,
  parseProblem,
  parseSnapshot,
  PAGE_GAPS,
  parseToken,
  sceneSize,
  stageRoom,
  tooltipLines,
  totalCost,
} from "./hud";

describe("computeScale", () => {
  it("is floor(min(w / 480, h / 270) × dpr) / dpr: whole device pixels per art pixel", () => {
    expect(computeScale(1000, 850, 1)).toBe(2);
    expect(computeScale(2000, 850, 1)).toBe(3);
    expect(computeScale(2000, 550, 1)).toBe(2);
    expect(computeScale(1440, 2000, 1)).toBe(3);
    // A dpr-2 screen gets the half steps: 2.5× CSS is 5× device.
    expect(computeScale(1200, 2000, 2)).toBe(2.5);
    expect(computeScale(1199, 2000, 2)).toBe(2);
    expect(computeScale(1000, 850, 2)).toBe(2);
    expect(computeScale(1120, 2000, 3)).toBe(7 / 3);
  });

  it("is below 1 on a narrow stage, 0 when nothing fits, and reads a bad dpr as 1", () => {
    expect(computeScale(400, 900, 1)).toBe(0);
    expect(computeScale(400, 900, 2)).toBe(0.5);
    expect(computeScale(0, 0, 1)).toBe(0);
    expect(computeScale(Number.NaN, 900, 1)).toBe(0);
    expect(computeScale(1000, 850, Number.NaN)).toBe(2);
    expect(computeScale(1000, 850, 0)).toBe(2);
  });
});

describe("sceneSize", () => {
  it("is a fixed size at 1× and up", () => {
    expect(sceneSize(1000, 850, 1)).toEqual({ fluid: false, scale: 2, width: 960, height: 540 });
    expect(sceneSize(1200, 2000, 2)).toEqual({ fluid: false, scale: 2.5, width: 1200, height: 675 });
  });

  it("takes the stage's width below 1× on a narrow stage, and keeps 1× on a wide but short one", () => {
    expect(sceneSize(380, 900, 2)).toEqual({ fluid: true });
    expect(sceneSize(380, 900, 1)).toEqual({ fluid: true });
    expect(sceneSize(1200, 200, 1)).toEqual({ fluid: false, scale: 1, width: 480, height: 270 });
    expect(sceneSize(Number.NaN, 900, 1)).toEqual({ fluid: true });
  });
});

describe("stageRoom", () => {
  it("leaves the stage the viewport less the top bar, the KPI row, the card's chrome and the page's gaps", () => {
    expect(stageRoom(900, 56, 100, 120)).toBe(900 - 56 - 100 - 120 - PAGE_GAPS);
    expect(stageRoom(100, 56, 100, 120)).toBe(0);
    expect(stageRoom(Number.NaN, 56, 100, 120)).toBe(0);
  });

  it("reaches 3× at 1920 × 1080 (dpr 1) with the trimmed layout: a 1452-px stage, a one-row KPI strip, lean chrome", () => {
    // The top bar 56; KPI cards 44 + 2 × 8 padding + 2 × 4 margins; the card: 2 × 8 padding, a 44-px title bar, a 33-px caption.
    const room = stageRoom(1080, 56, 68, 93);
    expect(room).toBeGreaterThanOrEqual(810);
    expect(computeScale(1452, room, 1)).toBe(3);
    // 1440 × 900: 2×.
    expect(computeScale(1012, stageRoom(900, 56, 68, 93), 1)).toBe(2);
  });
});

describe("parseToken", () => {
  it("reads #token=<hex>", () => {
    expect(parseToken("#token=0123456789abcdef0123456789ABCDEF")).toBe("0123456789abcdef0123456789ABCDEF");
    expect(parseToken("#a=1&token=deadbeefdeadbeef")).toBe("deadbeefdeadbeef");
  });

  it("refuses a missing or malformed token", () => {
    expect(parseToken("")).toBeNull();
    expect(parseToken("#")).toBeNull();
    expect(parseToken("#token=")).toBeNull();
    expect(parseToken("#token=not-hex!")).toBeNull();
    expect(parseToken("#token=abc")).toBeNull();
  });
});

describe("parseSnapshot", () => {
  it("accepts this protocol's snapshot", () => {
    const s = snapshot({ lanes: [lane({ name: "a" })] });
    const parsed = parseSnapshot(JSON.stringify(s));
    expect(parsed.ok && parsed.snapshot.lanes[0]?.name).toBe("a");
  });

  it("explains what is wrong with anything else", () => {
    const bad = (data: string): string => {
      const parsed = parseSnapshot(data);
      return parsed.ok ? "" : parsed.message;
    };
    expect(bad("{")).toMatch(/not JSON/);
    expect(bad("[]")).toMatch(/not an object/);
    expect(bad(JSON.stringify({ ...snapshot(), protocol: 2 }))).toMatch(/protocol 1 and the server speaks 2/);
    expect(bad(JSON.stringify({ ...snapshot(), lanes: null }))).toMatch(/without lanes/);
    expect(bad(JSON.stringify({ ...snapshot(), lanes: [{ state: "running" }] }))).toMatch(/without a name/);
  });
});

describe("parseProblem", () => {
  it("reads the message, else says something generic", () => {
    expect(parseProblem(JSON.stringify({ message: "registry unreadable" }))).toBe("registry unreadable");
    expect(parseProblem("nope")).toBe("The server reported a problem.");
    expect(parseProblem(JSON.stringify({ message: 3 }))).toBe("The server reported a problem.");
  });
});

describe("counts", () => {
  const lanes = [
    lane({ name: "a", state: "running" }),
    lane({ name: "b", state: "running" }),
    lane({ name: "c", state: "preparing" }),
    lane({ name: "d", state: "held", hold: "quota" }),
    lane({ name: "e", state: "queued" }),
    lane({ name: "f", state: "waiting-reset" }),
    lane({ name: "g", state: "orphaned" }),
    lane({ name: "h", state: "finished", endState: "success" }),
    lane({ name: "i", state: "finished", endState: "failed" }),
    lane({ name: "j", state: "finished", endState: "killed:wall" }),
  ];

  it("counts lanes by state, finished as ✓ and ✗", () => {
    expect(laneCounts(lanes)).toEqual({ running: 2, preparing: 1, waiting: 2, asleep: 1, orphaned: 1, succeeded: 1, failed: 2 });
    expect(formatCounts(laneCounts(lanes))).toBe("2 running · 1 preparing · 2 waiting · 1 asleep · 1 orphaned · ✓ 1 ✗ 2");
  });

  it("leaves out zeros", () => {
    expect(formatCounts(laneCounts([lane({ name: "a" })]))).toBe("1 running");
    expect(formatCounts(laneCounts([]))).toBe("no lanes");
  });
});

describe("header", () => {
  it("says project · version, counts, total cost, quota and held", () => {
    const s = snapshot({
      lanes: [lane({ name: "a", costUsd: 1.25 }), lane({ name: "b", costUsd: 2.5 }), lane({ name: "c", costUsd: null })],
      hiddenLanes: 3,
      quota: {
        ...snapshot().quota,
        fiveHour: { utilization: 0.62, resetsAt: Date.parse("2026-10-19T12:00:00Z") / 1000 },
        sevenDay: { utilization: 0.4, resetsAt: Date.parse("2026-10-22T12:00:00Z") / 1000 },
        hold: { hold: true, reason: "five-hour window above 90%", until: null },
      },
    });
    expect(header(s)).toEqual({
      project: "demo",
      version: "v0.2.0",
      counts: "3 running",
      cost: "$3.75",
      quota: "5h 62% · 7d 40%",
      held: true,
      footer: "Read-only · arbab 0.2.0 · 3 older lanes not shown",
    });
  });

  it("leaves the hidden lanes out of the footer when there are none", () => {
    expect(header(snapshot()).footer).toBe("Read-only · arbab 0.2.0");
    expect(header(snapshot({ hiddenLanes: 1 })).footer).toBe("Read-only · arbab 0.2.0 · 1 older lane not shown");
  });

  it("leaves out quota windows that have reset", () => {
    const nowSec = Date.parse(snapshot().now) / 1000;
    const quota = (fiveHour: UiQuota["fiveHour"], sevenDay: UiQuota["sevenDay"]): UiSnapshot => snapshot({ quota: { ...snapshot().quota, fiveHour, sevenDay } });
    expect(header(quota({ utilization: 0.9, resetsAt: nowSec - 1 }, null)).quota).toBe("—");
    expect(header(quota(null, { utilization: 0.123, resetsAt: nowSec + 1 })).quota).toBe("7d 12%");
  });

  it("formats money", () => {
    expect(formatUsd(null)).toBe("—");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(12.345)).toBe("$12.35");
    expect(totalCost([lane({ name: "a", costUsd: Number.NaN }), lane({ name: "b", costUsd: 1 })])).toBe(1);
  });
});

describe("tooltip", () => {
  it("lists the lane's facts, elapsed counting live from since", () => {
    const l = lane({
      name: "ui-art",
      role: "implementer",
      kind: "lane",
      state: "running",
      attempt: 2,
      since: "2026-10-19T10:00:00.000Z",
      toolCalls: 42,
      lastTool: "Edit",
      costUsd: 1.5,
      model: "claude-opus-5-5",
      effort: "high",
    });
    // The client clock is 1 minute behind the server's.
    const client = Date.parse("2026-10-19T10:11:03.000Z");
    expect(tooltipLines(l, client, 60_000)).toEqual([
      "ui-art",
      "implementer · lane",
      "running",
      "attempt 2",
      "elapsed 12m03s",
      "tool calls 42",
      "last tool Edit",
      "cost $1.50",
      "claude-opus-5-5 · high",
    ]);
  });

  it("adds the hold or the reason, and uses a finished run's wall clock", () => {
    const held = lane({ name: "h", state: "held", hold: "slot", reason: "no free slot" });
    const lines = tooltipLines(held, 0, 0);
    expect(lines[2]).toBe("held (slot)");
    expect(lines.slice(-2)).toEqual(["held for a free slot", "no free slot"]);
    const done = lane({ name: "d", state: "finished", endState: "success", elapsedMs: 45_000 });
    expect(tooltipLines(done, 0, 0)).toContain("elapsed 45s");
    expect(tooltipLines(done, 0, 0)[2]).toBe("finished (success)");
    expect(tooltipLines(lane({ name: "x", since: "garbage" }), 0, 0)).toContain("elapsed —");
  });

  it("never counts elapsed below zero", () => {
    expect(laneElapsedMs({ elapsedMs: null, since: "2026-10-19T10:00:00Z", state: "running" }, Date.parse("2026-10-19T09:00:00Z"))).toBe(0);
  });

  it("counts from since only while the state is live; a finished or orphaned lane without a wall clock shows —", () => {
    const since = "2026-10-19T10:00:00.000Z";
    const server = Date.parse("2026-10-19T10:00:45.000Z");
    for (const state of ["queued", "held", "preparing", "running", "waiting-reset"] as const) {
      expect(laneElapsedMs({ elapsedMs: null, since, state }, server), state).toBe(45_000);
    }
    expect(laneElapsedMs({ elapsedMs: null, since, state: "finished" }, server)).toBeNull();
    expect(laneElapsedMs({ elapsedMs: null, since, state: "orphaned" }, server)).toBeNull();
    expect(laneElapsedMs({ elapsedMs: 3_000, since, state: "orphaned" }, server)).toBe(3_000);
    for (const l of [lane({ name: "f", state: "finished", endState: "failed", since }), lane({ name: "o", state: "orphaned", since })]) {
      expect(tooltipLines(l, server, 0)).toContain("elapsed —");
    }
  });

  it("formats states", () => {
    expect(formatState({ state: "finished", endState: null, hold: null })).toBe("finished");
    expect(formatState({ state: "held", endState: null, hold: null })).toBe("held");
  });
});

describe("announcements", () => {
  it("says nothing for the first snapshot", () => {
    expect(announcements(null, snapshot({ lanes: [lane({ name: "a" })] }))).toEqual([]);
  });

  it("announces starts, finishes and landings", () => {
    const prev = snapshot({
      lanes: [lane({ name: "a", state: "queued" }), lane({ name: "b", state: "running" }), lane({ name: "c", state: "waiting-reset" })],
      integrations: [integration({ name: "int-1" })],
    });
    const next = snapshot({
      lanes: [
        lane({ name: "a", state: "preparing" }),
        lane({ name: "b", state: "finished", endState: "success" }),
        lane({ name: "c", state: "running" }),
        lane({ name: "d", state: "running" }),
      ],
      integrations: [integration({ name: "int-1", landedAt: "2026-10-19T10:04:00Z" }), integration({ name: "int-2", landedAt: "2026-10-19T10:04:00Z" })],
    });
    expect(announcements(prev, next)).toEqual(["a started", "b finished: success", "d started", "int-1 landed"]);
  });

  it("does not repeat itself", () => {
    const s = snapshot({ lanes: [lane({ name: "a", state: "running" })], integrations: [integration({ name: "i", landedAt: "x" })] });
    expect(announcements(s, s)).toEqual([]);
    const preparing = snapshot({ lanes: [lane({ name: "a", state: "preparing" })] });
    expect(announcements(preparing, s)).toEqual([]);
  });
});
