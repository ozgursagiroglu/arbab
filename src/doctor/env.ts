import { posix } from "node:path";
import type { GitRunner } from "../run";
import type { DoctorCheck } from "./types";

/** Env file names that by convention hold a template, not secrets. */
export const ENV_TEMPLATES: readonly string[] = [".env.example", ".env.sample", ".env.template", ".env.dist", ".env.defaults"];

/** Tracked env templates, relative to `root` and sorted; none when git cannot list them. */
export function trackedEnvTemplates(git: GitRunner, root: string): string[] {
  // Pathspec `*` crosses directories, so `*.env.example` finds every depth; the basename filter drops `x.env.example`.
  const r = git(["ls-files", "-z", "--", ...ENV_TEMPLATES.map((n) => `*${n}`)], root);
  if (r.code !== 0) return [];
  return r.stdout
    .split("\0")
    .filter((p) => p !== "" && ENV_TEMPLATES.includes(posix.basename(p)))
    .sort();
}

/**
 * The listed paths (normalised) git tracks at `root`, in one call; none when git fails. A path outside the root, or
 * the root itself, is never a tracked file and is not asked about.
 */
function trackedListed(git: GitRunner, root: string, listed: readonly string[]): Set<string> {
  const asked = listed.filter((p) => p !== "." && p !== ".." && !p.startsWith("../") && !p.startsWith("/"));
  if (asked.length === 0) return new Set();
  // Literal, so a listed name with glob characters matches only itself.
  const r = git(["ls-files", "-z", "--", ...asked.map((p) => `:(literal)${p}`)], root);
  if (r.code !== 0) return new Set();
  return new Set(r.stdout.split("\0").filter((p) => p !== ""));
}

/**
 * The blanket `.env*` deny hides tracked templates from workers until fence.readableEnvFiles lists them, and a listed
 * file git does not track is never re-opened. Asked of the project root, the human's checkout, never a worktree.
 */
export function checkEnvTemplates(git: GitRunner, root: string, readableEnvFiles: readonly string[]): DoctorCheck | null {
  const tracked = trackedEnvTemplates(git, root);
  const listed = new Map<string, string>();
  for (const p of readableEnvFiles) {
    const normal = posix.normalize(p.split("\\").join("/"));
    if (!listed.has(normal)) listed.set(normal, p);
  }
  if (tracked.length === 0 && listed.size === 0) return null;
  const missing = tracked.filter((p) => !listed.has(p));
  const known = trackedListed(git, root, [...listed.keys()]);
  const untracked = [...listed].filter(([normal]) => !known.has(normal)).map(([, written]) => written);
  const problems: string[] = [];
  if (missing.length > 0) problems.push(`workers cannot read ${missing.join(", ")}; add them to fence.readableEnvFiles`);
  if (untracked.length > 0) {
    problems.push(`git does not track ${untracked.join(", ")} from fence.readableEnvFiles, so each stays unreadable`);
  }
  return problems.length === 0
    ? { status: "ok", check: "env", detail: `fence.readableEnvFiles lists ${[...new Set([...tracked, ...listed.keys()])].sort().join(", ")}` }
    : { status: "warn", check: "env", detail: problems.join("; ") };
}
