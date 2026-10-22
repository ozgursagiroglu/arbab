// Lane notes as readiness risks a person can read (DESIGN.md §21): one sandbox limit named in twenty reports is one
// risk, not twenty.
import type { ReadinessItem } from "../types";

/** One entry of a lane report's not_verified or open_questions. */
export interface LaneNote {
  id: string;
  lane: string;
  /** "open question" or "not verified". */
  label: string;
  text: string;
}

/** A lane's notes and the risks about its report itself (missing, malformed), in report order. */
export type LaneEntry = { note: LaneNote } | { risk: ReadinessItem };

// The most specific kind first: "Playwright cannot run in the sandbox: no browser" is about the browser.
const FENCE_KINDS: ReadonlyArray<readonly [string, RegExp]> = [
  ["database", /\bno database\b/i],
  ["browser", /\bbrowsers?\b/i],
  ["network", /\bnetwork\b/i],
  ["sandbox", /\bsandbox|\bEPERM\b|\bcannot run\b|\bnot permitted\b/i],
];

const MAX_EXAMPLES = 3;
const EXAMPLE_CHARS = 100;

/** The fence limit a note is about, or null. */
export function fenceKind(text: string): string | null {
  return FENCE_KINDS.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

/** The text two lanes' notes share when they say the same thing: lowercased, digits as N, spaces collapsed. */
export function noteKey(text: string): string {
  return text.trim().toLowerCase().replace(/\d+/g, "N").replace(/\s+/g, " ");
}

function flat(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function example(note: LaneNote): string {
  const text = flat(note.text);
  return `${note.lane}: ${text.length > EXAMPLE_CHARS ? `${text.slice(0, EXAMPLE_CHARS - 1)}…` : text}`;
}

/**
 * The lane entries as risks, in the order each first appears. Notes about the fence become one item per kind; notes
 * that say the same thing in two or more lanes become one item "<n> lanes: <text>"; the rest stay one per note.
 */
export function groupLaneNotes(entries: readonly LaneEntry[]): ReadinessItem[] {
  const fence = new Map<string, LaneNote[]>();
  const lanesOf = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (!("note" in entry)) continue;
    const kind = fenceKind(entry.note.text);
    if (kind !== null) {
      fence.set(kind, [...(fence.get(kind) ?? []), entry.note]);
      continue;
    }
    const key = noteKey(entry.note.text);
    lanesOf.set(key, (lanesOf.get(key) ?? new Set()).add(entry.note.lane));
  }

  const out: ReadinessItem[] = [];
  const emitted = new Set<string>();
  for (const entry of entries) {
    if (!("note" in entry)) {
      out.push(entry.risk);
      continue;
    }
    const { note } = entry;
    const kind = fenceKind(note.text);
    if (kind !== null) {
      if (emitted.has(`fence:${kind}`)) continue;
      emitted.add(`fence:${kind}`);
      const notes = fence.get(kind) ?? [note];
      const examples = [...new Set(notes.map(example))].slice(0, MAX_EXAMPLES);
      out.push({
        id: `fence:${kind}`,
        text: `Not run inside the fence (${notes.length} ${notes.length === 1 ? "note" : "notes"}): ${examples.join("; ")}`,
      });
      continue;
    }
    const key = noteKey(note.text);
    const lanes = lanesOf.get(key)?.size ?? 1;
    if (lanes < 2) {
      out.push({ id: note.id, text: `${note.lane} (${note.label}): ${note.text}` });
      continue;
    }
    if (emitted.has(`notes:${key}`)) continue;
    emitted.add(`notes:${key}`);
    out.push({ id: `notes:${note.id}`, text: `${lanes} lanes: ${flat(note.text)}` });
  }
  return out;
}

/** The items with the first of each text kept: identical risks say nothing twice. */
export function uniqueTexts(items: readonly ReadinessItem[]): ReadinessItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.text)) return false;
    seen.add(item.text);
    return true;
  });
}
