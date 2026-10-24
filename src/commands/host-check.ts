// arbab host-check <name>
//
// Runs the configured hostGates in the integration worktree, on the host, in order, all of them even after a failure
// (DESIGN.md §21): the checks the fence cannot run (Docker, a browser, a database). The tree is worker code, so only a
// human in a terminal may start it; nothing else in arbab runs a host gate. A missing integration worktree is rebuilt
// on its branch first, its dependencies installed on a trusted commit before the checkout. The worktree's writer lock
// is held from before the rebuild until the record is written, so no sweep or cleanup removes it meanwhile; while
// another live process holds it, host-check waits (up to 2 minutes), then refuses naming that pid. The recorded head
// is checked before the wait and again under the lock, which refuses a head that moved meanwhile.
// Writes .arbab/integrations/<name>/host-checks.json (HostCheckRecord) for the integration head.
// Text: one line per gate; a failing gate's output goes to stderr. Exit 0 when every gate exited 0, 1 otherwise.
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { ensureIntegrationWorktree } from "../integrate";
import { untrustedTree } from "../run";
import { HOST_CHECKS_FILE, type GateResult, type HostCheckRecord } from "../types";
import { ArbabError } from "../util/errors";
import { readJson, writeJsonAtomic } from "../util/fs";
import { assertValidName } from "../util/names";
import { isoAt } from "../util/proc";
import { commandLine } from "../verify";
import type { CommandContext } from "./context";
import { assertRecordedHead, openIntegration } from "./integration";
import { onePositional, openProject, parse } from "./project";
import { withWorktreeLock } from "./worktree-lock";

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const isGateResult = (v: unknown): boolean =>
  isObject(v) &&
  (v["kind"] === "gate" || v["kind"] === "smoke") &&
  Array.isArray(v["argv"]) &&
  v["argv"].every((a) => typeof a === "string") &&
  typeof v["command"] === "string" &&
  (v["exitCode"] === null || Number.isInteger(v["exitCode"]));

/** host-checks.json, or null before the first `host-check`. A person may edit it, so it is checked. */
export function readHostCheckRecord(path: string, name: string): HostCheckRecord | null {
  const raw = readJson<unknown>(path);
  if (raw === null) return null;
  const ok =
    isObject(raw) &&
    raw["name"] === name &&
    typeof raw["headSha"] === "string" &&
    Array.isArray(raw["results"]) &&
    raw["results"].every(isGateResult) &&
    typeof raw["passed"] === "boolean" &&
    raw["interactive"] === true &&
    typeof raw["finishedAt"] === "string";
  if (!ok) throw new ArbabError("io", `${path} is not a host check record for ${name}`);
  return raw as unknown as HostCheckRecord;
}

/** Refuses unless the worktree is checked out at `head` with no tracked change: the record vouches for that commit. */
function assertWorktreeAt(ctx: CommandContext, worktree: string, head: string): void {
  // Rebuilt before this check; still missing means the rebuild did not leave it.
  if (!existsSync(worktree)) throw new ArbabError("usage", `the integration worktree ${worktree} does not exist after its rebuild`);
  const at = ctx.git([...untrustedTree(), "rev-parse", "HEAD"], worktree);
  if (at.code !== 0 || at.stdout.trim() !== head) {
    throw new ArbabError("usage", `${worktree} is at ${at.code === 0 ? at.stdout.trim() : "no commit"}, not at the integration head ${head}`);
  }
  const status = ctx.git([...untrustedTree(), "status", "--porcelain", "--untracked-files=no"], worktree);
  if (status.code !== 0) throw new ArbabError("git", `git status failed in ${worktree}: ${status.stderr.trim()}`);
  if (status.stdout.trim() !== "") {
    throw new ArbabError("usage", `${worktree} has tracked changes, so the gates would not check ${head}; commit or discard them first`);
  }
}

export async function runHostCheck(argv: string[], ctx: CommandContext): Promise<number> {
  const { positionals } = parse("host-check", { args: argv, options: {}, allowPositionals: true });
  const name = assertValidName(onePositional("host-check", positionals, "name"), "integration");
  // The gates run worker-written code on the host, outside the fence: an agent's shell has no terminal.
  if (!ctx.interactive) {
    throw new ArbabError(
      "usage",
      "host-check runs worker-written code on the host: run it yourself in a terminal, after reviewing the integration",
    );
  }
  const project = openProject(ctx);
  const gates = project.config.hostGates;
  if (gates.length === 0) throw new ArbabError("usage", "no hostGates are configured; add them to the config first");
  const integration = openIntegration(project, name);
  assertRecordedHead(ctx.git, project, integration);
  const head = integration.record.headSha;
  const worktree = integration.paths.worktree;
  // The gates take minutes and the record is written at the end: the writer lock keeps a sweep or cleanup from
  // removing the worktree, as idle, under them.
  const record = await withWorktreeLock(ctx, project, basename(worktree), "host-check", () => {
    // Checked again under the lock: an integrate or a hand commit may have moved the head during the wait, and the
    // human started the gates for the head read before it.
    const now = openIntegration(project, name);
    assertRecordedHead(ctx.git, project, now);
    if (now.record.headSha !== head) {
      throw new ArbabError("usage", `${now.paths.branch} moved from ${head} to ${now.record.headSha} while host-check waited; review it and run host-check again`);
    }
    // A worktree removed while idle is rebuilt on the branch, its install at a trusted commit; the branch is at the
    // recorded head (checked above), so the rebuilt tree is too.
    ensureIntegrationWorktree({ projectRoot: project.root, config: project.config, git: ctx.git, runCommand: ctx.runCommand }, integration.paths);
    assertWorktreeAt(ctx, worktree, head);

    const results: GateResult[] = [];
    for (const gate of gates) {
      const command = commandLine(gate);
      const r = ctx.runCommand(gate, worktree);
      results.push({ kind: "gate", argv: gate, command, exitCode: r.code });
      ctx.stdout(`${r.code === 0 ? "pass" : `FAIL (exit ${r.code})`}  ${command}\n`);
      if (r.code !== 0 && r.output.trim() !== "") ctx.stderr(`--- ${command}\n${r.output.endsWith("\n") ? r.output : `${r.output}\n`}`);
    }
    const done: HostCheckRecord = {
      name,
      headSha: head,
      results,
      passed: results.every((result) => result.exitCode === 0),
      interactive: true,
      finishedAt: isoAt(ctx.clock),
    };
    writeJsonAtomic(join(integration.paths.dir, HOST_CHECKS_FILE), done);
    return done;
  });
  return record.passed ? 0 : 1;
}
