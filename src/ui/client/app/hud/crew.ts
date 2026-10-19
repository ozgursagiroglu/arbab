// The crew panel (DESIGN.md §19): a card per lane at work, with its worker's sprite as an avatar, and a folded group of
// the lanes that finished last. Cards are keyed by lane and moved only when out of order, so a focused card keeps focus.
import { formatElapsed } from "../../../../registry/status";
import type { LaneState } from "../../../../types";
import type { UiLane, UiSnapshot } from "../../../protocol";
import type { Cast, Pose } from "../../model";
import { castOf, fillFor } from "../../scene/scene";
import type { Canvas2D, CanvasElementLike, DocumentLike, ElementLike } from "../browser";
import { formatUsd, laneElapsedMs } from "../hud";
import type { Sprite, SpriteSet } from "../sprites";
import { compileProp, ICONS } from "../sprites";
import { make, makeCanvas, reorder } from "./dom";
import type { PixelText } from "./pixel-text";
import { createPixelText } from "./pixel-text";
import { BADGE_INK, badgeColors, badgeOf, TOKENS } from "./tokens";

/** The avatar's canvas, in CSS px, and the most a sprite pixel is scaled. */
export const AVATAR = { w: 36, h: 54, scale: 3 } as const;
/** arbab on the empty state's tile: its 16 × 26 sprite at 3×. */
export const AVATAR_ARBAB = { w: 48, h: 78, scale: 3 } as const;
export const RECENT_MAX = 6;

const RANK: Readonly<Record<LaneState, number>> = {
  running: 0,
  preparing: 1,
  "waiting-reset": 2,
  held: 3,
  queued: 4,
  orphaned: 5,
  finished: 6,
};

const byName = (a: UiLane, b: UiLane): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** Every lane not finished: running, preparing, waiting-reset, held, queued, orphaned, then by name. */
export function crewOrder(lanes: readonly UiLane[]): UiLane[] {
  return lanes.filter((lane) => lane.state !== "finished").sort((a, b) => (RANK[a.state] ?? 9) - (RANK[b.state] ?? 9) || byName(a, b));
}

function epochMs(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : -Infinity;
}

/** The last `max` finished lanes, newest first. */
export function recentlyFinished(lanes: readonly UiLane[], max = RECENT_MAX): UiLane[] {
  return lanes
    .filter((lane) => lane.state === "finished")
    .sort((a, b) => epochMs(b.since) - epochMs(a.since) || byName(a, b))
    .slice(0, max);
}

/** The avatar's pose: at work while running, sitting while held or queued, asleep while waiting-reset, else idle. */
export function avatarPose(lane: Pick<UiLane, "state">): { pose: Pose; ghost: boolean } {
  switch (lane.state) {
    case "running":
      return { pose: "work", ghost: false };
    case "held":
    case "queued":
      return { pose: "sit", ghost: false };
    case "waiting-reset":
      return { pose: "sleep", ghost: false };
    case "orphaned":
      return { pose: "idle", ghost: true };
    default:
      return { pose: "idle", ghost: false };
  }
}

/** A builder's block is set when it finished with success and a `done` report, or none (the scene's rule). */
export function isSet(lane: Pick<UiLane, "state" | "endState" | "reportStatus">): boolean {
  return lane.state === "finished" && lane.endState === "success" && (lane.reportStatus === null || lane.reportStatus === "done");
}

/** The lane's block: full once set, else the scene's fill for its tool calls. */
export function blockFill(lane: Pick<UiLane, "state" | "endState" | "reportStatus" | "toolCalls">): number {
  return isSet(lane) ? 1 : fillFor(lane.toolCalls);
}

/** Whether a scroll container holds more below what it shows (a pixel of slack for fractional layouts). */
export function moreBelow(el: Pick<ElementLike, "scrollHeight" | "clientHeight" | "scrollTop">): boolean {
  const { scrollHeight = 0, clientHeight = 0, scrollTop = 0 } = el;
  return [scrollHeight, clientHeight, scrollTop].every(Number.isFinite) && scrollHeight - clientHeight - scrollTop > 1;
}

