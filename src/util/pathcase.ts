import { isAbsolute, relative, sep } from "node:path";

// macOS and Windows file systems take any spelling of a name: `.ARBAB` is `.arbab`, and on APFS `ſ` is `s` and an NFC
// `é` is its NFD form. Every check that must hold whatever the spelling compares through these. Where a file system
// does not fold, refusing a little more is the safe side.

/** A path as a case- and normalisation-insensitive file system (APFS, NTFS) compares it. */
export function foldPath(path: string): string {
  // Upper first: lowercasing alone keeps `ſ` (U+017F), which uppercases to `S`; `ß` becomes `ss` on the way.
  return path.normalize("NFD").toUpperCase().toLowerCase();
}

/** `child` is `parent` or lies inside it, compared by foldPath, at a separator boundary. */
export function sameOrInside(parent: string, child: string): boolean {
  // relative() normalises both sides, so a trailing separator or a `.` component changes nothing.
  const rel = relative(foldPath(parent), foldPath(child));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
