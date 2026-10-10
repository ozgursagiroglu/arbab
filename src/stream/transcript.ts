import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseStream } from "./digest";
import { Counter, isRecord } from "./json";

// Session ids become file names; anything but a UUID could walk out of the projects directory.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The path of `<sessionId>.jsonl` in a direct subdirectory of `projectsDir` (e.g. ~/.claude/projects), or null.
 * Returns null without touching the file system when `sessionId` is not a UUID, and null when `projectsDir` cannot
 * be read: the transcript only adds measured effort, so its absence is not an error.
 * Subdirectories are searched in name order, so the answer is stable if a session id appears twice.
 */
export function findTranscript(projectsDir: string, sessionId: string): string | null {
  if (!UUID.test(sessionId)) return null;
  let dirs: string[];
  try {
    dirs = readdirSync(projectsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return null;
  }
  const file = `${sessionId}.jsonl`;
  for (const dir of dirs) {
    const candidate = join(projectsDir, dir, file);
    if (statSync(candidate, { throwIfNoEntry: false })?.isFile()) return candidate;
  }
  return null;
}

/**
 * Counts the `effort` of every assistant entry in a session transcript, e.g. {"high": 104}. Effort is not in stream
 * events, so this is the only measure of what the session actually used. Unparsable lines are skipped.
 */
export function measuredEffort(transcriptText: string): Record<string, number> {
  const counts = new Counter();
  for (const entry of parseStream(transcriptText).events) {
    if (isRecord(entry) && entry.type === "assistant" && typeof entry.effort === "string" && entry.effort !== "") {
      counts.add(entry.effort);
    }
  }
  return counts.toObject();
}
