import { describe, expect, it } from "vitest";
import { CLOSED_MESSAGE, closedMessage, connectionLabel, NOT_RUNNING_MESSAGE, TOO_MANY_MESSAGE } from "./status";
import { badgeOf, TOKENS, toneColor } from "./tokens";

describe("closedMessage", () => {
  it("tells the causes of a closed stream apart", () => {
    expect(closedMessage({ status: 200 })).toBe(TOO_MANY_MESSAGE);
    expect(closedMessage({ status: 401 })).toBe(CLOSED_MESSAGE);
    expect(closedMessage({ status: 500 })).toBe(CLOSED_MESSAGE);
    expect(closedMessage(null)).toBe(NOT_RUNNING_MESSAGE);
  });
});

describe("connectionLabel", () => {
  it("is LIVE, RECONNECTING in amber or OFFLINE in red", () => {
    expect(connectionLabel("live")).toEqual({ text: "LIVE", color: TOKENS["st-success"] });
    expect(connectionLabel("lost")).toEqual({ text: "RECONNECTING", color: TOKENS["st-waiting"] });
    expect(connectionLabel("closed")).toEqual({ text: "OFFLINE", color: TOKENS["st-failed"] });
    expect(connectionLabel("connecting").text).toBe("CONNECTING");
  });
});

describe("badgeOf", () => {
  it("gives every state its tone and word", () => {
    const badge = (state: Parameters<typeof badgeOf>[0]["state"], endState: string | null = null) => badgeOf({ state, endState });
    expect(badge("running")).toEqual({ tone: "running", label: "RUNNING" });
    expect(badge("preparing")).toEqual({ tone: "preparing", label: "PREPARING" });
    expect(badge("queued")).toEqual({ tone: "waiting", label: "QUEUED" });
    expect(badge("held")).toEqual({ tone: "waiting", label: "HELD" });
    expect(badge("waiting-reset")).toEqual({ tone: "asleep", label: "ASLEEP" });
    expect(badge("orphaned")).toEqual({ tone: "orphaned", label: "ORPHANED" });
    expect(badge("finished", "success")).toEqual({ tone: "success", label: "✓ DONE" });
    expect(badge("finished", "killed:wall")).toEqual({ tone: "failed", label: "✗ FAILED" });
    expect(toneColor("asleep")).toBe("#8e7cc3");
  });
});
