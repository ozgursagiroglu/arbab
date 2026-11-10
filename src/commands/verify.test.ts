import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseBriefSource } from "../brief/parse";
import { checkCommandLine, checkScriptPath, formatFailureLine } from "../check/command";
import { loadLane } from "../config";
import type { CheckFailure, IntegrationRecord, LaneSpec, VerifyRecord, WaiterEntry } from "../types";
import { isValidName } from "../util/names";
import { runIntegrate } from "./integrate";
import { LAUNCH_POLL_MS } from "./launch";
import { lintLane, resolveGitCommonDir } from "./lint";
import { openProject } from "./project";
import { listWaiters, runPaths } from "../registry";
import { plantNestedRepo, type NestedRepo } from "../run/testkit";
import { readVerifyRecord } from "./records";
import { CLI_PID, DEFAULT_CONFIG, branchWith, makeProject, simulateShepherds, writeLaneRun, type LaneRun, type TestProject } from "./testkit";
import { formatGateResult, nextFixNumber, refId, refSlug, runVerify } from "./verify";

const SESSION = "aaaaaaaa-1111-2222-3333-444444444444";

let p: TestProject;
afterEach(() => p?.dispose());

const GATES = [["pnpm", "test"], ["pnpm", "typecheck"]];
const dir = (t: TestProject): string => join(t.root, ".arbab", "integrations", "rel");
const readRecord = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

/** The line verify lane `lane` runs for check `name` (gate-<i>, smoke) of the current project. */
const checkLine = (name: string, lane = "rel-verify"): string => checkCommandLine(checkScriptPath(p.runsRoot, lane), name);

/**
 * A stream with one Bash call per check, by name: exit 0, `Exit code N` as an error (with `output` after it), or
 * (null) a refusal.
 */
