// The page script (DESIGN.md §19): thin glue between the browser, the scene, the renderer and the HUD components in
// hud/. It reads the browser from globalThis once, at the bottom; startPage takes everything as parameters so tests
// drive it with fakes. Its import graph must never reach a node: module (scripts/build.mjs bundles it for the browser).
import type { UiLane, UiSnapshot } from "../../protocol";
import { UI_EVENTS, UI_ROUTES, UI_TOKEN_PARAM } from "../../protocol";
import type { Actor, Block } from "../model";
import { HEIGHT, WIDTH } from "../model";
import { createScene } from "../scene";
import type {
  AudioContextConstructor,
  CanvasElementLike,
  DocumentLike,
  ElementLike,
  EventSourceConstructor,
  FetchLike,
  LocationLike,
  MediaQueryListLike,
  PageEnv,
  ResponseLike,
  StorageLike,
  WindowLike,
} from "./browser";
import { announcements, computeScale, header, parseProblem, parseSnapshot, parseToken, tooltipLines } from "./hud";
import { sceneCaption } from "./hud/caption";
import type { ChronicleEntry } from "./hud/chronicle";
import { chronicleDiff, mergeChronicle, seedChronicle } from "./hud/chronicle";
import { mountChronicle } from "./hud/chronicle-panel";
import { mountCrew } from "./hud/crew";
import { asCanvas, devicePixels, make, sizeCanvas } from "./hud/dom";
import { gaugeView, mountGauge } from "./hud/gauge";
import { drawGrid, PYRAMID_GRID } from "./hud/icons";
import { mountKpis } from "./hud/kpi";
import { mountLedger } from "./hud/ledger";
import { mountMonument } from "./hud/monument";
import { createPixelText } from "./hud/pixel-text";
import type { Connection } from "./hud/status";
import { CLOSED_MESSAGE, closedMessage, connectionLabel } from "./hud/status";
import { TOKENS } from "./hud/tokens";
import { PAGE_IDS } from "./page";
import { renderWorld } from "./render";
import { createSound } from "./sound";
import { createSpriteSet } from "./sprites";

export { CLOSED_MESSAGE, NOT_RUNNING_MESSAGE, TOO_MANY_MESSAGE } from "./hud/status";

// arbab ui prints the token only when it could not open a browser (DESIGN.md §19), so both point at the tab it opened.
export const NO_TOKEN_MESSAGE =
  "This page needs its session token. Use the tab `arbab ui` opened, or run `arbab ui --no-open` to print a URL that carries it.";
/** EventSource.CLOSED: the tsconfig has no DOM lib. */
const EVENT_SOURCE_CLOSED = 2;
/** How often the relative times ("2m ago") are rewritten. */
const AGO_MS = 30_000;

export interface PageHandle {
  stop(): void;
}

type Ids = typeof PAGE_IDS;

/** Every element of PAGE_IDS, or null when one is missing. */
function elements(doc: DocumentLike): Record<keyof Ids, ElementLike> | null {
  const out: Partial<Record<keyof Ids, ElementLike>> = {};
  for (const [key, id] of Object.entries(PAGE_IDS) as [keyof Ids, string][]) {
    const el = doc.getElementById(id);
    if (!el) return null;
    out[key] = el;
  }
  return out as Record<keyof Ids, ElementLike>;
}

function drawLogo(canvas: CanvasElementLike | null, scale: number, dpr: number): void {
  if (!canvas) return;
  sizeCanvas(canvas, 16 * scale, 16 * scale, dpr);
  const ctx = canvas.getContext("2d");
  if (ctx) drawGrid(ctx, PYRAMID_GRID, 0, 0, scale * dpr);
}

