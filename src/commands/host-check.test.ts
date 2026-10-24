import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { HostCheckRecord, IntegrationRecord, ReadinessReport } from "../types";
import { writeJsonAtomic } from "../util/fs";
import { readHostCheckRecord, runHostCheck } from "./host-check";
import { runIntegrate } from "./integrate";
import { runReadiness } from "./readiness";
import { DEFAULT_CONFIG, NOW_MS, branchWith, makeProject, passedVerify, type TestProject } from "./testkit";

let p: TestProject;
afterEach(() => p?.dispose());

const GATES = [["docker", "build", "."], ["pnpm", "e2e", "--grep", "a b"], ["make", "db-test"]];
const dir = (t: TestProject): string => join(t.root, ".arbab", "integrations", "rel");
const recordPath = (t: TestProject): string => join(dir(t), "host-checks.json");
const readRecord = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

/** An integration "rel" of one lane, with `hostGates` configured; host commands are faked with `codes` by argv[0]. */
async function integrated(
  hostGates: string[][] = GATES,
  codes: Record<string, number> = {},
): Promise<{ t: TestProject; head: string; worktree: string; ran: Array<{ argv: string[]; cwd: string }> }> {
  const t = makeProject({ config: { ...DEFAULT_CONFIG, hostGates } });
  branchWith(t, "arbab/a", "a.txt", "a\n");
  expect(await runIntegrate(["rel", "--lanes", "a"], t.ctx)).toBe(0);
  t.out.length = 0;
  const record = readRecord<IntegrationRecord>(join(dir(t), "integration.json"));
  const ran: Array<{ argv: string[]; cwd: string }> = [];
  t.ctx.runCommand = (argv, cwd) => {
    ran.push({ argv, cwd });
    const code = codes[argv[0] ?? ""] ?? 0;
    return { code, output: code === 0 ? "fine\n" : `${argv[0]} broke` };
  };
  return { t, head: record.headSha, worktree: record.worktree, ran };
}

