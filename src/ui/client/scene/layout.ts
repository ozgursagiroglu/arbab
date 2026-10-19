// Geometry of the scene (DESIGN.md §19): the foreground pyramid's slots, the camp's seats and the far pyramids. All
// integer pixels, so blocks and feet land on whole pixels of the canvas.
import { CAMP, HORIZON_Y, PLACES, PYRAMID_AREA } from "../model";

export interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
  course: number;
}

export interface PyramidLayout {
  base: number;
  blockW: number;
  blockH: number;
  slots: Slot[];
  apex: { x: number; y: number };
}

/** The least b with b(b+1)/2 ≥ lanes, at least 4. */
function baseFor(lanes: number): number {
  let b = 4;
  while ((b * (b + 1)) / 2 < lanes) b += 1;
  return b;
}

export function pyramidLayout(lanes: number): PyramidLayout {
  const base = baseFor(Math.max(0, Math.floor(lanes)));
  const { centerX, baseY, maxWidth, maxHeight } = PYRAMID_AREA;
  let blockW = Math.min(32, Math.floor(maxWidth / base));
  blockW -= blockW % 2;
  const blockH = Math.min(blockW / 2, Math.floor(maxHeight / base));
  blockW = Math.min(blockW, 2 * blockH);
  const slots: Slot[] = [];
  for (let k = 0; k < base; k += 1) {
    const count = base - k;
    const left = centerX - (count * blockW) / 2;
    const y = baseY - (k + 1) * blockH;
    for (let j = 0; j < count; j += 1) slots.push({ x: left + j * blockW, y, w: blockW, h: blockH, course: k });
  }
  return { base, blockW, blockH, slots, apex: { x: centerX, y: baseY - base * blockH } };
}

export function campSeat(i: number): { x: number; y: number } {
  const seats = CAMP.columns * CAMP.rows;
  const n = ((Math.floor(i) % seats) + seats) % seats;
  const row = Math.floor(n / CAMP.columns);
  const col = n % CAMP.columns;
  return { x: PLACES.camp.x + col * CAMP.step + (row * CAMP.step) / 2, y: PLACES.camp.y + row * CAMP.rowStep };
}

/** The left horizon, clear of the site and the well: the newest stands nearest the site. */
const FAR_X = [152, 108, 64] as const;

/** i = 0 is the newest landed integration. */
export function farPyramidPlace(i: number, lanes: number): { x: number; y: number; height: number } {
  const x = FAR_X[Math.min(FAR_X.length - 1, Math.max(0, Math.floor(i)))] ?? FAR_X[0];
  const height = Math.min(22, Math.max(8, Math.round(8 + 0.6 * lanes)));
  return { x, y: HORIZON_Y, height };
}

/** Where a worker stands to work on a slot: its feet on the slot's bottom edge, at its center. */
export function workSpot(slot: Slot): { x: number; y: number } {
  return { x: slot.x + slot.w / 2, y: slot.y + slot.h };
}
