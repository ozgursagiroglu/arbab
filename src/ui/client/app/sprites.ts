// The pixel art (DESIGN.md §19): palette-indexed string grids, one character per pixel and `.` transparent, compiled
// once into horizontal runs of one color. Workers are put together from parts (head, torso and arms, kilt, legs, held
// items) so every cast gets every pose; the parts are drawn facing right and the renderer mirrors them.
import type { Cast, Icon, Pose } from "../model";
import { ACTOR_BOX, ARBAB_BOX } from "../model";
import { castColors, ghostly, SPRITE_CHARS } from "./palette";

export interface Run {
  x: number;
  y: number;
  w: number;
  color: string;
}

/** A compiled grid: runs from its top-left corner, and the same runs mirrored left to right. */
export interface Sprite {
  w: number;
  h: number;
  /** The first row with a pixel: where the head (or jug) starts. */
  top: number;
  runs: Run[];
  mirrored: Run[];
}

export type Grid = readonly string[];

export const POSES: readonly Pose[] = [
  "idle",
  "walk",
  "climb",
  "sit",
  "work",
  "sleep",
  "talk",
  "carry-scroll",
  "carry-stone",
  "carry-ration",
  "slump",
  "cheer",
];

export const WORKER_CASTS: readonly Exclude<Cast, "arbab">[] = [
  "laborer",
  "mason",
  "scribe",
  "skeptic",
  "surveyor",
  "waterboy",
  "scout",
];

/** The lying worker's box: wider than ACTOR_BOX, at its bottom. */
export const SLEEP_BOX = { w: 16, h: 7 } as const;

// ---------------------------------------------------------------------------------------------------------------
// Compiling

/** Grid → runs. Characters outside `colors` are a bug in the art and throw. */
export function compile(grid: Grid, colors: Readonly<Record<string, string>>): Sprite {
  const h = grid.length;
  const w = Math.max(0, ...grid.map((row) => row.length));
  const runs: Run[] = [];
  let top = h;
  for (let y = 0; y < h; y++) {
    const row = grid[y] ?? "";
    let x = 0;
    while (x < row.length) {
      const ch = row[x] ?? ".";
      if (ch === ".") {
        x++;
        continue;
      }
      const color = colors[ch];
      if (color === undefined) throw new Error(`sprite character ${JSON.stringify(ch)} has no color`);
      let end = x + 1;
      while (end < row.length && colors[row[end] ?? "."] === color) end++;
      runs.push({ x, y, w: end - x, color });
      top = Math.min(top, y);
      x = end;
    }
  }
  return { w, h, top: top === h ? 0 : top, runs, mirrored: runs.map((r) => ({ ...r, x: w - r.x - r.w })) };
}

interface Layer {
  grid: Grid;
  dx?: number;
  dy?: number;
}

/** Layers drawn in order onto a w × h grid; a pixel outside it is a bug in the art and throws. */
export function compose(w: number, h: number, layers: readonly Layer[]): string[] {
  const cells: string[][] = Array.from({ length: h }, () => Array.from({ length: w }, () => "."));
  for (const { grid, dx = 0, dy = 0 } of layers) {
    grid.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x] ?? ".";
        if (ch === "." || ch === "+") continue;
        const cx = x + dx;
        const cy = y + dy;
        const line = cells[cy];
        if (line === undefined || cx < 0 || cx >= w) throw new Error(`sprite pixel (${cx}, ${cy}) is outside ${w}×${h}`);
        line[cx] = ch;
      }
    });
  }
  return cells.map((line) => line.join(""));
}

function find(grid: Grid, ch: string): { x: number; y: number } | null {
  for (let y = 0; y < grid.length; y++) {
    const x = (grid[y] ?? "").indexOf(ch);
    if (x >= 0) return { x, y };
  }
  return null;
}

