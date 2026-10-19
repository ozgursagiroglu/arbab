// Test-only: a fake DOM for the page's tests. It records what the page does (moves, fills) so the tests can check it.
import type { Canvas2D, CanvasElementLike, DocumentLike, ElementLike, EventLike, StyleLike } from "../browser";

type Listener = (event: EventLike) => void;

export class FakeElement implements ElementLike {
  textContent: string | null = "";
  hidden = false;
  className = "";
  readonly style: StyleLike = { width: "", height: "", left: "", top: "" };
  readonly attributes = new Map<string, string>();
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  rect = { left: 0, top: 0, width: 0, height: 0 };
  /** How many times this element was put into a parent (a move in a real DOM drops its focus). */
  insertions = 0;
  requestFullscreen?: () => unknown;
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
    return this.insertBefore(child, null);
  }
  insertBefore(child: ElementLike, ref: ElementLike | null): unknown {
    const c = child as unknown as FakeElement;
    if (c === ref) return c;
    c.remove();
    c.parent = this;
    c.insertions++;
    const i = ref === null ? -1 : this.children.indexOf(ref as unknown as FakeElement);
    if (i < 0) this.children.push(c);
    else this.children.splice(i, 0, c);
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
  /** Every text below this element, space-separated. */
  text(): string {
    return [this.textContent ?? "", ...this.children.map((c) => c.text())].filter((t) => t !== "").join(" ");
  }
  /** Depth-first, the elements with this class. */
  find(className: string): FakeElement[] {
    const out: FakeElement[] = [];
    const visit = (el: FakeElement): void => {
      if (el.className.split(" ").includes(className)) out.push(el);
      el.children.forEach(visit);
    };
    this.children.forEach(visit);
    return out;
  }
}

export interface Fill {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export class FakeCanvas extends FakeElement implements CanvasElementLike {
  width = 0;
  height = 0;
  fills: Fill[] = [];
  clears = 0;
  readonly ctx: Canvas2D;
  constructor() {
    super("canvas");
    const self = this;
    this.ctx = {
      fillStyle: "#000000",
      globalAlpha: 1,
      imageSmoothingEnabled: true,
      fillRect(x, y, w, h) {
        self.fills.push({ x, y, w, h, color: this.fillStyle });
      },
      clearRect() {
        self.clears++;
        self.fills = [];
      },
    };
  }
  getContext(): Canvas2D {
    return this.ctx;
  }
}

export interface FakeDocument extends DocumentLike {
  fullscreenElement: ElementLike | null;
  exitFullscreen: () => unknown;
  root: FakeElement;
  byId: Map<string, FakeElement>;
}

/** A document whose createElement makes fakes (canvases for "canvas"), with `ids` registered by getElementById. */
export function fakeDocument(ids: readonly string[] = [], canvasIds: readonly string[] = []): FakeDocument {
  const root = new FakeElement("document");
  const byId = new Map<string, FakeElement>();
  for (const id of ids) byId.set(id, canvasIds.includes(id) ? new FakeCanvas() : new FakeElement("div"));
  const doc: FakeDocument = {
    root,
    byId,
    fullscreenElement: null,
    exitFullscreen: () => {
      doc.fullscreenElement = null;
    },
    getElementById: (id) => byId.get(id) ?? null,
    createElement: (tag) => (tag === "canvas" ? new FakeCanvas() : new FakeElement(tag)),
    addEventListener: (type, listener) => root.addEventListener(type, listener),
  };
  return doc;
}