/** `CREW · 3 AT WORK` */
export function crewTitle(lanes: readonly UiLane[]): string {
  const n = lanes.filter((lane) => lane.state === "running" || lane.state === "preparing").length;
  return `CREW · ${n} AT WORK`;
}

/** Draws a sprite from its runs, scaled by whole steps to fit and standing on the canvas's bottom edge. */
export function drawSprite(canvas: CanvasElementLike, sprite: Sprite, cssW: number, cssH: number, maxScale: number, dpr: number): number {
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  ctx.clearRect(0, 0, cssW * dpr, cssH * dpr);
  const scale = Math.max(1, Math.min(maxScale, Math.floor(cssW / Math.max(1, sprite.w)), Math.floor(cssH / Math.max(1, sprite.h))));
  paintSprite(ctx, sprite, Math.floor((cssW - sprite.w * scale) / 2), cssH - sprite.h * scale, scale, dpr);
  return scale;
}

/** A sprite's runs at (x, y) CSS px, each sprite pixel `scale` CSS px. */
function paintSprite(ctx: Canvas2D, sprite: Sprite, x: number, y: number, scale: number, dpr: number): void {
  const px = scale * dpr;
  for (const run of sprite.runs) {
    ctx.fillStyle = run.color;
    ctx.fillRect((x + run.x * scale) * dpr, (y + run.y * scale) * dpr, run.w * px, px);
  }
}

const ZZZ = compileProp(ICONS.zzz);

/**
 * A worker's avatar: its sprite standing on the bottom edge. Asleep it lies there at 2× (16 px across a 36-px tile),
 * a thin figure, so the zzz the scene shows over a sleeper floats above it.
 */
export function drawAvatar(canvas: CanvasElementLike, sprite: Sprite, pose: Pose, dpr: number): number {
  const scale = drawSprite(canvas, sprite, AVATAR.w, AVATAR.h, AVATAR.scale, dpr);
  const ctx = canvas.getContext("2d");
  if (pose === "sleep" && ctx) {
    const lying = sprite.h - sprite.top;
    paintSprite(ctx, ZZZ, AVATAR.w - ZZZ.w * 2 - 2, AVATAR.h - lying * scale - ZZZ.h * 2 - 4, 2, dpr);
  }
  return scale;
}

export interface Avatar {
  readonly el: ElementLike;
  set(cast: Exclude<Cast, "arbab">, pose: Pose, ghost: boolean): void;
}

/** A tile tinted with the cast's chip color, holding the sprite; redrawn only when the look changes. */
export function createAvatar(doc: DocumentLike, sprites: SpriteSet, dpr: number): Avatar {
  const el = make(doc, "span", "tile");
  el.setAttribute("aria-hidden", "true");
  const canvas = makeCanvas(doc, AVATAR.w, AVATAR.h, dpr, "px avatar");
  if (canvas) el.appendChild(canvas);
  let key = "";
  return {
    el,
    set(cast, pose, ghost) {
      const next = `${cast}:${pose}:${ghost}`;
      if (next === key) return;
      key = next;
      el.className = `tile cast-${cast}${ghost ? " ghost" : ""}`;
      const sprite = sprites.frames(cast, pose, 0, ghost)[0];
      if (canvas && sprite) drawAvatar(canvas, sprite, pose, dpr);
    },
  };
}

/** The empty state's tile: arbab standing idle at 3×. */
export function createArbabTile(doc: DocumentLike, sprites: SpriteSet, dpr: number): ElementLike {
  const el = make(doc, "span", "tile tile-arbab");
  el.setAttribute("aria-hidden", "true");
  const canvas = makeCanvas(doc, AVATAR_ARBAB.w, AVATAR_ARBAB.h, dpr, "px avatar");
  const sprite = sprites.frames("arbab", "idle", 0, false)[0];
  if (canvas) {
    el.appendChild(canvas);
    if (sprite) drawSprite(canvas, sprite, AVATAR_ARBAB.w, AVATAR_ARBAB.h, AVATAR_ARBAB.scale, dpr);
  }
  return el;
}

