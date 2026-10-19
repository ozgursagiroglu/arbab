import { describe, expect, it } from "vitest";
import { LINE_HEIGHT, measureText } from "../font";
import type { FakeCanvas, FakeElement } from "./fake-dom";
import { fakeDocument } from "./fake-dom";
import { createPixelText, pixelTextSize } from "./pixel-text";

describe("pixelTextSize", () => {
  it("is measureText × scale × dpr by LINE_HEIGHT × scale × dpr, in CSS px without the dpr", () => {
    const w = measureText("ARBAB");
    expect(pixelTextSize("ARBAB", 3, 1)).toEqual({ width: w * 3, height: LINE_HEIGHT * 3, cssWidth: w * 3, cssHeight: LINE_HEIGHT * 3 });
    expect(pixelTextSize("ARBAB", 3, 2)).toEqual({ width: w * 6, height: LINE_HEIGHT * 6, cssWidth: w * 3, cssHeight: LINE_HEIGHT * 3 });
    expect(pixelTextSize("", 2, 2).width).toBe(0);
  });
});

describe("createPixelText", () => {
  it("draws into an aria-hidden, pixelated canvas, with the same text in a visually-hidden span", () => {
    const text = createPixelText(fakeDocument(), { scale: 2, color: "#ffd54a", dpr: 2 }, "CREW");
    const el = text.el as FakeElement;
    const [canvas, hidden] = el.children as [FakeCanvas, FakeElement];
    expect(el.className).toBe("pxt");
    expect(canvas.attributes.get("aria-hidden")).toBe("true");
    expect(canvas.className).toBe("px");
    expect(hidden.className).toBe("visually-hidden");
    expect(hidden.textContent).toBe("CREW");
    expect(canvas.width).toBe(measureText("CREW") * 4);
    expect(canvas.height).toBe(LINE_HEIGHT * 4);
    expect(canvas.style.width).toBe(`${measureText("CREW") * 2}px`);
    expect(canvas.style.height).toBe(`${LINE_HEIGHT * 2}px`);
    // Font pixels are 4 × 4 device pixels, a leading row down, in the color.
    expect(canvas.fills.length).toBeGreaterThan(0);
    expect(canvas.fills.every((f) => f.color === "#ffd54a" && f.h === 4 && f.y >= 4)).toBe(true);
    expect(text.text()).toBe("CREW");
  });

  it("redraws only when the text, the color or the scale changes", () => {
    const text = createPixelText(fakeDocument(), { scale: 1, color: "#ffffff", dpr: 1, className: "badge" });
    const canvas = (text.el as FakeElement).children[0] as FakeCanvas;
    expect((text.el as FakeElement).className).toBe("pxt badge");
    text.set("12");
    const clears = canvas.clears;
    text.set("12");
    text.set("12", "#ffffff", 1);
    expect(canvas.clears).toBe(clears);
    text.set("13");
    expect(canvas.clears).toBe(clears + 1);
    text.set("13", "#000000");
    expect(canvas.fills.every((f) => f.color === "#000000")).toBe(true);
    text.set("13", "#000000", 4);
    expect(canvas.style.height).toBe(`${LINE_HEIGHT * 4}px`);
    expect(canvas.clears).toBe(clears + 3);
  });

  it("shows the text as text where there is no canvas", () => {
    const doc = fakeDocument();
    const plain = { ...doc, createElement: (tag: string) => doc.createElement(tag === "canvas" ? "div" : tag) };
    const text = createPixelText(plain, { scale: 1, color: "#fff", dpr: 1 }, "LIVE");
    expect(text.canvas).toBeNull();
    const [span] = (text.el as FakeElement).children;
    expect(span?.textContent).toBe("LIVE");
    expect(span?.className).toBe("");
  });
});
