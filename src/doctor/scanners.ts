import { existsSync } from "node:fs";
import { join } from "node:path";
import { ARBAB_DIR, ESLINT_MARKER } from "../run";
import { listNames, readOptional, readPackageJson } from "./read";
import type { DoctorCheck } from "./types";

// Tools run at the root of the main checkout walk into .arbab/worktrees, where every lane holds a copy of the project.

const FLAT_CONFIG = /^eslint\.config\.(js|mjs|cjs|ts|mts|cts)$/;
const TEST_CONFIG = /^(vitest|vite|jest)\.config\.(js|mjs|cjs|ts|mts|cts|json)$/;

export const ESLINT_FLAT_UNGUARDED = "eslint in this checkout also lints .arbab/worktrees: add '.arbab/**' to its ignores";

/**
 * A flat config that never mentions .arbab lints every worktree. A legacy config (ESLint 8) cascades from a worktree
 * up into the main checkout's config unless `.arbab/.eslintrc.json` says `root: true`.
 */
export function checkEslint(root: string): DoctorCheck[] {
  const names = listNames(root);
  const flat = names.filter((n) => FLAT_CONFIG.test(n));
  const legacy = names.filter((n) => n.startsWith(".eslintrc"));
  if (readPackageJson(root)?.["eslintConfig"] !== undefined) legacy.push("package.json eslintConfig");
  if (flat.length === 0 && legacy.length === 0) return [];

  const out: DoctorCheck[] = [];
  const unguarded = flat.filter((n) => !(readOptional(join(root, n)) ?? "").includes(ARBAB_DIR));
  if (unguarded.length > 0) out.push({ status: "warn", check: "eslint", detail: `${ESLINT_FLAT_UNGUARDED} (${unguarded.join(", ")})` });
  const marker = `${ARBAB_DIR}/${ESLINT_MARKER}`;
  if (legacy.length > 0 && !existsSync(join(root, marker))) {
    out.push({
      status: "warn",
      check: "eslint",
      detail: `${marker} is missing, so ESLint in a worktree also loads ${legacy.join(", ")} of this checkout (the shepherd writes the marker on the next launch)`,
    });
  }
  if (out.length === 0) out.push({ status: "ok", check: "eslint", detail: `${[...flat, ...legacy].join(", ")} stop at ${ARBAB_DIR}/` });
  return out;
}

/** Whether a test config's text limits what it collects: an include (vitest), a testMatch (jest) or an .arbab exclude. */
export function confinesTests(text: string): boolean {
  return /\b(include|testMatch)\b/.test(text) || text.includes(ARBAB_DIR);
}

/** A vitest or jest config that collects by default finds every worktree's tests too. vite.config needs a test block. */
export function checkTestConfigs(root: string): DoctorCheck | null {
  const configs: string[] = [];
  const open: string[] = [];
  for (const name of listNames(root).filter((n) => TEST_CONFIG.test(n))) {
    const text = readOptional(join(root, name)) ?? "";
    if (name.startsWith("vite.") && !/\btest\s*:/.test(text)) continue;
    configs.push(name);
    if (!confinesTests(text)) open.push(name);
  }
  if (configs.length === 0) return null;
  return open.length === 0
    ? { status: "ok", check: "tests", detail: `${configs.join(", ")} limit what they collect` }
    : {
        status: "warn",
        check: "tests",
        detail: `${open.join(", ")} may collect tests from .arbab/worktrees: set include, or exclude '.arbab/**'`,
      };
}
