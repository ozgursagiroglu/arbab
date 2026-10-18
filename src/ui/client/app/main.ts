// The page script (DESIGN.md §19): thin glue between the browser, the scene, the renderer and the DOM. It reads the
// browser from globalThis once, at the bottom; startPage takes everything as parameters so tests drive it with fakes.
// Its import graph must never reach a node: module (scripts/build.mjs bundles it for the browser).
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
  LocationLike,
  MediaQueryListLike,
  PageEnv,
  StorageLike,
  WindowLike,
} from "./browser";
import {
  announcements,
  castOf,
  computeScale,
  crew,
  formatState,
  header,
  parseProblem,
  parseSnapshot,
  parseToken,
  tableRow,
  tooltipLines,
} from "./hud";
import { PAGE_IDS } from "./page";
import { renderWorld } from "./render";
import { createSound } from "./sound";

export const NO_TOKEN_MESSAGE = "Open the URL `arbab ui` printed: it carries this session's token";

export interface PageHandle {
  stop(): void;
}

interface CrewItem {
  li: ElementLike;
  button: ElementLike;
  chip: ElementLike;
  name: ElementLike;
  state: ElementLike;
}

function asCanvas(element: ElementLike | null): CanvasElementLike | null {
  return element && typeof (element as Partial<CanvasElementLike>).getContext === "function" ? (element as CanvasElementLike) : null;
}

