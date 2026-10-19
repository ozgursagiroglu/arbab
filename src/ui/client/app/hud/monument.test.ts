import { describe, expect, it } from "vitest";
import { integration, snapshot } from "../fixtures";
import type { FakeElement } from "./fake-dom";
import { fakeDocument } from "./fake-dom";
import { formatReview, monumentSteps, mountMonument, pickMonument, STEP_COLORS } from "./monument";

const NOW = Date.parse("2026-10-19T22:00:00.000Z");

describe("pickMonument", () => {
  it("is the newest integration not landed, else the newest landed one", () => {
    const old = integration({ name: "old", landedAt: "2026-10-19T08:00:00.000Z" });
    const newer = integration({ name: "newer", landedAt: "2026-10-19T09:00:00.000Z" });
    const open1 = integration({ name: "open1", updatedAt: "2026-10-19T10:00:00.000Z" });
    const open2 = integration({ name: "open2", updatedAt: "2026-10-19T09:30:00.000Z" });
    expect(pickMonument([old, open1, newer, open2])?.name).toBe("open1");
    expect(pickMonument([newer, old])?.name).toBe("newer");
    expect(pickMonument([])).toBeNull();
  });
});

describe("monumentSteps", () => {
  it("is all pending but integrated for a fresh integration", () => {
    const steps = monumentSteps(integration({ name: "i", lanes: ["a"] }), NOW);
    expect(steps.map((s) => [s.label, s.state, s.mark, s.detail])).toEqual([
      ["INTEGRATED", "done", "✓", "1 lane"],
      ["VERIFY", "pending", "·", "not run"],
      ["REVIEW", "pending", "·", "not run"],
      ["READY", "pending", "·", "not checked"],
      ["LANDED", "pending", "·", "not landed"],
    ]);
  });

  it("marks what passed in gold and what failed in red", () => {
    const failed = monumentSteps(integration({ name: "i", lanes: ["a", "b"], verify: "failed", ready: false }), NOW);
    expect(failed.map((s) => s.state)).toEqual(["done", "failed", "pending", "failed", "pending"]);
    expect(failed[1]?.mark).toBe("✗");
    const landed = monumentSteps(
      integration({
        name: "i",
        lanes: ["a", "b"],
        verify: "passed",
        review: { lenses: 2, confirmed: 1, refuted: 0, unverified: 2 },
        ready: true,
        landedAt: "2026-10-19T11:00:00.000Z",
      }),
      NOW,
    );
    expect(landed.map((s) => [s.state, s.detail])).toEqual([
      ["done", "2 lanes"],
      ["done", "passed"],
      ["done", "2 lenses · 1 confirmed · 2 unverified"],
      ["done", "ready"],
      ["done", "11h ago"],
    ]);
    expect(STEP_COLORS).toEqual({ done: "#ffd54a", failed: "#d04040", pending: "#7d6a4d" });
  });

  it("formats a review of one lens", () => {
    expect(formatReview({ lenses: 1, confirmed: 0, refuted: 1, unverified: 0 })).toBe("1 lens · 0 confirmed · 0 unverified");
  });
});

describe("mountMonument", () => {
  it("says there is no integration yet, then shows the name, the short head and the stepper", () => {
    const doc = fakeDocument();
    const title = doc.createElement("h2") as FakeElement;
    const body = doc.createElement("div") as FakeElement;
    const panel = mountMonument(doc, { title, body }, 1);
    expect(title.text()).toBe("MONUMENT");
    panel.update(snapshot(), NOW);
    const [head, list, empty] = body.children;
    expect(empty?.hidden).toBe(false);
    expect(empty?.textContent).toBe("No integration yet.");
    expect(list?.hidden).toBe(true);
    panel.update(snapshot({ integrations: [integration({ name: "ui", headSha: "0123456789abcdef", verify: "failed", lanes: ["a"] })] }), NOW);
    expect(empty?.hidden).toBe(true);
    expect(head?.text()).toBe("ui 0123456");
    expect(list?.children.map((li) => li.attributes.get("data-state"))).toEqual(["done", "failed", "pending", "pending", "pending"]);
    expect(list?.children[1]?.text()).toBe("✗ VERIFY failed");
  });
});
