// M3 end to end: integrate, verify, readiness and land through the real bundle, detached shepherds and the fake
// claude. The verify lane replays a stream whose Bash calls are exactly its checks' lines, one per configured gate
// (`node <runsRoot>/rel-verify/bin/arbab-check.mjs gate-<i>`); the fake claude never runs them.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { parseBriefSource } from "../../src/brief/parse";
import { checkCommandLine, checkScriptPath, formatFailureLine } from "../../src/check/command";
import { loadConfig } from "../../src/config";
import { confirmDeps, integrationPaths } from "../../src/integrate";
import { makeGitRunner } from "../../src/run";
import type { IntegrationRecord, LandingRecord, LaneSpec, ReadinessReport, VerifyRecord } from "../../src/types";
import { buildBundle, fakeFixture, makeE2eProject, type E2eProject } from "./harness";

/**
 * The human's confirmation of a dependency install. The CLI refuses it without a terminal (an agent's shell has
 * none), so the test shows that refusal and then confirms as the human's terminal would, through confirmDeps.
 */
async function confirmAsHuman(project: E2eProject, sha: string): Promise<IntegrationRecord> {
  const refused = await project.cli("integrate", "rel", "--deps-installed", sha);
  expect(refused.code).toBe(1);
  expect(refused.stderr).toMatch(/--deps-installed is the human's confirmation: run it yourself in a terminal/);
  const paths = integrationPaths(project.root, loadConfig(project.root), "rel");
  return confirmDeps(paths, sha, makeGitRunner(), { now: () => Date.now() });
}

let bundle: { bundle: string; dispose(): void };
let p: E2eProject | undefined;

beforeAll(async () => {
  bundle = await buildBundle();
}, 60_000);
afterAll(() => bundle?.dispose());
afterEach(() => {
  p?.dispose();
  p = undefined;
});

const GATES = [
  ["pnpm", "test"],
  ["pnpm", "typecheck"],
];
const SESSION = "11111111-2222-4333-8444-555555555555";

/** The project's config with gates and landing at tier low, committed so the main checkout stays clean. */
function configure(project: E2eProject): void {
  const path = join(project.root, "arbab.config.json");
  const config = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  writeFileSync(path, JSON.stringify({ ...config, gates: GATES, landing: { tier: "low" } }, null, 2));
  project.git(["add", "--", "arbab.config.json"]);
  project.git(["commit", "-q", "-m", "gates"]);
}

/** The lines the verify lane rel-verify runs: each gate as a check through its arbab-check script. */
const gateLines = (project: E2eProject): string[] =>
  GATES.map((_, i) => checkCommandLine(checkScriptPath(project.runsRoot, "rel-verify"), `gate-${i + 1}`));

interface VerifyCall {
  command: string;
  /** 0 by default; otherwise the result is an error starting `Exit code <n>`, then `output`. */
  exitCode?: number;
  output?: string;
}

/** A verify stream: one foreground Bash call per command line, then the probe's report. */
function verifyScenario(project: E2eProject, calls: Array<string | VerifyCall>): void {
  const init = readFileSync(fakeFixture("success-report"), "utf8").split("\n")[0] ?? "";
  const lines = [init];
  const steps = calls.map((c) => (typeof c === "string" ? { command: c, exitCode: 0, output: "ok" } : { exitCode: 0, output: "ok", ...c }));
  steps.forEach(({ command, exitCode, output }, i) => {
    const failed = exitCode !== 0;
    lines.push(
      JSON.stringify({
        type: "assistant",
        session_id: SESSION,
        uuid: `u-v${i}`,
        message: { id: `msg_v${i}`, type: "message", role: "assistant", content: [{ type: "tool_use", id: `v${i}`, name: "Bash", input: { command, timeout: 900000 } }] },
      }),
      JSON.stringify({
        type: "user",
        session_id: SESSION,
        uuid: `u-vr${i}`,
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: `v${i}`, content: failed ? `Exit code ${exitCode}\n${output}` : output, is_error: failed }],
        },
      }),
    );
  });
  const commands = steps.map((s) => s.command);
  lines.push(
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 1000,
      num_turns: commands.length,
      result: "Ran every command.",
      session_id: SESSION,
      total_cost_usd: 0.01,
      usage: {},
      modelUsage: {},
      permission_denials: [],
      terminal_reason: "completed",
      uuid: "u-vres",
      structured_output: { steps: steps.map(({ command, exitCode, output }, i) => ({ n: i + 1, command, exit_code: exitCode, output })) },
    }),
  );
  const fixture = join(project.dir, "verify.jsonl");
  writeFileSync(fixture, lines.join("\n") + "\n");
  project.scenario({ fixture });
}