describe("runHostCheck", () => {
  it("refuses without a terminal, before running anything", async () => {
    let ran: Array<{ argv: string[]; cwd: string }>;
    ({ t: p, ran } = await integrated());
    p.ctx.interactive = false;
    await expect(runHostCheck(["rel"], p.ctx)).rejects.toMatchObject({
      code: "usage",
      message: expect.stringMatching(/run it yourself in a terminal/),
    });
    expect(ran).toEqual([]);
    expect(existsSync(recordPath(p))).toBe(false);
  });

  it("refuses when no hostGates are configured, a missing integration and bad arguments", async () => {
    ({ t: p } = await integrated([]));
    await expect(runHostCheck(["rel"], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/no hostGates/) });
    p.dispose();
    ({ t: p } = await integrated());
    await expect(runHostCheck(["other"], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/does not exist/) });
    await expect(runHostCheck([], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runHostCheck(["rel", "--json"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    await expect(runHostCheck(["../x"], p.ctx)).rejects.toThrow();
  });

  it("runs every gate in the worktree, in order, records them and exits 0 when all passed", async () => {
    let head: string;
    let worktree: string;
    let ran: Array<{ argv: string[]; cwd: string }>;
    ({ t: p, head, worktree, ran } = await integrated());
    expect(await runHostCheck(["rel"], p.ctx)).toBe(0);
    expect(ran).toEqual(GATES.map((argv) => ({ argv, cwd: worktree })));
    expect(p.stdout()).toBe(["pass  docker build .", "pass  pnpm e2e --grep 'a b'", "pass  make db-test", ""].join("\n"));
    expect(readRecord<HostCheckRecord>(recordPath(p))).toEqual({
      name: "rel",
      headSha: head,
      results: [
        { kind: "gate", argv: GATES[0], command: "docker build .", exitCode: 0 },
        { kind: "gate", argv: GATES[1], command: "pnpm e2e --grep 'a b'", exitCode: 0 },
        { kind: "gate", argv: GATES[2], command: "make db-test", exitCode: 0 },
      ],
      passed: true,
      interactive: true,
      finishedAt: new Date(NOW_MS).toISOString(),
    });
  });

  it("runs the rest after a failure, prints its output to stderr and exits 1", async () => {
    let ran: Array<{ argv: string[]; cwd: string }>;
    ({ t: p, ran } = await integrated(GATES, { docker: 2 }));
    expect(await runHostCheck(["rel"], p.ctx)).toBe(1);
    expect(ran.map((r) => r.argv[0])).toEqual(["docker", "pnpm", "make"]);
    expect(p.stdout()).toBe(["FAIL (exit 2)  docker build .", "pass  pnpm e2e --grep 'a b'", "pass  make db-test", ""].join("\n"));
    expect(p.stderr()).toContain("--- docker build .\ndocker broke\n");
    const record = readRecord<HostCheckRecord>(recordPath(p));
    expect(record.passed).toBe(false);
    expect(record.results.map((r) => r.exitCode)).toEqual([2, 0, 0]);
  });

  it("refuses when the worktree is not at the head or has tracked changes", async () => {
    let worktree: string;
    let ran: Array<{ argv: string[]; cwd: string }>;
    ({ t: p, worktree, ran } = await integrated());
    writeFileSync(join(worktree, "a.txt"), "edited\n");
    await expect(runHostCheck(["rel"], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/tracked changes/) });
    p.ok(["checkout", "--", "a.txt"], worktree);
    p.ok(["commit", "-q", "--allow-empty", "-m", "by hand"], worktree);
    await expect(runHostCheck(["rel"], p.ctx)).rejects.toMatchObject({ code: "usage" });
    expect(ran).toEqual([]);
  });

  it("rebuilds a removed worktree on its branch, installing at the base, then runs the gates on the recorded head", async () => {
    p = makeProject({ config: { ...DEFAULT_CONFIG, hostGates: GATES, dependencies: { strategy: "command", command: ["pnpm", "install"] } } });
    const t = p;
    const ran: Array<{ argv: string[]; cwd: string; head: string }> = [];
    t.ctx.runCommand = (argv, cwd) => {
      ran.push({ argv, cwd, head: t.ok(["rev-parse", "HEAD"], cwd).trim() });
      return { code: 0, output: "" };
    };
    const main = t.ok(["rev-parse", "main"]).trim();
    branchWith(t, "arbab/a", "a.txt", "a\n");
    expect(await runIntegrate(["rel", "--lanes", "a"], t.ctx)).toBe(0);
    const record = readRecord<IntegrationRecord>(join(dir(t), "integration.json"));
    t.ok(["worktree", "remove", "--force", record.worktree]);
    ran.length = 0;
    t.out.length = 0;

    expect(await runHostCheck(["rel"], t.ctx)).toBe(0);
    expect(ran).toEqual([
      { argv: ["pnpm", "install"], cwd: record.worktree, head: main },
      ...GATES.map((argv) => ({ argv, cwd: record.worktree, head: record.headSha })),
    ]);
    expect(t.ok(["rev-parse", "integrate/rel"]).trim()).toBe(record.headSha);
    expect(readRecord<HostCheckRecord>(recordPath(t)).headSha).toBe(record.headSha);
  });

  it("refuses, rebuilding nothing, a removed worktree whose branch moved past the record", async () => {
    let worktree: string;
    let ran: Array<{ argv: string[]; cwd: string }>;
    ({ t: p, worktree, ran } = await integrated());
    p.ok(["commit", "-q", "--allow-empty", "-m", "by hand"], worktree);
    p.ok(["worktree", "remove", "--force", worktree]);
    await expect(runHostCheck(["rel"], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/run arbab integrate rel again$/) });
    expect(existsSync(worktree)).toBe(false);
    expect(ran).toEqual([]);
  });

  it("feeds readiness: the gates are verified once they passed on the head", async () => {
    let head: string;
    ({ t: p, head } = await integrated(GATES, { make: 1 }));
    writeJsonAtomic(join(dir(p), "verify.json"), passedVerify(head));
    expect(await runHostCheck(["rel"], p.ctx)).toBe(1);
    expect(await runReadiness(["rel", "--tier", "low"], p.ctx)).toBe(1);
    const failed = readRecord<ReadinessReport>(join(dir(p), "readiness.json"));
    expect(failed.skipped).toEqual([
      { id: "host", text: "the host gates did not pass on the head: make db-test (exit 1)", waived: false },
    ]);

    p.ctx.runCommand = () => ({ code: 0, output: "" });
    expect(await runHostCheck(["rel"], p.ctx)).toBe(0);
    expect(await runReadiness(["rel", "--tier", "low"], p.ctx)).toBe(0);
    const passed = readRecord<ReadinessReport>(join(dir(p), "readiness.json"));
    expect(passed.verified.filter((item) => item.id.startsWith("host:")).map((item) => item.id)).toEqual([
      "host:docker build .",
      "host:pnpm e2e --grep 'a b'",
      "host:make db-test",
    ]);
  });
});

describe("readHostCheckRecord", () => {
  it("null when missing; refuses a record of another integration or one not made in a terminal", async () => {
    ({ t: p } = await integrated());
    expect(readHostCheckRecord(recordPath(p), "rel")).toBeNull();
    expect(await runHostCheck(["rel"], p.ctx)).toBe(0);
    const record = readHostCheckRecord(recordPath(p), "rel");
    expect(record?.passed).toBe(true);
    expect(() => readHostCheckRecord(recordPath(p), "other")).toThrow(/not a host check record for other/);
    for (const bad of [
      { ...record, interactive: false },
      { ...record, results: [{ kind: "gate", argv: "docker", command: "docker", exitCode: 0 }] },
      { ...record, results: [{ kind: "gate", argv: [], command: "x", exitCode: 1.5 }] },
      { ...record, passed: "yes" },
      [],
    ]) {
      writeFileSync(recordPath(p), JSON.stringify(bad));
      expect(() => readHostCheckRecord(recordPath(p), "rel")).toThrow(expect.objectContaining({ code: "io" }));
    }
  });
});