/** An item layer whose `+` lands on the grid's `anchor` character (`*` front hand, `&` back hand). */
function held(base: Grid, item: Grid, anchor: "*" | "&"): Layer {
  const hand = find(base, anchor);
  const grip = find(item, "+");
  if (!hand || !grip) throw new Error(`no ${anchor} or + to hold an item by`);
  return { grid: item, dx: hand.x - grip.x, dy: hand.y - grip.y };
}

function withItem(base: Grid, item: Grid | null, anchor: "*" | "&" = "*"): string[] {
  const layers: Layer[] = [{ grid: base }];
  if (item) layers.push(held(base, item, anchor));
  return compose(base[0]?.length ?? 0, base.length, layers);
}

// ---------------------------------------------------------------------------------------------------------------
// Worker parts, 12 wide. Rows 0–7 head, 8–12 torso and arms (hands on row 12), 12–14 kilt, 15–17 legs.
// h headcloth (hair for scribes), t torso skin (a scout's cloak), s sash, * front hand, & back hand.

const HEAD: Grid = [
  "....ooooo...",
  "...ohhhhho..",
  "..ohhhhhhho.",
  "..oHhhhkkko.",
  "..oHhhkkoko.",
  "..oHhhkkkkko",
  "..oHhokkKko.",
  "..oHo.okko..",
];

const HEAD_TALK: Grid = patch(HEAD, [[6, 9, "o"]]);

const HEAD_DOWN: Grid = [
  "............",
  "....ooooo...",
  "...ohhhhho..",
  "..ohhhhhhho.",
  "..oHhhhhkko.",
  "..oHhhkkkko.",
  "..oHhhkoKko.",
  "..oHhokkkko.",
];

const HEAD_UP: Grid = [
  "....ooooo...",
  "...ohhhhho..",
  "..ohhhhhkko.",
  "..oHhhkkoko.",
  "..oHhhkkkkko",
  "..oHhokkkko.",
  "..oHhoKkko..",
  "..oHo.oko...",
];

function patch(grid: Grid, cells: readonly [number, number, string][]): string[] {
  const rows = [...grid];
  for (const [y, x, ch] of cells) {
    const row = rows[y] ?? "";
    rows[y] = row.slice(0, x) + ch + row.slice(x + 1);
  }
  return rows;
}

/** Torso and arms, rows 8–12. */
const TORSO = {
  idle: ["..otttttto..", ".oTtttttTko.", ".okTttttTko.", ".okossssoko.", ".o&o....o*o."],
  swingA: ["..otttttto..", ".oTtttttTko.", "o&oTttttTko.", "oo.ossssok*o", "...........o"],
  swingB: ["..otttttto..", ".oTtttttTko.", "okoTttttTo..", "o&ossssso*o.", ".o.....oo.o."],
  /** The front forearm forward, hand at chest height. */
  hold: ["..otttttto..", ".oTtttttTo..", ".okTttttko*o", ".okosssso.o.", ".o&o........"],
  /** The back hand up at the shoulder, steadying a load. */
  shoulder: ["..o&ttttto..", ".okTttttTko.", ".oTTttttTko.", "..ossssoko..", "........o*o."],
  /** Both forearms forward, holding something before the chest. */
  write: ["..otttttto..", ".oTtttttTo..", ".ok&ttttt*o.", ".okosssso.o.", ".oo........."],
};

/** Raised arms reach above the torso: rows 4–12. */
const ARMS_UP = {
  /** The front arm up, hand above the brow. */
  front: [
    "..........o.",
    ".........o*o",
    ".........oko",
    ".........oko",
    "..ottttttoko",
    ".oTtttttTko.",
    ".okTttttto..",
    ".okosssso...",
    ".o&o........",
  ],
  /** Both arms up. */
  both: [
    ".o........o.",
    "o&o......o*o",
    "oko......oko",
    "oko......oko",
    "okottttttoko",
    ".okTttttTko.",
    "..oTttttto..",
    "..ossssso...",
    "............",
  ],
  /** Both arms half up, elbows out. */
  half: [
    "............",
    "............",
    "o&o......o*o",
    "oko......oko",
    "okottttttoko",
    ".okTttttTko.",
    "..oTttttto..",
    "..ossssso...",
    "............",
  ],
  /** One arm up the ladder, the other lower. */
  climbA: [
    ".........o*o",
    ".........oko",
    ".........oko",
    "........oko.",
    "..ottttttko.",
    ".o&tttttTo..",
    ".okTttttto..",
    "..ossssso...",
    "............",
  ],
  climbB: [
    "............",
    "............",
    "..........o.",
    ".........o*o",
    "..ottttttoko",
    ".o&tttttTko.",
    ".okTttttto..",
    "..ossssso...",
    "............",
  ],
};