function workerCast(lane: UiLane): Exclude<Cast, "arbab"> {
  const cast = castOf(lane);
  return cast === "arbab" ? "laborer" : cast;
}

function setBadge(badge: PixelText, lane: UiLane): void {
  const { tone, label } = badgeOf(lane);
  badge.el.className = `pxt badge tone-${tone}`;
  badge.set(label, badgeColors(tone).ink);
}

function elapsedText(lane: UiLane, serverNowMs: number): string {
  const ms = laneElapsedMs(lane, serverNowMs);
  return ms === null ? "—" : formatElapsed(ms);
}

interface Card {
  li: ElementLike;
  button: ElementLike;
  avatar: Avatar;
  name: ElementLike;
  meta: ElementLike;
  badge: PixelText;
  elapsed: ElementLike;
  fill: ElementLike;
  calls: ElementLike;
  stats: ElementLike;
  lane: UiLane;
}

export interface CrewElements {
  title: ElementLike;
  list: ElementLike;
  empty: ElementLike;
  recentGroup: ElementLike;
  recentTitle: ElementLike;
  recent: ElementLike;
}

export interface CrewHandlers {
  /** Focus or hover on a card. */
  enter(name: string): void;
  leave(name: string): void;
  /** A click or Enter: pin or unpin. */
  toggle(name: string): void;
}

export interface CrewPanel {
  update(snapshot: UiSnapshot, serverNowMs: number): void;
  /** Counts the elapsed times on. */
  tick(serverNowMs: number): void;
  setPinned(name: string | null): void;
  /** The cards' order, for tests. */
  order(): readonly string[];
  button(name: string): ElementLike | undefined;
}

