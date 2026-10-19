// The ledger (DESIGN.md §19): every lane in the snapshot in a sortable table, the accessible equivalent of the scene.
// Rows are keyed by lane and moved only when out of order.
import { formatElapsed } from "../../../../registry/status";
import type { LaneState } from "../../../../types";
import type { UiLane, UiSnapshot } from "../../../protocol";
import type { DocumentLike, ElementLike } from "../browser";
import { formatUsd, laneElapsedMs } from "../hud";
import { make, reorder } from "./dom";
import type { PixelText } from "./pixel-text";
import { createPixelText } from "./pixel-text";
import { BADGE_INK, badgeOf, TOKENS } from "./tokens";

export type LedgerKey = "lane" | "role" | "state" | "attempt" | "calls" | "lastTool" | "elapsed" | "cost";
export type SortDir = "ascending" | "descending";

export interface LedgerSort {
  key: LedgerKey;
  dir: SortDir;
}

export const LEDGER_COLUMNS: readonly { key: LedgerKey; label: string; numeric: boolean }[] = [
  { key: "lane", label: "lane", numeric: false },
  { key: "role", label: "role", numeric: false },
  { key: "state", label: "state", numeric: false },
  { key: "attempt", label: "attempt", numeric: true },
  { key: "calls", label: "calls", numeric: true },
  { key: "lastTool", label: "last tool", numeric: false },
  { key: "elapsed", label: "elapsed", numeric: true },
  { key: "cost", label: "cost", numeric: true },
];

/** By state (at work first), then name. */
export const DEFAULT_SORT: LedgerSort = { key: "state", dir: "ascending" };

const STATE_RANK: Readonly<Record<LaneState, number>> = {
  running: 0,
  preparing: 1,
  "waiting-reset": 2,
  held: 3,
  queued: 4,
  orphaned: 5,
  finished: 6,
};

function stateRank(lane: UiLane): number {
  const rank = STATE_RANK[lane.state] ?? 9;
  // Among the finished, successes first.
  return lane.state === "finished" && lane.endState !== "success" ? rank + 1 : rank;
}

/** A sort value; null sorts last whichever the direction. */
function value(lane: UiLane, key: LedgerKey, serverNowMs: number): string | number | null {
  switch (key) {
    case "lane":
      return lane.name;
    case "role":
      return lane.role;
    case "state":
      return stateRank(lane);
    case "attempt":
      return lane.attempt;
    case "calls":
      return lane.toolCalls;
    case "lastTool":
      return lane.lastTool;
    case "elapsed":
      return laneElapsedMs(lane, serverNowMs);
    case "cost":
      return lane.costUsd !== null && Number.isFinite(lane.costUsd) ? lane.costUsd : null;
  }
}

