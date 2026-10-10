// Review lenses (DESIGN.md §17): what each reviewer lane looks for.

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
