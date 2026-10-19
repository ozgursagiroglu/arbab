// The chronicle's list (DESIGN.md §19): one line per entry, keyed by id. A line that arrives after the first render
// slides in (CSS; none with reduced motion).
import type { DocumentLike, ElementLike } from "../browser";
import type { ChronicleEntry, ChronicleKind } from "./chronicle";
import { formatAgo, glyphOf } from "./chronicle";
import { make, reorder } from "./dom";
import type { IconName } from "./icons";
import { createIcon } from "./icons";
import { createPixelText } from "./pixel-text";
import { TOKENS } from "./tokens";

const GLYPH_COLORS: Readonly<Record<ChronicleKind, string>> = {
  started: TOKENS["st-running"],
  finished: TOKENS["st-success"],
  "verify-passed": TOKENS["st-success"],
  failed: TOKENS["st-failed"],
  "verify-failed": TOKENS["st-failed"],
  landed: TOKENS.gold,
  held: TOKENS["st-waiting"],
  waiting: TOKENS["st-waiting"],
};

/** The glyphs the font lacks, drawn as icons. */
const GLYPH_ICONS: Readonly<Record<string, IconName>> = { "◆": "diamond", "⏳": "wait" };

interface Line {
  li: ElementLike;
  time: ElementLike;
  at: number;
}

export interface ChroniclePanel {
  update(entries: readonly ChronicleEntry[], nowMs: number): void;
  /** Rewrites the relative times. */
  refresh(nowMs: number): void;
}

export function mountChronicle(doc: DocumentLike, els: { title: ElementLike; list: ElementLike; empty: ElementLike }, dpr: number): ChroniclePanel {
  const title = createPixelText(doc, { scale: 2, color: TOKENS.gold, dpr }, "CHRONICLE");
  els.title.replaceChildren(title.el);
  const lines = new Map<string, Line>();
  let order: string[] = [];
  let rendered = false;

  const line = (entry: ChronicleEntry): Line => {
    const li = make(doc, "li", rendered ? `chronicle-line kind-${entry.kind} enter` : `chronicle-line kind-${entry.kind}`);
    const glyph = glyphOf(entry.kind);
    const icon = GLYPH_ICONS[glyph];
    const mark = icon ? createIcon(doc, icon, 1, dpr, 9) : createPixelText(doc, { scale: 1, color: GLYPH_COLORS[entry.kind], dpr, className: "glyph" }, glyph).el;
    if (mark) li.appendChild(mark);
    // The glyph's meaning, for screen readers (the icon canvases are hidden).
    if (icon) li.appendChild(make(doc, "span", "visually-hidden", entry.kind === "landed" ? "landed:" : "waiting:"));
    li.appendChild(make(doc, "span", "text", entry.text));
    const time = make(doc, "time", "ago");
    time.setAttribute("datetime", new Date(entry.at).toISOString());
    li.appendChild(time);
    return { li, time, at: entry.at };
  };

  const panel: ChroniclePanel = {
    update(entries, nowMs) {
      for (const entry of entries) if (!lines.has(entry.id) && Number.isFinite(entry.at)) lines.set(entry.id, line(entry));
      const ids = entries.filter((e) => lines.has(e.id)).map((e) => e.id);
      order = reorder(els.list, order, ids, (id) => lines.get(id)?.li);
      const keep = new Set(ids);
      for (const id of [...lines.keys()]) if (!keep.has(id)) lines.delete(id);
      els.empty.hidden = ids.length > 0;
      rendered = true;
      panel.refresh(nowMs);
    },
    refresh(nowMs) {
      for (const l of lines.values()) l.time.textContent = formatAgo(nowMs - l.at);
    },
  };
  return panel;
}
