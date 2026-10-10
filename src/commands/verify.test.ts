import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { IntegrationRecord, LaneSpec, VerifyRecord } from "../types";
import { runIntegrate } from "./integrate";
import { runPaths } from "../registry";
import { plantNestedRepo, type NestedRepo } from "../run/testkit";
import { DEFAULT_CONFIG, branchWith, makeProject, simulateShepherds, type LaneRun, type TestProject } from "./testkit";
import { formatGateResult, runVerify } from "./verify";

let p: TestProject;
afterEach(() => p?.dispose());

const GATES = [["pnpm", "test"], ["pnpm", "typecheck"]];
const dir = (t: TestProject): string => join(t.root, ".arbab", "integrations", "rel");
const readRecord = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

/** A stream with one Bash call per command: exit 0, `Exit code N` as an error, or (null) a refusal. */
function bashStream(calls: Array<[string, number | null]>): string {
  const lines: unknown[] = [{ type: "system", subtype: "init", session_id: "s", tools: ["Bash"] }];
  calls.forEach(([command, code], i) => {
    const id = `b${i}`;
    lines.push({ type: "assistant", message: { id: `m${i}`, content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } });
    const content = code === null ? "Permission to use Bash has been denied." : code === 0 ? "ok" : `Exit code ${code}\nfailed`;
    lines.push({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: code !== 0 }] } });
  });
  lines.push({ type: "result", subtype: "success", is_error: false });
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

const finished = (stream: string): (() => LaneRun) => () => ({ state: "finished", endState: "success", stream, summary: { state: "success" } });

/**
 * simulateShepherds, plus what a real shepherd does with a new worktree's mergeBranches: the lane's branch, created at
 * its base, moves to the last commit merged (a fast-forward for a generated lane), and is checked out in the lane's
 * worktree. `during` runs as the worker would, after the worktree exists.
 */
function simulateWithMerges(
  t: TestProject,
  runs: Record<string, (pid: number) => LaneRun | null>,
  before?: () => void,
  during?: (worktree: string) => void,
): void {
  simulateShepherds(t, runs);
  const spawn = t.ctx.spawnShepherd;
  t.ctx.spawnShepherd = (root, lane, mode) => {
    before?.();
    const fresh = t.git(["rev-parse", "--verify", "--quiet", `refs/heads/arbab/${lane}`], t.root).code !== 0;
    const pid = spawn(root, lane, mode);
    const spec = readRecord<LaneSpec>(runPaths(t.runsRoot, lane).laneFile);
    const last = spec.mergeBranches?.at(-1);
    if (fresh && last !== undefined) t.ok(["branch", "-f", `arbab/${lane}`, last]);
    const worktree = join(t.worktreeRoot, lane);
    if (!existsSync(worktree)) t.ok(["worktree", "add", "-q", worktree, `arbab/${lane}`]);
    during?.(worktree);
    return pid;
  };
}

async function integrated(config: Record<string, unknown> = {}, manifest = false): Promise<TestProject> {
  const t = makeProject({ config: { ...DEFAULT_CONFIG, gates: GATES, ...config } });
  branchWith(t, "arbab/a", manifest ? "package.json" : "a.txt", "a\n");
  expect(await runIntegrate(["rel", "--lanes", "a"], t.ctx)).toBe(0);
  t.out.length = 0;
  return t;
}

describe("formatGateResult", () => {
  it("shows the exit code, or missing", () => {
    expect(formatGateResult({ kind: "gate", argv: ["pnpm", "test"], command: "pnpm test", exitCode: 0 })).toBe("exit 0    gate   pnpm test");
    expect(formatGateResult({ kind: "smoke", argv: ["x"], command: "x", exitCode: null })).toBe("missing   smoke  x");
  });
});

