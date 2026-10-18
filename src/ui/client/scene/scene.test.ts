import { describe, expect, it } from "vitest";
import type { Actor, Block, Pose, Scene } from "../model";
import { PLACES, PYRAMID_AREA, WIDTH } from "../model";
import type { UiLane, UiSnapshot } from "../../protocol";
import { campSeat, pyramidLayout, workSpot } from "./layout";
import { castOf, createScene, fillFor, foreground, isBuilder, rationFor } from "./scene";
import { at, finishedLane, seededRandom, T0, uiIntegration, uiLane, uiQuota, uiSnapshot } from "./testkit";

const GROUND_Y = PYRAMID_AREA.baseY + 2;

function newScene(reducedMotion = false, seed = 7): Scene {
  return createScene({ reducedMotion, random: seededRandom(seed) });
}

function actorOf(s: Scene, lane: string): Actor | undefined {
  return s.world.actors.find((a) => a.lane === lane);
}

function mustActor(s: Scene, lane: string): Actor {
  const a = actorOf(s, lane);
  if (!a) throw new Error(`no actor for ${lane}`);
  return a;
}

function blockOf(s: Scene, lane: string): Block {
  const b = s.world.pyramid.blocks.find((x) => x.lane === lane);
  if (!b) throw new Error(`no block for ${lane}`);
  return b;
}

function kinds(s: Scene, lane?: string): string[] {
  return s.world.events.filter((e) => lane === undefined || e.lane === lane).map((e) => e.kind);
}

/** Steps until cond holds; the seconds it took. */
function until(s: Scene, cond: () => boolean, maxSeconds = 60, each?: () => void, dtMs = 50): number {
  for (let t = 0; t <= maxSeconds * 1000; t += dtMs) {
    if (cond()) return t / 1000;
    s.step(dtMs);
    each?.();
  }
  throw new Error("condition not reached");
}

function run(s: Scene, seconds: number, each?: () => void, dtMs = 50): void {
  for (let t = 0; t < seconds * 1000; t += dtMs) {
    s.step(dtMs);
    each?.();
  }
}

interface Mark {
  pose: Pose;
  x: number;
  y: number;
}

/** Records an actor's pose changes, with where each began. */
function tracer(s: Scene, lane: string): { marks: Mark[]; sample: () => void } {
  const marks: Mark[] = [];
  const sample = (): void => {
    const a = actorOf(s, lane);
    if (!a) return;
    const last = marks[marks.length - 1];
    if (!last || last.pose !== a.pose) marks.push({ pose: a.pose, x: a.x, y: a.y });
  };
  return { marks, sample };
}

/** The poses in order, repeats collapsed. */
function poses(marks: Mark[]): Pose[] {
  return marks.map((m) => m.pose);
}

function expectInOrder(seq: string[], wanted: string[]): void {
  let i = 0;
  for (const item of seq) if (item === wanted[i]) i += 1;
  expect({ seq, matched: i }).toEqual({ seq, matched: wanted.length });
}

const builder = (name: string, extra: Partial<UiLane> = {}): UiLane =>
  uiLane({ name, firstSeen: at(-3600 + name.length), ...extra });

// ---------------------------------------------------------------------------------------------------------------

describe("castOf and isBuilder", () => {
  const cases: Array<[Partial<UiLane>, string, boolean]> = [
    [{ role: "implementer", kind: "lane" }, "laborer", true],
    [{ role: "verifier", kind: "lane" }, "mason", true],
    [{ role: "verifier", kind: "lane", worktreeOf: "lane-b" }, "mason", false],
    [{ role: "reviewer", kind: "review" }, "scribe", false],
    [{ role: "reviewer", kind: "skeptic" }, "skeptic", false],
    [{ role: "reviewer", kind: "lane" }, "scribe", false],
    [{ role: "probe", kind: "verify" }, "surveyor", false],
    [{ role: "probe", kind: "preflight" }, "waterboy", false],
    [{ role: "probe", kind: "lane" }, "waterboy", false],
    [{ role: "researcher", kind: "lane" }, "scout", false],
    // By kind before role: what `arbab preflight` writes is a probe with the probed lane's role.
    [{ role: "implementer", kind: "preflight" }, "waterboy", false],
    [{ role: "verifier", kind: "preflight" }, "waterboy", false],
    [{ role: "researcher", kind: "preflight" }, "waterboy", false],
    [{ role: "implementer", kind: "verify" }, "surveyor", false],
    [{ role: "verifier", kind: "verify" }, "surveyor", false],
    [{ role: "implementer", kind: "review" }, "scribe", false],
    [{ role: "probe", kind: "skeptic" }, "skeptic", false],
  ];

  it.each(cases)("%o is a %s (builder: %s)", (over, cast, build) => {
    const lane = uiLane(over);
    expect(castOf(lane)).toBe(cast);
    expect(isBuilder(lane)).toBe(build);
  });
});

describe("fillFor and rationFor", () => {
  it("fills toward 0.95", () => {
    expect(fillFor(0)).toBe(0);
    expect(fillFor(40)).toBeCloseTo(1 - Math.exp(-1));
    expect(fillFor(1000)).toBe(0.95);
    expect(fillFor(-5)).toBe(0);
    expect(fillFor(Number.NaN)).toBe(0);
  });

  it("rations by the attempt's cost, else the session's", () => {
    expect(rationFor(uiLane({ costUsd: 0.45 }))).toBe(1);
    expect(rationFor(uiLane({ costUsd: 2.52 }))).toBe(2);
    expect(rationFor(uiLane({ costUsd: 7.61 }))).toBe(3);
    expect(rationFor(uiLane({ costUsd: 7.61, costDeltaUsd: 0.5 }))).toBe(1);
    expect(rationFor(uiLane({ costUsd: 4.99 }))).toBe(2);
    expect(rationFor(uiLane({ costUsd: 5 }))).toBe(3);
    expect(rationFor(uiLane({ costUsd: 1 }))).toBe(2);
    expect(rationFor(uiLane())).toBe(1);
  });
});