/** Launches the lane with the fake worker writing `touch`, and waits for its success. */
async function runLane(project: E2eProject, lane: string, touch: string): Promise<void> {
  project.scenario({ fixture: fakeFixture("success-report"), touch });
  const launch = await project.cli("launch", project.lane(lane));
  expect(launch.code, launch.stderr).toBe(0);
  const wait = await project.cli("wait", "--any", "--timeout-min", "2", "--json", lane);
  expect(wait.code, wait.stderr).toBe(0);
  expect((JSON.parse(wait.stdout) as { finished: unknown[] }).finished).toEqual([expect.objectContaining({ lane, endState: "success" })]);
}

const integrationDir = (project: E2eProject): string => join(project.root, ".arbab", "integrations", "rel");

/** A setup script that appends `<who> <HEAD of the tree it runs in>` to the file named by its first argument. */
const setupScript = (who: string): string =>
  'const { execFileSync } = require("node:child_process");\n' +
  `require("node:fs").appendFileSync(process.argv[2], "${who} " + execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }));\n`;

/**
 * configure(), plus a dependency command that runs the tree's own scripts/setup.js, as a `postinstall` script or
 * `pip install -e .` would: no manifest names the file, but the install runs it. Returns the file the script logs to.
 */
function configureInstall(project: E2eProject): string {
  const log = join(project.dir, "installs.log");
  const path = join(project.root, "arbab.config.json");
  const config = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const dependencies = { strategy: "command", command: [process.execPath, "scripts/setup.js", log] };
  writeFileSync(path, JSON.stringify({ ...config, gates: GATES, landing: { tier: "low" }, dependencies }, null, 2));
  mkdirSync(join(project.root, "scripts"), { recursive: true });
  writeFileSync(join(project.root, "scripts", "setup.js"), setupScript("base"));
  project.git(["add", "-A"]);
  project.git(["commit", "-q", "-m", "gates and install"]);
  return log;
}

/** A lane branch arbab/<lane> off main with the given files committed, as a worker would leave it. */
function laneBranch(project: E2eProject, lane: string, files: Record<string, string>): string {
  project.git(["checkout", "-q", "-b", `arbab/${lane}`, "main"]);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(project.root, rel, ".."), { recursive: true });
    writeFileSync(join(project.root, rel), text);
  }
  project.git(["add", "--", ...Object.keys(files)]);
  project.git(["commit", "-q", "-m", `${lane} work`]);
  const sha = project.git(["rev-parse", "HEAD"]).trim();
  project.git(["checkout", "-q", "main"]);
  return sha;
}

const installs = (log: string): string[] => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter((l) => l !== "") : []);

