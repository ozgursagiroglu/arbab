import { describe, expect, it } from "vitest";
import { fillFor } from "../../scene/scene";
import { lane, snapshot } from "../fixtures";
import { createSpriteSet } from "../sprites";
import { AVATAR, avatarPose, blockFill, createAvatar, crewOrder, crewTitle, drawSprite, mountCrew, recentlyFinished } from "./crew";
import type { FakeElement } from "./fake-dom";
import { FakeCanvas, fakeDocument } from "./fake-dom";

const sprites = createSpriteSet();

describe("crewOrder", () => {
  it("lists lanes not finished: running, preparing, waiting-reset, held, queued, orphaned, then by name", () => {
    const lanes = [
      lane({ name: "q", state: "queued" }),
      lane({ name: "o", state: "orphaned" }),
      lane({ name: "r2", state: "running" }),
      lane({ name: "f", state: "finished", endState: "success" }),
      lane({ name: "h", state: "held", hold: "slot" }),
      lane({ name: "w", state: "waiting-reset" }),
      lane({ name: "p", state: "preparing" }),
      lane({ name: "r1", state: "running" }),
    ];
    expect(crewOrder(lanes).map((l) => l.name)).toEqual(["r1", "r2", "p", "w", "h", "q", "o"]);
  });
});

describe("recentlyFinished", () => {
  it("is the last six finished lanes, newest first", () => {
    const lanes = Array.from({ length: 8 }, (_, i) =>
      lane({ name: `l${i}`, state: "finished", endState: "success", since: `2026-10-19T10:0${i}:00.000Z` }),
    );
    expect(recentlyFinished([...lanes, lane({ name: "live" })]).map((l) => l.name)).toEqual(["l7", "l6", "l5", "l4", "l3", "l2"]);
  });
});

describe("avatarPose", () => {
  it("works while running, sits while held or queued, sleeps while waiting-reset, is a ghost when orphaned", () => {
    expect(avatarPose({ state: "running" })).toEqual({ pose: "work", ghost: false });
    expect(avatarPose({ state: "held" })).toEqual({ pose: "sit", ghost: false });
    expect(avatarPose({ state: "queued" })).toEqual({ pose: "sit", ghost: false });
    expect(avatarPose({ state: "waiting-reset" })).toEqual({ pose: "sleep", ghost: false });
    expect(avatarPose({ state: "orphaned" })).toEqual({ pose: "idle", ghost: true });
    expect(avatarPose({ state: "preparing" })).toEqual({ pose: "idle", ghost: false });
    expect(avatarPose({ state: "finished" })).toEqual({ pose: "idle", ghost: false });
  });
});

describe("blockFill and crewTitle", () => {
  it("is the scene's fill for the calls, and full for a set block", () => {
    expect(blockFill(lane({ name: "a", toolCalls: 93 }))).toBe(fillFor(93));
    expect(blockFill(lane({ name: "a", state: "finished", endState: "success", toolCalls: 3 }))).toBe(1);
    expect(blockFill(lane({ name: "a", state: "finished", endState: "success", reportStatus: "partial", toolCalls: 3 }))).toBe(fillFor(3));
    expect(blockFill(lane({ name: "a", state: "finished", endState: "failed", toolCalls: 3 }))).toBe(fillFor(3));
  });

  it("counts the lanes at work", () => {
    expect(crewTitle([lane({ name: "a" }), lane({ name: "b", state: "preparing" }), lane({ name: "c", state: "queued" })])).toBe("CREW · 2 AT WORK");
    expect(crewTitle([])).toBe("CREW · 0 AT WORK");
  });
});

describe("drawSprite and createAvatar", () => {
  it("draws a worker at 3× standing on the bottom edge, centered", () => {
    const sprite = sprites.frames("laborer", "work", 0, false)[0];
    if (!sprite) throw new Error("no sprite");
    const canvas = new FakeCanvas();
    expect(drawSprite(canvas, sprite, AVATAR.w, AVATAR.h, AVATAR.scale, 1)).toBe(3);
    expect(canvas.fills).toHaveLength(sprite.runs.length);
    expect(canvas.fills.every((f) => f.h === 3)).toBe(true);
    const bottom = Math.max(...canvas.fills.map((f) => f.y + f.h));
    expect(bottom).toBe(AVATAR.h);
  });

  it("scales a wide sprite down by whole steps to fit", () => {
    const sleep = sprites.frames("laborer", "sleep", 0, false)[0];
    if (!sleep) throw new Error("no sprite");
    expect(drawSprite(new FakeCanvas(), sleep, AVATAR.w, AVATAR.h, AVATAR.scale, 2)).toBe(2);
  });

  it("tints the tile with the cast and redraws only when the look changes", () => {
    const avatar = createAvatar(fakeDocument(), sprites, 1);
    const tile = avatar.el as FakeElement;
    const canvas = tile.children[0] as FakeCanvas;
    expect([canvas.width, canvas.height]).toEqual([36, 54]);
    avatar.set("mason", "sit", false);
    expect(tile.className).toBe("tile cast-mason");
    const clears = canvas.clears;
    avatar.set("mason", "sit", false);
    expect(canvas.clears).toBe(clears);
    avatar.set("mason", "idle", true);
    expect(tile.className).toBe("tile cast-mason ghost");
    expect(canvas.clears).toBe(clears + 1);
  });
});

