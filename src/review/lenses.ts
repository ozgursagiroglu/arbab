// Review lenses (DESIGN.md §17): what each reviewer lane looks for.
import { ArbabError } from "../util/errors";
import { assertValidName } from "../util/names";

export const BUILTIN_LENSES: Readonly<Record<string, string>> = Object.freeze({
  correctness:
    "Wrong behaviour on reachable paths, lost or duplicated work, wrong end states, time and unit errors, " +
    "resource leaks.",
  security:
    "Fence escapes, code from workers running on the host, path traversal and symlinks, argument injection, " +
    "secrets on disk or in logs, signals to the wrong processes, races.",
  contracts:
    "Files and fields modules disagree on, behaviour against DESIGN.md, duplicated logic, untested exports, " +
    "bundle-only breakage.",
});

/** The built-ins in their order, then the config lenses; a config lens named like a built-in keeps the built-in's place. */
export function lensNames(configLenses: Record<string, string>): string[] {
  const names = Object.keys(BUILTIN_LENSES);
  for (const name of Object.keys(configLenses)) if (!names.includes(name)) names.push(name);
  return names;
}

/** What a lens looks for: the config text when set (it replaces a built-in's), else the built-in text; null if unknown. */
export function lensText(lens: string, configLenses: Record<string, string>): string | null {
  if (Object.hasOwn(configLenses, lens)) return configLenses[lens] ?? null;
  return Object.hasOwn(BUILTIN_LENSES, lens) ? (BUILTIN_LENSES[lens] ?? null) : null;
}

/** The longest lens text a `--lens-file` may give. */
export const MAX_LENS_FILE_TEXT = 8_000;

/** `review --lens-file <name>=<file>`: the lens name (it becomes part of lane names) and the file as given. */
export function parseLensFileOption(option: string): { name: string; file: string } {
  const at = option.indexOf("=");
  if (at <= 0 || at === option.length - 1) {
    throw new ArbabError("usage", `--lens-file ${JSON.stringify(option)} must be <name>=<file>`);
  }
  return { name: assertValidName(option.slice(0, at), "lens"), file: option.slice(at + 1) };
}

/** A lens file's text, trimmed: 1 to MAX_LENS_FILE_TEXT characters. */
export function lensFileText(name: string, text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_LENS_FILE_TEXT) {
    throw new ArbabError("usage", `the file of lens ${name} has ${trimmed.length} characters; a lens text has 1 to ${MAX_LENS_FILE_TEXT}`);
  }
  return trimmed;
}
