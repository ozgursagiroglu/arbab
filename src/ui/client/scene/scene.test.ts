import { describe, expect, it } from "vitest";
import type { Actor, Block, Particle, Pose, Scene } from "../model";
import { PLACES, PYRAMID_AREA, WIDTH } from "../model";
import type { UiLane, UiSnapshot } from "../../protocol";
import { campSeat, farPyramidPlace, pyramidLayout, workSpot } from "./layout";
import { castOf, createScene, epochMs, featuredIntegration, fillFor, foreground, isBuilder, isSet, newest, rationFor } from "./scene";
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

  it("keeps every landing of the last 10 minutes in the foreground; the capstone shows the newest", () => {
    const first = uiIntegration({ name: "first", lanes: ["a"], updatedAt: at(-400), landedAt: at(-300) });
    const second = uiIntegration({ name: "second", lanes: ["b"], updatedAt: at(-200), landedAt: at(-60) });
    const old = uiIntegration({ name: "old", lanes: ["z"], updatedAt: at(-5000), landedAt: at(-4000) });
    const lanes = [
      finishedLane({ name: "z", integration: "old" }),
      finishedLane({ name: "a", integration: "first" }),
      finishedLane({ name: "b", integration: "second" }),
    ];
    // The snapshot's order does not decide which is newest: landedAt does.
    const fg = foreground(uiSnapshot({ lanes, integrations: [second, old, first] }));
    expect(fg.lanes.map((l) => l.name)).toEqual(["a", "b"]);
    expect(fg.capstone?.name).toBe("second");
    expect(fg.capstoneLanded).toBe(true);
    expect(fg.far.map((i) => i.name)).toEqual(["old"]);

    // Ten minutes after the first landed, only the second keeps its lanes.
    const later = foreground(uiSnapshot({ lanes, integrations: [old, first, second], now: at(300) }));
    expect(later.lanes.map((l) => l.name)).toEqual(["b"]);
    expect(later.capstone?.name).toBe("second");
    expect(later.far.map((i) => i.name)).toEqual(["first", "old"]);
  });

  it("lets a landing go far after 10 minutes", () => {
    const landed = uiIntegration({ name: "landed", lanes: ["a"], landedAt: at(-601) });
    // With other work in the foreground: without it, the landing would stand there as the monument.
    const lanes = [finishedLane({ name: "a", integration: "landed" }), uiLane({ name: "new" })];
    const fg = foreground(uiSnapshot({ lanes, integrations: [landed] }));
    expect(fg.lanes.map((l) => l.name)).toEqual(["new"]);
    expect(fg.capstone).toBeNull();
    expect(fg.monument).toBeNull();
    expect(fg.far.map((i) => i.name)).toEqual(["landed"]);
  });

  it("makes the newest landing the monument while the foreground holds no lane, and leaves it out of far", () => {
    const integrations = [1, 2, 3, 4, 5].map((n) =>
      uiIntegration({ name: `old-${n}`, lanes: [`l-${n}`], updatedAt: at(-9000 + n), landedAt: at(-7200 + n * 60) }),
    );
    const lanes = [1, 2, 3, 4, 5].map((n) => finishedLane({ name: `l-${n}`, integration: `old-${n}` }));
    // By landedAt, not by the snapshot's order.
    const fg = foreground(uiSnapshot({ lanes, integrations: [...integrations].reverse() }));
    expect(fg.lanes).toEqual([]);
    expect(fg.capstone).toBeNull();
    expect(fg.monument?.name).toBe("old-5");
    expect(fg.far.map((i) => i.name)).toEqual(["old-4", "old-3", "old-2"]);

    // Lanes that are not builders do not hold the foreground.
    const scout = uiLane({ name: "scout", role: "researcher", state: "running" });
    expect(foreground(uiSnapshot({ lanes: [...lanes, scout], integrations })).monument?.name).toBe("old-5");
    // Work in the foreground, even planned, sends it far.
    const busy = foreground(uiSnapshot({ lanes: [...lanes, uiLane({ name: "new" })], integrations }));
    expect(busy.monument).toBeNull();
    expect(busy.far.map((i) => i.name)).toEqual(["old-5", "old-4", "old-3"]);
  });

  it("has no monument with nothing landed, nor while a landing is within its 10 minutes", () => {
    expect(foreground(uiSnapshot()).monument).toBeNull();
    const open = uiIntegration({ name: "open", lanes: ["a"] });
    expect(foreground(uiSnapshot({ integrations: [open] })).monument).toBeNull();
    // The landing's lanes have left the snapshot: still no monument within the 10 minutes.
    const recent = uiIntegration({ name: "recent", lanes: ["a"], landedAt: at(-60) });
    const old = uiIntegration({ name: "old", lanes: ["z"], landedAt: at(-4000) });
    const fg = foreground(uiSnapshot({ integrations: [old, recent] }));
    expect(fg.monument).toBeNull();
    expect(fg.capstone?.name).toBe("recent");
    expect(fg.far.map((i) => i.name)).toEqual(["old"]);
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

describe("featuredIntegration", () => {
  it("is the capstone's: a recent landing, even with a newer integration open", () => {
    const landed = uiIntegration({ name: "landed", lanes: ["a"], updatedAt: at(-200), landedAt: at(-60) });
    const open = uiIntegration({ name: "open", lanes: ["b"], updatedAt: at(-10) });
    const lanes = [finishedLane({ name: "a", integration: "landed" }), uiLane({ name: "b", state: "running", integration: "open" })];
    expect(featuredIntegration(uiSnapshot({ lanes, integrations: [landed, open] }))?.name).toBe("landed");
  });

  it("is the capstone's: the open integration that merged a foreground builder, not a newer one that merged none", () => {
    const built = uiIntegration({ name: "built", lanes: ["a"], updatedAt: at(-300) });
    const reviewed = uiIntegration({ name: "reviewed", lanes: ["rev"], updatedAt: at(-10) });
    const lanes = [finishedLane({ name: "a", integration: "built" }), uiLane({ name: "rev", role: "reviewer", kind: "review", integration: "reviewed" })];
    expect(featuredIntegration(uiSnapshot({ lanes, integrations: [built, reviewed] }))?.name).toBe("built");
  });

  it("is the monument's while it stands, even with an integration open that holds no foreground lane", () => {
    const old = uiIntegration({ name: "old", lanes: ["z"], landedAt: at(-4000) });
    const idle = uiIntegration({ name: "idle", lanes: [], updatedAt: at(-10) });
    expect(featuredIntegration(uiSnapshot({ integrations: [old, idle] }))?.name).toBe("old");
  });

  it("is the newest open integration without a capstone or a monument, else the newest landed one", () => {
    const lanes = [uiLane({ name: "new", state: "running" })];
    const older = uiIntegration({ name: "older", updatedAt: at(-300) });
    const newer = uiIntegration({ name: "newer", updatedAt: at(-100) });
    const landedA = uiIntegration({ name: "landed-a", landedAt: at(-5000) });
    const landedB = uiIntegration({ name: "landed-b", landedAt: at(-4000) });
    expect(featuredIntegration(uiSnapshot({ lanes, integrations: [newer, landedB, older] }))?.name).toBe("newer");
    expect(featuredIntegration(uiSnapshot({ lanes, integrations: [landedB, landedA] }))?.name).toBe("landed-b");
    expect(featuredIntegration(uiSnapshot({ lanes }))).toBeNull();
    expect(featuredIntegration(uiSnapshot())).toBeNull();
  });
});

describe("epochMs, newest and isSet", () => {
  it("reads an ISO time, and sorts a missing or unparsable one oldest", () => {
    expect(epochMs(T0)).toBe(Date.parse(T0));
    expect(epochMs(null)).toBe(-Infinity);
    expect(epochMs("not a time")).toBe(-Infinity);
  });

  it("takes the newest by key, the later one at a tie, and null from nothing", () => {
    expect(newest([3, 1, 2], (n) => n)).toBe(3);
    const items = [{ id: "a", k: 1 }, { id: "b", k: 1 }, { id: "c", k: 0 }];
    expect(newest(items, (i) => i.k)?.id).toBe("b");
    expect(newest([{ id: "x" }], () => -Infinity)?.id).toBe("x");
    expect(newest([], () => 0)).toBeNull();
  });

  it("sets a block on success with a done report or none, never on a partial or blocked one or before the finish", () => {
    expect(isSet(finishedLane())).toBe(true);
    expect(isSet(finishedLane({ reportStatus: null }))).toBe(true);
    expect(isSet(finishedLane({ reportStatus: "partial" }))).toBe(false);
    expect(isSet(finishedLane({ reportStatus: "blocked" }))).toBe(false);
    expect(isSet(finishedLane({ endState: "failed" }))).toBe(false);
    expect(isSet(uiLane({ state: "running", endState: "success", reportStatus: "done" }))).toBe(false);
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

    expect(kinds(s, "me")).toEqual(["brief", "stone", "stone", "stone", "stone", "stone", "set", "report", "pay"]);
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
    expect(kinds(s)).toEqual(["report", "pay"]);
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

  describe("the pay at the ration table", () => {
    // The spend stays put, so no coins fly in for it: only the pay makes them.
    const finish = (s: Scene, extra: Partial<UiLane>): void => {
      const costUsd = extra.costUsd ?? null;
      s.apply(uiSnapshot({ lanes: [builder("a", { state: "running", toolCalls: 20, costUsd })] }));
      s.apply(uiSnapshot({ lanes: [builder("a", { state: "finished", toolCalls: 20, ...extra })], now: at(1) }));
    };
    const coins = (s: Scene): Particle[] => s.world.particles.filter((p) => p.kind === "coin");

    /** Steps until the pay; what stood before that step and what the step made. */
    function toPay(s: Scene): { before: Actor; after: Actor | undefined; coins: Particle[] } {
      let before = { ...mustActor(s, "a") };
      let had = coins(s).length;
      for (let t = 0; t < 60_000; t += 50) {
        before = { ...mustActor(s, "a") };
        had = coins(s).length;
        s.step(50);
        if (kinds(s).includes("pay")) return { before, after: actorOf(s, "a"), coins: coins(s).slice(had) };
      }
      throw new Error("no pay");
    }

    it("fires once, with the lane, in the step the pause ends and the ration is carried, and coins jump", () => {
      const s = newScene();
      finish(s, { endState: "success", costUsd: 2 });
      const { before, after, coins: made } = toPay(s);
      expect(before).toMatchObject({ pose: "idle", ...PLACES.rations, ration: 0 });
      expect(after).toMatchObject({ pose: "carry-ration", ration: 2 });
      expect(s.world.events.filter((e) => e.kind === "pay")).toEqual([{ kind: "pay", lane: "a" }]);
      expect(made.length).toBeGreaterThanOrEqual(3);
      expect(made.length).toBeLessThanOrEqual(5);
      for (const p of made) {
        expect(Math.abs(p.x - PLACES.treasury.x)).toBeLessThanOrEqual(6);
        expect(p.y).toBeLessThan(PLACES.treasury.y);
        expect(p.vy).toBeLessThan(0);
      }
      until(s, () => actorOf(s, "a") === undefined, 60);
      expect(kinds(s, "a").filter((k) => k === "pay")).toHaveLength(1);
      // The coins fall back and are gone.
      expect(coins(s)).toEqual([]);
    });

    it.each<[string, Partial<UiLane>]>([
      ["a failure", { endState: "failed" }],
      ["a blocked report", { endState: "success", reportStatus: "blocked", costUsd: 2 }],
    ])("fires nothing when the worker leaves empty-handed after %s", (_, extra) => {
      const s = newScene();
      finish(s, extra);
      let jumped = false;
      until(s, () => actorOf(s, "a") === undefined, 60, () => {
        if (coins(s).length > 0) jumped = true;
      });
      expect(kinds(s)).not.toContain("pay");
      expect(jumped).toBe(false);
    });

    it("fires in reduced motion too, without coins", () => {
      const s = newScene(true);
      finish(s, { endState: "success", costUsd: 2 });
      const { before, coins: made } = toPay(s);
      expect(before).toMatchObject({ pose: "idle", ...PLACES.rations });
      expect(made).toEqual([]);
      expect(s.world.particles).toEqual([]);
      // Without motion it reaches the exit in the same step.
      until(s, () => actorOf(s, "a") === undefined, 60);
      expect(s.world.events.filter((e) => e.kind === "pay")).toEqual([{ kind: "pay", lane: "a" }]);
    });

    it("is deterministic for a seed", () => {
      const once = (): string => {
        const s = newScene(false, 11);
        finish(s, { endState: "success", costUsd: 7 });
        const { coins: made } = toPay(s);
        return JSON.stringify({ made, world: s.world });
      };
      expect(once()).toBe(once());
    });
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
        glow: 0,
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

  it("lets a hoist finish before a landing that comes meanwhile hoists its own from the sledge", () => {
    const s = newScene();
    const two = [...lanes, finishedLane({ name: "c", integration: "int2" })];
    const one = uiIntegration({ name: "int", lanes: ["a", "b"], updatedAt: at(-30), verify: "passed" });
    const other = uiIntegration({ name: "int2", lanes: ["c"], updatedAt: at(-20), verify: "failed", ready: false });
    s.apply(uiSnapshot({ lanes: two, integrations: [one, other] }));
    s.apply(uiSnapshot({ lanes: two, integrations: [{ ...one, landedAt: at(1) }, other], now: at(2) }));
    const cap = s.world.pyramid.capstone;
    expect(cap).toMatchObject({ state: "hoisting", integration: "int", flag: "passed" });
    run(s, 1);
    const y = cap.y;

    // int2 lands while int's capstone is on its way up: int's keeps rising, then sets.
    const both = [
      { ...one, landedAt: at(1) },
      { ...other, landedAt: at(3) },
    ];
    s.apply(uiSnapshot({ lanes: two, integrations: both, now: at(3) }));
    expect(cap).toMatchObject({ state: "hoisting", integration: "int", flag: "passed", y });
    expect(s.world.pyramid.blocks.filter((b) => b.lane !== null).map((b) => b.lane)).toEqual(["a", "b", "c"]);
    run(s, 1);
    s.apply(uiSnapshot({ lanes: two, integrations: both, now: at(4) }));
    expect(cap).toMatchObject({ state: "hoisting", integration: "int" });
    expect(cap.y).toBeLessThan(y);
    until(s, () => kinds(s).length > 0, 3);
    expect(kinds(s)).toEqual(["capstone"]);
    expect(s.world.events).toEqual([{ kind: "capstone", lane: "int" }]);

    // int's stays set on the apex for 1.5 s, through another snapshot too, before int2's rises.
    const apex = s.world.pyramid.apex;
    expect(cap).toMatchObject({ state: "set", integration: "int", flag: "passed", ...apex, glow: 1 });
    run(s, 0.75);
    s.apply(uiSnapshot({ lanes: two, integrations: both, now: at(8) }));
    expect(cap).toMatchObject({ state: "set", integration: "int", flag: "passed", ...apex });
    const held = 0.75 + until(s, () => cap.state !== "set", 2);
    expect(held).toBeGreaterThanOrEqual(1.45);
    expect(held).toBeLessThanOrEqual(1.55);

    // Then int2's starts from the sledge, with its own flag, and sets in about 3 s.
    expect(cap).toMatchObject({ state: "hoisting", integration: "int2", flag: "failed", ready: false, ...PLACES.sledge });
    expect(cap.glow).toBe(0);
    // The pyramid int's capstone finished waits, dotted, for int2's.
    expect(s.world.pyramid.blocks.filter((b) => b.lane === null).every((b) => b.look === "empty")).toBe(true);
    const took = until(s, () => cap.state === "set", 4);
    expect(took).toBeGreaterThanOrEqual(2.95);
    expect(took).toBeLessThanOrEqual(3.1);
    expect(cap).toMatchObject({ state: "set", integration: "int2", ...s.world.pyramid.apex });
    expect(s.world.events).toEqual([
      { kind: "capstone", lane: "int" },
      { kind: "capstone", lane: "int2" },
    ]);
  });

  it("is set at once when the first snapshot shows it landed", () => {
    const s = newScene();
    const landed = uiIntegration({ name: "int", lanes: ["a", "b"], landedAt: at(-60) });
    s.apply(uiSnapshot({ lanes, integrations: [landed] }));
    expect(s.world.pyramid.capstone).toMatchObject({ state: "set", ...s.world.pyramid.apex });
    expect(s.world.events).toEqual([]);
    expect(s.world.actors[0]!.pose).toBe("idle");
  });

  it("finishes the pyramid under a set capstone: every slot without a lane a set block, dotted again after", () => {
    const free = (s: Scene): Block[] => s.world.pyramid.blocks.filter((b) => b.lane === null);
    const finished = (s: Scene): boolean => free(s).every((b) => b.look === "set" && b.fill === 1);
    const dotted = (s: Scene): boolean => free(s).every((b) => b.look === "empty" && b.fill === 0);
    const s = newScene();
    const open = uiIntegration({ name: "int", lanes: ["a", "b"], verify: "passed" });
    s.apply(uiSnapshot({ lanes, integrations: [open] }));
    // Two lanes on a base-4 pyramid: eight slots without one.
    expect(free(s)).toHaveLength(8);
    expect(s.world.pyramid.capstone.state).toBe("waiting");
    expect(dotted(s)).toBe(true);
    // Still dotted while it rises; finished the moment it sets, with the lanes' own blocks untouched.
    s.apply(uiSnapshot({ lanes, integrations: [{ ...open, landedAt: at(1) }], now: at(2) }));
    expect(s.world.pyramid.capstone.state).toBe("hoisting");
    expect(dotted(s)).toBe(true);
    until(s, () => s.world.pyramid.capstone.state === "set", 4);
    expect(finished(s)).toBe(true);
    expect(s.world.pyramid.blocks.filter((b) => b.lane !== null).map((b) => b.lane)).toEqual(["a", "b"]);
    expect(s.pick(free(s)[0]!.x + 1, free(s)[0]!.y + 1)).toBeNull();
    // Another snapshot rebuilds the pyramid: still finished.
    s.apply(uiSnapshot({ lanes, integrations: [{ ...open, landedAt: at(1) }], now: at(10) }));
    expect(finished(s)).toBe(true);
    // Once the landing is old and new work starts, the capstone is gone and the free slots are dotted again.
    s.apply(uiSnapshot({ lanes: [builder("new")], integrations: [{ ...open, landedAt: at(1) }], now: at(1200) }));
    expect(s.world.pyramid.capstone.state).toBe("none");
    expect(free(s).length).toBeGreaterThan(0);
    expect(dotted(s)).toBe(true);
  });

  it("finishes the pyramid at once under a capstone set at the baseline or in reduced motion", () => {
    const free = (s: Scene): Block[] => s.world.pyramid.blocks.filter((b) => b.lane === null);
    const baseline = newScene();
    baseline.apply(uiSnapshot({ lanes, integrations: [uiIntegration({ name: "int", lanes: ["a", "b"], landedAt: at(-60) })] }));
    expect(baseline.world.pyramid.capstone.state).toBe("set");
    expect(free(baseline).map((b) => [b.look, b.fill])).toEqual(Array.from({ length: 8 }, () => ["set", 1]));
    const reduced = newScene(true);
    const open = uiIntegration({ name: "int", lanes: ["a", "b"] });
    reduced.apply(uiSnapshot({ lanes, integrations: [open] }));
    reduced.apply(uiSnapshot({ lanes, integrations: [{ ...open, landedAt: at(1) }], now: at(2) }));
    expect(reduced.world.pyramid.capstone.state).toBe("set");
    expect(free(reduced).every((b) => b.look === "set" && b.fill === 1)).toBe(true);
  });

  it("stands landed integrations on the horizon", () => {
    const s = newScene();
    const integrations = [1, 2, 3, 4].map((n) => {
      const merged = Array.from({ length: n * 5 }, (_, k) => `x${k}`);
      return uiIntegration({ name: `i${n}`, lanes: merged, landedAt: at(-7200 + n) });
    });
    // Work in the foreground, so the newest stands far too rather than as the monument.
    s.apply(uiSnapshot({ lanes: [builder("new")], integrations }));
    expect(s.world.pyramid.monument).toBeNull();
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
    // The workers walking off raise dust on top of the falling stones: the cap still holds.
    let dust = 0;
    run(s, 3, () => {
      expect(s.world.particles.length).toBeLessThanOrEqual(300);
      dust = Math.max(dust, s.world.particles.filter((p) => p.kind === "dust").length);
    });
    expect(dust).toBeGreaterThan(0);
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

// ---------------------------------------------------------------------------------------------------------------

describe("the idle monument", () => {
  // Twelve lanes (base 5), so its layout differs from that of one new lane (base 4).
  const merged = Array.from({ length: 12 }, (_, i) => `m${String(i).padStart(2, "0")}`);
  const finished = merged.map((name, i) => finishedLane({ name, integration: "int-m", firstSeen: at(-8000 + i) }));
  const older = uiIntegration({ name: "int-o", lanes: ["o1"], updatedAt: at(-9100), landedAt: at(-9000) });
  const open = uiIntegration({ name: "int-m", lanes: merged, updatedAt: at(-7300), verify: "passed", ready: false });
  const landed = { ...open, landedAt: at(-7200) };

  function expectMonument(s: Scene): void {
    const p = s.world.pyramid;
    const layout = pyramidLayout(merged.length);
    expect(layout.base).toBe(5);
    expect(p.monument).toBe("int-m");
    expect([p.base, p.blockW, p.blockH]).toEqual([layout.base, layout.blockW, layout.blockH]);
    expect(p.apex).toEqual(layout.apex);
    expect(p.blocks.map((b) => [b.x, b.y, b.w, b.h])).toEqual(layout.slots.map((x) => [x.x, x.y, x.w, x.h]));
    for (const b of p.blocks) expect(b).toMatchObject({ look: "set", fill: 1 });
    expect(p.blocks.map((b) => b.lane)).toEqual([...merged, null, null, null]);
    expect(p.capstone).toEqual({ state: "set", integration: "int-m", ...layout.apex, flag: "passed", ready: true, glow: 0 });
    // Not also on the horizon.
    expect(s.world.far.map((f) => f.integration)).toEqual(["int-o"]);
  }

  it("stands at the baseline while no lane builds", () => {
    const s = newScene();
    s.apply(uiSnapshot({ lanes: finished, integrations: [older, landed] }));
    expectMonument(s);
    expect(s.world.events).toEqual([]);
    expect(s.world.shake).toBe(0);
    run(s, 2);
    expectMonument(s);
    expect(s.world.particles).toEqual([]);
    // Its blocks carry the lane names: they can be picked and highlighted.
    const block = s.world.pyramid.blocks[3]!;
    expect(s.pick(block.x + 1, block.y + 1)).toBe("m03");
    s.highlight("m03");
    expect(s.world.pyramid.blocks.filter((b) => b.highlight).map((b) => b.lane)).toEqual(["m03"]);
  });

  it("flies the flag of its verify", () => {
    const flag = (verify: "passed" | "failed" | null): string => {
      const s = newScene();
      s.apply(uiSnapshot({ integrations: [{ ...landed, verify }] }));
      return s.world.pyramid.capstone.flag;
    };
    expect([flag("passed"), flag("failed"), flag(null)]).toEqual(["passed", "failed", "none"]);
  });

  it("stands live once the last lane leaves, at once", () => {
    const s = newScene();
    s.apply(uiSnapshot({ lanes: [builder("w", { state: "running", toolCalls: 3 })], integrations: [older, landed] }));
    expect(s.world.pyramid.monument).toBeNull();
    expect(s.world.far.map((f) => f.integration)).toEqual(["int-m", "int-o"]);
    s.apply(uiSnapshot({ integrations: [older, landed], now: at(1) }));
    expectMonument(s);
    expect(kinds(s)).toEqual([]);
  });

  it("is the foreground's landing itself once its 10 minutes pass, not before", () => {
    const s = newScene();
    s.apply(uiSnapshot({ lanes: finished, integrations: [older, open] }));
    expect(s.world.pyramid.capstone.state).toBe("waiting");
    const now = { ...open, landedAt: at(1) };
    s.apply(uiSnapshot({ lanes: finished, integrations: [older, now], now: at(2) }));
    // Within its 10 minutes the landing is the foreground, with its lanes and its hoist.
    expect(s.world.pyramid.monument).toBeNull();
    expect(s.world.pyramid.capstone.state).toBe("hoisting");
    until(s, () => s.world.pyramid.capstone.state === "set", 4);
    s.apply(uiSnapshot({ lanes: finished, integrations: [older, now], now: at(600) }));
    expect(s.world.pyramid.monument).toBeNull();
    expect(s.world.pyramid.blocks.filter((b) => b.lane !== null).map((b) => b.look)).toEqual(merged.map(() => "set"));
    s.apply(uiSnapshot({ lanes: finished, integrations: [older, now], now: at(602) }));
    expectMonument(s);
    expect(kinds(s)).toEqual(["capstone"]);
  });

  it("leaves for the horizon at once when work starts, live and in reduced motion", () => {
    for (const reduced of [false, true]) {
      const s = newScene(reduced);
      s.apply(uiSnapshot({ lanes: finished, integrations: [older, landed] }));
      expectMonument(s);
      s.apply(uiSnapshot({ lanes: [...finished, builder("new")], integrations: [older, landed], now: at(1) }));
      const p = s.world.pyramid;
      const layout = pyramidLayout(1);
      expect(p.monument).toBeNull();
      expect([p.base, p.blockW, p.blockH]).toEqual([layout.base, layout.blockW, layout.blockH]);
      expect(p.apex).toEqual(layout.apex);
      // The new work's outline: its planned block, then empty slots.
      expect(p.blocks.map((b) => [b.lane, b.look])).toEqual([
        ["new", "planned"],
        ...layout.slots.slice(1).map(() => [null, "empty"]),
      ]);
      expect(p.capstone).toEqual({ state: "none", integration: null, ...PLACES.sledge, flag: "none", ready: false, glow: 0 });
      expect(s.world.far).toEqual([
        { integration: "int-m", ...farPyramidPlace(0, merged.length) },
        { integration: "int-o", ...farPyramidPlace(1, 1) },
      ]);
      expect(kinds(s)).toEqual([]);
      expect(s.world.shake).toBe(0);
    }
  });

  it("leaves the empty outline with nothing landed", () => {
    const s = newScene();
    s.apply(uiSnapshot({ integrations: [uiIntegration({ name: "open", lanes: ["a"] })] }));
    const p = s.world.pyramid;
    expect(p.monument).toBeNull();
    expect(p.blocks).toHaveLength(pyramidLayout(0).slots.length);
    for (const b of p.blocks) expect(b).toMatchObject({ lane: null, look: "empty", fill: 0 });
    expect(p.capstone).toMatchObject({ state: "none", integration: null });
    expect(s.world.far).toEqual([]);
  });
});

describe("time", () => {
  it("starts at 0 and adds each step's seconds, a long step cut to 100 ms", () => {
    for (const reduced of [false, true]) {
      const s = newScene(reduced);
      expect(s.world.time).toBe(0);
      s.apply(uiSnapshot({ lanes: [builder("a", { state: "running" })] }));
      expect(s.world.time).toBe(0);
      s.step(16);
      s.step(34);
      expect(s.world.time).toBeCloseTo(0.05, 9);
      s.step(10_000);
      expect(s.world.time).toBeCloseTo(0.15, 9);
      for (const dt of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) s.step(dt);
      expect(s.world.time).toBeCloseTo(0.15, 9);
      run(s, 2);
      expect(s.world.time).toBeCloseTo(2.15, 9);
    }
  });
});

describe("shake and glow", () => {
  const lanes = [finishedLane({ name: "a", integration: "int" }), finishedLane({ name: "b", integration: "int" })];
  const open = uiIntegration({ name: "int", lanes: ["a", "b"], verify: "passed" });

  it("shakes 2 px on a live fall, decaying at 6 px/s", () => {
    const s = newScene();
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "running", toolCalls: 40 })] }));
    expect(s.world.shake).toBe(0);
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "finished", endState: "failed" })], now: at(1) }));
    expect(s.world.shake).toBe(2);
    s.step(100);
    expect(s.world.shake).toBeCloseTo(1.4, 9);
    s.step(100);
    expect(s.world.shake).toBeCloseTo(0.8, 9);
    run(s, 0.15);
    expect(s.world.shake).toBe(0);
    run(s, 1);
    expect(s.world.shake).toBe(0);
  });

  it("does not shake for a block fallen at the baseline", () => {
    const s = newScene();
    s.apply(uiSnapshot({ lanes: [finishedLane({ name: "a", endState: "failed", reportStatus: null })] }));
    expect(s.world.pyramid.rubble).toBe(4);
    expect(s.world.shake).toBe(0);
  });

  it("shakes 3 px and lights the capstone when a hoist sets it; the larger shake wins", () => {
    const s = newScene();
    s.apply(uiSnapshot({ lanes: [...lanes, builder("c", { state: "running", toolCalls: 40 })], integrations: [open] }));
    s.apply(
      uiSnapshot({
        lanes: [...lanes, builder("c", { state: "running", toolCalls: 40 })],
        integrations: [{ ...open, landedAt: at(1) }],
        now: at(2),
      }),
    );
    const cap = s.world.pyramid.capstone;
    expect(cap).toMatchObject({ state: "hoisting", glow: 0 });
    until(s, () => cap.state === "set", 4);
    expect(s.world.shake).toBe(3);
    expect(cap.glow).toBe(1);
    // A fall now does not lower the shake.
    s.apply(
      uiSnapshot({
        lanes: [...lanes, builder("c", { state: "finished", endState: "failed" })],
        integrations: [{ ...open, landedAt: at(1) }],
        now: at(3),
      }),
    );
    expect(kinds(s)).toEqual(["capstone", "fall"]);
    expect(s.world.shake).toBe(3);
    s.step(100);
    expect(s.world.shake).toBeCloseTo(2.4, 9);
    expect(cap.glow).toBeCloseTo(0.975, 9);
    run(s, 0.9);
    expect(cap.glow).toBeCloseTo(0.75, 9);
    expect(s.world.shake).toBeCloseTo(0, 9);
    run(s, 3.05);
    expect(cap.glow).toBe(0);
    expect(cap.state).toBe("set");
    // Another snapshot keeps the set capstone as it is.
    s.apply(uiSnapshot({ lanes, integrations: [{ ...open, landedAt: at(1) }], now: at(10) }));
    expect(cap).toMatchObject({ state: "set", glow: 0 });
  });

  it("gives no glow to a capstone already set at the baseline", () => {
    const s = newScene();
    s.apply(uiSnapshot({ lanes, integrations: [{ ...open, landedAt: at(-60) }] }));
    expect(s.world.pyramid.capstone).toMatchObject({ state: "set", glow: 0 });
    expect(s.world.shake).toBe(0);
  });

  it("never shakes in reduced motion; the capstone still glows", () => {
    const s = newScene(true);
    s.apply(uiSnapshot({ lanes: [...lanes, builder("c", { state: "running", toolCalls: 40 })], integrations: [open] }));
    s.apply(
      uiSnapshot({
        lanes: [...lanes, builder("c", { state: "finished", endState: "failed" })],
        integrations: [{ ...open, landedAt: at(1) }],
        now: at(2),
      }),
    );
    expect(kinds(s)).toEqual(["fall", "capstone"]);
    expect(s.world.shake).toBe(0);
    expect(s.world.pyramid.capstone).toMatchObject({ state: "set", glow: 1 });
    run(s, 2);
    expect(s.world.shake).toBe(0);
    expect(s.world.pyramid.capstone.glow).toBeCloseTo(0.5, 9);
  });
});