const KILT: Grid = ["...owwwWo...", "..owwwwWWo..", "..oowwwWoo.."];

/** Legs, rows 15–17. */
const LEGS = {
  stand: ["...oko.oko..", "...oko.oko..", "..ooo..oooo."],
  strideA: ["..oKo..oko..", ".oKo....oko.", ".ooo....oooo"],
  pass: ["....oKko....", "....oKko....", "....oooooo.."],
  strideB: ["..oko..oKo..", ".oko....oKo.", ".ooo....oooo"],
  climbA: ["..oko.oKo...", "..oko..oo...", "..ooo......."],
  climbB: ["...oKo.oko..", "....oo.oko..", ".......ooo.."],
};

const SIT_BASE: Grid = [".owwwwwWkkko", ".oooooooooo."];

/** Lying on the back, head to the right, eyes shut. */
const SLEEP: Grid = [
  "................",
  "................",
  "..........ooooo.",
  ".oooooooooHhhhho",
  "oKkkwwwWttoHkoko",
  "okkkwwWWtttHkkko",
  ".oooooooooooooo.",
];

// Held items. `+` is the hand; it is not drawn.
const ITEMS = {
  hammerDown: [".+.", ".N.", "nnn", "NNN"],
  hammerUp: ["nnn", "NNN", ".N.", ".+."],
  plumb: ["+", "o", "o", "Y", "z"],
  papyrus: ["lL", "+L", "lL", "LL"],
  /** The reed lifted up and forward, clear of the body's outline. */
  penUp: ["..o", ".o.", "+.."],
  /** The reed's tip on the papyrus. */
  penDown: ["o+"],
  scroll: ["mlllm", "mLL+m"],
  loaf: [".oo.", "obbo", "ob+o", ".oo."],
  basket: ["..+.", "obbo", "onNo", "oNno", ".oo."],
  jug: [".+.", "ojo", "ojJo", ".oo."],
};

const STONE: Grid = ["oooooo", "olllLo", "olLLLo", "oLLLeo", "oooooo"];
/** Its bottom row takes the place of the head's top outline. */
const JUG_HEAD: Grid = [".oo.", "ojjo", "oJJo"];

/** A rod or staff held upright: `length` px, the hand `grip` px from its top. */
function pole(length: number, grip: number, marks: boolean): string[] {
  const rows: string[] = [];
  for (let i = 0; i < length; i++) {
    const wood = marks ? (Math.floor(i / 2) % 2 === 0 ? "n" : "y") : i === 0 ? "N" : "n";
    rows.push(i === grip ? `+${wood}` : `.${wood}`);
  }
  return rows;
}

type Tool = "hammer" | "pen" | "rod" | null;

function toolOf(cast: Exclude<Cast, "arbab">): Tool {
  switch (cast) {
    case "laborer":
    case "mason":
      return "hammer";
    case "scribe":
    case "skeptic":
      return "pen";
    case "surveyor":
      return "rod";
    default:
      return null;
  }
}

/** What a cast holds while it stands and walks. */
function heldItem(cast: Exclude<Cast, "arbab">): Grid | null {
  switch (cast) {
    case "laborer":
      return ITEMS.hammerDown;
    case "mason":
      return ITEMS.plumb;
    case "scribe":
    case "skeptic":
      return ITEMS.papyrus;
    case "surveyor":
      return pole(15, 10, true);
    case "scout":
      return pole(16, 11, false);
    default:
      return null;
  }
}

