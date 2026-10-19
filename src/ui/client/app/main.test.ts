import { beforeEach, describe, expect, it } from "vitest";
import type { EventSourceLike, FetchLike, MessageEventLike, PageEnv } from "./browser";
import { integration, lane, snapshot } from "./fixtures";
import type { FakeCanvas, FakeDocument, FakeElement } from "./hud/fake-dom";
import { fakeDocument } from "./hud/fake-dom";
import { CLOSED_MESSAGE, NO_TOKEN_MESSAGE, NOT_RUNNING_MESSAGE, startPage, TOO_MANY_MESSAGE } from "./main";
import { PAGE_IDS } from "./page";

class FakeEventSource implements EventSourceLike {
  static last: FakeEventSource | null = null;
  closed = false;
  readyState = 0;
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
  doc: FakeDocument;
  window: FakeElement & { innerWidth: number; innerHeight: number };
  fetched: string[];
  clock: { now: number };
}

const CANVAS_IDS = [PAGE_IDS.canvas, PAGE_IDS.logo, PAGE_IDS.titleCardLogo];

function page(hash = "#token=00112233445566778899aabbccddeeff", fetch: FetchLike | null = null): Page {
  const doc = fakeDocument(Object.values(PAGE_IDS), CANVAS_IDS);
  const el = (id: string): FakeElement => {
    const e = doc.byId.get(id);
    if (!e) throw new Error(`no #${id}`);
    return e;
  };
  const canvas = el(PAGE_IDS.canvas) as FakeCanvas;
  el(PAGE_IDS.stage).rect = { left: 0, top: 0, width: 1000, height: 600 };
  el(PAGE_IDS.header).rect = { left: 0, top: 0, width: 1000, height: 50 };
  canvas.rect = { left: 0, top: 0, width: 960, height: 540 };
  const win = Object.assign(fakeDocument().root, { innerWidth: 1200, innerHeight: 900 });
  const frames: ((time: number) => void)[] = [];
  const fetched: string[] = [];
  const clock = { now: Date.parse("2026-10-19T10:05:00.000Z") };
  const env: PageEnv = {
    document: doc,
    window: win,
    location: { hash },
    EventSource: FakeEventSource,
    fetch: fetch
      ? (url) => {
          fetched.push(url);
          return fetch(url);
        }
      : null,
    AudioContext: null,
    storage: () => null,
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (callback) => frames.push(callback),
    devicePixelRatio: 1,
    now: () => clock.now,
  };
  return { env, el, canvas, frames, doc, window: win, fetched, clock };
}

function emit(s: unknown): void {
  FakeEventSource.last?.emit("snapshot", JSON.stringify(s));
}

