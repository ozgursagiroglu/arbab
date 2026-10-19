// The scene's colors (DESIGN.md §19): a warm desert, lit from the upper left. Sprites are grids of the characters in
// SPRITE_CHARS; a cast swaps the few characters it owns (headcloth, sash, torso) for its own colors.
import type { Cast } from "../model";

export const SKY = {
  day: ["#5BA8D9", "#8CC6E3", "#F2E2B6"],
  dusk: ["#3B2F5C", "#B4546A", "#F29B4B"],
  night: ["#0B1026", "#1B2347", "#33406B"],
} as const;

export const SUN = { core: "#FFE07A", rim: "#FFF4C2" } as const;
export const MOON = "#E8E6D8";
/** The moon's shaded side: not in the brief's table; a shade of the moon for its craters. */
export const MOON_SHADE = "#C9C6B4";
export const STAR = "#F5F3E8";
export const DUNES = ["#D9B26F", "#C99A55"] as const;
/** Light to dark. */
export const SAND = ["#E9C886", "#DDB66E", "#C89A56", "#B5843F"] as const;
export const LIMESTONE = { light: "#F1E2BC", face: "#DCC796", mortar: "#B9A06C", edge: "#8F7A50" } as const;
export const OUTLINE_PLANNED = "#8C7A5B";
export const OUTLINE_EMPTY = "#CDB27E";
export const FALLEN = { gap: "#6E5A3C", crack: "#4A3B26" } as const;
export const ORPHANED = { light: "#A7A39A", dark: "#85827A" } as const;
export const GOLD = { gleam: "#FFF6C9", light: "#FFD54A", mid: "#E0A800", shadow: "#A87400" } as const;
export const SKIN = { base: "#B9784E", shadow: "#925A38" } as const;
export const CLOTH = { white: "#F4F0E2", shadow: "#D6CFBC" } as const;
export const OUTLINE = "#3A2716";
export const HEADCLOTH: Readonly<Record<Exclude<Cast, "arbab">, string>> = {
  laborer: "#C9A46B",
  mason: "#3C6FB0",
  scribe: "#6E4C9E",
  skeptic: "#B23A3A",
  surveyor: "#3F8F5A",
  waterboy: "#E2B23A",
  scout: "#2F6B4F",
};
export const NEMES_BLUE = "#2A4FA0";
export const WOOD = ["#8B5A2B", "#6B4220"] as const;
export const PALM = { leaf: "#3E7D3A", leafDark: "#2D5E2B", trunk: "#7A5230" } as const;
export const TENT = { cloth: "#E7D6B0", shade: "#C2A97A", stripe: "#B23A3A" } as const;
export const WATER = "#4F8FBF";
export const BREAD = "#C98A3E";
export const JUG = "#8E5B3E";
export const BUBBLE = { fill: "#FFFDF5", glyph: "#5A4630" } as const;
export const FLAG = { green: "#3FAF5A", red: "#D04040" } as const;
export const COIN = { face: "#F2C14E", shadow: "#C9962C" } as const;
/** The white of a block's flash. */
export const FLASH = "#FFFFFF";

// ---------------------------------------------------------------------------------------------------------------
// The game-studio pass: the scenery's materials, a few shades each, lit from the sun's side.

/** The sky from the zenith down to the horizon haze, per phase. */
export const SKY_RAMP: Readonly<Record<"day" | "dusk" | "night", readonly string[]>> = {
  day: ["#2E6CAF", "#3D82C2", "#5299CF", "#6CAED9", "#8DC2E0", "#B1D3DF", "#D3DDCB", "#ECE1BA"],
  dusk: ["#2A2350", "#45306A", "#6C3B70", "#984870", "#C25A66", "#E0755A", "#F1954E", "#F6B860"],
  night: ["#060A1C", "#0A1027", "#0F1733", "#151E3E", "#1B2648", "#222E52", "#2A375C", "#334166"],
};

