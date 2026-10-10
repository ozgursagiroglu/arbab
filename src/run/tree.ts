import { execFileSync } from "node:child_process";
import { isAlive, sendSignal, sleep as realSleep } from "../util/proc";

export interface PsRow {
  pid: number;
  ppid: number;
  pgid: number;
}

/** Parses `ps -A -o pid=,ppid=,pgid=`; lines that are not three integers are skipped. */
export function parsePs(output: string): PsRow[] {
  const rows: PsRow[] = [];
  for (const line of output.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 3 || !parts.every((p) => /^\d+$/.test(p))) continue;
    const [pid, ppid, pgid] = parts.map(Number) as [number, number, number];
    rows.push({ pid, ppid, pgid });
  }
  return rows;
}

export type ExecText = (file: string, args: string[]) => string;

const execText: ExecText = (file, args) => execFileSync(file, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });

/** One snapshot of every process. ps is setuid on macOS, so this fails (EPERM) inside a worker's sandbox. */
export function readPs(exec: ExecText = execText): string {
  return exec("ps", ["-A", "-o", "pid=,ppid=,pgid="]);
}

/**
 * Every descendant of `root` in this snapshot, plus members of root's process group, plus `known` pids from earlier
 * snapshots (a child whose parent died is reparented to PID 1 and is only reachable that way) and their descendants.
 * Never includes root, 0 or 1.
 */
export function descendantsOf(root: number, table: PsRow[], known: Set<number>): Set<number> {
  const children = new Map<number, number[]>();
  for (const row of table) {
    const list = children.get(row.ppid);
    if (list) list.push(row.pid);
    else children.set(row.ppid, [row.pid]);
  }
  const found = new Set<number>();
  const queue = [root, ...known, ...table.filter((r) => r.pgid === root).map((r) => r.pid)];
  for (const pid of queue) {
    if (pid !== root && pid > 1) found.add(pid);
  }
  while (queue.length > 0) {
    const pid = queue.pop() as number;
    for (const child of children.get(pid) ?? []) {
      if (child === root || child <= 1 || found.has(child)) continue;
      found.add(child);
      queue.push(child);
    }
  }
  return found;
}

/**
 * The tracked descendants after a new snapshot: descendantsOf, but only pids the snapshot still lists, so a pid that
 * died cannot stay tracked and be signalled once the system hands it to another process. Once root has exited its
 * pid may be reused too, so its children no longer count.
 */
export function trackDescendants(root: number, table: PsRow[], tracked: Set<number>, rootRunning: boolean): Set<number> {
  const present = new Set(table.map((row) => row.pid));
  const rows = rootRunning ? table : table.filter((row) => row.ppid !== root);
  return new Set([...descendantsOf(root, rows, tracked)].filter((pid) => present.has(pid)));
}

/**
 * The pids a kill may signal, from a fresh snapshot: members of root's process group (a group id is not reused while
 * the group exists), and processes whose parent is a tracked descendant still listed, or root while it runs. A
 * tracked pid that is now neither is left alone: it may belong to someone else by now.
 */
export function signalTargets(root: number, table: PsRow[], tracked: Set<number>, rootRunning: boolean): Set<number> {
  const present = new Set(table.map((row) => row.pid));
  const parents = new Set([...tracked].filter((pid) => present.has(pid)));
  if (rootRunning) parents.add(root);
  const out = new Set<number>();
  for (const row of table) {
    if (row.pid === root || row.pid <= 1) continue;
    if (row.pgid === root || parents.has(row.ppid)) out.add(row.pid);
  }
  return out;
}

export interface ReapInput {
  /** The worker's process group (its pid, since it was spawned detached). */
  pgid: number;
  pids: Iterable<number>;
  signal?: (target: number, signal: NodeJS.Signals) => boolean;
  alive?: (pid: number) => boolean;
  sleep?: (ms: number) => Promise<void>;
  graceMs?: number;
  /** The caller's pid, never signalled. */
  selfPid?: number;
  /**
   * Narrows the pids to those a fresh snapshot still vouches for (see signalTargets), before each signal round. It
   * returns null when no snapshot can be taken: then only the group is signalled. Without it every pid is signalled.
   */
  verify?: (pids: number[]) => Set<number> | null;
}

/**
 * SIGTERM to the group and every pid, wait `graceMs`, then SIGKILL the group and the survivors. Returns the pids
 * (the group leader included, unless `verify` drops it) that were alive at the start.
 */
export async function reap(input: ReapInput): Promise<number[]> {
  const signal = input.signal ?? sendSignal;
  const alive = input.alive ?? isAlive;
  const sleep = input.sleep ?? realSleep;
  const graceMs = input.graceMs ?? 10_000;
  const self = input.selfPid ?? process.pid;
  const safe = (pid: number): boolean => Number.isInteger(pid) && pid > 1 && pid !== self;
  const vouched = (pids: number[]): number[] => {
    if (input.verify === undefined) return pids;
    const ok = input.verify(pids);
    return ok === null ? [] : pids.filter((pid) => ok.has(pid));
  };

  const targets = [...new Set([input.pgid, ...input.pids])].filter(safe);
  const living = vouched(targets.filter((pid) => alive(pid)));
  const group = safe(input.pgid) ? -input.pgid : null;
  const send = (target: number, sig: NodeJS.Signals): boolean => {
    try {
      return signal(target, sig);
    } catch {
      // EPERM (a reused pid now owned by someone else) must not stop the rest of the reap.
      return false;
    }
  };

  let sent = group !== null && send(group, "SIGTERM");
  for (const pid of living) sent = send(pid, "SIGTERM") || sent;
  if (!sent) return living;

  await sleep(graceMs);
  if (group !== null) send(group, "SIGKILL");
  for (const pid of vouched(living.filter((p) => alive(p)))) send(pid, "SIGKILL");
  return living;
}