export function mountCrew(doc: DocumentLike, els: CrewElements, sprites: SpriteSet, dpr: number, on: CrewHandlers): CrewPanel {
  const title = createPixelText(doc, { scale: 2, color: TOKENS.gold, dpr }, "CREW");
  els.title.replaceChildren(title.el);
  const recentTitle = createPixelText(doc, { scale: 1, color: TOKENS.muted, dpr }, "RECENTLY FINISHED");
  els.recentTitle.replaceChildren(recentTitle.el);

  // The empty state: arbab waiting for work, and what to run.
  const lead = make(doc, "p", "empty-lead", "The site is quiet.");
  const hint = make(doc, "p", "empty-hint");
  hint.appendChild(make(doc, "span", "", "No lane is at work. Launch one with "));
  hint.appendChild(make(doc, "code", "", "arbab launch"));
  hint.appendChild(make(doc, "span", "", ", or "));
  hint.appendChild(make(doc, "code", "", "arbab plan next"));
  hint.appendChild(make(doc, "span", "", ": workers walk in from the village."));
  const words = make(doc, "div", "empty-words");
  words.appendChild(lead);
  words.appendChild(hint);
  els.empty.replaceChildren(createArbabTile(doc, sprites, dpr), words);

  const cards = new Map<string, Card>();
  let order: string[] = [];
  let pinned: string | null = null;
  /** The card with keyboard focus: it never moves. */
  let focused: string | null = null;
  let recentKey = "";

  const card = (name: string, lane: UiLane): Card => {
    const li = make(doc, "li", "crew-item");
    const button = make(doc, "button", "card frame-btn");
    button.setAttribute("type", "button");
    button.setAttribute("aria-pressed", "false");
    const avatar = createAvatar(doc, sprites, dpr);
    const body = make(doc, "span", "card-body");
    const head = make(doc, "span", "card-head");
    const nameEl = make(doc, "span", "name");
    const badge = createPixelText(doc, { scale: 1, color: BADGE_INK, dpr, className: "badge" });
    head.appendChild(nameEl);
    head.appendChild(badge.el);
    const meta = make(doc, "span", "meta");
    const progress = make(doc, "span", "progress");
    const bar = make(doc, "span", "bar");
    const fill = make(doc, "span", "bar-fill");
    bar.appendChild(fill);
    const calls = make(doc, "span", "calls");
    progress.appendChild(bar);
    progress.appendChild(calls);
    const foot = make(doc, "span", "card-foot");
    const stats = make(doc, "span", "stats");
    const elapsed = make(doc, "span", "elapsed");
    foot.appendChild(stats);
    foot.appendChild(elapsed);
    for (const part of [head, meta, progress, foot]) body.appendChild(part);
    button.appendChild(avatar.el);
    button.appendChild(body);
    li.appendChild(button);
    button.addEventListener("focus", () => {
      focused = name;
      on.enter(name);
    });
    button.addEventListener("mouseenter", () => on.enter(name));
    button.addEventListener("blur", () => {
      if (focused === name) focused = null;
      on.leave(name);
    });
    button.addEventListener("mouseleave", () => on.leave(name));
    button.addEventListener("click", () => on.toggle(name));
    return { li, button, avatar, name: nameEl, meta, badge, elapsed, fill, calls, stats, lane };
  };

  const fillCard = (c: Card, lane: UiLane, serverNowMs: number): void => {
    c.lane = lane;
    const { pose, ghost } = avatarPose(lane);
    c.avatar.set(workerCast(lane), pose, ghost);
    c.name.textContent = lane.name;
    c.meta.textContent = `${lane.role} · ${lane.kind}`;
    setBadge(c.badge, lane);
    c.elapsed.textContent = elapsedText(lane, serverNowMs);
    c.fill.style.width = `${Math.round(blockFill(lane) * 100)}%`;
    c.calls.textContent = `${lane.toolCalls} ${lane.toolCalls === 1 ? "call" : "calls"}`;
    c.stats.textContent = `${lane.lastTool ?? "—"} · ${formatUsd(lane.costUsd)}`;
  };

  const updateRecent = (snapshot: UiSnapshot, serverNowMs: number): void => {
    const recent = recentlyFinished(snapshot.lanes);
    const key = JSON.stringify(recent.map((l) => [l.name, l.endState, l.costUsd, l.elapsedMs, l.since]));
    els.recentGroup.hidden = recent.length === 0;
    if (key === recentKey) return;
    recentKey = key;
    els.recent.replaceChildren(
      ...recent.map((lane) => {
        const li = make(doc, "li", "recent-item");
        const avatar = createAvatar(doc, sprites, dpr);
        const { pose, ghost } = avatarPose(lane);
        avatar.set(workerCast(lane), pose, ghost);
        const badge = createPixelText(doc, { scale: 1, color: BADGE_INK, dpr });
        setBadge(badge, lane);
        li.appendChild(avatar.el);
        li.appendChild(make(doc, "span", "name", lane.name));
        li.appendChild(badge.el);
        li.appendChild(make(doc, "span", "num", formatUsd(lane.costUsd)));
        li.appendChild(make(doc, "span", "num", elapsedText(lane, serverNowMs)));
        return li;
      }),
    );
  };

  const panel: CrewPanel = {
    update(snapshot, serverNowMs) {
      title.set(crewTitle(snapshot.lanes));
      const list = crewOrder(snapshot.lanes);
      for (const lane of list) {
        let c = cards.get(lane.name);
        if (!c) {
          c = card(lane.name, lane);
          cards.set(lane.name, c);
        }
        fillCard(c, lane, serverNowMs);
      }
      const names = list.map((l) => l.name);
      order = reorder(els.list, order, names, (name) => cards.get(name)?.li, focused);
      const keep = new Set(names);
      for (const name of [...cards.keys()]) if (!keep.has(name)) cards.delete(name);
      els.empty.hidden = list.length > 0;
      updateRecent(snapshot, serverNowMs);
      if (pinned !== null && !keep.has(pinned)) pinned = null;
      panel.setPinned(pinned);
    },
    tick(serverNowMs) {
      for (const c of cards.values()) c.elapsed.textContent = elapsedText(c.lane, serverNowMs);
    },
    setPinned(name) {
      pinned = name;
      for (const [n, c] of cards) c.button.setAttribute("aria-pressed", String(n === name));
    },
    order: () => order,
    button: (name) => cards.get(name)?.button,
  };
  return panel;
}