describe("foreground", () => {
  it("holds builders in snapshot order, not generated lanes or verifiers in other worktrees", () => {
    const lanes = [
      uiLane({ name: "impl" }),
      uiLane({ name: "ver", role: "verifier" }),
      uiLane({ name: "ver-in", role: "verifier", worktreeOf: "impl" }),
      uiLane({ name: "rev", role: "reviewer", kind: "review" }),
      uiLane({ name: "skep", role: "reviewer", kind: "skeptic" }),
      uiLane({ name: "probe", role: "probe", kind: "verify" }),
      uiLane({ name: "pre", role: "probe", kind: "preflight" }),
      uiLane({ name: "scout", role: "researcher" }),
      uiLane({ name: "impl-2" }),
    ];
    const fg = foreground(uiSnapshot({ lanes }));
    expect(fg.lanes.map((l) => l.name)).toEqual(["impl", "ver", "impl-2"]);
    expect(fg.capstone).toBeNull();
    expect(fg.capstoneLanded).toBe(false);
    expect(fg.far).toEqual([]);
  });

  it("sends long-landed integrations far, newest first, at most three", () => {
    const integrations = [1, 2, 3, 4, 5].map((n) =>
      uiIntegration({ name: `old-${n}`, lanes: [`l-${n}`], updatedAt: at(-9000 + n), landedAt: at(-7200 + n * 60) }),
    );
    const lanes = [1, 2, 3, 4, 5].map((n) => finishedLane({ name: `l-${n}`, integration: `old-${n}` }));
    const fg = foreground(uiSnapshot({ lanes: [...lanes, uiLane({ name: "new" })], integrations }));
    expect(fg.lanes.map((l) => l.name)).toEqual(["new"]);
    expect(fg.far.map((i) => i.name)).toEqual(["old-5", "old-4", "old-3"]);
    expect(fg.capstone).toBeNull();
  });

  it("keeps a landing of the last 10 minutes in the foreground, with its capstone", () => {
    const recent = uiIntegration({ name: "recent", lanes: ["a"], updatedAt: at(-200), landedAt: at(-120) });
    const old = uiIntegration({ name: "old", lanes: ["z"], updatedAt: at(-5000), landedAt: at(-4000) });
    const open = uiIntegration({ name: "open", lanes: ["b"], updatedAt: at(-10) });
    const lanes = [
      finishedLane({ name: "z", integration: "old" }),
      finishedLane({ name: "a", integration: "recent" }),
      uiLane({ name: "b", state: "running", integration: "open" }),
    ];
    const fg = foreground(uiSnapshot({ lanes, integrations: [old, recent, open] }));
    expect(fg.lanes.map((l) => l.name)).toEqual(["a", "b"]);
    expect(fg.capstone?.name).toBe("recent");
    expect(fg.capstoneLanded).toBe(true);
    expect(fg.far.map((i) => i.name)).toEqual(["old"]);
  });

  it("lets a landing go far after 10 minutes", () => {
    const landed = uiIntegration({ name: "landed", lanes: ["a"], landedAt: at(-601) });
    const lanes = [finishedLane({ name: "a", integration: "landed" })];
    const fg = foreground(uiSnapshot({ lanes, integrations: [landed] }));
    expect(fg.lanes).toEqual([]);
    expect(fg.capstone).toBeNull();
    expect(fg.far.map((i) => i.name)).toEqual(["landed"]);
  });

  it("gives the capstone to the newest open integration that merged a foreground lane", () => {
    const integrations = [
      uiIntegration({ name: "older", lanes: ["a"], updatedAt: at(-300) }),
      uiIntegration({ name: "newer", lanes: ["a", "b"], updatedAt: at(-100) }),
      uiIntegration({ name: "foreign", lanes: ["rev"], updatedAt: at(-10) }),
    ];
    const lanes = [
      finishedLane({ name: "a", integration: "newer" }),
      finishedLane({ name: "b", integration: "newer" }),
      uiLane({ name: "rev", role: "reviewer", kind: "review", integration: "foreign" }),
    ];
    const fg = foreground(uiSnapshot({ lanes, integrations }));
    expect(fg.capstone?.name).toBe("newer");
    expect(fg.capstoneLanded).toBe(false);
  });

  it("leaves out lanes whose integration the snapshot no longer carries", () => {
    const fg = foreground(uiSnapshot({ lanes: [finishedLane({ name: "a", integration: "gone" })] }));
    expect(fg.lanes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe("the first snapshot", () => {
  const lanes = [
    builder("a-queued"),
    builder("b-held-quota", { state: "held", hold: "quota" }),
    builder("c-held-slot", { state: "held", hold: "slot" }),
    builder("d-preparing", { state: "preparing" }),
    builder("e-running", { state: "running", toolCalls: 20 }),
    builder("f-waiting", { state: "waiting-reset", toolCalls: 12 }),
    builder("g-orphaned", { state: "orphaned", toolCalls: 8 }),
    finishedLane({ name: "h-set" }),
    finishedLane({ name: "i-fallen", endState: "failed", reportStatus: null }),
    finishedLane({ name: "j-partial", reportStatus: "partial", toolCalls: 30 }),
    finishedLane({ name: "k-blocked", reportStatus: "blocked" }),
    finishedLane({ name: "l-fallen", endState: "killed:wall", reportStatus: null }),
  ];
  const slots = pyramidLayout(lanes.length).slots;

  function baseline(): Scene {
    const s = newScene();
    s.apply(uiSnapshot({ lanes }));
    return s;
  }

  it("puts arbab first and gives no worker to finished lanes", () => {
    const s = baseline();
    const arbab = s.world.actors[0]!;
    expect(arbab).toMatchObject({ id: "arbab", lane: null, cast: "arbab", ...PLACES.arbab, facing: 1, pose: "idle" });
    expect(s.world.actors.map((a) => a.id)).toEqual([
      "arbab",
      "a-queued",
      "b-held-quota",
      "c-held-slot",
      "d-preparing",
      "e-running",
      "f-waiting",
      "g-orphaned",
    ]);
    expect(s.world.events).toEqual([]);
    expect(s.world.particles).toEqual([]);
  });

  it("seats queued and held workers in the camp with their icons", () => {
    const s = baseline();
    expect(mustActor(s, "a-queued")).toMatchObject({ ...campSeat(0), pose: "sit", icon: null });
    expect(mustActor(s, "b-held-quota")).toMatchObject({ ...campSeat(1), pose: "sit", icon: "hourglass" });
    expect(mustActor(s, "c-held-slot")).toMatchObject({ ...campSeat(2), pose: "sit", icon: "dots" });
  });

  it("puts live builders at their blocks, asleep or ghostly where their state says", () => {
    const s = baseline();
    const e = mustActor(s, "e-running");
    expect(e).toMatchObject({ ...workSpot(slots[4]!), pose: "work" });
    expect(e.facing).toBe(e.x <= PYRAMID_AREA.centerX ? 1 : -1);
    expect(mustActor(s, "d-preparing")).toMatchObject({ ...workSpot(slots[3]!), pose: "work" });
    expect(mustActor(s, "f-waiting")).toMatchObject({ ...workSpot(slots[5]!), pose: "sleep", icon: "zzz" });
    expect(mustActor(s, "g-orphaned")).toMatchObject({
      ...workSpot(slots[6]!),
      pose: "idle",
      ghost: true,
      icon: "question",
    });
  });

  it("shows each block's outcome and the rubble of the fallen ones", () => {
    const s = baseline();
    const looks = Object.fromEntries(s.world.pyramid.blocks.map((b) => [b.lane ?? `#${b.x},${b.y}`, b.look]));
    expect(looks).toMatchObject({
      "a-queued": "planned",
      "b-held-quota": "planned",
      "c-held-slot": "planned",
      "d-preparing": "planned",
      "e-running": "building",
      "f-waiting": "stalled",
      "g-orphaned": "orphaned",
      "h-set": "set",
      "i-fallen": "fallen",
      "j-partial": "stalled",
      "k-blocked": "stalled",
      "l-fallen": "fallen",
    });
    expect(blockOf(s, "e-running").fill).toBeCloseTo(fillFor(20));
    expect(blockOf(s, "f-waiting").fill).toBeCloseTo(fillFor(12));
    expect(blockOf(s, "h-set").fill).toBe(1);
    expect(blockOf(s, "i-fallen").fill).toBe(0);
    expect(blockOf(s, "a-queued").fill).toBe(0);
    expect(s.world.pyramid.rubble).toBe(8);
    const empty = s.world.pyramid.blocks.filter((b) => b.lane === null);
    expect(empty).toHaveLength(slots.length - lanes.length);
    for (const b of empty) expect(b).toMatchObject({ look: "empty", fill: 0 });
    s.world.pyramid.blocks.forEach((b, i) => {
      const slot = slots[i]!;
      expect([b.x, b.y, b.w, b.h]).toEqual([slot.x, slot.y, slot.w, slot.h]);
    });
  });

  it("does not walk anyone who is where their state puts them", () => {
    const s = baseline();
    const before = s.world.actors.map((a) => ({ id: a.id, x: a.x, y: a.y, pose: a.pose }));
    run(s, 3);
    expect(s.world.actors.map((a) => ({ id: a.id, x: a.x, y: a.y, pose: a.pose }))).toEqual(before);
    expect(s.world.events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe("a builder's day", () => {
  const done = ["d1", "d2", "d3", "d4"].map((name, i) => finishedLane({ name, firstSeen: at(-7200 + i) }));
  const me = (extra: Partial<UiLane>): UiLane => uiLane({ name: "me", firstSeen: at(-3600), ...extra });
  const spot = workSpot(pyramidLayout(5).slots[4]!);

  it("comes in, sits, talks, builds, reports, takes its ration and leaves", () => {
    const s = newScene();
    s.apply(uiSnapshot({ lanes: done }));
    s.apply(uiSnapshot({ lanes: [...done, me({ state: "queued" })], now: at(1) }));
    const { marks, sample } = tracer(s, "me");
    const fills: number[] = [];
    const each = (): void => {
      sample();
      fills.push(blockOf(s, "me").fill);
    };
    sample();
    expect(mustActor(s, "me")).toMatchObject({ x: PLACES.spawn.x, y: PLACES.spawn.y });
    until(s, () => mustActor(s, "me").pose === "sit", 10, each);
    expect(mustActor(s, "me")).toMatchObject(campSeat(0));

    s.apply(uiSnapshot({ lanes: [...done, me({ state: "running", toolCalls: 5 })], now: at(10) }));
    expect(blockOf(s, "me").look).toBe("building");
    until(s, () => kinds(s, "me").filter((k) => k === "stone").length === 5, 40, each);
    run(s, 1, each);
    expect(mustActor(s, "me")).toMatchObject({ ...spot, pose: "work", stroke: 0 });
    expect(blockOf(s, "me").fill).toBeCloseTo(fillFor(5));

    s.apply(uiSnapshot({ lanes: [...done, me({ state: "finished", endState: "success", costUsd: 2 })], now: at(40) }));
    expect(blockOf(s, "me")).toMatchObject({ look: "set", fill: 1, flash: 1 });
    let carried = 0;
    until(s, () => actorOf(s, "me") === undefined, 60, () => {
      each();
      const a = actorOf(s, "me");
      if (a?.pose === "carry-ration") carried = a.ration;
    });

    expect(kinds(s, "me")).toEqual(["brief", "stone", "stone", "stone", "stone", "stone", "set", "report"]);
    expectInOrder(poses(marks), [
      "walk",
      "sit",
      "walk",
      "talk",
      "carry-stone",
      "climb-stone",
      "work",
      "climb",
      "walk",
      "talk",
      "walk",
      "idle",
      "carry-ration",
    ]);
    const at0 = (pose: Pose, n = 0): Mark => marks.filter((m) => m.pose === pose)[n]!;
    // The climb up, with the stone, starts on the ground line below the block, and the work on the block.
    expect(at0("climb-stone")).toMatchObject({ x: spot.x });
    expect(at0("climb-stone").y).toBeCloseTo(GROUND_Y, 0);
    expect(at0("work")).toMatchObject(spot);
    // The climb down to report is empty-handed: it starts on the block, after the work.
    const up = marks.findIndex((m) => m.pose === "climb-stone");
    const down = marks.findIndex((m) => m.pose === "climb");
    expect(down).toBeGreaterThan(up);
    expect(marks.slice(down).some((m) => m.pose === "climb-stone")).toBe(false);
    expect(at0("climb").x).toBe(spot.x);
    // It pauses at the table, then carries its ration off.
    const carry = marks.findIndex((m) => m.pose === "carry-ration");
    expect(marks[carry - 1]).toMatchObject({ pose: "idle", ...PLACES.rations });
    expect(carried).toBe(2);
    for (let i = 1; i < fills.length; i += 1) expect(fills[i]!).toBeGreaterThanOrEqual(fills[i - 1]!);
    expect(blockOf(s, "me").look).toBe("set");
  });

  it("places one stone per new call, at most six queued", () => {
    const s = newScene();
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "running", toolCalls: 10 })] }));
    s.step(50);
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "running", toolCalls: 30 })], now: at(1) }));
    const fills: number[] = [];
    run(s, 10, () => fills.push(blockOf(s, "a").fill));
    expect(kinds(s, "a")).toEqual(["stone", "stone", "stone", "stone", "stone", "stone"]);
    for (const f of fills) expect(f).toBeLessThanOrEqual(fillFor(30) + 1e-9);
    expect(blockOf(s, "a").fill).toBeCloseTo(fillFor(30));
    expect(mustActor(s, "a").stroke).toBe(0);
  });

  it("strokes take 0.4 s with the stone placed halfway, making dust and a shine", () => {
    const s = newScene();
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "running", toolCalls: 0 })] }));
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "running", toolCalls: 1 })], now: at(1) }));
    s.step(100);
    expect(mustActor(s, "a").stroke).toBeCloseTo(0.25);
    expect(kinds(s)).toEqual([]);
    s.step(100);
    expect(kinds(s)).toEqual(["stone"]);
    expect(blockOf(s, "a").flash).toBe(1);
    const dust = s.world.particles.filter((p) => p.kind === "dust");
    expect(dust.length).toBeGreaterThanOrEqual(3);
    expect(dust.length).toBeLessThanOrEqual(5);
    for (const p of dust) {
      expect(p.vy).toBeLessThanOrEqual(-10);
      expect(p.vy).toBeGreaterThanOrEqual(-30);
    }
    s.step(100);
    s.step(100);
    expect(mustActor(s, "a").stroke).toBe(0);
    run(s, 0.6);
    expect(blockOf(s, "a").flash).toBe(0);
    expect(s.world.particles.filter((p) => p.kind === "dust")).toEqual([]);
  });

  it("eases the fill up when no stroke is pending", () => {
    const s = newScene();
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "running", toolCalls: 0 })] }));
    // The calls came while it slept: no strokes for them, the fill catches up on its own.
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "waiting-reset", toolCalls: 40 })], now: at(1) }));
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "running", toolCalls: 40 })], now: at(2) }));
    expect(blockOf(s, "a").fill).toBe(0);
    s.step(100);
    expect(blockOf(s, "a").fill).toBeCloseTo(0.02);
    run(s, 1);
    expect(blockOf(s, "a").fill).toBeCloseTo(0.22);
    run(s, 5);
    expect(blockOf(s, "a").fill).toBeCloseTo(fillFor(40));
    expect(kinds(s)).toEqual([]);
  });

  it("falls on a failure: stones tumble into rubble, the worker leaves slumped and empty-handed", () => {
    const s = newScene();
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "running", toolCalls: 40 })] }));
    const fill = blockOf(s, "a").fill;
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "finished", endState: "failed" })], now: at(1) }));
    expect(kinds(s)).toEqual(["fall"]);
    expect(blockOf(s, "a")).toMatchObject({ look: "fallen", fill: 0 });
    const stones = s.world.particles.filter((p) => p.kind === "stone");
    expect(stones).toHaveLength(Math.round(fill * 8));
    for (const p of stones) expect(Math.abs(p.vx)).toBeLessThanOrEqual(40);
    expect(s.world.pyramid.rubble).toBe(0);
    let slumped = false;
    let ration = -1;
    until(s, () => actorOf(s, "a") === undefined, 60, () => {
      const a = actorOf(s, "a");
      if (a?.pose === "slump") {
        slumped = true;
        ration = a.ration;
      }
    });
    expect(s.world.particles.filter((p) => p.kind === "stone")).toEqual([]);
    expect(s.world.pyramid.rubble).toBe(Math.round(fill * 8));
    expect(slumped).toBe(true);
    expect(ration).toBe(0);
    expect(kinds(s)).toEqual(["fall", "report"]);
  });

  it("stalls on a partial report and gives a loaf", () => {
    const s = newScene();
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "running", toolCalls: 20 })] }));
    s.apply(
      uiSnapshot({
        lanes: [
          builder("a", { state: "finished", endState: "success", reportStatus: "partial", costUsd: 9, toolCalls: 20 }),
        ],
        now: at(1),
      }),
    );
    expect(blockOf(s, "a")).toMatchObject({ look: "stalled" });
    expect(blockOf(s, "a").fill).toBeCloseTo(fillFor(20));
    let ration = -1;
    let paused = 0;
    until(s, () => actorOf(s, "a") === undefined, 60, () => {
      const a = actorOf(s, "a");
      if (a?.pose === "carry-ration") ration = a.ration;
      if (a?.pose === "idle" && a.x === PLACES.rations.x && a.y === PLACES.rations.y) paused += 0.05;
    });
    expect(ration).toBe(1);
    expect(paused).toBeGreaterThanOrEqual(0.5);
    expect(paused).toBeLessThanOrEqual(0.65);
    expect(kinds(s)).toEqual(["report"]);
  });

  it("stalls on a blocked report and sends the worker off empty-handed", () => {
    const s = newScene();
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "running", toolCalls: 20 })] }));
    s.apply(
      uiSnapshot({
        lanes: [builder("a", { state: "finished", endState: "success", reportStatus: "blocked", costUsd: 2 })],
        now: at(1),
      }),
    );
    expect(blockOf(s, "a").look).toBe("stalled");
    const seen = new Set<Pose>();
    until(s, () => actorOf(s, "a") === undefined, 60, () => {
      const a = actorOf(s, "a");
      if (a) seen.add(a.pose);
    });
    expect(seen.has("slump")).toBe(true);
    expect(seen.has("carry-ration")).toBe(false);
  });

  it("sleeps where it works while waiting for a reset", () => {
    const s = newScene();
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "running", toolCalls: 20 })] }));
    const before = { x: mustActor(s, "a").x, y: mustActor(s, "a").y };
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "waiting-reset", toolCalls: 20 })], now: at(1) }));
    run(s, 2);
    expect(mustActor(s, "a")).toMatchObject({ ...before, pose: "sleep", icon: "zzz" });
    expect(blockOf(s, "a").look).toBe("stalled");
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "running", toolCalls: 20 })], now: at(2) }));
    run(s, 1);
    // Back at work without another brief.
    expect(mustActor(s, "a")).toMatchObject({ ...before, pose: "work", icon: null });
    expect(kinds(s)).toEqual([]);
  });

  it("shows why a held lane waits", () => {
    const s = newScene();
    s.apply(uiSnapshot({ lanes: [builder("a")] }));
    expect(mustActor(s, "a").icon).toBeNull();
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "held", hold: "quota" })], now: at(1) }));
    expect(mustActor(s, "a")).toMatchObject({ ...campSeat(0), pose: "sit", icon: "hourglass" });
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "held", hold: "slot" })], now: at(2) }));
    expect(mustActor(s, "a")).toMatchObject({ ...campSeat(0), pose: "sit", icon: "dots" });
  });

  it("leaves a ghost with a question mark where an orphaned worker stood, until the lane changes", () => {
    const s = newScene();
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "running", toolCalls: 4 })] }));
    const where = { x: mustActor(s, "a").x, y: mustActor(s, "a").y };
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "orphaned", toolCalls: 4 })], now: at(1) }));
    run(s, 2);
    expect(mustActor(s, "a")).toMatchObject({ ...where, ghost: true, icon: "question" });
    expect(blockOf(s, "a").look).toBe("orphaned");
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "running", toolCalls: 4 })], now: at(2) }));
    expect(mustActor(s, "a")).toMatchObject({ ghost: false, icon: null });
  });

  it("reuses the worker of a lane relaunched after a failure; the rubble stays", () => {
    const s = newScene();
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "running", toolCalls: 40 })] }));
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "finished", endState: "failed" })], now: at(1) }));
    run(s, 2);
    const worker = mustActor(s, "a");
    const rubble = s.world.pyramid.rubble;
    expect(rubble).toBeGreaterThan(0);
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "queued", attempt: 2 })], now: at(3) }));
    expect(mustActor(s, "a")).toBe(worker);
    expect(blockOf(s, "a")).toMatchObject({ look: "planned", fill: 0 });
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "running", attempt: 2, toolCalls: 2 })], now: at(4) }));
    expect(blockOf(s, "a")).toMatchObject({ look: "building", fill: 0 });
    until(s, () => kinds(s, "a").includes("brief"), 60);
    expect(s.world.pyramid.rubble).toBe(rubble);
    until(s, () => kinds(s, "a").filter((k) => k === "stone").length === 2, 30);
    expect(mustActor(s, "a")).toBe(worker);
  });

  it("spawns a new worker for a relaunch after the old one left", () => {
    const s = newScene();
    s.apply(uiSnapshot({ lanes: [finishedLane({ name: "a", endState: "failed", reportStatus: null })] }));
    expect(actorOf(s, "a")).toBeUndefined();
    expect(s.world.pyramid.rubble).toBe(4);
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "queued", attempt: 2 })], now: at(1) }));
    expect(mustActor(s, "a")).toMatchObject(PLACES.spawn);
    expect(blockOf(s, "a")).toMatchObject({ look: "planned", fill: 0 });
    expect(s.world.pyramid.rubble).toBe(4);
  });

  it("fades out a lane that leaves the snapshot and rebuilds the layout without it", () => {
    const s = newScene();
    const lanes = ["a", "b", "c", "d", "e"].map((n) => builder(n, { state: "running", toolCalls: 3 }));
    s.apply(uiSnapshot({ lanes }));
    const kept = lanes.filter((l) => l.name !== "a");
    s.apply(uiSnapshot({ lanes: kept, now: at(1) }));
    expect(s.world.pyramid.blocks.map((b) => b.lane).slice(0, 4)).toEqual(["b", "c", "d", "e"]);
    expect(s.world.pyramid.blocks.some((b) => b.lane === "a")).toBe(false);
    run(s, 0.5);
    expect(mustActor(s, "a").alpha).toBeCloseTo(0.5);
    run(s, 0.6);
    expect(actorOf(s, "a")).toBeUndefined();
    // e moves from course 1 to the bottom course.
    const slots = pyramidLayout(4).slots;
    until(s, () => {
      const e = mustActor(s, "e");
      return e.x === workSpot(slots[3]!).x && e.y === workSpot(slots[3]!).y && e.pose === "work";
    }, 30);
    expect(mustActor(s, "b")).toMatchObject(workSpot(slots[0]!));
  });

  it("cuts a long step to 100 ms", () => {
    const s = newScene();
    s.apply(uiSnapshot());
    s.apply(uiSnapshot({ lanes: [builder("a")], now: at(1) }));
    const x = mustActor(s, "a").x;
    s.step(10_000);
    expect(mustActor(s, "a").x - x).toBeLessThanOrEqual(2.8 + 1e-9);
    expect(mustActor(s, "a").x - x).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe("talks with arbab", () => {
  it("takes one worker at a time; the next waits in line and steps up", () => {
    const s = newScene();
    s.apply(uiSnapshot());
    s.apply(
      uiSnapshot({
        lanes: [builder("a", { state: "running" }), builder("b", { state: "running" })],
        now: at(1),
      }),
    );
    const arbab = s.world.actors[0]!;
    const arbabPoses: Pose[] = [];
    let arbabBubbles = 0;
    let workerBubbles = 0;
    until(s, () => kinds(s).includes("brief"), 30, () => {
      if (arbabPoses[arbabPoses.length - 1] !== arbab.pose) arbabPoses.push(arbab.pose);
      if (arbab.bubble) arbabBubbles += 1;
      const a = mustActor(s, "a");
      if (a.bubble) {
        workerBubbles += 1;
        expect(arbab.bubble).toBeNull();
        expect(a.pose).toBe("talk");
      }
      if (a.x === PLACES.audience.x && a.y === PLACES.audience.y && (arbab.bubble || a.bubble)) {
        expect(a.facing).toBe(-1);
      }
      // b, a step behind on the path, is in line by the time a speaks.
      if (a.bubble) {
        const b = mustActor(s, "b");
        expect(b).toMatchObject({ x: PLACES.audience.x + 12, y: PLACES.audience.y, pose: "idle", facing: -1 });
      }
    });
    expect(arbabPoses).toEqual(["idle", "talk", "idle", "talk", "idle"]);
    expect(arbabBubbles).toBeGreaterThan(0);
    expect(workerBubbles).toBeGreaterThan(0);
    expect(arbab.bubble).toBeNull();
    expect(mustActor(s, "a").bubble).toBeNull();
    expect(kinds(s)).toEqual(["brief"]);
    expect(s.world.events[0]!.lane).toBe("a");
    const took = until(s, () => kinds(s).length === 2, 10);
    expect(took).toBeGreaterThanOrEqual(2.4);
    expect(took).toBeLessThan(3.5);
    expect(s.world.events[1]).toEqual({ kind: "brief", lane: "b" });
  });

  /** Workers standing in line behind the audience spot. */
  function behind(s: Scene): Actor[] {
    return s.world.actors.filter(
      (a) => a.lane !== null && a.y === PLACES.audience.y && a.x > PLACES.audience.x && (a.x - PLACES.audience.x) % 12 === 0,
    );
  }

  it("lines up at most 6 behind the audience spot when 20 lanes start at once; the rest join in arrival order", () => {
    const names = Array.from({ length: 20 }, (_, i) => `l${String(i).padStart(2, "0")}`);
    const s = newScene();
    s.apply(uiSnapshot());
    s.apply(uiSnapshot({ lanes: names.map((n) => builder(n, { state: "running" })), now: at(1) }));
    const atSpawn = (): string[] =>
      s.world.actors.filter((a) => a.x === PLACES.spawn.x && a.y === PLACES.spawn.y).map((a) => a.id);
    run(s, 1);
    // The talker and six in line set off; the other thirteen wait at the village path.
    expect(atSpawn()).toEqual(names.slice(7));
    let most = 0;
    until(s, () => kinds(s).length === 20, 120, () => {
      const line = behind(s);
      most = Math.max(most, line.length);
      expect(line.length).toBeLessThanOrEqual(6);
      for (const a of s.world.actors) expect(a.x).toBeLessThanOrEqual(WIDTH);
    });
    expect(most).toBeGreaterThanOrEqual(5);
    expect(s.world.events.map((e) => e.lane)).toEqual(names);
    expect(new Set(kinds(s))).toEqual(new Set(["brief"]));
  });

  it("keeps the others in their camp seats until a place in line frees up", () => {
    const names = Array.from({ length: 10 }, (_, i) => `l${i}`);
    const s = newScene();
    s.apply(uiSnapshot({ lanes: names.map((n) => builder(n)) }));
    s.apply(uiSnapshot({ lanes: names.map((n) => builder(n, { state: "running" })), now: at(1) }));
    run(s, 3);
    // Seven are on their way to the line; the last three still sit where they were.
    for (const n of names.slice(0, 7)) expect(mustActor(s, n).pose).toBe("walk");
    for (const [i, n] of names.slice(7).entries()) expect(mustActor(s, n)).toMatchObject({ ...campSeat(7 + i), pose: "sit" });
    until(s, () => kinds(s).length === 1, 20);
    run(s, 0.5);
    expect(mustActor(s, "l7")).toMatchObject({ pose: "walk" });
    expect(mustActor(s, "l8")).toMatchObject({ ...campSeat(8), pose: "sit" });
  });

  it("climbs down from its block before it queues to report", () => {
    const s = newScene();
    const lanes = ["a", "b", "c", "d", "e"].map((n) => builder(n, { state: "running", toolCalls: 3 }));
    s.apply(uiSnapshot({ lanes }));
    const { marks, sample } = tracer(s, "e");
    s.apply(
      uiSnapshot({ lanes: lanes.map((l) => (l.name === "e" ? { ...l, state: "finished" as const, endState: "success" as const } : l)), now: at(1) }),
    );
    until(s, () => kinds(s, "e").includes("report"), 30, sample);
    expectInOrder(poses(marks), ["climb", "walk", "talk"]);
    expect(poses(marks)).not.toContain("climb-stone");
    expect(marks.find((m) => m.pose === "walk")?.y).toBeCloseTo(GROUND_Y, 0);
  });

  it("opens each bubble over 0.15 s with a fresh seed", () => {
    const s = newScene();
    s.apply(uiSnapshot());
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "running" })], now: at(1) }));
    const arbab = s.world.actors[0]!;
    until(s, () => arbab.bubble !== null, 30, undefined, 10);
    const first = arbab.bubble!;
    expect(first.open).toBeLessThan(0.15);
    run(s, 0.2, undefined, 10);
    expect(arbab.bubble?.open).toBe(1);
    until(s, () => mustActor(s, "a").bubble !== null, 2, undefined, 10);
    until(s, () => arbab.bubble !== null, 2, undefined, 10);
    expect(arbab.bubble!.seed).not.toBe(first.seed);
    expect(Number.isInteger(arbab.bubble!.seed)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe("the other workers", () => {
  const lanes = [
    builder("impl", { state: "running", toolCalls: 3 }),
    uiLane({ name: "mason", role: "verifier", worktreeOf: "impl", state: "running" }),
    uiLane({ name: "lost-mason", role: "verifier", worktreeOf: "nobody", state: "running" }),
    uiLane({ name: "scribe", role: "reviewer", kind: "review", state: "running" }),
    uiLane({ name: "skeptic", role: "reviewer", kind: "skeptic", state: "running" }),
    uiLane({ name: "surveyor", role: "probe", kind: "verify", state: "running" }),
    uiLane({ name: "water", role: "probe", kind: "preflight", state: "running" }),
    uiLane({ name: "scout", role: "researcher", state: "running" }),
  ];

  it("work at their places", () => {
    const s = newScene();
    s.apply(uiSnapshot({ lanes }));
    const slot = pyramidLayout(1).slots[0]!;
    const spot = workSpot(slot);
    expect(mustActor(s, "mason")).toMatchObject({ x: spot.x + 5, y: spot.y, pose: "work", cast: "mason" });
    expect(mustActor(s, "lost-mason")).toMatchObject({ x: PYRAMID_AREA.centerX, y: GROUND_Y, pose: "work" });
    expect(mustActor(s, "surveyor")).toMatchObject({ x: PLACES.sledge.x - 14, y: GROUND_Y, pose: "work", facing: -1 });
    expect(s.world.pyramid.blocks.filter((b) => b.lane !== null).map((b) => b.lane)).toEqual(["impl"]);
  });

  it("scribes write on the two lowest courses and move on after 3–6 s", () => {
    const s = newScene();
    s.apply(uiSnapshot({ lanes }));
    const low = pyramidLayout(1).slots.filter((x) => x.course < 2).map(workSpot);
    const writes: Array<{ x: number; y: number; t: number }> = [];
    let t = 0;
    let last: Pose | null = null;
    const sample = (): void => {
      t += 0.05;
      const a = mustActor(s, "scribe");
      if (a.pose === "work" && last !== "work") writes.push({ x: a.x, y: a.y, t });
      last = a.pose;
    };
    const climbs = new Set<Pose>();
    const each = (): void => {
      sample();
      const pose = mustActor(s, "scribe").pose;
      if (pose === "climb" || pose === "climb-stone") climbs.add(pose);
    };
    each();
    run(s, 40, each);
    expect(writes.length).toBeGreaterThanOrEqual(4);
    for (const w of writes) expect(low).toContainEqual({ x: w.x, y: w.y });
    // Up and down the courses empty-handed: only a builder carries a stone up.
    expect([...climbs]).toEqual(["climb"]);
  });

  it("a skeptic speaks up for 1.2 s now and then while writing", () => {
    const s = newScene();
    s.apply(uiSnapshot({ lanes }));
    let open = 0;
    let shown = 0;
    let was = false;
    run(s, 40, () => {
      const a = mustActor(s, "skeptic");
      if (a.bubble) {
        shown += 0.05;
        expect(a.pose).toBe("work");
      }
      if (a.bubble && !was) open += 1;
      was = a.bubble !== null;
    });
    expect(open).toBeGreaterThanOrEqual(2);
    expect(shown / open).toBeLessThanOrEqual(1.25);
  });

  it("the water carrier walks between the well and the foot", () => {
    const s = newScene();
    s.apply(uiSnapshot({ lanes }));
    const stops: Array<{ x: number; y: number }> = [];
    let last: Pose | null = null;
    run(s, 40, () => {
      const a = mustActor(s, "water");
      if (a.pose === "idle" && last !== "idle") stops.push({ x: a.x, y: a.y });
      last = a.pose;
    });
    expect(stops.length).toBeGreaterThanOrEqual(3);
    const half = (pyramidLayout(1).base * pyramidLayout(1).blockW) / 2;
    for (const p of stops) {
      if (p.x === PLACES.well.x && p.y === PLACES.well.y) continue;
      expect(p.y).toBe(GROUND_Y);
      expect(Math.abs(p.x - PYRAMID_AREA.centerX)).toBeLessThanOrEqual(half);
    }
    expect(stops.some((p) => p.x === PLACES.well.x && p.y === PLACES.well.y)).toBe(true);
  });

  it("the scout hides past the dunes for 6–10 s, then comes back to the right foot", () => {
    const s = newScene();
    s.apply(uiSnapshot({ lanes }));
    let hidden = 0;
    let maxHidden = 0;
    const returns: number[] = [];
    let wasHidden = false;
    run(s, 60, () => {
      const a = mustActor(s, "scout");
      if (a.alpha === 0) {
        expect(a).toMatchObject(PLACES.horizon);
        hidden += 0.05;
        maxHidden = Math.max(maxHidden, hidden);
      } else {
        if (wasHidden) hidden = 0;
        if (a.pose === "idle") returns.push(a.x);
      }
      wasHidden = a.alpha === 0;
    });
    expect(maxHidden).toBeGreaterThan(5.9);
    expect(maxHidden).toBeLessThanOrEqual(10.05);
    expect(returns.length).toBeGreaterThan(0);
    for (const x of returns) expect(x).toBeGreaterThanOrEqual(PYRAMID_AREA.centerX);
  });

  it("non-builders' strokes place nothing", () => {
    const s = newScene();
    s.apply(uiSnapshot({ lanes }));
    s.apply(
      uiSnapshot({
        lanes: lanes.map((l) => (l.name === "impl" ? l : { ...l, toolCalls: 4 })),
        now: at(1),
      }),
    );
    let struck = false;
    run(s, 5, () => {
      if (mustActor(s, "surveyor").stroke > 0) struck = true;
    });
    expect(struck).toBe(true);
    expect(kinds(s)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe("the capstone", () => {
  const lanes = [finishedLane({ name: "a", integration: "int" }), finishedLane({ name: "b", integration: "int" })];

  it("waits on its sledge with the verify flag and the readiness gleam", () => {
    const flags: Array<["passed" | "failed" | null, boolean | null, string, boolean]> = [
      ["passed", true, "passed", true],
      ["failed", false, "failed", false],
      [null, null, "none", false],
    ];
    for (const [verify, ready, flag, gleam] of flags) {
      const s = newScene();
      s.apply(uiSnapshot({ lanes, integrations: [uiIntegration({ name: "int", lanes: ["a", "b"], verify, ready })] }));
      expect(s.world.pyramid.capstone).toEqual({
        state: "waiting",
        integration: "int",
        ...PLACES.sledge,
        flag,
        ready: gleam,
      });
    }
  });

  it("is none without an integration", () => {
    const s = newScene();
    s.apply(uiSnapshot({ lanes }));
    expect(s.world.pyramid.capstone.state).toBe("none");
    expect(s.world.pyramid.capstone.integration).toBeNull();
  });

  it("is hoisted to the apex over about 3 s when it lands, with sparkles and a cheer", () => {
    const s = newScene();
    const open = uiIntegration({ name: "int", lanes: ["a", "b"], verify: "passed", ready: true });
    s.apply(uiSnapshot({ lanes, integrations: [open] }));
    s.apply(uiSnapshot({ lanes, integrations: [{ ...open, landedAt: at(1) }], now: at(2) }));
    const cap = s.world.pyramid.capstone;
    const apex = s.world.pyramid.apex;
    expect(cap).toMatchObject({ state: "hoisting", ...PLACES.sledge });
    run(s, 1.5);
    expect(cap.state).toBe("hoisting");
    expect(cap.x).toBeCloseTo((PLACES.sledge.x + apex.x) / 2, 0);
    expect(cap.y).toBeCloseTo((PLACES.sledge.y + apex.y) / 2, 0);
    expect(kinds(s)).toEqual([]);
    const took = until(s, () => cap.state === "set", 3);
    expect(1.5 + took).toBeGreaterThanOrEqual(2.95);
    expect(1.5 + took).toBeLessThanOrEqual(3.1);
    expect(cap).toMatchObject({ ...apex, state: "set" });
    expect(s.world.events).toEqual([{ kind: "capstone", lane: "int" }]);
    expect(s.world.particles.filter((p) => p.kind === "sparkle")).toHaveLength(20);
    expect(s.world.actors[0]!.pose).toBe("cheer");
    run(s, 2.1);
    expect(s.world.actors[0]!.pose).toBe("idle");
    expect(s.world.particles).toEqual([]);
    s.apply(uiSnapshot({ lanes, integrations: [{ ...open, landedAt: at(1) }], now: at(10) }));
    expect(cap.state).toBe("set");
    expect(kinds(s)).toEqual(["capstone"]);
  });

  it("is set at once when the first snapshot shows it landed", () => {
    const s = newScene();
    const landed = uiIntegration({ name: "int", lanes: ["a", "b"], landedAt: at(-60) });
    s.apply(uiSnapshot({ lanes, integrations: [landed] }));
    expect(s.world.pyramid.capstone).toMatchObject({ state: "set", ...s.world.pyramid.apex });
    expect(s.world.events).toEqual([]);
    expect(s.world.actors[0]!.pose).toBe("idle");
  });

  it("stands landed integrations on the horizon", () => {
    const s = newScene();
    const integrations = [1, 2, 3, 4].map((n) => {
      const merged = Array.from({ length: n * 5 }, (_, k) => `x${k}`);
      return uiIntegration({ name: `i${n}`, lanes: merged, landedAt: at(-7200 + n) });
    });
    s.apply(uiSnapshot({ integrations }));
    expect(s.world.far).toEqual([
      { integration: "i4", x: 152, y: 128, height: 20 },
      { integration: "i3", x: 108, y: 128, height: 17 },
      { integration: "i2", x: 64, y: 128, height: 14 },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe("sky and coins", () => {
  const nowSec = Date.parse(T0) / 1000;

  it("is day, dusk while held, night while rejected", () => {
    const sky = (quota: UiSnapshot["quota"]): string => {
      const s = newScene();
      s.apply(uiSnapshot({ quota }));
      return s.world.sky.phase;
    };
    const hold = { hold: true, reason: "five-hour", until: nowSec + 600 };
    expect(sky(uiQuota())).toBe("day");
    expect(sky(uiQuota({ hold }))).toBe("dusk");
    expect(sky(uiQuota({ status: "rejected", fiveHour: { utilization: 1, resetsAt: nowSec + 60 } }))).toBe("night");
    expect(sky(uiQuota({ status: "rejected", sevenDay: { utilization: 1, resetsAt: nowSec + 60 } }))).toBe("night");
    expect(sky(uiQuota({ status: "rejected", fiveHour: { utilization: 1, resetsAt: nowSec - 60 } }))).toBe("day");
    const past = { utilization: 1, resetsAt: nowSec - 60 };
    expect(sky(uiQuota({ status: "rejected", fiveHour: past, hold }))).toBe("dusk");
  });

  it("moves the sun through the five-hour window", () => {
    const sun = (resetsAt: number | null): number => {
      const s = newScene();
      s.apply(uiSnapshot({ quota: uiQuota({ fiveHour: resetsAt === null ? null : { utilization: 0.2, resetsAt } }) }));
      return s.world.sky.sun;
    };
    expect(sun(null)).toBe(0.5);
    expect(sun(nowSec - 1)).toBe(0.5);
    expect(sun(nowSec + 18000)).toBe(0);
    expect(sun(nowSec + 9000)).toBeCloseTo(0.5);
    expect(sun(nowSec + 1800)).toBeCloseTo(0.9);
    expect(sun(nowSec + 40000)).toBe(0);
  });

  it("piles coins by the square root of the spend, with a few flying in on a live increase", () => {
    const s = newScene();
    const costs = [7.61, 2.52, 0.45, 1.88];
    const lanes = costs.map((c, i) => finishedLane({ name: `l${i}`, costUsd: c }));
    s.apply(uiSnapshot({ lanes: lanes.slice(0, 3) }));
    expect(s.world.coins).toBe(Math.round(6 * Math.sqrt(7.61 + 2.52 + 0.45)));
    expect(s.world.particles).toEqual([]);
    s.apply(uiSnapshot({ lanes, now: at(1) }));
    expect(s.world.coins).toBe(21);
    const coins = s.world.particles.filter((p) => p.kind === "coin");
    expect(coins.length).toBeGreaterThanOrEqual(1);
    expect(coins.length).toBeLessThanOrEqual(3);
    for (const p of coins) expect(p.vy).toBe(-40);
    run(s, 0.7);
    expect(s.world.particles).toEqual([]);
    s.apply(uiSnapshot({ lanes: [finishedLane({ name: "big", costUsd: 500 })], now: at(2) }));
    expect(s.world.coins).toBe(48);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe("particles", () => {
  it("keeps at most 300, dropping the oldest", () => {
    const s = newScene();
    const lanes = Array.from({ length: 40 }, (_, i) =>
      builder(`l${String(i).padStart(2, "0")}`, { state: "running", toolCalls: 500 }),
    );
    s.apply(uiSnapshot({ lanes }));
    const failed = lanes.map((l) => ({ ...l, state: "finished" as const, endState: "failed" as const }));
    s.apply(uiSnapshot({ lanes: failed, now: at(1) }));
    expect(kinds(s).filter((k) => k === "fall")).toHaveLength(40);
    expect(s.world.particles).toHaveLength(300);
    run(s, 3);
    expect(s.world.pyramid.rubble).toBe(60);
  });
});

describe("reduced motion", () => {
  it("moves at once, makes no particles, still talks with bubbles open at once", () => {
    const s = newScene(true);
    s.apply(uiSnapshot());
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "running", toolCalls: 4 })], now: at(1) }));
    expect(s.world.reducedMotion).toBe(true);
    expect(mustActor(s, "a")).toMatchObject(PLACES.audience);
    expect(s.world.actors[0]!.bubble?.open).toBe(1);
    s.step(10);
    expect(s.world.actors[0]!.bubble?.open).toBe(1);
    until(s, () => kinds(s).includes("brief"), 3);
    s.step(10);
    const spot = workSpot(pyramidLayout(1).slots[0]!);
    expect(mustActor(s, "a")).toMatchObject({ ...spot, pose: "work" });
    expect(blockOf(s, "a").fill).toBeCloseTo(fillFor(4));
    run(s, 2);
    expect(kinds(s)).toEqual(["brief", "stone", "stone", "stone", "stone"]);
    expect(s.world.particles).toEqual([]);
  });

  it("jumps fills to their targets and sets a hoisting capstone at once", () => {
    const s = newScene(true);
    const lanes = [builder("a", { state: "running", toolCalls: 0, integration: "int" })];
    const open = uiIntegration({ name: "int", lanes: ["a"] });
    s.apply(uiSnapshot({ lanes, integrations: [open] }));
    s.apply(uiSnapshot({ lanes: [{ ...lanes[0]!, toolCalls: 30 }], integrations: [open], now: at(1) }));
    expect(blockOf(s, "a").fill).toBeCloseTo(fillFor(30));
    s.apply(
      uiSnapshot({
        lanes: [{ ...lanes[0]!, state: "finished", endState: "success", toolCalls: 30 }],
        integrations: [{ ...open, landedAt: at(2) }],
        now: at(3),
      }),
    );
    expect(s.world.pyramid.capstone).toMatchObject({ state: "set", ...s.world.pyramid.apex });
    expect(kinds(s)).toEqual(["set", "capstone"]);
    expect(s.world.particles).toEqual([]);
  });

  it("lays rubble without stones in the air", () => {
    const s = newScene(true);
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "running", toolCalls: 40 })] }));
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "finished", endState: "failed" })], now: at(1) }));
    expect(s.world.particles).toEqual([]);
    expect(s.world.pyramid.rubble).toBe(Math.round(fillFor(40) * 8));
  });
});

