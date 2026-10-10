// One policy for environment names that reach workers (M1 review C9), shared by config loading and workerEnv.

// These make a worker register as an interactive editor session, accept cross-session messages or inherit the
// host's effort.
const FORBIDDEN_PREFIX = /^(CLAUDE|VSCODE|CURSOR|TERM_PROGRAM)/;
// arbab sets these itself; a configured value would undo the scrub or pick the worker's account.
const RESERVED_PREFIX = /^ANTHROPIC/;
const RESERVED_EXACT: readonly string[] = ["HOME", "PATH"];

/** A name that must never reach a worker, by any route (passEnv included). */
export function isForbiddenWorkerEnv(name: string): boolean {
  return FORBIDDEN_PREFIX.test(name) || name === "CLAUDECODE";
}

/**
 * A name a project may not set to its own value (config env). ANTHROPIC_API_KEY is reserved here but not forbidden,
 * so API-key users can still pass the host's value through.
 */
export function isReservedEnv(name: string): boolean {
  return isForbiddenWorkerEnv(name) || RESERVED_PREFIX.test(name) || RESERVED_EXACT.includes(name);
}