function body(head: Grid, torso: Grid, legs: Grid, bob = 0, armsUp = false): string[] {
  const arms: Layer = { grid: torso, dy: (armsUp ? 4 : 8) + bob };
  const face: Layer = { grid: head, dy: bob };
  // Raised arms are in front of the head.
  return compose(ACTOR_BOX.w, ACTOR_BOX.h, [{ grid: legs, dy: 15 }, { grid: KILT, dy: 12 + bob }, ...(armsUp ? [face, arms] : [arms, face])]);
}

const WALK_LEGS = [LEGS.strideA, LEGS.pass, LEGS.strideB, LEGS.pass];
const WALK_BOB = [0, 1, 0, 1];
const WALK_TORSO = [TORSO.swingA, TORSO.idle, TORSO.swingB, TORSO.idle];

function walkCycle(make: (i: number) => string[]): string[][] {
  return [0, 1, 2, 3].map(make);
}

/** Every frame of every pose of one worker cast, as grids. */
export function workerGrids(cast: Exclude<Cast, "arbab">): Record<string, string[][]> {
  const item = heldItem(cast);
  const tool = toolOf(cast);
  const idle = [withItem(body(HEAD, TORSO.idle, LEGS.stand), item), withItem(body(HEAD, TORSO.idle, LEGS.stand, 1), item)];
  const walk = walkCycle((i) => withItem(body(HEAD, WALK_TORSO[i] ?? TORSO.idle, WALK_LEGS[i] ?? LEGS.pass, WALK_BOB[i]), item));

  const climbBody = (arms: Grid, legs: Grid): string[] =>
    compose(ACTOR_BOX.w, ACTOR_BOX.h, [
      { grid: legs, dy: 15 },
      { grid: KILT, dy: 12 },
      { grid: arms, dy: 4 },
      { grid: HEAD_UP },
      { grid: STONE, dx: 0, dy: 6 },
    ]);
  const climb = [climbBody(ARMS_UP.climbA, LEGS.climbA), climbBody(ARMS_UP.climbB, LEGS.climbB)];

  const sit = [
    compose(ACTOR_BOX.w, ACTOR_BOX.h, [
      { grid: SIT_BASE, dy: 16 },
      { grid: TORSO.idle, dy: 12 },
      { grid: HEAD, dy: 4 },
    ]),
  ];

  let work: string[][];
  if (tool === "hammer") {
    // Frame 0 is the blow, frame 1 the hammer up (the scene shows 1 while stroke < 0.5).
    work = [
      withItem(body(HEAD, TORSO.hold, LEGS.stand, 1), ITEMS.hammerDown),
      withItem(body(HEAD_UP, ARMS_UP.front, LEGS.stand, 0, true), ITEMS.hammerUp),
    ];
  } else if (tool === "pen") {
    const sheet = (grid: string[]): string[] => patch(grid, [[10, 5, "l"], [10, 6, "l"], [10, 7, "L"], [11, 5, "l"], [11, 6, "L"], [11, 7, "L"]]);
    work = [
      withItem(sheet(body(HEAD_DOWN, TORSO.write, LEGS.stand)), ITEMS.penDown),
      withItem(sheet(body(HEAD_DOWN, TORSO.write, LEGS.stand)), ITEMS.penUp),
    ];
  } else if (tool === "rod") {
    work = [
      withItem(body(HEAD, TORSO.hold, LEGS.stand), pole(10, 3, true)),
      withItem(body(HEAD_UP, TORSO.hold, LEGS.stand), pole(14, 9, true)),
    ];
  } else {
    work = idle;
  }

  const talkUp = cast === "skeptic" ? withItem(body(HEAD_TALK, ARMS_UP.front, LEGS.stand, 0, true), ["o", "+"]) : withItem(body(HEAD_TALK, TORSO.hold, LEGS.stand), null);
  const talk = [talkUp, withItem(body(HEAD, TORSO.idle, LEGS.stand), cast === "skeptic" ? null : item)];

  const carryScroll = walkCycle((i) => withItem(body(HEAD, TORSO.hold, WALK_LEGS[i] ?? LEGS.pass, WALK_BOB[i]), ITEMS.scroll));
  const carryStone = walkCycle((i) =>
    compose(ACTOR_BOX.w, ACTOR_BOX.h, [
      { grid: body(HEAD, TORSO.shoulder, WALK_LEGS[i] ?? LEGS.pass, WALK_BOB[i]) },
      { grid: STONE, dx: 0, dy: 4 + (WALK_BOB[i] ?? 0) },
    ]),
  );
  const ration = (tier: 1 | 2 | 3): string[][] =>
    walkCycle((i) => {
      const base = body(HEAD, TORSO.hold, WALK_LEGS[i] ?? LEGS.pass, WALK_BOB[i]);
      const layers: Layer[] = [{ grid: base }, held(base, tier === 3 ? ITEMS.basket : ITEMS.loaf, "*")];
      if (tier > 1) layers.push(held(base, ITEMS.jug, "&"));
      return compose(ACTOR_BOX.w, ACTOR_BOX.h, layers);
    });
  const slump = walkCycle((i) => body(HEAD_DOWN, TORSO.idle, WALK_LEGS[i] ?? LEGS.pass, i % 2));
  const cheer = [body(HEAD_UP, ARMS_UP.both, LEGS.stand, 0, true), body(HEAD_UP, ARMS_UP.half, LEGS.stand, 1, true)];

  const grids: Record<string, string[][]> = {
    idle,
    walk,
    climb,
    sit,
    work,
    sleep: [[...SLEEP]],
    talk,
    "carry-scroll": carryScroll,
    "carry-stone": carryStone,
    "carry-ration": ration(1),
    "carry-ration-2": ration(2),
    "carry-ration-3": ration(3),
    slump,
    cheer,
  };
  if (cast !== "waterboy") return grids;
  // A little shorter, with a jug on the head.
  const out: Record<string, string[][]> = {};
  for (const [pose, frames] of Object.entries(grids)) {
    out[pose] = frames.map((grid) => (pose === "sleep" ? grid : jugOnHead(pose === "sit" ? grid : shorter(grid))));
  }
  return out;
}

