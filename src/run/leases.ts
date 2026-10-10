import { createServer } from "node:net";
import { join, resolve } from "node:path";
import type { Lease, ProjectConfig } from "../types";
import { ArbabError } from "../util/errors";
import { assertValidName, envSuffix } from "../util/names";
import { acquireFromPool, releaseToPool, type Alive, type Holder } from "./pool";

export type PortProbe = (port: number) => boolean | Promise<boolean>;

/** True when a listener can bind 127.0.0.1:<port> right now. */
export function isPortFree(port: number): Promise<boolean> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return Promise.resolve(false);
  return new Promise((done) => {
    const server = createServer();
    server.once("error", () => done(false));
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => {
      server.close(() => done(true));
    });
  });
}

export interface LeaseRequest {
  home: string;
  /** Count per resource type, e.g. {"port": 2}. */
  requests: Record<string, number>;
  ranges: ProjectConfig["resources"];
  holder: Holder;
  alive: Alive;
  probePort: PortProbe;
}

function leaseDir(home: string, type: string): string {
  return join(resolve(home), "leases", assertValidName(type, "resource type"));
}

function checkedRange(type: string, ranges: ProjectConfig["resources"]): [number, number] {
  const spec: unknown = Object.hasOwn(ranges, type) ? ranges[type] : undefined;
  const r = typeof spec === "object" && spec !== null ? (spec as { range?: unknown }).range : undefined;
  if (!Array.isArray(r) || r.length !== 2) throw new ArbabError("lease", `no range configured for resource ${type}`);
  const [lo, hi] = r as unknown[];
  if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi) || (lo as number) < 0 || (lo as number) > (hi as number)) {
    throw new ArbabError("lease", `resource ${type} has an invalid range ${JSON.stringify(r)}`);
  }
  if (type === "port" && ((lo as number) < 1 || (hi as number) > 65535)) {
    throw new ArbabError("lease", `port range ${JSON.stringify(r)} is outside 1..65535`);
  }
  return [lo as number, hi as number];
}

/**
 * Takes the lowest free values of each requested type, in type-name order. Ports must also pass `probePort`; a busy
 * port is released at once. All-or-nothing: on any failure everything taken is released and a lease error thrown.
 */
export async function acquireLeases(req: LeaseRequest): Promise<Lease[]> {
  const plan: Array<{ type: string; count: number; lo: number; hi: number }> = [];
  for (const type of Object.keys(req.requests).sort()) {
    assertValidName(type, "resource type");
    const count = req.requests[type];
    if (count === undefined || !Number.isSafeInteger(count) || count < 0) {
      throw new ArbabError("lease", `resource ${type} count must be a non-negative integer`);
    }
    if (count === 0) continue;
    const [lo, hi] = checkedRange(type, req.ranges);
    plan.push({ type, count, lo, hi });
  }

  const taken: Lease[] = [];
  try {
    for (const { type, count, lo, hi } of plan) {
      const dir = leaseDir(req.home, type);
      let got = 0;
      for (let value = lo; value <= hi && got < count; value++) {
        if (acquireFromPool(dir, [value], req.holder, req.alive) === null) continue;
        if (type === "port") {
          let isFree: boolean;
          try {
            isFree = await req.probePort(value);
          } catch (err) {
            releaseToPool(dir, value, req.holder);
            throw err;
          }
          if (!isFree) {
            releaseToPool(dir, value, req.holder);
            continue;
          }
        }
        const { pid, lane, project, createdAt } = req.holder;
        taken.push({ type, value, lane, project, pid, createdAt });
        got++;
      }
      if (got < count) throw new ArbabError("lease", `only ${got} of ${count} ${type} values free in ${lo}..${hi}`);
    }
  } catch (err) {
    releaseLeases(req.home, taken, req.holder);
    throw err instanceof ArbabError ? err : new ArbabError("lease", (err as Error).message, { cause: err });
  }
  return taken;
}

export function releaseLeases(home: string, leases: Lease[], holder: Holder): void {
  for (const lease of leases) releaseToPool(leaseDir(home, lease.type), lease.value, holder);
}

/** {ARBAB_<TYPE>_<i>: value}, numbered from 0 per type in the order given. */
export function leaseEnv(leases: Lease[]): Record<string, string> {
  const env: Record<string, string> = {};
  const next = new Map<string, number>();
  for (const lease of leases) {
    const i = next.get(lease.type) ?? 0;
    next.set(lease.type, i + 1);
    env[`ARBAB_${envSuffix(lease.type)}_${i}`] = String(lease.value);
  }
  return env;
}