describe("pick and highlight", () => {
  function scene(): Scene {
    const s = newScene();
    s.apply(
      uiSnapshot({
        lanes: [
          builder("a", { state: "running", toolCalls: 4 }),
          finishedLane({ name: "b" }),
          uiLane({ name: "scout", role: "researcher", state: "running" }),
          builder("q"),
        ],
      }),
    );
    return s;
  }

  it("hits workers above their feet, then blocks", () => {
    const s = scene();
    const q = mustActor(s, "q");
    expect(s.pick(q.x, q.y - 1)).toBe("q");
    expect(s.pick(q.x + 6, q.y - 18)).toBe("q");
    expect(s.pick(q.x - 6, q.y)).toBe("q");
    expect(s.pick(q.x + 7, q.y - 1)).toBeNull();
    expect(s.pick(q.x, q.y - 19)).toBeNull();
    expect(s.pick(q.x, q.y + 1)).toBeNull();
    const a = mustActor(s, "a");
    expect(s.pick(a.x, a.y - 1)).toBe("a");
    const b = blockOf(s, "b");
    expect(s.pick(b.x + 1, b.y + 1)).toBe("b");
    expect(s.pick(5, 5)).toBeNull();
    expect(s.pick(PLACES.arbab.x, PLACES.arbab.y - 2)).toBeNull();
    const empty = s.world.pyramid.blocks.find((x) => x.lane === null)!;
    expect(s.pick(empty.x + 1, empty.y + 1)).toBeNull();
  });

  it("skips hidden workers and prefers the one in front", () => {
    const s = scene();
    until(s, () => mustActor(s, "scout").alpha === 0, 60);
    const scout = mustActor(s, "scout");
    expect(s.pick(scout.x, scout.y - 2)).toBeNull();
    const a = mustActor(s, "a");
    // Put the scout just behind a's feet: a, further front, wins.
    scout.alpha = 1;
    scout.x = a.x;
    scout.y = a.y - 2;
    expect(s.pick(a.x, a.y - 4)).toBe("a");
    scout.y = a.y + 2;
    expect(s.pick(a.x, a.y - 4)).toBe("scout");
  });

  it("marks one lane's worker and block, and clears the mark", () => {
    const s = scene();
    s.highlight("a");
    expect(mustActor(s, "a").highlight).toBe(true);
    expect(blockOf(s, "a").highlight).toBe(true);
    expect(blockOf(s, "b").highlight).toBe(false);
    expect(mustActor(s, "scout").highlight).toBe(false);
    const lanes = [builder("a", { state: "running", toolCalls: 5 }), finishedLane({ name: "b" })];
    s.apply(uiSnapshot({ lanes, now: at(1) }));
    expect(blockOf(s, "a").highlight).toBe(true);
    s.highlight("b");
    expect(mustActor(s, "a").highlight).toBe(false);
    expect(blockOf(s, "a").highlight).toBe(false);
    expect(blockOf(s, "b").highlight).toBe(true);
    s.highlight(null);
    expect(s.world.actors.some((x) => x.highlight)).toBe(false);
    expect(s.world.pyramid.blocks.some((x) => x.highlight)).toBe(false);
  });
});