function crewPage() {
  const doc = fakeDocument();
  const el = (): FakeElement => doc.createElement("div") as FakeElement;
  const els = { title: el(), list: el(), empty: el(), recentGroup: el(), recentTitle: el(), recent: el() };
  const calls: string[] = [];
  const panel = mountCrew(doc, els, sprites, 1, {
    enter: (n) => calls.push(`enter ${n}`),
    leave: (n) => calls.push(`leave ${n}`),
    toggle: (n) => calls.push(`toggle ${n}`),
  });
  return { els, panel, calls };
}

describe("mountCrew", () => {
  it("shows the sleeping worker and what to run when the site is quiet", () => {
    const { els, panel } = crewPage();
    panel.update(snapshot(), 0);
    expect(els.empty.hidden).toBe(false);
    expect(els.empty.text()).toContain("The site is quiet.");
    expect(els.empty.text()).toContain("arbab launch");
    expect(els.empty.text()).toContain("arbab plan next");
    expect(els.empty.find("tile")[0]?.className).toBe("tile cast-laborer");
    expect(els.recentGroup.hidden).toBe(true);
    expect(els.title.text()).toBe("CREW · 0 AT WORK");
  });

  it("fills a card: avatar, name, role · kind, badge, elapsed, progress with calls, last tool · cost", () => {
    const { els, panel } = crewPage();
    const now = Date.parse("2026-10-19T10:12:03.000Z");
    panel.update(snapshot({ lanes: [lane({ name: "ui-art", toolCalls: 93, lastTool: "Edit", costUsd: 1.5 })] }), now);
    const card = els.list.children[0];
    if (!card) throw new Error("no card");
    expect(card.find("name")[0]?.textContent).toBe("ui-art");
    expect(card.find("meta")[0]?.textContent).toBe("implementer · lane");
    expect(card.find("badge")[0]?.text()).toBe("RUNNING");
    expect(card.find("badge")[0]?.className).toBe("pxt badge tone-running");
    expect(card.find("elapsed")[0]?.textContent).toBe("12m03s");
    expect(card.find("calls")[0]?.textContent).toBe("93 calls");
    expect(card.find("bar-fill")[0]?.style.width).toBe(`${Math.round(fillFor(93) * 100)}%`);
    expect(card.find("stats")[0]?.textContent).toBe("Edit · $1.50");
    expect(card.find("tile")[0]?.className).toBe("tile cast-laborer");
    // The elapsed time counts on.
    panel.tick(now + 2000);
    expect(card.find("elapsed")[0]?.textContent).toBe("12m05s");
  });

  it("wires focus, hover and click to the handlers, and shows the pin with aria-pressed", () => {
    const { els, panel, calls } = crewPage();
    panel.update(snapshot({ lanes: [lane({ name: "a" })] }), 0);
    const button = panel.button("a") as FakeElement;
    for (const type of ["focus", "mouseenter", "blur", "mouseleave", "click"]) button.dispatch(type);
    expect(calls).toEqual(["enter a", "enter a", "leave a", "leave a", "toggle a"]);
    panel.setPinned("a");
    expect(button.attributes.get("aria-pressed")).toBe("true");
    expect(els.list.children[0]?.children[0]).toBe(button);
  });

  it("folds the last finished lanes into their group", () => {
    const { els, panel } = crewPage();
    panel.update(snapshot({ lanes: [lane({ name: "ok", state: "finished", endState: "success", costUsd: 0.4, elapsedMs: 61_000 }), lane({ name: "bad", state: "finished", endState: "failed" })] }), 0);
    expect(els.recentGroup.hidden).toBe(false);
    expect(els.recentTitle.text()).toBe("RECENTLY FINISHED");
    const items = els.recent.children.map((li) => li.text());
    expect(items).toContain("ok ✓ DONE $0.40 1m01s");
    expect(items).toContain("bad ✗ FAILED — —");
  });
});
