// The scene (DESIGN.md §19): folds snapshots into a World and animates it. Pure TypeScript for the browser: time comes
// only from snapshot.now and step(dtMs), randomness only from options.random, so the same inputs give the same world.
import type { QuotaWindow } from "../../../types";
import type { UiIntegration, UiLane, UiSnapshot } from "../../protocol";
import type {
  Actor,
  Block,
  BlockLook,
  Cast,
  Icon,
  Particle,
  ParticleKind,
  Pose,
  Scene,
  SceneEventKind,
  SceneOptions,
  World,
} from "../model";
import { ACTOR_BOX, PLACES, PYRAMID_AREA, WIDTH } from "../model";
import { campSeat, farPyramidPlace, pyramidLayout, workSpot } from "./layout";
import type { PyramidLayout, Slot } from "./layout";

const RECENT_MS = 10 * 60 * 1000;
const BASE_Y = PYRAMID_AREA.baseY;
const GROUND_Y = BASE_Y + 2;
const WALK = 28;
const SLUMP = 18;
const CLIMB = 16;
const TALK_TURN = 0.8;
const TALK_TURNS = 3;
const BUBBLE_OPEN = 0.15;
const SKEPTIC_TALK = 1.2;
const STROKE = 0.4;
const MAX_STROKES = 6;
const EASE_PER_S = 0.2;
const FLASH_FADE_PER_S = 2;
const RATION_PAUSE = 0.6;
const FADE_S = 1;
const GRAVITY = 300;
const MAX_PARTICLES = 300;
const MAX_RUBBLE = 60;
const MAX_COINS = 48;
const BASELINE_RUBBLE = 4;
const HOIST_S = 3;
const CHEER_S = 2;
const SPARKLES = 20;
const MAX_DT_MS = 100;
const LINE_GAP = 12;
/** Places in line behind the audience spot. */
const MAX_LINE = 6;
const MASON_OFFSET = 5;
const FIVE_HOURS_S = 18000;
/** How long a set capstone stays on the apex before the next landing's rises from the sledge. */
const NEXT_HOIST_PAUSE_S = 1.5;
const FALL_SHAKE = 2;
const CAPSTONE_SHAKE = 3;
const SHAKE_DECAY_PER_S = 6;
const GLOW_S = 4;
/** Seconds of walking per puff of dust underfoot. */
const DUST_EVERY_S = 0.25;
const DUST_LIFE_S = 0.5;
const DUST_POSES: ReadonlySet<Pose> = new Set<Pose>(["walk", "slump", "carry-scroll", "carry-stone", "carry-ration"]);

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers

// By kind first: a generated lane or a probe is what it does, whatever role it was given (a probe has the probed
// lane's role).
export function castOf(lane: UiLane): Cast {
  switch (lane.kind) {
    case "verify":
      return "surveyor";
    case "review":
      return "scribe";
    case "skeptic":
      return "skeptic";
    case "preflight":
      return "waterboy";
  }
  switch (lane.role) {
    case "implementer":
      return "laborer";
    case "verifier":
      return "mason";
    case "reviewer":
      return "scribe";
    case "probe":
      return "waterboy";
    case "researcher":
      return "scout";
    default:
      return "waterboy";
  }
}

export function isBuilder(lane: UiLane): boolean {
  return (
    lane.kind === "lane" && (lane.role === "implementer" || (lane.role === "verifier" && lane.worktreeOf === null))
  );
}

export interface Foreground {
  lanes: UiLane[];
  capstone: UiIntegration | null;
  capstoneLanded: boolean;
  /** The newest landing, standing finished in the foreground while it holds no lane; never also in far. */
  monument: UiIntegration | null;
  far: UiIntegration[];
}

/** Epoch ms of an ISO time; -Infinity when missing or unparsable, so it sorts oldest. */
function epochMs(iso: string | null): number {
  if (iso === null) return -Infinity;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : -Infinity;
}

/** The last of the newest by key: integrations come oldest first, so a tie goes to the later one. */
function newest<T>(items: T[], key: (item: T) => number): T | null {
  let best: T | null = null;
  let bestKey = -Infinity;
  for (const item of items) {
    const k = key(item);
    if (best === null || k >= bestKey) {
      best = item;
      bestKey = k;
    }
  }
  return best;
}

export function foreground(snapshot: UiSnapshot): Foreground {
  const now = epochMs(snapshot.now);
  const landed = snapshot.integrations
    .map((integration, index) => ({ integration, index, at: epochMs(integration.landedAt) }))
    .filter((e) => e.integration.landedAt !== null)
    .sort((a, b) => (a.at === b.at ? b.index - a.index : b.at > a.at ? 1 : -1))
    .map((e) => e.integration);
  // Every landing of the last ten minutes keeps its lanes in the foreground; the capstone shows the newest.
  const recent = new Set(landed.filter((i) => Number.isFinite(now) && now - epochMs(i.landedAt) < RECENT_MS));
  const latest = landed.find((i) => recent.has(i)) ?? null;
  const byName = new Map(snapshot.integrations.map((i) => [i.name, i]));
  const lanes = snapshot.lanes.filter((lane) => {
    if (!isBuilder(lane)) return false;
    if (lane.integration === null) return true;
    const integration = byName.get(lane.integration);
    // Missing: older than the five landed the snapshot keeps, so long landed.
    if (integration === undefined) return false;
    return integration.landedAt === null || recent.has(integration);
  });
  let capstone = latest;
  if (capstone === null) {
    const names = new Set(lanes.map((l) => l.name));
    const open = snapshot.integrations.filter((i) => i.landedAt === null && i.lanes.some((n) => names.has(n)));
    capstone = newest(open, (i) => epochMs(i.updatedAt));
  }
  // A recent landing holds the foreground with its lanes, so only an older one can stand as the monument.
  const monument = lanes.length === 0 && latest === null ? (landed[0] ?? null) : null;
  const far = landed.filter((i) => !recent.has(i) && i !== monument).slice(0, 3);
  return { lanes, capstone, capstoneLanded: latest !== null, monument, far };
}

