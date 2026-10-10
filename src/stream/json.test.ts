import { describe, expect, it } from "vitest";
import { Counter, arrayOrEmpty, isRecord, numberOrNull, stringOrNull, sumValues } from "./json";

describe("narrowing helpers", () => {
  it("accepts only the expected type", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(stringOrNull("a")).toBe("a");
    expect(stringOrNull(1)).toBeNull();
    expect(numberOrNull(1.5)).toBe(1.5);
    expect(numberOrNull("1")).toBeNull();
    expect(numberOrNull(Number.NaN)).toBeNull();
    expect(numberOrNull(Number.POSITIVE_INFINITY)).toBeNull();
    expect(arrayOrEmpty([1])).toEqual([1]);
    expect(arrayOrEmpty({ length: 1 })).toEqual([]);
  });
});

describe("Counter", () => {
  it("counts keys and keeps hostile keys as own properties", () => {
    const c = new Counter();
    c.add("Bash");
    c.add("Bash");
    c.add("__proto__");
    const counts = c.toObject();
    expect(Object.getPrototypeOf(counts)).toBe(Object.prototype);
    expect(Object.hasOwn(counts, "__proto__")).toBe(true);
    expect(counts.Bash).toBe(2);
    expect(sumValues(counts)).toBe(3);
  });
  it("sums an empty counter to 0", () => {
    expect(sumValues(new Counter().toObject())).toBe(0);
  });
});
