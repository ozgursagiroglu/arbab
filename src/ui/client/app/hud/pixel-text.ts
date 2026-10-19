// Display text in the pixel font (DESIGN.md §19): drawn into a canvas at whole device pixels, with the same text in a
// visually-hidden span beside it, so screen readers, search and copy see words, not a picture.
import type { CanvasElementLike, DocumentLike, ElementLike } from "../browser";
import { drawText, LINE_HEIGHT, measureText } from "../font";
import { make, makeCanvas, sizeCanvas } from "./dom";

/** Font pixels above the ascent: LINE_HEIGHT's leading, split one above and one below. */
const LEADING_TOP = 1;

export interface PixelTextSize {
  /** The canvas's backing store, in device pixels. */
  width: number;
  height: number;
  /** Its CSS size. */
  cssWidth: number;
  cssHeight: number;
}

/** measureText × scale × dpr by LINE_HEIGHT × scale × dpr; `dpr` is already whole. */
export function pixelTextSize(text: string, scale: number, dpr: number): PixelTextSize {
  const cssWidth = measureText(text) * scale;
  const cssHeight = LINE_HEIGHT * scale;
  return { width: cssWidth * dpr, height: cssHeight * dpr, cssWidth, cssHeight };
}

export interface PixelText {
  /** A span holding the canvas and the hidden text. */
  readonly el: ElementLike;
  readonly canvas: CanvasElementLike | null;
  /** Redraws only when the text, the color or the scale changed. */
  set(text: string, color?: string, scale?: number): void;
  text(): string;
}

export interface PixelTextOptions {
  scale: number;
  color: string;
  /** Whole device pixels per CSS px (see devicePixels). */
  dpr: number;
  className?: string;
}

export function createPixelText(doc: DocumentLike, options: PixelTextOptions, initial = ""): PixelText {
  const el = make(doc, "span", options.className ? `pxt ${options.className}` : "pxt");
  const canvas = makeCanvas(doc, 0, 0, options.dpr);
  const hidden = make(doc, "span", "visually-hidden");
  if (canvas) el.appendChild(canvas);
  el.appendChild(hidden);
  let current: string | null = null;
  let color = options.color;
  let scale = options.scale;
  const handle: PixelText = {
    el,
    canvas,
    set(text, nextColor = color, nextScale = scale) {
      if (text === current && nextColor === color && nextScale === scale) return;
      current = text;
      color = nextColor;
      scale = nextScale;
      hidden.textContent = text;
      if (!canvas) {
        // No canvas: the text shows as text.
        hidden.className = "";
        return;
      }
      const size = pixelTextSize(text, scale, options.dpr);
      sizeCanvas(canvas, size.cssWidth, size.cssHeight, options.dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, size.width, size.height);
      const px = scale * options.dpr;
      drawText(ctx, text, 0, LEADING_TOP * px, color, px);
    },
    text: () => current ?? "",
  };
  handle.set(initial);
  return handle;
}