function compare(a: string | number, b: string | number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortLedger(lanes: readonly UiLane[], sort: LedgerSort, serverNowMs: number): UiLane[] {
  const sign = sort.dir === "ascending" ? 1 : -1;
  return [...lanes].sort((a, b) => {
    const va = value(a, sort.key, serverNowMs);
    const vb = value(b, sort.key, serverNowMs);
    if (va === null || vb === null) {
      if (va !== vb) return va === null ? 1 : -1;
    } else {
      const c = compare(va, vb);
      if (c !== 0) return sign * c;
    }
    return compare(a.name, b.name);
  });
}

/** A click on a header: the same column flips its direction, another sorts by it ascending. */
export function nextSort(current: LedgerSort, key: LedgerKey): LedgerSort {
  if (current.key === key) return { key, dir: current.dir === "ascending" ? "descending" : "ascending" };
  return { key, dir: "ascending" };
}

/** The row's cells as text; the state cell's text is its badge's word. */
export function ledgerCells(lane: UiLane, serverNowMs: number): string[] {
  const elapsed = laneElapsedMs(lane, serverNowMs);
  return [
    lane.name,
    lane.role,
    badgeOf(lane).label,
    String(lane.attempt),
    String(lane.toolCalls),
    lane.lastTool ?? "—",
    elapsed === null ? "—" : formatElapsed(elapsed),
    formatUsd(lane.costUsd),
  ];
}

interface Row {
  tr: ElementLike;
  cells: ElementLike[];
  badge: PixelText;
  lane: UiLane;
}

export interface LedgerHandlers {
  enter(name: string): void;
  leave(name: string): void;
  toggle(name: string): void;
}

export interface LedgerPanel {
  update(snapshot: UiSnapshot, serverNowMs: number): void;
  tick(serverNowMs: number): void;
  setPinned(name: string | null): void;
  sort(): LedgerSort;
  /** Sorts as a click on that column's header does. */
  sortBy(key: LedgerKey): void;
  order(): readonly string[];
}

export function mountLedger(
  doc: DocumentLike,
  els: { title: ElementLike; head: ElementLike; body: ElementLike },
  dpr: number,
  on: LedgerHandlers,
): LedgerPanel {
  const title = createPixelText(doc, { scale: 2, color: TOKENS.gold, dpr }, "LEDGER");
  els.title.replaceChildren(title.el);
  let sort = DEFAULT_SORT;
  let lanes: UiLane[] = [];
  let nowMs = 0;
  const rows = new Map<string, Row>();
  let order: string[] = [];

  const headers = LEDGER_COLUMNS.map((column) => {
    const th = make(doc, "th", column.numeric ? "num" : "");
    th.setAttribute("scope", "col");
    const button = make(doc, "button", "sort", column.label);
    button.setAttribute("type", "button");
    button.addEventListener("click", () => panel.sortBy(column.key));
    th.appendChild(button);
    return { th, key: column.key };
  });
  els.head.replaceChildren(...headers.map((h) => h.th));
  const showSort = (): void => {
    for (const h of headers) h.th.setAttribute("aria-sort", h.key === sort.key ? sort.dir : "none");
  };
  showSort();

  const row = (name: string, lane: UiLane): Row => {
    const tr = make(doc, "tr");
    const badge = createPixelText(doc, { scale: 1, color: BADGE_INK, dpr, className: "badge" });
    const cells = LEDGER_COLUMNS.map((column, i) => {
      const cell = make(doc, i === 0 ? "th" : "td", column.numeric ? "num" : "");
      if (i === 0) cell.setAttribute("scope", "row");
      if (column.key === "state") cell.appendChild(badge.el);
      tr.appendChild(cell);
      return cell;
    });
    tr.addEventListener("mouseenter", () => on.enter(name));
    tr.addEventListener("mouseleave", () => on.leave(name));
    tr.addEventListener("click", () => on.toggle(name));
    return { tr, cells, badge, lane };
  };

  const fill = (r: Row, serverNowMs: number): void => {
    const texts = ledgerCells(r.lane, serverNowMs);
    LEDGER_COLUMNS.forEach((column, i) => {
      if (column.key === "state") {
        const { tone, label } = badgeOf(r.lane);
        r.badge.el.className = `pxt badge tone-${tone}`;
        r.badge.set(label, BADGE_INK);
        return;
      }
      const cell = r.cells[i];
      if (cell) cell.textContent = texts[i] ?? "";
    });
  };

  const arrange = (): void => {
    const names = sortLedger(lanes, sort, nowMs).map((l) => l.name);
    order = reorder(els.body, order, names, (name) => rows.get(name)?.tr);
  };

  const panel: LedgerPanel = {
    update(snapshot, serverNowMs) {
      lanes = snapshot.lanes;
      nowMs = serverNowMs;
      const keep = new Set(lanes.map((l) => l.name));
      for (const lane of lanes) {
        let r = rows.get(lane.name);
        if (!r) {
          r = row(lane.name, lane);
          rows.set(lane.name, r);
        }
        r.lane = lane;
        fill(r, serverNowMs);
      }
      arrange();
      for (const name of [...rows.keys()]) if (!keep.has(name)) rows.delete(name);
    },
    tick(serverNowMs) {
      nowMs = serverNowMs;
      const i = LEDGER_COLUMNS.findIndex((c) => c.key === "elapsed");
      for (const r of rows.values()) {
        const cell = r.cells[i];
        if (cell) cell.textContent = ledgerCells(r.lane, serverNowMs)[i] ?? "";
      }
    },
    setPinned(name) {
      for (const [n, r] of rows) r.tr.className = n === name ? "pinned" : "";
    },
    sort: () => sort,
    sortBy(key) {
      sort = nextSort(sort, key);
      showSort();
      arrange();
    },
    order: () => order,
  };
  return panel;
}