/** min(0.95, 1 − e^(−calls/40)) */
export function fillFor(toolCalls: number): number {
  const calls = Number.isFinite(toolCalls) ? Math.max(0, toolCalls) : 0;
  return Math.min(0.95, 1 - Math.exp(-calls / 40));
}

/** 1 under $1, 2 under $5, else 3: of costDeltaUsd, else costUsd, else 0 → 1. */
export function rationFor(lane: UiLane): 1 | 2 | 3 {
  const raw = lane.costDeltaUsd ?? lane.costUsd ?? 0;
  const cost = Number.isFinite(raw) ? raw : 0;
  return cost < 1 ? 1 : cost < 5 ? 2 : 3;
}

/** What a worker takes home after its report: a ration on success, a loaf on a partial report, else nothing. */
function rationOnLeaving(lane: UiLane): 0 | 1 | 2 | 3 {
  if (lane.reportStatus === "partial") return 1;
  if (lane.reportStatus === "blocked") return 0;
  return lane.endState === "success" ? rationFor(lane) : 0;
}

function lookFor(lane: UiLane): BlockLook {
  switch (lane.state) {
    case "running":
      return "building";
    case "waiting-reset":
      return "stalled";
    case "orphaned":
      return "orphaned";
    case "finished":
      if (lane.reportStatus === "partial" || lane.reportStatus === "blocked") return "stalled";
      return lane.endState === "success" ? "set" : "fallen";
    default:
      return "planned";
  }
}

