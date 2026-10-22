import { describe, expect, it } from "vitest";
import type { EndState } from "../types";
import { adviceFor, needsAttention } from "./advice";

describe("needsAttention", () => {
  it.each<EndState>(["failed", "invalid-report", "no-result", "budget", "max-turns", "unsupported-cli", "killed:wall", "killed:stopped", "killed:idle"])(
    "flags %s",
    (state) => expect(needsAttention(state)).toBe(true),
  );

  it.each<EndState>(["success", "usage-limit", "running"])("leaves %s alone", (state) => expect(needsAttention(state)).toBe(false));

  it("leaves an unknown end state alone", () => expect(needsAttention(null)).toBe(false));
});

describe("adviceFor", () => {
  it("says what to do for each end state of the table", () => {
    expect(adviceFor("killed:wall")).toContain("wallMin");
    expect(adviceFor("unsupported-cli")).toContain("arbab doctor");
    expect(adviceFor("invalid-report")).toContain("reportErrors");
    expect(adviceFor("failed")).toContain("arbab resume");
    expect(adviceFor("orphaned")).toContain("arbab cleanup");
  });

  it("points at the reference for a state the table does not name", () => {
    expect(adviceFor("success")).toBe("see references/end-states.md");
  });
});