/** Wires the page up. Returns null when it cannot run (no token, a missing element, no 2D canvas). */
export function startPage(env: PageEnv): PageHandle | null {
  const doc = env.document;
  const els = elements(doc);
  const canvas = asCanvas(doc.getElementById(PAGE_IDS.canvas));
  if (!els || !canvas) return null;
  const { stage, tooltip, notice, banner, connection, live, site } = els;

  const dpr = devicePixels(env.devicePixelRatio);
  const showNotice = (text: string): void => {
    notice.textContent = text;
    notice.hidden = false;
  };

  // The connection pill.
  const pill = createPixelText(doc, { scale: 1, color: TOKENS.muted, dpr });
  connection.replaceChildren(pill.el);
  const setConnection = (state: Connection): void => {
    connection.setAttribute("data-state", state);
    const { text, color } = connectionLabel(state);
    pill.set(text, color);
  };
  setConnection("connecting");

  const token = parseToken(env.location.hash);
  if (!token) {
    showNotice(NO_TOKEN_MESSAGE);
    els.project.textContent = "no session token";
    setConnection("closed");
    return null;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    showNotice("This browser cannot draw the scene; the ledger below still works.");
    return null;
  }
  canvas.width = WIDTH;
  canvas.height = HEIGHT;

  let reducedMotion = false;
  try {
    reducedMotion = env.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    reducedMotion = false;
  }
  const scene = createScene({ reducedMotion, random: Math.random });
  const sprites = createSpriteSet();

  // The brand, the titles and the title card.
  drawLogo(asCanvas(els.logo), 2, dpr);
  drawLogo(asCanvas(els.titleCardLogo), 4, dpr);
  els.title.replaceChildren(createPixelText(doc, { scale: 3, color: TOKENS.gold, dpr }, "ARBAB").el);
  els.titleCardWord.replaceChildren(createPixelText(doc, { scale: 6, color: TOKENS.gold, dpr }, "ARBAB").el);
  els.siteTitle.replaceChildren(createPixelText(doc, { scale: 2, color: TOKENS.gold, dpr }, "THE SITE").el);
  const caption = createPixelText(doc, { scale: 1, color: TOKENS.sand, dpr }, "THE SITE IS QUIET");
  els.caption.replaceChildren(caption.el);
  const gauges = [mountGauge(doc, els.gauge5h, "5h", dpr), mountGauge(doc, els.gauge7d, "7d", dpr)] as const;
  const kpis = mountKpis(doc, els.kpis, { dpr, reducedMotion });

  // Sound: off until the viewer turns it on.
  const sound = createSound({ AudioContext: env.AudioContext, storage: env.storage, now: env.now });
  const showSound = (): void => {
    els.sound.setAttribute("aria-pressed", String(sound.enabled));
    els.sound.textContent = sound.enabled ? "sound on" : "sound off";
  };
  showSound();
  els.sound.addEventListener("click", () => {
    sound.toggle();
    showSound();
  });

  // Full screen: the scene card, where the browser has the API.
  const fullscreen = (): boolean => doc.fullscreenElement !== undefined && doc.fullscreenElement !== null && doc.fullscreenElement === site;
  const canFullscreen = typeof site.requestFullscreen === "function";
  for (const button of [els.fullscreen, els.siteFullscreen]) {
    button.hidden = !canFullscreen;
    button.addEventListener("click", () => {
      // A refused request (it can throw or reject) leaves the page as it is.
      try {
        const pending = fullscreen() && typeof doc.exitFullscreen === "function" ? doc.exitFullscreen() : site.requestFullscreen?.();
        if (pending instanceof Promise) pending.catch(() => undefined);
      } catch {
        // As above.
      }
    });
  }

  // Scale: the largest integer that fits, snapped to device pixels; full screen, the whole stage.
  let scale = 1;
  const resize = (): void => {
    const box = stage.getBoundingClientRect();
    scale = fullscreen()
      ? computeScale(box.width, box.height, 0)
      : computeScale(box.width, env.window.innerHeight, els.header.getBoundingClientRect().height);
    const ratio = env.devicePixelRatio > 0 ? env.devicePixelRatio : 1;
    canvas.style.width = `${Math.round(WIDTH * scale * ratio) / ratio}px`;
    canvas.style.height = `${Math.round(HEIGHT * scale * ratio) / ratio}px`;
  };
  resize();
  env.window.addEventListener("resize", resize);
  doc.addEventListener("fullscreenchange", resize);

  // State from the snapshots.
  let last: UiSnapshot | null = null;
  let lanes = new Map<string, UiLane>();
  let offsetMs = 0;
  let hovered: string | null = null;
  let focused: string | null = null;
  let pinned: string | null = null;
  let pointer: { x: number; y: number } | null = null;
  let chronicle: ChronicleEntry[] = [];
  const serverNow = (): number => env.now() + offsetMs;

  const showBanner = (text: string): void => {
    banner.textContent = text;
    banner.hidden = false;
  };
  const hideBanner = (): void => {
    banner.hidden = true;
    banner.textContent = "";
  };

  const applyHighlight = (): void => scene.highlight(hovered ?? focused ?? pinned);

  /** The canvas's top-left corner in the stage (it is centered there). */
  const canvasOffset = (): { x: number; y: number } => {
    const c = canvas.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    return { x: c.left - s.left, y: c.top - s.top };
  };

  /** Where a lane is in the stage, in CSS px: its worker, else its block. */
  const anchorOf = (lane: string): { x: number; y: number } => {
    const off = canvasOffset();
    const actor: Actor | undefined = scene.world.actors.find((a) => a.lane === lane);
    if (actor) return { x: off.x + actor.x * scale, y: off.y + (actor.y - 20) * scale };
    const block: Block | undefined = scene.world.pyramid.blocks.find((b) => b.lane === lane);
    if (block) return { x: off.x + (block.x + block.w) * scale, y: off.y + block.y * scale };
    return { x: off.x + 8, y: off.y + 8 };
  };

  // The tooltip: a framed panel, the lane's name in the pixel font, then its facts.
  const tipTitle = createPixelText(doc, { scale: 1, color: TOKENS.gold, dpr });
  const tipHead = make(doc, "div", "tip-title");
  tipHead.appendChild(tipTitle.el);
  const refreshTooltip = (): void => {
    const name = hovered ?? focused ?? pinned;
    const lane = name === null ? undefined : lanes.get(name);
    if (!name || !lane) {
      tooltip.hidden = true;
      return;
    }
    const [first = name, ...lines] = tooltipLines(lane, env.now(), offsetMs);
    tipTitle.set(first);
    tooltip.replaceChildren(tipHead, ...lines.map((line) => make(doc, "div", "", line)));
    const at = hovered !== null && pointer ? pointer : anchorOf(name);
    const width = stage.getBoundingClientRect().width;
    tooltip.style.left = `${Math.max(0, Math.min(width - 220, at.x + 12))}px`;
    tooltip.style.top = `${Math.max(0, at.y + 12)}px`;
    tooltip.hidden = false;
  };

  const setPinned = (name: string | null): void => {
    pinned = name;
    crew.setPinned(name);
    ledger.setPinned(name);
    applyHighlight();
    refreshTooltip();
  };
  const handlers = {
    enter(name: string) {
      focused = name;
      applyHighlight();
      refreshTooltip();
    },
    leave(name: string) {
      if (focused === name) focused = null;
      applyHighlight();
      refreshTooltip();
    },
    // A click or Enter pins the lane's tooltip; again unpins it.
    toggle(name: string) {
      setPinned(pinned === name ? null : name);
    },
  };

  const crew = mountCrew(
    doc,
    { title: els.crewTitle, list: els.crew, empty: els.crewEmpty, recentGroup: els.recentGroup, recentTitle: els.recentTitle, recent: els.recent },
    sprites,
    dpr,
    handlers,
  );
  const monument = mountMonument(doc, { title: els.monumentTitle, body: els.monument }, dpr);
  const chroniclePanel = mountChronicle(doc, { title: els.chronicleTitle, list: els.chronicle, empty: els.chronicleEmpty }, dpr);
  const ledger = mountLedger(doc, { title: els.ledgerTitle, head: els.ledgerHead, body: els.table }, dpr, handlers);

  doc.addEventListener("pointerdown", () => sound.unlock());
  doc.addEventListener("keydown", (event) => {
    sound.unlock();
    if (event.key === "Escape" && pinned !== null) setPinned(null);
  });

  // Hover on the canvas.
  canvas.addEventListener("pointermove", (event) => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const cx = event.clientX ?? 0;
    const cy = event.clientY ?? 0;
    hovered = scene.pick(((cx - rect.left) * WIDTH) / rect.width, ((cy - rect.top) * HEIGHT) / rect.height);
    const stageRect = stage.getBoundingClientRect();
    pointer = { x: cx - stageRect.left, y: cy - stageRect.top };
    applyHighlight();
    refreshTooltip();
  });
  canvas.addEventListener("pointerleave", () => {
    hovered = null;
    pointer = null;
    applyHighlight();
    refreshTooltip();
  });

  const onSnapshot = (data: string): void => {
    const parsed = parseSnapshot(data);
    if (!parsed.ok) {
      showBanner(parsed.message);
      return;
    }
    const snapshot = parsed.snapshot;
    hideBanner();
    setConnection("live");
    const sent = Date.parse(snapshot.now);
    offsetMs = Number.isNaN(sent) ? 0 : sent - env.now();
    const now = serverNow();
    try {
      scene.apply(snapshot);
    } catch {
      showBanner("The scene could not show this snapshot; the ledger is up to date.");
    }
    if (last === null) els.titleCard.className = "title-card gone";

    const h = header(snapshot);
    els.project.textContent = h.project;
    els.version.textContent = h.version;
    els.held.hidden = !h.held;
    els.footer.textContent = h.footer;
    const nowSec = now / 1000;
    gauges[0].update(gaugeView("5h", snapshot.quota.fiveHour, snapshot.quota.holdAbove.fiveHour, nowSec));
    gauges[1].update(gaugeView("7d", snapshot.quota.sevenDay, snapshot.quota.holdAbove.sevenDay, nowSec));
    kpis.update(snapshot, env.now());
    caption.set(sceneCaption(snapshot, now));

    lanes = new Map(snapshot.lanes.map((lane) => [lane.name, lane]));
    if (pinned !== null && !lanes.has(pinned)) pinned = null;
    crew.update(snapshot, now);
    ledger.update(snapshot, now);
    monument.update(snapshot, now);
    chronicle = mergeChronicle(chronicle, last === null ? seedChronicle(snapshot) : chronicleDiff(last, snapshot));
    chroniclePanel.update(chronicle, now);

    const said = announcements(last, snapshot);
    if (said.length > 0) live.textContent = said.join(". ");
    last = snapshot;
    setPinned(pinned);
  };

  // A closed stream: ask the snapshot route, with the same token, why.
  let stopped = false;
  const explainClosed = (): void => {
    const fetcher: FetchLike | null = env.fetch;
    if (!fetcher) {
      showNotice(CLOSED_MESSAGE);
      return;
    }
    let probe: Promise<ResponseLike>;
    try {
      probe = fetcher(`${UI_ROUTES.snapshot}?${UI_TOKEN_PARAM}=${encodeURIComponent(token)}`);
    } catch {
      probe = Promise.reject(new Error("fetch threw"));
    }
    probe.then(
      (res) => {
        if (!stopped) showNotice(closedMessage(res));
      },
      () => {
        if (!stopped) showNotice(closedMessage(null));
      },
    );
  };

  const source = new env.EventSource(`${UI_ROUTES.events}?${UI_TOKEN_PARAM}=${encodeURIComponent(token)}`);
  source.addEventListener("open", () => setConnection("live"));
  source.addEventListener(UI_EVENTS.snapshot, (event) => onSnapshot(event.data));
  source.addEventListener(UI_EVENTS.problem, (event) => showBanner(parseProblem(event.data)));
  // EventSource retries by itself (the server sends retry: 2000) while it is CONNECTING. CLOSED means it gave up: the
  // server answered with an error (a new session's token, the client limit, a server gone and another on the port).
  source.addEventListener("error", () => {
    if (source.readyState === EVENT_SOURCE_CLOSED) {
      setConnection("closed");
      explainClosed();
    } else {
      setConnection("lost");
    }
  });

  // The loop: step the scene, draw it, play its events, count the KPIs, and tick the clocks.
  let previous: number | null = null;
  let second = 0;
  let ago = 0;
  const frame = (time: number): void => {
    if (stopped) return;
    const dt = previous === null ? 16 : Math.max(0, time - previous);
    previous = time;
    scene.step(dt);
    renderWorld(ctx, scene.world);
    const events = scene.world.events;
    for (const event of events) sound.play(event.kind);
    events.length = 0;
    kpis.tick(env.now());
    if (time - second >= 1000) {
      second = time;
      const now = serverNow();
      crew.tick(now);
      ledger.tick(now);
      if (!tooltip.hidden) refreshTooltip();
    }
    if (time - ago >= AGO_MS) {
      ago = time;
      const now = serverNow();
      chroniclePanel.refresh(now);
      if (last) {
        monument.update(last, now);
        caption.set(sceneCaption(last, now));
      }
    }
    env.requestAnimationFrame(frame);
  };
  env.requestAnimationFrame(frame);

  return {
    stop() {
      stopped = true;
      source.close();
    },
  };
}

