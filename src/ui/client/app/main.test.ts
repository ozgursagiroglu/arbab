import { beforeEach, describe, expect, it } from "vitest";
import type { Canvas2D, ElementLike, EventLike, EventSourceLike, MessageEventLike, PageEnv, StyleLike } from "./browser";
import { lane, snapshot } from "./fixtures";
import { NO_TOKEN_MESSAGE, startPage } from "./main";
import { PAGE_IDS } from "./page";

type Listener = (event: EventLike) => void;

class FakeElement implements ElementLike {
  textContent: string | null = "";
  hidden = false;
  className = "";
  readonly style: StyleLike = { width: "", height: "", left: "", top: "" };
  readonly attributes = new Map<string, string>();
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  rect = { left: 0, top: 0, width: 0, height: 0 };
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly tag: string) {}

  // Text goes in through textContent only: anything else is a test failure.
  set innerHTML(_value: string) {
    throw new Error("innerHTML used");
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  appendChild(child: ElementLike): unknown {
    const c = child as FakeElement;
    c.remove();
    c.parent = this;
    this.children.push(c);
    return c;
  }
  replaceChildren(...children: ElementLike[]): void {
    for (const c of this.children) c.parent = null;
    this.children = [];
    for (const c of children) this.appendChild(c);
  }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  dispatch(type: string, event: Partial<EventLike> = {}): void {
    for (const l of this.listeners.get(type) ?? []) l({ type, ...event });
  }
  getBoundingClientRect() {
    return this.rect;
  }
  text(): string {
    return (this.textContent ?? "") + this.children.map((c) => c.text()).join(" ");
  }
}

class FakeCanvas extends FakeElement {
  width = 0;
  height = 0;
  rects = 0;
  readonly ctx: Canvas2D;
  constructor() {
    super("canvas");
    const self = this;
    this.ctx = {
      fillStyle: "#000000",
      globalAlpha: 1,
      imageSmoothingEnabled: true,
      fillRect() {
        self.rects++;
      },
      clearRect() {},
    };
  }
  getContext(): Canvas2D {
    return this.ctx;
  }
}

class FakeEventSource implements EventSourceLike {
  static last: FakeEventSource | null = null;
  closed = false;
  private readonly listeners = new Map<string, ((event: MessageEventLike) => void)[]>();
  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, listener: (event: MessageEventLike) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close(): void {
    this.closed = true;
  }
  emit(type: string, data = ""): void {
    for (const l of this.listeners.get(type) ?? []) l({ data });
  }
}

interface Page {
  env: PageEnv;
  el: (id: string) => FakeElement;
  canvas: FakeCanvas;
  frames: ((time: number) => void)[];
  doc: FakeElement;
  window: FakeElement & { innerWidth: number; innerHeight: number };
}

function page(hash = "#token=00112233445566778899aabbccddeeff"): Page {
  const els = new Map<string, FakeElement>();
  const canvas = new FakeCanvas();
  for (const id of Object.values(PAGE_IDS)) els.set(id, id === PAGE_IDS.canvas ? canvas : new FakeElement("div"));
  const stage = els.get(PAGE_IDS.stage);
  if (stage) stage.rect = { left: 0, top: 0, width: 1000, height: 600 };
  const top = els.get(PAGE_IDS.header);
  if (top) top.rect = { left: 0, top: 0, width: 1000, height: 50 };
  canvas.rect = { left: 0, top: 0, width: 960, height: 540 };
  const doc = new FakeElement("document");
  const win = Object.assign(new FakeElement("window"), { innerWidth: 1200, innerHeight: 900 });
  const frames: ((time: number) => void)[] = [];
  const env: PageEnv = {
    document: {
      getElementById: (id) => els.get(id) ?? null,
      createElement: (tag) => new FakeElement(tag),
      addEventListener: (type, listener) => doc.addEventListener(type, listener),
    },
    window: win,
    location: { hash },
    EventSource: FakeEventSource,
    AudioContext: null,
    storage: () => null,
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (callback) => frames.push(callback),
    devicePixelRatio: 1,
    now: () => Date.parse("2026-10-19T10:05:00.000Z"),
  };
  const el = (id: string): FakeElement => {
    const e = els.get(id);
    if (!e) throw new Error(`no #${id}`);
    return e;
  };
  return { env, el, canvas, frames, doc, window: win };
}

beforeEach(() => {
  FakeEventSource.last = null;
});