describe("runVerify", () => {
  it("launches the verify lane on the integration head, reads exit codes from its stream and writes verify.json", async () => {
    p = await integrated();
    simulateWithMerges(p, { "rel-verify": finished(bashStream([["pnpm test", 0], ["pnpm typecheck", 0]])) });
    expect(await runVerify(["rel"], p.ctx)).toBe(0);

    const integration = readRecord<IntegrationRecord>(join(dir(p), "integration.json"));
    const record = readRecord<VerifyRecord>(join(dir(p), "verify.json"));
    expect(record).toMatchObject({ name: "rel", lane: "rel-verify", attempt: 1, headSha: integration.headSha, passed: true });
    expect(record.results.map((r) => [r.command, r.exitCode])).toEqual([
      ["pnpm test", 0],
      ["pnpm typecheck", 0],
    ]);
    expect(p.stdout()).toBe(
      `exit 0    gate   pnpm test\nexit 0    gate   pnpm typecheck\nverify rel: passed at ${integration.headSha} (lane rel-verify success)\n`,
    );
    // The generated lane: a probe allowed exactly the gate commands, whose brief names them. No manifest changed, so it
    // installs on the integration's base commit and the recorded head is merged on top, never integrate/rel by name.
    const lane = readRecord<LaneSpec>(join(dir(p), "lanes", "rel-verify.json"));
    expect(lane).toMatchObject({
      name: "rel-verify",
      role: "probe",
      tools: ["Read", "Bash"],
      base: integration.baseSha,
      mergeBranches: [integration.headSha],
      allow: ["Bash(pnpm test)", "Bash(pnpm typecheck)"],
    });
    expect(integration.baseSha).not.toBe(integration.headSha);
    expect(lane.brief).toBe(".arbab/integrations/rel/lanes/rel-verify.md");
    expect(readFileSync(join(p.root, lane.brief), "utf8")).toContain("1. Run `pnpm test`");
    expect(p.spawned.map((s) => s.lane)).toEqual(["rel-verify"]);
  });

  it("installs on the head a human confirmed when manifests changed, and merges the later head on top", async () => {
    p = await integrated({}, true);
    const confirmed = readRecord<IntegrationRecord>(join(dir(p), "integration.json")).headSha;
    expect(await runIntegrate(["rel", "--deps-installed", confirmed], p.ctx)).toBe(0);
    branchWith(p, "arbab/b", "b.txt", "b\n");
    expect(await runIntegrate(["rel", "--lanes", "b"], p.ctx)).toBe(0);
    const integration = readRecord<IntegrationRecord>(join(dir(p), "integration.json"));
    expect(integration).toMatchObject({ manifests: ["package.json"], depsConfirmedAt: confirmed });
    expect(integration.headSha).not.toBe(confirmed);

    simulateWithMerges(p, { "rel-verify": finished(bashStream([["pnpm test", 0], ["pnpm typecheck", 0]])) });
    expect(await runVerify(["rel"], p.ctx)).toBe(0);
    expect(readRecord<LaneSpec>(join(dir(p), "lanes", "rel-verify.json"))).toMatchObject({ base: confirmed, mergeBranches: [integration.headSha] });
    expect(p.ok(["rev-parse", "arbab/rel-verify"]).trim()).toBe(integration.headSha);
  });

  it("checks the recorded head even when integrate/rel moves while the lane waits to start", async () => {
    p = await integrated();
    const integration = readRecord<IntegrationRecord>(join(dir(p), "integration.json"));
    // Another integrate (here a commit in the integration worktree) moves the branch after the lane file is written.
    let moved = false;
    simulateWithMerges(p, { "rel-verify": finished(bashStream([["pnpm test", 0], ["pnpm typecheck", 0]])) }, () => {
      p.ok(["commit", "-q", "--allow-empty", "-m", "moved on"], integration.worktree);
      moved = true;
    });
    expect(await runVerify(["rel"], p.ctx)).toBe(0);
    expect(moved).toBe(true);
    expect(p.ok(["rev-parse", "integrate/rel"]).trim()).not.toBe(integration.headSha);
    expect(p.ok(["rev-parse", "arbab/rel-verify"]).trim()).toBe(integration.headSha);
    expect(readRecord<VerifyRecord>(join(dir(p), "verify.json"))).toMatchObject({ headSha: integration.headSha, passed: true });
    expect(readFileSync(join(dir(p), "lanes", "rel-verify.json"), "utf8")).not.toContain("integrate/");
  });

  it("records a run on another commit than the integration head as failed, and exits 1", async () => {
    p = await integrated();
    // A lane whose branch did not end at the head (a merge that was not a fast-forward, say) checked other code.
    simulateShepherds(p, { "rel-verify": finished(bashStream([["pnpm test", 0], ["pnpm typecheck", 0]])) });
    expect(await runVerify(["rel"], p.ctx)).toBe(1);
    const integration = readRecord<IntegrationRecord>(join(dir(p), "integration.json"));
    const record = readRecord<VerifyRecord>(join(dir(p), "verify.json"));
    expect(record).toMatchObject({ headSha: integration.headSha, passed: false });
    expect(record.reason).toMatch(new RegExp(`^rel-verify ran on [0-9a-f]{40}, not on the integration head ${integration.headSha}; run arbab verify rel again`));
    expect(record.results.every((r) => r.exitCode === 0)).toBe(true);
    expect(p.stdout()).toMatch(/verify rel: failed at [0-9a-f]{40} \(lane rel-verify success\): rel-verify ran on /);
  });

  it("fails when the lane leaves changes in its worktree, even though every gate passed", async () => {
    p = await integrated();
    // The worker edited a tracked file and added one; the gates may have run on that tree instead of the head.
    simulateWithMerges(p, { "rel-verify": finished(bashStream([["pnpm test", 0], ["pnpm typecheck", 0]])) }, undefined, (worktree) => {
      writeFileSync(join(worktree, "a.txt"), "changed\n");
      writeFileSync(join(worktree, "new.txt"), "new\n");
    });
    expect(await runVerify(["rel", "--json"], p.ctx)).toBe(1);
    const out = JSON.parse(p.stdout()) as { verify: VerifyRecord };
    expect(out.verify.passed).toBe(false);
    expect(out.verify.reason).toBe(`the worktree ${join(p.worktreeRoot, "rel-verify")} has changes after the run: M a.txt, ?? new.txt`);
    expect(readRecord<VerifyRecord>(join(dir(p), "verify.json"))).toEqual(out.verify);
  });

  it("fails on a nested repository the lane staged, without running anything of it", async () => {
    p = await integrated();
    let nested: NestedRepo | undefined;
    simulateWithMerges(p, { "rel-verify": finished(bashStream([["pnpm test", 0], ["pnpm typecheck", 0]])) }, undefined, (worktree) => {
      nested = plantNestedRepo(p.git, worktree, "sub", p.dir);
      p.ok(["add", "sub"], worktree);
      nested.reset();
    });
    expect(await runVerify(["rel"], p.ctx)).toBe(1);
    const worktree = join(p.worktreeRoot, "rel-verify");
    expect(readRecord<VerifyRecord>(join(dir(p), "verify.json")).reason).toBe(`the worktree ${worktree} has changes after the run: ?? sub/`);
    expect(nested?.ran()).toBe("");
    // The check it replaced, a plain status, runs the lane's commands on the host.
    p.ok(["status", "--porcelain"], worktree);
    expect(nested?.ran()).toMatch(/clean/);
  });

  it("fails when the verify worktree's git dir does not verify", async () => {
    p = await integrated();
    // A worker-written .git pointer that leads elsewhere: git would report on another tree.
    simulateWithMerges(p, { "rel-verify": finished(bashStream([["pnpm test", 0], ["pnpm typecheck", 0]])) }, undefined, (worktree) => {
      writeFileSync(join(worktree, ".git"), `gitdir: ${join(p.root, ".git")}\n`);
    });
    expect(await runVerify(["rel"], p.ctx)).toBe(1);
    const record = readRecord<VerifyRecord>(join(dir(p), "verify.json"));
    expect(record.passed).toBe(false);
    expect(record.reason).toMatch(/^the worktree .*rel-verify failed verification: git dir .* is not under /);
  });

  it("fails on a non-zero gate, a missing call and a smoke failure, and --json reports the record", async () => {
    p = await integrated({ verify: { smoke: ["node", "scripts/smoke.mjs"] } });
    simulateWithMerges(p, { "rel-verify": finished(bashStream([["pnpm test", 2], ["node scripts/smoke.mjs", 1]])) });
    expect(await runVerify(["rel", "--json"], p.ctx)).toBe(1);
    const out = JSON.parse(p.stdout()) as { timedOut: boolean; endState: string; verify: VerifyRecord };
    expect(out.timedOut).toBe(false);
    expect(out.endState).toBe("success");
    expect(out.verify.passed).toBe(false);
    expect(out.verify.results.map((r) => [r.kind, r.exitCode])).toEqual([
      ["gate", 2],
      ["gate", null],
      ["smoke", 1],
    ]);
  });

  it("starts a second verify from the new head, not the old lane's worktree", async () => {
    p = await integrated();
    simulateWithMerges(p, { "rel-verify": finished(bashStream([["pnpm test", 0], ["pnpm typecheck", 0]])) });
    expect(await runVerify(["rel"], p.ctx)).toBe(0);
    const first = p.ok(["rev-parse", "arbab/rel-verify"]).trim();

    branchWith(p, "arbab/b", "b.txt", "b\n");
    expect(await runIntegrate(["rel", "--lanes", "b"], p.ctx)).toBe(0);
    const head = readRecord<IntegrationRecord>(join(dir(p), "integration.json")).headSha;
    expect(await runVerify(["rel"], p.ctx)).toBe(0);
    expect(p.ok(["rev-parse", "arbab/rel-verify"]).trim()).toBe(head);
    expect(head).not.toBe(first);
    expect(readRecord<VerifyRecord>(join(dir(p), "verify.json"))).toMatchObject({ headSha: head, attempt: 2 });
  });

  it("refuses while a manifest change is unconfirmed, launching nothing", async () => {
    p = await integrated({}, true);
    simulateShepherds(p, {});
    await expect(runVerify(["rel"], p.ctx)).rejects.toMatchObject({
      code: "usage",
      message: expect.stringMatching(/a changed package\.json: .*arbab integrate rel --deps-installed [0-9a-f]{40}$/),
    });
    expect(p.spawned).toEqual([]);
    expect(existsSync(join(dir(p), "verify.json"))).toBe(false);
  });

  it("refuses without configured gates, and before the first integrate", async () => {
    p = await integrated({ gates: [] });
    await expect(runVerify(["rel"], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/no gates/) });
    p.dispose();
    p = makeProject({ config: { ...DEFAULT_CONFIG, gates: GATES } });
    await expect(runVerify(["rel"], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/does not exist/) });
  });

  it("refuses when the integration branch moved since integrate", async () => {
    p = await integrated();
    const worktree = readRecord<IntegrationRecord>(join(dir(p), "integration.json")).worktree;
    p.ok(["commit", "-q", "--allow-empty", "-m", "by hand"], worktree);
    await expect(runVerify(["rel"], p.ctx)).rejects.toThrow(/integration\.json records/);
  });

  it("exits 3 when the lane does not finish in time, writing nothing", async () => {
    p = await integrated();
    simulateShepherds(p, { "rel-verify": () => ({ state: "running" }) });
    expect(await runVerify(["rel", "--timeout-min", "1"], p.ctx)).toBe(3);
    expect(p.stderr()).toContain("rel-verify did not finish in time");
    expect(existsSync(join(dir(p), "verify.json"))).toBe(false);
  });

  it("records every command as missing when the lane failed before its first attempt", async () => {
    p = await integrated();
    // Setup failed before the merge (the install, say): the branch stays at its base, and nothing ran there.
    simulateShepherds(p, { "rel-verify": () => ({ state: "finished", endState: "failed" }) });
    expect(await runVerify(["rel"], p.ctx)).toBe(1);
    const record = readRecord<VerifyRecord>(join(dir(p), "verify.json"));
    expect(record.attempt).toBeNull();
    expect(record.results.every((r) => r.exitCode === null)).toBe(true);
    expect(p.stdout()).toContain("(lane rel-verify failed)");
  });
});
