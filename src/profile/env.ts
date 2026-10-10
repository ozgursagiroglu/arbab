import { isAbsolute } from "node:path";
import { isForbiddenWorkerEnv, isReservedEnv } from "../util/env-policy";
import { ArbabError } from "../util/errors";

const HOST_KEYS = ["HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "SHELL"] as const;
const SYSTEM_PATH = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface WorkerEnvOptions {
  passEnv: string[];
  extra: Record<string, string>;
  nodeDir: string;
  pnpmDir?: string;
}

/** The worker's environment, built from scratch: only named host variables get through (DESIGN.md §4). */
export function workerEnv(host: Record<string, string | undefined>, opts: WorkerEnvOptions): Record<string, string> {
  for (const name of opts.passEnv) assertWorkerEnvName(name, isForbiddenWorkerEnv);
  // Extra values are set by arbab, not taken from the host, so they must not replace the scrubbed HOME or PATH.
  for (const name of Object.keys(opts.extra)) assertWorkerEnvName(name, isReservedEnv);
  const dirs = opts.pnpmDir === undefined ? [opts.nodeDir] : [opts.nodeDir, opts.pnpmDir];
  for (const dir of dirs) {
    // An empty or relative PATH entry resolves against the working directory, which the worker controls.
    if (!isAbsolute(dir) || dir.includes(":")) {
      throw new ArbabError("config", `PATH entry ${JSON.stringify(dir)} must be an absolute path without ":"`);
    }
  }

  const env: Record<string, string> = {};
  for (const key of HOST_KEYS) {
    const value = host[key];
    if (value !== undefined) env[key] = value;
  }
  env.PATH = [...new Set([...dirs, ...SYSTEM_PATH])].join(":");
  env.TERM = "dumb";
  env.DISABLE_AUTOUPDATER = "1";
  for (const name of opts.passEnv) {
    const value = host[name];
    if (value !== undefined) env[name] = value;
  }
  Object.assign(env, opts.extra);
  return env;
}

function assertWorkerEnvName(name: string, refused: (name: string) => boolean): void {
  if (!ENV_NAME.test(name)) {
    throw new ArbabError("config", `environment name ${JSON.stringify(name)} is not a valid variable name`);
  }
  if (refused(name)) {
    throw new ArbabError("config", `environment name ${name} must not reach a worker`);
  }
}
