import { describe, expect, it } from "vitest";
import type { FakeElement } from "./fake-dom";
import { fakeDocument } from "./fake-dom";
import { formatReset, GAUGE_W, gaugeLevel, gaugeView, LEVEL_COLORS, mountGauge } from "./gauge";

const NOW = 1_000_000;

describe("gaugeLevel", () => {
  it("is sand under 70%, amber from 70%, red at or above the hold", () => {
    expect(gaugeLevel(0, 0.9)).toBe("ok");
    expect(gaugeLevel(0.69, 0.9)).toBe("ok");
    expect(gaugeLevel(0.7, 0.9)).toBe("warn");
    expect(gaugeLevel(0.89, 0.9)).toBe("warn");
    expect(gaugeLevel(0.9, 0.9)).toBe("hold");
    expect(gaugeLevel(1, 0.9)).toBe("hold");
    // A hold below 70% wins.
    expect(gaugeLevel(0.6, 0.5)).toBe("hold");
  });
});

describe("formatReset", () => {
  it("says how long until the reset", () => {
    expect(formatReset(2 * 3600 + 5 * 60 + 30)).toBe("2h 05m");
    expect(formatReset(45 * 60)).toBe("45m");
    expect(formatReset(3 * 86_400 + 4 * 3600)).toBe("3d 04h");
    expect(formatReset(20)).toBe("<1m");
    expect(formatReset(-5)).toBe("<1m");
  });
});

describe("gaugeView", () => {
  it("fills in whole steps, ticks at the hold and titles the reset", () => {
    const view = gaugeView("5h", { utilization: 0.62, resetsAt: NOW + 7530 }, 0.9, NOW);
    expect(view).toEqual({ percent: "62%", fill: 60, tick: 86, level: "ok", title: "5h window 62% · resets in 2h 05m · hold at 90%" });
    expect(gaugeView("7d", { utilization: 0.001, resetsAt: NOW + 60 }, 0.95, NOW).fill).toBe(4);
    expect(gaugeView("7d", { utilization: 0, resetsAt: NOW + 60 }, 0.95, NOW).fill).toBe(0);
    expect(gaugeView("7d", { utilization: 1.4, resetsAt: NOW + 60 }, 0.95, NOW)).toMatchObject({ fill: GAUGE_W, percent: "140%", level: "hold" });
    expect(gaugeView("7d", { utilization: 0.5, resetsAt: NOW + 60 }, 1, NOW).tick).toBe(GAUGE_W - 1);
  });

  it("shows no reading for a missing or reset window", () => {
    expect(gaugeView("5h", null, 0.9, NOW)).toEqual({ percent: "—", fill: 0, tick: 86, level: "ok", title: "5h window: no current reading · hold at 90%" });
    expect(gaugeView("5h", { utilization: 0.99, resetsAt: NOW }, 0.9, NOW).percent).toBe("—");
  });
});

describe("mountGauge", () => {
  it("fills its element with the label, the bar and the percentage in the level's color", () => {
    const doc = fakeDocument();
    const root = doc.createElement("div") as FakeElement;
    const gauge = mountGauge(doc, root, "5h", 1);
    gauge.update(gaugeView("5h", { utilization: 0.75, resetsAt: NOW + 600 }, 0.9, NOW));
    expect(root.text()).toBe("5H 75%");
    expect(root.attributes.get("data-level")).toBe("warn");
    expect(root.attributes.get("title")).toBe("5h window 75% · resets in 10m · hold at 90%");
    const [fill, tick] = root.find("gauge-bar")[0]?.children ?? [];
    expect(fill?.style.width).toBe("72px");
    expect(tick?.style.left).toBe("86px");
    const pct = root.find("gauge-pct")[0]?.children[0] as unknown as { fills: { color: string }[] };
    expect(pct.fills.every((f) => f.color === LEVEL_COLORS.warn)).toBe(true);
  });
});