/** The sun's disc at the horizon (warm) and high up (pale): the renderer mixes them by height. */
export const SUN_LOW = { core: "#FFA640", rim: "#FFCB6B", halo: "#FFB85C" } as const;
export const SUN_HIGH = { core: "#FFF7DC", rim: "#FFFCEF", halo: "#FFF3C4" } as const;

/** Clouds: lit top, body, shaded underside. */
export const CLOUDS: Readonly<Record<"day" | "dusk" | "night", readonly [string, string, string]>> = {
  day: ["#FFFDF6", "#F1ECDF", "#CBD3DD"],
  dusk: ["#FFD39A", "#E8968A", "#9C5A7C"],
  night: ["#5A6688", "#46507A", "#343D63"],
};

export const STARS = { bright: "#F5F3E8", mid: "#C9CCE0", dim: "#7E86AA" } as const;
export const BIRD: Readonly<Record<"day" | "dusk", string>> = { day: "#4A3A3C", dusk: "#3A2236" };

/** The valley's cliffs, farthest first: lit face, shaded face, strata. */
export const CLIFFS = [
  { light: "#DCD3C6", face: "#C9BFB6", shade: "#B0A7A9" },
  { light: "#E5CBA2", face: "#D2B58C", shade: "#B39575" },
] as const;
export const FAR_DUNES = { light: "#E2BE7C", face: "#D4AA68", shade: "#BF9456" } as const;
/** Fields and trees along the far bank. */
export const BANK_GREEN = { light: "#7E9A4A", face: "#5F7D3A", shade: "#465F2E" } as const;
export const RIVER = { sky: "#9CC9DD", light: "#6FA8CC", face: "#4F8FBF", deep: "#3D78A8", bank: "#A88654" } as const;
export const GLINT: Readonly<Record<"day" | "dusk" | "night", string>> = { day: "#E6F4FA", dusk: "#FFE0A8", night: "#A9B6D8" };
export const REED = { light: "#9CAA52", face: "#6E8A3C", shade: "#4E6A2E", tip: "#C8B068" } as const;
/** The far temple and obelisks: sunlit and shaded stone, softened by the distance. */
export const FAR_STONE = { light: "#EADCB8", face: "#D6C499", shade: "#B5A27C", dark: "#9A8868" } as const;

/** The plain from the river bank to the front, and its worn paths and pebbles. */
export const PLAIN = ["#CFAA6A", "#D8B36F", "#DFBC77", "#E6C582", "#E9C886", "#E3BF7A"] as const;
export const PATH = { light: "#F1D9A2", face: "#ECD195", track: "#D9B878" } as const;
export const PEBBLE = { light: "#CDB693", face: "#A8906C", shade: "#7E6A4E" } as const;
export const SCRUB = { light: "#A3A057", face: "#7C7E43", shade: "#5A5E34" } as const;

export const CAMEL = { light: "#D9AE73", face: "#BE8E55", shade: "#97693C", dark: "#6E4A2A" } as const;
export const FIRE = { white: "#FFF6D0", yellow: "#FFD24A", orange: "#F68B2C", red: "#D1452A", ember: "#8E2E1E" } as const;
export const SMOKE = "#CFC8C0";
export const STONE_RING = { light: "#A8A094", shade: "#756E64" } as const;
export const BRONZE = { light: "#E0A859", face: "#B37A3A", shade: "#7E5226" } as const;
/** arbab's canopy: cream and red stripes; its banners in the nemes' blue and gold. */
export const CANOPY = { cream: "#F2E4C2", creamShade: "#D7C29A", red: "#B8433A", redShade: "#8E2F2B" } as const;
export const SAIL = { light: "#FBF7EC", shade: "#DCD4C2" } as const;
export const QUARRY = { light: "#F3E6C2", face: "#E0CD9F", shade: "#C2AA78", edge: "#9C8558" } as const;
/** Shadows on the sand and the light of fires at night. */
export const SHADOW = "#3E2A1C";
export const NIGHT_SHADOW = "#0A0E22";
export const FIRELIGHT = "#FFB45A";
export const VIGNETTE: Readonly<Record<"day" | "dusk" | "night", string>> = { day: "#4A321E", dusk: "#2E1830", night: "#05071A" };
/** The nameplate above a highlighted worker. */
export const PLATE = { fill: "#2B1D14", rim: GOLD.mid, text: GOLD.gleam } as const;

