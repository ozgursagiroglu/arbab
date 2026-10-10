import { describe, expect, it } from "vitest";
import { descendantsOf, parsePs, readPs, reap, signalTargets, trackDescendants, type PsRow } from "./tree";

describe("parsePs", () => {
  it("parses padded rows and skips anything else", () => {
    const out = "    1     0     1\n  412     1   412\nPID PPID PGID\n\n 500 412 412 extra\n  501   412   412  \n";
    expect(parsePs(out)).toEqual([
      { pid: 1, ppid: 0, pgid: 1 },
      { pid: 412, ppid: 1, pgid: 412 },
      { pid: 501, ppid: 412, pgid: 412 },
    ]);
  });
});

// ps is setuid on macOS and refused inside an OS sandbox; the real snapshot is checked only where it can run.
const psRuns = (() => {
  try {
    readPs();
    return true;
  } catch {
    return false;
  }
})();

describe("readPs", () => {
  it("runs ps -A with pid, ppid and pgid columns and no shell", () => {
    const calls: Array<[string, string[]]> = [];
    expect(
      readPs((file, args) => {
        calls.push([file, args]);
        return "1 0 1\n";
      }),
    ).toBe("1 0 1\n");
    expect(calls).toEqual([["ps", ["-A", "-o", "pid=,ppid=,pgid="]]]);
  });
  it.runIf(psRuns)("lists this process with its parent", () => {
    const me = parsePs(readPs()).find((row) => row.pid === process.pid);
    expect(me?.ppid).toBe(process.ppid);
  });
});

describe("descendantsOf", () => {
  const table: PsRow[] = [
    { pid: 1, ppid: 0, pgid: 1 },
    { pid: 100, ppid: 50, pgid: 100 }, // the worker
    { pid: 101, ppid: 100, pgid: 100 },
    { pid: 102, ppid: 101, pgid: 102 }, // made its own group: only reachable by ancestry
    { pid: 103, ppid: 102, pgid: 102 },
    { pid: 104, ppid: 1, pgid: 100 }, // parent died, still in the worker's group
    { pid: 151, ppid: 150, pgid: 151 }, // child of a known pid that is gone now
    { pid: 200, ppid: 1, pgid: 200 }, // another session's process
    { pid: 201, ppid: 200, pgid: 200 },
  ];

  it("finds transitive children, group members and known pids with their children", () => {
    expect([...descendantsOf(100, table, new Set([150]))].sort((a, b) => a - b)).toEqual([101, 102, 103, 104, 150, 151]);
  });
  it("keeps known pids that left the snapshot and never returns root, 0 or 1", () => {
    const found = descendantsOf(100, [], new Set([0, 1, 100, 160]));
    expect([...found]).toEqual([160]);
  });
  it("tolerates cycles in a corrupt snapshot", () => {
    const loop: PsRow[] = [
      { pid: 10, ppid: 11, pgid: 10 },
      { pid: 11, ppid: 10, pgid: 10 },
    ];
    expect([...descendantsOf(10, loop, new Set())]).toEqual([11]);
  });
});

describe("trackDescendants", () => {
  it("drops tracked pids the snapshot no longer lists, keeping those that still appear", () => {
    const table: PsRow[] = [
      { pid: 100, ppid: 50, pgid: 100 },
      { pid: 101, ppid: 100, pgid: 100 },
      { pid: 150, ppid: 1, pgid: 150 }, // tracked earlier, reparented
      { pid: 151, ppid: 150, pgid: 150 },
    ];
    expect([...trackDescendants(100, table, new Set([150, 160]), true)].sort((a, b) => a - b)).toEqual([101, 150, 151]);
  });
  it("stops following root's children once root has exited, since its pid may be reused", () => {
    const table: PsRow[] = [
      { pid: 100, ppid: 1, pgid: 100 }, // someone else's process with root's old pid
      { pid: 300, ppid: 100, pgid: 100 },
      { pid: 104, ppid: 1, pgid: 100 }, // a member of the worker's group
    ];
    expect([...trackDescendants(100, table, new Set(), true)].sort((a, b) => a - b)).toEqual([104, 300]);
    expect([...trackDescendants(100, table.slice(1).map((r) => ({ ...r, pgid: 300 })), new Set(), false)]).toEqual([]);
  });
});

describe("signalTargets", () => {
  const table: PsRow[] = [
    { pid: 100, ppid: 50, pgid: 100 }, // the worker
    { pid: 101, ppid: 100, pgid: 101 }, // its child, in a group of its own
    { pid: 102, ppid: 101, pgid: 101 }, // grandchild under a tracked child
    { pid: 103, ppid: 1, pgid: 100 }, // in the worker's group
    { pid: 150, ppid: 1, pgid: 150 }, // tracked once, now under init in its own group: may be a recycled pid
    { pid: 151, ppid: 160, pgid: 151 }, // under a tracked pid that is gone
  ];
  it("keeps group members and children of root or of tracked pids that are still listed", () => {
    const targets = signalTargets(100, table, new Set([101, 150, 160]), true);
    expect([...targets].sort((a, b) => a - b)).toEqual([101, 102, 103]);
  });
  it("does not count root as a parent once it has exited", () => {
    expect([...signalTargets(100, table, new Set([150]), false)].sort((a, b) => a - b)).toEqual([103]);
  });
  it("never returns root, 0 or 1", () => {
    const rows: PsRow[] = [
      { pid: 0, ppid: 0, pgid: 100 },
      { pid: 1, ppid: 0, pgid: 100 },
      { pid: 100, ppid: 1, pgid: 100 },
    ];
    expect([...signalTargets(100, rows, new Set([1]), true)]).toEqual([]);
  });
});

