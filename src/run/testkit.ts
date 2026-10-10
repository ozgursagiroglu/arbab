// Test support: a worker-written nested repository whose own config runs commands on any git that descends into it.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GitRunner } from "./git";

export interface NestedRepo {
  /** Absolute path of the nested repository. */
  path: string;
  /** The file its core.fsmonitor command and clean filter append to. */
  marker: string;
  /** What has run so far ("" when nothing): `fsmonitor` and `clean` lines. */
  ran: () => string;
  /** Forgets what ran so far. */
  reset: () => void;
}

function ok(git: GitRunner, args: string[], cwd: string): string {
  const r = git(args, cwd);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

/**
 * Makes `<worktree>/<rel>` a repository with one commit, then configures, as a worker could, a core.fsmonitor command
 * and a clean filter for every file that append to a marker under `scratch`, and leaves a file modified so a git that
 * looks at its work tree runs both.
 */
export function plantNestedRepo(git: GitRunner, worktree: string, rel: string, scratch: string): NestedRepo {
  const path = join(worktree, rel);
  const marker = join(scratch, `nested-ran-${rel.replace(/[^A-Za-z0-9]/g, "_")}`);
  const monitor = join(scratch, `fsmonitor-${rel.replace(/[^A-Za-z0-9]/g, "_")}.sh`);
  mkdirSync(path, { recursive: true });
  ok(git, ["init", "-q", "-b", "main", path], scratch);
  writeFileSync(join(path, "f.txt"), "one\n");
  ok(git, ["add", "-A"], path);
  ok(git, ["commit", "-q", "-m", "nested"], path);
  writeFileSync(monitor, `#!/bin/sh\necho fsmonitor >> '${marker}'\n`, { mode: 0o755 });
  ok(git, ["config", "core.fsmonitor", monitor], path);
  ok(git, ["config", "filter.evil.clean", `sh -c "echo clean >> '${marker}'; cat"`], path);
  writeFileSync(join(path, ".gitattributes"), "* filter=evil\n");
  writeFileSync(join(path, "f.txt"), "two\n");
  const reset = (): void => rmSync(marker, { force: true });
  reset();
  return { path, marker, ran: () => (existsSync(marker) ? readFileSync(marker, "utf8") : ""), reset };
}
