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

/** The blanket `.env*` deny hides tracked templates from workers until fence.readableEnvFiles lists them. */
export function checkEnvTemplates(git: GitRunner, root: string, readableEnvFiles: readonly string[]): DoctorCheck | null {
  const tracked = trackedEnvTemplates(git, root);
  if (tracked.length === 0) return null;
  const listed = new Set(readableEnvFiles.map((p) => posix.normalize(p.split("\\").join("/"))));
  const missing = tracked.filter((p) => !listed.has(p));
  return missing.length === 0
    ? { status: "ok", check: "env", detail: `fence.readableEnvFiles lists ${tracked.join(", ")}` }
    : { status: "warn", check: "env", detail: `workers cannot read ${missing.join(", ")}; add them to fence.readableEnvFiles` };
}
