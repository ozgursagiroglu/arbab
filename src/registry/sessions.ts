import { realpathSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import type { SessionActivity } from "../types";
import { listShepherds, listWaiters } from "./machine";

export type { SessionActivity } from "../types";

// Which other sessions a landing affects (DESIGN.md §21): it moves the base under the lanes and waiters of this
// project, and replaces the runner file under processes of other projects that run this project's runner.

/** `path` through `realpath`, or as given when it cannot be resolved. */
export function runnerPath(path: string, realpath: (path: string) => string = realpathSync): string {
  try {
    return realpath(path);
  } catch {
    return path;
  }
}

/** `path` relative to `root` with "/" separators, or null when it does not lie inside it. */
function inside(root: string, path: string): string | null {
  const rel = relative(root, path);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

interface Tally {
  lanes: Set<string>;
  waiters: number;
  runnerProjects: Set<string>;
  runnersChanged: Set<string>;
}

const sorted = (values: Iterable<string>): string[] => [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

export function otherSessions(input: {
  home: string;
  projectRoot: string;
  /** This session (sessionOf); null outside Claude Code, when every live entry counts. */
  session: string | null;
  alive: (pid: number) => boolean;
  /** Project-relative paths the landing changes. */
  changed: readonly string[];
  realpath?: (path: string) => string;
}): SessionActivity[] {
  const real = (path: string): string => runnerPath(path, input.realpath);
  const root = real(input.projectRoot);
  const changed = new Set(input.changed);
  const byOwner = new Map<string | null, Tally>();
  const tally = (owner: string | null): Tally => {
    let t = byOwner.get(owner);
    if (t === undefined) {
      t = { lanes: new Set(), waiters: 0, runnerProjects: new Set(), runnersChanged: new Set() };
      byOwner.set(owner, t);
    }
    return t;
  };
  const entries = [
    ...listShepherds(input.home, input.alive).map((entry) => ({ ...entry, kind: "shepherd" as const })),
    ...listWaiters(input.home, input.alive).map((entry) => ({ ...entry, lane: null, kind: "waiter" as const })),
  ];
  for (const entry of entries) {
    if (input.session !== null && entry.owner === input.session) continue;
    if (real(entry.project) === root) {
      const t = tally(entry.owner);
      if (entry.kind === "shepherd" && entry.lane !== null) t.lanes.add(entry.lane);
      else t.waiters++;
      continue;
    }
    // An entry without a runner (written before 0.2.1) counts only by its project.
    const rel = entry.runner === undefined ? null : inside(root, real(entry.runner));
    if (rel === null || !changed.has(rel)) continue;
    const t = tally(entry.owner);
    t.runnerProjects.add(entry.project);
    t.runnersChanged.add(rel);
  }
  return [...byOwner]
    .sort(([a], [b]) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1))
    .map(([owner, t]) => ({
      owner,
      lanes: sorted(t.lanes),
      waiters: t.waiters,
      runnerProjects: sorted(t.runnerProjects),
      runnersChanged: sorted(t.runnersChanged),
    }));
}

/** `session:<first 8 characters of the owner>`, or `session:outside` for processes started outside Claude Code. */
export function sessionId(activity: SessionActivity): string {
  return `session:${activity.owner === null ? "outside" : activity.owner.slice(0, 8)}`;
}

const counted = (n: number, word: string): string => `${n === 1 ? "a" : n} ${word}${n === 1 ? "" : "s"}`;
const named = (names: readonly string[], word: string): string => `${word}${names.length === 1 ? "" : "s"} ${names.join(", ")}`;

/** One sentence per activity, the same in readiness.md and in land's warnings. */
export function sessionText(activity: SessionActivity): string {
  const outside = activity.owner === null;
  const who = outside ? "Processes started outside Claude Code" : `Session ${activity.owner?.slice(0, 8) ?? ""}`;
  const verb = outside ? "run" : "runs";
  const here: string[] = [];
  if (activity.lanes.length > 0) here.push(named(activity.lanes, "lane"));
  if (activity.waiters > 0) here.push(counted(activity.waiters, "waiter"));
  const clauses: string[] = [];
  if (here.length > 0) clauses.push(`${verb} ${here.join(" and ")} in this project, whose base this landing moves`);
  if (activity.runnersChanged.length > 0) {
    clauses.push(
      `${verb} this project's ${activity.runnersChanged.join(", ")} in ${activity.runnerProjects.join(", ")}, ` +
        `which this landing replaces`,
    );
  }
  return (
    `${who} ${clauses.join(", and ")}. ` +
    "Tell them before landing: Claude Code's ListAgents lists sessions by name and SendMessage reaches them."
  );
}
