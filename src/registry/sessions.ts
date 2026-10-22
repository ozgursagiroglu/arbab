import { realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import type { SessionActivity } from "../types";
import { foldPath, sameOrInside } from "../util/pathcase";
import { listShepherds, listWaiters } from "./machine";

export type { SessionActivity } from "../types";

// Which other sessions a landing affects (DESIGN.md §21): it moves the base under the lanes and waiters of this
// project, and replaces the runner file under processes of other projects that run this project's runner.
// Paths compare through foldPath: an entry may record the project in any spelling the file system takes.

/** `path` through `realpath`, or as given when it cannot be resolved. */
export function runnerPath(path: string, realpath: (path: string) => string = (p) => realpathSync.native(p)): string {
  try {
    return realpath(path);
  } catch {
    return path;
  }
}

/** `path` relative to `root`, folded and with "/" separators, or null when it does not lie strictly inside it. */
function inside(root: string, path: string): string | null {
  if (!sameOrInside(root, path)) return null;
  const rel = relative(foldPath(root), foldPath(path));
  return rel === "" ? null : rel.split(sep).join("/");
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
  /** Paths the landing changes, relative to `changedBase`. */
  changed: readonly string[];
  /**
   * The directory `changed` is relative to: git's top level, above the project root when the project is a
   * subdirectory of its repository. The project root when not given.
   */
  changedBase?: string;
  realpath?: (path: string) => string;
}): SessionActivity[] {
  const real = (path: string): string => runnerPath(path, input.realpath);
  const root = real(input.projectRoot);
  const folded = foldPath(root);
  const base = input.changedBase === undefined ? root : real(input.changedBase);
  // Folded project-relative path to its spelling from the root, which is the one reported. A changed path outside the
  // project is none of its runners.
  const changed = new Map<string, string>();
  for (const path of input.changed) {
    const full = join(base, path);
    const key = inside(root, full);
    if (key === null) continue;
    const rel = relative(root, full);
    changed.set(key, rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) ? key : rel.split(sep).join("/"));
  }
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
    if (foldPath(real(entry.project)) === folded) {
      const t = tally(entry.owner);
      if (entry.kind === "shepherd" && entry.lane !== null) t.lanes.add(entry.lane);
      else t.waiters++;
      continue;
    }
    // An entry without a runner (written before 0.2.1) counts only by its project.
    const rel = entry.runner === undefined ? null : inside(root, real(entry.runner));
    const path = rel === null ? undefined : changed.get(rel);
    if (path === undefined) continue;
    const t = tally(entry.owner);
    t.runnerProjects.add(entry.project);
    t.runnersChanged.add(path);
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

/** One activity as text; the ending differs because readiness comes before a landing and `land` warns once it merged. */
export function sessionText(activity: SessionActivity, when: "readiness" | "land"): string {
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
  const ending =
    when === "land"
      ? "This landing went ahead: tell them what landed. Claude Code's ListAgents lists sessions by name and SendMessage reaches them."
      : "Tell them before landing: Claude Code's ListAgents lists sessions by name and SendMessage reaches them.";
  return `${who} ${clauses.join(", and ")}. ${ending}`;
}