/** What each sprite character draws before a cast recolors it. `.` is transparent. */
export const SPRITE_CHARS: Readonly<Record<string, string>> = {
  o: OUTLINE,
  k: SKIN.base,
  K: SKIN.shadow,
  // The front hand: an anchor for held items, drawn as skin.
  "*": SKIN.base,
  // The back hand, in the shadow side.
  "&": SKIN.shadow,
  t: SKIN.base,
  T: SKIN.shadow,
  w: CLOTH.white,
  W: CLOTH.shadow,
  h: HEADCLOTH.laborer,
  H: shade(HEADCLOTH.laborer, 0.72),
  s: CLOTH.shadow,
  n: WOOD[0],
  N: WOOD[1],
  l: LIMESTONE.light,
  L: LIMESTONE.face,
  m: LIMESTONE.mortar,
  e: LIMESTONE.edge,
  G: GOLD.gleam,
  y: GOLD.light,
  Y: GOLD.mid,
  z: GOLD.shadow,
  B: NEMES_BLUE,
  b: BREAD,
  j: JUG,
  J: shade(JUG, 0.75),
  a: WATER,
  v: PALM.leaf,
  V: PALM.leafDark,
  r: PALM.trunk,
  c: TENT.cloth,
  C: TENT.shade,
  q: TENT.stripe,
  U: SAND[3],
  f: BUBBLE.fill,
};

/** Hair for the casts without a headcloth: the crack's dark brown, a step lighter than the outline. */
const HAIR = FALLEN.crack;

/** The characters a cast recolors. */
export function castColors(cast: Cast): Readonly<Record<string, string>> {
  switch (cast) {
    case "arbab":
      return {};
    case "scribe":
    case "skeptic":
      return { h: HAIR, H: OUTLINE, s: HEADCLOTH[cast] };
    case "scout": {
      const cloak = HEADCLOTH.scout;
      return { h: cloak, H: shade(cloak, 0.72), t: cloak, T: shade(cloak, 0.72) };
    }
    default:
      return { h: HEADCLOTH[cast], H: shade(HEADCLOTH[cast], 0.72) };
  }
}

/** `#rrggbb` → [r, g, b]. */
export function parseHex(color: string): [number, number, number] {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error(`not a #rrggbb color: ${color}`);
  const n = Number.parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex(r: number, g: number, b: number): string {
  const c = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

/** Darker by a factor (0–1). */
export function shade(color: string, factor: number): string {
  const [r, g, b] = parseHex(color);
  return toHex(r * factor, g * factor, b * factor);
}

/** Toward `to` by t (0–1). */
export function mix(color: string, to: string, t: number): string {
  const [r, g, b] = parseHex(color);
  const [r2, g2, b2] = parseHex(to);
  return toHex(r + (r2 - r) * t, g + (g2 - g) * t, b + (b2 - b) * t);
}

function grey(color: string): string {
  const [r, g, b] = parseHex(color);
  const l = 0.3 * r + 0.59 * g + 0.11 * b;
  return toHex(l, l, l);
}

/** A stalled block's stones: most of the color gone. */
export function desaturate(color: string): string {
  return mix(color, grey(color), 0.65);
}

/** An orphaned worker: grey, washed toward the moon's pale cream. */
export function ghostly(color: string): string {
  return mix(grey(color), MOON, 0.55);
}
