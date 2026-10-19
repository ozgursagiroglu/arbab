import { describe, expect, it } from "vitest";
import { integration, lane, snapshot } from "../fixtures";
import { sceneCaption } from "./caption";

const NOW = Date.parse("2026-10-19T22:05:00.000Z");

describe("sceneCaption", () => {
  it("names the integration, its blocks set, the capstone and verify while lanes build", () => {
    const lanes = Array.from({ length: 10 }, (_, i) =>
      i < 3 ? lane({ name: `l${i}`, state: "finished", endState: "success", integration: "ui2" }) : lane({ name: `l${i}`, integration: "ui2" }),
    );
    const s = snapshot({ now: "2026-10-19T22:05:00.000Z", lanes, integrations: [integration({ name: "ui2", lanes: ["l0", "l1", "l2"], verify: "passed" })] });
    expect(sceneCaption(s, NOW)).toBe("UI2 · 3/10 BLOCKS SET · CAPSTONE WAITING · VERIFY ✓");
    const failed = { ...s, integrations: [integration({ name: "ui2", lanes: ["l0"], verify: "failed" })] };
    expect(sceneCaption(failed, NOW)).toBe("UI2 · 3/10 BLOCKS SET · CAPSTONE WAITING · VERIFY ✗");
  });

  it("counts the blocks alone without an integration", () => {
    expect(sceneCaption(snapshot({ lanes: [lane({ name: "a" })] }), NOW)).toBe("0/1 BLOCKS SET");
  });

  it("says when the newest landed integration stands as the monument", () => {
    const s = snapshot({
      now: "2026-10-19T22:05:00.000Z",
      integrations: [
        integration({ name: "old", lanes: ["x"], landedAt: "2026-10-18T10:00:00.000Z" }),
        integration({ name: "ui", lanes: ["a", "b", "c", "d", "e", "f", "g", "h"], landedAt: "2026-10-19T11:00:00.000Z" }),
      ],
    });
    expect(sceneCaption(s, NOW)).toBe("MONUMENT · UI · 8 BLOCKS · LANDED 11H AGO");
  });

  it("is quiet with nothing", () => {
    expect(sceneCaption(snapshot(), NOW)).toBe("THE SITE IS QUIET");
  });
});
