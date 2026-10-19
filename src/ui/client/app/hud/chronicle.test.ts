import { describe, expect, it } from "vitest";
import { integration, lane, snapshot } from "../fixtures";
import type { ChronicleEntry } from "./chronicle";
import { CHRONICLE_MAX, chronicleDiff, formatAgo, glyphOf, mergeChronicle, seedChronicle } from "./chronicle";
import { mountChronicle } from "./chronicle-panel";
import type { FakeElement } from "./fake-dom";
import { fakeDocument } from "./fake-dom";

const at = (iso: string): number => Date.parse(iso);

describe("formatAgo", () => {
  it("says how long ago, coarsely", () => {
    expect(formatAgo(0)).toBe("just now");
    expect(formatAgo(-5000)).toBe("just now");
    expect(formatAgo(59_000)).toBe("just now");
    expect(formatAgo(2 * 60_000 + 5000)).toBe("2m ago");
    expect(formatAgo(11 * 3_600_000 + 60_000)).toBe("11h ago");
    expect(formatAgo(3 * 86_400_000)).toBe("3d ago");
  });
});

describe("seedChronicle", () => {
  it("tells the first snapshot as it stands, newest first", () => {
    const s = snapshot({
      lanes: [
        lane({ name: "run", state: "running", since: "2026-10-19T10:01:00.000Z" }),
        lane({ name: "q", state: "queued", since: "2026-10-19T10:02:00.000Z" }),
        lane({ name: "h", state: "held", hold: "quota", since: "2026-10-19T10:03:00.000Z" }),
        lane({ name: "z", state: "waiting-reset", since: "2026-10-19T09:00:00.000Z" }),
        lane({ name: "ok", state: "finished", endState: "success", costUsd: 1.2, since: "2026-10-19T09:30:00.000Z" }),
        lane({ name: "bad", state: "finished", endState: "killed:wall", since: "2026-10-19T09:20:00.000Z" }),
        lane({ name: "ghost", state: "orphaned" }),
      ],
      integrations: [integration({ name: "ui", landedAt: "2026-10-19T08:00:00.000Z" }), integration({ name: "open" })],
    });
    const seeded = seedChronicle(s);
    expect(seeded.map((e) => [e.kind, e.text])).toEqual([
      ["held", "h held for the quota"],
      ["waiting", "q queued"],
      ["started", "run started"],
      ["finished", "ok finished: success · $1.20"],
      ["failed", "bad finished: killed:wall"],
      ["waiting", "z asleep until the quota resets"],
      ["landed", "ui landed"],
    ]);
    expect(seeded[0]?.at).toBe(at("2026-10-19T10:03:00.000Z"));
    expect(seeded.at(-1)?.at).toBe(at("2026-10-19T08:00:00.000Z"));
  });

  it("falls back to the snapshot's time for a bad since", () => {
    const [entry] = seedChronicle(snapshot({ lanes: [lane({ name: "a", since: "garbage" })] }));
    expect(entry?.at).toBe(at(snapshot().now));
  });
});

describe("chronicleDiff", () => {
  it("adds starts, finishes, quota holds, landings and verify results", () => {
    const prev = snapshot({
      lanes: [lane({ name: "a", state: "queued" }), lane({ name: "b", state: "running" }), lane({ name: "c", state: "waiting-reset" }), lane({ name: "h", state: "queued" })],
      integrations: [integration({ name: "i1" }), integration({ name: "i2", verify: "failed" })],
    });
    const next = snapshot({
      now: "2026-10-19T10:06:00.000Z",
      lanes: [
        lane({ name: "a", state: "running", attempt: 2, since: "2026-10-19T10:05:30.000Z" }),
        lane({ name: "b", state: "finished", endState: "success", costUsd: 0.75, since: "2026-10-19T10:05:40.000Z" }),
        lane({ name: "c", state: "running" }),
        lane({ name: "h", state: "held", hold: "quota", since: "2026-10-19T10:05:50.000Z" }),
      ],
      integrations: [integration({ name: "i1", landedAt: "2026-10-19T10:05:55.000Z", verify: "passed" }), integration({ name: "i2", verify: "failed" })],
    });
    expect(chronicleDiff(prev, next).map((e) => [e.kind, e.text])).toEqual([
      ["started", "a started (attempt 2)"],
      ["finished", "b finished: success · $0.75"],
      ["held", "h held for the quota"],
      ["landed", "i1 landed"],
      ["verify-passed", "i1 verify passed"],
    ]);
    expect(chronicleDiff(next, next)).toEqual([]);
  });

  it("tells a new head's verify again", () => {
    const prev = snapshot({ integrations: [integration({ name: "i", verify: "failed", headSha: "a".repeat(40) })] });
    const next = snapshot({ integrations: [integration({ name: "i", verify: "failed", headSha: "b".repeat(40) })] });
    expect(chronicleDiff(prev, next).map((e) => e.kind)).toEqual(["verify-failed"]);
  });
});

describe("mergeChronicle", () => {
  const entry = (id: string, t: number): ChronicleEntry => ({ id, at: t, kind: "started", text: id });

  it("keeps each id once, newest first, at most 60", () => {
    const merged = mergeChronicle([entry("a", 1), entry("b", 3)], [entry("c", 2), entry("a", 9)]);
    expect(merged.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(merged[0]?.at).toBe(9);
    const many = Array.from({ length: 80 }, (_, i) => entry(`e${i}`, i));
    const capped = mergeChronicle([], many);
    expect(capped).toHaveLength(CHRONICLE_MAX);
    expect(capped[0]?.id).toBe("e79");
  });
});

describe("glyphOf", () => {
  it("is an arrow, a check, a cross, a diamond or an hourglass", () => {
    expect(["started", "finished", "failed", "landed", "verify-passed", "verify-failed", "held", "waiting"].map((k) => glyphOf(k as ChronicleEntry["kind"]))).toEqual([
      "→",
      "✓",
      "✗",
      "◆",
      "✓",
      "✗",
      "⏳",
      "⏳",
    ]);
  });
});

describe("mountChronicle", () => {
  it("draws the lines keyed, slides in only the later ones, and refreshes the times", () => {
    const doc = fakeDocument();
    const title = doc.createElement("h2") as FakeElement;
    const list = doc.createElement("ol") as FakeElement;
    const empty = doc.createElement("p") as FakeElement;
    const panel = mountChronicle(doc, { title, list, empty }, 1);
    expect(title.text()).toBe("CHRONICLE");
    const t0 = at("2026-10-19T10:00:00.000Z");
    const first: ChronicleEntry = { id: "x", at: t0, kind: "landed", text: "ui landed" };
    panel.update([first], t0 + 120_000);
    expect(empty.hidden).toBe(true);
    const line = list.children[0];
    expect(line?.className).toBe("chronicle-line kind-landed");
    expect(line?.text()).toBe("landed: ui landed 2m ago");
    expect(line?.find("ago")[0]?.attributes.get("datetime")).toBe("2026-10-19T10:00:00.000Z");
    const second: ChronicleEntry = { id: "y", at: t0 + 60_000, kind: "started", text: "a started" };
    panel.update([second, first], t0 + 120_000);
    expect(list.children.map((li) => li.className)).toEqual(["chronicle-line kind-started enter", "chronicle-line kind-landed"]);
    expect(list.children[1]).toBe(line);
    expect(list.children[0]?.text()).toBe("→ a started 1m ago");
    panel.refresh(t0 + 3_600_000);
    expect(line?.find("ago")[0]?.textContent).toBe("1h ago");
    panel.update([], t0);
    expect(list.children).toHaveLength(0);
    expect(empty.hidden).toBe(false);
  });
});
