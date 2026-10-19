import { describe, expect, it } from "vitest";
import { lane, snapshot } from "../fixtures";
import type { FakeElement } from "./fake-dom";
import { fakeDocument } from "./fake-dom";
import { DEFAULT_SORT, ledgerCells, mountLedger, nextSort, sortLedger } from "./ledger";

const NOW = Date.parse("2026-10-19T10:05:00.000Z");

const lanes = [
  lane({ name: "b", state: "finished", endState: "failed", costUsd: 0.5, toolCalls: 7, attempt: 2, elapsedMs: 60_000 }),
  lane({ name: "a", state: "finished", endState: "success", costUsd: 2, toolCalls: 30, elapsedMs: 120_000 }),
  lane({ name: "q", state: "queued", costUsd: null, lastTool: null }),
  lane({ name: "r", state: "running", costUsd: 1, toolCalls: 12, lastTool: "Edit" }),
  lane({ name: "c", role: "verifier", state: "running", costUsd: 3, toolCalls: 2, lastTool: "Bash" }),
];

const names = (list: { name: string }[]): string[] => list.map((l) => l.name);

describe("sortLedger", () => {
  it("defaults to state (at work first, successes before failures), then name", () => {
    expect(DEFAULT_SORT).toEqual({ key: "state", dir: "ascending" });
    expect(names(sortLedger(lanes, DEFAULT_SORT, NOW))).toEqual(["c", "r", "q", "a", "b"]);
    expect(names(sortLedger(lanes, { key: "state", dir: "descending" }, NOW))).toEqual(["b", "a", "q", "c", "r"]);
  });

  it("sorts by any column, both ways, with unknown values last", () => {
    expect(names(sortLedger(lanes, { key: "lane", dir: "ascending" }, NOW))).toEqual(["a", "b", "c", "q", "r"]);
    expect(names(sortLedger(lanes, { key: "cost", dir: "descending" }, NOW))).toEqual(["c", "a", "r", "b", "q"]);
    expect(names(sortLedger(lanes, { key: "cost", dir: "ascending" }, NOW))).toEqual(["b", "r", "a", "c", "q"]);
    expect(names(sortLedger(lanes, { key: "calls", dir: "descending" }, NOW))).toEqual(["a", "r", "b", "c", "q"]);
    expect(names(sortLedger(lanes, { key: "lastTool", dir: "ascending" }, NOW))).toEqual(["c", "r", "a", "b", "q"]);
    expect(names(sortLedger(lanes, { key: "role", dir: "descending" }, NOW))).toEqual(["c", "a", "b", "q", "r"]);
    expect(names(sortLedger(lanes, { key: "attempt", dir: "descending" }, NOW))).toEqual(["b", "a", "c", "q", "r"]);
    // Live lanes count from since (10:00), five minutes; finished ones use their wall clock.
    expect(names(sortLedger(lanes, { key: "elapsed", dir: "ascending" }, NOW))).toEqual(["b", "a", "c", "q", "r"]);
  });

  it("flips the direction on the same column, and starts ascending on another", () => {
    expect(nextSort(DEFAULT_SORT, "state")).toEqual({ key: "state", dir: "descending" });
    expect(nextSort({ key: "state", dir: "descending" }, "state")).toEqual({ key: "state", dir: "ascending" });
    expect(nextSort({ key: "state", dir: "descending" }, "cost")).toEqual({ key: "cost", dir: "ascending" });
  });
});

describe("ledgerCells", () => {
  it("has lane, role, state, attempt, calls, last tool, elapsed and cost", () => {
    expect(ledgerCells(lanes[3] ?? lane({ name: "x" }), NOW)).toEqual(["r", "implementer", "RUNNING", "1", "12", "Edit", "5m00s", "$1.00"]);
    expect(ledgerCells(lanes[2] ?? lane({ name: "x" }), NOW)).toEqual(["q", "implementer", "QUEUED", "1", "0", "—", "5m00s", "—"]);
  });
});

describe("mountLedger", () => {
  function ledger() {
    const doc = fakeDocument();
    const title = doc.createElement("h2") as FakeElement;
    const head = doc.createElement("tr") as FakeElement;
    const body = doc.createElement("tbody") as FakeElement;
    const calls: string[] = [];
    const panel = mountLedger(doc, { title, head, body }, 1, {
      enter: (n) => calls.push(`enter ${n}`),
      leave: (n) => calls.push(`leave ${n}`),
      toggle: (n) => calls.push(`toggle ${n}`),
    });
    return { title, head, body, panel, calls };
  }

  it("builds sortable headers with aria-sort and keyed rows with a badge", () => {
    const { title, head, body, panel } = ledger();
    expect(title.text()).toBe("LEDGER");
    expect(head.children.map((th) => th.text())).toEqual(["lane", "role", "state", "attempt", "calls", "last tool", "elapsed", "cost"]);
    expect(head.children.map((th) => th.attributes.get("aria-sort"))).toEqual(["none", "none", "ascending", "none", "none", "none", "none", "none"]);
    expect(head.children[3]?.className).toBe("num");
    panel.update(snapshot({ lanes }), NOW);
    expect(body.children.map((tr) => tr.children[0]?.textContent)).toEqual(["c", "r", "q", "a", "b"]);
    const row = body.children[0];
    expect(row?.children[0]?.tag).toBe("th");
    expect(row?.children[0]?.attributes.get("scope")).toBe("row");
    expect(row?.children[2]?.find("badge")[0]?.className).toBe("pxt badge tone-running");
    expect(row?.text()).toBe("c verifier RUNNING 1 2 Bash 5m00s $3.00");
    // A click on a header sorts by it, then flips it.
    const costButton = head.children[7]?.children[0];
    costButton?.dispatch("click");
    expect(head.children[7]?.attributes.get("aria-sort")).toBe("ascending");
    expect(head.children[2]?.attributes.get("aria-sort")).toBe("none");
    expect(body.children.map((tr) => tr.children[0]?.textContent)).toEqual(["b", "r", "a", "c", "q"]);
    costButton?.dispatch("click");
    expect(head.children[7]?.attributes.get("aria-sort")).toBe("descending");
    expect(panel.order()).toEqual(["c", "a", "r", "b", "q"]);
  });

  it("keeps rows across snapshots, ticks the elapsed time and shows the pin", () => {
    const { body, panel, calls } = ledger();
    panel.update(snapshot({ lanes }), NOW);
    const first = body.children[0];
    panel.update(snapshot({ lanes: lanes.filter((l) => l.name !== "q") }), NOW);
    expect(body.children).toHaveLength(4);
    expect(body.children[0]).toBe(first);
    panel.tick(NOW + 60_000);
    expect(first?.children[6]?.textContent).toBe("6m00s");
    first?.dispatch("mouseenter");
    first?.dispatch("click");
    first?.dispatch("mouseleave");
    expect(calls).toEqual(["enter c", "toggle c", "leave c"]);
    panel.setPinned("c");
    expect(first?.className).toBe("pinned");
    expect(body.children[1]?.className).toBe("");
  });
});