function bashStream(calls: Array<[string, number | null, string?]>, lane = "rel-verify"): string {
  const lines: unknown[] = [{ type: "system", subtype: "init", session_id: "s", tools: ["Bash"] }];
  calls.forEach(([check, code, output], i) => {
    const id = `b${i}`;
    const command = checkLine(check, lane);
    lines.push({ type: "assistant", message: { id: `m${i}`, content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } });
    const content = code === null ? "Permission to use Bash has been denied." : code === 0 ? "ok" : `Exit code ${code}\n${output ?? "failed"}`;
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
    simulateWithMerges(p, { "rel-verify": finished(bashStream([["gate-1", 0], ["gate-2", 0]])) });
    expect(await runVerify(["rel"], p.ctx)).toBe(0);

    const integration = readRecord<IntegrationRecord>(join(dir(p), "integration.json"));
    const record = readRecord<VerifyRecord>(join(dir(p), "verify.json"));
    expect(record).toMatchObject({ name: "rel", lane: "rel-verify", attempt: 1, headSha: integration.headSha, passed: true });
    // The gates' own command lines, which readiness and land show, not the check lines the lane ran.
    expect(record.results.map((r) => [r.command, r.exitCode])).toEqual([
      ["pnpm test", 0],
      ["pnpm typecheck", 0],
    ]);
    expect(record).not.toHaveProperty("failures");
    expect(p.stdout()).toBe(
      `exit 0    gate   pnpm test\nexit 0    gate   pnpm typecheck\nverify rel: passed at ${integration.headSha} (lane rel-verify success)\n`,
    );
    // The generated lane: a probe allowed exactly its checks' lines, whose brief names them, with the gates as its
    // checks. No manifest changed, so it installs on the integration's base commit and the recorded head is merged on
    // top, never integrate/rel by name.
    const lane = readRecord<LaneSpec>(join(dir(p), "lanes", "rel-verify.json"));
    expect(lane).toMatchObject({
      name: "rel-verify",
      role: "probe",
      tools: ["Read", "Bash"],
      base: integration.baseSha,
      mergeBranches: [integration.headSha],
      allow: [`Bash(${checkLine("gate-1")})`, `Bash(${checkLine("gate-2")})`],
      checks: { "gate-1": ["pnpm", "test"], "gate-2": ["pnpm", "typecheck"] },
    });
    expect(checkLine("gate-1")).toBe(`node ${join(p.runsRoot, "rel-verify", "bin", "arbab-check.mjs")} gate-1`);
    expect(integration.baseSha).not.toBe(integration.headSha);
    expect(lane.brief).toBe(".arbab/integrations/rel/lanes/rel-verify.md");
    expect(readFileSync(join(p.root, lane.brief), "utf8")).toContain(`1. Run \`${checkLine("gate-1")}\`\n2. Run \`${checkLine("gate-2")}\``);
    expect(existsSync(join(dir(p), "fix"))).toBe(false);
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

    const ran: string[] = [];
    simulateWithMerges(p, { "rel-verify": finished(bashStream([["gate-1", 0], ["gate-2", 0]])) }, undefined, (worktree) => {
      ran.push(p.ok(["rev-parse", "HEAD"], worktree).trim());
    });
    expect(await runVerify(["rel"], p.ctx)).toBe(0);
    expect(readRecord<LaneSpec>(join(dir(p), "lanes", "rel-verify.json"))).toMatchObject({ base: confirmed, mergeBranches: [integration.headSha] });
    expect(ran).toEqual([integration.headSha]);
  });

  it("checks the recorded head even when integrate/rel moves while the lane waits to start", async () => {
    p = await integrated();
    const integration = readRecord<IntegrationRecord>(join(dir(p), "integration.json"));
    // Another integrate (here a commit in the integration worktree) moves the branch after the lane file is written.
    let moved = false;
    const ran: string[] = [];
    simulateWithMerges(
      p,
      { "rel-verify": finished(bashStream([["gate-1", 0], ["gate-2", 0]])) },
      () => {
        p.ok(["commit", "-q", "--allow-empty", "-m", "moved on"], integration.worktree);
        moved = true;
      },
      (worktree) => ran.push(p.ok(["rev-parse", "HEAD"], worktree).trim()),
    );
    expect(await runVerify(["rel"], p.ctx)).toBe(0);
    expect(moved).toBe(true);
    expect(p.ok(["rev-parse", "integrate/rel"]).trim()).not.toBe(integration.headSha);
    expect(ran).toEqual([integration.headSha]);
    expect(readRecord<VerifyRecord>(join(dir(p), "verify.json"))).toMatchObject({ headSha: integration.headSha, passed: true });
    expect(readFileSync(join(dir(p), "lanes", "rel-verify.json"), "utf8")).not.toContain("integrate/");
  });

  it("records a run on another commit than the integration head as failed, and exits 1", async () => {
    p = await integrated();
    // A lane whose branch did not end at the head (a merge that was not a fast-forward, say) checked other code.
    simulateShepherds(p, { "rel-verify": finished(bashStream([["gate-1", 0], ["gate-2", 0]])) });
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
    simulateWithMerges(p, { "rel-verify": finished(bashStream([["gate-1", 0], ["gate-2", 0]])) }, undefined, (worktree) => {
      writeFileSync(join(worktree, "a.txt"), "changed\n");
      writeFileSync(join(worktree, "new.txt"), "new\n");
    });
    expect(await runVerify(["rel", "--json"], p.ctx)).toBe(1);
    const out = JSON.parse(p.stdout()) as { verify: VerifyRecord };
    expect(out.verify.passed).toBe(false);
    const worktree = join(p.worktreeRoot, "rel-verify");
    expect(out.verify.reason).toBe(`the worktree ${worktree} has changes after the run: M a.txt, ?? new.txt`);
    expect(readRecord<VerifyRecord>(join(dir(p), "verify.json"))).toEqual(out.verify);
    // The record points at that tree, so it stays to be looked at, its branch too.
    expect(p.stderr()).toContain(`arbab verify: kept ${worktree} for inspection: ${out.verify.reason ?? ""}\n`);
    expect(readFileSync(join(worktree, "new.txt"), "utf8")).toBe("new\n");
    expect(p.git(["rev-parse", "--verify", "--quiet", "refs/heads/arbab/rel-verify"], p.root).code).toBe(0);
    expect(readRecord<{ settled: boolean }>(join(dir(p), "lanes", "rel-verify.run.json")).settled).toBe(true);

    // The next verify resets it and runs afresh.
    simulateWithMerges(p, { "rel-verify": finished(bashStream([["gate-1", 0], ["gate-2", 0]])) });
    p.out.length = 0;
    expect(await runVerify(["rel"], p.ctx)).toBe(0);
    expect(existsSync(worktree)).toBe(false);
  });

  it("fails on a nested repository the lane staged, without running anything of it", async () => {
    p = await integrated();
    let nested: NestedRepo | undefined;
    let plain = "";
    simulateWithMerges(p, { "rel-verify": finished(bashStream([["gate-1", 0], ["gate-2", 0]])) }, undefined, (worktree) => {
      nested = plantNestedRepo(p.git, worktree, "sub", p.dir);
      p.ok(["add", "sub"], worktree);
      // The check it replaced, a plain status, runs the lane's commands on the host.
      nested.reset();
      p.ok(["status", "--porcelain"], worktree);
      plain = nested.ran();
      nested.reset();
    });
    expect(await runVerify(["rel"], p.ctx)).toBe(1);
    const worktree = join(p.worktreeRoot, "rel-verify");
    expect(readRecord<VerifyRecord>(join(dir(p), "verify.json")).reason).toBe(`the worktree ${worktree} has changes after the run: ?? sub/`);
    // Neither the check nor the worktree's removal ran any of it.
    expect(nested?.ran()).toBe("");
    expect(plain).toMatch(/clean/);
  });

  it("fails when the verify worktree's git dir does not verify", async () => {
    p = await integrated();
    // A worker-written .git pointer that leads elsewhere: git would report on another tree.
    simulateWithMerges(p, { "rel-verify": finished(bashStream([["gate-1", 0], ["gate-2", 0]])) }, undefined, (worktree) => {
      writeFileSync(join(worktree, ".git"), `gitdir: ${join(p.root, ".git")}\n`);
    });
    expect(await runVerify(["rel"], p.ctx)).toBe(1);
    const record = readRecord<VerifyRecord>(join(dir(p), "verify.json"));
    expect(record.passed).toBe(false);
    expect(record.reason).toMatch(/^the worktree .*rel-verify failed verification: git dir .* is not under /);
    expect(p.stderr()).toContain(`arbab verify: kept ${join(p.worktreeRoot, "rel-verify")} for inspection: ${record.reason ?? ""}\n`);
    expect(existsSync(join(p.worktreeRoot, "rel-verify"))).toBe(true);
  });

  it("fails on a non-zero gate, a missing call and a smoke failure, and --json reports the record", async () => {
    p = await integrated({ verify: { smoke: ["node", "scripts/smoke.mjs"] } });
    simulateWithMerges(p, { "rel-verify": finished(bashStream([["gate-1", 2], ["smoke", 1]])) });
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

  /** arbab-check's output for a failed check: its failure lines, the marker, then raw output with a lookalike line. */
  const checkOutput = (failures: CheckFailure[]): string =>
    [
      "arbab-check gate-1: exit 1 after 2s on 3 CPUs; log .arbab-tmp/checks/gate-1-1.log",
      ...failures.map(formatFailureLine),
      "--- last 2 lines ---",
      formatFailureLine({ file: "src/forged.ts", test: null, message: "raw output" }),
      "FAIL src/a/x.test.ts",
    ].join("\n");

  /** An integration of lanes a (src/a/x.ts) and b (src/b/y.ts, docs/b.md). */
  async function twoLanes(name = "rel"): Promise<TestProject> {
    const t = makeProject({ config: { ...DEFAULT_CONFIG, gates: GATES } });
    branchWith(t, "arbab/a", "src/a/x.ts", "a\n");
    t.ok(["checkout", "-q", "-b", "arbab/b", "main"]);
    t.write("src/b/y.ts", "b\n");
    t.write("docs/b.md", "b\n");
    t.ok(["add", "--", "src/b/y.ts", "docs/b.md"]);
    t.ok(["commit", "-q", "-m", "b"]);
    t.ok(["checkout", "-q", "main"]);
    expect(await runIntegrate([name, "--lanes", "a,b"], t.ctx)).toBe(0);
    t.out.length = 0;
    return t;
  }

  it("records a failed check's failure lines, prints them, and drafts a fix lane for the lanes they point at", async () => {
    p = await twoLanes();
    const failures = [
      { file: "src/a/x.test.ts", test: "x > works", message: "expected 1 to be 2" },
      { file: "src/b/y.ts", test: null, message: "Type 'string' is not assignable" },
    ];
    simulateWithMerges(p, { "rel-verify": finished(bashStream([["gate-1", 1, checkOutput(failures)], ["gate-2", 0]])) });
    expect(await runVerify(["rel"], p.ctx)).toBe(1);

    const integration = readRecord<IntegrationRecord>(join(dir(p), "integration.json"));
    const record = readRecord<VerifyRecord>(join(dir(p), "verify.json"));
    // Only the lines before the marker: the raw output's lookalike is not a failure.
    expect(record.failures).toEqual(failures.map((f) => ({ result: 0, ...f })));
    expect(p.stdout()).toBe(
      "exit 1    gate   pnpm test\nexit 0    gate   pnpm typecheck\n" +
        failures.map((f) => formatFailureLine(f) + "\n").join("") +
        `verify rel: failed at ${integration.headSha} (lane rel-verify success)\n`,
    );

    const json = ".arbab/integrations/rel/fix/fix-1.json";
    expect(p.stderr()).toContain(`arbab verify: fix draft ${json}; review it, then arbab launch ${json}\n`);
    const lane = loadLane(p.root, json);
    // verify.json is an input: the shepherd copies it into the worktree, where the worker may read it.
    expect(lane).toEqual({
      name: "rel-fix-1",
      role: "implementer",
      brief: ".arbab/integrations/rel/fix/fix-1.md",
      base: "integrate/rel",
      inputs: [join(dir(p), "verify.json")],
    });
    const project = openProject(p.ctx);
    expect(lintLane(project, json, resolveGitCommonDir(p.ctx.git, p.root)).issues.filter((i) => i.severity === "error")).toEqual([]);
    const brief = parseBriefSource(readFileSync(join(p.root, lane.brief), "utf8"));
    expect(brief.sections.Task).toContain(`at its head \`${integration.headSha}\``);
    expect(brief.sections.Task).toContain("- gate 1, `pnpm test`, exited 1");
    // a by its directory (src/a), b by the file itself; b's other file is in its scope too.
    expect(brief.sections.Facts).toContain("- Lane `a` may explain 1 of the failures; it changed `src/a/x.ts`.");
    expect(brief.sections.Facts).toContain("- Lane `b` may explain 1 of the failures; it changed `docs/b.md`, `src/b/y.ts`.");
    expect(brief.sections.Scope).toBe(["- `docs/b.md`", "- `src/a/x.test.ts`", "- `src/a/x.ts`", "- `src/b/y.ts`"].join("\n"));
    expect(brief.sections.Acceptance).toContain("- [ ] The integration's verify will run gate 1 again (pnpm test).");
    expect(p.spawned.map((s) => s.lane)).toEqual(["rel-verify"]);

    // The next failed verify drafts the next number, leaving the first as it was.
    const first = readFileSync(join(p.root, json), "utf8");
    simulateWithMerges(p, { "rel-verify": finished(bashStream([["gate-1", 0], ["gate-2", 2]])) });
    p.out.length = 0;
    expect(await runVerify(["rel", "--json"], p.ctx)).toBe(1);
    expect((JSON.parse(p.stdout()) as { verify: VerifyRecord }).verify).not.toHaveProperty("failures");
    expect(p.stderr()).toContain("arbab verify: fix draft .arbab/integrations/rel/fix/fix-2.json; review it");
    expect(readFileSync(join(p.root, json), "utf8")).toBe(first);
    const second = parseBriefSource(readFileSync(join(dir(p), "fix", "fix-2.md"), "utf8"));
    expect(second.sections.Task).toContain("printed no failure lines");
    expect(second.sections.Acceptance).toContain("- [ ] The integration's verify will run gate 2 again (pnpm typecheck).");
  });

  it("prints failures through formatFailureLine only, and drafts a Scope of plain relative paths and the record's input copy", async () => {
    p = await twoLanes();
    // Worker-written failure lines, raw: terminal escapes, and files outside the tree or with backticks.
    const raw = [
      "arbab-check failure: src/a/x.test.ts > works :: \u001b]0;owned\u0007\u001b[2JMARK-1",
      "arbab-check failure: /etc/passwd :: MARK-2",
      "arbab-check failure: ../outside.ts :: MARK-3",
      "arbab-check failure: src/a`b`.ts :: MARK-4 \u001b[31mred",
    ];
    const output = ["arbab-check gate-1: exit 1 after 2s on 3 CPUs; log .arbab-tmp/checks/gate-1-1.log", ...raw, "--- last 0 lines ---"].join("\n");
    simulateWithMerges(p, { "rel-verify": finished(bashStream([["gate-1", 1, output], ["gate-2", 0]])) });
    expect(await runVerify(["rel"], p.ctx)).toBe(1);

    const integration = readRecord<IntegrationRecord>(join(dir(p), "integration.json"));
    const record = readRecord<VerifyRecord>(join(dir(p), "verify.json"));
    const failures = record.failures ?? [];
    expect(failures.map((f) => f.file)).toEqual(["src/a/x.test.ts", "/etc/passwd", "../outside.ts", "src/a`b`.ts"]);
    expect(p.stdout()).toBe(
      "exit 1    gate   pnpm test\nexit 0    gate   pnpm typecheck\n" +
        failures.map((f) => formatFailureLine(f) + "\n").join("") +
        `verify rel: failed at ${integration.headSha} (lane rel-verify success)\n`,
    );
    // stderr says where the draft is, and nothing of the failures.
    expect(p.stderr()).not.toMatch(/MARK|passwd|outside|\u001b/);

    const brief = parseBriefSource(readFileSync(join(dir(p), "fix", "fix-1.md"), "utf8"));
    expect(brief.sections.Scope).toBe(
      ["- `docs/b.md`", "- `src/a/x.test.ts`", "- `src/a/x.ts`", "- `src/b/y.ts`", "", "3 named files are not plain relative paths and are left out of Scope."].join("\n"),
    );
    expect(brief.sections.Task).toContain('"file": "/etc/passwd"');
    expect(brief.sections.Facts).toContain("- The verify record, with every result and failure: `.arbab-tmp/inputs/verify.json`.");
    // The check log was in the verify worktree, which is gone.
    expect(existsSync(join(p.worktreeRoot, "rel-verify"))).toBe(false);
    const text = Object.values(brief.sections).join("\n");
    expect(text).not.toMatch(/\blogs?\b|\.arbab-tmp\/checks/i);
    expect(text).not.toContain(join(dir(p), "verify.json"));
  });

  it("prints at most 10 failure lines, and --json carries them all", async () => {
    p = await twoLanes();
    const failures = Array.from({ length: 12 }, (_, i) => ({ file: `src/a/t${i}.test.ts`, test: null, message: `boom ${i}` }));
    const stream = bashStream([["gate-1", 1, checkOutput(failures)], ["gate-2", 0]]);
    simulateWithMerges(p, { "rel-verify": finished(stream) });
    expect(await runVerify(["rel"], p.ctx)).toBe(1);
    const printed = p.stdout().split("\n").filter((l) => l.startsWith("arbab-check failure: "));
    expect(printed).toEqual(failures.slice(0, 10).map(formatFailureLine));
    expect(p.stdout()).toContain(`and 2 more failures in ${join(dir(p), "verify.json")}\n`);

    simulateWithMerges(p, { "rel-verify": finished(stream) });
    p.out.length = 0;
    expect(await runVerify(["rel", "--json"], p.ctx)).toBe(1);
    expect((JSON.parse(p.stdout()) as { verify: VerifyRecord }).verify.failures).toHaveLength(12);
  });

  it("drafts no fix lane when its name would be too long, and says so", async () => {
    // 41 characters is the longest integration name verify takes; -fix-100 makes 49.
    const name = "r".repeat(41);
    p = await twoLanes(name);
    const fixDir = join(p.root, ".arbab", "integrations", name, "fix");
    mkdirSync(fixDir, { recursive: true });
    writeFileSync(join(fixDir, "fix-99.json"), "{}\n");
    simulateWithMerges(p, { [`${name}-verify`]: finished(bashStream([["gate-1", 1], ["gate-2", 0]], `${name}-verify`)) });
    expect(await runVerify([name], p.ctx)).toBe(1);
    expect(p.stderr()).toContain(`arbab verify: no fix draft: ${name}-fix-100 is not a valid lane name (at most 48 characters)`);
    expect(existsSync(join(fixDir, "fix-100.json"))).toBe(false);
    expect(existsSync(join(fixDir, "fix-100.md"))).toBe(false);
  });

  it("drafts no fix lane when every command passed or none ran", async () => {
    p = await integrated();
    simulateWithMerges(p, { "rel-verify": finished(bashStream([["gate-1", null], ["gate-2", null]])) });
    expect(await runVerify(["rel"], p.ctx)).toBe(1);
    expect(existsSync(join(dir(p), "fix"))).toBe(false);
    expect(p.stderr()).not.toContain("fix draft");
  });

  it("starts a second verify from the new head, not the old lane's worktree", async () => {
    p = await integrated();
    const ran: string[] = [];
    simulateWithMerges(p, { "rel-verify": finished(bashStream([["gate-1", 0], ["gate-2", 0]])) }, undefined, (worktree) => {
      ran.push(p.ok(["rev-parse", "HEAD"], worktree).trim());
    });
    expect(await runVerify(["rel"], p.ctx)).toBe(0);

    branchWith(p, "arbab/b", "b.txt", "b\n");
    expect(await runIntegrate(["rel", "--lanes", "b"], p.ctx)).toBe(0);
    const head = readRecord<IntegrationRecord>(join(dir(p), "integration.json")).headSha;
    expect(await runVerify(["rel"], p.ctx)).toBe(0);
    expect(ran).toHaveLength(2);
    expect(ran[1]).toBe(head);
    expect(head).not.toBe(ran[0]);
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

  it("exits 3 when the lane does not finish in time, writing nothing and keeping its worktree", async () => {
    p = await integrated();
    simulateWithMerges(p, { "rel-verify": () => ({ state: "running" }) });
    expect(await runVerify(["rel", "--timeout-min", "1"], p.ctx)).toBe(3);
    expect(p.stderr()).toContain("rel-verify did not finish in time");
    expect(existsSync(join(dir(p), "verify.json"))).toBe(false);
    expect(existsSync(join(dir(p), "fix"))).toBe(false);
    // The next verify adopts it from there.
    expect(existsSync(join(p.worktreeRoot, "rel-verify"))).toBe(true);
    expect(p.git(["rev-parse", "--verify", "--quiet", "refs/heads/arbab/rel-verify"], p.root).code).toBe(0);
  });

  it("removes the verify lane's worktree and branch once verify.json is written, keeping what it measured", async () => {
    p = await integrated();
    simulateWithMerges(p, { "rel-verify": finished(bashStream([["gate-1", 0], ["gate-2", 0]])) });
    expect(await runVerify(["rel"], p.ctx)).toBe(0);
    expect(existsSync(join(p.worktreeRoot, "rel-verify"))).toBe(false);
    expect(p.git(["rev-parse", "--verify", "--quiet", "refs/heads/arbab/rel-verify"], p.root).code).not.toBe(0);
    expect(p.ok(["worktree", "list", "--porcelain"])).not.toContain("rel-verify");
    // The run dir, the marker, the run record and the record stay.
    expect(existsSync(join(p.runsRoot, "rel-verify", "attempt-1", "stream.jsonl"))).toBe(true);
    expect(existsSync(join(p.runsRoot, "rel-verify", "generated.json"))).toBe(true);
    expect(readRecord<{ settled: boolean }>(join(dir(p), "lanes", "rel-verify.run.json")).settled).toBe(true);
    expect(readRecord<VerifyRecord>(join(dir(p), "verify.json"))).toMatchObject({ passed: true, attempt: 1 });
    expect(p.stderr()).not.toContain("arbab verify:");

    // A second verify launches the lane afresh, and it works.
    expect(await runVerify(["rel"], p.ctx)).toBe(0);
    expect(p.spawned.map((s) => s.lane)).toEqual(["rel-verify", "rel-verify"]);
    expect(readRecord<VerifyRecord>(join(dir(p), "verify.json"))).toMatchObject({ passed: true, attempt: 2 });
    expect(existsSync(join(p.worktreeRoot, "rel-verify"))).toBe(false);
  });

  it("warns on stderr when the lane's worktree cannot go, and still exits as its record says", async () => {
    p = await integrated();
    // The lane committed: its branch has a commit that is not on integrate/rel, which is never deleted.
    simulateWithMerges(p, { "rel-verify": finished(bashStream([["gate-1", 0], ["gate-2", 0]])) }, undefined, (worktree) => {
      writeFileSync(join(worktree, "work.txt"), "work\n");
      p.ok(["add", "work.txt"], worktree);
      p.ok(["commit", "-q", "-m", "own work"], worktree);
    });
    expect(await runVerify(["rel"], p.ctx)).toBe(1);
    expect(readRecord<VerifyRecord>(join(dir(p), "verify.json")).passed).toBe(false);
    expect(p.stderr()).toContain(
      "arbab verify: could not remove rel-verify's worktree and branch: arbab/rel-verify has commits that are not on integrate/rel, so nothing was removed\n",
    );
    expect(existsSync(join(p.worktreeRoot, "rel-verify", "work.txt"))).toBe(true);
  });

  it("warns, and still exits 0 on a passing record, when a lane borrows the verify worktree", async () => {
    p = await integrated();
    simulateWithMerges(p, { "rel-verify": finished(bashStream([["gate-1", 0], ["gate-2", 0]])) }, undefined, () => {
      writeLaneRun(p.runsRoot, "borrower", { state: "running", shepherdPid: 6001, lane: { name: "borrower", role: "implementer", brief: "lanes/demo.md", worktree: "rel-verify" } });
      p.alive.add(6001);
    });
    expect(await runVerify(["rel", "--json"], p.ctx)).toBe(0);
    expect((JSON.parse(p.stdout()) as { verify: VerifyRecord }).verify.passed).toBe(true);
    expect(p.stderr()).toContain(
      "arbab verify: could not remove rel-verify's worktree and branch: lane borrower works in lane rel-verify's worktree and is running, so nothing was removed",
    );
    expect(existsSync(join(p.worktreeRoot, "rel-verify"))).toBe(true);
  });

  it("is a waiter of its session while it waits for the lane, and no longer once it returns", async () => {
    p = await integrated();
    p.ctx.hostEnv = { CLAUDE_CODE_SESSION_ID: SESSION };
    p.alive.add(CLI_PID);
    simulateShepherds(p, { "rel-verify": () => ({ state: "running" }) });
    const seen: WaiterEntry[][] = [];
    const sleep = p.ctx.sleep;
    p.ctx.sleep = async (ms) => {
      if (ms !== LAUNCH_POLL_MS) seen.push(listWaiters(p.home, p.ctx.alive));
      await sleep(ms);
    };
    expect(await runVerify(["rel", "--timeout-min", "0.1"], p.ctx)).toBe(3);
    expect(seen.length).toBeGreaterThan(0);
    for (const waiters of seen) {
      expect(waiters).toEqual([{ pid: CLI_PID, project: p.root, owner: SESSION, startedAt: expect.any(String), runner: p.ctx.scriptPath }]);
    }
    expect(listWaiters(p.home, p.ctx.alive)).toEqual([]);
  });

  it("after a timeout, takes the lane's results when it finished on the same head, without relaunching it", async () => {
    p = await integrated();
    simulateWithMerges(p, { "rel-verify": () => ({ state: "running" }) });
    expect(await runVerify(["rel", "--timeout-min", "1"], p.ctx)).toBe(3);
    const pid = readRecord<{ shepherdPid: number }>(join(p.runsRoot, "rel-verify", "state.json")).shepherdPid;
    // The lane finishes minutes after verify stopped waiting.
    writeLaneRun(p.runsRoot, "rel-verify", { ...finished(bashStream([["gate-1", 0], ["gate-2", 0]]))(), shepherdPid: pid });
    p.alive.delete(pid);

    expect(await runVerify(["rel"], p.ctx)).toBe(0);
    expect(p.spawned.map((s) => s.lane)).toEqual(["rel-verify"]);
    expect(p.stderr()).toContain("adopted rel-verify");
    const head = readRecord<IntegrationRecord>(join(dir(p), "integration.json")).headSha;
    expect(readRecord<VerifyRecord>(join(dir(p), "verify.json"))).toMatchObject({ headSha: head, attempt: 1, passed: true });
    expect(existsSync(join(p.worktreeRoot, "rel-verify"))).toBe(false);

    // Taken into verify.json: the next verify runs the gates again.
    simulateWithMerges(p, { "rel-verify": finished(bashStream([["gate-1", 0], ["gate-2", 0]])) });
    expect(await runVerify(["rel"], p.ctx)).toBe(0);
    expect(p.spawned.map((s) => s.lane)).toEqual(["rel-verify", "rel-verify"]);
    expect(readRecord<VerifyRecord>(join(dir(p), "verify.json")).attempt).toBe(2);
  });

  it("after a timeout, relaunches a lane that finished on the same head but lost its worktree", async () => {
    p = await integrated();
    simulateWithMerges(p, { "rel-verify": () => ({ state: "running" }) });
    expect(await runVerify(["rel", "--timeout-min", "1"], p.ctx)).toBe(3);
    const pid = readRecord<{ shepherdPid: number }>(join(p.runsRoot, "rel-verify", "state.json")).shepherdPid;
    writeLaneRun(p.runsRoot, "rel-verify", { ...finished(bashStream([["gate-1", 1], ["gate-2", 1]]))(), shepherdPid: pid });
    p.alive.delete(pid);
    p.ok(["worktree", "remove", "--force", join(p.worktreeRoot, "rel-verify")]);

    simulateWithMerges(p, { "rel-verify": finished(bashStream([["gate-1", 0], ["gate-2", 0]])) });
    expect(await runVerify(["rel"], p.ctx)).toBe(0);
    expect(p.spawned.map((s) => s.lane)).toEqual(["rel-verify", "rel-verify"]);
    expect(p.stderr()).not.toContain("adopted");
    expect(readRecord<VerifyRecord>(join(dir(p), "verify.json"))).toMatchObject({ attempt: 2, passed: true });
  });

  it("after a timeout, waits for the lane still running on the same head", async () => {
    p = await integrated();
    simulateWithMerges(p, { "rel-verify": () => ({ state: "running" }) });
    expect(await runVerify(["rel", "--timeout-min", "1"], p.ctx)).toBe(3);
    const pid = readRecord<{ shepherdPid: number }>(join(p.runsRoot, "rel-verify", "state.json")).shepherdPid;
    const sleep = p.ctx.sleep;
    p.ctx.sleep = async (ms) => {
      writeLaneRun(p.runsRoot, "rel-verify", { ...finished(bashStream([["gate-1", 1], ["gate-2", 0]]))(), shepherdPid: pid });
      await sleep(ms);
    };
    expect(await runVerify(["rel"], p.ctx)).toBe(1);
    expect(p.spawned.map((s) => s.lane)).toEqual(["rel-verify"]);
    expect(p.stderr()).toContain("rel-verify still running for this head from an earlier run; waiting");
    expect(readRecord<VerifyRecord>(join(dir(p), "verify.json")).results.map((r) => r.exitCode)).toEqual([1, 0]);
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
    // Nothing ran, so there is nothing for a fix lane to fix.
    expect(existsSync(join(dir(p), "fix"))).toBe(false);
  });
});

describe("nextFixNumber", () => {
  it("is one more than the highest fix-<k>.json, 1 when there is none", () => {
    const tmp = mkdtempSync(join(tmpdir(), "arbab-"));
    try {
      expect(nextFixNumber(join(tmp, "missing"))).toBe(1);
      expect(nextFixNumber(tmp)).toBe(1);
      for (const file of ["fix-1.json", "fix-3.json", "fix-12.md", "fix-0.json", "fix-07.json", "fix-x.json", "other-9.json"]) writeFileSync(join(tmp, file), "{}");
      expect(nextFixNumber(tmp)).toBe(4);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("refSlug", () => {
  it("lowercases, turns every character outside [a-z0-9] into -, and keeps 22", () => {
    expect(refSlug("main")).toBe("main");
    expect(refSlug("Feature/Ünïcode_x.1")).toBe("feature--n-code-x-1");
    expect(refSlug("release/".repeat(6))).toBe("release-release-releas");
    expect(refSlug("release/".repeat(6))).toHaveLength(22);
  });
});

describe("refId", () => {
  it("is ref-<slug>-<the first 6 hex of the branch name's sha1>, a valid lane prefix even at full length", () => {
    expect(refId("main")).toBe(`ref-main-${createHash("sha1").update("main").digest("hex").slice(0, 6)}`);
    expect(refId("main")).toMatch(/^ref-main-[0-9a-f]{6}$/);
    expect(isValidName(`${refId("release/".repeat(20))}-verify`)).toBe(true);
  });

  it("tells apart branches whose slugs collide", () => {
    expect(refSlug("Release/Next")).toBe(refSlug("release_next"));
    expect(refId("Release/Next")).not.toBe(refId("release_next"));
    expect(refId("release/".repeat(6) + "a")).not.toBe(refId("release/".repeat(6) + "b"));
  });
});

describe("runVerify --ref", () => {
  const refDir = (t: TestProject, branch: string): string => join(t.root, ".arbab", "refs", refId(branch));

  it("runs the gates on the branch head with no integration, and writes the record under .arbab/refs", async () => {
    p = makeProject({ config: { ...DEFAULT_CONFIG, gates: GATES } });
    const head = branchWith(p, "Release/Next", "r.txt", "r\n");
    const id = refId("Release/Next");
    simulateWithMerges(p, { [`${id}-verify`]: finished(bashStream([["gate-1", 0], ["gate-2", 0]], `${id}-verify`)) });
    expect(await runVerify(["--ref", "Release/Next"], p.ctx)).toBe(0);

    const lane = readRecord<LaneSpec>(join(refDir(p, "Release/Next"), "lanes", `${id}-verify.json`));
    // The branch head is the base: the same probe, tools and gates as an integration's verify, nothing merged on top.
    expect(lane).toMatchObject({
      name: `${id}-verify`,
      role: "probe",
      tools: ["Read", "Bash"],
      base: head,
      allow: [`Bash(${checkLine("gate-1", `${id}-verify`)})`, `Bash(${checkLine("gate-2", `${id}-verify`)})`],
      checks: { "gate-1": ["pnpm", "test"], "gate-2": ["pnpm", "typecheck"] },
    });
    expect(lane).not.toHaveProperty("mergeBranches");
    expect(lane.brief).toBe(`.arbab/refs/${id}/lanes/${id}-verify.md`);
    const record = readRecord<VerifyRecord>(join(refDir(p, "Release/Next"), "verify.json"));
    expect(record).toMatchObject({ name: "ref:Release/Next", lane: `${id}-verify`, headSha: head, passed: true, attempt: 1 });
    expect(readVerifyRecord(join(refDir(p, "Release/Next"), "verify.json"), "ref:Release/Next")?.passed).toBe(true);
    expect(p.stdout()).toBe(
      `exit 0    gate   pnpm test\nexit 0    gate   pnpm typecheck\nverify ref:Release/Next: passed at ${head} (lane ${id}-verify success)\n`,
    );
    expect(existsSync(join(p.root, ".arbab", "integrations"))).toBe(false);
    // As for an integration: the lane's worktree and branch go, its run dir and run record stay.
    expect(existsSync(join(p.worktreeRoot, `${id}-verify`))).toBe(false);
    expect(p.git(["rev-parse", "--verify", "--quiet", `refs/heads/arbab/${id}-verify`], p.root).code).not.toBe(0);
    expect(existsSync(join(p.runsRoot, `${id}-verify`, "generated.json"))).toBe(true);
    expect(readRecord<{ settled: boolean }>(join(refDir(p, "Release/Next"), "lanes", `${id}-verify.run.json`)).settled).toBe(true);
    expect(p.stderr()).not.toContain("arbab verify:");
  });

  it("records a failed check's failures but drafts no fix lane", async () => {
    p = makeProject({ config: { ...DEFAULT_CONFIG, gates: GATES } });
    const lane = `${refId("main")}-verify`;
    const output = formatFailureLine({ file: "src/a.ts", test: null, message: "boom" });
    simulateWithMerges(p, { [lane]: finished(bashStream([["gate-1", 1, output], ["gate-2", 0]], lane)) });
    expect(await runVerify(["--ref", "main"], p.ctx)).toBe(1);
    expect(readRecord<VerifyRecord>(join(refDir(p, "main"), "verify.json")).failures).toEqual([{ result: 0, file: "src/a.ts", test: null, message: "boom" }]);
    expect(p.stderr()).not.toContain("fix draft");
    expect(existsSync(join(refDir(p, "main"), "fix"))).toBe(false);
    expect(existsSync(join(p.root, ".arbab", "integrations"))).toBe(false);
  });

  it("keeps the lane's worktree when it does not finish in time", async () => {
    p = makeProject({ config: { ...DEFAULT_CONFIG, gates: GATES } });
    const lane = `${refId("main")}-verify`;
    simulateWithMerges(p, { [lane]: () => ({ state: "running" }) });
    expect(await runVerify(["--ref", "main", "--timeout-min", "1"], p.ctx)).toBe(3);
    expect(existsSync(join(p.worktreeRoot, lane))).toBe(true);
    expect(existsSync(join(refDir(p, "main"), "verify.json"))).toBe(false);
  });

  it("gives two branches whose slugs collide their own lane and record", async () => {
    p = makeProject({ config: { ...DEFAULT_CONFIG, gates: GATES } });
    const upper = branchWith(p, "Release/Next", "r.txt", "r\n");
    const lower = branchWith(p, "release_next", "s.txt", "s\n");
    const ok = (lane: string) => finished(bashStream([["gate-1", 0], ["gate-2", 0]], lane));
    const [first, second] = [`${refId("Release/Next")}-verify`, `${refId("release_next")}-verify`];
    simulateWithMerges(p, { [first]: ok(first), [second]: ok(second) });
    expect(await runVerify(["--ref", "Release/Next"], p.ctx)).toBe(0);
    expect(await runVerify(["--ref", "release_next"], p.ctx)).toBe(0);

    expect(p.spawned.map((s) => s.lane)).toEqual([`${refId("Release/Next")}-verify`, `${refId("release_next")}-verify`]);
    expect(readRecord<VerifyRecord>(join(refDir(p, "Release/Next"), "verify.json"))).toMatchObject({ name: "ref:Release/Next", headSha: upper });
    expect(readRecord<VerifyRecord>(join(refDir(p, "release_next"), "verify.json"))).toMatchObject({ name: "ref:release_next", headSha: lower });
  });

  it("fails, as verify does, when the lane ran on another commit than the branch head", async () => {
    p = makeProject({ config: { ...DEFAULT_CONFIG, gates: GATES } });
    const head = p.ok(["rev-parse", "main"]).trim();
    const lane = `${refId("main")}-verify`;
    simulateWithMerges(p, { [lane]: finished(bashStream([["gate-1", 0], ["gate-2", 0]], lane)) }, () => {
      // The branch moves on while the lane waits to start: the lane still checks the head verify resolved.
      p.ok(["commit", "-q", "--allow-empty", "-m", "later"]);
    });
    expect(await runVerify(["--ref", "main", "--json"], p.ctx)).toBe(0);
    expect((JSON.parse(p.stdout()) as { verify: VerifyRecord }).verify).toMatchObject({ name: "ref:main", headSha: head, passed: true });

    // On the moved head, a lane whose branch ends elsewhere checked other code.
    const moved = p.ok(["rev-parse", "main"]).trim();
    simulateWithMerges(p, { [lane]: finished(bashStream([["gate-1", 0], ["gate-2", 0]], lane)) }, undefined, (worktree) => {
      p.ok(["reset", "-q", "--hard", head], worktree);
    });
    expect(await runVerify(["--ref", "main"], p.ctx)).toBe(1);
    expect(readRecord<VerifyRecord>(join(refDir(p, "main"), "verify.json")).reason).toBe(
      `${lane} ran on ${head}, not on the head of main ${moved}; run arbab verify --ref main again`,
    );
  });

  it("refuses a name with --ref, no name at all, and a branch that does not exist", async () => {
    p = makeProject({ config: { ...DEFAULT_CONFIG, gates: GATES } });
    simulateShepherds(p, {});
    await expect(runVerify(["rel", "--ref", "main"], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/not both/) });
    await expect(runVerify([], p.ctx)).rejects.toMatchObject({ code: "usage", message: "usage: arbab verify <name>" });
    await expect(runVerify(["--ref", "nope"], p.ctx)).rejects.toMatchObject({ code: "usage", message: "there is no branch nope" });
    await expect(runVerify(["--ref", "main~1"], p.ctx)).rejects.toMatchObject({ code: "usage", message: "there is no branch main~1" });
    await expect(runVerify(["--ref=-x"], p.ctx)).rejects.toMatchObject({ code: "usage", message: expect.stringMatching(/is not a branch name/) });
    expect(p.spawned).toEqual([]);
  });
});
