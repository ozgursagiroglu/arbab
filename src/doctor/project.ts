import { existsSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILE, LOCAL_CONFIG_FILE } from "../config";
import { WORKER_TMP_DIR, arbabIgnoreEntries, type GitRunner } from "../run";
import type { ProjectConfig } from "../types";
import type { DoctorCheck } from "./types";

/**
 * `.arbab/` as a whole, and worktreeRoot or runsRoot when the config moved them outside it. A warning only: the
 * shepherd adds them to info/exclude on its next launch.
 */
export function checkIgnored(git: GitRunner, root: string, config: Pick<ProjectConfig, "worktreeRoot" | "runsRoot">): DoctorCheck {
  // .arbab-tmp/ lives in worktrees, not in the main checkout.
  const entries = arbabIgnoreEntries(root, config).filter((e) => e !== `${WORKER_TMP_DIR}/`);
  const notIgnored = entries.filter((e) => git(["check-ignore", "-q", "--", `${e}x`], root).code !== 0);
  if (notIgnored.length === 0) return { status: "ok", check: "ignored", detail: `${entries.join(", ")} ignored` };
  const them = notIgnored.length === 1 ? "it" : "them";
  return {
    status: "warn",
    check: "ignored",
    detail: `${notIgnored.join(", ")} not ignored yet (the shepherd adds ${them} to info/exclude on the next launch)`,
  };
}

/** loadConfig reads the root file and silently ignores the other. */
export function checkConfigFiles(root: string): DoctorCheck | null {
  if (!existsSync(join(root, CONFIG_FILE)) || !existsSync(join(root, LOCAL_CONFIG_FILE))) return null;
  return { status: "warn", check: "configs", detail: `both ${CONFIG_FILE} and ${LOCAL_CONFIG_FILE} exist: ${CONFIG_FILE} wins` };
}