/** Two rows out of the torso and kilt; the feet stay where they are. */
function shorter(grid: Grid): string[] {
  const blank = ".".repeat(grid[0]?.length ?? 0);
  return [blank, blank, ...grid.filter((_, y) => y !== 10 && y !== 13)];
}

function jugOnHead(grid: Grid): string[] {
  const y = grid.findIndex((row) => row.includes("h"));
  const row = grid[y] ?? "";
  const center = Math.floor((row.indexOf("h") + row.lastIndexOf("h")) / 2);
  return compose(grid[0]?.length ?? 0, grid.length, [{ grid }, { grid: JUG_HEAD, dx: center - 1, dy: y - 3 }]);
}

// ---------------------------------------------------------------------------------------------------------------
// arbab, 16 × 26: nemes striped blue and gold, gold collar, white robe, a staff in the back hand.

const ARBAB_HEAD: Grid = [
  ".....oooooo.....",
  "....oyBYyBYo....",
  "...oyBYyBYyyo...",
  "...oBYyBYyyyyo..",
  "..oyBYyBokkkkko.",
  "..oBYyBYokkokko.",
  "..oyBYyBokkkkkko",
  "..oBYyBYokkKkko.",
  "..oyBYyBookkkoo.",
  "..oBYyBo.oYYo...",
];

