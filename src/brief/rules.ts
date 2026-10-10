// Claude Code's Bash permission matching, as far as briefs need it (DESIGN.md §4, w0 docs research).

const SEPARATORS = /&&|\|\||\|&|;|\||&|\r?\n/;

function globToRegExp(pattern: string): RegExp {
  const body = pattern
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}$`, "s");
}

export function matchesBashRule(command: string, rule: string): boolean {
  const r = rule.trim();
  if (r === "Bash") return true;
  const inner = /^Bash\((.*)\)$/s.exec(r)?.[1];
  if (inner === undefined) return false;
  // The legacy `p:*` form means the same as `p *`.
  const pattern = inner.endsWith(":*") ? `${inner.slice(0, -2)} *` : inner;
  if (pattern === "*") return true;
  return globToRegExp(pattern).test(command.trim());
}

/** Naive split on the separators Claude Code splits on; quotes are not interpreted. */
export function splitCompound(command: string): string[] {
  return command
    .split(SEPARATORS)
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

export function isAllowedCommand(command: string, allow: string[], deny: string[]): boolean {
  const parts = splitCompound(command);
  if (parts.length === 0) return false;
  if (parts.some((p) => deny.some((rule) => matchesBashRule(p, rule)))) return false;
  return parts.every((p) => allow.some((rule) => matchesBashRule(p, rule)));
}
