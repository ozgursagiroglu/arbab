import { describe, expect, it } from "vitest";
import type { UiSnapshot } from "../../../protocol";
import { createScene } from "../../scene/scene";
import { seededRandom } from "../../scene/testkit";
import { integration, lane, snapshot } from "../fixtures";
import { sceneCaption } from "./caption";
import type { FakeElement } from "./fake-dom";
import { fakeDocument } from "./fake-dom";
import { formatReview, monumentSteps, mountMonument, STEP_COLORS } from "./monument";

const NOW = Date.parse("2026-10-19T22:00:00.000Z");

/** The integration the panel names for a snapshot, and the caption under the scene the page draws of it. */
function shown(s: UiSnapshot): { panel: string | null; caption: string } {
  const doc = fakeDocument();
  const body = doc.createElement("div") as FakeElement;
  mountMonument(doc, { title: doc.createElement("h2"), body }, 1).update(s, Date.parse(s.now));
  const [head] = body.children;
  const scene = createScene({ reducedMotion: false, random: seededRandom(3) });
  scene.apply(s);
  return { panel: head?.hidden ? null : (head?.children[0]?.textContent ?? null), caption: sceneCaption(s, Date.parse(s.now), scene.world) };
}

describe("the integration the panel names", () => {
  it("is the recent landing the scene hoists, not the newer integration open beside it", () => {
    const s = snapshot({
      lanes: [lane({ name: "a", state: "finished", endState: "success", integration: "landed" }), lane({ name: "b", integration: "open" })],
      integrations: [
        integration({ name: "landed", lanes: ["a"], updatedAt: "2026-10-19T10:03:00.000Z", landedAt: "2026-10-19T10:04:00.000Z" }),
        integration({ name: "open", lanes: ["b"], updatedAt: "2026-10-19T10:04:30.000Z" }),
      ],
    });
    const { panel, caption } = shown(s);
    expect(panel).toBe("landed");
    expect(caption).toBe("LANDED · 1/2 BLOCKS SET · CAPSTONE SET · VERIFY ·");
  });

  it("is the open integration that merged a foreground builder, not a newer one that merged none", () => {
    const s = snapshot({
      lanes: [
        lane({ name: "a", state: "finished", endState: "success", integration: "built" }),
        lane({ name: "rev", role: "reviewer", kind: "review", integration: "reviewed" }),
      ],
      integrations: [
        integration({ name: "built", lanes: ["a"], updatedAt: "2026-10-19T10:00:00.000Z" }),
        integration({ name: "reviewed", lanes: ["rev"], updatedAt: "2026-10-19T10:04:00.000Z" }),
      ],
    });
    const { panel, caption } = shown(s);
    expect(panel).toBe("built");
    expect(caption).toBe("BUILT · 1/1 BLOCKS SET · CAPSTONE WAITING · VERIFY ·");
  });

  it("is the monument the scene stands, else the newest open integration, else the newest landed one", () => {
    const old = integration({ name: "old", lanes: ["z"], landedAt: "2026-10-19T08:00:00.000Z" });
    const idle = integration({ name: "idle", updatedAt: "2026-10-19T10:04:00.000Z" });
    const standing = shown(snapshot({ integrations: [old, idle] }));
    expect(standing.panel).toBe("old");
    expect(standing.caption).toMatch(/^MONUMENT · OLD · /);
    // Work in the foreground that no integration merged: no capstone and no monument.
    const busy = [lane({ name: "new" })];
    expect(shown(snapshot({ lanes: busy, integrations: [old, idle] })).panel).toBe("idle");
    expect(shown(snapshot({ lanes: busy, integrations: [old] })).panel).toBe("old");
    expect(shown(snapshot({ lanes: busy })).panel).toBeNull();
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
