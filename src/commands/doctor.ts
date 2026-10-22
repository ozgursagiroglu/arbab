// arbab doctor [--json]
//
// Text: one line per check, `ok|warn|fail  <check>  <detail>`.
// --json: {"ok": boolean, "checks": [{"status": "ok" | "warn" | "fail", "check": string, "detail": string}]}
// Exit 1 when any check fails; warnings do not fail.
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { compareVersions, findOnPath, parseVersion, resolveBinary } from "../binary";
import { defaultConfig, loadConfig } from "../config";
import {
  checkConfigFiles,
  checkDisk,
  checkEnvTemplates,
  checkEslint,
  checkGates,
  checkHook,
  checkIgnored,
  checkMachineCap,
  checkTestConfigs,
  type DoctorCheck,
} from "../doctor";
import type { ShepherdDeps } from "../shepherd";
import type { ProjectConfig } from "../types";
import { confine, createExclusive, ensureDir } from "../util/fs";
import type { CommandContext } from "./context";
import { findProjectRoot, parse, printJson } from "./project";

export type { CheckStatus, DoctorCheck } from "../doctor";

const MIN_NODE = "20.0.0";
const MIN_GIT = "2.20.0";

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function atLeast(version: string, min: string): boolean {
  return parseVersion(version) !== null && compareVersions(version, min) >= 0;
}

export function checkNode(nodeVersion: string): DoctorCheck {
  return atLeast(nodeVersion, MIN_NODE)
    ? { status: "ok", check: "node", detail: nodeVersion }
    : { status: "fail", check: "node", detail: `${nodeVersion} is older than ${MIN_NODE}` };
}

export function checkGit(ctx: Pick<CommandContext, "git" | "cwd">): DoctorCheck {
  const r = ctx.git(["--version"], ctx.cwd);
  const version = parseVersion(r.stdout)?.join(".") ?? null;
  if (r.code !== 0 || version === null) return { status: "fail", check: "git", detail: `git --version failed: ${(r.stderr || r.stdout).trim()}` };
  return atLeast(version, MIN_GIT)
    ? { status: "ok", check: "git", detail: version }
    : { status: "fail", check: "git", detail: `${version} is older than ${MIN_GIT}` };
}

export function checkClaude(deps: ShepherdDeps, config: ProjectConfig): DoctorCheck {
  try {
    const binary = resolveBinary({
      pinned: null,
      explicitPath: deps.explicitClaude,
      pathEnv: deps.pathEnv,
      minVersion: config.minClaudeVersion,
      run: deps.run,
      exists: deps.exists,
      realpath: deps.realpath,
    });
    return { status: "ok", check: "claude", detail: `${binary.version} at ${binary.path} (minimum ${config.minClaudeVersion})` };
  } catch (err) {
    return { status: "fail", check: "claude", detail: message(err) };
  }
}

export function checkSandbox(platform: NodeJS.Platform, deps: Pick<ShepherdDeps, "exists" | "pathEnv">): DoctorCheck {
  if (platform === "darwin") {
    return deps.exists("/usr/bin/sandbox-exec")
      ? { status: "ok", check: "sandbox", detail: "/usr/bin/sandbox-exec" }
      : { status: "fail", check: "sandbox", detail: "/usr/bin/sandbox-exec is missing" };
  }
  if (platform === "linux") {
    const missing = ["bwrap", "socat"].filter((cmd) => findOnPath(cmd, deps.pathEnv, deps.exists) === null);
    return missing.length === 0
      ? { status: "ok", check: "sandbox", detail: "bwrap and socat on PATH" }
      : { status: "fail", check: "sandbox", detail: `${missing.join(" and ")} not on PATH` };
  }
  return { status: "fail", check: "sandbox", detail: `Claude Code has no sandbox on ${platform}` };
}

export function checkHome(home: string): DoctorCheck {
  const probe = join(home, `.doctor-${randomBytes(6).toString("hex")}`);
  try {
    ensureDir(home);
    createExclusive(probe, "");
    rmSync(probe, { force: true });
    return { status: "ok", check: "home", detail: `${home} is writable` };
  } catch (err) {
    return { status: "fail", check: "home", detail: `${home} is not writable: ${message(err)}` };
  }
}

/** A check that throws is reported as a warning under its name, so one surprise in a project hides no other check. */
function guarded(check: string, run: () => DoctorCheck | DoctorCheck[] | null): DoctorCheck[] {
  try {
    const result = run();
    return result === null ? [] : Array.isArray(result) ? result : [result];
  } catch (err) {
    return [{ status: "warn", check, detail: `could not check: ${message(err)}` }];
  }
}

/** The checks of DESIGN.md §21: what made real projects fail after launch, named before it. */
export function projectChecks(ctx: CommandContext, root: string, config: ProjectConfig): DoctorCheck[] {
  return [
    ...guarded("ignored", () => checkIgnored(ctx.git, root, config)),
    ...guarded("eslint", () => checkEslint(root)),
    ...guarded("tests", () => checkTestConfigs(root)),
    ...guarded("gates", () => checkGates(root, config.gates)),
    ...guarded("env", () => checkEnvTemplates(ctx.git, root, config.fence.readableEnvFiles)),
    ...guarded("disk", () => checkDisk(confine(root, config.worktreeRoot), config.worktreeRoot, ctx.home)),
    ...guarded("machine", () => checkMachineCap(ctx.home, root, config.maxParallel)),
  ];
}

export function doctorChecks(ctx: CommandContext): DoctorCheck[] {
  const checks: DoctorCheck[] = [checkNode(ctx.nodeVersion), checkGit(ctx)];

  const root = findProjectRoot(ctx.cwd, ctx.git);
  let config: ProjectConfig | null = null;
  if (root === null) {
    checks.push({ status: "fail", check: "config", detail: `no arbab.config.json or git repository at or above ${ctx.cwd}` });
  } else {
    try {
      config = loadConfig(root);
      checks.push({ status: "ok", check: "config", detail: `${root}` });
    } catch (err) {
      checks.push({ status: "fail", check: "config", detail: message(err) });
    }
    checks.push(...guarded("configs", () => checkConfigFiles(root)));
  }

  let deps: ShepherdDeps | null = null;
  try {
    deps = ctx.shepherdDeps();
  } catch (err) {
    checks.push({ status: "fail", check: "claude", detail: message(err) });
    checks.push({ status: "fail", check: "sandbox", detail: message(err) });
  }
  if (deps !== null) {
    checks.push(checkClaude(deps, config ?? defaultConfig()));
    checks.push(checkSandbox(ctx.platform, deps));
  }
  checks.push(...guarded("hook", () => checkHook(ctx.scriptPath)));

  if (root !== null && config !== null) checks.push(...projectChecks(ctx, root, config));
  checks.push(checkHome(ctx.home));
  return checks;
}

export function formatChecks(checks: Array<{ status: string; check: string; detail: string }>): string {
  const width = Math.max(...checks.map((c) => c.check.length));
  return checks.map((c) => `${c.status.padEnd(4)}  ${c.check.padEnd(width)}  ${c.detail}`).join("\n");
}

export async function runDoctor(argv: string[], ctx: CommandContext): Promise<number> {
  const { values } = parse("doctor", { args: argv, options: { json: { type: "boolean" } }, allowPositionals: false });
  const checks = doctorChecks(ctx);
  const ok = checks.every((c) => c.status !== "fail");
  if (values.json === true) printJson(ctx, { ok, checks });
  else ctx.stdout(formatChecks(checks) + "\n");
  return ok ? 0 : 1;
}