/** Lets settled promises run their callbacks. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  FakeEventSource.last = null;
});

describe("startPage", () => {
  it("without a token, says where the URL is and stops", () => {
    const p = page("");
    expect(startPage(p.env)).toBeNull();
    expect(p.el(PAGE_IDS.notice).textContent).toBe(NO_TOKEN_MESSAGE);
    expect(p.el(PAGE_IDS.notice).hidden).toBe(false);
    expect(p.el(PAGE_IDS.connection).text()).toBe("OFFLINE");
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

  it("draws the logo, the wordmark and the titles in pixels, with their text beside them", () => {
    const p = page();
    startPage(p.env);
    expect((p.el(PAGE_IDS.logo) as FakeCanvas).fills.length).toBeGreaterThan(10);
    expect(p.el(PAGE_IDS.logo).style.width).toBe("32px");
    expect(p.el(PAGE_IDS.title).text()).toBe("ARBAB");
    expect(p.el(PAGE_IDS.siteTitle).text()).toBe("THE SITE");
    expect(p.el(PAGE_IDS.crewTitle).text()).toBe("CREW");
    expect(p.el(PAGE_IDS.ledgerTitle).text()).toBe("LEDGER");
    expect(p.el(PAGE_IDS.kpis).children).toHaveLength(5);
    expect(p.el(PAGE_IDS.connection).text()).toBe("CONNECTING");
  });

  it("puts a snapshot into the top bar, the KPIs, the crew, the ledger, the monument and the chronicle", () => {
    const p = page();
    startPage(p.env);
    const s = snapshot({
      lanes: [
        lane({ name: "ui-art", costUsd: 1.5, toolCalls: 40 }),
        lane({ name: "ui-scene", role: "verifier", state: "held", hold: "quota" }),
        lane({ name: "old", state: "finished", endState: "success", costUsd: 0.25, since: "2026-10-19T09:00:00.000Z" }),
      ],
      integrations: [integration({ name: "int-1", lanes: ["old"], verify: "passed", headSha: "abcdef0123456789" })],
      quota: { ...snapshot().quota, hold: { hold: true, reason: "quota", until: null } },
      hiddenLanes: 2,
    });
    emit(s);
    expect(p.el(PAGE_IDS.project).textContent).toBe("demo");
    expect(p.el(PAGE_IDS.version).textContent).toBe("v0.2.0");
    expect(p.el(PAGE_IDS.held).hidden).toBe(false);
    expect(p.el(PAGE_IDS.connection).text()).toBe("LIVE");
    expect(p.el(PAGE_IDS.connection).attributes.get("data-state")).toBe("live");
    expect(p.el(PAGE_IDS.footer).textContent).toBe("Read-only · arbab 0.2.0 · 2 older lanes not shown");
    expect(p.el(PAGE_IDS.titleCard).className).toBe("title-card gone");
    // The crew: lanes at work, running before held.
    const crew = p.el(PAGE_IDS.crew).children;
    expect(crew.map((li) => li.find("name")[0]?.textContent)).toEqual(["ui-art", "ui-scene"]);
    expect(crew[1]?.find("tile")[0]?.className).toBe("tile cast-mason");
    expect(p.el(PAGE_IDS.crewTitle).text()).toBe("CREW · 1 AT WORK");
    expect(p.el(PAGE_IDS.crewEmpty).hidden).toBe(true);
    expect(p.el(PAGE_IDS.recentGroup).hidden).toBe(false);
    expect(p.el(PAGE_IDS.recent).children).toHaveLength(1);
    // The ledger has every lane.
    expect(p.el(PAGE_IDS.table).children).toHaveLength(3);
    expect(p.el(PAGE_IDS.table).text()).toContain("✓ DONE");
    expect(p.el(PAGE_IDS.monument).text()).toContain("int-1 abcdef0");
    expect(p.el(PAGE_IDS.chronicle).children).toHaveLength(3);
    expect(p.el(PAGE_IDS.chronicle).text()).toContain("old finished: success · $0.25");
    expect(p.el(PAGE_IDS.chronicleEmpty).hidden).toBe(true);
    expect(p.el(PAGE_IDS.caption).text()).toBe("INT-1 · 1/3 BLOCKS SET · CAPSTONE WAITING · VERIFY ✓");
    expect(p.el(PAGE_IDS.gauge5h).text()).toBe("5H —");
  });

  it("counts the KPI numbers up over 0.6 s", () => {
    const p = page();
    startPage(p.env);
    emit(snapshot({ lanes: ["a", "b", "c", "d"].map((name) => lane({ name })) }));
    const atWork = p.el(PAGE_IDS.kpis).children[0];
    const number = (): string => atWork?.find("kpi-number")[0]?.text() ?? "";
    expect(number()).toBe("0");
    p.clock.now += 100;
    p.frames[0]?.(16);
    expect(Number(number())).toBeGreaterThan(0);
    expect(Number(number())).toBeLessThan(4);
    p.clock.now += 500;
    p.frames[1]?.(32);
    expect(number()).toBe("4");
  });

  it("keeps a focused crew card in place while the crew around it changes", () => {
    const p = page();
    startPage(p.env);
    emit(snapshot({ lanes: [lane({ name: "a", state: "queued" }), lane({ name: "b", state: "queued" }), lane({ name: "c", state: "queued" })] }));
    const list = p.el(PAGE_IDS.crew);
    const cardOf = (name: string): FakeElement | undefined => list.children.find((li) => li.find("name")[0]?.textContent === name);
    const a = cardOf("a");
    if (!a) throw new Error("no card a");
    a.children[0]?.dispatch("focus");
    const before = a.insertions;
    // a is orphaned (it sorts last), c starts running (first), d joins: everything moves around a, never a itself.
    emit(
      snapshot({
        lanes: [
          lane({ name: "a", state: "orphaned" }),
          lane({ name: "b", state: "queued" }),
          lane({ name: "c", state: "running" }),
          lane({ name: "d", state: "queued" }),
        ],
      }),
    );
    expect(list.children.map((li) => li.find("name")[0]?.textContent)).toEqual(["c", "b", "d", "a"]);
    expect(cardOf("a")).toBe(a);
    expect(a.insertions).toBe(before);
    expect(p.el(PAGE_IDS.tooltip).hidden).toBe(false);
    // b leaves: nothing else moves.
    const c = cardOf("c");
    const cBefore = c?.insertions;
    emit(snapshot({ lanes: [lane({ name: "a", state: "orphaned" }), lane({ name: "c", state: "running" }), lane({ name: "d", state: "queued" })] }));
    expect(list.children.map((li) => li.find("name")[0]?.textContent)).toEqual(["c", "d", "a"]);
    expect(c?.insertions).toBe(cBefore);
    expect(a.insertions).toBe(before);
  });

  it("keeps crew cards across snapshots and announces changes politely", () => {
    const p = page();
    startPage(p.env);
    emit(snapshot({ lanes: [lane({ name: "a", state: "queued" })] }));
    const first = p.el(PAGE_IDS.crew).children[0];
    expect(p.el(PAGE_IDS.live).textContent).toBe("");
    emit(snapshot({ lanes: [lane({ name: "a", state: "running" })] }));
    expect(p.el(PAGE_IDS.crew).children[0]).toBe(first);
    expect(p.el(PAGE_IDS.live).textContent).toBe("a started");
    emit(snapshot({ lanes: [lane({ name: "a", state: "finished", endState: "failed" })] }));
    expect(p.el(PAGE_IDS.crew).children).toHaveLength(0);
    expect(p.el(PAGE_IDS.crewEmpty).hidden).toBe(false);
    expect(p.el(PAGE_IDS.crewEmpty).text()).toContain("The site is quiet.");
    expect(p.el(PAGE_IDS.live).textContent).toBe("a finished: failed");
    expect(p.el(PAGE_IDS.chronicle).children[0]?.text()).toContain("a finished: failed");
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
    expect(p.el(PAGE_IDS.connection).text()).toBe("RECONNECTING");
    es?.emit("snapshot", JSON.stringify(snapshot()));
    expect(p.el(PAGE_IDS.banner).hidden).toBe(true);
  });

  it("says reconnecting while the stream retries", () => {
    const p = page();
    startPage(p.env);
    const es = FakeEventSource.last;
    if (!es) throw new Error("no event source");
    const notice = p.el(PAGE_IDS.notice);
    const connection = p.el(PAGE_IDS.connection);
    notice.hidden = true;
    es.readyState = 1;
    es.emit("open");
    expect(connection.text()).toBe("LIVE");
    es.readyState = 0;
    es.emit("error");
    expect(connection.text()).toBe("RECONNECTING");
    expect(connection.attributes.get("data-state")).toBe("lost");
    expect(notice.hidden).toBe(true);
  });

  describe("a closed stream asks the snapshot route why", () => {
    const close = async (fetch: FetchLike | null): Promise<Page> => {
      const p = page("#token=deadbeefdeadbeef", fetch);
      startPage(p.env);
      const es = FakeEventSource.last;
      if (!es) throw new Error("no event source");
      p.el(PAGE_IDS.notice).hidden = true;
      es.readyState = 2;
      es.emit("error");
      expect(p.el(PAGE_IDS.connection).text()).toBe("OFFLINE");
      expect(p.el(PAGE_IDS.connection).attributes.get("data-state")).toBe("closed");
      await settle();
      return p;
    };

    it("200: the server is up and the token good, so this tab is one too many", async () => {
      const p = await close(() => Promise.resolve({ status: 200 }));
      expect(p.fetched).toEqual(["/snapshot.json?token=deadbeefdeadbeef"]);
      expect(p.el(PAGE_IDS.notice).hidden).toBe(false);
      expect(p.el(PAGE_IDS.notice).textContent).toBe(TOO_MANY_MESSAGE);
      expect(TOO_MANY_MESSAGE).toBe("This page is one too many: arbab ui serves 16 at once. Close another of its tabs and reload.");
    });

    it("401: the session ended or restarted", async () => {
      const p = await close(() => Promise.resolve({ status: 401 }));
      expect(p.el(PAGE_IDS.notice).textContent).toBe(CLOSED_MESSAGE);
      expect(CLOSED_MESSAGE).toBe("This session ended or restarted. Use the tab the new `arbab ui` opened, or the URL it printed.");
    });

    it("a failed fetch: arbab ui is not running", async () => {
      const p = await close(() => Promise.reject(new TypeError("Failed to fetch")));
      expect(p.el(PAGE_IDS.notice).textContent).toBe(NOT_RUNNING_MESSAGE);
      expect(NOT_RUNNING_MESSAGE).toBe("arbab ui is not running.");
    });

    it("a fetch that throws, or none at all", async () => {
      const thrown = await close(() => {
        throw new Error("blocked");
      });
      expect(thrown.el(PAGE_IDS.notice).textContent).toBe(NOT_RUNNING_MESSAGE);
      const none = await close(null);
      expect(none.el(PAGE_IDS.notice).textContent).toBe(CLOSED_MESSAGE);
    });
  });

  it("draws every animation frame and asks for the next", () => {
    const p = page();
    startPage(p.env);
    expect(p.frames).toHaveLength(1);
    p.frames[0]?.(16);
    expect(p.canvas.fills.length).toBeGreaterThan(100);
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

  it("goes full screen on the scene card, at the largest scale the screen holds", () => {
    const p = page();
    const site = p.el(PAGE_IDS.site);
    let requested = 0;
    site.requestFullscreen = () => {
      requested++;
      p.doc.fullscreenElement = site;
    };
    startPage(p.env);
    expect(p.el(PAGE_IDS.siteFullscreen).hidden).toBe(false);
    p.el(PAGE_IDS.siteFullscreen).dispatch("click");
    expect(requested).toBe(1);
    p.el(PAGE_IDS.stage).rect = { left: 0, top: 0, width: 1920, height: 1100 };
    p.doc.root.dispatch("fullscreenchange");
    expect(p.canvas.style.width).toBe("1920px");
    expect(p.canvas.style.height).toBe("1080px");
    // Again leaves it.
    p.el(PAGE_IDS.fullscreen).dispatch("click");
    expect(p.doc.fullscreenElement).toBeNull();
  });

  it("leaves the page as it is when the browser refuses full screen", async () => {
    const p = page();
    p.el(PAGE_IDS.site).requestFullscreen = () => Promise.reject(new TypeError("denied"));
    startPage(p.env);
    p.el(PAGE_IDS.fullscreen).dispatch("click");
    await settle();
    p.el(PAGE_IDS.site).requestFullscreen = () => {
      throw new Error("denied");
    };
    p.el(PAGE_IDS.siteFullscreen).dispatch("click");
    expect(p.canvas.style.width).toBe("960px");
  });

  it("hides the full-screen buttons where the browser has no Fullscreen API", () => {
    const p = page();
    startPage(p.env);
    expect(p.el(PAGE_IDS.fullscreen).hidden).toBe(true);
    expect(p.el(PAGE_IDS.siteFullscreen).hidden).toBe(true);
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
    emit(snapshot({ lanes: [lane({ name: "ui-art", toolCalls: 9 })] }));
    const button = p.el(PAGE_IDS.crew).children[0]?.children[0];
    if (!button) throw new Error("no crew button");
    const tooltip = p.el(PAGE_IDS.tooltip);
    button.dispatch("focus");
    expect(tooltip.hidden).toBe(false);
    expect(tooltip.children[0]?.text()).toBe("ui-art");
    expect(tooltip.text()).toContain("tool calls 9");
    button.dispatch("click");
    expect(button.attributes.get("aria-pressed")).toBe("true");
    expect(p.el(PAGE_IDS.table).children[0]?.className).toBe("pinned");
    button.dispatch("blur");
    expect(tooltip.hidden).toBe(false);
    p.doc.root.dispatch("keydown", { key: "Escape" });
    expect(button.attributes.get("aria-pressed")).toBe("false");
    expect(tooltip.hidden).toBe(true);
  });

  it("highlights a ledger row's lane on hover and pins it on click", () => {
    const p = page();
    startPage(p.env);
    emit(snapshot({ lanes: [lane({ name: "done", state: "finished", endState: "success" })] }));
    const row = p.el(PAGE_IDS.table).children[0];
    if (!row) throw new Error("no row");
    row.dispatch("mouseenter");
    expect(p.el(PAGE_IDS.tooltip).hidden).toBe(false);
    row.dispatch("click");
    row.dispatch("mouseleave");
    expect(p.el(PAGE_IDS.tooltip).hidden).toBe(false);
    expect(row.className).toBe("pinned");
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