describe("startPage", () => {
  it("without a token, says where the URL is and stops", () => {
    const p = page("");
    expect(startPage(p.env)).toBeNull();
    expect(p.el(PAGE_IDS.notice).textContent).toBe(NO_TOKEN_MESSAGE);
    expect(p.el(PAGE_IDS.notice).hidden).toBe(false);
    expect(FakeEventSource.last).toBeNull();
    expect(p.frames).toHaveLength(0);
  });

  it("returns null when an element is missing", () => {
    const p = page();
    const env: PageEnv = { ...p.env, document: { ...p.env.document, getElementById: (id) => (id === PAGE_IDS.crew ? null : p.el(id)) } };
    expect(startPage(env)).toBeNull();
  });

  it("listens on the events route with the token", () => {
    const p = page("#token=deadbeefdeadbeef");
    const handle = startPage(p.env);
    expect(FakeEventSource.last?.url).toBe("/events?token=deadbeefdeadbeef");
    handle?.stop();
    expect(FakeEventSource.last?.closed).toBe(true);
  });

  it("puts a snapshot into the header, the crew list and the table", () => {
    const p = page();
    startPage(p.env);
    const s = snapshot({
      lanes: [
        lane({ name: "ui-art", costUsd: 1.5 }),
        lane({ name: "ui-scene", role: "verifier", state: "held", hold: "quota" }),
        lane({ name: "old", state: "finished", endState: "success", costUsd: 0.25 }),
      ],
      quota: { ...snapshot().quota, hold: { hold: true, reason: "quota", until: null } },
    });
    FakeEventSource.last?.emit("snapshot", JSON.stringify(s));
    expect(p.el(PAGE_IDS.title).textContent).toBe("demo · 0.2.0");
    expect(p.el(PAGE_IDS.counts).textContent).toBe("1 running · 1 waiting · ✓ 1");
    expect(p.el(PAGE_IDS.cost).textContent).toBe("$1.75");
    expect(p.el(PAGE_IDS.held).hidden).toBe(false);
    expect(p.el(PAGE_IDS.connection).textContent).toBe("live");
    const crew = p.el(PAGE_IDS.crew).children;
    expect(crew.map((li) => li.text())).toEqual([expect.stringContaining("ui-art"), expect.stringContaining("ui-scene")]);
    expect(crew[1]?.children[0]?.children[0]?.className).toBe("chip cast-mason");
    expect(p.el(PAGE_IDS.table).children).toHaveLength(3);
    expect(p.el(PAGE_IDS.table).children[2]?.text()).toContain("success");
  });

  it("keeps a crew button across snapshots and announces changes politely", () => {
    const p = page();
    startPage(p.env);
    const es = FakeEventSource.last;
    es?.emit("snapshot", JSON.stringify(snapshot({ lanes: [lane({ name: "a", state: "queued" })] })));
    const first = p.el(PAGE_IDS.crew).children[0];
    expect(p.el(PAGE_IDS.live).textContent).toBe("");
    es?.emit("snapshot", JSON.stringify(snapshot({ lanes: [lane({ name: "a", state: "running" })] })));
    expect(p.el(PAGE_IDS.crew).children[0]).toBe(first);
    expect(p.el(PAGE_IDS.live).textContent).toBe("a started");
    es?.emit("snapshot", JSON.stringify(snapshot({ lanes: [lane({ name: "a", state: "finished", endState: "failed" })] })));
    expect(p.el(PAGE_IDS.crew).children).toHaveLength(0);
    expect(p.el(PAGE_IDS.live).textContent).toBe("a finished: failed");
  });

  it("shows problems, other protocols and reconnects in the page", () => {
    const p = page();
    startPage(p.env);
    const es = FakeEventSource.last;
    es?.emit("problem", JSON.stringify({ message: "three snapshot builds failed" }));
    expect(p.el(PAGE_IDS.banner).hidden).toBe(false);
    expect(p.el(PAGE_IDS.banner).textContent).toBe("three snapshot builds failed");
    es?.emit("snapshot", JSON.stringify({ ...snapshot(), protocol: 9 }));
    expect(p.el(PAGE_IDS.banner).textContent).toMatch(/protocol 1 and the server speaks 9/);
    es?.emit("error");
    expect(p.el(PAGE_IDS.connection).textContent).toBe("reconnecting");
    es?.emit("snapshot", JSON.stringify(snapshot()));
    expect(p.el(PAGE_IDS.banner).hidden).toBe(true);
  });

  it("draws every animation frame and asks for the next", () => {
    const p = page();
    startPage(p.env);
    expect(p.frames).toHaveLength(1);
    p.frames[0]?.(16);
    expect(p.canvas.rects).toBeGreaterThan(100);
    expect(p.canvas.width).toBe(480);
    expect(p.canvas.height).toBe(270);
    expect(p.frames).toHaveLength(2);
  });

  it("scales the canvas by the largest integer that fits, on resize too", () => {
    const p = page();
    startPage(p.env);
    expect(p.canvas.style.width).toBe("960px");
    expect(p.canvas.style.height).toBe("540px");
    p.el(PAGE_IDS.stage).rect = { left: 0, top: 0, width: 400, height: 300 };
    p.window.dispatch("resize");
    expect(p.canvas.style.width).toBe("480px");
  });

  it("toggles sound with aria-pressed", () => {
    const p = page();
    startPage(p.env);
    const button = p.el(PAGE_IDS.sound);
    expect(button.attributes.get("aria-pressed")).toBe("false");
    button.dispatch("click");
    expect(button.attributes.get("aria-pressed")).toBe("true");
  });

  it("shows a crew lane's tooltip on focus, pins it on Enter and unpins on Escape", () => {
    const p = page();
    startPage(p.env);
    FakeEventSource.last?.emit("snapshot", JSON.stringify(snapshot({ lanes: [lane({ name: "ui-art", toolCalls: 9 })] })));
    const button = p.el(PAGE_IDS.crew).children[0]?.children[0];
    if (!button) throw new Error("no crew button");
    const tooltip = p.el(PAGE_IDS.tooltip);
    button.dispatch("focus");
    expect(tooltip.hidden).toBe(false);
    expect(tooltip.text()).toContain("tool calls 9");
    button.dispatch("click");
    expect(button.attributes.get("aria-pressed")).toBe("true");
    button.dispatch("blur");
    expect(tooltip.hidden).toBe(false);
    p.doc.dispatch("keydown", { key: "Escape" });
    expect(button.attributes.get("aria-pressed")).toBe("false");
    expect(tooltip.hidden).toBe(true);
  });

  it("hides the tooltip when the pointer finds no lane", () => {
    const p = page();
    startPage(p.env);
    p.canvas.dispatch("pointermove", { clientX: 10, clientY: 10 });
    expect(p.el(PAGE_IDS.tooltip).hidden).toBe(true);
    p.canvas.dispatch("pointerleave");
    expect(p.el(PAGE_IDS.tooltip).hidden).toBe(true);
  });
});