/** Wires the page up. Returns null when it cannot run (no token, a missing element, no 2D canvas). */
export function startPage(env: PageEnv): PageHandle | null {
  const doc = env.document;
  const get = (id: string): ElementLike | null => doc.getElementById(id);
  const els = {
    header: get(PAGE_IDS.header),
    title: get(PAGE_IDS.title),
    counts: get(PAGE_IDS.counts),
    cost: get(PAGE_IDS.cost),
    quota: get(PAGE_IDS.quota),
    held: get(PAGE_IDS.held),
    connection: get(PAGE_IDS.connection),
    sound: get(PAGE_IDS.sound),
    banner: get(PAGE_IDS.banner),
    stage: get(PAGE_IDS.stage),
    tooltip: get(PAGE_IDS.tooltip),
    notice: get(PAGE_IDS.notice),
    crew: get(PAGE_IDS.crew),
    table: get(PAGE_IDS.table),
    hidden: get(PAGE_IDS.hidden),
    live: get(PAGE_IDS.live),
  };
  const canvas = asCanvas(get(PAGE_IDS.canvas));
  const {
    header: headerEl,
    title,
    counts,
    cost,
    quota,
    held,
    connection,
    sound: soundButton,
    banner,
    stage,
    tooltip,
    notice,
    crew: crewList,
    table,
    hidden,
    live,
  } = els;
  if (
    !canvas ||
    !headerEl ||
    !title ||
    !counts ||
    !cost ||
    !quota ||
    !held ||
    !connection ||
    !soundButton ||
    !banner ||
    !stage ||
    !tooltip ||
    !notice ||
    !crewList ||
    !table ||
    !hidden ||
    !live
  ) {
    return null;
  }

  const setConnection = (state: "connecting" | "live" | "lost"): void => {
    connection.setAttribute("data-state", state);
    connection.textContent = state === "lost" ? "reconnecting" : state;
  };
  const showNotice = (text: string): void => {
    notice.textContent = text;
    notice.hidden = false;
  };

  const token = parseToken(env.location.hash);
  if (!token) {
    showNotice(NO_TOKEN_MESSAGE);
    counts.textContent = "no session token";
    setConnection("lost");
    connection.textContent = "not connected";
    return null;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    showNotice("This browser cannot draw the scene; the lanes table below still works.");
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

  // Sound: off until the viewer turns it on.
  const sound = createSound({ AudioContext: env.AudioContext, storage: env.storage, now: env.now });
  const showSound = (): void => {
    soundButton.setAttribute("aria-pressed", String(sound.enabled));
    soundButton.textContent = sound.enabled ? "sound on" : "sound off";
  };
  showSound();
  soundButton.addEventListener("click", () => {
    sound.toggle();
    showSound();
  });
  doc.addEventListener("pointerdown", () => sound.unlock());
  doc.addEventListener("keydown", (event) => {
    sound.unlock();
    if (event.key === "Escape" && pinned !== null) {
      pinned = null;
      refreshCrewPressed();
      applyHighlight();
      refreshTooltip();
    }
  });

  // Scale: the largest integer that fits, snapped to device pixels.
  let scale = 1;
  const resize = (): void => {
    scale = computeScale(stage.getBoundingClientRect().width, env.window.innerHeight, headerEl.getBoundingClientRect().height);
    const dpr = env.devicePixelRatio > 0 ? env.devicePixelRatio : 1;
    canvas.style.width = `${Math.round(WIDTH * scale * dpr) / dpr}px`;
    canvas.style.height = `${Math.round(HEIGHT * scale * dpr) / dpr}px`;
  };
  resize();
  env.window.addEventListener("resize", resize);

  // State from the snapshots.
  let last: UiSnapshot | null = null;
  let lanes = new Map<string, UiLane>();
  let offsetMs = 0;
  let hovered: string | null = null;
  let focused: string | null = null;
  let pinned: string | null = null;
  let pointer: { x: number; y: number } | null = null;

  const showBanner = (text: string): void => {
    banner.textContent = text;
    banner.hidden = false;
  };
  const hideBanner = (): void => {
    banner.hidden = true;
    banner.textContent = "";
  };

  const applyHighlight = (): void => scene.highlight(hovered ?? focused ?? pinned);

  /** Where a lane is on the canvas, in CSS px of the stage: its worker, else its block. */
  const anchorOf = (lane: string): { x: number; y: number } => {
    const actor: Actor | undefined = scene.world.actors.find((a) => a.lane === lane);
    if (actor) return { x: actor.x * scale, y: (actor.y - 20) * scale };
    const block: Block | undefined = scene.world.pyramid.blocks.find((b) => b.lane === lane);
    if (block) return { x: (block.x + block.w) * scale, y: block.y * scale };
    return { x: 8, y: 8 };
  };

  const refreshTooltip = (): void => {
    const name = hovered ?? focused ?? pinned;
    const lane = name === null ? undefined : lanes.get(name);
    if (!name || !lane) {
      tooltip.hidden = true;
      return;
    }
    const lines = tooltipLines(lane, env.now(), offsetMs);
    tooltip.replaceChildren(
      ...lines.map((line) => {
        const div = doc.createElement("div");
        div.textContent = line;
        return div;
      }),
    );
    const at = hovered !== null && pointer ? pointer : anchorOf(name);
    const width = stage.getBoundingClientRect().width;
    tooltip.style.left = `${Math.max(0, Math.min(width - 200, at.x + 12))}px`;
    tooltip.style.top = `${Math.max(0, at.y + 12)}px`;
    tooltip.hidden = false;
  };

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

  // The crew list, keyed by lane so a focused button survives a snapshot.
  const items = new Map<string, CrewItem>();
  let order: string[] = [];
  const refreshCrewPressed = (): void => {
    for (const [name, item] of items) item.button.setAttribute("aria-pressed", String(pinned === name));
  };
  const crewItem = (name: string): CrewItem => {
    const li = doc.createElement("li");
    const button = doc.createElement("button");
    button.setAttribute("type", "button");
    button.setAttribute("aria-pressed", "false");
    const chip = doc.createElement("span");
    chip.setAttribute("aria-hidden", "true");
    const label = doc.createElement("span");
    label.className = "name";
    const state = doc.createElement("span");
    state.className = "state";
    button.appendChild(chip);
    button.appendChild(label);
    button.appendChild(state);
    li.appendChild(button);
    const enter = (): void => {
      focused = name;
      applyHighlight();
      refreshTooltip();
    };
    const leave = (): void => {
      if (focused === name) focused = null;
      applyHighlight();
      refreshTooltip();
    };
    button.addEventListener("focus", enter);
    button.addEventListener("mouseenter", enter);
    button.addEventListener("blur", leave);
    button.addEventListener("mouseleave", leave);
    // Enter (or a click) pins the lane's tooltip; again unpins it.
    button.addEventListener("click", () => {
      pinned = pinned === name ? null : name;
      refreshCrewPressed();
      applyHighlight();
      refreshTooltip();
    });
    return { li, button, chip, name: label, state };
  };
  const updateCrew = (snapshot: UiSnapshot): void => {
    const list = crew(snapshot);
    const names = list.map((lane) => lane.name);
    const keep = new Set(names);
    for (const [name, item] of items) {
      if (!keep.has(name)) {
        item.li.remove();
        items.delete(name);
      }
    }
    for (const lane of list) {
      let item = items.get(lane.name);
      if (!item) {
        item = crewItem(lane.name);
        items.set(lane.name, item);
      }
      item.chip.className = `chip cast-${castOf(lane)}`;
      item.name.textContent = lane.name;
      item.state.textContent = formatState(lane);
    }
    if (names.length !== order.length || names.some((name, i) => order[i] !== name)) {
      for (const name of names) {
        const item = items.get(name);
        if (item) crewList.appendChild(item.li);
      }
      order = names;
    }
    if (pinned !== null && !keep.has(pinned)) pinned = null;
    refreshCrewPressed();
  };

  const updateTable = (snapshot: UiSnapshot): void => {
    table.replaceChildren(
      ...snapshot.lanes.map((lane) => {
        const tr = doc.createElement("tr");
        tableRow(lane).forEach((cell, i) => {
          const td = doc.createElement(i === 0 ? "th" : "td");
          if (i === 0) td.setAttribute("scope", "row");
          td.textContent = cell;
          tr.appendChild(td);
        });
        return tr;
      }),
    );
  };

  const onSnapshot = (data: string): void => {
    const parsed = parseSnapshot(data);
    if (!parsed.ok) {
      showBanner(parsed.message);
      return;
    }
    const snapshot = parsed.snapshot;
    hideBanner();
    setConnection("live");
    const serverNow = Date.parse(snapshot.now);
    offsetMs = Number.isNaN(serverNow) ? 0 : serverNow - env.now();
    try {
      scene.apply(snapshot);
    } catch {
      showBanner("The scene could not show this snapshot; the lanes table is up to date.");
    }
    const h = header(snapshot);
    title.textContent = h.title;
    counts.textContent = h.counts;
    cost.textContent = h.cost;
    quota.textContent = h.quota;
    held.hidden = !h.held;
    hidden.textContent = h.hidden;
    lanes = new Map(snapshot.lanes.map((lane) => [lane.name, lane]));
    updateCrew(snapshot);
    updateTable(snapshot);
    const said = announcements(last, snapshot);
    if (said.length > 0) live.textContent = said.join(". ");
    last = snapshot;
    applyHighlight();
    refreshTooltip();
  };

  const source = new env.EventSource(`${UI_ROUTES.events}?${UI_TOKEN_PARAM}=${encodeURIComponent(token)}`);
  source.addEventListener("open", () => setConnection("live"));
  source.addEventListener(UI_EVENTS.snapshot, (event) => onSnapshot(event.data));
  source.addEventListener(UI_EVENTS.problem, (event) => showBanner(parseProblem(event.data)));
  // EventSource retries by itself (the server sends retry: 2000).
  source.addEventListener("error", () => setConnection("lost"));

  // The loop: step the scene, draw it, play its events.
  let stopped = false;
  let previous: number | null = null;
  let tick = 0;
  const frame = (time: number): void => {
    if (stopped) return;
    const dt = previous === null ? 16 : Math.max(0, time - previous);
    previous = time;
    scene.step(dt);
    renderWorld(ctx, scene.world);
    const events = scene.world.events;
    for (const event of events) sound.play(event.kind);
    events.length = 0;
    // The tooltip's elapsed time counts on.
    if (time - tick >= 1000) {
      tick = time;
      if (!tooltip.hidden) refreshTooltip();
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
  return {
    document: doc as DocumentLike,
    window: win as WindowLike,
    location: g.location as LocationLike,
    EventSource: g.EventSource as EventSourceConstructor,
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