function costOf(lane: UiLane): number {
  return typeof lane.costUsd === "number" && Number.isFinite(lane.costUsd) ? Math.max(0, lane.costUsd) : 0;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

// ---------------------------------------------------------------------------------------------------------------
// The scene

interface Point {
  x: number;
  y: number;
}

/** A point, or the worker's work place resolved when the step starts (the layout may change before that). */
type Target = Point | "work";

type Step =
  | { kind: "go"; to: Target; pose: Pose; alpha?: number; ration?: 0 | 1 | 2 | 3 }
  | { kind: "move"; x: number; y: number; pose: Pose; speed: number }
  | { kind: "hold"; pose: Pose; time: number; icon?: Icon; ghost?: boolean; alpha?: number; faceCenter?: boolean }
  | { kind: "talk"; event: "brief" | "report" }
  | { kind: "exit" };

interface Crew {
  actor: Actor;
  lane: UiLane;
  builder: boolean;
  queue: Step[];
  /** The head step has started. */
  begun: boolean;
  /** Seconds into the head hold. */
  elapsed: number;
  /** When the queue runs dry, the cast's round (scribe, water carrier, scout) refills it. */
  loop: boolean;
  /** The brief was handed out for this run. */
  briefed: boolean;
  pending: number;
  /** The work place this worker last headed for; a layout change that moves it sends the worker again. */
  spot: Point | null;
  seat: number | null;
  fading: boolean;
  /** On its way down the ladder to queue for a talk. */
  descending: boolean;
  chatIn: number | null;
  chatLeft: number;
  /** Seconds walked since the last puff of dust. */
  dust: number;
}

interface Talk {
  crew: Crew;
  t: number;
  turn: number;
}

function go(to: Target, pose: Pose, extra: { alpha?: number; ration?: 0 | 1 | 2 | 3 } = {}): Step {
  return { kind: "go", to, pose, ...extra };
}

function hold(
  pose: Pose,
  time: number,
  extra: { icon?: Icon; ghost?: boolean; alpha?: number; faceCenter?: boolean } = {},
): Step {
  return { kind: "hold", pose, time, ...extra };
}

function setPose(actor: Actor, pose: Pose): void {
  if (actor.pose !== pose) {
    actor.pose = pose;
    actor.poseTime = 0;
  }
}

/**
 * Above baseY within the pyramid's area: reached by ladder. The camp, the well and the horizon also lie above baseY,
 * but off to the sides, on the dunes.
 */
function onPyramid(p: Point): boolean {
  const half = PYRAMID_AREA.maxWidth / 2;
  return p.y < BASE_Y && p.x >= PYRAMID_AREA.centerX - half && p.x <= PYRAMID_AREA.centerX + half;
}

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

function newActor(id: string, lane: string | null, cast: Cast, at: Point): Actor {
  return {
    id,
    lane,
    cast,
    x: at.x,
    y: at.y,
    facing: 1,
    pose: "idle",
    poseTime: 0,
    stroke: 0,
    ration: 0,
    icon: null,
    bubble: null,
    alpha: 1,
    ghost: false,
    highlight: false,
  };
}

function emptyBlock(slot: Slot): Block {
  return { lane: null, x: slot.x, y: slot.y, w: slot.w, h: slot.h, look: "empty", fill: 0, flash: 0, highlight: false };
}

/** A scene that folds snapshots into its world and animates it. */
export function createScene(options: SceneOptions): Scene {
  const reduced = options.reducedMotion;
  const random = options.random;
  const arbab = newActor("arbab", null, "arbab", PLACES.arbab);
  let layout: PyramidLayout = pyramidLayout(0);
  const world: World = {
    sky: { phase: "day", sun: 0.5 },
    pyramid: {
      base: layout.base,
      blockW: layout.blockW,
      blockH: layout.blockH,
      blocks: layout.slots.map(emptyBlock),
      rubble: 0,
      apex: { ...layout.apex },
      capstone: { state: "none", integration: null, ...PLACES.sledge, flag: "none", ready: false, glow: 0 },
      monument: null,
    },
    far: [],
    actors: [arbab],
    particles: [],
    coins: 0,
    events: [],
    reducedMotion: reduced,
    time: 0,
    shake: 0,
  };

  const crews = new Map<string, Crew>();
  const blocks = new Map<string, Block>();
  const targets = new Map<string, number>();
  const line: Crew[] = [];
  let talk: Talk | null = null;
  let slots = new Map<string, Slot>();
  let prev = new Map<string, UiLane>();
  let started = false;
  let hoist = 0;
  /** The landing whose capstone rises once the one rising now has set. */
  let nextLanding: UiIntegration | null = null;
  /** Seconds the set capstone still stays on the apex before nextLanding's rises. */
  let pause = 0;
  let cheer = 0;
  let highlighted: string | null = null;
  let actorsDirty = false;

  const seed = (): number => Math.floor(random() * 0x7fffffff);
  const emit = (kind: SceneEventKind, lane: string | null): void => {
    world.events.push({ kind, lane });
  };

  // --- places

  const foot = (): Point => ({ x: PYRAMID_AREA.centerX, y: GROUND_Y });
  const halfWidth = (): number => (layout.base * layout.blockW) / 2;
  const footX = (from: number, to: number): number => {
    const left = PYRAMID_AREA.centerX - halfWidth();
    return Math.round(left + (from + (to - from) * random()) * 2 * halfWidth());
  };

  function workPlace(c: Crew): Point | null {
    if (c.builder) {
      const slot = slots.get(c.lane.name);
      return slot ? workSpot(slot) : foot();
    }
    switch (c.actor.cast) {
      case "mason": {
        const slot = c.lane.worktreeOf === null ? undefined : slots.get(c.lane.worktreeOf);
        if (!slot) return foot();
        const spot = workSpot(slot);
        return { x: spot.x + MASON_OFFSET, y: spot.y };
      }
      case "surveyor":
        return { x: PLACES.sledge.x - 14, y: GROUND_Y };
      default:
        return null;
    }
  }

  /** A random slot of the two lowest courses, where scribes write. */
  function lowSpot(): Point {
    const low = layout.slots.filter((s) => s.course < 2);
    const slot = low[Math.min(low.length - 1, Math.floor(random() * low.length))];
    return slot ? workSpot(slot) : foot();
  }

  /** Where a worker without a fixed work place stands when the scene puts it somewhere without a walk. */
  function defaultPlace(c: Crew): Point {
    switch (c.actor.cast) {
      case "scribe":
      case "skeptic":
        return lowSpot();
      case "waterboy":
        return { ...PLACES.well };
      default:
        return { x: footX(0.5, 1), y: GROUND_Y };
    }
  }

  const offCanvas = (a: Actor): boolean => a.x < 0 || a.x > WIDTH;

  function resolve(c: Crew, to: Target): Point {
    if (to !== "work") return to;
    const place = workPlace(c) ?? foot();
    c.spot = place;
    return place;
  }

  /**
   * Moves from where the actor stands: off the pyramid by its ladder, along the ground, up the target's ladder. A
   * builder carrying its stone climbs up with it on its back; every other climb is empty-handed.
   */
  function path(from: Point, to: Point, pose: Pose): Step[] {
    const speed = pose === "slump" ? SLUMP : WALK;
    const up: Pose = pose === "carry-stone" ? "climb-stone" : "climb";
    const steps: Step[] = [];
    const fromUp = onPyramid(from);
    const toUp = onPyramid(to);
    if (fromUp && toUp && from.x === to.x) {
      return [{ kind: "move", x: to.x, y: to.y, pose: to.y < from.y ? up : "climb", speed: CLIMB }];
    }
    if (fromUp) steps.push({ kind: "move", x: from.x, y: GROUND_Y, pose: "climb", speed: CLIMB });
    if (toUp) {
      steps.push({ kind: "move", x: to.x, y: GROUND_Y, pose, speed });
      steps.push({ kind: "move", x: to.x, y: to.y, pose: up, speed: CLIMB });
    } else {
      steps.push({ kind: "move", x: to.x, y: to.y, pose, speed });
    }
    return steps;
  }

  // --- seats, the talk line

  function takeSeat(c: Crew): number {
    if (c.seat !== null) return c.seat;
    const used = new Set<number>();
    for (const other of crews.values()) if (other.seat !== null) used.add(other.seat);
    let i = 0;
    while (used.has(i)) i += 1;
    c.seat = i;
    return i;
  }

  function leaveLine(c: Crew): void {
    const i = line.indexOf(c);
    if (i >= 0) line.splice(i, 1);
    if (talk?.crew === c) {
      talk = null;
      arbab.bubble = null;
      c.actor.bubble = null;
    }
  }

  function removeCrew(c: Crew): void {
    leaveLine(c);
    c.seat = null;
    if (crews.get(c.lane.name) === c) crews.delete(c.lane.name);
    actorsDirty = true;
  }

  // --- particles

  function addParticle(kind: ParticleKind, x: number, y: number, vx: number, vy: number, life: number): void {
    if (reduced) return;
    const p: Particle = { kind, x, y, vx, vy, life };
    world.particles.push(p);
    if (world.particles.length > MAX_PARTICLES) world.particles.splice(0, world.particles.length - MAX_PARTICLES);
  }

  const addRubble = (n: number): void => {
    world.pyramid.rubble = Math.min(MAX_RUBBLE, world.pyramid.rubble + n);
  };

  // --- scripts

  /** Replaces the worker's steps with its state's script, from where it stands. */
  function rescript(c: Crew): void {
    leaveLine(c);
    const lane = c.lane;
    const a = c.actor;
    if (lane.state !== "queued" && lane.state !== "held") c.seat = null;
    c.queue = [];
    c.loop = false;
    c.spot = null;
    c.begun = false;
    c.elapsed = 0;
    c.chatIn = null;
    c.chatLeft = 0;
    c.descending = false;
    a.alpha = 1;
    a.stroke = 0;
    a.bubble = null;
    switch (lane.state) {
      case "queued":
      case "held": {
        // A held lane waits for a slot or, by default, for the quota (NO_FREE_SLOT_REASON).
        const held: { icon?: Icon } = lane.state === "held" ? { icon: lane.hold === "slot" ? "dots" : "hourglass" } : {};
        c.queue.push(go(campSeat(takeSeat(c)), "walk"), hold("sit", Infinity, held));
        break;
      }
      case "preparing":
      case "running":
        if (!c.briefed) c.queue.push({ kind: "talk", event: "brief" });
        if (workPlace(c) !== null) {
          c.queue.push(go("work", c.builder ? "carry-stone" : "walk"), hold("work", Infinity, { faceCenter: true }));
        } else {
          c.loop = true;
        }
        break;
      case "waiting-reset": {
        const place: Target =
          workPlace(c) !== null ? "work" : c.briefed && !offCanvas(a) ? { x: a.x, y: a.y } : defaultPlace(c);
        c.queue.push(go(place, "walk"), hold("sleep", Infinity, { icon: "zzz", faceCenter: true }));
        break;
      }
      case "finished": {
        const ration = rationOnLeaving(lane);
        c.queue.push(
          { kind: "talk", event: "report" },
          go({ ...PLACES.rations }, "walk"),
          hold("idle", RATION_PAUSE),
          go({ ...PLACES.exit }, ration > 0 ? "carry-ration" : "slump", { ration }),
          { kind: "exit" },
        );
        break;
      }
      case "orphaned":
        if (offCanvas(a)) c.queue.push(go(workPlace(c) !== null ? "work" : defaultPlace(c), "walk"));
        c.queue.push(hold("idle", Infinity, { ghost: true, icon: "question" }));
        break;
      default:
        c.queue.push(hold("idle", Infinity));
    }
    advance(c, 0);
  }

  /** One round of a worker without a fixed place. */
  function loopSteps(c: Crew): Step[] {
    switch (c.actor.cast) {
      case "scribe":
      case "skeptic":
        return [go(lowSpot(), "walk"), hold("work", 3 + 3 * random(), { faceCenter: true })];
      case "waterboy":
        return [
          go({ ...PLACES.well }, "walk"),
          hold("idle", 1),
          go({ x: footX(0, 1), y: GROUND_Y }, "walk"),
          hold("idle", 1),
        ];
      case "scout": {
        const away = 6 + 4 * random();
        return [
          go({ ...PLACES.horizon }, "walk"),
          hold("idle", away, { alpha: 0 }),
          go({ x: footX(0.5, 1), y: GROUND_Y }, "walk", { alpha: 1 }),
          hold("idle", 2),
        ];
      }
      default:
        return [hold("idle", Infinity)];
    }
  }

  function next(c: Crew): void {
    c.queue.shift();
    c.begun = false;
    c.elapsed = 0;
  }

  /** Starts the head step; true when it rewrote the queue (a go became moves, a talk climbs down first). */
  function begin(c: Crew, step: Step): boolean {
    const a = c.actor;
    a.bubble = null;
    a.stroke = 0;
    c.chatLeft = 0;
    if (step.kind === "go") {
      const to = resolve(c, step.to);
      if (step.alpha !== undefined) a.alpha = step.alpha;
      if (step.ration !== undefined) a.ration = step.ration;
      c.queue.splice(0, 1, ...path(a, to, step.pose));
      return true;
    }
    a.icon = step.kind === "hold" ? (step.icon ?? null) : null;
    a.ghost = step.kind === "hold" && step.ghost === true;
    if (step.kind === "hold") {
      setPose(a, step.pose);
      if (step.alpha !== undefined) a.alpha = step.alpha;
      if (step.faceCenter) a.facing = a.x <= PYRAMID_AREA.centerX ? 1 : -1;
    }
    return false;
  }

  /** Moves toward a point; the time left on arrival, or -1 while still on the way. */
  function moveToward(a: Actor, to: Point, pose: Pose, speed: number, dt: number): number {
    const dx = to.x - a.x;
    const dy = to.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return dt;
    if (dx !== 0) a.facing = dx > 0 ? 1 : -1;
    setPose(a, pose);
    if (reduced || speed * dt >= dist) {
      a.x = to.x;
      a.y = to.y;
      return reduced ? dt : Math.max(0, dt - dist / speed);
    }
    a.x += (dx / dist) * speed * dt;
    a.y += (dy / dist) * speed * dt;
    return -1;
  }

  /** Runs the actor's steps for dt seconds. */
  function advance(c: Crew, dt: number): void {
    const a = c.actor;
    let left = dt;
    for (let guard = 0; guard < 64; guard += 1) {
      if (crews.get(c.lane.name) !== c) return;
      if (c.queue.length === 0) {
        if (!c.loop) {
          setPose(a, "idle");
          return;
        }
        c.queue = loopSteps(c);
        c.begun = false;
      }
      const step = c.queue[0];
      if (step === undefined) return;
      if (!c.begun) {
        c.begun = true;
        c.elapsed = 0;
        if (begin(c, step)) {
          c.begun = false;
          continue;
        }
      }
      switch (step.kind) {
        case "go":
          continue;
        case "move":
          left = moveToward(a, step, step.pose, step.speed, left);
          if (left < 0) return;
          next(c);
          continue;
        case "hold": {
          const use = Math.min(left, step.time - c.elapsed);
          c.elapsed += use;
          left -= use;
          if (step.pose === "work") work(c, use);
          if (c.elapsed < step.time) return;
          next(c);
          continue;
        }
        case "talk":
          left = talkStep(c, step.event, left);
          if (left < 0) return;
          next(c);
          continue;
        case "exit":
          removeCrew(c);
          return;
      }
    }
  }

  // --- talks with arbab

  /**
   * The talk step: queue up, step up to the audience spot, talk; the time left when done, or -1. At most MAX_LINE stand
   * behind the audience spot, so the line stays on the canvas; the rest wait where they are, in arrival order.
   */
  function talkStep(c: Crew, event: "brief" | "report", dt: number): number {
    const a = c.actor;
    let left = dt;
    if (!line.includes(c)) line.push(c);
    if (talk?.crew !== c) {
      const k = line.indexOf(c);
      if (k > MAX_LINE) {
        if (a.pose !== "sit") setPose(a, "idle");
        return -1;
      }
      // Down the ladder to the ground line first; onPyramid turns false a step before the ladder's foot.
      if (onPyramid(a)) c.descending = true;
      if (c.descending) {
        left = moveToward(a, { x: a.x, y: GROUND_Y }, "climb", CLIMB, left);
        if (left < 0) return -1;
        c.descending = false;
      }
      const spot = { x: PLACES.audience.x + LINE_GAP * k, y: PLACES.audience.y };
      left = moveToward(a, spot, "walk", WALK, left);
      if (left < 0) return -1;
      a.facing = -1;
      if (k !== 0 || talk !== null) {
        setPose(a, "idle");
        return -1;
      }
      talk = { crew: c, t: 0, turn: -1 };
    }
    const t = talk;
    t.t += left;
    const turn = Math.min(TALK_TURNS - 1, Math.floor(t.t / TALK_TURN));
    while (t.turn < turn) {
      t.turn += 1;
      const workerSpeaks = t.turn === 1;
      const bubble = { seed: seed(), open: 0 };
      a.bubble = workerSpeaks ? bubble : null;
      arbab.bubble = workerSpeaks ? null : bubble;
    }
    const speaker = t.turn === 1 ? a : arbab;
    if (speaker.bubble) speaker.bubble.open = reduced ? 1 : Math.min(1, (t.t - t.turn * TALK_TURN) / BUBBLE_OPEN);
    setPose(a, t.turn === 1 ? "talk" : "idle");
    a.facing = -1;
    if (t.t < TALK_TURNS * TALK_TURN) return -1;
    const rest = t.t - TALK_TURNS * TALK_TURN;
    talk = null;
    arbab.bubble = null;
    a.bubble = null;
    const i = line.indexOf(c);
    if (i >= 0) line.splice(i, 1);
    if (event === "brief") c.briefed = true;
    emit(event, c.lane.name);
    return rest;
  }

  // --- work: strokes, stones, a skeptic's remarks

  function work(c: Crew, dt: number): void {
    const a = c.actor;
    let left = dt;
    while (left > 0 && c.pending > 0) {
      const before = a.stroke;
      const need = (1 - before) * STROKE;
      if (left >= need) {
        a.stroke = 1;
        left -= need;
      } else {
        a.stroke = before + left / STROKE;
        left = 0;
      }
      if (before < 0.5 && a.stroke >= 0.5) placeStone(c);
      if (a.stroke >= 1) {
        a.stroke = 0;
        c.pending -= 1;
      }
    }
    if (a.cast === "skeptic") remark(c, dt);
  }

  function placeStone(c: Crew): void {
    if (!c.builder) return;
    const name = c.lane.name;
    const block = blocks.get(name);
    if (!block || !slots.has(name)) return;
    const target = targets.get(name) ?? 0;
    const grown = reduced ? target : block.fill + Math.max(0.02, (target - block.fill) / Math.max(1, c.pending));
    block.fill = Math.max(block.fill, Math.min(target, grown));
    block.flash = 1;
    if (!reduced) {
      const n = 3 + Math.floor(random() * 3);
      for (let i = 0; i < n; i += 1) {
        const x = block.x + random() * block.w;
        const y = block.y + random() * block.h;
        addParticle("dust", x, y, (random() - 0.5) * 16, -(10 + 20 * random()), 0.5);
      }
    }
    emit("stone", name);
  }

  function remark(c: Crew, dt: number): void {
    const a = c.actor;
    if (c.chatLeft > 0) {
      c.chatLeft -= dt;
      if (a.bubble) a.bubble.open = reduced ? 1 : Math.min(1, a.bubble.open + dt / BUBBLE_OPEN);
      if (c.chatLeft <= 0) {
        a.bubble = null;
        c.chatIn = 4 + 4 * random();
      }
      return;
    }
    if (c.chatIn === null) c.chatIn = 4 + 4 * random();
    c.chatIn -= dt;
    if (c.chatIn <= 0) {
      a.bubble = { seed: seed(), open: reduced ? 1 : 0 };
      c.chatLeft = SKEPTIC_TALK;
    }
  }

  // --- blocks

  function fall(block: Block): void {
    const n = Math.round(block.fill * 8);
    if (reduced) {
      addRubble(n);
    } else {
      for (let i = 0; i < n; i += 1) {
        const x = block.x + random() * block.w;
        const y = block.y + random() * block.h;
        addParticle("stone", x, y, (random() * 2 - 1) * 40, 0, 5);
      }
      world.shake = Math.max(world.shake, FALL_SHAKE);
    }
    block.fill = 0;
    emit("fall", block.lane);
  }

  function foldBlock(lane: UiLane, before: UiLane | undefined, first: boolean): void {
    const name = lane.name;
    const look = lookFor(lane);
    const target = fillFor(lane.toolCalls);
    targets.set(name, target);
    const slot = slots.get(name);
    let block = blocks.get(name);
    const unseen = block === undefined;
    if (block === undefined) {
      block = { lane: name, x: 0, y: 0, w: 0, h: 0, look, fill: 0, flash: 0, highlight: false };
      blocks.set(name, block);
    }
    if (slot) Object.assign(block, { x: slot.x, y: slot.y, w: slot.w, h: slot.h });
    if (unseen || before === undefined) {
      block.look = look;
      block.flash = 0;
      // A lane seen first while live builds from nothing; its strokes fill the block.
      if (look === "set") block.fill = 1;
      else if (look === "planned" || look === "fallen" || (!first && look === "building")) block.fill = 0;
      else block.fill = target;
      if (first && look === "fallen") addRubble(BASELINE_RUBBLE);
      return;
    }
    if (before.state === "finished" && lane.state !== "finished") {
      block.fill = 0;
      block.flash = 0;
    }
    if (look !== block.look && slot) {
      if (look === "set") {
        block.fill = 1;
        block.flash = 1;
        emit("set", name);
      } else if (look === "fallen") {
        fall(block);
      }
    }
    block.look = look;
    if (reduced && look === "building") block.fill = Math.max(block.fill, target);
  }

  // --- folding a snapshot

  function spawn(lane: UiLane): Crew {
    const c: Crew = {
      actor: newActor(lane.name, lane.name, castOf(lane), PLACES.spawn),
      lane,
      builder: isBuilder(lane),
      queue: [],
      begun: false,
      elapsed: 0,
      loop: false,
      briefed: false,
      pending: 0,
      spot: null,
      seat: null,
      fading: false,
      descending: false,
      chatIn: null,
      chatLeft: 0,
      dust: 0,
    };
    crews.set(lane.name, c);
    actorsDirty = true;
    return c;
  }

  /** Puts a worker where its script leads, without walking: the first snapshot sets the scene as it stands. */
  function settle(c: Crew): void {
    const a = c.actor;
    for (let guard = 0; guard < 64; guard += 1) {
      if (c.queue.length === 0) {
        if (!c.loop) break;
        c.queue = loopSteps(c);
        c.begun = false;
      }
      const step = c.queue[0];
      if (step === undefined) break;
      if (step.kind === "go") {
        const to = resolve(c, step.to);
        if (step.alpha !== undefined) a.alpha = step.alpha;
        a.x = to.x;
        a.y = to.y;
        next(c);
      } else if (step.kind === "move") {
        a.x = step.x;
        a.y = step.y;
        next(c);
      } else {
        break;
      }
    }
    advance(c, 0);
  }

  function foldLane(lane: UiLane, before: UiLane | undefined, first: boolean): void {
    const name = lane.name;
    let c = crews.get(name);
    if (c?.fading) {
      removeCrew(c);
      c = undefined;
    }
    if (isBuilder(lane)) foldBlock(lane, before, first);
    else {
      blocks.delete(name);
      targets.delete(name);
    }
    if (first) {
      if (lane.state === "finished") return;
      const fresh = spawn(lane);
      fresh.briefed = lane.state !== "queued" && lane.state !== "held";
      rescript(fresh);
      settle(fresh);
      return;
    }
    if (c === undefined) {
      if (lane.state === "finished") return;
      c = spawn(lane);
      rescript(c);
    } else {
      c.lane = lane;
      const changed =
        before === undefined || before.state !== lane.state || (lane.state === "held" && before.hold !== lane.hold);
      if (changed) {
        if (before?.state === "finished") {
          c.briefed = false;
          c.actor.ration = 0;
        }
        if (lane.state !== "running") c.pending = 0;
        rescript(c);
      }
    }
    if (lane.state === "running") {
      const was = before !== undefined && before.attempt === lane.attempt ? before.toolCalls : 0;
      const d = lane.toolCalls - was;
      if (d > 0) c.pending = Math.min(MAX_STROKES, c.pending + d);
    }
  }

  function leave(name: string): void {
    const c = crews.get(name);
    if (c && !c.fading) {
      leaveLine(c);
      c.seat = null;
      c.fading = true;
      c.queue = [];
      c.loop = false;
      c.pending = 0;
      c.spot = null;
      c.actor.stroke = 0;
      c.actor.bubble = null;
    }
    blocks.delete(name);
    targets.delete(name);
  }

  function dressCapstone(integration: UiIntegration): void {
    const cap = world.pyramid.capstone;
    cap.integration = integration.name;
    cap.flag = integration.verify === "passed" ? "passed" : integration.verify === "failed" ? "failed" : "none";
    cap.ready = integration.ready === true;
  }

  function startHoist(): void {
    Object.assign(world.pyramid.capstone, { state: "hoisting", ...PLACES.sledge, glow: 0 });
    hoist = 0;
  }

  function foldCapstone(fg: Foreground, first: boolean): void {
    const cap = world.pyramid.capstone;
    const integration = fg.capstone;
    // A landing that comes while another's capstone rises (or stands its pause on the apex) waits for that one to
    // set, then rises from the sledge.
    const busy = cap.state === "hoisting" || pause > 0;
    if (fg.capstoneLanded && integration !== null && busy && cap.integration !== integration.name) {
      nextLanding = integration;
      return;
    }
    nextLanding = null;
    pause = 0;
    if (fg.monument !== null) {
      dressCapstone(fg.monument);
      Object.assign(cap, { state: "set", ...world.pyramid.apex, ready: true, glow: 0 });
      return;
    }
    if (integration === null) {
      Object.assign(cap, { state: "none", integration: null, ...PLACES.sledge, flag: "none", ready: false, glow: 0 });
      return;
    }
    const same = cap.integration === integration.name;
    dressCapstone(integration);
    if (!fg.capstoneLanded) {
      Object.assign(cap, { state: "waiting", ...PLACES.sledge, glow: 0 });
      return;
    }
    if (same && cap.state === "hoisting") return;
    if (same && cap.state === "set") {
      Object.assign(cap, world.pyramid.apex);
      return;
    }
    if (first) {
      Object.assign(cap, { state: "set", ...world.pyramid.apex, glow: 0 });
      return;
    }
    startHoist();
    if (reduced) setCapstone();
  }

  function setCapstone(): void {
    const cap = world.pyramid.capstone;
    const apex = world.pyramid.apex;
    Object.assign(cap, { state: "set", ...apex, glow: 1 });
    if (!reduced) world.shake = Math.max(world.shake, CAPSTONE_SHAKE);
    for (let i = 0; i < SPARKLES && !reduced; i += 1) {
      const x = apex.x + (random() - 0.5) * 8;
      const y = apex.y - random() * 6;
      addParticle("sparkle", x, y, (random() - 0.5) * 12, -random() * 10, 0.8);
    }
    emit("capstone", cap.integration);
    cheer = CHEER_S;
  }

  function foldSky(snapshot: UiSnapshot): void {
    const nowSec = epochMs(snapshot.now) / 1000;
    const q = snapshot.quota;
    const live = (w: QuotaWindow | null): QuotaWindow | null =>
      w !== null && Number.isFinite(nowSec) && w.resetsAt > nowSec ? w : null;
    const five = live(q.fiveHour);
    const seven = live(q.sevenDay);
    world.sky.phase =
      q.status === "rejected" && (five !== null || seven !== null) ? "night" : q.hold.hold ? "dusk" : "day";
    world.sky.sun = five !== null ? Math.min(1, Math.max(0, 1 - (five.resetsAt - nowSec) / FIVE_HOURS_S)) : 0.5;
  }

  function foldCoins(snapshot: UiSnapshot, first: boolean): void {
    const total = snapshot.lanes.reduce((sum, lane) => sum + costOf(lane), 0);
    const coins = Math.min(MAX_COINS, Math.round(6 * Math.sqrt(total)));
    if (!first && coins > world.coins && !reduced) {
      const n = 1 + Math.floor(random() * 3);
      for (let i = 0; i < n; i += 1) {
        const x = PLACES.treasury.x + (random() - 0.5) * 6;
        addParticle("coin", x, PLACES.treasury.y - 8, (random() - 0.5) * 20, -40, 0.6);
      }
    }
    world.coins = coins;
  }

  function rebuildPyramid(fg: Foreground): void {
    const p = world.pyramid;
    p.base = layout.base;
    p.blockW = layout.blockW;
    p.blockH = layout.blockH;
    p.apex = { ...layout.apex };
    const monument = fg.monument;
    p.monument = monument === null ? null : monument.name;
    if (monument !== null) {
      // Finished: every slot is set, the merged lanes in order on the first ones.
      p.blocks = layout.slots.map((slot, i) => ({
        ...emptyBlock(slot),
        lane: monument.lanes[i] ?? null,
        look: "set",
        fill: 1,
      }));
      return;
    }
    p.blocks = layout.slots.map((slot, i) => {
      const lane = fg.lanes[i];
      const block = lane === undefined ? undefined : blocks.get(lane.name);
      if (block === undefined) return emptyBlock(slot);
      Object.assign(block, { x: slot.x, y: slot.y, w: slot.w, h: slot.h });
      return block;
    });
    if (p.capstone.state === "set") Object.assign(p.capstone, p.apex);
  }

  /** Sends workers whose work place moved (a lane left, the pyramid grew) there again. */
  function relocate(reshaped: boolean): void {
    for (const c of [...crews.values()]) {
      if (c.fading || line.includes(c)) continue;
      const place = workPlace(c);
      if (c.spot !== null && place !== null && !samePoint(c.spot, place)) rescript(c);
      else if (reshaped && c.loop && (c.lane.state === "running" || c.lane.state === "preparing")) rescript(c);
    }
  }

  function refreshActors(): void {
    if (!actorsDirty) return;
    actorsDirty = false;
    world.actors.length = 0;
    world.actors.push(arbab);
    for (const c of crews.values()) world.actors.push(c.actor);
    markHighlight();
  }

  function markHighlight(): void {
    for (const a of world.actors) a.highlight = highlighted !== null && a.lane === highlighted;
    for (const b of world.pyramid.blocks) b.highlight = highlighted !== null && b.lane === highlighted;
  }

  function updateArbab(): void {
    arbab.x = PLACES.arbab.x;
    arbab.y = PLACES.arbab.y;
    arbab.facing = 1;
    setPose(arbab, cheer > 0 ? "cheer" : talk !== null && talk.turn >= 0 && talk.turn !== 1 ? "talk" : "idle");
  }

  function apply(snapshot: UiSnapshot): void {
    const first = !started;
    started = true;
    const fg = foreground(snapshot);
    foldSky(snapshot);
    const old = layout;
    layout = pyramidLayout(fg.monument === null ? fg.lanes.length : fg.monument.lanes.length);
    const reshaped = old.base !== layout.base || old.blockW !== layout.blockW || old.blockH !== layout.blockH;
    slots = new Map();
    fg.lanes.forEach((lane, i) => {
      const slot = layout.slots[i];
      if (slot) slots.set(lane.name, slot);
    });
    // The pyramid's geometry first: effects of this snapshot (a fall, a hoist) happen at the new places.
    world.pyramid.apex = { ...layout.apex };
    const present = new Set(snapshot.lanes.map((l) => l.name));
    for (const name of prev.keys()) if (!present.has(name)) leave(name);
    for (const lane of snapshot.lanes) foldLane(lane, prev.get(lane.name), first);
    rebuildPyramid(fg);
    relocate(reshaped);
    foldCapstone(fg, first);
    world.far = fg.far.map((integration, i) => ({
      integration: integration.name,
      ...farPyramidPlace(i, integration.lanes.length),
    }));
    foldCoins(snapshot, first);
    prev = new Map(snapshot.lanes.map((l) => [l.name, l]));
    actorsDirty = true;
    refreshActors();
    updateArbab();
  }

  function step(dtMs: number): void {
    const dt = Math.min(MAX_DT_MS, Number.isFinite(dtMs) ? Math.max(0, dtMs) : 0) / 1000;
    if (dt <= 0) return;
    world.time += dt;
    arbab.poseTime += dt;
    // Before the effects of this frame, so a fall or a set in it shakes and glows at full strength.
    world.shake = Math.max(0, world.shake - SHAKE_DECAY_PER_S * dt);
    const cap = world.pyramid.capstone;
    cap.glow = Math.max(0, cap.glow - dt / GLOW_S);
    // Before the strokes, so a stone placed in this frame shows its full shine.
    for (const block of blocks.values()) block.flash = Math.max(0, block.flash - FLASH_FADE_PER_S * dt);
    for (const c of [...crews.values()]) {
      c.actor.poseTime += dt;
      if (c.fading) {
        c.actor.alpha = Math.max(0, c.actor.alpha - dt / FADE_S);
        if (c.actor.alpha <= 0) removeCrew(c);
        continue;
      }
      const { x, y } = c.actor;
      advance(c, dt);
      kickDust(c, dt, c.actor.x !== x || c.actor.y !== y);
    }
    for (const [name, block] of blocks) {
      if (block.look !== "building") continue;
      const target = targets.get(name) ?? 0;
      if (reduced) block.fill = Math.max(block.fill, target);
      else if ((crews.get(name)?.pending ?? 0) === 0 && block.fill < target) {
        block.fill = Math.min(target, block.fill + EASE_PER_S * dt);
      }
    }
    if (cap.state === "hoisting") {
      hoist = Math.min(1, hoist + dt / HOIST_S);
      const e = easeInOut(hoist);
      const apex = world.pyramid.apex;
      cap.x = PLACES.sledge.x + (apex.x - PLACES.sledge.x) * e;
      cap.y = PLACES.sledge.y + (apex.y - PLACES.sledge.y) * e;
      if (hoist >= 1) {
        setCapstone();
        // The set capstone is seen on the apex before the next landing's rises.
        if (nextLanding !== null) pause = NEXT_HOIST_PAUSE_S;
      }
    } else if (pause > 0) {
      pause = Math.max(0, pause - dt);
      if (pause === 0 && nextLanding !== null) {
        dressCapstone(nextLanding);
        nextLanding = null;
        startHoist();
      }
    }
    stepParticles(dt);
    cheer = Math.max(0, cheer - dt);
    updateArbab();
    refreshActors();
  }

  /** A puff of dust at the feet for every DUST_EVERY_S a worker walks on the ground (a climb raises none). */
  function kickDust(c: Crew, dt: number, moved: boolean): void {
    const a = c.actor;
    if (reduced || !moved || !DUST_POSES.has(a.pose)) return;
    c.dust += dt;
    while (c.dust >= DUST_EVERY_S) {
      c.dust -= DUST_EVERY_S;
      addParticle("dust", a.x, a.y, -4 + 8 * random(), -6 + 4 * random(), DUST_LIFE_S);
    }
  }

  function stepParticles(dt: number): void {
    let kept = 0;
    for (const p of world.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === "stone" || p.kind === "coin") p.vy += GRAVITY * dt;
      p.life -= dt;
      if (p.kind === "stone" && p.y >= BASE_Y) {
        addRubble(1);
        continue;
      }
      if (p.life <= 0) continue;
      world.particles[kept] = p;
      kept += 1;
    }
    world.particles.length = kept;
  }

  function pick(x: number, y: number): string | null {
    const actors = world.actors
      .map((a, i) => ({ a, i }))
      .filter(({ a }) => a.lane !== null && a.cast !== "arbab" && a.alpha >= 0.1)
      .sort((p, q) => (q.a.y === p.a.y ? q.i - p.i : q.a.y - p.a.y));
    for (const { a } of actors) {
      if (x >= a.x - ACTOR_BOX.w / 2 && x <= a.x + ACTOR_BOX.w / 2 && y >= a.y - ACTOR_BOX.h && y <= a.y) return a.lane;
    }
    for (const b of world.pyramid.blocks) {
      if (b.lane !== null && x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return b.lane;
    }
    return null;
  }

  function highlight(lane: string | null): void {
    highlighted = lane;
    markHighlight();
  }

  return { world, apply, step, pick, highlight };
}