const ARBAB_HEAD_UP: Grid = [
  ".....oooooo.....",
  "....oyBYyBYo....",
  "...oyBYyBYyyo...",
  "...oBYyBYyykko..",
  "..oyBYyBokkokko.",
  "..oBYyBYokkkkkko",
  "..oyBYyBokkkkko.",
  "..oBYyBYoKkkkoo.",
  "..oyBYyBookko...",
  "..oBYyBo.oYYo...",
];

const ARBAB_HEAD_TALK: Grid = patch(ARBAB_HEAD, [[7, 12, "o"]]);

const ARBAB_ROBE: Grid = [
  "..oyBYoGyyyyyo..",
  ".oGyyyGyyyGyyYo.",
  ".oYzYYzYYzYYzYo.",
  ".okowwwwwwwWokko",
  ".okowwwwwwwWokko",
  ".o&owwwwwwwWo*o.",
  "..oowwwwwwWWoo..",
  "...owyyyyyyYo...",
  "...owwwwwwWWo...",
  "...owwwwwwWWo...",
  "...owwwwwwWWo...",
  "..owwwwwwwWWWo..",
  "..owwwwwwwWWWo..",
  "..owwwwwwwWWWo..",
  "..oooooooooooo..",
  "...okko..okko...",
];

/** The robe with the back arm raised (drawn by ARBAB_ARM). */
const ARBAB_ROBE_UP: Grid = patch(ARBAB_ROBE, [
  [3, 1, "."],
  [3, 2, "o"],
  [3, 3, "w"],
  [4, 1, "."],
  [4, 2, "o"],
  [4, 3, "w"],
  [5, 1, "."],
  [5, 2, "o"],
  [5, 3, "w"],
]);

/** The back arm raised, its hand on row `hand`; it ends at the shoulder on row 12. */
function arbabArm(hand: number): string[] {
  const rows = Array.from({ length: 13 }, () => "...");
  rows[hand - 1] = ".o.";
  rows[hand] = "o&o";
  for (let y = hand + 1; y < 12; y++) rows[y] = "oko";
  rows[12] = ".oo";
  return rows;
}

/** The staff, in the front hand: a gold knob on a long wooden shaft, standing on the ground. */
const STAFF: Grid = [".y.", "yGz", ".z.", ...Array.from({ length: 22 }, () => ".n.")];

function arbabBody(head: Grid, robe: Grid, arm: Grid | null): string[] {
  const layers: Layer[] = [{ grid: STAFF, dx: 13 }, { grid: robe, dy: 10 }, { grid: head }];
  if (arm) layers.push({ grid: arm });
  return compose(ARBAB_BOX.w, ARBAB_BOX.h, layers);
}

