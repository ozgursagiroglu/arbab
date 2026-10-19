import { describe, expect, it } from "vitest";
import { measureText } from "../font";
import { lane, snapshot } from "../fixtures";
import type { FakeElement } from "./fake-dom";
import { fakeDocument } from "./fake-dom";
import { COUNT_MS, countAt, createCounter, KPI_CARDS, kpiScale, kpiText, kpiValues, mountKpis, NUMBER_MAX_W } from "./kpi";

const lanes = [
  lane({ name: "a", state: "running", costUsd: 1.25 }),
  lane({ name: "b", state: "preparing" }),
  lane({ name: "c", state: "queued" }),
  lane({ name: "d", state: "held", hold: "quota" }),
  lane({ name: "e", state: "waiting-reset" }),
  lane({ name: "f", state: "finished", endState: "success", costUsd: 2 }),
  lane({ name: "g", state: "finished", endState: "failed", costUsd: 0.5 }),
  lane({ name: "h", state: "orphaned" }),
];

describe("kpiValues", () => {
  it("counts at work, waiting, asleep, finished and the treasury", () => {
    expect(kpiValues(snapshot({ lanes }))).toEqual({ atWork: 2, waiting: 2, asleep: 1, succeeded: 1, failed: 1, treasury: 3.75 });
  });
});

describe("countAt", () => {
  it("eases from one value to the next over the duration", () => {
    expect(countAt(0, 10, 0)).toBe(0);
    const mid = countAt(0, 10, COUNT_MS / 2);
    expect(mid).toBeGreaterThan(5);
    expect(mid).toBeLessThan(10);
    expect(countAt(0, 10, COUNT_MS)).toBe(10);
    expect(countAt(0, 10, COUNT_MS * 3)).toBe(10);
    expect(countAt(10, 2, COUNT_MS / 2)).toBeLessThan(10);
    expect(countAt(0, 10, 50, 0)).toBe(10);
  });
});

describe("createCounter", () => {
  it("counts from what shows now to the new target", () => {
    const counter = createCounter(false);
    counter.set([4], 1000);
    expect(counter.value(1000)).toEqual([0]);
    expect(counter.value(1000 + COUNT_MS)).toEqual([4]);
    // A change mid-count starts from where it is.
    const shown = counter.value(1100)[0] ?? 0;
    counter.set([8], 1100);
    expect(counter.value(1100)[0]).toBeCloseTo(shown);
    expect(counter.value(1100 + COUNT_MS)).toEqual([8]);
    // The same target does not restart the count.
    counter.set([8], 1200);
    expect(counter.value(1100 + COUNT_MS)).toEqual([8]);
  });

  it("jumps at once with reduced motion", () => {
    const counter = createCounter(true);
    counter.set([3, 1], 0);
    expect(counter.value(0)).toEqual([3, 1]);
    counter.set([5, 1], 10);
    expect(counter.value(10)).toEqual([5, 1]);
  });
});

describe("kpiScale and kpiText", () => {
  it("steps the scale down when the number is too wide for a card", () => {
    expect(kpiScale("12")).toBe(4);
    expect(kpiScale("$12.34")).toBe(4);
    const wide = "$1234.56";
    expect(measureText(wide) * 4).toBeGreaterThan(NUMBER_MAX_W);
    expect(kpiScale(wide)).toBe(3);
    expect(kpiScale("$1234567.89")).toBe(2);
  });

  it("formats each card, and calls an all-zero card zero", () => {
    const [atWork, , , finished, treasury] = KPI_CARDS;
    if (!atWork || !finished || !treasury) throw new Error("cards");
    expect(kpiText(atWork, [2.6])).toEqual({ text: "3", zero: false });
    expect(kpiText(atWork, [0])).toEqual({ text: "0", zero: true });
    expect(kpiText(finished, [3, 1])).toEqual({ text: "✓3 ✗1", zero: false });
    expect(kpiText(finished, [0, 0]).zero).toBe(true);
    expect(kpiText(treasury, [3.75])).toEqual({ text: "$3.75", zero: false });
    expect(kpiText(treasury, [0])).toEqual({ text: "$0.00", zero: true });
    expect(KPI_CARDS.map((c) => c.label)).toEqual(["AT WORK", "WAITING", "ASLEEP", "FINISHED", "TREASURY"]);
  });
});

describe("mountKpis", () => {
  it("makes five framed cards with an icon, a number and a label, and counts them", () => {
    const doc = fakeDocument();
    const list = doc.createElement("ul") as FakeElement;
    const row = mountKpis(doc, list, { dpr: 1, reducedMotion: false });
    expect(list.children.map((li) => li.className)).toEqual(Array(5).fill("kpi frame"));
    expect(list.children[0]?.children[0]?.className).toBe("px icon icon-hammer");
    expect(list.children.map((li) => li.find("kpi-label")[0]?.text())).toEqual(["AT WORK", "WAITING", "ASLEEP", "FINISHED", "TREASURY"]);
    row.update(snapshot({ lanes }), 0);
    const numbers = (): string[] => list.children.map((li) => li.find("kpi-number")[0]?.text() ?? "");
    expect(numbers()).toEqual(["0", "0", "0", "✓0 ✗0", "$0.00"]);
    expect(list.children[0]?.attributes.get("data-zero")).toBe("true");
    row.tick(COUNT_MS);
    expect(numbers()).toEqual(["2", "2", "1", "✓1 ✗1", "$3.75"]);
    expect(list.children[0]?.attributes.get("data-zero")).toBe("false");
  });

  it("shows the new numbers at once with reduced motion", () => {
    const doc = fakeDocument();
    const list = doc.createElement("ul") as FakeElement;
    const row = mountKpis(doc, list, { dpr: 1, reducedMotion: true });
    row.update(snapshot({ lanes }), 0);
    expect(list.children[2]?.find("kpi-number")[0]?.text()).toBe("1");
  });
});
