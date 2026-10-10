import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Lease } from "../types";
import { ArbabError } from "../util/errors";
import { acquireLeases, isPortFree, leaseEnv, releaseLeases } from "./leases";
import { acquireFromPool, type Holder } from "./pool";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "arbab-lease-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const holder = (pid: number): Holder => ({ pid, lane: `lane-${pid}`, project: "/p", createdAt: "t0" });
const alive = () => true;
const free = () => true;
const ranges = { port: { range: [3000, 3004] as [number, number] }, "redis-db": { range: [0, 1] as [number, number] } };
const held = (type: string) => (existsSync(join(home, "leases", type)) ? readdirSync(join(home, "leases", type)).sort() : []);

async function leaseError(p: Promise<unknown>): Promise<ArbabError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(ArbabError);
    expect((err as ArbabError).code).toBe("lease");
    return err as ArbabError;
  }
  throw new Error("expected a lease error");
}

describe("acquireLeases", () => {
  it("takes the lowest free values per type, in type-name order", async () => {
    acquireFromPool(join(home, "leases", "port"), [3000], holder(1), alive);
    const leases = await acquireLeases({
      home,
      requests: { port: 2, "redis-db": 1 },
      ranges,
      holder: holder(10),
      alive,
      probePort: free,
    });
    expect(leases.map((l) => [l.type, l.value])).toEqual([
      ["port", 3001],
      ["port", 3002],
      ["redis-db", 0],
    ]);
    expect(leases[0]).toEqual({ type: "port", value: 3001, lane: "lane-10", project: "/p", pid: 10, createdAt: "t0" });
    expect(held("port")).toEqual(["3000.json", "3001.json", "3002.json"]);
  });

  it("skips busy ports without keeping them", async () => {
    const probed: number[] = [];
    const leases = await acquireLeases({
      home,
      requests: { port: 2 },
      ranges,
      holder: holder(10),
      alive,
      probePort: async (port) => {
        probed.push(port);
        return port !== 3001;
      },
    });
    expect(leases.map((l) => l.value)).toEqual([3000, 3002]);
    expect(probed).toEqual([3000, 3001, 3002]);
    expect(held("port")).toEqual(["3000.json", "3002.json"]);
  });

  it("does not probe non-port types", async () => {
    const leases = await acquireLeases({
      home,
      requests: { "redis-db": 2 },
      ranges,
      holder: holder(10),
      alive,
      probePort: () => {
        throw new Error("must not probe");
      },
    });
    expect(leases.map((l) => l.value)).toEqual([0, 1]);
  });

  it("is all-or-nothing", async () => {
    acquireFromPool(join(home, "leases", "redis-db"), [0, 1], holder(1), alive);
    acquireFromPool(join(home, "leases", "redis-db"), [1], holder(2), alive);
    // "port" sorts before "redis-db": the ports are taken first and must be given back.
    const err = await leaseError(
      acquireLeases({ home, requests: { port: 2, "redis-db": 1 }, ranges, holder: holder(10), alive, probePort: free }),
    );
    expect(err.message).toMatch(/redis-db/);
    expect(held("port")).toEqual([]);
    expect(held("redis-db")).toEqual(["0.json", "1.json"]);
  });

  it("fails when too few ports are free", async () => {
    await leaseError(
      acquireLeases({ home, requests: { port: 2 }, ranges, holder: holder(10), alive, probePort: (p) => p === 3004 }),
    );
    expect(held("port")).toEqual([]);
  });

  it("releases and wraps a probe that throws", async () => {
    await leaseError(
      acquireLeases({
        home,
        requests: { "redis-db": 1, port: 1 },
        ranges,
        holder: holder(10),
        alive,
        probePort: () => {
          throw new Error("probe broke");
        },
      }),
    );
    expect(held("port")).toEqual([]);
    expect(held("redis-db")).toEqual([]);
  });

  it("validates types, counts and ranges", async () => {
    const base = { home, holder: holder(10), alive, probePort: free };
    await leaseError(acquireLeases({ ...base, requests: { database: 1 }, ranges }));
    await leaseError(acquireLeases({ ...base, requests: { port: -1 }, ranges }));
    await leaseError(acquireLeases({ ...base, requests: { port: 1.5 }, ranges }));
    await leaseError(acquireLeases({ ...base, requests: { x: 1 }, ranges: { x: { range: [5, 1] } } }));
    await leaseError(acquireLeases({ ...base, requests: { port: 1 }, ranges: { port: { range: [0, 10] } } }));
    await leaseError(acquireLeases({ ...base, requests: { constructor: 1 }, ranges: {} }));
    await expect(acquireLeases({ ...base, requests: { "../x": 1 }, ranges })).rejects.toThrow(ArbabError);
    expect(await acquireLeases({ ...base, requests: { port: 0 }, ranges })).toEqual([]);
  });
});

describe("releaseLeases", () => {
  it("removes this holder's entries only", async () => {
    const mine = await acquireLeases({ home, requests: { port: 2 }, ranges, holder: holder(10), alive, probePort: free });
    acquireFromPool(join(home, "leases", "port"), [3004], holder(11), alive);
    releaseLeases(home, [...mine, { ...mine[0]!, value: 3004 }], holder(10));
    expect(held("port")).toEqual(["3004.json"]);
  });
});

describe("leaseEnv", () => {
  it("numbers values from 0 per type", () => {
    const l = (type: string, value: number): Lease => ({ type, value, lane: "a", project: "/p", pid: 1, createdAt: "t" });
    expect(leaseEnv([l("port", 3001), l("port", 3002), l("redis-db", 4)])).toEqual({
      ARBAB_PORT_0: "3001",
      ARBAB_PORT_1: "3002",
      ARBAB_REDIS_DB_0: "4",
    });
    expect(leaseEnv([])).toEqual({});
  });
});

describe("isPortFree", () => {
  it("sees a port held by a listener as busy and free once it closes", async () => {
    const server = createServer();
    await new Promise<void>((done) => server.listen({ port: 0, host: "127.0.0.1" }, done));
    const port = (server.address() as AddressInfo).port;
    expect(await isPortFree(port)).toBe(false);
    await new Promise<void>((done) => server.close(() => done()));
    expect(await isPortFree(port)).toBe(true);
  });
  it("treats invalid ports as not free", async () => {
    expect(await isPortFree(0)).toBe(false);
    expect(await isPortFree(70000)).toBe(false);
    expect(await isPortFree(1.5)).toBe(false);
  });
});