describe("arbab landing end to end", () => {
  it("integrates two lanes, verifies inside the fence, is ready at tier low and lands into main without pushing", async () => {
    p = makeE2eProject(bundle.bundle);
    const project = p;
    configure(project);
    await runLane(project, "a", "a/out.txt");
    await runLane(project, "b", "b/out.txt");

    const integrate = await project.cli("integrate", "rel", "--lanes", "a,b", "--json");
    expect(integrate.code, integrate.stderr).toBe(0);
    const record = JSON.parse(integrate.stdout) as IntegrationRecord;
    expect(record.merged.map((m) => m.lane)).toEqual(["a", "b"]);
    expect(record.depsConfirmed).toBe(true);
    expect(existsSync(join(record.worktree, "a", "out.txt")) && existsSync(join(record.worktree, "b", "out.txt"))).toBe(true);

    // Nothing lands before a readiness report exists.
    const early = await project.cli("land", "rel");
    expect(early.code).toBe(1);
    expect(early.stderr).toContain("not landed: no readiness report; run arbab readiness rel");

    verifyScenario(project, gateLines(project));
    const verify = await project.cli("verify", "rel", "--json");
    expect(verify.code, verify.stderr).toBe(0);
    const verified = JSON.parse(verify.stdout) as { timedOut: boolean; endState: string; verify: VerifyRecord };
    expect(verified.timedOut).toBe(false);
    expect(verified.verify).toMatchObject({ lane: "rel-verify", headSha: record.headSha, passed: true, attempt: 1 });
    expect(verified.verify.results.map((r) => [r.command, r.exitCode])).toEqual([
      ["pnpm test", 0],
      ["pnpm typecheck", 0],
    ]);
    // The gates ran in the verify lane's own worktree as a probe worker; verify removed that worktree and the
    // generated branch once verify.json was written.
    const call = project.calls().at(-1);
    expect(call?.argv[call.argv.indexOf("-n") + 1]).toBe("rel-verify");
    expect(call?.cwd).toBe(join(project.worktreeRoot, "rel-verify"));
    expect(existsSync(join(project.worktreeRoot, "rel-verify"))).toBe(false);
    expect(project.git(["branch", "--list", "arbab/rel-verify"])).toBe("");
    expect(project.json<VerifyRecord>(join(integrationDir(project), "verify.json")).passed).toBe(true);

    const readiness = await project.cli("readiness", "rel", "--tier", "low");
    expect(readiness.code, readiness.stderr).toBe(0);
    expect(readiness.stdout).toContain("Ready to land: yes");
    expect(project.json<ReadinessReport>(join(integrationDir(project), "readiness.json"))).toMatchObject({ tier: "low", ready: true, headSha: record.headSha });
    expect(readFileSync(join(integrationDir(project), "readiness.md"), "utf8")).toBe(readiness.stdout);

    const lanes = ["a", "b"];
    for (const lane of lanes) expect(existsSync(join(project.worktreeRoot, lane))).toBe(true);
    const land = await project.cli("land", "rel");
    expect(land.code, land.stderr).toBe(0);
    const mergeSha = project.git(["rev-parse", "main"]).trim();
    // land cleans up what it landed: the merged lanes' and the integration's worktrees, and the integration's branch
    // (verify already removed its lane's). Lane branches stay: later plan phases merge them by name.
    expect(land.stdout).toBe(
      `landed rel: ${record.headSha} into main as ${mergeSha}\nNot pushed. To publish: git push <remote> main (no remote configured)\n` +
        [...lanes.map((lane) => join(project.worktreeRoot, lane)), record.worktree].map((path) => `removed worktree ${path}\n`).join("") +
        "deleted branch integrate/rel\n",
    );
    for (const path of [...lanes.map((lane) => join(project.worktreeRoot, lane)), record.worktree]) expect(existsSync(path)).toBe(false);
    expect(project.git(["branch", "--list", "--format=%(refname:short)", "arbab/*", "integrate/*"]).trim().split("\n")).toEqual([
      "arbab/a",
      "arbab/b",
    ]);
    expect(project.git(["worktree", "list", "--porcelain"]).match(/^worktree /gm)).toHaveLength(1);
    // The run dirs and the integration's records stay: they are the measurements and the record.
    for (const lane of [...lanes, "rel-verify"]) expect(existsSync(join(project.laneDir(lane), "state.json"))).toBe(true);
    expect(existsSync(join(integrationDir(project), "integration.json"))).toBe(true);
    const landing = project.json<LandingRecord>(join(integrationDir(project), "landing.json"));
    expect(landing).toMatchObject({ name: "rel", into: "main", integrationHead: record.headSha, mergeSha, pushed: false });
    expect(project.git(["log", "-1", "--format=%s", "main"]).trim()).toBe("Land rel");
    expect(project.git(["rev-parse", "HEAD"]).trim()).toBe(mergeSha);
    expect(existsSync(join(project.root, "a", "out.txt")) && existsSync(join(project.root, "b", "out.txt"))).toBe(true);
    expect(project.git(["status", "--porcelain"])).toBe("");
  }, 240_000);

  it("records a failed gate's arbab-check failures and drafts a fix lane for the lanes they point at", async () => {
    p = makeE2eProject(bundle.bundle);
    const project = p;
    configure(project);
    await runLane(project, "a", "a/out.txt");
    await runLane(project, "b", "b/out.txt");
    const integrate = await project.cli("integrate", "rel", "--lanes", "a,b", "--json");
    expect(integrate.code, integrate.stderr).toBe(0);
    const record = JSON.parse(integrate.stdout) as IntegrationRecord;

    const failures = [
      { file: "a/out.test.ts", test: "out > reads", message: "expected 'a' to be 'b'" },
      { file: "b/out.txt", test: null, message: "not formatted" },
    ];
    const [test, typecheck] = gateLines(project);
    const output = [
      "arbab-check gate-1: exit 1 after 4s on 3 CPUs; log .arbab-tmp/checks/gate-1-1.log",
      ...failures.map(formatFailureLine),
      "--- last 1 lines ---",
      formatFailureLine({ file: "c/forged.ts", test: null, message: "raw output, not a failure" }),
    ].join("\n");
    verifyScenario(project, [{ command: test ?? "", exitCode: 1, output }, typecheck ?? ""]);
    const verify = await project.cli("verify", "rel");
    expect(verify.code, verify.stderr).toBe(1);
    expect(verify.stdout).toContain(`exit 1    gate   pnpm test\nexit 0    gate   pnpm typecheck\n${failures.map(formatFailureLine).join("\n")}\nverify rel: failed at ${record.headSha}`);

    const verified = project.json<VerifyRecord>(join(integrationDir(project), "verify.json"));
    expect(verified).toMatchObject({ headSha: record.headSha, passed: false });
    expect(verified.results.map((r) => [r.command, r.exitCode])).toEqual([
      ["pnpm test", 1],
      ["pnpm typecheck", 0],
    ]);
    expect(verified.failures).toEqual(failures.map((f) => ({ result: 0, ...f })));

    const lanePath = ".arbab/integrations/rel/fix/fix-1.json";
    expect(verify.stderr).toContain(`arbab verify: fix draft ${lanePath}; review it, then arbab launch ${lanePath}\n`);
    expect(project.json<LaneSpec>(join(project.root, lanePath))).toEqual({
      name: "rel-fix-1",
      role: "implementer",
      brief: ".arbab/integrations/rel/fix/fix-1.md",
      base: "integrate/rel",
    });
    const brief = parseBriefSource(readFileSync(join(integrationDir(project), "fix", "fix-1.md"), "utf8"));
    expect(brief.sections.Facts).toContain("- Lane `a` may explain 1 of the failures; it changed `a/out.txt`.");
    expect(brief.sections.Facts).toContain("- Lane `b` may explain 1 of the failures; it changed `b/out.txt`.");
    expect(brief.sections.Scope).toBe(["- `a/out.test.ts`", "- `a/out.txt`", "- `b/out.txt`"].join("\n"));
    // Nothing launched it, and the CLI's own lint passes it.
    expect(existsSync(project.laneDir("rel-fix-1"))).toBe(false);
    const lint = await project.cli("lint", lanePath);
    expect(lint.code, lint.stdout + lint.stderr).toBe(0);
  }, 240_000);

  it("refuses to verify while a merged lane's manifest change is unconfirmed, until --deps-installed", async () => {
    p = makeE2eProject(bundle.bundle);
    const project = p;
    configure(project);
    await runLane(project, "m", "package.json");

    const integrate = await project.cli("integrate", "rel", "--lanes", "m");
    expect(integrate.code, integrate.stderr).toBe(0);
    expect(integrate.stdout).toContain("  m: package.json");
    const head = /^head ([0-9a-f]{40}) /m.exec(integrate.stdout)?.[1] ?? "";
    expect(integrate.stdout).toContain(`then run: arbab integrate rel --deps-installed ${head}`);

    const refused = await project.cli("verify", "rel");
    expect(refused.code).toBe(1);
    expect(refused.stderr).toMatch(/m changed package\.json: review the change and what an install at [0-9a-f]{40} runs .*, install the dependencies in .* then run arbab integrate rel --deps-installed [0-9a-f]{40}/);
    expect(existsSync(project.laneDir("rel-verify"))).toBe(false);

    expect((await confirmAsHuman(project, head)).depsConfirmed).toBe(true);
  }, 240_000);

  it("installs the verify lane on the base commit, never running a worker's setup script on the host, then verifies the head", async () => {
    p = makeE2eProject(bundle.bundle);
    const project = p;
    const log = configureInstall(project);
    // A worker changed the file the install runs, and no manifest.
    laneBranch(project, "a", { "scripts/setup.js": setupScript("pwned"), "a.txt": "a\n" });

    const integrate = await project.cli("integrate", "rel", "--lanes", "a", "--json");
    expect(integrate.code, integrate.stderr).toBe(0);
    const record = JSON.parse(integrate.stdout) as IntegrationRecord;
    expect(record).toMatchObject({ manifests: [], depsConfirmed: true });
    expect(record.headSha).not.toBe(record.baseSha);

    verifyScenario(project, gateLines(project));
    const verify = await project.cli("verify", "rel", "--json");
    expect(verify.code, verify.stderr).toBe(0);
    expect((JSON.parse(verify.stdout) as { verify: VerifyRecord }).verify).toMatchObject({ headSha: record.headSha, passed: true });

    // Every install ran the base's script on the base commit: the integration worktree's, then the verify lane's.
    expect(installs(log)).toEqual([`base ${record.baseSha}`, `base ${record.baseSha}`]);
    // The lane then worked on the integration head, with the worker's script in its tree, never run. Its worktree and
    // branch are gone once verify returns.
    const call = project.calls().at(-1);
    expect(call?.argv[call.argv.indexOf("-n") + 1]).toBe("rel-verify");
    expect(call?.cwd).toBe(join(project.worktreeRoot, "rel-verify"));
    expect(existsSync(join(project.worktreeRoot, "rel-verify"))).toBe(false);
    expect(project.git(["show", `${record.headSha}:scripts/setup.js`])).toContain('"pwned "');
    expect(project.git(["branch", "--list", "arbab/rel-verify"])).toBe("");
  }, 240_000);

  it("installs on the head a human confirmed after a manifest change, then fast-forwards to the later head", async () => {
    p = makeE2eProject(bundle.bundle);
    const project = p;
    const log = configureInstall(project);
    laneBranch(project, "m", { "package.json": '{"name":"x"}\n' });
    laneBranch(project, "b", { "scripts/setup.js": setupScript("pwned"), "b.txt": "b\n" });

    const merged = await project.cli("integrate", "rel", "--lanes", "m", "--json");
    expect(merged.code, merged.stderr).toBe(0);
    const listed = (JSON.parse(merged.stdout) as IntegrationRecord).headSha;
    const at = (await confirmAsHuman(project, listed)).headSha;
    const integrate = await project.cli("integrate", "rel", "--lanes", "b", "--json");
    expect(integrate.code, integrate.stderr).toBe(0);
    const record = JSON.parse(integrate.stdout) as IntegrationRecord;
    expect(record).toMatchObject({ manifests: ["package.json"], depsConfirmedAt: at });
    expect(record.headSha).not.toBe(at);

    verifyScenario(project, gateLines(project));
    const verify = await project.cli("verify", "rel", "--json");
    expect(verify.code, verify.stderr).toBe(0);
    expect((JSON.parse(verify.stdout) as { verify: VerifyRecord }).verify).toMatchObject({ headSha: record.headSha, passed: true });

    // The verify lane installed on the confirmed head, whose script is the base's, and ran on the integration head (the
    // verify record's headSha) in its own worktree, gone once verify returns.
    expect(installs(log)).toEqual([`base ${record.baseSha}`, `base ${at}`]);
    const call = project.calls().at(-1);
    expect(call?.cwd).toBe(join(project.worktreeRoot, "rel-verify"));
    expect(existsSync(join(project.worktreeRoot, "rel-verify"))).toBe(false);
    expect(project.git(["branch", "--list", "arbab/rel-verify"])).toBe("");
  }, 240_000);
});
