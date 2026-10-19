import { describe, expect, it } from "vitest";
import type { UiSnapshot } from "../../../protocol";
import type { Scene } from "../../model";
import { createScene } from "../../scene/scene";
import { seededRandom } from "../../scene/testkit";
import { integration, lane, snapshot } from "../fixtures";
import { captionKey, sceneCaption } from "./caption";

const NOW_ISO = "2026-10-19T22:05:00.000Z";
const NOW = Date.parse(NOW_ISO);

/** The scene the page would show for these snapshots, the last one applied. */
function sceneOf(...snapshots: UiSnapshot[]): Scene {
  const scene = createScene({ reducedMotion: false, random: seededRandom(5) });
  for (const s of snapshots) scene.apply(s);
  return scene;
}

function caption(s: UiSnapshot): string {
  return sceneCaption(s, NOW, sceneOf(s).world);
}

describe("sceneCaption", () => {
  it("names the integration, its blocks set, the capstone and verify while lanes build", () => {
    const lanes = Array.from({ length: 10 }, (_, i) =>
      i < 3 ? lane({ name: `l${i}`, state: "finished", endState: "success", integration: "ui2" }) : lane({ name: `l${i}`, integration: "ui2" }),
    );
    const s = snapshot({ now: NOW_ISO, lanes, integrations: [integration({ name: "ui2", lanes: ["l0", "l1", "l2"], verify: "passed" })] });
    expect(caption(s)).toBe("UI2 · 3/10 BLOCKS SET · CAPSTONE WAITING · VERIFY ✓");
    const failed = { ...s, integrations: [integration({ name: "ui2", lanes: ["l0"], verify: "failed" })] };
    expect(caption(failed)).toBe("UI2 · 3/10 BLOCKS SET · CAPSTONE WAITING · VERIFY ✗");
  });

  it("counts the blocks the scene shows as set: a done report or none, not a partial one", () => {
    const s = snapshot({
      now: NOW_ISO,
      lanes: [
        lane({ name: "a", state: "finished", endState: "success", reportStatus: "done" }),
        lane({ name: "b", state: "finished", endState: "success", reportStatus: "partial" }),
        lane({ name: "c" }),
      ],
    });
    expect(caption(s)).toBe("1/3 BLOCKS SET");
  });

  it("counts the blocks alone without an integration", () => {
    expect(caption(snapshot({ lanes: [lane({ name: "a" })] }))).toBe("0/1 BLOCKS SET");
  });

  it("follows the capstone up: rising while it is hoisted, set once it stands on the apex", () => {
    const lanes = [lane({ name: "a", state: "finished", endState: "success", integration: "ui2" })];
    const open = snapshot({ now: NOW_ISO, lanes, integrations: [integration({ name: "ui2", lanes: ["a"], verify: "passed" })] });
    const landed = { ...open, integrations: [integration({ name: "ui2", lanes: ["a"], verify: "passed", landedAt: "2026-10-19T22:04:59.000Z" })] };
    const scene = sceneOf(open, landed);
    expect(sceneCaption(landed, NOW, scene.world)).toBe("UI2 · 1/1 BLOCKS SET · CAPSTONE RISING · VERIFY ✓");
    const before = captionKey(scene.world);
    for (let i = 0; i < 300; i += 1) scene.step(16);
    expect(sceneCaption(landed, NOW, scene.world)).toBe("UI2 · 1/1 BLOCKS SET · CAPSTONE SET · VERIFY ✓");
    expect(captionKey(scene.world)).not.toBe(before);
  });

  it("says when the newest landed integration stands as the monument", () => {
    const s = snapshot({
      now: NOW_ISO,
      integrations: [
        integration({ name: "old", lanes: ["x"], landedAt: "2026-10-18T10:00:00.000Z" }),
        integration({ name: "ui", lanes: ["a", "b", "c", "d", "e", "f", "g", "h"], landedAt: "2026-10-19T11:00:00.000Z" }),
      ],
    });
    expect(caption(s)).toBe("MONUMENT · UI · 8 BLOCKS · LANDED 11H AGO");
    expect(caption({ ...s, integrations: [integration({ name: "one", lanes: ["a"], landedAt: "2026-10-19T21:00:00.000Z" })] })).toBe(
      "MONUMENT · ONE · 1 BLOCK · LANDED 1H AGO",
    );
  });

  it("is quiet with nothing", () => {
    expect(caption(snapshot())).toBe("THE SITE IS QUIET");
  });
});