/** The real browser, read from globalThis once; null outside a browser (tests import this file). */
function browserEnv(): PageEnv | null {
  const g = globalThis as unknown as Record<string, unknown>;
  const doc = g.document;
  const win = g.window;
  if (typeof doc !== "object" || doc === null || typeof win !== "object" || win === null) return null;
  if (typeof g.EventSource !== "function" || typeof g.requestAnimationFrame !== "function") return null;
  const raf = g.requestAnimationFrame as (callback: (time: number) => void) => unknown;
  const media = typeof g.matchMedia === "function" ? (g.matchMedia as (query: string) => MediaQueryListLike) : null;
  const audio = typeof g.AudioContext === "function" ? g.AudioContext : typeof g.webkitAudioContext === "function" ? g.webkitAudioContext : null;
  const fetcher = typeof g.fetch === "function" ? (g.fetch as (url: string) => Promise<ResponseLike>) : null;
  return {
    document: doc as DocumentLike,
    window: win as WindowLike,
    location: g.location as LocationLike,
    EventSource: g.EventSource as EventSourceConstructor,
    fetch: fetcher ? (url) => fetcher.call(win, url) : null,
    AudioContext: audio as AudioContextConstructor | null,
    storage: () => {
      try {
        return (g.localStorage as StorageLike | undefined) ?? null;
      } catch {
        return null;
      }
    },
    matchMedia: (query) => (media ? media.call(win, query) : { matches: false }),
    requestAnimationFrame: (callback) => raf.call(win, callback),
    devicePixelRatio: typeof g.devicePixelRatio === "number" ? g.devicePixelRatio : 1,
    now: () => Date.now(),
  };
}

const browser = browserEnv();
if (browser) startPage(browser);
