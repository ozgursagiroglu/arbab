// Narrowing helpers for untrusted stream and transcript values: a field of the wrong type reads as absent.

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Finite numbers only: NaN and Infinity cannot come from JSON, but a hand-built event could carry them. */
export function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function arrayOrEmpty(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Counts by key. Keys come from untrusted input (tool names, effort values), so counting happens in a Map and the
 * plain object is built with Object.fromEntries, which defines "__proto__" as an own key instead of a prototype.
 */
export class Counter {
  private readonly counts = new Map<string, number>();

  add(key: string): void {
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  toObject(): Record<string, number> {
    return Object.fromEntries(this.counts);
  }
}

export function sumValues(counts: Record<string, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}
