import { basename, dirname, join } from "node:path";
import { readOptional } from "./read";
import type { DoctorCheck } from "./types";

export const HOOK_MISSING = "runner calls will wait for approval: the plugin hook is missing (update the plugin)";

/** `<plugin>/hooks/hooks.json` for a runner at `<plugin>/dist/arbab.mjs`; null when the runner is not in a dist/. */
export function hookFile(scriptPath: string): string | null {
  const dist = dirname(scriptPath);
  return basename(dist) === "dist" ? join(dirname(dist), "hooks", "hooks.json") : null;
}

/** Without the PreToolUse hook every `arbab` call from the orchestrator waits for a human's approval. */
export function checkHook(scriptPath: string): DoctorCheck | null {
  const file = hookFile(scriptPath);
  if (file === null) return null;
  return readOptional(file)?.includes("hook pre-tool-use") === true
    ? { status: "ok", check: "hook", detail: file }
    : { status: "warn", check: "hook", detail: HOOK_MISSING };
}