describe("determinism", () => {
  function script(s: Scene): void {
    const lanes = [
      builder("a", { state: "running", toolCalls: 10 }),
      builder("b"),
      uiLane({ name: "rev", role: "reviewer", kind: "review", state: "running" }),
      uiLane({ name: "skep", role: "reviewer", kind: "skeptic", state: "running" }),
      uiLane({ name: "water", role: "probe", kind: "preflight", state: "running" }),
      uiLane({ name: "scout", role: "researcher", state: "running" }),
    ];
    s.apply(uiSnapshot({ lanes }));
    run(s, 3, undefined, 16);
    const next = lanes.map((l) =>
      l.name === "a"
        ? { ...l, toolCalls: 17, costUsd: 1.2 }
        : l.name === "b"
          ? { ...l, state: "running" as const, toolCalls: 3 }
          : l,
    );
    s.apply(uiSnapshot({ lanes: next, now: at(3) }));
    run(s, 8, undefined, 16);
    const failed = next.map((l) =>
      l.name === "a" ? { ...l, state: "finished" as const, endState: "failed" as const } : l,
    );
    s.apply(uiSnapshot({ lanes: failed, now: at(11) }));
    run(s, 12, undefined, 16);
  }

  it("gives deep-equal worlds for the same inputs and seed", () => {
    const one = newScene(false, 99);
    const two = newScene(false, 99);
    script(one);
    script(two);
    expect(one.world).toEqual(two.world);
    expect(one.world.events.length).toBeGreaterThan(0);
  });

  it("differs with another seed", () => {
    const one = newScene(false, 1);
    const two = newScene(false, 2);
    script(one);
    script(two);
    expect(one.world).not.toEqual(two.world);
  });
});
