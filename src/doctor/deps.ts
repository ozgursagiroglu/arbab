import { statSync } from "node:fs";
import { join } from "node:path";
import type { ArgvRunner } from "../run";
import type { DependencyStrategy } from "../types";
import type { DoctorCheck } from "./types";

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The clone strategy's prerequisites (DESIGN.md §22): python3 for clonefile(2) on macOS, and each listed directory in
 * the main checkout. Warnings only, since the strategy still works without them, slower or through its fallback. Null
 * for any other strategy.
 */
export function checkClone(root: string, dependencies: DependencyStrategy, platform: NodeJS.Platform, run: ArgvRunner): DoctorCheck[] | null {
  if (dependencies.strategy !== "clone") return null;
  const warn = (detail: string): DoctorCheck => ({ status: "warn", check: "dependencies", detail });
  const out: DoctorCheck[] = [];
  if (platform === "darwin" && run(["python3", "-I", "-c", "import ctypes"], root).code !== 0) {
    out.push(warn("clone falls back to cp -cR, much slower, without python3"));
  }
  for (const path of dependencies.paths) {
    if (!isDirectory(join(root, path))) out.push(warn(`every launch will fall back: ${path} is missing`));
  }
  if (out.length > 0) return out;
  const how = platform === "darwin" ? "clonefile(2)" : "cp -a --reflink=auto";
  return [{ status: "ok", check: "dependencies", detail: `clone ${dependencies.paths.join(", ")} with ${how}` }];
}