export function arbabGrids(): Record<string, string[][]> {
  const shine = patch(ARBAB_ROBE, [[1, 2, "y"], [1, 6, "y"], [1, 10, "y"], [1, 4, "G"], [1, 8, "G"]]);
  return {
    idle: [arbabBody(ARBAB_HEAD, ARBAB_ROBE, null), arbabBody(ARBAB_HEAD, shine, null)],
    talk: [arbabBody(ARBAB_HEAD_TALK, ARBAB_ROBE_UP, arbabArm(6)), arbabBody(ARBAB_HEAD, ARBAB_ROBE_UP, arbabArm(7))],
    cheer: [arbabBody(ARBAB_HEAD_UP, ARBAB_ROBE_UP, arbabArm(1)), arbabBody(ARBAB_HEAD_UP, ARBAB_ROBE_UP, arbabArm(4))],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Props

export const PROPS = {
  tent: [
    "............oo............",
    "...........occo...........",
    "..........occcCo..........",
    ".........occccCCo.........",
    "........occccqCCCo........",
    ".......occccqqCCCCo.......",
    "......occccqqoqCCCCo......",
    ".....occccqqooqqCCCCo.....",
    "....occccqqoooqqqCCCCo....",
    "...occcccccoooooCCCCCCo...",
    "..occcccccooooooCCCCCCCo..",
    ".occccccccooooooCCCCCCCCo.",
    "occccccccoooooooCCCCCCCCCo",
    "oooooooooooooooooooooooooo",
  ],
  palm: [
    ".......vvv.........",
    "....vvvvvvVv..vvv..",
    "..vvvVVvvvvVvvvvvv.",
    ".vvV...vVvvvvVV..vv",
    "vvV...vvVrVvvv...Vv",
    "vV...vV.JrJ.vVv...V",
    "V...vV..rNJ..vV....",
    "....V...rN....V....",
    "........rN.........",
    "........rN.........",
    ".........rN........",
    ".........rN........",
    ".........rN........",
    ".........rN........",
    ".........rrN.......",
    "..........rN.......",
    "..........rN.......",
    "..........rN.......",
    "..........rN.......",
    "..........rN.......",
    "..........rN.......",
    "..........rN.......",
    "..........rrN......",
    "..........rrN......",
    "..........rrN......",
    ".........rrN.......",
    ".........rrN.......",
    ".........rrN.......",
    ".........rrN.......",
    ".........rrNN......",
    "........UUUUUU.....",
  ],
  table: [
    "........oo..........",
    ".......ojjo.........",
    "..oo..ojjjJo..ooo...",
    ".obbo.ojjJJo.obbbo..",
    "obbbbo.oJJo.obbbbbo.",
    "oooooooooooooooooooo",
    "onnnnnnnnnnnnnnnnnNo",
    "oNNNNNNNNNNNNNNNNNNo",
    ".oNo............oNo.",
    ".oNo............oNo.",
    ".ooo............ooo.",
  ],
  chest: [
    "..oooooooooo..",
    ".onnnnnnnnnNo.",
    "onnnnnnnnnnNNo",
    "oyyyyyyyyyyYYo",
    "onnnnnoyonnNNo",
    "oNNNNNoYoNNNNo",
    "onnnnnnonnnNNo",
    "onnnnnnnnnnNNo",
    "oyyyyyyyyyyYYo",
    "oooooooooooooo",
  ],
  well: [
    "..oooooooooooooooo..",
    "..onnnnnnnnnnnnnNo..",
    "..ooooooooooooooo...",
    "..oNo....o....oNo...",
    "..oNo....o....oNo...",
    "..oNo...ooo...oNo...",
    "..oNo..onnNo..oNo...",
    "..oNo..oNNNo..oNo...",
    "..oNo...ooo...oNo...",
    "..oNo.........oNo...",
    ".ooooooooooooooooo..",
    "olllLlllLlllLlllLeo.",
    "oLLmLLLmLLLmLLLmLeo.",
    "oaaaaaaaaaaaaaaaaeo.",
    "ollLlllLlllLlllLLeo.",
    "oLmLLLmLLLmLLLmLLeo.",
    "oLLLmLLLmLLLmLLLeeo.",
    ".oooooooooooooooooo.",
  ],
  sledge: [
    "oooooooooooooooooooooo..",
    "onnnnnnnnnnnnnnnnnnnNo..",
    "oNNNNNNNNNNNNNNNNNNNNo.o",
    ".oNo....oNo.....oNo..onN",
    "ooooooooooooooooooooooNo",
    "oNNNNNNNNNNNNNNNNNNNNNo.",
  ],
  capstone: [
    "....yY....",
    "...yyYz...",
    "...yyYz...",
    "..yyyYzz..",
    "..yyyYzz..",
    ".yyyyYzzz.",
    "yyyyyYzzzz",
  ],
  capstoneGleam: [
    "....GY....",
    "...GyYz...",
    "...yGYz...",
    "..GyyYzz..",
    "..yGyYzz..",
    ".GyyGYzzz.",
    "yyyyyYzzzz",
  ],
  /** A four-point glint beside a ready capstone. */
  glint: [".G.", "GGG", ".G."],
  rubble: [
    ["llLo", "LLeo", "oooo"],
    [".llo", "lLLe", "oooo"],
    ["lLo", "eeo"],
  ],
} as const;

export const ICONS: Readonly<Record<Icon, Grid>> = {
  hourglass: ["ooooo", "oGyGo", ".oyo.", "..o..", ".oGo.", "oyyyo", "ooooo"],
  dots: ["ooo.ooo.ooo", "ofo.ofo.ofo", "ooo.ooo.ooo"],
  zzz: [
    ".....oooooo",
    ".....offffo",
    ".....ooofoo",
    ".....oofooo",
    "ooooooffffo",
    "offfooooooo",
    "oofoo......",
    "offfo......",
    "ooooo......",
  ],
  question: [".ooo.", "offfo", "oo.fo", "..ofo", "..oo.", "..of.", "..oo."],
};

export const MARKER: Grid = ["ooooooo", "oyyyyYo", ".oyyYo.", "..oYo..", "...o..."];

/**
 * Hieroglyph-like glyphs for the speech bubbles, 3 × 4 (`#` ink): eye, bird, reed, water, loop, sun, feet, hand, snake,
 * bread, mouth, basket, column, owl, house, star.
 */
export const GLYPHS: readonly Grid[] = [
  ["...", "###", "#.#", ".#."],
  ["##.", ".##", ".#.", "#.#"],
  [".#.", "##.", ".#.", ".#."],
  ["...", "#.#", ".#.", "..."],
  [".#.", "#.#", "###", ".#."],
  ["###", "#.#", "###", "..."],
  ["#..", "#..", "##.", "#.#"],
  ["###", "#..", "##.", "..."],
  ["##.", "..#", ".#.", "#.."],
  ["...", ".#.", "###", "..."],
  ["...", "###", "#.#", "###"],
  ["...", "#.#", "###", "..."],
  ["###", ".#.", ".#.", "###"],
  ["#.#", "###", "#.#", "###"],
  ["###", "#.#", "#.#", "#.#"],
  ["#.#", ".#.", "#.#", "..."],
];

// ---------------------------------------------------------------------------------------------------------------
// The compiled set

export interface SpriteSet {
  /** Frames for a cast and pose (with the ration tier for carry-ration); arbab's missing poses draw as idle. */
  frames(cast: Cast, pose: Pose, ration: number, ghost: boolean): readonly Sprite[];
}

function compileAll(grids: Record<string, string[][]>, colors: Readonly<Record<string, string>>): Map<string, Sprite[]> {
  const out = new Map<string, Sprite[]>();
  for (const [pose, frames] of Object.entries(grids)) out.set(pose, frames.map((g) => compile(g, colors)));
  return out;
}

function colorsFor(cast: Cast, ghost: boolean): Record<string, string> {
  const colors: Record<string, string> = { ...SPRITE_CHARS, ...castColors(cast) };
  if (ghost) for (const ch of Object.keys(colors)) colors[ch] = ghostly(colors[ch] ?? "#000000");
  return colors;
}

/** Compiles lazily, once per cast and look. */
export function createSpriteSet(): SpriteSet {
  const cache = new Map<string, Map<string, Sprite[]>>();
  const set = (cast: Cast, ghost: boolean): Map<string, Sprite[]> => {
    const key = `${cast}:${ghost ? "ghost" : "solid"}`;
    let compiled = cache.get(key);
    if (!compiled) {
      compiled = compileAll(cast === "arbab" ? arbabGrids() : workerGrids(cast), colorsFor(cast, ghost));
      cache.set(key, compiled);
    }
    return compiled;
  };
  return {
    frames(cast, pose, ration, ghost) {
      const compiled = set(cast, ghost);
      const key = pose === "carry-ration" && ration >= 2 ? `carry-ration-${Math.min(3, ration)}` : pose;
      return compiled.get(key) ?? compiled.get("idle") ?? [];
    },
  };
}

/** Grids compiled with the base palette (props, icons): no cast recoloring. */
export function compileProp(grid: Grid): Sprite {
  return compile(grid, SPRITE_CHARS);
}