describe("dust underfoot", () => {
  const WALKING: ReadonlySet<Pose> = new Set<Pose>(["walk", "slump", "carry-scroll", "carry-stone", "carry-ration"]);

  interface Puff {
    p: Particle;
    pose: Pose;
    feet: { x: number; y: number };
  }

  /** Steps the scene, logging each new dust particle with the pose and feet of the lane's worker in that step. */
  function watch(s: Scene, lane: string): { puffs: Puff[]; poses: Set<Pose>; walked: () => number; each: () => void } {
    const seen = new Set<Particle>(s.world.particles);
    const puffs: Puff[] = [];
    const poses = new Set<Pose>();
    let walked = 0;
    let last: { x: number; y: number } | null = null;
    const each = (): void => {
      const a = actorOf(s, lane);
      if (a) {
        poses.add(a.pose);
        if (last !== null && WALKING.has(a.pose) && (a.x !== last.x || a.y !== last.y)) walked += 0.05;
        last = { x: a.x, y: a.y };
      }
      for (const p of s.world.particles) {
        if (seen.has(p)) continue;
        seen.add(p);
        if (p.kind === "dust" && a) puffs.push({ p: { ...p }, pose: a.pose, feet: { x: a.x, y: a.y } });
      }
    };
    return { puffs, poses, walked: () => walked, each };
  }

  it("puffs one dust every 0.25 s of walking, at the feet, none while sitting, talking, climbing or working", () => {
    const done = ["d1", "d2", "d3", "d4"].map((name, i) => finishedLane({ name, firstSeen: at(-7200 + i) }));
    const me = (extra: Partial<UiLane>): UiLane => uiLane({ name: "me", firstSeen: at(-3600), ...extra });
    const s = newScene();
    s.apply(uiSnapshot({ lanes: done }));
    s.apply(uiSnapshot({ lanes: [...done, me({ state: "queued" })], now: at(1) }));
    const w = watch(s, "me");
    w.each();
    until(s, () => mustActor(s, "me").pose === "sit", 10, w.each);
    run(s, 2, w.each);
    // No tool calls: no strokes, so every dust is underfoot.
    s.apply(uiSnapshot({ lanes: [...done, me({ state: "running", toolCalls: 0 })], now: at(10) }));
    until(s, () => mustActor(s, "me").pose === "work", 60, w.each);
    run(s, 3, w.each);

    for (const pose of ["walk", "sit", "talk", "carry-stone", "climb-stone", "work"] as const) expect(w.poses).toContain(pose);
    expect(w.walked()).toBeGreaterThan(5);
    const expected = Math.floor(w.walked() / 0.25);
    expect(w.puffs.length).toBeGreaterThanOrEqual(expected - 1);
    expect(w.puffs.length).toBeLessThanOrEqual(expected + 1);
    for (const { p, pose, feet } of w.puffs) {
      expect(WALKING.has(pose)).toBe(true);
      expect(p.vx).toBeGreaterThanOrEqual(-4);
      expect(p.vx).toBeLessThanOrEqual(4);
      expect(p.vy).toBeGreaterThanOrEqual(-6);
      expect(p.vy).toBeLessThanOrEqual(-2);
      // Made at the feet, then moved for the rest of the step.
      expect(Math.abs(p.x - feet.x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(p.y - feet.y)).toBeLessThanOrEqual(0.5);
    }
  });

  it("puffs while a worker slumps off", () => {
    const s = newScene();
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "running", toolCalls: 40 })] }));
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "finished", endState: "failed" })], now: at(1) }));
    const w = watch(s, "a");
    until(s, () => actorOf(s, "a") === undefined, 60, w.each);
    expect(w.puffs.some((x) => x.pose === "slump")).toBe(true);
    expect(w.puffs.every((x) => WALKING.has(x.pose))).toBe(true);
  });

  it("raises none in reduced motion", () => {
    const s = newScene(true);
    s.apply(uiSnapshot());
    s.apply(uiSnapshot({ lanes: [builder("a")], now: at(1) }));
    s.apply(uiSnapshot({ lanes: [builder("a", { state: "running" })], now: at(2) }));
    run(s, 5, () => expect(s.world.particles).toEqual([]));
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
    expect(one.world.time).toBeCloseTo(23, 1);
  });

  it("differs with another seed", () => {
    const one = newScene(false, 1);
    const two = newScene(false, 2);
    script(one);
    script(two);
    expect(one.world).not.toEqual(two.world);
  });
});
