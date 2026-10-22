import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// doctor reports on the project's files; an unreadable one is a missing one, never a crash.

/** A file's text, or null when it is missing or unreadable. */
export function readOptional(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** The names in a directory, sorted; none when it is missing or unreadable. */
export function listNames(dir: string): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

/** `<root>/package.json` as an object, or null when it is missing, unreadable, not JSON or not an object. */
export function readPackageJson(root: string): Record<string, unknown> | null {
  const text = readOptional(join(root, "package.json"));
  if (text === null) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** package.json's string-valued scripts; others are ignored. */
export function packageScripts(pkg: Record<string, unknown> | null): Record<string, string> {
  const raw = pkg?.["scripts"];
  const out: Record<string, string> = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  for (const [name, body] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof body === "string") out[name] = body;
  }
  return out;
}
