/** True when a process with this pid exists (EPERM means it exists but belongs to someone else). */
export function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Sends a signal to a pid, or to a process group when `target` is negative. A target that is already gone is not
 * an error: returns false. Refuses 0, -1 and non-integers, which would hit the caller's own group or every process.
 */
export function sendSignal(target: number, signal: NodeJS.Signals): boolean {
  if (!Number.isInteger(target) || target === 0 || target === -1) {
    throw new RangeError(`refusing to signal ${target}`);
  }
  try {
    process.kill(target, signal);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw err;
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export const isoAt = (clock: Clock): string => new Date(clock.now()).toISOString();
