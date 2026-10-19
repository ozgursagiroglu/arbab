import { describe, expect, it } from "vitest";
import { devicePixels, make, makeCanvas, planMoves, reorder } from "./dom";
import type { FakeCanvas, FakeElement } from "./fake-dom";
import { fakeDocument } from "./fake-dom";

function apply(current: string[], moves: { key: string; before: string | null }[]): string[] {
  let order = [...current];
  for (const { key, before } of moves) {
    order = order.filter((k) => k !== key);
    const i = before === null ? -1 : order.indexOf(before);
    if (i < 0) order.push(key);
    else order.splice(i, 0, key);
  }
  return order;
}

/** A seeded shuffle, so a failure can be replayed. */
function shuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

describe("devicePixels", () => {
  it("is the device pixel ratio rounded, at least 1", () => {
    expect(devicePixels(1)).toBe(1);
    expect(devicePixels(1.25)).toBe(1);
    expect(devicePixels(1.5)).toBe(2);
    expect(devicePixels(3)).toBe(3);
    expect(devicePixels(0)).toBe(1);
    expect(devicePixels(Number.NaN)).toBe(1);
  });
});

describe("make and makeCanvas", () => {
  it("make sets the class and the text", () => {
    const doc = fakeDocument();
    const el = make(doc, "span", "name", "a") as FakeElement;
    expect([el.tag, el.className, el.textContent]).toEqual(["span", "name", "a"]);
  });

  it("makeCanvas sizes the backing store in device pixels and hides it", () => {
    const canvas = makeCanvas(fakeDocument(), 36, 54, 2) as FakeCanvas;
    expect([canvas.width, canvas.height, canvas.style.width, canvas.style.height]).toEqual([72, 108, "36px", "54px"]);
    expect(canvas.attributes.get("aria-hidden")).toBe("true");
    expect(canvas.className).toBe("px");
  });

  it("makeCanvas is null without a canvas", () => {
    const doc = { ...fakeDocument(), createElement: () => make(fakeDocument(), "div") };
    expect(makeCanvas(doc, 1, 1, 1)).toBeNull();
  });
});

describe("planMoves", () => {
  it("leaves an order alone", () => {
    expect(planMoves(["a", "b", "c"], ["a", "b", "c"])).toEqual([]);
  });

  it("moves only what is out of order", () => {
    expect(planMoves(["a", "b", "c", "d"], ["a", "c", "d", "b"])).toEqual([{ key: "b", before: null }]);
    expect(planMoves(["a", "b"], ["a", "x", "b"])).toEqual([{ key: "x", before: "b" }]);
  });

  it("never moves the kept item, even when moving it would be fewer moves", () => {
    expect(planMoves(["a", "b", "c"], ["b", "c", "a"])).toEqual([{ key: "a", before: null }]);
    const moves = planMoves(["a", "b", "c"], ["b", "c", "a"], "a");
    expect(moves.map((m) => m.key)).not.toContain("a");
    expect(apply(["a", "b", "c"], moves)).toEqual(["b", "c", "a"]);
  });

  it("reaches every target order, with any kept item", () => {
    const keys = ["a", "b", "c", "d", "e", "f", "g"];
    for (let seed = 1; seed <= 200; seed++) {
      const current = shuffle(keys, seed).slice(0, 5);
      const next = shuffle(keys, seed * 7 + 3).slice(0, 5);
      const keep = current.find((k) => next.includes(k)) ?? null;
      const left = current.filter((k) => next.includes(k));
      const moves = planMoves(left, next, keep);
      expect(apply(left, moves), `seed ${seed}`).toEqual(next);
      if (keep !== null) expect(moves.map((m) => m.key)).not.toContain(keep);
      expect(apply(left, planMoves(left, next))).toEqual(next);
    }
  });
});

describe("reorder", () => {
  it("removes what left and inserts before the right sibling, so the focused element stays put", () => {
    const doc = fakeDocument();
    const parent = make(doc, "ul") as FakeElement;
    const els = new Map<string, FakeElement>();
    const of = (k: string): FakeElement => {
      let el = els.get(k);
      if (!el) {
        el = make(doc, "li", "", k) as FakeElement;
        els.set(k, el);
      }
      return el;
    };
    let order = reorder(parent, [], ["a", "b", "c"], of);
    expect(parent.children.map((c) => c.textContent)).toEqual(["a", "b", "c"]);
    const b = of("b");
    const before = b.insertions;
    order = reorder(parent, order, ["c", "b", "x"], of, "b");
    expect(parent.children.map((c) => c.textContent)).toEqual(["c", "b", "x"]);
    expect(of("a").parent).toBeNull();
    expect(b.insertions).toBe(before);
    expect(order).toEqual(["c", "b", "x"]);
  });
});