function fakes(initiallyAlive: number[], dieOnTerm: number[]) {
  const living = new Set(initiallyAlive);
  const signals: Array<[number, string]> = [];
  const sleeps: number[] = [];
  return {
    signals,
    sleeps,
    alive: (pid: number) => living.has(pid),
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    signal: (target: number, sig: NodeJS.Signals) => {
      signals.push([target, sig]);
      // Group signals reach the fake's members only through the per-pid calls that follow them.
      if (target < 0) return living.size > 0;
      const existed = living.has(target);
      if (sig === "SIGKILL" || dieOnTerm.includes(target)) living.delete(target);
      return existed;
    },
  };
}

describe("reap", () => {
  it("terms the group and every pid, waits, then kills the group and the survivors", async () => {
    const f = fakes([100, 101, 102], [101]);
    const reaped = await reap({ pgid: 100, pids: [101, 102, 103], ...f, graceMs: 10_000, selfPid: 7 });
    expect(reaped).toEqual([100, 101, 102]);
    expect(f.sleeps).toEqual([10_000]);
    expect(f.signals).toEqual([
      [-100, "SIGTERM"],
      [100, "SIGTERM"],
      [101, "SIGTERM"],
      [102, "SIGTERM"],
      [-100, "SIGKILL"],
      [100, "SIGKILL"],
      [102, "SIGKILL"],
    ]);
  });

  it("never signals 0, 1 or its own pid", async () => {
    const f = fakes([0, 1, 7, 300], []);
    const reaped = await reap({ pgid: 1, pids: [0, 1, 7, 300, -5], ...f, graceMs: 5, selfPid: 7 });
    expect(reaped).toEqual([300]);
    const targets = f.signals.map(([t]) => t);
    expect(targets).toEqual([300, 300]);
  });

  it("does not wait when nothing was there to signal", async () => {
    const f = fakes([], []);
    const signal = (target: number, sig: NodeJS.Signals) => {
      f.signals.push([target, sig]);
      return false;
    };
    expect(await reap({ pgid: 100, pids: [101], alive: f.alive, sleep: f.sleep, signal, selfPid: 7 })).toEqual([]);
    expect(f.sleeps).toEqual([]);
    expect(f.signals).toEqual([[-100, "SIGTERM"]]);
  });

  it("carries on when a signal throws (EPERM)", async () => {
    const f = fakes([100, 101], []);
    const signal = (target: number, sig: NodeJS.Signals) => {
      if (target === 100) throw Object.assign(new Error("EPERM"), { code: "EPERM" });
      return f.signal(target, sig);
    };
    const reaped = await reap({ pgid: 100, pids: [101], alive: f.alive, sleep: f.sleep, signal, graceMs: 1, selfPid: 7 });
    expect(reaped).toEqual([100, 101]);
    expect(f.signals).toContainEqual([101, "SIGTERM"]);
    expect(f.signals).toContainEqual([-100, "SIGKILL"]);
  });

  it("signals only the pids verify vouches for, asking again before SIGKILL", async () => {
    const f = fakes([100, 101, 102, 103], []);
    const asked: number[][] = [];
    const vouch = [new Set([101, 102]), new Set([102])];
    const verify = (pids: number[]): Set<number> | null => {
      asked.push(pids);
      return vouch[asked.length - 1] ?? null;
    };
    const reaped = await reap({ pgid: 100, pids: [101, 102, 103], ...f, verify, graceMs: 1, selfPid: 7 });
    expect(reaped).toEqual([101, 102]);
    expect(asked).toEqual([
      [100, 101, 102, 103],
      [101, 102],
    ]);
    expect(f.signals).toEqual([
      [-100, "SIGTERM"],
      [101, "SIGTERM"],
      [102, "SIGTERM"],
      [-100, "SIGKILL"],
      [102, "SIGKILL"],
    ]);
  });

  it("falls back to the group alone when verify cannot take a snapshot", async () => {
    const f = fakes([100, 101], []);
    const reaped = await reap({ pgid: 100, pids: [101], ...f, verify: () => null, graceMs: 1, selfPid: 7 });
    expect(reaped).toEqual([]);
    expect(f.signals).toEqual([
      [-100, "SIGTERM"],
      [-100, "SIGKILL"],
    ]);
  });

  it("uses the 10 s default grace", async () => {
    const f = fakes([100], []);
    await reap({ pgid: 100, pids: [], ...f, selfPid: 7 });
    expect(f.sleeps).toEqual([10_000]);
  });
});
